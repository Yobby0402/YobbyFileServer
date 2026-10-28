from __future__ import annotations

import os
import re
import tempfile
import threading
from pathlib import Path
from typing import Any, Dict, List

from fastapi import FastAPI, File, HTTPException, UploadFile

from speech_status import write_status
from model_selection import identify_model_folder


app = FastAPI(title="Yobboy Todo Speech Service")
_model: Any = None
_model_error = ""
_model_lock = threading.Lock()
_inference_lock = threading.Lock()
MODEL_CACHE_ROOT = Path(
    os.environ.get(
        "TODO_SPEECH_MODEL_CACHE",
        Path.home() / ".cache" / "modelscope" / "models",
    )
)
LOCAL_MODELS = {
    "TODO_SPEECH_MODEL": "iic--SenseVoiceSmall",
    "TODO_SPEECH_VAD_MODEL": "iic--speech_fsmn_vad_zh-cn-16k-common-pytorch",
    "TODO_SPEECH_SPK_MODEL": "iic--speech_campplus_sv_zh-cn_16k-common",
}
_CONTROL_TOKEN_PATTERN = re.compile(r"<\|([^|>]+)\|>")
_CONTROL_TOKEN_LABELS = {
    "zh": "中文",
    "en": "英文",
    "yue": "粤语",
    "ja": "日语",
    "ko": "韩语",
    "neutral": "中性",
    "happy": "开心",
    "sad": "悲伤",
    "angry": "愤怒",
    "fearful": "恐惧",
    "surprised": "惊讶",
    "speech": "语音",
    "music": "音乐",
    "withitn": "启用文本规范化",
    "withoutitn": "未启用文本规范化",
}


def _local_model_path(environment_name: str) -> str:
    configured = os.environ.get(environment_name, "").strip()
    path = (
        Path(configured).expanduser()
        if configured
        else MODEL_CACHE_ROOT / LOCAL_MODELS[environment_name] / "snapshots" / "master"
    )
    if not path.is_dir():
        raise RuntimeError(f"缺少本地语音模型：{path}")
    return str(path)


def _load_model() -> Any:
    global _model, _model_error
    with _model_lock:
        if _model is not None:
            return _model
        if _model_error:
            raise RuntimeError(_model_error)
        try:
            model_folder = os.environ.get("TODO_SPEECH_MODEL_DIR", "").strip()
            model_folder = model_folder or _local_model_path("TODO_SPEECH_MODEL")
            backend = identify_model_folder(model_folder)
            device = os.environ.get("TODO_SPEECH_DEVICE", "cuda:0")
            vad_folder = _local_model_path("TODO_SPEECH_VAD_MODEL")
            speaker_folder = _local_model_path("TODO_SPEECH_SPK_MODEL")
            if backend == "qwen":
                from qwen_backend import QwenSpeechModel

                _model = QwenSpeechModel(model_folder, vad_folder, speaker_folder, device)
            else:
                from funasr import AutoModel

                _model = AutoModel(
                    model=model_folder,
                    vad_model=vad_folder,
                    vad_kwargs={"max_single_segment_time": 30000},
                    spk_model=speaker_folder,
                    device=device,
                    output_timestamp=True,
                    disable_update=True,
                )
            return _model
        except Exception as exc:
            _model_error = str(exc)
            raise RuntimeError(_model_error) from exc


@app.on_event("startup")
def load_model_on_startup() -> None:
    """Fail fast so the main app can report a genuinely ready local service."""
    write_status("loading_models", "正在加载所选识别模型、VAD 和说话人模型")
    try:
        _load_model()
    except Exception as exc:
        write_status("failed", f"语音模型加载失败：{exc}")
        raise
    write_status("ready", "本地语音服务已就绪")


def _clean_transcript_text(value: Any) -> tuple[str, str]:
    labels: List[str] = []

    def replace_token(match: re.Match[str]) -> str:
        label = _CONTROL_TOKEN_LABELS.get(match.group(1).strip().lower())
        if label and label not in labels:
            labels.append(label)
        return ""

    text = _CONTROL_TOKEN_PATTERN.sub(replace_token, str(value or ""))
    return re.sub(r"\s{2,}", " ", text).strip(), " / ".join(labels)


def _segment_payload(result: Dict[str, Any]) -> List[Dict[str, Any]]:
    segments: List[Dict[str, Any]] = []
    for item in result.get("sentence_info") or []:
        if not isinstance(item, dict):
            continue
        text, details = _clean_transcript_text(item.get("text") or item.get("sentence"))
        if not text:
            continue
        segment = {
            "start_ms": int(item.get("start") or 0),
            "end_ms": int(item.get("end") or 0),
            "speaker": str(item.get("spk") or "SPK0"),
            "text": text,
        }
        if details:
            segment["details"] = details
        segments.append(segment)
    return segments


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "ok": _model is not None,
        "state": "ready" if _model is not None else ("failed" if _model_error else "starting"),
        "error": _model_error,
    }


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)) -> Dict[str, Any]:
    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    descriptor, temporary_path = tempfile.mkstemp(prefix="todo-speech-", suffix=suffix)
    os.close(descriptor)
    try:
        with open(temporary_path, "wb") as target:
            while data := await file.read(1024 * 1024):
                target.write(data)
        try:
            model = _load_model()
            with _inference_lock:
                write_status("transcribing", "正在转写录音")
                result = model.generate(
                    input=temporary_path,
                    language="auto",
                    use_itn=True,
                    batch_size_s=60,
                    merge_vad=True,
                    merge_length_s=15,
                )
                write_status("ready", "本地语音服务已就绪")
        except Exception as exc:
            write_status("failed", f"语音转写失败：{exc}")
            raise HTTPException(status_code=503, detail=f"语音模型不可用: {exc}") from exc
        item = result[0] if isinstance(result, list) and result else {}
        if not isinstance(item, dict):
            item = {}
        segments = _segment_payload(item)
        text, _details = _clean_transcript_text(item.get("text"))
        if not text:
            text = "\n".join(segment["text"] for segment in segments)
        duration_ms = max((segment["end_ms"] for segment in segments), default=0)
        return {"text": text, "duration_ms": duration_ms, "segments": segments}
    finally:
        await file.close()
        if os.path.exists(temporary_path):
            os.remove(temporary_path)
