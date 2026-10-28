from __future__ import annotations

from typing import Any, Dict, Optional

from . import knowledge_store


def list_entries_page(
    root_dir: str,
    *,
    limit: Optional[int] = None,
    offset: int = 0,
    problem_first: bool = False,
    query: str = "",
) -> Dict[str, Any]:
    return knowledge_store.list_entries_page(
        root_dir,
        limit=limit,
        offset=max(0, int(offset or 0)),
        problem_first=bool(problem_first),
        query=str(query or "").strip(),
    )


def get_entry(root_dir: str, path: str) -> Dict[str, Any]:
    rel_path = str(path or "").strip()
    meta = knowledge_store.get_meta(rel_path, root_dir=root_dir)
    return {"path": rel_path, "in_knowledge": meta is not None, "meta": meta}


def preview_entry(root_dir: str, path: str, *, max_chars: int = 20000) -> Dict[str, Any]:
    item = knowledge_store.preview_entry(root_dir, str(path or "").strip(), max_chars=max(1, int(max_chars or 1)))
    return {"item": item}


def set_entry(
    root_dir: str,
    path: str,
    *,
    tags: Optional[list[str]] = None,
    note: str = "",
    run_async: bool = False,
) -> Dict[str, Any]:
    if run_async:
        entry = knowledge_store.queue_entry(root_dir, path, tags=tags, note=note)
    else:
        entry = knowledge_store.set_entry(root_dir, path, tags=tags, note=note)
    return {
        "entry": entry,
        "queued": bool(run_async),
        "job": entry.get("latest_job") if isinstance(entry, dict) else None,
    }


def remove_entry(root_dir: str, path: str) -> Dict[str, Any]:
    rel_path = str(path or "").strip()
    knowledge_store.remove_entry(root_dir, rel_path)
    return {"removed": True, "path": rel_path}


def rebuild_entry(root_dir: str, path: str, *, run_async: bool = False) -> Dict[str, Any]:
    if run_async:
        entry = knowledge_store.queue_rebuild_entry(root_dir, path)
    else:
        entry = knowledge_store.rebuild_entry(root_dir, path)
    return {
        "entry": entry,
        "queued": bool(run_async),
        "job": entry.get("latest_job") if isinstance(entry, dict) else None,
    }


def index_status(root_dir: str) -> Dict[str, Any]:
    return knowledge_store.get_index_status(root_dir)


def retrieve_for_query(root_dir: str, query: str, *, top_k: int, max_file_bytes: int) -> Dict[str, Any]:
    context, hits, names = knowledge_store.retrieve_for_query(
        root_dir,
        query,
        top_k=top_k,
        max_file_bytes=max_file_bytes,
    )
    return {"context": context, "hits": hits, "name_suggestions": names}


def scan_files(root_dir: str, *, run_async: bool = True) -> Dict[str, Any]:
    if run_async:
        job = knowledge_store.queue_scan_files(root_dir)
        return {"queued": True, "job": job}
    return {"queued": False, "result": knowledge_store.scan_files(root_dir)}


def bulk_index(
    root_dir: str,
    *,
    folder_path: str = "",
    paths: Optional[list[str]] = None,
) -> Dict[str, Any]:
    folder = str(folder_path or "").strip()
    if folder:
        return knowledge_store.queue_folder_entries(root_dir, folder)
    queued = []
    errors = []
    for raw_path in paths or []:
        path = str(raw_path or "").strip()
        if not path:
            continue
        try:
            queued.append(knowledge_store.queue_entry(root_dir, path))
        except ValueError as exc:
            errors.append({"path": path, "error": str(exc)})
    return {
        "queued_count": len(queued),
        "error_count": len(errors),
        "items": queued,
        "errors": errors,
    }


def list_jobs(
    root_dir: str,
    *,
    limit: int = 50,
    source_type: Optional[str] = None,
    source_key: Optional[str] = None,
) -> Dict[str, Any]:
    safe_limit = max(1, min(int(limit or 50), 200))
    items = knowledge_store.list_jobs(root_dir, limit=safe_limit, source_type=source_type, source_key=source_key)
    return {"items": items, "count": len(items)}


def get_job(job_id: str) -> Dict[str, Any]:
    item = knowledge_store.get_job(str(job_id or "").strip())
    return {"found": item is not None, "item": item}


def list_snippets(root_dir: str) -> Dict[str, Any]:
    items = knowledge_store.list_snippets(root_dir)
    return {"items": items, "count": len(items)}


def add_snippet(
    root_dir: str,
    text: str,
    *,
    title: str = "",
    note: str = "",
    tags: Optional[list[str]] = None,
) -> Dict[str, Any]:
    return {"item": knowledge_store.add_snippet(root_dir, text, title=title, note=note, tags=tags)}


def update_snippet(
    root_dir: str,
    snippet_id: str,
    *,
    text: str,
    title: str = "",
    note: str = "",
    tags: Optional[list[str]] = None,
) -> Dict[str, Any]:
    item = knowledge_store.update_snippet(
        root_dir,
        snippet_id,
        text=text,
        title=title,
        note=note,
        tags=tags,
    )
    return {"item": item}


def remove_snippet(root_dir: str, snippet_id: str) -> Dict[str, Any]:
    sid = str(snippet_id or "").strip()
    knowledge_store.remove_snippet(root_dir, sid)
    return {"removed": True, "id": sid}
