# main.py
import os
import sys
import configparser
import json
import logging
from datetime import datetime
import ctypes
import socket
from flask import Flask, request
from flask_socketio import SocketIO, emit, join_room, leave_room
import routes
from serial_manager import serial_manager
from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                                QPushButton, QTextEdit, QLabel, QGroupBox, QMessageBox, 
                                QSystemTrayIcon, QMenu, QAction, QDialog, QLineEdit, 
                                QFileDialog, QFormLayout, QMenuBar, QInputDialog, QCheckBox)
from PyQt5.QtCore import QProcess, QTimer, Qt, pyqtSignal, QObject, QThread
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
        print(f"[调试] 打包模式 - exe目录: {base_dir}")
    else:
        # 开发环境：.py文件所在目录
        base_dir = os.path.dirname(os.path.abspath(__file__))
        print(f"[调试] 开发模式 - py目录: {base_dir}")
    
    program_dir_path = os.path.join(base_dir, config_name)
    print(f"[调试] 配置文件路径: {program_dir_path}")
    
    # 如果配置文件已存在于程序目录，直接返回
    if os.path.exists(program_dir_path):
        print(f"[调试] 配置文件已存在")
        return program_dir_path
    
    # 配置文件不存在，测试程序目录是否可写
    try:
        # 使用临时文件测试写权限
        test_file = os.path.join(base_dir, '.config_write_test')
        with open(test_file, 'w') as f:
            f.write('test')
        os.remove(test_file)
        # 程序目录可写，使用程序目录
        print(f"[调试] 程序目录可写，配置文件将创建在: {program_dir_path}")
        return program_dir_path
    except Exception as e:
        # 程序目录不可写，使用用户目录
        config_dir = os.path.join(os.path.expanduser("~"), ".yobboy_file_server")
        os.makedirs(config_dir, exist_ok=True)
        fallback_path = os.path.join(config_dir, config_name)
        print(f"[调试] 程序目录不可写({e})，使用用户目录: {fallback_path}")
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

connection_logger = logging.getLogger("file_server_connections")
connection_logger.setLevel(logging.INFO)
log_filename = f"{get_logs_dir()}/access_{datetime.now().strftime('%Y-%m-%d')}.log"
file_handler = logging.FileHandler(log_filename, encoding='utf-8')
file_handler.setFormatter(logging.Formatter(
    '%(asctime)s - %(message)s', datefmt='%Y-%m-%d %H:%M:%S'
))
connection_logger.addHandler(file_handler)
connection_logger.propagate = False


def get_local_ips():
    """
    获取本机所有 IPv4 地址，智能排序优先返回真实可用的局域网IP
    优先级：
    1. 通过默认路由的IP（最可能是真实物理网卡）
    2. 常见局域网段的IP（10.x, 172.16-31.x, 192.168.x）
    3. 其他非虚拟网络的IP
    4. 排除虚拟网络接口（VMware、VirtualBox、Docker等）
    """
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
            s.connect(("8.8.8.8", 80))
            default_ip = s.getsockname()[0]
            print(f"[网络] 默认路由IP（推荐）: {default_ip}")
    except Exception as e:
        print(f"[网络] 无法获取默认路由IP: {e}")
    
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
        print(f"[网络] 获取主机名IP时出错: {e}")
    
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
                third_octet = int(ip.split('.')[2])
                # 常见的真实局域网第三段通常是 0-20 或者较大的数（如100+）
                if third_octet <= 20 or third_octet >= 100:
                    return 1  # 高优先级真实局域网
                else:
                    return 3  # 可能是特殊配置的局域网
            elif ip.startswith('10.'):
                return 2  # 10.x.x.x 段
            elif ip.startswith('172.'):
                # 172.16.0.0 - 172.31.255.255 是私有地址
                second_octet = int(ip.split('.')[1])
                if 16 <= second_octet <= 31:
                    return 2  # 私有局域网
                else:
                    return 4  # 其他172段（可能是虚拟网络）
        
        # 低优先级：已知的虚拟网络
        return 10
    
    # 去重并排序
    ip_list = list(set(ip_list))
    
    # 如果有默认IP且不在列表中，添加到列表
    if default_ip and default_ip not in ip_list:
        ip_list.append(default_ip)
    
    # 按优先级排序
    ip_list.sort(key=ip_priority)
    
    # 打印所有找到的IP及其优先级（便于调试）
    print("[网络] 找到的所有IP地址（按优先级排序）:")
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
            print(f"  {status} {ip} (优先级: {priority})")
        except UnicodeEncodeError:
            # 如果仍然有编码问题，使用纯ASCII输出
            print(f"  {status} {ip} (priority: {priority})")
    
    return ip_list


