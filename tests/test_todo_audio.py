import io
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace

import pytest
from flask import Flask

from yobboy_file_server import routes
from yobboy_file_server.todo_audio_manager import TodoAudioManager
from yobboy_file_server.todo_audio_worker import TodoAudioWorker
from yobboy_file_server.todo_extended_manager import TodoExtendedManager
from yobboy_file_server.todo_live_transcription import TodoLiveTranscriptionManager
from yobboy_file_server.todo_speech_service_manager import TodoSpeechServiceManager


def _reserve_with_audio(manager: TodoAudioManager, note_date: str = "2026-09-01"):
    record, source_path = manager.reserve_upload(note_date, "meeting.wav", "audio/wav")
    Path(source_path).write_bytes(b"not-real-audio")
    return record, source_path


def test_audio_manager_persists_tokens_and_merges_transcript(tmp_path: Path):
    manager = TodoAudioManager(
        storage_path=str(tmp_path / "audio_notes.json"),
        audio_root=str(tmp_path / "audio"),
    )
    record, source_path = _reserve_with_audio(manager)
    manager.mark_completed(
        record["id"],
        "<|zh|><|NEUTRAL|>第一段 第二段",
        12500,
        [
            {"start_ms": 0, "end_ms": 6100, "speaker": "SPK0", "text": "<|Speech|>第一段"},
            {"start_ms": 6200, "end_ms": 12500, "speaker": "SPK1", "text": "第二段"},
        ],
    )

    merged = manager.merge_completed_markdown("2026-09-01", "# 原有笔记")
    assert "说话人 1" in merged
    assert "说话人 2" in merged
    assert "<|" not in merged
    assert merged.count(f"todo-audio:{record['id']}:start") == 1
    assert manager.merge_completed_markdown("2026-09-01", merged) == merged

    token, secret = manager.create_token("手机")
    assert manager.authenticate_token(secret) == token["id"]
    assert manager.revoke_token(token["id"])
    assert manager.authenticate_token(secret) is None
    stored = json.loads((tmp_path / "audio_notes.json").read_text(encoding="utf-8"))
    assert stored["tokens"][token["id"]]["token_hash"] != secret
    assert secret not in json.dumps(stored, ensure_ascii=False)

    manager.delete_record(record["id"])
    assert not os.path.exists(source_path)

    reloaded = TodoAudioManager(
        storage_path=str(tmp_path / "audio_notes.json"),
        audio_root=str(tmp_path / "audio"),
    )
    assert reloaded.get_record(record["id"]) is None
    assert reloaded.list_tokens()[0]["revoked_at"]


def test_audio_manager_recovers_pending_record_after_restart(tmp_path: Path):
    manager = TodoAudioManager(
        storage_path=str(tmp_path / "audio_notes.json"),
        audio_root=str(tmp_path / "audio"),
    )
    record, _source_path = _reserve_with_audio(manager)
    assert manager.set_transcribing(record["id"])

    restarted = TodoAudioManager(
        storage_path=str(tmp_path / "audio_notes.json"),
        audio_root=str(tmp_path / "audio"),
    )
    assert restarted.recover_pending_records() == [record["id"]]
    assert restarted.get_record(record["id"])["status"] == "queued"


