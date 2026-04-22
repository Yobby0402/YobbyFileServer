from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple

from . import knowledge_index_db
from . import knowledge_job_manager
from . import knowledge_store
from .paths import project_base_dir

SOURCE_TYPE = "product_compare"
INDEXED_STATUSES = ("indexed", "indexed_partial")


def _now_iso() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _normalize_root(root_dir: Optional[str]) -> str:
    return os.path.normpath(os.path.abspath(root_dir or project_base_dir()))


def _safe_tags(tags: Optional[Iterable[str]]) -> List[str]:
    out: List[str] = []
    for item in tags or []:
        text = str(item or "").strip()
        if text and text not in out:
            out.append(text)
    return out


def _source_key(entity_type: str, entity_id: str) -> str:
    return f"{entity_type}:{entity_id}"


def _entity_type_from_source_key(source_key: str) -> str:
    prefix, _sep, _rest = str(source_key or "").partition(":")
    return prefix or "unknown"


def _hash_text(text: str) -> str:
    return hashlib.sha256(str(text or "").encode("utf-8", errors="replace")).hexdigest()


def _timestamp_to_float(value: Any) -> float:
    text = str(value or "").strip()
    if not text:
        return 0.0
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text).timestamp()
    except Exception:
        return 0.0


def _parse_tags_json(value: Any) -> List[str]:
    return knowledge_store._parse_tags(value)


def _attribute_lines(attributes: List[Dict[str, Any]]) -> List[str]:
    lines: List[str] = []
    ordered = sorted(attributes, key=lambda item: int(item.get("order") or 0))
    for attr in ordered:
        if not isinstance(attr, dict):
            continue
        bits = [
            str(attr.get("name") or "").strip() or str(attr.get("id") or "").strip() or "未命名属性",
            f"id={attr.get('id') or ''}",
            f"type={attr.get('type') or 'text'}",
            f"common={bool(attr.get('is_common', False))}",
        ]
        unit = str(attr.get("unit") or "").strip()
        if unit:
            bits.append(f"unit={unit}")
        direction = str(attr.get("direction") or "").strip()
        if direction:
            bits.append(f"direction={direction}")
        lines.append("- " + " | ".join(bits))
    return lines


def _product_summary_line(product: Dict[str, Any]) -> str:
    name = str(product.get("name") or "").strip() or "未命名产品"
    belonging = str(product.get("belonging") or "").strip() or "未归属"
    link = str(product.get("link") or "").strip()
    bits = [name, f"归属={belonging}"]
    if link:
        bits.append(f"链接={link}")
    return "- " + " | ".join(bits)


def _file_text(file_data: Dict[str, Any]) -> str:
    name = str(file_data.get("name") or "").strip() or "未命名对比"
    attributes = list(file_data.get("attributes") or [])
    products = list(file_data.get("products") or [])
    belonging_colors = file_data.get("belonging_colors") or {}
    if not isinstance(belonging_colors, dict):
        belonging_colors = {}
    lines = [
        f"对比名称: {name}",
        f"属性数量: {len(attributes)}",
        f"产品数量: {len(products)}",
    ]
    if belonging_colors:
        lines.extend(["", "归属颜色:"])
        for belonging, color in sorted(belonging_colors.items(), key=lambda item: str(item[0])):
            lines.append(f"- {belonging}: {color}")
    if attributes:
        lines.extend(["", "属性定义:"])
        lines.extend(_attribute_lines(attributes))
    if products:
        lines.extend(["", "产品列表:"])
        lines.extend(_product_summary_line(product) for product in products if isinstance(product, dict))
    return "\n".join(lines).strip()


def _product_text(file_data: Dict[str, Any], product: Dict[str, Any]) -> str:
    file_name = str(file_data.get("name") or "").strip() or "未命名对比"
    name = str(product.get("name") or "").strip() or "未命名产品"
    belonging = str(product.get("belonging") or "").strip() or "未归属"
    link = str(product.get("link") or "").strip()
    attr_defs = {
        str(attr.get("id") or ""): attr
        for attr in (file_data.get("attributes") or [])
        if isinstance(attr, dict)
    }
    values = product.get("attributes") or {}
    if not isinstance(values, dict):
        values = {}
    lines = [
        f"对比名称: {file_name}",
        f"产品名称: {name}",
        f"归属: {belonging}",
        f"链接: {link}",
    ]
    if values:
        lines.extend(["", "属性值:"])
        for attr_id, value in values.items():
            attr = attr_defs.get(str(attr_id), {})
            attr_name = str(attr.get("name") or attr_id or "未命名属性")
            unit = str(attr.get("unit") or "").strip()
            direction = str(attr.get("direction") or "").strip()
            tail: List[str] = []
            if unit:
                tail.append(f"单位={unit}")
            if direction:
                tail.append(f"方向={direction}")
            rendered = str(value if value is not None else "").strip()
            line = f"- {attr_name}: {rendered}"
            if tail:
                line += " | " + " | ".join(tail)
            lines.append(line)
    return "\n".join(lines).strip()


