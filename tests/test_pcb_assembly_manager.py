import io
import json
import socket
import time
import zipfile
from pathlib import Path

import pytest

from yobboy_file_server.pcb_assembly_manager import (
    PcbAssemblyConflictError,
    PcbAssemblyManager,
    PcbAssemblyValidationError,
)


def _box_glb() -> bytes:
    import trimesh

    scene = trimesh.Scene()
    scene.add_geometry(
        trimesh.creation.box(extents=[2.0, 4.0, 6.0]),
        node_name="TestBox",
        geom_name="TestBox",
    )
    scene.add_geometry(
        trimesh.creation.box(extents=[1.0, 1.0, 1.0]),
        node_name="SecondBox",
        geom_name="SecondBox",
        transform=trimesh.transformations.translation_matrix([4.0, 0.0, 0.0]),
    )
    return scene.export(file_type="glb")


def _zip_bytes(files: dict[str, bytes]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return output.getvalue()


def _payload(filename: str, data: bytes) -> dict:
    return {
        "type": "file_upload",
        "filename": filename,
        "size": len(data),
        "data": list(data),
    }


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def test_process_zip_discovers_obj_mtl_and_assets(tmp_path: Path):
    manager = PcbAssemblyManager(
        data_dir=str(tmp_path / "data"),
        root_dir=str(tmp_path),
        save_dir=str(tmp_path / "assemblies"),
        receiver_port=_free_port(),
    )
    session = manager.create_session()
    archive = _zip_bytes(
        {
            "board/pcb.obj": b"mtllib pcb.mtl\no board\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
            "board/pcb.mtl": b"newmtl board\nmap_Kd textures/board.png\n",
            "board/textures/board.png": b"not-a-real-png",
        }
    )

    item = manager.process_upload(session["id"], _payload("PCB_3D_Model.zip", archive))

    assert item["name"] == "PCB_3D_Model"
    assert item["source_filename"] == "PCB_3D_Model.zip"
    assert item["models"] == [{"obj_path": "board/pcb.obj", "mtl_path": "board/pcb.mtl"}]
    assert manager.resolve_asset(session["id"], item["id"], "board/pcb.obj").is_file()
    assert manager.list_items(session["id"])["revision"] == 1


def test_rejects_unsafe_zip_and_size_mismatch(tmp_path: Path):
    manager = PcbAssemblyManager(
        data_dir=str(tmp_path / "data"),
        root_dir=str(tmp_path),
        save_dir=str(tmp_path / "assemblies"),
        receiver_port=_free_port(),
    )
    session = manager.create_session()
    unsafe = _zip_bytes({"../outside.obj": b"v 0 0 0\n"})

    with pytest.raises(PcbAssemblyValidationError, match="路径"):
        manager.process_upload(session["id"], _payload("unsafe.zip", unsafe))

    mismatched = _payload("board.zip", _zip_bytes({"board.obj": b"v 0 0 0\n"}))
    mismatched["size"] += 1
    with pytest.raises(PcbAssemblyValidationError, match="大小"):
        manager.process_upload(session["id"], mismatched)


def test_save_glb_uses_configured_directory_and_requires_overwrite(tmp_path: Path):
    save_dir = tmp_path / "assemblies"
    manager = PcbAssemblyManager(
        data_dir=str(tmp_path / "data"),
        root_dir=str(tmp_path),
        save_dir=str(save_dir),
        receiver_port=_free_port(),
    )
    session = manager.create_session()
    glb = b"glTF" + b"\x02\x00\x00\x00" + b"\x0c\x00\x00\x00"

    result = manager.save_glb(session["id"], "装配结果", glb)

    assert result["filename"] == "装配结果.glb"
    assert result["relative_path"] == "assemblies/装配结果.glb"
    assert (save_dir / "装配结果.glb").read_bytes() == glb
    with pytest.raises(PcbAssemblyConflictError):
        manager.save_glb(session["id"], "装配结果.glb", glb)
    manager.save_glb(session["id"], "装配结果.glb", glb, overwrite=True)


def test_save_glb_can_export_stl_3mf_and_step(tmp_path: Path):
    import trimesh

    save_dir = tmp_path / "assemblies"
    manager = PcbAssemblyManager(
        data_dir=str(tmp_path / "data"),
        root_dir=str(tmp_path),
        save_dir=str(save_dir),
        receiver_port=_free_port(),
    )
    session = manager.create_session()

    result = manager.save_glb(
        session["id"],
        "多格式装配",
        _box_glb(),
        additional_formats={"stl", "3mf", "step"},
    )

    assert result["filename"] == "多格式装配.glb"
    assert [item["format"] for item in result["files"]] == ["glb", "stl", "3mf", "step"]
    assert (save_dir / "多格式装配.glb").is_file()
    stl = trimesh.load_mesh(save_dir / "多格式装配.stl", file_type="stl")
    model_3mf = trimesh.load_scene(save_dir / "多格式装配.3mf", file_type="3mf")
    step_bytes = (save_dir / "多格式装配.step").read_bytes()
    assert stl.extents.tolist() == pytest.approx([5.5, 4.0, 6.0])
    assert len(model_3mf.geometry) == 2
    assert (model_3mf.bounds[1] - model_3mf.bounds[0]).tolist() == pytest.approx([5.5, 4.0, 6.0])
    assert step_bytes.startswith(b"ISO-10303-21;")
    assert b"TestBox" in step_bytes
    assert b"SecondBox" in step_bytes


def test_save_glb_uses_selected_step_model_without_changing_saved_glb(tmp_path: Path):
    import trimesh

    save_dir = tmp_path / "assemblies"
    manager = PcbAssemblyManager(
        data_dir=str(tmp_path / "data"),
        root_dir=str(tmp_path),
        save_dir=str(save_dir),
        receiver_port=_free_port(),
    )
    session = manager.create_session()
    full_glb = _box_glb()
    selected_scene = trimesh.Scene()
    selected_scene.add_geometry(
        trimesh.creation.box(extents=[1.0, 2.0, 0.4]),
        node_name="SelectedBoard",
        geom_name="SelectedBoard",
    )
    selected_glb = selected_scene.export(file_type="glb")

    manager.save_glb(
        session["id"],
        "部分板子",
        full_glb,
        additional_formats={"step"},
        step_glb_bytes=selected_glb,
    )

    assert (save_dir / "部分板子.glb").read_bytes() == full_glb
    step_bytes = (save_dir / "部分板子.step").read_bytes()
    assert b"SelectedBoard" in step_bytes
    assert b"SecondBox" not in step_bytes


def test_multi_format_save_checks_all_conflicts_before_writing(tmp_path: Path):
    save_dir = tmp_path / "assemblies"
    save_dir.mkdir()
    (save_dir / "装配结果.stl").write_bytes(b"existing")
    manager = PcbAssemblyManager(
        data_dir=str(tmp_path / "data"),
        root_dir=str(tmp_path),
        save_dir=str(save_dir),
        receiver_port=_free_port(),
    )
    session = manager.create_session()

    with pytest.raises(PcbAssemblyConflictError, match="STL"):
        manager.save_glb(
            session["id"],
            "装配结果",
            _box_glb(),
            additional_formats={"stl"},
        )

    assert not (save_dir / "装配结果.glb").exists()
    assert (save_dir / "装配结果.stl").read_bytes() == b"existing"


def test_save_glb_can_export_each_top_level_item(tmp_path: Path):
    save_dir = tmp_path / "assemblies"
    manager = PcbAssemblyManager(
        data_dir=str(tmp_path / "data"),
        root_dir=str(tmp_path),
        save_dir=str(save_dir),
        receiver_port=_free_port(),
    )
    session = manager.create_session()

    result = manager.save_glb(
        session["id"],
        "组合装配",
        _box_glb(),
        additional_formats={"stl"},
        separate_models=[("主控板", _box_glb()), ("主控板", _box_glb())],
    )

    assert [item["filename"] for item in result["files"]] == [
        "组合装配.glb",
        "组合装配.stl",
        "组合装配_主控板.glb",
        "组合装配_主控板.stl",
        "组合装配_主控板_2.glb",
        "组合装配_主控板_2.stl",
    ]
    assert [item["scope"] for item in result["files"]] == [
        "assembly",
        "assembly",
        "item",
        "item",
        "item",
        "item",
    ]
    assert all((save_dir / item["filename"]).is_file() for item in result["files"])


def test_raw_websocket_receiver_accepts_easyeda_protocol(tmp_path: Path):
    websockets = pytest.importorskip("websockets.sync.client")
    port = _free_port()
    manager = PcbAssemblyManager(
        data_dir=str(tmp_path / "data"),
        root_dir=str(tmp_path),
        save_dir=str(tmp_path / "assemblies"),
        receiver_port=port,
        lease_timeout=5,
    )
    session = manager.create_session()
    manager.start_receiver(session["id"])
    archive = _zip_bytes({"board.obj": b"o board\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"})

    try:
        with websockets.connect(f"ws://localhost:{port}", open_timeout=2) as client:
            assert json.loads(client.recv())["type"] == "connection_established"
            client.send(json.dumps(_payload("board.zip", archive)))
            messages = [json.loads(client.recv()) for _ in range(3)]
        assert [message["type"] for message in messages] == [
            "upload_progress",
            "upload_progress",
            "upload_complete",
        ]
        assert len(manager.list_items(session["id"])["items"]) == 1
    finally:
        manager.stop_receiver(session["id"])
        manager.close_session(session["id"])


def test_receiver_rejects_main_server_port_conflict(tmp_path: Path):
    port = _free_port()
    manager = PcbAssemblyManager(
        data_dir=str(tmp_path / "data"),
        root_dir=str(tmp_path),
        save_dir=str(tmp_path / "assemblies"),
        main_port=port,
        receiver_port=port,
    )
    session = manager.create_session()

    with pytest.raises(PcbAssemblyConflictError, match="主服务器"):
        manager.start_receiver(session["id"])


def test_receiver_stops_after_lease_timeout(tmp_path: Path):
    pytest.importorskip("websockets")
    port = _free_port()
    manager = PcbAssemblyManager(
        data_dir=str(tmp_path / "data"),
        root_dir=str(tmp_path),
        save_dir=str(tmp_path / "assemblies"),
        receiver_port=port,
        lease_timeout=0.25,
    )
    session = manager.create_session()
    manager.start_receiver(session["id"])

    deadline = time.time() + 2
    while manager.receiver_status()["listening"] and time.time() < deadline:
        time.sleep(0.05)

    assert manager.receiver_status()["listening"] is False
    manager.close_session(session["id"])
