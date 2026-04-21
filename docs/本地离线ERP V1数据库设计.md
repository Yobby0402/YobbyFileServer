# 本地离线 ERP V1 数据库设计

> 目标：为本地离线 ERP 的第一期版本提供一套可直接落地到 `SQLite` 的数据库结构设计。
> 本期聚焦：**库存、BOM、工单、物料去向追踪、AI 查询支持**。

---

## 1. 设计原则

### 1.1 本期目标

V1 数据库需要支撑以下业务：

- 基础资料管理
- 库存出入库
- BOM 管理
- 工单领料与完工入库
- 物料流向追踪
- AI 问答查询

### 1.2 设计原则

- 使用 `SQLite`
- 尽量采用整数主键
- 业务编码单独存储，不直接作为主键
- 主表/明细表分离
- 所有库存变化必须进入库存台账
- 所有关键单据必须可追踪来源和去向
- 为 AI 查询预留结构化字段

---

## 2. 命名约定

### 2.1 主键

- 所有主键统一使用：`id INTEGER PRIMARY KEY AUTOINCREMENT`

### 2.2 审计字段

建议所有主要表都带：

- `created_at TEXT`
- `updated_at TEXT`
- `created_by TEXT`
- `updated_by TEXT`

时间统一采用：

- `YYYY-MM-DD HH:MM:SS`

### 2.3 状态字段

建议主单表统一包含：

- `status`

V1 可选值建议：

- `draft`
- `submitted`
- `cancelled`
- `completed`

---

## 3. 基础资料表

## 3.1 `items`

物料主数据表。

### 建议字段

- `id`
- `item_code TEXT NOT NULL UNIQUE`
- `item_name TEXT NOT NULL`
- `spec TEXT DEFAULT ''`
- `category_id INTEGER`
- `unit_id INTEGER`
- `item_type TEXT NOT NULL`
- `default_warehouse_id INTEGER`
- `safety_stock REAL DEFAULT 0`
- `min_stock REAL DEFAULT 0`
- `is_enabled INTEGER DEFAULT 1`
- `remark TEXT DEFAULT ''`
- `created_at`
- `updated_at`
- `created_by`
- `updated_by`

### 说明

`item_type` 建议值：

- `raw_material`
- `semi_finished`
- `finished_goods`
- `consumable`
- `packaging`
- `spare_part`

### 建议索引

- `idx_items_code`
- `idx_items_name`
- `idx_items_type`
- `idx_items_category_id`

---

## 3.2 `item_categories`

- `id`
- `category_code TEXT UNIQUE`
- `category_name TEXT NOT NULL`
- `parent_id INTEGER`
- `sort_order INTEGER DEFAULT 0`
- `is_enabled INTEGER DEFAULT 1`
- `remark TEXT DEFAULT ''`

---

## 3.3 `units`

- `id`
- `unit_code TEXT UNIQUE`
- `unit_name TEXT NOT NULL`
- `precision_digits INTEGER DEFAULT 2`
- `remark TEXT DEFAULT ''`

---

## 3.4 `warehouses`

- `id`
- `warehouse_code TEXT NOT NULL UNIQUE`
- `warehouse_name TEXT NOT NULL`
- `warehouse_type TEXT DEFAULT 'normal'`
- `is_enabled INTEGER DEFAULT 1`
- `remark TEXT DEFAULT ''`
- `created_at`
- `updated_at`

### 建议索引

- `idx_warehouses_code`
- `idx_warehouses_name`

---

## 3.5 `suppliers`

- `id`
- `supplier_code TEXT UNIQUE`
- `supplier_name TEXT NOT NULL`
- `contact_person TEXT DEFAULT ''`
- `phone TEXT DEFAULT ''`
- `address TEXT DEFAULT ''`
- `is_enabled INTEGER DEFAULT 1`
- `remark TEXT DEFAULT ''`

---

## 3.6 `employees`

- `id`
- `employee_code TEXT UNIQUE`
- `employee_name TEXT NOT NULL`
- `role_name TEXT DEFAULT ''`
- `phone TEXT DEFAULT ''`
- `is_enabled INTEGER DEFAULT 1`
- `remark TEXT DEFAULT ''`

---

## 3.7 `custom_fields`

用于后续支持基础资料字段自定义。

- `id`
- `entity_name TEXT NOT NULL`
- `field_name TEXT NOT NULL`
- `field_label TEXT NOT NULL`
- `field_type TEXT NOT NULL`
- `is_required INTEGER DEFAULT 0`
- `is_enabled INTEGER DEFAULT 1`
- `sort_order INTEGER DEFAULT 0`
- `options_json TEXT DEFAULT ''`
- `default_value TEXT DEFAULT ''`

