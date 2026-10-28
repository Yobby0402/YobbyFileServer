import os

from yobboy_file_server import context_orchestrator
from yobboy_file_server.todo_manager import TodoManager


def test_prepare_context_plans_before_fetching_todo_via_mcp(tmp_path):
    trace_stages = []
    calls = []

    def fake_mcp_call(tool, args, timeout):
        calls.append((tool, args, timeout))
        return (
            {"ok": True, "trace_id": "trace-todo", "data": {"text": "MCP TODO SNAPSHOT"}},
            {"trace_id": "meta-todo", "elapsed_ms": 3},
        )

    def trace(stage, *_args, **_fields):
        trace_stages.append(stage)

    result = context_orchestrator.prepare_context(
        question="1521有什么待办",
        mode="todo",
        page_context={},
        root_dir="",
        tm=object(),
        use_mcp=True,
        mcp_call=fake_mcp_call,
        local_erp_context=lambda _question, _page_context: None,
        todo_kb_root_dir=str(tmp_path),
        product_compare_kb_root_dir=str(tmp_path),
        has_product_compare=False,
        app_config={},
        trace=trace,
    )

    assert trace_stages[0] == "context_plan_ready"
    assert calls == [("todo_get_context_preview", {"level": "auto", "q": "1521有什么待办"}, 5.0)]
    assert result["context_plan"]["tools"] == ["todo_get_context_preview"]
    assert result["todo_snapshot"] == "MCP TODO SNAPSHOT"
    assert "primary=实时结构化待办数据" in result["todo_attach"]
    assert result["tool_audit"][0]["via"] == "mcp"
    assert result["tool_audit"][0]["ok"] is True


def test_iter_prepare_context_yields_progress_before_todo_fetch(tmp_path):
    calls = []

    def fake_mcp_call(tool, args, timeout):
        calls.append((tool, args, timeout))
        return (
            {"ok": True, "trace_id": "trace-todo", "data": {"text": "MCP TODO SNAPSHOT"}},
            {"elapsed_ms": 3},
        )

    events = context_orchestrator.iter_prepare_context_events(
        question="1521有什么待办",
        mode="todo",
        page_context={},
        root_dir="",
        tm=object(),
        use_mcp=True,
        mcp_call=fake_mcp_call,
        local_erp_context=lambda _question, _page_context: None,
        todo_kb_root_dir=str(tmp_path),
        product_compare_kb_root_dir=str(tmp_path),
        has_product_compare=False,
        app_config={},
    )

    assert next(events)["type"] == "context_plan_ready"
    progress_event = next(events)
    assert progress_event == {"type": "progress", "state": "processing", "message": "正在读取待办上下文"}
    assert calls == []

    mcp_event = next(events)
    assert mcp_event["type"] == "mcp_call"
    assert calls == [("todo_get_context_preview", {"level": "auto", "q": "1521有什么待办"}, 5.0)]


def test_prepare_context_falls_back_to_local_todo_snapshot(tmp_path):
    todo_path = os.path.join(tmp_path, "todos_v2.json")
    manager = TodoManager(storage_path=todo_path)
    project = manager.create_project({"name": "1521 客诉处理"})
    manager.create_task(project["id"], {"summary": "整理返工记录", "progress": 20})

    def failing_mcp_call(tool, _args, _timeout):
        assert tool == "todo_get_context_preview"
        return None, {"message": "bridge unavailable"}

    result = context_orchestrator.prepare_context(
        question="1521有什么待办",
        mode="todo",
        page_context={},
        root_dir="",
        tm=manager,
        use_mcp=True,
        mcp_call=failing_mcp_call,
        local_erp_context=lambda _question, _page_context: None,
        todo_kb_root_dir=str(tmp_path),
        product_compare_kb_root_dir=str(tmp_path),
        has_product_compare=False,
        app_config={},
    )

    assert "1521 客诉处理" in result["todo_snapshot"]
    assert "整理返工记录" in result["todo_snapshot"]
    assert [item["via"] for item in result["tool_audit"]] == ["mcp", "local"]
    assert result["tool_audit"][1]["fallback"] is True


def test_prepare_context_retrieves_knowledge_and_supplemental_todo_kb(tmp_path, monkeypatch):
    def fake_mcp_call(tool, _args, _timeout):
        assert tool == "kb_retrieve"
        return (
            {
                "ok": True,
                "trace_id": "trace-kb",
                "data": {
                    "context": "文件知识正文",
                    "hits": [{"path": "doc.md"}],
                    "name_suggestions": ["doc.md"],
                },
            },
            {"elapsed_ms": 4},
        )

    monkeypatch.setattr(
        context_orchestrator.todo_kb_store,
        "retrieve_for_query",
        lambda *_args, **_kwargs: ("待办长文本补充", [{"task": "A"}]),
    )

    result = context_orchestrator.prepare_context(
        question="根据知识库说明一下项目背景",
        mode="knowledge",
        page_context={},
        root_dir=str(tmp_path),
        tm=None,
        use_mcp=True,
        mcp_call=fake_mcp_call,
        local_erp_context=lambda _question, _page_context: None,
        todo_kb_root_dir=str(tmp_path),
        product_compare_kb_root_dir=str(tmp_path),
        has_product_compare=False,
        app_config={},
    )

    assert result["context_plan"]["tools"][:2] == ["kb_retrieve", "todo-kb.retrieve_for_query"]
    assert "### 文件知识库" in result["knowledge_attach"]
    assert "文件知识正文" in result["knowledge_attach"]
    assert "### 待办知识库" in result["knowledge_attach"]
    assert result["knowledge_meta"]["hits"] == [{"path": "doc.md"}]
    assert result["knowledge_meta"]["todo_hits"] == [{"task": "A"}]
    assert [item["source"] for item in result["tool_audit"]] == ["knowledge", "todo-kb"]
