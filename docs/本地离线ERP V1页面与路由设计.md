# 本地离线 ERP V1 页面与路由设计

> 目标：定义本地离线 ERP V1 的页面结构、前后端路由、本地 API、页面职责与交互边界。
> 适用范围：**库存、BOM、工单、物料追踪、AI 问答**。

---

## 1. 设计目标

V1 页面与路由设计需要满足：

- 完全本地运行
- 页面结构清晰，便于后续扩展
- 优先围绕库存/BOM/追踪主线
- AI 不是装饰，而是可直接操作的辅助入口
- 页面与 API 分层明确

---

## 2. 页面总览

建议 V1 页面分为以下 8 个主页面：

1. 工作台
2. 基础资料
3. 库存中心
4. BOM 中心
5. 工单中心
6. 物料追踪
7. AI 助手
8. 系统设置

---

## 3. 页面信息架构

## 3.1 一级导航建议

建议主导航如下：

- `工作台`
- `基础资料`
- `库存`
- `BOM`
- `工单`
- `追踪`
- `AI`
- `设置`

如果首页入口卡片还要保留大屏式入口，建议后续改成：

- 文件浏览器
- ToDo
- 产品对比
- Draw.io
- 串口助手
- 本地 ERP

其中“本地 ERP”进入 ERP 工作台首页，而不是旧的 ERPNext 页面。

---

## 4. 页面设计

## 4.1 工作台

### 页面目标

让用户打开 ERP 后第一眼看到：

- 当前库存风险
- 当前缺料情况
- 近期工单状态
- 近期出入库摘要
- AI 生成的提醒摘要

### 页面建议区域

#### 顶部指标卡

- 低于安全库存物料数
- 今日入库单数
- 今日出库单数
- 进行中的工单数
- 待处理追踪异常数

#### 中部左侧

- 缺料预警列表
- 最近库存异动列表

#### 中部右侧

- 进行中工单
- 最近新增 BOM / BOM 变更

#### 底部

- AI 摘要
- 快速入口

### 页面需要的本地数据

- 安全库存结果
- 今日单据统计
- 工单统计
- 异常追踪统计
- AI 摘要文本

---

## 4.2 基础资料页面

### 子页面建议

- 物料列表
- 物料详情
- 仓库列表
- 供应商列表
- 员工列表
- 自定义字段配置

### 4.2.1 物料列表页

#### 目标

统一查看和维护物料主数据。

#### 列表字段建议

- 物料编码
- 物料名称
- 规格型号
- 分类
- 单位
- 物料属性
- 默认仓库
- 安全库存
- 启用状态

#### 支持操作

- 新增物料
- 编辑物料
- 停用/启用
- 导入导出
- AI 补全建议

### 4.2.2 物料详情页

#### 页面组成

- 基础信息
- 自定义字段
- 当前库存摘要
- 最近库存流水
- 关联 BOM
- 被哪些 BOM 使用
- AI 快速问答

---

## 4.3 库存中心

### 子页面建议

- 库存余额查询
- 库存流水查询
- 出入库单列表
- 单据录入页
- 调拨页
- 盘点页

### 4.3.1 库存余额页

#### 目标

快速查看某物料在各仓库的库存。

#### 列表字段建议

- 物料编码
- 物料名称
- 仓库
- 批次
- 现存量
- 可用量
- 安全库存
- 是否预警

#### 支持筛选

- 物料
- 仓库
- 分类
- 物料属性
- 仅显示预警

### 4.3.2 库存流水页

#### 目标

查看每一次库存变化记录。

#### 列表字段建议

- 业务日期
- 物料
- 仓库
- 批次
- 单据类型
- 单据编号
- 方向
- 数量
- 变动后余额
- trace_key

### 4.3.3 单据录入页

V1 建议先支持这些单据页面：

- 采购入库单
- 领料单
- 退料单
- 完工入库单
- 调拨单
- 盘点单
- 其他出入库单

#### 页面结构建议

- 单据头
- 明细表格
- 单据状态栏
- AI 建议区

#### 单据头字段建议

