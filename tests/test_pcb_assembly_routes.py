import io
import json
from pathlib import Path

from flask import Flask

from yobboy_file_server import routes
from yobboy_file_server.pcb_assembly_manager import PcbAssemblyManager


def _box_glb() -> bytes:
    import trimesh

    scene = trimesh.Scene()
    scene.add_geometry(trimesh.creation.box(extents=[2.0, 4.0, 6.0]))
    return scene.export(file_type="glb")


def _obj_payload(filename: str) -> dict:
    data = b"o board\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"
    return {
        "type": "file_upload",
        "filename": filename,
        "size": len(data),
        "data": list(data),
    }


def _create_app(root_dir: Path) -> Flask:
    project_dir = Path(__file__).resolve().parents[1]
    save_dir = root_dir / "assemblies"
    app = Flask(
        __name__,
        template_folder=str(project_dir / "templates"),
        static_folder=str(project_dir / "static"),
    )
    app.config.update(
        SECRET_KEY="test-secret",
        ROOT_DIR=str(root_dir),
        DATA_DIR=str(root_dir / "data"),
        PORT=5000,
        PCB_ASSEMBLY_DIR=str(save_dir),
    )
    app.config["PCB_ASSEMBLY_MANAGER"] = PcbAssemblyManager(
        data_dir=app.config["DATA_DIR"],
        root_dir=app.config["ROOT_DIR"],
        save_dir=app.config["PCB_ASSEMBLY_DIR"],
        receiver_port=18765,
    )
    routes.init_app(app)
    return app


def test_assembly_page_requires_login_and_exposes_workspace(tmp_path: Path):
    app = _create_app(tmp_path)
    with app.test_client() as client:
        assert client.get("/pcb-assembly").status_code in {302, 401}
        with client.session_transaction() as session:
            session["logged_in"] = True
        response = client.get("/pcb-assembly")

    assert response.status_code == 200
    assert 'id="assembly-start-receiver"' in response.text
    assert 'id="assembly-transform-form"' in response.text
    assert 'data-action="background"' in response.text
    assert 'id="assembly-view-cube"' in response.text
    assert response.text.count('step="0.1" value="0" data-transform-kind="rotation"') == 3
    assert 'css/view_cube.css' in response.text
    assert 'data-workspace-mode="assembly"' in response.text
    assert 'data-workspace-mode="presentation"' in response.text
    assert 'id="assembly-presentation"' in response.text
    assert response.text.count('name="additional_format" type="checkbox"') == 3
    assert 'name="additional_format" type="checkbox" value="stl"' in response.text
    assert 'name="additional_format" type="checkbox" value="3mf"' in response.text
    assert 'name="additional_format" type="checkbox" value="step"' in response.text
    assert 'id="assembly-step-selection"' in response.text
    assert 'name="separate_items" type="checkbox"' in response.text
    assert "js/pcb_assembly.js" in response.text
    assert '"receiverPort": 8765' in response.text


def test_model_review_supports_embedded_workspace_chrome(tmp_path: Path):
    app = _create_app(tmp_path)
    model_path = tmp_path / "assemblies" / "demo.glb"
    model_path.parent.mkdir(parents=True)
    model_path.write_bytes(b"glTF" + b"\x02\x00\x00\x00" + b"\x0c\x00\x00\x00")

    with app.test_client() as client:
        with client.session_transaction() as session:
            session["logged_in"] = True
        response = client.get("/view_model/assemblies/demo.glb?embed=1")

    assert response.status_code == 200
    assert "model-viewer--embedded" in response.text
    assert '"embedded": true' in response.text


def test_session_save_endpoint_writes_valid_glb(tmp_path: Path):
    app = _create_app(tmp_path)
    glb = b"glTF" + b"\x02\x00\x00\x00" + b"\x0c\x00\x00\x00"

    with app.test_client() as client:
        with client.session_transaction() as session:
            session["logged_in"] = True
        created = client.post("/api/pcb-assembly/sessions").get_json()
        session_id = created["session"]["id"]
        response = client.post(
            f"/api/pcb-assembly/sessions/{session_id}/save",
            data={
                "filename": "测试装配",
                "model_glb": (io.BytesIO(glb), "model.glb"),
            },
            content_type="multipart/form-data",
        )

    assert response.status_code == 201
    payload = response.get_json()
    assert payload["model_path"] == "assemblies/测试装配.glb"
    assert payload["review_url"].endswith("/view_model/assemblies/%E6%B5%8B%E8%AF%95%E8%A3%85%E9%85%8D.glb")
    assert (tmp_path / "assemblies" / "测试装配.glb").read_bytes() == glb


def test_session_save_endpoint_exports_stl_3mf_and_step(tmp_path: Path):
    app = _create_app(tmp_path)

    with app.test_client() as client:
        with client.session_transaction() as session:
            session["logged_in"] = True
        created = client.post("/api/pcb-assembly/sessions").get_json()
        session_id = created["session"]["id"]
        response = client.post(
            f"/api/pcb-assembly/sessions/{session_id}/save",
            data={
                "filename": "测试装配",
                "additional_formats": json.dumps(["stl", "3mf", "step"]),
                "model_glb": (io.BytesIO(_box_glb()), "model.glb"),
                "step_model_glb": (io.BytesIO(_box_glb()), "step-model.glb"),
            },
            content_type="multipart/form-data",
        )

    assert response.status_code == 201
    payload = response.get_json()
    assert [item["format"] for item in payload["files"]] == ["glb", "stl", "3mf", "step"]
    assert (tmp_path / "assemblies" / "测试装配.stl").is_file()
    assert (tmp_path / "assemblies" / "测试装配.3mf").is_file()
    assert (tmp_path / "assemblies" / "测试装配.step").is_file()


def test_session_save_endpoint_exports_each_received_board(tmp_path: Path):
    app = _create_app(tmp_path)
    manager = app.config["PCB_ASSEMBLY_MANAGER"]

    with app.test_client() as client:
        with client.session_transaction() as session:
            session["logged_in"] = True
        created = client.post("/api/pcb-assembly/sessions").get_json()
        session_id = created["session"]["id"]
        manager.process_upload(session_id, _obj_payload("主控板.obj"))
        manager.process_upload(session_id, _obj_payload("接口板.obj"))
        items = manager.list_items(session_id)["items"]
        response = client.post(
            f"/api/pcb-assembly/sessions/{session_id}/save",
            data={
                "filename": "完整装配",
                "separate_item_ids": json.dumps([item["id"] for item in items]),
                "model_glb": (io.BytesIO(_box_glb()), "assembly.glb"),
                "separate_model_0": (io.BytesIO(_box_glb()), "board-0.glb"),
                "separate_model_1": (io.BytesIO(_box_glb()), "board-1.glb"),
            },
            content_type="multipart/form-data",
        )

    assert response.status_code == 201
    payload = response.get_json()
    assert [item["filename"] for item in payload["files"]] == [
        "完整装配.glb",
        "完整装配_主控板.glb",
        "完整装配_接口板.glb",
    ]
    assert all((tmp_path / "assemblies" / item["filename"]).is_file() for item in payload["files"])


def test_asset_endpoint_rejects_path_traversal(tmp_path: Path):
    app = _create_app(tmp_path)
    manager = app.config["PCB_ASSEMBLY_MANAGER"]
    session = manager.create_session()

    with app.test_client() as client:
        with client.session_transaction() as login_session:
            login_session["logged_in"] = True
        response = client.get(
            f"/api/pcb-assembly/sessions/{session['id']}/assets/missing/../../config.ini"
        )

    assert response.status_code in {400, 404}
