import configparser
import json
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from speech_service.model_selection import identify_model_folder
from yobboy_file_server.todo_audio_settings import (
    speech_settings_dict_from_ini,
    write_speech_section_to_config,
)
from yobboy_file_server.todo_speech_service_manager import TodoSpeechServiceManager


def make_qwen_folder(path: Path) -> Path:
    path.mkdir()
    (path / "config.json").write_text(json.dumps({"model_type": "qwen3_asr"}))
    for name in (
        "preprocessor_config.json", "tokenizer_config.json", "vocab.json",
        "merges.txt", "chat_template.json", "generation_config.json",
    ):
        (path / name).write_text("{}")
    (path / "model.safetensors.index.json").write_text(json.dumps({
        "weight_map": {"layer.a": "part-1.safetensors", "layer.b": "part-2.safetensors"},
    }))
    for name in ("part-1.safetensors", "part-2.safetensors"):
        (path / name).write_bytes(b"weights")
    return path


def test_folder_identification_checks_all_qwen_shards(tmp_path):
    folder = make_qwen_folder(tmp_path / "Qwen")
    assert identify_model_folder(str(folder)) == "qwen"
    (folder / "part-2.safetensors").unlink()
    with pytest.raises(ValueError, match="part-2.safetensors"):
        identify_model_folder(str(folder))
    (folder / "part-2.safetensors").write_bytes(b"weights")
    (folder / "chat_template.json").unlink()
    with pytest.raises(ValueError, match="chat_template.json"):
        identify_model_folder(str(folder))


def test_folder_identification_accepts_unsharded_qwen(tmp_path):
    folder = make_qwen_folder(tmp_path / "Qwen")
    (folder / "model.safetensors.index.json").unlink()
    (folder / "model.safetensors").write_bytes(b"weights")
    assert identify_model_folder(str(folder)) == "qwen"


def test_folder_identification_rejects_non_asr_and_external_shards(tmp_path):
    folder = make_qwen_folder(tmp_path / "Qwen")
    (folder / "model.safetensors.index.json").write_text(json.dumps({
        "weight_map": {"layer": "../weights.safetensors"},
    }))
    with pytest.raises(ValueError, match="shard"):
        identify_model_folder(str(folder))
    with pytest.raises(ValueError, match="Qwen3-ASR"):
        identify_model_folder(str(tmp_path))


def test_folder_identification_accepts_existing_sensevoice_layout(tmp_path):
    (tmp_path / "configuration.json").write_text(json.dumps({"task": "auto-speech-recognition"}))
    for name in ("model.pt", "config.yaml", "am.mvn", "chn_jpn_yue_eng_ko_spectok.bpe.model"):
        (tmp_path / name).write_bytes(b"data")
    assert identify_model_folder(str(tmp_path)) == "sensevoice"


def test_speech_model_folder_settings_roundtrip_preserves_other_fields(tmp_path):
    config = configparser.ConfigParser()
    original = speech_settings_dict_from_ini()
    assert original["TODO_SPEECH_MODEL_DIR"] == ""
    original.update(TODO_SPEECH_ENABLED=True, TODO_SPEECH_MODEL_DIR=str(tmp_path / "中文 Qwen"))
    write_speech_section_to_config(config, original)
    assert speech_settings_dict_from_ini(config) == original


def test_service_launch_receives_selected_model_folder(tmp_path, monkeypatch):
    manager = TodoSpeechServiceManager(
        enabled=True, service_url="http://127.0.0.1:8899/transcribe",
        status_path=str(tmp_path / "status.json"), model_dir=str(tmp_path / "Qwen"),
    )
    manager.log_path = str(tmp_path / "speech.log")
    captured = {}

    def launch(_arguments, **kwargs):
        captured.update(kwargs["env"])
        return SimpleNamespace(pid=123, poll=lambda: None)

    monkeypatch.setattr(manager, "_probe_health", lambda: {"reachable": False})
    monkeypatch.setattr(manager, "_speech_service_directory", lambda: str(tmp_path))
    monkeypatch.setattr(manager, "_bootstrap_python", lambda: "python.exe")
    monkeypatch.setattr("yobboy_file_server.todo_speech_service_manager.subprocess.Popen", launch)
    manager.ensure_started()
    manager._process = None
    assert captured["TODO_SPEECH_MODEL_DIR"] == str(tmp_path / "Qwen")


@pytest.fixture
def qt_app():
    os.environ.setdefault("QT_QPA_PLATFORM", "windows" if os.name == "nt" else "offscreen")
    from PyQt5.QtWidgets import QApplication

    return QApplication.instance() or QApplication([])


