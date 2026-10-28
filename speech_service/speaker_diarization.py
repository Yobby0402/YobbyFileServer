"""Reuse FunASR's VAD, CAM++ and clustering for Qwen speaker turns."""

from __future__ import annotations

import numpy as np
import torch
from funasr import AutoModel
from funasr.models.campplus.cluster_backend import ClusterBackend
from funasr.models.campplus.utils import postprocess, sv_chunk


class SpeakerDiarizer:
    def __init__(self, vad_folder: str, speaker_folder: str):
        # Keep the small auxiliary models off the GPU reserved for Qwen.
        options = {"device": "cpu", "disable_update": True, "disable_pbar": True}
        self.vad = AutoModel(model=vad_folder, max_single_segment_time=30000, **options)
        self.speaker = AutoModel(model=speaker_folder, **options)
        self.cluster = ClusterBackend()

    def turns(self, audio: np.ndarray) -> list:
        results = self.vad.generate(input=audio, fs=16000)
        intervals = results[0].get("value", []) if results else []
        vad_segments = []
        for start_ms, end_ms in intervals:
            start = max(0, int(start_ms * 16))
            end = min(len(audio), int(end_ms * 16))
            if end > start:
                vad_segments.append([start / 16000, end / 16000, audio[start:end]])
        if not vad_segments:
            return []
        chunks = sv_chunk(vad_segments)
        embeddings = self.speaker.generate(
            input=[chunk[2] for chunk in chunks], fs=16000, batch_size=8,
        )
        embeddings = torch.cat([item["spk_embedding"] for item in embeddings], dim=0).cpu()
        labels = self.cluster(embeddings)
        return postprocess(chunks, None, labels, embeddings.detach().numpy())
