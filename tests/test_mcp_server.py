import os
import tempfile
from pathlib import Path

from yobboy_file_server import knowledge_ai_bridge
from yobboy_file_server import knowledge_index_db
from yobboy_file_server import knowledge_store
from yobboy_file_server.mcp_server import YFSMCPServer


def test_mcp_server_exposes_erp_context_tool():
    with tempfile.TemporaryDirectory() as tmpdir:
        todo_path = os.path.join(tmpdir, "todos_v2.json")
        erp_db_path = os.path.join(tmpdir, "erp.sqlite3")
        server = YFSMCPServer(todo_path, tmpdir, erp_db_path=erp_db_path)

        payload = server.handle_tool_call(
            "erp_get_context",
            {
                "query_text": "当前有哪些仓库",
                "page_context": {"source": "erp", "active_page": "inventory"},
            },
            "trace-test",
        )

        assert payload["ok"] is True
        assert "text" in payload["data"]
        assert "structured_data" in payload["data"]


def test_todo_list_tasks_accepts_short_project_code():
    with tempfile.TemporaryDirectory() as tmpdir:
        todo_path = os.path.join(tmpdir, "todos_v2.json")
        server = YFSMCPServer(todo_path, tmpdir)
        project = server.todo_manager.create_project({"name": "1521 客诉处理"})
        server.todo_manager.create_task(project["id"], {"summary": "整理返工记录"})

        payload = server.todo_list_tasks({"project_name": "1521"}, "trace-test")

        assert payload["ok"] is True
        assert payload["data"]["project"]["name"] == "1521 客诉处理"
        assert payload["data"]["tasks"][0]["summary"] == "整理返工记录"


def _fake_embed(_app_config, texts, **_kwargs):
    return [[float(i + 1)] * 4 for i, _text in enumerate(texts)], None


def _isolate_kb(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setattr(knowledge_store, "_store_path", lambda: str(tmp_path / "knowledge_files.json"))
    monkeypatch.setattr(knowledge_index_db, "db_path", lambda: str(tmp_path / "knowledge.sqlite3"))
    monkeypatch.setattr(knowledge_store, "_batch_embed_texts", _fake_embed)


def test_kb_list_entries_accepts_paging_and_query(tmp_path: Path, monkeypatch):
    _isolate_kb(tmp_path, monkeypatch)
    (tmp_path / "alpha.md").write_text("alpha project note", encoding="utf-8")
    (tmp_path / "beta.txt").write_text("beta project note", encoding="utf-8")
    knowledge_store.set_entry(str(tmp_path), "alpha.md")
    knowledge_store.set_entry(str(tmp_path), "beta.txt")
    server = YFSMCPServer(str(tmp_path / "todos_v2.json"), str(tmp_path))

    payload = server.handle_tool_call(
        "kb_list_entries",
        {"q": "alpha", "limit": 1, "offset": 0, "problem_first": True},
        "trace-test",
    )

    assert payload["ok"] is True
    assert payload["data"]["total"] == 1
    assert payload["data"]["items"][0]["path"] == "alpha.md"
    assert payload["data"]["limit"] == 1


def test_kb_preview_entry_returns_file_text(tmp_path: Path, monkeypatch):
    _isolate_kb(tmp_path, monkeypatch)
    (tmp_path / "note.md").write_text("hello knowledge", encoding="utf-8")
    server = YFSMCPServer(str(tmp_path / "todos_v2.json"), str(tmp_path))

    payload = server.handle_tool_call(
        "kb_preview_entry",
        {"path": "note.md", "max_chars": 5},
        "trace-test",
    )

    assert payload["ok"] is True
    assert payload["data"]["item"]["path"] == "note.md"
    assert payload["data"]["item"]["text"] == "hello"
    assert payload["data"]["item"]["truncated"] is True


def test_kb_set_entry_can_queue_async(tmp_path: Path, monkeypatch):
    _isolate_kb(tmp_path, monkeypatch)
    (tmp_path / "queued.md").write_text("queued knowledge", encoding="utf-8")
    server = YFSMCPServer(str(tmp_path / "todos_v2.json"), str(tmp_path))

    payload = server.handle_tool_call(
        "kb_set_entry",
        {"path": "queued.md", "async": True, "tags": ["x"], "note": "n"},
        "trace-test",
    )

    assert payload["ok"] is True
    assert payload["data"]["queued"] is True
    assert payload["data"]["entry"]["path"] == "queued.md"
    assert payload["data"]["job"]


def test_kb_rebuild_entry_missing_returns_validation_error(tmp_path: Path, monkeypatch):
    _isolate_kb(tmp_path, monkeypatch)
    (tmp_path / "missing.md").write_text("not registered", encoding="utf-8")
    server = YFSMCPServer(str(tmp_path / "todos_v2.json"), str(tmp_path))

    payload = server.handle_tool_call(
        "kb_rebuild_entry",
        {"path": "missing.md", "async": True},
        "trace-test",
    )

    assert payload["ok"] is False
    assert payload["error"]["code"] == "VALIDATION_ERROR"


def test_knowledge_ai_bridge_wraps_set_entry_result(tmp_path: Path, monkeypatch):
    _isolate_kb(tmp_path, monkeypatch)
    (tmp_path / "bridge.md").write_text("bridge knowledge", encoding="utf-8")

    payload = knowledge_ai_bridge.set_entry(str(tmp_path), "bridge.md", tags=["bridge"], note="via bridge")

    assert payload["queued"] is False
    assert payload["entry"]["path"] == "bridge.md"
    assert payload["entry"]["tags"] == ["bridge"]


def test_kb_management_tools_cover_scan_jobs_and_snippets(tmp_path: Path, monkeypatch):
    _isolate_kb(tmp_path, monkeypatch)
    (tmp_path / "doc.md").write_text("doc knowledge", encoding="utf-8")
    server = YFSMCPServer(str(tmp_path / "todos_v2.json"), str(tmp_path))

    scan_payload = server.handle_tool_call("kb_scan_files", {"async": False}, "trace-test")
    assert scan_payload["ok"] is True
    assert scan_payload["data"]["queued"] is False
    assert scan_payload["data"]["result"]["matched_files"] >= 1

    bulk_payload = server.handle_tool_call(
        "kb_bulk_index",
        {"paths": ["doc.md"]},
        "trace-test",
    )
    assert bulk_payload["ok"] is True
    assert bulk_payload["data"]["queued_count"] == 1

    jobs_payload = server.handle_tool_call("kb_list_jobs", {"limit": 5}, "trace-test")
    assert jobs_payload["ok"] is True
    assert "items" in jobs_payload["data"]

    add_payload = server.handle_tool_call(
        "kb_add_snippet",
        {"text": "snippet knowledge", "title": "Snippet"},
        "trace-test",
    )
    assert add_payload["ok"] is True
    snippet_id = add_payload["data"]["item"]["id"]

    list_payload = server.handle_tool_call("kb_list_snippets", {}, "trace-test")
    assert list_payload["ok"] is True
    assert any(item["id"] == snippet_id for item in list_payload["data"]["items"])

    update_payload = server.handle_tool_call(
        "kb_update_snippet",
        {"id": snippet_id, "text": "updated snippet", "title": "Updated"},
        "trace-test",
    )
    assert update_payload["ok"] is True
    assert update_payload["data"]["item"]["title"] == "Updated"

    remove_payload = server.handle_tool_call("kb_remove_snippet", {"id": snippet_id}, "trace-test")
    assert remove_payload["ok"] is True
    assert remove_payload["data"]["removed"] is True
