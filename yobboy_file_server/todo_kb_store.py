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

SOURCE_TYPE = "todo"
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


def _progress_value(task: Dict[str, Any]) -> int:
    try:
        value = int(task.get("progress", 0) or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, value))


def _parse_tags_json(value: Any) -> List[str]:
    return knowledge_store._parse_tags(value)


def _serialize_links(links: Iterable[Dict[str, Any]]) -> List[str]:
    out: List[str] = []
    for link in links or []:
        if not isinstance(link, dict):
            continue
        name = str(link.get("name") or "").strip()
        url = str(link.get("url") or "").strip()
        if name and url:
            out.append(f"{name}: {url}")
        elif name:
            out.append(name)
        elif url:
            out.append(url)
    return out


def _project_text(project: Dict[str, Any], extended_manager: Any) -> str:
    project_id = str(project.get("id") or "")
    description = ""
    links: List[Dict[str, Any]] = []
    if extended_manager is not None:
        try:
            description = str(extended_manager.get_project_description(project_id) or "")
        except Exception:
            description = ""
        try:
            links = list(extended_manager.get_project_links(project_id) or [])
        except Exception:
            links = []
    lines = [
        f"项目名称: {project.get('name') or ''}",
        f"阶段: {project.get('phase') or ''}",
        f"归档: {bool(project.get('archived', False))}",
        f"汇报显示: {bool(project.get('show_in_report', True))}",
        f"任务数量: {len(project.get('tasks') or [])}",
    ]
    if description.strip():
        lines.extend(["", "项目描述:", description.strip()])
    link_lines = _serialize_links(links)
    if link_lines:
        lines.extend(["", "项目链接:"])
        lines.extend(f"- {item}" for item in link_lines)
    return "\n".join(lines).strip()


def _task_text(project: Dict[str, Any], task: Dict[str, Any], extended_manager: Any) -> str:
    task_id = str(task.get("id") or "")
    links: List[Dict[str, Any]] = []
    if extended_manager is not None:
        try:
            links = list(extended_manager.get_task_links(task_id) or [])
        except Exception:
            links = []
    comments = task.get("comments") or []
    if not isinstance(comments, list):
        comments = []
    history = task.get("update_history") or []
    if not isinstance(history, list):
        history = []
    lines = [
        f"项目名称: {project.get('name') or ''}",
        f"项目阶段: {project.get('phase') or ''}",
        f"任务标题: {task.get('summary') or ''}",
        f"任务类型: {task.get('task_type') or ''}",
        f"任务描述: {task.get('description') or ''}",
        f"优先级: {task.get('priority') or ''}",
        f"进度: {_progress_value(task)}",
        f"截止日期: {task.get('due_date') or ''}",
        f"周报计划: {task.get('weekly_plan') or ''}",
        f"结论: {task.get('conclusion') or ''}",
        f"汇报显示: {bool(task.get('show_in_report', True))}",
        f"评论数量: {len(comments)}",
    ]
    link_lines = _serialize_links(links)
    if link_lines:
        lines.extend(["", "任务链接:"])
        lines.extend(f"- {item}" for item in link_lines)
    if comments:
        lines.extend(["", "评论摘录:"])
        for comment in comments[-10:]:
            if not isinstance(comment, dict):
                continue
            ts = str(comment.get("timestamp") or "")[:19]
            body = str(comment.get("content") or comment.get("text") or "").strip()
            if body:
                lines.append(f"- [{ts}] {body}")
    if history:
        lines.extend(["", "更新历史:"])
        for item in history[-12:]:
            if not isinstance(item, dict):
                continue
            ts = str(item.get("timestamp") or "")[:19]
            field = str(item.get("field") or "").strip()
            new_value = str(item.get("new_value") or "").strip()
            if field or new_value:
                lines.append(f"- [{ts}] {field}: {new_value}")
    return "\n".join(lines).strip()


