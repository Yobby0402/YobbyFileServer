"""Verify real speech-service startup and HTTP transcription on cached samples."""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import librosa
import numpy as np
import psutil
import requests
import soundfile as sf


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "speech_service"))
from model_selection import identify_model_folder


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", default="", help="Empty uses the existing SenseVoice cache.")
    args = parser.parse_args()
    expect_multiple_speakers = bool(args.model_dir and identify_model_folder(args.model_dir) == "qwen")
    sys.stdout.reconfigure(encoding="utf-8")
    examples = Path.home() / ".cache/modelscope/models/iic--SenseVoiceSmall/snapshots/master/example"
    with tempfile.TemporaryDirectory(prefix="speech-smoke-") as temporary:
        directory = Path(temporary)
        samples = {}
        for name in ("zh", "yue"):
            audio, rate = sf.read(examples / f"{name}.mp3", dtype="float32")
            if audio.ndim == 2:
                audio = audio.mean(axis=1)
            if rate != 16000:
                audio = librosa.resample(audio, orig_sr=rate, target_sr=16000)
            samples[name] = audio
        pause = np.zeros(12800, dtype=np.float32)
        samples["conversation"] = np.concatenate([
            samples["zh"], pause, samples["yue"], pause,
            samples["zh"], pause, samples["yue"],
        ])
        samples["silence"] = np.zeros(16000, dtype=np.float32)
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        environment = os.environ.copy()
        environment.update({
            "TODO_SPEECH_MODEL_DIR": args.model_dir,
            "TODO_SPEECH_PORT": str(port),
            "TODO_SPEECH_STATUS_FILE": str(directory / "status.json"),
            "HF_HUB_OFFLINE": "1",
            "MODELSCOPE_OFFLINE": "1",
        })
        log_path = directory / "service.log"
        with log_path.open("wb") as log:
            process = subprocess.Popen(
                [sys.executable, str(ROOT / "speech_service" / "launcher.py")],
                cwd=ROOT / "speech_service", env=environment, stdout=log, stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
        base_url = f"http://127.0.0.1:{port}"
        started = time.perf_counter()
        report = {"model_dir": args.model_dir or "SenseVoice default", "samples": []}
        try:
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError("Service exited before becoming ready.")
                try:
                    health = requests.get(base_url + "/health", timeout=1).json()
                    if health.get("ok") and health.get("state") == "ready":
                        break
                except requests.RequestException:
                    pass
                time.sleep(0.5)
            else:
                raise RuntimeError("Service startup timed out.")
            report["startup_seconds"] = round(time.perf_counter() - started, 3)
            print(json.dumps({"ready": report["startup_seconds"]}), flush=True)
            for name, audio in samples.items():
                path = directory / f"{name}.wav"
                sf.write(path, audio, 16000)
                started = time.perf_counter()
                with path.open("rb") as source:
                    response = requests.post(
                        base_url + "/transcribe",
                        files={"file": (path.name, source, "audio/wav")}, timeout=180,
                    )
                response.raise_for_status()
                payload = response.json()
                elapsed = time.perf_counter() - started
                assert set(payload) == {"text", "duration_ms", "segments"}, payload
                for segment in payload["segments"]:
                    assert segment["speaker"]
                    assert 0 <= segment["start_ms"] < segment["end_ms"] <= len(audio) // 16
                speakers = sorted({item["speaker"] for item in payload["segments"]})
                if name == "silence":
                    assert payload["text"] == "" and payload["segments"] == [], payload
                else:
                    assert any(character.isalnum() for character in payload["text"]), payload
                    assert payload["segments"], payload
                if name == "conversation" and expect_multiple_speakers:
                    assert len(speakers) >= 2, payload
                item = {
                    "name": name, "audio_seconds": round(len(audio) / 16000, 3),
                    "elapsed_seconds": round(elapsed, 3),
                    "speakers": speakers, **payload,
                }
                report["samples"].append(item)
                print(json.dumps(item, ensure_ascii=False), flush=True)
            print("SMOKE_PASSED", flush=True)
        except Exception:
            print(log_path.read_text(encoding="utf-8", errors="replace")[-16000:], file=sys.stderr)
            raise
        finally:
            if process.poll() is None:
                children = psutil.Process(process.pid).children(recursive=True)
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False,
                    )
                else:
                    for child in children:
                        child.terminate()
                    process.terminate()
                process.wait(timeout=10)
                _gone, alive = psutil.wait_procs(children, timeout=10)
                assert not alive, "Speech service child processes did not exit."


if __name__ == "__main__":
    main()
