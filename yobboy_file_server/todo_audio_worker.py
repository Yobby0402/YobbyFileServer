from __future__ import annotations

import http.client
import json
import logging
import os
import queue
import subprocess
import tempfile
import threading
import wave
from typing import Any, Callable, Dict, Optional
from urllib.parse import urlparse

from .todo_audio_manager import TodoAudioManager
from .todo_extended_manager import TodoExtendedManager


_log = logging.getLogger("yobboy_file_server.todo_audio_worker")


class TodoAudioWorker:
    """A single-consumer queue that keeps GPU inference out of Flask request threads."""

    def __init__(
        self,
        manager: TodoAudioManager,
        extended_manager: TodoExtendedManager,
        service_url: str,
        timeout_seconds: int = 900,
        queue_limit: int = 20,
        on_completed: Optional[Callable[[], None]] = None,
        before_transcribe: Optional[Callable[[], None]] = None,
        on_work_enqueued: Optional[Callable[[], None]] = None,
        on_idle: Optional[Callable[[], None]] = None,
    ) -> None:
        self.manager = manager
        self.extended_manager = extended_manager
        self.service_url = str(service_url or "").strip()
        self.timeout_seconds = max(30, int(timeout_seconds or 900))
        self.queue: queue.Queue[str] = queue.Queue(maxsize=max(1, int(queue_limit or 20)))
        self.on_completed = on_completed
        self.before_transcribe = before_transcribe
        self.on_work_enqueued = on_work_enqueued
        self.on_idle = on_idle
        self._queued_ids: set[str] = set()
        self._lock = threading.RLock()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(
                target=self._run,
                name="todo-audio-worker",
                daemon=True,
            )
            self._thread.start()
        for record_id in self.manager.recover_pending_records():
            self.enqueue(record_id)

    def enqueue(self, record_id: str) -> bool:
        with self._lock:
            if record_id in self._queued_ids:
                return True
            try:
                self.queue.put_nowait(record_id)
            except queue.Full:
                return False
            self._queued_ids.add(record_id)
        if self.on_work_enqueued:
            self.on_work_enqueued()
        return True

    def _run(self) -> None:
        while True:
            record_id = self.queue.get()
            try:
                self._process(record_id)
            except Exception:  # Last-resort protection for the long-lived worker.
                _log.exception("语音转写 worker 未处理异常: %s", record_id)
                self.manager.mark_failed(record_id, "转写任务发生未处理错误")
            finally:
                with self._lock:
                    self._queued_ids.discard(record_id)
                self.queue.task_done()
                if self.on_idle and self.queue.empty():
                    self.on_idle()

    def _process(self, record_id: str) -> None:
        record = self.manager.set_transcribing(record_id)
        if not record:
            return
        source_path = self.manager.get_source_path(record_id)
        if not source_path:
            self.manager.mark_failed(record_id, "原始录音文件不存在")
            return
        normalized_path = ""
        try:
            normalized_path = self._normalize_audio(source_path)
            if self.before_transcribe:
                self.before_transcribe()
            result = self._request_transcription(normalized_path)
            completed = self.manager.mark_completed(
                record_id,
                text=str(result.get("text") or ""),
                duration_ms=self._wav_duration_ms(normalized_path)
                or int(result.get("duration_ms") or 0),
                segments=list(result.get("segments") or []),
            )
            if completed:
                self._append_transcript_to_note(completed)
                if self.on_completed:
                    self.on_completed()
        except Exception as exc:
            _log.warning("语音转写失败: %s", exc)
            self.manager.mark_failed(record_id, str(exc))
        finally:
            if normalized_path and os.path.exists(normalized_path):
                try:
                    os.remove(normalized_path)
                except OSError:
                    _log.warning("无法删除临时音频: %s", normalized_path)

    def _normalize_audio(self, source_path: str) -> str:
        descriptor, normalized_path = tempfile.mkstemp(suffix=".wav", prefix="todo-audio-")
        os.close(descriptor)
        command = [
            "ffmpeg",
            "-nostdin",
            "-y",
            "-i",
            source_path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "pcm_s16le",
            normalized_path,
        ]
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=min(self.timeout_seconds, 300),
            check=False,
        )
        if completed.returncode != 0:
            if os.path.exists(normalized_path):
                os.remove(normalized_path)
            detail = (completed.stderr or "").strip().splitlines()
            raise RuntimeError(detail[-1] if detail else "FFmpeg 无法读取该录音")
        return normalized_path

    @staticmethod
    def _wav_duration_ms(path: str) -> int:
        try:
            with wave.open(path, "rb") as audio:
                if not audio.getframerate():
                    return 0
                return int(audio.getnframes() * 1000 / audio.getframerate())
        except (OSError, wave.Error):
            return 0

    @staticmethod
    def _multipart_prefix(fields: Dict[str, str], boundary: str) -> bytes:
        chunks = []
        for name, value in fields.items():
            chunks.extend(
                [
                    f"--{boundary}\r\n".encode("ascii"),
                    f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                    str(value).encode("utf-8"),
                    b"\r\n",
                ]
            )
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("ascii"),
                b'Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n',
                b"Content-Type: audio/wav\r\n\r\n",
            ]
        )
        return b"".join(chunks)

    def _request_transcription(self, normalized_path: str) -> Dict[str, Any]:
        parsed = urlparse(self.service_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise RuntimeError("语音服务地址无效")
        boundary = f"----TodoAudio{os.urandom(12).hex()}"
        prefix = self._multipart_prefix({"language": "zh"}, boundary)
        suffix = f"\r\n--{boundary}--\r\n".encode("ascii")
        body_size = len(prefix) + os.path.getsize(normalized_path) + len(suffix)
        connection_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        connection = connection_cls(parsed.hostname, port, timeout=self.timeout_seconds)
        path = parsed.path or "/transcribe"
        if parsed.query:
            path = f"{path}?{parsed.query}"
        try:
            connection.putrequest("POST", path)
            connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
            connection.putheader("Content-Length", str(body_size))
            connection.endheaders()
            connection.send(prefix)
            with open(normalized_path, "rb") as audio_file:
                while True:
                    chunk = audio_file.read(1024 * 1024)
                    if not chunk:
                        break
                    connection.send(chunk)
            connection.send(suffix)
            response = connection.getresponse()
            payload = response.read().decode("utf-8", errors="replace")
        except OSError as exc:
            raise RuntimeError(f"无法连接本地语音服务: {exc}") from exc
        finally:
            connection.close()
        if response.status >= 400:
            try:
                detail = json.loads(payload).get("detail") or payload
            except json.JSONDecodeError:
                detail = payload
            raise RuntimeError(f"语音服务返回 {response.status}: {str(detail)[:500]}")
        try:
            result = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise RuntimeError("语音服务返回了无效 JSON") from exc
        if not isinstance(result, dict):
            raise RuntimeError("语音服务返回格式无效")
        return result

    def _append_transcript_to_note(self, record: Dict[str, Any]) -> None:
        note_date = str(record.get("date") or "")
        current = self.extended_manager.get_meeting_note(note_date) or ""
        merged = self.manager.merge_completed_markdown(note_date, current)
        self.extended_manager.set_meeting_note(note_date, merged)
