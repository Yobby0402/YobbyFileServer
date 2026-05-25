from __future__ import annotations

import yobboy_file_server.game_hub as game_hub_module
from yobboy_file_server.game_hub import GameHubStore


def test_adjust_total_score_records_positive_delta_and_target(tmp_path, monkeypatch):
    monkeypatch.setattr(game_hub_module, "games_db_path", lambda: str(tmp_path / "game_hub.sqlite3"))
    store = GameHubStore()
    store.record_score("player-1", "seed", 1200, mode="bootstrap")

    result = store.adjust_total_score(
        "player-1",
        3500,
        note="bug修复补分",
        operator="desktop-admin",
    )

    assert result["game_id"] == "admin-adjustment"
    assert result["score"] == 2300
    assert result["mode"] == "manual-adjustment"
    assert result["meta"]["previous_total_score"] == 1200
    assert result["meta"]["target_total_score"] == 3500
    assert result["meta"]["score_delta"] == 2300
    assert result["meta"]["note"] == "bug修复补分"

    summary = store.total_score_summary("player-1")
    assert summary["total_score"] == 3500


def test_adjust_total_score_records_negative_delta_and_allows_deduction(tmp_path, monkeypatch):
    monkeypatch.setattr(game_hub_module, "games_db_path", lambda: str(tmp_path / "game_hub.sqlite3"))
    store = GameHubStore()
    store.record_score("player-1", "seed", 5000, mode="bootstrap")

    result = store.adjust_total_score(
        "player-1",
        1800,
        note="活动回收",
        operator="desktop-admin",
    )

    assert result["game_id"] == "admin-adjustment"
    assert result["score"] == -3200
    assert result["mode"] == "manual-adjustment"
    assert result["meta"]["previous_total_score"] == 5000
    assert result["meta"]["target_total_score"] == 1800
    assert result["meta"]["score_delta"] == -3200

    summary = store.total_score_summary("player-1")
    assert summary["total_score"] == 1800


def test_adjust_total_score_returns_noop_when_target_matches_current_total(tmp_path, monkeypatch):
    monkeypatch.setattr(game_hub_module, "games_db_path", lambda: str(tmp_path / "game_hub.sqlite3"))
    store = GameHubStore()
    store.record_score("player-1", "seed", 2600, mode="bootstrap")

    result = store.adjust_total_score(
        "player-1",
        2600,
        note="无需处理",
        operator="desktop-admin",
    )

    assert result["noop"] is True
    assert result["score"] == 0
    assert result["target_total_score"] == 2600

    recent = store.recent_scores("player-1", limit=10)
    assert len(recent) == 1
