from __future__ import annotations

import json
import time
from typing import Any, Callable, Dict, Iterator, List, Optional, Tuple

from . import context_router
from . import knowledge_store
from . import product_compare_kb_store
from . import todo_ai_bridge
from . import todo_kb_store

MCPCallFn = Callable[[str, Dict[str, Any], float], Tuple[Optional[Dict[str, Any]], Dict[str, Any]]]
ProgressFn = Callable[[str, str], None]
TraceFn = Callable[..., None]


def kb_section(title: str, text: str) -> str:
    return f"### {title}\n\n{text.strip()}"


def record_tool_audit(
    audit: List[Dict[str, Any]],
    *,
    source: str,
    tool: str,
    ok: bool,
    via: str,
    fallback: bool = False,
    hit_count: Optional[int] = None,
    trace_id: str = "",
    message: str = "",
) -> None:
    item: Dict[str, Any] = {
        "source": source,
        "tool": tool,
        "ok": bool(ok),
        "via": via,
        "fallback": bool(fallback),
    }
    if hit_count is not None:
        item["hit_count"] = int(hit_count)
    if trace_id:
        item["trace_id"] = trace_id
    if message:
        item["message"] = str(message)[:200]
    audit.append(item)


def tool_audit_prompt_block(audit: List[Dict[str, Any]], plan: Dict[str, Any]) -> str:
    if not audit and not plan:
        return ""
    lines = [
        "[数据调用审计]",
        "回答必须以已调用的数据源为依据；如果某数据源未命中、MCP 失败或走了本地回退，请明确说明不确定性，不要补编。",
    ]
    tools = plan.get("tools") if isinstance(plan, dict) else None
    if isinstance(tools, list) and tools:
        lines.append("计划调用: " + ", ".join(str(x) for x in tools[:12]))
    for item in audit[:12]:
        status = "ok" if item.get("ok") else "failed"
        parts = [
            f"{item.get('source')}.{item.get('tool')}",
            status,
            f"via={item.get('via')}",
        ]
        if item.get("fallback"):
            parts.append("fallback=true")
        if item.get("hit_count") is not None:
            parts.append(f"hits={item.get('hit_count')}")
        if item.get("trace_id"):
            parts.append(f"trace={item.get('trace_id')}")
        if item.get("message"):
            parts.append(f"note={item.get('message')}")
        lines.append("- " + " ".join(parts))
    return "\n".join(lines) + "\n"


def _trace(trace: Optional[Callable[..., None]], stage: str, started_at: Optional[float] = None, **fields: Any) -> None:
    if trace is not None:
        trace(stage, started_at, **fields)


def _progress(progress: Optional[Callable[[str, str], None]], state: str, message: str) -> None:
    if progress is not None:
        progress(state, message)


def _progress_event(state: str, message: str) -> Dict[str, Any]:
    return {"type": "progress", "state": state, "message": message}


def _mcp_audit_events(audit: List[Dict[str, Any]], start_index: int) -> Iterator[Dict[str, Any]]:
    for item in audit[start_index:]:
        if str(item.get("via") or "") == "mcp":
            yield {"type": "mcp_call", "item": item}


def _empty_prepare_result(plan: Dict[str, Any], audit: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "context_plan": plan,
        "tool_audit": audit,
        "todo_attach": "",
        "erp_attach": "",
        "knowledge_attach": "",
        "knowledge_meta": None,
        "todo_task_card": None,
        "todo_snapshot": "",
        "todo_semantic_extra": "",
        "todo_overview_extra": "",
    }