### 唯一约束建议

- `(entity_name, field_name)`

---

## 3.8 `custom_field_values`

用于存储各业务实体的扩展字段值。

- `id`
- `entity_name TEXT NOT NULL`
- `record_id INTEGER NOT NULL`
- `field_name TEXT NOT NULL`
- `field_value TEXT DEFAULT ''`

### 建议索引

- `idx_custom_field_values_entity_record`
- `idx_custom_field_values_field_name`

---

## 4. BOM 表

## 4.1 `boms`

用于 BOM 主表。

### 建议字段

- `id`
- `bom_code TEXT NOT NULL UNIQUE`
- `parent_item_id INTEGER NOT NULL`
- `version_no TEXT NOT NULL`
- `status TEXT NOT NULL DEFAULT 'draft'`
- `is_default_version INTEGER DEFAULT 0`
- `effective_date TEXT DEFAULT ''`
- `expired_date TEXT DEFAULT ''`
- `remark TEXT DEFAULT ''`
- `created_at`
- `updated_at`
- `created_by`
- `updated_by`

### 唯一约束建议

- `(parent_item_id, version_no)`

### 建议索引

- `idx_boms_parent_item_id`
- `idx_boms_status`

---

## 4.2 `bom_items`

用于 BOM 子件明细。

### 建议字段

- `id`
- `bom_id INTEGER NOT NULL`
- `line_no INTEGER DEFAULT 0`
- `component_item_id INTEGER NOT NULL`
- `qty REAL NOT NULL`
- `unit_id INTEGER`
- `loss_rate REAL DEFAULT 0`
- `is_optional INTEGER DEFAULT 0`
- `substitute_group TEXT DEFAULT ''`
- `remark TEXT DEFAULT ''`

### 建议索引

- `idx_bom_items_bom_id`
- `idx_bom_items_component_item_id`

---

## 4.3 `bom_versions`

可选表，用于记录版本变化说明；如果想简化，也可以先不建，直接用 `boms`。

- `id`
- `bom_id INTEGER NOT NULL`
- `version_no TEXT NOT NULL`
- `change_summary TEXT DEFAULT ''`
- `changed_at TEXT`
- `changed_by TEXT`

---

## 5. 单据主表设计

为了统一库存相关单据，建议 V1 采用统一主表结构。

## 5.1 `stock_documents`

用于所有库存类单据主表。

### 建议字段

- `id`
- `doc_type TEXT NOT NULL`
- `doc_no TEXT NOT NULL UNIQUE`
- `status TEXT NOT NULL DEFAULT 'draft'`
- `biz_date TEXT NOT NULL`
- `source_warehouse_id INTEGER`
- `target_warehouse_id INTEGER`
- `related_party_type TEXT DEFAULT ''`
- `related_party_id INTEGER`
- `related_order_id INTEGER`
- `related_work_order_id INTEGER`
- `operator_id INTEGER`
- `remark TEXT DEFAULT ''`
- `created_at`
- `updated_at`
- `created_by`
- `updated_by`

### `doc_type` 建议值

- `purchase_in`
- `production_in`
- `sales_out`
- `material_issue`
- `material_return`
- `transfer`
- `stock_count`
- `stock_adjust`
- `other_in`
- `other_out`

### 建议索引

- `idx_stock_documents_doc_type`
- `idx_stock_documents_status`
- `idx_stock_documents_biz_date`
- `idx_stock_documents_related_work_order_id`

---

## 5.2 `stock_document_items`

库存单据明细表。

### 建议字段

- `id`
- `document_id INTEGER NOT NULL`
- `line_no INTEGER DEFAULT 0`
- `item_id INTEGER NOT NULL`
- `batch_no TEXT DEFAULT ''`
- `qty REAL NOT NULL`
- `unit_id INTEGER`
- `warehouse_id INTEGER`
- `location_code TEXT DEFAULT ''`
- `source_trace_id INTEGER`
- `related_bom_id INTEGER`
- `remark TEXT DEFAULT ''`

### 建议索引

- `idx_stock_document_items_document_id`
- `idx_stock_document_items_item_id`
- `idx_stock_document_items_batch_no`

---

## 6. 库存台账与余额表

## 6.1 `inventory_ledger`

这是库存核心表，必须记录每一次库存变化。

### 建议字段

