# 本地离线 ERP V1 单据流转设计

> 目标：定义 V1 阶段库存单据、工单、BOM、追踪关系之间的流转规则，确保后续实现时库存可算、来源可追、去向可查、AI 可解释。

---

## 1. 设计目标

本期单据流转需要解决四个核心问题：

- 哪些业务动作会生成单据
- 哪些单据会写入库存台账
- 工单、BOM、库存单据之间如何关联
- 物料来源与去向如何形成追踪链路

---

## 2. V1 单据范围

## 2.1 库存类单据

V1 建议支持以下单据类型：

- `purchase_in` 采购入库单
- `production_in` 完工入库单
- `material_issue` 领料单
- `material_return` 退料单
- `transfer` 调拨单
- `stock_count` 盘点单
- `stock_adjust` 库存调整单
- `other_in` 其他入库单
- `other_out` 其他出库单

其中：

- 入库方向单据：`purchase_in`、`production_in`、`other_in`
- 出库方向单据：`material_issue`、`other_out`
- 双向单据：`transfer`
- 差异修正单据：`stock_count`、`stock_adjust`

## 2.2 生产类单据

V1 生产主线建议包括：

- `work_order` 工单
- `material_issue` 工单领料
- `material_return` 工单退料
- `production_in` 工单完工入库

---

## 3. 关键对象关系

## 3.1 BOM 与工单

- BOM 定义“做什么产品需要什么物料”
- 工单定义“针对哪一个产品、按哪个 BOM、计划做多少”
- 工单创建时，默认带入 BOM 明细生成理论用料

建议关系如下：

- `work_orders.bom_id -> boms.id`
- `work_order_materials.work_order_id -> work_orders.id`
- `work_order_materials.item_id -> items.id`

## 3.2 工单与库存单据

工单本身不直接改库存，库存变化由关联库存单据完成：

- 领料：生成 `material_issue`
- 退料：生成 `material_return`
- 完工：生成 `production_in`

建议关联字段如下：

- `stock_documents.related_work_order_id`
- `stock_document_items.related_bom_id`
- `document_relations`

---

## 4. 单据状态流转

## 4.1 库存单据状态

库存单据建议统一状态：

- `draft`
- `submitted`
- `cancelled`

### 状态规则

- `draft`：允许编辑，不写库存台账
- `submitted`：正式生效，写库存台账与追踪关系
- `cancelled`：已作废，不可再次编辑；若之前已生效，则必须冲销台账

## 4.2 工单状态

工单建议使用以下状态：

- `draft`
- `released`
- `in_progress`
- `completed`
- `cancelled`

### 状态规则

- `draft`：刚创建，允许修改 BOM 与计划量
- `released`：已下达，允许开始领料
- `in_progress`：已有领料或已有产出
- `completed`：完工数量达到目标或人工确认完工
- `cancelled`：工单作废，不允许继续领退料与完工

---

## 5. 库存台账写入规则

## 5.1 基本原则

- 只有 `submitted` 状态的库存单据才能写入 `inventory_ledger`
- 每条会影响库存的明细行都必须落一条或多条台账
- 所有库存数量变化都必须能反查到原始单据

## 5.2 各单据写台账规则

### 采购入库 `purchase_in`

- 每个明细行写 1 条 `in`
- 更新 `inventory_balances`
- 必要时新建 `stock_batches`
- 建立来源追踪：供应来源 -> 当前库存

### 领料单 `material_issue`

- 每个明细行写 1 条 `out`
- 更新 `inventory_balances`
- 若关联工单，则建立：
  - 库存 -> 领料单
  - 领料单 -> 工单

### 退料单 `material_return`

- 每个明细行写 1 条 `in`
- 更新 `inventory_balances`
- 若关联工单，则建立：
  - 工单 -> 退料单
  - 退料单 -> 库存

### 完工入库 `production_in`

- 每个明细行写 1 条 `in`
- 更新 `inventory_balances`
- 建立：
  - 工单 -> 完工入库单
  - 原料消耗链 -> 成品批次

### 调拨单 `transfer`

同一明细需写 2 条台账：

- 源仓写 1 条 `out`
- 目标仓写 1 条 `in`

并建立：

- 源库存 -> 调拨出
- 调拨出 -> 调拨入

### 盘点单 `stock_count`

盘点单本质上建议生成“差异调整结果”，只对差异部分写台账：

- 盘盈写 `in`
- 盘亏写 `out`

### 调整单 `stock_adjust`

直接按调整方向写：

- 增加库存写 `in`
- 减少库存写 `out`

---

## 6. 单据与追踪链路

## 6.1 追踪目标

系统应能回答：

- 某批原料从哪张入库单进入库存
- 后续被哪些领料单领走
- 被哪个工单消耗
- 最终进入了哪些成品或半成品

## 6.2 推荐追踪结构

追踪建议同时依赖三类数据：

- `inventory_ledger`：记录库存变化
- `material_trace_links`：记录来源与去向连接
- `document_relations`：记录单据之间的业务关系

