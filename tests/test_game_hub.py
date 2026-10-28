from __future__ import annotations

import sqlite3

import pytest

import yobboy_file_server.game_hub as game_hub_module
from yobboy_file_server.game_hub import GameHubStore


def test_sudoku_unique_score_claim_blocks_duplicate_award(tmp_path, monkeypatch):
    monkeypatch.setattr(game_hub_module, "games_db_path", lambda: str(tmp_path / "game_hub.sqlite3"))
    store = GameHubStore()

    first = store.record_score(
        "player-1",
        "sudoku",
        1200,
        mode="classic-medium",
        session_key="sdk-a",
        meta={"puzzle_id": "classic-medium-01"},
        unique_key="puzzle:classic-medium-01",
    )
    second = store.record_score(
        "player-1",
        "sudoku",
        9999,
        mode="classic-medium",
        session_key="sdk-b",
        meta={"puzzle_id": "classic-medium-01"},
        unique_key="puzzle:classic-medium-01",
    )

    assert first["duplicate"] is False
    assert second["duplicate"] is True
    assert second["id"] == first["id"]
    assert second["score"] == first["score"]

    recent = store.recent_scores("player-1", limit=10)
    assert len(recent) == 1
    assert recent[0]["score"] == 1200
    assert recent[0]["meta"]["puzzle_id"] == "classic-medium-01"


def test_sudoku_unique_score_claim_still_allows_different_puzzles(tmp_path, monkeypatch):
    monkeypatch.setattr(game_hub_module, "games_db_path", lambda: str(tmp_path / "game_hub.sqlite3"))
    store = GameHubStore()

    first = store.record_score(
        "player-1",
        "sudoku",
        1200,
        mode="classic-medium",
        session_key="sdk-a",
        meta={"puzzle_id": "classic-medium-01"},
        unique_key="puzzle:classic-medium-01",
    )
    second = store.record_score(
        "player-1",
        "sudoku",
        1800,
        mode="classic-medium",
        session_key="sdk-b",
        meta={"puzzle_id": "classic-medium-02"},
        unique_key="puzzle:classic-medium-02",
    )

    assert first["duplicate"] is False
    assert second["duplicate"] is False

    recent = store.recent_scores("player-1", limit=10)
    assert len(recent) == 2
    assert {entry["meta"]["puzzle_id"] for entry in recent} == {"classic-medium-01", "classic-medium-02"}


def test_grant_score_compensation_records_admin_entry_and_updates_total(tmp_path, monkeypatch):
    monkeypatch.setattr(game_hub_module, "games_db_path", lambda: str(tmp_path / "game_hub.sqlite3"))
    store = GameHubStore()

    result = store.grant_score_compensation(
        "player-1",
        2500,
        note="五一活动补偿",
        operator="desktop-admin",
    )

    assert result["game_id"] == "admin-compensation"
    assert result["score"] == 2500
    assert result["mode"] == "manual-compensation"
    assert result["meta"]["note"] == "五一活动补偿"
    assert result["meta"]["operator"] == "desktop-admin"
    assert result["meta"]["source"] == "desktop-admin"

    summary = store.total_score_summary("player-1")
    assert summary["total_score"] == 2500
    assert summary["play_count"] == 1

    recent = store.recent_scores("player-1", limit=10)
    assert len(recent) == 1
    assert recent[0]["game_id"] == "admin-compensation"
    assert recent[0]["score"] == 2500


def test_grant_score_compensation_rejects_non_positive_amount(tmp_path, monkeypatch):
    monkeypatch.setattr(game_hub_module, "games_db_path", lambda: str(tmp_path / "game_hub.sqlite3"))
    store = GameHubStore()

    with pytest.raises(ValueError, match="补偿积分必须大于 0"):
        store.grant_score_compensation("player-1", 0)


def test_leaderboards_include_all_time_total_across_weeks(tmp_path, monkeypatch):
    db_path = tmp_path / "game_hub.sqlite3"
    monkeypatch.setattr(game_hub_module, "games_db_path", lambda: str(db_path))
    store = GameHubStore()

    store.record_score("player-1", "2048", 100, session_key="p1")
    store.record_score("player-2", "2048", 250, session_key="p2")
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE game_scores SET week_key = '2026-W01' WHERE ip = 'player-2'")

    leaderboard = store.leaderboards(limit=10)

    assert [entry["ip"] for entry in leaderboard["all_time_total"]] == ["player-2", "player-1"]
    assert leaderboard["all_time_total"][0]["total_score"] == 250
    assert [entry["ip"] for entry in leaderboard["weekly_total"]] == ["player-1"]
