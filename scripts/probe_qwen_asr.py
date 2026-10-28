"""Run an offline Qwen ASR probe without changing the speech service."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from importlib.metadata import version
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "AI" / "models" / "Qwen3-ASR-1.7B"
REPORT = ROOT / "AI" / "models" / "_qwen_probe" / "result.json"
MIB = 1024 * 1024


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", nargs="*", type=Path)
    parser.add_argument(
        "--enable-cudnn",
        action="store_true",
        help="Enable cuDNN to reproduce the GTX 1660 FP16 numerical failure.",
    )
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    entry_started = time.perf_counter()

    import soundfile as sf
    import torch
    from qwen_asr import Qwen3ASRModel

    torch.set_num_threads(4)
    torch.backends.cudnn.enabled = args.enable_cudnn
    free_bytes, total_bytes = torch.cuda.mem_get_info()
    # Leave room for attention, activations, and the Windows desktop.
    gpu_budget = min(3072 * MIB, free_bytes - 1024 * MIB)
    if gpu_budget < 1024 * MIB:
        raise RuntimeError("Insufficient free GPU memory for this probe.")

    report = {
        "model": str(MODEL),
        "torch": torch.__version__,
        "transformers": version("transformers"),
        "qwen_asr": version("qwen-asr"),
        "accelerate": version("accelerate"),
        "cudnn_enabled": torch.backends.cudnn.enabled,
        "gpu": torch.cuda.get_device_name(0),
        "free_gpu_mib_before_load": round(free_bytes / MIB, 2),
        "total_gpu_mib": round(total_bytes / MIB, 2),
        "gpu_weight_budget_mib": round(gpu_budget / MIB, 2),
        "runtime_import_seconds": round(time.perf_counter() - entry_started, 3),
        "samples": [],
    }
    print(json.dumps({"loading": report}, ensure_ascii=False), flush=True)
    torch.cuda.reset_peak_memory_stats()
    started = time.perf_counter()
    model = Qwen3ASRModel.from_pretrained(
        str(MODEL),
        dtype=torch.float16,
        device_map="auto",
        max_memory={0: gpu_budget, "cpu": 10 * 1024**3},
        attn_implementation="eager",
        local_files_only=True,
        max_inference_batch_size=1,
        max_new_tokens=256,
    )
    torch.cuda.synchronize()
    report["load_seconds"] = round(time.perf_counter() - started, 3)
    report["startup_seconds"] = round(time.perf_counter() - entry_started, 3)
    report["device_map"] = model.model.hf_device_map
    print(
        json.dumps(
            {"loaded": report["load_seconds"], "device_map": report["device_map"]},
            ensure_ascii=False,
        ),
        flush=True,
    )

    def check_encoder_output(_module, _inputs, output):
        if not torch.isfinite(output.last_hidden_state).all().item():
            raise RuntimeError("Non-finite audio encoder output; transcription unsafe.")

    model.model.thinker.audio_tower.register_forward_hook(check_encoder_output)

    examples = (
        Path.home()
        / ".cache/modelscope/models/iic--SenseVoiceSmall/snapshots/master/example"
    )
    audio_paths = args.audio or [
        examples / "zh.mp3",
        examples / "yue.mp3",
        examples / "zh.mp3",
    ]
    for audio_path in audio_paths:
        audio, sample_rate = sf.read(str(audio_path), dtype="float32")
        if audio.ndim == 2:
            audio = audio.mean(axis=1)
        duration = len(audio) / sample_rate
        torch.cuda.synchronize()
        started = time.perf_counter()
        results = model.transcribe(audio=(audio, sample_rate), language=None)
        torch.cuda.synchronize()
        elapsed = time.perf_counter() - started
        result = results[0]
        sample = {
            "audio": str(audio_path),
            "duration_seconds": round(duration, 3),
            "transcribe_seconds": round(elapsed, 3),
            "rtf": round(elapsed / duration, 3),
            "language": result.language,
            "text": result.text,
        }
        if not any(character.isalnum() for character in result.text):
            raise RuntimeError(f"No valid transcription text: {audio_path}")
        report["samples"].append(sample)
        print(json.dumps(sample, ensure_ascii=False), flush=True)

    report["peak_allocated_gpu_mib"] = round(
        torch.cuda.max_memory_allocated() / MIB, 2
    )
    report["peak_reserved_gpu_mib"] = round(torch.cuda.max_memory_reserved() / MIB, 2)
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Report: {REPORT}", flush=True)


if __name__ == "__main__":
    main()
