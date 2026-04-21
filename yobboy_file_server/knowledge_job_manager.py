from __future__ import annotations

import json
import threading
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, Optional

from . import knowledge_index_db


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


class KnowledgeJobManager:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._running_jobs: dict[str, threading.Thread] = {}
        knowledge_index_db.recover_interrupted_jobs()

    def enqueue(
        self,
        *,
        root_dir: str,
        job_type: str,
        source_type: str,
        source_key: str,
        payload: Dict[str, Any],
        runner: Callable[[Callable[..., None]], None],
    ) -> Dict[str, Any]:
        with self._lock:
            active = knowledge_index_db.find_active_job(root_dir, source_type, source_key)
            if active:
                return active

            job_id = uuid.uuid4().hex[:16]
            now = _now_iso()
            job = knowledge_index_db.create_job(
                job_id=job_id,
                root_dir=root_dir,
                job_type=job_type,
                source_type=source_type,
                source_key=source_key,
                status="queued",
                stage="queued",
                message="任务已加入后台队列",
                progress=0.0,
                current_count=0,
                total_count=0,
                payload_json=json.dumps(payload or {}, ensure_ascii=False),
                error_text="",
                created_at=now,
                updated_at=now,
            )

            def progress(**fields: Any) -> None:
                fields.setdefault("updated_at", _now_iso())
                knowledge_index_db.update_job(job_id, **fields)

            def run() -> None:
                try:
                    progress(
                        status="running",
                        stage="starting",
                        message="后台任务已启动",
                        started_at=_now_iso(),
                    )
                    runner(progress)
                    progress(
                        status="completed",
                        stage="completed",
                        message="处理完成",
                        progress=1.0,
                        finished_at=_now_iso(),
                    )
                except Exception as exc:
                    progress(
                        status="failed",
                        stage="failed",
                        message="处理失败",
                        error_text=str(exc),
                        finished_at=_now_iso(),
                    )
                finally:
                    with self._lock:
                        self._running_jobs.pop(job_id, None)

            thread = threading.Thread(target=run, name=f"kb-job-{job_id}", daemon=True)
            self._running_jobs[job_id] = thread
            thread.start()
            return knowledge_index_db.get_job(job_id) or job


_MANAGER = KnowledgeJobManager()


def get_job_manager() -> KnowledgeJobManager:
    return _MANAGER