def _comment_text(project: Dict[str, Any], task: Dict[str, Any], comment: Dict[str, Any]) -> str:
    return "\n".join(
        [
            f"项目名称: {project.get('name') or ''}",
            f"任务标题: {task.get('summary') or ''}",
            f"评论时间: {comment.get('timestamp') or ''}",
            f"评论内容: {comment.get('content') or comment.get('text') or ''}",
        ]
    ).strip()


def _meeting_note_text(note: Dict[str, Any]) -> str:
    return "\n".join(
        [
            f"日期: {note.get('date') or ''}",
            "会议记录:",
            str(note.get("content") or "").strip(),
        ]
    ).strip()


def _build_project_doc(project: Dict[str, Any], extended_manager: Any) -> Dict[str, Any]:
    project_id = str(project.get("id") or "")
    updated_at = str(project.get("updated_at") or project.get("created_at") or _now_iso())
    return {
        "entity_type": "project",
        "entity_id": project_id,
        "source_key": _source_key("project", project_id),
        "display_name": f"项目/{project.get('name') or '未命名项目'}",
        "title": str(project.get("name") or "未命名项目"),
        "tags": _safe_tags(["todo", "project", str(project.get("phase") or "").strip()]),
        "text": _project_text(project, extended_manager),
        "updated_at": updated_at,
    }


def _build_task_doc(project: Dict[str, Any], task: Dict[str, Any], extended_manager: Any) -> Dict[str, Any]:
    task_id = str(task.get("id") or "")
    updated_at = str(task.get("updated_at") or task.get("created_at") or _now_iso())
    return {
        "entity_type": "task",
        "entity_id": task_id,
        "project_id": str(project.get("id") or ""),
        "source_key": _source_key("task", task_id),
        "display_name": f"任务/{project.get('name') or '未命名项目'}/{task.get('summary') or '未命名任务'}",
        "title": str(task.get("summary") or "未命名任务"),
        "tags": _safe_tags(
            [
                "todo",
                "task",
                str(project.get("name") or "").strip(),
                str(task.get("task_type") or "").strip(),
                "done" if _progress_value(task) >= 100 else "pending",
            ]
        ),
        "text": _task_text(project, task, extended_manager),
        "updated_at": updated_at,
    }


