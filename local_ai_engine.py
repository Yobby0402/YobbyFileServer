"""
本地 AI 推理：通过 LM Studio 的 OpenAI 兼容 API 访问本地模型。
保持技能拼接、知识库、Todo 等上层能力不变。
"""
from __future__ import annotations

import json
import threading
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, Generator, List, Optional

_engine_lock = threading.RLock()
_backend: str = "none"  # none | lm_studio_api
_load_error: Optional[str] = None
_api_root: Optional[str] = None
_active_model: Optional[str] = None


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


def _model_ids_from_payload(payload: Any) -> List[str]:
    """
    解析 GET …/models 的 JSON：
    - OpenAI 兼容：{ "data": [ { "id": "…" } ] }（LM Studio 的 /v1/models）
    - LM Studio 原生：{ "models": [ { "key", "type", "loaded_instances" } ] }（常见为 /api/v1/models）
    """
    if not isinstance(payload, dict):
        return []
    data_arr = payload.get("data")
    if isinstance(data_arr, list) and data_arr:
        out: List[str] = []
        for it in data_arr:
            if isinstance(it, dict):
                iid = str(it.get("id") or "").strip()
                if iid:
                    out.append(iid)
        return out
    models_arr = payload.get("models")
    if isinstance(models_arr, list) and models_arr:
        loaded_llm: List[str] = []
        other_llm: List[str] = []
        rest: List[str] = []
        for it in models_arr:
            if not isinstance(it, dict):
                continue
            key = str(it.get("key") or "").strip()
            if not key:
                continue
            typ = str(it.get("type") or "").lower()
            inst = it.get("loaded_instances")
            loaded = isinstance(inst, list) and len(inst) > 0
            if typ == "llm" and loaded:
                loaded_llm.append(key)
            elif typ == "llm":
                other_llm.append(key)
            else:
                rest.append(key)
        ordered = loaded_llm + other_llm + rest
        return list(dict.fromkeys(ordered))
    return []


def _candidate_roots(base_url: str) -> List[str]:
    """
    LM Studio 多数为 OpenAI 兼容前缀 …/v1；部分界面/版本展示为 …/api/v1。
    用户只填主机端口时，依次尝试两种根路径。
    """
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return []
    if base.endswith("/v1") or base.endswith("/api/v1"):
        return [base]
    roots = [base + "/v1", base + "/api/v1", base]
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
            model_ids = _model_ids_from_payload(data)
            selected = configured_model or (model_ids[0] if model_ids else "")
            if configured_model and configured_model not in model_ids:
                return {
                    "success": False,
                    "error": f"LM Studio 已连接，但未找到已配置模型：{configured_model}",
                    "api_root": root,
                    "models": model_ids,
                    "model": configured_model,
                }
            if not selected:
                return {
                    "success": False,
                    "error": "LM Studio 已连接，但当前未加载任何模型。",
                    "api_root": root,
                    "models": model_ids,
                    "model": "",
                }
            return {
                "success": True,
                "error": "",
                "api_root": root,
                "models": model_ids,
                "model": selected,
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
    probe = probe_connection(app_config, timeout=3.0)
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
    global _backend, _load_error, _api_root, _active_model
    with _engine_lock:
        _backend = "none"
        _load_error = None
        _api_root = None
        _active_model = None


def inference_dependencies() -> Dict[str, Any]:
    return {
        "lm_studio_mode": True,
    }


def load(app_config: Dict[str, Any]) -> Dict[str, Any]:
    """LM Studio 模式下的“加载”即测试连接并记录当前可用模型。"""
    global _backend, _load_error, _api_root, _active_model
    probe = probe_connection(app_config, timeout=5.0)
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


def stream_generate(
    app_config: Dict[str, Any],
    messages: List[Dict[str, Any]],
    system: Optional[str] = None,
    max_new_tokens: Optional[int] = None,
) -> Generator[str, None, None]:
    """通过 LM Studio OpenAI 兼容 API 逐段产出文本。"""
    global _backend, _load_error, _api_root, _active_model
    ctx = _effective_lm_context_tokens(app_config)
    min_reply = max(192, min(1024, ctx // 5))
    max_tok_req = max_new_tokens if max_new_tokens is not None else int(app_config.get("LOCAL_AI_MAX_NEW_TOKENS", 512) or 512)
    max_tok_req = max(16, min(int(max_tok_req), max(ctx // 2, 256)))
    probe = probe_connection(app_config, timeout=10.0)
    if not probe["success"]:
        with _engine_lock:
            _backend = "none"
            _load_error = probe["error"]
        yield f"\n[生成错误] {probe['error']}\n"
        return

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
                    yield content
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="ignore")
        yield f"\n[生成错误] HTTP {e.code}: {detail or e.reason}\n"
    except Exception as e:
        yield f"\n[生成错误] {e}\n"

def generate_once(
    app_config: Dict[str, Any],
    messages: List[Dict[str, Any]],
    system: Optional[str] = None,
    max_new_tokens: Optional[int] = None,
) -> str:
    return "".join(stream_generate(app_config, messages, system=system, max_new_tokens=max_new_tokens))
