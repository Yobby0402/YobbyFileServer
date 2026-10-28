from __future__ import annotations

import http.client
import json
import os
import queue
import tempfile
import threading
import time
import wave
from datetime import datetime
from typing import Any, Callable, Dict, Optional
from urllib.parse import urlparse


class TodoLiveTranscriptionManager:
    """Serialize short-lived browser PCM chunks into temporary live captions."""

    def __init__(
        self,
        service_url: str,
        timeout_seconds: int = 900,
        queue_limit: int = 60,
        before_transcribe: Optional[Callable[[], None]] = None,
        on_work_enqueued: Optional[Callable[[], None]] = None,
        on_idle: Optional[Callable[[], None]] = None,
    ) -> None:
        self.service_url = str(service_url or "").strip()
        self.timeout_seconds = max(30, int(timeout_seconds or 900))
        self.queue: queue.Queue[tuple[str, int, int, bytes]] = queue.Queue(
            maxsize=max(1, int(queue_limit or 60))
        )
        self.before_transcribe = before_transcribe
        self.on_work_enqueued = on_work_enqueued
        self.on_idle = on_idle
        self._sessions: Dict[str, Dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._thread: Optional[threading.Thread] = None

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._thread = threading.Thread(
                target=self._run,
                name="todo-live-transcription",
                daemon=True,
            )
            self._thread.start()

    def create_session(self) -> Dict[str, Any]:
        self.start()
        session_id = os.urandom(18).hex()
        with self._lock:
            self._discard_expired_sessions_locked()
            self._sessions[session_id] = {
                "id": session_id,
                "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                "stopped": False,
                "next_sequence": 1,
                "next_caption_id": 1,
                "pending_chunks": 0,
                "captions": [],
            }
            return self._public_session(self._sessions[session_id])

    def enqueue_chunk(self, session_id: str, offset_ms: int, pcm_bytes: bytes) -> bool:
        data = bytes(pcm_bytes or b"")
        if not data or len(data) % 2:
            raise ValueError("实时音频片段格式无效")
        with self._lock:
            session = self._sessions.get(session_id)
            if not session or session.get("stopped"):
                raise ValueError("实时转写会话不存在或已结束")
            sequence = int(session["next_sequence"])
            try:
                self.queue.put_nowait((session_id, sequence, max(0, int(offset_ms)), data))
            except queue.Full:
                return False
            session["next_sequence"] = sequence + 1
            session["pending_chunks"] = int(session.get("pending_chunks") or 0) + 1
        if self.on_work_enqueued:
            self.on_work_enqueued()
        return True

    def get_captions(self, session_id: str, after: int = 0) -> Dict[str, Any]:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise ValueError("实时转写会话不存在")
            cursor = max(0, int(after or 0))
            captions = [
                dict(caption)
                for caption in session["captions"]
                if int(caption.get("id") or 0) > cursor
            ]
            return {
                "session": self._public_session(session),
                "captions": captions,
                "next_cursor": int(session["next_caption_id"]) - 1,
            }

    def stop_session(self, session_id: str) -> Dict[str, Any]:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                raise ValueError("实时转写会话不存在")
            session["stopped"] = True
            session["stopped_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
            return self._public_session(session)

    @staticmethod
    def _public_session(session: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": session["id"],
            "created_at": session["created_at"],
            "stopped": bool(session.get("stopped")),
            "pending_chunks": int(session.get("pending_chunks") or 0),
        }

    def _discard_expired_sessions_locked(self) -> None:
        cutoff = time.time() - 30 * 60
        stale_ids = []
        for session_id, session in self._sessions.items():
            if not session.get("stopped"):
                continue
            stopped_at = session.get("stopped_at") or ""
            try:
                timestamp = datetime.fromisoformat(stopped_at).timestamp()
            except (TypeError, ValueError):
                timestamp = 0
            if timestamp < cutoff:
                stale_ids.append(session_id)
        for session_id in stale_ids:
            self._sessions.pop(session_id, None)

    def _run(self) -> None:
        while True:
            session_id, sequence, offset_ms, pcm_bytes = self.queue.get()
            try:
                self._process_chunk(session_id, sequence, offset_ms, pcm_bytes)
            finally:
                self._finish_chunk(session_id)
                self.queue.task_done()
                if self.on_idle and self.queue.empty():
                    self.on_idle()

    def _finish_chunk(self, session_id: str) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session["pending_chunks"] = max(
                    0, int(session.get("pending_chunks") or 0) - 1
                )

    def _process_chunk(
        self, session_id: str, sequence: int, offset_ms: int, pcm_bytes: bytes
    ) -> None:
        temporary_path = ""
        try:
            descriptor, temporary_path = tempfile.mkstemp(
                prefix="todo-live-audio-", suffix=".wav"
            )
            os.close(descriptor)
            with wave.open(temporary_path, "wb") as audio:
                audio.setnchannels(1)
                audio.setsampwidth(2)
                audio.setframerate(16000)
                audio.writeframes(pcm_bytes)
            if self.before_transcribe:
                self.before_transcribe()
            result = self._request_transcription(temporary_path)
            self._store_result(session_id, sequence, offset_ms, result)
        except Exception as exc:
            self._store_error(session_id, sequence, offset_ms, str(exc))
        finally:
            if temporary_path and os.path.exists(temporary_path):
                os.remove(temporary_path)

    def _store_result(
        self, session_id: str, sequence: int, offset_ms: int, result: Dict[str, Any]
    ) -> None:
        raw_segments = result.get("segments") or []
        if not raw_segments and str(result.get("text") or "").strip():
            raw_segments = [{"start_ms": 0, "end_ms": result.get("duration_ms") or 0, "text": result["text"]}]
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return
            for segment in raw_segments:
                text = str(segment.get("text") or "").strip()
                if not text:
                    continue
                caption_id = int(session["next_caption_id"])
                session["next_caption_id"] = caption_id + 1
                caption = {
                    "id": caption_id,
                    "sequence": sequence,
                    "start_ms": offset_ms + max(0, int(segment.get("start_ms") or 0)),
                    "end_ms": offset_ms + max(0, int(segment.get("end_ms") or 0)),
                    "text": text,
                }
                details = str(segment.get("details") or "").strip()
                if details:
                    caption["details"] = details
                session["captions"].append(caption)

    def _store_error(self, session_id: str, sequence: int, offset_ms: int, error: str) -> None:
        with self._lock:
            session = self._sessions.get(session_id)
            if not session:
                return
            caption_id = int(session["next_caption_id"])
            session["next_caption_id"] = caption_id + 1
            session["captions"].append(
                {
                    "id": caption_id,
                    "sequence": sequence,
                    "start_ms": offset_ms,
                    "end_ms": offset_ms,
                    "error": str(error)[:500],
                }
            )

    @staticmethod
    def _multipart_prefix(boundary: str) -> bytes:
        return b"".join(
            [
                f"--{boundary}\r\n".encode("ascii"),
                b'Content-Disposition: form-data; name="file"; filename="live.wav"\r\n',
                b"Content-Type: audio/wav\r\n\r\n",
            ]
        )

    def _request_transcription(self, wav_path: str) -> Dict[str, Any]:
        parsed = urlparse(self.service_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise RuntimeError("语音服务地址无效")
        boundary = f"----TodoLiveAudio{os.urandom(12).hex()}"
        prefix = self._multipart_prefix(boundary)
        suffix = f"\r\n--{boundary}--\r\n".encode("ascii")
        body_size = len(prefix) + os.path.getsize(wav_path) + len(suffix)
        connection_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
        connection = connection_cls(
            parsed.hostname,
            parsed.port or (443 if parsed.scheme == "https" else 80),
            timeout=self.timeout_seconds,
        )
        path = parsed.path or "/transcribe"
        if parsed.query:
            path = f"{path}?{parsed.query}"
        try:
            connection.putrequest("POST", path)
            connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
            connection.putheader("Content-Length", str(body_size))
            connection.endheaders()
            connection.send(prefix)
            with open(wav_path, "rb") as source:
                while chunk := source.read(1024 * 1024):
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