def _build_file_doc(file_id: str, file_data: Dict[str, Any]) -> Dict[str, Any]:
    updated_at = str(file_data.get("updated_at") or file_data.get("created_at") or _now_iso())
    name = str(file_data.get("name") or "").strip() or "未命名对比"
    products = list(file_data.get("products") or [])
    return {
        "entity_type": "file",
        "entity_id": file_id,
        "source_key": _source_key("file", file_id),
        "display_name": f"产品对比/{name}",
        "title": name,
        "tags": _safe_tags(["product_compare", "file", name, f"products:{len(products)}"]),
        "text": _file_text(file_data),
        "updated_at": updated_at,
    }


def _build_product_doc(file_id: str, file_data: Dict[str, Any], product: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    product_id = str(product.get("id") or "").strip()
    if not product_id:
        return None
    updated_at = str(product.get("updated_at") or product.get("created_at") or file_data.get("updated_at") or _now_iso())
    file_name = str(file_data.get("name") or "").strip() or "未命名对比"
    product_name = str(product.get("name") or "").strip() or "未命名产品"
    belonging = str(product.get("belonging") or "").strip()
    return {
        "entity_type": "product",
        "entity_id": product_id,
        "file_id": file_id,
        "source_key": _source_key("product", f"{file_id}:{product_id}"),
        "display_name": f"产品对比/{file_name}/{product_name}",
        "title": product_name,
        "tags": _safe_tags(["product_compare", "product", file_name, belonging]),
        "text": _product_text(file_data, product),
        "updated_at": updated_at,
    }


def _iter_all_docs(product_compare_manager: Any) -> List[Dict[str, Any]]:
    if product_compare_manager is None:
        return []
    docs: List[Dict[str, Any]] = []
    try:
        files = list(product_compare_manager.list_files() or [])
    except Exception:
        files = []
    for item in files:
        if not isinstance(item, dict):
            continue
        file_id = str(item.get("file_id") or "").strip()
        if not file_id:
            continue
        try:
            file_data = product_compare_manager.get_file(file_id)
        except Exception:
            continue
        docs.append(_build_file_doc(file_id, file_data))
        for product in file_data.get("products") or []:
            if not isinstance(product, dict):
                continue
            doc = _build_product_doc(file_id, file_data, product)
            if doc:
                docs.append(doc)
    return docs


def _index_doc(
    root_dir: str,
    doc: Dict[str, Any],
    *,
    app_config: Optional[Dict[str, Any]] = None,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    text = str(doc.get("text") or "").strip()
    chunks = knowledge_store._chunk_markdown_text(text)
    vectors, embed_error = knowledge_store._batch_embed_texts(
        app_config,
        [item["text"] for item in chunks],
        is_query=False,
        progress_callback=progress_callback,
        progress_stage="embedding",
    )
    status = "indexed" if chunks and not embed_error and len(vectors) == len(chunks) else "indexed_partial"
    indexed_at = _now_iso()
    source = knowledge_index_db.upsert_source(
        root_dir=root_dir,
        source_type=SOURCE_TYPE,
        source_key=str(doc.get("source_key") or ""),
        display_name=str(doc.get("display_name") or ""),
        title=str(doc.get("title") or ""),
        note="",
        tags_json=json.dumps(_safe_tags(doc.get("tags")), ensure_ascii=False),
        content_hash=_hash_text(text),
        mtime=_timestamp_to_float(doc.get("updated_at")),
        status=status,
        last_error=str(embed_error or ""),
        chunk_count=len(chunks),
        indexed_at=indexed_at,
        updated_at=indexed_at,
        raw_text=text,
        normalized_text=knowledge_store._normalize_freeform_text(text),
    )
    knowledge_index_db.replace_chunks(
        int(source.get("id") or 0),
        chunks,
        vectors if len(vectors) == len(chunks) else [],
    )
    latest_job = knowledge_index_db.latest_job_for_source(root_dir, SOURCE_TYPE, str(doc.get("source_key") or ""))
    return {
        "source_key": str(source.get("source_key") or ""),
        "entity_type": _entity_type_from_source_key(str(source.get("source_key") or "")),
        "title": str(source.get("title") or ""),
        "display_name": str(source.get("display_name") or ""),
        "index_status": str(source.get("status") or ""),
        "indexed_at": str(source.get("indexed_at") or ""),
        "updated_at": str(source.get("updated_at") or ""),
        "chunk_count": int(source.get("chunk_count") or 0),
        "last_error": str(source.get("last_error") or ""),
        "tags": _parse_tags_json(source.get("tags_json")),
        "latest_job": knowledge_store._job_to_public(latest_job),
    }


def _delete_sources(root_dir: str, source_keys: Iterable[str]) -> int:
    removed = 0
    for source_key in source_keys:
        key = str(source_key or "").strip()
        if not key:
            continue
        knowledge_index_db.delete_source(root_dir, SOURCE_TYPE, key)
        removed += 1
    return removed


def rebuild_all(
    root_dir: Optional[str],
    product_compare_manager: Any,
    *,
    app_config: Optional[Dict[str, Any]] = None,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    docs = _iter_all_docs(product_compare_manager)
    existing = knowledge_index_db.list_sources(root_n, SOURCE_TYPE)
    existing_keys = {str(item.get("source_key") or "") for item in existing}
    new_keys = {str(item.get("source_key") or "") for item in docs}
    removed = _delete_sources(root_n, existing_keys - new_keys)

    if progress_callback is not None:
        progress_callback(
            stage="collecting",
            message=f"正在准备 {len(docs)} 个产品对比知识条目",
            progress=0.05,
            current_count=0,
            total_count=len(docs),
        )

    indexed_items: List[Dict[str, Any]] = []
    total = max(1, len(docs))
    for idx, doc in enumerate(docs, start=1):
        def doc_progress(**fields: Any) -> None:
            if progress_callback is None:
                return
            doc_progress_value = max(0.0, min(1.0, float(fields.get("progress") or 0.0)))
            overall = min(0.98, 0.1 + 0.88 * (((idx - 1) + doc_progress_value) / total))
            progress_callback(
                stage=str(fields.get("stage") or "embedding"),
                message=f"正在生成产品对比向量 {idx}/{len(docs)}：{fields.get('message') or doc.get('title') or doc.get('display_name') or ''}",
                progress=overall,
                current_count=idx,
                total_count=len(docs),
            )

        indexed_items.append(_index_doc(root_n, doc, app_config=app_config, progress_callback=doc_progress))
        if progress_callback is not None:
            progress_callback(
                stage="indexing",
                message=f"正在索引产品对比知识 {idx}/{len(docs)}",
                progress=min(0.98, 0.1 + 0.88 * (idx / total)),
                current_count=idx,
                total_count=len(docs),
            )
    if progress_callback is not None:
        progress_callback(
            stage="completed",
            message="产品对比知识库重建完成",
            progress=1.0,
            current_count=len(docs),
            total_count=len(docs),
        )
    return {
        "root_dir": root_n,
        "indexed_count": len(indexed_items),
        "removed_count": removed,
        "items": indexed_items,
        "status": get_index_status(root_n),
    }


def queue_rebuild_all(
    root_dir: Optional[str],
    product_compare_manager: Any,
    *,
    app_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)

    def runner(progress_callback: Any) -> None:
        rebuild_all(root_n, product_compare_manager, app_config=app_config, progress_callback=progress_callback)

    return knowledge_job_manager.get_job_manager().enqueue(
        root_dir=root_n,
        job_type="rebuild",
        source_type=SOURCE_TYPE,
        source_key="__product_compare_all__",
        payload={"scope": "all"},
        runner=runner,
    )


def list_entries(root_dir: Optional[str]) -> List[Dict[str, Any]]:
    root_n = _normalize_root(root_dir)
    items: List[Dict[str, Any]] = []
    for source in knowledge_index_db.list_sources(root_n, SOURCE_TYPE):
        latest_job = knowledge_index_db.latest_job_for_source(root_n, SOURCE_TYPE, str(source.get("source_key") or ""))
        items.append(
            {
                "source_key": str(source.get("source_key") or ""),
                "entity_type": _entity_type_from_source_key(str(source.get("source_key") or "")),
                "display_name": str(source.get("display_name") or ""),
                "title": str(source.get("title") or ""),
                "tags": _parse_tags_json(source.get("tags_json")),
                "index_status": str(source.get("status") or ""),
                "chunk_count": int(source.get("chunk_count") or 0),
                "indexed_at": str(source.get("indexed_at") or ""),
                "updated_at": str(source.get("updated_at") or ""),
                "last_error": str(source.get("last_error") or ""),
                "latest_job": knowledge_store._job_to_public(latest_job),
            }
        )
    return items


def get_index_status(root_dir: Optional[str]) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    items = knowledge_index_db.list_sources(root_n, SOURCE_TYPE)
    entity_counts: Dict[str, int] = {}
    status_counts: Dict[str, int] = {}
    for item in items:
        entity_type = _entity_type_from_source_key(str(item.get("source_key") or ""))
        status = str(item.get("status") or "")
        entity_counts[entity_type] = entity_counts.get(entity_type, 0) + 1
        status_counts[status] = status_counts.get(status, 0) + 1
    return {
        "root_dir": root_n,
        "source_type": SOURCE_TYPE,
        "summary": status_counts,
        "entity_counts": entity_counts,
        "total_sources": len(items),
        "total_chunks": sum(int(item.get("chunk_count") or 0) for item in items),
        "latest_jobs": [
            knowledge_store._job_to_public(job)
            for job in knowledge_index_db.list_jobs(root_n, limit=10, source_type=SOURCE_TYPE)
        ],
    }


def retrieve_for_query(
    root_dir: Optional[str],
    query: str,
    *,
    top_k: int = 6,
    app_config: Optional[Dict[str, Any]] = None,
) -> Tuple[str, List[Dict[str, Any]]]:
    q = str(query or "").strip()
    if not q:
        return "", []
    root_n = _normalize_root(root_dir)
    chunks = [
        item
        for item in knowledge_index_db.list_chunks(root_n, statuses=INDEXED_STATUSES)
        if str(item.get("source_type") or "") == SOURCE_TYPE
    ]
    if not chunks:
        return "", []

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
        docs.append(knowledge_store._tokenize(combined))
    lexical_norm = knowledge_store._normalize_scores(knowledge_store._bm25_scores(docs, q))
    query_vectors, _embed_error = knowledge_store._batch_embed_texts(app_config, [q], is_query=True)
    vector_scores: List[float] = []
    if query_vectors:
        query_vector = query_vectors[0]
        for chunk in chunks:
            try:
                vector = json.loads(str(chunk.get("vector_json") or "[]"))
                vector_scores.append(knowledge_store._cosine_similarity(query_vector, [float(item) for item in vector]))
            except Exception:
                vector_scores.append(0.0)
    else:
        vector_scores = [0.0] * len(chunks)
    vector_norm = knowledge_store._normalize_scores(vector_scores)

    q_low = q.lower()
    hits: List[Dict[str, Any]] = []
    for idx, chunk in enumerate(chunks):
        lexical = lexical_norm[idx] if idx < len(lexical_norm) else 0.0
        vector = vector_norm[idx] if idx < len(vector_norm) else 0.0
        display_name = str(chunk.get("display_name") or chunk.get("title") or chunk.get("source_key") or "")
        final = lexical if not query_vectors else (0.45 * lexical + 0.55 * vector)
        if q_low in display_name.lower():
            final += 0.08
        hits.append(
            {
                "source_key": str(chunk.get("source_key") or ""),
                "entity_type": _entity_type_from_source_key(str(chunk.get("source_key") or "")),
                "display_name": display_name,
                "title": str(chunk.get("title") or ""),
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
        label = f"{item['entity_type']}: {item.get('display_name') or item.get('title') or item.get('source_key')}"
        if item.get("heading_path"):
            label += f" / {item['heading_path']}"
        context_parts.append(f"--- {label} (片段{item['chunk_index']}) ---\n{item['text']}\n")
        hit_meta = dict(item)
        hit_meta.pop("text", None)
        out_hits.append(hit_meta)
    return "\n".join(context_parts).strip(), out_hits