def _retrieve_todo_context(
    *,
    tm: Any,
    question: str,
    plan: Dict[str, Any],
    mode: str,
    use_mcp: bool,
    mcp_call: MCPCallFn,
    todo_kb_root_dir: str,
    app_config: Dict[str, Any],
    audit: List[Dict[str, Any]],
    progress: Optional[Callable[[str, str], None]],
    trace: Optional[Callable[..., None]],
) -> Dict[str, Any]:
    todo_strategy = plan.get("todo_strategy") if isinstance(plan.get("todo_strategy"), dict) else {}
    started = time.perf_counter()
    _progress(progress, "processing", "正在读取待办上下文")
    todo_text = ""
    task_card = None
    if use_mcp:
        mcp_started = time.perf_counter()
        mcp_ctx, mcp_meta = mcp_call(
            "todo_get_context_preview",
            {"level": "auto", "q": question},
            5.0,
        )
        _trace(
            trace,
            "todo_mcp_preview",
            mcp_started,
            ok=bool(mcp_ctx and mcp_ctx.get("ok")),
            mcp_elapsed_ms=mcp_meta.get("elapsed_ms"),
        )
        record_tool_audit(
            audit,
            source="todo",
            tool="todo_get_context_preview",
            ok=bool(mcp_ctx and mcp_ctx.get("ok")),
            via="mcp",
            trace_id=str((mcp_ctx or {}).get("trace_id") or mcp_meta.get("trace_id") or ""),
            message=str(mcp_meta.get("message") or ""),
        )
        if mcp_ctx and mcp_ctx.get("ok"):
            todo_text = str((mcp_ctx.get("data") or {}).get("text") or "")
    if not todo_text:
        local_started = time.perf_counter()
        if mode == "todo":
            todo_text, meta = todo_ai_bridge.build_adaptive_todo_context_and_meta(tm, question)
            if isinstance(meta, dict):
                task_card = meta.get("task_card")
        else:
            todo_text = todo_ai_bridge.build_adaptive_todo_context_for_llm(tm, question)
        _trace(trace, "todo_local_context_build", local_started, ctx_chars=len(todo_text or ""))
        record_tool_audit(
            audit,
            source="todo",
            tool="build_adaptive_todo_context",
            ok=bool(todo_text),
            via="local",
            fallback=True,
        )

    attach = (
        todo_ai_bridge.TODO_LLM_SCHEMA_GUIDE
        + "\n\n[待办数据源策略] primary=实时结构化待办数据；todo-kb 只用于补充长描述/评论/历史的语义命中，不用于决定项目/任务身份或写入目标。"
        + "\n\n[当前待办快照 - 按问题选层级；仅用于待办相关回答，勿编造]\n"
        + todo_text
    )
    semantic_extra = ""
    if todo_strategy.get("use_semantic_kb"):
        semantic_started = time.perf_counter()
        todo_kb_ctx, todo_kb_hits = todo_kb_store.retrieve_for_query(
            todo_kb_root_dir,
            question,
            top_k=4,
            app_config=app_config,
        )
        _trace(
            trace,
            "todo_semantic_kb",
            semantic_started,
            ctx_chars=len(todo_kb_ctx or ""),
            hit_count=len(todo_kb_hits or []),
        )
        record_tool_audit(
            audit,
            source="todo-kb",
            tool="retrieve_for_query",
            ok=bool(todo_kb_ctx.strip() or todo_kb_hits),
            via="local",
            hit_count=len(todo_kb_hits or []),
        )
        if todo_kb_ctx.strip():
            semantic_extra = "\n\n[待办语义补充：仅供长文本佐证]\n" + todo_kb_ctx.strip()
            attach += semantic_extra
    _trace(
        trace,
        "todo_context_ready",
        started,
        attach_chars=len(attach),
        strategy=todo_strategy,
    )
    _progress(progress, "processing", "待办上下文已就绪")
    return {"attach": attach, "text": todo_text, "semantic_extra": semantic_extra, "task_card": task_card}


