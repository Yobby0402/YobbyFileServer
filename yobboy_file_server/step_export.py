from __future__ import annotations

import io
from collections.abc import Iterable


class StepExportError(RuntimeError):
    pass


def export_scene_step(scene) -> bytes:
    entities = []
    for node_name in scene.graph.nodes_geometry:
        transform, geometry_name = scene.graph[node_name]
        mesh = scene.geometry.get(geometry_name)
        if mesh is None:
            continue
        entities.append((str(node_name or geometry_name or "Model"), [(mesh, transform)]))
    return _write_step_entities(entities)


def export_glb_entities(models: Iterable[tuple[str, bytes]]) -> bytes:
    try:
        import trimesh
    except ImportError as exc:
        raise StepExportError("缺少 trimesh，无法读取 STEP 导出模型") from exc

    entities = []
    for entity_name, glb_bytes in models:
        try:
            scene = trimesh.load_scene(io.BytesIO(glb_bytes), file_type="glb")
        except Exception as exc:
            raise StepExportError("STEP 导出的 GLB 模型无法读取") from exc
        meshes = []
        for node_name in scene.graph.nodes_geometry:
            transform, geometry_name = scene.graph[node_name]
            mesh = scene.geometry.get(geometry_name)
            if mesh is not None:
                meshes.append((mesh, transform))
        entities.append((str(entity_name or "Model"), meshes))
    return _write_step_entities(entities)


def _write_step_entities(entities) -> bytes:
    try:
        import numpy as np
        from OCP.BRep import BRep_Builder
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_MakePolygon
        from OCP.IFSelect import IFSelect_RetDone
        from OCP.STEPCAFControl import STEPCAFControl_Writer
        from OCP.STEPControl import STEPControl_AsIs
        from OCP.TCollection import TCollection_ExtendedString
        from OCP.TDataStd import TDataStd_Name
        from OCP.TDocStd import TDocStd_Document
        from OCP.TopoDS import TopoDS_Compound
        from OCP.XCAFDoc import XCAFDoc_DocumentTool
        from OCP.gp import gp_Pnt
    except ImportError as exc:
        raise StepExportError("缺少 cadquery-ocp，无法导出 STEP") from exc

    document = TDocStd_Document(TCollection_ExtendedString("XmlXCAF"))
    shape_tool = XCAFDoc_DocumentTool.ShapeTool_s(document.Main())
    exported_entities = 0

    for index, (raw_name, meshes) in enumerate(entities, start=1):
        builder = BRep_Builder()
        compound = TopoDS_Compound()
        builder.MakeCompound(compound)
        face_count = 0

        for mesh, transform in meshes:
            vertices = np.asarray(mesh.vertices, dtype=float)
            faces = np.asarray(mesh.faces, dtype=int)
            if not len(vertices) or not len(faces):
                continue
            homogeneous = np.column_stack((vertices, np.ones(len(vertices))))
            transformed = (np.asarray(transform, dtype=float) @ homogeneous.T).T[:, :3]
            for triangle in faces:
                points = transformed[triangle]
                if np.linalg.norm(np.cross(points[1] - points[0], points[2] - points[0])) <= 1e-12:
                    continue
                polygon = BRepBuilderAPI_MakePolygon(
                    gp_Pnt(*map(float, points[0])),
                    gp_Pnt(*map(float, points[1])),
                    gp_Pnt(*map(float, points[2])),
                    True,
                )
                if not polygon.IsDone():
                    continue
                face = BRepBuilderAPI_MakeFace(polygon.Wire())
                if face.IsDone():
                    builder.Add(compound, face.Face())
                    face_count += 1

        if not face_count:
            continue
        label = shape_tool.AddShape(compound, False)
        name = str(raw_name or f"Model {index}").strip()[:160] or f"Model {index}"
        TDataStd_Name.Set_s(label, TCollection_ExtendedString(name))
        exported_entities += 1

    if not exported_entities:
        raise StepExportError("模型不包含可导出的三角面")

    writer = STEPCAFControl_Writer()
    writer.SetNameMode(True)
    if not writer.Transfer(document, STEPControl_AsIs):
        raise StepExportError("STEP 模型转换失败")
    output = io.BytesIO()
    if writer.WriteStream(output) != IFSelect_RetDone:
        raise StepExportError("STEP 文件写入失败")
    return output.getvalue()


__all__ = ["StepExportError", "export_glb_entities", "export_scene_step"]
