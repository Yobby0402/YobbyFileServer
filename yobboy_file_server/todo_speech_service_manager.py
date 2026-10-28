from __future__ import annotations

import atexit
import json
import logging
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from datetime import datetime
from typing import Any, Dict, Optional
from urllib.parse import urlsplit, urlunsplit
from urllib.request import urlopen

from .paths import get_data_path, project_path


_log = logging.getLogger("yobboy_file_server.todo_speech_service")


def speech_status_file_path() -> str:
    return get_data_path("todos", "speech_service_status.json", create_parent=True)


def speech_service_log_file_path() -> str:
    return get_data_path("todos", "speech_service.log", create_parent=True)


def read_speech_service_status(status_path: str, enabled: bool) -> Dict[str, Any]:
    if not enabled:
        return {"state": "disabled", "message": "语音记录未启用", "reachable": False}
    try:
        with open(status_path, "r", encoding="utf-8") as source:
            status = json.load(source)
        if isinstance(status, dict):
            return status
    except (OSError, ValueError, json.JSONDecodeError):
        pass
    return {"state": "stopped", "message": "等待录音或上传后自动启动", "reachable": False}


class TodoSpeechServiceManager:
    """Own the optional local speech process without starting it during app boot."""

    def __init__(
        self,
        enabled: bool,
        service_url: str,
        timeout_seconds: int = 900,
        idle_shutdown_seconds: int = 60,
        status_path: Optional[str] = None,
        model_dir: str = "",
    ) -> None:
        self.enabled = bool(enabled)
        self.service_url = str(service_url or "").strip()
        self.timeout_seconds = max(30, int(timeout_seconds or 900))
        self.idle_shutdown_seconds = max(10, int(idle_shutdown_seconds or 60))
        self.status_path = status_path or speech_status_file_path()
        self.model_dir = str(model_dir or "").strip()
        self.log_path = speech_service_log_file_path()
        self._lock = threading.RLock()
        self._process: Optional[subprocess.Popen] = None
        self._idle_timer: Optional[threading.Timer] = None
        self._recording_leases: Dict[str, threading.Timer] = {}
        self._work_active = False
        atexit.register(self.stop)

    def _write_status(self, state: str, message: str = "", **extra: Any) -> None:
        temporary_path = ""
        try:
            directory = os.path.dirname(self.status_path)
            os.makedirs(directory, exist_ok=True)
            payload = {
                "state": state,
                "message": message,
                "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            }
            payload.update(extra)
            descriptor, temporary_path = tempfile.mkstemp(
                prefix=".todo-speech-status.", suffix=".tmp", dir=directory
            )
            with os.fdopen(descriptor, "w", encoding="utf-8") as target:
                json.dump(payload, target, ensure_ascii=False)
            for attempt in range(8):
                try:
                    os.replace(temporary_path, self.status_path)
                    temporary_path = ""
                    return
                except PermissionError:
                    if attempt == 7:
                        _log.warning("无法更新语音服务状态文件：%s", self.status_path)
                        return
                    time.sleep(0.05 * (attempt + 1))
        except OSError as exc:
            _log.warning("无法更新语音服务状态文件：%s", exc)
        finally:
            if temporary_path and os.path.exists(temporary_path):
                os.remove(temporary_path)

    def _service_parts(self):
        parsed = urlsplit(self.service_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise RuntimeError("语音服务地址无效")
        return parsed

    def _uses_local_process(self) -> bool:
        return self._service_parts().hostname in {"127.0.0.1", "localhost"}

    def _health_url(self) -> str:
        parsed = self._service_parts()
        return urlunsplit((parsed.scheme, parsed.netloc, "/health", "", ""))

    def _probe_health(self) -> Dict[str, Any]:
        try:
            with urlopen(self._health_url(), timeout=1.5) as response:
                payload = json.loads(response.read().decode("utf-8"))
            if isinstance(payload, dict):
                payload["reachable"] = True
                return payload
        except Exception:
            pass
        return {"reachable": False}

    @staticmethod
    def _bootstrap_python() -> str:
        candidates = [
            os.environ.get("TODO_SPEECH_PYTHON", ""),
            r"C:\Users\48043\AppData\Local\Programs\Python\Python310\python.exe",
        ]
        if sys.version_info[:2] == (3, 10):
            candidates.append(sys.executable)
        candidates.extend(filter(None, [shutil.which("python3.10")]))
        for candidate in candidates:
            if candidate and os.path.isfile(candidate):
                return candidate
        raise RuntimeError("未找到 Python 3.10。请安装 Python 3.10 或设置 TODO_SPEECH_PYTHON。")

    def _is_process_running(self) -> bool:
        return bool(self._process and self._process.poll() is None)

    def _speech_service_directory(self) -> str:
        """Locate the separately deployed Python 3.10 speech service."""
        configured_directory = os.environ.get("TODO_SPEECH_SERVICE_DIR", "").strip()
        executable_directory = os.path.dirname(os.path.abspath(sys.executable)) if sys.executable else ""
        package_parent = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
        bundle_directory = str(getattr(sys, "_MEIPASS", "") or "")
        candidates = (
            configured_directory,
            project_path("speech_service"),
            os.path.join(executable_directory, "speech_service"),
            os.path.join(bundle_directory, "speech_service"),
            os.path.join(package_parent, "speech_service"),
            os.path.join(os.getcwd(), "speech_service"),
        )
        seen = set()
        for candidate in candidates:
            if not candidate:
                continue
            directory = os.path.normcase(os.path.abspath(os.path.expandvars(os.path.expanduser(candidate))))
            if directory in seen:
                continue
            seen.add(directory)
            if os.path.isfile(os.path.join(directory, "launcher.py")):
                return directory
        raise RuntimeError(
            "找不到语音服务目录。请将 speech_service 文件夹放在程序 EXE 同级目录后重试。"
        )

    def _last_log_line(self) -> str:
        try:
            with open(self.log_path, "rb") as source:
                source.seek(0, os.SEEK_END)
                source.seek(max(0, source.tell() - 8192))
                lines = source.read().decode("utf-8", errors="replace").splitlines()
            return next((line.strip() for line in reversed(lines) if line.strip()), "")
        except OSError:
            return ""

    def _mark_exited_process_failed(self) -> None:
        if not self._uses_local_process():
            return
        process = self._process
        if not process or process.poll() is None:
            return
        status = read_speech_service_status(self.status_path, self.enabled)
        if status.get("state") in {"failed", "stopped", "disabled"}:
            return
        detail = self._last_log_line()
        message = f"本地语音服务意外退出（退出码 {process.returncode}）"
        if detail:
            message = f"{message}：{detail[:500]}"
        self._write_status("failed", message, log_path=self.log_path)

    def _schedule_idle_if_inactive(self) -> None:
        if not self._recording_leases and not self._work_active:
            self.schedule_idle_shutdown()

    def ensure_started(self) -> Dict[str, Any]:
        if not self.enabled:
            raise RuntimeError("本地语音转写服务未启用")
        self.cancel_idle_shutdown()
        health = self._probe_health()
        if health.get("reachable"):
            return self.status()
        if not self._uses_local_process():
            self._write_status("starting", "正在等待 Docker 语音服务就绪")
            return self.status()
        with self._lock:
            if not self._is_process_running():
                parsed = self._service_parts()
                try:
                    service_directory = self._speech_service_directory()
                except RuntimeError as exc:
                    self._write_status("failed", str(exc), log_path=self.log_path)
                    raise
                launcher = os.path.join(service_directory, "launcher.py")
                environment = os.environ.copy()
                environment.update(
                    {
                        "TODO_SPEECH_STATUS_FILE": self.status_path,
                        "TODO_SPEECH_HOST": parsed.hostname or "127.0.0.1",
                        "TODO_SPEECH_PORT": str(parsed.port or 8899),
                        "TODO_SPEECH_DEVICE": environment.get("TODO_SPEECH_DEVICE", "cuda:0"),
                        "TODO_SPEECH_MODEL_DIR": self.model_dir,
                    }
                )
                os.makedirs(os.path.dirname(self.log_path), exist_ok=True)
                log_file = open(self.log_path, "ab")
                kwargs: Dict[str, Any] = {
                    "cwd": service_directory,
                    "env": environment,
                    "stdout": log_file,
                    "stderr": subprocess.STDOUT,
                }
                if os.name == "nt":
                    kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                try:
                    try:
                        self._process = subprocess.Popen([self._bootstrap_python(), launcher], **kwargs)
                    except OSError as exc:
                        message = f"无法启动本地语音服务：{exc}"
                        self._write_status("failed", message, log_path=self.log_path)
                        raise RuntimeError(message) from exc
                finally:
                    log_file.close()
                self._write_status(
                    "starting",
                    "正在启动本地语音服务",
                    pid=self._process.pid,
                    log_path=self.log_path,
                )
        return self.status()

    def wait_until_ready(self) -> None:
        self.ensure_started()
        # The first CUDA/runtime download can take longer than an individual
        # transcription request, especially on a constrained network.
        deadline = time.monotonic() + max(self.timeout_seconds, 3600)
        while time.monotonic() < deadline:
            health = self._probe_health()
            if health.get("reachable") and health.get("state") == "ready":
                return
            self._mark_exited_process_failed()
            status = self.status()
            if status.get("state") == "failed":
                raise RuntimeError(status.get("message") or "本地语音服务启动失败")
            time.sleep(1)
        raise RuntimeError("等待本地语音服务就绪超时")

    def status(self) -> Dict[str, Any]:
        self._mark_exited_process_failed()
        status = read_speech_service_status(self.status_path, self.enabled)
        health = self._probe_health() if self.enabled else {"reachable": False}
        if health.get("reachable"):
            status.update(
                {
                    "reachable": True,
                    "state": health.get("state", status.get("state", "ready")),
                    "error": health.get("error", ""),
                }
            )
        else:
            status["reachable"] = False
        return status

    def work_enqueued(self) -> None:
        with self._lock:
            self._work_active = True
        try:
            if not self._probe_health().get("reachable"):
                self.ensure_started()
        except Exception as exc:
            _log.warning("无法启动本地语音服务: %s", exc)
            self._write_status("failed", str(exc))

    def begin_recording(self) -> str:
        """Keep the lazily started service alive while a browser recording is in progress."""
        self.ensure_started()
        lease_id = secrets.token_urlsafe(16)
        expiry = threading.Timer(max(3600, self.timeout_seconds), self.finish_recording, args=(lease_id,))
        expiry.daemon = True
        with self._lock:
            self._recording_leases[lease_id] = expiry
        expiry.start()
        return lease_id

    def finish_recording(self, lease_id: str) -> None:
        with self._lock:
            expiry = self._recording_leases.pop(lease_id, None)
            if expiry:
                expiry.cancel()
            self._schedule_idle_if_inactive()

    def schedule_idle_shutdown(self) -> None:
        if not self.enabled or not self._uses_local_process():
            return
        with self._lock:
            self._work_active = False
            if self._recording_leases:
                return
            if self._idle_timer:
                self._idle_timer.cancel()
            self._idle_timer = threading.Timer(self.idle_shutdown_seconds, self.stop)
            self._idle_timer.daemon = True
            self._idle_timer.start()

    def cancel_idle_shutdown(self) -> None:
        with self._lock:
            if self._idle_timer:
                self._idle_timer.cancel()
                self._idle_timer = None

    def stop(self) -> None:
        with self._lock:
            self.cancel_idle_shutdown()
            for expiry in self._recording_leases.values():
                expiry.cancel()
            self._recording_leases.clear()
            self._work_active = False
            process = self._process
            self._process = None
        if process and process.poll() is None:
            if os.name == "nt":
                # Uvicorn starts a child interpreter on Windows. Terminating
                # only the launcher leaves that child listening on port 8899.
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    check=False,
                )
            else:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
        if not self._uses_local_process():
            return
        existing = read_speech_service_status(self.status_path, self.enabled)
        if process and existing.get("state") != "failed":
            self._write_status("stopped", "当前没有待转写任务，语音服务已停止")
