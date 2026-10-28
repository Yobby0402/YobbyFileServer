import os
import time

from yobboy_file_server import local_ai_engine, local_ai_skills


def test_probe_connection_cached_reuses_recent_success(monkeypatch):
    calls = {"count": 0}

    def fake_probe(app_config, timeout=5.0):
        calls["count"] += 1
        return {
            "success": True,
            "api_root": "http://127.0.0.1:1234/v1",
            "models": ["demo"],
            "model": "demo",
        }

    local_ai_engine.unload()
    monkeypatch.setattr(local_ai_engine, "probe_connection", fake_probe)
    cfg = {"LOCAL_AI_API_BASE_URL": "http://127.0.0.1:1234/v1", "LOCAL_AI_API_MODEL": ""}

    first = local_ai_engine.probe_connection_cached(cfg, success_ttl=30.0)
    second = local_ai_engine.probe_connection_cached(cfg, success_ttl=30.0)

    assert first["success"] is True
    assert second["model"] == "demo"
    assert calls["count"] == 1


def test_load_skills_text_cache_refreshes_when_file_changes(tmp_path):
    skill_path = tmp_path / "server-assistant.md"
    skill_path.write_text("第一版", encoding="utf-8")

    first = local_ai_skills.load_skills_text(str(tmp_path), max_total_chars=1000)
    second = local_ai_skills.load_skills_text(str(tmp_path), max_total_chars=1000)

    assert first == second
    assert "第一版" in first

    time.sleep(0.01)
    skill_path.write_text("第二版", encoding="utf-8")
    os.utime(skill_path, None)

    refreshed = local_ai_skills.load_skills_text(str(tmp_path), max_total_chars=1000)
    assert "第二版" in refreshed
