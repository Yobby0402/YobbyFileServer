import io
import json
import re
import struct
import zipfile
from pathlib import Path

import pytest
from flask import Flask
from PIL import Image

from yobboy_file_server import routes


@pytest.fixture()
def app(tmp_path: Path) -> Flask:
    project_dir = Path(__file__).resolve().parents[1]
    root_dir = tmp_path / "files"
    root_dir.mkdir()
    (root_dir / "assembly.glb").write_bytes(b"glTF")
    (root_dir / "notes.txt").write_text("not a model", encoding="utf-8")
    application = Flask(
        __name__,
        template_folder=str(project_dir / "templates"),
        static_folder=str(project_dir / "static"),
    )
    application.config.update(
        TESTING=True,
        SECRET_KEY="test-secret",
        ROOT_DIR=str(root_dir),
        DATA_DIR=str(tmp_path / "data"),
    )
    routes.init_app(application)
    return application


def _login(client) -> None:
    with client.session_transaction() as session:
        session["logged_in"] = True


def _annotation_payload(**overrides):
    payload = {
        "path": "assembly.glb",
        "title": "检查装配",
        "markdown": "确认 **装配间隙**。",
        "position": [1, 2, 3],
        "normal": [0, 0, 2],
        "surface_part_path": "Assembly#0/Cover#0",
    }
    payload.update(overrides)
    return payload


REPORT_VIEWS = [
    {"id": "front", "label": "前视图"},
    {"id": "back", "label": "后视图"},
    {"id": "left", "label": "左视图"},
    {"id": "right", "label": "右视图"},
    {"id": "top", "label": "顶视图"},
    {"id": "bottom", "label": "底视图"},
]


def _jpeg_bytes() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (1600, 900), "#e7eaed").save(output, format="JPEG", quality=80)
    return output.getvalue()


def _minimal_glb() -> bytes:
    json_chunk = b'{"asset":{"version":"2.0"},"scene":0,"scenes":[{}]}'
    json_chunk += b" " * ((4 - len(json_chunk) % 4) % 4)
    total_length = 12 + 8 + len(json_chunk)
    return b"glTF" + struct.pack("<II", 2, total_length) + struct.pack("<I4s", len(json_chunk), b"JSON") + json_chunk


def _report_form(
    *,
    formats=None,
    include_annotations=False,
    annotation_ids=None,
    include_3d=None,
    annotation_view_count=2,
    separate_3d=False,
    separate_model_names=None,
):
    formats = formats or ["pdf", "docx"]
    annotation_ids = annotation_ids or []
    if include_3d is None:
        include_3d = "docx" in formats
    config = {
        "path": "assembly.glb",
        "title": "装配体审阅报告",
        "formats": formats,
        "preview_count": 6,
        "include_annotations": include_annotations,
        "annotation_view_count": annotation_view_count,
        "include_3d": include_3d,
        "separate_3d": separate_3d,
        "separate_models": [
            {"name": name, "max_dimension": 2.5}
            for name in (separate_model_names or [])
        ],
        "views": REPORT_VIEWS,
        "annotation_ids": annotation_ids,
        "model_max_dimension": 2.5,
    }
    image = _jpeg_bytes()
    data = {"config": json.dumps(config, ensure_ascii=False)}
    for view in REPORT_VIEWS:
        data[f"preview_{view['id']}"] = (io.BytesIO(image), f"{view['id']}.jpg")
    if include_annotations:
        for annotation_id in annotation_ids:
            for view_index in range(1, annotation_view_count + 1):
                field = f"annotation_{annotation_id}_{view_index}"
                data[field] = (io.BytesIO(image), f"{field}.jpg")
    if include_3d:
        data["model_glb"] = (io.BytesIO(_minimal_glb()), "model.glb")
    if separate_3d:
        for index, _name in enumerate(separate_model_names or []):
            data[f"separate_model_{index}"] = (
                io.BytesIO(_minimal_glb()),
                f"separate-{index}.glb",
            )
            data[f"separate_poster_{index}"] = (
                io.BytesIO(image),
                f"separate-{index}.jpg",
            )
    return data


def test_annotation_api_requires_login(app: Flask):
    with app.test_client() as client:
        response = client.get("/api/model-review/annotations?path=assembly.glb")

    assert response.status_code == 401


def test_report_api_requires_login(app: Flask):
    with app.test_client() as client:
        response = client.post("/api/model-review/reports", data={"config": "{}"})

    assert response.status_code == 401


def test_model_export_api_requires_login(app: Flask):
    with app.test_client() as client:
        response = client.post("/api/model-review/models/export")

    assert response.status_code == 401


