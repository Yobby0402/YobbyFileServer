# main.py
import os
import sys
import shutil
import subprocess
import configparser
import json
import logging
import threading
import importlib.util
import ssl
import urllib.request
import urllib.error
from datetime import datetime, timedelta
import ctypes
import socket
import ipaddress
from flask import Flask, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room
from .logging_setup import (
    get_logs_dir,
    app_logger,
    connection_logger,
    ensure_connection_logger_handler,
    apply_log_level_from_sources,
    configure_flask_app_logger,
)
from . import routes
from .serial_manager import serial_manager
from .shared_serial_hub import (
    SOURCE_BROWSER_SERIAL,
    SOURCE_SERVER_PYSERIAL,
    shared_serial_hub,
)
from .paths import project_base_dir
from .paths import get_data_dir, get_logs_dir as get_runtime_logs_dir, resolve_path
from .game_gomoku import init_gomoku_socketio
from .game_hub import GameHubStore

DEFAULT_MAX_UPLOAD_SIZE_MB = 0
DEFAULT_TOPDOWN_SCORE_SOFT_CAP = 100000


def normalize_max_upload_size_mb(value, default=DEFAULT_MAX_UPLOAD_SIZE_MB):
    """Normalize upload limit in MB. 0 disables Flask's request size limit."""
    try:
        size = int(value)
    except (TypeError, ValueError):
        size = default
    return max(size, 0)


def apply_upload_size_config(app, value=None):
    max_upload_size_mb = normalize_max_upload_size_mb(value)
    app.config['MAX_UPLOAD_SIZE_MB'] = max_upload_size_mb
    app.config['MAX_CONTENT_LENGTH'] = (
        max_upload_size_mb * 1024 * 1024 if max_upload_size_mb > 0 else None
    )


def normalize_topdown_score_soft_cap(value, default=DEFAULT_TOPDOWN_SCORE_SOFT_CAP):
    """Normalize the topdown score soft cap. Values below 0 fall back to default."""
    try:
        score_cap = int(value)
    except (TypeError, ValueError):
        score_cap = default
    return max(score_cap, 0)


from PyQt5.QtWidgets import (QApplication, QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                                QPushButton, QTextEdit, QLabel, QGroupBox, QMessageBox,
                                QSystemTrayIcon, QMenu, QAction, QDialog, QLineEdit,
                                QFileDialog, QFormLayout, QMenuBar, QInputDialog, QCheckBox,
                                QListWidget, QListWidgetItem, QComboBox, QTabWidget, QScrollArea)
from PyQt5.QtCore import QProcess, QTimer, Qt, pyqtSignal, QObject, QThread, QUrl
from PyQt5.QtCore import QEventLoop
from PyQt5.QtGui import QIcon, QTextCursor, QDesktopServices


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
        base_path = project_base_dir()
    else:
        # 开发环境：.py 文件所在目录
        base_path = project_base_dir()
    return os.path.join(base_path, relative_path)


def get_config_path():
    """获取配置文件路径，优先exe/py所在目录，否则用户目录"""
    config_name = 'config.ini'

    # 获取程序所在目录（打包后是exe目录，开发时是.py文件目录）
    if getattr(sys, 'frozen', False):
        # 打包环境：exe所在目录
        base_dir = project_base_dir()
        app_logger.info("[调试] 打包模式 - exe目录: %s", base_dir)
    else:
        # 开发环境：.py文件所在目录
        base_dir = project_base_dir()
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


DEFAULT_SERIAL_HTTPS_PORT = 5443
REMOTE_SERIAL_HTTPS_MODE_FULL = 'full'
REMOTE_SERIAL_HTTPS_MODE_COMPAT = 'compat'


def normalize_remote_serial_https_mode(value):
    """Normalize the remote-serial HTTPS mode."""
    mode = (value or '').strip().lower()
    if mode == REMOTE_SERIAL_HTTPS_MODE_COMPAT:
        return REMOTE_SERIAL_HTTPS_MODE_COMPAT
    return REMOTE_SERIAL_HTTPS_MODE_FULL


def default_serial_https_port(main_port=None):
    """Return a sensible default HTTPS port for the serial companion listener."""
    try:
        main_port_value = int(main_port)
    except (TypeError, ValueError):
        main_port_value = 5000

    default_port = DEFAULT_SERIAL_HTTPS_PORT
    if main_port_value == default_port:
        return default_port + 1
    return default_port


def normalize_serial_https_port(value, main_port=None):
    """Normalize the configured serial HTTPS port."""
    try:
        port = int(value)
        if 1 <= port <= 65535:
            return port
    except (TypeError, ValueError):
        pass
    return default_serial_https_port(main_port)


def resolve_relative_config_path(path_value, config_dir):
    """Resolve a config path relative to the config directory."""
    if not path_value:
        return ''
    candidate = os.path.expanduser(path_value)
    if os.path.isabs(candidate):
        return os.path.normpath(candidate)
    return os.path.normpath(os.path.join(config_dir, candidate))


def can_load_cert_pair(cert_path, key_path):
    """Check whether a certificate pair can be loaded by Python's SSL stack."""
    try:
        test_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        test_context.load_cert_chain(certfile=cert_path, keyfile=key_path)
        return True, ''
    except Exception as e:
        return False, str(e)


