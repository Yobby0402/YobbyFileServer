# main.py
import os
import sys
import configparser
import json
import logging
import threading
from datetime import datetime
import ctypes
import socket
from logging.handlers import TimedRotatingFileHandler
from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import routes
from serial_manager import serial_manager
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                                QPushButton, QTextEdit, QLabel, QGroupBox, QMessageBox, 
                                QSystemTrayIcon, QMenu, QAction, QDialog, QLineEdit, 
                                QFileDialog, QFormLayout, QMenuBar, QInputDialog, QCheckBox,
                                QListWidget, QListWidgetItem, QComboBox)
from PyQt5.QtCore import QProcess, QTimer, Qt, pyqtSignal, QObject, QThread
from PyQt5.QtCore import QEventLoop
from PyQt5.QtGui import QIcon, QTextCursor


# =============================
# 资源与路径处理函数
# =============================

def get_resource_path(relative_path):
    """
    获取资源路径：
    - 开发环境：返回相对于 .py 文件的路径
    - 打包环境：返回相对于 .exe 文件的路径（外部文件夹）
    """
    if getattr(sys, 'frozen', False):
        # 打包环境：exe 所在目录
        base_path = os.path.dirname(sys.executable)
    else:
        # 开发环境：.py 文件所在目录
        base_path = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base_path, relative_path)


def get_config_path():
    """获取配置文件路径，优先exe/py所在目录，否则用户目录"""
    config_name = 'config.ini'
    
    # 获取程序所在目录（打包后是exe目录，开发时是.py文件目录）
    if getattr(sys, 'frozen', False):
        # 打包环境：exe所在目录
        base_dir = os.path.dirname(sys.executable)
        app_logger.info("[调试] 打包模式 - exe目录: %s", base_dir)
    else:
        # 开发环境：.py文件所在目录
        base_dir = os.path.dirname(os.path.abspath(__file__))
        app_logger.info("[调试] 开发模式 - py目录: %s", base_dir)
    
    program_dir_path = os.path.join(base_dir, config_name)
    app_logger.info("[调试] 配置文件路径: %s", program_dir_path)
    
    # 如果配置文件已存在于程序目录，直接返回
    if os.path.exists(program_dir_path):
        app_logger.info("[调试] 配置文件已存在")
        return program_dir_path
    
    # 配置文件不存在，测试程序目录是否可写
    try:
        # 使用临时文件测试写权限
        test_file = os.path.join(base_dir, '.config_write_test')
        with open(test_file, 'w') as f:
            f.write('test')
        os.remove(test_file)
        # 程序目录可写，使用程序目录
        app_logger.info("[调试] 程序目录可写，配置文件将创建在: %s", program_dir_path)
        return program_dir_path
    except Exception as e:
        # 程序目录不可写，使用用户目录
        config_dir = os.path.join(os.path.expanduser("~"), ".yobboy_file_server")
        os.makedirs(config_dir, exist_ok=True)
        fallback_path = os.path.join(config_dir, config_name)
        app_logger.warning("[调试] 程序目录不可写(%s)，使用用户目录: %s", e, fallback_path)
        return fallback_path


def get_logs_dir():
    """获取日志目录，优先exe/py所在目录，否则用户目录"""
    # 获取程序所在目录（打包后是exe目录，开发时是.py文件目录）
    if getattr(sys, 'frozen', False):
        # 打包环境：exe所在目录
        base_dir = os.path.dirname(sys.executable)
    else:
        # 开发环境：.py文件所在目录
        base_dir = os.path.dirname(os.path.abspath(__file__))
    
    logs_dir = os.path.join(base_dir, "logs")
    try:
        os.makedirs(logs_dir, exist_ok=True)
        test_file = os.path.join(logs_dir, '.test')
        with open(test_file, 'w'):
            pass
        os.remove(test_file)
        return logs_dir
    except:
        logs_dir = os.path.join(os.path.expanduser("~"), ".yobboy_file_server", "logs")
        os.makedirs(logs_dir, exist_ok=True)
        return logs_dir


# =============================
# Flask 应用日志配置
# =============================

def _create_rotating_handler(log_file, level=logging.INFO):
    """创建按天轮转的日志处理器。"""
    handler = TimedRotatingFileHandler(
        filename=log_file,
        when='midnight',
        interval=1,
        backupCount=14,
        encoding='utf-8'
    )
    handler.suffix = "%Y-%m-%d"
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter(
        '%(asctime)s - %(levelname)s - %(name)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    ))
    return handler


_logs_dir = get_logs_dir()
app_logger = logging.getLogger("yobboy_file_server")
app_logger.setLevel(logging.INFO)
if not app_logger.handlers:
    app_logger.addHandler(_create_rotating_handler(os.path.join(_logs_dir, "app.log"), logging.INFO))
app_logger.propagate = False

connection_logger = logging.getLogger("file_server_connections")
connection_logger.setLevel(logging.INFO)
if not connection_logger.handlers:
    connection_logger.addHandler(_create_rotating_handler(os.path.join(_logs_dir, "access.log"), logging.INFO))
connection_logger.propagate = False


# IP地址缓存（避免重复查询）
_ip_cache = None
_ip_cache_time = 0
_ip_cache_ttl = 300  # 缓存5分钟

def get_local_ips(verbose=True, use_cache=True):
    """
    获取本机所有 IPv4 地址，智能排序优先返回真实可用的局域网IP
    优先级：
    1. 通过默认路由的IP（最可能是真实物理网卡）
    2. 常见局域网段的IP（10.x, 172.16-31.x, 192.168.x）
    3. 其他非虚拟网络的IP
    4. 排除虚拟网络接口（VMware、VirtualBox、Docker等）
    
    Args:
        verbose: 是否打印详细调试信息（默认True）
        use_cache: 是否使用缓存（默认True，5分钟内复用结果）
    """
    global _ip_cache, _ip_cache_time
    
    # 检查缓存
    if use_cache and _ip_cache is not None:
        import time
        if time.time() - _ip_cache_time < _ip_cache_ttl:
            if verbose:
                app_logger.info("[网络] 使用缓存的IP地址列表（%s个地址）", len(_ip_cache))
            return _ip_cache.copy()
    
    ip_list = []
    default_ip = None
    
    # 虚拟网络常见IP段（需要排除或降低优先级）
    virtual_prefixes = [
        '192.168.56.',   # VirtualBox Host-Only
        '192.168.99.',   # Docker Toolbox
        '192.168.116.',  # VMware
        '192.168.113.',  # VMware
        '192.168.137.',  # Windows移动热点
        '172.17.',       # Docker
        '172.18.',       # Docker
        '172.19.',       # Docker
        '10.0.2.',       # VirtualBox NAT
    ]
    
    # 1. 首先尝试获取默认路由的IP（最可靠的真实网卡IP）
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.settimeout(1)  # 设置超时，避免长时间阻塞
            s.connect(("8.8.8.8", 80))
            default_ip = s.getsockname()[0]
            if verbose:
                app_logger.info("[网络] 默认路由IP（推荐）: %s", default_ip)
    except Exception as e:
        if verbose:
            app_logger.warning("[网络] 无法获取默认路由IP: %s", e)
    
    # 2. 获取所有网络接口的IP地址
    try:
        hostname = socket.gethostname()
        addr_info = socket.getaddrinfo(hostname, None)
        for info in addr_info:
            if info[0] == socket.AF_INET:
                ip = info[4][0]
                # 排除回环地址
                if ip != '127.0.0.1' and not ip.startswith('127.'):
                    ip_list.append(ip)
    except Exception as e:
        if verbose:
            app_logger.warning("[网络] 获取主机名IP时出错: %s", e)
    
    # 3. 智能排序IP地址
    def ip_priority(ip):
        """
        计算IP的优先级（数字越小优先级越高）
        """
        # 最高优先级：默认路由IP
        if ip == default_ip:
            return 0
        
        # 次高优先级：排除虚拟网络后的常见局域网段
        is_virtual = any(ip.startswith(prefix) for prefix in virtual_prefixes)
        
        if not is_virtual:
            # 常见局域网段
            if ip.startswith('192.168.'):
                # 提取第三段数字，避免虚拟网络段
                try:
                    third_octet = int(ip.split('.')[2])
                    # 常见的真实局域网第三段通常是 0-20 或者较大的数（如100+）
                    if third_octet <= 20 or third_octet >= 100:
                        return 1  # 高优先级真实局域网
                    else:
                        return 3  # 可能是特殊配置的局域网
                except (ValueError, IndexError):
                    return 3
            elif ip.startswith('10.'):
                return 2  # 10.x.x.x 段
            elif ip.startswith('172.'):
                # 172.16.0.0 - 172.31.255.255 是私有地址
                try:
                    second_octet = int(ip.split('.')[1])
                    if 16 <= second_octet <= 31:
                        return 2  # 私有局域网
                    else:
                        return 4  # 其他172段（可能是虚拟网络）
                except (ValueError, IndexError):
                    return 4
        
        # 低优先级：已知的虚拟网络
        return 10
    
    # 去重并排序
    ip_list = list(set(ip_list))
    
    # 如果有默认IP且不在列表中，添加到列表
    if default_ip and default_ip not in ip_list:
        ip_list.append(default_ip)
    
    # 按优先级排序
    ip_list.sort(key=ip_priority)
    
    # 打印所有找到的IP及其优先级（仅在verbose模式下）
    if verbose:
        app_logger.info("[网络] 找到的所有IP地址（按优先级排序）:")
        for ip in ip_list:
            priority = ip_priority(ip)
            # 使用ASCII字符替代Unicode字符，避免Windows控制台编码问题
            if priority <= 2:
                status = "[推荐]"
            elif priority >= 10:
                status = "[虚拟网络]"
            else:
                status = "[可用]"
            
            try:
                app_logger.info("  %s %s (优先级: %s)", status, ip, priority)
            except UnicodeEncodeError:
                # 如果仍然有编码问题，使用纯ASCII输出
                app_logger.info("  %s %s (priority: %s)", status, ip, priority)
    
    # 更新缓存
    if use_cache:
        import time
        _ip_cache = ip_list.copy()
        _ip_cache_time = time.time()
    
    return ip_list


def log_connection_info():
    """记录当前请求的连接信息"""
    if request:
        path = request.path
        # 跳过高频静态资源与连接探测请求，减少日志 I/O 压力
        if path.startswith('/static/') or path.startswith('/socket.io/') or path == '/favicon.ico':
            return
        client_ip = request.environ.get('REMOTE_ADDR')
        user_agent = request.headers.get('User-Agent', 'Unknown')
        method = request.method
        msg = f"IP: {client_ip} | Method: {method} | Path: {path} | User-Agent: {user_agent}"
        connection_logger.info(msg)


def create_app(debug=False):
    """应用工厂函数"""
    # 显式指定 templates 和 static 目录（外部文件夹）
    template_dir = get_resource_path('templates')
    static_dir = get_resource_path('static')

    app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)
    app.secret_key = 'your_super_secret_key_change_this_in_production'
    app.config['CONFIG_FILE'] = get_config_path()
    app.config['DEFAULT_ROOT_DIR'] = os.path.expanduser("~")
    
    # 调试模式由启动参数控制，避免 GUI 场景默认开启调试
    app.debug = debug

    # 确保模板和静态目录存在（用于首次运行时创建）
    os.makedirs(template_dir, exist_ok=True)
    os.makedirs(static_dir, exist_ok=True)

    @app.before_request
    def before_request():
        log_connection_info()

    # 先加载配置，再初始化路由（这样路由初始化时能读取到正确的配置）
    load_or_create_config(app)
    
    routes.init_app(app)
    
    # 初始化 SocketIO（显式使用 threading 模式以加快启动速度）
    socketio = SocketIO(app, 
                      cors_allowed_origins="*", 
                      logger=False,
                      engineio_logger=False,
                      async_mode='threading',  # 显式指定 threading 模式，避免自动检测延迟
                      ping_timeout=60,
                      ping_interval=25)
    init_serial_socketio(socketio)
    app.socketio = socketio
    
    return app