def test_model_export_api_returns_step(app: Flask):
    import trimesh

    scene = trimesh.Scene()
    scene.add_geometry(
        trimesh.creation.box(extents=[1.0, 2.0, 0.5]),
        node_name="SelectedBoard",
        geom_name="SelectedBoard",
    )
    glb = scene.export(file_type="glb")

    with app.test_client() as client:
        _login(client)
        response = client.post(
            "/api/model-review/models/export",
            data={
                "path": "assembly.glb",
                "format": "step",
                "model_glb": (io.BytesIO(glb), "selected.glb"),
            },
            content_type="multipart/form-data",
        )

    assert response.status_code == 200
    assert response.data.startswith(b"ISO-10303-21;")
    assert b"SelectedBoard" in response.data
    assert response.headers["X-Model-Export-Filename"] == "assembly.step"


def test_annotation_api_crud_and_database_reopen(app: Flask):
    with app.test_client() as client:
        _login(client)
        created_response = client.post(
            "/api/model-review/annotations",
            json=_annotation_payload(),
        )
        assert created_response.status_code == 201
        created = created_response.get_json()["annotation"]
        assert created["normal"] == [0.0, 0.0, 1.0]

        empty_body = client.put(
            f"/api/model-review/annotations/{created['id']}",
            json={"path": "assembly.glb", "markdown": ""},
        )
        assert empty_body.status_code == 200
        assert empty_body.get_json()["annotation"]["markdown"] == ""

        app.config.pop("MODEL_REVIEW_MANAGER")
        listed = client.get("/api/model-review/annotations?path=assembly.glb")
        assert listed.get_json()["annotations"][0]["markdown"] == ""

        updated = client.put(
            f"/api/model-review/annotations/{created['id']}",
            json={"path": "assembly.glb", "title": "更新标题"},
        )
        assert updated.status_code == 200
        assert updated.get_json()["annotation"]["title"] == "更新标题"

        deleted = client.delete(
            f"/api/model-review/annotations/{created['id']}?path=assembly.glb"
        )
        assert deleted.status_code == 200
        assert client.get(
            "/api/model-review/annotations?path=assembly.glb"
        ).get_json()["annotations"] == []

    assert (Path(app.config["DATA_DIR"]) / "model_reviews" / "model_reviews.sqlite3").is_file()


@pytest.mark.parametrize(
    ("method", "url", "payload"),
    [
        ("get", "/api/model-review/annotations?path=../assembly.glb", None),
        ("get", "/api/model-review/annotations?path=notes.txt", None),
        ("post", "/api/model-review/annotations", _annotation_payload(position=[1, 2])),
        ("post", "/api/model-review/annotations", _annotation_payload(normal=[0, 0, 0])),
    ],
)
def test_annotation_api_rejects_invalid_paths_and_vectors(app: Flask, method, url, payload):
    with app.test_client() as client:
        _login(client)
        response = getattr(client, method)(url, json=payload)

    assert response.status_code == 400


def test_report_api_builds_pdf_and_interactive_docx_zip(app: Flask):
    with app.test_client() as client:
        _login(client)
        response = client.post(
            "/api/model-review/reports",
            data=_report_form(),
            content_type="multipart/form-data",
        )

    assert response.status_code == 200
    assert response.mimetype == "application/x-yobboy-model-review"
    assert response.headers["X-Model-Review-Filename"].endswith(".zip")
    with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
        names = set(archive.namelist())
        pdf_name = next(name for name in names if name.endswith(".pdf"))
        docx_name = next(name for name in names if name.endswith(".docx"))
        assert archive.read(pdf_name).startswith(b"%PDF")
        docx_bytes = archive.read(docx_name)

    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as document:
        document_names = set(document.namelist())
        assert "word/media/model-review.glb" in document_names
        assert "word/media/model-review-poster.jpg" in document_names
        xml = document.read("word/document.xml")
        assert b"model3d" in xml
        assert b"MODEL_3D_PLACEHOLDER" not in xml
        assert b'w:w="16838"' in xml
        assert b'w:h="11906"' in xml
        assert document.read("word/media/model-review.glb").startswith(b"glTF")
        styles_xml = document.read("word/styles.xml").decode("utf-8")
        assert 'w:eastAsia="Microsoft YaHei"' in styles_xml


def test_report_api_builds_static_docx_without_model3d(app: Flask):
    with app.test_client() as client:
        _login(client)
        response = client.post(
            "/api/model-review/reports",
            data=_report_form(formats=["docx"], include_3d=False),
            content_type="multipart/form-data",
        )

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.data)) as document:
        names = set(document.namelist())
        assert "word/media/model-review.glb" not in names
        assert b"model3d" not in document.read("word/document.xml")
        assert 'w:eastAsia="Microsoft YaHei"' in document.read("word/styles.xml").decode("utf-8")