def can_bind_tcp_port(host, port):
    """Return whether a TCP port looks available for binding."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as test_socket:
            test_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            test_socket.bind((host, int(port)))
        return True
    except OSError:
        return False


def inspect_https_runtime(settings_data, verify_cert_pair=True):
    """Inspect whether HTTPS can be started with the current settings."""
    config_file = settings_data.get('CONFIG_FILE') or get_config_path()
    config_dir = os.path.dirname(config_file)
    main_port = settings_data.get('PORT', 5000)
    remote_serial_enabled = bool(settings_data.get('REMOTE_SERIAL_ENABLED', False))
    remote_serial_https_mode = normalize_remote_serial_https_mode(
        settings_data.get('REMOTE_SERIAL_HTTPS_MODE', REMOTE_SERIAL_HTTPS_MODE_FULL)
    )
    serial_https_port = normalize_serial_https_port(
        settings_data.get('SERIAL_HTTPS_PORT', default_serial_https_port(main_port)),
        main_port=main_port,
    )

    cert_file = (settings_data.get('HTTPS_CERT_FILE') or '').strip()
    key_file = (settings_data.get('HTTPS_KEY_FILE') or '').strip()
    resolved_cert_file = resolve_relative_config_path(cert_file, config_dir)
    resolved_key_file = resolve_relative_config_path(key_file, config_dir)

    cert_exists = bool(resolved_cert_file and os.path.exists(resolved_cert_file))
    key_exists = bool(resolved_key_file and os.path.exists(resolved_key_file))
    cert_pair_configured = bool(cert_file and key_file)
    cert_pair_ok = False
    cert_pair_error = ''
    if cert_exists and key_exists and verify_cert_pair:
        cert_pair_ok, cert_pair_error = can_load_cert_pair(resolved_cert_file, resolved_key_file)
    elif cert_exists and key_exists:
        cert_pair_ok = True

    has_cryptography = importlib.util.find_spec('cryptography') is not None
    https_available = cert_pair_ok or has_cryptography

    return {
        'config_file': config_file,
        'config_dir': config_dir,
        'main_port': main_port,
        'remote_serial_enabled': remote_serial_enabled,
        'remote_serial_https_mode': remote_serial_https_mode,
        'serial_https_port': serial_https_port,
        'cert_file': cert_file,
        'key_file': key_file,
        'resolved_cert_file': resolved_cert_file,
        'resolved_key_file': resolved_key_file,
        'cert_exists': cert_exists,
        'key_exists': key_exists,
        'cert_pair_configured': cert_pair_configured,
        'cert_pair_ok': cert_pair_ok,
        'cert_pair_error': cert_pair_error,
        'has_cryptography': has_cryptography,
        'https_available': https_available,
    }


def prepare_https_runtime(settings_data):
    """Prepare SSL context information for a remote-serial HTTPS listener."""
    runtime_info = inspect_https_runtime(settings_data, verify_cert_pair=True)
    ssl_context = None
    cert_source = 'none'

    if runtime_info['cert_exists'] and runtime_info['key_exists'] and runtime_info['cert_pair_ok']:
        ssl_context = (
            runtime_info['resolved_cert_file'],
            runtime_info['resolved_key_file'],
        )
        cert_source = 'configured'
        return runtime_info, ssl_context, cert_source

    if runtime_info['has_cryptography']:
        local_ips_for_cert = get_local_ips(verbose=False, use_cache=True)
        auto_cert_file, auto_key_file, auto_cert_created = get_or_create_local_https_cert(
            runtime_info['config_dir'],
            local_ips_for_cert
        )
        if auto_cert_file and auto_key_file:
            runtime_info['auto_cert_file'] = auto_cert_file
            runtime_info['auto_key_file'] = auto_key_file
            runtime_info['auto_cert_created'] = auto_cert_created
            ssl_context = (auto_cert_file, auto_key_file)
            cert_source = 'generated'
        else:
            ssl_context = 'adhoc'
            cert_source = 'adhoc'

    return runtime_info, ssl_context, cert_source


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

    app = Flask('yobboy_file_server.web', template_folder=template_dir, static_folder=static_dir)
    app.secret_key = 'your_super_secret_key_change_this_in_production'
    app.config['CONFIG_FILE'] = get_config_path()
    app.config['DEFAULT_ROOT_DIR'] = os.path.expanduser("~")
    apply_upload_size_config(app)

    # 调试模式由启动参数控制，避免 GUI 场景默认开启调试
    app.debug = debug

    # 确保模板和静态目录存在（用于首次运行时创建）
    os.makedirs(template_dir, exist_ok=True)
    os.makedirs(static_dir, exist_ok=True)

    # 仅在真正启动 Flask 应用时绑定 access logger，避免多进程文件锁冲突。
    ensure_connection_logger_handler()

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
    init_gomoku_socketio(
        socketio,
        profile_resolver=lambda req: routes.resolve_game_profile_payload(req),
    )
    app.socketio = socketio

    configure_flask_app_logger(app)

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


def init_serial_socketio(socketio):
    """Initialize shared serial Socket.IO events."""

    def channel_room(channel_id):
        return f'channel_{channel_id}'

    def emit_shared_channels():
        socketio.emit(
            'shared_channels',
            {'success': True, 'channels': shared_serial_hub.list_channels()},
            namespace='/serial'
        )

    def emit_channel_state(channel_id):
        channel = shared_serial_hub.get_channel(channel_id)
        if channel:
            socketio.emit(
                'channel_state',
                {'success': True, 'channel': channel},
                namespace='/serial',
                room=channel_room(channel_id),
            )

    def emit_serial_entry(entry):
        if not entry:
            return
        payload = {
            'success': True,
            'channel_id': entry['channel_id'],
            'port_id': entry['channel_id'],
            'direction': entry['dir'],
            'data': list(bytes.fromhex(entry.get('hex', ''))),
            'timestamp': entry['ts'],
            'entry': entry,
        }
        # 仅广播 serial_data，避免客户端同时监听 serial_entry + serial_data 时重复显示
        socketio.emit('serial_data', payload, namespace='/serial', room=channel_room(entry['channel_id']))

    def apply_serial_actions(actions):
        if not actions:
            return
        catalog_dirty = False
        for action in actions:
            action_type = action.get('type')
            channel_id = action.get('channel_id')
            if action_type == 'server_open':
                config = action.get('config', {})
                listener_id = f"hub:{channel_id}"

                def on_data_received(_pid, data_bytes, current_channel_id=channel_id):
                    entry = shared_serial_hub.append_rx_entry(current_channel_id, data_bytes)
                    emit_serial_entry(entry)

                success = serial_manager.open_port(
                    port_id=channel_id,
                    device=action.get('device'),
                    baudrate=int(config.get('baudrate', 9600)),
                    bytesize=int(config.get('bytesize', 8)),
                    parity=config.get('parity', 'N'),
                    stopbits=int(config.get('stopbits', 1)),
                    listener_id=listener_id,
                    callback=on_data_received,
                )
                shared_serial_hub.mark_server_channel_state(
                    channel_id,
                    active=success,
                    error='' if success else 'server_open_failed',
                )
                emit_channel_state(channel_id)
                if not success:
                    socketio.emit(
                        'channel_error',
                        {
                            'success': False,
                            'channel_id': channel_id,
                            'error': '打开服务器串口失败',
                        },
                        namespace='/serial',
                        room=channel_room(channel_id),
                    )
                catalog_dirty = True
            elif action_type == 'server_close':
                try:
                    serial_manager.release_port(channel_id, listener_id=f"hub:{channel_id}", force=True)
                except Exception:
                    pass
                shared_serial_hub.mark_server_channel_state(channel_id, active=False, error='')
                emit_channel_state(channel_id)
                catalog_dirty = True
            elif action_type == 'browser_activate':
                socketio.emit(
                    'browser_channel_activate',
                    {
                        'success': True,
                        'channel_id': channel_id,
                        'config': action.get('config', {}),
                    },
                    namespace='/serial',
                    room=action.get('owner_sid'),
                )
                catalog_dirty = True
            elif action_type == 'browser_sleep':
                socketio.emit(
                    'browser_channel_sleep',
                    {
                        'success': True,
                        'channel_id': channel_id,
                    },
                    namespace='/serial',
                    room=action.get('owner_sid'),
                )
                catalog_dirty = True
            elif action_type == 'browser_write_request':
                socketio.emit(
                    'browser_write_request',
                    {
                        'success': True,
                        'channel_id': channel_id,
                        'request_id': action.get('request_id'),
                        'data': action.get('data', []),
                    },
                    namespace='/serial',
                    room=action.get('owner_sid'),
                )
        if catalog_dirty:
            emit_shared_channels()

    socketio.serial_action_runner = apply_serial_actions
    socketio.serial_emit_shared_channels = emit_shared_channels
    socketio.serial_emit_channel_state = emit_channel_state

    @socketio.on('connect', namespace='/serial')
    def handle_connect():
        if not session.get('logged_in'):
            app_logger.warning('[Serial WebSocket] Rejecting unauthorized socket connection: %s', request.sid)
            return False
        app_logger.info('[Serial WebSocket] 客户端连接: %s', request.sid)
        emit('connected', {'client_id': request.sid})
        emit('shared_channels', {'success': True, 'channels': shared_serial_hub.list_channels()})
        return True

    @socketio.on('disconnect', namespace='/serial')
    def handle_disconnect():
        app_logger.info('[Serial WebSocket] 客户端断开: %s', request.sid)
        failed_writes = shared_serial_hub.fail_browser_writes_for_owner(request.sid)
        changed_channels, actions = shared_serial_hub.handle_socket_disconnect(request.sid)
        for failed in failed_writes:
            socketio.emit(
                'data_written',
                {
                    'success': False,
                    'port_id': failed.get('channel_id'),
                    'channel_id': failed.get('channel_id'),
                    'bytes_written': failed.get('bytes_written', 0),
                    'error': failed.get('error', 'owner_disconnected'),
                },
                namespace='/serial',
                room=failed.get('requester_sid'),
            )
        apply_serial_actions(actions)
        if changed_channels or failed_writes:
            emit_shared_channels()
            for channel in changed_channels:
                emit_channel_state(channel['channel_id'])

    @socketio.on('list_ports', namespace='/serial')
    def handle_list_ports():
        try:
            ports = serial_manager.list_available_ports()
            emit('ports_list', {'success': True, 'ports': ports})
        except Exception as e:
            emit('ports_list', {'success': False, 'error': str(e)})

    @socketio.on('list_channels', namespace='/serial')
    def handle_list_channels():
        emit('shared_channels', {'success': True, 'channels': shared_serial_hub.list_channels()})

    @socketio.on('register_browser_port', namespace='/serial')
    def handle_register_browser_port(data):
        try:
            config = {
                'baudrate': int(data.get('baudrate', 9600)),
                'bytesize': int(data.get('bytesize', 8)),
                'parity': data.get('parity', 'N'),
                'stopbits': int(data.get('stopbits', 1)),
            }
            channel = shared_serial_hub.register_browser_channel(
                owner_sid=request.sid,
                display_name=data.get('display_name', ''),
                config=config,
                browser_port=data.get('browser_port') or {},
            )
            emit('browser_port_registered', {'success': True, 'channel': channel})
            emit_shared_channels()
        except Exception as e:
            emit('browser_port_registered', {'success': False, 'error': str(e)})

    @socketio.on('unregister_browser_port', namespace='/serial')
    def handle_unregister_browser_port(data):
        try:
            channel_id = data.get('channel_id') or data.get('port_id')
            channel, actions = shared_serial_hub.unregister_browser_channel(request.sid, channel_id)
            if not channel:
                emit('browser_port_unregistered', {'success': False, 'error': '共享串口不存在'})
                return
            apply_serial_actions(actions)
            emit('browser_port_unregistered', {'success': True, 'channel_id': channel_id})
            emit_shared_channels()
        except Exception as e:
            emit('browser_port_unregistered', {'success': False, 'error': str(e)})

    @socketio.on('open_port', namespace='/serial')
    def handle_open_port(data):
        try:
            channel_id = (data.get('channel_id') or data.get('port_id') or '').strip()
            if not channel_id:
                device = (data.get('device') or '').strip()
                if not device:
                    emit('port_opened', {'success': False, 'error': '缺少串口设备信息'})
                    return
                config = {
                    'baudrate': int(data.get('baudrate', 9600)),
                    'bytesize': int(data.get('bytesize', 8)),
                    'parity': data.get('parity', 'N'),
                    'stopbits': int(data.get('stopbits', 1)),
                }
                channel_info, _created = shared_serial_hub.ensure_server_channel(
                    device=device,
                    config=config,
                    display_name=data.get('display_name') or device,
                )
                channel_id = channel_info['channel_id']

            channel, actions, error = shared_serial_hub.attach_client(channel_id, request.sid)
            if error or not channel:
                emit('port_opened', {'success': False, 'port_id': channel_id, 'error': error or '打开共享串口失败'})
                return

            join_room(channel_room(channel_id))
            apply_serial_actions(actions)
            channel = shared_serial_hub.get_channel(channel_id) or channel
            emit(
                'port_opened',
                {
                    'success': True,
                    'port_id': channel_id,
                    'channel': channel,
                    'port_info': channel,
                },
            )
            emit_channel_state(channel_id)
            emit_shared_channels()
        except Exception as e:
            app_logger.error('[错误] 打开共享串口失败: %s', e)
            emit('port_opened', {'success': False, 'error': str(e)})

    @socketio.on('close_port', namespace='/serial')
    def handle_close_port(data):
        try:
            channel_id = (data.get('channel_id') or data.get('port_id') or '').strip()
            channel, actions = shared_serial_hub.detach_client(channel_id, request.sid)
            leave_room(channel_room(channel_id))
            apply_serial_actions(actions)
            emit(
                'port_closed',
                {
                    'success': True,
                    'port_id': channel_id,
                    'channel': channel,
                },
            )
            emit_channel_state(channel_id)
            emit_shared_channels()
        except Exception as e:
            app_logger.error('[错误] 关闭共享串口失败: %s', e)
            emit('port_closed', {'success': False, 'error': str(e)})

    @socketio.on('write_data', namespace='/serial')
    def handle_write_data(data):
        try:
            channel_id = (data.get('channel_id') or data.get('port_id') or '').strip()
            if not shared_serial_hub.is_client_attached(channel_id, request.sid):
                emit('data_written', {'success': False, 'port_id': channel_id, 'error': '当前客户端未连接此串口'})
                return

            channel = shared_serial_hub.get_channel(channel_id)
            if not channel:
                emit('data_written', {'success': False, 'port_id': channel_id, 'error': '共享串口不存在'})
                return

            data_bytes = bytes(data.get('data', []))
            if channel['source_type'] == SOURCE_SERVER_PYSERIAL:
                bytes_written = serial_manager.write_data(channel_id, data_bytes)
                if bytes_written >= 0:
                    entry = shared_serial_hub.append_tx_entry(channel_id, data_bytes, actor=None)
                    emit(
                        'data_written',
                        {
                            'success': True,
                            'port_id': channel_id,
                            'channel_id': channel_id,
                            'bytes_written': bytes_written,
                        },
                    )
                    emit_serial_entry(entry)
                else:
                    emit('data_written', {'success': False, 'port_id': channel_id, 'error': '写入数据失败'})
            elif channel['source_type'] == SOURCE_BROWSER_SERIAL:
                action, error = shared_serial_hub.build_browser_write_request(
                    channel_id=channel_id,
                    requester_sid=request.sid,
                    data=data_bytes,
                    actor=None,
                )
                if error or not action:
                    emit('data_written', {'success': False, 'port_id': channel_id, 'error': error or '浏览器串口未激活'})
                    return
                apply_serial_actions([action])
            else:
                emit('data_written', {'success': False, 'port_id': channel_id, 'error': '未知串口类型'})
        except Exception as e:
            app_logger.error('[错误] 写入共享串口失败: %s', e)
            emit('data_written', {'success': False, 'error': str(e)})

    @socketio.on('get_port_info', namespace='/serial')
    def handle_get_port_info(data):
        try:
            channel_id = (data.get('channel_id') or data.get('port_id') or '').strip()
            channel = shared_serial_hub.get_channel(channel_id)
            if channel:
                emit(
                    'port_info',
                    {
                        'success': True,
                        'port_id': channel_id,
                        'channel': channel,
                        'port_info': channel,
                    },
                )
            else:
                emit('port_info', {'success': False, 'port_id': channel_id, 'error': '共享串口不存在'})
        except Exception as e:
            emit('port_info', {'success': False, 'error': str(e)})

    @socketio.on('browser_channel_ready', namespace='/serial')
    def handle_browser_channel_ready(data):
        channel_id = (data.get('channel_id') or '').strip()
        channel = shared_serial_hub.mark_browser_channel_ready(
            owner_sid=request.sid,
            channel_id=channel_id,
            active=bool(data.get('active', False)),
            error=(data.get('error') or '').strip() or None,
        )
        if channel:
            emit_channel_state(channel_id)
            emit_shared_channels()

    @socketio.on('browser_port_data', namespace='/serial')
    def handle_browser_port_data(data):
        channel_id = (data.get('channel_id') or '').strip()
        if not shared_serial_hub.is_browser_owner(channel_id, request.sid):
            return
        entry = shared_serial_hub.append_rx_entry(channel_id, bytes(data.get('data', [])))
        emit_serial_entry(entry)

    @socketio.on('browser_port_tx', namespace='/serial')
    def handle_browser_port_tx(data):
        channel_id = (data.get('channel_id') or '').strip()
        if not shared_serial_hub.is_browser_owner(channel_id, request.sid):
            return
        entry = shared_serial_hub.append_tx_entry(channel_id, bytes(data.get('data', [])), actor='owner')
        emit_serial_entry(entry)

    @socketio.on('browser_write_result', namespace='/serial')
    def handle_browser_write_result(data):
        ack, entry, error = shared_serial_hub.complete_browser_write(
            owner_sid=request.sid,
            request_id=(data.get('request_id') or '').strip(),
            success=bool(data.get('success', False)),
            error=(data.get('error') or '').strip() or None,
        )
        if error or not ack:
            return
        socketio.emit(
            'data_written',
            {
                'success': ack['success'],
                'port_id': ack['channel_id'],
                'channel_id': ack['channel_id'],
                'bytes_written': ack.get('bytes_written', 0),
                'error': ack.get('error', ''),
            },
            namespace='/serial',
            room=ack.get('requester_sid'),
        )
        if entry:
            emit_serial_entry(entry)


LOCAL_AI_CONFIG_KEYS = (
    'LOCAL_AI_API_BASE_URL',
    'LOCAL_AI_API_MODEL',
    'LOCAL_AI_EMBED_API_BASE_URL',
    'LOCAL_AI_EMBED_MODEL',
    'LOCAL_AI_EMBED_API_KEY',
    'LOCAL_AI_EMBED_QUERY_INSTRUCTION',
    'LOCAL_AI_EMBED_BATCH_SIZE',
    'LOCAL_AI_SKILLS_DIR',
    'LOCAL_AI_KB_STORAGE_DIR',
    'LOCAL_AI_MODELS_DIR',
    'LOCAL_AI_HF_HOME',
    'LOCAL_AI_APPEND_SKILLS',
    'LOCAL_AI_DEVICE',
    'LOCAL_AI_TORCH_DTYPE',
    'LOCAL_AI_MAX_NEW_TOKENS',
    'LOCAL_AI_DRAWIO_MAX_NEW_TOKENS',
    'LOCAL_AI_DRAWIO_OUTPUT',
    'LOCAL_AI_TEMPERATURE',
    'LOCAL_AI_TOP_P',
    'LOCAL_AI_LLAMA_CTX',
    'LOCAL_AI_LLAMA_GPU_LAYERS',
    'LOCAL_AI_PROMPT_CONTEXT_CAP',
    'LOCAL_AI_USE_MCP_BRIDGE',
)

def local_ai_settings_dict_from_ini(ini_config=None):
    """解析 [local_ai] 为字典（GUI / read_runtime_settings 与 Flask 共用逻辑）。"""
    from .local_ai_paths import (
        default_knowledge_storage_dir,
        default_hf_home,
        default_models_dir,
        default_skills_dir,
        project_base_dir,
        resolve_project_path,
    )

    base = project_base_dir()
    d = {
        'LOCAL_AI_API_BASE_URL': 'http://127.0.0.1:1234/v1',
        'LOCAL_AI_API_MODEL': '',
        'LOCAL_AI_EMBED_API_BASE_URL': 'http://127.0.0.1:1234/v1',
        'LOCAL_AI_EMBED_MODEL': '',
        'LOCAL_AI_EMBED_API_KEY': 'lm-studio',
        'LOCAL_AI_EMBED_QUERY_INSTRUCTION': (
            'Represent this query for retrieving relevant passages from the local knowledge base.'
        ),
        'LOCAL_AI_EMBED_BATCH_SIZE': 16,
        'LOCAL_AI_SKILLS_DIR': default_skills_dir(),
        'LOCAL_AI_KB_STORAGE_DIR': default_knowledge_storage_dir(),
        'LOCAL_AI_MODELS_DIR': default_models_dir(),
        'LOCAL_AI_HF_HOME': default_hf_home(),
        'LOCAL_AI_APPEND_SKILLS': True,
        'LOCAL_AI_DEVICE': 'auto',
        'LOCAL_AI_TORCH_DTYPE': 'bfloat16',
        'LOCAL_AI_MAX_NEW_TOKENS': 512,
        'LOCAL_AI_DRAWIO_MAX_NEW_TOKENS': 8192,
        'LOCAL_AI_DRAWIO_OUTPUT': 'text_dsl',
        'LOCAL_AI_TEMPERATURE': 0.7,
        'LOCAL_AI_TOP_P': 0.95,
        'LOCAL_AI_LLAMA_CTX': 4096,
        'LOCAL_AI_LLAMA_GPU_LAYERS': -1,
        'LOCAL_AI_PROMPT_CONTEXT_CAP': 4096,
        'LOCAL_AI_USE_MCP_BRIDGE': True,
    }
    if ini_config and ini_config.has_section('local_ai'):
        la = ini_config['local_ai']
        if (la.get('api_base_url') or '').strip():
            d['LOCAL_AI_API_BASE_URL'] = la.get('api_base_url').strip()
        if la.get('api_model') is not None:
            d['LOCAL_AI_API_MODEL'] = (la.get('api_model') or '').strip()
        if (la.get('embed_api_base_url') or '').strip():
            d['LOCAL_AI_EMBED_API_BASE_URL'] = la.get('embed_api_base_url').strip()
        else:
            d['LOCAL_AI_EMBED_API_BASE_URL'] = d['LOCAL_AI_API_BASE_URL']
        if la.get('embed_model') is not None:
            d['LOCAL_AI_EMBED_MODEL'] = (la.get('embed_model') or '').strip()
        if la.get('embed_api_key') is not None:
            d['LOCAL_AI_EMBED_API_KEY'] = (la.get('embed_api_key') or '').strip() or 'lm-studio'
        if la.get('embed_query_instruction') is not None:
            d['LOCAL_AI_EMBED_QUERY_INSTRUCTION'] = (
                la.get('embed_query_instruction') or d['LOCAL_AI_EMBED_QUERY_INSTRUCTION']
            ).strip()
        try:
            d['LOCAL_AI_EMBED_BATCH_SIZE'] = max(1, int(la.get('embed_batch_size', '16')))
        except ValueError:
            pass
        if (la.get('skills_dir') or '').strip():
            d['LOCAL_AI_SKILLS_DIR'] = resolve_project_path(la.get('skills_dir'), base)
        if (la.get('knowledge_storage_dir') or '').strip():
            d['LOCAL_AI_KB_STORAGE_DIR'] = resolve_project_path(la.get('knowledge_storage_dir'), base)
        if (la.get('models_dir') or '').strip():
            d['LOCAL_AI_MODELS_DIR'] = resolve_project_path(la.get('models_dir'), base)
        if (la.get('hf_home') or '').strip():
            d['LOCAL_AI_HF_HOME'] = resolve_project_path(la.get('hf_home'), base)
        if (la.get('append_skills') or '').strip():
            d['LOCAL_AI_APPEND_SKILLS'] = la.get('append_skills', 'true').strip().lower() in (
                '1',
                'true',
                'yes',
                'on',
            )
        if (la.get('device') or '').strip():
            d['LOCAL_AI_DEVICE'] = la.get('device').strip()
        if (la.get('torch_dtype') or '').strip():
            d['LOCAL_AI_TORCH_DTYPE'] = la.get('torch_dtype').strip()
        try:
            d['LOCAL_AI_MAX_NEW_TOKENS'] = int(la.get('max_new_tokens', '512'))
        except ValueError:
            pass
        try:
            d['LOCAL_AI_DRAWIO_MAX_NEW_TOKENS'] = int(la.get('drawio_max_new_tokens', '8192'))
        except ValueError:
            pass
        if (la.get('drawio_output') or '').strip():
            _dout = la.get('drawio_output', 'text_dsl').strip().lower()
            if _dout in ('text_dsl', 'xml'):
                d['LOCAL_AI_DRAWIO_OUTPUT'] = _dout
        try:
            d['LOCAL_AI_LLAMA_CTX'] = int(la.get('llama_ctx', '4096'))
        except ValueError:
            pass
        try:
            raw_pcap = (la.get('prompt_context_cap') or '4096').strip().lower()
            if raw_pcap in ('0', 'none', 'off', ''):
                d['LOCAL_AI_PROMPT_CONTEXT_CAP'] = 0
            else:
                d['LOCAL_AI_PROMPT_CONTEXT_CAP'] = int(raw_pcap or '4096')
        except ValueError:
            pass
        try:
            d['LOCAL_AI_LLAMA_GPU_LAYERS'] = int(la.get('llama_gpu_layers', '-1'))
        except ValueError:
            pass
        try:
            d['LOCAL_AI_TEMPERATURE'] = float(la.get('temperature', '0.7'))
        except ValueError:
            pass
        try:
            d['LOCAL_AI_TOP_P'] = float(la.get('top_p', '0.95'))
        except ValueError:
            pass
        if (la.get('use_mcp_bridge') or '').strip():
            d['LOCAL_AI_USE_MCP_BRIDGE'] = la.get('use_mcp_bridge', 'true').strip().lower() in (
                '1',
                'true',
                'yes',
                'on',
            )
    return d


def _append_local_ai_to_settings_data(settings_data, ini_config=None):
    settings_data.update(local_ai_settings_dict_from_ini(ini_config))


def _write_local_ai_section_to_config(config, settings_data):
    """把 settings_data 中的 LOCAL_AI_* 写入 configparser 的 [local_ai]（路径尽量存相对项目根）。"""
    from .local_ai_paths import project_base_dir

    base = project_base_dir()

    def _rel(p):
        if not p:
            return ''
        try:
            rel = os.path.relpath(str(p), base)
            if not rel.startswith('..'):
                return rel.replace('\\', '/')
        except ValueError:
            pass
        return os.path.normpath(str(p)).replace('\\', '/')

    if not config.has_section('local_ai'):
        config.add_section('local_ai')
    la = config['local_ai']
    la['api_base_url'] = str(settings_data.get('LOCAL_AI_API_BASE_URL', '') or '')
    la['api_model'] = str(settings_data.get('LOCAL_AI_API_MODEL', '') or '')
    la['embed_api_base_url'] = str(
        settings_data.get('LOCAL_AI_EMBED_API_BASE_URL', settings_data.get('LOCAL_AI_API_BASE_URL', '')) or ''
    )
    la['embed_model'] = str(settings_data.get('LOCAL_AI_EMBED_MODEL', '') or '')
    la['embed_api_key'] = str(settings_data.get('LOCAL_AI_EMBED_API_KEY', 'lm-studio') or 'lm-studio')
    la['embed_query_instruction'] = str(
        settings_data.get(
            'LOCAL_AI_EMBED_QUERY_INSTRUCTION',
            'Represent this query for retrieving relevant passages from the local knowledge base.',
        )
        or ''
    )
    la['embed_batch_size'] = str(int(settings_data.get('LOCAL_AI_EMBED_BATCH_SIZE', 16) or 16))
    la['skills_dir'] = _rel(settings_data.get('LOCAL_AI_SKILLS_DIR', '') or '')
    la['knowledge_storage_dir'] = _rel(settings_data.get('LOCAL_AI_KB_STORAGE_DIR', '') or '')
    la['models_dir'] = _rel(settings_data.get('LOCAL_AI_MODELS_DIR', '') or '')
    la['hf_home'] = _rel(settings_data.get('LOCAL_AI_HF_HOME', '') or '')
    la['append_skills'] = str(bool(settings_data.get('LOCAL_AI_APPEND_SKILLS', True))).lower()
    la['device'] = str(settings_data.get('LOCAL_AI_DEVICE', 'auto') or 'auto')
    la['torch_dtype'] = str(settings_data.get('LOCAL_AI_TORCH_DTYPE', 'bfloat16') or 'bfloat16')
    la['max_new_tokens'] = str(int(settings_data.get('LOCAL_AI_MAX_NEW_TOKENS', 512) or 512))
    la['drawio_max_new_tokens'] = str(int(settings_data.get('LOCAL_AI_DRAWIO_MAX_NEW_TOKENS', 8192) or 8192))
    _dout_w = str(settings_data.get('LOCAL_AI_DRAWIO_OUTPUT', 'text_dsl') or 'text_dsl').strip().lower()
    if _dout_w not in ('text_dsl', 'xml'):
        _dout_w = 'text_dsl'
    la['drawio_output'] = _dout_w
    la['llama_ctx'] = str(int(settings_data.get('LOCAL_AI_LLAMA_CTX', 4096) or 4096))
    _pcap_w = settings_data.get('LOCAL_AI_PROMPT_CONTEXT_CAP', 4096)
    la['prompt_context_cap'] = str(int(4096 if _pcap_w is None else _pcap_w))
    la['llama_gpu_layers'] = str(int(settings_data.get('LOCAL_AI_LLAMA_GPU_LAYERS', -1) or -1))
    la['temperature'] = str(float(settings_data.get('LOCAL_AI_TEMPERATURE', 0.7) or 0.7))
    la['top_p'] = str(float(settings_data.get('LOCAL_AI_TOP_P', 0.95) or 0.95))
    la['use_mcp_bridge'] = str(bool(settings_data.get('LOCAL_AI_USE_MCP_BRIDGE', True))).lower()


def apply_local_ai_config(app, ini_config=None):
    """本地 AI 默认项 + 可选 [local_ai] 段覆盖。Skill 与模型默认目录为项目下 AI/skills、AI/models。"""
    d = local_ai_settings_dict_from_ini(ini_config)
    for k, v in d.items():
        app.config[k] = v


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
            max_upload_size_mb = normalize_max_upload_size_mb(
                settings.get('max_upload_size', DEFAULT_MAX_UPLOAD_SIZE_MB)
            )
            topdown_score_soft_cap = normalize_topdown_score_soft_cap(
                settings.get('topdown_score_soft_cap', DEFAULT_TOPDOWN_SCORE_SOFT_CAP)
            )
            remote_serial_enabled = settings.get('remote_serial_enabled', 'false').lower() == 'true'
            remote_serial_https_mode = normalize_remote_serial_https_mode(
                settings.get('remote_serial_https_mode', REMOTE_SERIAL_HTTPS_MODE_FULL)
            )
            serial_https_port = normalize_serial_https_port(
                settings.get('serial_https_port', default_serial_https_port(port)),
                main_port=port,
            )
            https_cert_file = settings.get('https_cert_file', '').strip()
            https_key_file = settings.get('https_key_file', '').strip()
            log_level_raw = (settings.get('log_level', 'INFO') or 'INFO').strip()
            app.config['LOG_LEVEL'] = (log_level_raw or 'INFO').upper()

            # 保存配置到app中（即使路径不存在也保留用户设置）
            app.config['ROOT_DIR'] = os.path.normpath(root_dir) if root_dir else app.config['DEFAULT_ROOT_DIR']
            app.config['DATA_DIR'] = resolve_path(settings.get('data_dir', 'data'), project_base_dir())
            app.config['LOG_DIR'] = resolve_path(settings.get('log_dir', 'logs'), project_base_dir())
            app.config['PASSWORD'] = password
            app.config['ADMIN_PASSWORD'] = admin_password
            app.config['CLOSE_TO_TRAY'] = close_to_tray
            app.config['PORT'] = port
            app.config['GIT_ENABLED'] = git_enabled
            app.config['GIT_WORKDIR'] = os.path.normpath(git_workdir) if git_workdir else ''
            app.config['GIT_EXTERNAL_APP_PATH'] = git_external_app_path if git_external_app_path else ''
            apply_upload_size_config(app, max_upload_size_mb)
            app.config['TOPDOWN_SCORE_SOFT_CAP'] = topdown_score_soft_cap
            app.config['REMOTE_SERIAL_ENABLED'] = remote_serial_enabled
            app.config['REMOTE_SERIAL_HTTPS_MODE'] = remote_serial_https_mode
            app.config['SERIAL_HTTPS_PORT'] = serial_https_port
            app.config['HTTPS_CERT_FILE'] = https_cert_file
            app.config['HTTPS_KEY_FILE'] = https_key_file
            apply_local_ai_config(app, config)
            apply_log_level_from_sources(ini_level=app.config['LOG_LEVEL'], app_debug=app.debug)

            # 检查路径是否有效（仅警告，不修改配置）
            if not os.path.isdir(app.config['ROOT_DIR']):
                app_logger.warning("[警告] 配置的根目录 '%s' 不存在或无效", app.config['ROOT_DIR'])
                app_logger.warning("  请通过设置界面修改根目录，或手动创建该目录")

            app_logger.info("[OK] 配置已加载: 根目录=%s, 密码长度=%s, 管理员密码已设置", app.config['ROOT_DIR'], len(password))
            app_logger.info("[配置] Git功能开关: %s (从配置文件读取: %s)", git_enabled, settings.get('git_enabled', 'false'))
            app_logger.info("[配置] Git工作目录: %s", app.config['GIT_WORKDIR'] if app.config['GIT_WORKDIR'] else '未设置')
            app_logger.info(
                "[配置] 远程串口: %s, HTTPS模式: %s, HTTPS端口: %s, HTTPS证书已配置: %s",
                remote_serial_enabled,
                remote_serial_https_mode,
                serial_https_port,
                bool(https_cert_file and https_key_file),
            )
        else:
            # 配置文件格式错误，使用默认值并保存
            app_logger.warning("[警告] 配置文件格式错误，使用默认配置")
            app.config['ROOT_DIR'] = app.config['DEFAULT_ROOT_DIR']
            app.config['DATA_DIR'] = get_data_dir(config_file=config_file, create=False)
            app.config['LOG_DIR'] = get_runtime_logs_dir(config_file=config_file, create=False)
            app.config['PASSWORD'] = 'password'
            app.config['ADMIN_PASSWORD'] = 'admin123'
            app.config['CLOSE_TO_TRAY'] = False
            app.config['PORT'] = 5000
            app.config['GIT_ENABLED'] = False
            app.config['GIT_WORKDIR'] = ''
            apply_upload_size_config(app)
            app.config['TOPDOWN_SCORE_SOFT_CAP'] = DEFAULT_TOPDOWN_SCORE_SOFT_CAP
            app.config['REMOTE_SERIAL_ENABLED'] = False
            app.config['REMOTE_SERIAL_HTTPS_MODE'] = REMOTE_SERIAL_HTTPS_MODE_FULL
            app.config['SERIAL_HTTPS_PORT'] = default_serial_https_port(app.config['PORT'])
            app.config['HTTPS_CERT_FILE'] = ''
            app.config['HTTPS_KEY_FILE'] = ''
            app.config['LOG_LEVEL'] = 'INFO'
            apply_local_ai_config(app, config)
            apply_log_level_from_sources(ini_level='INFO', app_debug=app.debug)
            save_config(app)
    else:
        # 配置文件不存在，创建默认配置
        app_logger.info("配置文件不存在，创建默认配置")
        app.config['ROOT_DIR'] = app.config['DEFAULT_ROOT_DIR']
        app.config['DATA_DIR'] = get_data_dir(config_file=config_file, create=False)
        app.config['LOG_DIR'] = get_runtime_logs_dir(config_file=config_file, create=False)
        app.config['PASSWORD'] = 'password'
        app.config['ADMIN_PASSWORD'] = 'admin123'
        app.config['CLOSE_TO_TRAY'] = False
        app.config['PORT'] = 5000
        app.config['GIT_ENABLED'] = False
        app.config['GIT_WORKDIR'] = ''
        apply_upload_size_config(app)
        app.config['TOPDOWN_SCORE_SOFT_CAP'] = DEFAULT_TOPDOWN_SCORE_SOFT_CAP
        app.config['REMOTE_SERIAL_ENABLED'] = False
        app.config['REMOTE_SERIAL_HTTPS_MODE'] = REMOTE_SERIAL_HTTPS_MODE_FULL
        app.config['SERIAL_HTTPS_PORT'] = default_serial_https_port(app.config['PORT'])
        app.config['HTTPS_CERT_FILE'] = ''
        app.config['HTTPS_KEY_FILE'] = ''
        app.config['LOG_LEVEL'] = 'INFO'
        apply_local_ai_config(app, None)
        apply_log_level_from_sources(ini_level='INFO', app_debug=app.debug)
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
        'DATA_DIR': get_data_dir(config_file=config_file, create=False),
        'LOG_DIR': get_runtime_logs_dir(config_file=config_file, create=False),
        'PASSWORD': 'password',
        'ADMIN_PASSWORD': 'admin123',
        'CLOSE_TO_TRAY': False,
        'PORT': 5000,
        'GIT_ENABLED': False,
        'GIT_WORKDIR': '',
        'GIT_EXTERNAL_APP_PATH': '',
        'MAX_UPLOAD_SIZE_MB': DEFAULT_MAX_UPLOAD_SIZE_MB,
        'TOPDOWN_SCORE_SOFT_CAP': DEFAULT_TOPDOWN_SCORE_SOFT_CAP,
        'REMOTE_SERIAL_ENABLED': False,
        'REMOTE_SERIAL_HTTPS_MODE': REMOTE_SERIAL_HTTPS_MODE_FULL,
        'SERIAL_HTTPS_PORT': default_serial_https_port(5000),
        'HTTPS_CERT_FILE': '',
        'HTTPS_KEY_FILE': '',
        'LOG_LEVEL': 'INFO',
    }

    config_read_from_disk = False
    if os.path.exists(config_file):
        config.read(config_file, encoding='utf-8')
        config_read_from_disk = True
        if 'settings' in config:
            settings = config['settings']
            root_dir = settings.get('root_dir', default_root_dir)
            settings_data['ROOT_DIR'] = os.path.normpath(root_dir) if root_dir else default_root_dir
            settings_data['DATA_DIR'] = resolve_path(
                settings.get('data_dir', settings_data['DATA_DIR']),
                project_base_dir(),
            )
            settings_data['LOG_DIR'] = resolve_path(
                settings.get('log_dir', settings_data['LOG_DIR']),
                project_base_dir(),
            )
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
            settings_data['MAX_UPLOAD_SIZE_MB'] = normalize_max_upload_size_mb(
                settings.get('max_upload_size', DEFAULT_MAX_UPLOAD_SIZE_MB)
            )
            settings_data['TOPDOWN_SCORE_SOFT_CAP'] = normalize_topdown_score_soft_cap(
                settings.get('topdown_score_soft_cap', DEFAULT_TOPDOWN_SCORE_SOFT_CAP)
            )
            settings_data['REMOTE_SERIAL_ENABLED'] = settings.get('remote_serial_enabled', 'false').lower() == 'true'
            settings_data['REMOTE_SERIAL_HTTPS_MODE'] = normalize_remote_serial_https_mode(
                settings.get('remote_serial_https_mode', REMOTE_SERIAL_HTTPS_MODE_FULL)
            )
            settings_data['SERIAL_HTTPS_PORT'] = normalize_serial_https_port(
                settings.get('serial_https_port', default_serial_https_port(settings_data['PORT'])),
                main_port=settings_data['PORT'],
            )
            settings_data['HTTPS_CERT_FILE'] = settings.get('https_cert_file', '').strip()
            settings_data['HTTPS_KEY_FILE'] = settings.get('https_key_file', '').strip()
            settings_data['LOG_LEVEL'] = (
                (settings.get('log_level', 'INFO') or 'INFO').strip() or 'INFO'
            ).upper()
            _append_local_ai_to_settings_data(settings_data, config)
            return settings_data
        app_logger.warning("[警告] 配置文件缺少 [settings] 段，使用默认配置")
    elif not create_if_missing:
        _append_local_ai_to_settings_data(settings_data, None)
        return settings_data
    else:
        app_logger.info("配置文件不存在，创建默认配置")

    if config_read_from_disk:
        _append_local_ai_to_settings_data(settings_data, config)
    else:
        _append_local_ai_to_settings_data(settings_data, None)

    if create_if_missing:
        save_runtime_settings(settings_data, config_file=config_file)
    return settings_data


def save_runtime_settings(settings_data, config_file=None):
    """保存轻量配置字典到配置文件"""
    config_file = config_file or settings_data.get('CONFIG_FILE', get_config_path())
    existing_remote_serial_enabled = False
    existing_remote_serial_https_mode = REMOTE_SERIAL_HTTPS_MODE_FULL
    existing_serial_https_port = default_serial_https_port(settings_data.get('PORT', 5000))
    existing_https_cert_file = ''
    existing_https_key_file = ''
    existing_log_level = 'INFO'
    existing_max_upload_size_mb = DEFAULT_MAX_UPLOAD_SIZE_MB
    existing_topdown_score_soft_cap = DEFAULT_TOPDOWN_SCORE_SOFT_CAP
    existing_data_dir = get_data_dir(config_file=config_file, create=False)
    existing_log_dir = get_runtime_logs_dir(config_file=config_file, create=False)
    if os.path.exists(config_file):
        existing_config = configparser.ConfigParser()
        existing_config.read(config_file, encoding='utf-8')
        if 'settings' in existing_config:
            existing_settings = existing_config['settings']
            existing_log_level = (existing_settings.get('log_level', 'INFO') or 'INFO').strip() or 'INFO'
            existing_max_upload_size_mb = normalize_max_upload_size_mb(
                existing_settings.get('max_upload_size', DEFAULT_MAX_UPLOAD_SIZE_MB)
            )
            existing_topdown_score_soft_cap = normalize_topdown_score_soft_cap(
                existing_settings.get('topdown_score_soft_cap', DEFAULT_TOPDOWN_SCORE_SOFT_CAP)
            )
            existing_remote_serial_enabled = existing_settings.get('remote_serial_enabled', 'false').lower() == 'true'
            existing_remote_serial_https_mode = normalize_remote_serial_https_mode(
                existing_settings.get('remote_serial_https_mode', REMOTE_SERIAL_HTTPS_MODE_FULL)
            )
            existing_serial_https_port = normalize_serial_https_port(
                existing_settings.get('serial_https_port', default_serial_https_port(settings_data.get('PORT', 5000))),
                main_port=settings_data.get('PORT', 5000),
            )
            existing_https_cert_file = existing_settings.get('https_cert_file', '').strip()
            existing_https_key_file = existing_settings.get('https_key_file', '').strip()
            existing_data_dir = resolve_path(existing_settings.get('data_dir', existing_data_dir), project_base_dir())
            existing_log_dir = resolve_path(existing_settings.get('log_dir', existing_log_dir), project_base_dir())

    remote_serial_enabled_value = settings_data.get('REMOTE_SERIAL_ENABLED', existing_remote_serial_enabled)
    if isinstance(remote_serial_enabled_value, str):
        remote_serial_enabled = remote_serial_enabled_value.strip().lower() == 'true'
    else:
        remote_serial_enabled = bool(remote_serial_enabled_value)

    remote_serial_https_mode = normalize_remote_serial_https_mode(
        settings_data.get('REMOTE_SERIAL_HTTPS_MODE', existing_remote_serial_https_mode)
    )
    main_port = settings_data.get('PORT', 5000)
    serial_https_port = normalize_serial_https_port(
        settings_data.get('SERIAL_HTTPS_PORT', existing_serial_https_port),
        main_port=main_port,
    )
    https_cert_file = (settings_data.get('HTTPS_CERT_FILE', existing_https_cert_file) or '').strip()
    https_key_file = (settings_data.get('HTTPS_KEY_FILE', existing_https_key_file) or '').strip()
    data_dir = resolve_path(settings_data.get('DATA_DIR', existing_data_dir), project_base_dir())
    log_dir = resolve_path(settings_data.get('LOG_DIR', existing_log_dir), project_base_dir())
    max_upload_size_mb = normalize_max_upload_size_mb(
        settings_data.get('MAX_UPLOAD_SIZE_MB', existing_max_upload_size_mb)
    )
    topdown_score_soft_cap = normalize_topdown_score_soft_cap(
        settings_data.get('TOPDOWN_SCORE_SOFT_CAP', existing_topdown_score_soft_cap)
    )

    config = configparser.ConfigParser()
    if os.path.exists(config_file):
        config.read(config_file, encoding='utf-8')
    config['settings'] = {
        'root_dir': settings_data.get('ROOT_DIR', os.path.expanduser("~")),
        'data_dir': data_dir,
        'log_dir': log_dir,
        'password': settings_data.get('PASSWORD', 'password'),
        'admin_password': settings_data.get('ADMIN_PASSWORD', 'admin123'),
        'close_to_tray': str(settings_data.get('CLOSE_TO_TRAY', False)).lower(),
        'port': str(settings_data.get('PORT', 5000)),
        'git_enabled': str(settings_data.get('GIT_ENABLED', False)).lower(),
        'git_workdir': settings_data.get('GIT_WORKDIR', ''),
        'git_external_app_path': settings_data.get('GIT_EXTERNAL_APP_PATH', ''),
        'max_upload_size': str(max_upload_size_mb),
        'topdown_score_soft_cap': str(topdown_score_soft_cap),
        'remote_serial_enabled': str(remote_serial_enabled).lower(),
        'remote_serial_https_mode': remote_serial_https_mode,
        'serial_https_port': str(serial_https_port),
        'https_cert_file': https_cert_file,
        'https_key_file': https_key_file,
        'log_level': (settings_data.get('LOG_LEVEL') or existing_log_level or 'INFO').strip().lower(),
    }
    if any(k in settings_data for k in LOCAL_AI_CONFIG_KEYS):
        _write_local_ai_section_to_config(config, settings_data)
    with open(config_file, 'w', encoding='utf-8') as f:
        config.write(f)


def save_config(app):
    """保存当前配置到文件"""
    la_defaults = local_ai_settings_dict_from_ini(None)
    settings_data = {
        'CONFIG_FILE': app.config['CONFIG_FILE'],
        'ROOT_DIR': app.config['ROOT_DIR'],
        'DATA_DIR': app.config.get('DATA_DIR', get_data_dir(config_file=app.config['CONFIG_FILE'], create=False)),
        'LOG_DIR': app.config.get('LOG_DIR', get_runtime_logs_dir(config_file=app.config['CONFIG_FILE'], create=False)),
        'PASSWORD': app.config['PASSWORD'],
        'ADMIN_PASSWORD': app.config.get('ADMIN_PASSWORD', 'admin123'),
        'CLOSE_TO_TRAY': app.config.get('CLOSE_TO_TRAY', False),
        'PORT': app.config.get('PORT', 5000),
        'GIT_ENABLED': app.config.get('GIT_ENABLED', False),
        'GIT_WORKDIR': app.config.get('GIT_WORKDIR', ''),
        'GIT_EXTERNAL_APP_PATH': app.config.get('GIT_EXTERNAL_APP_PATH', ''),
        'MAX_UPLOAD_SIZE_MB': app.config.get('MAX_UPLOAD_SIZE_MB', DEFAULT_MAX_UPLOAD_SIZE_MB),
        'TOPDOWN_SCORE_SOFT_CAP': app.config.get('TOPDOWN_SCORE_SOFT_CAP', DEFAULT_TOPDOWN_SCORE_SOFT_CAP),
        'REMOTE_SERIAL_ENABLED': app.config.get('REMOTE_SERIAL_ENABLED', False),
        'REMOTE_SERIAL_HTTPS_MODE': app.config.get('REMOTE_SERIAL_HTTPS_MODE', REMOTE_SERIAL_HTTPS_MODE_FULL),
        'SERIAL_HTTPS_PORT': app.config.get('SERIAL_HTTPS_PORT', default_serial_https_port(app.config.get('PORT', 5000))),
        'HTTPS_CERT_FILE': app.config.get('HTTPS_CERT_FILE', ''),
        'HTTPS_KEY_FILE': app.config.get('HTTPS_KEY_FILE', ''),
        'LOG_LEVEL': app.config.get('LOG_LEVEL', 'INFO'),
    }
    for k in LOCAL_AI_CONFIG_KEYS:
        settings_data[k] = app.config.get(k, la_defaults.get(k))
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
            from .git_config_manager import GitConfigManager
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
            QLineEdit, QComboBox, QTextEdit {
                padding: 8px 12px;
                border: 2px solid #e0e0e0;
                border-radius: 6px;
                background: white;
                font-size: 10pt;
                color: #2c3e50;
            }
            QLineEdit:focus, QComboBox:focus, QTextEdit:focus {
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
        self.ssh_key_edit.setPlaceholderText("原有方式可继续直接选择已有私钥文件，或点击右侧生成兼容密钥...")
        ssh_key_layout.addWidget(self.ssh_key_edit, 1)

        ssh_browse_button = QPushButton("📁 浏览")
        ssh_browse_button.setObjectName("browseButton")
        ssh_browse_button.clicked.connect(self.browse_ssh_key)
        ssh_key_layout.addWidget(ssh_browse_button)

        ssh_generate_button = QPushButton("🔐 生成")
        ssh_generate_button.setObjectName("browseButton")
        ssh_generate_button.setToolTip("自动生成一对兼容性更高的 RSA SSH 密钥，并填入私钥路径")
        ssh_generate_button.clicked.connect(self.generate_ssh_key)
        ssh_key_layout.addWidget(ssh_generate_button)

        ssh_help_button = QPushButton("❓ 说明")
        ssh_help_button.setObjectName("browseButton")
        ssh_help_button.setToolTip("查看SSH私钥、公钥和Git服务器配置说明")
        ssh_help_button.clicked.connect(self.show_ssh_key_help)
        ssh_key_layout.addWidget(ssh_help_button)

        form_layout.addRow(self.ssh_key_label, self.ssh_key_widget)

        self.ssh_key_hint_label = QLabel(
            "兼容原有方式：你仍然可以点击“浏览”直接选择已有私钥文件。"
            "如果点“生成”，程序会自动创建一对兼容性更高的 RSA 密钥，自动填入私钥路径，并把同名 .pub 公钥复制到剪贴板。"
            "接着把公钥粘贴到 Git 服务器的 SSH Keys 页面，再点“测试配置”。"
        )
        self.ssh_key_hint_label.setWordWrap(True)
        self.ssh_key_hint_label.setStyleSheet("""
            color: #5f6c7b;
            font-size: 10pt;
            font-weight: normal;
            padding: 0 0 4px 0;
        """)
        form_layout.addRow("", self.ssh_key_hint_label)

        self.ssh_public_key_label = QLabel("公钥内容：")
        self.ssh_public_key_widget = QWidget()
        ssh_public_key_layout = QVBoxLayout(self.ssh_public_key_widget)
        ssh_public_key_layout.setContentsMargins(0, 0, 0, 0)
        ssh_public_key_layout.setSpacing(8)

        self.ssh_public_key_text = QTextEdit()
        self.ssh_public_key_text.setReadOnly(True)
        self.ssh_public_key_text.setAcceptRichText(False)
        self.ssh_public_key_text.setPlaceholderText("生成密钥后，或选择已有私钥后，这里会显示可直接复制的公钥内容。")
        self.ssh_public_key_text.setMinimumHeight(96)
        ssh_public_key_layout.addWidget(self.ssh_public_key_text)

        ssh_public_key_actions = QHBoxLayout()
        ssh_public_key_actions.setContentsMargins(0, 0, 0, 0)
        ssh_public_key_actions.setSpacing(10)

        self.ssh_public_key_status = QLabel("当前还没有可复制的公钥内容。")
        self.ssh_public_key_status.setStyleSheet("""
            color: #5f6c7b;
            font-size: 10pt;
            font-weight: normal;
        """)
        ssh_public_key_actions.addWidget(self.ssh_public_key_status, 1)

        self.copy_public_key_button = QPushButton("📋 复制公钥")
        self.copy_public_key_button.setObjectName("browseButton")
        self.copy_public_key_button.setToolTip("复制当前显示的公钥内容")
        self.copy_public_key_button.clicked.connect(self.copy_public_key)
        self.copy_public_key_button.setEnabled(False)
        ssh_public_key_actions.addWidget(self.copy_public_key_button)

        self.export_public_key_button = QPushButton("📄 生成TXT")
        self.export_public_key_button.setObjectName("browseButton")
        self.export_public_key_button.setToolTip("将当前公钥内容生成 TXT 文件，并用系统默认程序打开")
        self.export_public_key_button.clicked.connect(self.export_public_key_to_txt)
        self.export_public_key_button.setEnabled(False)
        ssh_public_key_actions.addWidget(self.export_public_key_button)

        ssh_public_key_layout.addLayout(ssh_public_key_actions)
        form_layout.addRow(self.ssh_public_key_label, self.ssh_public_key_widget)

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

        # 测试按钮（新增配置和编辑配置都可直接测试）
        self.test_button = QPushButton("🧪 测试配置")
        self.test_button.setObjectName("editButton")
        self.test_button.setVisible(True)
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
        self.ssh_key_hint_label.setVisible(ssh_visible)
        self.ssh_public_key_label.setVisible(ssh_visible)
        self.ssh_public_key_widget.setVisible(ssh_visible)

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

        if ssh_visible:
            self.refresh_public_key_display()
        else:
            self.set_public_key_display('', "当前不是 SSH 认证方式。")

        # 监听服务器地址变化，动态显示转换按钮
        if not hasattr(self, '_server_edit_connected'):
            self.server_edit.textChanged.connect(self.on_server_url_changed)
            self._server_edit_connected = True

        if not hasattr(self, '_ssh_key_edit_connected'):
            self.ssh_key_edit.textChanged.connect(self.on_ssh_key_path_changed)
            self._ssh_key_edit_connected = True

    def on_server_url_changed(self):
        """服务器地址改变时的处理"""
        if self.auth_type_combo.currentText().lower() == 'ssh':
            server_url = self.server_edit.text().strip()
            is_http_url = server_url.startswith(('http://', 'https://'))
            self.convert_to_ssh_button.setVisible(is_http_url)

    def on_ssh_key_path_changed(self):
        """SSH密钥路径改变时，尝试同步显示公钥内容"""
        if self.auth_type_combo.currentText().lower() != 'ssh':
            self.set_public_key_display('', '当前不是 SSH 认证方式。')
            return
        self.refresh_public_key_display()

    def set_public_key_display(self, public_key_text: str, status_text: str = ''):
        """设置公钥显示区域内容"""
        public_key_text = (public_key_text or '').strip()
        self.ssh_public_key_text.setPlainText(public_key_text)
        has_text = bool(public_key_text)
        self.copy_public_key_button.setEnabled(has_text)
        self.export_public_key_button.setEnabled(has_text)
        if has_text:
            self.ssh_public_key_status.setText(status_text or "公钥内容已就绪，可以直接复制并粘贴到 Git 服务器。")
        else:
            self.ssh_public_key_status.setText(status_text or "当前还没有可复制的公钥内容。")

    def load_public_key_text(self, ssh_key_path: str) -> str:
        """根据SSH密钥路径读取或推导公钥内容"""
        ssh_key_path = (ssh_key_path or '').strip()
        if not ssh_key_path:
            return ''

        candidate_paths = []
        if ssh_key_path.endswith('.pub'):
            candidate_paths.append(ssh_key_path)
        else:
            candidate_paths.append(f"{ssh_key_path}.pub")

        for candidate in candidate_paths:
            if os.path.exists(candidate):
                try:
                    with open(candidate, 'r', encoding='utf-8') as f:
                        return f.read().strip()
                except Exception:
                    pass

        if not os.path.exists(ssh_key_path) or ssh_key_path.endswith('.pub'):
            return ''

        ssh_keygen = shutil.which('ssh-keygen')
        if ssh_keygen:
            run_kwargs = {
                'capture_output': True,
                'text': True,
                'check': True
            }
            if sys.platform.startswith('win'):
                run_kwargs['creationflags'] = subprocess.CREATE_NO_WINDOW
            try:
                result = subprocess.run([ssh_keygen, '-y', '-f', ssh_key_path], **run_kwargs)
                return (result.stdout or '').strip()
            except Exception:
                pass

        try:
            from cryptography.hazmat.primitives import serialization
            with open(ssh_key_path, 'rb') as f:
                private_key_data = f.read()
            private_key = None
            loaders = [
                serialization.load_ssh_private_key,
                serialization.load_pem_private_key
            ]
            for loader in loaders:
                try:
                    private_key = loader(private_key_data, password=None)
                    break
                except TypeError:
                    try:
                        private_key = loader(private_key_data, None)
                        break
                    except Exception:
                        pass
                except Exception:
                    pass
            if private_key is not None:
                return private_key.public_key().public_bytes(
                    encoding=serialization.Encoding.OpenSSH,
                    format=serialization.PublicFormat.OpenSSH
                ).decode('utf-8').strip()
        except Exception:
            pass

        return ''

    def refresh_public_key_display(self, public_key_text: str = ''):
        """刷新公钥显示区域"""
        ssh_key_path = self.ssh_key_edit.text().strip()
        text = (public_key_text or '').strip()
        if text:
            self.set_public_key_display(text, "公钥内容已显示在下方，可直接复制。")
            return

        if not ssh_key_path:
            self.set_public_key_display('', "请先选择已有私钥文件，或点击“生成”创建新密钥。")
            return

        text = self.load_public_key_text(ssh_key_path)
        if text:
            self.set_public_key_display(text, "已读取到公钥内容，可直接复制。")
        else:
            self.set_public_key_display('', "未找到对应公钥内容。若刚生成密钥，请确认生成成功；若是已有私钥，请确认同目录下存在 .pub 文件。")

    def copy_public_key(self):
        """复制当前显示的公钥内容"""
        public_key_text = self.ssh_public_key_text.toPlainText().strip()
        if not public_key_text:
            QMessageBox.information(self, "提示", "当前没有可复制的公钥内容。")
            return
        QApplication.clipboard().setText(public_key_text)
        self.ssh_public_key_status.setText("公钥内容已复制到剪贴板，可以直接粘贴到 Git 服务器。")

    def export_public_key_to_txt(self):
        """将当前公钥内容导出为TXT文件并打开"""
        public_key_text = self.ssh_public_key_text.toPlainText().strip()
        if not public_key_text:
            QMessageBox.information(self, "提示", "当前没有可导出的公钥内容。")
            return

        ssh_key_path = self.ssh_key_edit.text().strip()
        if ssh_key_path:
            base_dir = os.path.dirname(ssh_key_path)
            if not base_dir:
                base_dir = os.path.expanduser("~")
            base_name = os.path.basename(ssh_key_path)
            if base_name.endswith('.pub'):
                base_name = base_name[:-4]
        else:
            desktop_dir = os.path.join(os.path.expanduser("~"), "Desktop")
            base_dir = desktop_dir if os.path.isdir(desktop_dir) else os.path.expanduser("~")
            base_name = self.name_edit.text().strip() or f"ssh_public_key_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
            safe_chars = []
            for char in base_name:
                safe_chars.append(char if char.isalnum() or char in ('-', '_', '.') else '_')
            base_name = ''.join(safe_chars).strip('._') or f"ssh_public_key_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        txt_path = os.path.join(base_dir, f"{base_name}_public_key.txt")

        try:
            os.makedirs(base_dir, exist_ok=True)
            with open(txt_path, 'w', encoding='utf-8') as f:
                f.write(public_key_text + '\n')

            opened = QDesktopServices.openUrl(QUrl.fromLocalFile(txt_path))
            status_text = f"公钥 TXT 已生成：{txt_path}"
            if opened:
                status_text += "，已尝试用系统默认程序打开。"
            else:
                status_text += "。"
            self.ssh_public_key_status.setText(status_text)

            QMessageBox.information(
                self,
                "TXT 已生成",
                f"公钥 TXT 已生成：\n{txt_path}\n\n"
                "文件中只有公钥内容本身，方便你用其他被授权的进程打开并复制。"
            )
        except Exception as e:
            QMessageBox.warning(self, "生成失败", f"生成公钥 TXT 失败：{e}")

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

    def generate_ssh_key(self):
        """生成新的SSH密钥对并自动填充私钥路径"""
        try:
            from .git_config_manager import GitConfigManager

            config_name = self.name_edit.text().strip() or "git_key"
            git_email = self.git_email_edit.text().strip()
            git_name = self.git_name_edit.text().strip()
            comment = git_email or git_name or f"yobboy-file-server-{datetime.now().strftime('%Y%m%d')}"

            config_manager = GitConfigManager()
            result = config_manager.generate_ssh_key_pair(
                key_name=config_name,
                comment=comment
            )

            if not result.get('success'):
                QMessageBox.warning(self, "生成失败", result.get('error', '生成SSH密钥失败'))
                return

            self.auth_type_combo.setCurrentIndex(0)
            self.ssh_key_edit.setText(result['private_key_path'])
            self.refresh_public_key_display(result['public_key'])
            QApplication.clipboard().setText(result['public_key'])

            QMessageBox.information(
                self,
                "SSH密钥已生成",
                "已为当前配置生成新的 RSA SSH 密钥，并自动兼容原来的私钥路径使用方式。\n\n"
                f"私钥文件：\n{result['private_key_path']}\n\n"
                f"公钥文件：\n{result['public_key_path']}\n\n"
                "下一步请按这个顺序操作：\n"
                "1. 现在不用手动改私钥路径，程序已经自动填好了。\n"
                "2. 系统已经把公钥内容复制到剪贴板。\n"
                "3. 打开 GitLab / GitHub / Gitea / 自建 Git 服务的 SSH Keys 页面。\n"
                "4. 把剪贴板里的公钥粘贴进去并保存。\n"
                "5. 下方“公钥内容”区域也会直接显示这段内容，你也可以在那里手动复制。\n"
                "6. 如果当前进程不允许复制，也可以点击“生成TXT”，用其他进程打开 TXT 后复制。\n"
                "7. 回到这里，点击“测试配置”。\n\n"
                "如果你已经有自己的私钥，也可以继续使用原来的“浏览”方式，不受影响。"
            )
        except Exception as e:
            QMessageBox.warning(self, "生成失败", f"生成SSH密钥时出错：{e}")

    def show_ssh_key_help(self):
        """显示SSH密钥获取与使用说明"""
        help_text = """
