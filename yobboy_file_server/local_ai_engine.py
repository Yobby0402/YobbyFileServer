"""
本地 AI 推理：通过 LM Studio 的 OpenAI 兼容 API 访问本地模型。
保持技能拼接、知识库、Todo 等上层能力不变。
"""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Generator, List, Optional

_engine_lock = threading.RLock()
_backend: str = "none"  # none | lm_studio_api
_load_error: Optional[str] = None
_api_root: Optional[str] = None
_active_model: Optional[str] = None
_probe_cache: Dict[str, Any] = {"key": None, "ts": 0.0, "ttl": 0.0, "result": None}


def _normalize_base_url(raw: str) -> str:
    raw = (raw or "").strip().rstrip("/")
    if not raw:
        return ""
    if raw.endswith("/v1") or raw.endswith("/api/v1"):
        return raw
    return raw + "/v1"


def _openai_compat_chat_root(probe_root: str) -> str:
    """
    LM Studio：列表接口可能在 …/api/v1/models（原生 JSON），
    但 OpenAI 兼容的流式对话固定为 …/v1/chat/completions，对 /api/v1 会返回 Unexpected endpoint。
    """
    r = (probe_root or "").strip().rstrip("/")
    if r.endswith("/api/v1"):
        return r[: -len("/api/v1")] + "/v1"
    return r


def _lmstudio_rest_chat_root(probe_root: str) -> str:
    """
    LM Studio REST Chat API 位于 …/api/v1/chat，会额外发送模型加载与 prompt 处理进度事件。
    """
    r = (probe_root or "").strip().rstrip("/")
    if r.endswith("/api/v1"):
        return r
    if r.endswith("/v1"):
        return r[: -len("/v1")] + "/api/v1"
    return r + "/api/v1"


def _plain_text_from_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text":
                parts.append(str(part.get("text") or ""))
            elif part.get("type") == "image_url":
                parts.append("[图片]")
        return "\n".join(p for p in parts if p).strip()
    return str(content or "")


def _rest_input_from_content(content: Any) -> Any:
    if isinstance(content, list):
        items: List[Dict[str, str]] = []
        text_parts: List[str] = []
        has_image = False
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text":
                text = str(part.get("text") or "")
                if text:
                    text_parts.append(text)
            elif part.get("type") == "image_url":
                image_url = part.get("image_url") or {}
                url = str(image_url.get("url") or "")
                if url.startswith("data:"):
                    has_image = True
                    if text_parts:
                        items.append({"type": "message", "content": "\n".join(text_parts).strip()})
                        text_parts = []
                    items.append({"type": "image", "data_url": url})
        if has_image:
            if text_parts:
                items.append({"type": "message", "content": "\n".join(text_parts).strip()})
            return items
        return "\n".join(text_parts).strip() or "继续"
    text = _plain_text_from_content(content).strip()
    return text or "继续"


def _rest_prompt_and_input(messages: List[Dict[str, Any]]) -> tuple[str, Any]:
    system_text = ""
    work = list(messages or [])
    if work and work[0].get("role") == "system":
        system_text = _plain_text_from_content(work[0].get("content")).strip()
        work = work[1:]

    last_user_idx = -1
    for idx in range(len(work) - 1, -1, -1):
        if work[idx].get("role") == "user":
            last_user_idx = idx
            break

    if last_user_idx < 0:
        return system_text, "继续"

    prior = work[:last_user_idx]
    last_input = _rest_input_from_content(work[last_user_idx].get("content"))
    transcript_lines: List[str] = []
    for item in prior[-18:]:
        role = "用户" if item.get("role") == "user" else "助手"
        text = _plain_text_from_content(item.get("content")).strip()
        if not text:
            continue
        if len(text) > 1800:
            text = text[:1800].rstrip() + "…"
        transcript_lines.append(f"{role}: {text}")

    if transcript_lines:
        history = "以下是此前对话记录，仅用于延续上下文；最新用户消息会在 input 中单独提供。\n" + "\n\n".join(transcript_lines)
        system_text = (system_text + "\n\n" + history).strip() if system_text else history
    return system_text, last_input


