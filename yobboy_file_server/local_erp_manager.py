from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional

from .paths import package_dir, project_base_dir


DOC_PREFIXES = {
    "purchase_in": "PI",
    "production_in": "FI",
    "material_issue": "MI",
    "material_return": "MR",
    "transfer": "TR",
    "stock_count": "SC",
    "stock_adjust": "SA",
    "other_in": "OI",
    "other_out": "OO",
}

INBOUND_DOC_TYPES = {"purchase_in", "production_in", "material_return", "other_in"}
OUTBOUND_DOC_TYPES = {"material_issue", "other_out"}
TWO_WAY_DOC_TYPES = {"transfer"}


def _now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _today_text() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _normalize_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _normalize_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


class LocalERPManager:
    def __init__(self, db_path: Optional[str] = None) -> None:
        data_dir = os.path.join(project_base_dir(), "data", "local_erp")
        os.makedirs(data_dir, exist_ok=True)
        self.db_path = db_path or os.path.join(data_dir, "erp.sqlite3")
        self._lock = threading.RLock()
        self._schema_path = self._resolve_schema_path()
        self.ensure_initialized()

    def _resolve_schema_path(self) -> str:
        candidates = [
            os.path.join(package_dir(), "sql", "local_erp_schema.sql"),
            os.path.join(project_base_dir(), "yobboy_file_server", "sql", "local_erp_schema.sql"),
            os.path.join(project_base_dir(), "sql", "local_erp_schema.sql"),
        ]
        for candidate in candidates:
            if os.path.isfile(candidate):
                return candidate
        return candidates[0]

    def ensure_initialized(self) -> None:
        with self._lock:
            with self._connect() as conn:
                with open(self._schema_path, "r", encoding="utf-8") as schema_file:
                    conn.executescript(schema_file.read())
                self._seed_base_data(conn)
                conn.commit()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _seed_base_data(self, conn: sqlite3.Connection) -> None:
        now = _now_text()
        conn.execute(
            """
            INSERT OR IGNORE INTO units(unit_code, unit_name, precision_digits, remark)
            VALUES ('PCS', '个', 2, '默认单位')
            """
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO item_categories(category_code, category_name, sort_order, is_enabled, remark)
            VALUES ('DEFAULT', '默认分类', 0, 1, '系统默认')
            """
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO warehouses(
                warehouse_code, warehouse_name, warehouse_type, is_enabled, remark, created_at, updated_at
            ) VALUES ('MAIN', '主仓库', 'normal', 1, '系统默认', ?, ?)
            """,
            (now, now),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO settings(setting_key, setting_value, updated_at)
            VALUES ('erp_initialized_at', ?, ?)
            """,
            (now, now),
        )

    def get_runtime_info(self) -> Dict[str, Any]:
        self.ensure_initialized()
        return {
            "db_path": self.db_path,
            "db_exists": os.path.exists(self.db_path),
            "initialized_at": _now_text(),
        }

    def _default_unit_id(self, conn: sqlite3.Connection) -> Optional[int]:
        row = conn.execute(
            "SELECT id FROM units WHERE unit_code = 'PCS' ORDER BY id LIMIT 1"
        ).fetchone()
        return row["id"] if row else None

    def _default_warehouse_id(self, conn: sqlite3.Connection) -> Optional[int]:
        row = conn.execute(
            "SELECT id FROM warehouses WHERE warehouse_code = 'MAIN' ORDER BY id LIMIT 1"
        ).fetchone()
        return row["id"] if row else None

    def list_warehouses(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, warehouse_code, warehouse_name, warehouse_type, is_enabled, remark
                FROM warehouses
                ORDER BY warehouse_code
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def get_warehouse(self, warehouse_id: int) -> Dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT id, warehouse_code, warehouse_name, warehouse_type, is_enabled, remark
                FROM warehouses
                WHERE id = ?
                """,
                (warehouse_id,),
            ).fetchone()
        if row is None:
            raise ValueError("仓库不存在")
        return dict(row)

    def _validate_warehouse_disable(self, conn: sqlite3.Connection, warehouse_id: int) -> None:
        item_row = conn.execute(
            """
            SELECT item_code
            FROM items
            WHERE default_warehouse_id = ? AND is_enabled = 1
            ORDER BY item_code
            LIMIT 1
            """,
            (warehouse_id,),
        ).fetchone()
        if item_row is not None:
            raise ValueError(f"该仓库仍被启用物料引用：{item_row['item_code']}")

        inventory_row = conn.execute(
            """
            SELECT qty_on_hand
            FROM inventory_balances
            WHERE warehouse_id = ? AND ABS(qty_on_hand) > 0.000001
            LIMIT 1
            """,
            (warehouse_id,),
        ).fetchone()
        if inventory_row is not None:
            raise ValueError("该仓库仍有库存，不能停用")

        work_order_row = conn.execute(
            """
            SELECT work_order_no
            FROM work_orders
            WHERE warehouse_id = ? AND status IN ('draft', 'released', 'in_progress')
            ORDER BY id DESC
            LIMIT 1
            """,
            (warehouse_id,),
        ).fetchone()
        if work_order_row is not None:
            raise ValueError(f"该仓库仍被工单占用：{work_order_row['work_order_no']}")

    def create_warehouse(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        warehouse_code = (payload.get("warehouse_code") or "").strip().upper()
        warehouse_name = (payload.get("warehouse_name") or "").strip()
        if not warehouse_code:
            raise ValueError("仓库编码不能为空")
        if not warehouse_name:
            raise ValueError("仓库名称不能为空")

        now = _now_text()
        with self._lock, self._connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO warehouses(
                    warehouse_code, warehouse_name, warehouse_type, is_enabled, remark, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    warehouse_code,
                    warehouse_name,
                    (payload.get("warehouse_type") or "normal").strip(),
                    1 if payload.get("is_enabled", True) else 0,
                    (payload.get("remark") or "").strip(),
                    now,
                    now,
                ),
            )
            warehouse_id = cursor.lastrowid
            self._log_operation(conn, "erp_master_data", "create", "warehouse", warehouse_id, payload)
            conn.commit()
        return self.get_warehouse(warehouse_id)

    def update_warehouse(self, warehouse_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        current = self.get_warehouse(warehouse_id)
        now = _now_text()
        with self._lock, self._connect() as conn:
            target_enabled = 1 if payload.get("is_enabled", current["is_enabled"]) else 0
            if current["is_enabled"] and not target_enabled:
                self._validate_warehouse_disable(conn, warehouse_id)
            conn.execute(
                """
                UPDATE warehouses
                SET warehouse_name = ?, warehouse_type = ?, is_enabled = ?, remark = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    (payload.get("warehouse_name") or current["warehouse_name"]).strip(),
                    (payload.get("warehouse_type") or current["warehouse_type"]).strip(),
                    target_enabled,
                    (payload.get("remark") if "remark" in payload else current["remark"]) or "",
                    now,
                    warehouse_id,
                ),
            )
            self._log_operation(conn, "erp_master_data", "update", "warehouse", warehouse_id, payload)
            conn.commit()
        return self.get_warehouse(warehouse_id)

    def list_items(self, keyword: str = "") -> List[Dict[str, Any]]:
        keyword = (keyword or "").strip()
        params: List[Any] = []
        where = ""
        if keyword:
            where = "WHERE i.item_code LIKE ? OR i.item_name LIKE ? OR i.spec LIKE ?"
            like_value = f"%{keyword}%"
            params.extend([like_value, like_value, like_value])

        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    i.id,
                    i.item_code,
                    i.item_name,
                    i.spec,
                    i.item_type,
                    i.safety_stock,
                    i.min_stock,
                    i.is_enabled,
                    i.remark,
                    i.default_warehouse_id,
                    u.unit_name,
                    w.warehouse_name AS default_warehouse_name,
                    COALESCE(SUM(ib.qty_on_hand), 0) AS qty_on_hand
                FROM items i
                LEFT JOIN units u ON u.id = i.unit_id
                LEFT JOIN warehouses w ON w.id = i.default_warehouse_id
                LEFT JOIN inventory_balances ib ON ib.item_id = i.id
                {where}
                GROUP BY i.id
                ORDER BY i.item_code
                """,
                params,
            ).fetchall()
        return [dict(row) for row in rows]

    def list_custom_fields(self, entity_name: str) -> List[Dict[str, Any]]:
        entity_name = (entity_name or "").strip()
        if not entity_name:
            raise ValueError("实体名称不能为空")
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    id, entity_name, field_name, field_label, field_type,
                    is_required, is_enabled, sort_order, options_json, default_value
                FROM custom_fields
                WHERE entity_name = ?
                ORDER BY sort_order, id
                """,
                (entity_name,),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_custom_field_values(self, entity_name: str, record_id: int) -> Dict[str, Any]:
        if record_id <= 0:
            return {}
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT field_name, field_value
                FROM custom_field_values
                WHERE entity_name = ? AND record_id = ?
                """,
                (entity_name, record_id),
            ).fetchall()
        return {row["field_name"]: row["field_value"] for row in rows}

    def upsert_custom_field(self, entity_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        entity_name = (entity_name or "").strip()
        field_name = (payload.get("field_name") or "").strip()
        field_label = (payload.get("field_label") or "").strip()
        field_type = (payload.get("field_type") or "").strip()
        if not entity_name:
            raise ValueError("实体名称不能为空")
        if not field_name:
            raise ValueError("字段名不能为空")
        if not field_label:
            raise ValueError("字段显示名不能为空")
        if not field_type:
            raise ValueError("字段类型不能为空")

        with self._lock, self._connect() as conn:
            existing = conn.execute(
                """
                SELECT id
                FROM custom_fields
                WHERE entity_name = ? AND field_name = ?
                """,
                (entity_name, field_name),
            ).fetchone()
            if existing is None:
                cursor = conn.execute(
                    """
                    INSERT INTO custom_fields(
                        entity_name, field_name, field_label, field_type,
                        is_required, is_enabled, sort_order, options_json, default_value
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        entity_name,
                        field_name,
                        field_label,
                        field_type,
                        1 if payload.get("is_required") else 0,
                        1 if payload.get("is_enabled", True) else 0,
                        _normalize_int(payload.get("sort_order")),
                        payload.get("options_json") or "",
                        payload.get("default_value") or "",
                    ),
                )
                field_id = cursor.lastrowid
                operation = "create"
            else:
                field_id = existing["id"]
                conn.execute(
                    """
                    UPDATE custom_fields
                    SET field_label = ?, field_type = ?, is_required = ?, is_enabled = ?,
                        sort_order = ?, options_json = ?, default_value = ?
                    WHERE id = ?
                    """,
                    (
                        field_label,
                        field_type,
                        1 if payload.get("is_required") else 0,
                        1 if payload.get("is_enabled", True) else 0,
                        _normalize_int(payload.get("sort_order")),
                        payload.get("options_json") or "",
                        payload.get("default_value") or "",
                        field_id,
                    ),
                )
                operation = "update"
            self._log_operation(
                conn,
                "erp_custom_fields",
                operation,
                "custom_field",
                field_id,
                {"entity_name": entity_name, **payload},
            )
            conn.commit()
        return self.list_custom_fields(entity_name)[-1 if operation == "create" else 0] if self.list_custom_fields(entity_name) else {}

    def save_custom_field_values(
        self,
        entity_name: str,
        record_id: int,
        values: Dict[str, Any],
        conn: Optional[sqlite3.Connection] = None,
    ) -> None:
        if record_id <= 0:
            return
        managed_connection = False
        if conn is None:
            conn = self._connect()
            managed_connection = True
        try:
            for field_name, field_value in (values or {}).items():
                existing = conn.execute(
                    """
                    SELECT id
                    FROM custom_field_values
                    WHERE entity_name = ? AND record_id = ? AND field_name = ?
                    """,
                    (entity_name, record_id, field_name),
                ).fetchone()
                normalized_value = "" if field_value is None else str(field_value)
                if existing is None:
                    conn.execute(
                        """
                        INSERT INTO custom_field_values(entity_name, record_id, field_name, field_value)
                        VALUES (?, ?, ?, ?)
                        """,
                        (entity_name, record_id, field_name, normalized_value),
                    )
                else:
                    conn.execute(
                        """
                        UPDATE custom_field_values
                        SET field_value = ?
                        WHERE id = ?
                        """,
                        (normalized_value, existing["id"]),
                    )
            if managed_connection:
                conn.commit()
        finally:
            if managed_connection:
                conn.close()

    def get_item(self, item_id: int) -> Dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    i.*,
                    u.unit_name,
                    w.warehouse_name AS default_warehouse_name
                FROM items i
                LEFT JOIN units u ON u.id = i.unit_id
                LEFT JOIN warehouses w ON w.id = i.default_warehouse_id
                WHERE i.id = ?
                """,
                (item_id,),
            ).fetchone()
        if row is None:
            raise ValueError("物料不存在")
            return {}
        item = dict(row)
        item["custom_field_values"] = self.get_custom_field_values("items", item_id)
        return item

    def create_item(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        item_code = (payload.get("item_code") or "").strip().upper()
        item_name = (payload.get("item_name") or "").strip()
        if not item_code:
            raise ValueError("物料编码不能为空")
        if not item_name:
            raise ValueError("物料名称不能为空")

        now = _now_text()
        with self._lock, self._connect() as conn:
            unit_id = _normalize_int(payload.get("unit_id")) or self._default_unit_id(conn)
            warehouse_id = _normalize_int(payload.get("default_warehouse_id")) or self._default_warehouse_id(conn)
            cursor = conn.execute(
                """
                INSERT INTO items(
                    item_code, item_name, spec, category_id, unit_id, item_type,
                    default_warehouse_id, safety_stock, min_stock, is_enabled, remark,
                    created_at, updated_at, created_by, updated_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item_code,
                    item_name,
                    (payload.get("spec") or "").strip(),
                    _normalize_int(payload.get("category_id")) or None,
                    unit_id,
                    (payload.get("item_type") or "raw_material").strip(),
                    warehouse_id,
                    _normalize_float(payload.get("safety_stock")),
                    _normalize_float(payload.get("min_stock")),
                    1 if payload.get("is_enabled", True) else 0,
                    (payload.get("remark") or "").strip(),
                    now,
                    now,
                    "system",
                    "system",
                ),
            )
            item_id = cursor.lastrowid
            self.save_custom_field_values("items", item_id, payload.get("custom_field_values") or {}, conn=conn)
            self._log_operation(conn, "erp_items", "create", "item", item_id, payload)
            conn.commit()
        return self.get_item(item_id)

    def update_item(self, item_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        current = self.get_item(item_id)
        now = _now_text()
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE items
                SET item_code = ?, item_name = ?, spec = ?, item_type = ?, default_warehouse_id = ?,
                    safety_stock = ?, min_stock = ?, is_enabled = ?, remark = ?, updated_at = ?, updated_by = ?
                WHERE id = ?
                """,
                (
                    (payload.get("item_code") or current["item_code"]).strip().upper(),
                    (payload.get("item_name") or current["item_name"]).strip(),
                    (payload.get("spec") if "spec" in payload else current["spec"]) or "",
                    (payload.get("item_type") or current["item_type"]).strip(),
                    _normalize_int(payload.get("default_warehouse_id"), current["default_warehouse_id"] or 0) or None,
                    _normalize_float(payload.get("safety_stock"), current["safety_stock"]),
                    _normalize_float(payload.get("min_stock"), current["min_stock"]),
                    1 if payload.get("is_enabled", current["is_enabled"]) else 0,
                    (payload.get("remark") if "remark" in payload else current["remark"]) or "",
                    now,
                    "system",
                    item_id,
                ),
            )
            self.save_custom_field_values("items", item_id, payload.get("custom_field_values") or {}, conn=conn)
            self._log_operation(conn, "erp_items", "update", "item", item_id, payload)
            conn.commit()
        return self.get_item(item_id)

    def get_item(self, item_id: int) -> Dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    i.*,
                    u.unit_name,
                    w.warehouse_name AS default_warehouse_name
                FROM items i
                LEFT JOIN units u ON u.id = i.unit_id
                LEFT JOIN warehouses w ON w.id = i.default_warehouse_id
                WHERE i.id = ?
                """,
                (item_id,),
            ).fetchone()
        if row is None:
            raise ValueError("物料不存在")
        item = dict(row)
        item["custom_field_values"] = self.get_custom_field_values("items", item_id)
        return item

    def upsert_custom_field(self, entity_name: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        entity_name = (entity_name or "").strip()
        field_name = (payload.get("field_name") or "").strip()
        field_label = (payload.get("field_label") or "").strip()
        field_type = (payload.get("field_type") or "").strip()
        if not entity_name:
            raise ValueError("实体名称不能为空")
        if not field_name:
            raise ValueError("字段名不能为空")
        if not field_label:
            raise ValueError("字段显示名不能为空")
        if not field_type:
            raise ValueError("字段类型不能为空")

        with self._lock, self._connect() as conn:
            existing = conn.execute(
                """
                SELECT id
                FROM custom_fields
                WHERE entity_name = ? AND field_name = ?
                """,
                (entity_name, field_name),
            ).fetchone()
            if existing is None:
                cursor = conn.execute(
                    """
                    INSERT INTO custom_fields(
                        entity_name, field_name, field_label, field_type,
                        is_required, is_enabled, sort_order, options_json, default_value
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        entity_name,
                        field_name,
                        field_label,
                        field_type,
                        1 if payload.get("is_required") else 0,
                        1 if payload.get("is_enabled", True) else 0,
                        _normalize_int(payload.get("sort_order")),
                        payload.get("options_json") or "",
                        payload.get("default_value") or "",
                    ),
                )
                field_id = cursor.lastrowid
                operation = "create"
            else:
                field_id = existing["id"]
                conn.execute(
                    """
                    UPDATE custom_fields
                    SET field_label = ?, field_type = ?, is_required = ?, is_enabled = ?,
                        sort_order = ?, options_json = ?, default_value = ?
                    WHERE id = ?
                    """,
                    (
                        field_label,
                        field_type,
                        1 if payload.get("is_required") else 0,
                        1 if payload.get("is_enabled", True) else 0,
                        _normalize_int(payload.get("sort_order")),
                        payload.get("options_json") or "",
                        payload.get("default_value") or "",
                        field_id,
                    ),
                )
                operation = "update"
            self._log_operation(
                conn,
                "erp_custom_fields",
                operation,
                "custom_field",
                field_id,
                {"entity_name": entity_name, **payload},
            )
            conn.commit()
        fields = self.list_custom_fields(entity_name)
        for field in fields:
            if field["field_name"] == field_name:
                return field
        return {}

    def list_inventory_balances(
        self,
        keyword: str = "",
        warehouse_id: Optional[int] = None,
        only_warning: bool = False,
    ) -> List[Dict[str, Any]]:
        conditions = []
        params: List[Any] = []
        if keyword:
            conditions.append("(i.item_code LIKE ? OR i.item_name LIKE ?)")
            like_value = f"%{keyword.strip()}%"
            params.extend([like_value, like_value])
        if warehouse_id:
            conditions.append("ib.warehouse_id = ?")
            params.append(warehouse_id)
        if only_warning:
            conditions.append("ib.qty_available < i.safety_stock")
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    ib.id,
                    i.id AS item_id,
                    i.item_code,
                    i.item_name,
                    i.item_type,
                    i.safety_stock,
                    w.warehouse_code,
                    w.warehouse_name,
                    ib.batch_no,
                    ib.qty_on_hand,
                    ib.qty_available,
                    ib.updated_at
                FROM inventory_balances ib
                INNER JOIN items i ON i.id = ib.item_id
                INNER JOIN warehouses w ON w.id = ib.warehouse_id
                {where}
                ORDER BY i.item_code, w.warehouse_code, ib.batch_no
                """,
                params,
            ).fetchall()
        return [dict(row) for row in rows]

    def list_inventory_ledger(self, limit: int = 100) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    l.id,
                    l.biz_date,
                    i.item_code,
                    i.item_name,
                    w.warehouse_code,
                    w.warehouse_name,
                    l.batch_no,
                    l.doc_type,
                    d.doc_no,
                    l.direction,
                    l.qty,
                    l.balance_after,
                    l.trace_key,
                    l.source_trace_key,
                    l.remark
                FROM inventory_ledger l
                INNER JOIN items i ON i.id = l.item_id
                INNER JOIN warehouses w ON w.id = l.warehouse_id
                INNER JOIN stock_documents d ON d.id = l.doc_id
                ORDER BY l.id DESC
                LIMIT ?
                """,
                (_normalize_int(limit, 100),),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_boms(self, parent_item_id: int = 0) -> List[Dict[str, Any]]:
        conditions: List[str] = []
        params: List[Any] = []
        normalized_parent_item_id = _normalize_int(parent_item_id)
        if normalized_parent_item_id > 0:
            conditions.append("b.parent_item_id = ?")
            params.append(normalized_parent_item_id)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    b.id,
                    b.bom_code,
                    b.parent_item_id,
                    b.version_no,
                    b.status,
                    b.is_default_version,
                    b.effective_date,
                    b.updated_at,
                    b.remark,
                    i.item_code AS parent_item_code,
                    i.item_name AS parent_item_name,
                    COUNT(bi.id) AS component_count
                FROM boms b
                INNER JOIN items i ON i.id = b.parent_item_id
                LEFT JOIN bom_items bi ON bi.bom_id = b.id
                {where}
                GROUP BY b.id
                ORDER BY b.parent_item_id ASC, b.is_default_version DESC, b.id DESC
                """,
                params,
            ).fetchall()
        return [dict(row) for row in rows]

    def get_bom(self, bom_id: int) -> Dict[str, Any]:
        with self._connect() as conn:
            header = conn.execute(
                """
                SELECT
                    b.*,
                    i.item_code AS parent_item_code,
                    i.item_name AS parent_item_name
                FROM boms b
                INNER JOIN items i ON i.id = b.parent_item_id
                WHERE b.id = ?
                """,
                (bom_id,),
            ).fetchone()
            if header is None:
                raise ValueError("BOM 不存在")
            items = conn.execute(
                """
                SELECT
                    bi.*,
                    i.item_code AS component_item_code,
                    i.item_name AS component_item_name,
                    u.unit_name
                FROM bom_items bi
                INNER JOIN items i ON i.id = bi.component_item_id
                LEFT JOIN units u ON u.id = bi.unit_id
                WHERE bi.bom_id = ?
                ORDER BY bi.line_no, bi.id
                """,
                (bom_id,),
            ).fetchall()
        return {**dict(header), "items": [dict(row) for row in items]}

    def _replace_bom_items(self, conn: sqlite3.Connection, bom_id: int, components: List[Dict[str, Any]]) -> None:
        if not isinstance(components, list) or not components:
            raise ValueError("BOM 至少需要一个子件")
        conn.execute("DELETE FROM bom_items WHERE bom_id = ?", (bom_id,))
        default_unit_id = self._default_unit_id(conn)
        for index, component in enumerate(components, start=1):
            component_item_id = _normalize_int(component.get("component_item_id"))
            qty = _normalize_float(component.get("qty"))
            if component_item_id <= 0 or qty <= 0:
                raise ValueError("BOM 子件的物料和数量必须有效")
            conn.execute(
                """
                INSERT INTO bom_items(
                    bom_id, line_no, component_item_id, qty, unit_id, loss_rate,
                    is_optional, substitute_group, remark
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    bom_id,
                    index,
                    component_item_id,
                    qty,
                    _normalize_int(component.get("unit_id")) or default_unit_id,
                    _normalize_float(component.get("loss_rate")),
                    1 if component.get("is_optional") else 0,
                    (component.get("substitute_group") or "").strip(),
                    (component.get("remark") or "").strip(),
                ),
            )

    def _set_default_bom_version(self, conn: sqlite3.Connection, parent_item_id: int, bom_id: int, is_default: bool) -> None:
        if not is_default:
            return
        conn.execute(
            "UPDATE boms SET is_default_version = 0, updated_at = ? WHERE parent_item_id = ? AND id <> ?",
            (_now_text(), parent_item_id, bom_id),
        )

    def create_bom(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        parent_item_id = _normalize_int(payload.get("parent_item_id"))
        if parent_item_id <= 0:
            raise ValueError("请选择父项物料")
        components = payload.get("items") or []
        if not isinstance(components, list) or not components:
            raise ValueError("BOM 至少需要一个子件")

        with self._lock, self._connect() as conn:
            parent_item = conn.execute(
                "SELECT id, item_code FROM items WHERE id = ?",
                (parent_item_id,),
            ).fetchone()
            if parent_item is None:
                raise ValueError("父项物料不存在")

            version_no = (payload.get("version_no") or "V1").strip().upper()
            now = _now_text()
            bom_code = (payload.get("bom_code") or f"BOM-{parent_item['item_code']}-{version_no}").strip().upper()
            is_default_version = 1 if payload.get("is_default_version", True) else 0
            try:
                cursor = conn.execute(
                    """
                    INSERT INTO boms(
                        bom_code, parent_item_id, version_no, status, is_default_version,
                        effective_date, expired_date, remark, created_at, updated_at, created_by, updated_by
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        bom_code,
                        parent_item_id,
                        version_no,
                        (payload.get("status") or "submitted").strip(),
                        is_default_version,
                        payload.get("effective_date") or _today_text(),
                        payload.get("expired_date") or "",
                        (payload.get("remark") or "").strip(),
                        now,
                        now,
                        "system",
                        "system",
                    ),
                )
            except sqlite3.IntegrityError as exc:
                message = str(exc)
                if "boms.bom_code" in message:
                    raise ValueError("BOM 编号已存在") from exc
                if "boms.parent_item_id, boms.version_no" in message:
                    raise ValueError("同一父项的 BOM 版本号已存在") from exc
                raise ValueError("BOM 保存失败，请检查数据是否重复") from exc
            bom_id = cursor.lastrowid
            self._replace_bom_items(conn, bom_id, components)
            self._set_default_bom_version(conn, parent_item_id, bom_id, bool(is_default_version))
            self._log_operation(conn, "erp_bom", "create", "bom", bom_id, payload)
            conn.commit()
        return self.get_bom(bom_id)

    def update_bom(self, bom_id: int, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock, self._connect() as conn:
            existing = conn.execute(
                "SELECT id, parent_item_id, version_no, bom_code, status, is_default_version, effective_date, expired_date, remark FROM boms WHERE id = ?",
                (bom_id,),
            ).fetchone()
            if existing is None:
                raise ValueError("BOM 不存在")

            parent_item_id = _normalize_int(payload.get("parent_item_id")) or int(existing["parent_item_id"])
            parent_item = conn.execute(
                "SELECT id, item_code FROM items WHERE id = ?",
                (parent_item_id,),
            ).fetchone()
            if parent_item is None:
                raise ValueError("父项物料不存在")

            version_no = (payload.get("version_no") or existing["version_no"] or "V1").strip().upper()
            bom_code = (payload.get("bom_code") or existing["bom_code"] or f"BOM-{parent_item['item_code']}-{version_no}").strip().upper()
            status = (payload.get("status") or existing["status"] or "submitted").strip()
            effective_date = payload.get("effective_date")
            expired_date = payload.get("expired_date")
            remark = payload.get("remark")
            is_default_version = 1 if payload.get("is_default_version", bool(existing["is_default_version"])) else 0
            now = _now_text()

            try:
                conn.execute(
                    """
                    UPDATE boms
                    SET
                        bom_code = ?,
                        parent_item_id = ?,
                        version_no = ?,
                        status = ?,
                        is_default_version = ?,
                        effective_date = ?,
                        expired_date = ?,
                        remark = ?,
                        updated_at = ?,
                        updated_by = ?
                    WHERE id = ?
                    """,
                    (
                        bom_code,
                        parent_item_id,
                        version_no,
                        status,
                        is_default_version,
                        effective_date if effective_date is not None else existing["effective_date"],
                        expired_date if expired_date is not None else existing["expired_date"],
                        (remark.strip() if isinstance(remark, str) else existing["remark"]),
                        now,
                        "system",
                        bom_id,
                    ),
                )
            except sqlite3.IntegrityError as exc:
                message = str(exc)
                if "boms.bom_code" in message:
                    raise ValueError("BOM 编号已存在") from exc
                if "boms.parent_item_id, boms.version_no" in message:
                    raise ValueError("同一父项的 BOM 版本号已存在") from exc
                raise ValueError("BOM 更新失败，请检查数据是否重复") from exc

            if "items" in payload:
                self._replace_bom_items(conn, bom_id, payload.get("items") or [])
            self._set_default_bom_version(conn, parent_item_id, bom_id, bool(is_default_version))
            self._log_operation(conn, "erp_bom", "update", "bom", bom_id, payload)
            conn.commit()
        return self.get_bom(bom_id)

    def compare_boms(self, left_bom_id: int, right_bom_id: int) -> Dict[str, Any]:
        left_bom = self.get_bom(left_bom_id)
        right_bom = self.get_bom(right_bom_id)

        def _normalize_item(item: Dict[str, Any]) -> Dict[str, Any]:
            return {
                "component_item_id": item["component_item_id"],
                "component_item_code": item.get("component_item_code") or "",
                "component_item_name": item.get("component_item_name") or "",
                "qty": float(item.get("qty") or 0),
                "loss_rate": float(item.get("loss_rate") or 0),
                "is_optional": bool(item.get("is_optional")),
                "substitute_group": item.get("substitute_group") or "",
                "remark": item.get("remark") or "",
            }

        left_items = {_normalize_item(item)["component_item_id"]: _normalize_item(item) for item in left_bom.get("items", [])}
        right_items = {_normalize_item(item)["component_item_id"]: _normalize_item(item) for item in right_bom.get("items", [])}

        added: List[Dict[str, Any]] = []
        removed: List[Dict[str, Any]] = []
        changed: List[Dict[str, Any]] = []

        for component_item_id, left_item in left_items.items():
            right_item = right_items.get(component_item_id)
            if right_item is None:
                removed.append(left_item)
                continue
            field_changes: List[Dict[str, Any]] = []
            for field_name in ("qty", "loss_rate", "is_optional", "substitute_group", "remark"):
                if left_item[field_name] != right_item[field_name]:
                    field_changes.append(
                        {
                            "field": field_name,
                            "left": left_item[field_name],
                            "right": right_item[field_name],
                        }
                    )
            if field_changes:
                changed.append(
                    {
                        "component_item_id": component_item_id,
                        "component_item_code": left_item["component_item_code"] or right_item["component_item_code"],
                        "component_item_name": left_item["component_item_name"] or right_item["component_item_name"],
                        "left_item": left_item,
                        "right_item": right_item,
                        "field_changes": field_changes,
                    }
                )

        for component_item_id, right_item in right_items.items():
            if component_item_id not in left_items:
                added.append(right_item)

        return {
            "same_parent_item": left_bom["parent_item_id"] == right_bom["parent_item_id"],
            "left_bom": left_bom,
            "right_bom": right_bom,
            "summary": {
                "left_component_count": len(left_items),
                "right_component_count": len(right_items),
                "added_count": len(added),
                "removed_count": len(removed),
                "changed_count": len(changed),
            },
            "added_items": added,
            "removed_items": removed,
            "changed_items": changed,
        }

    def list_work_orders(self) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    wo.id,
                    wo.work_order_no,
                    wo.status,
                    wo.plan_qty,
                    wo.finished_qty,
                    wo.planned_start_date,
                    wo.planned_end_date,
                    wo.actual_start_date,
                    wo.actual_end_date,
                    wo.remark,
                    i.item_code AS parent_item_code,
                    i.item_name AS parent_item_name,
                    b.bom_code,
                    COUNT(wom.id) AS material_count
                FROM work_orders wo
                INNER JOIN items i ON i.id = wo.parent_item_id
                LEFT JOIN boms b ON b.id = wo.bom_id
                LEFT JOIN work_order_materials wom ON wom.work_order_id = wo.id
                GROUP BY wo.id
                ORDER BY wo.id DESC
                """
            ).fetchall()
        return [dict(row) for row in rows]

    def list_trace_links(
        self,
        item_keyword: str = "",
        batch_no: str = "",
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        conditions = []
        params: List[Any] = []
        if item_keyword:
            conditions.append("(i.item_code LIKE ? OR i.item_name LIKE ?)")
            like_value = f"%{item_keyword.strip()}%"
            params.extend([like_value, like_value])
        if batch_no:
            conditions.append("mtl.batch_no LIKE ?")
            params.append(f"%{batch_no.strip()}%")
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        params.append(_normalize_int(limit, 100))

        with self._connect() as conn:
            rows = conn.execute(
                f"""
                SELECT
                    mtl.id,
                    i.item_code,
                    i.item_name,
                    mtl.batch_no,
                    mtl.from_doc_type,
                    mtl.from_doc_id,
                    mtl.to_doc_type,
                    mtl.to_doc_id,
                    mtl.qty,
                    mtl.trace_type,
                    mtl.created_at
                FROM material_trace_links mtl
                INNER JOIN items i ON i.id = mtl.item_id
                {where}
                ORDER BY mtl.id DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        return [dict(row) for row in rows]

    def get_work_order(self, work_order_id: int) -> Dict[str, Any]:
        with self._connect() as conn:
            header = conn.execute(
                """
                SELECT
                    wo.*,
                    i.item_code AS parent_item_code,
                    i.item_name AS parent_item_name,
                    b.bom_code
                FROM work_orders wo
                INNER JOIN items i ON i.id = wo.parent_item_id
                LEFT JOIN boms b ON b.id = wo.bom_id
                WHERE wo.id = ?
                """,
                (work_order_id,),
            ).fetchone()
            if header is None:
                raise ValueError("工单不存在")
            materials = conn.execute(
                """
                SELECT
                    wom.*,
                    i.item_code,
                    i.item_name,
                    u.unit_name
                FROM work_order_materials wom
                INNER JOIN items i ON i.id = wom.item_id
                LEFT JOIN units u ON u.id = wom.unit_id
                WHERE wom.work_order_id = ?
                ORDER BY wom.id
                """,
                (work_order_id,),
            ).fetchall()
            relations = conn.execute(
                """
                SELECT from_doc_type, from_doc_id, to_doc_type, to_doc_id, relation_type, created_at
                FROM document_relations
                WHERE (from_doc_type = 'work_order' AND from_doc_id = ?)
                   OR (to_doc_type = 'work_order' AND to_doc_id = ?)
                ORDER BY id DESC
                """,
                (work_order_id, work_order_id),
            ).fetchall()
        return {
            **dict(header),
            "materials": [dict(row) for row in materials],
            "relations": [dict(row) for row in relations],
        }

    def create_work_order(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        parent_item_id = _normalize_int(payload.get("parent_item_id"))
        bom_id = _normalize_int(payload.get("bom_id"))
        plan_qty = _normalize_float(payload.get("plan_qty"))
        if parent_item_id <= 0:
            raise ValueError("请选择成品物料")
        if bom_id <= 0:
            raise ValueError("请选择 BOM")
        if plan_qty <= 0:
            raise ValueError("计划数量必须大于 0")

        with self._lock, self._connect() as conn:
            bom = conn.execute(
                "SELECT id, parent_item_id FROM boms WHERE id = ?",
                (bom_id,),
            ).fetchone()
            if bom is None:
                raise ValueError("BOM 不存在")
            if bom["parent_item_id"] != parent_item_id:
                raise ValueError("工单成品与 BOM 父项不一致")

            bom_items = conn.execute(
                "SELECT component_item_id, qty, unit_id, remark FROM bom_items WHERE bom_id = ? ORDER BY line_no, id",
                (bom_id,),
            ).fetchall()
            if not bom_items:
                raise ValueError("所选 BOM 没有子件")

            now = _now_text()
            work_order_no = self._generate_work_order_no(conn)
            cursor = conn.execute(
                """
                INSERT INTO work_orders(
                    work_order_no, status, parent_item_id, bom_id, plan_qty, finished_qty, warehouse_id,
                    planned_start_date, planned_end_date, actual_start_date, actual_end_date,
                    remark, created_at, updated_at, created_by, updated_by
                ) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, '', '', ?, ?, ?, ?, ?)
                """,
                (
                    work_order_no,
                    (payload.get("status") or "released").strip(),
                    parent_item_id,
                    bom_id,
                    plan_qty,
                    _normalize_int(payload.get("warehouse_id")) or self._default_warehouse_id(conn),
                    payload.get("planned_start_date") or _today_text(),
                    payload.get("planned_end_date") or "",
                    (payload.get("remark") or "").strip(),
                    now,
                    now,
                    "system",
                    "system",
                ),
            )
            work_order_id = cursor.lastrowid
            for bom_item in bom_items:
                required_qty = plan_qty * float(bom_item["qty"])
                conn.execute(
                    """
                    INSERT INTO work_order_materials(
                        work_order_id, item_id, required_qty, issued_qty, returned_qty,
                        consumed_qty, unit_id, remark
                    ) VALUES (?, ?, ?, 0, 0, 0, ?, ?)
                    """,
                    (
                        work_order_id,
                        bom_item["component_item_id"],
                        required_qty,
                        bom_item["unit_id"],
                        bom_item["remark"] or "",
                    ),
                )
            self._log_operation(conn, "erp_work_order", "create", "work_order", work_order_id, payload)
            conn.commit()
        return self.get_work_order(work_order_id)

    def issue_work_order(self, work_order_id: int, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = payload or {}
        work_order = self.get_work_order(work_order_id)
        if work_order["status"] not in {"released", "in_progress"}:
            raise ValueError("当前工单状态不允许领料")

        selected_lines = payload.get("items")
        materials = work_order["materials"]
        issue_lines: List[Dict[str, Any]] = []
        if isinstance(selected_lines, list) and selected_lines:
            selected_map = {
                _normalize_int(item.get("item_id")): _normalize_float(item.get("qty"))
                for item in selected_lines
            }
            for material in materials:
                item_id = material["item_id"]
                qty = selected_map.get(item_id, 0)
                if qty > 0:
                    issue_lines.append(
                        {
                            "item_id": item_id,
                            "qty": qty,
                            "batch_no": (payload.get("batch_no") or "").strip(),
                            "related_bom_id": work_order["bom_id"],
                        }
                    )
        else:
            for material in materials:
                remaining_qty = float(material["required_qty"]) - float(material["issued_qty"])
                if remaining_qty > 0:
                    issue_lines.append(
                        {
                            "item_id": material["item_id"],
                            "qty": remaining_qty,
                            "batch_no": "",
                            "related_bom_id": work_order["bom_id"],
                        }
                    )

        if not issue_lines:
            raise ValueError("没有可领用的物料")

        warehouse_id = _normalize_int(payload.get("source_warehouse_id")) or work_order["warehouse_id"]
        with self._connect() as conn:
            normalized_issue_lines = []
            for line in issue_lines:
                batch_no = (line.get("batch_no") or "").strip()
                if not batch_no:
                    batch_no = self._pick_batch_no(conn, line["item_id"], warehouse_id, line["qty"])
                normalized_issue_lines.append({**line, "batch_no": batch_no})
            issue_lines = normalized_issue_lines
        document = self.create_stock_document(
            {
                "doc_type": "material_issue",
                "biz_date": payload.get("biz_date") or _today_text(),
                "source_warehouse_id": warehouse_id,
                "related_work_order_id": work_order_id,
                "remark": payload.get("remark") or f"工单 {work_order['work_order_no']} 领料",
                "items": issue_lines,
            }
        )
        submitted = self.submit_document(document["id"])

        with self._lock, self._connect() as conn:
            for line in issue_lines:
                conn.execute(
                    """
                    UPDATE work_order_materials
                    SET issued_qty = issued_qty + ?, consumed_qty = consumed_qty + ?
                    WHERE work_order_id = ? AND item_id = ?
                    """,
                    (line["qty"], line["qty"], work_order_id, line["item_id"]),
                )
            conn.execute(
                """
                UPDATE work_orders
                SET status = 'in_progress',
                    actual_start_date = CASE WHEN actual_start_date = '' THEN ? ELSE actual_start_date END,
                    updated_at = ?, updated_by = ?
                WHERE id = ?
                """,
                (_today_text(), _now_text(), "system", work_order_id),
            )
            self._log_operation(conn, "erp_work_order", "issue", "work_order", work_order_id, {"document_id": submitted["id"]})
            conn.commit()
        return self.get_work_order(work_order_id)

    def return_work_order(self, work_order_id: int, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = payload or {}
        work_order = self.get_work_order(work_order_id)
        if work_order["status"] not in {"in_progress", "released"}:
            raise ValueError("当前工单状态不允许退料")

        selected_lines = payload.get("items")
        materials = work_order["materials"]
        return_lines: List[Dict[str, Any]] = []
        if isinstance(selected_lines, list) and selected_lines:
            selected_map = {
                _normalize_int(item.get("item_id")): _normalize_float(item.get("qty"))
                for item in selected_lines
            }
            for material in materials:
                item_id = material["item_id"]
                qty = selected_map.get(item_id, 0)
                available_return = float(material["issued_qty"]) - float(material["returned_qty"])
                if qty > 0:
                    if qty > available_return + 1e-9:
                        raise ValueError("退料数量不能大于可退数量")
                    return_lines.append(
                        {
                            "item_id": item_id,
                            "qty": qty,
                            "batch_no": (payload.get("batch_no") or "").strip(),
                            "related_bom_id": work_order["bom_id"],
                        }
                    )
        else:
            for material in materials:
                available_return = float(material["issued_qty"]) - float(material["returned_qty"])
                if available_return > 0:
                    return_lines.append(
                        {
                            "item_id": material["item_id"],
                            "qty": available_return,
                            "batch_no": "",
                            "related_bom_id": work_order["bom_id"],
                        }
                    )

        if not return_lines:
            raise ValueError("没有可退回的物料")

        warehouse_id = _normalize_int(payload.get("target_warehouse_id")) or work_order["warehouse_id"]
        with self._connect() as conn:
            normalized_return_lines = []
            for line in return_lines:
                batch_no = (line.get("batch_no") or "").strip()
                if not batch_no:
                    batch_no = self._pick_return_batch_no(conn, work_order_id, line["item_id"])
                normalized_return_lines.append({**line, "batch_no": batch_no})
            return_lines = normalized_return_lines

        document = self.create_stock_document(
            {
                "doc_type": "material_return",
                "biz_date": payload.get("biz_date") or _today_text(),
                "target_warehouse_id": warehouse_id,
                "related_work_order_id": work_order_id,
                "remark": payload.get("remark") or f"工单 {work_order['work_order_no']} 退料",
                "items": return_lines,
            }
        )
        submitted = self.submit_document(document["id"])

        with self._lock, self._connect() as conn:
            for line in return_lines:
                conn.execute(
                    """
                    UPDATE work_order_materials
                    SET returned_qty = returned_qty + ?, consumed_qty = CASE
                        WHEN consumed_qty - ? < 0 THEN 0
                        ELSE consumed_qty - ?
                    END
                    WHERE work_order_id = ? AND item_id = ?
                    """,
                    (line["qty"], line["qty"], line["qty"], work_order_id, line["item_id"]),
                )
            self._log_operation(conn, "erp_work_order", "return", "work_order", work_order_id, {"document_id": submitted["id"]})
            conn.commit()
        return self.get_work_order(work_order_id)

    def complete_work_order(self, work_order_id: int, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = payload or {}
        work_order = self.get_work_order(work_order_id)
        if work_order["status"] not in {"released", "in_progress"}:
            raise ValueError("当前工单状态不允许完工")

        complete_qty = _normalize_float(payload.get("qty"), 0)
        if complete_qty <= 0:
            remaining = float(work_order["plan_qty"]) - float(work_order["finished_qty"])
            complete_qty = remaining
        if complete_qty <= 0:
            raise ValueError("没有可完工数量")

        warehouse_id = _normalize_int(payload.get("target_warehouse_id")) or work_order["warehouse_id"]
        batch_no = (payload.get("batch_no") or f"WO-{work_order['work_order_no']}").strip()
        document = self.create_stock_document(
            {
                "doc_type": "production_in",
                "biz_date": payload.get("biz_date") or _today_text(),
                "target_warehouse_id": warehouse_id,
                "related_work_order_id": work_order_id,
                "remark": payload.get("remark") or f"工单 {work_order['work_order_no']} 完工入库",
                "items": [
                    {
                        "item_id": work_order["parent_item_id"],
                        "qty": complete_qty,
                        "batch_no": batch_no,
                    }
                ],
            }
        )
        submitted = self.submit_document(document["id"])

        with self._lock, self._connect() as conn:
            conn.execute(
                """
                UPDATE work_orders
                SET finished_qty = finished_qty + ?,
                    status = CASE WHEN finished_qty + ? >= plan_qty THEN 'completed' ELSE 'in_progress' END,
                    actual_end_date = CASE WHEN finished_qty + ? >= plan_qty THEN ? ELSE actual_end_date END,
                    updated_at = ?, updated_by = ?
                WHERE id = ?
                """,
                (complete_qty, complete_qty, complete_qty, _today_text(), _now_text(), "system", work_order_id),
            )
            self._log_operation(conn, "erp_work_order", "complete", "work_order", work_order_id, {"document_id": submitted["id"], "qty": complete_qty})
            conn.commit()
        return self.get_work_order(work_order_id)

    def list_documents(self, limit: int = 50) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    d.id,
                    d.doc_type,
                    d.doc_no,
                    d.status,
                    d.biz_date,
                    d.remark,
                    sw.warehouse_name AS source_warehouse_name,
                    tw.warehouse_name AS target_warehouse_name,
                    COUNT(di.id) AS line_count
                FROM stock_documents d
                LEFT JOIN warehouses sw ON sw.id = d.source_warehouse_id
                LEFT JOIN warehouses tw ON tw.id = d.target_warehouse_id
                LEFT JOIN stock_document_items di ON di.document_id = d.id
                GROUP BY d.id
                ORDER BY d.id DESC
                LIMIT ?
                """,
                (_normalize_int(limit, 50),),
            ).fetchall()
        return [dict(row) for row in rows]

    def get_document(self, doc_id: int) -> Dict[str, Any]:
        with self._connect() as conn:
            header = conn.execute(
                """
                SELECT *
                FROM stock_documents
                WHERE id = ?
                """,
                (doc_id,),
            ).fetchone()
            if header is None:
                raise ValueError("单据不存在")
            items = conn.execute(
                """
                SELECT
                    di.*,
                    i.item_code,
                    i.item_name,
                    w.warehouse_name
                FROM stock_document_items di
                INNER JOIN items i ON i.id = di.item_id
                LEFT JOIN warehouses w ON w.id = di.warehouse_id
                WHERE di.document_id = ?
                ORDER BY di.line_no
                """,
                (doc_id,),
            ).fetchall()
        return {**dict(header), "items": [dict(row) for row in items]}

    def create_stock_document(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        doc_type = (payload.get("doc_type") or "").strip()
        if doc_type not in DOC_PREFIXES:
            raise ValueError("不支持的单据类型")

        lines = payload.get("items") or []
        if not isinstance(lines, list) or not lines:
            raise ValueError("单据明细不能为空")

        with self._lock, self._connect() as conn:
            now = _now_text()
            doc_no = self._generate_doc_no(conn, doc_type)
            source_warehouse_id = _normalize_int(payload.get("source_warehouse_id")) or None
            target_warehouse_id = _normalize_int(payload.get("target_warehouse_id")) or None
            if doc_type in INBOUND_DOC_TYPES and not target_warehouse_id:
                target_warehouse_id = self._default_warehouse_id(conn)
            if doc_type in OUTBOUND_DOC_TYPES and not source_warehouse_id:
                source_warehouse_id = self._default_warehouse_id(conn)

            cursor = conn.execute(
                """
                INSERT INTO stock_documents(
                    doc_type, doc_no, status, biz_date, source_warehouse_id, target_warehouse_id,
                    related_party_type, related_party_id, related_order_id, related_work_order_id,
                    operator_id, remark, created_at, updated_at, created_by, updated_by
                ) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    doc_type,
                    doc_no,
                    payload.get("biz_date") or _today_text(),
                    source_warehouse_id,
                    target_warehouse_id,
                    (payload.get("related_party_type") or "").strip(),
                    _normalize_int(payload.get("related_party_id")) or None,
                    _normalize_int(payload.get("related_order_id")) or None,
                    _normalize_int(payload.get("related_work_order_id")) or None,
                    _normalize_int(payload.get("operator_id")) or None,
                    (payload.get("remark") or "").strip(),
                    now,
                    now,
                    "system",
                    "system",
                ),
            )
            document_id = cursor.lastrowid
            for index, line in enumerate(lines, start=1):
                item_id = _normalize_int(line.get("item_id"))
                qty = _normalize_float(line.get("qty"))
                if item_id <= 0 or qty <= 0:
                    raise ValueError("单据明细的物料和数量必须有效")
                line_warehouse_id = _normalize_int(line.get("warehouse_id")) or None
                if doc_type in INBOUND_DOC_TYPES and not line_warehouse_id:
                    line_warehouse_id = target_warehouse_id
                if doc_type in OUTBOUND_DOC_TYPES and not line_warehouse_id:
                    line_warehouse_id = source_warehouse_id
                conn.execute(
                    """
                    INSERT INTO stock_document_items(
                        document_id, line_no, item_id, batch_no, qty, unit_id, warehouse_id,
                        location_code, source_trace_key, related_bom_id, remark
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        document_id,
                        index,
                        item_id,
                        (line.get("batch_no") or "").strip(),
                        qty,
                        _normalize_int(line.get("unit_id")) or self._default_unit_id(conn),
                        line_warehouse_id,
                        (line.get("location_code") or "").strip(),
                        (line.get("source_trace_key") or "").strip(),
                        _normalize_int(line.get("related_bom_id")) or None,
                        (line.get("remark") or "").strip(),
                    ),
                )
            self._log_operation(conn, "erp_inventory", "create_document", "stock_document", document_id, payload)
            conn.commit()
        return self.get_document(document_id)

    def submit_document(self, doc_id: int) -> Dict[str, Any]:
        with self._lock, self._connect() as conn:
            header = conn.execute("SELECT * FROM stock_documents WHERE id = ?", (doc_id,)).fetchone()
            if header is None:
                raise ValueError("单据不存在")
            if header["status"] != "draft":
                raise ValueError("只有草稿单据可以提交")

            lines = conn.execute(
                "SELECT * FROM stock_document_items WHERE document_id = ? ORDER BY line_no",
                (doc_id,),
            ).fetchall()
            if not lines:
                raise ValueError("单据没有明细")

            for line in lines:
                self._apply_document_line(conn, dict(header), dict(line))

            now = _now_text()
            conn.execute(
                "UPDATE stock_documents SET status = 'submitted', updated_at = ?, updated_by = ? WHERE id = ?",
                (now, "system", doc_id),
            )
            self._log_operation(conn, "erp_inventory", "submit_document", "stock_document", doc_id, {"doc_type": header["doc_type"]})
            conn.commit()
        return self.get_document(doc_id)

    def cancel_document(self, doc_id: int, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        payload = payload or {}
        with self._lock, self._connect() as conn:
            header = conn.execute("SELECT * FROM stock_documents WHERE id = ?", (doc_id,)).fetchone()
            if header is None:
                raise ValueError("单据不存在")
            header_dict = dict(header)
            if header_dict["status"] == "cancelled":
                raise ValueError("单据已取消，无需重复操作")

            lines = conn.execute(
                "SELECT * FROM stock_document_items WHERE document_id = ? ORDER BY line_no",
                (doc_id,),
            ).fetchall()
            if not lines:
                raise ValueError("单据没有明细")

            if header_dict["status"] == "submitted":
                for line in lines:
                    self._reverse_document_line(conn, header_dict, dict(line))
                self._rollback_document_business_effects(conn, header_dict, [dict(line) for line in lines])

            now = _now_text()
            cancel_remark = (payload.get("remark") or "").strip()
            next_remark = header_dict.get("remark") or ""
            if cancel_remark:
                next_remark = f"{next_remark}；取消原因：{cancel_remark}" if next_remark else f"取消原因：{cancel_remark}"
            conn.execute(
                "UPDATE stock_documents SET status = 'cancelled', remark = ?, updated_at = ?, updated_by = ? WHERE id = ?",
                (next_remark, now, "system", doc_id),
            )
            self._log_operation(
                conn,
                "erp_inventory",
                "cancel_document",
                "stock_document",
                doc_id,
                {"doc_type": header_dict["doc_type"], "remark": cancel_remark},
            )
            conn.commit()
        return self.get_document(doc_id)

    def _apply_document_line(self, conn: sqlite3.Connection, header: Dict[str, Any], line: Dict[str, Any]) -> None:
        doc_type = header["doc_type"]
        if doc_type in INBOUND_DOC_TYPES:
            warehouse_id = line["warehouse_id"] or header["target_warehouse_id"]
            self._write_inventory_entry(conn, header, line, warehouse_id, "in")
        elif doc_type in OUTBOUND_DOC_TYPES:
            warehouse_id = line["warehouse_id"] or header["source_warehouse_id"]
            self._write_inventory_entry(conn, header, line, warehouse_id, "out")
        elif doc_type == "transfer":
            source_warehouse_id = header["source_warehouse_id"]
            target_warehouse_id = header["target_warehouse_id"]
            if not source_warehouse_id or not target_warehouse_id:
                raise ValueError("调拨单需要源仓库和目标仓库")
            self._write_inventory_entry(conn, header, line, source_warehouse_id, "out")
            self._write_inventory_entry(conn, header, line, target_warehouse_id, "in")
        elif doc_type == "stock_adjust":
            direction = "in" if line["qty"] >= 0 else "out"
            self._write_inventory_entry(conn, header, line, line["warehouse_id"] or header["target_warehouse_id"], direction)
        else:
            raise ValueError(f"暂未实现该单据类型提交流程: {doc_type}")

        if header.get("related_work_order_id"):
            conn.execute(
                """
                INSERT INTO document_relations(from_doc_type, from_doc_id, to_doc_type, to_doc_id, relation_type, remark, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    "work_order",
                    header["related_work_order_id"],
                    header["doc_type"],
                    header["id"],
                    "generated_document",
                    "",
                    _now_text(),
                ),
            )

    def _reverse_document_line(self, conn: sqlite3.Connection, header: Dict[str, Any], line: Dict[str, Any]) -> None:
        doc_type = header["doc_type"]
        reverse_header = {
            **header,
            "remark": f"{header.get('remark') or ''} [冲销]",
        }
        reverse_line = {
            **line,
            "remark": f"{line.get('remark') or ''} [冲销]".strip(),
        }
        if doc_type in INBOUND_DOC_TYPES:
            warehouse_id = line["warehouse_id"] or header["target_warehouse_id"]
            self._write_inventory_entry(conn, reverse_header, reverse_line, warehouse_id, "out")
        elif doc_type in OUTBOUND_DOC_TYPES:
            warehouse_id = line["warehouse_id"] or header["source_warehouse_id"]
            self._write_inventory_entry(conn, reverse_header, reverse_line, warehouse_id, "in")
        elif doc_type == "transfer":
            source_warehouse_id = header["source_warehouse_id"]
            target_warehouse_id = header["target_warehouse_id"]
            if not source_warehouse_id or not target_warehouse_id:
                raise ValueError("调拨单缺少源仓库或目标仓库，无法取消")
            self._write_inventory_entry(conn, reverse_header, reverse_line, target_warehouse_id, "out")
            self._write_inventory_entry(conn, reverse_header, reverse_line, source_warehouse_id, "in")
        elif doc_type == "stock_adjust":
            direction = "out" if float(line["qty"]) >= 0 else "in"
            self._write_inventory_entry(conn, reverse_header, reverse_line, line["warehouse_id"] or header["target_warehouse_id"], direction)
        else:
            raise ValueError(f"暂未实现该单据类型取消流程: {doc_type}")

    def _rollback_document_business_effects(
        self,
        conn: sqlite3.Connection,
        header: Dict[str, Any],
        lines: List[Dict[str, Any]],
    ) -> None:
        related_work_order_id = _normalize_int(header.get("related_work_order_id"))
        if related_work_order_id <= 0:
            return
        doc_type = header["doc_type"]
        if doc_type == "material_issue":
            for line in lines:
                qty = _normalize_float(line.get("qty"))
                conn.execute(
                    """
                    UPDATE work_order_materials
                    SET
                        issued_qty = CASE WHEN issued_qty - ? < 0 THEN 0 ELSE issued_qty - ? END,
                        consumed_qty = CASE WHEN consumed_qty - ? < 0 THEN 0 ELSE consumed_qty - ? END
                    WHERE work_order_id = ? AND item_id = ?
                    """,
                    (qty, qty, qty, qty, related_work_order_id, line["item_id"]),
                )
        elif doc_type == "material_return":
            for line in lines:
                qty = _normalize_float(line.get("qty"))
                conn.execute(
                    """
                    UPDATE work_order_materials
                    SET
                        returned_qty = CASE WHEN returned_qty - ? < 0 THEN 0 ELSE returned_qty - ? END,
                        consumed_qty = consumed_qty + ?
                    WHERE work_order_id = ? AND item_id = ?
                    """,
                    (qty, qty, qty, related_work_order_id, line["item_id"]),
                )
        elif doc_type == "production_in":
            total_qty = sum(_normalize_float(line.get("qty")) for line in lines)
            conn.execute(
                """
                UPDATE work_orders
                SET finished_qty = CASE WHEN finished_qty - ? < 0 THEN 0 ELSE finished_qty - ? END,
                    updated_at = ?, updated_by = ?
                WHERE id = ?
                """,
                (total_qty, total_qty, _now_text(), "system", related_work_order_id),
            )
        self._recalculate_work_order_status(conn, related_work_order_id)

    def _recalculate_work_order_status(self, conn: sqlite3.Connection, work_order_id: int) -> None:
        work_order = conn.execute(
            """
            SELECT id, plan_qty, finished_qty
            FROM work_orders
            WHERE id = ?
            """,
            (work_order_id,),
        ).fetchone()
        if work_order is None:
            return
        material_summary = conn.execute(
            """
            SELECT
                COALESCE(SUM(issued_qty), 0) AS total_issued,
                COALESCE(SUM(consumed_qty), 0) AS total_consumed
            FROM work_order_materials
            WHERE work_order_id = ?
            """,
            (work_order_id,),
        ).fetchone()
        total_issued = float(material_summary["total_issued"] if material_summary else 0)
        finished_qty = float(work_order["finished_qty"] or 0)
        plan_qty = float(work_order["plan_qty"] or 0)

        if finished_qty >= plan_qty and plan_qty > 0:
            status = "completed"
            actual_start_date = _today_text()
            actual_end_date = _today_text()
        elif total_issued > 0 or finished_qty > 0:
            status = "in_progress"
            actual_start_date = _today_text()
            actual_end_date = ""
        else:
            status = "released"
            actual_start_date = ""
            actual_end_date = ""

        conn.execute(
            """
            UPDATE work_orders
            SET status = ?, actual_start_date = ?, actual_end_date = ?, updated_at = ?, updated_by = ?
            WHERE id = ?
            """,
            (status, actual_start_date, actual_end_date, _now_text(), "system", work_order_id),
        )

    def _write_inventory_entry(
        self,
        conn: sqlite3.Connection,
        header: Dict[str, Any],
        line: Dict[str, Any],
        warehouse_id: Optional[int],
        direction: str,
    ) -> None:
        if not warehouse_id:
            raise ValueError("库存变更缺少仓库")

        current_balance = conn.execute(
            """
            SELECT id, qty_on_hand, qty_available
            FROM inventory_balances
            WHERE item_id = ? AND warehouse_id = ? AND batch_no = ?
            """,
            (line["item_id"], warehouse_id, line["batch_no"] or ""),
        ).fetchone()
        delta = float(line["qty"])
        if direction == "out":
            delta = -delta

        next_qty = (current_balance["qty_on_hand"] if current_balance else 0.0) + delta
        if next_qty < -1e-9:
            raise ValueError("库存不足，无法提交单据")

        if current_balance:
            conn.execute(
                """
                UPDATE inventory_balances
                SET qty_on_hand = ?, qty_available = ?, updated_at = ?
                WHERE id = ?
                """,
                (next_qty, next_qty, _now_text(), current_balance["id"]),
            )
        else:
            conn.execute(
                """
                INSERT INTO inventory_balances(item_id, warehouse_id, batch_no, qty_on_hand, qty_available, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (line["item_id"], warehouse_id, line["batch_no"] or "", next_qty, next_qty, _now_text()),
            )

        trace_key = self._build_trace_key(line["item_id"], line["batch_no"], header["doc_type"], header["id"], line["id"])
        source_trace_key = line.get("source_trace_key") or ""
        conn.execute(
            """
            INSERT INTO inventory_ledger(
                biz_date, item_id, warehouse_id, batch_no, doc_type, doc_id, doc_item_id,
                direction, qty, balance_after, trace_key, source_trace_key, remark, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                header["biz_date"],
                line["item_id"],
                warehouse_id,
                line["batch_no"] or "",
                header["doc_type"],
                header["id"],
                line["id"],
                direction,
                abs(float(line["qty"])),
                next_qty,
                trace_key if direction == "in" else "",
                source_trace_key if direction == "in" else (source_trace_key or trace_key),
                line.get("remark") or header.get("remark") or "",
                _now_text(),
            ),
        )

        self._insert_trace_link(conn, header, line, warehouse_id, direction, trace_key, source_trace_key)

    def _insert_trace_link(
        self,
        conn: sqlite3.Connection,
        header: Dict[str, Any],
        line: Dict[str, Any],
        warehouse_id: int,
        direction: str,
        trace_key: str,
        source_trace_key: str,
    ) -> None:
        trace_type = {
            "purchase_in": "purchase_to_stock",
            "material_issue": "stock_to_issue",
            "material_return": "return_to_stock",
            "production_in": "work_order_to_finished_goods",
            "transfer": "transfer_between_warehouses",
            "other_in": "other_to_stock",
            "other_out": "stock_to_other",
        }.get(header["doc_type"], "inventory_flow")
        from_doc_type = "stock" if direction == "out" else header["doc_type"]
        to_doc_type = header["doc_type"] if direction == "out" else "stock"
        from_doc_id = warehouse_id if direction == "out" else header["id"]
        to_doc_id = header["id"] if direction == "out" else warehouse_id
        conn.execute(
            """
            INSERT INTO material_trace_links(
                item_id, batch_no, from_doc_type, from_doc_id, from_doc_item_id,
                to_doc_type, to_doc_id, to_doc_item_id, qty, trace_type, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                line["item_id"],
                line["batch_no"] or "",
                from_doc_type,
                from_doc_id,
                line["id"] if direction == "out" else line["id"],
                to_doc_type,
                to_doc_id,
                line["id"],
                abs(float(line["qty"])),
                trace_type,
                _now_text(),
            ),
        )
        if header["doc_type"] == "material_issue" and header.get("related_work_order_id"):
            conn.execute(
                """
                INSERT INTO material_trace_links(
                    item_id, batch_no, from_doc_type, from_doc_id, from_doc_item_id,
                    to_doc_type, to_doc_id, to_doc_item_id, qty, trace_type, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    line["item_id"],
                    line["batch_no"] or "",
                    "material_issue",
                    header["id"],
                    line["id"],
                    "work_order",
                    header["related_work_order_id"],
                    None,
                    abs(float(line["qty"])),
                    "issue_to_work_order",
                    _now_text(),
                ),
            )
        if header["doc_type"] == "material_return" and header.get("related_work_order_id"):
            conn.execute(
                """
                INSERT INTO material_trace_links(
                    item_id, batch_no, from_doc_type, from_doc_id, from_doc_item_id,
                    to_doc_type, to_doc_id, to_doc_item_id, qty, trace_type, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    line["item_id"],
                    line["batch_no"] or "",
                    "work_order",
                    header["related_work_order_id"],
                    None,
                    "material_return",
                    header["id"],
                    line["id"],
                    abs(float(line["qty"])),
                    "work_order_to_return",
                    _now_text(),
                ),
            )

    def _build_trace_key(
        self,
        item_id: int,
        batch_no: Optional[str],
        doc_type: str,
        doc_id: int,
        doc_item_id: int,
    ) -> str:
        return f"{item_id}:{batch_no or 'NA'}:{doc_type}:{doc_id}:{doc_item_id}"

    def _generate_doc_no(self, conn: sqlite3.Connection, doc_type: str) -> str:
        prefix = DOC_PREFIXES[doc_type]
        date_code = datetime.now().strftime("%Y%m%d")
        like_prefix = f"{prefix}-{date_code}-%"
        row = conn.execute(
            "SELECT COUNT(*) AS count_value FROM stock_documents WHERE doc_no LIKE ?",
            (like_prefix,),
        ).fetchone()
        next_index = (row["count_value"] if row else 0) + 1
        return f"{prefix}-{date_code}-{next_index:04d}"

    def get_dashboard_summary(self) -> Dict[str, Any]:
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT
                    (SELECT COUNT(*) FROM items WHERE is_enabled = 1) AS item_count,
                    (SELECT COUNT(*) FROM warehouses WHERE is_enabled = 1) AS warehouse_count,
                    (SELECT COUNT(*) FROM boms) AS bom_count,
                    (SELECT COUNT(*) FROM work_orders WHERE status IN ('released', 'in_progress')) AS active_work_order_count,
                    (SELECT COUNT(*) FROM stock_documents WHERE biz_date = ? AND status = 'submitted') AS today_document_count,
                    (SELECT COUNT(*) FROM inventory_balances) AS balance_row_count,
                    (
                        SELECT COUNT(*)
                        FROM (
                            SELECT i.id
                            FROM items i
                            LEFT JOIN inventory_balances ib ON ib.item_id = i.id
                            WHERE i.is_enabled = 1
                            GROUP BY i.id
                            HAVING COALESCE(SUM(ib.qty_available), 0) < i.safety_stock
                        )
                    ) AS low_stock_count,
                    (SELECT COALESCE(SUM(qty_on_hand), 0) FROM inventory_balances) AS total_on_hand
                """,
                (_today_text(),),
            ).fetchone()

            warnings = conn.execute(
                """
                SELECT
                    i.item_code,
                    i.item_name,
                    i.safety_stock,
                    COALESCE(SUM(ib.qty_available), 0) AS qty_available
                FROM items i
                LEFT JOIN inventory_balances ib ON ib.item_id = i.id
                WHERE i.is_enabled = 1
                GROUP BY i.id
                HAVING qty_available < i.safety_stock
                ORDER BY (i.safety_stock - qty_available) DESC, i.item_code
                LIMIT 8
                """
            ).fetchall()
            recent_documents = conn.execute(
                """
                SELECT doc_no, doc_type, status, biz_date, remark
                FROM stock_documents
                ORDER BY id DESC
                LIMIT 8
                """
            ).fetchall()
        return {
            **dict(row),
            "warnings": [dict(item) for item in warnings],
            "recent_documents": [dict(item) for item in recent_documents],
        }

    def build_ai_context(
        self,
        query_text: str,
        page_context: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        query_text = (query_text or "").strip()
        page_context = page_context if isinstance(page_context, dict) else {}
        active_page = str(page_context.get("active_page") or "").strip().lower()
        focused_item_id = _normalize_int(page_context.get("focused_item_id"))
        focused_bom_id = _normalize_int(page_context.get("focused_bom_id"))
        focused_work_order_id = _normalize_int(page_context.get("focused_work_order_id"))
        trace_keyword = (page_context.get("trace_keyword") or "").strip()
        trace_batch_no = (page_context.get("trace_batch_no") or "").strip()

        query_lower = query_text.lower()
        summary = self.get_dashboard_summary()
        sections: List[str] = [
            "\n".join(
                [
                    "【ERP 系统概览】",
                    f"- 物料数：{summary['item_count']}",
                    f"- 仓库数：{summary['warehouse_count']}",
                    f"- BOM 数：{summary['bom_count']}",
                    f"- 进行中工单：{summary['active_work_order_count']}",
                    f"- 今日已提交单据：{summary['today_document_count']}",
                    f"- 安全库存预警：{summary['low_stock_count']}",
                    f"- 当前总库存量：{float(summary['total_on_hand'] or 0):.2f}",
                ]
            )
        ]
        structured_data: Dict[str, Any] = {
            "summary": {
                "item_count": summary["item_count"],
                "warehouse_count": summary["warehouse_count"],
                "bom_count": summary["bom_count"],
                "active_work_order_count": summary["active_work_order_count"],
                "today_document_count": summary["today_document_count"],
                "low_stock_count": summary["low_stock_count"],
                "total_on_hand": float(summary["total_on_hand"] or 0),
            }
        }
        suggestions: List[str] = []

        matched_item: Optional[Dict[str, Any]] = None
        if focused_item_id > 0:
            try:
                matched_item = self.get_item(focused_item_id)
            except ValueError:
                matched_item = None
        if matched_item is None and query_text:
            matched_item = self._find_item_from_query(query_text)

        if (
            matched_item is not None
            or active_page in {"items", "inventory", "documents", "trace"}
            or any(keyword in query_text for keyword in ("库存", "物料", "仓库", "安全库存", "预警"))
        ):
            if matched_item is not None:
                balances = self.list_inventory_balances(keyword=matched_item["item_code"])
                total_qty = sum(float(item["qty_on_hand"] or 0) for item in balances)
                structured_data["item"] = matched_item
                structured_data["balances"] = balances[:12]
                sections.append(
                    "\n".join(
                        [
                            f"【当前聚焦物料】{matched_item['item_code']} / {matched_item['item_name']}",
                            f"- 类型：{matched_item['item_type']}",
                            f"- 当前总库存：{total_qty:.2f}",
                            f"- 安全库存：{float(matched_item.get('safety_stock') or 0):.2f}",
                            "- 分仓库存：",
                        ]
                        + [
                            f"  - {item['warehouse_code']} / {item['warehouse_name']}：{float(item['qty_on_hand'] or 0):.2f}（批次 {item['batch_no'] or '-'}）"
                            for item in balances[:8]
                        ]
                    )
                )
                suggestions.extend(["可继续追问该物料最近流向", "可继续追问是否低于安全库存"])
            elif summary["warnings"]:
                warning_lines = [
                    f"  - {item['item_code']} / {item['item_name']}：库存 {float(item['qty_available'] or 0):.2f}，安全库存 {float(item['safety_stock'] or 0):.2f}"
                    for item in summary["warnings"][:8]
                ]
                structured_data["warnings"] = summary["warnings"][:8]
                sections.append("\n".join(["【安全库存预警】", *warning_lines]))
                suggestions.append("可继续问：哪些预警物料最紧急")

        if active_page in {"items", "inventory", "documents"} or "仓库" in query_text:
            warehouses = self.list_warehouses()
            warehouse_balances = self.list_inventory_balances()[:200]
            warehouse_stats: List[Dict[str, Any]] = []
            for warehouse in warehouses:
                related_balances = [
                    item for item in warehouse_balances if item["warehouse_code"] == warehouse["warehouse_code"]
                ]
                warehouse_stats.append(
                    {
                        **warehouse,
                        "item_count": len({item["item_code"] for item in related_balances}),
                        "total_qty_on_hand": round(sum(float(item["qty_on_hand"] or 0) for item in related_balances), 2),
                    }
                )
            structured_data["warehouses"] = warehouse_stats[:12]
            sections.append(
                "\n".join(
                    ["【仓库清单】"]
                    + [
                        f"- {item['warehouse_code']} / {item['warehouse_name']}：类型 {item['warehouse_type']}，"
                        f"{'启用' if item['is_enabled'] else '停用'}，物料数 {item['item_count']}，库存量 {float(item['total_qty_on_hand'] or 0):.2f}"
                        for item in warehouse_stats[:10]
                    ]
                )
            )
            suggestions.append("可继续问：每个仓库分别放了哪些物料")

        focus_bom: Optional[Dict[str, Any]] = None
        if focused_bom_id > 0:
            try:
                focus_bom = self.get_bom(focused_bom_id)
            except ValueError:
                focus_bom = None
        if (
            focus_bom is not None
            or active_page == "bom"
            or "bom" in query_lower
            or "配方" in query_text
        ):
            bom_items: List[Dict[str, Any]] = []
            if focus_bom is not None:
                bom_items = focus_bom.get("items") or []
                structured_data["bom"] = {
                    "id": focus_bom["id"],
                    "bom_code": focus_bom["bom_code"],
                    "version_no": focus_bom["version_no"],
                    "status": focus_bom["status"],
                    "parent_item_code": focus_bom["parent_item_code"],
                    "parent_item_name": focus_bom["parent_item_name"],
                    "items": bom_items[:10],
                }
                sections.append(
                    "\n".join(
                        [
                            f"【当前聚焦 BOM】{focus_bom['bom_code']} / {focus_bom['version_no']}",
                            f"- 父项：{focus_bom['parent_item_code']} / {focus_bom['parent_item_name']}",
                            f"- 状态：{focus_bom['status']}",
                            f"- 子件数：{len(bom_items)}",
                            "- 子件明细：",
                        ]
                        + [
                            f"  - {item['component_item_code']} / {item['component_item_name']}：数量 {float(item['qty'] or 0):.2f}，损耗率 {float(item['loss_rate'] or 0):.2f}%"
                            for item in bom_items[:8]
                        ]
                    )
                )
            else:
                recent_boms = self.list_boms()[:8]
                structured_data["recent_boms"] = recent_boms
                sections.append(
                    "\n".join(
                        ["【最近 BOM】"]
                        + [
                            f"- {item['bom_code']} / {item['version_no']}：父项 {item['parent_item_code']}，状态 {item['status']}，子件数 {item['component_count']}"
                            for item in recent_boms
                        ]
                    )
                )
            suggestions.append("可继续问：这个 BOM 的关键子件和版本变化")

        focus_work_order: Optional[Dict[str, Any]] = None
        if focused_work_order_id > 0:
            try:
                focus_work_order = self.get_work_order(focused_work_order_id)
            except ValueError:
                focus_work_order = None
        if (
            focus_work_order is not None
            or active_page == "work_orders"
            or "工单" in query_text
            or "领料" in query_text
            or "退料" in query_text
            or "完工" in query_text
        ):
            if focus_work_order is not None:
                materials = focus_work_order.get("materials") or []
                structured_data["work_order"] = {
                    "id": focus_work_order["id"],
                    "work_order_no": focus_work_order["work_order_no"],
                    "status": focus_work_order["status"],
                    "plan_qty": focus_work_order["plan_qty"],
                    "finished_qty": focus_work_order["finished_qty"],
                    "parent_item_code": focus_work_order["parent_item_code"],
                    "parent_item_name": focus_work_order["parent_item_name"],
                    "bom_code": focus_work_order["bom_code"],
                    "materials": materials[:10],
                    "relations": (focus_work_order.get("relations") or [])[:10],
                }
                sections.append(
                    "\n".join(
                        [
                            f"【当前聚焦工单】{focus_work_order['work_order_no']}",
                            f"- 状态：{focus_work_order['status']}",
                            f"- 成品：{focus_work_order['parent_item_code']} / {focus_work_order['parent_item_name']}",
                            f"- BOM：{focus_work_order['bom_code'] or '-'}",
                            f"- 计划 / 已完工：{float(focus_work_order['plan_qty'] or 0):.2f} / {float(focus_work_order['finished_qty'] or 0):.2f}",
                            "- 物料执行：",
                        ]
                        + [
                            f"  - {item['item_code']} / {item['item_name']}：应领 {float(item['required_qty'] or 0):.2f}，已领 {float(item['issued_qty'] or 0):.2f}，已退 {float(item['returned_qty'] or 0):.2f}，消耗 {float(item['consumed_qty'] or 0):.2f}"
                            for item in materials[:8]
                        ]
                    )
                )
            else:
                work_orders = self.list_work_orders()[:8]
                structured_data["recent_work_orders"] = work_orders
                sections.append(
                    "\n".join(
                        ["【最近工单】"]
                        + [
                            f"- {item['work_order_no']}：{item['parent_item_code']}，状态 {item['status']}，计划 {float(item['plan_qty'] or 0):.2f}，已完工 {float(item['finished_qty'] or 0):.2f}"
                            for item in work_orders
                        ]
                    )
                )
            suggestions.append("可继续问：工单当前卡在哪一步")

        should_include_trace = (
            active_page == "trace"
            or bool(trace_keyword)
            or bool(trace_batch_no)
            or "追踪" in query_text
            or "流向" in query_text
            or "批次" in query_text
        )
        if should_include_trace:
            effective_trace_keyword = trace_keyword or (matched_item["item_code"] if matched_item else "")
            trace_links = self.list_trace_links(
                item_keyword=effective_trace_keyword,
                batch_no=trace_batch_no,
                limit=12,
            )
            structured_data["trace_links"] = trace_links
            sections.append(
                "\n".join(
                    ["【追踪链路】"]
                    + [
                        f"- {item['item_code']} / 批次 {item['batch_no'] or '-'}：{item['from_doc_type']} #{item['from_doc_id']} -> {item['to_doc_type']} #{item['to_doc_id']}，数量 {float(item['qty'] or 0):.2f}，类型 {item['trace_type']}"
                        for item in trace_links[:10]
                    ]
                )
            )
            suggestions.append("可继续问：这条批次最终去了哪里")

        if active_page in {"documents", "inventory"} or "单据" in query_text or "流水" in query_text:
            documents = self.list_documents(limit=8)
            structured_data["recent_documents"] = documents
            sections.append(
                "\n".join(
                    ["【最近库存单据】"]
                    + [
                        f"- {item['doc_no']}：类型 {item['doc_type']}，状态 {item['status']}，日期 {item['biz_date']}，行数 {item['line_count']}"
                        for item in documents
                    ]
                )
            )
            suggestions.append("可继续问：哪张单据影响了当前库存")

        context_text = (
            "以下是 Yobboy Tiny ERP 的本地离线数据快照，请仅基于这些内容回答；若信息不足请明确说明。\n\n"
            + "\n\n".join(section for section in sections if section.strip())
        )
        return {
            "text": context_text,
            "structured_data": structured_data,
            "suggestions": suggestions[:6],
        }

    def ai_query(self, query_text: str) -> Dict[str, Any]:
        query_text = (query_text or "").strip()
        if not query_text:
            raise ValueError("请输入要查询的问题")

        result: Dict[str, Any]
        if "安全库存" in query_text or "预警" in query_text:
            summary = self.get_dashboard_summary()
            result = {
                "answer_text": f"当前共有 {summary['low_stock_count']} 个物料低于安全库存。",
                "structured_data": {"warnings": summary["warnings"]},
                "references": summary["warnings"],
                "suggestions": [
                    "打开库存页查看具体仓库余额",
                    "优先补充缺口最大的原料",
                ],
            }
        elif "追踪" in query_text or "流向" in query_text:
            matched_item = self._find_item_from_query(query_text)
            keyword = matched_item["item_code"] if matched_item else ""
            links = self.list_trace_links(item_keyword=keyword, limit=12)
            result = {
                "answer_text": f"当前找到 {len(links)} 条与追踪相关的链路记录。",
                "structured_data": {"links": links},
                "references": links,
                "suggestions": [
                    "打开追踪页继续按批次过滤",
                    "结合工单和单据一起查看来源与去向",
                ],
            }
        elif "工单" in query_text:
            work_orders = self.list_work_orders()[:8]
            result = {
                "answer_text": f"当前共有 {len(work_orders)} 条最近工单记录可供查看。",
                "structured_data": {"work_orders": work_orders},
                "references": work_orders,
                "suggestions": [
                    "可继续查看工单详情页中的理论用料",
                    "也可以问库存或追踪相关问题",
                ],
            }
        elif "仓库" in query_text:
            warehouses = self.list_warehouses()
            balances = self.list_inventory_balances()[:200]
            warehouse_rows = []
            for warehouse in warehouses:
                related_balances = [
                    item for item in balances if item["warehouse_code"] == warehouse["warehouse_code"]
                ]
                warehouse_rows.append(
                    {
                        **warehouse,
                        "item_count": len({item["item_code"] for item in related_balances}),
                        "total_qty_on_hand": round(sum(float(item["qty_on_hand"] or 0) for item in related_balances), 2),
                    }
                )
            warehouse_names = "、".join(
                f"{item['warehouse_code']} / {item['warehouse_name']}" for item in warehouse_rows[:10]
            ) or "暂无仓库"
            result = {
                "answer_text": f"当前共有 {len(warehouse_rows)} 个仓库：{warehouse_names}。",
                "structured_data": {"warehouses": warehouse_rows},
                "references": warehouse_rows,
                "suggestions": [
                    "可以继续问：各仓库当前库存量分别是多少",
                    "也可以继续问：某个仓库里有哪些物料",
                ],
            }
        elif "单据" in query_text or "流水" in query_text:
            documents = self.list_documents(limit=8)
            result = {
                "answer_text": f"最近共找到 {len(documents)} 张库存相关单据。",
                "structured_data": {"documents": documents},
                "references": documents,
                "suggestions": [
                    "继续查看库存余额变化",
                    "按单号进入单据详情页",
                ],
            }
        elif "库存" in query_text:
            matched_item = self._find_item_from_query(query_text)
            if matched_item is None:
                summary = self.get_dashboard_summary()
                result = {
                    "answer_text": (
                        f"我暂时没识别到具体物料。当前系统共有 {summary['item_count']} 个物料，"
                        f"{summary['low_stock_count']} 个处于预警状态。"
                    ),
                    "structured_data": {"summary": summary},
                    "references": [],
                    "suggestions": [
                        "可以直接问：查询物料 ITEM001 当前库存",
                        "也可以问：哪些物料低于安全库存",
                    ],
                }
            else:
                balances = self.list_inventory_balances(keyword=matched_item["item_code"])
                total_qty = sum(item["qty_on_hand"] for item in balances)
                result = {
                    "answer_text": f"物料 {matched_item['item_code']} / {matched_item['item_name']} 当前库存为 {total_qty:.2f}。",
                    "structured_data": {"item": matched_item, "balances": balances, "total_qty": total_qty},
                    "references": balances,
                    "suggestions": [
                        "查看最近库存流水",
                        "检查是否低于安全库存",
                    ],
                }
        else:
            result = {
                "answer_text": "当前 AI 已支持库存问答、预警说明和基础库存解释。",
                "structured_data": {
                    "examples": [
                        "查询物料 ITEM001 当前库存",
                        "哪些物料低于安全库存",
                        "最近有哪些单据影响了库存",
                    ]
                },
                "references": [],
                "suggestions": [
                    "先从库存和预警问题开始",
                    "下一阶段会接入 BOM 与工单解释",
                ],
            }

        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO ai_query_logs(query_text, query_type, result_summary, referenced_entity, referenced_record_id, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    query_text,
                    "local_rule_query",
                    result["answer_text"],
                    "erp",
                    None,
                    _now_text(),
                    "system",
                ),
            )
            conn.commit()
        return result

    def _find_item_from_query(self, query_text: str) -> Optional[Dict[str, Any]]:
        code_match = re.search(r"([A-Za-z][A-Za-z0-9_-]{1,})", query_text)
        keyword = code_match.group(1).upper() if code_match else ""
        items = self.list_items(keyword=keyword or query_text)
        for item in items:
            if item["item_code"] in query_text.upper() or item["item_name"] in query_text:
                return item
        return items[0] if code_match and items else None

    def _log_operation(
        self,
        conn: sqlite3.Connection,
        module_name: str,
        operation_type: str,
        target_type: str,
        target_id: Optional[int],
        detail: Dict[str, Any],
    ) -> None:
        conn.execute(
            """
            INSERT INTO operation_logs(module_name, operation_type, target_type, target_id, detail_json, created_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                module_name,
                operation_type,
                target_type,
                target_id,
                json.dumps(detail, ensure_ascii=False),
                _now_text(),
                "system",
            ),
        )

    def _generate_work_order_no(self, conn: sqlite3.Connection) -> str:
        date_code = datetime.now().strftime("%Y%m%d")
        like_prefix = f"WO-{date_code}-%"
        row = conn.execute(
            "SELECT COUNT(*) AS count_value FROM work_orders WHERE work_order_no LIKE ?",
            (like_prefix,),
        ).fetchone()
        next_index = (row["count_value"] if row else 0) + 1
        return f"WO-{date_code}-{next_index:04d}"

    def _pick_batch_no(
        self,
        conn: sqlite3.Connection,
        item_id: int,
        warehouse_id: Optional[int],
        required_qty: float,
    ) -> str:
        if not warehouse_id:
            return ""
        rows = conn.execute(
            """
            SELECT batch_no, qty_available
            FROM inventory_balances
            WHERE item_id = ? AND warehouse_id = ? AND qty_available > 0
            ORDER BY CASE WHEN batch_no = '' THEN 1 ELSE 0 END, id
            """,
            (item_id, warehouse_id),
        ).fetchall()
        if not rows:
            return ""
        for row in rows:
            if float(row["qty_available"]) >= float(required_qty):
                return row["batch_no"] or ""
        return rows[0]["batch_no"] or ""

    def _pick_return_batch_no(self, conn: sqlite3.Connection, work_order_id: int, item_id: int) -> str:
        row = conn.execute(
            """
            SELECT di.batch_no
            FROM stock_documents d
            INNER JOIN stock_document_items di ON di.document_id = d.id
            WHERE d.related_work_order_id = ?
              AND d.doc_type = 'material_issue'
              AND di.item_id = ?
            ORDER BY di.id DESC
            LIMIT 1
            """,
            (work_order_id, item_id),
        ).fetchone()
        return (row["batch_no"] if row else "") or ""