三者职责：

- `inventory_ledger` 负责算库存
- `material_trace_links` 负责查去向
- `document_relations` 负责解释业务链路

---

## 7. `trace_key` 设计建议

## 7.1 设计原则

`trace_key` 不建议仅靠物料编码，应尽量能标识“这一份库存从哪来”。

建议追踪粒度至少到：

- 物料
- 批次
- 来源单据明细
- 仓库

## 7.2 推荐生成规则

建议格式：

`{item_id}:{batch_no}:{doc_type}:{doc_id}:{doc_item_id}`

示例：

`101:B20260420:purchase_in:88:3`

含义：

- 物料 `101`
- 批次 `B20260420`
- 来源于采购入库单 `88`
- 来源单据第 `3` 行

## 7.3 `source_trace_key` 规则

`source_trace_key` 用于表示“当前这笔流转来自哪条上游链路”。

建议用法：

- 采购入库：`source_trace_key` 为空
- 领料单：`source_trace_key` 指向被消耗的库存来源
- 退料单：`source_trace_key` 指向原领料行
- 完工入库：`source_trace_key` 可记录主来源工单号或主耗料链

## 7.4 V1 简化策略

为避免实现复杂度过高，V1 可以采用：

- 入库单生成新的 `trace_key`
- 出库单沿用被消耗库存的 `trace_key` 填入 `source_trace_key`
- 完工入库单生成新的成品 `trace_key`
- 原料到成品的映射记录在 `material_trace_links`

这样既保留来源链，又避免在 `inventory_ledger` 中做过度复杂的多对多追踪。

---

## 8. `material_trace_links` 写入规则

## 8.1 采购入库

建议写入：

- `from_doc_type = purchase_in`
- `to_doc_type = stock`
- `trace_type = purchase_to_stock`

## 8.2 领料

建议写入两层关系：

- 库存 -> 领料单：`stock_to_issue`
- 领料单 -> 工单：`issue_to_work_order`

## 8.3 退料

建议写入：

- 工单 -> 退料单：`work_order_to_return`
- 退料单 -> 库存：`return_to_stock`

## 8.4 完工入库

建议写入：

- 工单 -> 完工入库单：`work_order_to_finished_goods`
- 完工入库单 -> 成品库存：`finished_goods_to_stock`

## 8.5 调拨

建议写入：

- 源仓库存 -> 调拨单：`transfer_out`
- 调拨单 -> 目标仓库存：`transfer_between_warehouses`

---

## 9. 单据取消与冲销规则

## 9.1 基本原则

不建议直接物理删除已提交单据。

如果已提交单据需要作废，建议：

- 单据改为 `cancelled`
- 写入反向台账
- 写入反向追踪关系或标记关系失效
- 记录操作日志

## 9.2 冲销规则

### 已提交采购入库取消

- 写一条等量 `out` 冲销台账
- 更新库存余额
- 若库存已被后续使用，则禁止直接取消或提示先处理后续业务

### 已提交领料单取消

- 写一条等量 `in` 冲销台账
- 回滚工单已领料数量

### 已提交完工入库取消

- 写一条等量 `out` 冲销台账
- 回滚工单已完工数量
- 若成品已再次出库，则禁止直接取消

---

## 10. V1 最小业务闭环

建议先实现以下闭环：

### 闭环一：采购入库到库存查询

1. 创建采购入库单
2. 提交单据
3. 写入库存台账
4. 更新库存余额
5. 可在库存余额与流水页查询

### 闭环二：BOM 到工单到领料

1. 创建 BOM
2. 创建工单并引用 BOM
3. 自动生成理论用料
4. 创建并提交领料单
5. 更新工单已领料数量

### 闭环三：工单完工到成品追踪

1. 创建完工入库单
2. 提交后增加成品库存
3. 建立工单与成品批次关系
4. 在追踪页可反查成品来源工单与原料去向

---

## 11. AI 使用这些流转数据做什么

有了上述流转规则后，AI 可以稳定回答：

- “为什么这个工单还不能完工”
- “这个成品用了哪些批次原料”
- “某批原料最后流向了哪些产品”
- “最近哪些物料因为领料导致库存预警”
- “某张单据为什么会影响当前库存”

AI 解释时建议引用：

- 单据编号
- 单据类型
- 工单编号
- 批次号
- 库存台账记录

---

## 12. 推荐实现顺序

建议开发时按下面顺序落地：

1. 单据状态与编号规则
2. `stock_documents` / `stock_document_items`
3. `inventory_ledger` / `inventory_balances`
4. 单据提交与冲销逻辑
5. `work_orders` / `work_order_materials`
6. `document_relations`
7. `material_trace_links`
8. AI 查询解释层

---

## 13. 下一步建议

有了这份单据流转设计后，建议下一步直接进入实现准备：

- 输出 `schema.sql`
- 输出 `docs/本地离线ERP V1模块拆分与开发顺序.md`
- 或直接开始落地数据库初始化与仓储层
