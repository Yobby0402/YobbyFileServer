from __future__ import annotations

import json
import urllib.request
from typing import Any, Dict, List, Optional


class EmbeddingClientError(RuntimeError):
    pass


def _http_json(
    method: str,
    url: str,
    body: Optional[Dict[str, Any]] = None,
    timeout: float = 10.0,
    api_key: str = "",
) -> Any:
    headers = {
        "Accept": "application/json",
    }
    data = None
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method.upper(), headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = resp.read()
    if not payload:
        return {}
    return json.loads(payload.decode("utf-8"))


def _candidate_roots(base_url: str) -> List[str]:
    base = (base_url or "").strip().rstrip("/")
    if not base:
        return []
    if base.endswith("/v1") or base.endswith("/api/v1"):
        return [base]
    out: List[str] = []
    for root in (base + "/v1", base + "/api/v1", base):
        if root not in out:
            out.append(root)
    return out


def _model_candidates_from_payload(payload: Any) -> List[Dict[str, Any]]:
    if not isinstance(payload, dict):
        return []

    data_arr = payload.get("data")
    if isinstance(data_arr, list):
        out: List[Dict[str, Any]] = []
        for item in data_arr:
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("id") or "").strip()
            if not model_id:
                continue
            out.append(
                {
                    "id": model_id,
                    "type": str(item.get("type") or item.get("object") or "").strip().lower(),
                    "loaded": True,
                }
            )
        return out

    models_arr = payload.get("models")
    if isinstance(models_arr, list):
        out = []
        for item in models_arr:
            if not isinstance(item, dict):
                continue
            model_id = str(item.get("key") or item.get("id") or "").strip()
            if not model_id:
                continue
            loaded_instances = item.get("loaded_instances")
            out.append(
                {
                    "id": model_id,
                    "type": str(item.get("type") or "").strip().lower(),
                    "loaded": isinstance(loaded_instances, list) and len(loaded_instances) > 0,
                }
            )
        return out
    return []


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


def _pick_model(configured_model: str, candidates: List[Dict[str, Any]]) -> str:
    configured = (configured_model or "").strip()
    if configured:
        for item in candidates:
            if str(item.get("id") or "").strip() == configured:
                return configured
        raise EmbeddingClientError(f"未找到 embedding 模型：{configured}")

    embedding_loaded = [
        str(item.get("id") or "")
        for item in candidates
        if item.get("loaded") and _looks_like_embedding_model(str(item.get("id") or ""), str(item.get("type") or ""))
    ]
    if embedding_loaded:
        return embedding_loaded[0]

    embedding_any = [
        str(item.get("id") or "")
        for item in candidates
        if _looks_like_embedding_model(str(item.get("id") or ""), str(item.get("type") or ""))
    ]
    if embedding_any:
        return embedding_any[0]

    loaded_any = [str(item.get("id") or "") for item in candidates if item.get("loaded")]
    if loaded_any:
        return loaded_any[0]

    if candidates:
        return str(candidates[0].get("id") or "")
    return ""


def resolve_embedding_config(app_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    cfg = dict(app_config or {})
    base_url = (
        (cfg.get("LOCAL_AI_EMBED_API_BASE_URL") or "").strip()
        or (cfg.get("LOCAL_AI_API_BASE_URL") or "").strip()
        or "http://127.0.0.1:1234/v1"
    )
    return {
        "LOCAL_AI_EMBED_API_BASE_URL": base_url,
        "LOCAL_AI_EMBED_MODEL": (cfg.get("LOCAL_AI_EMBED_MODEL") or "").strip(),
        "LOCAL_AI_EMBED_API_KEY": (cfg.get("LOCAL_AI_EMBED_API_KEY") or "").strip() or "lm-studio",
        "LOCAL_AI_EMBED_QUERY_INSTRUCTION": (
            cfg.get("LOCAL_AI_EMBED_QUERY_INSTRUCTION")
            or "Represent this query for retrieving relevant passages from the local knowledge base."
        ),
        "LOCAL_AI_EMBED_BATCH_SIZE": max(1, int(cfg.get("LOCAL_AI_EMBED_BATCH_SIZE", 16) or 16)),
    }


def probe_connection(app_config: Optional[Dict[str, Any]] = None, timeout: float = 8.0) -> Dict[str, Any]:
    cfg = resolve_embedding_config(app_config)
    base_url = cfg["LOCAL_AI_EMBED_API_BASE_URL"]
    configured_model = cfg["LOCAL_AI_EMBED_MODEL"]
    api_key = cfg["LOCAL_AI_EMBED_API_KEY"]
    if not base_url:
        return {
            "success": False,
            "error": "未配置 embedding API 地址",
            "api_root": "",
            "models": [],
            "model": configured_model,
        }

    errors: List[str] = []
    for root in _candidate_roots(base_url):
        try:
            payload = _http_json("GET", root + "/models", timeout=timeout, api_key=api_key)
            candidates = _model_candidates_from_payload(payload)
            selected = _pick_model(configured_model, candidates)
            if not selected:
                return {
                    "success": False,
                    "error": "embedding 服务已连接，但没有可用模型",
                    "api_root": root,
                    "models": [str(item.get("id") or "") for item in candidates],
                    "model": "",
                }
            return {
                "success": True,
                "error": "",
                "api_root": root,
                "models": [str(item.get("id") or "") for item in candidates],
                "model": selected,
            }
        except Exception as exc:
            errors.append(f"{root}: {exc}")

    return {
        "success": False,
        "error": "无法连接 embedding 服务" + (("\n" + "\n".join(errors)) if errors else ""),
        "api_root": base_url,
        "models": [],
        "model": configured_model,
    }


def build_query_text(query: str, instruction: str = "") -> str:
    q = str(query or "").strip()
    inst = str(instruction or "").strip()
    if not inst:
        return q
    return f"Instruct: {inst}\nQuery: {q}"


def embed_texts(
    app_config: Optional[Dict[str, Any]],
    texts: List[str],
    *,
    is_query: bool = False,
    timeout: float = 60.0,
) -> List[List[float]]:
    clean_texts = [str(text or "").strip() for text in texts]
    if not clean_texts:
        return []

    cfg = resolve_embedding_config(app_config)
    probe = probe_connection(cfg, timeout=min(timeout, 10.0))
    if not probe.get("success"):
        raise EmbeddingClientError(str(probe.get("error") or "embedding 服务不可用"))

    api_root = str(probe.get("api_root") or "").rstrip("/")
    model = str(probe.get("model") or "").strip()
    if not api_root or not model:
        raise EmbeddingClientError("embedding 配置不完整")

    if is_query:
        instruction = str(cfg.get("LOCAL_AI_EMBED_QUERY_INSTRUCTION") or "").strip()
        prepared = [build_query_text(text, instruction) for text in clean_texts]
    else:
        prepared = clean_texts

    payload = _http_json(
        "POST",
        api_root + "/embeddings",
        body={"model": model, "input": prepared},
        timeout=timeout,
        api_key=str(cfg.get("LOCAL_AI_EMBED_API_KEY") or ""),
    )
    data = payload.get("data")
    if not isinstance(data, list):
        raise EmbeddingClientError("embedding 接口返回格式无效")

    ordered = sorted(
        (
            item for item in data if isinstance(item, dict) and isinstance(item.get("embedding"), list)
        ),
        key=lambda item: int(item.get("index", 0) or 0),
    )
    vectors = [list(map(float, item.get("embedding") or [])) for item in ordered]
    if len(vectors) != len(clean_texts):
        raise EmbeddingClientError("embedding 返回数量与输入不一致")
    return vectors