def _http_json(method: str, url: str, body: Optional[Dict[str, Any]] = None, timeout: float = 5.0) -> Any:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method.upper(), headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = resp.read()
    if not payload:
        return {}
    return json.loads(payload.decode("utf-8"))


def _looks_like_embedding_model(model_id: str, model_type: str = "") -> bool:
    low = (model_id or "").strip().lower()
    type_low = (model_type or "").strip().lower()
    if type_low in ("embedding", "embeddings", "text-embedding"):
        return True
    return any(
        token in low
        for token in (
            "embedding",
            "embed",
            "bge",
            "gte",
            "e5",
            "mxbai",
            "qwen3-embedding",
            "nomic-embed",
        )
    )


def _model_candidates_from_payload(payload: Any) -> List[Dict[str, Any]]:
    """
    解析 GET …/models 的 JSON：
    - OpenAI 兼容：{ "data": [ { "id": "…" } ] }（LM Studio 的 /v1/models）
    - LM Studio 原生：{ "models": [ { "key", "type", "loaded_instances" } ] }（常见为 /api/v1/models）
    """
    if not isinstance(payload, dict):
        return []
    data_arr = payload.get("data")
    if isinstance(data_arr, list) and data_arr:
        candidates: List[Dict[str, Any]] = []
        for it in data_arr:
            if isinstance(it, dict):
                iid = str(it.get("id") or "").strip()
                if iid:
                    candidates.append(
                        {
                            "id": iid,
                            "type": str(it.get("type") or it.get("object") or "").strip().lower(),
                            # /v1/models only exposes models available to the server, which are usable now.
                            "loaded": True,
                        }
                    )
        return candidates
    models_arr = payload.get("models")
    if isinstance(models_arr, list) and models_arr:
        candidates = []
        for it in models_arr:
            if not isinstance(it, dict):
                continue
            key = str(it.get("key") or "").strip()
            if not key:
                continue
            typ = str(it.get("type") or "").lower()
            inst = it.get("loaded_instances")
            loaded = isinstance(inst, list) and len(inst) > 0
            if not loaded:
                candidates.append({"id": key, "model_key": key, "type": typ, "loaded": False})
                continue
            for loaded_instance in inst:
                instance = loaded_instance if isinstance(loaded_instance, dict) else {}
                instance_id = str(instance.get("id") or key).strip()
                candidate = {
                    "id": instance_id,
                    "model_key": key,
                    "type": typ,
                    "loaded": True,
                }
                if instance.get("id"):
                    candidate["model_instance_id"] = instance_id
                candidates.append(candidate)
        return candidates
    return []


def _model_ids_from_payload(payload: Any) -> List[str]:
    candidates = _model_candidates_from_payload(payload)
    loaded_chat: List[str] = []
    unloaded_chat: List[str] = []
    embedding: List[str] = []
    for item in candidates:
        model_id = str(item.get("id") or "")
        if _looks_like_embedding_model(model_id, str(item.get("type") or "")):
            embedding.append(model_id)
        elif item.get("loaded"):
            loaded_chat.append(model_id)
        else:
            unloaded_chat.append(model_id)
    return list(dict.fromkeys(loaded_chat + unloaded_chat + embedding))


def _select_chat_model(configured_model: str, candidates: List[Dict[str, Any]]) -> Dict[str, Any]:
    configured = (configured_model or "").strip()
    if configured:
        matched = next((item for item in candidates if str(item.get("id") or "") == configured), None)
        if not matched:
            matched = next((item for item in candidates if str(item.get("model_key") or "") == configured), None)
        if not matched:
            raise RuntimeError(f"LM Studio 未找到已配置模型：{configured}")
        if _looks_like_embedding_model(configured, str(matched.get("type") or "")):
            raise RuntimeError(f"已配置模型是 Embedding 模型，不能用于对话：{configured}")
        if not matched.get("loaded"):
            raise RuntimeError(f"已配置对话模型尚未在 LM Studio 加载：{configured}")
        return matched

    loaded_chat = [
        item
        for item in candidates
        if item.get("loaded")
        and not _looks_like_embedding_model(str(item.get("id") or ""), str(item.get("type") or ""))
    ]
    if loaded_chat:
        return loaded_chat[0]

    unloaded_chat = [
        str(item.get("id") or "")
        for item in candidates
        if not item.get("loaded")
        and not _looks_like_embedding_model(str(item.get("id") or ""), str(item.get("type") or ""))
    ]
    if unloaded_chat:
        raise RuntimeError("LM Studio 已连接，但对话模型尚未加载：" + unloaded_chat[0])
    if candidates:
        raise RuntimeError("LM Studio 已连接，但只发现 Embedding 模型，未发现已加载的对话模型。")
    raise RuntimeError("LM Studio 已连接，但当前未加载任何模型。")


