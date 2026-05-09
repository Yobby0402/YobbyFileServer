# logging_setup.py — 统一应用日志（文件轮转、控制台、等级、TTY 着色）
import logging
import os
import sys
from logging.handlers import TimedRotatingFileHandler

from .paths import get_logs_dir as get_runtime_logs_dir

try:
    import colorama  # noqa: F401
    from colorama import just_fix_windows_console

    just_fix_windows_console()
except ImportError:
    pass

APP_LOGGER_NAME = "yobboy_file_server"
CONNECTION_LOGGER_NAME = "file_server_connections"

_LEVEL_NAMES = {
    "CRITICAL": logging.CRITICAL,
    "ERROR": logging.ERROR,
    "WARNING": logging.WARNING,
    "WARN": logging.WARNING,
    "INFO": logging.INFO,
    "DEBUG": logging.DEBUG,
    "NOTSET": logging.NOTSET,
}


def parse_log_level(value, default=logging.INFO):
    """解析日志等级字符串，非法时返回 default。"""
    if value is None:
        return default
    s = str(value).strip().upper()
    if not s:
        return default
    return _LEVEL_NAMES.get(s, default)


def get_logs_dir():
    """日志目录：优先 exe/py 旁 logs，不可写则 ~/.yobboy_file_server/logs"""
    logs_dir = get_runtime_logs_dir(create=False)
    try:
        os.makedirs(logs_dir, exist_ok=True)
        test_file = os.path.join(logs_dir, ".test")
        with open(test_file, "w", encoding="utf-8"):
            pass
        os.remove(test_file)
        return logs_dir
    except OSError:
        logs_dir = os.path.join(os.path.expanduser("~"), ".yobboy_file_server", "logs")
        os.makedirs(logs_dir, exist_ok=True)
        return logs_dir


def _create_rotating_handler(log_file, level=logging.INFO, delay=True):
    handler = TimedRotatingFileHandler(
        filename=log_file,
        when="midnight",
        interval=1,
        backupCount=14,
        encoding="utf-8",
        delay=delay,
    )
    handler.suffix = "%Y-%m-%d"
    handler.setLevel(level)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s - %(levelname)s - %(name)s - %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    return handler


class _LevelColoredFormatter(logging.Formatter):
    """在支持 TTY 时为 levelname 着色（管道/GUI 捕获 stdout 时 use_color=False）。"""

    _COLORS = {
        "DEBUG": "\033[36m",
        "INFO": "\033[32m",
        "WARNING": "\033[33m",
        "ERROR": "\033[31m",
        "CRITICAL": "\033[35m",
    }
    _RESET = "\033[0m"

    def __init__(self, fmt, datefmt, use_color):
        super().__init__(fmt, datefmt)
        self.use_color = use_color

    def format(self, record):
        text = super().format(record)
        if not self.use_color:
            return text
        c = self._COLORS.get(record.levelname)
        if not c:
            return text
        return f"{c}{text}{self._RESET}"


def _has_rotating_for_file(logger, basename):
    for h in logger.handlers:
        if isinstance(h, TimedRotatingFileHandler):
            try:
                if os.path.basename(getattr(h, "baseFilename", "") or "") == basename:
                    return True
            except Exception:
                continue
    return False


def _has_stream_to_stdout(logger):
    for h in logger.handlers:
        if isinstance(h, logging.StreamHandler):
            stream = getattr(h, "stream", None)
            if stream is sys.stdout:
                return True
    return False


def ensure_app_file_handler(log_dir=None):
    """确保 yobboy_file_server 有 app.log 轮转文件 handler。"""
    log_dir = log_dir or get_logs_dir()
    root = logging.getLogger(APP_LOGGER_NAME)
    if not _has_rotating_for_file(root, "app.log"):
        root.addHandler(_create_rotating_handler(os.path.join(log_dir, "app.log"), logging.INFO))
    root.propagate = False


def ensure_console_handler(stream=None, force_plain=False):
    """为应用 logger 添加 stdout StreamHandler（管道下无 ANSI）。"""
    stream = stream or sys.stdout
    root = logging.getLogger(APP_LOGGER_NAME)
    if _has_stream_to_stdout(root):
        return
    use_color = (not force_plain) and stream.isatty()
    fmt = "%(asctime)s %(levelname)s %(name)s %(message)s"
    datefmt = "%Y-%m-%d %H:%M:%S"
    handler = logging.StreamHandler(stream)
    handler.setLevel(logging.DEBUG)
    handler.setFormatter(_LevelColoredFormatter(fmt, datefmt, use_color))
    root.addHandler(handler)


connection_logger = logging.getLogger(CONNECTION_LOGGER_NAME)
connection_logger.setLevel(logging.INFO)
connection_logger.propagate = False

_logs_dir_cached = None


def ensure_connection_logger_handler():
    """懒加载 access.log，避免 GUI 主进程占用句柄导致子进程轮转失败。"""
    global _logs_dir_cached
    if connection_logger.handlers:
        return
    _logs_dir_cached = get_logs_dir()
    connection_logger.addHandler(
        _create_rotating_handler(os.path.join(_logs_dir_cached, "access.log"), logging.INFO, delay=True)
    )


def apply_log_level_from_sources(ini_level=None, app_debug=False):
    """
    设置应用日志等级。环境变量 YOBBY_LOG_LEVEL 优先于 ini。
    app_debug=True 时强制为 DEBUG（Flask debug 子进程）。
    """
    env = (os.environ.get("YOBBY_LOG_LEVEL") or "").strip()
    if env:
        level = parse_log_level(env)
    else:
        level = parse_log_level(ini_level or "INFO")
    if app_debug:
        level = logging.DEBUG
    root = logging.getLogger(APP_LOGGER_NAME)
    root.setLevel(level)
    for h in root.handlers:
        h.setLevel(logging.DEBUG)


def configure_flask_app_logger(app):
    """使 Flask app.logger 作为 yobboy_file_server 子树，复用同一套 handlers。"""
    app.logger.handlers.clear()
    app.logger.propagate = True
    app.logger.setLevel(logging.NOTSET)


# 模块导入时：文件日志 + 控制台（着色仅 TTY）
ensure_app_file_handler()
ensure_console_handler()

app_logger = logging.getLogger(APP_LOGGER_NAME)
apply_log_level_from_sources(ini_level="INFO")
