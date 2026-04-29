CREATE TABLE IF NOT EXISTS units (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    unit_code TEXT NOT NULL UNIQUE,
    unit_name TEXT NOT NULL,
    precision_digits INTEGER NOT NULL DEFAULT 2,
    remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS item_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_code TEXT UNIQUE,
    category_name TEXT NOT NULL,
    parent_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    warehouse_code TEXT NOT NULL UNIQUE,
    warehouse_name TEXT NOT NULL,
    warehouse_type TEXT NOT NULL DEFAULT 'normal',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    remark TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    supplier_code TEXT UNIQUE,
    supplier_name TEXT NOT NULL,
    contact_person TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    employee_code TEXT UNIQUE,
    employee_name TEXT NOT NULL,
    role_name TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_code TEXT NOT NULL UNIQUE,
    item_name TEXT NOT NULL,
    spec TEXT NOT NULL DEFAULT '',
    category_id INTEGER,
    unit_id INTEGER,
    item_type TEXT NOT NULL DEFAULT 'raw_material',
    default_warehouse_id INTEGER,
    safety_stock REAL NOT NULL DEFAULT 0,
    min_stock REAL NOT NULL DEFAULT 0,
    track_individuals INTEGER NOT NULL DEFAULT 0,
    individual_code_prefix TEXT NOT NULL DEFAULT '',
    is_enabled INTEGER NOT NULL DEFAULT 1,
    remark TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS custom_fields (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_name TEXT NOT NULL,
    field_name TEXT NOT NULL,
    field_label TEXT NOT NULL,
    field_type TEXT NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 0,
    is_enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    options_json TEXT NOT NULL DEFAULT '',
    default_value TEXT NOT NULL DEFAULT '',
    UNIQUE(entity_name, field_name)
);

CREATE TABLE IF NOT EXISTS custom_field_values (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_name TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    field_name TEXT NOT NULL,
    field_value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS item_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    instance_code TEXT NOT NULL UNIQUE,
    serial_no TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'in_stock',
    warehouse_id INTEGER,
    location_code TEXT NOT NULL DEFAULT '',
    owner_name TEXT NOT NULL DEFAULT '',
    attributes_json TEXT NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '',
    source_doc_type TEXT NOT NULL DEFAULT '',
    source_doc_id INTEGER,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS item_instance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    from_status TEXT NOT NULL DEFAULT '',
    to_status TEXT NOT NULL DEFAULT '',
    from_warehouse_id INTEGER,
    to_warehouse_id INTEGER,
    from_location_code TEXT NOT NULL DEFAULT '',
    to_location_code TEXT NOT NULL DEFAULT '',
    reference_doc_type TEXT NOT NULL DEFAULT '',
    reference_doc_id INTEGER,
    owner_name TEXT NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS boms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bom_code TEXT NOT NULL UNIQUE,
    parent_item_id INTEGER NOT NULL,
    version_no TEXT NOT NULL DEFAULT 'V1',
    status TEXT NOT NULL DEFAULT 'draft',
    is_default_version INTEGER NOT NULL DEFAULT 0,
    effective_date TEXT NOT NULL DEFAULT '',
    expired_date TEXT NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT '',
    UNIQUE(parent_item_id, version_no)
);

CREATE TABLE IF NOT EXISTS bom_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bom_id INTEGER NOT NULL,
    line_no INTEGER NOT NULL DEFAULT 0,
    component_item_id INTEGER NOT NULL,
    qty REAL NOT NULL,
    unit_id INTEGER,
    loss_rate REAL NOT NULL DEFAULT 0,
    is_optional INTEGER NOT NULL DEFAULT 0,
    substitute_group TEXT NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS work_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_no TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft',
    parent_item_id INTEGER NOT NULL,
    bom_id INTEGER,
    plan_qty REAL NOT NULL DEFAULT 0,
    finished_qty REAL NOT NULL DEFAULT 0,
    warehouse_id INTEGER,
    planned_start_date TEXT NOT NULL DEFAULT '',
    planned_end_date TEXT NOT NULL DEFAULT '',
    actual_start_date TEXT NOT NULL DEFAULT '',
    actual_end_date TEXT NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS work_order_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    required_qty REAL NOT NULL DEFAULT 0,
    issued_qty REAL NOT NULL DEFAULT 0,
    returned_qty REAL NOT NULL DEFAULT 0,
    consumed_qty REAL NOT NULL DEFAULT 0,
    unit_id INTEGER,
    remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS stock_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_type TEXT NOT NULL,
    doc_no TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'draft',
    biz_date TEXT NOT NULL,
    source_warehouse_id INTEGER,
    target_warehouse_id INTEGER,
    related_party_type TEXT NOT NULL DEFAULT '',
    related_party_id INTEGER,
    related_order_id INTEGER,
    related_work_order_id INTEGER,
    operator_id INTEGER,
    remark TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    updated_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS stock_document_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    line_no INTEGER NOT NULL DEFAULT 0,
    item_id INTEGER NOT NULL,
    batch_no TEXT NOT NULL DEFAULT '',
    qty REAL NOT NULL,
    unit_id INTEGER,
    warehouse_id INTEGER,
    location_code TEXT NOT NULL DEFAULT '',
    source_trace_key TEXT NOT NULL DEFAULT '',
    related_bom_id INTEGER,
    remark TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS inventory_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    biz_date TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    warehouse_id INTEGER NOT NULL,
    batch_no TEXT NOT NULL DEFAULT '',
    doc_type TEXT NOT NULL,
    doc_id INTEGER NOT NULL,
    doc_item_id INTEGER,
    direction TEXT NOT NULL,
    qty REAL NOT NULL,
    balance_after REAL NOT NULL DEFAULT 0,
    trace_key TEXT NOT NULL DEFAULT '',
    source_trace_key TEXT NOT NULL DEFAULT '',
    remark TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS inventory_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    warehouse_id INTEGER NOT NULL,
    batch_no TEXT NOT NULL DEFAULT '',
    qty_on_hand REAL NOT NULL DEFAULT 0,
    qty_available REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT '',
    UNIQUE(item_id, warehouse_id, batch_no)
);