def log_connection_info():
    """记录当前请求的连接信息"""
    if request:
        client_ip = request.environ.get('REMOTE_ADDR')
        user_agent = request.headers.get('User-Agent', 'Unknown')
        path = request.path
        method = request.method
        msg = f"IP: {client_ip} | Method: {method} | Path: {path} | User-Agent: {user_agent}"
        connection_logger.info(msg)


def create_app():
    """应用工厂函数"""
    # 显式指定 templates 和 static 目录（外部文件夹）
    template_dir = get_resource_path('templates')
    static_dir = get_resource_path('static')

    app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)
    app.secret_key = 'your_super_secret_key_change_this_in_production'
    app.config['CONFIG_FILE'] = get_config_path()
    app.config['DEFAULT_ROOT_DIR'] = os.path.expanduser("~")
    
    # 启用调试模式以便查看请求日志
    app.debug = True

    # 确保模板和静态目录存在（用于首次运行时创建）
    os.makedirs(template_dir, exist_ok=True)
    os.makedirs(static_dir, exist_ok=True)

    @app.before_request
    def before_request():
        log_connection_info()

    routes.init_app(app)
    
    # 初始化 SocketIO（不指定 async_mode，让其自动选择）
    socketio = SocketIO(app, 
                      cors_allowed_origins="*", 
                      logger=False,
                      engineio_logger=False,
                      ping_timeout=60,
                      ping_interval=25)
    init_serial_socketio(socketio)
    app.socketio = socketio
    
    return app


def init_serial_socketio(socketio):
    """初始化串口 WebSocket 事件"""
    
    # 存储客户端会话
    serial_sessions = {}
    
    @socketio.on('connect', namespace='/serial')
    def handle_connect():
        """客户端连接"""
        print(f'[Serial WebSocket] 客户端连接: {request.sid}')
        emit('connected', {'client_id': request.sid})
    
    @socketio.on('disconnect', namespace='/serial')
    def handle_disconnect():
        """客户端断开"""
        print(f'[Serial WebSocket] 客户端断开: {request.sid}')
        
        # 清理会话
        session_ports = serial_sessions.pop(request.sid, {})
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
            print(f'[错误] 打开串口失败: {e}')
            emit('port_opened', {
                'success': False,
                'error': str(e)
            })
    
    @socketio.on('close_port', namespace='/serial')
    def handle_close_port(data):
        """关闭串口"""
        try:
            port_id = data.get('port_id')
            
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
            print(f'[错误] 关闭串口失败: {e}')
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
            print(f'[错误] 写入数据失败: {e}')
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
            password = settings.get('password', 'ats123')
            admin_password = settings.get('admin_password', 'admin123')  # 管理员密码
            close_to_tray = settings.get('close_to_tray', 'false').lower() == 'true'  # 关闭到托盘
            
            # 保存配置到app中（即使路径不存在也保留用户设置）
            app.config['ROOT_DIR'] = os.path.normpath(root_dir) if root_dir else app.config['DEFAULT_ROOT_DIR']
            app.config['PASSWORD'] = password
            app.config['ADMIN_PASSWORD'] = admin_password
            app.config['CLOSE_TO_TRAY'] = close_to_tray
            
            # 检查路径是否有效（仅警告，不修改配置）
            if not os.path.isdir(app.config['ROOT_DIR']):
                print(f"[警告] 配置的根目录 '{app.config['ROOT_DIR']}' 不存在或无效")
                print(f"  请通过设置界面修改根目录，或手动创建该目录")
            
            print(f"[OK] 配置已加载: 根目录={app.config['ROOT_DIR']}, 密码长度={len(password)}, 管理员密码已设置")
        else:
            # 配置文件格式错误，使用默认值并保存
            print("[警告] 配置文件格式错误，使用默认配置")
            app.config['ROOT_DIR'] = app.config['DEFAULT_ROOT_DIR']
            app.config['PASSWORD'] = 'ats123'
            app.config['ADMIN_PASSWORD'] = 'admin123'
            app.config['CLOSE_TO_TRAY'] = False
            save_config(app)
    else:
        # 配置文件不存在，创建默认配置
        print("配置文件不存在，创建默认配置")
        app.config['ROOT_DIR'] = app.config['DEFAULT_ROOT_DIR']
        app.config['PASSWORD'] = 'ats123'
        app.config['ADMIN_PASSWORD'] = 'admin123'
        app.config['CLOSE_TO_TRAY'] = False
        save_config(app)


