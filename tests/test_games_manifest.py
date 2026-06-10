import json
from pathlib import Path


def test_games_manifest_includes_shi():
    manifest_path = Path("static/games/manifest.json")
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    games = payload.get("games", [])
    shi = next((item for item in games if item.get("id") == "shi"), None)

    assert shi is not None
    assert shi["title"] == "士"
    assert "动作" in shi.get("tags", [])


def test_games_manifest_includes_hardware_daren():
    manifest_path = Path("static/games/manifest.json")
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    games = payload.get("games", [])
    hardware_daren = next((item for item in games if item.get("id") == "hardware-daren"), None)

    assert hardware_daren is not None
    assert hardware_daren["title"] == "硬件达人"
    assert "示波器" in hardware_daren.get("tags", [])
