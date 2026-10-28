from __future__ import annotations

import json
import math
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional


MAX_TITLE_LENGTH = 120
MAX_MARKDOWN_LENGTH = 20_000
MAX_PART_PATH_LENGTH = 1_000


class ModelReviewValidationError(ValueError):
    pass


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _vector3(value: Any, field_name: str, *, normalize: bool = False) -> List[float]:
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ModelReviewValidationError(f"{field_name} 必须是包含 3 个数字的数组")

    try:
        vector = [float(item) for item in value]
    except (TypeError, ValueError) as exc:
        raise ModelReviewValidationError(f"{field_name} 必须是包含 3 个数字的数组") from exc

    if not all(math.isfinite(item) for item in vector):
        raise ModelReviewValidationError(f"{field_name} 不能包含无穷大或 NaN")

    if normalize:
        length = math.sqrt(sum(item * item for item in vector))
        if length <= 1e-9:
            raise ModelReviewValidationError(f"{field_name} 不能是零向量")
        vector = [item / length for item in vector]

    return vector


def normalize_annotation_payload(payload: Any, *, partial: bool = False) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        raise ModelReviewValidationError("请求内容必须是 JSON 对象")

    normalized: Dict[str, Any] = {}

    if not partial or "title" in payload:
        title = str(payload.get("title") or "").strip()
        if not title:
            raise ModelReviewValidationError("评论标题不能为空")
        if len(title) > MAX_TITLE_LENGTH:
            raise ModelReviewValidationError(f"评论标题不能超过 {MAX_TITLE_LENGTH} 个字符")
        normalized["title"] = title

    if not partial or "markdown" in payload:
        markdown = str(payload.get("markdown") or "").strip()
        if len(markdown) > MAX_MARKDOWN_LENGTH:
            raise ModelReviewValidationError(f"Markdown 内容不能超过 {MAX_MARKDOWN_LENGTH} 个字符")
        normalized["markdown"] = markdown

    position_supplied = "position" in payload
    normal_supplied = "normal" in payload
    if not partial or position_supplied or normal_supplied:
        if partial and position_supplied != normal_supplied:
            raise ModelReviewValidationError("重新定位时必须同时提供 position 和 normal")
        normalized["position"] = _vector3(payload.get("position"), "position")
        normalized["normal"] = _vector3(payload.get("normal"), "normal", normalize=True)

    if not partial or "surface_part_path" in payload:
        part_path = str(payload.get("surface_part_path") or "").strip()
        if len(part_path) > MAX_PART_PATH_LENGTH:
            raise ModelReviewValidationError(
                f"surface_part_path 不能超过 {MAX_PART_PATH_LENGTH} 个字符"
            )
        normalized["surface_part_path"] = part_path or None

    if partial and not normalized:
        raise ModelReviewValidationError("没有可更新的评论字段")

    return normalized


class ModelReviewManager:
    def __init__(self, db_path: str):
        self.db_path = os.path.abspath(db_path)
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        self._init_database()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_database(self) -> None:
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS model_annotations (
                    id TEXT PRIMARY KEY,
                    model_path TEXT NOT NULL,
                    title TEXT NOT NULL,
                    markdown TEXT NOT NULL,
                    position_json TEXT NOT NULL,
                    normal_json TEXT NOT NULL,
                    surface_part_path TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_model_annotations_path
                ON model_annotations(model_path, created_at)
                """
            )

    @staticmethod
    def _serialize_vector(vector: Iterable[float]) -> str:
        return json.dumps(list(vector), separators=(",", ":"))

    @staticmethod
    def _row_to_annotation(row: sqlite3.Row) -> Dict[str, Any]:
        return {
            "id": row["id"],
            "model_path": row["model_path"],
            "title": row["title"],
            "markdown": row["markdown"],
            "position": json.loads(row["position_json"]),
            "normal": json.loads(row["normal_json"]),
            "surface_part_path": row["surface_part_path"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def list_annotations(self, model_path: str) -> List[Dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM model_annotations
                WHERE model_path = ?
                ORDER BY created_at ASC, id ASC
                """,
                (model_path,),
            ).fetchall()
        return [self._row_to_annotation(row) for row in rows]

    def get_annotation(self, annotation_id: str) -> Optional[Dict[str, Any]]:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM model_annotations WHERE id = ?",
                (annotation_id,),
            ).fetchone()
        return self._row_to_annotation(row) if row else None

    def create_annotation(self, model_path: str, payload: Any) -> Dict[str, Any]:
        values = normalize_annotation_payload(payload)
        annotation_id = str(uuid.uuid4())
        now = _utc_now()

        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO model_annotations (
                    id, model_path, title, markdown, position_json, normal_json,
                    surface_part_path, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    annotation_id,
                    model_path,
                    values["title"],
                    values["markdown"],
                    self._serialize_vector(values["position"]),
                    self._serialize_vector(values["normal"]),
                    values["surface_part_path"],
                    now,
                    now,
                ),
            )

        return self.get_annotation(annotation_id)

    def update_annotation(self, annotation_id: str, payload: Any) -> Optional[Dict[str, Any]]:
        existing = self.get_annotation(annotation_id)
        if not existing:
            return None

        values = normalize_annotation_payload(payload, partial=True)
        updated = dict(existing)
        updated.update(values)
        updated_at = _utc_now()

        with self._connect() as connection:
            connection.execute(
                """
                UPDATE model_annotations
                SET title = ?, markdown = ?, position_json = ?, normal_json = ?,
                    surface_part_path = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    updated["title"],
                    updated["markdown"],
                    self._serialize_vector(updated["position"]),
                    self._serialize_vector(updated["normal"]),
                    updated.get("surface_part_path"),
                    updated_at,
                    annotation_id,
                ),
            )

        return self.get_annotation(annotation_id)

    def delete_annotation(self, annotation_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute(
                "DELETE FROM model_annotations WHERE id = ?",
                (annotation_id,),
            )
        return cursor.rowcount > 0
