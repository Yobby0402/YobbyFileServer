from __future__ import annotations

import configparser
import os
import sys
from typing import Optional


def project_base_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def package_dir() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def project_path(*parts: str) -> str:
    return os.path.join(project_base_dir(), *parts)


def config_path() -> str:
    return project_path("config.ini")


def resolve_path(path: str, base_dir: Optional[str] = None) -> str:
    path = (path or "").strip()
    root = base_dir or project_base_dir()
    if not path:
        return os.path.normpath(root)
    if os.path.isabs(path):
        return os.path.normpath(path)
    return os.path.normpath(os.path.join(root, path.replace("/", os.sep)))


def _read_settings_path(setting_name: str, config_file: Optional[str] = None) -> str:
    ini_path = config_file or config_path()
    parser = configparser.ConfigParser()
    if not os.path.exists(ini_path):
        return ""
    try:
        parser.read(ini_path, encoding="utf-8")
    except Exception:
        parser.read(ini_path)
    if not parser.has_section("settings"):
        return ""
    return str(parser["settings"].get(setting_name) or "").strip()


def get_data_dir(config_file: Optional[str] = None, create: bool = True) -> str:
    base_dir = project_base_dir()
    raw_path = _read_settings_path("data_dir", config_file=config_file)
    data_dir = resolve_path(raw_path or "data", base_dir=base_dir)
    if create:
        os.makedirs(data_dir, exist_ok=True)
    return data_dir


def get_data_path(*parts: str, config_file: Optional[str] = None, create_parent: bool = False) -> str:
    data_dir = get_data_dir(config_file=config_file, create=True)
    if not parts:
        return data_dir
    path = os.path.join(data_dir, *parts)
    if create_parent:
        os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def get_logs_dir(config_file: Optional[str] = None, create: bool = True) -> str:
    base_dir = project_base_dir()
    raw_path = _read_settings_path("log_dir", config_file=config_file)
    logs_dir = resolve_path(raw_path or "logs", base_dir=base_dir)
    if create:
        os.makedirs(logs_dir, exist_ok=True)
    return logs_dir


def get_logs_path(*parts: str, config_file: Optional[str] = None, create_parent: bool = False) -> str:
    logs_dir = get_logs_dir(config_file=config_file, create=True)
    if not parts:
        return logs_dir
    path = os.path.join(logs_dir, *parts)
    if create_parent:
        os.makedirs(os.path.dirname(path), exist_ok=True)
    return path