def init_serial_socketio(socketio):
    """初始化串口 WebSocket 事件"""
    
    # 存储客户端会话
    serial_sessions = {}
    serial_sessions_lock = threading.Lock()
    
    @socketio.on('connect', namespace='/serial')
    def handle_connect():
        """客户端连接"""
        app_logger.info('[Serial WebSocket] 客户端连接: %s', request.sid)
        emit('connected', {'client_id': request.sid})
    
    @socketio.on('disconnect', namespace='/serial')
    def handle_disconnect():
        """客户端断开"""
        app_logger.info('[Serial WebSocket] 客户端断开: %s', request.sid)
        
        # 清理会话
        with serial_sessions_lock:
            session_ports = dict(serial_sessions.pop(request.sid, {}))
        for port_id, listener_id in session_ports.items():
            try:
                serial_manager.release_port(port_id, listener_id)
            except Exception:
                pass
    
    @socketio.on('list_ports', namespace='/serial')
    def handle_list_ports():
        """列出可用串口"""
        try:
            ports = serial_manager.list_available_ports()
            emit('ports_list', {'success': True, 'ports': ports})
        except Exception as e:
            emit('ports_list', {'success': False, 'error': str(e)})
    
    @socketio.on('open_port', namespace='/serial')
    def handle_open_port(data):
        """打开串口"""
        try:
            port_id = data.get('port_id')
            device = data.get('device')
            baudrate = int(data.get('baudrate', 9600))
            bytesize = int(data.get('bytesize', 8))
            parity = data.get('parity', 'N')
            stopbits = int(data.get('stopbits', 1))
            
            listener_id = f"{request.sid}:{port_id}"

            def on_data_received(pid, data_bytes):
                """数据接收回调"""
                # 广播数据给所有监听此端口的客户端
                socketio.emit('serial_data', {
                    'port_id': pid,
                    'data': list(data_bytes),  # 转换为列表以便 JSON 序列化
                    'timestamp': datetime.now().isoformat()
                }, namespace='/serial', room=f'port_{pid}')
            
            # 打开串口
            success = serial_manager.open_port(
                port_id=port_id,
                device=device,
                baudrate=baudrate,
                bytesize=bytesize,
                parity=parity,
                stopbits=stopbits,
                listener_id=listener_id,
                callback=on_data_received
            )
            
            if success:
                # 记录会话
                with serial_sessions_lock:
                    serial_sessions.setdefault(request.sid, {})[port_id] = listener_id
                
                # 加入房间
                join_room(f'port_{port_id}')
                
                # 获取端口信息
                port_info = serial_manager.get_port_info(port_id)
                
                emit('port_opened', {
                    'success': True,
                    'port_id': port_id,
                    'port_info': port_info
                })
            else:
                emit('port_opened', {
                    'success': False,
                    'port_id': port_id,
                    'error': '打开串口失败'
                })
        
        except Exception as e:
            app_logger.error('[错误] 打开串口失败: %s', e)
            emit('port_opened', {
                'success': False,
                'error': str(e)
            })
    
    @socketio.on('close_port', namespace='/serial')
    def handle_close_port(data):
        """关闭串口"""
        try:
            port_id = data.get('port_id')
            
            with serial_sessions_lock:
                session_ports = serial_sessions.get(request.sid, {})
                listener_id = session_ports.pop(port_id, None)

            # 释放监听器（若没有其他监听器与日志，则会关闭串口）
            serial_manager.release_port(port_id, listener_id)
            
            # 离开房间
            leave_room(f'port_{port_id}')
            
            emit('port_closed', {
                'success': True,
                'port_id': port_id
            })
        
        except Exception as e:
            app_logger.error('[错误] 关闭串口失败: %s', e)
            emit('port_closed', {
                'success': False,
                'error': str(e)
            })
    
    @socketio.on('write_data', namespace='/serial')
    def handle_write_data(data):
        """写入数据到串口"""
        try:
            port_id = data.get('port_id')
            data_bytes = bytes(data.get('data', []))
            
            # 写入数据
            bytes_written = serial_manager.write_data(port_id, data_bytes)
            
            if bytes_written >= 0:
                emit('data_written', {
                    'success': True,
                    'port_id': port_id,
                    'bytes_written': bytes_written
                })
            else:
                emit('data_written', {
                    'success': False,
                    'port_id': port_id,
                    'error': '写入数据失败'
                })
        
        except Exception as e:
            app_logger.error('[错误] 写入数据失败: %s', e)
            emit('data_written', {
                'success': False,
                'error': str(e)
            })
    
    @socketio.on('get_port_info', namespace='/serial')
    def handle_get_port_info(data):
        """获取串口信息"""
        try:
            port_id = data.get('port_id')
            port_info = serial_manager.get_port_info(port_id)
            
            if port_info:
                emit('port_info', {
                    'success': True,
                    'port_id': port_id,
                    'port_info': port_info
                })
            else:
                emit('port_info', {
                    'success': False,
                    'port_id': port_id,
                    'error': '串口不存在'
                })
        
        except Exception as e:
            emit('port_info', {
                'success': False,
                'error': str(e)
            })


def load_or_create_config(app):
    """加载或创建配置文件"""
    config_file = app.config['CONFIG_FILE']
    config = configparser.ConfigParser()
    
    if os.path.exists(config_file):
        # 配置文件存在，加载配置
        config.read(config_file, encoding='utf-8')
        if 'settings' in config:
            settings = config['settings']
            root_dir = settings.get('root_dir', app.config['DEFAULT_ROOT_DIR'])
            password = settings.get('password', 'password')
            admin_password = settings.get('admin_password', 'admin123')  # 管理员密码
            close_to_tray = settings.get('close_to_tray', 'false').lower() == 'true'  # 关闭到托盘
            port = int(settings.get('port', '5000'))  # 服务器端口
            git_enabled = settings.get('git_enabled', 'false').lower() == 'true'  # Git功能开关
            git_workdir = settings.get('git_workdir', '')  # Git工作目录
            git_external_app_path = settings.get('git_external_app_path', '')  # Git外部软件路径（如VSCode）
            
            # 保存配置到app中（即使路径不存在也保留用户设置）
            app.config['ROOT_DIR'] = os.path.normpath(root_dir) if root_dir else app.config['DEFAULT_ROOT_DIR']
            app.config['PASSWORD'] = password
            app.config['ADMIN_PASSWORD'] = admin_password
            app.config['CLOSE_TO_TRAY'] = close_to_tray
            app.config['PORT'] = port
            app.config['GIT_ENABLED'] = git_enabled
            app.config['GIT_WORKDIR'] = os.path.normpath(git_workdir) if git_workdir else ''
            app.config['GIT_EXTERNAL_APP_PATH'] = git_external_app_path if git_external_app_path else ''
            
            # 检查路径是否有效（仅警告，不修改配置）
            if not os.path.isdir(app.config['ROOT_DIR']):
                app_logger.warning("[警告] 配置的根目录 '%s' 不存在或无效", app.config['ROOT_DIR'])
                app_logger.warning("  请通过设置界面修改根目录，或手动创建该目录")
            
            app_logger.info("[OK] 配置已加载: 根目录=%s, 密码长度=%s, 管理员密码已设置", app.config['ROOT_DIR'], len(password))
            app_logger.info("[配置] Git功能开关: %s (从配置文件读取: %s)", git_enabled, settings.get('git_enabled', 'false'))
            app_logger.info("[配置] Git工作目录: %s", app.config['GIT_WORKDIR'] if app.config['GIT_WORKDIR'] else '未设置')
        else:
            # 配置文件格式错误，使用默认值并保存
            app_logger.warning("[警告] 配置文件格式错误，使用默认配置")
            app.config['ROOT_DIR'] = app.config['DEFAULT_ROOT_DIR']
            app.config['PASSWORD'] = 'password'
            app.config['ADMIN_PASSWORD'] = 'admin123'
            app.config['CLOSE_TO_TRAY'] = False
            app.config['PORT'] = 5000
            app.config['GIT_ENABLED'] = False
            app.config['GIT_WORKDIR'] = ''
            save_config(app)
    else:
        # 配置文件不存在，创建默认配置
        app_logger.info("配置文件不存在，创建默认配置")
        app.config['ROOT_DIR'] = app.config['DEFAULT_ROOT_DIR']
        app.config['PASSWORD'] = 'password'
        app.config['ADMIN_PASSWORD'] = 'admin123'
        app.config['CLOSE_TO_TRAY'] = False
        app.config['PORT'] = 5000
        app.config['GIT_ENABLED'] = False
        app.config['GIT_WORKDIR'] = ''
        save_config(app)


def read_runtime_settings(create_if_missing=True, config_file=None):
    """
    轻量读取运行配置，避免仅为读取配置而初始化 Flask/SocketIO。
    返回结构与 app.config 关键字段保持一致。
    """
    default_root_dir = os.path.expanduser("~")
    config_file = config_file or get_config_path()
    config = configparser.ConfigParser()
    settings_data = {
        'CONFIG_FILE': config_file,
        'ROOT_DIR': default_root_dir,
        'PASSWORD': 'password',
        'ADMIN_PASSWORD': 'admin123',
        'CLOSE_TO_TRAY': False,
        'PORT': 5000,
        'GIT_ENABLED': False,
        'GIT_WORKDIR': '',
        'GIT_EXTERNAL_APP_PATH': ''
    }

    if os.path.exists(config_file):
        config.read(config_file, encoding='utf-8')
        if 'settings' in config:
            settings = config['settings']
            root_dir = settings.get('root_dir', default_root_dir)
            settings_data['ROOT_DIR'] = os.path.normpath(root_dir) if root_dir else default_root_dir
            settings_data['PASSWORD'] = settings.get('password', 'password')
            settings_data['ADMIN_PASSWORD'] = settings.get('admin_password', 'admin123')
            settings_data['CLOSE_TO_TRAY'] = settings.get('close_to_tray', 'false').lower() == 'true'
            try:
                settings_data['PORT'] = int(settings.get('port', '5000'))
            except ValueError:
                app_logger.warning("[警告] 配置文件中的端口无效，已回退到 5000")
                settings_data['PORT'] = 5000
            settings_data['GIT_ENABLED'] = settings.get('git_enabled', 'false').lower() == 'true'
            git_workdir = settings.get('git_workdir', '')
            settings_data['GIT_WORKDIR'] = os.path.normpath(git_workdir) if git_workdir else ''
            settings_data['GIT_EXTERNAL_APP_PATH'] = settings.get('git_external_app_path', '')
            return settings_data
        app_logger.warning("[警告] 配置文件缺少 [settings] 段，使用默认配置")
    elif not create_if_missing:
        return settings_data
    else:
        app_logger.info("配置文件不存在，创建默认配置")

    if create_if_missing:
        save_runtime_settings(settings_data, config_file=config_file)
    return settings_data


def save_runtime_settings(settings_data, config_file=None):
    """保存轻量配置字典到配置文件"""
    config_file = config_file or settings_data.get('CONFIG_FILE', get_config_path())
    config = configparser.ConfigParser()
    config['settings'] = {
        'root_dir': settings_data.get('ROOT_DIR', os.path.expanduser("~")),
        'password': settings_data.get('PASSWORD', 'password'),
        'admin_password': settings_data.get('ADMIN_PASSWORD', 'admin123'),
        'close_to_tray': str(settings_data.get('CLOSE_TO_TRAY', False)).lower(),
        'port': str(settings_data.get('PORT', 5000)),
        'git_enabled': str(settings_data.get('GIT_ENABLED', False)).lower(),
        'git_workdir': settings_data.get('GIT_WORKDIR', ''),
        'git_external_app_path': settings_data.get('GIT_EXTERNAL_APP_PATH', '')
    }
    with open(config_file, 'w', encoding='utf-8') as f:
        config.write(f)


def save_config(app):
    """保存当前配置到文件"""
    settings_data = {
        'CONFIG_FILE': app.config['CONFIG_FILE'],
        'ROOT_DIR': app.config['ROOT_DIR'],
        'PASSWORD': app.config['PASSWORD'],
        'ADMIN_PASSWORD': app.config.get('ADMIN_PASSWORD', 'admin123'),
        'CLOSE_TO_TRAY': app.config.get('CLOSE_TO_TRAY', False),
        'PORT': app.config.get('PORT', 5000),
        'GIT_ENABLED': app.config.get('GIT_ENABLED', False),
        'GIT_WORKDIR': app.config.get('GIT_WORKDIR', ''),
        'GIT_EXTERNAL_APP_PATH': app.config.get('GIT_EXTERNAL_APP_PATH', '')
    }
    save_runtime_settings(settings_data, config_file=app.config['CONFIG_FILE'])
    app_logger.info("配置已保存到: %s", app.config['CONFIG_FILE'])


class LogMessageReceiver(QObject):
    """用于从工作线程接收日志消息的信号对象"""
    message = pyqtSignal(str)


