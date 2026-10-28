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


def test_dsn_preview_uses_the_embedded_viewer(tmp_path: Path):
    (tmp_path / "board.dsn").write_text("(pcb demo)", encoding="utf-8")
    app = _create_app(tmp_path)

    with app.test_client() as client:
        with client.session_transaction() as session:
            session["logged_in"] = True

        response = client.post("/get_preview_content", json={"filepath": "board.dsn"})

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["file_type"] == "dsn"
    assert 'src="/view_dsn/board.dsn"' in payload["content_html"]


def test_dsn_viewer_requires_login_and_rejects_other_extensions(tmp_path: Path):
    (tmp_path / "board.dsn").write_text("(pcb demo)", encoding="utf-8")
    (tmp_path / "note.txt").write_text("not a board", encoding="utf-8")
    app = _create_app(tmp_path)

    with app.test_client() as client:
        unauthenticated = client.get("/view_dsn/board.dsn")
        assert unauthenticated.status_code == 302
        assert "/login" in unauthenticated.headers["Location"]

        with client.session_transaction() as session:
            session["logged_in"] = True

        response = client.get("/view_dsn/board.dsn")
        assert response.status_code == 200
        assert b"/static/dsn-viewer/index.html?file=%2Fdsn-content%3Fpath%3Dboard.dsn" in response.data

        viewer = client.get("/static/dsn-viewer/index.html")
        assert viewer.status_code == 200
        assert b"/static/dsn-viewer/assets/" in viewer.data

        invalid = client.get("/view_dsn/note.txt")
        assert invalid.status_code == 400


def test_dsn_viewer_home_is_available_without_a_file(tmp_path: Path):
    app = _create_app(tmp_path)

    with app.test_client() as client:
        unauthenticated = client.get("/dsn-viewer")
        assert unauthenticated.status_code == 302

        with client.session_transaction() as session:
            session["logged_in"] = True

        response = client.get("/dsn-viewer/")

    assert response.status_code == 200
    assert b"/static/dsn-viewer/index.html" in response.data


def test_dsn_preview_reads_files_from_git_worktrees(tmp_path: Path):
    git_workdir = tmp_path / "git"
    repo_dir = git_workdir / "repo" / "boards"
    repo_dir.mkdir(parents=True)
    (repo_dir / "board.dsn").write_text("(pcb demo)", encoding="utf-8")
    app = _create_app(tmp_path)
    app.config["GIT_WORKDIR"] = str(git_workdir)

    with app.test_client() as client:
        with client.session_transaction() as session:
            session["logged_in"] = True

        preview = client.post(
            "/get_preview_content",
            json={"filepath": "boards/board.dsn", "git_root": "repo"},
        )
        assert preview.status_code == 200
        assert "root=repo" in preview.get_json()["content_html"]

        viewer = client.get("/view_dsn?path=boards/board.dsn&root=repo")
        assert viewer.status_code == 200
        assert b"%2Fdsn-content%3Fpath%3Dboards%2Fboard.dsn%26root%3Drepo" in viewer.data

        content = client.get("/dsn-content?path=boards/board.dsn&root=repo")
        assert content.status_code == 200
        assert content.text == "(pcb demo)"