<h3>🔐 SSH私钥要怎么获取？</h3>

<p>这个界面现在同时兼容两种方式，你可以任选一种：</p>
<ol>
  <li><b>沿用原来的方式：</b> 点击“浏览”，选择你本机已经存在的私钥文件。</li>
  <li><b>直接在本程序里点击“生成”</b>，程序会自动创建一对新的 RSA SSH 密钥，并把私钥路径填回当前配置。</li>
</ol>

<h4>推荐的最简单流程</h4>
<ol>
  <li>填好服务器地址</li>
  <li>如果你已有私钥：点击“浏览”选择；如果没有：点击“生成”</li>
  <li>如果使用了“生成”，程序会自动把公钥复制到剪贴板，并在下方“公钥内容”区域显示出来</li>
  <li>打开 Git 服务器的 SSH Keys 页面，直接粘贴公钥，或点击“复制公钥”后再粘贴</li>
  <li>回到当前窗口，点击“测试配置”</li>
  <li>测试通过后再点击“保存”</li>
</ol>

<h4>什么是私钥，什么是公钥？</h4>
<ul>
  <li><b>私钥：</b> 本机认证时使用的文件，没有 <code>.pub</code> 后缀，比如 <code>id_ed25519</code>。</li>
  <li><b>公钥：</b> 同名的 <code>.pub</code> 文件，比如 <code>id_ed25519.pub</code>，需要添加到 Git 服务器。</li>
  <li><b>注意：</b> Git 认证时这里填写的是私钥路径，不是 <code>.pub</code> 公钥文件。</li>