- `id`
- `biz_date TEXT NOT NULL`
- `item_id INTEGER NOT NULL`
- `warehouse_id INTEGER NOT NULL`
- `batch_no TEXT DEFAULT ''`
- `doc_type TEXT NOT NULL`
- `doc_id INTEGER NOT NULL`
- `doc_item_id INTEGER`
- `direction TEXT NOT NULL`
- `qty REAL NOT NULL`
- `balance_after REAL DEFAULT 0`
- `trace_key TEXT DEFAULT ''`
- `source_trace_key TEXT DEFAULT ''`
- `remark TEXT DEFAULT ''`
- `created_at`

### `direction` 建议值

- `in`
- `out`

### 设计要点

- 每次出入库必须写一条或多条台账
- `trace_key` 用于追踪本次库存的去向/来源
- `source_trace_key` 用于关联上游来源

### 建议索引

- `idx_inventory_ledger_item_wh`
- `idx_inventory_ledger_doc`
- `idx_inventory_ledger_batch`
- `idx_inventory_ledger_trace_key`
- `idx_inventory_ledger_source_trace_key`

---

## 6.2 `inventory_balances`

实时库存汇总表，用于提升查询效率。

### 建议字段

- `id`
- `item_id INTEGER NOT NULL`
- `warehouse_id INTEGER NOT NULL`
- `batch_no TEXT DEFAULT ''`
- `qty_on_hand REAL DEFAULT 0`
- `qty_available REAL DEFAULT 0`
- `updated_at TEXT`

### 唯一约束建议

- `(item_id, warehouse_id, batch_no)`

---

## 6.3 `stock_batches`

如果要做批次追踪，建议一期就落这张表。

- `id`
- `item_id INTEGER NOT NULL`
- `batch_no TEXT NOT NULL`
- `source_doc_type TEXT DEFAULT ''`
- `source_doc_id INTEGER`
- `source_doc_item_id INTEGER`
- `received_date TEXT DEFAULT ''`
- `status TEXT DEFAULT 'active'`
- `remark TEXT DEFAULT ''`

### 唯一约束建议

- `(item_id, batch_no)`

---

## 7. 工单与生产表

## 7.1 `work_orders`

工单主表。

### 建议字段

- `id`
- `work_order_no TEXT NOT NULL UNIQUE`
- `status TEXT NOT NULL DEFAULT 'draft'`
- `parent_item_id INTEGER NOT NULL`
- `bom_id INTEGER`
- `plan_qty REAL NOT NULL`
- `finished_qty REAL DEFAULT 0`
- `warehouse_id INTEGER`
- `planned_start_date TEXT DEFAULT ''`
- `planned_end_date TEXT DEFAULT ''`
- `actual_start_date TEXT DEFAULT ''`
- `actual_end_date TEXT DEFAULT ''`
- `remark TEXT DEFAULT ''`
- `created_at`
- `updated_at`
- `created_by`
- `updated_by`

### 建议索引

- `idx_work_orders_parent_item_id`
- `idx_work_orders_bom_id`
- `idx_work_orders_status`

---

## 7.2 `work_order_materials`

记录工单理论/实际用料。

### 建议字段

- `id`
- `work_order_id INTEGER NOT NULL`
- `item_id INTEGER NOT NULL`
- `required_qty REAL DEFAULT 0`
- `issued_qty REAL DEFAULT 0`
- `returned_qty REAL DEFAULT 0`
- `consumed_qty REAL DEFAULT 0`
- `unit_id INTEGER`
- `remark TEXT DEFAULT ''`

### 建议索引

- `idx_work_order_materials_work_order_id`
- `idx_work_order_materials_item_id`

---

## 7.3 `work_order_outputs`

记录工单产出。

- `id`
- `work_order_id INTEGER NOT NULL`
- `item_id INTEGER NOT NULL`
- `output_qty REAL NOT NULL`
- `warehouse_id INTEGER`
- `batch_no TEXT DEFAULT ''`
- `related_doc_id INTEGER`
- `remark TEXT DEFAULT ''`

---

## 8. 追踪关系表

## 8.1 `material_trace_links`

用于把来源与去向连接起来。

### 建议字段

- `id`
- `item_id INTEGER NOT NULL`
- `batch_no TEXT DEFAULT ''`
- `from_doc_type TEXT NOT NULL`
- `from_doc_id INTEGER NOT NULL`
- `from_doc_item_id INTEGER`
- `to_doc_type TEXT NOT NULL`
- `to_doc_id INTEGER NOT NULL`
- `to_doc_item_id INTEGER`
- `qty REAL NOT NULL`
- `trace_type TEXT NOT NULL`
- `created_at TEXT`

### `trace_type` 建议值

- `purchase_to_stock`
- `stock_to_issue`
- `issue_to_work_order`
- `work_order_to_finished_goods`
- `stock_to_sales`
- `transfer_between_warehouses`

### 作用

这张表是“物料去向追踪”的核心支撑表之一。

