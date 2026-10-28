"""Identify supported local ASR folders without importing GPU dependencies."""

from __future__ import annotations

import json
from pathlib import Path


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"Invalid model metadata: {path.name}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"Invalid model metadata: {path.name}")
    return value


def identify_model_folder(folder: str) -> str:
    """Return qwen or sensevoice; reject unsupported or incomplete folders."""
    path = Path(folder).expanduser()
    if not folder.strip() or not path.is_dir():
        raise ValueError("Model folder does not exist.")
    config_path = path / "config.json"
    if config_path.is_file() and _read_json(config_path).get("model_type") == "qwen3_asr":
        required = {
            "config.json", "preprocessor_config.json", "tokenizer_config.json",
            "vocab.json", "merges.txt", "chat_template.json", "generation_config.json",
        }
        index_path = path / "model.safetensors.index.json"
        if index_path.is_file():
            weight_map = _read_json(index_path).get("weight_map")
            if not isinstance(weight_map, dict) or not weight_map:
                raise ValueError("Invalid Qwen weight index.")
            for name in weight_map.values():
                if not isinstance(name, str) or Path(name).name != name:
                    raise ValueError("Invalid Qwen weight shard name.")
                required.add(name)
        else:
            required.add("model.safetensors")
        backend = "qwen"
    elif (path / "configuration.json").is_file():
        config = _read_json(path / "configuration.json")
        if config.get("task") != "auto-speech-recognition":
            raise ValueError("Select a Qwen3-ASR or SenseVoiceSmall model folder.")
        required = {"model.pt", "config.yaml", "am.mvn", "chn_jpn_yue_eng_ko_spectok.bpe.model"}
        backend = "sensevoice"
    else:
        raise ValueError("Select a Qwen3-ASR or SenseVoiceSmall model folder.")
    missing = sorted(name for name in required if not (path / name).is_file() or (path / name).stat().st_size == 0)
    if missing:
        raise ValueError(f"Missing model files: {', '.join(missing)}")
    return backend
