"""Local Qwen ASR adapter preserving the existing FunASR result contract."""

from __future__ import annotations

from contextlib import nullcontext

import librosa
import soundfile as sf
import torch
from qwen_asr import Qwen3ASRModel

from speaker_diarization import SpeakerDiarizer


class QwenSpeechModel:
    def __init__(self, model_folder: str, vad_folder: str, speaker_folder: str, device: str):
        torch.set_num_threads(4)
        target = torch.device(device)
        use_cuda = target.type == "cuda" and torch.cuda.is_available()
        options = {"device_map": "cpu", "dtype": torch.float32}
        self.disable_cudnn = False
        if use_cuda:
            index = target.index or 0
            free_bytes, _total_bytes = torch.cuda.mem_get_info(index)
            gpu_budget = min(3072 * 1024**2, free_bytes - 1024**3)
            if gpu_budget < 1024**3:
                raise RuntimeError("Qwen needs at least 2 GiB of free GPU memory.")
            options = {
                "device_map": "auto",
                "dtype": torch.float16,
                "max_memory": {index: gpu_budget, "cpu": 10 * 1024**3},
            }
            self.disable_cudnn = torch.cuda.get_device_capability(index)[0] < 8
        self.asr = Qwen3ASRModel.from_pretrained(
            model_folder,
            attn_implementation="eager",
            local_files_only=True,
            max_inference_batch_size=1,
            max_new_tokens=256,
            **options,
        )
        self.asr.model.thinker.audio_tower.register_forward_hook(self._check_encoder)
        self.diarizer = SpeakerDiarizer(vad_folder, speaker_folder)

    @staticmethod
    def _check_encoder(_module, _inputs, output):
        if not torch.isfinite(output.last_hidden_state).all().item():
            raise RuntimeError("Qwen audio encoder produced non-finite values.")

    def generate(self, input: str, **kwargs) -> list:
        audio, sample_rate = sf.read(input, dtype="float32")
        if audio.ndim == 2:
            audio = audio.mean(axis=1)
        if sample_rate != 16000:
            audio = librosa.resample(audio, orig_sr=sample_rate, target_sr=16000)
        if not len(audio):
            return [{"text": "", "sentence_info": []}]
        turns = self.diarizer.turns(audio)
        sentences = []
        # VAD/CAM++ supply coarse turn times, without a word-alignment model.
        for start_seconds, end_seconds, speaker in turns:
            start = max(0, round(start_seconds * 16000))
            end = min(len(audio), round(end_seconds * 16000))
            for offset in range(start, end, 15 * 16000):
                chunk_end = min(end, offset + 15 * 16000)
                context = torch.backends.cudnn.flags(enabled=False) if self.disable_cudnn else nullcontext()
                with context:
                    result = self.asr.transcribe(
                        audio=(audio[offset:chunk_end], 16000), language=None,
                    )[0]
                text = result.text.strip()
                if not text:
                    continue
                sentences.append({
                    "start": offset // 16,
                    "end": chunk_end // 16,
                    "spk": f"SPK{int(speaker)}",
                    "text": text,
                })
        return [{"text": "\n".join(item["text"] for item in sentences), "sentence_info": sentences}]