def _build_comment_doc(project: Dict[str, Any], task: Dict[str, Any], comment: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    task_id = str(task.get("id") or "").strip()
    comment_id = str(comment.get("comment_id") or "").strip()
    body = str(comment.get("content") or comment.get("text") or "").strip()
    if not task_id or not comment_id or not body:
        return None
    updated_at = str(comment.get("timestamp") or task.get("updated_at") or _now_iso())
    return {
        "entity_type": "comment",
        "entity_id": comment_id,
        "project_id": str(project.get("id") or ""),
        "task_id": task_id,
        "source_key": _source_key("comment", f"{task_id}:{comment_id}"),
        "display_name": f"评论/{project.get('name') or '未命名项目'}/{task.get('summary') or '未命名任务'}",
        "title": f"{task.get('summary') or '未命名任务'} 评论",
        "tags": _safe_tags(["todo", "comment", str(project.get("name") or "").strip()]),
        "text": _comment_text(project, task, comment),
        "updated_at": updated_at,
    }


def _build_meeting_note_doc(note: Dict[str, Any]) -> Dict[str, Any]:
    date_str = str(note.get("date") or "").strip()
    updated_at = str(note.get("updated_at") or note.get("created_at") or _now_iso())
    return {
        "entity_type": "meeting_note",
        "entity_id": date_str,
        "source_key": _source_key("meeting_note", date_str),
        "display_name": f"会议记录/{date_str or '未命名'}",
        "title": f"会议记录 {date_str or ''}".strip(),
        "tags": _safe_tags(["todo", "meeting_note"]),
        "text": _meeting_note_text(note),
        "updated_at": updated_at,
    }


def _collect_task_docs(project: Dict[str, Any], task: Dict[str, Any], extended_manager: Any) -> List[Dict[str, Any]]:
    docs = [_build_task_doc(project, task, extended_manager)]
    comments = task.get("comments") or []
    if not isinstance(comments, list):
        comments = []
    for comment in comments:
        if not isinstance(comment, dict):
            continue
        doc = _build_comment_doc(project, task, comment)
        if doc:
            docs.append(doc)
    return docs


def _collect_project_docs(project: Dict[str, Any], extended_manager: Any) -> List[Dict[str, Any]]:
    docs: List[Dict[str, Any]] = [_build_project_doc(project, extended_manager)]
    for task in project.get("tasks") or []:
        if isinstance(task, dict):
            docs.extend(_collect_task_docs(project, task, extended_manager))
    return docs


def _iter_all_docs(todo_manager: Any, extended_manager: Any) -> List[Dict[str, Any]]:
    data = todo_manager.list_all() if todo_manager is not None else {}
    projects = list(data.get("projects") or [])
    docs: List[Dict[str, Any]] = []
    for project in projects:
        if isinstance(project, dict):
            docs.extend(_collect_project_docs(project, extended_manager))
    if extended_manager is not None:
        try:
            notes = list(extended_manager.list_meeting_notes() or [])
        except Exception:
            notes = []
        for note in notes:
            if isinstance(note, dict):
                docs.append(_build_meeting_note_doc(note))
    return docs


def _index_doc(root_dir: str, doc: Dict[str, Any], *, app_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    text = str(doc.get("text") or "").strip()
    chunks = knowledge_store._chunk_markdown_text(text)
    vectors, embed_error = knowledge_store._batch_embed_texts(app_config, [item["text"] for item in chunks], is_query=False)
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
    todo_manager: Any,
    extended_manager: Any,
    *,
    app_config: Optional[Dict[str, Any]] = None,
    progress_callback: Optional[Any] = None,
) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)
    docs = _iter_all_docs(todo_manager, extended_manager)
    existing = knowledge_index_db.list_sources(root_n, SOURCE_TYPE)
    existing_keys = {str(item.get("source_key") or "") for item in existing}
    new_keys = {str(item.get("source_key") or "") for item in docs}
    removed = _delete_sources(root_n, existing_keys - new_keys)

    if progress_callback is not None:
        progress_callback(
            stage="collecting",
            message=f"正在准备 {len(docs)} 个待办知识条目",
            progress=0.05,
            current_count=0,
            total_count=len(docs),
        )

    indexed_items: List[Dict[str, Any]] = []
    total = max(1, len(docs))
    for idx, doc in enumerate(docs, start=1):
        indexed_items.append(_index_doc(root_n, doc, app_config=app_config))
        if progress_callback is not None:
            progress_callback(
                stage="indexing",
                message=f"正在索引待办知识 {idx}/{len(docs)}",
                progress=min(0.98, 0.1 + 0.88 * (idx / total)),
                current_count=idx,
                total_count=len(docs),
            )
    if progress_callback is not None:
        progress_callback(
            stage="completed",
            message="待办知识库重建完成",
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
    todo_manager: Any,
    extended_manager: Any,
    *,
    app_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    root_n = _normalize_root(root_dir)

    def runner(progress_callback: Any) -> None:
        rebuild_all(root_n, todo_manager, extended_manager, app_config=app_config, progress_callback=progress_callback)

    return knowledge_job_manager.get_job_manager().enqueue(
        root_dir=root_n,
        job_type="rebuild",
        source_type=SOURCE_TYPE,
        source_key="__todo_all__",
        payload={"scope": "all"},
        runner=runner,
    )


def rebuild_project(
    root_dir: Optional[str],
    project: Dict[str, Any],
    extended_manager: Any,
    *,
    app_config: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    root_n = _normalize_root(root_dir)
    docs = _collect_project_docs(project, extended_manager)
    live_keys = {str(doc.get("source_key") or "") for doc in docs}
    project_id = str(project.get("id") or "")
    task_ids = {str(task.get("id") or "") for task in project.get("tasks") or [] if isinstance(task, dict)}
    comment_prefixes = {f"comment:{task_id}:" for task_id in task_ids}
    stale_keys: List[str] = []
    for source in knowledge_index_db.list_sources(root_n, SOURCE_TYPE):
        key = str(source.get("source_key") or "")
        if key == _source_key("project", project_id) and key not in live_keys:
            stale_keys.append(key)
        elif key.startswith("task:") and key[5:] in task_ids and key not in live_keys:
            stale_keys.append(key)
        elif any(key.startswith(prefix) for prefix in comment_prefixes) and key not in live_keys:
            stale_keys.append(key)
    _delete_sources(root_n, stale_keys)
    return [_index_doc(root_n, doc, app_config=app_config) for doc in docs]


def remove_project(root_dir: Optional[str], project: Dict[str, Any]) -> int:
    keys = [_source_key("project", str(project.get("id") or ""))]
    for task in project.get("tasks") or []:
        if not isinstance(task, dict):
            continue
        task_id = str(task.get("id") or "")
        keys.append(_source_key("task", task_id))
        for comment in task.get("comments") or []:
            if isinstance(comment, dict) and comment.get("comment_id"):
                keys.append(_source_key("comment", f"{task_id}:{comment.get('comment_id')}"))
    return _delete_sources(_normalize_root(root_dir), keys)


def rebuild_task(
    root_dir: Optional[str],
    project: Dict[str, Any],
    task: Dict[str, Any],
    extended_manager: Any,
    *,
    app_config: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    root_n = _normalize_root(root_dir)
    docs = _collect_task_docs(project, task, extended_manager)
    live_keys = {str(doc.get("source_key") or "") for doc in docs}
    task_id = str(task.get("id") or "")
    stale_keys = [
        str(source.get("source_key") or "")
        for source in knowledge_index_db.list_sources(root_n, SOURCE_TYPE)
        if str(source.get("source_key") or "").startswith(f"comment:{task_id}:")
        and str(source.get("source_key") or "") not in live_keys
    ]
    _delete_sources(root_n, stale_keys)
    return [_index_doc(root_n, doc, app_config=app_config) for doc in docs]


def remove_task(root_dir: Optional[str], task: Dict[str, Any]) -> int:
    task_id = str(task.get("id") or "")
    keys = [_source_key("task", task_id)]
    for comment in task.get("comments") or []:
        if isinstance(comment, dict) and comment.get("comment_id"):
            keys.append(_source_key("comment", f"{task_id}:{comment.get('comment_id')}"))
    return _delete_sources(_normalize_root(root_dir), keys)


def rebuild_meeting_note(
    root_dir: Optional[str],
    date_str: str,
    extended_manager: Any,
    *,
    app_config: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    root_n = _normalize_root(root_dir)
    if extended_manager is None:
        return None
    content = extended_manager.get_meeting_note(date_str)
    if content is None:
        knowledge_index_db.delete_source(root_n, SOURCE_TYPE, _source_key("meeting_note", date_str))
        return None
    notes = list(extended_manager.list_meeting_notes() or [])
    note = next((item for item in notes if str(item.get("date") or "") == date_str), None)
    if not note:
        note = {"date": date_str, "content": content, "created_at": _now_iso(), "updated_at": _now_iso()}
    return _index_doc(root_n, _build_meeting_note_doc(note), app_config=app_config)


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


def list_jobs(root_dir: Optional[str], *, limit: int = 50, source_key: Optional[str] = None) -> List[Dict[str, Any]]:
    return [
        knowledge_store._job_to_public(item)
        for item in knowledge_index_db.list_jobs(
            _normalize_root(root_dir),
            limit=limit,
            source_type=SOURCE_TYPE,
            source_key=source_key,
        )
    ]


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