def _candidate_roots(base_url: str) -> List[str]:
    """
    LM Studio 多数为 OpenAI 兼容前缀 …/v1；部分界面/版本展示为 …/api/v1。
    用户只填主机端口时，依次尝试两种根路径。
    """
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return []
    if base.endswith("/api/v1"):
        roots = [base, base[: -len("/api/v1")] + "/v1"]
    elif base.endswith("/v1"):
        roots = [base[: -len("/v1")] + "/api/v1", base]
    else:
        roots = [base + "/api/v1", base + "/v1", base]
    seen: set[str] = set()
    out: List[str] = []
    for r in roots:
        if r not in seen:
            seen.add(r)
            out.append(r)
    return out


def probe_connection(app_config: Dict[str, Any], timeout: float = 5.0) -> Dict[str, Any]:
    base_url = (app_config.get("LOCAL_AI_API_BASE_URL") or "").strip()
    configured_model = (app_config.get("LOCAL_AI_API_MODEL") or "").strip()
    if not base_url:
        return {
            "success": False,
            "error": "未配置 LM Studio API 地址，请在桌面设置中填写，例如 http://127.0.0.1:1234/v1 或 …/api/v1",
            "api_root": "",
            "models": [],
            "model": configured_model,
        }

    errors: List[str] = []
    for root in _candidate_roots(base_url):
        try:
            data = _http_json("GET", root + "/models", timeout=timeout)
            candidates = _model_candidates_from_payload(data)
            model_ids = _model_ids_from_payload(data)
            try:
                selected = _select_chat_model(configured_model, candidates)
            except RuntimeError as exc:
                return {
                    "success": False,
                    "error": str(exc),
                    "api_root": root,
                    "models": model_ids,
                    "model": configured_model,
                }
            return {
                "success": True,
                "error": "",
                "api_root": root,
                "models": model_ids,
                "model": selected["id"],
                "model_key": selected.get("model_key") or selected["id"],
                "model_instance_id": selected.get("model_instance_id") or "",
            }
        except Exception as e:
            errors.append(f"{root}: {e}")

    return {
        "success": False,
        "error": "无法连接 LM Studio API。请确认已启动本地服务器；若界面为 /api/v1/models，请在设置中填写完整根地址（含 /api/v1）。"
        + (("\n" + "\n".join(errors)) if errors else ""),
        "api_root": _normalize_base_url(base_url),
        "models": [],
        "model": configured_model,
    }


def _probe_cache_key(app_config: Dict[str, Any]) -> tuple[str, str]:
    return (
        (app_config.get("LOCAL_AI_API_BASE_URL") or "").strip(),
        (app_config.get("LOCAL_AI_API_MODEL") or "").strip(),
    )


def probe_connection_cached(
    app_config: Dict[str, Any],
    timeout: float = 5.0,
    *,
    success_ttl: float = 15.0,
    failure_ttl: float = 2.0,
    force: bool = False,
) -> Dict[str, Any]:
    """Short-lived cache for LM Studio /models probing; generation should not pay this cost every request."""
    key = _probe_cache_key(app_config)
    now = time.monotonic()
    with _engine_lock:
        cached = _probe_cache.get("result")
        if (
            not force
            and cached is not None
            and _probe_cache.get("key") == key
            and now - float(_probe_cache.get("ts") or 0.0) < float(_probe_cache.get("ttl") or 0.0)
        ):
            return dict(cached)
    result = probe_connection(app_config, timeout=timeout)
    ttl = success_ttl if result.get("success") else failure_ttl
    with _engine_lock:
        _probe_cache.update({"key": key, "ts": now, "ttl": ttl, "result": dict(result)})
    return result