def save_config(app):
    """保存当前配置到文件"""
    config_file = app.config['CONFIG_FILE']
    config = configparser.ConfigParser()
    config['settings'] = {
        'root_dir': app.config['ROOT_DIR'],
        'password': app.config['PASSWORD'],
        'admin_password': app.config.get('ADMIN_PASSWORD', 'admin123'),
        'close_to_tray': str(app.config.get('CLOSE_TO_TRAY', False)).lower()
    }
    with open(config_file, 'w', encoding='utf-8') as f:
        config.write(f)
    print(f"配置已保存到: {config_file}")


class LogMessageReceiver(QObject):
    """用于从工作线程接收日志消息的信号对象"""
    message = pyqtSignal(str)


class SettingsDialog(QDialog):
    """设置对话框，用于配置根目录和密码"""
    def __init__(self, parent=None, current_root='', current_password='', current_admin_password='', current_close_to_tray=False):
        super().__init__(parent)
        self.setWindowTitle("服务器设置")
        self.setMinimumWidth(500)
        self.current_root = current_root
        self.current_password = current_password
        self.current_admin_password = current_admin_password
        self.current_close_to_tray = current_close_to_tray
        self.new_root = current_root
        self.new_password = current_password
        self.new_admin_password = current_admin_password
        self.new_close_to_tray = current_close_to_tray
        
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
    
    def accept(self):
        """确认保存"""
        # 验证输入
        self.new_root = self.root_edit.text()
        self.new_password = self.password_edit.text()
        self.new_admin_password = self.admin_password_edit.text()
        self.new_close_to_tray = self.close_to_tray_checkbox.isChecked()
        
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
    
    def get_settings(self):
        """获取设置"""
        return self.new_root, self.new_password, self.new_admin_password, self.new_close_to_tray


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
        print(f"[调试] Flask子进程工作目录: {current_dir}")
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
            print(f"加载图标失败: {e}")

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
        self.create_menu_bar()
        self.create_widgets()
        self.create_tray_icon()
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
            print("系统不支持托盘图标")
            return
        
        # 创建系统托盘图标
        self.tray_icon = QSystemTrayIcon(self)
        
        # 尝试加载图标（先 png，失败则回退 ico，再失败用系统默认）
        try:
            icon_loaded = False
            png_path = get_resource_path('文件服务器.png')
            print(f"尝试加载托盘图标: {png_path}")
            png_icon = QIcon(png_path)
            if not png_icon.isNull():
                self.tray_icon.setIcon(png_icon)
                icon_loaded = True
                print("托盘图标加载成功 (png)")
            else:
                ico_path = get_resource_path('文件服务器.ico')
                print(f"png无效，尝试ico: {ico_path}")
                ico_icon = QIcon(ico_path)
                if not ico_icon.isNull():
                    self.tray_icon.setIcon(ico_icon)
                    icon_loaded = True
                    print("托盘图标加载成功 (ico)")
            if not icon_loaded:
                self.tray_icon.setIcon(self.style().standardIcon(self.style().SP_ComputerIcon))
                print("使用系统默认图标")
        except Exception as e:
            print(f"加载托盘图标失败: {e}")
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
        print("托盘图标已显示")
        
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
            print("托盘图标不可用，无法最小化到托盘")
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
            addr_text = "<br>".join([f"  🌐 <a href='http://{ip}:5000' style='color: #0066cc; text-decoration: none;'>{ip}:5000</a>" for ip in addresses])
            self.address_label.setText(f"<b>访问地址:</b><br>{addr_text}")
            self.address_label.setOpenExternalLinks(True)
            self.address_label.setTextFormat(Qt.RichText)
            # 更新托盘图标提示
            tray_tooltip = f"Yobboy文件服务器\n状态: {status}\n地址: {addresses[0]}:5000"
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
                local_ips = get_local_ips()
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
            print(f"保存日志失败: {e}")

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
                
                # 等待服务器启动（最多等待5秒）
                for i in range(50):
                    if self.is_server_running:
                        # 再等待一小段时间确保服务器完全启动
                        QApplication.processEvents()
                        QThread.msleep(200)
                        break
                    QApplication.processEvents()
                    QThread.msleep(100)
                
                if not self.is_server_running:
                    QMessageBox.warning(self, "错误", "服务器启动失败，无法打开帮助页面")
                    return
            else:
                return
        
        # 获取本地IP地址
        local_ips = get_local_ips()
        if local_ips:
            help_url = f"http://{local_ips[0]}:5000/help"
        else:
            help_url = "http://127.0.0.1:5000/help"
        
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
                # 等待服务器停止
                for i in range(50):
                    if not self.is_server_running:
                        break
                    QApplication.processEvents()
                    QThread.msleep(100)
                
                if self.is_server_running:
                    QMessageBox.warning(self, "错误", "服务器停止失败，无法打开设置")
                    return
            else:
                return
        
        # 获取当前配置
        app = create_app()
        load_or_create_config(app)
        current_root = app.config.get('ROOT_DIR', os.path.expanduser('~'))
        current_password = app.config.get('PASSWORD', 'ats123')
        current_admin_password = app.config.get('ADMIN_PASSWORD', 'admin123')
        current_close_to_tray = app.config.get('CLOSE_TO_TRAY', False)
        
        # 显示设置对话框
        dialog = SettingsDialog(self, current_root, current_password, current_admin_password, current_close_to_tray)
        if dialog.exec_() == QDialog.Accepted:
            new_root, new_password, new_admin_password, new_close_to_tray = dialog.get_settings()
            
            # 保存配置
            try:
                config = configparser.ConfigParser()
                config['settings'] = {
                    'root_dir': new_root,
                    'password': new_password,
                    'admin_password': new_admin_password,
                    'close_to_tray': str(new_close_to_tray).lower()
                }
                config_file = get_config_path()
                
                with open(config_file, 'w', encoding='utf-8') as f:
                    config.write(f)
                
                # 验证保存是否成功
                config_check = configparser.ConfigParser()
                config_check.read(config_file, encoding='utf-8')
                saved_password = config_check['settings'].get('password', '')
                
                close_behavior_text = "最小化到托盘" if new_close_to_tray else "直接退出程序"
                
                QMessageBox.information(
                    self, "保存成功", 
                    f"设置已成功保存到配置文件！\n\n"
                    f"配置文件位置:\n{config_file}\n\n"
                    f"根目录: {new_root}\n"
                    f"登录密码: {'*' * len(new_password)} (已加密显示)\n"
                    f"管理员密码: {'*' * len(new_admin_password)} (已加密显示)\n"
                    f"关闭行为: {close_behavior_text}\n\n"
                    f"您可以重新启动服务器使用新配置。"
                )
                
                print(f"配置已保存到: {config_file}")
                print(f"根目录: {new_root}")
                print(f"登录密码长度: {len(new_password)}")
                print(f"管理员密码长度: {len(new_admin_password)}")
                print(f"关闭行为: {close_behavior_text}")
                
                # 更新主窗口的关闭行为配置
                self.close_to_tray = new_close_to_tray
                self.update_quit_behavior()  # 立即更新QApplication行为
                print(f"[配置更新] 关闭行为已更新: {'最小化到托盘' if new_close_to_tray else '直接退出'}")
                
            except Exception as e:
                import traceback
                error_detail = traceback.format_exc()
                QMessageBox.critical(self, "保存失败", f"保存配置时发生错误：\n\n{e}\n\n详细信息:\n{error_detail}")
                print(f"保存配置失败: {e}")
                print(error_detail)
    
    def load_close_behavior_config(self):
        """加载关闭行为配置"""
        try:
            app = create_app()
            load_or_create_config(app)
            self.close_to_tray = app.config.get('CLOSE_TO_TRAY', False)
            print(f"[配置] 关闭行为: {'最小化到托盘' if self.close_to_tray else '直接退出'}")
        except Exception as e:
            print(f"[警告] 加载关闭行为配置失败: {e}")
            self.close_to_tray = False
    
    def update_quit_behavior(self):
        """根据配置更新QApplication的退出行为"""
        app = QApplication.instance()
        if app:
            if self.close_to_tray:
                # 关闭到托盘模式：关闭窗口不退出应用
                app.setQuitOnLastWindowClosed(False)
                print("[配置] 已设置：关闭窗口不退出应用（托盘模式）")
            else:
                # 退出模式：关闭窗口退出应用
                app.setQuitOnLastWindowClosed(True)
                print("[配置] 已设置：关闭窗口退出应用（退出模式）")
    
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
            print("[关闭事件] 窗口已最小化到托盘")
        else:
            # 退出程序
            print("[关闭事件] 准备退出程序")
            if self.is_server_running:
                reply = QMessageBox.question(
                    self, '退出', '服务器正在运行，确定要退出吗？',
                    QMessageBox.Yes | QMessageBox.No, QMessageBox.No
                )
                if reply == QMessageBox.Yes:
                    self.stop_server()
                    for _ in range(50):
                        if not self.is_server_running:
                            break
                        QApplication.processEvents()
                        QThread.msleep(100)
                    event.accept()
                    print("[关闭事件] 程序已退出")
                else:
                    event.ignore()
                    print("[关闭事件] 用户取消退出")
            else:
                event.accept()
                print("[关闭事件] 程序已退出")


def run_flask_app(info_file_path=None):
    """运行 Flask 应用"""
    application = create_app()
    load_or_create_config(application)
    
    # === 显示加载的配置信息 ===
    print("=" * 60)
    print("[服务器配置信息]")
    print(f"配置文件路径: {application.config.get('CONFIG_FILE')}")
    print(f"根目录: {application.config.get('ROOT_DIR')}")
    print(f"登录密码: {application.config.get('PASSWORD')}")
    print(f"密码长度: {len(application.config.get('PASSWORD', ''))}")
    print("=" * 60)
    # === 配置信息结束 ===
    
    host = "0.0.0.0"
    port = 5000
    local_ips = get_local_ips()
    print(f" * Running on all addresses ({host})")
    for ip in local_ips:
        if ip != '0.0.0.0':
            print(f" * Running on http://{ip}:{port}")
    print(f" * WebSocket endpoint: /serial")
    sys.stdout.flush()
    # 当从GUI启动时（有info_file_path参数），将debug设为False以避免冲突
    debug = False if info_file_path else True
    # 使用 socketio.run 而不是 app.run
    application.socketio.run(application, 
                            host=host, 
                            port=port, 
                            debug=debug, 
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