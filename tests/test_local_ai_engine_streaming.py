import json

from yobboy_file_server import local_ai_engine, local_ai_routes


class _FakeResponse:
    def __init__(self, lines):
        self._lines = lines

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def __iter__(self):
        return iter(self._lines)


def _sse_lines(event_type, payload):
    return [
        f"event: {event_type}\n".encode("utf-8"),
        ("data: " + json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"),
        b"\n",
    ]


def test_probe_connection_only_auto_selects_loaded_chat_model(monkeypatch):
    payload = {
        "models": [
            {
                "key": "Qwen/Qwen3-Embedding-4B",
                "type": "embedding",
                "loaded_instances": [{}],
            },
            {
                "key": "Qwen/Qwen3-8B-GGUF",
                "type": "llm",
                "loaded_instances": [{}],
            },
            {
                "key": "Qwen/Qwen3-14B-GGUF",
                "type": "llm",
                "loaded_instances": [],
            },
        ]
    }

    monkeypatch.setattr(local_ai_engine, "_http_json", lambda *args, **kwargs: payload)

    result = local_ai_engine.probe_connection(
        {"LOCAL_AI_API_BASE_URL": "http://127.0.0.1:1234/api/v1", "LOCAL_AI_API_MODEL": ""}
    )

    assert result["success"] is True
    assert result["model"] == "Qwen/Qwen3-8B-GGUF"


def test_probe_connection_selects_the_existing_native_instance(monkeypatch):
    payload = {
        "models": [
            {
                "key": "qwen3.8-27b",
                "type": "llm",
                "loaded_instances": [
                    {"id": "qwen3.8-27b"},
                    {"id": "qwen3.8-27b:2"},
                ],
            },
        ]
    }

    monkeypatch.setattr(local_ai_engine, "_http_json", lambda *args, **kwargs: payload)

    result = local_ai_engine.probe_connection(
        {"LOCAL_AI_API_BASE_URL": "http://127.0.0.1:1234/api/v1", "LOCAL_AI_API_MODEL": "qwen3.8-27b"}
    )

    assert result["success"] is True
    assert result["model"] == "qwen3.8-27b"
    assert result["model_instance_id"] == "qwen3.8-27b"


def test_probe_connection_does_not_auto_load_configured_chat_model(monkeypatch):
    payload = {
        "models": [
            {
                "key": "Qwen/Qwen3-8B-GGUF",
                "type": "llm",
                "loaded_instances": [],
            },
        ]
    }

    monkeypatch.setattr(local_ai_engine, "_http_json", lambda *args, **kwargs: payload)

    result = local_ai_engine.probe_connection(
        {
            "LOCAL_AI_API_BASE_URL": "http://127.0.0.1:1234/api/v1",
            "LOCAL_AI_API_MODEL": "Qwen/Qwen3-8B-GGUF",
        }
    )

    assert result["success"] is False
    assert "尚未在 LM Studio 加载" in result["error"]


def test_native_stream_uses_final_message_output_and_preserves_reasoning(monkeypatch):
    lines = []
    request_bodies = []
    lines += _sse_lines("reasoning.delta", {"type": "reasoning.delta", "content": "先检查输入。"})
    lines += _sse_lines(
        "chat.end",
        {
            "type": "chat.end",
            "result": {
                "output": [
                    {"type": "reasoning", "content": "先检查输入。"},
                    {"type": "message", "content": "这是最终回答。"},
                ],
                "stats": {"total_output_tokens": 12},
            },
        },
    )

    def fake_urlopen(request, *args, **kwargs):
        request_bodies.append(json.loads(request.data.decode("utf-8")))
        return _FakeResponse(lines)

    monkeypatch.setattr(local_ai_engine.urllib.request, "urlopen", fake_urlopen)

    events = list(
        local_ai_engine._stream_generate_rest_events(
            {},
            {
                "probe": {
                    "model": "Qwen/Qwen3-8B-GGUF",
                    "model_instance_id": "Qwen/Qwen3-8B-GGUF",
                    "api_root": "http://127.0.0.1:1234/api/v1",
                },
                "built": [{"role": "user", "content": "测试"}],
                "max_tok": 128,
                "ctx": 4096,
            },
        )
    )

    assert {"type": "reasoning", "text": "先检查输入。"} in events
    assert {"type": "token", "text": "这是最终回答。"} in events
    assert "context_length" not in request_bodies[0]


def test_chat_route_forwards_model_and_reasoning_events(monkeypatch):
    monkeypatch.setattr(
        local_ai_routes.local_ai_engine,
        "stream_generate_events",
        lambda *args, **kwargs: iter(
            [
                {"type": "model", "model": "Qwen/Qwen3-8B-GGUF", "source": "requested"},
                {"type": "reasoning", "text": "分析问题。"},
                {"type": "token", "text": "最终回答。"},
            ]
        ),
    )

    chunks = list(local_ai_routes._stream_chat_model_sse({}, [{"role": "user", "content": "测试"}]))

    assert 'event: model_instance' in "".join(chunks)
    assert 'event: reasoning' in "".join(chunks)
    assert 'event: token' in "".join(chunks)