class GitConfigDialog(QDialog):
    """Git配置管理对话框"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Git服务器配置管理")
        self.setMinimumSize(800, 600)
        
        # 导入GitConfigManager
        try:
            from git_config_manager import GitConfigManager
            self.config_manager = GitConfigManager()
        except ImportError:
            QMessageBox.critical(self, "错误", "无法加载Git配置管理器")
            self.reject()
            return
        
        self.setStyleSheet("""
            QDialog {
                background: #f5f7fa;
            }
            QLabel {
                color: #2c3e50;
                font-size: 11pt;
                font-weight: bold;
            }
            QLineEdit, QComboBox {
                padding: 8px 12px;
                border: 2px solid #e0e0e0;
                border-radius: 6px;
                background: white;
                font-size: 10pt;
                color: #2c3e50;
            }
            QLineEdit:focus, QComboBox:focus {
                border-color: #667eea;
            }
            QPushButton {
                padding: 8px 20px;
                border: none;
                border-radius: 6px;
                font-size: 10pt;
                font-weight: bold;
                min-width: 100px;
            }
            QPushButton#addButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #56ab2f, stop:1 #a8e063);
                color: white;
            }
            QPushButton#addButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #4a9628, stop:1 #96d054);
            }
            QPushButton#editButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #4facfe, stop:1 #00f2fe);
                color: white;
            }
            QPushButton#editButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #3f9be8, stop:1 #00dae8);
            }
            QPushButton#deleteButton {
                background: #e74c3c;
                color: white;
            }
            QPushButton#deleteButton:hover {
                background: #c0392b;
            }
            QPushButton#saveButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #667eea, stop:1 #764ba2);
                color: white;
            }
            QPushButton#saveButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #5568d3, stop:1 #6a3d8f);
            }
            QPushButton#cancelButton {
                background: #e0e0e0;
                color: #666;
            }
            QPushButton#cancelButton:hover {
                background: #d0d0d0;
            }
            QListWidget {
                border: 2px solid #e0e0e0;
                border-radius: 6px;
                background: white;
                padding: 5px;
            }
            QListWidget::item {
                padding: 10px;
                border-bottom: 1px solid #e0e0e0;
            }
            QListWidget::item:selected {
                background: #667eea;
                color: white;
            }
        """)
        
        self.init_ui()
        self.load_configs()
    
    def init_ui(self):
        """初始化UI"""
        layout = QVBoxLayout()
        layout.setSpacing(15)
        layout.setContentsMargins(25, 25, 25, 25)
        
        # 标题
        title_label = QLabel("⚙️ Git服务器配置管理")
        title_label.setStyleSheet("""
            font-size: 16pt;
            font-weight: bold;
            color: #667eea;
            padding: 10px 0;
        """)
        title_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(title_label)
        
        # 配置列表区域
        list_label = QLabel("已保存的配置：")
        layout.addWidget(list_label)
        
        self.config_list = QListWidget()
        self.config_list.itemDoubleClicked.connect(self.edit_selected_config)
        layout.addWidget(self.config_list, 1)
        
        # 按钮区域
        button_layout = QHBoxLayout()
        button_layout.setSpacing(10)
        
        add_button = QPushButton("➕ 添加配置")
        add_button.setObjectName("addButton")
        add_button.clicked.connect(self.add_config)
        button_layout.addWidget(add_button)
        
        edit_button = QPushButton("✏️ 编辑")
        edit_button.setObjectName("editButton")
        edit_button.clicked.connect(self.edit_selected_config)
        button_layout.addWidget(edit_button)
        
        delete_button = QPushButton("🗑️ 删除")
        delete_button.setObjectName("deleteButton")
        delete_button.clicked.connect(self.delete_selected_config)
        button_layout.addWidget(delete_button)
        
        button_layout.addStretch()
        
        close_button = QPushButton("关闭")
        close_button.setObjectName("cancelButton")
        close_button.clicked.connect(self.accept)
        button_layout.addWidget(close_button)
        
        layout.addLayout(button_layout)
        
        self.setLayout(layout)
    
    def load_configs(self):
        """加载配置列表"""
        self.config_list.clear()
        configs = self.config_manager.get_all_configs()
        default_id = self.config_manager.configs.get('default_config_id')
        
        for config in configs:
            name = config.get('name', '未命名配置')
            server_url = config.get('server_url', '')
            auth_type = config.get('auth_type', 'ssh')
            config_id = config.get('id', '')
            
            is_default = (config_id == default_id)
            default_mark = " [默认]" if is_default else ""
            
            item_text = f"{name}{default_mark}\n服务器: {server_url} | 认证: {auth_type.upper()}"
            item = QListWidgetItem(item_text)
            item.setData(Qt.UserRole, config_id)
            self.config_list.addItem(item)
    
    def add_config(self):
        """添加新配置"""
        dialog = GitConfigEditDialog(self)
        if dialog.exec_() == QDialog.Accepted:
            config = dialog.get_config()
            if config:
                config_id = self.config_manager.add_config(config)
                self.load_configs()
                QMessageBox.information(self, "成功", f"配置已添加: {config.get('name', '')}")
    
    def edit_selected_config(self):
        """编辑选中的配置"""
        current_item = self.config_list.currentItem()
        if not current_item:
            QMessageBox.warning(self, "提示", "请先选择一个配置")
            return
        
        config_id = current_item.data(Qt.UserRole)
        config = self.config_manager.get_config(config_id)
        if not config:
            QMessageBox.warning(self, "错误", "配置不存在")
            return
        
        dialog = GitConfigEditDialog(self, config)
        if dialog.exec_() == QDialog.Accepted:
            updated_config = dialog.get_config()
            if updated_config:
                if self.config_manager.update_config(config_id, updated_config):
                    self.load_configs()
                    QMessageBox.information(self, "成功", "配置已更新")
                else:
                    QMessageBox.warning(self, "错误", "更新配置失败")
    
    def delete_selected_config(self):
        """删除选中的配置"""
        current_item = self.config_list.currentItem()
        if not current_item:
            QMessageBox.warning(self, "提示", "请先选择一个配置")
            return
        
        config_id = current_item.data(Qt.UserRole)
        config = self.config_manager.get_config(config_id)
        if not config:
            return
        
        reply = QMessageBox.question(
            self, 
            "确认删除", 
            f"确定要删除配置 '{config.get('name', '')}' 吗？",
            QMessageBox.Yes | QMessageBox.No
        )
        
        if reply == QMessageBox.Yes:
            if self.config_manager.delete_config(config_id):
                self.load_configs()
                QMessageBox.information(self, "成功", "配置已删除")
            else:
                QMessageBox.warning(self, "错误", "删除配置失败")


class GitConfigEditDialog(QDialog):
    """Git配置编辑对话框"""
    def __init__(self, parent=None, config=None):
        super().__init__(parent)
        self.setWindowTitle("编辑Git配置" if config else "添加Git配置")
        self.setMinimumWidth(600)
        self.config = config
        
        self.setStyleSheet("""
            QDialog {
                background: #f5f7fa;
            }
            QLabel {
                color: #2c3e50;
                font-size: 11pt;
                font-weight: bold;
            }
            QLineEdit, QComboBox {
                padding: 8px 12px;
                border: 2px solid #e0e0e0;
                border-radius: 6px;
                background: white;
                font-size: 10pt;
                color: #2c3e50;
            }
            QLineEdit:focus, QComboBox:focus {
                border-color: #667eea;
            }
            QPushButton {
                padding: 8px 20px;
                border: none;
                border-radius: 6px;
                font-size: 10pt;
                font-weight: bold;
                min-width: 100px;
            }
            QPushButton#saveButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #56ab2f, stop:1 #a8e063);
                color: white;
            }
            QPushButton#saveButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #4a9628, stop:1 #96d054);
            }
            QPushButton#cancelButton {
                background: #e0e0e0;
                color: #666;
            }
            QPushButton#cancelButton:hover {
                background: #d0d0d0;
            }
            QPushButton#browseButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #4facfe, stop:1 #00f2fe);
                color: white;
            }
            QPushButton#browseButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #3f9be8, stop:1 #00dae8);
            }
        """)
        
        self.init_ui()
        if config:
            self.load_config(config)
    
    def init_ui(self):
        """初始化UI"""
        layout = QVBoxLayout()
        layout.setSpacing(15)
        layout.setContentsMargins(25, 25, 25, 25)
        
        # 标题
        title_label = QLabel("⚙️ Git服务器配置" if not self.config else "✏️ 编辑Git配置")
        title_label.setStyleSheet("""
            font-size: 16pt;
            font-weight: bold;
            color: #667eea;
            padding: 10px 0;
        """)
        title_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(title_label)
        
        # 表单布局
        form_layout = QFormLayout()
        form_layout.setSpacing(15)
        form_layout.setContentsMargins(0, 10, 0, 10)
        
        # 配置名称
        name_label = QLabel("配置名称：")
        self.name_edit = QLineEdit()
        self.name_edit.setPlaceholderText("输入配置名称...")
        form_layout.addRow(name_label, self.name_edit)
        
        # 服务器地址
        server_label = QLabel("服务器地址：")
        server_widget = QWidget()
        server_layout = QHBoxLayout(server_widget)
        server_layout.setContentsMargins(0, 0, 0, 0)
        server_layout.setSpacing(10)
        
        self.server_edit = QLineEdit()
        self.server_edit.setPlaceholderText("例如: git@example.com:username/ 或 git@example.com:username/repo.git")
        server_layout.addWidget(self.server_edit, 1)
        
        # 添加帮助按钮
        help_button = QPushButton("❓ 如何确认SSH地址?")
        help_button.setObjectName("browseButton")
        help_button.setToolTip("查看SSH地址格式说明")
        help_button.clicked.connect(self.show_ssh_address_help)
        server_layout.addWidget(help_button)
        
        form_layout.addRow(server_label, server_widget)
        
        # 认证类型
        auth_label = QLabel("认证方式：")
        auth_widget = QWidget()
        auth_layout = QHBoxLayout(auth_widget)
        auth_layout.setContentsMargins(0, 0, 0, 0)
        auth_layout.setSpacing(10)
        
        self.auth_type_combo = QComboBox()
        self.auth_type_combo.addItems(["SSH", "HTTPS"])
        self.auth_type_combo.currentTextChanged.connect(self.on_auth_type_changed)
        auth_layout.addWidget(self.auth_type_combo, 1)
        
        # 添加"转换为SSH"按钮（当选择SSH认证时显示）
        self.convert_to_ssh_button = QPushButton("🔄 从HTTPS转换")
        self.convert_to_ssh_button.setObjectName("browseButton")
        self.convert_to_ssh_button.setToolTip("将HTTP/HTTPS地址转换为SSH格式")
        self.convert_to_ssh_button.clicked.connect(self.convert_http_to_ssh)
        self.convert_to_ssh_button.setVisible(False)
        auth_layout.addWidget(self.convert_to_ssh_button)
        
        form_layout.addRow(auth_label, auth_widget)
        
        # SSH密钥路径（SSH认证）
        self.ssh_key_label = QLabel("SSH密钥路径：")
        self.ssh_key_widget = QWidget()
        ssh_key_layout = QHBoxLayout(self.ssh_key_widget)
        ssh_key_layout.setContentsMargins(0, 0, 0, 0)
        ssh_key_layout.setSpacing(10)
        
        self.ssh_key_edit = QLineEdit()
        self.ssh_key_edit.setPlaceholderText("选择SSH私钥文件...")
        ssh_key_layout.addWidget(self.ssh_key_edit, 1)
        
        ssh_browse_button = QPushButton("📁 浏览")
        ssh_browse_button.setObjectName("browseButton")
        ssh_browse_button.clicked.connect(self.browse_ssh_key)
        ssh_key_layout.addWidget(ssh_browse_button)
        
        form_layout.addRow(self.ssh_key_label, self.ssh_key_widget)
        
        # 用户名（HTTPS认证）
        self.username_label = QLabel("用户名：")
        self.username_edit = QLineEdit()
        self.username_edit.setPlaceholderText("输入Git服务器用户名...")
        form_layout.addRow(self.username_label, self.username_edit)
        
        # 密码（HTTPS认证）
        self.password_label = QLabel("密码/Token：")
        self.password_edit = QLineEdit()
        self.password_edit.setEchoMode(QLineEdit.Password)
        self.password_edit.setPlaceholderText("输入密码或访问令牌...")
        form_layout.addRow(self.password_label, self.password_edit)
        
        # Git用户名称
        git_name_label = QLabel("Git用户名称：")
        self.git_name_edit = QLineEdit()
        self.git_name_edit.setPlaceholderText("用于Git提交的用户名...")
        form_layout.addRow(git_name_label, self.git_name_edit)
        
        # Git用户邮箱
        git_email_label = QLabel("Git用户邮箱：")
        self.git_email_edit = QLineEdit()
        self.git_email_edit.setPlaceholderText("用于Git提交的邮箱...")
        form_layout.addRow(git_email_label, self.git_email_edit)
        
        layout.addLayout(form_layout)
        
        # 按钮区域
        button_layout = QHBoxLayout()
        button_layout.setSpacing(10)
        
        # 测试按钮（仅在编辑已保存的配置时显示）
        self.test_button = QPushButton("🧪 测试配置")
        self.test_button.setObjectName("editButton")
        self.test_button.setVisible(bool(self.config))
        self.test_button.clicked.connect(self.test_config)
        button_layout.addWidget(self.test_button)
        
        button_layout.addStretch()
        
        save_button = QPushButton("💾 保存")
        save_button.setObjectName("saveButton")
        save_button.clicked.connect(self.accept)
        button_layout.addWidget(save_button)
        
        cancel_button = QPushButton("❌ 取消")
        cancel_button.setObjectName("cancelButton")
        cancel_button.clicked.connect(self.reject)
        button_layout.addWidget(cancel_button)
        
        layout.addLayout(button_layout)
        
        self.setLayout(layout)
        
        # 初始化显示状态
        self.on_auth_type_changed()
    
    def on_auth_type_changed(self):
        """认证类型改变时的处理"""
        auth_type = self.auth_type_combo.currentText().lower()
        
        # SSH认证
        ssh_visible = (auth_type == 'ssh')
        self.ssh_key_label.setVisible(ssh_visible)
        self.ssh_key_widget.setVisible(ssh_visible)
        
        # 显示/隐藏转换按钮
        server_url = self.server_edit.text().strip()
        is_http_url = server_url.startswith(('http://', 'https://'))
        self.convert_to_ssh_button.setVisible(ssh_visible and is_http_url)
        
        # HTTPS认证
        https_visible = (auth_type == 'https')
        self.username_label.setVisible(https_visible)
        self.username_edit.setVisible(https_visible)
        self.password_label.setVisible(https_visible)
        self.password_edit.setVisible(https_visible)
        
        # 监听服务器地址变化，动态显示转换按钮
        if not hasattr(self, '_server_edit_connected'):
            self.server_edit.textChanged.connect(self.on_server_url_changed)
            self._server_edit_connected = True
    
    def on_server_url_changed(self):
        """服务器地址改变时的处理"""
        if self.auth_type_combo.currentText().lower() == 'ssh':
            server_url = self.server_edit.text().strip()
            is_http_url = server_url.startswith(('http://', 'https://'))
            self.convert_to_ssh_button.setVisible(is_http_url)
    
    def convert_http_to_ssh(self):
        """将HTTP/HTTPS地址转换为SSH格式"""
        server_url = self.server_edit.text().strip()
        
        if not server_url.startswith(('http://', 'https://')):
            QMessageBox.information(self, "提示", "当前地址不是HTTP/HTTPS格式，无需转换")
            return
        
        try:
            from urllib.parse import urlparse
            
            parsed = urlparse(server_url)
            hostname = parsed.hostname or 'localhost'
            port = parsed.port
            path = parsed.path.lstrip('/')
            
            # 移除.git后缀（如果有），稍后会重新添加
            if path.endswith('.git'):
                path = path[:-4]
            
            # 移除尾部的斜杠
            path = path.rstrip('/')
            
            # 如果路径为空，提示用户需要手动输入
            if not path:
                QMessageBox.warning(
                    self,
                    "转换提示",
                    f"无法从URL中提取仓库路径。\n\n"
                    f"请手动输入SSH地址，格式为：\n"
                    f"  git@{hostname}:username/repo.git\n\n"
                    f"或者：\n"
                    f"  ssh://git@{hostname}/username/repo.git"
                )
                return
            
            # 构建SSH地址（使用冒号格式，更常用）
            ssh_url = f"git@{hostname}:{path}.git"
            
            # 如果有非标准端口，使用ssh://格式
            if port and port != 22:
                ssh_url = f"ssh://git@{hostname}:{port}/{path}.git"
            
            reply = QMessageBox.question(
                self,
                "地址转换",
                f"将HTTP/HTTPS地址转换为SSH格式：\n\n"
                f"原地址：{server_url}\n\n"
                f"转换后：{ssh_url}\n\n"
                f"⚠️ 请确认仓库路径是否正确（{path}）\n\n"
                f"是否应用此转换？",
                QMessageBox.Yes | QMessageBox.No
            )
            
            if reply == QMessageBox.Yes:
                self.server_edit.setText(ssh_url)
                # 更新转换按钮的显示状态
                self.on_server_url_changed()
        
        except Exception as e:
            QMessageBox.warning(
                self,
                "转换失败",
                f"无法自动转换地址：{str(e)}\n\n"
                f"请手动输入SSH地址，格式为：\n"
                f"  git@hostname:username/repo.git"
            )
    
    def browse_ssh_key(self):
        """浏览选择SSH密钥文件"""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "选择SSH私钥文件（注意：选择私钥文件，不是.pub公钥文件）",
            os.path.expanduser("~/.ssh"),
            "Private Key Files (*.pem *.key id_ed25519 id_rsa);;All Files (*)"
        )
        if file_path:
            # 检查是否选择了公钥文件
            if file_path.endswith('.pub'):
                reply = QMessageBox.warning(
                    self,
                    "警告",
                    "您选择的是公钥文件（.pub），SSH认证需要使用私钥文件（没有.pub后缀）。\n\n"
                    "私钥文件通常是：\n"
                    "  - id_ed25519（不是 id_ed25519.pub）\n"
                    "  - id_rsa（不是 id_rsa.pub）\n\n"
                    "是否继续使用此文件？",
                    QMessageBox.Yes | QMessageBox.No
                )
                if reply == QMessageBox.No:
                    return
            self.ssh_key_edit.setText(file_path)
    
    def show_ssh_address_help(self):
        """显示SSH地址格式帮助"""
        help_text = """