</ul>

<h4>如果你想手动查找已有私钥</h4>
<p>常见路径示例：</p>
<ul>
  <li>Windows: <code>C:\\Users\\你的用户名\\.ssh\\id_ed25519</code></li>
  <li>Windows: <code>C:\\Users\\你的用户名\\.ssh\\id_rsa</code></li>
  <li>Linux / macOS: <code>~/.ssh/id_ed25519</code></li>
  <li>Linux / macOS: <code>~/.ssh/id_rsa</code></li>
</ul>

<p>如果你只看到 <code>.pub</code> 文件，没有同名私钥文件，就不能直接完成 SSH 认证，需要重新生成一对密钥。</p>
"""

        msg_box = QMessageBox(self)
        msg_box.setWindowTitle("SSH密钥说明")
        msg_box.setTextFormat(Qt.RichText)
        msg_box.setText(help_text)
        msg_box.setStandardButtons(QMessageBox.Ok)
        msg_box.exec_()

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
                reply = QMessageBox.warning(
                    self,
                    "警告",
                    f"SSH密钥文件不存在: {ssh_key_path}\n是否继续？",
                    QMessageBox.Yes | QMessageBox.No
                )
                if reply == QMessageBox.No:
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

        # 显示测试进度
        from PyQt5.QtWidgets import QProgressDialog
        progress = QProgressDialog("正在测试配置...", "取消", 0, 0, self)
        progress.setWindowModality(Qt.WindowModal)
        progress.setCancelButton(None)  # 不允许取消
        progress.show()
        QApplication.processEvents()

        try:
            from .git_manager import GitManager

            # 测试配置
            git_manager = GitManager()
            result = git_manager.test_config(config)

            if result.get('success'):
                message = result.get('message', '配置测试成功')
                if not self.config or not self.config.get('id'):
                    message += "\n\n当前是未保存状态，确认可用后再点击“保存”即可。"
                QMessageBox.information(self, "测试成功", message)
            else:
                QMessageBox.warning(self, "测试失败", result.get('error', '配置测试失败'))
        except ImportError as e:
            QMessageBox.critical(self, "错误", f"无法加载Git模块: {e}\n请确保已安装GitPython")
        except Exception as e:
            QMessageBox.critical(self, "错误", f"测试配置时发生错误: {str(e)}")
        finally:
            progress.close()


class SettingsDialog(QDialog):
    """设置对话框，用于配置根目录和密码"""
    def __init__(
        self,
        parent=None,
        current_root='',
        current_data_dir='',
        current_log_dir='',
        current_password='',
        current_admin_password='',
        current_close_to_tray=False,
        current_port=5000,
        current_git_enabled=False,
        current_git_workdir='',
        current_git_external_app_path='',
        current_remote_serial_enabled=False,
        current_remote_serial_https_mode=REMOTE_SERIAL_HTTPS_MODE_FULL,
        current_serial_https_port=DEFAULT_SERIAL_HTTPS_PORT,
        current_https_cert_file='',
        current_https_key_file='',
        local_ai_settings=None,
    ):
        super().__init__(parent)
        self.setWindowTitle("服务器设置")
        self.setMinimumSize(620, 420)
        self.resize(760, 680)
        self.current_root = current_root
        self.current_data_dir = current_data_dir
        self.current_log_dir = current_log_dir
        self.current_password = current_password
        self.current_admin_password = current_admin_password
        self.current_close_to_tray = current_close_to_tray
        self.current_port = current_port
        self.current_git_enabled = current_git_enabled
        self.current_git_workdir = current_git_workdir
        self.current_git_external_app_path = current_git_external_app_path
        self.current_remote_serial_enabled = current_remote_serial_enabled
        self.current_remote_serial_https_mode = normalize_remote_serial_https_mode(current_remote_serial_https_mode)
        self.current_serial_https_port = normalize_serial_https_port(
            current_serial_https_port,
            main_port=current_port,
        )
        self.current_https_cert_file = current_https_cert_file
        self.current_https_key_file = current_https_key_file
        self.new_root = current_root
        self.new_data_dir = current_data_dir
        self.new_log_dir = current_log_dir
        self.new_password = current_password
        self.new_admin_password = current_admin_password
        self.new_close_to_tray = current_close_to_tray
        self.new_port = current_port
        self.new_git_enabled = current_git_enabled
        self.new_git_workdir = current_git_workdir
        self.new_git_external_app_path = current_git_external_app_path
        self.new_remote_serial_enabled = current_remote_serial_enabled
        self.new_remote_serial_https_mode = self.current_remote_serial_https_mode
        self.new_serial_https_port = self.current_serial_https_port
        self.new_https_cert_file = current_https_cert_file
        self.new_https_key_file = current_https_key_file
        self._local_ai_saved = local_ai_settings_dict_from_ini(None)
        if local_ai_settings:
            for _k, _v in local_ai_settings.items():
                if _k in LOCAL_AI_CONFIG_KEYS and _v is not None:
                    self._local_ai_saved[_k] = _v

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

    def init_ui(self):
        """初始化UI"""
        main_layout = QVBoxLayout()
        main_layout.setSpacing(12)
        main_layout.setContentsMargins(18, 18, 18, 18)

        scroll_area = QScrollArea()
        scroll_area.setWidgetResizable(True)
        scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        scroll_area.setStyleSheet("QScrollArea { border: none; background: transparent; }")

        content_widget = QWidget()
        layout = QVBoxLayout(content_widget)
        layout.setSpacing(15)
        layout.setContentsMargins(7, 7, 7, 7)

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

        # Tab布局（避免单页过长）
        tab_widget = QTabWidget()
        basic_tab = QWidget()
        advanced_tab = QWidget()
        tab_widget.addTab(basic_tab, "基础")
        tab_widget.addTab(advanced_tab, "高级")
        ai_tab = QWidget()
        tab_widget.addTab(ai_tab, "本地 AI")

        basic_layout = QVBoxLayout(basic_tab)
        basic_layout.setContentsMargins(0, 8, 0, 0)
        advanced_layout = QVBoxLayout(advanced_tab)
        advanced_layout.setContentsMargins(0, 8, 0, 0)
        ai_layout = QVBoxLayout(ai_tab)
        ai_layout.setContentsMargins(0, 8, 0, 0)

        basic_form_layout = QFormLayout()
        basic_form_layout.setSpacing(15)
        basic_form_layout.setContentsMargins(0, 10, 0, 10)
        advanced_form_layout = QFormLayout()
        advanced_form_layout.setSpacing(15)
        advanced_form_layout.setContentsMargins(0, 10, 0, 10)
        ai_form_layout = QFormLayout()
        ai_form_layout.setSpacing(12)
        ai_form_layout.setContentsMargins(0, 10, 0, 10)

        basic_layout.addLayout(basic_form_layout)
        advanced_layout.addLayout(advanced_form_layout)
        ai_layout.addLayout(ai_form_layout)

        # 默认先写入基础页
        form_layout = basic_form_layout

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

        data_dir_label = QLabel("数据目录：")
        data_dir_widget = QWidget()
        data_dir_layout = QHBoxLayout(data_dir_widget)
        data_dir_layout.setContentsMargins(0, 0, 0, 0)
        data_dir_layout.setSpacing(10)

        self.data_dir_edit = QLineEdit(self.current_data_dir)
        self.data_dir_edit.setReadOnly(True)
        data_dir_layout.addWidget(self.data_dir_edit, 1)

        data_dir_browse_button = QPushButton("📁 浏览")
        data_dir_browse_button.setObjectName("browseButton")
        data_dir_browse_button.clicked.connect(self.browse_data_directory)
        data_dir_layout.addWidget(data_dir_browse_button)

        form_layout.addRow(data_dir_label, data_dir_widget)

        data_dir_hint = QLabel("数据目录用于保存工作区数据，如待办、收藏、ERP、本地知识库等。")
        data_dir_hint.setStyleSheet("""
            font-size: 9pt;
            color: #3498db;
            font-weight: normal;
            padding: 5px;
            background: #e3f2fd;
            border-radius: 4px;
        """)
        form_layout.addRow("", data_dir_hint)
        # 登录密码设置
        password_label = QLabel("登录密码（固定 6 位）：")
        self.password_edit = QLineEdit(self.current_password)
        self.password_edit.setEchoMode(QLineEdit.Password)
        self.password_edit.setMaxLength(6)
        self.password_edit.setPlaceholderText("输入 6 位登录密码...")
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

        # 以下写入高级页
        form_layout = advanced_form_layout

        # 远程串口设置
        remote_serial_label = QLabel("远程串口：")
        self.remote_serial_enabled_checkbox = QCheckBox("启用远程串口（支持全站 HTTPS 或兼容模式）")
        self.remote_serial_enabled_checkbox.setChecked(self.current_remote_serial_enabled)
        self.remote_serial_enabled_checkbox.setStyleSheet("""
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
        form_layout.addRow(remote_serial_label, self.remote_serial_enabled_checkbox)

        self.remote_serial_hint = QLabel(
            "☁️ 启用后将开放远程串口 WebSocket。\n"
            "可继续使用原有全站 HTTPS，也可切换为主站 HTTP + 串口 HTTPS 的兼容模式。"
        )
        self.remote_serial_hint.setStyleSheet("""
            font-size: 9pt;
            color: #3498db;
            font-weight: normal;
            padding: 5px;
            background: #e3f2fd;
            border-radius: 4px;
        """)
        form_layout.addRow("", self.remote_serial_hint)

        self.remote_serial_mode_label = QLabel("串口 HTTPS 模式：")
        self.remote_serial_mode_combo = QComboBox()
        self.remote_serial_mode_combo.addItem("全站 HTTPS（原有方式）", REMOTE_SERIAL_HTTPS_MODE_FULL)
        self.remote_serial_mode_combo.addItem(
            "兼容模式：主站 HTTP + 串口 HTTPS",
            REMOTE_SERIAL_HTTPS_MODE_COMPAT,
        )
        current_mode_index = self.remote_serial_mode_combo.findData(self.current_remote_serial_https_mode)
        if current_mode_index >= 0:
            self.remote_serial_mode_combo.setCurrentIndex(current_mode_index)
        form_layout.addRow(self.remote_serial_mode_label, self.remote_serial_mode_combo)

        self.remote_serial_mode_hint = QLabel(
            "全站 HTTPS 会保持原有行为；兼容模式会保留主站 HTTP，并额外开启一个 HTTPS 端口供串口工具使用。"
        )
        self.remote_serial_mode_hint.setStyleSheet("""
            font-size: 9pt;
            color: #3498db;
            font-weight: normal;
            padding: 5px;
            background: #e3f2fd;
            border-radius: 4px;
        """)
        form_layout.addRow("", self.remote_serial_mode_hint)

        self.serial_https_port_label = QLabel("串口 HTTPS 端口：")
        self.serial_https_port_edit = QLineEdit(str(self.current_serial_https_port))
        self.serial_https_port_edit.setPlaceholderText("兼容模式下的 HTTPS 端口，例如 5443")
        form_layout.addRow(self.serial_https_port_label, self.serial_https_port_edit)

        self.serial_https_port_hint = QLabel(
            "兼容模式下，主站继续使用上面的 HTTP 端口，串口工具会自动跳转到这里的 HTTPS 地址。"
        )
        self.serial_https_port_hint.setStyleSheet("""
            font-size: 9pt;
            color: #3498db;
            font-weight: normal;
            padding: 5px;
            background: #e3f2fd;
            border-radius: 4px;
        """)
        form_layout.addRow("", self.serial_https_port_hint)

        # HTTPS证书路径
        self.https_cert_label = QLabel("HTTPS证书：")
        self.https_cert_widget = QWidget()
        https_cert_layout = QHBoxLayout(self.https_cert_widget)
        https_cert_layout.setContentsMargins(0, 0, 0, 0)
        https_cert_layout.setSpacing(10)

        self.https_cert_edit = QLineEdit(self.current_https_cert_file)
        self.https_cert_edit.setPlaceholderText("选择证书文件（.pem/.crt）...")
        https_cert_layout.addWidget(self.https_cert_edit, 1)

        https_cert_browse_button = QPushButton("📄 证书")
        https_cert_browse_button.setObjectName("browseButton")
        https_cert_browse_button.clicked.connect(self.browse_https_cert)
        https_cert_layout.addWidget(https_cert_browse_button)
        form_layout.addRow(self.https_cert_label, self.https_cert_widget)

        # HTTPS私钥路径
        self.https_key_label = QLabel("HTTPS私钥：")
        self.https_key_widget = QWidget()
        https_key_layout = QHBoxLayout(self.https_key_widget)
        https_key_layout.setContentsMargins(0, 0, 0, 0)
        https_key_layout.setSpacing(10)

        self.https_key_edit = QLineEdit(self.current_https_key_file)
        self.https_key_edit.setPlaceholderText("选择私钥文件（.key/.pem）...")
        https_key_layout.addWidget(self.https_key_edit, 1)

        https_key_browse_button = QPushButton("🔑 私钥")
        https_key_browse_button.setObjectName("browseButton")
        https_key_browse_button.clicked.connect(self.browse_https_key)
        https_key_layout.addWidget(https_key_browse_button)
        form_layout.addRow(self.https_key_label, self.https_key_widget)

        self.https_files_hint = QLabel(
            "🔐 可留空：将尝试 adhoc 证书（需安装 cryptography）。\n"
            "使用自定义证书时，证书和私钥需要同时配置。"
        )
        self.https_files_hint.setStyleSheet("""
            font-size: 9pt;
            color: #3498db;
            font-weight: normal;
            padding: 5px;
            background: #e3f2fd;
            border-radius: 4px;
        """)
        form_layout.addRow("", self.https_files_hint)

        def on_remote_serial_changed(state):
            enabled = (state == Qt.Checked)
            compat_mode = (
                self.remote_serial_mode_combo.currentData() == REMOTE_SERIAL_HTTPS_MODE_COMPAT
            )
            self.remote_serial_mode_label.setVisible(enabled)
            self.remote_serial_mode_combo.setVisible(enabled)
            self.remote_serial_mode_hint.setVisible(enabled)
            self.serial_https_port_label.setVisible(enabled and compat_mode)
            self.serial_https_port_edit.setVisible(enabled and compat_mode)
            self.serial_https_port_hint.setVisible(enabled and compat_mode)
            self.https_cert_label.setVisible(enabled)
            self.https_cert_widget.setVisible(enabled)
            self.https_key_label.setVisible(enabled)
            self.https_key_widget.setVisible(enabled)
            self.https_files_hint.setVisible(enabled)

        self.remote_serial_enabled_checkbox.stateChanged.connect(on_remote_serial_changed)
        self.remote_serial_mode_combo.currentIndexChanged.connect(
            lambda _index: on_remote_serial_changed(
                Qt.Checked if self.remote_serial_enabled_checkbox.isChecked() else Qt.Unchecked
            )
        )
        on_remote_serial_changed(Qt.Checked if self.current_remote_serial_enabled else Qt.Unchecked)

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

        # —— 本地 AI ——
        lai = self._local_ai_saved
        ai_hint = QLabel(
            "当前主后端为 LM Studio API。请先在 LM Studio 中加载模型并启动本地服务器，"
            "此处只负责连接测试与参数配置。网页面板将直接复用该连接。"
        )
        ai_hint.setWordWrap(True)
        ai_hint.setStyleSheet(
            "font-size: 9pt; color: #555; font-weight: normal; padding: 8px; "
            "background: #f0f4ff; border-radius: 6px;"
        )
        ai_form_layout.addRow("", ai_hint)

        try:
            from . import local_ai_engine as _la_dep
            _deps = _la_dep.inference_dependencies()
        except Exception:
            _deps = {
                'lm_studio_mode': True,
            }
        dep_parts = []
        dep_parts.append("桌面设置用于测试 LM Studio 连接；网页面板仅显示状态并直接对话。")
        self.local_ai_deps_label = QLabel(" · ".join(dep_parts))
        self.local_ai_deps_label.setWordWrap(True)
        self.local_ai_deps_label.setStyleSheet(
            "font-size: 9pt; color: #333; font-weight: normal; padding: 6px; "
            "background: #fafafa; border-radius: 4px;"
        )
        ai_form_layout.addRow(QLabel("依赖检测："), self.local_ai_deps_label)

        self.local_ai_api_base_edit = QLineEdit(str(lai.get('LOCAL_AI_API_BASE_URL', '') or ''))
        self.local_ai_api_base_edit.setPlaceholderText("http://127.0.0.1:1234/v1（或 …/api/v1，与 LM Studio 列表一致）")
        ai_form_layout.addRow(QLabel("LM Studio API："), self.local_ai_api_base_edit)

        self.local_ai_api_model_edit = QLineEdit(str(lai.get('LOCAL_AI_API_MODEL', '') or ''))
        self.local_ai_api_model_edit.setPlaceholderText("留空则自动使用 LM Studio 当前第一个已加载模型")
        ai_form_layout.addRow(QLabel("模型 ID："), self.local_ai_api_model_edit)

        self.local_ai_embed_api_base_edit = QLineEdit(
            str(lai.get('LOCAL_AI_EMBED_API_BASE_URL', lai.get('LOCAL_AI_API_BASE_URL', '')) or '')
        )
        self.local_ai_embed_api_base_edit.setPlaceholderText("默认可与 LM Studio 对话地址相同")
        ai_form_layout.addRow(QLabel("Embedding API："), self.local_ai_embed_api_base_edit)

        self.local_ai_embed_model_edit = QLineEdit(str(lai.get('LOCAL_AI_EMBED_MODEL', '') or ''))
        self.local_ai_embed_model_edit.setPlaceholderText("例如 Qwen/Qwen3-Embedding-4B")
        ai_form_layout.addRow(QLabel("Embedding 模型："), self.local_ai_embed_model_edit)

        self.local_ai_embed_instruction_edit = QLineEdit(
            str(
                lai.get(
                    'LOCAL_AI_EMBED_QUERY_INSTRUCTION',
                    'Represent this query for retrieving relevant passages from the local knowledge base.',
                )
                or ''
            )
        )
        self.local_ai_embed_instruction_edit.setPlaceholderText("检索查询 embedding 的 instruction")
        ai_form_layout.addRow(QLabel("Embedding 指令："), self.local_ai_embed_instruction_edit)

        api_test_button = QPushButton("测试对话 AI")
        api_test_button.setObjectName("browseButton")
        api_test_button.clicked.connect(self.test_local_ai_chat_api)
        ai_form_layout.addRow("", api_test_button)

        embed_test_button = QPushButton("测试 Embedding AI")
        embed_test_button.setObjectName("browseButton")
        embed_test_button.clicked.connect(self.test_local_ai_embedding_api)
        ai_form_layout.addRow("", embed_test_button)

        no_dir_hint = QLabel(
            "开启 OpenAI Compatible Server 后，填「API 根路径」即可（不是整段 /models URL）。"
            "常见为 http://127.0.0.1:1234/v1；若软件列出 /api/v1/models/，则填 http://127.0.0.1:1234/api/v1。"
            "只填 http://127.0.0.1:1234 时，程序会自动依次尝试 /v1 与 /api/v1。"
            "对话会使用 OpenAI 兼容的 /v1/chat/completions（若你填的是 /api/v1，程序会自动改到 /v1）。"
        )
        no_dir_hint.setWordWrap(True)
        no_dir_hint.setStyleSheet("font-size: 8pt; color: #888; font-weight: normal;")
        ai_form_layout.addRow("", no_dir_hint)

        skills_row = QWidget()
        skills_h = QHBoxLayout(skills_row)
        skills_h.setContentsMargins(0, 0, 0, 0)
        self.local_ai_skills_edit = QLineEdit(str(lai.get('LOCAL_AI_SKILLS_DIR', '') or ''))
        self.local_ai_skills_edit.setPlaceholderText("默认 AI/skills")
        skills_h.addWidget(self.local_ai_skills_edit, 1)
        skills_btn = QPushButton("📁")
        skills_btn.setObjectName("browseButton")
        skills_btn.clicked.connect(self.browse_local_ai_skills_dir)
        skills_h.addWidget(skills_btn)
        ai_form_layout.addRow(QLabel("Skill 目录："), skills_row)

        kb_storage_row = QWidget()
        kb_storage_h = QHBoxLayout(kb_storage_row)
        kb_storage_h.setContentsMargins(0, 0, 0, 0)
        self.local_ai_kb_storage_edit = QLineEdit(str(lai.get('LOCAL_AI_KB_STORAGE_DIR', '') or ''))
        self.local_ai_kb_storage_edit.setPlaceholderText("默认 data/local_ai")
        kb_storage_h.addWidget(self.local_ai_kb_storage_edit, 1)
        kb_storage_btn = QPushButton("📁")
        kb_storage_btn.setObjectName("browseButton")
        kb_storage_btn.clicked.connect(self.browse_local_ai_kb_storage_dir)
        kb_storage_h.addWidget(kb_storage_btn)
        ai_form_layout.addRow(QLabel("知识库存储："), kb_storage_row)

        self.local_ai_append_skills_cb = QCheckBox("在系统提示前附加 Skill 文档")
        self.local_ai_append_skills_cb.setChecked(bool(lai.get('LOCAL_AI_APPEND_SKILLS', True)))
        self.local_ai_append_skills_cb.setStyleSheet("QCheckBox { font-size: 10pt; font-weight: normal; }")
        ai_form_layout.addRow("", self.local_ai_append_skills_cb)

        self.local_ai_use_mcp_cb = QCheckBox("启用 MCP 工具调用（关闭后仅使用纯对话，不执行 MCP 工具）")
        self.local_ai_use_mcp_cb.setChecked(bool(lai.get('LOCAL_AI_USE_MCP_BRIDGE', True)))
        self.local_ai_use_mcp_cb.setStyleSheet("QCheckBox { font-size: 10pt; font-weight: normal; }")
        ai_form_layout.addRow("", self.local_ai_use_mcp_cb)

        self.local_ai_max_tokens_edit = QLineEdit(str(int(lai.get('LOCAL_AI_MAX_NEW_TOKENS', 512) or 512)))
        self.local_ai_max_tokens_edit.setPlaceholderText("512")
        ai_form_layout.addRow(QLabel("最大输出 (tokens)："), self.local_ai_max_tokens_edit)

        self.local_ai_drawio_max_tokens_edit = QLineEdit(
            str(int(lai.get('LOCAL_AI_DRAWIO_MAX_NEW_TOKENS', 8192) or 8192))
        )
        self.local_ai_drawio_max_tokens_edit.setPlaceholderText("8192")
        self.local_ai_drawio_max_tokens_edit.setToolTip(
            "仅用于 Draw.io 页的「AI 绘图」：生成 yobboy-flow 或 mxfile 需要足够输出长度。\n须小于等于 LM Studio 上下文剩余空间。"
        )
        ai_form_layout.addRow(QLabel("Draw.io 生成上限 (tokens)："), self.local_ai_drawio_max_tokens_edit)

        self.local_ai_drawio_output_combo = QComboBox()
        self.local_ai_drawio_output_combo.addItem("yobboy-flow 文本（推荐，可带坐标）", "text_dsl")
        self.local_ai_drawio_output_combo.addItem("直接输出 XML / mxfile（旧版）", "xml")
        _dout_cur = str(lai.get("LOCAL_AI_DRAWIO_OUTPUT", "text_dsl") or "text_dsl").strip().lower()
        if _dout_cur not in ("text_dsl", "xml"):
            _dout_cur = "text_dsl"
        for _i in range(self.local_ai_drawio_output_combo.count()):
            if self.local_ai_drawio_output_combo.itemData(_i) == _dout_cur:
                self.local_ai_drawio_output_combo.setCurrentIndex(_i)
                break
        self.local_ai_drawio_output_combo.setToolTip(
            "yobboy-flow：模型只写类 Mermaid 文本，由本机转换为可编辑 draw.io；"
            "xml：模型直接输出 <mxfile>（弱模型易语法错误）。"
        )
        ai_form_layout.addRow(QLabel("Draw.io AI 输出格式："), self.local_ai_drawio_output_combo)

        _lctx = int(lai.get('LOCAL_AI_LLAMA_CTX', 4096) or 4096)
        _pcap = int(lai.get('LOCAL_AI_PROMPT_CONTEXT_CAP', 4096) or 4096)
        _ctx_one = _lctx if _pcap <= 0 else min(_lctx, _pcap)
        self.local_ai_context_tokens_edit = QLineEdit(str(max(512, _ctx_one)))
        self.local_ai_context_tokens_edit.setPlaceholderText("4096")
        self.local_ai_context_tokens_edit.setToolTip(
            "与 LM Studio 里该模型的 Context length 保持一致。\n保存时会同时写入配置中的两项内部字段，无需再改 config.ini。"
        )
        ai_form_layout.addRow(QLabel("上下文长度 (tokens)："), self.local_ai_context_tokens_edit)
        _ctx_hint = QLabel(
            "须与 LM Studio 加载模型时的 Context length 一致（例如 4096、8192、10000）。"
            "保存后程序按此长度估算截断与 Skill 体积；过大或过小都会导致无回复或多余截断。"
        )
        _ctx_hint.setWordWrap(True)
        _ctx_hint.setStyleSheet("font-size: 8pt; color: #888; font-weight: normal;")
        ai_form_layout.addRow("", _ctx_hint)

        layout.addWidget(tab_widget)
        scroll_area.setWidget(content_widget)
        main_layout.addWidget(scroll_area, 1)

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

        main_layout.addLayout(button_layout)

        self.setLayout(main_layout)

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

    def browse_data_directory(self):
        directory = QFileDialog.getExistingDirectory(
            self,
            "选择数据目录",
            self.data_dir_edit.text() or self.root_edit.text() or os.path.expanduser("~"),
            QFileDialog.ShowDirsOnly | QFileDialog.DontResolveSymlinks
        )

        if directory:
            self.data_dir_edit.setText(directory)
            self.new_data_dir = directory

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

    def browse_https_cert(self):
        """浏览选择HTTPS证书文件"""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "选择HTTPS证书文件",
            self.https_cert_edit.text() or os.path.expanduser("~"),
            "证书文件 (*.pem *.crt *.cer *.cert);;所有文件 (*.*)"
        )
        if file_path:
            self.https_cert_edit.setText(file_path)
            self.new_https_cert_file = file_path

    def browse_https_key(self):
        """浏览选择HTTPS私钥文件"""
        file_path, _ = QFileDialog.getOpenFileName(
            self,
            "选择HTTPS私钥文件",
            self.https_key_edit.text() or os.path.expanduser("~"),
            "私钥文件 (*.key *.pem);;所有文件 (*.*)"
        )
        if file_path:
            self.https_key_edit.setText(file_path)
            self.new_https_key_file = file_path

    def test_local_ai_api(self):
        self.test_local_ai_chat_api()

    def _build_local_ai_chat_test_config(self):
        return {
            'LOCAL_AI_API_BASE_URL': self.local_ai_api_base_edit.text().strip(),
            'LOCAL_AI_API_MODEL': self.local_ai_api_model_edit.text().strip(),
        }

    def _build_local_ai_embedding_test_config(self):
        embed_api_key = self._local_ai_saved.get('LOCAL_AI_EMBED_API_KEY', 'lm-studio')
        return {
            'LOCAL_AI_API_BASE_URL': self.local_ai_api_base_edit.text().strip(),
            'LOCAL_AI_API_MODEL': self.local_ai_api_model_edit.text().strip(),
            'LOCAL_AI_EMBED_API_BASE_URL': self.local_ai_embed_api_base_edit.text().strip()
            or self.local_ai_api_base_edit.text().strip(),
            'LOCAL_AI_EMBED_MODEL': self.local_ai_embed_model_edit.text().strip(),
            'LOCAL_AI_EMBED_API_KEY': embed_api_key or 'lm-studio',
            'LOCAL_AI_EMBED_QUERY_INSTRUCTION': self.local_ai_embed_instruction_edit.text().strip(),
            'LOCAL_AI_EMBED_BATCH_SIZE': self._local_ai_saved.get('LOCAL_AI_EMBED_BATCH_SIZE', 16),
        }

    def test_local_ai_chat_api(self):
        try:
            from . import local_ai_engine

            cfg = self._build_local_ai_chat_test_config()
            res = local_ai_engine.probe_connection(cfg, timeout=5.0)
            if not res.get('success'):
                QMessageBox.warning(self, "对话 AI 测试失败", res.get('error') or '未知错误')
                return

            reply = local_ai_engine.generate_once(
                cfg,
                [{'role': 'user', 'content': '请只回复“连接成功”四个字。'}],
                max_new_tokens=32,
            ).strip()
            models = res.get('models') or []
            picked = res.get('model') or '（未选择）'
            QMessageBox.information(
                self,
                "对话 AI 测试成功",
                "聊天模型已可用。\n\n"
                f"接口地址: {res.get('api_root')}\n"
                f"当前模型: {picked}\n"
                f"可见模型数: {len(models)}\n"
                f"测试输出: {reply or '（模型未返回文本）'}",
            )
        except Exception as e:
            QMessageBox.warning(self, "对话 AI 测试失败", str(e))

    def test_local_ai_embedding_api(self):
        try:
            from . import embedding_client

            cfg = self._build_local_ai_embedding_test_config()
            res = embedding_client.probe_connection(cfg, timeout=5.0)
            if not res.get('success'):
                QMessageBox.warning(self, "Embedding AI 测试失败", res.get('error') or '未知错误')
                return

            vectors = embedding_client.embed_texts(
                cfg,
                ['这是一个用于测试本地知识库 embedding 的样例文本。'],
                is_query=False,
                timeout=20.0,
            )
            vector = vectors[0] if vectors else []
            preview = ', '.join(f'{value:.4f}' for value in vector[:8])
            QMessageBox.information(
                self,
                "Embedding AI 测试成功",
                "Embedding 模型已可用。\n\n"
                f"接口地址: {res.get('api_root')}\n"
                f"当前模型: {res.get('model') or '（未选择）'}\n"
                f"向量维度: {len(vector)}\n"
                f"向量预览: [{preview}]",
            )
        except Exception as e:
            QMessageBox.warning(self, "Embedding AI 测试失败", str(e))

    def browse_local_ai_skills_dir(self):
        from .local_ai_paths import default_skills_dir

        start = self.local_ai_skills_edit.text().strip() or default_skills_dir()
        directory = QFileDialog.getExistingDirectory(
            self, "选择 Skill 目录", start, QFileDialog.ShowDirsOnly | QFileDialog.DontResolveSymlinks
        )
        if directory:
            self.local_ai_skills_edit.setText(directory)

    def browse_local_ai_kb_storage_dir(self):
        from .local_ai_paths import default_knowledge_storage_dir

        start = self.local_ai_kb_storage_edit.text().strip() or default_knowledge_storage_dir()
        directory = QFileDialog.getExistingDirectory(
            self, "选择知识库存储目录", start, QFileDialog.ShowDirsOnly | QFileDialog.DontResolveSymlinks
        )
        if directory:
            self.local_ai_kb_storage_edit.setText(directory)

    def accept(self):
        """确认保存"""
        # 验证输入
        self.new_root = self.root_edit.text()
        self.new_data_dir = self.data_dir_edit.text().strip()
        self.new_password = self.password_edit.text()
        self.new_admin_password = self.admin_password_edit.text()
        self.new_close_to_tray = self.close_to_tray_checkbox.isChecked()
        self.new_git_enabled = self.git_enabled_checkbox.isChecked()
        self.new_git_workdir = self.git_workdir_edit.text().strip()
        self.new_git_external_app_path = self.git_external_app_edit.text().strip()
        self.new_remote_serial_enabled = self.remote_serial_enabled_checkbox.isChecked()
        self.new_remote_serial_https_mode = normalize_remote_serial_https_mode(
            self.remote_serial_mode_combo.currentData()
        )
        self.new_https_cert_file = self.https_cert_edit.text().strip()
        self.new_https_key_file = self.https_key_edit.text().strip()

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

        if not self.new_data_dir:
            QMessageBox.warning(self, "错误", "请选择有效的数据目录")
            return
        if not self.new_password:
            QMessageBox.warning(self, "错误", "登录密码不能为空")
            return

        if len(self.new_password) != 6:
            QMessageBox.warning(self, "错误", "登录密码必须正好为 6 位")
            return


        if not self.new_admin_password:
            QMessageBox.warning(self, "错误", "管理员密码不能为空")
            return

        if self.new_remote_serial_enabled:
            if self.new_remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_COMPAT:
                try:
                    serial_https_port = int(self.serial_https_port_edit.text().strip())
                    if serial_https_port < 1 or serial_https_port > 65535:
                        QMessageBox.warning(self, "错误", "串口 HTTPS 端口必须在 1-65535 之间")
                        return
                except ValueError:
                    QMessageBox.warning(self, "错误", "串口 HTTPS 端口必须是有效的数字")
                    return

                if serial_https_port == self.new_port:
                    QMessageBox.warning(self, "错误", "兼容模式下，HTTP 端口和串口 HTTPS 端口不能相同")
                    return
                self.new_serial_https_port = serial_https_port
            else:
                self.new_serial_https_port = normalize_serial_https_port(
                    self.serial_https_port_edit.text().strip() or self.current_serial_https_port,
                    main_port=self.new_port,
                )

            cert_filled = bool(self.new_https_cert_file)
            key_filled = bool(self.new_https_key_file)
            if cert_filled != key_filled:
                QMessageBox.warning(self, "错误", "HTTPS证书和私钥必须同时填写，或同时留空。")
                return

            if cert_filled and not os.path.exists(self.new_https_cert_file):
                QMessageBox.warning(self, "错误", f"证书文件不存在：{self.new_https_cert_file}")
                return
            if key_filled and not os.path.exists(self.new_https_key_file):
                QMessageBox.warning(self, "错误", f"私钥文件不存在：{self.new_https_key_file}")
                return

            if not cert_filled:
                has_cryptography = importlib.util.find_spec('cryptography') is not None
                if not has_cryptography:
                    QMessageBox.warning(
                        self,
                        "提示",
                        "当前环境未安装 cryptography，且未配置证书。\n"
                        "远程串口的 HTTPS 入口将无法启用。\n"
                        "如需 HTTPS，请安装 cryptography 或配置证书与私钥。"
                    )
        else:
            self.new_remote_serial_https_mode = REMOTE_SERIAL_HTTPS_MODE_FULL
            self.new_serial_https_port = normalize_serial_https_port(
                self.serial_https_port_edit.text().strip() or self.current_serial_https_port,
                main_port=self.new_port,
            )

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

        try:
            max_new = int(self.local_ai_max_tokens_edit.text().strip())
            if max_new < 1 or max_new > 65536:
                raise ValueError("range")
        except ValueError:
            QMessageBox.warning(self, "错误", "本地 AI 页中的最大输出 token 参数无效")
            return

        try:
            drawio_max = int(self.local_ai_drawio_max_tokens_edit.text().strip())
            if drawio_max < 512 or drawio_max > 65536:
                raise ValueError("drawio_range")
        except ValueError:
            QMessageBox.warning(self, "错误", "Draw.io 生成上限须为 512～65536 之间的整数")
            return

        try:
            ctx_one = int(self.local_ai_context_tokens_edit.text().strip())
            if ctx_one < 512 or ctx_one > 262144:
                raise ValueError("ctx")
        except ValueError:
            QMessageBox.warning(self, "错误", "本地 AI 页中的上下文长度须为 512～262144 之间的整数")
            return

        la_defaults = local_ai_settings_dict_from_ini(None)
        prev = dict(self._local_ai_saved)

        self._local_ai_saved = {
            'LOCAL_AI_API_BASE_URL': self.local_ai_api_base_edit.text().strip()
            or la_defaults['LOCAL_AI_API_BASE_URL'],
            'LOCAL_AI_API_MODEL': self.local_ai_api_model_edit.text().strip(),
            'LOCAL_AI_EMBED_API_BASE_URL': self.local_ai_embed_api_base_edit.text().strip()
            or self.local_ai_api_base_edit.text().strip()
            or la_defaults['LOCAL_AI_API_BASE_URL'],
            'LOCAL_AI_EMBED_MODEL': self.local_ai_embed_model_edit.text().strip(),
            'LOCAL_AI_EMBED_API_KEY': prev.get('LOCAL_AI_EMBED_API_KEY', la_defaults['LOCAL_AI_EMBED_API_KEY']),
            'LOCAL_AI_EMBED_QUERY_INSTRUCTION': self.local_ai_embed_instruction_edit.text().strip()
            or la_defaults['LOCAL_AI_EMBED_QUERY_INSTRUCTION'],
            'LOCAL_AI_EMBED_BATCH_SIZE': prev.get(
                'LOCAL_AI_EMBED_BATCH_SIZE', la_defaults['LOCAL_AI_EMBED_BATCH_SIZE']
            ),
            'LOCAL_AI_MODEL_DIR': '',
            'LOCAL_AI_MODEL_ID': '',
            'LOCAL_AI_GGUF_PATH': '',
            'LOCAL_AI_SKILLS_DIR': self.local_ai_skills_edit.text().strip()
            or la_defaults['LOCAL_AI_SKILLS_DIR'],
            'LOCAL_AI_KB_STORAGE_DIR': self.local_ai_kb_storage_edit.text().strip()
            or la_defaults['LOCAL_AI_KB_STORAGE_DIR'],
            'LOCAL_AI_MODELS_DIR': prev.get('LOCAL_AI_MODELS_DIR') or la_defaults['LOCAL_AI_MODELS_DIR'],
            'LOCAL_AI_HF_HOME': prev.get('LOCAL_AI_HF_HOME') or la_defaults['LOCAL_AI_HF_HOME'],
            'LOCAL_AI_APPEND_SKILLS': self.local_ai_append_skills_cb.isChecked(),
            'LOCAL_AI_DEVICE': 'auto',
            'LOCAL_AI_TORCH_DTYPE': 'float16',
            'LOCAL_AI_MAX_NEW_TOKENS': max_new,
            'LOCAL_AI_DRAWIO_MAX_NEW_TOKENS': drawio_max,
            'LOCAL_AI_DRAWIO_OUTPUT': str(self.local_ai_drawio_output_combo.currentData() or 'text_dsl'),
            'LOCAL_AI_LLAMA_CTX': ctx_one,
            'LOCAL_AI_PROMPT_CONTEXT_CAP': ctx_one,
            'LOCAL_AI_LLAMA_GPU_LAYERS': prev.get(
                'LOCAL_AI_LLAMA_GPU_LAYERS', la_defaults['LOCAL_AI_LLAMA_GPU_LAYERS']
            ),
            'LOCAL_AI_TEMPERATURE': prev.get('LOCAL_AI_TEMPERATURE', la_defaults['LOCAL_AI_TEMPERATURE']),
            'LOCAL_AI_TOP_P': prev.get('LOCAL_AI_TOP_P', la_defaults['LOCAL_AI_TOP_P']),
            'LOCAL_AI_USE_MCP_BRIDGE': self.local_ai_use_mcp_cb.isChecked(),
        }

        super().accept()

    def open_git_config_dialog(self):
        """打开Git配置管理对话框"""
        dialog = GitConfigDialog(self)
        dialog.exec_()

    def get_settings(self):
        """获取设置"""
        return (
            self.new_root,
            self.new_data_dir,
            self.new_log_dir,
            self.new_password,
            self.new_admin_password,
            self.new_close_to_tray,
            self.new_port,
            self.new_git_enabled,
            self.new_git_workdir,
            self.new_git_external_app_path,
            self.new_remote_serial_enabled,
            self.new_remote_serial_https_mode,
            self.new_serial_https_port,
            self.new_https_cert_file,
            self.new_https_key_file,
            self._local_ai_saved,
        )


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
            current_dir = project_base_dir()
            # 打包模式：直接运行当前 exe
            cmd = [sys.executable, 'run', info_file_path]
        else:
            # 开发模式：使用.py文件所在目录
            current_dir = project_base_dir()
            # 开发模式：运行 main.py
            app_path = get_resource_path("main.py")
            cmd = [sys.executable, app_path, 'run', info_file_path]

        # 设置工作目录为exe所在目录（打包模式）或.py文件所在目录（开发模式）
        self.setWorkingDirectory(current_dir)
        app_logger.info("[调试] Flask子进程工作目录: %s", current_dir)
        self.start(cmd[0], cmd[1:])


    def stop_server(self):
        """停止 Flask 服务器"""
        try:
            process_state = self.state()
        except RuntimeError as e:
            app_logger.warning("停止服务器时读取进程状态失败（对象可能已销毁）: %s", e)
            return

        if process_state != QProcess.NotRunning:
            self.terminate()
            try:
                finished = self.waitForFinished(5000)
            except RuntimeError as e:
                app_logger.warning("等待服务器进程退出失败（对象可能已销毁）: %s", e)
                return

            if not finished:
                self.kill()
                try:
                    self.waitForFinished(1000)
                except RuntimeError as e:
                    app_logger.warning("强制结束服务器进程后等待失败（对象可能已销毁）: %s", e)


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
        self._stdout_buffer = ""
        self._stderr_buffer = ""
        self.log_timer = QTimer()
        self.log_timer.timeout.connect(self.flush_log_queue)
        self.log_timer.start(100)

        self.is_server_running = False
        self.server_port = 5000  # 默认端口，将从配置中读取
        self.server_scheme = 'http'
        self.remote_serial_enabled = False
        self.remote_serial_https_mode = REMOTE_SERIAL_HTTPS_MODE_FULL
        self.serial_https_port = default_serial_https_port(self.server_port)
        self.serial_https_active = False
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

        manage_games_action = QAction('🗑️ 删除游戏用户数据', self)
        manage_games_action.setStatusTip('仅管理员可在桌面 GUI 中删除 Games Hub 用户数据')
        manage_games_action.triggered.connect(self.open_games_data_admin)
        file_menu.addAction(manage_games_action)

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
            ordered_addresses = []
            for preferred in ('127.0.0.1', 'localhost'):
                if preferred not in ordered_addresses:
                    ordered_addresses.append(preferred)
            for ip in addresses:
                if ip and ip not in ordered_addresses:
                    ordered_addresses.append(ip)

            main_addr_text = "<br>".join(
                [
                    f"  🌐 <a href='{self.server_scheme}://{ip}:{self.server_port}' style='color: #0066cc; text-decoration: none;'>{self.server_scheme}://{ip}:{self.server_port}</a>"
                    for ip in ordered_addresses
                ]
            )

            address_sections = [f"<b>主站地址:</b><br>{main_addr_text}"]
            if self.remote_serial_enabled and self.remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_COMPAT:
                serial_addr_text = "<br>".join(
                    [
                        f"  🔐 <a href='https://{ip}:{self.serial_https_port}/serial_tool' style='color: #0b7285; text-decoration: none;'>https://{ip}:{self.serial_https_port}/serial_tool</a>"
                        for ip in ordered_addresses
                    ]
                )
                if self.serial_https_active:
                    serial_caption = "串口 HTTPS 地址:"
                else:
                    serial_caption = "串口 HTTPS 地址（若无法打开，请检查证书或 cryptography）:"
                address_sections.append(f"<b>{serial_caption}</b><br>{serial_addr_text}")

            self.address_label.setText("<br><br>".join(address_sections))
            self.address_label.setOpenExternalLinks(True)
            self.address_label.setTextFormat(Qt.RichText)
            # 更新托盘图标提示
            tray_tooltip = (
                f"Yobboy文件服务器\n状态: {status}\n主站: {self.server_scheme}://127.0.0.1:{self.server_port}"
            )
            if self.remote_serial_enabled and self.remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_COMPAT:
                tray_tooltip += f"\n串口 HTTPS: https://127.0.0.1:{self.serial_https_port}/serial_tool"
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

        self._stdout_buffer += stdout
        lines = self._stdout_buffer.splitlines(keepends=True)
        if lines and not lines[-1].endswith(('\n', '\r')):
            self._stdout_buffer = lines.pop()
        else:
            self._stdout_buffer = ""

        for line in lines:
            self.log_receiver.message.emit(line)
            if "Running on" in line:
                if self.remote_serial_enabled and self.remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_COMPAT:
                    if "https://" in line:
                        self.serial_https_active = True
                    elif "http://" in line:
                        self.server_scheme = 'http'
                else:
                    if "https://" in line:
                        self.server_scheme = 'https'
                    elif "http://" in line:
                        self.server_scheme = 'http'
                if "http://" in line or "https://" in line:
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

        self._stderr_buffer += stderr
        lines = self._stderr_buffer.splitlines(keepends=True)
        if lines and not lines[-1].endswith(('\n', '\r')):
            self._stderr_buffer = lines.pop()
        else:
            self._stderr_buffer = ""

        for line in lines:
            if line.startswith("[STDERR] "):
                self.log_receiver.message.emit(line)
            else:
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
        try:
            self.process.stop_server()
        except RuntimeError as e:
            app_logger.warning("停止服务器时进程对象不可用，按已停止处理: %s", e)
            self.is_server_running = False
            self.start_button.setEnabled(True)
            self.stop_button.setEnabled(False)
            self.tray_start_action.setEnabled(True)
            self.tray_stop_action.setEnabled(False)
            self.update_server_info("未运行")

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

    def probe_single_server(self, url):
        """Probe one local endpoint and return whether it is reachable."""
        try:
            if url.startswith('https://'):
                context = ssl._create_unverified_context()
                with urllib.request.urlopen(url, timeout=3, context=context) as resp:
                    code = getattr(resp, 'status', None)
            else:
                with urllib.request.urlopen(url, timeout=3) as resp:
                    code = getattr(resp, 'status', None)
            app_logger.info("[探测] 本机访问成功: %s (status=%s)", url, code)
            return True
        except urllib.error.URLError as e:
            app_logger.error("[探测] 本机访问失败: %s, error=%s", url, e)
        except Exception as e:
            app_logger.error("[探测] 本机访问异常: %s, error=%s", url, e)
        return False

    def probe_server_locally(self):
        """本机探测服务是否可访问，便于定位 HTTPS 连接问题。"""
        if not self.is_server_running:
            return

        primary_url = f"{self.server_scheme}://127.0.0.1:{self.server_port}/"
        self.probe_single_server(primary_url)

        if self.remote_serial_enabled and self.remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_COMPAT:
            serial_https_url = f"https://127.0.0.1:{self.serial_https_port}/serial_tool"
            self.serial_https_active = self.probe_single_server(serial_https_url)

        local_ips = get_local_ips(verbose=False, use_cache=True)
        self.update_server_info("运行中", local_ips)

    def on_server_started(self):
        """服务器进程启动时的回调"""
        self.is_server_running = True
        self.serial_https_active = False
        self.start_button.setEnabled(False)
        self.stop_button.setEnabled(True)
        self.tray_start_action.setEnabled(False)
        self.tray_stop_action.setEnabled(True)
        self.update_server_info("启动中...")
        self.append_log("--- 服务器启动中... ---\n")
        QTimer.singleShot(1200, self.probe_server_locally)

    def on_server_finished(self, exit_code, exit_status):
        """服务器进程结束时的回调"""
        self.is_server_running = False
        self.serial_https_active = False
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
        scheme = self.server_scheme or 'http'
        help_url = f"{scheme}://127.0.0.1:{port}/help"
        if local_ips:
            app_logger.info("[帮助] 可用局域网IP: %s", ", ".join(local_ips))

        # 在浏览器中打开帮助页面
        try:
            webbrowser.open(help_url)
        except Exception as e:
            QMessageBox.warning(self, "错误", f"无法打开浏览器：{e}")

    def open_games_data_admin(self):
        """管理员入口：删除 Games Hub 用户数据。"""
        if self.is_server_running:
            reply = QMessageBox.question(
                self,
                "停止服务器",
                "删除游戏用户数据前建议先停止服务器，是否现在停止？",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.Yes
            )
            if reply != QMessageBox.Yes:
                return
            self.stop_server()
            if not self.wait_for_server_state(expected_running=False, timeout_ms=5000):
                QMessageBox.warning(self, "错误", "服务器停止失败，已取消删除操作。")
                return

        settings = read_runtime_settings()
        current_admin_password = settings.get('ADMIN_PASSWORD', 'admin123')
        admin_pass, ok = QInputDialog.getText(
            self,
            "验证管理员密码",
            "请输入管理员密码：",
            QLineEdit.Password
        )
        if not ok:
            return
        if admin_pass != current_admin_password:
            QMessageBox.critical(self, "错误", "管理员密码错误，无法删除游戏用户数据。")
            return

        try:
            store = GameHubStore()
            players = store.list_player_profiles(limit=1000)
        except Exception as e:
            QMessageBox.critical(self, "错误", f"读取游戏用户数据失败：{e}")
            return

        if not players:
            QMessageBox.information(self, "提示", "当前没有可删除的 Games Hub 用户数据。")
            return

        labels = [
            f"{item.get('display_name', '')} | {item.get('identity', '')} | 总分 {int(item.get('total_score', 0))} | 记录 {int(item.get('play_count', 0))} | 存档 {int(item.get('state_count', 0))}"
            for item in players
        ]
        selected_label, ok = QInputDialog.getItem(
            self,
            "选择用户",
            "请选择要删除的游戏用户数据：",
            labels,
            0,
            False
        )
        if not ok or not selected_label:
            return

        selected_index = labels.index(selected_label)
        selected_player = players[selected_index]
        selected_identity = str(selected_player.get('identity') or '')
        confirm = QMessageBox.warning(
            self,
            "确认删除",
            (
                f"确定删除以下用户的 Games Hub 数据吗？\n\n"
                f"显示名：{selected_player.get('display_name', '')}\n"
                f"身份：{selected_identity}\n"
                f"总分：{int(selected_player.get('total_score', 0))}\n"
                f"历史记录：{int(selected_player.get('play_count', 0))}\n"
                f"游戏存档：{int(selected_player.get('state_count', 0))}\n\n"
                f"此操作不可撤销。"
            ),
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No
        )
        if confirm != QMessageBox.Yes:
            return

        try:
            result = store.delete_player_data(selected_identity)
        except Exception as e:
            QMessageBox.critical(self, "错误", f"删除游戏用户数据失败：{e}")
            return

        QMessageBox.information(
            self,
            "删除完成",
            (
                f"已删除 {selected_player.get('display_name', selected_identity)} 的 Games Hub 数据。\n\n"
                f"成绩记录：{result.get('deleted_scores', 0)}\n"
                f"游戏存档：{result.get('deleted_states', 0)}\n"
                f"在线状态：{result.get('deleted_presence', 0)}\n"
                f"资料记录：{result.get('deleted_profile', 0)}\n"
                f"头像文件：{'已删除' if result.get('avatar_deleted') else '无或未删除'}"
            )
        )

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
        current_data_dir = settings.get('DATA_DIR', get_data_dir(create=False))
        current_log_dir = settings.get('LOG_DIR', get_runtime_logs_dir(create=False))
        current_password = settings.get('PASSWORD', 'password')
        current_admin_password = settings.get('ADMIN_PASSWORD', 'admin123')
        current_close_to_tray = settings.get('CLOSE_TO_TRAY', False)
        current_port = settings.get('PORT', 5000)
        current_git_enabled = settings.get('GIT_ENABLED', False)
        current_git_workdir = settings.get('GIT_WORKDIR', '')
        current_git_external_app_path = settings.get('GIT_EXTERNAL_APP_PATH', '')
        current_remote_serial_enabled = settings.get('REMOTE_SERIAL_ENABLED', False)
        current_remote_serial_https_mode = settings.get('REMOTE_SERIAL_HTTPS_MODE', REMOTE_SERIAL_HTTPS_MODE_FULL)
        current_serial_https_port = settings.get('SERIAL_HTTPS_PORT', default_serial_https_port(current_port))
        current_https_cert_file = settings.get('HTTPS_CERT_FILE', '')
        current_https_key_file = settings.get('HTTPS_KEY_FILE', '')
        current_local_ai = {k: settings.get(k) for k in LOCAL_AI_CONFIG_KEYS}

        # 显示设置对话框
        dialog = SettingsDialog(
            self,
            current_root,
            current_data_dir,
            current_log_dir,
            current_password,
            current_admin_password,
            current_close_to_tray,
            current_port,
            current_git_enabled,
            current_git_workdir,
            current_git_external_app_path,
            current_remote_serial_enabled,
            current_remote_serial_https_mode,
            current_serial_https_port,
            current_https_cert_file,
            current_https_key_file,
            local_ai_settings=current_local_ai,
        )
        if dialog.exec_() == QDialog.Accepted:
            (
                new_root,
                new_data_dir,
                new_log_dir,
                new_password,
                new_admin_password,
                new_close_to_tray,
                new_port,
                new_git_enabled,
                new_git_workdir,
                new_git_external_app_path,
                new_remote_serial_enabled,
                new_remote_serial_https_mode,
                new_serial_https_port,
                new_https_cert_file,
                new_https_key_file,
                new_local_ai,
            ) = dialog.get_settings()

            # 保存配置
            try:
                config_file = get_config_path()
                prev_rt = read_runtime_settings(create_if_missing=False, config_file=config_file)
                save_payload = {
                    'CONFIG_FILE': config_file,
                    'ROOT_DIR': new_root,
                    'DATA_DIR': new_data_dir,
                    'LOG_DIR': new_log_dir,
                    'PASSWORD': new_password,
                    'ADMIN_PASSWORD': new_admin_password,
                    'CLOSE_TO_TRAY': new_close_to_tray,
                    'PORT': new_port,
                    'GIT_ENABLED': new_git_enabled,
                    'GIT_WORKDIR': new_git_workdir,
                    'GIT_EXTERNAL_APP_PATH': new_git_external_app_path,
                    'REMOTE_SERIAL_ENABLED': new_remote_serial_enabled,
                    'REMOTE_SERIAL_HTTPS_MODE': new_remote_serial_https_mode,
                    'SERIAL_HTTPS_PORT': new_serial_https_port,
                    'HTTPS_CERT_FILE': new_https_cert_file,
                    'HTTPS_KEY_FILE': new_https_key_file,
                    'LOG_LEVEL': prev_rt.get('LOG_LEVEL', 'INFO'),
                }
                save_payload.update(new_local_ai)
                save_runtime_settings(save_payload, config_file=config_file)

                close_behavior_text = "最小化到托盘" if new_close_to_tray else "直接退出程序"
                git_enabled_text = "已启用" if new_git_enabled else "已禁用"
                git_workdir_text = new_git_workdir if new_git_workdir else "未设置"
                remote_serial_text = "已启用" if new_remote_serial_enabled else "已禁用"
                mcp_enabled_text = "已启用" if bool(new_local_ai.get('LOCAL_AI_USE_MCP_BRIDGE', True)) else "已禁用"
                remote_serial_mode_text = (
                     "兼容模式（主站 HTTP + 串口 HTTPS）"
                    if new_remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_COMPAT
                    else "全站 HTTPS（原有方式）"
                )
                if not new_remote_serial_enabled:
                    cert_summary = "未启用"
                else:
                    cert_summary = "已配置" if (new_https_cert_file and new_https_key_file) else "未配置（将尝试 adhoc）"

                QMessageBox.information(
                    self, "保存成功",
                    f"设置已成功保存到配置文件！\n\n"
                    f"配置文件位置:\n{config_file}\n\n"
                    f"根目录: {new_root}\n"
                    f"数据目录: {new_data_dir}\n"
                    f"日志目录: {new_log_dir}\n"
                    f"登录密码: {'*' * len(new_password)} (已加密显示)\n"
                    f"管理员密码: {'*' * len(new_admin_password)} (已加密显示)\n"
                    f"服务器端口: {new_port}\n"
                    f"关闭行为: {close_behavior_text}\n"
                    f"Git功能: {git_enabled_text}\n"
                    f"远程串口: {remote_serial_text}\n"
                    f"{'串口 HTTPS 模式: ' + remote_serial_mode_text if new_remote_serial_enabled else ''}\n"
                    f"{'串口 HTTPS 端口: ' + str(new_serial_https_port) if new_remote_serial_enabled and new_remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_COMPAT else ''}\n"
                    f"HTTPS证书: {cert_summary}\n"
                    f"{'Git工作目录: ' + git_workdir_text if new_git_enabled else ''}\n"
                    f"LM Studio API: {new_local_ai.get('LOCAL_AI_API_BASE_URL', '')}\n"
                    f"LM Studio 模型: {new_local_ai.get('LOCAL_AI_API_MODEL', '') or '（自动取当前已加载模型）'}\n"
                    f"知识库存储: {new_local_ai.get('LOCAL_AI_KB_STORAGE_DIR', '')}\n"
                    f"MCP 工具调用: {mcp_enabled_text}\n"
                    f"（[local_ai] 已写入配置文件，网页面板将直接复用 LM Studio 连接）\n\n"
                    f"您可以重新启动服务器使用新配置。"
                )

                app_logger.info("配置已保存到: %s", config_file)
                app_logger.info("根目录: %s", new_root)
                app_logger.info("登录密码长度: %s", len(new_password))
                app_logger.info("管理员密码长度: %s", len(new_admin_password))
                app_logger.info("服务器端口: %s", new_port)
                app_logger.info("关闭行为: %s", close_behavior_text)
                app_logger.info("Git功能: %s", git_enabled_text)
                app_logger.info("远程串口: %s", remote_serial_text)
                app_logger.info("远程串口 HTTPS 模式: %s", remote_serial_mode_text)
                if new_remote_serial_enabled and new_remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_COMPAT:
                    app_logger.info("串口 HTTPS 端口: %s", new_serial_https_port)
                app_logger.info("HTTPS证书: %s", cert_summary)

                # 更新主窗口的关闭行为配置
                self.close_to_tray = new_close_to_tray
                self.server_port = new_port  # 更新端口配置
                self.remote_serial_enabled = new_remote_serial_enabled
                self.remote_serial_https_mode = normalize_remote_serial_https_mode(new_remote_serial_https_mode)
                self.serial_https_port = normalize_serial_https_port(new_serial_https_port, main_port=new_port)
                self.serial_https_active = False
                self.server_scheme = (
                    'https'
                    if new_remote_serial_enabled and self.remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_FULL
                    else 'http'
                )
                self.update_quit_behavior()  # 立即更新QApplication行为
                app_logger.info("[配置更新] 关闭行为已更新: %s", '最小化到托盘' if new_close_to_tray else '直接退出')
                app_logger.info("[配置更新] 服务器端口已更新: %s（需要重启服务器生效）", new_port)
                app_logger.info("[配置更新] Git功能已更新: %s（需要重启服务器生效）", git_enabled_text)
                app_logger.info("[配置更新] 远程串口已更新: %s（需要重启服务器生效）", remote_serial_text)

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
            self.remote_serial_enabled = settings.get('REMOTE_SERIAL_ENABLED', False)
            self.remote_serial_https_mode = normalize_remote_serial_https_mode(
                settings.get('REMOTE_SERIAL_HTTPS_MODE', REMOTE_SERIAL_HTTPS_MODE_FULL)
            )
            self.serial_https_port = normalize_serial_https_port(
                settings.get('SERIAL_HTTPS_PORT', default_serial_https_port(self.server_port)),
                main_port=self.server_port,
            )
            self.serial_https_active = False
            self.server_scheme = (
                'https'
                if self.remote_serial_enabled and self.remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_FULL
                else 'http'
            )
            app_logger.info("[配置] 服务器端口: %s", self.server_port)
            app_logger.info("[配置] 服务器协议: %s", self.server_scheme)
            app_logger.info("[配置] 远程串口: %s", self.remote_serial_enabled)
            app_logger.info("[配置] 远程串口 HTTPS 模式: %s", self.remote_serial_https_mode)
            app_logger.info("[配置] 串口 HTTPS 端口: %s", self.serial_https_port)
        except Exception as e:
            app_logger.warning("[警告] 加载端口配置失败: %s", e)
            self.server_port = 5000
            self.server_scheme = 'http'
            self.remote_serial_enabled = False
            self.remote_serial_https_mode = REMOTE_SERIAL_HTTPS_MODE_FULL
            self.serial_https_port = default_serial_https_port(self.server_port)
            self.serial_https_active = False

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
        <p><b>版本:</b> R1.5 (2026-04-21)</p>
        <p><b>作者:</b> Yobboy Team</p>
        <br>
        <p>一个功能强大的本地文件服务器，支持：</p>
        <ul>
            <li>📁 文件浏览、新建、上传、下载</li>
            <li>🎮 3D模型在线查看（Three.js）</li>
            <li>✏️ 代码在线编辑（CodeMirror）</li>
            <li>📊 Draw.io 离线图表编辑</li>
            <li>🧠 知识库增强、本地 AI 与 MCP 能力完善</li>
            <li>🤖 本地 AI / MCP 辅助问答</li>
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


