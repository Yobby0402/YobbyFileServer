from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

from flask import current_app, jsonify, redirect, render_template, request, send_file, url_for

from .paths import get_data_dir
from .pcb_assembly_manager import (
    PCB_RECEIVER_PORT,
    PcbAssemblyConflictError,
    PcbAssemblyManager,
    PcbAssemblyNotFoundError,
    PcbAssemblyValidationError,
    resolve_pcb_assembly_dir,
)


MAX_SAVED_GLB_BYTES = 300 * 1024 * 1024
MAX_TOTAL_SAVED_GLB_BYTES = 600 * 1024 * 1024


def _get_manager() -> PcbAssemblyManager:
    manager = current_app.config.get("PCB_ASSEMBLY_MANAGER")
    if manager is not None:
        return manager
    manager = PcbAssemblyManager(
        data_dir=current_app.config.get("DATA_DIR") or get_data_dir(),
        root_dir=current_app.config.get("ROOT_DIR", ""),
        save_dir=current_app.config.get("PCB_ASSEMBLY_DIR", ""),
        main_port=current_app.config.get("PORT", 5000),
        receiver_port=PCB_RECEIVER_PORT,
    )
    current_app.config["PCB_ASSEMBLY_MANAGER"] = manager
    return manager


def register_pcb_assembly_routes(app, is_logged_in: Callable[[], bool]) -> None:
    def require_api_login():
        if is_logged_in():
            return None
        return jsonify({"success": False, "error": "未授权"}), 401

    def handle_error(exc: Exception):
        if isinstance(exc, PcbAssemblyNotFoundError):
            return jsonify({"success": False, "error": str(exc)}), 404
        if isinstance(exc, PcbAssemblyConflictError):
            return jsonify({"success": False, "error": str(exc)}), 409
        if isinstance(exc, PcbAssemblyValidationError):
            return jsonify({"success": False, "error": str(exc)}), 400
        raise exc

    @app.route("/pcb-assembly")
    def pcb_assembly_workspace():
        if not is_logged_in():
            return redirect(url_for("login"))
        root_dir = current_app.config.get("ROOT_DIR", "")
        configured_dir = current_app.config.get("PCB_ASSEMBLY_DIR", "")
        try:
            save_dir = resolve_pcb_assembly_dir(root_dir, configured_dir, create=True)
            relative_save_dir = save_dir.relative_to(Path(root_dir).resolve()).as_posix()
            return_path = relative_save_dir
            directory_error = ""
        except PcbAssemblyValidationError as exc:
            save_dir = Path(configured_dir or root_dir)
            relative_save_dir = ""
            return_path = ""
            directory_error = str(exc)

        return render_template(
            "pcb_assembly.html",
            save_directory=str(save_dir),
            directory_error=directory_error,
            config={
                "receiverPort": PCB_RECEIVER_PORT,
                "mainPort": int(current_app.config.get("PORT", 5000)),
                "saveDirectory": str(save_dir),
                "saveDirectoryRelative": relative_save_dir,
                "fileBrowserUrl": url_for("file_browser", path=return_path) if return_path else url_for("file_browser"),
                "sessionUrl": url_for("pcb_assembly_sessions"),
            },
        )

    @app.route("/api/pcb-assembly/sessions", methods=["POST"])
    def pcb_assembly_sessions():
        unauthorized = require_api_login()
        if unauthorized:
            return unauthorized
        session_data = _get_manager().create_session()
        return jsonify({"success": True, "session": session_data}), 201

    @app.route("/api/pcb-assembly/sessions/<session_id>/receiver/start", methods=["POST"])
    def pcb_assembly_receiver_start(session_id: str):
        unauthorized = require_api_login()
        if unauthorized:
            return unauthorized
        try:
            status = _get_manager().start_receiver(session_id)
            return jsonify({"success": True, "receiver": status})
        except (PcbAssemblyConflictError, PcbAssemblyNotFoundError, PcbAssemblyValidationError) as exc:
            return handle_error(exc)

    @app.route("/api/pcb-assembly/sessions/<session_id>/receiver/stop", methods=["POST"])
    def pcb_assembly_receiver_stop(session_id: str):
        unauthorized = require_api_login()
        if unauthorized:
            return unauthorized
        try:
            _get_manager()._get_session(session_id)
            status = _get_manager().stop_receiver(session_id)
            return jsonify({"success": True, "receiver": status})
        except (PcbAssemblyConflictError, PcbAssemblyNotFoundError) as exc:
            return handle_error(exc)

    @app.route("/api/pcb-assembly/sessions/<session_id>/heartbeat", methods=["POST"])
    def pcb_assembly_heartbeat(session_id: str):
        unauthorized = require_api_login()
        if unauthorized:
            return unauthorized
        try:
            status = _get_manager().heartbeat(session_id)
            return jsonify({"success": True, "receiver": status})
        except (PcbAssemblyConflictError, PcbAssemblyNotFoundError) as exc:
            return handle_error(exc)

    @app.route("/api/pcb-assembly/sessions/<session_id>/items")
    def pcb_assembly_items(session_id: str):
        unauthorized = require_api_login()
        if unauthorized:
            return unauthorized
        try:
            result = _get_manager().list_items(session_id)
            for item in result["items"]:
                for model in item["models"]:
                    model["obj_url"] = url_for(
                        "pcb_assembly_asset",
                        session_id=session_id,
                        item_id=item["id"],
                        asset_path=model["obj_path"],
                    )
                    model["mtl_url"] = (
                        url_for(
                            "pcb_assembly_asset",
                            session_id=session_id,
                            item_id=item["id"],
                            asset_path=model["mtl_path"],
                        )
                        if model.get("mtl_path")
                        else None
                    )
            return jsonify({"success": True, **result})
        except PcbAssemblyNotFoundError as exc:
            return handle_error(exc)

    @app.route("/api/pcb-assembly/sessions/<session_id>/assets/<item_id>/<path:asset_path>")
    def pcb_assembly_asset(session_id: str, item_id: str, asset_path: str):
        unauthorized = require_api_login()
        if unauthorized:
            return unauthorized
        try:
            path = _get_manager().resolve_asset(session_id, item_id, asset_path)
            response = send_file(path, conditional=True)
            response.headers["Cache-Control"] = "no-store"
            return response
        except (PcbAssemblyNotFoundError, PcbAssemblyValidationError) as exc:
            return handle_error(exc)

    @app.route("/api/pcb-assembly/sessions/<session_id>/items/<item_id>", methods=["DELETE"])
    def pcb_assembly_item_delete(session_id: str, item_id: str):
        unauthorized = require_api_login()
        if unauthorized:
            return unauthorized
        try:
            _get_manager().remove_item(session_id, item_id)
            return jsonify({"success": True})
        except (PcbAssemblyNotFoundError, PcbAssemblyValidationError) as exc:
            return handle_error(exc)

    @app.route("/api/pcb-assembly/sessions/<session_id>/save", methods=["POST"])
    def pcb_assembly_save(session_id: str):
        unauthorized = require_api_login()
        if unauthorized:
            return unauthorized
        upload = request.files.get("model_glb")
        if upload is None:
            return jsonify({"success": False, "error": "缺少 GLB 文件"}), 400
        glb_bytes = upload.stream.read(MAX_SAVED_GLB_BYTES + 1)
        if len(glb_bytes) > MAX_SAVED_GLB_BYTES:
            return jsonify({"success": False, "error": "GLB 文件超过 300 MB 限制"}), 413
        overwrite = str(request.form.get("overwrite") or "").strip().lower() in {"1", "true", "yes"}
        try:
            additional_formats = json.loads(request.form.get("additional_formats") or "[]")
        except json.JSONDecodeError:
            return jsonify({"success": False, "error": "附加导出格式无效"}), 400
        if not isinstance(additional_formats, list):
            return jsonify({"success": False, "error": "附加导出格式无效"}), 400
        normalized_formats = {
            str(value or "").strip().lower() for value in additional_formats
        }
        try:
            separate_item_ids = json.loads(request.form.get("separate_item_ids") or "[]")
        except json.JSONDecodeError:
            return jsonify({"success": False, "error": "分别导出的板子列表无效"}), 400
        if not isinstance(separate_item_ids, list) or any(
            not isinstance(item_id, str) for item_id in separate_item_ids
        ):
            return jsonify({"success": False, "error": "分别导出的板子列表无效"}), 400

        manager = _get_manager()
        try:
            step_glb_bytes = None
            step_models = []
            try:
                step_item_ids = json.loads(request.form.get("step_item_ids") or "[]")
            except json.JSONDecodeError:
                raise PcbAssemblyValidationError("STEP 零件列表无效")
            if not isinstance(step_item_ids, list) or any(
                not isinstance(item_id, str) for item_id in step_item_ids
            ):
                raise PcbAssemblyValidationError("STEP 零件列表无效")

            session_items = None
            total_bytes = len(glb_bytes)
            if "step" in normalized_formats:
                if step_item_ids:
                    if len(step_item_ids) > 64 or len(set(step_item_ids)) != len(step_item_ids):
                        raise PcbAssemblyValidationError("STEP 零件列表无效")
                    session_items = manager.list_items(session_id)["items"]
                    items_by_id = {item["id"]: item for item in session_items}
                    if not set(step_item_ids).issubset(items_by_id):
                        raise PcbAssemblyValidationError("STEP 零件不属于当前装配")
                    for index, item_id in enumerate(step_item_ids):
                        item_upload = request.files.get(f"step_model_{index}")
                        if item_upload is None:
                            raise PcbAssemblyValidationError("缺少 STEP 零件 GLB 文件")
                        item_glb = item_upload.stream.read(MAX_SAVED_GLB_BYTES + 1)
                        if len(item_glb) > MAX_SAVED_GLB_BYTES:
                            raise PcbAssemblyValidationError("STEP 零件 GLB 超过 300 MB 限制")
                        total_bytes += len(item_glb)
                        step_models.append((items_by_id[item_id]["name"], item_glb))
                else:
                    step_upload = request.files.get("step_model_glb")
                    if step_upload is not None:
                        step_glb_bytes = step_upload.stream.read(MAX_SAVED_GLB_BYTES + 1)
                        if len(step_glb_bytes) > MAX_SAVED_GLB_BYTES:
                            raise PcbAssemblyValidationError("STEP 模型 GLB 超过 300 MB 限制")
                        total_bytes += len(step_glb_bytes)

            separate_models = []
            if separate_item_ids:
                if len(separate_item_ids) < 2 or len(separate_item_ids) > 64:
                    raise PcbAssemblyValidationError("分别导出仅适用于 2 至 64 块板子")
                session_items = session_items or manager.list_items(session_id)["items"]
                items_by_id = {item["id"]: item for item in session_items}
                if (
                    len(separate_item_ids) != len(items_by_id)
                    or len(set(separate_item_ids)) != len(separate_item_ids)
                    or set(separate_item_ids) != set(items_by_id)
                ):
                    raise PcbAssemblyValidationError("分别导出的板子必须与当前装配一致")
                for index, item_id in enumerate(separate_item_ids):
                    item_upload = request.files.get(f"separate_model_{index}")
                    if item_upload is None:
                        raise PcbAssemblyValidationError("缺少单独板子 GLB 文件")
                    item_glb = item_upload.stream.read(MAX_SAVED_GLB_BYTES + 1)
                    if len(item_glb) > MAX_SAVED_GLB_BYTES:
                        raise PcbAssemblyValidationError("单独板子 GLB 超过 300 MB 限制")
                    total_bytes += len(item_glb)
                    if total_bytes > MAX_TOTAL_SAVED_GLB_BYTES:
                        raise PcbAssemblyValidationError("本次保存的 GLB 总大小超过 600 MB 限制")
                    separate_models.append((items_by_id[item_id]["name"], item_glb))

            if total_bytes > MAX_TOTAL_SAVED_GLB_BYTES:
                raise PcbAssemblyValidationError("本次保存的 GLB 总大小超过 600 MB 限制")

            result = manager.save_glb(
                session_id,
                request.form.get("filename", ""),
                glb_bytes,
                overwrite=overwrite,
                additional_formats=additional_formats,
                separate_models=separate_models,
                step_glb_bytes=step_glb_bytes,
                step_models=step_models,
            )
            review_url = url_for("view_model", filepath=result["relative_path"])
            files = [
                {
                    **item,
                    "download_url": url_for("download_file", filepath=item["relative_path"]),
                }
                for item in result["files"]
            ]
            return (
                jsonify(
                    {
                        "success": True,
                        "filename": result["filename"],
                        "model_path": result["relative_path"],
                        "review_url": review_url,
                        "download_url": url_for("download_file", filepath=result["relative_path"]),
                        "files": files,
                    }
                ),
                201,
            )
        except (PcbAssemblyConflictError, PcbAssemblyNotFoundError, PcbAssemblyValidationError) as exc:
            return handle_error(exc)

    @app.route("/api/pcb-assembly/sessions/<session_id>/close", methods=["POST"])
    def pcb_assembly_close(session_id: str):
        unauthorized = require_api_login()
        if unauthorized:
            return unauthorized
        try:
            _get_manager().close_session(session_id)
            return jsonify({"success": True})
        except PcbAssemblyNotFoundError:
            return jsonify({"success": True})


__all__ = ["register_pcb_assembly_routes"]
