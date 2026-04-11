"""
YobboyFileServer MCP Server (V1)

基于 stdio + JSON-RPC 的轻量 MCP 实现，优先做“薄适配”：
- Todo: 只读 + 写入预览 + 写入执行（confirm_token / idempotency）
- Knowledge: list/get/set/remove/retrieve
"""
from __future__ import annotations

import argparse
import html
import hashlib
import json
import os
import re
import secrets
import sys
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET

import drawio_text_dsl
import knowledge_store
import todo_ai_bridge
from local_ai_paths import project_base_dir
from todo_manager import TodoManager

SERVER_NAME = "yobboy-file-server-mcp"
SERVER_VERSION = "0.1.0"

_MAX_OPS_SIZE = 200
_MAX_TEXT_FIELD = 4000
_MAX_TASK_QUERY = 400
_MAX_PROJECT_NAME = 200
_MAX_IDEMPOTENCY_SIZE = 128
_MAX_TOP_K = 20
_MAX_FILE_BYTES = 1_000_000
_DEFAULT_CONFIRM_TTL_SECONDS = 300
_DEFAULT_IDEMPOTENCY_TTL_SECONDS = 900
_DEFAULT_KB_FILE_BYTES = 200_000
_MAX_XML_CHARS = 2_000_000
_MAX_DSL_TEXT_CHARS = 512_000

# 布局类问题仅作提示，不阻断 Draw.io AI 管线（弱模型常产生轻微重叠/越界，可在编辑器内手调）。
_DRAWIO_NON_BLOCKING_ISSUE_CODES = frozenset({"LAYOUT_OVERLAP", "LAYOUT_OUT_OF_BOUNDS"})


def _drawio_validation_has_blocker(issues: List[Dict[str, Any]]) -> bool:
    for item in issues:
        if not isinstance(item, dict):
            return True
        code = str(item.get("code") or "").strip()
        if not code:
            return True
        if code in _DRAWIO_NON_BLOCKING_ISSUE_CODES:
            continue
        return True
    return False