---

## 8.2 `document_relations`

用于记录单据之间的关联关系。

- `id`
- `from_doc_type TEXT NOT NULL`
- `from_doc_id INTEGER NOT NULL`
- `to_doc_type TEXT NOT NULL`
- `to_doc_id INTEGER NOT NULL`
- `relation_type TEXT NOT NULL`
- `remark TEXT DEFAULT ''`
- `created_at TEXT`

### 作用

例如：

- 工单 -> 领料单
- 工单 -> 完工入库单
- 入库单 -> 批次

---

## 9. AI 支撑表

## 9.1 `ai_query_logs`

记录 AI 查询历史。

- `id`
- `query_text TEXT NOT NULL`
- `query_type TEXT DEFAULT ''`
- `result_summary TEXT DEFAULT ''`
- `referenced_entity TEXT DEFAULT ''`
- `referenced_record_id INTEGER`
- `created_at TEXT`
- `created_by TEXT`

---

## 9.2 `operation_logs`

记录关键业务操作。

- `id`
- `module_name TEXT NOT NULL`
- `operation_type TEXT NOT NULL`
- `target_type TEXT NOT NULL`
- `target_id INTEGER`
- `detail_json TEXT DEFAULT ''`
- `created_at TEXT`
- `created_by TEXT`

---

## 10. 用户与设置表

## 10.1 `users`

- `id`
- `username TEXT NOT NULL UNIQUE`
- `password_hash TEXT NOT NULL`
- `display_name TEXT DEFAULT ''`
- `role_name TEXT DEFAULT 'admin'`
- `is_enabled INTEGER DEFAULT 1`
- `last_login_at TEXT DEFAULT ''`
- `created_at TEXT`

---

## 10.2 `settings`

- `id`
- `setting_key TEXT NOT NULL UNIQUE`
- `setting_value TEXT DEFAULT ''`
- `updated_at TEXT`

### 可放内容

- 单据编号前缀
- 是否启用批次
- AI 开关
- 默认仓库
- 安全库存检查参数

---

## 11. 关键外键关系建议

为了兼容 SQLite 的灵活性，建议：

- 核心外键在代码层和数据库层同时维护
- 重要字段保留索引

### 重点关系

- `items.category_id -> item_categories.id`
- `items.unit_id -> units.id`
- `items.default_warehouse_id -> warehouses.id`
- `boms.parent_item_id -> items.id`
- `bom_items.bom_id -> boms.id`
- `bom_items.component_item_id -> items.id`
- `stock_document_items.document_id -> stock_documents.id`
- `stock_document_items.item_id -> items.id`
- `inventory_ledger.doc_id -> stock_documents.id`
- `work_orders.parent_item_id -> items.id`
- `work_orders.bom_id -> boms.id`

---

## 12. 单据编号建议

V1 建议采用“前缀 + 日期 + 序号”的简单规则。

### 示例

- 采购入库：`PI-20260420-0001`
- 领料单：`MI-20260420-0001`
- 完工入库：`FI-20260420-0001`
- 调拨单：`TR-20260420-0001`
- 盘点单：`SC-20260420-0001`
- 工单：`WO-20260420-0001`
- BOM：`BOM-ITEM001-V1`

---

## 13. 一期最小闭环所需核心表

如果只做 V1 最小闭环，优先落地以下表：

- `items`
- `item_categories`
- `units`
- `warehouses`
- `suppliers`
- `boms`
- `bom_items`
- `stock_documents`
- `stock_document_items`
- `inventory_ledger`
- `inventory_balances`
- `work_orders`
- `work_order_materials`
- `material_trace_links`
- `users`
- `settings`

---

## 14. 推荐开发顺序

### 第一批

- `items`
- `warehouses`
- `units`
- `inventory_ledger`
- `inventory_balances`

### 第二批

- `stock_documents`
- `stock_document_items`

### 第三批

- `boms`
- `bom_items`

### 第四批

- `work_orders`
- `work_order_materials`
- `material_trace_links`

### 第五批

- `ai_query_logs`
- `operation_logs`

---

## 15. V1 数据库落地建议

建议后续实现时按下面方式推进：

1. 先写 `schema.sql`
2. 再写数据库初始化脚本
3. 再写基础仓储层
4. 再写库存台账逻辑
5. 最后接页面和 AI 查询

---

## 16. 下一步建议

有了这份数据库设计后，建议下一步继续输出：

**`docs/本地离线ERP V1页面与路由设计.md`**

把下面内容定下来：

- 首页工作台布局
- 库存页面
- BOM 页面
- 追踪页面
- AI 问答页面
- 每个页面对应的本地 API