def get_or_create_local_https_cert(config_dir, local_ips=None):
    """
    Create a persistent local HTTPS certificate when custom cert/key are not configured.
    This avoids re-generating adhoc certs on every start and usually improves first-load latency.
    """
    cert_dir = os.path.join(config_dir, ".https")
    cert_file = os.path.join(cert_dir, "local_https_cert.pem")
    key_file = os.path.join(cert_dir, "local_https_key.pem")

    if os.path.exists(cert_file) and os.path.exists(key_file):
        return cert_file, key_file, False

    try:
        from cryptography import x509
        from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec
    except Exception as e:
        app_logger.error("[serial] Unable to import cryptography modules for local HTTPS cert: %s", e)
        return '', '', False

    try:
        os.makedirs(cert_dir, exist_ok=True)
        private_key = ec.generate_private_key(ec.SECP256R1())

        dns_names = {"localhost"}
        host_name = socket.gethostname().strip()
        if host_name:
            dns_names.add(host_name)

        ip_values = {"127.0.0.1"}
        for ip_text in (local_ips or []):
            ip_text = (ip_text or '').strip()
            if not ip_text:
                continue
            try:
                ip_values.add(str(ipaddress.ip_address(ip_text)))
            except ValueError:
                dns_names.add(ip_text)

        san_entries = [x509.DNSName(name) for name in sorted(dns_names)]
        for ip_text in sorted(ip_values):
            san_entries.append(x509.IPAddress(ipaddress.ip_address(ip_text)))

        subject = issuer = x509.Name([
            x509.NameAttribute(NameOID.COUNTRY_NAME, "CN"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Yobboy File Server"),
            x509.NameAttribute(NameOID.COMMON_NAME, "Yobboy Local HTTPS"),
        ])

        now = datetime.utcnow()
        certificate = (
            x509.CertificateBuilder()
            .subject_name(subject)
            .issuer_name(issuer)
            .public_key(private_key.public_key())
            .serial_number(x509.random_serial_number())
            .not_valid_before(now - timedelta(days=1))
            .not_valid_after(now + timedelta(days=3650))
            .add_extension(x509.SubjectAlternativeName(san_entries), critical=False)
            .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
            .add_extension(
                x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),
                critical=False
            )
            .sign(private_key, hashes.SHA256())
        )

        with open(key_file, "wb") as f:
            f.write(
                private_key.private_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PrivateFormat.PKCS8,
                    encryption_algorithm=serialization.NoEncryption()
                )
            )
        with open(cert_file, "wb") as f:
            f.write(certificate.public_bytes(serialization.Encoding.PEM))

        return cert_file, key_file, True
    except Exception as e:
        app_logger.error("[serial] Failed to create local HTTPS certificate: %s", e)
        return '', '', False