def test_worker_completion_appends_markdown_and_failure_keeps_source(tmp_path: Path, monkeypatch):
    manager = TodoAudioManager(
        storage_path=str(tmp_path / "audio_notes.json"),
        audio_root=str(tmp_path / "audio"),
    )
    extended = TodoExtendedManager(storage_path=str(tmp_path / "todos_extended.json"))
    record, source_path = _reserve_with_audio(manager)
    normalized = tmp_path / "normalized.wav"
    normalized.write_bytes(b"normalized")
    before_transcribe = []
    worker = TodoAudioWorker(
        manager,
        extended,
        "http://127.0.0.1:8899/transcribe",
        before_transcribe=lambda: before_transcribe.append(True),
    )
    monkeypatch.setattr(worker, "_normalize_audio", lambda _source: str(normalized))
    monkeypatch.setattr(
        worker,
        "_request_transcription",
        lambda _source: {
            "text": "会议结论",
            "duration_ms": 2500,
            "segments": [{"start_ms": 0, "end_ms": 2500, "speaker": "SPK0", "text": "会议结论"}],
        },
    )

    worker._process(record["id"])

    completed = manager.get_record(record["id"])
    assert completed["status"] == "completed"
    assert before_transcribe == [True]
    assert not normalized.exists()
    assert "会议结论" in extended.get_meeting_note("2026-09-01")

    failed, failed_source = _reserve_with_audio(manager, "2026-09-02")
    monkeypatch.setattr(worker, "_normalize_audio", lambda _source: (_ for _ in ()).throw(RuntimeError("坏音频")))
    worker._process(failed["id"])
    assert manager.get_record(failed["id"])["status"] == "failed"
    assert os.path.exists(failed_source)


class _FakeAudioWorker:
    def __init__(self, *_args, **_kwargs):
        self.queue = SimpleNamespace(qsize=lambda: 0)

    def start(self):
        return None

    def enqueue(self, _record_id):
        return True


class _FakeSpeechServiceManager:
    def __init__(self):
        self.started = 0
        self.finished_leases = []

    def status(self):
        return {"state": "stopped", "message": "等待录音或上传后自动启动", "reachable": False}

    def ensure_started(self):
        self.started += 1
        return self.status()

    def wait_until_ready(self):
        return None

    def work_enqueued(self):
        return None

    def schedule_idle_shutdown(self):
        return None

    def begin_recording(self):
        self.started += 1
        return "test-lease"

    def finish_recording(self, lease_id):
        self.finished_leases.append(lease_id)


