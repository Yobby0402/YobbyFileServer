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