class MCPError(Exception):
    def __init__(self, code: str, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def _now_ts() -> float:
    return time.time()


def _trace_id() -> str:
    return uuid.uuid4().hex[:16]


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def _ok(data: Any, trace_id: str) -> Dict[str, Any]:
    return {"ok": True, "data": data, "error": None, "trace_id": trace_id}


def _err(code: str, message: str, trace_id: str, details: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    return {"ok": False, "data": None, "error": {"code": code, "message": message, "details": details or {}}, "trace_id": trace_id}


def _read_stdin_message() -> Optional[Dict[str, Any]]:
    headers: Dict[str, str] = {}
    while True:
        line = sys.stdin.buffer.readline()
        if not line:
            return None
        if line in (b"\r\n", b"\n"):
            break
        dec = line.decode("utf-8", errors="replace").strip()
        if ":" in dec:
            k, v = dec.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    cl = headers.get("content-length")
    if not cl:
        return None
    try:
        n = int(cl)
    except ValueError:
        return None
    payload = sys.stdin.buffer.read(n)
    if not payload:
        return None
    try:
        return json.loads(payload.decode("utf-8", errors="replace"))
    except Exception:
        return None


def _write_stdout_message(obj: Dict[str, Any]) -> None:
    b = _json_dumps(obj).encode("utf-8")
    header = f"Content-Length: {len(b)}\r\nContent-Type: application/json\r\n\r\n".encode("utf-8")
    sys.stdout.buffer.write(header)
    sys.stdout.buffer.write(b)
    sys.stdout.buffer.flush()


def _safe_len_text(s: Any, max_len: int, field: str) -> str:
    v = str(s or "")
    if len(v) > max_len:
        raise MCPError("VALIDATION_ERROR", f"{field} 超过长度限制 {max_len}")
    return v


def _project_root_from_args(root_dir: str) -> str:
    root = (root_dir or "").strip()
    if not root:
        root = project_base_dir()
    root = os.path.abspath(root)
    if not os.path.isdir(root):
        raise MCPError("INVALID_CONFIG", f"root_dir 不存在: {root}")
    return root


def _find_project_by_name(data: Dict[str, Any], name: str) -> Dict[str, Any]:
    q = _safe_len_text(name, _MAX_PROJECT_NAME, "project_name").strip()
    if not q:
        raise MCPError("VALIDATION_ERROR", "project_name 不能为空")
    projects = list(data.get("projects") or [])
    exact = [p for p in projects if str(p.get("name") or "") == q]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise MCPError("AMBIGUOUS_PROJECT", "project_name 命中多个同名项目", {"project_name": q, "count": len(exact)})
    contains = [p for p in projects if q in str(p.get("name") or "")]
    if len(contains) == 1:
        return contains[0]
    if len(contains) > 1:
        names = [str(x.get("name") or "") for x in contains[:8]]
        raise MCPError("AMBIGUOUS_PROJECT", "project_name 模糊匹配到多个项目", {"project_name": q, "candidates": names})
    raise MCPError("PROJECT_NOT_FOUND", "找不到指定项目", {"project_name": q})


def _task_progress(task: Dict[str, Any]) -> int:
    try:
        return max(0, min(100, int(task.get("progress", 0) or 0)))
    except Exception:
        return 0


def _task_detail_payload(project: Dict[str, Any], task: Dict[str, Any]) -> Dict[str, Any]:
    comments = task.get("comments") or []
    history = task.get("update_history") or []
    if not isinstance(comments, list):
        comments = []
    if not isinstance(history, list):
        history = []
    return {
        "project": {"name": project.get("name"), "archived": bool(project.get("archived", False))},
        "task": {
            "summary": task.get("summary", ""),
            "description": task.get("description", ""),
            "progress": _task_progress(task),
            "priority": task.get("priority"),
            "due_date": task.get("due_date"),
            "task_type": task.get("task_type"),
            "weekly_plan": task.get("weekly_plan"),
            "conclusion": task.get("conclusion"),
            "show_in_report": task.get("show_in_report", True),
            "comments": [
                {"timestamp": c.get("timestamp"), "content": str(c.get("content") or c.get("text") or "")}
                for c in comments
                if isinstance(c, dict)
            ],
            "update_history": [
                {
                    "timestamp": h.get("timestamp"),
                    "field": h.get("field"),
                    "old_value": h.get("old_value"),
                    "new_value": h.get("new_value"),
                }
                for h in history
                if isinstance(h, dict)
            ],
        },
    }


def _extract_mxfile_fragment(text: str) -> str:
    s = str(text or "").strip()
    if not s:
        return ""
    m = re.search(r"<mxfile\b", s, flags=re.IGNORECASE)
    if not m:
        return s
    sub = s[m.start() :]
    low = sub.lower()
    end_ix = low.find("</mxfile>")
    if end_ix < 0:
        return sub
    return sub[: end_ix + len("</mxfile>")]


def _decode_html_wrapped_xml(s: str) -> str:
    low = s.lower()
    if "&lt;mxfile" in low or "&lt;diagram" in low or "&lt;mxgraphmodel" in low:
        return html.unescape(s)
    return s


_BARE_AMP_RE = re.compile(r"&(?!(?:amp|lt|gt|quot|apos|nbsp);|#[0-9]{1,14};|#x[0-9A-Fa-f]{1,14};)")


def _escape_bare_ampersands(s: str) -> str:
    old = s
    for _ in range(4):
        nxt = _BARE_AMP_RE.sub("&amp;", old)
        if nxt == old:
            return nxt
        old = nxt
    return old


def _ensure_mxfile_wrapper(s: str) -> str:
    t = s.strip()
    if "<mxfile" in t.lower():
        return t
    dm = re.search(r"<diagram\b[\s\S]*?</diagram>", t, flags=re.IGNORECASE)
    if dm:
        return "<mxfile>" + dm.group(0) + "</mxfile>"
    gm = re.search(r"<mxGraphModel\b[\s\S]*?</mxGraphModel>", t, flags=re.IGNORECASE)
    if gm:
        return '<mxfile><diagram id="ai-page" name="Page-1">' + gm.group(0) + "</diagram></mxfile>"
    return t


def _repair_drawio_xml_candidate(raw: str) -> Tuple[str, List[str]]:
    changes: List[str] = []
    s = str(raw or "").strip()
    if not s:
        return s, changes
    dec = _decode_html_wrapped_xml(s)
    if dec != s:
        changes.append("decoded_html_entities")
        s = dec
    frag = _extract_mxfile_fragment(s)
    if frag != s:
        changes.append("extracted_mxfile_fragment")
        s = frag
    wrapped = _ensure_mxfile_wrapper(s)
    if wrapped != s:
        changes.append("wrapped_to_mxfile")
        s = wrapped
    if "</mxfile>" not in s.lower() and "<mxfile" in s.lower():
        s += "</mxfile>"
        changes.append("appended_missing_mxfile_closure")
    esc = _escape_bare_ampersands(s)
    if esc != s:
        changes.append("escaped_bare_ampersands")
        s = esc
    return s, changes


def _structural_repair_mxfile_tree(root: ET.Element) -> Tuple[str, List[str]]:
    """
    在已能 parse 的 mxfile 树上：为重复 mxCell id 重命名、删除悬空边。
    """
    changes: List[str] = []
    if str(root.tag).lower() != "mxfile":
        try:
            return ET.tostring(root, encoding="unicode", method="xml"), changes
        except Exception:
            return "", changes

    cells = list(root.iter("mxCell"))
    all_ids: set[str] = set()
    max_num = 1
    for c in cells:
        cid = str(c.attrib.get("id", "")).strip()
        if cid:
            all_ids.add(cid)
            if cid.isdigit():
                try:
                    max_num = max(max_num, int(cid))
                except ValueError:
                    pass

    seen: set[str] = set()
    for c in cells:
        cid = str(c.attrib.get("id", "")).strip()
        if not cid:
            max_num += 1
            while str(max_num) in all_ids:
                max_num += 1
            nid = str(max_num)
            c.set("id", nid)
            all_ids.add(nid)
            seen.add(nid)
            changes.append("filled_missing_mxcell_id")
            continue
        if cid in seen:
            max_num += 1
            while str(max_num) in all_ids:
                max_num += 1
            nid = str(max_num)
            c.set("id", nid)
            all_ids.add(nid)
            seen.add(nid)
            changes.append("renamed_duplicate_mxcell_id")
            continue
        seen.add(cid)

    valid_ids = set(seen)
    for parent in root.iter():
        to_del: List[ET.Element] = []
        for child in list(parent):
            if child.tag != "mxCell":
                continue
            if str(child.attrib.get("edge", "")) != "1":
                continue
            src = str(child.attrib.get("source", "")).strip()
            tgt = str(child.attrib.get("target", "")).strip()
            if not src or not tgt or src not in valid_ids or tgt not in valid_ids:
                to_del.append(child)
        for ch in to_del:
            parent.remove(ch)
            changes.append("removed_dangling_edge")

    try:
        out = ET.tostring(root, encoding="unicode", method="xml")
    except Exception:
        out = ""
    return out, changes


def _drawio_metrics(root: ET.Element) -> Dict[str, Any]:
    diagrams = root.findall(".//diagram")
    page_count = len(diagrams)
    cells = root.findall(".//mxCell")
    cell_ids: List[str] = []
    dup_ids: List[str] = []
    seen = set()
    vertex_count = 0
    edge_count = 0
    for c in cells:
        cid = str(c.attrib.get("id", "")).strip()
        if cid:
            if cid in seen and cid not in dup_ids:
                dup_ids.append(cid)
            seen.add(cid)
            cell_ids.append(cid)
    all_ids = set(cell_ids)
    dangling_edges: List[Dict[str, Any]] = []
    for c in cells:
        if str(c.attrib.get("vertex", "")) == "1":
            vertex_count += 1
        if str(c.attrib.get("edge", "")) == "1":
            edge_count += 1
            src = str(c.attrib.get("source", "")).strip()
            tgt = str(c.attrib.get("target", "")).strip()
            if (src and src not in all_ids) or (tgt and tgt not in all_ids) or not src or not tgt:
                dangling_edges.append({"id": cid, "source": src, "target": tgt})
    vertices_boxes: List[Dict[str, Any]] = []
    for c in cells:
        if str(c.attrib.get("vertex", "")) != "1":
            continue
        cid = str(c.attrib.get("id", "")).strip()
        gx = gy = gw = gh = None
        g = c.find("./mxGeometry")
        if g is not None:
            try:
                gx = float(g.attrib.get("x", "0") or 0)
                gy = float(g.attrib.get("y", "0") or 0)
                gw = float(g.attrib.get("width", "0") or 0)
                gh = float(g.attrib.get("height", "0") or 0)
            except Exception:
                gx = gy = gw = gh = None
        if gx is not None and gy is not None and gw is not None and gh is not None and gw > 0 and gh > 0:
            vertices_boxes.append({"id": cid, "x": gx, "y": gy, "w": gw, "h": gh})

    overlap_pairs: List[Dict[str, Any]] = []
    out_of_bounds: List[Dict[str, Any]] = []
    for b in vertices_boxes:
        if b["x"] < 0 or b["y"] < 0 or b["x"] > 5000 or b["y"] > 5000:
            out_of_bounds.append({"id": b["id"], "x": b["x"], "y": b["y"]})
    cap_n = min(len(vertices_boxes), 220)
    for i in range(cap_n):
        a = vertices_boxes[i]
        ax2 = a["x"] + a["w"]
        ay2 = a["y"] + a["h"]
        for j in range(i + 1, cap_n):
            b = vertices_boxes[j]
            bx2 = b["x"] + b["w"]
            by2 = b["y"] + b["h"]
            inter_w = min(ax2, bx2) - max(a["x"], b["x"])
            inter_h = min(ay2, by2) - max(a["y"], b["y"])
            if inter_w > 12 and inter_h > 12:
                overlap_pairs.append({"a": a["id"], "b": b["id"]})
                if len(overlap_pairs) >= 80:
                    break
        if len(overlap_pairs) >= 80:
            break

    return {
        "page_count": page_count,
        "cell_count": len(cells),
        "vertex_count": vertex_count,
        "edge_count": edge_count,
        "duplicate_cell_ids": dup_ids[:30],
        "dangling_edges": dangling_edges[:30],
        "overlap_pairs": overlap_pairs[:30],
        "out_of_bounds": out_of_bounds[:30],
    }


class ConfirmTokenStore:
    def __init__(self, ttl_seconds: int = _DEFAULT_CONFIRM_TTL_SECONDS):
        self.ttl_seconds = max(30, int(ttl_seconds))
        self._lock = threading.RLock()
        self._items: Dict[str, Dict[str, Any]] = {}

    def issue(self, caller_id: str, ops: List[Dict[str, Any]], trace_id: str) -> Dict[str, Any]:
        token = secrets.token_urlsafe(24)
        now = _now_ts()
        ops_hash = hashlib.sha256(_json_dumps(ops).encode("utf-8")).hexdigest()
        exp = now + self.ttl_seconds
        with self._lock:
            self._cleanup(now)
            self._items[token] = {
                "caller_id": caller_id,
                "ops_hash": ops_hash,
                "expires_at": exp,
                "used": False,
                "issued_trace_id": trace_id,
            }
        return {"confirm_token": token, "expires_at": int(exp)}

    def consume(self, token: str, caller_id: str, ops: List[Dict[str, Any]]) -> None:
        token = str(token or "").strip()
        if len(token) < 16:
            raise MCPError("CONFIRM_TOKEN_INVALID", "confirm_token 格式不正确")
        now = _now_ts()
        ops_hash = hashlib.sha256(_json_dumps(ops).encode("utf-8")).hexdigest()
        with self._lock:
            self._cleanup(now)
            item = self._items.get(token)
            if not item:
                raise MCPError("CONFIRM_TOKEN_INVALID", "confirm_token 不存在或已过期")
            if item.get("used"):
                raise MCPError("CONFIRM_TOKEN_USED", "confirm_token 已被消费")
            if item.get("caller_id") != caller_id:
                raise MCPError("CONFIRM_TOKEN_MISMATCH", "confirm_token 与 caller_id 不匹配")
            if item.get("ops_hash") != ops_hash:
                raise MCPError("CONFIRM_TOKEN_MISMATCH", "confirm_token 与 ops 不匹配")
            item["used"] = True

    def _cleanup(self, now: float) -> None:
        dead = [k for k, v in self._items.items() if float(v.get("expires_at", 0)) <= now]
        for k in dead:
            self._items.pop(k, None)


class IdempotencyStore:
    def __init__(self, ttl_seconds: int = _DEFAULT_IDEMPOTENCY_TTL_SECONDS):
        self.ttl_seconds = max(60, int(ttl_seconds))
        self._lock = threading.RLock()
        self._items: Dict[str, Dict[str, Any]] = {}

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        k = str(key or "").strip()
        if not k:
            return None
        now = _now_ts()
        with self._lock:
            self._cleanup(now)
            item = self._items.get(k)
            if not item:
                return None
            return item.get("result")

    def set(self, key: str, result: Dict[str, Any]) -> None:
        k = str(key or "").strip()
        if not k:
            return
        now = _now_ts()
        with self._lock:
            self._cleanup(now)
            self._items[k] = {"expires_at": now + self.ttl_seconds, "result": result}

    def _cleanup(self, now: float) -> None:
        dead = [k for k, v in self._items.items() if float(v.get("expires_at", 0)) <= now]
        for k in dead:
            self._items.pop(k, None)


class YFSMCPServer:
    def __init__(self, todo_storage_path: Optional[str], root_dir: str):
        self.todo_manager = TodoManager(storage_path=todo_storage_path or None)
        self.root_dir = _project_root_from_args(root_dir)
        self.confirm_tokens = ConfirmTokenStore()
        self.idempotency = IdempotencyStore()
        self.tools = self._build_tools()

    def _build_tools(self) -> Dict[str, Dict[str, Any]]:
        return {
            "todo_list_projects": {
                "description": "列出项目及任务统计",
                "inputSchema": {
                    "type": "object",
                    "properties": {"include_archived": {"type": "boolean", "default": True}},
                    "additionalProperties": False,
                },
                "handler": self.todo_list_projects,
            },
            "todo_list_tasks": {
                "description": "按项目列出任务（支持过滤与分页）",
                "inputSchema": {
                    "type": "object",
                    "required": ["project_name"],
                    "properties": {
                        "project_name": {"type": "string", "minLength": 1},
                        "incomplete_only": {"type": "boolean", "default": False},
                        "limit": {"type": "integer", "minimum": 1, "maximum": 500, "default": 80},
                        "offset": {"type": "integer", "minimum": 0, "default": 0},
                        "include_description": {"type": "boolean", "default": False},
                        "include_comments": {"type": "boolean", "default": False},
                        "include_history": {"type": "boolean", "default": False},
                    },
                    "additionalProperties": False,
                },
                "handler": self.todo_list_tasks,
            },
            "todo_get_task_detail": {
                "description": "按关键词或索引获取单任务详情",
                "inputSchema": {
                    "type": "object",
                    "required": ["project_name", "task_query"],
                    "properties": {
                        "project_name": {"type": "string", "minLength": 1},
                        "task_query": {"type": "string", "minLength": 1},
                        "match_mode": {"type": "string", "enum": ["auto", "exact", "contains", "index"], "default": "auto"},
                    },
                    "additionalProperties": False,
                },
                "handler": self.todo_get_task_detail,
            },
            "todo_get_context_preview": {
                "description": "获取分层上下文预览（summary/project/task/full）",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "level": {"type": "string", "enum": ["auto", "summary", "project", "task", "full"], "default": "auto"},
                        "q": {"type": "string"},
                        "project_name": {"type": "string"},
                        "task_query": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
                "handler": self.todo_get_context_preview,
            },
            "todo_plan_ops": {
                "description": "校验/规划待办变更并生成 confirm_token（默认不写入）",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "message": {"type": "string"},
                        "ops": {"type": "array", "items": {"type": "object"}},
                        "auto_due_date": {"type": "boolean", "default": True},
                        "caller_id": {"type": "string"},
                    },
                    "oneOf": [{"required": ["message"]}, {"required": ["ops"]}],
                    "additionalProperties": False,
                },
                "handler": self.todo_plan_ops,
            },
            "todo_validate_ops": {
                "description": "校验待办 ops 并返回预览",
                "inputSchema": {
                    "type": "object",
                    "required": ["ops"],
                    "properties": {
                        "ops": {"type": "array", "items": {"type": "object"}, "minItems": 1},
                        "ref_question": {"type": "string"},
                        "auto_due_date": {"type": "boolean", "default": True},
                    },
                    "additionalProperties": False,
                },
                "handler": self.todo_validate_ops,
            },
            "todo_apply_ops": {
                "description": "执行待办 ops（需 confirm_token）",
                "inputSchema": {
                    "type": "object",
                    "required": ["ops", "confirm_token"],
                    "properties": {
                        "ops": {"type": "array", "items": {"type": "object"}, "minItems": 1},
                        "confirm_token": {"type": "string", "minLength": 16},
                        "caller_id": {"type": "string"},
                        "idempotency_key": {"type": "string", "minLength": 8},
                    },
                    "additionalProperties": False,
                },
                "handler": self.todo_apply_ops,
            },
            "kb_list_entries": {
                "description": "列出知识库条目",
                "inputSchema": {
                    "type": "object",
                    "properties": {},
                    "additionalProperties": False,
                },
                "handler": self.kb_list_entries,
            },
            "kb_get_entry": {
                "description": "读取知识库条目元数据",
                "inputSchema": {
                    "type": "object",
                    "required": ["path"],
                    "properties": {"path": {"type": "string", "minLength": 1}},
                    "additionalProperties": False,
                },
                "handler": self.kb_get_entry,
            },
            "kb_set_entry": {
                "description": "添加/更新知识库条目（仅 md/txt）",
                "inputSchema": {
                    "type": "object",
                    "required": ["path"],
                    "properties": {
                        "path": {"type": "string", "minLength": 1},
                        "tags": {"type": "array", "items": {"type": "string"}},
                        "note": {"type": "string"},
                    },
                    "additionalProperties": False,
                },
                "handler": self.kb_set_entry,
            },
            "kb_remove_entry": {
                "description": "移除知识库条目",
                "inputSchema": {
                    "type": "object",
                    "required": ["path"],
                    "properties": {"path": {"type": "string", "minLength": 1}},
                    "additionalProperties": False,
                },
                "handler": self.kb_remove_entry,
            },
            "kb_retrieve": {
                "description": "按 query 检索知识库片段",
                "inputSchema": {
                    "type": "object",
                    "required": ["query"],
                    "properties": {
                        "query": {"type": "string", "minLength": 1},
                        "top_k": {"type": "integer", "minimum": 1, "maximum": 20, "default": 6},
                        "max_file_bytes": {"type": "integer", "minimum": 1000, "maximum": 1000000, "default": 200000},
                    },
                    "additionalProperties": False,
                },
                "handler": self.kb_retrieve,
            },
            "drawio_validate_xml": {
                "description": "校验 draw.io mxfile XML 结构与连线引用",
                "inputSchema": {
                    "type": "object",
                    "required": ["xml"],
                    "properties": {"xml": {"type": "string", "minLength": 1}},
                    "additionalProperties": False,
                },
                "handler": self.drawio_validate_xml,
            },
            "drawio_summarize_xml": {
                "description": "汇总 draw.io 图信息（页/节点/边）",
                "inputSchema": {
                    "type": "object",
                    "required": ["xml"],
                    "properties": {"xml": {"type": "string", "minLength": 1}},
                    "additionalProperties": False,
                },
                "handler": self.drawio_summarize_xml,
            },
            "drawio_diff_summary": {
                "description": "比较两份 draw.io XML 的变化摘要",
                "inputSchema": {
                    "type": "object",
                    "required": ["old_xml", "new_xml"],
                    "properties": {
                        "old_xml": {"type": "string", "minLength": 1},
                        "new_xml": {"type": "string", "minLength": 1},
                    },
                    "additionalProperties": False,
                },
                "handler": self.drawio_diff_summary,
            },
            "drawio_repair_xml": {
                "description": "尝试自动修复 draw.io XML 并返回修复结果",
                "inputSchema": {
                    "type": "object",
                    "required": ["xml"],
                    "properties": {"xml": {"type": "string", "minLength": 1}},
                    "additionalProperties": False,
                },
                "handler": self.drawio_repair_xml,
            },
            "drawio_text_dsl_to_xml": {
                "description": "将 yobboy-flow 类 Mermaid 文本（可含坐标）转换为可编辑 draw.io mxfile XML",
                "inputSchema": {
                    "type": "object",
                    "required": ["text"],
                    "properties": {"text": {"type": "string", "minLength": 1}},
                    "additionalProperties": False,
                },
                "handler": self.drawio_text_dsl_to_xml,
            },
        }

    def _guard_ops(self, ops: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not isinstance(ops, list):
            raise MCPError("VALIDATION_ERROR", "ops 必须为数组")
        if not ops:
            raise MCPError("VALIDATION_ERROR", "ops 不能为空")
        if len(ops) > _MAX_OPS_SIZE:
            raise MCPError("VALIDATION_ERROR", f"ops 条数超过限制 {_MAX_OPS_SIZE}")
        for i, op in enumerate(ops):
            if not isinstance(op, dict):
                raise MCPError("VALIDATION_ERROR", f"ops[{i}] 必须为对象")
            for k, v in list(op.items()):
                if isinstance(v, str):
                    _safe_len_text(v, _MAX_TEXT_FIELD, f"ops[{i}].{k}")
        return ops

    def _validate_ops_common(self, args: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[str]]:
        ops = self._guard_ops(args.get("ops"))
        ref_question = str(args.get("ref_question") or args.get("message") or "").strip()
        cat = todo_ai_bridge.build_mutate_ref_catalog_only(self.todo_manager, ref_question)
        ops = todo_ai_bridge.expand_natural_todo_refs(ops, cat)
        auto_due_date = bool(args.get("auto_due_date", True))
        if auto_due_date and ref_question:
            ops = todo_ai_bridge.enrich_todo_ops_due_dates(ops, ref_question)
        preview, err = todo_ai_bridge.validate_and_describe_ops(self.todo_manager, ops)
        if err:
            raise MCPError("VALIDATION_ERROR", err, {"preview_lines": preview or []})
        return ops, (preview or [])

    def todo_list_projects(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        include_archived = bool(args.get("include_archived", True))
        rows = todo_ai_bridge.build_todo_projects_summary_rows(self.todo_manager)
        if not include_archived:
            rows = [x for x in rows if not bool(x.get("archived", False))]
        return _ok({"projects": rows, "count": len(rows)}, trace_id)

    def todo_list_tasks(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        data = self.todo_manager.list_all()
        proj = _find_project_by_name(data, args.get("project_name"))
        tasks = list(proj.get("tasks") or [])
        tasks.sort(key=lambda x: str(x.get("updated_at") or ""), reverse=True)
        if bool(args.get("incomplete_only", False)):
            tasks = [t for t in tasks if _task_progress(t) < 100]
        try:
            limit = max(1, min(int(args.get("limit", 80)), 500))
            offset = max(0, int(args.get("offset", 0)))
        except Exception:
            raise MCPError("VALIDATION_ERROR", "limit/offset 参数无效")
        include_desc = bool(args.get("include_description", False))
        include_comments = bool(args.get("include_comments", False))
        include_history = bool(args.get("include_history", False))
        window = tasks[offset : offset + limit]
        out: List[Dict[str, Any]] = []
        for idx, t in enumerate(window, start=offset + 1):
            row = {
                "index": idx,
                "summary": t.get("summary"),
                "progress": _task_progress(t),
                "due_date": t.get("due_date"),
                "priority": t.get("priority"),
                "updated_at": t.get("updated_at"),
            }
            if include_desc:
                row["description"] = str(t.get("description") or "")
            if include_comments:
                row["comments"] = t.get("comments") if isinstance(t.get("comments"), list) else []
            if include_history:
                row["update_history"] = t.get("update_history") if isinstance(t.get("update_history"), list) else []
            out.append(row)
        return _ok(
            {
                "project": {"name": proj.get("name"), "archived": bool(proj.get("archived", False))},
                "total": len(tasks),
                "limit": limit,
                "offset": offset,
                "tasks": out,
            },
            trace_id,
        )

    def todo_get_task_detail(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        data = self.todo_manager.list_all()
        proj = _find_project_by_name(data, args.get("project_name"))
        tasks = list(proj.get("tasks") or [])
        q = _safe_len_text(args.get("task_query"), _MAX_TASK_QUERY, "task_query").strip()
        mode = str(args.get("match_mode") or "auto").strip().lower()
        if mode not in ("auto", "exact", "contains", "index"):
            raise MCPError("VALIDATION_ERROR", "match_mode 非法")

        def by_index(text: str) -> Optional[Dict[str, Any]]:
            if not text.isdigit():
                return None
            idx = int(text)
            if idx <= 0 or idx > len(tasks):
                return None
            return tasks[idx - 1]

        def by_exact(text: str) -> List[Dict[str, Any]]:
            return [t for t in tasks if str(t.get("summary") or "") == text]

        def by_contains(text: str) -> List[Dict[str, Any]]:
            return [t for t in tasks if text in str(t.get("summary") or "")]

        matched: List[Dict[str, Any]] = []
        if mode in ("index", "auto"):
            one = by_index(q)
            if one is not None:
                matched = [one]
        if not matched and mode in ("exact", "auto"):
            matched = by_exact(q)
        if not matched and mode in ("contains", "auto"):
            matched = by_contains(q)
        if not matched:
            raise MCPError("TASK_NOT_FOUND", "找不到匹配任务", {"project_name": proj.get("name"), "task_query": q, "match_mode": mode})
        if len(matched) > 1:
            cands = [str(t.get("summary") or "") for t in matched[:8]]
            raise MCPError("AMBIGUOUS_TASK", "匹配到多条任务，请改用更精确 task_query 或 index", {"candidates": cands})
        return _ok(_task_detail_payload(proj, matched[0]), trace_id)

    def todo_get_context_preview(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        level = str(args.get("level") or "auto").strip().lower()
        q = _safe_len_text(args.get("q") or "", _MAX_TEXT_FIELD, "q")
        if level not in ("auto", "summary", "project", "task", "full"):
            raise MCPError("VALIDATION_ERROR", "level 非法")
        data = self.todo_manager.list_all()
        if level == "auto":
            text = todo_ai_bridge.build_adaptive_todo_context_for_llm(self.todo_manager, q)
            return _ok({"level": "auto", "text": text}, trace_id)
        if level == "summary":
            return _ok({"level": "summary", "text": todo_ai_bridge.build_todo_summary_text_for_llm(self.todo_manager)}, trace_id)
        if level == "full":
            return _ok({"level": "full", "text": todo_ai_bridge.build_todo_snapshot_for_llm(self.todo_manager, q)}, trace_id)
        if level == "project":
            proj = _find_project_by_name(data, args.get("project_name"))
            return _ok({"level": "project", "text": todo_ai_bridge.build_todo_project_detail_for_llm(self.todo_manager, proj, q)}, trace_id)
        proj = _find_project_by_name(data, args.get("project_name"))
        task_args = {"project_name": proj.get("name"), "task_query": args.get("task_query"), "match_mode": "auto"}
        detail = self.todo_get_task_detail(task_args, trace_id)
        if not detail.get("ok"):
            return detail
        payload = detail.get("data") or {}
        task_obj = payload.get("task") or {}
        t = {
            "summary": task_obj.get("summary"),
            "description": task_obj.get("description"),
            "progress": task_obj.get("progress"),
            "priority": task_obj.get("priority"),
            "due_date": task_obj.get("due_date"),
            "task_type": task_obj.get("task_type"),
            "weekly_plan": task_obj.get("weekly_plan"),
            "conclusion": task_obj.get("conclusion"),
            "show_in_report": task_obj.get("show_in_report"),
            "comments": task_obj.get("comments"),
            "update_history": task_obj.get("update_history"),
        }
        text = todo_ai_bridge.build_todo_task_detail_for_llm(proj, t)
        return _ok({"level": "task", "text": text}, trace_id)

    def todo_plan_ops(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        caller_id = str(args.get("caller_id") or "default").strip() or "default"
        if args.get("ops") is not None:
            ops, preview = self._validate_ops_common(args)
            token_info = self.confirm_tokens.issue(caller_id, ops, trace_id)
            return _ok({"ops": ops, "preview_lines": preview, "warnings": [], **token_info}, trace_id)
        msg = _safe_len_text(args.get("message") or "", _MAX_TEXT_FIELD, "message").strip()
        if not msg:
            raise MCPError("VALIDATION_ERROR", "message 不能为空")
        raise MCPError(
            "NOT_IMPLEMENTED",
            "当前 todo_plan_ops 仅支持传入结构化 ops；自然语言 message 规划请先在本地 AI 路由产出 ops 后再调用。",
        )

    def todo_validate_ops(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        ops, preview = self._validate_ops_common(args)
        return _ok({"ops": ops, "preview_lines": preview}, trace_id)

    def todo_apply_ops(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        caller_id = str(args.get("caller_id") or "default").strip() or "default"
        idem = str(args.get("idempotency_key") or "").strip()
        if idem:
            if len(idem) > _MAX_IDEMPOTENCY_SIZE:
                raise MCPError("VALIDATION_ERROR", "idempotency_key 过长")
            cached = self.idempotency.get(idem)
            if cached is not None:
                return _ok({"idempotent_replay": True, **cached}, trace_id)
        ops, preview = self._validate_ops_common(args)
        self.confirm_tokens.consume(args.get("confirm_token"), caller_id, ops)
        ok, err = todo_ai_bridge.apply_todo_ops(self.todo_manager, ops, expand_refs=False)
        if not ok:
            raise MCPError("APPLY_FAILED", err or "写入失败")
        result = {"applied": True, "preview_lines": preview}
        if idem:
            self.idempotency.set(idem, result)
        return _ok(result, trace_id)

    def kb_list_entries(self, _args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        items = knowledge_store.list_entries(self.root_dir)
        return _ok({"items": items, "count": len(items)}, trace_id)

    def kb_get_entry(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        path = _safe_len_text(args.get("path"), _MAX_TEXT_FIELD, "path").strip()
        if not path:
            raise MCPError("VALIDATION_ERROR", "path 不能为空")
        meta = knowledge_store.get_meta(path)
        return _ok({"path": path, "in_knowledge": meta is not None, "meta": meta}, trace_id)

    def kb_set_entry(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        path = _safe_len_text(args.get("path"), _MAX_TEXT_FIELD, "path").strip()
        note = _safe_len_text(args.get("note") or "", _MAX_TEXT_FIELD, "note")
        tags = args.get("tags")
        if tags is not None and not isinstance(tags, list):
            raise MCPError("VALIDATION_ERROR", "tags 必须为字符串数组")
        try:
            entry = knowledge_store.set_entry(self.root_dir, path, tags=tags, note=note)
        except ValueError as e:
            raise MCPError("VALIDATION_ERROR", str(e))
        return _ok({"entry": entry}, trace_id)

    def kb_remove_entry(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        path = _safe_len_text(args.get("path"), _MAX_TEXT_FIELD, "path").strip()
        knowledge_store.remove_entry(self.root_dir, path)
        return _ok({"removed": True, "path": path}, trace_id)

    def kb_retrieve(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        query = _safe_len_text(args.get("query"), _MAX_TEXT_FIELD, "query").strip()
        if not query:
            raise MCPError("VALIDATION_ERROR", "query 不能为空")
        try:
            top_k = int(args.get("top_k", 6))
            max_file_bytes = int(args.get("max_file_bytes", _DEFAULT_KB_FILE_BYTES))
        except Exception:
            raise MCPError("VALIDATION_ERROR", "top_k / max_file_bytes 参数无效")
        top_k = max(1, min(top_k, _MAX_TOP_K))
        max_file_bytes = max(1000, min(max_file_bytes, _MAX_FILE_BYTES))
        context, hits, names = knowledge_store.retrieve_for_query(self.root_dir, query, top_k=top_k, max_file_bytes=max_file_bytes)
        return _ok({"context": context, "hits": hits, "name_suggestions": names}, trace_id)

    def _parse_drawio_xml(self, raw: Any, field_name: str = "xml") -> Tuple[str, Optional[ET.Element], Optional[str]]:
        txt = _safe_len_text(raw, _MAX_XML_CHARS, field_name)
        frag = _extract_mxfile_fragment(txt)
        if not frag.strip():
            return "", None, "empty"
        try:
            root = ET.fromstring(frag)
            return frag, root, None
        except Exception as e:
            return frag, None, str(e)

    def drawio_validate_xml(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        frag, root, parse_err = self._parse_drawio_xml(args.get("xml"), "xml")
        if root is None:
            return _ok(
                {
                    "valid": False,
                    "issues": [{"code": "XML_PARSE_ERROR", "message": parse_err or "xml parse failed"}],
                    "metrics": {"xml_chars": len(frag)},
                },
                trace_id,
            )
        issues: List[Dict[str, Any]] = []
        if root.tag.lower() != "mxfile":
            issues.append({"code": "ROOT_NOT_MXFILE", "message": f"root tag is {root.tag}, expected mxfile"})
        m = _drawio_metrics(root)
        if m["duplicate_cell_ids"]:
            issues.append({"code": "DUPLICATE_CELL_ID", "message": "found duplicate mxCell id", "details": m["duplicate_cell_ids"]})
        if m["dangling_edges"]:
            issues.append(
                {
                    "code": "DANGLING_EDGE",
                    "message": "some edges have missing/invalid source-target",
                    "details": m["dangling_edges"][:10],
                }
            )
        if m["overlap_pairs"]:
            issues.append(
                {
                    "code": "LAYOUT_OVERLAP",
                    "message": "some vertex cells overlap; increase spacing and adjust coordinates",
                    "details": m["overlap_pairs"][:10],
                }
            )
        if m["out_of_bounds"]:
            issues.append(
                {
                    "code": "LAYOUT_OUT_OF_BOUNDS",
                    "message": "some vertex cells are out of expected viewport range",
                    "details": m["out_of_bounds"][:10],
                }
            )
        return _ok(
            {
                "valid": not _drawio_validation_has_blocker(issues),
                "issues": issues,
                "metrics": {"xml_chars": len(frag), **m},
            },
            trace_id,
        )

    def drawio_summarize_xml(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        frag, root, parse_err = self._parse_drawio_xml(args.get("xml"), "xml")
        if root is None:
            raise MCPError("VALIDATION_ERROR", f"XML 解析失败: {parse_err or 'unknown'}")
        m = _drawio_metrics(root)
        diagrams = root.findall(".//diagram")
        page_names = [str(d.attrib.get("name", "")).strip() or f"Page-{i + 1}" for i, d in enumerate(diagrams[:20])]
        return _ok({"summary": {"xml_chars": len(frag), **m, "page_names": page_names}}, trace_id)

    def drawio_diff_summary(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        _old_frag, old_root, old_err = self._parse_drawio_xml(args.get("old_xml"), "old_xml")
        _new_frag, new_root, new_err = self._parse_drawio_xml(args.get("new_xml"), "new_xml")
        if old_root is None:
            raise MCPError("VALIDATION_ERROR", f"old_xml 解析失败: {old_err or 'unknown'}")
        if new_root is None:
            raise MCPError("VALIDATION_ERROR", f"new_xml 解析失败: {new_err or 'unknown'}")
        old_m = _drawio_metrics(old_root)
        new_m = _drawio_metrics(new_root)
        old_ids = set([str(c.attrib.get("id", "")).strip() for c in old_root.findall(".//mxCell") if str(c.attrib.get("id", "")).strip()])
        new_ids = set([str(c.attrib.get("id", "")).strip() for c in new_root.findall(".//mxCell") if str(c.attrib.get("id", "")).strip()])
        added = sorted(list(new_ids - old_ids))
        removed = sorted(list(old_ids - new_ids))
        return _ok(
            {
                "diff": {
                    "cell_added": len(added),
                    "cell_removed": len(removed),
                    "added_ids_sample": added[:20],
                    "removed_ids_sample": removed[:20],
                    "page_count_delta": int(new_m["page_count"]) - int(old_m["page_count"]),
                    "vertex_delta": int(new_m["vertex_count"]) - int(old_m["vertex_count"]),
                    "edge_delta": int(new_m["edge_count"]) - int(old_m["edge_count"]),
                }
            },
            trace_id,
        )

    def drawio_repair_xml(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        raw = _safe_len_text(args.get("xml"), _MAX_XML_CHARS, "xml")
        repaired, changes = _repair_drawio_xml_candidate(raw)
        _, root, parse_err = self._parse_drawio_xml(repaired, "xml")
        if root is not None and str(root.tag).lower() == "mxfile":
            struct_xml, struct_changes = _structural_repair_mxfile_tree(root)
            if struct_changes:
                changes.extend(struct_changes)
            if struct_xml:
                repaired = struct_xml
                _, root, parse_err = self._parse_drawio_xml(repaired, "xml")
        valid = root is not None and str(root.tag).lower() == "mxfile"
        issues: List[Dict[str, Any]] = []
        metrics: Dict[str, Any] = {"xml_chars": len(repaired)}
        if not valid:
            issues.append({"code": "XML_PARSE_ERROR", "message": parse_err or "xml parse failed after repair"})
        else:
            m = _drawio_metrics(root)
            metrics.update(m)
            if m["duplicate_cell_ids"]:
                issues.append({"code": "DUPLICATE_CELL_ID", "message": "found duplicate mxCell id", "details": m["duplicate_cell_ids"]})
            if m["dangling_edges"]:
                issues.append({"code": "DANGLING_EDGE", "message": "some edges have invalid source-target", "details": m["dangling_edges"][:10]})
        return _ok(
            {
                "valid": valid and len(issues) == 0,
                "repaired_xml": repaired,
                "changes": changes,
                "issues": issues,
                "metrics": metrics,
            },
            trace_id,
        )

    def drawio_text_dsl_to_xml(self, args: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        txt = _safe_len_text(args.get("text"), _MAX_DSL_TEXT_CHARS, "text")
        try:
            xml_out = drawio_text_dsl.convert_model_reply_to_mxfile(txt)
        except drawio_text_dsl.DrawioTextDslError as e:
            return _ok(
                {
                    "ok_parse": False,
                    "error": str(e),
                    "xml": "",
                    "changes": [],
                },
                trace_id,
            )
        repaired, changes = _repair_drawio_xml_candidate(xml_out)
        _, root, parse_err = self._parse_drawio_xml(repaired, "xml")
        if root is not None and str(root.tag).lower() == "mxfile":
            struct_xml, struct_changes = _structural_repair_mxfile_tree(root)
            if struct_changes:
                changes.extend(struct_changes)
            if struct_xml:
                repaired = struct_xml
        return _ok(
            {
                "ok_parse": True,
                "error": None,
                "xml": repaired,
                "changes": changes,
                "xml_parse_note": parse_err,
            },
            trace_id,
        )

    def handle_tool_call(self, name: str, arguments: Dict[str, Any], trace_id: str) -> Dict[str, Any]:
        tool = self.tools.get(name)
        if not tool:
            return _err("TOOL_NOT_FOUND", f"未知工具: {name}", trace_id)
        handler: Callable[[Dict[str, Any], str], Dict[str, Any]] = tool["handler"]
        try:
            return handler(arguments or {}, trace_id)
        except MCPError as e:
            return _err(e.code, e.message, trace_id, e.details)
        except Exception as e:
            return _err("INTERNAL_ERROR", str(e), trace_id)

    def _mcp_tool_result(self, payload: Dict[str, Any], is_error: bool = False) -> Dict[str, Any]:
        return {
            "content": [{"type": "text", "text": _json_dumps(payload)}],
            "structuredContent": payload,
            "isError": bool(is_error),
        }

    def serve_forever(self) -> None:
        while True:
            req = _read_stdin_message()
            if req is None:
                return
            method = req.get("method")
            req_id = req.get("id")
            params = req.get("params") or {}
            if method == "initialize":
                result = {
                    "protocolVersion": "2024-11-05",
                    "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                    "capabilities": {"tools": {"listChanged": False}},
                }
                _write_stdout_message({"jsonrpc": "2.0", "id": req_id, "result": result})
                continue
            if method == "notifications/initialized":
                continue
            if method == "tools/list":
                items = []
                for name, m in self.tools.items():
                    items.append({"name": name, "description": m.get("description", ""), "inputSchema": m.get("inputSchema", {"type": "object"})})
                _write_stdout_message({"jsonrpc": "2.0", "id": req_id, "result": {"tools": items}})
                continue
            if method == "tools/call":
                name = params.get("name")
                arguments = params.get("arguments") or {}
                trace_id = _trace_id()
                payload = self.handle_tool_call(str(name or ""), arguments, trace_id)
                _write_stdout_message(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": self._mcp_tool_result(payload, is_error=(not payload.get("ok", False))),
                    }
                )
                continue
            if req_id is not None:
                _write_stdout_message(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {"code": -32601, "message": f"Method not found: {method}"},
                    }
                )


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="YobboyFileServer MCP Server")
    p.add_argument("--root-dir", default=os.environ.get("YFS_ROOT_DIR", ""), help="知识库与项目根目录（默认项目根）")
    p.add_argument(
        "--todo-storage-path",
        default=os.environ.get("YFS_TODO_STORAGE_PATH", ""),
        help="Todo 数据文件路径（默认使用 todo_manager 的 data/todos/todos_v2.json）",
    )
    return p.parse_args()


def main() -> int:
    args = _parse_args()
    try:
        server = YFSMCPServer(args.todo_storage_path, args.root_dir)
        server.serve_forever()
        return 0
    except Exception as e:
        sys.stderr.write(f"[mcp_server] fatal: {e}\n")
        sys.stderr.flush()
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
