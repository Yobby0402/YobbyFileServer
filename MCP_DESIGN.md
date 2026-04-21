# YobboyFileServer MCP 设计草案（V1）

本文档给出本项目接入 MCP（Model Context Protocol）的首版设计框架，目标是：

- 让 AI 从“快照推理”升级为“按需调用结构化工具”；
- 降低上下文截断和误判概率；
- 保留现有“预览 + 人工确认再写入”的安全模型。

---

## 1. 总体架构

建议采用三层：

1. **MCP Server 层**
   - 暴露 tools（只读 + 写入预览 + 写入执行）。
   - 输入输出全部 JSON schema 化。

2. **业务适配层（Adapter）**
   - 封装现有模块：`yobboy_file_server/todo_ai_bridge.py`、`yobboy_file_server/todo_manager.py`、`yobboy_file_server/knowledge_store.py`。
   - 做名称匹配、参数标准化、错误转换。

3. **安全治理层（Guard）**
   - 鉴权、限流、审计、幂等。
   - 写操作默认 dry-run，执行需 confirm token。

---

## 2. 工具列表（V1）

分三类：只读查询、写入预览、写入执行。

### 2.1 Todo 只读工具

#### `todo_list_projects`
- 作用：列出项目及统计信息。
- 对应现有能力：`TodoManager.list_all()` + 轻聚合。

#### `todo_list_tasks`
- 作用：按项目列任务（支持未完成过滤、分页）。
- 对应现有能力：`build_todo_overview_dict` 思路。

#### `todo_get_task_detail`
- 作用：返回单任务完整信息（description/comments/update_history）。
- 对应现有能力：`build_todo_task_detail_for_llm` 的结构化版本。

#### `todo_get_context_preview`
- 作用：返回分层上下文（summary/project/task/full），用于调试与解释。
- 对应现有能力：`build_adaptive_todo_context_and_meta`。

### 2.2 Todo 写入工具（推荐双阶段）

#### `todo_plan_ops`
- 作用：把自然语言或结构化请求转换成 ops（不落库）。
- 输出：标准 ops + 可读预览 + 风险提示。
- 对应现有能力：`propose_todo_ops_json` + `validate_and_describe_ops`。

#### `todo_validate_ops`
- 作用：校验 ops 合法性，返回错误与可读预览。
- 对应现有能力：`validate_and_describe_ops`。

#### `todo_apply_ops`
- 作用：执行 ops 写入。
- 要求：必须带 confirm token（或显式 `confirmed=true` 且有权限）。
- 对应现有能力：`apply_todo_ops`。

### 2.3 知识库工具

#### `kb_list_entries`
- 作用：列出已纳入知识库的文件。
- 对应现有能力：`knowledge_store.list_entries`。

#### `kb_get_entry`
- 作用：查询某文件是否在知识库及其元数据。
- 对应现有能力：`knowledge_store.get_meta`。

#### `kb_set_entry`
- 作用：加入知识库（仅 `.md/.txt`）。
- 对应现有能力：`knowledge_store.set_entry`。

#### `kb_remove_entry`
- 作用：移除知识库。
- 对应现有能力：`knowledge_store.remove_entry`。

#### `kb_retrieve`
- 作用：按 query 检索知识库片段，返回命中与建议文件名。
- 对应现有能力：`knowledge_store.retrieve_for_query`。

---

## 3. 参数 Schema（建议）

以下为建议 JSON schema 轮廓（便于实现时直接落地）。

### 3.1 `todo_list_projects` input

```json
{
  "type": "object",
  "properties": {
    "include_archived": { "type": "boolean", "default": true }
  },
  "additionalProperties": false
}
```

### 3.2 `todo_list_tasks` input

```json
{
  "type": "object",
  "required": ["project_name"],
  "properties": {
    "project_name": { "type": "string", "minLength": 1 },
    "incomplete_only": { "type": "boolean", "default": false },
    "limit": { "type": "integer", "minimum": 1, "maximum": 500, "default": 80 },
    "offset": { "type": "integer", "minimum": 0, "default": 0 },
    "include_description": { "type": "boolean", "default": false },
    "include_comments": { "type": "boolean", "default": false },
    "include_history": { "type": "boolean", "default": false }
  },
  "additionalProperties": false
}
```

