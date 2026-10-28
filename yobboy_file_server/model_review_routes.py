from __future__ import annotations

import json
import os
import posixpath
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterable, Tuple
from urllib.parse import quote

from flask import Response, current_app, jsonify, request

from .model_review_manager import ModelReviewManager, ModelReviewValidationError
from .model_conversion import ModelConversionError, convert_glb, normalize_export_formats
from .model_review_docx import resolve_model3d_template_path
from .model_review_report import (
    ModelReportValidationError,
    build_docx,
    build_pdf,
    build_zip,
    parse_report_request,
    read_validated_glb,
    read_validated_image,
    safe_download_stem,
)
from .paths import get_data_dir
from .step_export import StepExportError, export_glb_entities


LOADABLE_MODEL_EXTENSIONS = {".gltf", ".glb", ".obj", ".stl"}
FULL_REVIEW_EXTENSIONS = {".gltf", ".glb"}
PART_REVIEW_EXTENSIONS = {".gltf", ".glb", ".obj"}


@dataclass
class ModelFileError(ValueError):
    message: str
    status_code: int

    def __str__(self) -> str:
        return self.message


def resolve_model_file(
    root_dir: str,
    filepath: str,
    allowed_extensions: Iterable[str],
) -> Tuple[str, str, str]:
    if not root_dir:
        raise ModelFileError("未配置文件根目录", 404)

    raw_path = str(filepath or "").strip().replace("\\", "/")
    if not raw_path or raw_path.startswith("/") or "\x00" in raw_path:
        raise ModelFileError("模型路径无效", 400)

    normalized_path = posixpath.normpath(raw_path)
    if normalized_path in {"", "."} or normalized_path == ".." or normalized_path.startswith("../"):
        raise ModelFileError("模型路径无效", 400)

    root_path = os.path.realpath(root_dir)
    full_path = os.path.realpath(os.path.join(root_path, *normalized_path.split("/")))
    try:
        if os.path.commonpath([root_path, full_path]) != root_path:
            raise ModelFileError("模型路径超出文件根目录", 403)
    except ValueError as exc:
        raise ModelFileError("模型路径超出文件根目录", 403) from exc

    if not os.path.exists(full_path) or os.path.isdir(full_path):
        raise ModelFileError("模型文件不存在", 404)

    extension = os.path.splitext(full_path)[1].lower()
    if extension not in set(allowed_extensions):
        raise ModelFileError("不支持的 3D 模型格式", 400)

    return normalized_path, full_path, extension


def model_capabilities(extension: str) -> dict:
    extension = str(extension or "").lower()
    return {
        "loadable": extension in LOADABLE_MODEL_EXTENSIONS,
        "full_review": extension in FULL_REVIEW_EXTENSIONS,
        "parts": extension in PART_REVIEW_EXTENSIONS,
        "explode": extension in PART_REVIEW_EXTENSIONS,
        "annotations": extension in LOADABLE_MODEL_EXTENSIONS,
    }


def _get_manager() -> ModelReviewManager:
    manager = current_app.config.get("MODEL_REVIEW_MANAGER")
    if manager is not None:
        return manager

    data_dir = current_app.config.get("DATA_DIR") or get_data_dir()
    db_path = os.path.join(data_dir, "model_reviews", "model_reviews.sqlite3")
    manager = ModelReviewManager(db_path)
    current_app.config["MODEL_REVIEW_MANAGER"] = manager
    return manager