- 单据编号
- 业务日期
- 仓库
- 关联供应商/工单
- 经办人
- 备注

#### 明细字段建议

- 物料编码
- 物料名称
- 批次
- 数量
- 单位
- 仓库
- 备注

---

## 4.4 BOM 中心

### 子页面建议

- BOM 列表
- BOM 编辑器
- BOM 版本对比
- 子件反查父件

### 4.4.1 BOM 列表页

#### 列表字段建议

- BOM 编号
- 父件编码
- 父件名称
- 版本号
- 默认版本
- 状态
- 生效日期
- 更新时间

#### 支持操作

- 新建 BOM
- 编辑 BOM
- 复制 BOM
- 设为默认版本
- 停用 BOM
- AI 分析 BOM 差异

### 4.4.2 BOM 编辑页

#### 页面结构

- BOM 主信息
- 子件明细表
- 替代料信息
- 版本说明
- 差异比对入口

#### 子件明细列

- 行号
- 子件编码
- 子件名称
- 数量
- 单位
- 损耗率
- 可选件
- 替代组
- 备注

### 4.4.3 子件反查父件页

#### 目标

回答“某个原料被哪些成品使用”。

#### 列表字段建议

- 子件编码
- 父件编码
- 父件名称
- BOM 编号
- 版本号
- 用量

---

## 4.5 工单中心

### 子页面建议

- 工单列表
- 工单详情
- 工单领料
- 工单完工

### 4.5.1 工单列表页

#### 列表字段建议

- 工单号
- 成品编码
- 成品名称
- BOM
- 计划数量
- 已完工数量
- 状态
- 计划开始/结束

#### 支持操作

- 新建工单
- 领料
- 退料
- 完工入库
- 查看物料消耗

### 4.5.2 工单详情页

#### 页面组成

- 工单头信息
- 理论用料
- 实际领料
- 退料记录
- 完工记录
- 关联单据
- AI 原因解释

---

## 4.6 物料追踪页面

这是核心特色页面。

### 子页面建议

- 物料追踪
- 批次追踪
- 单据链路

### 4.6.1 物料追踪页

#### 查询条件

- 物料编码
- 批次号
- 时间范围
- 仓库

#### 展示区域

- 追踪时间轴
- 来源单据
- 去向单据
- 关联工单
- 关联成品
- AI 解释结果

### 4.6.2 单据链路页

#### 目标

展示：

- 哪张单据来源于哪张单据
- 物料如何在不同单据间流转

#### 展示方式

- 表格
- 时间轴
- 关系图（V1 可以先不做图形，只做结构化列表）

---

## 4.7 AI 助手页面

### 页面目标

让用户可以直接用自然语言问业务问题。

### 页面组成

- 聊天输入框
- 常见问题快捷按钮
- 结构化答案区
- 引用记录区
- AI 建议区

### 常见问题建议

- “查询物料 A 当前库存”
- “哪些物料低于安全库存”
- “成品 B 的 BOM 是什么”
- “原料 C 最近流向了哪里”
- “某张工单为什么还不能完工”

### AI 页面输出建议

- 自然语言答案
- 结构化数据摘要
- 引用单据链接
- 建议动作（仅草稿/建议，不自动写入）

---

## 4.8 系统设置页面

### 子页面建议

- 基本设置
- 单据编号规则
- 批次设置
- AI 设置
- 备份恢复
- 操作日志

### V1 必做项

- 是否启用批次管理
- 默认仓库
- 安全库存检查参数
- AI 开关
- 数据备份
- 数据恢复

---

## 5. 页面路由设计

建议页面路由统一放在 `/erp` 下。

## 5.1 页面路由列表

