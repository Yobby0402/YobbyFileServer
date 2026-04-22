from __future__ import annotations

import json
import os
import sqlite3
import threading
from typing import Any, Dict, Iterable, List, Optional

from .local_ai_paths import knowledge_storage_path

_db_lock = threading.RLock()


def db_path() -> str:
    return knowledge_storage_path("knowledge_index.sqlite3")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def ensure_schema() -> None:
    with _db_lock:
        conn = _connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS kb_sources (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    root_dir TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    source_key TEXT NOT NULL,
                    display_name TEXT NOT NULL DEFAULT '',
                    title TEXT NOT NULL DEFAULT '',
                    note TEXT NOT NULL DEFAULT '',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    content_hash TEXT NOT NULL DEFAULT '',
                    mtime REAL NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'pending',
                    last_error TEXT NOT NULL DEFAULT '',
                    chunk_count INTEGER NOT NULL DEFAULT 0,
                    indexed_at TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT '',
                    raw_text TEXT NOT NULL DEFAULT '',
                    normalized_text TEXT NOT NULL DEFAULT '',
                    UNIQUE(root_dir, source_type, source_key)
                );

                CREATE INDEX IF NOT EXISTS idx_kb_sources_root_type
                ON kb_sources(root_dir, source_type, status);

                CREATE TABLE IF NOT EXISTS kb_chunks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_id INTEGER NOT NULL,
                    chunk_index INTEGER NOT NULL,
                    heading_path TEXT NOT NULL DEFAULT '',
                    text TEXT NOT NULL,
                    token_count INTEGER NOT NULL DEFAULT 0,
                    char_count INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL DEFAULT '',
                    UNIQUE(source_id, chunk_index),
                    FOREIGN KEY(source_id) REFERENCES kb_sources(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_kb_chunks_source
                ON kb_chunks(source_id, chunk_index);

                CREATE TABLE IF NOT EXISTS kb_embeddings (
                    chunk_id INTEGER PRIMARY KEY,
                    vector_json TEXT NOT NULL,
                    dims INTEGER NOT NULL DEFAULT 0,
                    FOREIGN KEY(chunk_id) REFERENCES kb_chunks(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS kb_jobs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_id TEXT NOT NULL UNIQUE,
                    root_dir TEXT NOT NULL,
                    job_type TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    source_key TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'queued',
                    stage TEXT NOT NULL DEFAULT 'queued',
                    message TEXT NOT NULL DEFAULT '',
                    progress REAL NOT NULL DEFAULT 0,
                    current_count INTEGER NOT NULL DEFAULT 0,
                    total_count INTEGER NOT NULL DEFAULT 0,
                    payload_json TEXT NOT NULL DEFAULT '{}',
                    error_text TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT '',
                    started_at TEXT NOT NULL DEFAULT '',
                    finished_at TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT ''
                );

                CREATE INDEX IF NOT EXISTS idx_kb_jobs_root_status
                ON kb_jobs(root_dir, status, updated_at);

                CREATE INDEX IF NOT EXISTS idx_kb_jobs_source
                ON kb_jobs(root_dir, source_type, source_key, updated_at);
                """
            )
            conn.commit()
        finally:
            conn.close()


def _row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def upsert_source(
    *,
    root_dir: str,
    source_type: str,
    source_key: str,
    display_name: str = "",
    title: str = "",
    note: str = "",
    tags_json: str = "[]",
    content_hash: str = "",
    mtime: float = 0.0,
    status: str = "pending",
    last_error: str = "",
    chunk_count: int = 0,
    indexed_at: str = "",
    updated_at: str = "",
    raw_text: str = "",
    normalized_text: str = "",
) -> Dict[str, Any]:
    ensure_schema()
    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO kb_sources (
                    root_dir, source_type, source_key, display_name, title, note, tags_json,
                    content_hash, mtime, status, last_error, chunk_count, indexed_at,
                    updated_at, raw_text, normalized_text
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(root_dir, source_type, source_key) DO UPDATE SET
                    display_name=excluded.display_name,
                    title=excluded.title,
                    note=excluded.note,
                    tags_json=excluded.tags_json,
                    content_hash=excluded.content_hash,
                    mtime=excluded.mtime,
                    status=excluded.status,
                    last_error=excluded.last_error,
                    chunk_count=excluded.chunk_count,
                    indexed_at=excluded.indexed_at,
                    updated_at=excluded.updated_at,
                    raw_text=excluded.raw_text,
                    normalized_text=excluded.normalized_text
                """,
                (
                    root_dir,
                    source_type,
                    source_key,
                    display_name,
                    title,
                    note,
                    tags_json,
                    content_hash,
                    float(mtime or 0.0),
                    status,
                    last_error,
                    int(chunk_count or 0),
                    indexed_at,
                    updated_at,
                    raw_text,
                    normalized_text,
                ),
            )
            conn.commit()
            row = conn.execute(
                """
                SELECT * FROM kb_sources
                WHERE root_dir = ? AND source_type = ? AND source_key = ?
                """,
                (root_dir, source_type, source_key),
            ).fetchone()
            return _row_to_dict(row) or {}
        finally:
            conn.close()


def get_source(root_dir: str, source_type: str, source_key: str) -> Optional[Dict[str, Any]]:
    ensure_schema()
    with _db_lock:
        conn = _connect()
        try:
            row = conn.execute(
                "SELECT * FROM kb_sources WHERE root_dir = ? AND source_type = ? AND source_key = ?",
                (root_dir, source_type, source_key),
            ).fetchone()
            return _row_to_dict(row)
        finally:
            conn.close()


def list_sources(root_dir: str, source_type: Optional[str] = None) -> List[Dict[str, Any]]:
    ensure_schema()
    with _db_lock:
        conn = _connect()
        try:
            if source_type:
                rows = conn.execute(
                    """
                    SELECT * FROM kb_sources
                    WHERE root_dir = ? AND source_type = ?
                    ORDER BY updated_at DESC, id DESC
                    """,
                    (root_dir, source_type),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT * FROM kb_sources
                    WHERE root_dir = ?
                    ORDER BY updated_at DESC, id DESC
                    """,
                    (root_dir,),
                ).fetchall()
            return [_row_to_dict(row) or {} for row in rows]
        finally:
            conn.close()


def delete_source(root_dir: str, source_type: str, source_key: str) -> None:
    ensure_schema()
    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                "DELETE FROM kb_sources WHERE root_dir = ? AND source_type = ? AND source_key = ?",
                (root_dir, source_type, source_key),
            )
            conn.commit()
        finally:
            conn.close()


def replace_chunks(
    source_id: int,
    chunks: Iterable[Dict[str, Any]],
    vectors: Optional[List[List[float]]] = None,
) -> None:
    ensure_schema()
    vector_list = list(vectors or [])
    chunk_list = list(chunks)
    with _db_lock:
        conn = _connect()
        try:
            conn.execute("DELETE FROM kb_chunks WHERE source_id = ?", (int(source_id),))
            chunk_ids: List[int] = []
            for chunk in chunk_list:
                cur = conn.execute(
                    """
                    INSERT INTO kb_chunks (
                        source_id, chunk_index, heading_path, text, token_count, char_count, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        int(source_id),
                        int(chunk.get("chunk_index", 0) or 0),
                        str(chunk.get("heading_path") or ""),
                        str(chunk.get("text") or ""),
                        int(chunk.get("token_count", 0) or 0),
                        int(chunk.get("char_count", 0) or 0),
                        str(chunk.get("created_at") or ""),
                    ),
                )
                chunk_ids.append(int(cur.lastrowid))
            for idx, vector in enumerate(vector_list):
                if idx >= len(chunk_ids):
                    break
                conn.execute(
                    """
                    INSERT INTO kb_embeddings (chunk_id, vector_json, dims)
                    VALUES (?, ?, ?)
                    """,
                    (chunk_ids[idx], json.dumps(vector, ensure_ascii=False), len(vector)),
                )
            conn.commit()
        finally:
            conn.close()


def list_chunks(root_dir: str, statuses: Optional[Iterable[str]] = None) -> List[Dict[str, Any]]:
    ensure_schema()
    wanted = tuple(str(item) for item in (statuses or ("indexed", "indexed_partial")))
    placeholders = ", ".join("?" for _ in wanted)
    sql = f"""
        SELECT
            s.id AS source_id,
            s.root_dir,
            s.source_type,
            s.source_key,
            s.display_name,
            s.title,
            s.note,
            s.tags_json,
            s.status,
            s.last_error,
            s.indexed_at,
            c.id AS chunk_id,
            c.chunk_index,
            c.heading_path,
            c.text,
            c.token_count,
            c.char_count,
            e.vector_json,
            e.dims
        FROM kb_sources s
        JOIN kb_chunks c ON c.source_id = s.id
        LEFT JOIN kb_embeddings e ON e.chunk_id = c.id
        WHERE s.root_dir = ? AND s.status IN ({placeholders})
        ORDER BY s.id ASC, c.chunk_index ASC
    """
    with _db_lock:
        conn = _connect()
        try:
            rows = conn.execute(sql, (root_dir, *wanted)).fetchall()
            return [_row_to_dict(row) or {} for row in rows]
        finally:
            conn.close()


def get_summary(root_dir: str) -> Dict[str, Any]:
    ensure_schema()
    with _db_lock:
        conn = _connect()
        try:
            rows = conn.execute(
                """
                SELECT source_type, status, COUNT(*) AS cnt
                FROM kb_sources
                WHERE root_dir = ?
                GROUP BY source_type, status
                """,
                (root_dir,),
            ).fetchall()
            summary: Dict[str, Dict[str, int]] = {}
            total_sources = 0
            total_chunks = int(
                conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM kb_sources s
                    JOIN kb_chunks c ON c.source_id = s.id
                    WHERE s.root_dir = ?
                    """,
                    (root_dir,),
                ).fetchone()[0]
            )
            for row in rows:
                source_type = str(row["source_type"] or "")
                status = str(row["status"] or "")
                count = int(row["cnt"] or 0)
                total_sources += count
                summary.setdefault(source_type, {})[status] = count
            return {
                "total_sources": total_sources,
                "total_chunks": total_chunks,
                "by_type": summary,
            }
        finally:
            conn.close()


def create_job(
    *,
    job_id: str,
    root_dir: str,
    job_type: str,
    source_type: str,
    source_key: str,
    status: str,
    stage: str,
    message: str,
    progress: float,
    current_count: int,
    total_count: int,
    payload_json: str,
    error_text: str,
    created_at: str,
    started_at: str = "",
    finished_at: str = "",
    updated_at: str = "",
) -> Dict[str, Any]:
    ensure_schema()
    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                """
                INSERT INTO kb_jobs (
                    job_id, root_dir, job_type, source_type, source_key,
                    status, stage, message, progress, current_count, total_count,
                    payload_json, error_text, created_at, started_at, finished_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    root_dir,
                    job_type,
                    source_type,
                    source_key,
                    status,
                    stage,
                    message,
                    float(progress or 0.0),
                    int(current_count or 0),
                    int(total_count or 0),
                    payload_json or "{}",
                    error_text or "",
                    created_at or "",
                    started_at or "",
                    finished_at or "",
                    updated_at or created_at or "",
                ),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM kb_jobs WHERE job_id = ?", (job_id,)).fetchone()
            return _row_to_dict(row) or {}
        finally:
            conn.close()


def update_job(job_id: str, **fields: Any) -> Optional[Dict[str, Any]]:
    ensure_schema()
    allowed = {
        "status",
        "stage",
        "message",
        "progress",
        "current_count",
        "total_count",
        "payload_json",
        "error_text",
        "started_at",
        "finished_at",
        "updated_at",
    }
    updates = {key: value for key, value in fields.items() if key in allowed}
    if not updates:
        return get_job(job_id)
    with _db_lock:
        conn = _connect()
        try:
            columns = []
            values = []
            for key, value in updates.items():
                columns.append(f"{key} = ?")
                values.append(value)
            values.append(job_id)
            conn.execute(f"UPDATE kb_jobs SET {', '.join(columns)} WHERE job_id = ?", values)
            conn.commit()
            row = conn.execute("SELECT * FROM kb_jobs WHERE job_id = ?", (job_id,)).fetchone()
            return _row_to_dict(row)
        finally:
            conn.close()


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    ensure_schema()
    with _db_lock:
        conn = _connect()
        try:
            row = conn.execute("SELECT * FROM kb_jobs WHERE job_id = ?", (job_id,)).fetchone()
            return _row_to_dict(row)
        finally:
            conn.close()


def list_jobs(
    root_dir: str,
    *,
    limit: int = 50,
    source_type: Optional[str] = None,
    source_key: Optional[str] = None,
) -> List[Dict[str, Any]]:
    ensure_schema()
    limit = max(1, min(int(limit or 50), 200))
    query = "SELECT * FROM kb_jobs WHERE root_dir = ?"
    params: List[Any] = [root_dir]
    if source_type:
        query += " AND source_type = ?"
        params.append(source_type)
    if source_key:
        query += " AND source_key = ?"
        params.append(source_key)
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    with _db_lock:
        conn = _connect()
        try:
            rows = conn.execute(query, params).fetchall()
            return [_row_to_dict(row) or {} for row in rows]
        finally:
            conn.close()


def latest_job_for_source(root_dir: str, source_type: str, source_key: str) -> Optional[Dict[str, Any]]:
    ensure_schema()
    with _db_lock:
        conn = _connect()
        try:
            row = conn.execute(
                """
                SELECT * FROM kb_jobs
                WHERE root_dir = ? AND source_type = ? AND source_key = ?
                ORDER BY id DESC LIMIT 1
                """,
                (root_dir, source_type, source_key),
            ).fetchone()
            return _row_to_dict(row)
        finally:
            conn.close()


def latest_jobs_for_sources(root_dir: str, source_type: str, source_keys: List[str]) -> Dict[str, Dict[str, Any]]:
    ensure_schema()
    keys = [str(item or "").strip() for item in source_keys if str(item or "").strip()]
    if not keys:
        return {}
    placeholders = ",".join("?" for _ in keys)
    query = f"""
        SELECT j.*
        FROM kb_jobs j
        JOIN (
            SELECT source_key, MAX(id) AS max_id
            FROM kb_jobs
            WHERE root_dir = ? AND source_type = ? AND source_key IN ({placeholders})
            GROUP BY source_key
        ) latest
            ON latest.source_key = j.source_key
           AND latest.max_id = j.id
        WHERE j.root_dir = ? AND j.source_type = ?
    """
    params: List[Any] = [root_dir, source_type, *keys, root_dir, source_type]
    with _db_lock:
        conn = _connect()
        try:
            rows = conn.execute(query, params).fetchall()
            out: Dict[str, Dict[str, Any]] = {}
            for row in rows:
                item = _row_to_dict(row) or {}
                source_key = str(item.get("source_key") or "").strip()
                if source_key:
                    out[source_key] = item
            return out
        finally:
            conn.close()


def find_active_job(root_dir: str, source_type: str, source_key: str) -> Optional[Dict[str, Any]]:
    ensure_schema()
    with _db_lock:
        conn = _connect()
        try:
            row = conn.execute(
                """
                SELECT * FROM kb_jobs
                WHERE root_dir = ? AND source_type = ? AND source_key = ?
                  AND status IN ('queued', 'running')
                ORDER BY id DESC LIMIT 1
                """,
                (root_dir, source_type, source_key),
            ).fetchone()
            return _row_to_dict(row)
        finally:
            conn.close()


def recover_interrupted_jobs() -> None:
    ensure_schema()
    with _db_lock:
        conn = _connect()
        try:
            conn.execute(
                """
                UPDATE kb_jobs
                SET status = 'interrupted',
                    stage = 'interrupted',
                    message = CASE
                        WHEN message = '' THEN '后台任务在服务重启前中断'
                        ELSE message
                    END
                WHERE status IN ('queued', 'running')
                """
            )
            conn.commit()
        finally:
            conn.close()
