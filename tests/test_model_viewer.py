from pathlib import Path

from flask import Flask

from yobboy_file_server import routes


def _create_app(root_dir: Path) -> Flask:
    project_dir = Path(__file__).resolve().parents[1]
    app = Flask(
        __name__,
        template_folder=str(project_dir / "templates"),
        static_folder=str(project_dir / "static"),
    )
    app.config.update(SECRET_KEY="test-secret", ROOT_DIR=str(root_dir))
    routes.init_app(app)
    return app


def test_model_preview_and_review_modes_use_dedicated_viewer(tmp_path: Path):
    (tmp_path / "model.stl").write_text("solid model\nendsolid model\n", encoding="utf-8")
    app = _create_app(tmp_path)

    with app.test_client() as client:
        with client.session_transaction() as session:
            session["logged_in"] = True

        preview = client.post("/get_preview_content", json={"filepath": "model.stl"})
        response = client.get("/view_model/model.stl")
        light_preview = client.get("/view_model/model.stl?mode=preview")
        browser = client.get("/file_browser")

    assert preview.status_code == 200
    assert preview.get_json()["file_type"] == "3d_model"
    assert 'src="/view_model/model.stl?mode=preview"' in preview.get_json()["content_html"]
    assert response.status_code == 200
    assert light_preview.status_code == 200
    assert browser.status_code == 200
    assert 'href="/view_model/model.stl"' in browser.text
    assert 'data-action="back"' in response.text
    assert 'data-action="export-report"' in response.text
    assert 'data-action="export-model"' in response.text
    assert 'data-action="toggle-annotations"' in response.text
    assert 'data-action="toggle-all-lines"' in response.text
    assert 'aria-keyshortcuts="C"' in response.text
    assert 'id="model-view-cube"' in response.text
    assert 'css/view_cube.css' in response.text
    assert 'id="report-preview-count"' in response.text
    assert 'id="model-export-dialog"' in response.text
    assert 'id="model-export-parts"' in response.text
    assert 'name="model_export_format"' in response.text
    assert 'id="report-include-3d"' in response.text
    assert response.text.count('name="output_mode" type="radio"') == 3
    assert 'name="output_mode" type="radio" value="both" checked' in response.text
    assert response.text.count('name="annotation_view_count" type="radio"') == 4
    assert 'name="separate_3d" type="checkbox"' in response.text
    assert "theme_floater.js" not in response.text
    assert '"mode": "review"' in response.text
    assert '"mode": "preview"' in light_preview.text
    assert "css/model_viewer.css" in response.text
    assert "js/model_viewer.js" in response.text
    assert 'data-action="open-review"' in light_preview.text
    assert 'data-action="fullscreen"' in light_preview.text
    assert '"reportsUrl": "/api/model-review/reports"' in response.text
    assert '"modelExportUrl": "/api/model-review/models/export"' in response.text
    assert 'id="annotation-markdown" name="markdown" maxlength="20000"></textarea>' in response.text
    assert "onclick=" not in response.text


def test_model_viewer_rejects_invalid_mode_and_unsupported_file(tmp_path: Path):
    (tmp_path / "model.glb").write_bytes(b"glTF")
    (tmp_path / "notes.txt").write_text("notes", encoding="utf-8")
    app = _create_app(tmp_path)

    with app.test_client() as client:
        with client.session_transaction() as session:
            session["logged_in"] = True

        assert client.get("/view_model/model.glb?mode=unknown").status_code == 400
        assert client.get("/view_model/notes.txt").status_code == 400
        assert client.get("/view_model/../model.glb").status_code in {400, 404}
