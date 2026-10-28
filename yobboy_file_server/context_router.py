from __future__ import annotations

from typing import Any, Dict, List, Optional

from . import todo_ai_bridge


_ERP_KEYWORDS = (
    "erp",
    "物料",
    "库存",
    "仓库",
    "bom",
    "工单",
    "单据",
    "批次",
    "追踪",
    "追溯",
    "流向",
    "领料",
    "退料",
    "完工",
    "安全库存",
    "预警",
)

_KNOWLEDGE_KEYWORDS = (
    "知识库",
    "文档",
    "根据文档",
    "根据知识库",
    "资料里",
    "README",
    ".md",
    ".txt",
)


def is_erp_page_context(page_context: Optional[Dict[str, Any]]) -> bool:
    return str((page_context or {}).get("source") or "").strip().lower() == "erp"


def message_suggests_erp_context(message: str) -> bool:
    m = str(message or "").strip().lower()
    if not m:
        return False
    return any(keyword in m for keyword in _ERP_KEYWORDS)


def message_suggests_knowledge_context(message: str) -> bool:
    m = str(message or "").strip()
    if not m:
        return False
    low = m.lower()
    return any(keyword.lower() in low for keyword in _KNOWLEDGE_KEYWORDS)


def build_context_plan(
    message: str,
    *,
    mode: str = "general",
    page_context: Optional[Dict[str, Any]] = None,
    has_root_dir: bool = False,
    has_todo_manager: bool = False,
) -> Dict[str, Any]:
    mode_norm = (mode or "general").strip().lower() or "general"
    todo_strategy = todo_ai_bridge.build_todo_context_strategy(message or "", mode=mode_norm)
    needs_todo = bool(
        has_todo_manager
        and (
            mode_norm == "todo"
            or (mode_norm in ("general", "knowledge") and todo_strategy.get("needs_todo"))
        )
    )
    needs_kb = bool(
        has_root_dir
        and (
            mode_norm == "knowledge"
            or (mode_norm == "general" and message_suggests_knowledge_context(message))
        )
    )
    needs_erp = bool(
        mode_norm == "erp"
        or (
            mode_norm in ("general", "knowledge")
            and (is_erp_page_context(page_context) or message_suggests_erp_context(message))
        )
    )

    tools: List[str] = []
    if needs_todo:
        tools.append("todo_get_context_preview")
        if todo_strategy.get("use_semantic_kb"):
            tools.append("todo-kb.retrieve_for_query")
    if needs_erp:
        tools.append("erp_get_context")
    if needs_kb:
        tools.append("kb_retrieve")
        if mode_norm == "knowledge":
            tools.extend(["todo-kb.retrieve_for_query", "product-compare-kb.retrieve_for_query"])

    return {
        "mode": mode_norm,
        "needs_todo": needs_todo,
        "needs_kb": needs_kb,
        "needs_erp": needs_erp,
        "todo_strategy": todo_strategy,
        "tools": tools,
    }
