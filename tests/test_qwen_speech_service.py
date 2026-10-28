"""Run in the speech service environment; no GPU weights are loaded."""

import importlib
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

pytest.importorskip("fastapi", reason="Requires the separate speech_service Python environment")


@pytest.fixture
def service_modules(monkeypatch):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "speech_service"))
    server = importlib.import_module("server")
    monkeypatch.setattr(server, "_model", None)
    monkeypatch.setattr(server, "_model_error", "")
    monkeypatch.setattr(server, "write_status", lambda *_args: None)
    return server


def test_http_contract_retains_speaker_text_and_times(service_modules, monkeypatch):
    from fastapi.testclient import TestClient

    seen_paths = []

    def generate(input, **_kwargs):
        seen_paths.append(input)
        assert Path(input).read_bytes() == b"audio"
        return [{"text": "first\nsecond", "sentence_info": [
            {"start": 10, "end": 1200, "spk": "SPK0", "text": "first"},
            {"start": 1500, "end": 3000, "spk": "SPK1", "text": "second"},
        ]}]

    monkeypatch.setattr(service_modules, "_model", SimpleNamespace(generate=generate))
    with TestClient(service_modules.app) as client:
        assert client.get("/health").json()["state"] == "ready"
        response = client.post("/transcribe", files={"file": ("audio.wav", b"audio", "audio/wav")})
    assert response.status_code == 200
    assert response.json() == {
        "text": "first\nsecond", "duration_ms": 3000,
        "segments": [
            {"start_ms": 10, "end_ms": 1200, "speaker": "SPK0", "text": "first"},
            {"start_ms": 1500, "end_ms": 3000, "speaker": "SPK1", "text": "second"},
        ],
    }
    assert not Path(seen_paths[0]).exists()


def test_service_selects_qwen_without_loading_sensevoice(service_modules, monkeypatch, tmp_path):
    qwen = importlib.import_module("qwen_backend")
    (tmp_path / "config.json").write_text(json.dumps({"model_type": "qwen3_asr"}))
    for name in (
        "preprocessor_config.json", "tokenizer_config.json", "vocab.json",
        "merges.txt", "model.safetensors", "chat_template.json", "generation_config.json",
    ):
        (tmp_path / name).write_bytes(b"data")
    monkeypatch.setenv("TODO_SPEECH_MODEL_DIR", str(tmp_path))
    for name in ("TODO_SPEECH_VAD_MODEL", "TODO_SPEECH_SPK_MODEL"):
        monkeypatch.setenv(name, str(tmp_path))
    calls = []
    expected = object()
    monkeypatch.setattr(qwen, "QwenSpeechModel", lambda *args: calls.append(args) or expected)
    assert service_modules._load_model() is expected
    assert calls == [(str(tmp_path), str(tmp_path), str(tmp_path), "cuda:0")]


def test_default_service_keeps_original_sensevoice_options(service_modules, monkeypatch, tmp_path):
    import funasr

    monkeypatch.delenv("TODO_SPEECH_MODEL_DIR", raising=False)
    monkeypatch.setattr(service_modules, "identify_model_folder", lambda _path: "sensevoice")
    for name in service_modules.LOCAL_MODELS:
        monkeypatch.setenv(name, str(tmp_path))
    calls = []
    expected = object()
    monkeypatch.setattr(funasr, "AutoModel", lambda **kwargs: calls.append(kwargs) or expected)
    assert service_modules._load_model() is expected
    assert calls[0]["model"] == str(tmp_path)
    assert calls[0]["spk_model"] == str(tmp_path)
    assert calls[0]["vad_kwargs"] == {"max_single_segment_time": 30000}
    assert calls[0]["output_timestamp"] is True


def test_qwen_turns_are_transcribed_with_bounded_chunks_and_scoped_cudnn(monkeypatch, tmp_path):
    import soundfile as sf
    import torch

    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "speech_service"))
    backend = importlib.import_module("qwen_backend")
    observed = []
    hook = torch.nn.Identity()
    loaded = SimpleNamespace(model=SimpleNamespace(thinker=SimpleNamespace(audio_tower=hook)))

    def transcribe(audio, language):
        observed.append((len(audio[0]), audio[1], language, torch.backends.cudnn.enabled))
        return [SimpleNamespace(text="transcript")]

    loaded.transcribe = transcribe
    monkeypatch.setattr(backend.Qwen3ASRModel, "from_pretrained", lambda *_args, **_kw: loaded)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "mem_get_info", lambda _index: (5 * 1024**3, 6 * 1024**3))
    monkeypatch.setattr(torch.cuda, "get_device_capability", lambda _index: (7, 5))
    turns = [[0, 16, 0], [17, 19, 1]]
    monkeypatch.setattr(backend, "SpeakerDiarizer", lambda *_args: SimpleNamespace(turns=lambda _audio: turns))
    wav = tmp_path / "audio.wav"
    sf.write(wav, np.zeros(20 * 16000, dtype=np.float32), 16000)
    previous_cudnn = torch.backends.cudnn.enabled
    model = backend.QwenSpeechModel("qwen", "vad", "speaker", "cuda:0")
    result = model.generate(str(wav))[0]
    assert [item["spk"] for item in result["sentence_info"]] == ["SPK0", "SPK0", "SPK1"]
    assert [(item["start"], item["end"]) for item in result["sentence_info"]] == [
        (0, 15000), (15000, 16000), (17000, 19000),
    ]
    assert observed == [(240000, 16000, None, False), (16000, 16000, None, False), (32000, 16000, None, False)]
    assert torch.backends.cudnn.enabled == previous_cudnn
    with pytest.raises(RuntimeError, match="non-finite"):
        model._check_encoder(None, None, SimpleNamespace(last_hidden_state=torch.tensor([float("nan")])))
    turns.clear()
    assert model.generate(str(wav)) == [{"text": "", "sentence_info": []}]


def test_qwen_dependencies_are_optional_and_cached(monkeypatch, tmp_path):
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "speech_service"))
    launcher = importlib.import_module("launcher")
    (tmp_path / "requirements-qwen.txt").write_text("accelerate==1.12.0\n")
    monkeypatch.setattr(launcher, "SERVICE_DIR", tmp_path)
    monkeypatch.setattr(launcher, "VENV_DIR", tmp_path)
    monkeypatch.setattr(launcher, "write_status", lambda *_args: None)
    commands = []
    monkeypatch.setattr(launcher.subprocess, "run", lambda args, **_kw: commands.append(args))
    monkeypatch.delenv("TODO_SPEECH_MODEL_DIR", raising=False)
    launcher._install_qwen_dependencies()
    assert commands == []
    monkeypatch.setenv("TODO_SPEECH_MODEL_DIR", str(tmp_path))
    monkeypatch.setattr(launcher, "identify_model_folder", lambda _path: "qwen")
    launcher._install_qwen_dependencies()
    assert len(commands) == 2
    assert commands[1][-2:] == ["--no-deps", "qwen-asr==0.0.6"]
    launcher._install_qwen_dependencies()
    assert len(commands) == 2