def test_report_api_embeds_assembly_and_each_top_level_board(app: Flask):
    with app.test_client() as client:
        _login(client)
        response = client.post(
            "/api/model-review/reports",
            data=_report_form(
                formats=["docx"],
                separate_3d=True,
                separate_model_names=["主控板", "接口板"],
            ),
            content_type="multipart/form-data",
        )

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.data)) as document:
        names = set(document.namelist())
        assert {
            "word/media/model-review.glb",
            "word/media/model-review-2.glb",
            "word/media/model-review-3.glb",
            "word/media/model-review-poster.jpg",
            "word/media/model-review-poster-2.jpg",
            "word/media/model-review-poster-3.jpg",
        }.issubset(names)
        xml = document.read("word/document.xml")
        assert xml.count(b"<am3d:model3d") == 3
        assert "主控板" in xml.decode("utf-8")
        assert "接口板" in xml.decode("utf-8")


def test_report_api_rejects_missing_separate_board_model(app: Flask):
    data = _report_form(
        formats=["docx"],
        separate_3d=True,
        separate_model_names=["主控板", "接口板"],
    )
    data.pop("separate_model_1")

    with app.test_client() as client:
        _login(client)
        response = client.post(
            "/api/model-review/reports",
            data=data,
            content_type="multipart/form-data",
        )

    assert response.status_code == 400
    assert "GLB" in response.get_json()["error"]


def test_report_api_uses_current_annotation_list(app: Flask):
    with app.test_client() as client:
        _login(client)
        created = client.post(
            "/api/model-review/annotations",
            json=_annotation_payload(
                markdown="## 检查结果\n\n背面连接器需要确认安装间隙，并检查焊点是否完整。\n\n- 检查固定孔\n- 检查连接器方向"
            ),
        ).get_json()["annotation"]
        data = _report_form(
            formats=["pdf"],
            include_annotations=True,
            annotation_ids=[created["id"]],
            annotation_view_count=4,
        )
        response = client.post(
            "/api/model-review/reports",
            data=data,
            content_type="multipart/form-data",
        )

    assert response.status_code == 200
    assert response.mimetype == "application/x-yobboy-model-review"
    assert response.headers["X-Model-Review-Filename"].endswith(".pdf")
    assert response.data.startswith(b"%PDF")
    assert len(re.findall(rb"/Type\s*/Page\b", response.data)) == 8


def test_report_api_builds_multi_view_comment_without_part_location(app: Flask):
    with app.test_client() as client:
        _login(client)
        created = client.post("/api/model-review/annotations", json=_annotation_payload()).get_json()["annotation"]
        response = client.post(
            "/api/model-review/reports",
            data=_report_form(
                formats=["docx"],
                include_3d=False,
                include_annotations=True,
                annotation_ids=[created["id"]],
                annotation_view_count=4,
            ),
            content_type="multipart/form-data",
        )

    assert response.status_code == 200
    with zipfile.ZipFile(io.BytesIO(response.data)) as document:
        xml = document.read("word/document.xml").decode("utf-8")
        assert "关联位置" not in xml
        assert ">评论<" in xml
        assert "第二部分  评论" not in xml
        assert "评论标题" in xml
        assert "评论内容" in xml
        assert xml.count("<a:blip") >= len(REPORT_VIEWS) + 4
        assert xml.count('w:type="page"') >= len(REPORT_VIEWS) + 1


@pytest.mark.parametrize("annotation_view_count", [0, 5])
def test_report_api_rejects_invalid_annotation_view_count(app: Flask, annotation_view_count: int):
    with app.test_client() as client:
        _login(client)
        response = client.post(
            "/api/model-review/reports",
            data=_report_form(formats=["pdf"], annotation_view_count=annotation_view_count),
            content_type="multipart/form-data",
        )

    assert response.status_code == 400
    assert "评论视角数量" in response.get_json()["error"]


def test_report_api_rejects_missing_comment_view(app: Flask):
    with app.test_client() as client:
        _login(client)
        created = client.post("/api/model-review/annotations", json=_annotation_payload()).get_json()["annotation"]
        data = _report_form(
            formats=["pdf"],
            include_annotations=True,
            annotation_ids=[created["id"]],
            annotation_view_count=2,
        )
        data.pop(f"annotation_{created['id']}_2")
        response = client.post(
            "/api/model-review/reports",
            data=data,
            content_type="multipart/form-data",
        )

    assert response.status_code == 400
    assert "缺少图片" in response.get_json()["error"]


def test_report_api_rejects_changed_annotations_and_bad_path(app: Flask):
    with app.test_client() as client:
        _login(client)
        client.post("/api/model-review/annotations", json=_annotation_payload())
        changed = client.post(
            "/api/model-review/reports",
            data=_report_form(formats=["pdf"], include_annotations=True, annotation_ids=[]),
            content_type="multipart/form-data",
        )
        bad_data = _report_form(formats=["pdf"])
        config = json.loads(bad_data["config"])
        config["path"] = "../assembly.glb"
        bad_data["config"] = json.dumps(config)
        invalid_path = client.post(
            "/api/model-review/reports",
            data=bad_data,
            content_type="multipart/form-data",
        )

    assert changed.status_code == 400
    assert "评论列表已变化" in changed.get_json()["error"]
    assert invalid_path.status_code == 400
