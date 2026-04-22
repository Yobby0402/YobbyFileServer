from pathlib import Path

from yobboy_file_server import knowledge_index_db
from yobboy_file_server import todo_kb_store
from yobboy_file_server.todo_extended_manager import TodoExtendedManager
from yobboy_file_server.todo_manager import TodoManager


def _fake_embed(_cfg, texts, *, is_query=False, **_kwargs):
    vectors = []
    for text in texts:
        source = str(text or "")
        low = source.lower()
        vectors.append(
            [
                1.0 if "erp" in low else 0.0,
                1.0 if ("日报" in source or "daily" in low) else 0.0,
                1.0 if ("采购" in source or "purchase" in low) else 0.0,
                1.0 if ("会议" in source or "meeting" in low) else 0.0,
            ]
        )
    return vectors, None


def test_todo_kb_rebuild_and_search(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(knowledge_index_db, "db_path", lambda: str(tmp_path / "knowledge.sqlite3"))
    monkeypatch.setattr(todo_kb_store.knowledge_store, "_batch_embed_texts", _fake_embed)

    manager = TodoManager(storage_path=str(tmp_path / "todos_v2.json"))
    extended = TodoExtendedManager(storage_path=str(tmp_path / "todos_extended.json"))

    project = manager.create_project({"name": "ERP 改造", "phase": "开发"})
    task, _ = manager.create_task(
        project["id"],
        {
            "summary": "采购日报接入",
            "description": "需要把采购流程的日报写入知识库",
            "weekly_plan": "完成日报知识库初版",
            "task_type": "开发",
        },
    )
    manager.add_comment(project["id"], task["id"], "今天已完成采购日报索引设计")
    extended.set_project_description(project["id"], "这是 ERP 项目的总体说明")
    extended.set_meeting_note("2026-04-22", "今天讨论了 ERP 日报和周报方案")

    result = todo_kb_store.rebuild_all(str(tmp_path), manager, extended, app_config={})

    assert result["indexed_count"] >= 4
    assert result["status"]["entity_counts"]["project"] == 1
    assert result["status"]["entity_counts"]["task"] == 1
    assert result["status"]["entity_counts"]["meeting_note"] == 1

    context, hits = todo_kb_store.retrieve_for_query(str(tmp_path), "ERP 日报", top_k=3, app_config={})

    assert context
    assert hits
    assert any(hit["entity_type"] in {"task", "meeting_note", "project"} for hit in hits)


def test_todo_kb_remove_deleted_task_sources(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(knowledge_index_db, "db_path", lambda: str(tmp_path / "knowledge.sqlite3"))
    monkeypatch.setattr(todo_kb_store.knowledge_store, "_batch_embed_texts", _fake_embed)

    manager = TodoManager(storage_path=str(tmp_path / "todos_v2.json"))
    extended = TodoExtendedManager(storage_path=str(tmp_path / "todos_extended.json"))
    project = manager.create_project({"name": "ERP"})
    task, _ = manager.create_task(project["id"], {"summary": "日报模块"})
    manager.add_comment(project["id"], task["id"], "先做知识库")

    todo_kb_store.rebuild_all(str(tmp_path), manager, extended, app_config={})
    removed_task = manager.delete_task(project["id"], task["id"])
    deleted_count = todo_kb_store.remove_task(str(tmp_path), removed_task)
    entries = todo_kb_store.list_entries(str(tmp_path))

    assert deleted_count >= 1
    assert all(item["entity_type"] != "task" for item in entries)
