"""
本地 AI 目录：项目下 AI/skills（模型专用 Skill）、AI/models（权重与 Hugging Face 缓存）。
"""
from __future__ import annotations

import configparser
import os
import sys
from typing import Any, Mapping, Optional, Tuple

from .paths import get_data_path, project_base_dir


def ai_root() -> str:
    return os.path.join(project_base_dir(), "AI")


def default_skills_dir() -> str:
    return os.path.join(ai_root(), "skills")


def default_models_dir() -> str:
    return os.path.join(ai_root(), "models")


def default_hf_home() -> str:
    return os.path.join(default_models_dir(), "huggingface")


def default_knowledge_storage_dir() -> str:
    return get_data_path("local_ai")


def ensure_ai_layout() -> None:
    os.makedirs(default_skills_dir(), exist_ok=True)
    os.makedirs(default_models_dir(), exist_ok=True)


def resolve_project_path(path: str, base: Optional[str] = None) -> str:
    """相对路径相对于项目根（main 同级目录），绝对路径原样规范化。"""
    path = (path or "").strip()
    if not path:
        return ""
    root = base if base is not None else project_base_dir()
    if os.path.isabs(path):
        return os.path.normpath(path)
    return os.path.normpath(os.path.join(root, path.replace("/", os.sep)))


def resolve_knowledge_storage_dir(path: str, base: Optional[str] = None) -> str:
    if (path or "").strip():
        return resolve_project_path(path, base)
    return os.path.normpath(default_knowledge_storage_dir())


def _current_flask_local_ai_config() -> Tuple[Optional[Mapping[str, Any]], str]:
    try:
        from flask import current_app, has_app_context
    except Exception:
        return None, ""
    if not has_app_context():
        return None, ""
    return current_app.config, str(current_app.config.get("CONFIG_FILE") or "")


def knowledge_storage_dir(
    app_config: Optional[Mapping[str, Any]] = None,
    *,
    config_file: Optional[str] = None,
) -> str:
    cfg = app_config
    if cfg is None:
        cfg, current_config_file = _current_flask_local_ai_config()
        if not config_file:
            config_file = current_config_file

    raw_path = ""
    if cfg is not None:
        raw_path = str(cfg.get("LOCAL_AI_KB_STORAGE_DIR") or "").strip()

    if not raw_path:
        ini_path = config_file or os.path.join(project_base_dir(), "config.ini")
        parser = configparser.ConfigParser()
        if os.path.exists(ini_path):
            try:
                parser.read(ini_path, encoding="utf-8")
            except Exception:
                parser.read(ini_path)
        if parser.has_section("local_ai"):
            raw_path = str(parser["local_ai"].get("knowledge_storage_dir") or "").strip()

    resolved = resolve_knowledge_storage_dir(raw_path)
    os.makedirs(resolved, exist_ok=True)
    return resolved


def knowledge_storage_path(
    *parts: str,
    app_config: Optional[Mapping[str, Any]] = None,
    config_file: Optional[str] = None,
) -> str:
    base = knowledge_storage_dir(app_config=app_config, config_file=config_file)
    if not parts:
        return base
    return os.path.join(base, *parts)


def resolve_model_from_user_dir(home: str) -> Tuple[str, str]:
    """
    在用户选定的目录中自动查找模型。
    返回 (transformers 本地目录路径, gguf 文件路径)，二者最多一个非空。

    当前项目以 GGUF 为主：
    1. 当前目录下 .gguf 优先
    2. 一层子目录中的 .gguf
    3. 当前目录含 config.json
    4. 一层子目录含 config.json
    """
    home = os.path.normpath(home)
    if not home or not os.path.isdir(home):
        return "", ""

    def has_config(d: str) -> bool:
        return os.path.isfile(os.path.join(d, "config.json"))

    try:
        root_ggufs = sorted(
            f
            for f in os.listdir(home)
            if f.lower().endswith(".gguf") and os.path.isfile(os.path.join(home, f))
        )
    except OSError:
        return "", ""

    sub_gguf_paths: list[str] = []
    sub_with_config: list[str] = []
    try:
        for name in sorted(os.listdir(home)):
            sub = os.path.join(home, name)
            if not os.path.isdir(sub):
                continue
            try:
                for f in sorted(os.listdir(sub)):
                    if f.lower().endswith(".gguf") and os.path.isfile(os.path.join(sub, f)):
                        sub_gguf_paths.append(os.path.join(sub, f))
                        break
            except OSError:
                pass
            if has_config(sub):
                sub_with_config.append(sub)
    except OSError:
        return "", ""

    if root_ggufs:
        return "", os.path.join(home, root_ggufs[0])

    if sub_gguf_paths:
        return "", sorted(sub_gguf_paths)[0]

    if has_config(home):
        return home, ""

    if sub_with_config:
        return sub_with_config[0], ""

    return "", ""


def pick_single_gguf(models_dir: str) -> str:
    """若目录内仅有一个 .gguf，返回其绝对路径，否则返回空字符串。"""
    if not models_dir or not os.path.isdir(models_dir):
        return ""
    try:
        names = sorted(
            f for f in os.listdir(models_dir) if f.lower().endswith(".gguf") and os.path.isfile(os.path.join(models_dir, f))
        )
    except OSError:
        return ""
    if len(names) != 1:
        return ""
    return os.path.join(models_dir, names[0])
