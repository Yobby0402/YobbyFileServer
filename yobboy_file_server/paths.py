from __future__ import annotations

import os
import sys


def project_base_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def package_dir() -> str:
    return os.path.dirname(os.path.abspath(__file__))


def project_path(*parts: str) -> str:
    return os.path.join(project_base_dir(), *parts)