def test_audio_routes_scope_external_tokens_to_uploaded_records(tmp_path: Path, monkeypatch):
    manager = TodoAudioManager(
        storage_path=str(tmp_path / "audio_notes.json"),
        audio_root=str(tmp_path / "audio"),
    )
    monkeypatch.setattr(routes, "TodoAudioWorker", _FakeAudioWorker)
    service_manager = _FakeSpeechServiceManager()
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.config.update(
        TODO_AUDIO_MANAGER=manager,
        TODO_SPEECH_ENABLED=True,
        TODO_SPEECH_SERVICE_URL="http://127.0.0.1:8899/transcribe",
        TODO_SPEECH_TIMEOUT_SECONDS=30,
        TODO_SPEECH_QUEUE_LIMIT=2,
        TODO_SPEECH_MAX_UPLOAD_MB=1,
        TODO_SPEECH_SERVICE_MANAGER=service_manager,
        ROOT_DIR=str(tmp_path),
        GIT_ENABLED=False,
    )
    routes.init_app(app)
    client = app.test_client()
    with client.session_transaction() as session:
        session["logged_in"] = True

    created = client.post("/api/todo/v2/audio-tokens", json={"label": "手机"})
    assert created.status_code == 201
    secret = created.get_json()["secret"]

    uploaded = client.post(
        "/api/todo/v2/audio-notes",
        data={"date": "2026-09-01", "file": (io.BytesIO(b"audio"), "memo.wav")},
        content_type="multipart/form-data",
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert uploaded.status_code == 202
    record_id = uploaded.get_json()["record"]["id"]

    external = app.test_client()
    own_record = external.get(
        f"/api/todo/v2/audio-notes/{record_id}",
        headers={"Authorization": f"Bearer {secret}"},
    )
    assert own_record.status_code == 200
    assert external.delete(
        f"/api/todo/v2/audio-notes/{record_id}",
        headers={"Authorization": f"Bearer {secret}"},
    ).status_code == 403

    second = client.post("/api/todo/v2/audio-tokens", json={"label": "平板"}).get_json()["secret"]
    forbidden = external.get(
        f"/api/todo/v2/audio-notes/{record_id}",
        headers={"Authorization": f"Bearer {second}"},
    )
    assert forbidden.status_code == 403

    start = client.post("/api/todo/v2/audio/service/start")
    assert start.status_code == 202
    assert service_manager.started == 1
    assert start.get_json()["lease_id"] == "test-lease"
    release = client.post("/api/todo/v2/audio/service/release", json={"lease_id": "test-lease"})
    assert release.status_code == 200
    assert service_manager.finished_leases == ["test-lease"]


def test_live_transcription_routes_require_login_and_return_captions(tmp_path: Path, monkeypatch):
    manager = TodoAudioManager(
        storage_path=str(tmp_path / "audio_notes.json"),
        audio_root=str(tmp_path / "audio"),
    )
    monkeypatch.setattr(routes, "TodoAudioWorker", _FakeAudioWorker)
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.config.update(
        TODO_AUDIO_MANAGER=manager,
        TODO_SPEECH_ENABLED=True,
        TODO_SPEECH_SERVICE_URL="http://127.0.0.1:8899/transcribe",
        TODO_SPEECH_TIMEOUT_SECONDS=30,
        TODO_SPEECH_QUEUE_LIMIT=2,
        TODO_SPEECH_MAX_UPLOAD_MB=1,
        TODO_SPEECH_SERVICE_MANAGER=_FakeSpeechServiceManager(),
        ROOT_DIR=str(tmp_path),
        GIT_ENABLED=False,
    )
    routes.init_app(app)
    client = app.test_client()

    assert client.post("/api/todo/v2/audio/live-sessions").status_code == 401
    with client.session_transaction() as session:
        session["logged_in"] = True

    started = client.post("/api/todo/v2/audio/live-sessions")
    assert started.status_code == 201
    session_id = started.get_json()["session"]["id"]
    live_manager = app.config["TODO_LIVE_TRANSCRIPTION_MANAGER"]
    monkeypatch.setattr(
        live_manager,
        "_request_transcription",
        lambda _path: {"segments": [{"start_ms": 5, "end_ms": 25, "text": "临时字幕"}]},
    )

    uploaded = client.post(
        f"/api/todo/v2/audio/live-sessions/{session_id}/chunks",
        data=b"\x00\x00" * 16000,
        content_type="application/octet-stream",
        headers={"X-Todo-Live-Offset-Ms": "2000"},
    )
    assert uploaded.status_code == 202
    live_manager.queue.join()
    captions = client.get(f"/api/todo/v2/audio/live-sessions/{session_id}").get_json()
    assert captions["captions"][0]["start_ms"] == 2005
    assert captions["captions"][0]["text"] == "临时字幕"
    assert client.post(f"/api/todo/v2/audio/live-sessions/{session_id}").get_json()["session"]["stopped"]


def test_speech_service_manager_waits_for_ready_status(tmp_path: Path, monkeypatch):
    manager = TodoSpeechServiceManager(
        enabled=True,
        service_url="http://127.0.0.1:8899/transcribe",
        timeout_seconds=30,
        status_path=str(tmp_path / "speech-status.json"),
    )
    states = iter([{"reachable": False}, {"reachable": True, "state": "ready"}])
    monkeypatch.setattr(manager, "ensure_started", lambda: {"state": "starting"})
    monkeypatch.setattr(manager, "status", lambda: {"state": "starting"})
    monkeypatch.setattr(manager, "_probe_health", lambda: next(states))
    manager.wait_until_ready()


def test_speech_service_manager_starts_from_discovered_service_directory(tmp_path: Path, monkeypatch):
    service_directory = tmp_path / "speech_service"
    service_directory.mkdir()
    launcher = service_directory / "launcher.py"
    launcher.write_text("# launcher", encoding="utf-8")
    manager = TodoSpeechServiceManager(
        enabled=True,
        service_url="http://127.0.0.1:8899/transcribe",
        status_path=str(tmp_path / "speech-status.json"),
    )
    manager.log_path = str(tmp_path / "speech.log")
    captured = {}

    def fake_popen(arguments, **kwargs):
        captured["arguments"] = arguments
        captured["kwargs"] = kwargs
        return SimpleNamespace(pid=123, poll=lambda: None)

    monkeypatch.setattr(manager, "_probe_health", lambda: {"reachable": False})
    monkeypatch.setattr(manager, "_speech_service_directory", lambda: str(service_directory))
    monkeypatch.setattr(manager, "_bootstrap_python", lambda: "C:/Python310/python.exe")
    monkeypatch.setattr(
        "yobboy_file_server.todo_speech_service_manager.subprocess.Popen", fake_popen
    )

    manager.ensure_started()

    assert captured["arguments"] == ["C:/Python310/python.exe", str(launcher)]
    assert Path(captured["kwargs"]["cwd"]) == service_directory
    manager._process = None


def test_speech_service_manager_reports_process_launch_error(tmp_path: Path, monkeypatch):
    service_directory = tmp_path / "speech_service"
    service_directory.mkdir()
    (service_directory / "launcher.py").write_text("# launcher", encoding="utf-8")
    manager = TodoSpeechServiceManager(
        enabled=True,
        service_url="http://127.0.0.1:8899/transcribe",
        status_path=str(tmp_path / "speech-status.json"),
    )
    manager.log_path = str(tmp_path / "speech.log")
    monkeypatch.setattr(manager, "_probe_health", lambda: {"reachable": False})
    monkeypatch.setattr(manager, "_speech_service_directory", lambda: str(service_directory))
    monkeypatch.setattr(manager, "_bootstrap_python", lambda: "C:/Python310/python.exe")
    monkeypatch.setattr(
        "yobboy_file_server.todo_speech_service_manager.subprocess.Popen",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(NotADirectoryError("目录名称无效")),
    )

    with pytest.raises(RuntimeError, match="无法启动本地语音服务"):
        manager.ensure_started()

    assert manager.status()["state"] == "failed"


def test_todo_page_exposes_configured_https_recording_url(tmp_path: Path, monkeypatch):
    manager = TodoAudioManager(
        storage_path=str(tmp_path / "audio_notes.json"),
        audio_root=str(tmp_path / "audio"),
    )
    monkeypatch.setattr(routes, "TodoAudioWorker", _FakeAudioWorker)
    app = Flask(
        __name__,
        template_folder=str(Path(__file__).resolve().parents[1] / "templates"),
        static_folder=str(Path(__file__).resolve().parents[1] / "static"),
    )
    app.secret_key = "test-secret"
    app.config.update(
        TODO_AUDIO_MANAGER=manager,
        TODO_SPEECH_ENABLED=True,
        TODO_SPEECH_SERVICE_URL="http://127.0.0.1:8899/transcribe",
        TODO_SPEECH_TIMEOUT_SECONDS=30,
        TODO_SPEECH_QUEUE_LIMIT=2,
        TODO_SPEECH_MAX_UPLOAD_MB=1,
        TODO_SPEECH_SERVICE_MANAGER=_FakeSpeechServiceManager(),
        ROOT_DIR=str(tmp_path),
        GIT_ENABLED=False,
        PORT=4298,
        SERIAL_HTTPS_PORT=5443,
        SERIAL_HTTPS_ACTIVE=True,
    )
    routes.init_app(app)
    client = app.test_client()
    with client.session_transaction() as session:
        session["logged_in"] = True

    response = client.get("/todo/v2")

    assert response.status_code == 200
    assert 'data-todo-https-url="https://localhost:5443/todo/v2"' in response.get_data(as_text=True)


def test_speech_service_manager_keeps_recording_service_alive_until_released(tmp_path: Path, monkeypatch):
    manager = TodoSpeechServiceManager(
        enabled=True,
        service_url="http://127.0.0.1:8899/transcribe",
        timeout_seconds=30,
        status_path=str(tmp_path / "speech-status.json"),
    )
    monkeypatch.setattr(manager, "ensure_started", lambda: {"state": "starting"})

    lease_id = manager.begin_recording()
    manager.schedule_idle_shutdown()
    assert manager._idle_timer is None
    manager.finish_recording(lease_id)
    assert manager._idle_timer is not None
    manager._idle_timer.cancel()


def test_speech_service_manager_does_not_rewrite_reachable_service_status(tmp_path: Path, monkeypatch):
    manager = TodoSpeechServiceManager(
        enabled=True,
        service_url="http://127.0.0.1:8899/transcribe",
        status_path=str(tmp_path / "speech-status.json"),
    )
    calls = []
    monkeypatch.setattr(manager, "_probe_health", lambda: {"reachable": True, "state": "ready"})
    monkeypatch.setattr(manager, "ensure_started", lambda: calls.append(True))

    manager.work_enqueued()

    assert calls == []
    assert manager._work_active


def test_speech_status_retries_windows_file_lock(tmp_path: Path, monkeypatch):
    module_path = Path(__file__).resolve().parents[1] / "speech_service" / "speech_status.py"
    spec = importlib.util.spec_from_file_location("test_speech_status", module_path)
    speech_status = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(speech_status)
    status_path = tmp_path / "speech-status.json"
    monkeypatch.setenv("TODO_SPEECH_STATUS_FILE", str(status_path))
    original_replace = speech_status.os.replace
    attempts = []

    def replace_with_temporary_lock(source, target):
        attempts.append((source, target))
        if len(attempts) < 3:
            raise PermissionError("locked")
        return original_replace(source, target)

    monkeypatch.setattr(speech_status.os, "replace", replace_with_temporary_lock)
    monkeypatch.setattr(speech_status.time, "sleep", lambda _seconds: None)

    speech_status.write_status("ready", "本地语音服务已就绪")

    assert len(attempts) == 3
    assert json.loads(status_path.read_text(encoding="utf-8"))["state"] == "ready"


def test_speech_service_manager_stops_windows_process_tree(tmp_path: Path, monkeypatch):
    manager = TodoSpeechServiceManager(
        enabled=True,
        service_url="http://127.0.0.1:8899/transcribe",
        status_path=str(tmp_path / "speech-status.json"),
    )
    manager._process = SimpleNamespace(pid=12345, poll=lambda: None)
    commands = []
    monkeypatch.setattr(
        "yobboy_file_server.todo_speech_service_manager.subprocess.run",
        lambda command, **_kwargs: commands.append(command),
    )

    manager.stop()

    assert commands == [["taskkill", "/PID", "12345", "/T", "/F"]]


def test_live_transcription_queues_pcm_and_returns_time_adjusted_captions(monkeypatch):
    ready_calls = []
    manager = TodoLiveTranscriptionManager(
        "http://127.0.0.1:8899/transcribe",
        before_transcribe=lambda: ready_calls.append(True),
    )
    monkeypatch.setattr(
        manager,
        "_request_transcription",
        lambda _path: {
            "segments": [{"start_ms": 120, "end_ms": 820, "text": "实时字幕"}],
        },
    )
    session = manager.create_session()

    assert manager.enqueue_chunk(session["id"], 4000, b"\x00\x00" * 16000)
    manager.queue.join()

    result = manager.get_captions(session["id"])
    assert ready_calls == [True]
    assert result["captions"] == [{
        "id": 1,
        "sequence": 1,
        "start_ms": 4120,
        "end_ms": 4820,
        "text": "实时字幕",
    }]
    assert manager.stop_session(session["id"])["stopped"]
