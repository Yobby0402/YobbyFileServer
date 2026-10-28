import io

import pytest

from yobboy_file_server.model_conversion import convert_glb, normalize_export_formats


def _named_boxes_glb() -> bytes:
    import trimesh

    scene = trimesh.Scene()
    scene.add_geometry(
        trimesh.creation.box(extents=[2.0, 2.0, 1.0]),
        node_name="MainBoard",
        geom_name="MainBoard",
    )
    scene.add_geometry(
        trimesh.creation.box(extents=[1.0, 1.0, 0.5]),
        node_name="DisplayBoard",
        geom_name="DisplayBoard",
        transform=trimesh.transformations.translation_matrix([4.0, 0.0, 0.0]),
    )
    return scene.export(file_type="glb")


def test_normalize_export_formats_includes_step():
    assert normalize_export_formats(["STEP", "stl"]) == ("stl", "step")


def test_convert_glb_exports_named_step_entities():
    pytest.importorskip("OCP")

    output = convert_glb(_named_boxes_glb(), {"step"})["step"]

    assert output.startswith(b"ISO-10303-21;")
    assert b"MainBoard" in output
    assert b"DisplayBoard" in output

    from OCP.IFSelect import IFSelect_RetDone
    from OCP.STEPControl import STEPControl_Reader

    reader = STEPControl_Reader()
    assert reader.ReadStream("model.step", io.BytesIO(output)) == IFSelect_RetDone
    assert reader.NbRootsForTransfer() == 2

