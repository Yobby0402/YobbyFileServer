"""服务器端串口管理器，支持多监听器与持续日志捕获"""

from __future__ import annotations

import json
import os
import serial
import serial.tools.list_ports
import sys
import threading
import time
from collections import defaultdict, deque
from datetime import datetime
from typing import Callable, Dict, List, Optional


class SerialPortManager:
    """负责服务器侧串口管理、监听分发与持续日志记录。"""

    def __init__(self) -> None:
        self.ports: Dict[str, Dict] = {}
        self.reading_threads: Dict[str, Dict] = {}
        self.callbacks: Dict[str, Callable] = {}  # 聚合回调
        self.listeners: Dict[str, Dict[str, Callable]] = defaultdict(dict)
        self.log_sessions: Dict[str, Dict] = {}
        self.running = True
        self._lock = threading.RLock()

        base_dir = self._get_base_dir()
        self.log_root = os.path.join(base_dir, "logs", "serial_capture")
        os.makedirs(self.log_root, exist_ok=True)

    # ------------------------------------------------------------------ #
    # 基础能力
    # ------------------------------------------------------------------ #
    def list_available_ports(self) -> List[Dict]:
        """列出可用串口信息。"""
        ports = []
        for port in serial.tools.list_ports.comports():
            ports.append(
                {
                    "device": port.device,
                    "name": port.description,
                    "hwid": port.hwid,
                    "vid": port.vid,
                    "pid": port.pid,
                    "serial_number": port.serial_number,
                    "manufacturer": port.manufacturer,
                    "product": port.product,
                }
            )
        return ports

    def open_port(
        self,
        port_id: str,
        device: str,
        baudrate: int = 9600,
        bytesize: int = 8,
        parity: str = "N",
        stopbits: int = 1,
        timeout: float = 1,
        listener_id: Optional[str] = None,
        callback: Optional[Callable[[str, bytes], None]] = None,
    ) -> bool:
        """
        打开串口或为已打开串口注册监听器。
        """
        with self._lock:
            if port_id in self.ports:
                # 串口已打开，仅添加监听器
                if listener_id and callback:
                    self.listeners[port_id][listener_id] = callback
                return True

            try:
                ser = serial.Serial(
                    port=device,
                    baudrate=baudrate,
                    bytesize=bytesize,
                    parity=parity,
                    stopbits=stopbits,
                    timeout=timeout,
                )
            except serial.SerialException as exc:
                print(f"[错误] 打开串口失败 {device}: {exc}")
                return False

            self.ports[port_id] = {
                "serial": ser,
                "device": device,
                "baudrate": baudrate,
                "bytesize": bytesize,
                "parity": parity,
                "stopbits": stopbits,
                "timeout": timeout,
                "opened_at": datetime.utcnow(),
                "rx_bytes": 0,
                "tx_bytes": 0,
            }

            dispatcher = self._build_dispatcher(port_id)
            self.callbacks[port_id] = dispatcher
            self.listeners[port_id] = {}

            if listener_id and callback:
                self.listeners[port_id][listener_id] = callback

            self._start_reading_thread(port_id)
            print(f"[成功] 串口 {device} 已打开 (ID: {port_id})")
            return True

    def release_port(
        self, port_id: str, listener_id: Optional[str] = None, force: bool = False
    ) -> bool:
        """
        释放监听器；必要时关闭串口。
        """
        with self._lock:
            if port_id not in self.ports:
                return False

            if listener_id:
                self.listeners.get(port_id, {}).pop(listener_id, None)

            should_close = force or (
                not self.listeners.get(port_id) and port_id not in self.log_sessions
            )
            if should_close:
                return self._close_port_locked(port_id)
            return False

    def close_port(self, port_id: str) -> bool:
        """强制关闭串口并停止日志。"""
        return self.release_port(port_id, force=True)

    def write_data(self, port_id: str, data: bytes) -> int:
        """向串口写入数据。"""
        with self._lock:
            if port_id not in self.ports:
                print(f"[警告] 串口 {port_id} 不存在")
                return -1

            ser = self.ports[port_id]["serial"]
            if not ser.is_open:
                print(f"[警告] 串口 {port_id} 未打开")
                return -1

            try:
                bytes_written = ser.write(data)
                self.ports[port_id]["tx_bytes"] += bytes_written
                self._append_log_entry(port_id, "tx", data)
                return bytes_written
            except Exception as exc:  # pylint: disable=broad-except
                print(f"[错误] 写入数据失败: {exc}")
                return -1

    def get_port_info(self, port_id: str) -> Optional[Dict]:
        """获取串口信息（可序列化）。"""
        with self._lock:
            if port_id not in self.ports:
                return None
            info = self.ports[port_id].copy()
            info.pop("serial", None)
            info["opened_at"] = info["opened_at"].isoformat() + "Z"
            info["logging"] = port_id in self.log_sessions
            return info

    def get_all_ports_info(self) -> Dict[str, Dict]:
        with self._lock:
            return {pid: self.get_port_info(pid) for pid in self.ports}

    def close_all(self) -> None:
        for port_id in list(self.ports.keys()):
            self.close_port(port_id)
        print("[关闭] 所有串口已关闭")

    # ------------------------------------------------------------------ #
    # 持续日志
    # ------------------------------------------------------------------ #
    def start_logging(
        self,
        device: str,
        baudrate: int,
        bytesize: int = 8,
        parity: str = "N",
        stopbits: int = 1,
        port_id: Optional[str] = None,
    ) -> Dict:
        """
        为指定串口开启持续日志。若串口未打开，会自动打开。
        """
        target_port_id = port_id or self.generate_port_id(device, baudrate)

        with self._lock:
            if target_port_id in self.log_sessions:
                session_copy = self.log_sessions[target_port_id].copy()
                session_copy.pop("file_handle", None)
                return session_copy
            # 若串口未打开则打开
            self.open_port(
                target_port_id,
                device,
                baudrate=baudrate,
                bytesize=bytesize,
                parity=parity,
                stopbits=stopbits,
                listener_id=None,
                callback=None,
            )

            port_info = self.ports[target_port_id]

            # 校验配置是否一致
            if (
                port_info["device"] != device
                or port_info["baudrate"] != baudrate
                or port_info["bytesize"] != bytesize
                or port_info["parity"] != parity
                or port_info["stopbits"] != stopbits
            ):
                raise ValueError("串口已以不同配置运行，无法开启日志")

            log_dir = self._ensure_log_dir(target_port_id, device)
            filename = datetime.utcnow().strftime("%Y-%m-%d") + ".jsonl"
            filepath = os.path.join(log_dir, filename)

            file_handle = open(filepath, "a", encoding="utf-8")  # noqa: SIM115

            session = {
                "port_id": target_port_id,
                "device": device,
                "config": {
                    "baudrate": baudrate,
                    "bytesize": bytesize,
                    "parity": parity,
                    "stopbits": stopbits,
                },
                "directory": log_dir,
                "file_path": filepath,
                "file_handle": file_handle,
                "started_at": datetime.utcnow().isoformat() + "Z",
                "last_write": None,
                "bytes_logged": 0,
            }
            self.log_sessions[target_port_id] = session
            print(f"[日志] 启动串口 {device} 持续日志 -> {filepath}")
            return session.copy()

    def stop_logging(self, port_id: str) -> bool:
        with self._lock:
            session = self.log_sessions.pop(port_id, None)
            if not session:
                return False
            handle = session.get("file_handle")
            if handle:
                handle.flush()
                handle.close()
            # 如果没有其他监听器，则关闭串口
            if not self.listeners.get(port_id):
                self._close_port_locked(port_id)
            print(f"[日志] 停止串口 {port_id} 持续日志")
            return True

    def get_logging_status(self) -> List[Dict]:
        with self._lock:
            status = []
            for port_id, session in self.log_sessions.items():
                info = session.copy()
                info.pop("file_handle", None)
                status.append(info)
            return status

    def read_log_entries(
        self,
        port_id: str,
        limit: int = 500,
        since: Optional[str] = None,
    ) -> List[Dict]:
        """读取指定端口当前日志（按时间顺序）。"""
        directory = self._ensure_log_dir(port_id)
        # 默认为当日文件
        filename = datetime.utcnow().strftime("%Y-%m-%d") + ".jsonl"
        filepath = os.path.join(directory, filename)

        if not os.path.exists(filepath):
            return []

        if since:
            since_ts = since
        else:
            since_ts = None

        result: List[Dict] = []
        if limit:
            with open(filepath, "r", encoding="utf-8") as fh:
                lines = deque(fh, maxlen=limit)
        else:
            with open(filepath, "r", encoding="utf-8") as fh:
                lines = list(fh)

        for raw_line in lines:
            line = raw_line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if since_ts and entry.get("ts") <= since_ts:
                continue
            result.append(entry)
        return result

    def list_log_files(self, port_id: str) -> List[Dict]:
        directory = self._ensure_log_dir(port_id)
        files = []
        if os.path.exists(directory):
            for filename in os.listdir(directory):
                if not filename.endswith(".jsonl"):
                    continue
                path = os.path.join(directory, filename)
                stat = os.stat(path)
                files.append(
                    {
                        "filename": filename,
                        "modified": datetime.utcfromtimestamp(stat.st_mtime).isoformat()
                        + "Z",
                        "size": stat.st_size,
                    }
                )
        files.sort(key=lambda item: item["modified"], reverse=True)
        return files

    # ------------------------------------------------------------------ #
    # 内部工具
    # ------------------------------------------------------------------ #
    def _start_reading_thread(self, port_id: str) -> None:
        thread_info = {"running": True, "thread": None}

        def read_loop() -> None:
            while thread_info["running"]:
                try:
                    with self._lock:
                        if port_id not in self.ports:
                            break
                        ser = self.ports[port_id]["serial"]
                    if ser.is_open and ser.in_waiting > 0:
                        data = ser.read(ser.in_waiting)
                        if data:
                            with self._lock:
                                if port_id in self.ports:
                                    self.ports[port_id]["rx_bytes"] += len(data)
                            dispatcher = self.callbacks.get(port_id)
                            if dispatcher:
                                dispatcher(port_id, data)
                    time.sleep(0.01)
                except Exception as exc:  # pylint: disable=broad-except
                    print(f"[错误] 读取串口 {port_id} 数据失败: {exc}")
                    time.sleep(0.1)

        thread = threading.Thread(target=read_loop, daemon=True)
        thread.start()
        thread_info["thread"] = thread
        self.reading_threads[port_id] = thread_info
        print(f"[启动] 串口 {port_id} 读取线程已启动")

    def _build_dispatcher(self, port_id: str) -> Callable[[str, bytes], None]:
        def dispatcher(pid: str, data: bytes) -> None:
            self._append_log_entry(pid, "rx", data)
            listeners = list(self.listeners.get(pid, {}).values())
            for callback in listeners:
                try:
                    callback(pid, data)
                except Exception as exc:  # pylint: disable=broad-except
                    print(f"[错误] 监听回调执行失败: {exc}")

        return dispatcher

    def _append_log_entry(self, port_id: str, direction: str, data: bytes) -> None:
        session = self.log_sessions.get(port_id)
        if not session:
            return
        entry = {
            "ts": datetime.utcnow().isoformat() + "Z",
            "dir": direction,
            "hex": data.hex(),
            "text": data.decode("utf-8", errors="replace"),
        }
        handle = session.get("file_handle")
        if handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
            handle.flush()
        session["last_write"] = entry["ts"]
        session["bytes_logged"] += len(data)

    def _close_port_locked(self, port_id: str) -> bool:
        if port_id not in self.ports:
            return False

        session = self.log_sessions.pop(port_id, None)
        if session and session.get("file_handle"):
            try:
                session["file_handle"].flush()
                session["file_handle"].close()
            except Exception:  # pylint: disable=broad-except
                pass

        thread_info = self.reading_threads.pop(port_id, None)
        if thread_info:
            thread_info["running"] = False
            thread = thread_info.get("thread")
            if thread and thread.is_alive():
                thread.join(timeout=2)

        info = self.ports.pop(port_id)
        self.listeners.pop(port_id, None)
        self.callbacks.pop(port_id, None)
        ser = info["serial"]
        try:
            if ser.is_open:
                ser.close()
        finally:
            print(f"[关闭] 串口 {port_id} 已释放")
        return True

    def _get_base_dir(self) -> str:
        if getattr(sys, "frozen", False):
            return os.path.dirname(sys.executable)
        return os.path.dirname(os.path.abspath(__file__))

    def _ensure_log_dir(self, port_id: str, device: Optional[str] = None) -> str:
        name = port_id
        if device:
            name = self._sanitize_component(device)
        directory = os.path.join(self.log_root, name)
        os.makedirs(directory, exist_ok=True)
        return directory

    @staticmethod
    def _sanitize_component(text: str) -> str:
        sanitized = "".join(ch if ch.isalnum() else "_" for ch in text)
        while "__" in sanitized:
            sanitized = sanitized.replace("__", "_")
        return sanitized.strip("_") or "serial"

    # ------------------------------------------------------------------ #
    # 辅助工具
    # ------------------------------------------------------------------ #
    def generate_port_id(self, device: str, baudrate: int) -> str:
        base = self._sanitize_component(device)
        return f"remote_{base}_{baudrate}"


# 全局串口管理器实例
serial_manager = SerialPortManager()

