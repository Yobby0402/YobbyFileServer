from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from datetime import datetime
from typing import Any, Dict


_status_write_lock = threading.Lock()


def _status_path() -> str:
    configured = os.environ.get("TODO_SPEECH_STATUS_FILE", "").strip()
    if configured:
        return configured
    return os.path.join(os.path.dirname(__file__), "speech_service_status.json")


def write_status(state: str, message: str = "", **extra: Any) -> None:
    """Best-effort cross-process status update that never breaks transcription."""
    temporary_path = ""
    try:
        path = _status_path()
        directory = os.path.dirname(path)
        if directory:
            os.makedirs(directory, exist_ok=True)
        payload: Dict[str, Any] = {
            "state": state,
            "message": message,
            "pid": os.getpid(),
            "updated_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        }
        payload.update(extra)
        descriptor, temporary_path = tempfile.mkstemp(
            prefix=".todo-speech-status.", suffix=".tmp", dir=directory or None
        )
        with os.fdopen(descriptor, "w", encoding="utf-8") as target:
            json.dump(payload, target, ensure_ascii=False)
        with _status_write_lock:
            for attempt in range(8):
                try:
                    os.replace(temporary_path, path)
                    temporary_path = ""
                    return
                except PermissionError:
                    if attempt == 7:
                        return
                    time.sleep(0.05 * (attempt + 1))
    except OSError:
        return
    finally:
        if temporary_path and os.path.exists(temporary_path):
            os.remove(temporary_path)