def register_model_review_routes(app, is_logged_in: Callable[[], bool]) -> None:
    def require_login():
        if is_logged_in():
            return None
        return jsonify({"success": False, "error": "未授权"}), 401

    def resolve_request_model(filepath: str):
        return resolve_model_file(
            current_app.config.get("ROOT_DIR", ""),
            filepath,
            LOADABLE_MODEL_EXTENSIONS,
        )

    def report_download(data: bytes, filename: str, partial: str | None = None):
        response = Response(data, mimetype="application/x-yobboy-model-review")
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Model-Review-Filename"] = quote(filename, safe="")
        if partial:
            response.headers["X-Model-Review-Partial"] = partial
        return response

    def model_download(data: bytes, filename: str, file_format: str):
        mimetypes = {
            "glb": "model/gltf-binary",
            "stl": "model/stl",
            "3mf": "model/3mf",
            "step": "model/step",
        }
        response = Response(data, mimetype=mimetypes[file_format])
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Model-Export-Filename"] = quote(filename, safe="")
        response.headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(filename, safe='')}"
        return response

    @app.route("/api/model-review/annotations", methods=["GET", "POST"])
    def model_review_annotations():
        unauthorized = require_login()
        if unauthorized:
            return unauthorized

        payload = request.get_json(silent=True) if request.method == "POST" else None
        filepath = request.args.get("path", "") if request.method == "GET" else str((payload or {}).get("path") or "")

        try:
            normalized_path, _, _ = resolve_request_model(filepath)
            manager = _get_manager()
            if request.method == "GET":
                return jsonify(
                    {
                        "success": True,
                        "annotations": manager.list_annotations(normalized_path),
                    }
                )

            annotation = manager.create_annotation(normalized_path, payload)
            return jsonify({"success": True, "annotation": annotation}), 201
        except ModelFileError as exc:
            return jsonify({"success": False, "error": str(exc)}), exc.status_code
        except ModelReviewValidationError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/model-review/annotations/<annotation_id>", methods=["PUT", "DELETE"])
    def model_review_annotation_detail(annotation_id: str):
        unauthorized = require_login()
        if unauthorized:
            return unauthorized

        payload = request.get_json(silent=True) if request.method == "PUT" else None
        filepath = str((payload or {}).get("path") or "") if request.method == "PUT" else request.args.get("path", "")

        try:
            normalized_path, _, _ = resolve_request_model(filepath)
            manager = _get_manager()
            existing = manager.get_annotation(annotation_id)
            if not existing or existing["model_path"] != normalized_path:
                return jsonify({"success": False, "error": "评论不存在"}), 404

            if request.method == "DELETE":
                manager.delete_annotation(annotation_id)
                return jsonify({"success": True})

            annotation = manager.update_annotation(annotation_id, payload)
            return jsonify({"success": True, "annotation": annotation})
        except ModelFileError as exc:
            return jsonify({"success": False, "error": str(exc)}), exc.status_code
        except ModelReviewValidationError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/model-review/reports", methods=["POST"])
    def model_review_reports():
        unauthorized = require_login()
        if unauthorized:
            return unauthorized

        raw_config = request.form.get("config", "")
        try:
            payload = json.loads(raw_config)
            if not isinstance(payload, dict):
                raise ValueError
            normalized_path, full_path, _ = resolve_request_model(str(payload.get("path") or ""))
            annotations = _get_manager().list_annotations(normalized_path)
            report_request = parse_report_request(raw_config, annotations)
            if report_request.path != normalized_path:
                raise ModelReportValidationError("模型路径必须使用规范化相对路径")

            preview_images = {
                view_id: read_validated_image(request.files.get(f"preview_{view_id}"), f"preview_{view_id}")
                for view_id, _ in report_request.views
            }
            annotation_images = {
                annotation["id"]: [
                    read_validated_image(
                        request.files.get(f"annotation_{annotation['id']}_{view_index}"),
                        f"annotation_{annotation['id']}_{view_index}",
                    )
                    for view_index in range(1, report_request.annotation_view_count + 1)
                ]
                for annotation in annotations
                if report_request.include_annotations
            }
            model_glb = read_validated_glb(request.files.get("model_glb")) if report_request.include_3d else None
            separate_model_files = []
            total_glb_bytes = len(model_glb or b"")
            for index, (name, max_dimension) in enumerate(report_request.separate_models):
                item_glb = read_validated_glb(request.files.get(f"separate_model_{index}"))
                poster = read_validated_image(
                    request.files.get(f"separate_poster_{index}"),
                    f"separate_poster_{index}",
                )
                total_glb_bytes += len(item_glb)
                if total_glb_bytes > 500 * 1024 * 1024:
                    raise ModelReportValidationError("Word 交互模型总大小不能超过 500 MB")
                separate_model_files.append((name, item_glb, poster, max_dimension))
        except ModelFileError as exc:
            return jsonify({"success": False, "error": str(exc)}), exc.status_code
        except (json.JSONDecodeError, TypeError, ValueError, ModelReportValidationError) as exc:
            return jsonify({"success": False, "error": str(exc) or "报告配置无效"}), 400

        stem = safe_download_stem(report_request.title)
        generated: dict[str, bytes] = {}
        partial_note = None
        try:
            if "pdf" in report_request.formats:
                generated[f"{stem}.pdf"] = build_pdf(
                    report_request,
                    os.path.basename(full_path),
                    preview_images,
                    annotations,
                    annotation_images,
                )

            if "docx" in report_request.formats:
                try:
                    template_path = (
                        resolve_model3d_template_path()
                        if report_request.include_3d
                        else None
                    )
                    generated[f"{stem}.docx"] = build_docx(
                        report_request,
                        os.path.basename(full_path),
                        preview_images,
                        annotations,
                        annotation_images,
                        model_glb,
                        template_path,
                        separate_model_files,
                    )
                except Exception as exc:
                    current_app.logger.exception("Failed to build model review DOCX")
                    if report_request.formats == ("docx",):
                        return jsonify({"success": False, "error": f"Word 报告生成失败：{exc}"}), 500
                    partial_note = f"Word 文档生成失败。\n\n原因：{exc}\n\nPDF 报告不受影响。"
        except Exception as exc:
            current_app.logger.exception("Failed to build model review report")
            return jsonify({"success": False, "error": f"报告生成失败：{exc}"}), 500

        if len(report_request.formats) > 1:
            return report_download(
                build_zip(generated, partial_note),
                f"{stem}.zip",
                "docx" if partial_note else None,
            )

        filename, data = next(iter(generated.items()))
        return report_download(data, filename)

    @app.route("/api/model-review/models/export", methods=["POST"])
    def model_review_model_export():
        unauthorized = require_login()
        if unauthorized:
            return unauthorized

        try:
            normalized_path, full_path, _ = resolve_request_model(request.form.get("path", ""))
            file_format = str(request.form.get("format") or "").strip().lower()
            if file_format != "glb":
                normalize_export_formats((file_format,))

            raw_entity_names = request.form.get("entity_names", "")
            entity_names = json.loads(raw_entity_names) if raw_entity_names else []
            if not isinstance(entity_names, list) or any(
                not isinstance(name, str) or not name.strip() for name in entity_names
            ):
                raise ModelReportValidationError("STEP 实体列表无效")
            if len(entity_names) > 64:
                raise ModelReportValidationError("一次最多导出 64 个 STEP 实体")

            if file_format == "step" and entity_names:
                entities = []
                total_bytes = 0
                for index, name in enumerate(entity_names):
                    entity_glb = read_validated_glb(request.files.get(f"entity_{index}"))
                    total_bytes += len(entity_glb)
                    if total_bytes > 500 * 1024 * 1024:
                        raise ModelReportValidationError("STEP 实体总大小不能超过 500 MB")
                    entities.append((name.strip(), entity_glb))
                output = export_glb_entities(entities)
            else:
                model_glb = read_validated_glb(request.files.get("model_glb"))
                output = model_glb if file_format == "glb" else convert_glb(
                    model_glb,
                    (file_format,),
                )[file_format]

            stem = safe_download_stem(Path(full_path).stem)
            return model_download(output, f"{stem}.{file_format}", file_format)
        except ModelFileError as exc:
            return jsonify({"success": False, "error": str(exc)}), exc.status_code
        except (
            json.JSONDecodeError,
            ModelConversionError,
            ModelReportValidationError,
            StepExportError,
            TypeError,
            ValueError,
        ) as exc:
            return jsonify({"success": False, "error": str(exc) or "模型导出配置无效"}), 400