<h3>📋 如何确认Git服务器的SSH地址？</h3>

<h4>方法一：在Git服务器网站上查看</h4>
<p>大多数Git服务器（如GitLab、GitHub、Gitea等）会在仓库页面提供SSH地址：</p>
<ol>
  <li>登录Git服务器网站</li>
  <li>打开要克隆的仓库</li>
  <li>点击"Clone"或"克隆"按钮</li>
  <li>选择"Clone with SSH"或"使用SSH克隆"</li>
  <li>复制显示的SSH地址（格式如：git@example.com:user/repo.git）</li>
</ol>

<h4>方法二：从HTTP/HTTPS地址推导</h4>
<p>如果您知道HTTP/HTTPS地址，可以按以下规则转换：</p>
<ul>
  <li><b>HTTPS格式：</b> <code>https://example.com/username/repo.git</code></li>
  <li><b>SSH格式（方式1）：</b> <code>git@example.com:username/repo.git</code></li>
  <li><b>SSH格式（方式2）：</b> <code>ssh://git@example.com/username/repo.git</code></li>
</ul>
<p><b>转换规则：</b></p>
<ol>
  <li>将 <code>https://</code> 或 <code>http://</code> 替换为 <code>git@</code></li>
  <li>将第一个斜杠后的路径改为冒号分隔格式</li>
  <li>例如：<code>https://example.com/user/repo</code> → <code>git@example.com:user/repo.git</code></li>
</ol>

<h4>方法三：常见Git服务器的SSH地址格式</h4>
<table style="width:100%; border-collapse: collapse;">
<tr style="background: #f0f0f0;">
  <th style="padding: 8px; border: 1px solid #ddd;">服务器类型</th>
  <th style="padding: 8px; border: 1px solid #ddd;">SSH地址格式示例</th>
</tr>
<tr>
  <td style="padding: 8px; border: 1px solid #ddd;"><b>GitLab</b></td>
  <td style="padding: 8px; border: 1px solid #ddd;"><code>git@gitlab.example.com:username/repo.git</code></td>
</tr>
<tr>
  <td style="padding: 8px; border: 1px solid #ddd;"><b>GitHub</b></td>
  <td style="padding: 8px; border: 1px solid #ddd;"><code>git@github.com:username/repo.git</code></td>
</tr>
<tr>
  <td style="padding: 8px; border: 1px solid #ddd;"><b>Gitea</b></td>
  <td style="padding: 8px; border: 1px solid #ddd;"><code>git@gitea.example.com:username/repo.git</code></td>
</tr>
<tr>
  <td style="padding: 8px; border: 1px solid #ddd;"><b>自建服务器</b></td>
  <td style="padding: 8px; border: 1px solid #ddd;"><code>git@example.com:user/repo.git</code></td>
</tr>
</table>

<h4>方法四：测试SSH连接</h4>
<p>在命令行中测试SSH连接（Windows PowerShell或Git Bash）：</p>
<pre style="background: #f5f5f5; padding: 10px; border-radius: 4px;">
# 测试SSH连接（替换为您的服务器地址）
ssh -T git@example.com

# 如果连接成功，通常会显示欢迎信息或确认消息
# 如果失败，会显示错误信息，帮助您诊断问题
</pre>

<h4>⚠️ 重要提示</h4>
<ul>
  <li>SSH地址通常以 <code>git@</code> 开头</li>
  <li>SSH地址使用冒号 <code>:</code> 分隔主机名和路径</li>
  <li>SSH地址通常以 <code>.git</code> 结尾</li>
  <li>确保您的公钥（.pub文件）已添加到Git服务器的SSH Keys设置中</li>
  <li>如果服务器使用非标准SSH端口，格式为：<code>ssh://git@host:port/path.git</code></li>
</ul>

<h4>💡 服务器地址示例</h4>
<p>假设您的服务器地址是 <code>example.com</code>，仓库路径是 <code>/username/repo.git</code>，SSH地址可能是：</p>
<ul>
  <li><code>git@example.com:username/repo.git</code></li>
  <li>或 <code>ssh://git@example.com/username/repo.git</code></li>