def _retrieve_erp_context(
    *,
    question: str,
    page_context: Dict[str, Any],
    use_mcp: bool,
    mcp_call: MCPCallFn,
    local_erp_context: Callable[[str, Dict[str, Any]], Optional[Dict[str, Any]]],
    audit: List[Dict[str, Any]],
    progress: Optional[Callable[[str, str], None]],
    trace: Optional[Callable[..., None]],
) -> Dict[str, Any]:
    started = time.perf_counter()
    _progress(progress, "processing", "正在读取 ERP 上下文")
    data: Optional[Dict[str, Any]] = None
    if use_mcp:
        mcp_started = time.perf_counter()
        mcp_erp, mcp_meta = mcp_call(
            "erp_get_context",
            {"query_text": question, "page_context": page_context},
            5.0,
        )
        _trace(
            trace,
            "erp_mcp_context",
            mcp_started,
            ok=bool(mcp_erp and mcp_erp.get("ok")),
            mcp_elapsed_ms=mcp_meta.get("elapsed_ms"),
        )
        record_tool_audit(
            audit,
            source="erp",
            tool="erp_get_context",
            ok=bool(mcp_erp and mcp_erp.get("ok")),
            via="mcp",
            trace_id=str((mcp_erp or {}).get("trace_id") or mcp_meta.get("trace_id") or ""),
            message=str(mcp_meta.get("message") or ""),
        )
        if mcp_erp and mcp_erp.get("ok"):
            candidate = mcp_erp.get("data") or {}
            data = candidate if isinstance(candidate, dict) else None
    if not data:
        local_started = time.perf_counter()
        data = local_erp_context(question, page_context)
        has_context = bool(data and str(data.get("text") or "").strip())
        _trace(trace, "erp_local_context_build", local_started, has_context=has_context)
        record_tool_audit(
            audit,
            source="erp",
            tool="build_ai_context",
            ok=has_context,
            via="local",
            fallback=True,
        )
    text = str((data or {}).get("text") or "").strip()
    attach = "\n\n--- ERP 本地数据快照 ---\n\n" + text if text else ""
    if attach:
        _trace(trace, "erp_context_ready", started, attach_chars=len(attach))
        _progress(progress, "processing", "ERP 上下文已就绪")
    return {"attach": attach, "data": data}


def _retrieve_knowledge_context(
    *,
    question: str,
    root_dir: str,
    mode: str,
    use_mcp: bool,
    mcp_call: MCPCallFn,
    todo_kb_root_dir: str,
    product_compare_kb_root_dir: str,
    has_product_compare: bool,
    app_config: Dict[str, Any],
    audit: List[Dict[str, Any]],
    progress: Optional[Callable[[str, str], None]],
    trace: Optional[Callable[..., None]],
) -> Dict[str, Any]:
    started = time.perf_counter()
    _progress(progress, "processing", "正在检索知识库")
    ctx = ""
    hits: List[Dict[str, Any]] = []
    names: List[str] = []
    todo_hits: List[Dict[str, Any]] = []
    product_compare_hits: List[Dict[str, Any]] = []
    sections: List[str] = []

    if use_mcp:
        mcp_started = time.perf_counter()
        mcp_kb, mcp_meta = mcp_call(
            "kb_retrieve",
            {"query": question, "top_k": 6, "max_file_bytes": 200000},
            6.0,
        )
        data = (mcp_kb or {}).get("data") or {}
        _trace(
            trace,
            "knowledge_mcp_retrieve",
            mcp_started,
            ok=bool(mcp_kb and mcp_kb.get("ok")),
            mcp_elapsed_ms=mcp_meta.get("elapsed_ms"),
        )
        record_tool_audit(
            audit,
            source="knowledge",
            tool="kb_retrieve",
            ok=bool(mcp_kb and mcp_kb.get("ok")),
            via="mcp",
            hit_count=len(data.get("hits") or []) if isinstance(data, dict) else 0,
            trace_id=str((mcp_kb or {}).get("trace_id") or mcp_meta.get("trace_id") or ""),
            message=str(mcp_meta.get("message") or ""),
        )
        if mcp_kb and mcp_kb.get("ok") and isinstance(data, dict):
            ctx = str(data.get("context") or "")
            hits = list(data.get("hits") or [])
            names = list(data.get("name_suggestions") or [])
    if not ctx and not hits and not names:
        local_started = time.perf_counter()
        ctx, hits, names = knowledge_store.retrieve_for_query(
            root_dir,
            question,
            app_config=app_config,
        )
        _trace(
            trace,
            "knowledge_local_retrieve",
            local_started,
            ctx_chars=len(ctx or ""),
            hit_count=len(hits or []),
            name_count=len(names or []),
        )
        record_tool_audit(
            audit,
            source="knowledge",
            tool="retrieve_for_query",
            ok=bool(ctx or hits or names),
            via="local",
            fallback=True,
            hit_count=len(hits or []),
        )
    if ctx.strip():
        sections.append(kb_section("文件知识库", ctx.strip()))

    if mode == "knowledge":
        todo_started = time.perf_counter()
        todo_ctx, todo_hits = todo_kb_store.retrieve_for_query(
            todo_kb_root_dir,
            question,
            top_k=5,
            app_config=app_config,
        )
        _trace(
            trace,
            "knowledge_mode_todo_retrieve",
            todo_started,
            ctx_chars=len(todo_ctx or ""),
            hit_count=len(todo_hits or []),
        )
        record_tool_audit(
            audit,
            source="todo-kb",
            tool="retrieve_for_query",
            ok=bool(todo_ctx.strip() or todo_hits),
            via="local",
            hit_count=len(todo_hits or []),
        )
        if todo_ctx.strip():
            sections.append(kb_section("待办知识库", todo_ctx.strip()))

        if has_product_compare:
            product_started = time.perf_counter()
            compare_ctx, product_compare_hits = product_compare_kb_store.retrieve_for_query(
                product_compare_kb_root_dir,
                question,
                top_k=5,
                app_config=app_config,
            )
            _trace(
                trace,
                "knowledge_mode_product_retrieve",
                product_started,
                ctx_chars=len(compare_ctx or ""),
                hit_count=len(product_compare_hits or []),
            )
            record_tool_audit(
                audit,
                source="product-compare-kb",
                tool="retrieve_for_query",
                ok=bool(compare_ctx.strip() or product_compare_hits),
                via="local",
                hit_count=len(product_compare_hits or []),
            )
            if compare_ctx.strip():
                sections.append(kb_section("产品对比知识库", compare_ctx.strip()))

    if sections:
        attach = "\n\n--- 知识库摘录 ---\n\n" + "\n\n".join(sections)
    else:
        attach = "\n\n--- 知识库摘录 ---\n\n(未命中正文；请确认已把目标 .md/.txt 加入知识库，或换更精确关键词。)"
    meta = {
        "hits": hits,
        "name_suggestions": names,
        "todo_hits": todo_hits,
        "product_compare_hits": product_compare_hits,
    }
    _trace(trace, "knowledge_context_ready", started, attach_chars=len(attach), section_count=len(sections))
    _progress(progress, "processing", "知识库上下文已就绪")
    return {"attach": attach, "meta": meta}


