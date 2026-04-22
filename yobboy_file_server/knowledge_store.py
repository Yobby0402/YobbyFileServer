from __future__ import annotations

import configparser
import hashlib
import json
import math
import os
import re
import threading
import time
import uuid
from collections import Counter
from datetime import datetime
from difflib import get_close_matches
from typing import Any, Dict, Iterable, List, Optional, Tuple

from . import embedding_client
from . import knowledge_job_manager
from . import knowledge_index_db
from .local_ai_paths import knowledge_storage_path
from .paths import project_base_dir

_lock = threading.RLock()

_FILE_SOURCE = "file"
_SNIPPET_SOURCE = "snippet"
_SCAN_SOURCE = "scan"
_SCAN_SOURCE_KEY = "__knowledge_file_scan__"
_INDEXED_STATUSES = {"indexed", "indexed_partial"}
_SUPPORTED_FILE_EXTS = {".md", ".markdown", ".txt"}
_SKIP_SCAN_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".venv",
    "venv",
    "env",
    "node_modules",
    "dist",
    "build",
}
_DEFAULT_INDEX_MAX_FILE_BYTES = 1_000_000
_DEFAULT_CHUNK_MAX_CHARS = 1200
_DEFAULT_PREVIEW_MAX_CHARS = 20000


def _base_dir() -> str:
    return project_base_dir()


def _store_path() -> str:
    return knowledge_storage_path("knowledge_files.json")


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _normalize_root(root_dir: str) -> str:
    return os.path.normpath(os.path.abspath(root_dir or _base_dir()))


def _normalize_rel_path(path: str) -> str:
    normalized = (path or "").replace("\\", "/").strip()
    normalized = re.sub(r"^/+", "", normalized)
    return normalized


def _clean_input_path(path: str) -> str:
    cleaned = str(path or "").strip().replace("\x00", "")
    if cleaned.lower().startswith("file://"):
        cleaned = cleaned[7:]
        cleaned = re.sub(r"^/+(?=[A-Za-z]:[\\/])", "", cleaned)
    return cleaned


def _looks_absolute_path(path: str) -> bool:
    return bool(
        os.path.isabs(path)
        or re.match(r"^[A-Za-z]:[\\/]", path or "")
        or str(path or "").startswith(("\\\\", "//"))
    )


def _path_key(path: str) -> str:
    return os.path.normcase(os.path.normpath(os.path.abspath(path)))


def _is_under_root_path(root_dir: str, full_path: str) -> bool:
    try:
        root_key = _path_key(root_dir)
        full_key = _path_key(full_path)
        return os.path.commonpath([root_key, full_key]) == root_key
    except (OSError, ValueError):
        return False


def _resolve_under_root(root_dir: str, path: str) -> Tuple[Optional[str], str]:
    root_n = _normalize_root(root_dir)
    cleaned = _clean_input_path(path)
    if not cleaned:
        return None, ""

    candidates: List[str] = []
    drive_fixed = re.sub(r"^/+(?=[A-Za-z]:[\\/])", "", cleaned)
    if _looks_absolute_path(cleaned):
        candidates.append(cleaned)
    elif drive_fixed != cleaned and _looks_absolute_path(drive_fixed):
        candidates.append(drive_fixed)
    else:
        candidates.append(os.path.join(root_n, _normalize_rel_path(cleaned)))

    for candidate in candidates:
        full = os.path.normpath(os.path.abspath(candidate))
        if _is_under_root_path(root_n, full):
            rel = os.path.relpath(full, root_n).replace("\\", "/")
            return full, "" if rel == "." else rel
    return None, _normalize_rel_path(cleaned)


def _normalize_rel_dir(path: str) -> str:
    normalized = _normalize_rel_path(path)
    if normalized in ("", "."):
        return ""
    return normalized.rstrip("/")


def _under_root(root_dir: str, rel_path: str) -> Optional[str]:
    full, _rel = _resolve_under_root(root_dir, rel_path)
    return full


def load_store() -> Dict[str, Any]:
    path = _store_path()
    with _lock:
        if not os.path.exists(path):
            return {"entries": {}}
        try:
            with open(path, "r", encoding="utf-8") as handle:
                data = json.load(handle)
        except Exception:
            return {"entries": {}}
        if not isinstance(data, dict):
            return {"entries": {}}
        entries = data.get("entries")
        if not isinstance(entries, dict):
            data["entries"] = {}
        settings = data.get("settings")
        if not isinstance(settings, dict):
            data["settings"] = {}
        return data


def save_store(data: Dict[str, Any]) -> None:
    path = _store_path()
    tmp = path + ".tmp"
    with _lock:
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        os.replace(tmp, path)


def _normalize_excluded_dirs(items: Optional[Iterable[str]]) -> List[str]:
    out: List[str] = []
    for item in items or []:
        normalized = _normalize_rel_dir(str(item or ""))
        if normalized and normalized not in out:
            out.append(normalized)
    return sorted(out)


def get_scan_settings() -> Dict[str, Any]:
    data = load_store()
    settings = data.get("settings") if isinstance(data.get("settings"), dict) else {}
    excluded_dirs = _normalize_excluded_dirs(settings.get("scan_excluded_dirs") or [])
    return {
        "scan_excluded_dirs": excluded_dirs,
    }


def update_scan_settings(*, excluded_dirs: Optional[Iterable[str]] = None) -> Dict[str, Any]:
    data = load_store()
    settings = data.get("settings") if isinstance(data.get("settings"), dict) else {}
    if excluded_dirs is not None:
        settings["scan_excluded_dirs"] = _normalize_excluded_dirs(excluded_dirs)
    data["settings"] = settings
    save_store(data)
    return get_scan_settings()


def list_scan_root_dirs(root_dir: str) -> List[Dict[str, Any]]:
    root_n = _normalize_root(root_dir)
    excluded_dirs = get_scan_settings().get("scan_excluded_dirs") or []
    items: List[Dict[str, Any]] = []
    try:
        iterator = os.scandir(root_n)
    except OSError:
        return items
    with iterator:
        for entry in iterator:
            try:
                if not entry.is_dir(follow_symlinks=False):
                    continue
            except OSError:
                continue
            rel = _normalize_rel_dir(entry.name)
            if not rel:
                continue
            excluded = _is_rel_path_excluded(rel, excluded_dirs)
            items.append(
                {
                    "name": entry.name,
                    "path": rel,
                    "included": not excluded,
                    "excluded": excluded,
                    "skipped_by_default": _is_skip_scan_dir(entry.name),
                }
            )
    return sorted(items, key=lambda item: str(item.get("path") or "").lower())


def _load_local_ai_embedding_config() -> Dict[str, Any]:
    defaults = {
        "LOCAL_AI_API_BASE_URL": "http://127.0.0.1:1234/v1",
        "LOCAL_AI_EMBED_API_BASE_URL": "",
        "LOCAL_AI_EMBED_MODEL": "",
        "LOCAL_AI_EMBED_API_KEY": "lm-studio",
        "LOCAL_AI_EMBED_QUERY_INSTRUCTION": (
            "Represent this query for retrieving relevant passages from the local knowledge base."
        ),
        "LOCAL_AI_EMBED_BATCH_SIZE": 16,
    }
    config_path = os.path.join(_base_dir(), "config.ini")
    parser = configparser.ConfigParser()
    if os.path.exists(config_path):
        try:
            parser.read(config_path, encoding="utf-8")
        except Exception:
            parser.read(config_path)
    if parser.has_section("local_ai"):
        local_ai = parser["local_ai"]
        if (local_ai.get("api_base_url") or "").strip():
            defaults["LOCAL_AI_API_BASE_URL"] = local_ai.get("api_base_url", "").strip()
        if (local_ai.get("embed_api_base_url") or "").strip():
            defaults["LOCAL_AI_EMBED_API_BASE_URL"] = local_ai.get("embed_api_base_url", "").strip()
        if local_ai.get("embed_model") is not None:
            defaults["LOCAL_AI_EMBED_MODEL"] = (local_ai.get("embed_model") or "").strip()
        if local_ai.get("embed_api_key") is not None:
            defaults["LOCAL_AI_EMBED_API_KEY"] = (local_ai.get("embed_api_key") or "").strip() or "lm-studio"
        if local_ai.get("embed_query_instruction") is not None:
            defaults["LOCAL_AI_EMBED_QUERY_INSTRUCTION"] = (
                local_ai.get("embed_query_instruction") or defaults["LOCAL_AI_EMBED_QUERY_INSTRUCTION"]
            ).strip()
        try:
            defaults["LOCAL_AI_EMBED_BATCH_SIZE"] = max(
                1,
                int(local_ai.get("embed_batch_size", str(defaults["LOCAL_AI_EMBED_BATCH_SIZE"]))),
            )
        except (TypeError, ValueError):
            pass
    if not defaults["LOCAL_AI_EMBED_API_BASE_URL"]:
        defaults["LOCAL_AI_EMBED_API_BASE_URL"] = defaults["LOCAL_AI_API_BASE_URL"]
    return defaults