def get_system_stats() -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "ram_used_mb": None,
        "ram_total_mb": None,
        "ram_percent": None,
        "vram_used_mb": None,
        "vram_total_mb": None,
        "gpu_name": None,
    }
    try:
        import psutil

        vm = psutil.virtual_memory()
        out["ram_used_mb"] = round(vm.used / (1024 * 1024), 1)
        out["ram_total_mb"] = round(vm.total / (1024 * 1024), 1)
        out["ram_percent"] = round(vm.percent, 1)
    except Exception:
        pass
    try:
        import pynvml

        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        mem = pynvml.nvmlDeviceGetMemoryInfo(handle)
        out["vram_used_mb"] = round(mem.used / (1024 * 1024), 1)
        out["vram_total_mb"] = round(mem.total / (1024 * 1024), 1)
        out["gpu_name"] = pynvml.nvmlDeviceGetName(handle).decode("utf-8", errors="ignore")
    except Exception:
        pass
    return out


def get_status(app_config: Dict[str, Any]) -> Dict[str, Any]:
    global _backend, _load_error, _api_root, _active_model
    probe = probe_connection_cached(app_config, timeout=3.0, success_ttl=5.0, failure_ttl=2.0)
    with _engine_lock:
        if probe["success"]:
            _backend = "lm_studio_api"
            _api_root = probe["api_root"]
            _active_model = probe["model"]
            _load_error = None
        else:
            _backend = "none"
            _load_error = probe["error"]
        stats = get_system_stats()
        return {
            "loaded": bool(probe["success"]),
            "backend": _backend,
            "api_base_url": (app_config.get("LOCAL_AI_API_BASE_URL") or "").strip(),
            "api_root": probe.get("api_root") or "",
            "model_id": probe.get("model") or "",
            "configured_model": (app_config.get("LOCAL_AI_API_MODEL") or "").strip(),
            "available_models": probe.get("models") or [],
            "load_error": _load_error,
            **stats,
        }


def unload() -> None:
    global _backend, _load_error, _api_root, _active_model, _probe_cache
    with _engine_lock:
        _backend = "none"
        _load_error = None
        _api_root = None
        _active_model = None
        _probe_cache = {"key": None, "ts": 0.0, "ttl": 0.0, "result": None}


def inference_dependencies() -> Dict[str, Any]:
    return {
        "lm_studio_mode": True,
    }


def load(app_config: Dict[str, Any]) -> Dict[str, Any]:
    """LM Studio 模式下的“加载”即测试连接并记录当前可用模型。"""
    global _backend, _load_error, _api_root, _active_model
    probe = probe_connection_cached(app_config, timeout=5.0, force=True)
    with _engine_lock:
        if probe["success"]:
            _backend = "lm_studio_api"
            _api_root = probe["api_root"]
            _active_model = probe["model"]
            _load_error = None
            return {"success": True, "backend": _backend, "model_id": _active_model}
        _backend = "none"
        _load_error = probe["error"]
        return {"success": False, "error": _load_error, "backend": _backend}


def _build_prompt_messages(
    user_messages: List[Dict[str, Any]], system: Optional[str] = None
) -> List[Dict[str, Any]]:
    """支持 user 多模态：content 为 OpenAI 风格 list，如 [{"type":"text","text":"..."},{"type":"image_url","image_url":{"url":"data:..."}}]。"""
    msgs: List[Dict[str, Any]] = []
    if system:
        msgs.append({"role": "system", "content": system})
    for m in user_messages:
        role = m.get("role", "user")
        if role not in ("user", "assistant"):
            role = "user"
        content: Any = m.get("content")
        if isinstance(content, list):
            msgs.append({"role": role, "content": content})
        else:
            msgs.append(
                {"role": role, "content": content if isinstance(content, str) else str(content)}
            )
    return msgs