def _todo_overview_extra(tm: Any, question: str) -> str:
    if not question or not any(
        k in question
        for k in (
            "结构化",
            "概览表",
            "完整列表",
            "JSON",
            "所有任务id",
            "全部任务id",
            "描述",
            "详情",
            "评论",
            "评论历史",
            "更新历史",
            "变更历史",
            "属性",
            "字段",
        )
    ):
        return ""
    ov = todo_ai_bridge.build_todo_overview_dict(
        tm,
        limit_per_project=40,
        redact_ids=True,
        include_description=True,
        include_comments=True,
        include_history=True,
    )
    jtxt = json.dumps(ov, ensure_ascii=False)
    if len(jtxt) <= 8000:
        return "\n\n[以下为结构化摘要 JSON，可与上文快照对照]\n" + jtxt
    return ""


def iter_prepare_context_events(
    *,
    question: str,
    mode: str,
    page_context: Dict[str, Any],
    root_dir: str,
    tm: Any,
    use_mcp: bool,
    mcp_call: MCPCallFn,
    local_erp_context: Callable[[str, Dict[str, Any]], Optional[Dict[str, Any]]],
    todo_kb_root_dir: str,
    product_compare_kb_root_dir: str,
    has_product_compare: bool,
    app_config: Dict[str, Any],
    trace: Optional[Callable[..., None]] = None,
) -> Iterator[Dict[str, Any]]:
    plan = context_router.build_context_plan(
        question,
        mode=mode,
        page_context=page_context,
        has_root_dir=bool(root_dir),
        has_todo_manager=bool(tm),
    )
    audit: List[Dict[str, Any]] = []
    result: Dict[str, Any] = _empty_prepare_result(plan, audit)
    _trace(trace, "context_plan_ready", None, plan=plan)
    yield {"type": "context_plan_ready", "plan": plan}

    if plan.get("needs_todo"):
        yield _progress_event("processing", "正在读取待办上下文")
        todo_started = len(audit)
        todo_data = _retrieve_todo_context(
            tm=tm,
            question=question,
            plan=plan,
            mode=mode,
            use_mcp=use_mcp,
            mcp_call=mcp_call,
            todo_kb_root_dir=todo_kb_root_dir,
            app_config=app_config,
            audit=audit,
            progress=None,
            trace=trace,
        )
        result["todo_attach"] = todo_data.get("attach") or ""
        result["todo_task_card"] = todo_data.get("task_card")
        result["todo_snapshot"] = todo_data.get("text") or ""
        result["todo_semantic_extra"] = todo_data.get("semantic_extra") or ""
        if mode == "todo":
            result["todo_overview_extra"] = _todo_overview_extra(tm, question)
        for event in _mcp_audit_events(audit, todo_started):
            yield event
        if result["todo_task_card"] is not None:
            yield {"type": "todo_task_card", "item": result["todo_task_card"]}
        yield _progress_event("processing", "待办上下文已就绪")

    if plan.get("needs_erp"):
        yield _progress_event("processing", "正在读取 ERP 上下文")
        erp_started = len(audit)
        erp_data = _retrieve_erp_context(
            question=question,
            page_context=page_context,
            use_mcp=use_mcp,
            mcp_call=mcp_call,
            local_erp_context=local_erp_context,
            audit=audit,
            progress=None,
            trace=trace,
        )
        result["erp_attach"] = erp_data.get("attach") or ""
        for event in _mcp_audit_events(audit, erp_started):
            yield event
        if result["erp_attach"]:
            yield _progress_event("processing", "ERP 上下文已就绪")

    if plan.get("needs_kb"):
        yield _progress_event("processing", "正在检索知识库")
        kb_started = len(audit)
        kb_data = _retrieve_knowledge_context(
            question=question,
            root_dir=root_dir,
            mode=mode,
            use_mcp=use_mcp,
            mcp_call=mcp_call,
            todo_kb_root_dir=todo_kb_root_dir,
            product_compare_kb_root_dir=product_compare_kb_root_dir,
            has_product_compare=has_product_compare,
            app_config=app_config,
            audit=audit,
            progress=None,
            trace=trace,
        )
        result["knowledge_attach"] = kb_data.get("attach") or ""
        result["knowledge_meta"] = kb_data.get("meta")
        for event in _mcp_audit_events(audit, kb_started):
            yield event
        if result["knowledge_meta"] is not None:
            yield {"type": "knowledge_meta", "item": result["knowledge_meta"]}
        yield _progress_event("processing", "知识库上下文已就绪")

    yield {"type": "result", "context": result}


