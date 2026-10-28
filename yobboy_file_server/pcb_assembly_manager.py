from __future__ import annotations

import asyncio
import json
import os
import posixpath
import re
import shutil
import stat
import tempfile
import threading
import time
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from .model_conversion import ModelConversionError, convert_glb, normalize_export_formats
from .step_export import StepExportError, export_glb_entities


PCB_RECEIVER_PORT = 8765
DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024
DEFAULT_MAX_EXTRACTED_BYTES = 500 * 1024 * 1024
DEFAULT_MAX_ARCHIVE_FILES = 512


class PcbAssemblyError(RuntimeError):
    pass


class PcbAssemblyValidationError(PcbAssemblyError):
    pass


class PcbAssemblyNotFoundError(PcbAssemblyError):
    pass


class PcbAssemblyConflictError(PcbAssemblyError):
    pass


def _is_under(root: Path, candidate: Path) -> bool:
    try:
        common = os.path.commonpath([str(root), str(candidate)])
        return os.path.normcase(common) == os.path.normcase(str(root))
    except ValueError:
        return False


def resolve_pcb_assembly_dir(root_dir: str, configured_dir: str | None, create: bool = False) -> Path:
    root = Path(root_dir or "").expanduser().resolve()
    if not root.is_dir():
        raise PcbAssemblyValidationError("文件服务器根目录不存在")

    raw_dir = str(configured_dir or "").strip()
    target = Path(raw_dir).expanduser() if raw_dir else root / "PCB装配"
    if not target.is_absolute():
        target = root / target
    target = target.resolve()
    if not _is_under(root, target):
        raise PcbAssemblyValidationError("PCB 装配目录必须位于文件服务器根目录内")
    if create:
        target.mkdir(parents=True, exist_ok=True)
    elif not target.is_dir():
        raise PcbAssemblyValidationError("PCB 装配目录不存在")
    return target


def _clean_filename(filename: str, allowed_extensions: set[str]) -> str:
    value = str(filename or "").replace("\\", "/").split("/")[-1].strip().rstrip(" .")
    if not value or value in {".", ".."} or "\x00" in value:
        raise PcbAssemblyValidationError("文件名无效")
    if len(value) > 180 or any(ord(char) < 32 for char in value):
        raise PcbAssemblyValidationError("文件名无效")
    if any(char in value for char in '<>:"|?*/\\'):
        raise PcbAssemblyValidationError("文件名包含非法字符")
    extension = Path(value).suffix.lower()
    if extension not in allowed_extensions:
        raise PcbAssemblyValidationError("仅支持 OBJ 或 ZIP 文件")
    return value


def _clean_glb_filename(filename: str) -> str:
    value = str(filename or "").strip().rstrip(" .")
    if not value:
        raise PcbAssemblyValidationError("保存名称不能为空")
    if not value.lower().endswith(".glb"):
        value += ".glb"
    if len(value) > 180 or any(ord(char) < 32 for char in value):
        raise PcbAssemblyValidationError("保存名称无效")
    if any(char in value for char in '<>:"|?*/\\'):
        raise PcbAssemblyValidationError("保存名称包含非法字符")
    return value


def _validate_glb_bytes(glb_bytes: bytes) -> None:
    if len(glb_bytes) < 12 or glb_bytes[:4] != b"glTF":
        raise PcbAssemblyValidationError("浏览器生成的文件不是有效 GLB")
    version = int.from_bytes(glb_bytes[4:8], "little")
    declared_length = int.from_bytes(glb_bytes[8:12], "little")
    if version != 2 or declared_length != len(glb_bytes):
        raise PcbAssemblyValidationError("GLB 版本或文件长度无效")


def _clean_export_component(value: str, fallback: str) -> str:
    name = Path(str(value or "").replace("\\", "/")).stem.strip().rstrip(" .")
    name = re.sub(r'[<>:"|?*/\\\x00-\x1f]+', "_", name)
    name = re.sub(r"\s+", " ", name).strip().rstrip(" .")
    return (name or fallback)[:80].rstrip(" .")


