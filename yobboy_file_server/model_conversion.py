from __future__ import annotations

import io
from collections.abc import Iterable


from .step_export import StepExportError, export_scene_step


SUPPORTED_MODEL_EXPORT_FORMATS = ("stl", "3mf", "step")


class ModelConversionError(RuntimeError):
    pass


def normalize_export_formats(formats: Iterable[str] | None) -> tuple[str, ...]:
    requested = {str(value or "").strip().lower() for value in (formats or ())}
    unsupported = requested.difference(SUPPORTED_MODEL_EXPORT_FORMATS)
    if unsupported:
        names = ", ".join(sorted(unsupported))
        raise ModelConversionError(f"不支持的导出格式：{names}")
    return tuple(name for name in SUPPORTED_MODEL_EXPORT_FORMATS if name in requested)


def convert_glb(glb_bytes: bytes, formats: Iterable[str] | None) -> dict[str, bytes]:
    requested = normalize_export_formats(formats)
    if not requested:
        return {}

    try:
        import trimesh
    except ImportError as exc:
        raise ModelConversionError("缺少 trimesh，无法导出 STL、3MF 或 STEP") from exc

    try:
        scene = trimesh.load_scene(io.BytesIO(glb_bytes), file_type="glb")
    except Exception as exc:
        raise ModelConversionError("GLB 模型无法转换") from exc
    if not scene.geometry:
        raise ModelConversionError("GLB 模型不包含可导出的网格")

    output: dict[str, bytes] = {}
    try:
        if "stl" in requested:
            mesh = scene.to_geometry()
            output["stl"] = bytes(mesh.export(file_type="stl"))
        if "3mf" in requested:
            output["3mf"] = bytes(scene.export(file_type="3mf"))
        if "step" in requested:
            output["step"] = export_scene_step(scene)
    except StepExportError as exc:
        raise ModelConversionError(str(exc)) from exc
    except Exception as exc:
        raise ModelConversionError("模型格式转换失败") from exc
    return output