- `/erp`
- `/erp/dashboard`
- `/erp/master-data/items`
- `/erp/master-data/items/<id>`
- `/erp/master-data/warehouses`
- `/erp/master-data/suppliers`
- `/erp/master-data/employees`
- `/erp/master-data/custom-fields`
- `/erp/inventory/balances`
- `/erp/inventory/ledger`
- `/erp/inventory/documents`
- `/erp/inventory/documents/new/<doc_type>`
- `/erp/inventory/documents/<id>`
- `/erp/bom`
- `/erp/bom/new`
- `/erp/bom/<id>`
- `/erp/bom/<id>/compare`
- `/erp/bom/component-usage`
- `/erp/work-orders`
- `/erp/work-orders/new`
- `/erp/work-orders/<id>`
- `/erp/work-orders/<id>/issue`
- `/erp/work-orders/<id>/complete`
- `/erp/trace/items`
- `/erp/trace/batches`
- `/erp/trace/doc-relations`
- `/erp/ai`
- `/erp/settings`

---

## 6. 本地 API 设计

建议 API 统一放在 `/api/erp` 下。

## 6.1 设计原则

- 页面路由负责展示
- API 路由负责数据
- 所有写入操作默认要求显式确认
- AI 建议类接口与写入类接口分开

---

## 6.2 工作台 API

- `GET /api/erp/dashboard/summary`
- `GET /api/erp/dashboard/warnings`
- `GET /api/erp/dashboard/recent-documents`
- `GET /api/erp/dashboard/work-orders`
- `GET /api/erp/dashboard/ai-summary`

### 返回内容建议

- 安全库存预警数量
- 今日出入库统计
- 待处理工单数
- 最新异常摘要

---

## 6.3 基础资料 API

### 物料

- `GET /api/erp/items`
- `POST /api/erp/items`
- `GET /api/erp/items/<id>`
- `PUT /api/erp/items/<id>`
- `POST /api/erp/items/<id>/disable`
- `POST /api/erp/items/import`
- `GET /api/erp/items/export`

### 仓库

- `GET /api/erp/warehouses`
- `POST /api/erp/warehouses`
- `PUT /api/erp/warehouses/<id>`

### 供应商

- `GET /api/erp/suppliers`
- `POST /api/erp/suppliers`
- `PUT /api/erp/suppliers/<id>`

### 自定义字段

- `GET /api/erp/custom-fields/<entity_name>`
- `PUT /api/erp/custom-fields/<entity_name>`

---

## 6.4 库存 API

### 库存余额

- `GET /api/erp/inventory/balances`

### 库存台账

- `GET /api/erp/inventory/ledger`

### 单据

- `GET /api/erp/inventory/documents`
- `POST /api/erp/inventory/documents`
- `GET /api/erp/inventory/documents/<id>`
- `PUT /api/erp/inventory/documents/<id>`
- `POST /api/erp/inventory/documents/<id>/submit`
- `POST /api/erp/inventory/documents/<id>/cancel`

### 单据类型建议

请求体中的 `doc_type` 取值：

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

---

## 6.5 BOM API

- `GET /api/erp/boms`
- `POST /api/erp/boms`
- `GET /api/erp/boms/<id>`
- `PUT /api/erp/boms/<id>`
- `POST /api/erp/boms/<id>/set-default`
- `POST /api/erp/boms/<id>/disable`
- `GET /api/erp/boms/<id>/compare/<target_id>`
- `GET /api/erp/bom/component-usage`

---

## 6.6 工单 API

- `GET /api/erp/work-orders`
- `POST /api/erp/work-orders`
- `GET /api/erp/work-orders/<id>`
- `PUT /api/erp/work-orders/<id>`
- `POST /api/erp/work-orders/<id>/issue`
- `POST /api/erp/work-orders/<id>/return`
- `POST /api/erp/work-orders/<id>/complete`
- `GET /api/erp/work-orders/<id>/materials`
- `GET /api/erp/work-orders/<id>/relations`

---

## 6.7 追踪 API

- `GET /api/erp/trace/items`
- `GET /api/erp/trace/batches`
- `GET /api/erp/trace/doc-relations`
- `GET /api/erp/trace/items/<item_id>/timeline`
- `GET /api/erp/trace/batches/<batch_no>`

### API 应支持的查询参数

- `item_code`
- `batch_no`
- `warehouse_id`
- `date_from`
- `date_to`
- `doc_type`

---

## 6.8 AI API

### 问答

- `POST /api/erp/ai/query`

### 摘要

- `GET /api/erp/ai/summary`

### 建议

