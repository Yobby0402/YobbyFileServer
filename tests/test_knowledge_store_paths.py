from pathlib import Path

from yobboy_file_server import knowledge_store


def test_knowledge_preview_accepts_absolute_path_under_root(tmp_path: Path):
    note = tmp_path / "docs" / "note.md"
    note.parent.mkdir()
    note.write_text("# Note\n\nhello", encoding="utf-8")

    preview = knowledge_store.preview_entry(str(tmp_path), str(note))

    assert preview["path"] == "docs/note.md"
    assert preview["text"].startswith("# Note")


def test_knowledge_resolver_rejects_absolute_path_outside_root(tmp_path: Path):
    root = tmp_path / "root"
    outside = tmp_path / "outside.md"
    root.mkdir()
    outside.write_text("outside", encoding="utf-8")

    full, rel = knowledge_store._resolve_under_root(str(root), str(outside))

    assert full is None
    assert rel