CREATE TABLE IF NOT EXISTS document_relations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_doc_type TEXT NOT NULL,
    from_doc_id INTEGER NOT NULL,
    to_doc_type TEXT NOT NULL,
    to_doc_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    remark TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS material_trace_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL,
    batch_no TEXT NOT NULL DEFAULT '',
    from_doc_type TEXT NOT NULL,
    from_doc_id INTEGER NOT NULL,
    from_doc_item_id INTEGER,
    to_doc_type TEXT NOT NULL,
    to_doc_id INTEGER NOT NULL,
    to_doc_item_id INTEGER,
    qty REAL NOT NULL,
    trace_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setting_key TEXT NOT NULL UNIQUE,
    setting_value TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS ai_query_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query_text TEXT NOT NULL,
    query_type TEXT NOT NULL DEFAULT '',
    result_summary TEXT NOT NULL DEFAULT '',
    referenced_entity TEXT NOT NULL DEFAULT '',
    referenced_record_id INTEGER,
    created_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS operation_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    module_name TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id INTEGER,
    detail_json TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_items_code ON items(item_code);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(item_name);
CREATE INDEX IF NOT EXISTS idx_items_type ON items(item_type);
CREATE INDEX IF NOT EXISTS idx_items_track_individuals ON items(track_individuals);
CREATE INDEX IF NOT EXISTS idx_warehouses_code ON warehouses(warehouse_code);
CREATE INDEX IF NOT EXISTS idx_boms_parent_item_id ON boms(parent_item_id);
CREATE INDEX IF NOT EXISTS idx_bom_items_bom_id ON bom_items(bom_id);
CREATE INDEX IF NOT EXISTS idx_stock_documents_doc_type ON stock_documents(doc_type);
CREATE INDEX IF NOT EXISTS idx_stock_documents_status ON stock_documents(status);
CREATE INDEX IF NOT EXISTS idx_stock_documents_biz_date ON stock_documents(biz_date);
CREATE INDEX IF NOT EXISTS idx_stock_document_items_document_id ON stock_document_items(document_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_item_wh ON inventory_ledger(item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_doc ON inventory_ledger(doc_type, doc_id);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_trace_key ON inventory_ledger(trace_key);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_item_wh ON inventory_balances(item_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_order_materials_work_order_id ON work_order_materials(work_order_id);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_entity_record ON custom_field_values(entity_name, record_id);
CREATE INDEX IF NOT EXISTS idx_item_instances_item_id ON item_instances(item_id);
CREATE INDEX IF NOT EXISTS idx_item_instances_status ON item_instances(status);
CREATE INDEX IF NOT EXISTS idx_item_instances_warehouse ON item_instances(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_item_instance_logs_instance_id ON item_instance_logs(instance_id);