def _unique_export_stem(base_stem: str, item_name: str, index: int, used: set[str]) -> str:
    component = _clean_export_component(item_name, f"板子{index}")
    suffix_index = 1
    while True:
        suffix = "" if suffix_index == 1 else f"_{suffix_index}"
        available = 176 - len(suffix)
        candidate = f"{base_stem}_{component}"[:available].rstrip(" ._") + suffix
        key = candidate.casefold()
        if key not in used:
            used.add(key)
            return candidate
        suffix_index += 1


def _copy_item(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item["id"],
        "name": item["name"],
        "source_filename": item["source_filename"],
        "created_at": item["created_at"],
        "models": [dict(model) for model in item["models"]],
    }


class PcbAssemblyManager:
    def __init__(
        self,
        data_dir: str,
        root_dir: str,
        save_dir: str | None = None,
        main_port: int = 5000,
        receiver_port: int = PCB_RECEIVER_PORT,
        lease_timeout: float = 30.0,
        max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
        max_extracted_bytes: int = DEFAULT_MAX_EXTRACTED_BYTES,
        max_archive_files: int = DEFAULT_MAX_ARCHIVE_FILES,
    ):
        self.data_dir = Path(data_dir).expanduser().resolve()
        self.root_dir = Path(root_dir).expanduser().resolve()
        self.save_dir = str(save_dir or "")
        self.main_port = int(main_port)
        self.receiver_port = int(receiver_port)
        self.lease_timeout = max(float(lease_timeout), 0.1)
        self.max_upload_bytes = int(max_upload_bytes)
        self.max_extracted_bytes = int(max_extracted_bytes)
        self.max_archive_files = int(max_archive_files)

        self.sessions_root = self.data_dir / "pcb_assembly" / "sessions"
        self.sessions_root.mkdir(parents=True, exist_ok=True)
        self._sessions: dict[str, dict[str, Any]] = {}
        self._lock = threading.RLock()
        self._receiver_thread: threading.Thread | None = None
        self._receiver_stop_event: threading.Event | None = None
        self._receiver_ready_event: threading.Event | None = None
        self._receiver_session_id: str | None = None
        self._receiver_heartbeat = 0.0
        self._receiver_error = ""

    def create_session(self) -> dict[str, Any]:
        session_id = str(uuid.uuid4())
        session_dir = self.sessions_root / session_id
        session_dir.mkdir(parents=True, exist_ok=False)
        session = {
            "id": session_id,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "dir": session_dir,
            "items": {},
            "revision": 0,
        }
        with self._lock:
            self._sessions[session_id] = session
        return {"id": session_id, "created_at": session["created_at"]}

    def _get_session(self, session_id: str) -> dict[str, Any]:
        with self._lock:
            session = self._sessions.get(str(session_id or ""))
        if session is None:
            raise PcbAssemblyNotFoundError("装配会话不存在或已经结束")
        return session

    def list_items(self, session_id: str) -> dict[str, Any]:
        session = self._get_session(session_id)
        with self._lock:
            items = [_copy_item(item) for item in session["items"].values()]
            revision = int(session["revision"])
        return {"items": items, "revision": revision}

    def process_upload(self, session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        session = self._get_session(session_id)
        if not isinstance(payload, dict) or payload.get("type") != "file_upload":
            raise PcbAssemblyValidationError("不支持的 WebSocket 消息")

        filename = _clean_filename(payload.get("filename"), {".zip", ".obj"})
        data_values = payload.get("data")
        if not isinstance(data_values, list):
            raise PcbAssemblyValidationError("文件数据必须是字节数组")
        try:
            file_bytes = bytes(data_values)
        except (TypeError, ValueError) as exc:
            raise PcbAssemblyValidationError("文件数据包含无效字节") from exc

        try:
            declared_size = int(payload.get("size"))
        except (TypeError, ValueError) as exc:
            raise PcbAssemblyValidationError("文件大小无效") from exc
        if declared_size != len(file_bytes):
            raise PcbAssemblyValidationError("声明的文件大小与实际数据不一致")
        if not file_bytes or len(file_bytes) > self.max_upload_bytes:
            raise PcbAssemblyValidationError("文件为空或超过接收大小限制")

        item_id = str(uuid.uuid4())
        item_dir = Path(session["dir"]) / item_id
        source_dir = item_dir / "source"
        assets_dir = item_dir / "assets"
        source_dir.mkdir(parents=True, exist_ok=False)
        assets_dir.mkdir(parents=True, exist_ok=False)

        try:
            source_path = source_dir / filename
            source_path.write_bytes(file_bytes)
            if filename.lower().endswith(".zip"):
                self._extract_zip(source_path, assets_dir)
            else:
                shutil.copy2(source_path, assets_dir / filename)
            models = self._discover_models(assets_dir)
            if not models:
                raise PcbAssemblyValidationError("接收文件中没有找到 OBJ 模型")
        except Exception:
            shutil.rmtree(item_dir, ignore_errors=True)
            raise

        item = {
            "id": item_id,
            "name": Path(filename).stem,
            "source_filename": filename,
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "dir": item_dir,
            "assets_dir": assets_dir,
            "models": models,
        }
        with self._lock:
            session["items"][item_id] = item
            session["revision"] += 1
        return _copy_item(item)

    def _extract_zip(self, zip_path: Path, assets_dir: Path) -> None:
        try:
            archive = zipfile.ZipFile(zip_path, "r")
        except zipfile.BadZipFile as exc:
            raise PcbAssemblyValidationError("接收到的 ZIP 文件已损坏") from exc

        with archive:
            file_entries = [entry for entry in archive.infolist() if not entry.is_dir()]
            if not file_entries or len(file_entries) > self.max_archive_files:
                raise PcbAssemblyValidationError("ZIP 文件数量为空或超过限制")
            declared_total = sum(max(int(entry.file_size), 0) for entry in file_entries)
            if declared_total > self.max_extracted_bytes:
                raise PcbAssemblyValidationError("ZIP 解压后的总大小超过限制")

            extracted_total = 0
            for entry in file_entries:
                unix_mode = (entry.external_attr >> 16) & 0o170000
                if unix_mode == stat.S_IFLNK:
                    raise PcbAssemblyValidationError("ZIP 中不允许包含符号链接")

                raw_name = entry.filename.replace("\\", "/")
                normalized = posixpath.normpath(raw_name)
                if (
                    not normalized
                    or normalized in {".", ".."}
                    or normalized.startswith("../")
                    or normalized.startswith("/")
                    or re.match(r"^[A-Za-z]:", normalized)
                    or "\x00" in normalized
                ):
                    raise PcbAssemblyValidationError("ZIP 中包含越界路径")

                target = (assets_dir / Path(*normalized.split("/"))).resolve()
                if not _is_under(assets_dir.resolve(), target):
                    raise PcbAssemblyValidationError("ZIP 中包含越界路径")
                target.parent.mkdir(parents=True, exist_ok=True)
                temporary = target.with_name(f".{target.name}.extracting")
                try:
                    with archive.open(entry, "r") as source, open(temporary, "wb") as destination:
                        while True:
                            chunk = source.read(1024 * 1024)
                            if not chunk:
                                break
                            extracted_total += len(chunk)
                            if extracted_total > self.max_extracted_bytes:
                                raise PcbAssemblyValidationError("ZIP 解压后的总大小超过限制")
                            destination.write(chunk)
                    os.replace(temporary, target)
                finally:
                    if temporary.exists():
                        temporary.unlink()

    def _discover_models(self, assets_dir: Path) -> list[dict[str, str | None]]:
        models: list[dict[str, str | None]] = []
        for obj_path in sorted(assets_dir.rglob("*.obj"), key=lambda path: path.as_posix().lower()):
            relative_obj = obj_path.relative_to(assets_dir).as_posix()
            mtl_path = self._find_mtl_for_obj(obj_path, assets_dir)
            models.append(
                {
                    "obj_path": relative_obj,
                    "mtl_path": mtl_path.relative_to(assets_dir).as_posix() if mtl_path else None,
                }
            )
        return models

    @staticmethod
    def _find_mtl_for_obj(obj_path: Path, assets_dir: Path) -> Path | None:
        try:
            with open(obj_path, "r", encoding="utf-8", errors="ignore") as handle:
                for line in handle:
                    if not line.lower().startswith("mtllib "):
                        continue
                    raw_reference = line[7:].strip().strip('"\'')
                    reference = posixpath.normpath(raw_reference.replace("\\", "/"))
                    candidate = (obj_path.parent / Path(*reference.split("/"))).resolve()
                    if _is_under(assets_dir.resolve(), candidate) and candidate.is_file():
                        return candidate
        except OSError:
            pass
        fallback = obj_path.with_suffix(".mtl")
        return fallback if fallback.is_file() else None

    def resolve_asset(self, session_id: str, item_id: str, asset_path: str) -> Path:
        session = self._get_session(session_id)
        with self._lock:
            item = session["items"].get(item_id)
        if item is None:
            raise PcbAssemblyNotFoundError("PCB 模型不存在")
        raw_path = str(asset_path or "").replace("\\", "/")
        normalized = posixpath.normpath(raw_path)
        if not normalized or normalized in {".", ".."} or normalized.startswith("../"):
            raise PcbAssemblyValidationError("模型资源路径无效")
        assets_dir = Path(item["assets_dir"]).resolve()
        target = (assets_dir / Path(*normalized.split("/"))).resolve()
        if not _is_under(assets_dir, target):
            raise PcbAssemblyValidationError("模型资源路径越界")
        if not target.is_file():
            raise PcbAssemblyNotFoundError("模型资源不存在")
        return target

    def remove_item(self, session_id: str, item_id: str) -> None:
        session = self._get_session(session_id)
        with self._lock:
            item = session["items"].pop(item_id, None)
            if item is not None:
                session["revision"] += 1
        if item is None:
            raise PcbAssemblyNotFoundError("PCB 模型不存在")
        shutil.rmtree(item["dir"], ignore_errors=True)

    def save_glb(
        self,
        session_id: str,
        filename: str,
        glb_bytes: bytes,
        overwrite: bool = False,
        additional_formats: set[str] | list[str] | tuple[str, ...] | None = None,
        separate_models: list[tuple[str, bytes]] | None = None,
        step_glb_bytes: bytes | None = None,
        step_models: list[tuple[str, bytes]] | None = None,
    ) -> dict[str, Any]:
        self._get_session(session_id)
        clean_name = _clean_glb_filename(filename)
        _validate_glb_bytes(glb_bytes)
        separate_models = list(separate_models or ())
        step_models = list(step_models or ())
        for _item_name, item_glb in separate_models:
            _validate_glb_bytes(item_glb)
        if step_glb_bytes is not None:
            _validate_glb_bytes(step_glb_bytes)
        for _item_name, item_glb in step_models:
            _validate_glb_bytes(item_glb)

        try:
            export_formats = normalize_export_formats(additional_formats)
        except ModelConversionError as exc:
            raise PcbAssemblyValidationError(str(exc)) from exc

        save_dir = resolve_pcb_assembly_dir(str(self.root_dir), self.save_dir, create=True)
        stem = clean_name[:-4]
        format_names = ("glb", *export_formats)
        models = [
            {
                "scope": "assembly",
                "item_name": None,
                "stem": stem,
                "glb": glb_bytes,
            }
        ]
        used_stems = {stem.casefold()}
        for index, (item_name, item_glb) in enumerate(separate_models, start=1):
            models.append(
                {
                    "scope": "item",
                    "item_name": item_name,
                    "stem": _unique_export_stem(stem, item_name, index, used_stems),
                    "glb": item_glb,
                }
            )

        targets = []
        for model in models:
            for file_format in format_names:
                targets.append(
                    {
                        **model,
                        "format": file_format,
                        "path": (save_dir / f"{model['stem']}.{file_format}").resolve(),
                    }
                )
        if any(not _is_under(save_dir, target["path"]) for target in targets):
            raise PcbAssemblyValidationError("保存路径越界")
        conflicts = [
            f"{target['path'].stem}.{target['format'].upper()}"
            for target in targets
            if target["path"].exists()
        ]
        if conflicts and not overwrite:
            raise PcbAssemblyConflictError(f"同名文件已存在：{'、'.join(conflicts)}")

        contents: dict[str, dict[str, bytes]] = {}
        for model in models:
            try:
                model_formats = export_formats
                converted = {}
                if model["scope"] == "assembly" and "step" in export_formats:
                    model_formats = tuple(name for name in export_formats if name != "step")
                    if step_models:
                        converted["step"] = export_glb_entities(step_models)
                    else:
                        converted["step"] = convert_glb(
                            step_glb_bytes or model["glb"],
                            ("step",),
                        )["step"]
                converted.update(convert_glb(model["glb"], model_formats))
            except StepExportError as exc:
                raise PcbAssemblyValidationError(str(exc)) from exc
            except ModelConversionError as exc:
                raise PcbAssemblyValidationError(str(exc)) from exc
            contents[model["stem"]] = {"glb": model["glb"], **converted}
        temporary_files: list[tuple[Path, Path]] = []
        try:
            for target in targets:
                target_path = target["path"]
                descriptor, temporary_name = tempfile.mkstemp(
                    prefix=f".{target_path.name}.", suffix=".saving", dir=save_dir
                )
                os.close(descriptor)
                temporary = Path(temporary_name)
                temporary.write_bytes(contents[target["stem"]][target["format"]])
                temporary_files.append((temporary, target_path))
            for temporary, target_path in temporary_files:
                os.replace(temporary, target_path)
        finally:
            for temporary, _target in temporary_files:
                if temporary.exists():
                    temporary.unlink()

        files = [
            {
                "format": target["format"],
                "filename": target["path"].name,
                "relative_path": target["path"].relative_to(self.root_dir).as_posix(),
                "scope": target["scope"],
                **({"item_name": target["item_name"]} if target["item_name"] else {}),
            }
            for target in targets
        ]

        return {
            "filename": clean_name,
            "relative_path": files[0]["relative_path"],
            "files": files,
        }

    def start_receiver(self, session_id: str) -> dict[str, Any]:
        self._get_session(session_id)
        if self.main_port == self.receiver_port:
            raise PcbAssemblyConflictError("主服务器正在使用 8765 端口，请先修改主服务器端口")

        with self._lock:
            if self._receiver_thread and self._receiver_thread.is_alive():
                if self._receiver_session_id == session_id:
                    self._receiver_heartbeat = time.monotonic()
                    return self.receiver_status()
                raise PcbAssemblyConflictError("8765 端口正在被另一个装配会话使用")
            self._receiver_session_id = session_id
            self._receiver_heartbeat = time.monotonic()
            self._receiver_error = ""
            self._receiver_stop_event = threading.Event()
            self._receiver_ready_event = threading.Event()
            thread = threading.Thread(
                target=self._run_receiver,
                args=(session_id, self._receiver_stop_event, self._receiver_ready_event),
                name="pcb-assembly-receiver",
                daemon=True,
            )
            self._receiver_thread = thread
            thread.start()

        if not self._receiver_ready_event.wait(timeout=5):
            self.stop_receiver(session_id)
            raise PcbAssemblyConflictError("PCB 接收器启动超时")
        with self._lock:
            error = self._receiver_error
        if error:
            self.stop_receiver(session_id)
            raise PcbAssemblyConflictError(error)
        return self.receiver_status()

    def _run_receiver(
        self,
        session_id: str,
        stop_event: threading.Event,
        ready_event: threading.Event,
    ) -> None:
        try:
            from websockets.asyncio.server import serve
        except ImportError:
            with self._lock:
                self._receiver_error = "缺少 websockets 依赖，请重新安装 requirements.txt"
            ready_event.set()
            return

        async def connection_handler(websocket, path=None):
            await websocket.send(
                json.dumps(
                    {"type": "connection_established", "message": "已连接到 PCB 装配接收器"},
                    ensure_ascii=False,
                )
            )
            async for raw_message in websocket:
                try:
                    if not isinstance(raw_message, str):
                        raise PcbAssemblyValidationError("接收器仅支持 JSON 文本消息")
                    payload = json.loads(raw_message)
                    await websocket.send(
                        json.dumps(
                            {"type": "upload_progress", "progress": 50, "status": "正在校验文件"},
                            ensure_ascii=False,
                        )
                    )
                    item = await asyncio.to_thread(self.process_upload, session_id, payload)
                    await websocket.send(
                        json.dumps(
                            {"type": "upload_progress", "progress": 100, "status": "文件接收完成"},
                            ensure_ascii=False,
                        )
                    )
                    await websocket.send(
                        json.dumps(
                            {
                                "type": "upload_complete",
                                "message": "PCB 已加入装配会话",
                                "item_id": item["id"],
                            },
                            ensure_ascii=False,
                        )
                    )
                except (json.JSONDecodeError, PcbAssemblyError, ValueError) as exc:
                    await websocket.send(
                        json.dumps({"type": "error", "message": str(exc)}, ensure_ascii=False)
                    )

        async def run_server():
            try:
                async with serve(
                    connection_handler,
                    "localhost",
                    self.receiver_port,
                    max_size=max(self.max_upload_bytes * 5, 16 * 1024 * 1024),
                ):
                    ready_event.set()
                    while not stop_event.is_set():
                        with self._lock:
                            heartbeat = self._receiver_heartbeat
                        if time.monotonic() - heartbeat > self.lease_timeout:
                            break
                        await asyncio.sleep(min(0.1, self.lease_timeout / 2))
            except OSError as exc:
                with self._lock:
                    self._receiver_error = f"无法监听 localhost:{self.receiver_port}：{exc}"
                ready_event.set()

        try:
            asyncio.run(run_server())
        finally:
            ready_event.set()
            with self._lock:
                if self._receiver_session_id == session_id:
                    self._receiver_session_id = None
                    self._receiver_thread = None
                    self._receiver_stop_event = None

    def heartbeat(self, session_id: str) -> dict[str, Any]:
        self._get_session(session_id)
        with self._lock:
            if self._receiver_session_id != session_id:
                raise PcbAssemblyConflictError("当前装配会话没有启动接收")
            self._receiver_heartbeat = time.monotonic()
        return self.receiver_status()

    def stop_receiver(self, session_id: str | None = None) -> dict[str, Any]:
        with self._lock:
            active_session_id = self._receiver_session_id
            if session_id and active_session_id and active_session_id != session_id:
                raise PcbAssemblyConflictError("8765 端口属于另一个装配会话")
            stop_event = self._receiver_stop_event
            thread = self._receiver_thread
            if stop_event:
                stop_event.set()
        if thread and thread is not threading.current_thread():
            thread.join(timeout=3)
        return self.receiver_status()

    def receiver_status(self) -> dict[str, Any]:
        with self._lock:
            listening = bool(self._receiver_thread and self._receiver_thread.is_alive() and not self._receiver_error)
            return {
                "listening": listening,
                "port": self.receiver_port,
                "session_id": self._receiver_session_id if listening else None,
                "error": self._receiver_error,
            }

    def close_session(self, session_id: str) -> None:
        session = self._get_session(session_id)
        with self._lock:
            is_active = self._receiver_session_id == session_id
        if is_active:
            self.stop_receiver(session_id)
        with self._lock:
            self._sessions.pop(session_id, None)
        shutil.rmtree(session["dir"], ignore_errors=True)


__all__ = [
    "PCB_RECEIVER_PORT",
    "PcbAssemblyConflictError",
    "PcbAssemblyManager",
    "PcbAssemblyNotFoundError",
    "PcbAssemblyValidationError",
    "resolve_pcb_assembly_dir",
]