def _message_content_token_estimate(content: Any) -> int:
    if isinstance(content, str):
        return _rough_prompt_token_estimate(content)
    if isinstance(content, list):
        n = 24
        for part in content:
            if not isinstance(part, dict):
                continue
            t = part.get("type")
            if t == "text":
                n += _rough_prompt_token_estimate(str(part.get("text") or ""))
            elif t == "image_url":
                n += 2800
        return n
    return _rough_prompt_token_estimate(str(content or ""))


def _effective_lm_context_tokens(app_config: Dict[str, Any]) -> int:
    """
    LM Studio 里实际 n_ctx 常为标准 4096，而 config.ini 的 llama_ctx 可能被设得更大，会导致误信「空间足够」而不截断。
    LOCAL_AI_PROMPT_CONTEXT_CAP（默认 4096）用于截断预算上限；设为 0 表示不按此项收紧，仅用 llama_ctx。
    """
    ctx_cfg = int(app_config.get("LOCAL_AI_LLAMA_CTX", 4096) or 4096)
    if ctx_cfg < 512:
        ctx_cfg = 4096
    cap_raw = app_config.get("LOCAL_AI_PROMPT_CONTEXT_CAP", 4096)
    try:
        cap = int(cap_raw)
    except (TypeError, ValueError):
        cap = 4096
    if cap <= 0:
        return ctx_cfg
    return min(ctx_cfg, cap)


def _rough_prompt_token_estimate(text: str) -> int:
    """偏保守：中日文 Gemma 等往往小于 2 字节/token，避免低估导致仍超出 LM Studio n_ctx。"""
    if not text:
        return 0
    return max(1, int(len(text) * 0.65) + 8)


def _messages_token_estimate(msgs: List[Dict[str, Any]]) -> int:
    return sum(_message_content_token_estimate(m.get("content")) for m in msgs)


def _shrink_messages_for_lm_context(
    messages: List[Dict[str, Any]],
    ctx_tokens: int,
    min_output_tokens: int,
) -> List[Dict[str, Any]]:
    """避免「prompt 超过 n_ctx」导致 LM Studio 无输出；优先截短 system，再丢弃较早的对话轮次。"""
    out: List[Dict[str, Any]] = []
    for m in messages:
        role = m.get("role", "user")
        c = m.get("content")
        if isinstance(c, list):
            out.append({"role": role, "content": list(c)})
        else:
            out.append({"role": role, "content": c if isinstance(c, str) else str(c or "")})
    slack = max(256, int(ctx_tokens) - int(min_output_tokens))
    cap = max(200, int(slack * 0.9))

    def over_cap() -> bool:
        return _messages_token_estimate(out) > cap

    if not over_cap():
        return out

    trunc_tail = (
        "\n\n...[以上内容已自动截断以适配上下文长度。"
        "请在 LM Studio 中提高模型 Context length；若 [local_ai] llama_ctx 大于 LM 实际 n_ctx，请调小 llama_ctx，"
        "或设置 prompt_context_cap（与 LM 的 n_ctx 一致）。亦可酌情精简 Skill。]"
    )

    if out and out[0].get("role") == "system":
        rest = _messages_token_estimate(out[1:])
        budget = max(160, cap - rest)
        c = out[0]["content"] or ""
        if _rough_prompt_token_estimate(c) > budget:
            # 与 _rough_prompt_token_estimate 中 ~0.65 字/token 对齐的反推
            budget_chars = max(280, int(budget / 0.65) - len(trunc_tail))
            out[0]["content"] = c[:budget_chars].rstrip() + trunc_tail

    while over_cap() and len(out) > 3:
        if out[0].get("role") == "system":
            if len(out) <= 2:
                break
            out.pop(1)
        elif len(out) > 2:
            out.pop(0)
        else:
            break

    if over_cap() and out and out[0].get("role") == "system":
        c = out[0]["content"] or ""
        out[0]["content"] = (c[:900].rstrip() + trunc_tail) if len(c) > 900 else c

    if over_cap() and len(out) >= 2:
        sys_m = out[0] if out[0].get("role") == "system" else None
        tail = out[-1]
        if sys_m:
            c2 = sys_m.get("content") or ""
            out = [
                {
                    "role": "system",
                    "content": (c2[:600].rstrip() + trunc_tail) if c2 else trunc_tail.strip(),
                },
                tail,
            ]
        else:
            out = [tail]

    return out