def test_folder_picker_cancellation_invalid_folder_and_reset(qt_app, tmp_path, monkeypatch):
    from PyQt5.QtWidgets import QToolButton
    from yobboy_file_server import speech_model_settings_widget as ui

    folder = make_qwen_folder(tmp_path / "Qwen")
    widget = ui.SpeechModelFolderWidget("previous")
    warnings = []
    monkeypatch.setattr(ui.QMessageBox, "warning", lambda *_args: warnings.append(True))
    selections = iter(["", str(tmp_path), str(folder)])
    monkeypatch.setattr(ui.QFileDialog, "getExistingDirectory", lambda *_args: next(selections))
    widget.browse_folder()
    assert widget.folder() == "previous"
    widget.browse_folder()
    assert widget.folder() == "previous"
    assert warnings == [True]
    widget.browse_folder()
    assert widget.folder() == str(folder)
    assert widget.validate_folder()
    widget.findChildren(QToolButton)[1].click()
    assert widget.folder() == ""
    assert widget.validate_folder()
    widget.close()


def test_settings_dialog_saves_selected_folder(qt_app, tmp_path):
    from PyQt5.QtCore import Qt
    from PyQt5.QtWidgets import QTabWidget, QToolButton
    from yobboy_file_server.main import SettingsDialog

    folder = make_qwen_folder(tmp_path / "Qwen")
    dialog = SettingsDialog(
        current_root=str(tmp_path), current_data_dir=str(tmp_path),
        current_log_dir=str(tmp_path), current_password="password",
        current_admin_password="admin",
        speech_settings={"TODO_SPEECH_MODEL_DIR": str(folder), "TODO_SPEECH_ENABLED": True},
    )
    dialog.setAttribute(Qt.WA_DontShowOnScreen)
    dialog.findChild(QTabWidget).setCurrentIndex(3)
    dialog.resize(620, 420)
    dialog.show()
    qt_app.processEvents()
    for button in dialog.speech_model_folder.findChildren(QToolButton):
        assert button.mapTo(dialog, button.rect().topRight()).x() < dialog.width()
    dialog.accept()
    assert dialog.result() == dialog.Accepted
    assert dialog.get_settings()[-1]["TODO_SPEECH_MODEL_DIR"] == str(folder)
    assert dialog.get_settings()[-1]["TODO_SPEECH_ENABLED"] is True
    dialog.speech_status_timer.stop()
    dialog.close()


def test_settings_can_disable_speech_when_model_folder_is_unavailable(qt_app, tmp_path, monkeypatch):
    from yobboy_file_server.main import SettingsDialog
    from yobboy_file_server import speech_model_settings_widget as ui

    warnings = []
    monkeypatch.setattr(ui.QMessageBox, "warning", lambda *_args: warnings.append(True))
    dialog = SettingsDialog(
        current_root=str(tmp_path), current_data_dir=str(tmp_path), current_log_dir=str(tmp_path),
        current_password="password", current_admin_password="admin",
        speech_settings={"TODO_SPEECH_MODEL_DIR": str(tmp_path / "removed"), "TODO_SPEECH_ENABLED": True},
    )
    dialog.accept()
    assert dialog.result() == dialog.Rejected
    assert warnings == [True]
    warnings.clear()
    dialog.speech_enabled_checkbox.setChecked(False)
    dialog.accept()
    assert dialog.result() == dialog.Accepted
    assert warnings == []
    dialog.speech_status_timer.stop()
    dialog.close()


@pytest.mark.skipif(os.name != "nt", reason="Windows QProcess child shutdown")
def test_server_shutdown_stops_child_service_before_model_switch(qt_app, tmp_path):
    psutil = pytest.importorskip("psutil")
    from yobboy_file_server.main import FlaskServerProcess

    pid_file = tmp_path / "child.pid"
    child_code = (
        "import os,time; from pathlib import Path; "
        f"Path({str(pid_file)!r}).write_text(str(os.getpid())); time.sleep(60)"
    )
    parent_code = (
        "import subprocess,sys,time; "
        f"subprocess.Popen([sys.executable, '-c', {child_code!r}]); time.sleep(60)"
    )
    process = FlaskServerProcess()
    child = None
    try:
        process.start(sys.executable, ["-c", parent_code])
        assert process.waitForStarted(5000)
        deadline = time.monotonic() + 5
        while not pid_file.exists() and time.monotonic() < deadline:
            qt_app.processEvents()
            time.sleep(0.05)
        child = psutil.Process(int(pid_file.read_text()))
        process.stop_server()
        _gone, alive = psutil.wait_procs([child], timeout=2)
        assert not alive, "Previous speech service survives and can keep serving the old model."
    finally:
        process.stop_server()
        if child and child.is_running():
            child.kill()
            child.wait(timeout=5)