def run_flask_app(info_file_path=None):
    """运行 Flask 应用"""
    # 当从GUI启动时（有info_file_path参数），将debug设为False以避免冲突
    debug = False if info_file_path else True
    # 注意：load_or_create_config 现在在 create_app() 中调用
    application = create_app(debug=debug)

    # === 显示加载的配置信息（写入统一日志，便于 GUI 捕获 stdout）===
    apply_log_level_from_sources(
        ini_level=application.config.get('LOG_LEVEL', 'INFO'),
        app_debug=application.debug,
    )
    app_logger.info("=" * 60)
    app_logger.info("[服务器配置信息]")
    app_logger.info("配置文件路径: %s", application.config.get('CONFIG_FILE'))
    app_logger.info("根目录: %s", application.config.get('ROOT_DIR'))
    app_logger.info("登录密码长度: %s", len(application.config.get('PASSWORD', '') or ''))
    app_logger.info("Git功能: %s", '已启用' if application.config.get('GIT_ENABLED') else '已禁用')
    app_logger.info("Git工作目录: %s", application.config.get('GIT_WORKDIR', '未设置'))
    app_logger.info("Git外部软件路径: %s", application.config.get('GIT_EXTERNAL_APP_PATH', '未设置'))
    app_logger.info(
        "远程串口: %s",
        '已启用' if application.config.get('REMOTE_SERIAL_ENABLED') else '已禁用',
    )
    app_logger.info(
        "串口 HTTPS 模式: %s",
        normalize_remote_serial_https_mode(
            application.config.get('REMOTE_SERIAL_HTTPS_MODE', REMOTE_SERIAL_HTTPS_MODE_FULL)
        ),
    )
    app_logger.info(
        "串口 HTTPS 端口: %s",
        normalize_serial_https_port(
            application.config.get(
                'SERIAL_HTTPS_PORT', default_serial_https_port(application.config.get('PORT', 5000))
            ),
            main_port=application.config.get('PORT', 5000),
        ),
    )
    app_logger.info("=" * 60)

    host = "0.0.0.0"
    port = application.config.get('PORT', 5000)
    remote_serial_enabled = bool(application.config.get('REMOTE_SERIAL_ENABLED', False))
    remote_serial_https_mode = normalize_remote_serial_https_mode(
        application.config.get('REMOTE_SERIAL_HTTPS_MODE', REMOTE_SERIAL_HTTPS_MODE_FULL)
    )
    serial_https_port = normalize_serial_https_port(
        application.config.get('SERIAL_HTTPS_PORT', default_serial_https_port(port)),
        main_port=port,
    )

    settings_data = {
        'CONFIG_FILE': application.config.get('CONFIG_FILE') or get_config_path(),
        'PORT': port,
        'REMOTE_SERIAL_ENABLED': remote_serial_enabled,
        'REMOTE_SERIAL_HTTPS_MODE': remote_serial_https_mode,
        'SERIAL_HTTPS_PORT': serial_https_port,
        'HTTPS_CERT_FILE': application.config.get('HTTPS_CERT_FILE', ''),
        'HTTPS_KEY_FILE': application.config.get('HTTPS_KEY_FILE', ''),
    }
    runtime_info = inspect_https_runtime(settings_data, verify_cert_pair=True)
    remote_ssl_context = None
    remote_cert_source = 'none'
    if remote_serial_enabled:
        runtime_info, remote_ssl_context, remote_cert_source = prepare_https_runtime(settings_data)

    def log_remote_https_runtime():
        if remote_ssl_context is None:
            return
        if remote_cert_source == 'configured':
            app_logger.info("[serial] HTTPS enabled with configured certificate files.")
            return
        if runtime_info['cert_exists'] and runtime_info['key_exists'] and not runtime_info['cert_pair_ok']:
            app_logger.warning(
                "[serial] HTTPS cert/key files exist but cannot be loaded, fallback certificate will be used. cert=%s, key=%s, error=%s",
                runtime_info['resolved_cert_file'],
                runtime_info['resolved_key_file'],
                runtime_info['cert_pair_error'],
            )
        elif runtime_info['resolved_cert_file'] or runtime_info['resolved_key_file']:
            app_logger.warning(
                "[serial] HTTPS cert/key not ready, fallback certificate will be used. cert=%s (exists=%s), key=%s (exists=%s)",
                runtime_info['resolved_cert_file'] or "(empty)",
                runtime_info['cert_exists'],
                runtime_info['resolved_key_file'] or "(empty)",
                runtime_info['key_exists'],
            )
        if remote_cert_source == 'generated':
            if runtime_info.get('auto_cert_created'):
                app_logger.info(
                    "[serial] Generated local HTTPS certificate: cert=%s, key=%s",
                    runtime_info.get('auto_cert_file'),
                    runtime_info.get('auto_key_file'),
                )
            else:
                app_logger.info("[serial] HTTPS enabled with local persistent certificate.")
        elif remote_cert_source == 'adhoc':
            app_logger.info("[serial] HTTPS enabled with adhoc certificate.")

    primary_scheme = 'http'
    primary_ssl_context = None
    serial_https_active = False
    serial_websocket_scheme = 'ws'

    if remote_serial_enabled:
        if remote_ssl_context is not None:
            log_remote_https_runtime()
            serial_websocket_scheme = 'wss'
            if remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_FULL:
                primary_scheme = 'https'
                primary_ssl_context = remote_ssl_context
                serial_https_active = True
            else:
                serial_https_active = True
        else:
            app_logger.error(
                "[serial] remote_serial_enabled=true 但当前无法启动 HTTPS。mode=%s",
                remote_serial_https_mode,
            )
            app_logger.error(
                "[serial] 如需 HTTPS，请安装 cryptography 或在 config.ini 配置 https_cert_file/https_key_file。"
            )
            app_logger.warning(
                "远程串口已启用，但当前无法启动 HTTPS：缺少 cryptography 且未配置有效证书。"
            )
            app_logger.warning("请执行: pip install cryptography")
            app_logger.warning("或在 config.ini 设置 https_cert_file / https_key_file 后重启服务。")

    if (
        remote_serial_enabled
        and remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_COMPAT
        and serial_https_active
        and not can_bind_tcp_port(host, serial_https_port)
    ):
        serial_https_active = False
        serial_websocket_scheme = 'ws'
        app_logger.error(
            "[serial] Compatibility HTTPS port is already in use: %s",
            serial_https_port,
        )
        app_logger.warning(
            "串口 HTTPS 端口 %s 已被占用，兼容模式下的 HTTPS 入口未启动。",
            serial_https_port,
        )

    application.config['SERVER_SCHEME'] = primary_scheme
    application.config['PRIMARY_SERVER_SCHEME'] = primary_scheme
    application.config['REMOTE_SERIAL_HTTPS_MODE'] = remote_serial_https_mode
    application.config['SERIAL_HTTPS_PORT'] = serial_https_port
    application.config['SERIAL_HTTPS_ACTIVE'] = serial_https_active

    local_ips = get_local_ips()
    app_logger.info(" * Running on all addresses (%s)", host)

    if remote_serial_enabled and remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_COMPAT:
        for ip in local_ips:
            if ip != '0.0.0.0':
                app_logger.info(" * Main site: http://%s:%s", ip, port)
        app_logger.info(" * Main WebSocket endpoint: ws://<server>:%s/serial", port)
        if serial_https_active:
            for ip in local_ips:
                if ip != '0.0.0.0':
                    app_logger.info(" * Serial HTTPS: https://%s:%s/serial_tool", ip, serial_https_port)
            app_logger.info(" * Serial WebSocket endpoint: wss://<server>:%s/serial", serial_https_port)
        else:
            app_logger.info("[说明] 当前兼容模式仅启动 HTTP 主站，串口 HTTPS 入口尚未就绪。")
    else:
        for ip in local_ips:
            if ip != '0.0.0.0':
                app_logger.info(" * Running on %s://%s:%s", primary_scheme, ip, port)
        app_logger.info(
            " * WebSocket endpoint: %s://<server>:%s/serial", serial_websocket_scheme, port
        )

    sys.stdout.flush()

    if remote_serial_enabled and remote_serial_https_mode == REMOTE_SERIAL_HTTPS_MODE_COMPAT and serial_https_active:
        def run_serial_https_listener():
            try:
                run_kwargs = {
                    'host': host,
                    'port': serial_https_port,
                    'debug': False,
                    'use_reloader': False,
                    'allow_unsafe_werkzeug': True,
                    'log_output': False,
                    'ssl_context': remote_ssl_context,
                }
                application.socketio.run(application, **run_kwargs)
            except Exception as e:
                app_logger.error("[serial] Failed to start compatibility HTTPS listener: %s", e)
                app_logger.error("兼容模式下的串口 HTTPS 监听启动失败: %s", e)

        serial_https_thread = threading.Thread(
            target=run_serial_https_listener,
            name='serial-https-listener',
            daemon=True,
        )
        serial_https_thread.start()

    # 使用 socketio.run 而不是 app.run
    # 添加 use_reloader=False 以加快启动速度（避免自动检测和重载机制）
    run_kwargs = {
        'host': host,
        'port': port,
        'debug': debug,
        'use_reloader': False,  # 禁用自动重载，加快启动
        'allow_unsafe_werkzeug': True,
        'log_output': False
    }
    if primary_ssl_context is not None:
        run_kwargs['ssl_context'] = primary_ssl_context
    application.socketio.run(application, **run_kwargs)


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'run':
        info_file_path = sys.argv[2] if len(sys.argv) > 2 else None
        run_flask_app(info_file_path)
    else:
        app = QApplication(sys.argv)
        window = MainWindow()
        window.show()
        sys.exit(app.exec_())