### 3.3 `todo_get_task_detail` input

```json
{
  "type": "object",
  "required": ["project_name", "task_query"],
  "properties": {
    "project_name": { "type": "string", "minLength": 1 },
    "task_query": {
      "type": "string",
      "description": "任务标题关键词，或项目内序号（如 '3'）"
    },
    "match_mode": {
      "type": "string",
      "enum": ["auto", "exact", "contains", "index"],
      "default": "auto"
    }
  },
  "additionalProperties": false
}
```

### 3.4 `todo_plan_ops` input

```json
{
  "type": "object",
  "properties": {
    "message": { "type": "string" },
    "ops": {
      "type": "array",
      "items": { "type": "object" },
      "description": "可选；若传入则跳过自然语言规划，直接校验该 ops"
    },
    "auto_due_date": { "type": "boolean", "default": true }
  },
  "oneOf": [
    { "required": ["message"] },
    { "required": ["ops"] }
  ],
  "additionalProperties": false
}
```

### 3.5 `todo_apply_ops` input

```json
{
  "type": "object",
  "required": ["ops", "confirm_token"],
  "properties": {
    "ops": { "type": "array", "items": { "type": "object" }, "minItems": 1 },
    "confirm_token": { "type": "string", "minLength": 16 },
    "idempotency_key": { "type": "string", "minLength": 8 }
  },
  "additionalProperties": false
}
```

### 3.6 `kb_retrieve` input

```json
{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query": { "type": "string", "minLength": 1 },
    "top_k": { "type": "integer", "minimum": 1, "maximum": 20, "default": 6 },
    "max_file_bytes": { "type": "integer", "minimum": 1000, "maximum": 1000000, "default": 200000 }
  },
  "additionalProperties": false
}
```

---

## 4. 返回 Schema（建议）

统一建议：

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "trace_id": "uuid-or-short-id"
}
```

失败时：

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "具体错误",
    "details": {}
  },
  "trace_id": "..."
}
```

### 4.1 `todo_get_task_detail` output `data`

```json
{
  "project": { "name": "xxx", "archived": false },
  "task": {
    "summary": "...",
    "description": "...",
    "progress": 35,
    "priority": 3,
    "due_date": "2026-04-10",
    "task_type": "",
    "weekly_plan": "",
    "conclusion": "",
    "show_in_report": true,
    "comments": [{ "timestamp": "...", "content": "..." }],
    "update_history": [{ "timestamp": "...", "field": "...", "old_value": null, "new_value": "..." }]
  }
}
```

### 4.2 `todo_plan_ops` output `data`

```json
{
  "ops": [{ "op": "create_task", "...": "..." }],
  "preview_lines": ["在项目「A」下创建任务「B」", "· 截止: 2026-04-10"],
  "warnings": ["项目名有歧义，按最长匹配处理"],
  "confirm_token": "server-generated-token",
  "expires_at": "2026-04-08T12:00:00Z"
}
```

---

## 5. 安全策略（重点）

### 5.1 权限分级

- `read:*`：只读工具（项目/任务/知识库查询）
- `write:todo`：todo 写入工具
- `write:kb`：知识库管理工具
- 默认 token 仅开 `read:*`

### 5.2 写入必须双阶段

1. `todo_plan_ops` / `todo_validate_ops` 生成预览 + `confirm_token`
2. `todo_apply_ops` 必须提交 `confirm_token` 才执行

`confirm_token` 建议：
- 短时有效（如 5 分钟）
- 与调用者、ops 哈希绑定
- 一次性消费

### 5.3 幂等与防重放

- `todo_apply_ops` 支持 `idempotency_key`
- 服务端保存近 N 分钟执行记录，重复 key 直接返回已执行结果

### 5.4 输入校验

- 所有入参 JSON schema 校验
- 限制字符串长度（如 description/comment 最大长度）
- 项目/任务匹配失败必须返回结构化错误，不隐式猜测写入

### 5.5 审计日志

记录：
- 时间、调用者、tool 名、参数摘要
- 写入前后差异（不必存全量大文本）
- 成功/失败与错误码、trace_id