- `POST /api/erp/ai/suggestions`

### 草稿生成

- `POST /api/erp/ai/draft-document`

### AI API 设计原则

- `query` 只读
- `suggestions` 只返回建议
- `draft-document` 只生成待确认草稿
- AI 不直接提交单据

---

## 6.9 设置 API

- `GET /api/erp/settings`
- `PUT /api/erp/settings`
- `POST /api/erp/settings/backup`
- `POST /api/erp/settings/restore`
- `GET /api/erp/settings/logs`

---

## 7. 页面与 API 的映射关系

## 7.1 工作台

- 页面：`/erp/dashboard`
- API：
  - `/api/erp/dashboard/summary`
  - `/api/erp/dashboard/warnings`
  - `/api/erp/dashboard/recent-documents`
  - `/api/erp/dashboard/work-orders`
  - `/api/erp/dashboard/ai-summary`

## 7.2 物料页

- 页面：`/erp/master-data/items`
- API：
  - `/api/erp/items`
  - `/api/erp/items/<id>`

## 7.3 库存页

- 页面：`/erp/inventory/balances`
- API：
  - `/api/erp/inventory/balances`
  - `/api/erp/inventory/ledger`

## 7.4 BOM 页

- 页面：`/erp/bom`
- API：
  - `/api/erp/boms`
  - `/api/erp/bom/component-usage`

## 7.5 工单页

- 页面：`/erp/work-orders`
- API：
  - `/api/erp/work-orders`
  - `/api/erp/work-orders/<id>/issue`
  - `/api/erp/work-orders/<id>/complete`

## 7.6 追踪页

- 页面：`/erp/trace/items`
- API：
  - `/api/erp/trace/items`
  - `/api/erp/trace/batches`
  - `/api/erp/trace/doc-relations`

## 7.7 AI 页

- 页面：`/erp/ai`
- API：
  - `/api/erp/ai/query`
  - `/api/erp/ai/summary`
  - `/api/erp/ai/suggestions`

---

## 8. 推荐页面开发顺序

为减少前后端来回返工，建议按以下顺序做：

### 第一批

- `/erp/dashboard`
- `/erp/master-data/items`
- `/erp/inventory/balances`
- `/erp/inventory/ledger`

### 第二批

- `/erp/inventory/documents`
- `/erp/inventory/documents/new/<doc_type>`

### 第三批

- `/erp/bom`
- `/erp/bom/<id>`
- `/erp/bom/component-usage`

### 第四批

- `/erp/work-orders`
- `/erp/work-orders/<id>`

### 第五批

- `/erp/trace/items`
- `/erp/trace/batches`

### 第六批

- `/erp/ai`
- `/erp/settings`

---

## 9. V1 页面最小闭环

如果先做一个最小可用版本，建议只优先完成：

### 页面

- 工作台
- 物料列表
- 库存余额
- 库存流水
- BOM 列表/编辑
- 工单列表/详情
- 物料追踪
- AI 问答

### API

- 物料查询/维护
- 库存余额/台账
- 库存单据写入
- BOM 查询/维护
- 工单查询/写入
- 追踪查询
- AI 查询

---

## 10. AI 页面特别说明

因为你希望“偏向让 AI 帮我管理”，所以 AI 页面建议不是单纯聊天页，而是：

### 10.1 三栏布局建议

- 左侧：常见问题与快捷入口
- 中间：聊天与结果
- 右侧：引用记录 / 建议动作

### 10.2 AI 结果类型建议

AI 的每次回答尽量拆成：

- `answer_text`
- `structured_data`
- `references`
- `suggestions`

### 10.3 AI 常见动作建议

- 查看某物料库存
- 查看某 BOM 结构
- 分析某成品缺料原因
- 查看某工单相关物料
- 查看某批次流向
- 推荐补货清单

---

## 11. 下一步建议

有了页面与路由设计后，建议下一步继续输出：

**`docs/本地离线ERP V1单据流转设计.md`**

重点定义：

- 哪些单据进入库存台账
- 单据状态怎么流转
- 工单、BOM、库存单据如何关联
- trace_key / source_trace_key 如何生成