def prepare_context(
    *,
    question: str,
    mode: str,
    page_context: Dict[str, Any],
    root_dir: str,
    tm: Any,
    use_mcp: bool,
    mcp_call: MCPCallFn,
    local_erp_context: Callable[[str, Dict[str, Any]], Optional[Dict[str, Any]]],
    todo_kb_root_dir: str,
    product_compare_kb_root_dir: str,
    has_product_compare: bool,
    app_config: Dict[str, Any],
    progress: Optional[Callable[[str, str], None]] = None,
    trace: Optional[Callable[..., None]] = None,
) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for event in iter_prepare_context_events(
        question=question,
        mode=mode,
        page_context=page_context,
        root_dir=root_dir,
        tm=tm,
        use_mcp=use_mcp,
        mcp_call=mcp_call,
        local_erp_context=local_erp_context,
        todo_kb_root_dir=todo_kb_root_dir,
        product_compare_kb_root_dir=product_compare_kb_root_dir,
        has_product_compare=has_product_compare,
        app_config=app_config,
        trace=trace,
    ):
        if event.get("type") == "progress":
            _progress(progress, str(event.get("state") or ""), str(event.get("message") or ""))
        elif event.get("type") == "result":
            candidate = event.get("context")
            if isinstance(candidate, dict):
                result = candidate
    return result