def _prepare_generation_request(
    app_config: Dict[str, Any],
    messages: List[Dict[str, Any]],
    system: Optional[str],
    max_new_tokens: Optional[int],
) -> Dict[str, Any]:
    global _backend, _load_error, _api_root, _active_model
    ctx = _effective_lm_context_tokens(app_config)
    min_reply = max(192, min(1024, ctx // 5))
    max_tok_req = max_new_tokens if max_new_tokens is not None else int(app_config.get("LOCAL_AI_MAX_NEW_TOKENS", 2048) or 2048)
    max_tok_req = max(16, min(int(max_tok_req), max(ctx // 2, 256)))
    probe = probe_connection_cached(app_config, timeout=5.0, success_ttl=30.0, failure_ttl=2.0)
    if not probe["success"]:
        with _engine_lock:
            _backend = "none"
            _load_error = probe["error"]
        return {"error": probe["error"]}

    with _engine_lock:
        _backend = "lm_studio_api"
        _api_root = probe["api_root"]
        _active_model = probe["model"]
        _load_error = None
    built = _build_prompt_messages(messages, system=system)
    built = _shrink_messages_for_lm_context(built, ctx_tokens=ctx, min_output_tokens=min_reply)
    prompt_est = _messages_token_estimate(built)
    room = ctx - prompt_est - 48
    max_tok = max(32, min(max_tok_req, max(room, 64)))
    body = {
        "model": probe["model"],
        "messages": built,
        "temperature": float(app_config.get("LOCAL_AI_TEMPERATURE", 0.7) or 0.7),
        "top_p": float(app_config.get("LOCAL_AI_TOP_P", 0.95) or 0.95),
        "max_tokens": max_tok,
        "stream": True,
    }
    return {
        "probe": probe,
        "built": built,
        "body": body,
        "ctx": ctx,
        "max_tok": max_tok,
    }


def _parse_sse_block(block: str) -> tuple[str, str]:
    event_name = "message"
    data_lines: List[str] = []
    for raw in block.splitlines():
        line = raw.strip("\r")
        if not line or line.startswith(":"):
            continue
        if line.startswith("event:"):
            event_name = line[6:].strip() or "message"
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
    return event_name, "\n".join(data_lines)


def _iter_sse_json(resp: Any) -> Generator[tuple[str, Any], None, None]:
    buffer = ""
    for raw_line in resp:
        buffer += raw_line.decode("utf-8", errors="ignore")
        while "\n\n" in buffer:
            block, buffer = buffer.split("\n\n", 1)
            event_name, data_text = _parse_sse_block(block)
            if not data_text:
                continue
            if data_text.strip() == "[DONE]":
                yield event_name, "[DONE]"
                continue
            try:
                yield event_name, json.loads(data_text)
            except json.JSONDecodeError:
                yield event_name, {"raw": data_text}
    if buffer.strip():
        event_name, data_text = _parse_sse_block(buffer)
        if data_text:
            try:
                yield event_name, json.loads(data_text)
            except json.JSONDecodeError:
                yield event_name, {"raw": data_text}


def _final_chat_output(result: Dict[str, Any]) -> tuple[str, str]:
    text_parts: List[str] = []
    reasoning_parts: List[str] = []
    output_items = result.get("output")
    if isinstance(output_items, list):
        for item in output_items:
            if not isinstance(item, dict):
                continue
            content = item.get("content") or item.get("text") or ""
            if not content:
                continue
            if str(item.get("type") or "").lower() == "reasoning":
                reasoning_parts.append(str(content))
            else:
                text_parts.append(str(content))
    if not text_parts:
        fallback_text = result.get("output_text") or result.get("text") or result.get("content") or ""
        if fallback_text:
            text_parts.append(str(fallback_text))
    return "".join(text_parts), "".join(reasoning_parts)


def _stream_generate_rest_events(
    app_config: Dict[str, Any],
    prepared: Dict[str, Any],
) -> Generator[Dict[str, Any], None, None]:
    probe = prepared["probe"]
    system_prompt, rest_input = _rest_prompt_and_input(prepared["built"])
    body: Dict[str, Any] = {
        "model": probe["model"],
        "input": rest_input,
        "temperature": float(app_config.get("LOCAL_AI_TEMPERATURE", 0.7) or 0.7),
        "top_p": float(app_config.get("LOCAL_AI_TOP_P", 0.95) or 0.95),
        "max_output_tokens": int(prepared["max_tok"]),
        "stream": True,
        "store": False,
    }
    # A loaded LM Studio instance already owns its context configuration. Sending
    # a different context_length can create another instance of the same model.
    if not probe.get("model_instance_id"):
        body["context_length"] = int(prepared["ctx"])
    if system_prompt:
        body["system_prompt"] = system_prompt
    data = json.dumps(body).encode("utf-8")
    rest_root = _lmstudio_rest_chat_root(probe["api_root"])
    req = urllib.request.Request(
        rest_root + "/chat",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
    )

    emitted = ""
    emitted_reasoning = ""
    yield {"type": "model", "model": str(probe["model"]), "source": "requested"}
    with urllib.request.urlopen(req, timeout=300) as resp:
        for event_name, obj in _iter_sse_json(resp):
            if obj == "[DONE]":
                break
            if not isinstance(obj, dict):
                continue
            typ = str(obj.get("type") or event_name or "").strip()
            if typ in ("chat.start", "response.start"):
                model_instance = str(obj.get("model_instance_id") or probe["model"])
                yield {"type": "model", "model": model_instance, "source": "instance"}
                continue
            if typ in ("model_load.progress", "prompt_processing.progress"):
                raw_progress = obj.get("progress")
                try:
                    stage_percent = max(0.0, min(100.0, float(raw_progress) * 100.0))
                except (TypeError, ValueError):
                    stage_percent = None
                if typ == "model_load.progress":
                    overall = 6.0 + (stage_percent or 0.0) * 0.18
                    phase = "model_loading"
                    message = "LM Studio 正在加载模型"
                else:
                    overall = 24.0 + (stage_percent or 0.0) * 0.42
                    phase = "prompt_processing"
                    message = "LM Studio 正在处理提示词"
                yield {
                    "type": "progress",
                    "phase": phase,
                    "message": message,
                    "percent": round(overall, 1),
                    "stage_percent": round(stage_percent, 1) if stage_percent is not None else None,
                }
                continue
            if typ == "model_load.start":
                model_instance = str(obj.get("model_instance_id") or probe["model"])
                yield {"type": "model", "model": model_instance, "source": "loading"}
                yield {
                    "type": "progress",
                    "phase": "model_loading",
                    "message": "LM Studio 正在加载本轮模型",
                    "percent": 6.0,
                }
                continue
            if typ == "message.start":
                yield {
                    "type": "progress",
                    "phase": "generating",
                    "message": "LM Studio 已开始生成回答",
                    "percent": 68.0,
                }
                continue
            if typ in ("message.delta", "response.output_text.delta", "content.delta"):
                text = (
                    obj.get("content")
                    or obj.get("text")
                    or obj.get("delta")
                    or ((obj.get("message") or {}).get("content") if isinstance(obj.get("message"), dict) else "")
                )
                if text:
                    emitted += str(text)
                    yield {"type": "token", "text": str(text)}
                continue
            if typ in ("reasoning.start", "response.reasoning.start"):
                yield {
                    "type": "progress",
                    "phase": "reasoning",
                    "message": "LM Studio 正在推理",
                    "percent": 66.0,
                }
                continue
            if typ in ("reasoning.delta", "response.reasoning.delta"):
                reasoning = (
                    obj.get("content")
                    or obj.get("text")
                    or obj.get("delta")
                    or ((obj.get("reasoning") or {}).get("content") if isinstance(obj.get("reasoning"), dict) else "")
                )
                if reasoning:
                    emitted_reasoning += str(reasoning)
                    yield {"type": "reasoning", "text": str(reasoning)}
                yield {
                    "type": "progress",
                    "phase": "reasoning",
                    "message": "LM Studio 正在推理",
                    "percent": 66.0,
                }
                continue
            if typ in ("chat.end", "response.completed", "message.end"):
                result = obj.get("result") if isinstance(obj.get("result"), dict) else {}
                output_text, final_reasoning = _final_chat_output(result)
                if final_reasoning and not emitted_reasoning:
                    emitted_reasoning += final_reasoning
                    yield {"type": "reasoning", "text": final_reasoning}
                if output_text and not emitted:
                    emitted += output_text
                    yield {"type": "token", "text": output_text}
                stats = obj.get("stats") or (result.get("stats") if isinstance(result, dict) else None) or {}
                if stats:
                    yield {"type": "stats", "stats": stats}
                yield {
                    "type": "progress",
                    "phase": "completed",
                    "message": "LM Studio 生成完成",
                    "percent": 100.0,
                }
                break
            if typ in ("error", "chat.error", "response.error"):
                message = str(obj.get("message") or obj.get("error") or obj)
                yield {"type": "error", "message": message}
                break


def _stream_generate_openai_events(
    app_config: Dict[str, Any],
    prepared: Dict[str, Any],
    *,
    fallback_reason: str = "",
) -> Generator[Dict[str, Any], None, None]:
    probe = prepared["probe"]
    body = prepared["body"]
    yield {"type": "model", "model": str(probe["model"]), "source": "requested"}
    if fallback_reason:
        yield {
            "type": "progress",
            "phase": "generating",
            "message": "LM Studio 进度事件不可用，已切回兼容流",
            "percent": 66.0,
            "details": {"fallback_reason": fallback_reason[:300]},
        }
    else:
        yield {
            "type": "progress",
            "phase": "generating",
            "message": "正在连接 LM Studio 兼容流",
            "percent": 60.0,
        }
    data = json.dumps(body).encode("utf-8")
    chat_root = _openai_compat_chat_root(probe["api_root"])
    req = urllib.request.Request(
        chat_root + "/chat/completions",
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="ignore").strip()
                if not line or not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    obj = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                choices = obj.get("choices") or []
                if not choices:
                    continue
                delta = choices[0].get("delta") or {}
                content = delta.get("content")
                if content:
                    yield {"type": "token", "text": content}
                reasoning = delta.get("reasoning_content") or delta.get("reasoning")
                if reasoning:
                    yield {"type": "reasoning", "text": str(reasoning)}
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        yield {"type": "error", "message": f"HTTP {e.code}: {detail or e.reason}"}
    except Exception as e:
        yield {"type": "error", "message": str(e)}


def stream_generate_events(
    app_config: Dict[str, Any],
    messages: List[Dict[str, Any]],
    system: Optional[str] = None,
    max_new_tokens: Optional[int] = None,
) -> Generator[Dict[str, Any], None, None]:
    """通过 LM Studio 流式生成，并尽量透出 REST 进度事件。"""
    prepared = _prepare_generation_request(app_config, messages, system, max_new_tokens)
    if prepared.get("error"):
        yield {"type": "error", "message": str(prepared["error"])}
        return

    rest_error = ""
    try:
        for event in _stream_generate_rest_events(app_config, prepared):
            yield event
        return
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        rest_error = f"REST HTTP {e.code}: {detail or e.reason}"
    except Exception as e:
        rest_error = f"REST {e}"

    for event in _stream_generate_openai_events(app_config, prepared, fallback_reason=rest_error):
        yield event


def stream_generate(
    app_config: Dict[str, Any],
    messages: List[Dict[str, Any]],
    system: Optional[str] = None,
    max_new_tokens: Optional[int] = None,
) -> Generator[str, None, None]:
    """通过 LM Studio 逐段产出文本，供旧调用点保持兼容。"""
    for event in stream_generate_events(app_config, messages, system=system, max_new_tokens=max_new_tokens):
        typ = event.get("type")
        if typ == "token":
            yield str(event.get("text") or "")
        elif typ == "error":
            yield f"\n[生成错误] {event.get('message') or '未知错误'}\n"

def generate_once(
    app_config: Dict[str, Any],
    messages: List[Dict[str, Any]],
    system: Optional[str] = None,
    max_new_tokens: Optional[int] = None,
) -> str:
    return "".join(stream_generate(app_config, messages, system=system, max_new_tokens=max_new_tokens))