### 5.6 资源限制

- `kb_retrieve` 强制 `top_k` 和 `max_file_bytes` 上限
- tool 超时（如 5~10s）
- 并发限制（每调用者同类工具并发数）

---

## 6. 与现有代码映射建议

- `yobboy_file_server/todo_manager.py`：写入与核心 CRUD
- `yobboy_file_server/todo_ai_bridge.py`：
  - 日期解析：`parse_natural_due_date_cn`
  - ops 预览校验：`validate_and_describe_ops`
  - 执行：`apply_todo_ops`
  - 分层上下文：`build_adaptive_todo_context_and_meta`
- `yobboy_file_server/knowledge_store.py`：
  - `list_entries/get_meta/set_entry/remove_entry/retrieve_for_query`

建议先做“薄适配”：MCP tools 直接调用这些函数，先跑通，再做重构。

---

## 7. 分阶段落地计划

### Phase 1（1 天，低风险）
- 只读工具：`todo_list_projects/todo_list_tasks/todo_get_task_detail/kb_list_entries/kb_retrieve`
- 加 schema 校验 + trace_id + 基本日志

### Phase 2（1~2 天，中风险）
- 写入预览：`todo_plan_ops/todo_validate_ops`
- 执行：`todo_apply_ops`（confirm_token + idempotency_key）

### Phase 3（1~2 天，治理）
- 权限模型、审计增强、限流、超时、错误码统一

---

## 8. 设计结论

对本项目，MCP 的核心收益不是“换协议”，而是：

- **把数据访问和写入动作显式工具化**；
- **把安全策略前置到工具层**；
- **让 AI 在可控边界内高效调用真实能力**。

这会显著改善你目前遇到的：
- 细节字段拿不到（description/comments/history）
- 任务识别后无法直接操作
- 知识库命中“无感知”

在 V1 框架下，这些问题都可通过工具化和事件化稳定解决。

---

## 9. V1 实现约定（已落地）

本仓库已新增 `mcp_server.py` 兼容入口（真实实现位于 `yobboy_file_server/mcp_server.py`），按“薄适配”实现了本文档 V1 的主干能力：

- 传输：`stdio` + JSON-RPC + MCP `tools/list` / `tools/call`
- 返回：统一 `{ok,data,error,trace_id}`，并作为 MCP tool result 的 `structuredContent`
- Todo：
  - 只读：`todo_list_projects/todo_list_tasks/todo_get_task_detail/todo_get_context_preview`
  - 预览：`todo_plan_ops/todo_validate_ops`
  - 执行：`todo_apply_ops`
- Knowledge：
  - `kb_list_entries/kb_get_entry/kb_set_entry/kb_remove_entry/kb_retrieve`

### 9.1 安全治理（V1）

已实现：

- `todo_apply_ops` 必须提供 `confirm_token`
- `confirm_token` 与 `caller_id + ops 哈希` 绑定，短时有效，一次性消费
- `idempotency_key` 重放保护（短时缓存）
- 入参长度、条数、边界上限校验（含 `top_k/max_file_bytes`）

V1 暂未实现（留到下一阶段）：

- 独立鉴权 token 与 `read:* / write:*` 权限中心
- 完整审计落盘与调用者级限流

### 9.2 已知限制

- `todo_plan_ops` 当前仅支持传入结构化 `ops` 做校验与签发 `confirm_token`；
- `message -> ops` 的自然语言规划仍建议复用现有 `/api/local-ai/todo/preview`（或后续在 MCP 内接入模型推理链路）。

---

## 10. 启动与联调

### 10.1 本地启动

在项目根目录执行：

```bash
python mcp_server.py
```

可选参数：

```bash
python mcp_server.py --root-dir "你的项目根目录" --todo-storage-path "todos_v2.json绝对路径"
```

也可用环境变量：

- `YFS_ROOT_DIR`
- `YFS_TODO_STORAGE_PATH`

### 10.2 Cursor / 其它 MCP Client 配置示例

命令型 stdio 配置可指向：

- command: `python`
- args: `["mcp_server.py", "--root-dir", "F:/Work/YobboyFileServer"]`

