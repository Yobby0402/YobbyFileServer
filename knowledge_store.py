"""
知识库元数据（不修改原文件）：路径相对 ROOT_DIR，支持 BM25 检索与文件名模糊匹配。
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import threading
from collections import Counter
from difflib import get_close_matches
from typing import Any, Dict, List, Optional, Tuple

_lock = threading.RLock()


def _base_dir() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def _store_path() -> str:
    d = os.path.join(_base_dir(), "data", "local_ai")
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, "knowledge_files.json")


def _normalize_rel_path(p: str) -> str:
    p = (p or "").replace("\\", "/").strip()
    p = re.sub(r"^/+", "", p)
    return p


def _under_root(root: str, rel: str) -> Optional[str]:
    root_n = os.path.normpath(os.path.abspath(root))
    full = os.path.normpath(os.path.join(root_n, rel))
    if not full.startswith(root_n + os.sep) and full != root_n:
        return None
    return full


def load_store() -> Dict[str, Any]:
    path = _store_path()
    with _lock:
        if not os.path.exists(path):
            return {"entries": {}}
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                return {"entries": {}}
            data.setdefault("entries", {})
            if not isinstance(data["entries"], dict):
                data["entries"] = {}
            return data
        except Exception:
            return {"entries": {}}


def save_store(data: Dict[str, Any]) -> None:
    path = _store_path()
    tmp = path + ".tmp"
    with _lock:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)


def list_entries(root_dir: str) -> List[Dict[str, Any]]:
    data = load_store()
    root_n = os.path.normpath(os.path.abspath(root_dir))
    out = []
    for rel, meta in data.get("entries", {}).items():
        rel = _normalize_rel_path(rel)
        full = _under_root(root_n, rel)
        if full and os.path.isfile(full):
            entry = {"path": rel, **(meta if isinstance(meta, dict) else {})}
            out.append(entry)
    return sorted(out, key=lambda x: x.get("path", ""))


def set_entry(root_dir: str, rel_path: str, tags: Optional[List[str]] = None, note: str = "") -> Dict[str, Any]:
    from datetime import datetime

    rel = _normalize_rel_path(rel_path)
    full = _under_root(os.path.normpath(os.path.abspath(root_dir)), rel)
    if not full or not os.path.isfile(full):
        raise ValueError("路径无效或不是文件")
    ext = os.path.splitext(full)[1].lower()
    if ext not in (".md", ".markdown", ".txt"):
        raise ValueError("仅支持 .md / .txt 标记为知识库")

    data = load_store()
    data.setdefault("entries", {})
    now = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    prev = data["entries"].get(rel, {})
    entry = {
        "tags": list(tags) if tags is not None else prev.get("tags", []),
        "note": note if note is not None else prev.get("note", ""),
        "added_at": prev.get("added_at") or now,
        "updated_at": now,
    }
    data["entries"][rel] = entry
    save_store(data)
    return {"path": rel, **entry}


def get_meta(rel_path: str) -> Optional[Dict[str, Any]]:
    rel = _normalize_rel_path(rel_path)
    data = load_store()
    ent = data.get("entries", {}).get(rel)
    return dict(ent) if isinstance(ent, dict) else None


def remove_entry(root_dir: str, rel_path: str) -> None:
    rel = _normalize_rel_path(rel_path)
    data = load_store()
    data.setdefault("entries", {})
    data["entries"].pop(rel, None)
    save_store(data)


def _tokenize(text: str) -> List[str]:
    return re.findall(r"[\w\u4e00-\u9fff]+", text.lower())


def _bm25_scores(docs: List[List[str]], query: str, k1: float = 1.5, b: float = 0.75) -> List[float]:
    q_terms = _tokenize(query)
    if not q_terms:
        return [0.0] * len(docs)
    N = len(docs)
    df: Counter = Counter()
    doc_lens = [len(d) for d in docs]
    avgdl = sum(doc_lens) / N if N else 0
    for d in docs:
        df.update(set(d))
    scores = []
    for d in docs:
        tf = Counter(d)
        dl = len(d)
        score = 0.0
        for term in q_terms:
            if term not in tf:
                continue
            n = df[term]
            idf = math.log((N - n + 0.5) / (n + 0.5) + 1.0)
            f = tf[term]
            denom = f + k1 * (1 - b + b * dl / avgdl) if avgdl else f + k1
            score += idf * (f * (k1 + 1)) / denom
        scores.append(score)
    return scores


def _chunk_text(text: str, max_chars: int = 1200) -> List[str]:
    parts = re.split(r"\n\n+", text)
    chunks: List[str] = []
    buf = ""
    for p in parts:
        if len(buf) + len(p) + 2 <= max_chars:
            buf = (buf + "\n\n" + p).strip() if buf else p
        else:
            if buf:
                chunks.append(buf)
            buf = p if len(p) <= max_chars else p[:max_chars]
    if buf:
        chunks.append(buf)
    return chunks


def retrieve_for_query(
    root_dir: str,
    query: str,
    top_k: int = 6,
    max_file_bytes: int = 200_000,
) -> Tuple[str, List[Dict[str, Any]], List[str]]:
    """
    返回 (拼接的上下文字符串, 命中的片段元数据列表, 文件名建议列表)。
    """
    entries = list_entries(root_dir)
    root_n = os.path.normpath(os.path.abspath(root_dir))
    all_chunks: List[Tuple[str, str, int]] = []  # (rel_path, text, chunk_idx)
    doc_tokens: List[List[str]] = []

    for ent in entries:
        rel = ent["path"]
        full = _under_root(root_n, rel)
        if not full:
            continue
        try:
            if os.path.getsize(full) > max_file_bytes:
                text = "[文件过大，已跳过全文索引]"
            else:
                with open(full, "r", encoding="utf-8", errors="replace") as f:
                    text = f.read()
        except Exception:
            continue
        for i, ch in enumerate(_chunk_text(text)):
            all_chunks.append((rel, ch, i))
            doc_tokens.append(_tokenize(ch))

    meta_hits: List[Dict[str, Any]] = []
    context_parts: List[str] = []

    if doc_tokens and query.strip():
        scores = _bm25_scores(doc_tokens, query)
        ranked = sorted(enumerate(scores), key=lambda x: -x[1])
        seen = 0
        for idx, sc in ranked:
            if sc <= 0 and seen > 0:
                break
            if sc <= 0 and seen == 0:
                continue
            rel, ch, ci = all_chunks[idx]
            meta_hits.append({"path": rel, "chunk_index": ci, "score": round(sc, 4)})
            context_parts.append(f"--- 文件: {rel} (片段{ci}) ---\n{ch}\n")
            seen += 1
            if seen >= top_k:
                break

    # 文件名提示：仅在「已登记为知识库」的路径上匹配，避免对整个 ROOT_DIR 递归 os.walk
    # （根目录很大时会长时间占满磁盘/CPU，极端情况下加剧整机不稳定）。
    name_suggestions: List[str] = []
    qn = query.strip().lower()
    if qn:
        kb_paths = [_normalize_rel_path(e["path"]) for e in entries]
        subs = [n for n in kb_paths if qn in n.lower()]
        name_suggestions.extend(subs[:8])
        if len(name_suggestions) < 5 and kb_paths:
            bases = [os.path.basename(n) for n in kb_paths]
            close = get_close_matches(qn, bases, n=5, cutoff=0.4)
            base_to_rel = {os.path.basename(n): n for n in kb_paths}
            for c in close:
                r = base_to_rel.get(c)
                if r and r not in name_suggestions:
                    name_suggestions.append(r)

    context = "\n".join(context_parts)
    if not context.strip() and name_suggestions:
        context = "未在知识库正文中找到强匹配。可参考以下文件名相近的文件：\n" + "\n".join(f"- {n}" for n in name_suggestions[:8])

    return context, meta_hits, name_suggestions[:12]
