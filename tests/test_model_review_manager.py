from pathlib import Path

import pytest

from yobboy_file_server.model_review_manager import (
    ModelReviewManager,
    ModelReviewValidationError,
)


def _payload(**overrides):
    payload = {
        "title": "外壳间隙",
        "markdown": "这里需要确认 **装配间隙**。",
        "position": [1, 2, 3],
        "normal": [0, 0, 5],
        "surface_part_path": "Assembly/Cover",
    }
    payload.update(overrides)
    return payload


def test_annotations_persist_and_can_be_updated(tmp_path: Path):
    db_path = tmp_path / "reviews.sqlite3"
    manager = ModelReviewManager(str(db_path))

    created = manager.create_annotation("models/demo.glb", _payload())
    assert created["normal"] == [0.0, 0.0, 1.0]

    reloaded = ModelReviewManager(str(db_path))
    assert reloaded.list_annotations("models/demo.glb") == [created]

    updated = reloaded.update_annotation(
        created["id"],
        {"title": "更新后的标题", "surface_part_path": None},
    )
    assert updated["title"] == "更新后的标题"
    assert updated["surface_part_path"] is None
    assert updated["markdown"] == created["markdown"]

    assert reloaded.delete_annotation(created["id"]) is True
    assert reloaded.list_annotations("models/demo.glb") == []


def test_annotation_markdown_may_be_empty(tmp_path: Path):
    manager = ModelReviewManager(str(tmp_path / "reviews.sqlite3"))

    created = manager.create_annotation("models/demo.glb", _payload(markdown=""))
    assert created["markdown"] == ""

    updated = manager.update_annotation(created["id"], {"markdown": ""})
    assert updated["markdown"] == ""


@pytest.mark.parametrize(
    "payload",
    [
        _payload(title=""),
        _payload(position=[1, 2]),
        _payload(position=[1, 2, float("nan")]),
        _payload(normal=[0, 0, 0]),
    ],
)
def test_annotation_validation_rejects_invalid_payloads(tmp_path: Path, payload):
    manager = ModelReviewManager(str(tmp_path / "reviews.sqlite3"))

    with pytest.raises(ModelReviewValidationError):
        manager.create_annotation("models/demo.glb", payload)


def test_reanchor_requires_position_and_normal_together(tmp_path: Path):
    manager = ModelReviewManager(str(tmp_path / "reviews.sqlite3"))
    created = manager.create_annotation("models/demo.glb", _payload())

    with pytest.raises(ModelReviewValidationError):
        manager.update_annotation(created["id"], {"position": [4, 5, 6]})