> 建议把 server 运行目录固定在仓库根目录，避免相对路径解析差异。

---

## 11. 本地 AI 接 MCP（已落地）

为满足“网页本地 AI 也走 MCP”的目标，已在服务端加入本地 bridge：

- 新增：`yobboy_file_server/local_mcp_bridge.py`
- 方式：Flask 进程内作为 MCP client，通过 stdio 持久连接 `mcp_server.py`
- 默认开启：`LOCAL_AI_USE_MCP_BRIDGE=true`（`local_ai_routes.py` 内 setdefault）

### 11.1 已接入的本地 AI 链路

- `/api/local-ai/chat/stream`
  - todo 上下文读取优先走 `todo_get_context_preview`
  - knowledge 检索优先走 `kb_retrieve`
  - todo 变更预览后，追加调用 `todo_plan_ops`，返回 `confirm_token`
- `/api/local-ai/todo/preview`
  - 生成 ops 后优先走 `todo_plan_ops` 签发 `confirm_token`
- `/api/local-ai/todo/apply`
  - 优先走 `todo_apply_ops`（带 `confirm_token/caller_id/idempotency_key`）
  - 若前端未传 token，会先尝试 `todo_plan_ops` 再执行（兼容旧前端）

### 11.2 前端同步

`static/js/local_ai_panel.js` 已增加：

- 接收并缓存 `todo_patch.confirm_token`
- 调用 `/api/local-ai/todo/apply` 时自动携带 `confirm_token`

这意味着：

- 外部 AI/客户端可继续直接连接 `mcp_server.py`
- 本地网页 AI 与外部客户端复用同一套 MCP tools 与安全策略

---

## 12. Draw.io Phase 1（已落地）

已新增 Draw.io 的 MCP 工具（`mcp_server.py` 兼容入口 / `yobboy_file_server/mcp_server.py` 实现）：

- `drawio_validate_xml`
  - 校验 XML 可解析、根节点是否 `mxfile`、重复 `mxCell id`、悬空连线（source/target）
- `drawio_summarize_xml`
  - 汇总页数、节点数、边数、重复 id、悬空边等指标
- `drawio_diff_summary`
  - 对比旧图与新图的 cell 增删、页数变化、节点/边变化

### 12.1 接入现有 Draw.io 流程

`/api/local-ai/chat/stream` 的 `mode=drawio` 在生成完成后会自动：

1. 调用 `drawio_validate_xml`
2. 调用 `drawio_summarize_xml`
3. 若有 `current_xml`，再调用 `drawio_diff_summary`

并通过 SSE 发送事件：

- `mcp_call`
- `drawio_validation`
- `drawio_summary`
- `drawio_diff`

### 12.2 面板展示

Draw.io AI 侧栏新增“`MCP 调用记录`”区域（`drawio_main.html` + `drawio_ai_panel.js`），可看到：

- 工具名、成功/失败
- 耗时、trace 信息
- 结构化摘要（校验结果、图统计、差异）

---

## 13. Draw.io Phase 2（已落地）

新增工具：

- `drawio_repair_xml`
  - 自动尝试修复常见问题：HTML 实体包裹、mxfile 提取/补壳、裸 `&` 转义、缺失闭合补齐
  - 返回 `repaired_xml`、`changes`、`issues`、`valid`

### 13.1 反馈循环

`mode=drawio` 现已升级为“反馈循环”：

1. 模型生成 XML
2. `drawio_validate_xml` 校验
3. 若失败：
   - 先尝试 `drawio_repair_xml`
   - 若修复后仍失败，则把错误列表反馈给模型重试
4. 循环至通过或达上限（默认 3 轮）
5. 最终结果再做 summarize/diff 回传

前端会显示 `drawio_feedback_loop` 的重试记录，便于确认是否发生了自动修复/重试。

补充：

- 新增 `drawio_progress` 事件，反馈循环模式下会实时回传“已接收字符数 + 阶段”，避免界面长期显示 0 字符。
- `drawio_validate_xml` 增加布局质量检测：
  - `LAYOUT_OVERLAP`（节点重叠）
  - `LAYOUT_OUT_OF_BOUNDS`（节点超出常规视口范围）

