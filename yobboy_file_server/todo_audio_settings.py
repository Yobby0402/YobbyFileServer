from __future__ import annotations

from typing import Any, Dict


SPEECH_CONFIG_KEYS = (
    "TODO_SPEECH_ENABLED",
    "TODO_SPEECH_MODEL_DIR",
    "TODO_SPEECH_SERVICE_URL",
    "TODO_SPEECH_TIMEOUT_SECONDS",
    "TODO_SPEECH_QUEUE_LIMIT",
    "TODO_SPEECH_MAX_UPLOAD_MB",
    "TODO_SPEECH_IDLE_SHUTDOWN_SECONDS",
)


def _positive_int(value: Any, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(value))
    except (TypeError, ValueError):
        return default


def speech_settings_dict_from_ini(ini_config=None) -> Dict[str, Any]:
    settings: Dict[str, Any] = {
        "TODO_SPEECH_ENABLED": False,
        "TODO_SPEECH_MODEL_DIR": "",
        "TODO_SPEECH_SERVICE_URL": "http://127.0.0.1:8899/transcribe",
        "TODO_SPEECH_TIMEOUT_SECONDS": 900,
        "TODO_SPEECH_QUEUE_LIMIT": 20,
        "TODO_SPEECH_MAX_UPLOAD_MB": 512,
        "TODO_SPEECH_IDLE_SHUTDOWN_SECONDS": 60,
    }
    if not ini_config or not ini_config.has_section("speech"):
        return settings
    section = ini_config["speech"]
    settings["TODO_SPEECH_MODEL_DIR"] = (section.get("model_dir") or "").strip()
    settings["TODO_SPEECH_ENABLED"] = (section.get("enabled") or "false").strip().lower() in {
        "1", "true", "yes", "on"
    }
    service_url = (section.get("service_url") or "").strip()
    if service_url:
        settings["TODO_SPEECH_SERVICE_URL"] = service_url
    settings["TODO_SPEECH_TIMEOUT_SECONDS"] = _positive_int(
        section.get("timeout_seconds"), settings["TODO_SPEECH_TIMEOUT_SECONDS"], minimum=30
    )
    settings["TODO_SPEECH_QUEUE_LIMIT"] = _positive_int(
        section.get("queue_limit"), settings["TODO_SPEECH_QUEUE_LIMIT"]
    )
    settings["TODO_SPEECH_MAX_UPLOAD_MB"] = _positive_int(
        section.get("max_upload_mb"), settings["TODO_SPEECH_MAX_UPLOAD_MB"]
    )
    settings["TODO_SPEECH_IDLE_SHUTDOWN_SECONDS"] = _positive_int(
        section.get("idle_shutdown_seconds"),
        settings["TODO_SPEECH_IDLE_SHUTDOWN_SECONDS"],
        minimum=10,
    )
    return settings


def apply_speech_config(app, ini_config=None) -> None:
    app.config.update(speech_settings_dict_from_ini(ini_config))


def append_speech_to_settings_data(settings_data, ini_config=None) -> None:
    settings_data.update(speech_settings_dict_from_ini(ini_config))


def write_speech_section_to_config(config, settings_data) -> None:
    if not config.has_section("speech"):
        config.add_section("speech")
    section = config["speech"]
    section["model_dir"] = str(settings_data.get("TODO_SPEECH_MODEL_DIR") or "").strip()
    section["enabled"] = str(bool(settings_data.get("TODO_SPEECH_ENABLED", False))).lower()
    section["service_url"] = str(
        settings_data.get("TODO_SPEECH_SERVICE_URL", "http://127.0.0.1:8899/transcribe") or ""
    )
    section["timeout_seconds"] = str(
        _positive_int(settings_data.get("TODO_SPEECH_TIMEOUT_SECONDS"), 900, minimum=30)
    )
    section["queue_limit"] = str(_positive_int(settings_data.get("TODO_SPEECH_QUEUE_LIMIT"), 20))
    section["max_upload_mb"] = str(
        _positive_int(settings_data.get("TODO_SPEECH_MAX_UPLOAD_MB"), 512)
    )
    section["idle_shutdown_seconds"] = str(
        _positive_int(settings_data.get("TODO_SPEECH_IDLE_SHUTDOWN_SECONDS"), 60, minimum=10)
    )