</ul>
<p>建议在Git服务器网站上查看准确的SSH地址格式。</p>
"""
        
        msg_box = QMessageBox(self)
        msg_box.setWindowTitle("SSH地址格式帮助")
        msg_box.setTextFormat(Qt.RichText)
        msg_box.setText(help_text)
        msg_box.setStandardButtons(QMessageBox.Ok)
        msg_box.exec_()
    
    def load_config(self, config):
        """加载配置到表单"""
        self.name_edit.setText(config.get('name', ''))
        self.server_edit.setText(config.get('server_url', ''))
        
        auth_type = config.get('auth_type', 'ssh')
        if auth_type == 'ssh':
            self.auth_type_combo.setCurrentIndex(0)
            self.ssh_key_edit.setText(config.get('ssh_key_path', ''))
        else:
            self.auth_type_combo.setCurrentIndex(1)
            self.username_edit.setText(config.get('username', ''))
            # 密码不显示，需要用户重新输入
        
        self.git_name_edit.setText(config.get('git_user_name', ''))
        self.git_email_edit.setText(config.get('git_user_email', ''))
        
        self.on_auth_type_changed()
    
    def get_config(self):
        """获取表单中的配置"""
        name = self.name_edit.text().strip()
        if not name:
            QMessageBox.warning(self, "错误", "配置名称不能为空")
            return None
        
        server_url = self.server_edit.text().strip()
        if not server_url:
            QMessageBox.warning(self, "错误", "服务器地址不能为空")
            return None
        
        auth_type = self.auth_type_combo.currentText().lower()
        
        # 检查URL格式与认证方式是否匹配
        is_http_url = server_url.startswith(('http://', 'https://'))
        is_ssh_url = server_url.startswith(('git@', 'ssh://'))
        
        if auth_type == 'ssh' and is_http_url:
            reply = QMessageBox.warning(
                self,
                "配置警告",
                f"您选择了SSH认证方式，但提供的URL是HTTP/HTTPS格式：\n{server_url}\n\n"
                f"SSH认证需要使用SSH格式的URL，例如：\n"
                f"  - git@example.com:username/ (基础URL，可访问所有仓库)\n"
                f"  - git@example.com:username/repo.git (特定仓库)\n"
                f"  - ssh://git@example.com/username/repo.git\n\n"
                f"💡 提示：如果输入基础URL（末尾带斜杠），克隆时只需输入仓库名\n"
                f"例如：配置 git@example.com:username/，克隆时输入 repo-name 即可\n\n"
                f"如果您需要使用HTTP/HTTPS URL，请将认证方式改为HTTPS。\n\n"
                f"是否继续保存此配置？",
                QMessageBox.Yes | QMessageBox.No
            )
            if reply == QMessageBox.No:
                return None
        
        if auth_type == 'https' and is_ssh_url:
            reply = QMessageBox.warning(
                self,
                "配置警告",
                f"您选择了HTTPS认证方式，但提供的URL是SSH格式：\n{server_url}\n\n"
                f"HTTPS认证需要使用HTTP/HTTPS格式的URL，例如：\n"
                f"  - http://example.com/username/repo.git\n"
                f"  - https://example.com/username/repo.git\n\n"
                f"如果您需要使用SSH URL，请将认证方式改为SSH。\n\n"
                f"是否继续保存此配置？",
                QMessageBox.Yes | QMessageBox.No
            )
            if reply == QMessageBox.No:
                return None
        
        config = {
            'name': name,
            'server_url': server_url,
            'auth_type': auth_type,
            'git_user_name': self.git_name_edit.text().strip(),
            'git_user_email': self.git_email_edit.text().strip()
        }
        
        if auth_type == 'ssh':
            ssh_key_path = self.ssh_key_edit.text().strip()
            if not ssh_key_path:
                QMessageBox.warning(self, "错误", "SSH密钥路径不能为空")
                return None
            
            # 检查是否选择了公钥文件
            if ssh_key_path.endswith('.pub'):
                reply = QMessageBox.warning(
                    self,
                    "警告",
                    "您选择的是公钥文件（.pub），SSH认证需要使用私钥文件（没有.pub后缀）。\n\n"
                    "私钥文件通常是：\n"
                    "  - id_ed25519（不是 id_ed25519.pub）\n"
                    "  - id_rsa（不是 id_rsa.pub）\n\n"
                    "公钥文件（.pub）需要添加到Git服务器上，而不是在客户端使用。\n\n"
                    "是否继续使用此文件？",
                    QMessageBox.Yes | QMessageBox.No
                )
                if reply == QMessageBox.No:
                    return None
            
            if not os.path.exists(ssh_key_path):
                QMessageBox.warning(self, "警告", f"SSH密钥文件不存在: {ssh_key_path}\n是否继续？",
                                  QMessageBox.Yes | QMessageBox.No)
                if QMessageBox.No:
                    return None
            config['ssh_key_path'] = ssh_key_path
        else:  # https
            username = self.username_edit.text().strip()
            password = self.password_edit.text().strip()
            if not username:
                QMessageBox.warning(self, "错误", "用户名不能为空")
                return None
            if not password:
                # 如果是编辑模式，允许不修改密码
                if self.config and self.config.get('password_encrypted'):
                    config['password_encrypted'] = self.config.get('password_encrypted')
                else:
                    QMessageBox.warning(self, "错误", "密码不能为空")
                    return None
            else:
                # 加密密码（base64编码）
                import base64
                config['password_encrypted'] = base64.b64encode(password.encode('utf-8')).decode('utf-8')
            config['username'] = username
        
        return config
    
    def test_config(self):
        """测试当前配置"""
        # 先获取表单中的配置（不保存）
        config = self.get_config()
        if not config:
            return
        
        # 检查是否已保存（有ID）
        if not self.config or not self.config.get('id'):
            QMessageBox.warning(self, "提示", "请先保存配置后再测试")
            return
        
        # 显示测试进度
        from PyQt5.QtWidgets import QProgressDialog
        progress = QProgressDialog("正在测试配置...", "取消", 0, 0, self)
        progress.setWindowModality(Qt.WindowModal)
        progress.setCancelButton(None)  # 不允许取消
        progress.show()
        QApplication.processEvents()
        
        try:
            # 导入Git配置管理器
            from git_config_manager import GitConfigManager
            from git_manager import GitManager
            
            config_manager = GitConfigManager()
            config_id = self.config.get('id')
            saved_config = config_manager.get_config(config_id)
            
            if not saved_config:
                QMessageBox.warning(self, "错误", "配置不存在")
                return
            
            # 测试配置
            git_manager = GitManager()
            result = git_manager.test_config(saved_config)
            
            progress.close()
            
            if result.get('success'):
                QMessageBox.information(self, "测试成功", result.get('message', '配置测试成功'))
            else:
                QMessageBox.warning(self, "测试失败", result.get('error', '配置测试失败'))
        except ImportError as e:
            progress.close()
            QMessageBox.critical(self, "错误", f"无法加载Git模块: {e}\n请确保已安装GitPython")
        except Exception as e:
            progress.close()
            QMessageBox.critical(self, "错误", f"测试配置时发生错误: {str(e)}")


class SettingsDialog(QDialog):
    """设置对话框，用于配置根目录和密码"""
    def __init__(self, parent=None, current_root='', current_password='', current_admin_password='', current_close_to_tray=False, current_port=5000, current_git_enabled=False, current_git_workdir='', current_git_external_app_path=''):
        super().__init__(parent)
        self.setWindowTitle("服务器设置")
        self.setMinimumWidth(500)
        self.current_root = current_root
        self.current_password = current_password
        self.current_admin_password = current_admin_password
        self.current_close_to_tray = current_close_to_tray
        self.current_port = current_port
        self.current_git_enabled = current_git_enabled
        self.current_git_workdir = current_git_workdir
        self.current_git_external_app_path = current_git_external_app_path
        self.new_root = current_root
        self.new_password = current_password
        self.new_admin_password = current_admin_password
        self.new_close_to_tray = current_close_to_tray
        self.new_port = current_port
        self.new_git_enabled = current_git_enabled
        self.new_git_workdir = current_git_workdir
        self.new_git_external_app_path = current_git_external_app_path
        
        # 设置窗口样式
        self.setStyleSheet("""
            QDialog {
                background: #f5f7fa;
            }
            QLabel {
                color: #2c3e50;
                font-size: 11pt;
                font-weight: bold;
            }
            QLineEdit {
                padding: 8px 12px;
                border: 2px solid #e0e0e0;
                border-radius: 6px;
                background: white;
                font-size: 10pt;
                color: #2c3e50;
            }
            QLineEdit:focus {
                border-color: #667eea;
            }
            QPushButton {
                padding: 8px 20px;
                border: none;
                border-radius: 6px;
                font-size: 10pt;
                font-weight: bold;
                min-width: 100px;
            }
            QPushButton#saveButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #56ab2f, stop:1 #a8e063);
                color: white;
            }
            QPushButton#saveButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #4a9628, stop:1 #96d054);
            }
            QPushButton#cancelButton {
                background: #e0e0e0;
                color: #666;
            }
            QPushButton#cancelButton:hover {
                background: #d0d0d0;
            }
            QPushButton#browseButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #4facfe, stop:1 #00f2fe);
                color: white;
            }
            QPushButton#browseButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #3f9be8, stop:1 #00dae8);
            }
        """)
        
        self.init_ui()
    
    def init_ui(self):
        """初始化UI"""
        layout = QVBoxLayout()
        layout.setSpacing(15)
        layout.setContentsMargins(25, 25, 25, 25)
        
        # 标题
        title_label = QLabel("⚙️ 服务器设置")
        title_label.setStyleSheet("""
            font-size: 16pt;
            font-weight: bold;
            color: #667eea;
            padding: 10px 0;
        """)
        title_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(title_label)
        
        # 说明文字
        info_label = QLabel("提示：修改设置将停止正在运行的服务器")
        info_label.setStyleSheet("""
            font-size: 9pt;
            color: #e74c3c;
            font-weight: normal;
            padding: 5px;
            background: #fee;
            border-radius: 4px;
        """)
        info_label.setAlignment(Qt.AlignCenter)
        layout.addWidget(info_label)
        
        # 表单布局
        form_layout = QFormLayout()
        form_layout.setSpacing(15)
        form_layout.setContentsMargins(0, 10, 0, 10)
        
        # 根目录设置
        root_label = QLabel("根目录：")
        root_widget = QWidget()
        root_layout = QHBoxLayout(root_widget)
        root_layout.setContentsMargins(0, 0, 0, 0)
        root_layout.setSpacing(10)
        
        self.root_edit = QLineEdit(self.current_root)
        self.root_edit.setReadOnly(True)
        root_layout.addWidget(self.root_edit, 1)
        
        browse_button = QPushButton("📁 浏览")
        browse_button.setObjectName("browseButton")
        browse_button.clicked.connect(self.browse_directory)
        root_layout.addWidget(browse_button)
        
        form_layout.addRow(root_label, root_widget)
        
        # 登录密码设置
        password_label = QLabel("登录密码：")
        self.password_edit = QLineEdit(self.current_password)
        self.password_edit.setEchoMode(QLineEdit.Password)
        self.password_edit.setPlaceholderText("输入登录密码...")
        form_layout.addRow(password_label, self.password_edit)
        
        # 管理员密码设置
        admin_password_label = QLabel("管理员密码：")
        admin_password_label.setStyleSheet("""
            font-size: 11pt;
            font-weight: bold;
            color: #e74c3c;
        """)
        self.admin_password_edit = QLineEdit(self.current_admin_password)
        self.admin_password_edit.setEchoMode(QLineEdit.Password)
        self.admin_password_edit.setPlaceholderText("用于保护目录修改...")
        form_layout.addRow(admin_password_label, self.admin_password_edit)
        
        # 管理员密码说明
        admin_hint = QLabel("⚠️ 管理员密码用于保护目录修改等重要操作")
        admin_hint.setStyleSheet("""
            font-size: 9pt;
            color: #e67e22;
            font-weight: normal;
            padding: 5px;
            background: #fff3cd;
            border-radius: 4px;
        """)
        form_layout.addRow("", admin_hint)
        
        # 关闭行为设置
        close_behavior_label = QLabel("关闭行为：")
        self.close_to_tray_checkbox = QCheckBox("点击关闭按钮时最小化到托盘（不退出程序）")
        self.close_to_tray_checkbox.setChecked(self.current_close_to_tray)
        self.close_to_tray_checkbox.setStyleSheet("""
            QCheckBox {
                font-size: 10pt;
                color: #2c3e50;
                font-weight: normal;
                padding: 5px;
            }
            QCheckBox::indicator {
                width: 18px;
                height: 18px;
            }
        """)
        form_layout.addRow(close_behavior_label, self.close_to_tray_checkbox)
        
        # 关闭行为说明
        close_hint = QLabel("💡 勾选后，点击右上角关闭按钮将最小化到托盘，不会退出程序")
        close_hint.setStyleSheet("""
            font-size: 9pt;
            color: #3498db;
            font-weight: normal;
            padding: 5px;
            background: #e3f2fd;
            border-radius: 4px;
        """)
        form_layout.addRow("", close_hint)
        
        # 服务器端口设置
        port_label = QLabel("服务器端口：")
        self.port_edit = QLineEdit(str(self.current_port))
        self.port_edit.setPlaceholderText("输入端口号（默认: 5000）")
        form_layout.addRow(port_label, self.port_edit)
        
        # 端口说明
        port_hint = QLabel("🌐 修改端口后需要重启服务器才能生效（范围: 1-65535）")
        port_hint.setStyleSheet("""
            font-size: 9pt;
            color: #3498db;
            font-weight: normal;
            padding: 5px;
            background: #e3f2fd;
            border-radius: 4px;
        """)
        form_layout.addRow("", port_hint)
        
        # Git功能开关设置
        git_enabled_label = QLabel("Git功能：")
        self.git_enabled_checkbox = QCheckBox("启用Git集成功能")
        self.git_enabled_checkbox.setChecked(self.current_git_enabled)
        self.git_enabled_checkbox.setStyleSheet("""
            QCheckBox {
                font-size: 10pt;
                color: #2c3e50;
                font-weight: normal;
                padding: 5px;
            }
            QCheckBox::indicator {
                width: 18px;
                height: 18px;
            }
        """)
        form_layout.addRow(git_enabled_label, self.git_enabled_checkbox)
        
        # Git功能说明
        git_hint = QLabel("💡 启用后可在文件浏览器中使用Git版本控制功能\n⚠️ 需要安装GitPython库: pip install GitPython")
        git_hint.setStyleSheet("""
            font-size: 9pt;
            color: #3498db;
            font-weight: normal;
            padding: 5px;
            background: #e3f2fd;
            border-radius: 4px;
        """)
        form_layout.addRow("", git_hint)
        
        # Git工作目录设置（仅在启用Git时显示）
        self.git_workdir_label = QLabel("Git工作目录：")
        git_workdir_widget = QWidget()
        git_workdir_layout = QHBoxLayout(git_workdir_widget)
        git_workdir_layout.setContentsMargins(0, 0, 0, 0)
        git_workdir_layout.setSpacing(10)
        
        self.git_workdir_edit = QLineEdit(self.current_git_workdir)
        self.git_workdir_edit.setPlaceholderText("选择Git工作目录（用于扫描Git仓库）...")
        git_workdir_layout.addWidget(self.git_workdir_edit, 1)
        
        git_workdir_browse_button = QPushButton("📁 浏览")
        git_workdir_browse_button.setObjectName("browseButton")
        git_workdir_browse_button.clicked.connect(self.browse_git_workdir)
        git_workdir_layout.addWidget(git_workdir_browse_button)
        
        form_layout.addRow(self.git_workdir_label, git_workdir_widget)
        self.git_workdir_label.setVisible(self.current_git_enabled)
        git_workdir_widget.setVisible(self.current_git_enabled)
        
        # Git工作目录说明
        git_workdir_hint = QLabel("📂 Git视图将仅扫描此目录下的Git仓库")
        git_workdir_hint.setStyleSheet("""
            font-size: 9pt;
            color: #3498db;
            font-weight: normal;
            padding: 5px;
            background: #e3f2fd;
            border-radius: 4px;
        """)
        form_layout.addRow("", git_workdir_hint)
        git_workdir_hint.setVisible(self.current_git_enabled)
        self.git_workdir_hint = git_workdir_hint
        
        # Git外部软件路径设置（仅在启用Git时显示）
        self.git_external_app_label = QLabel("外部软件路径：")
        git_external_app_widget = QWidget()
        git_external_app_layout = QHBoxLayout(git_external_app_widget)
        git_external_app_layout.setContentsMargins(0, 0, 0, 0)
        git_external_app_layout.setSpacing(10)
        
        self.git_external_app_edit = QLineEdit(self.current_git_external_app_path)
        self.git_external_app_edit.setPlaceholderText("选择外部软件路径（如VSCode: code.exe）...")
        git_external_app_layout.addWidget(self.git_external_app_edit, 1)
        
        git_external_app_browse_button = QPushButton("📁 浏览")
        git_external_app_browse_button.setObjectName("browseButton")
        git_external_app_browse_button.clicked.connect(self.browse_git_external_app)
        git_external_app_layout.addWidget(git_external_app_browse_button)
        
        form_layout.addRow(self.git_external_app_label, git_external_app_widget)
        self.git_external_app_label.setVisible(self.current_git_enabled)
        git_external_app_widget.setVisible(self.current_git_enabled)
        
        # Git外部软件路径说明
        git_external_app_hint = QLabel("💻 用于在仓库页面中\"用软件打开\"功能（如VSCode、IntelliJ IDEA等）")
        git_external_app_hint.setStyleSheet("""
            font-size: 9pt;
            color: #3498db;
            font-weight: normal;
            padding: 5px;
            background: #e3f2fd;
            border-radius: 4px;
        """)
        form_layout.addRow("", git_external_app_hint)
        git_external_app_hint.setVisible(self.current_git_enabled)
        self.git_external_app_hint = git_external_app_hint
        
        # Git配置管理按钮（仅在启用Git时显示）
        self.git_config_button = QPushButton("⚙️ 管理Git服务器配置")
        self.git_config_button.setStyleSheet("""
            QPushButton {
                padding: 8px 20px;
                border: 2px solid #667eea;
                border-radius: 6px;
                background: white;
                color: #667eea;
                font-size: 10pt;
                font-weight: bold;
            }
            QPushButton:hover {
                background: #667eea;
                color: white;
            }
        """)
        self.git_config_button.clicked.connect(self.open_git_config_dialog)
        self.git_config_button.setEnabled(self.current_git_enabled)
        form_layout.addRow("", self.git_config_button)
        
        # 当Git开关状态改变时，启用/禁用相关控件
        def on_git_enabled_changed(state):
            enabled = (state == Qt.Checked)
            self.git_config_button.setEnabled(enabled)
            self.git_workdir_label.setVisible(enabled)
            git_workdir_widget.setVisible(enabled)
            self.git_workdir_hint.setVisible(enabled)
            # 更新外部软件路径控件的可见性
            self.git_external_app_label.setVisible(enabled)
            git_external_app_widget.setVisible(enabled)
            self.git_external_app_hint.setVisible(enabled)
        
        self.git_enabled_checkbox.stateChanged.connect(on_git_enabled_changed)
        
        layout.addLayout(form_layout)
        
        # 按钮区域
        button_layout = QHBoxLayout()
        button_layout.setSpacing(10)
        button_layout.addStretch()
        
        save_button = QPushButton("💾 保存设置")
        save_button.setObjectName("saveButton")
        save_button.clicked.connect(self.accept)
        button_layout.addWidget(save_button)
        
        cancel_button = QPushButton("❌ 取消")
        cancel_button.setObjectName("cancelButton")
        cancel_button.clicked.connect(self.reject)
        button_layout.addWidget(cancel_button)
        
        layout.addLayout(button_layout)
        
        self.setLayout(layout)
    
    def browse_directory(self):
        """浏览选择目录"""
        directory = QFileDialog.getExistingDirectory(
            self, 
            "选择服务器根目录",
            self.root_edit.text() or os.path.expanduser("~"),
            QFileDialog.ShowDirsOnly | QFileDialog.DontResolveSymlinks
        )
        
        if directory:
            self.root_edit.setText(directory)
            self.new_root = directory
    
    def browse_git_workdir(self):
        """浏览选择Git工作目录"""
        directory = QFileDialog.getExistingDirectory(
            self, 
            "选择Git工作目录（用于扫描Git仓库）",
            self.git_workdir_edit.text() or self.root_edit.text() or os.path.expanduser("~"),
            QFileDialog.ShowDirsOnly | QFileDialog.DontResolveSymlinks
        )
        
        if directory:
            self.git_workdir_edit.setText(directory)
            self.new_git_workdir = directory
    
    def browse_git_external_app(self):
        """浏览选择外部软件路径（如VSCode）"""
        import platform
        system = platform.system()
        
        if system == 'Windows':
            # Windows: 选择.exe文件
            file_path, _ = QFileDialog.getOpenFileName(
                self, 
                "选择外部软件（如VSCode）", 
                self.git_external_app_edit.text() or os.path.expanduser("~"),
                "可执行文件 (*.exe);;所有文件 (*.*)"
            )
        elif system == 'Darwin':  # macOS
            # macOS: 选择.app包
            file_path, _ = QFileDialog.getOpenFileName(
                self, 
                "选择外部软件（如VSCode）", 
                self.git_external_app_edit.text() or "/Applications",
                "应用程序 (*.app);;所有文件 (*.*)"
            )
        else:  # Linux
            # Linux: 选择任何文件
            file_path, _ = QFileDialog.getOpenFileName(
                self, 
                "选择外部软件（如VSCode）", 
                self.git_external_app_edit.text() or os.path.expanduser("~"),
                "所有文件 (*.*)"
            )
        
        if file_path:
            self.git_external_app_edit.setText(file_path)
            self.new_git_external_app_path = file_path
    
    def accept(self):
        """确认保存"""
        # 验证输入
        self.new_root = self.root_edit.text()
        self.new_password = self.password_edit.text()
        self.new_admin_password = self.admin_password_edit.text()
        self.new_close_to_tray = self.close_to_tray_checkbox.isChecked()
        self.new_git_enabled = self.git_enabled_checkbox.isChecked()
        self.new_git_workdir = self.git_workdir_edit.text().strip()
        self.new_git_external_app_path = self.git_external_app_edit.text().strip()
        
        # 验证端口
        try:
            port_value = int(self.port_edit.text().strip())
            if port_value < 1 or port_value > 65535:
                QMessageBox.warning(self, "错误", "端口号必须在 1-65535 之间")
                return
            self.new_port = port_value
        except ValueError:
            QMessageBox.warning(self, "错误", "端口号必须是有效的数字")
            return
        
        if not self.new_root or not os.path.exists(self.new_root):
            QMessageBox.warning(self, "错误", "请选择有效的根目录")
            return
        
        if not self.new_password:
            QMessageBox.warning(self, "错误", "登录密码不能为空")
            return
        
        if not self.new_admin_password:
            QMessageBox.warning(self, "错误", "管理员密码不能为空")
            return
        
        # 检查是否修改了根目录
        if self.new_root != self.current_root:
            # 需要验证管理员密码
            admin_pass, ok = QInputDialog.getText(
                self, 
                "验证管理员密码", 
                "修改目录需要管理员密码：",
                QLineEdit.Password
            )
            
            if not ok:
                return
            
            if admin_pass != self.current_admin_password:
                QMessageBox.critical(self, "错误", "管理员密码错误！无法修改目录。")
                return
        
        super().accept()
    
    def open_git_config_dialog(self):
        """打开Git配置管理对话框"""
        dialog = GitConfigDialog(self)
        dialog.exec_()
    
    def get_settings(self):
        """获取设置"""
        return self.new_root, self.new_password, self.new_admin_password, self.new_close_to_tray, self.new_port, self.new_git_enabled, self.new_git_workdir, self.new_git_external_app_path


class FlaskServerProcess(QProcess):
    """管理 Flask 服务器子进程的类"""
    def __init__(self, parent=None):
        super().__init__(parent)
        self.info_file_path = None

    def start_server(self, info_file_path):
        """启动 Flask 服务器"""
        self.info_file_path = info_file_path
        
        is_frozen = getattr(sys, 'frozen', False)  # 是否为打包环境

        if is_frozen:
            # 打包模式：使用exe所在目录作为工作目录
            current_dir = os.path.dirname(sys.executable)
            # 打包模式：直接运行当前 exe
            cmd = [sys.executable, 'run', info_file_path]
        else:
            # 开发模式：使用.py文件所在目录
            current_dir = os.path.dirname(os.path.abspath(__file__))
            # 开发模式：运行 main.py
            app_path = get_resource_path("main.py")
            cmd = [sys.executable, app_path, 'run', info_file_path]

        # 设置工作目录为exe所在目录（打包模式）或.py文件所在目录（开发模式）
        self.setWorkingDirectory(current_dir)
        app_logger.info("[调试] Flask子进程工作目录: %s", current_dir)
        self.start(cmd[0], cmd[1:])


    def stop_server(self):
        """停止 Flask 服务器"""
        if self.state() == QProcess.Running:
            self.terminate()
            if not self.waitForFinished(5000):
                self.kill()
                self.waitForFinished(1000)


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Yobboy文件服务器")
        self.setGeometry(100, 100, 900, 650)
        self.setMinimumSize(700, 500)
        
        # 加载关闭行为配置
        self.load_close_behavior_config()
        
        try:
            icon_path = get_resource_path('文件服务器.png')
            self.setWindowIcon(QIcon(icon_path))
        except Exception as e:
            app_logger.warning("加载图标失败: %s", e)

        myappid = "wo de app"
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(myappid)
        
        # 设置全局样式
        self.setStyleSheet("""
            QMainWindow {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1,
                    stop:0 #f5f7fa, stop:1 #c3cfe2);
            }
            QWidget {
                font-family: "Microsoft YaHei", "Segoe UI", Arial;
            }
            QGroupBox {
                background: white;
                border-radius: 12px;
                margin-top: 15px;
                padding-top: 15px;
                font-weight: bold;
                font-size: 14px;
                color: #2c3e50;
            }
            QGroupBox::title {
                subcontrol-origin: margin;
                subcontrol-position: top left;
                left: 15px;
                padding: 5px 10px;
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #667eea, stop:1 #764ba2);
                color: white;
                border-radius: 6px;
            }
            QTextEdit {
                background: #f8f9fa;
                border: 2px solid #e9ecef;
                border-radius: 8px;
                padding: 10px;
                font-family: "Consolas", "Courier New", monospace;
                font-size: 9pt;
                color: #212529;
            }
            QLabel {
                color: #495057;
                font-size: 11pt;
            }
        """)

        self.process = FlaskServerProcess(self)
        self.process.setProcessChannelMode(QProcess.SeparateChannels)
        self.process.readyReadStandardOutput.connect(self.handle_stdout)
        self.process.readyReadStandardError.connect(self.handle_stderr)
        self.process.started.connect(self.on_server_started)
        self.process.finished.connect(self.on_server_finished)

        self.log_receiver = LogMessageReceiver()
        self.log_receiver.message.connect(self.append_log)
        self.log_queue = []
        self.log_timer = QTimer()
        self.log_timer.timeout.connect(self.flush_log_queue)
        self.log_timer.start(100)

        self.is_server_running = False
        self.server_port = 5000  # 默认端口，将从配置中读取
        self.create_menu_bar()
        self.create_widgets()
        self.create_tray_icon()
        self.load_server_port_config()  # 加载端口配置
        self.update_server_info("未运行")

    def create_menu_bar(self):
        """创建菜单栏"""
        menubar = self.menuBar()
        menubar.setStyleSheet("""
            QMenuBar {
                background: white;
                border-bottom: 2px solid #667eea;
                padding: 5px;
            }
            QMenuBar::item {
                background: transparent;
                padding: 8px 15px;
                color: #2c3e50;
                font-weight: bold;
            }
            QMenuBar::item:selected {
                background: #667eea;
                color: white;
                border-radius: 4px;
            }
            QMenu {
                background: white;
                border: 2px solid #667eea;
                border-radius: 6px;
            }
            QMenu::item {
                padding: 8px 30px;
                color: #2c3e50;
            }
            QMenu::item:selected {
                background: #667eea;
                color: white;
            }
        """)
        
        # 文件菜单
        file_menu = menubar.addMenu('文件(&F)')
        
        # 设置
        settings_action = QAction('⚙️ 设置', self)
        settings_action.setStatusTip('配置服务器根目录和密码')
        settings_action.triggered.connect(self.open_settings)
        file_menu.addAction(settings_action)
        
        file_menu.addSeparator()
        
        # 退出
        exit_action = QAction('❌ 退出', self)
        exit_action.setStatusTip('退出程序')
        exit_action.triggered.connect(self.quit_application)
        file_menu.addAction(exit_action)
        
        # 窗口菜单
        window_menu = menubar.addMenu('窗口(&W)')
        
        # 最小化到托盘
        minimize_action = QAction('📥 最小化到托盘', self)
        minimize_action.setStatusTip('将窗口最小化到系统托盘')
        minimize_action.triggered.connect(self.minimize_to_tray)
        window_menu.addAction(minimize_action)
        
        # 帮助菜单
        help_menu = menubar.addMenu('帮助(&H)')
        
        # 使用帮助
        help_action = QAction('❓ 使用帮助', self)
        help_action.setStatusTip('查看使用帮助文档')
        help_action.triggered.connect(self.open_help)
        help_menu.addAction(help_action)
        
        help_menu.addSeparator()
        
        # 关于
        about_action = QAction('ℹ️ 关于', self)
        about_action.setStatusTip('关于Yobboy文件服务器')
        about_action.triggered.connect(self.show_about)
        help_menu.addAction(about_action)

    def create_widgets(self):
        central_widget = QWidget()
        central_widget.setStyleSheet("background: transparent;")
        self.setCentralWidget(central_widget)
        main_layout = QVBoxLayout(central_widget)
        main_layout.setContentsMargins(20, 20, 20, 20)
        main_layout.setSpacing(15)

        # 标题栏
        title_label = QLabel("🖥️ Yobboy文件服务器")
        title_label.setStyleSheet("""
            QLabel {
                font-size: 24pt;
                font-weight: bold;
                color: #2c3e50;
                padding: 10px;
                background: transparent;
            }
        """)
        title_label.setAlignment(Qt.AlignCenter)
        main_layout.addWidget(title_label)

        # 按钮区域
        button_layout = QHBoxLayout()
        button_layout.setSpacing(12)
        
        self.start_button = QPushButton("▶ 启动服务器")
        self.start_button.setMinimumHeight(50)
        self.start_button.setStyleSheet("""
            QPushButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #56ab2f, stop:1 #a8e063);
                color: white;
                border: none;
                border-radius: 10px;
                padding: 12px 24px;
                font-size: 14pt;
                font-weight: bold;
            }
            QPushButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #4a9628, stop:1 #96d054);
            }
            QPushButton:pressed {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #3d7a20, stop:1 #7ab83f);
            }
        """)
        self.start_button.clicked.connect(self.start_server)
        button_layout.addWidget(self.start_button)

        self.stop_button = QPushButton("⏹ 停止服务器")
        self.stop_button.setMinimumHeight(50)
        self.stop_button.setStyleSheet("""
            QPushButton {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #eb3349, stop:1 #f45c43);
                color: white;
                border: none;
                border-radius: 10px;
                padding: 12px 24px;
                font-size: 14pt;
                font-weight: bold;
            }
            QPushButton:hover {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #d42d3f, stop:1 #e54d38);
            }
            QPushButton:pressed {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0,
                    stop:0 #bd2737, stop:1 #d13e2f);
            }
            QPushButton:disabled {
                background: #cccccc;
                color: #666666;
            }
        """)
        self.stop_button.clicked.connect(self.stop_server)
        self.stop_button.setEnabled(False)
        button_layout.addWidget(self.stop_button)

        main_layout.addLayout(button_layout)

        # 服务器信息区域
        info_group = QGroupBox("📡 服务器状态")
        info_group.setStyleSheet("""
            QGroupBox {
                background: white;
                border-radius: 12px;
                margin-top: 15px;
                padding: 20px;
            }
        """)
        info_layout = QVBoxLayout(info_group)
        info_layout.setSpacing(10)
        
        self.status_label = QLabel("状态: 未运行")
        self.status_label.setStyleSheet("""
            QLabel {
                font-size: 12pt;
                padding: 8px;
                background: #e9ecef;
                border-radius: 6px;
                border-left: 4px solid #6c757d;
            }
        """)
        info_layout.addWidget(self.status_label)
        
        self.address_label = QLabel("地址: ")
        self.address_label.setStyleSheet("""
            QLabel {
                font-size: 11pt;
                padding: 8px;
                background: #e7f3ff;
                border-radius: 6px;
                border-left: 4px solid #0066cc;
            }
        """)
        info_layout.addWidget(self.address_label)
        main_layout.addWidget(info_group)

        # 日志输出区域
        log_group = QGroupBox("📋 服务器日志")
        log_layout = QVBoxLayout(log_group)
        log_layout.setContentsMargins(15, 15, 15, 15)
        
        self.log_text_edit = QTextEdit()
        self.log_text_edit.setReadOnly(True)
        self.log_text_edit.setPlaceholderText("""
    💡 提示：
    
    点击 "启动服务器" 按钮后，服务器将在多个网络地址上启动
    您可以使用上方显示的任意地址在浏览器中访问文件服务器
    
    如果同时连接WiFi和有线网络，服务器会映射到所有可用网络接口
    局域网内的其他设备也可以通过这些地址访问您的文件服务器
        """)
        self.log_text_edit.setStyleSheet("""
            QTextEdit {
                background: #f8f9fa;
                border: 2px solid #dee2e6;
                border-radius: 8px;
                padding: 15px;
                font-family: "Consolas", "Courier New", monospace;
                font-size: 9pt;
                color: #212529;
                line-height: 1.5;
            }
        """)
        font = self.log_text_edit.font()
        font.setFamily("Consolas")
        font.setPointSize(9)
        self.log_text_edit.setFont(font)
        log_layout.addWidget(self.log_text_edit)
        main_layout.addWidget(log_group)

    def create_tray_icon(self):
        """创建系统托盘图标"""
        # 检查系统是否支持托盘图标
        if not QSystemTrayIcon.isSystemTrayAvailable():
            app_logger.warning("系统不支持托盘图标")
            return
        
        # 创建系统托盘图标
        self.tray_icon = QSystemTrayIcon(self)
        
        # 尝试加载图标（先 png，失败则回退 ico，再失败用系统默认）
        try:
            icon_loaded = False
            png_path = get_resource_path('文件服务器.png')
            app_logger.info("尝试加载托盘图标: %s", png_path)
            png_icon = QIcon(png_path)
            if not png_icon.isNull():
                self.tray_icon.setIcon(png_icon)
                icon_loaded = True
                app_logger.info("托盘图标加载成功 (png)")
            else:
                ico_path = get_resource_path('文件服务器.ico')
                app_logger.info("png无效，尝试ico: %s", ico_path)
                ico_icon = QIcon(ico_path)
                if not ico_icon.isNull():
                    self.tray_icon.setIcon(ico_icon)
                    icon_loaded = True
                    app_logger.info("托盘图标加载成功 (ico)")
            if not icon_loaded:
                self.tray_icon.setIcon(self.style().standardIcon(self.style().SP_ComputerIcon))
                app_logger.info("使用系统默认图标")
        except Exception as e:
            app_logger.warning("加载托盘图标失败: %s", e)
            self.tray_icon.setIcon(self.style().standardIcon(self.style().SP_ComputerIcon))
        
        # 设置提示文字
        self.tray_icon.setToolTip('Yobboy文件服务器')
        
        # 创建托盘菜单
        tray_menu = QMenu()
        
        # 显示/隐藏主窗口
        show_action = QAction('显示主窗口', self)
        show_action.triggered.connect(self.show_window)
        tray_menu.addAction(show_action)
        
        hide_action = QAction('隐藏到托盘', self)
        hide_action.triggered.connect(self.hide)
        tray_menu.addAction(hide_action)
        
        tray_menu.addSeparator()
        
        # 快速启动/停止服务器
        self.tray_start_action = QAction('🟢 启动服务器', self)
        self.tray_start_action.triggered.connect(self.start_server)
        tray_menu.addAction(self.tray_start_action)
        
        self.tray_stop_action = QAction('🔴 停止服务器', self)
        self.tray_stop_action.triggered.connect(self.stop_server)
        self.tray_stop_action.setEnabled(False)
        tray_menu.addAction(self.tray_stop_action)
        
        tray_menu.addSeparator()
        
        # 退出程序
        quit_action = QAction('退出程序', self)
        quit_action.triggered.connect(self.quit_application)
        tray_menu.addAction(quit_action)
        
        self.tray_icon.setContextMenu(tray_menu)
        
        # 双击托盘图标显示窗口
        self.tray_icon.activated.connect(self.tray_icon_activated)
        
        # 强制显示托盘图标（避免判断show返回值）
        self.tray_icon.setVisible(True)
        self.tray_icon.show()
        app_logger.info("托盘图标已显示")
        
        # 根据配置设置关闭行为
        self.update_quit_behavior()

    def tray_icon_activated(self, reason):
        """托盘图标激活事件"""
        if reason == QSystemTrayIcon.DoubleClick:
            self.show_window()
    
    def show_window(self):
        """显示并激活主窗口"""
        self.show()
        self.activateWindow()
        self.raise_()
    
    def minimize_to_tray(self):
        """最小化到系统托盘"""
        # 检查托盘图标是否可用
        if not hasattr(self, 'tray_icon') or not self.tray_icon:
            app_logger.warning("托盘图标不可用，无法最小化到托盘")
            return
        
        # 确保托盘图标可见
        self.tray_icon.setVisible(True)
        
        self.hide()
        self.tray_icon.showMessage(
            'Yobboy文件服务器',
            '程序已最小化到系统托盘\n双击托盘图标可以重新显示窗口',
            QSystemTrayIcon.Information,
            2000
        )
    
    def quit_application(self):
        """退出应用程序"""
        reply = QMessageBox.question(
            self,
            '确认退出',
            '确定要退出程序吗？\n如果服务器正在运行，将会自动停止。',
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No
        )
        
        if reply == QMessageBox.Yes:
            if self.is_server_running:
                self.stop_server()
            self.tray_icon.hide()
            QApplication.quit()
    
    def update_server_info(self, status, addresses=None):
        """更新界面上的服务器状态和地址"""
        # 根据状态设置不同的颜色
        if "运行中" in status:
            status_color = "#28a745"  # 绿色
            border_color = "#28a745"
            bg_color = "#d4edda"
            icon = "🟢"
        else:
            status_color = "#6c757d"  # 灰色
            border_color = "#6c757d"
            bg_color = "#e9ecef"
            icon = "⚪"
        
        self.status_label.setStyleSheet(f"""
            QLabel {{
                font-size: 12pt;
                padding: 10px 15px;
                background: {bg_color};
                border-radius: 6px;
                border-left: 4px solid {border_color};
                color: {status_color};
                font-weight: bold;
            }}
        """)
        self.status_label.setText(f"{icon} <b>状态:</b> {status}")
        
        if addresses:
            port = self.server_port
            addr_text = "<br>".join([f"  🌐 <a href='http://{ip}:{port}' style='color: #0066cc; text-decoration: none;'>{ip}:{port}</a>" for ip in addresses])
            self.address_label.setText(f"<b>访问地址:</b><br>{addr_text}")
            self.address_label.setOpenExternalLinks(True)
            self.address_label.setTextFormat(Qt.RichText)
            # 更新托盘图标提示
            tray_tooltip = f"Yobboy文件服务器\n状态: {status}\n地址: {addresses[0]}:{port}"
            self.tray_icon.setToolTip(tray_tooltip)
        else:
            self.address_label.setText("访问地址: 未启动")
            # 更新托盘图标提示
            self.tray_icon.setToolTip(f'Yobboy文件服务器\n状态: {status}')

    def append_log(self, message):
        """将单条日志消息添加到队列"""
        self.log_queue.append(message)

    def flush_log_queue(self):
        """将队列中的日志消息批量刷新到文本框"""
        if self.log_queue:
            cursor = self.log_text_edit.textCursor()
            cursor.movePosition(QTextCursor.End)
            for message in self.log_queue:
                cursor.insertText(message)
            self.log_text_edit.setTextCursor(cursor)
            self.log_text_edit.ensureCursorVisible()
            self.log_queue.clear()

    def handle_stdout(self):
        """处理来自 Flask 进程的标准输出"""
        data = self.process.readAllStandardOutput()
        stdout_bytes = bytes(data)
        
        # 尝试多种编码解码（Windows控制台可能使用GBK或UTF-8）
        stdout = None
        for encoding in ['gbk', 'utf-8', 'cp936']:
            try:
                stdout = stdout_bytes.decode(encoding)
                break
            except:
                continue
        
        # 如果所有编码都失败，使用UTF-8并忽略错误
        if stdout is None:
            stdout = stdout_bytes.decode('utf-8', errors='replace')
        
        lines = stdout.splitlines(keepends=True)
        for line in lines:
            self.log_receiver.message.emit(line)
            if "Running on" in line and "http://" in line:
                # 使用缓存，避免重复查询IP地址
                local_ips = get_local_ips(verbose=False, use_cache=True)
                self.update_server_info("运行中", local_ips)

    def handle_stderr(self):
        """处理来自 Flask 进程的标准错误"""
        data = self.process.readAllStandardError()
        stderr_bytes = bytes(data)
        
        # 尝试多种编码解码（Windows控制台可能使用GBK或UTF-8）
        stderr = None
        for encoding in ['gbk', 'utf-8', 'cp936']:
            try:
                stderr = stderr_bytes.decode(encoding)
                break
            except:
                continue
        
        # 如果所有编码都失败，使用UTF-8并忽略错误
        if stderr is None:
            stderr = stderr_bytes.decode('utf-8', errors='replace')
        
        lines = stderr.splitlines(keepends=True)
        for line in lines:
            self.log_receiver.message.emit(f"[STDERR] {line}")

    def start_server(self):
        """启动服务器的槽函数"""
        if self.is_server_running:
            QMessageBox.warning(self, "警告", "服务器已在运行中！")
            return
        import tempfile
        fd, self.info_file_path = tempfile.mkstemp(suffix='.json', prefix='flask_info_', text=True)
        os.close(fd)
        self.process.start_server(self.info_file_path)

    def stop_server(self):
        """停止服务器的槽函数"""
        if not self.is_server_running:
            return
        self.append_log("--- 正在停止服务器... ---\n")
        self.process.stop_server()

    def wait_for_server_state(self, expected_running, timeout_ms=5000):
        """等待服务器达到目标状态，使用事件循环保持 UI 响应。"""
        if self.is_server_running == expected_running:
            return True

        loop = QEventLoop(self)
        timeout_timer = QTimer(self)
        check_timer = QTimer(self)
        timeout_timer.setSingleShot(True)

        result = {'ok': False}

        def check_state():
            if self.is_server_running == expected_running:
                result['ok'] = True
                loop.quit()

        timeout_timer.timeout.connect(loop.quit)
        check_timer.timeout.connect(check_state)
        timeout_timer.start(timeout_ms)
        check_timer.start(50)
        check_state()
        loop.exec_()
        check_timer.stop()
        timeout_timer.stop()

        return result['ok']

    def on_server_started(self):
        """服务器进程启动时的回调"""
        self.is_server_running = True
        self.start_button.setEnabled(False)
        self.stop_button.setEnabled(True)
        self.tray_start_action.setEnabled(False)
        self.tray_stop_action.setEnabled(True)
        self.update_server_info("启动中...")
        self.append_log("--- 服务器启动中... ---\n")

    def on_server_finished(self, exit_code, exit_status):
        """服务器进程结束时的回调"""
        self.is_server_running = False
        self.start_button.setEnabled(True)
        self.stop_button.setEnabled(False)
        self.tray_start_action.setEnabled(True)
        self.tray_stop_action.setEnabled(False)
        self.update_server_info("未运行")
        self.append_log(f"--- 服务器已停止 (退出码: {exit_code}) ---\n")

        # 保存日志到文件
        log_dir = get_logs_dir()
        log_file_path = os.path.join(log_dir, datetime.now().strftime("%Y-%m-%d-%H-%M-%S") + ".log")
        try:
            with open(log_file_path, 'w', encoding='utf-8') as f:
                f.write(self.log_text_edit.toPlainText())
        except Exception as e:
            app_logger.error("保存日志失败: %s", e)

        self.log_text_edit.clear()

        # 清理临时 info 文件
        if hasattr(self, 'info_file_path') and self.info_file_path and os.path.exists(self.info_file_path):
            try:
                os.remove(self.info_file_path)
            except OSError:
                pass
            self.info_file_path = None

    def open_help(self):
        """打开帮助页面"""
        import webbrowser
        
        # 检查服务器是否正在运行
        if not self.is_server_running:
            # 如果服务器未运行，先启动服务器
            reply = QMessageBox.question(
                self, '启动服务器', 
                '帮助页面需要服务器运行。是否现在启动服务器？',
                QMessageBox.Yes | QMessageBox.No, 
                QMessageBox.Yes
            )
            
            if reply == QMessageBox.Yes:
                # 启动服务器
                self.start_server()

                if not self.wait_for_server_state(expected_running=True, timeout_ms=5000):
                    QMessageBox.warning(self, "错误", "服务器启动失败，无法打开帮助页面")
                    return
            else:
                return
        
        # 获取本地IP地址（使用缓存）
        local_ips = get_local_ips(verbose=False, use_cache=True)
        port = self.server_port
        if local_ips:
            help_url = f"http://{local_ips[0]}:{port}/help"
        else:
            help_url = f"http://127.0.0.1:{port}/help"
        
        # 在浏览器中打开帮助页面
        try:
            webbrowser.open(help_url)
        except Exception as e:
            QMessageBox.warning(self, "错误", f"无法打开浏览器：{e}")
    
    def open_settings(self):
        """打开设置对话框"""
        # 如果服务器正在运行，先停止
        if self.is_server_running:
            reply = QMessageBox.question(
                self, '停止服务器', 
                '修改设置需要停止服务器。是否继续？',
                QMessageBox.Yes | QMessageBox.No, 
                QMessageBox.No
            )
            
            if reply == QMessageBox.Yes:
                self.stop_server()

                if not self.wait_for_server_state(expected_running=False, timeout_ms=5000):
                    QMessageBox.warning(self, "错误", "服务器停止失败，无法打开设置")
                    return
            else:
                return
        
        # 获取当前配置（轻量读取，避免初始化 Flask/SocketIO）
        settings = read_runtime_settings()
        current_root = settings.get('ROOT_DIR', os.path.expanduser('~'))
        current_password = settings.get('PASSWORD', 'password')
        current_admin_password = settings.get('ADMIN_PASSWORD', 'admin123')
        current_close_to_tray = settings.get('CLOSE_TO_TRAY', False)
        current_port = settings.get('PORT', 5000)
        current_git_enabled = settings.get('GIT_ENABLED', False)
        current_git_workdir = settings.get('GIT_WORKDIR', '')
        current_git_external_app_path = settings.get('GIT_EXTERNAL_APP_PATH', '')
        
        # 显示设置对话框
        dialog = SettingsDialog(self, current_root, current_password, current_admin_password, current_close_to_tray, current_port, current_git_enabled, current_git_workdir, current_git_external_app_path)
        if dialog.exec_() == QDialog.Accepted:
            new_root, new_password, new_admin_password, new_close_to_tray, new_port, new_git_enabled, new_git_workdir, new_git_external_app_path = dialog.get_settings()
            
            # 保存配置
            try:
                config_file = get_config_path()
                save_runtime_settings({
                    'CONFIG_FILE': config_file,
                    'ROOT_DIR': new_root,
                    'PASSWORD': new_password,
                    'ADMIN_PASSWORD': new_admin_password,
                    'CLOSE_TO_TRAY': new_close_to_tray,
                    'PORT': new_port,
                    'GIT_ENABLED': new_git_enabled,
                    'GIT_WORKDIR': new_git_workdir,
                    'GIT_EXTERNAL_APP_PATH': new_git_external_app_path
                }, config_file=config_file)
                
                close_behavior_text = "最小化到托盘" if new_close_to_tray else "直接退出程序"
                git_enabled_text = "已启用" if new_git_enabled else "已禁用"
                git_workdir_text = new_git_workdir if new_git_workdir else "未设置"
                
                QMessageBox.information(
                    self, "保存成功", 
                    f"设置已成功保存到配置文件！\n\n"
                    f"配置文件位置:\n{config_file}\n\n"
                    f"根目录: {new_root}\n"
                    f"登录密码: {'*' * len(new_password)} (已加密显示)\n"
                    f"管理员密码: {'*' * len(new_admin_password)} (已加密显示)\n"
                    f"服务器端口: {new_port}\n"
                    f"关闭行为: {close_behavior_text}\n"
                    f"Git功能: {git_enabled_text}\n"
                    f"{'Git工作目录: ' + git_workdir_text if new_git_enabled else ''}\n\n"
                    f"您可以重新启动服务器使用新配置。"
                )
                
                app_logger.info("配置已保存到: %s", config_file)
                app_logger.info("根目录: %s", new_root)
                app_logger.info("登录密码长度: %s", len(new_password))
                app_logger.info("管理员密码长度: %s", len(new_admin_password))
                app_logger.info("服务器端口: %s", new_port)
                app_logger.info("关闭行为: %s", close_behavior_text)
                app_logger.info("Git功能: %s", git_enabled_text)
                
                # 更新主窗口的关闭行为配置
                self.close_to_tray = new_close_to_tray
                self.server_port = new_port  # 更新端口配置
                self.update_quit_behavior()  # 立即更新QApplication行为
                app_logger.info("[配置更新] 关闭行为已更新: %s", '最小化到托盘' if new_close_to_tray else '直接退出')
                app_logger.info("[配置更新] 服务器端口已更新: %s（需要重启服务器生效）", new_port)
                app_logger.info("[配置更新] Git功能已更新: %s（需要重启服务器生效）", git_enabled_text)
                
            except Exception as e:
                import traceback
                error_detail = traceback.format_exc()
                QMessageBox.critical(self, "保存失败", f"保存配置时发生错误：\n\n{e}\n\n详细信息:\n{error_detail}")
                app_logger.error("保存配置失败: %s", e)
                app_logger.error(error_detail)
    
    def load_close_behavior_config(self):
        """加载关闭行为配置"""
        try:
            settings = read_runtime_settings(create_if_missing=False)
            self.close_to_tray = settings.get('CLOSE_TO_TRAY', False)
            app_logger.info("[配置] 关闭行为: %s", '最小化到托盘' if self.close_to_tray else '直接退出')
        except Exception as e:
            app_logger.warning("[警告] 加载关闭行为配置失败: %s", e)
            self.close_to_tray = False
    
    def load_server_port_config(self):
        """加载服务器端口配置"""
        try:
            settings = read_runtime_settings(create_if_missing=False)
            self.server_port = settings.get('PORT', 5000)
            app_logger.info("[配置] 服务器端口: %s", self.server_port)
        except Exception as e:
            app_logger.warning("[警告] 加载端口配置失败: %s", e)
            self.server_port = 5000
    
    def update_quit_behavior(self):
        """根据配置更新QApplication的退出行为"""
        app = QApplication.instance()
        if app:
            if self.close_to_tray:
                # 关闭到托盘模式：关闭窗口不退出应用
                app.setQuitOnLastWindowClosed(False)
                app_logger.info("[配置] 已设置：关闭窗口不退出应用（托盘模式）")
            else:
                # 退出模式：关闭窗口退出应用
                app.setQuitOnLastWindowClosed(True)
                app_logger.info("[配置] 已设置：关闭窗口退出应用（退出模式）")
    
    def show_about(self):
        """显示关于对话框"""
        about_text = """
        <h2>🖥️ Yobboy文件服务器</h2>
        <p><b>版本:</b> v2.2</p>
        <p><b>作者:</b> Yobboy Team</p>
        <br>
        <p>一个功能强大的本地文件服务器，支持：</p>
        <ul>
            <li>📁 文件浏览、新建、上传、下载</li>
            <li>🎮 3D模型在线查看（Three.js）</li>
            <li>✏️ 代码在线编辑（CodeMirror）</li>
            <li>📊 Draw.io 离线图表编辑</li>
            <li>👀 多种文件格式预览</li>
            <li>🔗 分享链接系统</li>
            <li>🔒 双重密码保护</li>
            <li>⚙️ 可配置关闭行为</li>
        </ul>
        <br>
        <p>© 2025 Yobboy文件服务器</p>
        <p>本地化文件管理与图表编辑解决方案</p>
        """
        
        QMessageBox.about(self, "关于 Yobboy文件服务器", about_text)
    
    def closeEvent(self, event):
        """处理窗口关闭事件"""
        # 使用实例变量中的配置
        if self.close_to_tray:
            # 最小化到托盘，不退出程序
            event.ignore()
            self.hide()
            # 显示托盘消息提示
            self.tray_icon.showMessage(
                "Yobboy 文件服务器",
                "程序已最小化到系统托盘，双击图标可恢复窗口",
                QSystemTrayIcon.Information,
                2000
            )
            app_logger.info("[关闭事件] 窗口已最小化到托盘")
        else:
            # 退出程序
            app_logger.info("[关闭事件] 准备退出程序")
            if self.is_server_running:
                reply = QMessageBox.question(
                    self, '退出', '服务器正在运行，确定要退出吗？',
                    QMessageBox.Yes | QMessageBox.No, QMessageBox.No
                )
                if reply == QMessageBox.Yes:
                    self.stop_server()
                    if self.wait_for_server_state(expected_running=False, timeout_ms=5000):
                        event.accept()
                        app_logger.info("[关闭事件] 程序已退出")
                    else:
                        event.ignore()
                        QMessageBox.warning(self, "错误", "服务器停止超时，已取消退出")
                else:
                    event.ignore()
                    app_logger.info("[关闭事件] 用户取消退出")
            else:
                event.accept()
                app_logger.info("[关闭事件] 程序已退出")


def run_flask_app(info_file_path=None):
    """运行 Flask 应用"""
    # 当从GUI启动时（有info_file_path参数），将debug设为False以避免冲突
    debug = False if info_file_path else True
    # 注意：load_or_create_config 现在在 create_app() 中调用
    application = create_app(debug=debug)
    
    # === 显示加载的配置信息 ===
    print("=" * 60)
    print("[服务器配置信息]")
    print(f"配置文件路径: {application.config.get('CONFIG_FILE')}")
    print(f"根目录: {application.config.get('ROOT_DIR')}")
    print(f"登录密码长度: {len(application.config.get('PASSWORD', ''))}")
    print(f"Git功能: {'已启用' if application.config.get('GIT_ENABLED') else '已禁用'}")
    print(f"Git工作目录: {application.config.get('GIT_WORKDIR', '未设置')}")
    print(f"Git外部软件路径: {application.config.get('GIT_EXTERNAL_APP_PATH', '未设置')}")
    print("=" * 60)
    # === 配置信息结束 ===
    
    host = "0.0.0.0"
    port = application.config.get('PORT', 5000)
    local_ips = get_local_ips()
    print(f" * Running on all addresses ({host})")
    for ip in local_ips:
        if ip != '0.0.0.0':
            print(f" * Running on http://{ip}:{port}")
    print(f" * WebSocket endpoint: /serial")
    sys.stdout.flush()
    # 使用 socketio.run 而不是 app.run
    # 添加 use_reloader=False 以加快启动速度（避免自动检测和重载机制）
    application.socketio.run(application, 
                            host=host, 
                            port=port, 
                            debug=debug,
                            use_reloader=False,  # 禁用自动重载，加快启动
                            allow_unsafe_werkzeug=True,
                            log_output=False)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'run':
        info_file_path = sys.argv[2] if len(sys.argv) > 2 else None
        run_flask_app(info_file_path)
    else:
        app = QApplication(sys.argv)
        window = MainWindow()
        window.show()
        sys.exit(app.exec_())
