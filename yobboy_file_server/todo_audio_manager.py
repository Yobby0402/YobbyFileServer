from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import re
import secrets
import shutil
import tempfile
import threading
from copy import deepcopy
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from .paths import get_data_path


_log = logging.getLogger("yobboy_file_server.todo_audio")


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _valid_note_date(value: str) -> str:
    value = str(value or "").strip()
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError as exc:
        raise ValueError("日期必须使用 YYYY-MM-DD 格式") from exc


def _display_speaker(value: Any) -> str:
    label = str(value or "").strip()
    match = re.fullmatch(r"SPK(?:EAKER)?[_ -]?(\d+)", label, re.IGNORECASE)
    if match:
        return f"说话人 {int(match.group(1)) + 1}"
    return label or "说话人"


def _format_timecode(milliseconds: Any) -> str:
    try:
        seconds = max(0, int(float(milliseconds) / 1000))
    except (TypeError, ValueError):
        seconds = 0
    hours, seconds = divmod(seconds, 3600)
    minutes, seconds = divmod(seconds, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def _strip_speech_control_tokens(value: Any) -> str:
    return re.sub(r"<\|[^|>]+\|>", "", str(value or "")).strip()


class TodoAudioManager:
    """Persist audio-note metadata and narrowly scoped external client tokens."""

    def __init__(
        self,
        storage_path: Optional[str] = None,
        audio_root: Optional[str] = None,
    ) -> None:
        self.storage_path = storage_path or get_data_path(
            "todos", "audio_notes.json", create_parent=True
        )
        self.audio_root = audio_root or get_data_path("todos", "audio", create_parent=True)
        os.makedirs(self.audio_root, exist_ok=True)
        self._lock = threading.RLock()
        self._data: Dict[str, Dict[str, Dict[str, Any]]] = {
            "records": {},
            "tokens": {},
        }
        self._load()

    def _load(self) -> None:
        with self._lock:
            if not os.path.exists(self.storage_path):
                return
            try:
                with open(self.storage_path, "r", encoding="utf-8") as source:
                    loaded = json.load(source)
                if not isinstance(loaded, dict):
                    raise ValueError("根节点不是对象")
                records = loaded.get("records")
                tokens = loaded.get("tokens")
                self._data["records"] = records if isinstance(records, dict) else {}
                self._data["tokens"] = tokens if isinstance(tokens, dict) else {}
            except (OSError, ValueError, json.JSONDecodeError) as exc:
                _log.warning("无法读取语音记录元数据，将使用空数据: %s", exc)

    def _persist(self) -> None:
        directory = os.path.dirname(self.storage_path)
        os.makedirs(directory, exist_ok=True)
        descriptor, temporary_path = tempfile.mkstemp(
            prefix=".audio_notes.", suffix=".tmp", dir=directory
        )
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as target:
                json.dump(self._data, target, ensure_ascii=False, indent=2)
            os.replace(temporary_path, self.storage_path)
        finally:
            if os.path.exists(temporary_path):
                os.remove(temporary_path)

    @staticmethod
    def _public_record(record: Dict[str, Any]) -> Dict[str, Any]:
        item = deepcopy(record)
        item.pop("token_id", None)
        item.pop("source_path", None)
        return item

    @staticmethod
    def _token_digest(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def reserve_upload(
        self,
        note_date: str,
        original_filename: str,
        content_type: str = "",
        title: str = "",
        token_id: str = "",
    ) -> Tuple[Dict[str, Any], str]:
        note_date = _valid_note_date(note_date)
        record_id = secrets.token_urlsafe(12).replace("-", "_")
        created_at = _now_iso()
        folder = os.path.join(self.audio_root, record_id)
        source_path = os.path.join(folder, "source")
        record = {
            "id": record_id,
            "date": note_date,
            "title": str(title or "").strip()[:120],
            "original_filename": str(original_filename or "audio"),
            "content_type": str(content_type or "").strip()[:120],
            "status": "queued",
            "created_at": created_at,
            "updated_at": created_at,
            "started_at": "",
            "completed_at": "",
            "duration_ms": 0,
            "text": "",
            "segments": [],
            "error": "",
            "token_id": token_id,
            "source_path": source_path,
        }
        with self._lock:
            os.makedirs(folder, exist_ok=False)
            self._data["records"][record_id] = record
            self._persist()
            return self._public_record(record), source_path

    def discard_reserved_upload(self, record_id: str) -> None:
        self.delete_record(record_id)

    def get_record(self, record_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            record = self._data["records"].get(record_id)
            return self._public_record(record) if record else None

    def get_internal_record(self, record_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            record = self._data["records"].get(record_id)
            return deepcopy(record) if record else None

    def list_records(self, note_date: str) -> List[Dict[str, Any]]:
        note_date = _valid_note_date(note_date)
        with self._lock:
            records = [
                self._public_record(record)
                for record in self._data["records"].values()
                if record.get("date") == note_date
            ]
        return sorted(records, key=lambda item: item.get("created_at", ""), reverse=True)

    def get_source_path(self, record_id: str) -> Optional[str]:
        with self._lock:
            record = self._data["records"].get(record_id)
            source_path = str(record.get("source_path") or "") if record else ""
        if source_path and os.path.isfile(source_path):
            return source_path
        return None

    def set_transcribing(self, record_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            record = self._data["records"].get(record_id)
            if not record or record.get("status") != "queued":
                return None
            record["status"] = "transcribing"
            record["started_at"] = _now_iso()
            record["updated_at"] = record["started_at"]
            record["error"] = ""
            self._persist()
            return self._public_record(record)

    def mark_completed(
        self,
        record_id: str,
        text: str,
        duration_ms: int,
        segments: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        safe_segments = []
        for segment in segments or []:
            if not isinstance(segment, dict):
                continue
            safe_segments.append(
                {
                    "start_ms": max(0, int(segment.get("start_ms") or 0)),
                    "end_ms": max(0, int(segment.get("end_ms") or 0)),
                    "speaker": str(segment.get("speaker") or "SPK0"),
                    "text": _strip_speech_control_tokens(segment.get("text")),
                }
            )
        with self._lock:
            record = self._data["records"].get(record_id)
            if not record:
                return None
            completed_at = _now_iso()
            record.update(
                {
                    "status": "completed",
                    "updated_at": completed_at,
                    "completed_at": completed_at,
                    "duration_ms": max(0, int(duration_ms or 0)),
                    "text": _strip_speech_control_tokens(text),
                    "segments": safe_segments,
                    "error": "",
                }
            )
            self._persist()
            return self._public_record(record)

    def mark_failed(self, record_id: str, error: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            record = self._data["records"].get(record_id)
            if not record:
                return None
            record.update(
                {
                    "status": "failed",
                    "updated_at": _now_iso(),
                    "error": str(error or "转写失败").strip()[:1000],
                }
            )
            self._persist()
            return self._public_record(record)

    def retry_record(self, record_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            record = self._data["records"].get(record_id)
            if not record or record.get("status") != "failed":
                return None
            record.update(
                {
                    "status": "queued",
                    "updated_at": _now_iso(),
                    "started_at": "",
                    "completed_at": "",
                    "error": "",
                }
            )
            self._persist()
            return self._public_record(record)

    def recover_pending_records(self) -> List[str]:
        recovered: List[str] = []
        changed = False
        with self._lock:
            for record_id, record in self._data["records"].items():
                if record.get("status") in {"queued", "transcribing"}:
                    changed = True
                    record["status"] = "queued"
                    record["updated_at"] = _now_iso()
                    record["error"] = ""
                    if os.path.isfile(str(record.get("source_path") or "")):
                        recovered.append(record_id)
                    else:
                        record["status"] = "failed"
                        record["error"] = "原始录音文件不存在"
            if changed:
                self._persist()
        return recovered

    def delete_record(self, record_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            record = self._data["records"].pop(record_id, None)
            if not record:
                return None
            self._persist()
        source_path = str(record.get("source_path") or "")
        folder = os.path.dirname(source_path)
        if folder and os.path.commonpath([self.audio_root, folder]) == self.audio_root:
            shutil.rmtree(folder, ignore_errors=True)
        return self._public_record(record)

    def create_token(self, label: str) -> Tuple[Dict[str, Any], str]:
        label = str(label or "").strip()[:120]
        if not label:
            raise ValueError("设备名称不能为空")
        token_id = secrets.token_urlsafe(9).replace("-", "_")
        raw_token = f"todo_audio_{secrets.token_urlsafe(32)}"
        now = _now_iso()
        token = {
            "id": token_id,
            "label": label,
            "token_hash": self._token_digest(raw_token),
            "created_at": now,
            "revoked_at": "",
            "last_used_at": "",
        }
        with self._lock:
            self._data["tokens"][token_id] = token
            self._persist()
        return self._public_token(token), raw_token

    @staticmethod
    def _public_token(token: Dict[str, Any]) -> Dict[str, Any]:
        return {
            "id": token.get("id", ""),
            "label": token.get("label", ""),
            "created_at": token.get("created_at", ""),
            "revoked_at": token.get("revoked_at", ""),
            "last_used_at": token.get("last_used_at", ""),
        }

    def list_tokens(self) -> List[Dict[str, Any]]:
        with self._lock:
            items = [self._public_token(token) for token in self._data["tokens"].values()]
        return sorted(items, key=lambda item: item.get("created_at", ""), reverse=True)

    def revoke_token(self, token_id: str) -> bool:
        with self._lock:
            token = self._data["tokens"].get(token_id)
            if not token or token.get("revoked_at"):
                return False
            token["revoked_at"] = _now_iso()
            self._persist()
            return True

    def authenticate_token(self, raw_token: str) -> Optional[str]:
        digest = self._token_digest(str(raw_token or ""))
        with self._lock:
            for token_id, token in self._data["tokens"].items():
                if token.get("revoked_at"):
                    continue
                if hmac.compare_digest(str(token.get("token_hash") or ""), digest):
                    token["last_used_at"] = _now_iso()
                    self._persist()
                    return token_id
        return None

    def token_owns_record(self, token_id: str, record_id: str) -> bool:
        with self._lock:
            record = self._data["records"].get(record_id)
            return bool(record and record.get("token_id") == token_id)

    def render_recording_markdown(self, record: Dict[str, Any]) -> str:
        record_id = str(record.get("id") or "")
        marker_start = f"<!-- todo-audio:{record_id}:start -->"
        marker_end = f"<!-- todo-audio:{record_id}:end -->"
        created_at = str(record.get("created_at") or "")
        try:
            time_label = datetime.fromisoformat(created_at).strftime("%H:%M")
        except ValueError:
            time_label = "录音"
        title = str(record.get("title") or "").strip() or f"录音 {time_label}"
        lines = [marker_start, f"## {title}"]
        segments = record.get("segments") or []
        for segment in segments:
            text = str(segment.get("text") or "").strip()
            if not text:
                continue
            start = _format_timecode(segment.get("start_ms"))
            end = _format_timecode(segment.get("end_ms"))
            speaker = _display_speaker(segment.get("speaker"))
            lines.append(f"- [{start} - {end}] **{speaker}**：{text}")
        if len(lines) == 2 and record.get("text"):
            lines.append(str(record["text"]).strip())
        lines.append(marker_end)
        return "\n".join(lines)

    def merge_completed_markdown(self, note_date: str, content: str) -> str:
        content = str(content or "").rstrip()
        records = self.list_records(note_date)
        for public_record in reversed(records):
            if public_record.get("status") != "completed":
                continue
            block = self.render_recording_markdown(public_record)
            record_id = re.escape(str(public_record["id"]))
            pattern = re.compile(
                rf"<!-- todo-audio:{record_id}:start -->.*?<!-- todo-audio:{record_id}:end -->",
                re.DOTALL,
            )
            if pattern.search(content):
                content = pattern.sub(block, content)
            else:
                content = f"{content}\n\n{block}".strip()
        return content


todo_audio_manager = TodoAudioManager()
