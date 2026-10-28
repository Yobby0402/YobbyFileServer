FROM pytorch/pytorch:2.3.1-cuda11.8-cudnn8-runtime

WORKDIR /service

COPY requirements.txt requirements-qwen.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-qwen.txt \
    && pip install --no-cache-dir --no-deps qwen-asr==0.0.6

COPY server.py speech_status.py model_selection.py qwen_backend.py speaker_diarization.py ./

EXPOSE 8899

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8899"]