def _resolve_embedding_config(app_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    merged = _load_local_ai_embedding_config()
    if app_config:
        for key, value in app_config.items():
            if value is None:
                continue
            merged[key] = value
    if not str(merged.get("LOCAL_AI_EMBED_API_BASE_URL") or "").strip():
        merged["LOCAL_AI_EMBED_API_BASE_URL"] = str(merged.get("LOCAL_AI_API_BASE_URL") or "").strip()
    return embedding_client.resolve_embedding_config(merged)


def _safe_tags(tags: Optional[Iterable[str]]) -> List[str]:
    out: List[str] = []
    for item in tags or []:
        text = str(item or "").strip()
        if text and text not in out:
            out.append(text)
    return out


def _tokenize(text: str) -> List[str]:
    source = str(text or "").lower()
    parts = re.findall(r"[a-z0-9_]+|[\u4e00-\u9fff]+", source)
    tokens: List[str] = []
    for part in parts:
        if re.fullmatch(r"[\u4e00-\u9fff]+", part):
            if len(part) == 1:
                tokens.append(part)
                continue
            tokens.append(part)
            tokens.extend(part[idx : idx + 2] for idx in range(0, len(part) - 1))
        else:
            tokens.append(part)
    return tokens


def _bm25_scores(docs: List[List[str]], query: str, *, k1: float = 1.5, b: float = 0.75) -> List[float]:
    q_terms = _tokenize(query)
    if not q_terms:
        return [0.0] * len(docs)
    doc_count = len(docs)
    df: Counter = Counter()
    lengths = [len(doc) for doc in docs]
    avg_len = (sum(lengths) / doc_count) if doc_count else 0
    for doc in docs:
        df.update(set(doc))
    scores: List[float] = []
    for doc in docs:
        tf = Counter(doc)
        doc_len = len(doc)
        score = 0.0
        for term in q_terms:
            if term not in tf:
                continue
            n = df[term]
            idf = math.log((doc_count - n + 0.5) / (n + 0.5) + 1.0)
            freq = tf[term]
            denom = freq + k1 * (1 - b + b * doc_len / avg_len) if avg_len else freq + k1
            score += idf * (freq * (k1 + 1)) / denom
        scores.append(score)
    return scores


def _normalize_scores(values: List[float]) -> List[float]:
    if not values:
        return []
    max_value = max(values)
    min_value = min(values)
    if max_value <= 0 and min_value <= 0:
        return [0.0] * len(values)
    if math.isclose(max_value, min_value):
        return [1.0 if max_value > 0 else 0.0] * len(values)
    return [max(0.0, (value - min_value) / (max_value - min_value)) for value in values]


def _cosine_similarity(left: List[float], right: List[float]) -> float:
    if not left or not right or len(left) != len(right):
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    norm_left = math.sqrt(sum(a * a for a in left))
    norm_right = math.sqrt(sum(b * b for b in right))
    if norm_left <= 0 or norm_right <= 0:
        return 0.0
    return dot / (norm_left * norm_right)


def _truncate_file_text(path: str, max_bytes: int) -> Tuple[str, float, str, bool]:
    stat = os.stat(path)
    size = int(stat.st_size)
    mtime = float(stat.st_mtime)
    max_bytes = max(4096, int(max_bytes or _DEFAULT_INDEX_MAX_FILE_BYTES))
    if size <= max_bytes:
        with open(path, "r", encoding="utf-8", errors="replace") as handle:
            text = handle.read()
        payload = text.encode("utf-8", errors="replace")
        return text, mtime, hashlib.sha256(payload).hexdigest(), False
    with open(path, "rb") as handle:
        data = handle.read(max_bytes)
    text = data.decode("utf-8", errors="replace")
    payload = text.encode("utf-8", errors="replace")
    text += "\n\n[文件较大，已截断用于索引]"
    return text, mtime, hashlib.sha256(payload).hexdigest(), True


def _normalize_freeform_text(text: str) -> str:
    clean = re.sub(r"\s+", " ", str(text or "")).strip()
    return clean


def _default_snippet_title(text: str) -> str:
    clean = _normalize_freeform_text(text)
    if not clean:
        return "未命名零散知识"
    return clean[:48]


def _heading_path(headings: List[str]) -> str:
    return " / ".join([item for item in headings if item])


def _flush_section_chunks(
    chunks: List[Dict[str, Any]],
    paragraphs: List[str],
    heading_path: str,
    *,
    max_chars: int,
) -> None:
    if not paragraphs:
        return
    buffer = ""
    for paragraph in paragraphs:
        block = paragraph.strip()
        if not block:
            continue
        candidate = f"{buffer}\n\n{block}".strip() if buffer else block
        if buffer and len(candidate) > max_chars:
            chunks.append({"heading_path": heading_path, "text": buffer.strip()})
            buffer = block
            continue
        if not buffer and len(block) > max_chars:
            start = 0
            while start < len(block):
                piece = block[start : start + max_chars]
                chunks.append({"heading_path": heading_path, "text": piece.strip()})
                start += max_chars
            buffer = ""
            continue
        buffer = candidate
    if buffer.strip():
        chunks.append({"heading_path": heading_path, "text": buffer.strip()})


def _chunk_markdown_text(text: str, *, max_chars: int = _DEFAULT_CHUNK_MAX_CHARS) -> List[Dict[str, Any]]:
    lines = str(text or "").splitlines()
    headings: List[str] = []
    paragraphs: List[str] = []
    chunks: List[Dict[str, Any]] = []

    def flush() -> None:
        _flush_section_chunks(chunks, paragraphs, _heading_path(headings), max_chars=max_chars)
        paragraphs.clear()

    buffer: List[str] = []
    for line in lines:
        heading_match = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading_match:
            if buffer:
                paragraphs.append("\n".join(buffer).strip())
                buffer.clear()
            flush()
            level = len(heading_match.group(1))
            title = heading_match.group(2).strip()
            headings[:] = headings[: level - 1] + [title]
            continue
        if not line.strip():
            if buffer:
                paragraphs.append("\n".join(buffer).strip())
                buffer.clear()
            continue
        buffer.append(line.rstrip())
    if buffer:
        paragraphs.append("\n".join(buffer).strip())
    flush()

    out: List[Dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        text_value = str(chunk.get("text") or "").strip()
        if not text_value:
            continue
        token_count = len(_tokenize(text_value))
        out.append(
            {
                "chunk_index": index,
                "heading_path": str(chunk.get("heading_path") or ""),
                "text": text_value,
                "token_count": token_count,
                "char_count": len(text_value),
                "created_at": _now_iso(),
            }
        )
    if not out and str(text or "").strip():
        raw = str(text).strip()
        out.append(
            {
                "chunk_index": 0,
                "heading_path": "",
                "text": raw,
                "token_count": len(_tokenize(raw)),
                "char_count": len(raw),
                "created_at": _now_iso(),
            }
        )
    return out


def _tags_json(tags: Iterable[str]) -> str:
    return json.dumps(_safe_tags(tags), ensure_ascii=False)


def _parse_tags(value: Any) -> List[str]:
    if isinstance(value, list):
        return _safe_tags(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, list):
                return _safe_tags(parsed)
        except Exception:
            pass
    return []


def _job_to_public(job: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(job, dict):
        return None
    payload = {}
    raw_payload = job.get("payload_json")
    if isinstance(raw_payload, str) and raw_payload:
        try:
            parsed = json.loads(raw_payload)
            if isinstance(parsed, dict):
                payload = parsed
        except Exception:
            payload = {}
    return {
        "job_id": str(job.get("job_id") or ""),
        "job_type": str(job.get("job_type") or ""),
        "source_type": str(job.get("source_type") or ""),
        "source_key": str(job.get("source_key") or ""),
        "status": str(job.get("status") or ""),
        "stage": str(job.get("stage") or ""),
        "message": str(job.get("message") or ""),
        "progress": round(float(job.get("progress") or 0.0), 4),
        "current_count": int(job.get("current_count") or 0),
        "total_count": int(job.get("total_count") or 0),
        "error_text": str(job.get("error_text") or ""),
        "created_at": str(job.get("created_at") or ""),
        "started_at": str(job.get("started_at") or ""),
        "finished_at": str(job.get("finished_at") or ""),
        "updated_at": str(job.get("updated_at") or ""),
        "payload": payload,
    }


def _batch_embed_texts(
    app_config: Optional[Dict[str, Any]],
    texts: List[str],
    *,
    is_query: bool = False,
    progress_callback: Optional[Any] = None,
    progress_stage: str = "embedding",
) -> Tuple[List[List[float]], Optional[str]]:
    if not texts:
        return [], None
    cfg = _resolve_embedding_config(app_config)
    batch_size = max(1, int(cfg.get("LOCAL_AI_EMBED_BATCH_SIZE", 16) or 16))
    try:
        vectors: List[List[float]] = []
        total_batches = max(1, math.ceil(len(texts) / batch_size))
        for start in range(0, len(texts), batch_size):
            batch = texts[start : start + batch_size]
            vectors.extend(embedding_client.embed_texts(cfg, batch, is_query=is_query))
            if progress_callback is not None:
                done_batches = min(total_batches, start // batch_size + 1)
                progress_callback(
                    stage=progress_stage,
                    message=f"正在生成向量（{done_batches}/{total_batches} 批）",
                    progress=0.35 + 0.55 * (done_batches / total_batches),
                    current_count=done_batches,
                    total_count=total_batches,
                )
        return vectors, None
    except Exception as exc:
        return [], str(exc)


def _source_meta_to_public(meta: Dict[str, Any]) -> Dict[str, Any]:
    tags = _parse_tags(meta.get("tags_json"))
    return {
        "index_status": str(meta.get("status") or ""),
        "indexed_at": str(meta.get("indexed_at") or ""),
        "index_updated_at": str(meta.get("updated_at") or ""),
        "chunk_count": int(meta.get("chunk_count") or 0),
        "last_error": str(meta.get("last_error") or ""),
        "tags": tags,
        "title": str(meta.get("title") or ""),
    }


def _file_state(root_dir: str, rel_path: str) -> Dict[str, Any]:
    full = _under_root(root_dir, rel_path)
    if not full or not os.path.isfile(full):
        return {"exists": False, "mtime": 0.0}
    stat = os.stat(full)
    return {
        "exists": True,
        "mtime": float(stat.st_mtime),
        "size": int(stat.st_size),
        "ext": os.path.splitext(full)[1].lower(),
    }


def _supported_file_ext(path: str) -> bool:
    return os.path.splitext(path or "")[1].lower() in _SUPPORTED_FILE_EXTS


def _format_rel_for_store(root_dir: str, full_path: str) -> str:
    return os.path.relpath(full_path, root_dir).replace("\\", "/")


def _is_skip_scan_dir(name: str) -> bool:
    low = str(name or "").lower()
    return low in _SKIP_SCAN_DIRS or low.startswith(".")


def _filter_scan_dirnames(root_dir: str, current_root: str, dirnames: List[str], excluded_dirs: Iterable[str]) -> None:
    rel_current = _format_rel_for_store(root_dir, current_root) if current_root != root_dir else ""
    filtered_dirnames = []
    for name in dirnames:
        if _is_skip_scan_dir(name):
            continue
        child_rel = "/".join([piece for piece in (rel_current, name) if piece])
        if _is_rel_path_excluded(child_rel, excluded_dirs):
            continue
        filtered_dirnames.append(name)
    dirnames[:] = filtered_dirnames


def _is_rel_path_excluded(rel_path: str, excluded_dirs: Optional[Iterable[str]]) -> bool:
    rel = _normalize_rel_dir(rel_path)
    if not rel:
        return False
    for raw_prefix in excluded_dirs or []:
        prefix = _normalize_rel_dir(str(raw_prefix or ""))
        if not prefix:
            continue
        if rel == prefix or rel.startswith(prefix + "/"):
            return True
    return False


def _file_status_from_meta(meta: Dict[str, Any]) -> str:
    return str(meta.get("scan_status") or meta.get("status") or "discovered")


def _is_source_stale(root_dir: str, source: Optional[Dict[str, Any]], rel_path: str) -> bool:
    if not source:
        return True
    state = _file_state(root_dir, rel_path)
    if not state.get("exists"):
        return True
    if str(source.get("status") or "") not in _INDEXED_STATUSES:
        return True
    try:
        return abs(float(source.get("mtime") or 0.0) - float(state.get("mtime") or 0.0)) > 1e-6
    except (TypeError, ValueError):
        return True


def _registry_entry(
    rel_path: str,
    meta: Dict[str, Any],
    indexed_meta: Optional[Dict[str, Any]] = None,
    latest_job: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    entry = {
        "path": rel_path,
        "tags": _safe_tags(meta.get("tags")),
        "note": str(meta.get("note") or ""),
        "added_at": str(meta.get("added_at") or ""),
        "updated_at": str(meta.get("updated_at") or ""),
        "discovered_at": str(meta.get("discovered_at") or ""),
        "scanned_at": str(meta.get("scanned_at") or ""),
        "scan_status": _file_status_from_meta(meta),
        "auto_discovered": bool(meta.get("auto_discovered")),
        "ext": str(meta.get("ext") or os.path.splitext(rel_path)[1].lower()),
        "size": int(meta.get("size") or 0),
        "mtime": float(meta.get("mtime") or 0.0),
    }
    if indexed_meta:
        entry.update(_source_meta_to_public(indexed_meta))
    else:
        entry["index_status"] = _file_status_from_meta(meta)
        entry["chunk_count"] = 0
        entry["last_error"] = str(meta.get("last_error") or "")
    entry["latest_job"] = _job_to_public(latest_job)
    return entry


def _stored_source_stale(source: Optional[Dict[str, Any]], meta: Dict[str, Any]) -> bool:
    if not source:
        return False
    if str(source.get("status") or "") not in _INDEXED_STATUSES:
        return True
    try:
        return abs(float(source.get("mtime") or 0.0) - float(meta.get("mtime") or 0.0)) > 1e-6
    except (TypeError, ValueError):
        return True


def _entry_from_store(
    rel_path: str,
    meta: Dict[str, Any],
    *,
    indexed_meta: Optional[Dict[str, Any]] = None,
    latest_job: Optional[Dict[str, Any]] = None,
    excluded_dirs: Optional[Iterable[str]] = None,
) -> Dict[str, Any]:
    entry = _registry_entry(rel_path, meta, indexed_meta, latest_job)
    scan_status = str(meta.get("scan_status") or "")
    entry["exists"] = scan_status != "missing"
    entry["size"] = int(meta.get("size") or entry.get("size") or 0)
    entry["mtime"] = float(meta.get("mtime") or entry.get("mtime") or 0.0)
    entry["ext"] = str(meta.get("ext") or entry.get("ext") or os.path.splitext(rel_path)[1].lower())
    entry["supported"] = _supported_file_ext(rel_path)
    entry["indexed"] = bool(indexed_meta and str(indexed_meta.get("status") or "") in _INDEXED_STATUSES)
    entry["stale"] = _stored_source_stale(indexed_meta, meta)
    entry["excluded"] = _is_rel_path_excluded(rel_path, excluded_dirs or [])
    return entry


def _entry_matches_query(
    rel_path: str,
    meta: Dict[str, Any],
    source: Optional[Dict[str, Any]],
    query: str,
) -> bool:
    q = str(query or "").strip().lower()
    if not q:
        return True
    tags = meta.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    parts = [
        rel_path,
        os.path.basename(rel_path),
        str(meta.get("note") or ""),
        str(meta.get("scan_status") or ""),
        str(meta.get("last_error") or ""),
        str(meta.get("ext") or ""),
    ]
    if source:
        parts.extend(
            [
                str(source.get("display_name") or ""),
                str(source.get("title") or ""),
                str(source.get("note") or ""),
                str(source.get("status") or ""),
                str(source.get("last_error") or ""),
                str(source.get("tags_json") or ""),
            ]
        )
    parts.extend(str(item or "") for item in tags)
    haystack = "\n".join(parts).lower()
    return q in haystack


def get_registry_overview(root_dir: str) -> Dict[str, int]:
    root_n = _normalize_root(root_dir)
    scan_settings = get_scan_settings()
    excluded_dirs = scan_settings.get("scan_excluded_dirs") or []
    data = load_store()
    source_map = {
        str(source.get("source_key") or ""): source
        for source in knowledge_index_db.list_sources(root_n, _FILE_SOURCE)
    }
    registered_files = 0
    indexed_files = 0
    stale_files = 0
    excluded_files = 0
    missing_files = 0
    pending_files = 0
    for rel_path, meta in data.get("entries", {}).items():
        if not isinstance(meta, dict):
            continue
        rel = _normalize_rel_path(rel_path)
        if not rel:
            continue
        registered_files += 1
        indexed = source_map.get(rel)
        excluded = _is_rel_path_excluded(rel, excluded_dirs)
        scan_status = str(meta.get("scan_status") or "")
        is_indexed = bool(indexed and str(indexed.get("status") or "") in _INDEXED_STATUSES)
        is_stale = _stored_source_stale(indexed, meta)
        if excluded:
            excluded_files += 1
        if scan_status == "missing":
            missing_files += 1
        if is_indexed:
            indexed_files += 1
        if is_stale:
            stale_files += 1
        if not excluded and (not is_indexed or is_stale):
            pending_files += 1
    return {
        "registered_files": registered_files,
        "indexed_files": indexed_files,
        "stale_files": stale_files,
        "excluded_files": excluded_files,
        "missing_files": missing_files,
        "pending_files": pending_files,
    }


def list_entries_page(
    root_dir: str,
    *,
    limit: Optional[int] = None,
    offset: int = 0,
    problem_first: bool = False,
    query: str = "",
) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    scan_settings = get_scan_settings()
    excluded_dirs = scan_settings.get("scan_excluded_dirs") or []
    data = load_store()
    raw_entries = data.get("entries", {})
    if not isinstance(raw_entries, dict):
        raw_entries = {}
    source_map = {
        str(source.get("source_key") or ""): source
        for source in knowledge_index_db.list_sources(root_n, _FILE_SOURCE)
    }
    normalized: List[Tuple[str, Dict[str, Any], Optional[Dict[str, Any]], Tuple[int, str]]] = []
    for rel_path, meta in raw_entries.items():
        if not isinstance(meta, dict):
            continue
        rel = _normalize_rel_path(rel_path)
        if not rel:
            continue
        source = source_map.get(rel)
        if not _entry_matches_query(rel, meta, source, query):
            continue
        excluded = _is_rel_path_excluded(rel, excluded_dirs)
        indexed = bool(source and str(source.get("status") or "") in _INDEXED_STATUSES)
        stale = _stored_source_stale(source, meta)
        scan_status = str(meta.get("scan_status") or "")
        last_error = str((source or {}).get("last_error") or meta.get("last_error") or "").strip()
        if problem_first:
            if last_error:
                rank = 0
            elif not excluded and stale:
                rank = 1
            elif not excluded and not indexed:
                rank = 2
            elif scan_status == "missing":
                rank = 3
            elif excluded:
                rank = 5
            else:
                rank = 4
        else:
            rank = 0
        normalized.append((rel, meta, source, (rank, rel)))

    normalized.sort(key=lambda item: item[3])
    folder_map: Dict[str, Dict[str, Any]] = {}
    root_files = {
        "file_count": 0,
        "indexed_count": 0,
        "pending_count": 0,
        "issue_count": 0,
    }
    for rel, meta, source, _sort_key in normalized:
        excluded = _is_rel_path_excluded(rel, excluded_dirs)
        indexed = bool(source and str(source.get("status") or "") in _INDEXED_STATUSES)
        stale = _stored_source_stale(source, meta)
        last_error = str((source or {}).get("last_error") or meta.get("last_error") or "").strip()
        bucket: Dict[str, Any]
        top_name = rel.split("/", 1)[0] if "/" in rel else ""
        if top_name:
            bucket = folder_map.setdefault(
                top_name,
                {
                    "name": top_name,
                    "path": top_name,
                    "file_count": 0,
                    "indexed_count": 0,
                    "pending_count": 0,
                    "issue_count": 0,
                },
            )
        else:
            bucket = root_files
        bucket["file_count"] += 1
        if indexed:
            bucket["indexed_count"] += 1
        if last_error:
            bucket["issue_count"] += 1
        if not excluded and (not indexed or stale):
            bucket["pending_count"] += 1

    top_folders = sorted(folder_map.values(), key=lambda item: str(item.get("path") or "").lower())
    total = len(normalized)
    safe_offset = max(0, int(offset or 0))
    if limit is None:
        slice_items = normalized[safe_offset:]
        safe_limit = total
    else:
        safe_limit = max(1, min(int(limit or 1), 500))
        slice_items = normalized[safe_offset : safe_offset + safe_limit]

    page_keys = [item[0] for item in slice_items]
    latest_job_map = knowledge_index_db.latest_jobs_for_sources(root_n, _FILE_SOURCE, page_keys)
    items = [
        _entry_from_store(
            rel,
            meta,
            indexed_meta=source,
            latest_job=latest_job_map.get(rel),
            excluded_dirs=excluded_dirs,
        )
        for rel, meta, source, _sort_key in slice_items
    ]
    return {
        "items": items,
        "top_folders": top_folders,
        "root_files": root_files,
        "total": total,
        "offset": safe_offset,
        "limit": safe_limit,
        "has_more": safe_offset + len(items) < total,
        "query": str(query or "").strip(),
    }


def list_entries(root_dir: str) -> List[Dict[str, Any]]:
    return list_entries_page(root_dir).get("items") or []


def queue_folder_entries(
    root_dir: str,
    folder_path: str,
    *,
    app_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    prefix = _normalize_rel_dir(folder_path)
    data = load_store()
    raw_entries = data.get("entries", {})
    if not isinstance(raw_entries, dict):
        raw_entries = {}

    excluded_dirs = get_scan_settings().get("scan_excluded_dirs") or []
    source_map = {
        str(source.get("source_key") or ""): source
        for source in knowledge_index_db.list_sources(root_n, _FILE_SOURCE)
    }
    candidate_paths: List[str] = []
    skipped: List[Dict[str, str]] = []

    for raw_rel, meta in sorted(raw_entries.items(), key=lambda item: str(item[0]).lower()):
        if not isinstance(meta, dict):
            continue
        rel = _normalize_rel_path(raw_rel)
        if not rel:
            continue
        if prefix:
            if not rel.startswith(prefix + "/"):
                continue
        elif "/" in rel:
            continue

        if _is_rel_path_excluded(rel, excluded_dirs):
            skipped.append({"path": rel, "reason": "excluded"})
            continue
        if not _supported_file_ext(rel):
            skipped.append({"path": rel, "reason": "unsupported"})
            continue
        if str(meta.get("scan_status") or "") == "missing":
            skipped.append({"path": rel, "reason": "missing"})
            continue

        source = source_map.get(rel)
        indexed = bool(source and str(source.get("status") or "") in _INDEXED_STATUSES)
        stale = _stored_source_stale(source, meta)
        if indexed and not stale:
            skipped.append({"path": rel, "reason": "indexed"})
            continue
        candidate_paths.append(rel)

    queued = []
    errors = []
    for rel in candidate_paths:
        try:
            queued.append(queue_entry(root_n, rel, app_config=app_config))
        except ValueError as exc:
            errors.append({"path": rel, "error": str(exc)})

    return {
        "folder_path": prefix,
        "candidate_count": len(candidate_paths),
        "queued_count": len(queued),
        "skipped_count": len(skipped),
        "error_count": len(errors),
        "items": queued,
        "skipped": skipped[:200],
        "errors": errors,
    }


def get_meta(rel_path: str, root_dir: Optional[str] = None) -> Optional[Dict[str, Any]]:
    if root_dir:
        _full, rel = _resolve_under_root(root_dir, rel_path)
    else:
        rel = _normalize_rel_path(rel_path)
    data = load_store()
    meta = data.get("entries", {}).get(rel)
    if not isinstance(meta, dict):
        return None
    if not root_dir:
        return dict(meta)
    source = knowledge_index_db.get_source(_normalize_root(root_dir), _FILE_SOURCE, rel)
    latest_job = knowledge_index_db.latest_job_for_source(_normalize_root(root_dir), _FILE_SOURCE, rel)
    entry = _registry_entry(rel, meta, source, latest_job)
    state = _file_state(_normalize_root(root_dir), rel)
    entry["exists"] = bool(state.get("exists"))
    entry["size"] = int(state.get("size") or entry.get("size") or 0)
    entry["mtime"] = float(state.get("mtime") or entry.get("mtime") or 0.0)
    entry["ext"] = str(state.get("ext") or entry.get("ext") or os.path.splitext(rel)[1].lower())
    entry["supported"] = _supported_file_ext(rel)
    entry["indexed"] = bool(source and str(source.get("status") or "") in _INDEXED_STATUSES)
    entry["stale"] = bool(source and _is_source_stale(root_dir, source, rel))
    entry["excluded"] = _is_rel_path_excluded(rel, get_scan_settings().get("scan_excluded_dirs") or [])
    return entry


def _index_file_source(
    root_dir: str,
    rel_path: str,
    *,
    tags: Optional[Iterable[str]] = None,
    note: str = "",
    app_config: Optional[Dict[str, Any]] = None,
    max_file_bytes: int = _DEFAULT_INDEX_MAX_FILE_BYTES,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    full, rel = _resolve_under_root(root_n, rel_path)
    if not full or not os.path.isfile(full):
        raise ValueError("路径无效或不是文件")
    ext = os.path.splitext(full)[1].lower()
    if ext not in _SUPPORTED_FILE_EXTS:
        raise ValueError("仅支持 .md / .markdown / .txt 标记为知识库")

    registry = load_store()
    previous = registry.get("entries", {}).get(rel, {}) if isinstance(registry.get("entries", {}), dict) else {}
    safe_note = note if note is not None else str(previous.get("note") or "")
    safe_tags = _safe_tags(tags if tags is not None else previous.get("tags") or [])

    if progress_callback is not None:
        progress_callback(stage="reading", message="正在读取文件", progress=0.08)
    text, mtime, content_hash, _truncated = _truncate_file_text(full, max_file_bytes)
    if progress_callback is not None:
        progress_callback(stage="chunking", message="正在切分文本片段", progress=0.22)
    chunks = _chunk_markdown_text(text, max_chars=_DEFAULT_CHUNK_MAX_CHARS)
    if progress_callback is not None:
        progress_callback(
            stage="embedding_prepare",
            message=f"已切分 {len(chunks)} 个片段，准备生成向量",
            progress=0.32,
            current_count=0,
            total_count=len(chunks),
        )
    vectors, embed_error = _batch_embed_texts(
        app_config,
        [chunk["text"] for chunk in chunks],
        is_query=False,
        progress_callback=progress_callback,
    )
    status = "indexed" if chunks and not embed_error and len(vectors) == len(chunks) else "indexed_partial"
    indexed_at = _now_iso()

    if progress_callback is not None:
        progress_callback(stage="saving", message="正在写入索引库", progress=0.94)
    source = knowledge_index_db.upsert_source(
        root_dir=root_n,
        source_type=_FILE_SOURCE,
        source_key=rel,
        display_name=rel,
        title=os.path.basename(rel),
        note=safe_note,
        tags_json=_tags_json(safe_tags),
        content_hash=content_hash,
        mtime=mtime,
        status=status,
        last_error=str(embed_error or ""),
        chunk_count=len(chunks),
        indexed_at=indexed_at,
        updated_at=indexed_at,
        raw_text="",
        normalized_text="",
    )
    if chunks:
        knowledge_index_db.replace_chunks(int(source.get("id") or 0), chunks, vectors if len(vectors) == len(chunks) else [])
    else:
        knowledge_index_db.replace_chunks(int(source.get("id") or 0), [], [])
    latest_job = knowledge_index_db.latest_job_for_source(root_n, _FILE_SOURCE, rel)
    return _registry_entry(rel, previous, knowledge_index_db.get_source(root_n, _FILE_SOURCE, rel), latest_job)


def set_entry(
    root_dir: str,
    rel_path: str,
    tags: Optional[List[str]] = None,
    note: str = "",
    app_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    full, rel = _resolve_under_root(root_n, rel_path)
    if not full or not os.path.isfile(full):
        raise ValueError("路径无效或不是文件")
    if _is_rel_path_excluded(rel, get_scan_settings().get("scan_excluded_dirs") or []):
        raise ValueError("该文件位于排除目录中，请先调整扫描设置")
    ext = os.path.splitext(full)[1].lower()
    if ext not in _SUPPORTED_FILE_EXTS:
        raise ValueError("仅支持 .md / .markdown / .txt 标记为知识库")

    data = load_store()
    data.setdefault("entries", {})
    now = _now_iso()
    prev = data["entries"].get(rel, {})
    entry = dict(prev) if isinstance(prev, dict) else {}
    entry.update(
        {
            "tags": _safe_tags(tags if tags is not None else prev.get("tags") or []),
            "note": str(note if note is not None else prev.get("note") or ""),
            "added_at": prev.get("added_at") or now,
            "updated_at": now,
            "scan_status": str(prev.get("scan_status") or "discovered"),
        }
    )
    data["entries"][rel] = entry
    save_store(data)
    return _index_file_source(root_dir, rel, tags=entry["tags"], note=entry["note"], app_config=app_config)


def queue_entry(
    root_dir: str,
    rel_path: str,
    tags: Optional[List[str]] = None,
    note: str = "",
    app_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    full, rel = _resolve_under_root(root_n, rel_path)
    if not full or not os.path.isfile(full):
        raise ValueError("路径无效或不是文件")
    if _is_rel_path_excluded(rel, get_scan_settings().get("scan_excluded_dirs") or []):
        raise ValueError("该文件位于排除目录中，请先调整扫描设置")
    ext = os.path.splitext(full)[1].lower()
    if ext not in _SUPPORTED_FILE_EXTS:
        raise ValueError("仅支持 .md / .markdown / .txt 标记为知识库")

    data = load_store()
    data.setdefault("entries", {})
    now = _now_iso()
    prev = data["entries"].get(rel, {})
    entry = dict(prev) if isinstance(prev, dict) else {}
    entry.update(
        {
            "tags": _safe_tags(tags if tags is not None else prev.get("tags") or []),
            "note": str(note if note is not None else prev.get("note") or ""),
            "added_at": prev.get("added_at") or now,
            "updated_at": now,
            "scan_status": str(prev.get("scan_status") or "queued"),
        }
    )
    data["entries"][rel] = entry
    save_store(data)
    knowledge_index_db.upsert_source(
        root_dir=root_n,
        source_type=_FILE_SOURCE,
        source_key=rel,
        display_name=rel,
        title=os.path.basename(rel),
        note=entry["note"],
        tags_json=_tags_json(entry["tags"]),
        content_hash="",
        mtime=float(_file_state(root_n, rel).get("mtime") or 0.0),
        status="queued",
        last_error="",
        chunk_count=0,
        indexed_at="",
        updated_at=now,
        raw_text="",
        normalized_text="",
    )

    def runner(progress: Any) -> None:
        progress(stage="queued", message="等待后台处理", progress=0.02)
        knowledge_index_db.upsert_source(
            root_dir=root_n,
            source_type=_FILE_SOURCE,
            source_key=rel,
            display_name=rel,
            title=os.path.basename(rel),
            note=entry["note"],
            tags_json=_tags_json(entry["tags"]),
            content_hash="",
            mtime=float(_file_state(root_n, rel).get("mtime") or 0.0),
            status="running",
            last_error="",
            chunk_count=0,
            indexed_at="",
            updated_at=_now_iso(),
            raw_text="",
            normalized_text="",
        )
        _index_file_source(
            root_n,
            rel,
            tags=entry["tags"],
            note=entry["note"],
            app_config=app_config,
            progress_callback=progress,
        )

    job = knowledge_job_manager.get_job_manager().enqueue(
        root_dir=root_n,
        job_type="file_index",
        source_type=_FILE_SOURCE,
        source_key=rel,
        payload={"path": rel, "note": entry["note"], "tags": entry["tags"]},
        runner=runner,
    )
    source = knowledge_index_db.get_source(root_n, _FILE_SOURCE, rel)
    public_entry = _registry_entry(rel, entry, source, job)
    public_entry["exists"] = True
    public_entry["stale"] = False
    public_entry["queued"] = True
    return public_entry


def rebuild_entry(root_dir: str, rel_path: str, app_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    _full, rel = _resolve_under_root(root_dir, rel_path)
    if _is_rel_path_excluded(rel, get_scan_settings().get("scan_excluded_dirs") or []):
        raise ValueError("该文件位于排除目录中，请先调整扫描设置")
    meta = get_meta(rel, root_dir=root_dir)
    if meta is None:
        raise ValueError("该文件未加入知识库")
    return _index_file_source(
        root_dir,
        rel,
        tags=meta.get("tags") or [],
        note=str(meta.get("note") or ""),
        app_config=app_config,
    )


def queue_rebuild_entry(root_dir: str, rel_path: str, app_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    _full, rel = _resolve_under_root(root_dir, rel_path)
    meta = get_meta(rel, root_dir=root_dir)
    if meta is None:
        raise ValueError("该文件未加入知识库")
    return queue_entry(
        root_dir,
        rel,
        tags=meta.get("tags") or [],
        note=str(meta.get("note") or ""),
        app_config=app_config,
    )


def remove_entry(root_dir: str, rel_path: str) -> None:
    root_n = _normalize_root(root_dir)
    _full, rel = _resolve_under_root(root_n, rel_path)
    active_job = knowledge_index_db.find_active_job(root_n, _FILE_SOURCE, rel)
    if active_job:
        raise ValueError("该文件仍在后台处理中，请等待完成后再移除")
    data = load_store()
    data.setdefault("entries", {})
    previous = data["entries"].get(rel)
    if isinstance(previous, dict) and previous.get("auto_discovered"):
        kept = dict(previous)
        kept["scan_status"] = "discovered" if _file_state(root_n, rel).get("exists") else "missing"
        kept["updated_at"] = _now_iso()
        data["entries"][rel] = kept
    else:
        data["entries"].pop(rel, None)
    save_store(data)
    knowledge_index_db.delete_source(root_n, _FILE_SOURCE, rel)


def _scan_file_entries(
    root_dir: str,
    *,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    excluded_dirs = get_scan_settings().get("scan_excluded_dirs") or []
    data = load_store()
    data.setdefault("entries", {})
    entries = data["entries"] if isinstance(data.get("entries"), dict) else {}
    now = _now_iso()
    found: set[str] = set()
    scanned_dirs = 0
    matched_files = 0
    new_files = 0
    updated_files = 0
    missing_files = 0
    total_seen = 0
    if progress_callback is not None:
        progress_callback(stage="scanning", message="正在扫描目录", progress=0.02)
    last_progress_at = 0.0
    last_progress_dir = 0

    for current_root, dirnames, filenames in os.walk(root_n):
        _filter_scan_dirnames(root_n, current_root, dirnames, excluded_dirs)
        scanned_dirs += 1
        for filename in filenames:
            total_seen += 1
            full = os.path.join(current_root, filename)
            if not _supported_file_ext(full):
                continue
            rel = _format_rel_for_store(root_n, full)
            if _is_rel_path_excluded(os.path.dirname(rel), excluded_dirs) or _is_rel_path_excluded(rel, excluded_dirs):
                continue
            found.add(rel)
            stat = os.stat(full)
            size = int(stat.st_size)
            mtime = float(stat.st_mtime)
            ext = os.path.splitext(filename)[1].lower()
            previous = entries.get(rel, {})
            is_new = not isinstance(previous, dict)
            if is_new:
                previous = {}
            changed = (
                is_new
                or int(previous.get("size") or 0) != size
                or abs(float(previous.get("mtime") or 0.0) - mtime) > 1e-6
                or str(previous.get("ext") or "") != ext
                or str(previous.get("scan_status") or "") == "missing"
            )
            meta = dict(previous)
            meta.update(
                {
                    "auto_discovered": True,
                    "ext": ext,
                    "size": size,
                    "mtime": mtime,
                    "discovered_at": str(previous.get("discovered_at") or now),
                    "scanned_at": now,
                    "scan_status": "discovered",
                    "updated_at": now if changed else str(previous.get("updated_at") or now),
                    "added_at": str(previous.get("added_at") or now),
                    "tags": _safe_tags(previous.get("tags") or []),
                    "note": str(previous.get("note") or ""),
                }
            )
            entries[rel] = meta
            matched_files += 1
            if is_new:
                new_files += 1
            elif changed:
                updated_files += 1
        now_mono = time.monotonic()
        should_report_progress = (
            progress_callback is not None
            and (
                scanned_dirs - last_progress_dir >= 50
                or now_mono - last_progress_at >= 0.75
            )
        )
        if should_report_progress:
            last_progress_at = now_mono
            last_progress_dir = scanned_dirs
            progress_callback(
                stage="scanning",
                message=f"已扫描 {scanned_dirs} 个目录，发现 {matched_files} 个候选文件",
                progress=min(0.92, 0.05 + min(scanned_dirs, 2000) / 2200.0),
                current_count=scanned_dirs,
                total_count=0,
            )

    for rel, meta in list(entries.items()):
        if not isinstance(meta, dict) or not meta.get("auto_discovered"):
            continue
        if _is_rel_path_excluded(rel, excluded_dirs):
            meta = dict(meta)
            meta["scan_status"] = "excluded"
            meta["scanned_at"] = now
            entries[rel] = meta
            continue
        if rel in found:
            continue
        if str(meta.get("scan_status") or "") != "missing":
            meta = dict(meta)
            meta["scan_status"] = "missing"
            meta["scanned_at"] = now
            meta["updated_at"] = now
            entries[rel] = meta
            missing_files += 1

    data["entries"] = entries
    save_store(data)
    return {
        "scanned_dirs": scanned_dirs,
        "matched_files": matched_files,
        "new_files": new_files,
        "updated_files": updated_files,
        "missing_files": missing_files,
        "finished_at": now,
    }


def scan_files(root_dir: str) -> Dict[str, Any]:
    return _scan_file_entries(root_dir)


def queue_scan_files(root_dir: str) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    knowledge_index_db.upsert_source(
        root_dir=root_n,
        source_type=_SCAN_SOURCE,
        source_key=_SCAN_SOURCE_KEY,
        display_name="Knowledge File Scan",
        title="Knowledge File Scan",
        note="",
        tags_json="[]",
        content_hash="",
        mtime=0.0,
        status="queued",
        last_error="",
        chunk_count=0,
        indexed_at="",
        updated_at=_now_iso(),
        raw_text="",
        normalized_text="",
    )

    def runner(progress: Any) -> None:
        progress(stage="queued", message="等待扫描任务开始", progress=0.02)
        knowledge_index_db.upsert_source(
            root_dir=root_n,
            source_type=_SCAN_SOURCE,
            source_key=_SCAN_SOURCE_KEY,
            display_name="Knowledge File Scan",
            title="Knowledge File Scan",
            note="",
            tags_json="[]",
            content_hash="",
            mtime=0.0,
            status="running",
            last_error="",
            chunk_count=0,
            indexed_at="",
            updated_at=_now_iso(),
            raw_text="",
            normalized_text="",
        )
        result = _scan_file_entries(root_n, progress_callback=progress)
        knowledge_index_db.upsert_source(
            root_dir=root_n,
            source_type=_SCAN_SOURCE,
            source_key=_SCAN_SOURCE_KEY,
            display_name="Knowledge File Scan",
            title="Knowledge File Scan",
            note="",
            tags_json="[]",
            content_hash="",
            mtime=0.0,
            status="completed",
            last_error="",
            chunk_count=int(result.get("matched_files") or 0),
            indexed_at=_now_iso(),
            updated_at=_now_iso(),
            raw_text="",
            normalized_text="",
        )
        progress(
            stage="completed",
            message=f"扫描完成：{int(result.get('matched_files') or 0)} 个文件",
            progress=1.0,
            current_count=int(result.get("scanned_dirs") or 0),
            total_count=0,
        )

    return knowledge_job_manager.get_job_manager().enqueue(
        root_dir=root_n,
        job_type="file_scan",
        source_type=_SCAN_SOURCE,
        source_key=_SCAN_SOURCE_KEY,
        payload={"scope": "supported_knowledge_files"},
        runner=runner,
    )


def preview_entry(root_dir: str, rel_path: str, *, max_chars: int = _DEFAULT_PREVIEW_MAX_CHARS) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    full, rel = _resolve_under_root(root_n, rel_path)
    if not full or not os.path.isfile(full):
        raise ValueError("文件不存在")
    if not _supported_file_ext(full):
        raise ValueError("仅支持预览 .md / .markdown / .txt")
    with open(full, "r", encoding="utf-8", errors="replace") as handle:
        text = handle.read(max(1, int(max_chars or _DEFAULT_PREVIEW_MAX_CHARS)) + 1)
    truncated = len(text) > max_chars
    if truncated:
        text = text[:max_chars]
    return {
        "path": rel,
        "ext": os.path.splitext(full)[1].lower(),
        "text": text,
        "truncated": truncated,
        "size": int(os.path.getsize(full)),
    }


def _ensure_registered_entries_current(
    root_dir: str,
    *,
    app_config: Optional[Dict[str, Any]] = None,
    max_file_bytes: int = _DEFAULT_INDEX_MAX_FILE_BYTES,
) -> None:
    root_n = _normalize_root(root_dir)
    excluded_dirs = get_scan_settings().get("scan_excluded_dirs") or []
    data = load_store()
    entries = data.get("entries", {})
    if not isinstance(entries, dict):
        return
    for rel_path, meta in entries.items():
        rel = _normalize_rel_path(rel_path)
        if _is_rel_path_excluded(rel, excluded_dirs):
            continue
        source = knowledge_index_db.get_source(root_n, _FILE_SOURCE, rel)
        if not source and str((meta or {}).get("scan_status") or "") in ("discovered", "missing"):
            continue
        if source and str(source.get("status") or "") in ("queued", "running"):
            continue
        if not _is_source_stale(root_n, source, rel):
            continue
        full = _under_root(root_n, rel)
        if not full or not os.path.isfile(full):
            source = knowledge_index_db.upsert_source(
                root_dir=root_n,
                source_type=_FILE_SOURCE,
                source_key=rel,
                display_name=rel,
                title=os.path.basename(rel),
                note=str((meta or {}).get("note") or ""),
                tags_json=_tags_json((meta or {}).get("tags") or []),
                content_hash="",
                mtime=0.0,
                status="missing",
                last_error="源文件不存在",
                chunk_count=0,
                indexed_at=str(source.get("indexed_at") if source else ""),
                updated_at=_now_iso(),
                raw_text="",
                normalized_text="",
            )
            knowledge_index_db.replace_chunks(int((source or {}).get("id") or 0), [], [])
            continue
        _index_file_source(
            root_n,
            rel,
            tags=(meta or {}).get("tags") or [],
            note=str((meta or {}).get("note") or ""),
            app_config=app_config,
            max_file_bytes=max_file_bytes,
        )


def _snippet_public(meta: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(meta.get("source_key") or ""),
        "title": str(meta.get("title") or ""),
        "text": str(meta.get("raw_text") or ""),
        "normalized_text": str(meta.get("normalized_text") or ""),
        "note": str(meta.get("note") or ""),
        "tags": _parse_tags(meta.get("tags_json")),
        "index_status": str(meta.get("status") or ""),
        "indexed_at": str(meta.get("indexed_at") or ""),
        "updated_at": str(meta.get("updated_at") or ""),
        "chunk_count": int(meta.get("chunk_count") or 0),
        "last_error": str(meta.get("last_error") or ""),
    }


def list_snippets(root_dir: str) -> List[Dict[str, Any]]:
    rows = knowledge_index_db.list_sources(_normalize_root(root_dir), _SNIPPET_SOURCE)
    return [_snippet_public(row) for row in rows]


def get_snippet(root_dir: str, snippet_id: str) -> Optional[Dict[str, Any]]:
    source = knowledge_index_db.get_source(_normalize_root(root_dir), _SNIPPET_SOURCE, str(snippet_id or "").strip())
    if not source:
        return None
    return _snippet_public(source)


def _upsert_snippet(
    root_dir: str,
    *,
    snippet_id: Optional[str],
    text: str,
    title: str = "",
    tags: Optional[Iterable[str]] = None,
    note: str = "",
    app_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    normalized_text = _normalize_freeform_text(text)
    if not normalized_text:
        raise ValueError("text 不能为空")
    snippet_key = str(snippet_id or uuid.uuid4().hex[:16]).strip()
    snippet_title = str(title or "").strip() or _default_snippet_title(normalized_text)
    safe_tags = _safe_tags(tags)
    vectors, embed_error = _batch_embed_texts(app_config, [normalized_text], is_query=False)
    now = _now_iso()
    payload = normalized_text.encode("utf-8", errors="replace")
    source = knowledge_index_db.upsert_source(
        root_dir=root_n,
        source_type=_SNIPPET_SOURCE,
        source_key=snippet_key,
        display_name=snippet_title,
        title=snippet_title,
        note=str(note or ""),
        tags_json=_tags_json(safe_tags),
        content_hash=hashlib.sha256(payload).hexdigest(),
        mtime=0.0,
        status="indexed" if vectors else "indexed_partial",
        last_error=str(embed_error or ""),
        chunk_count=1,
        indexed_at=now,
        updated_at=now,
        raw_text=str(text or "").strip(),
        normalized_text=normalized_text,
    )
    knowledge_index_db.replace_chunks(
        int(source.get("id") or 0),
        [
            {
                "chunk_index": 0,
                "heading_path": "",
                "text": normalized_text,
                "token_count": len(_tokenize(normalized_text)),
                "char_count": len(normalized_text),
                "created_at": now,
            }
        ],
        vectors if vectors else [],
    )
    latest = knowledge_index_db.get_source(root_n, _SNIPPET_SOURCE, snippet_key) or source
    return _snippet_public(latest)


def add_snippet(
    root_dir: str,
    text: str,
    *,
    title: str = "",
    tags: Optional[List[str]] = None,
    note: str = "",
    app_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return _upsert_snippet(
        root_dir,
        snippet_id=None,
        text=text,
        title=title,
        tags=tags,
        note=note,
        app_config=app_config,
    )


def update_snippet(
    root_dir: str,
    snippet_id: str,
    *,
    text: str,
    title: str = "",
    tags: Optional[List[str]] = None,
    note: str = "",
    app_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    existing = knowledge_index_db.get_source(_normalize_root(root_dir), _SNIPPET_SOURCE, str(snippet_id or "").strip())
    if not existing:
        raise ValueError("snippet 不存在")
    return _upsert_snippet(
        root_dir,
        snippet_id=snippet_id,
        text=text,
        title=title or str(existing.get("title") or ""),
        tags=tags if tags is not None else _parse_tags(existing.get("tags_json")),
        note=note if note is not None else str(existing.get("note") or ""),
        app_config=app_config,
    )


def remove_snippet(root_dir: str, snippet_id: str) -> None:
    knowledge_index_db.delete_source(_normalize_root(root_dir), _SNIPPET_SOURCE, str(snippet_id or "").strip())


def list_jobs(
    root_dir: str,
    *,
    limit: int = 50,
    source_type: Optional[str] = None,
    source_key: Optional[str] = None,
) -> List[Dict[str, Any]]:
    rows = knowledge_index_db.list_jobs(
        _normalize_root(root_dir),
        limit=limit,
        source_type=source_type,
        source_key=source_key,
    )
    return [item for item in (_job_to_public(row) for row in rows) if item]


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    return _job_to_public(knowledge_index_db.get_job(str(job_id or "").strip()))


def get_index_status(root_dir: str) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    summary = knowledge_index_db.get_summary(root_n)
    overview = get_registry_overview(root_n)
    jobs = list_jobs(root_n, limit=100)
    scan_settings = get_scan_settings()
    job_counts: Dict[str, int] = {}
    for item in jobs:
        status = str(item.get("status") or "")
        job_counts[status] = job_counts.get(status, 0) + 1
    return {
        **summary,
        **overview,
        "snippet_count": len(list_snippets(root_n)),
        "job_counts": job_counts,
        "scan_settings": scan_settings,
    }


def retrieve_for_query(
    root_dir: str,
    query: str,
    top_k: int = 6,
    max_file_bytes: int = 200_000,
    app_config: Optional[Dict[str, Any]] = None,
) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    q = str(query or "").strip()
    if not q:
        return "", [], []

    root_n = _normalize_root(root_dir)
    _ensure_registered_entries_current(root_n, app_config=app_config, max_file_bytes=max_file_bytes)
    chunks = knowledge_index_db.list_chunks(root_n, statuses=("indexed", "indexed_partial"))
    sources = knowledge_index_db.list_sources(root_n)
    suggestions_base = []
    for source in sources:
        source_type = str(source.get("source_type") or "")
        if source_type == _FILE_SOURCE:
            suggestions_base.append(str(source.get("display_name") or source.get("source_key") or ""))
        elif source_type == _SNIPPET_SOURCE:
            suggestions_base.append(str(source.get("title") or source.get("display_name") or ""))

    name_suggestions: List[str] = []
    q_low = q.lower()
    direct_names = [name for name in suggestions_base if q_low in name.lower()]
    name_suggestions.extend(direct_names[:8])
    if len(name_suggestions) < 5 and suggestions_base:
        for name in get_close_matches(q, suggestions_base, n=5, cutoff=0.4):
            if name not in name_suggestions:
                name_suggestions.append(name)

    if not chunks:
        if name_suggestions:
            context = "知识库中暂无正文索引，可参考以下名称接近的条目：\n" + "\n".join(
                f"- {item}" for item in name_suggestions[:8]
            )
            return context, [], name_suggestions[:12]
        return "", [], []

    docs = []
    for chunk in chunks:
        combined = "\n".join(
            [
                str(chunk.get("display_name") or ""),
                str(chunk.get("title") or ""),
                str(chunk.get("heading_path") or ""),
                str(chunk.get("text") or ""),
            ]
        )
        docs.append(_tokenize(combined))
    lexical_scores = _bm25_scores(docs, q)
    lexical_norm = _normalize_scores(lexical_scores)

    query_vectors, query_embed_error = _batch_embed_texts(app_config, [q], is_query=True)
    vector_scores: List[float] = []
    if query_vectors:
        query_vector = query_vectors[0]
        for chunk in chunks:
            try:
                vector = json.loads(str(chunk.get("vector_json") or "[]"))
                if not isinstance(vector, list):
                    vector_scores.append(0.0)
                    continue
                vector_scores.append(_cosine_similarity(query_vector, [float(item) for item in vector]))
            except Exception:
                vector_scores.append(0.0)
    else:
        vector_scores = [0.0] * len(chunks)
    vector_norm = _normalize_scores(vector_scores)

    hits: List[Dict[str, Any]] = []
    for idx, chunk in enumerate(chunks):
        lexical = lexical_norm[idx] if idx < len(lexical_norm) else 0.0
        vector = vector_norm[idx] if idx < len(vector_norm) else 0.0
        source_name = str(chunk.get("display_name") or chunk.get("title") or chunk.get("source_key") or "")
        title_name = str(chunk.get("title") or "")
        title_bonus = 0.0
        if q_low in source_name.lower() or (title_name and q_low in title_name.lower()):
            title_bonus = 0.08
        final = lexical if not query_vectors else (0.45 * lexical + 0.55 * vector)
        final += title_bonus
        hits.append(
            {
                "source_type": str(chunk.get("source_type") or ""),
                "path": str(chunk.get("source_key") or ""),
                "title": title_name,
                "display_name": source_name,
                "heading_path": str(chunk.get("heading_path") or ""),
                "chunk_index": int(chunk.get("chunk_index") or 0),
                "score": round(final, 6),
                "lexical_score": round(lexical, 6),
                "vector_score": round(vector, 6),
                "text": str(chunk.get("text") or ""),
            }
        )

    ranked = sorted(hits, key=lambda item: item["score"], reverse=True)
    selected = [item for item in ranked if item["score"] > 0][: max(1, int(top_k or 6))]
    if not selected and ranked:
        selected = ranked[:1]

    context_parts: List[str] = []
    out_hits: List[Dict[str, Any]] = []
    for item in selected:
        label = ""
        if item["source_type"] == _FILE_SOURCE:
            label = f"文件: {item['display_name']}"
            if item.get("heading_path"):
                label += f" / {item['heading_path']}"
        else:
            label = f"零散知识: {item.get('title') or item.get('display_name')}"
        context_parts.append(f"--- {label} (片段{item['chunk_index']}) ---\n{item['text']}\n")
        hit_meta = dict(item)
        hit_meta.pop("text", None)
        if query_embed_error:
            hit_meta["vector_warning"] = query_embed_error
        out_hits.append(hit_meta)

    context = "\n".join(context_parts).strip()
    if not context and name_suggestions:
        context = "未找到强命中内容，可参考以下名称接近的条目：\n" + "\n".join(
            f"- {item}" for item in name_suggestions[:8]
        )
    return context, out_hits, name_suggestions[:12]
