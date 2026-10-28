from __future__ import annotations

import hashlib
import os
import subprocess
import sys
from pathlib import Path

from speech_status import write_status
from model_selection import identify_model_folder


SERVICE_DIR = Path(__file__).resolve().parent
VENV_DIR = SERVICE_DIR / ".venv"
VENV_PYTHON = VENV_DIR / "Scripts" / "python.exe"
REQUIREMENTS_FILE = SERVICE_DIR / "requirements.txt"
REQUIREMENTS_MARKER = VENV_DIR / ".requirements.sha256"
WHEELS_DIR = SERVICE_DIR / "wheels"
PYTORCH_WHEELS = (
    "torch-2.3.1+cu118-cp310-cp310-win_amd64.whl",
    "torchaudio-2.3.1+cu118-cp310-cp310-win_amd64.whl",
)
QWEN_PACKAGE = "qwen-asr==0.0.6"


def _requirements_digest() -> str:
    return hashlib.sha256(REQUIREMENTS_FILE.read_bytes()).hexdigest()


def _install_dependencies() -> None:
    digest = _requirements_digest()
    installed_digest = REQUIREMENTS_MARKER.read_text(encoding="utf-8").strip() if REQUIREMENTS_MARKER.exists() else ""
    if installed_digest == digest:
        return
    write_status("installing_dependencies", "正在安装或更新语音识别依赖")
    subprocess.run(
        [str(VENV_PYTHON), "-m", "pip", "install", "--upgrade", "pip"],
        check=True,
    )
    subprocess.run(
        [str(VENV_PYTHON), "-m", "pip", "install", "-r", str(REQUIREMENTS_FILE)],
        check=True,
    )
    REQUIREMENTS_MARKER.write_text(digest, encoding="utf-8")


def _install_qwen_dependencies() -> None:
    folder = os.environ.get("TODO_SPEECH_MODEL_DIR", "").strip()
    if not folder or identify_model_folder(folder) != "qwen":
        return
    requirements = SERVICE_DIR / "requirements-qwen.txt"
    marker = VENV_DIR / ".qwen-requirements.sha256"
    digest = hashlib.sha256(requirements.read_bytes() + QWEN_PACKAGE.encode("ascii")).hexdigest()
    if marker.exists() and marker.read_text(encoding="utf-8").strip() == digest:
        return
    write_status("installing_dependencies", "正在安装 Qwen 语音识别依赖")
    subprocess.run(
        [str(VENV_PYTHON), "-m", "pip", "install", "-r", str(requirements)], check=True,
    )
    subprocess.run(
        [str(VENV_PYTHON), "-m", "pip", "install", "--no-deps", QWEN_PACKAGE], check=True,
    )
    marker.write_text(digest, encoding="utf-8")


def _cuda_is_available() -> bool:
    probe = subprocess.run(
        [
            str(VENV_PYTHON),
            "-c",
            "import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    return probe.returncode == 0


def _install_cuda_pytorch() -> None:
    if _cuda_is_available():
        return
    wheel_paths = [WHEELS_DIR / filename for filename in PYTORCH_WHEELS]
    missing = [path.name for path in wheel_paths if not path.is_file()]
    if missing:
        raise RuntimeError(f"缺少离线 CUDA 安装包：{', '.join(missing)}")
    write_status("installing_pytorch", "正在安装本地 CUDA 版 PyTorch")
    subprocess.run(
        [
            str(VENV_PYTHON),
            "-m",
            "pip",
            "install",
            "--upgrade",
            "--force-reinstall",
            *(str(path) for path in wheel_paths),
        ],
        check=True,
    )
    if not _cuda_is_available():
        raise RuntimeError("CUDA 版 PyTorch 安装完成，但未检测到可用的 NVIDIA CUDA 设备")


def main() -> None:
    try:
        if not VENV_PYTHON.exists():
            write_status("creating_environment", "正在创建 Python 3.10 语音环境")
            subprocess.run([sys.executable, "-m", "venv", str(VENV_DIR)], check=True)
        _install_cuda_pytorch()
        _install_dependencies()
        _install_qwen_dependencies()
        os.environ.setdefault("MODELSCOPE_OFFLINE", "1")
        os.environ.setdefault("HF_HUB_OFFLINE", "1")
        write_status("loading_models", "正在从本地缓存加载语音模型")
        host = os.environ.get("TODO_SPEECH_HOST", "127.0.0.1")
        port = os.environ.get("TODO_SPEECH_PORT", "8899")
        service = subprocess.run(
            [
                str(VENV_PYTHON),
                "-m",
                "uvicorn",
                "server:app",
                "--app-dir",
                str(SERVICE_DIR),
                "--host",
                host,
                "--port",
                port,
            ],
            check=False,
        )
        if service.returncode:
            raise RuntimeError(f"语音服务进程已退出（退出码 {service.returncode}）")
    except Exception as exc:
        write_status("failed", f"本地语音服务启动失败：{exc}")
        raise


if __name__ == "__main__":
    main()
