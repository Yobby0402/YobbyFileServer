from pathlib import Path

from yobboy_file_server import knowledge_index_db
from yobboy_file_server import todo_kb_store
from yobboy_file_server import todo_report_builder
from yobboy_file_server.todo_extended_manager import TodoExtendedManager
from yobboy_file_server.todo_manager import TodoManager


def _fake_embed(_cfg, texts, *, is_query=False, **_kwargs):
    vectors = []
    for text in texts:
        source = str(text or "")
        vectors.append(
            [
                1.0 if "日报" in source else 0.0,
                1.0 if "周报" in source else 0.0,
                1.0 if "ERP" in source or "erp" in source.lower() else 0.0,
            ]
        )
    return vectors, None


def test_daily_and_weekly_report_generation_and_persistence(tmp_path: Path):
    manager = TodoManager(storage_path=str(tmp_path / "todos_v2.json"))
    extended = TodoExtendedManager(storage_path=str(tmp_path / "todos_extended.json"))
    project = manager.create_project({"name": "ERP 项目"})
    task, _ = manager.create_task(
        project["id"],
        {
            "summary": "日报模块",
            "description": "整理今日 ERP 开发进展",
            "weekly_plan": "继续完善周报实体",
            "progress": 60,
        },
    )
    manager.add_comment(project["id"], task["id"], "完成日报生成逻辑")
    report_date = task["created_at"][:10]
    extended.set_meeting_note(report_date, "讨论日报与周报保存方式")

    daily = todo_report_builder.build_daily_report(manager, extended, date_str=report_date)
    weekly = todo_report_builder.build_weekly_report(manager, extended, ref_date=report_date)

    saved_daily = extended.set_report("daily", daily.key, daily.to_record())
    saved_weekly = extended.set_report("weekly", weekly.key, weekly.to_record())
    reloaded = TodoExtendedManager(storage_path=str(tmp_path / "todos_extended.json"))

    assert daily.key == report_date
    assert "日报" in saved_daily["content"]
    assert "完成日报生成逻辑" in saved_daily["content"]
    assert "周报" in saved_weekly["content"]
    assert reloaded.get_report("daily", daily.key)["content"] == saved_daily["content"]
    assert reloaded.get_report("weekly", weekly.key)["content"] == saved_weekly["content"]


def test_todo_kb_indexes_saved_reports(tmp_path: Path, monkeypatch):
    monkeypatch.setattr(knowledge_index_db, "db_path", lambda: str(tmp_path / "knowledge.sqlite3"))
    monkeypatch.setattr(todo_kb_store.knowledge_store, "_batch_embed_texts", _fake_embed)

    manager = TodoManager(storage_path=str(tmp_path / "todos_v2.json"))
    extended = TodoExtendedManager(storage_path=str(tmp_path / "todos_extended.json"))
    project = manager.create_project({"name": "ERP"})
    task, _ = manager.create_task(project["id"], {"summary": "周报知识库", "weekly_plan": "同步到 KB"})
    report_date = task["created_at"][:10]
    daily = todo_report_builder.build_daily_report(manager, extended, date_str=report_date)
    weekly = todo_report_builder.build_weekly_report(manager, extended, ref_date=report_date)
    extended.set_report("daily", daily.key, daily.to_record())
    extended.set_report("weekly", weekly.key, weekly.to_record())

    result = todo_kb_store.rebuild_all(str(tmp_path), manager, extended, app_config={})
    entries = todo_kb_store.list_entries(str(tmp_path))

    assert result["status"]["entity_counts"]["daily_report"] == 1
    assert result["status"]["entity_counts"]["weekly_report"] == 1
    assert any(item["entity_type"] == "daily_report" for item in entries)
    assert any(item["entity_type"] == "weekly_report" for item in entries)
