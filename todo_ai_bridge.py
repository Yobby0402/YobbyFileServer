"""
Todo 自然语言：确定性数据聚合 + 变更预览/应用（经校验）。
"""
from __future__ import annotations

import copy
import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from todo_manager import TodoManager

_MAX_TASKS_PER_PROJECT = 48
_MAX_TASKS_PER_PROJECT_INCOMPLETE = 120
_MAX_SNAPSHOT_LINES = 520
_MAX_SNAPSHOT_CHARS = 22000
_MAX_MUTATE_TASKS_PER_PROJECT = 120

# 注入所有待办相关对话，说明字段与查询方式（避免模型不知道有 description、不知如何下钻）
TODO_LLM_SCHEMA_GUIDE = """
[待办数据模型与查询]
■ 项目（Project）属性：name 名称；color 颜色；archived 是否归档；phase 阶段；show_in_report 是否出现在周报；tasks 为其下属任务列表；另有 created_at / updated_at。
■ 任务（Task）属性：summary 标题（宜短）；description **详细描述**（长文本，列表层默认不占位，需用户问「描述/详情」或进入详情层才有全文）；progress 进度 0–100；due_date 截止日；priority 优先级；comments[] 评论（正文+时间）；update_history 修改历史；conclusion 结论；weekly_plan 周报片段；task_type 类型；show_in_report。
■ 快照层级（由服务器按问题自动选择）：
  · 第1层——只显示各项目「任务总数 / 已完成 / 未完成」，无单条详情。
  · 第2层——用户话里含**完整项目名**并意在列任务时：每条有序号、标题、进度、截止；若用户问到「描述、详情、具体内容」，同层会附 **描述摘录**。
  · 第3层——任务标题关键短语 + 「详情、展开、描述」等：注入该任务 **description 全文**、评论与历史。
  · 说「完整列表、全量」时：多项目任务简表（仍可能截断）。
■ 可由用户或你提示使用的只读 API（需登录同站）：GET /api/local-ai/todo/summary（各项目计数）；GET /api/local-ai/todo/context?level=auto&…&q=…（与注入逻辑一致的文本）；GET /api/local-ai/todo/overview?limit_per_project=N（JSON，含多字段；对话里附带的 JSON 会脱敏 id）。
■ 写入流程：网页选「待办」且模型需生成「变更 JSON」时，须 **勾选「强制解析为变更」**（若句子里同时有「哪些、列出、统计」等词，容易被判成纯查询）。补丁经用户确认后才写入。**create_task 必须把用户给出的长说明写入 description，summary 用简短标题。**
■ **截止日期**：`due_date` 须为 `YYYY-MM-DD`。用户若说「本周五、明天、4月10日」等而 JSON 里未填，服务器会从原句**自动补全**空的 `due_date`（与模型输出合并，仅填补空白字段）。
""".strip()

_CN_WEEKDAY_CHAR = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}


def _local_today(ref: datetime) -> date:
    return ref.astimezone().date()


def _monday_of_calendar_week(ref: datetime) -> date:
    d = _local_today(ref)
    return d - timedelta(days=d.weekday())


def _upcoming_weekday_this_calendar_week(ref: datetime, target_wd: int) -> date:
    mon = _monday_of_calendar_week(ref)
    cand = mon + timedelta(days=target_wd)
    if cand < _local_today(ref):
        cand = cand + timedelta(days=7)
    return cand


def _weekday_next_calendar_week(ref: datetime, target_wd: int) -> date:
    mon = _monday_of_calendar_week(ref) + timedelta(days=7)
    return mon + timedelta(days=target_wd)


def parse_natural_due_date_cn(
    message: str, ref: Optional[datetime] = None
) -> Optional[str]:
    """
    从用户中文句子里解析一个截止日期 YYYY-MM-DD（本地时区）。
    用于模型未填 due_date 时的确定性补全。
    """
    if not (message or "").strip():
        return None
    ref = ref or datetime.now().astimezone()
    today = _local_today(ref)
    m = message.strip()

    if "大后天" in m:
        return (today + timedelta(days=3)).isoformat()
    if "后天" in m:
        return (today + timedelta(days=2)).isoformat()
    if "明天" in m:
        return (today + timedelta(days=1)).isoformat()
    if "今天" in m or "今日" in m:
        return today.isoformat()

    mo = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?", m)
    if mo:
        try:
            return date(int(mo.group(1)), int(mo.group(2)), int(mo.group(3))).isoformat()
        except ValueError:
            pass

    mo = re.search(r"(\d{1,2})\s*月\s*(\d{1,2})\s*日", m)
    if mo:
        mo_, d_ = int(mo.group(1)), int(mo.group(2))
        y = today.year
        try:
            cand = date(y, mo_, d_)
        except ValueError:
            return None
        if cand < today:
            try:
                cand = date(y + 1, mo_, d_)
            except ValueError:
                return None
        return cand.isoformat()

    def _ix(ch: str) -> Optional[int]:
        return _CN_WEEKDAY_CHAR.get(ch)

    mo = re.search(r"下周\s*星期([一二三四五六日天])", m)
    if mo:
        ix = _ix(mo.group(1))
        if ix is not None:
            return _weekday_next_calendar_week(ref, ix).isoformat()

    mo = re.search(r"下周\s*([一二三四五六日天])", m)
    if mo:
        ix = _ix(mo.group(1))
        if ix is not None:
            return _weekday_next_calendar_week(ref, ix).isoformat()

    mo = re.search(r"(?:本周|这周)\s*星期([一二三四五六日天])", m)
    if mo:
        ix = _ix(mo.group(1))
        if ix is not None:
            return _upcoming_weekday_this_calendar_week(ref, ix).isoformat()

    mo = re.search(r"(?:本周|这周)([一二三四五六日天])", m)
    if mo:
        ix = _ix(mo.group(1))
        if ix is not None:
            return _upcoming_weekday_this_calendar_week(ref, ix).isoformat()

    weekenders = ("本周" in m) or ("这周" in m)
    nextend = "下周" in m
    if not weekenders and not nextend:
        for tok, ix in (
            ("星期日", 6),
            ("星期天", 6),
            ("星期六", 5),
            ("星期五", 4),
            ("星期四", 3),
            ("星期三", 2),
            ("星期二", 1),
            ("星期一", 0),
            ("周天", 6),
            ("周日", 6),
            ("周六", 5),
            ("周五", 4),
            ("周四", 3),
            ("周三", 2),
            ("周二", 1),
            ("周一", 0),
        ):
            if tok in m:
                return _upcoming_weekday_this_calendar_week(ref, ix).isoformat()

    return None


def enrich_todo_ops_due_dates(
    ops: List[Dict[str, Any]],
    user_message: str,
    ref: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """对 create_task / update_task 中空缺的 due_date 用语义解析结果填补。"""
    if not ops or not (user_message or "").strip():
        return ops
    parsed = parse_natural_due_date_cn(user_message, ref)
    if not parsed:
        return ops
    out = copy.deepcopy(ops)
    for op in out:
        kind = op.get("op")
        if kind not in ("create_task", "update_task"):
            continue
        cur = op.get("due_date")
        empty = cur is None or (isinstance(cur, str) and not str(cur).strip())
        if empty:
            op["due_date"] = parsed
    return out


# 说明见 build_todo_snapshot_for_llm：默认始终注入「项目 → 其下任务」完整列表，不在此按日期过滤任务，
# 避免用户话里出现「今天」「本周」等词时误触发过滤、只剩项目行而无任务。

def _parse_iso_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def _to_local(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone()


def _task_progress_val(task: Dict[str, Any]) -> int:
    try:
        v = int(task.get("progress", 0) or 0)
        return max(0, min(100, v))
    except (TypeError, ValueError):
        return 0


def _question_focus_incomplete_tasks(q: str) -> bool:
    """用户问「未完成/还剩哪些」等时，只列出进度<100% 的任务，显著减轻快照体积。"""
    m = (q or "").strip()
    if not m:
        return False
    keys = (
        "未完成",
        "没完成",
        "未做完",
        "待完成",
        "还没做",
        "还没完成",
        "没做完",
        "进度未满",
        "没到100",
        "不到100",
        "进行中的任务",
        "还剩哪些",
        "剩下哪些",
    )
    return any(k in m for k in keys)


def _task_sort_updated_desc(task: Dict[str, Any]) -> datetime:
    dt = _parse_iso_date(task.get("updated_at")) or _parse_iso_date(task.get("created_at"))
    if dt is None:
        return datetime.min.replace(tzinfo=timezone.utc)
    return _to_local(dt)


def _ordered_projects_for_snapshot(tm: TodoManager, question: str) -> List[Dict[str, Any]]:
    data = tm.list_all()
    projects = list(data.get("projects") or [])
    q = (question or "").strip()
    if q:

        def _proj_rank(p: Dict[str, Any]) -> Tuple[int, str]:
            pname = str(p.get("name") or "")
            hit = 1 if pname and pname in q else 0
            return (hit, pname)

        projects.sort(key=_proj_rank, reverse=True)
    return projects


def _tasks_for_project_snapshot_list(
    p: Dict[str, Any],
    question: str,
    *,
    for_mutate: bool = False,
) -> List[Dict[str, Any]]:
    raw_tasks: List[Dict[str, Any]] = list(p.get("tasks") or [])
    tasks = list(raw_tasks)
    if not for_mutate and _question_focus_incomplete_tasks(question):
        tasks = [t for t in tasks if _task_progress_val(t) < 100]
    tasks.sort(key=_task_sort_updated_desc, reverse=True)
    return tasks


def build_todo_snapshot_for_llm(tm: TodoManager, question: str) -> str:
    """供模型阅读的全量快照：仅用「项目名 + 序号」指代任务，不输出任何 UUID。"""
    projects = _ordered_projects_for_snapshot(tm, question)
    q = (question or "").strip()
    incomplete_only = _question_focus_incomplete_tasks(q)
    cap_tasks = _MAX_TASKS_PER_PROJECT_INCOMPLETE if incomplete_only else _MAX_TASKS_PER_PROJECT

    lines: List[str] = [
        "[待办] 层级为 项目 → 其下编号任务。指称时请用「项目名」+「第几条」（见下行首数字），不要使用十六进制 id。",
    ]
    if incomplete_only:
        lines.append(
            "[本快照模式] 仅包含进度未满 100% 的任务（已完成已省略）；"
            "每个项目都会至少出现一行，若无未完成任务会标明。"
        )

    for p in projects:
        if len(lines) >= _MAX_SNAPSHOT_LINES - 2:
            lines.append("...(已达快照行数上限，后续项目未展开)")
            break
        pname = p.get("name", "")
        archived = p.get("archived", False)
        lines.append(f"• 项目「{pname}」  archived={archived}")
        tasks = _tasks_for_project_snapshot_list(p, q, for_mutate=False)
        total_t = len(tasks)
        if total_t == 0:
            if incomplete_only:
                lines.append("    （本项目无未完成任务）")
            else:
                lines.append("    （本项目下暂无任务）")
            continue
        cap = min(cap_tasks, total_t)
        want_desc = _wants_description_in_task_lines(q)
        for idx, t in enumerate(tasks[:cap], start=1):
            if len(lines) >= _MAX_SNAPSHOT_LINES - 1:
                lines.append("    …(快照行数上限，以下任务略)")
                break
            prog = _task_progress_val(t)
            due = (t.get("due_date") or "").strip()
            if incomplete_only:
                summ = (t.get("summary") or "")[:90]
                line = f"    {idx}. 「{summ}」  {prog}%  截止 {due or '—'}"
                if want_desc:
                    ex = _task_line_description_excerpt(t, 140)
                    if ex:
                        line += f"  | 描述摘录:{ex}"
                lines.append(line)
                continue
            summ = (t.get("summary") or "")[:120]
            upd = (t.get("updated_at") or "")[:19]
            com = t.get("comments") or []
            nc = len(com) if isinstance(com, list) else 0
            cpart = f"  评论×{nc}" if nc else ""
            line = (
                f"    {idx}. 「{summ}」  进度 {prog}%  截止 {due or '—'}  更新 {upd or '—'}" + cpart
            )
            if want_desc:
                ex = _task_line_description_excerpt(t, 140)
                if ex:
                    line += f"  | 描述摘录:{ex}"
            if _wants_comments_or_history_in_task_lines(q):
                cex = _task_last_comment_excerpt(t, 90)
                if cex:
                    line += f"  | 最近评论:{cex}"
                hist = t.get("update_history") or []
                if isinstance(hist, list) and hist:
                    line += f"  | 历史条数:{len(hist)}"
            lines.append(line)
        if total_t > cap:
            cap_name = cap_tasks
            lines.append(
                f"    … 本项目另有 {total_t - cap} 条"
                + ("未完成" if incomplete_only else "")
                + f"任务未列出（每项目最多 {cap_name} 条，按更新时间倒序）"
            )

    if len(lines) > _MAX_SNAPSHOT_LINES:
        lines = lines[:_MAX_SNAPSHOT_LINES] + ["...(截断)"]
    text = "\n".join(lines)
    if len(text) > _MAX_SNAPSHOT_CHARS:
        text = text[:_MAX_SNAPSHOT_CHARS] + "\n...(快照过长已截断)"
    return text


_REF_PROJ = re.compile(r"^项(\d+)$")
_REF_TASK = re.compile(r"^项(\d+)\s*[·.]\s*任(\d+)$")
_REF_COMMENT = re.compile(r"^项(\d+)\s*[·.]\s*任(\d+)\s*[·.]\s*评(\d+)$")

_UUID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def _is_uuid_like(s: str) -> bool:
    s = (s or "").strip()
    return bool(
        re.fullmatch(
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
            s,
        )
    )


def build_todo_mutate_snapshot_and_catalog(
    tm: TodoManager, question: str
) -> Tuple[str, Dict[str, Any]]:
    """变更 JSON 专用快照：仅含「项N / 项N·任M / 项N·任M·评C」代号，由服务端展开为真实 id。"""
    projects = _ordered_projects_for_snapshot(tm, question)
    catalog: Dict[str, Any] = {"projects": {}, "tasks": {}, "comments": {}}
    pmap: Dict[int, str] = catalog["projects"]
    tmap: Dict[Tuple[int, int], str] = catalog["tasks"]
    cmap: Dict[Tuple[int, int, int], str] = catalog["comments"]

    lines: List[str] = [
        "[待办·变更引用] 下列代号与 JSON 中的 project_id / task_id / comment_id 一致，禁止使用十六进制：",
        "- project_id：项1、项2、…（从上到下第几个项目）",
        "- task_id：项1·任1（中间「·」可用英文句点 .）",
        "- comment_id：项1·任2·评1（该任务下评论从上至下编号）",
        "",
    ]
    cap = _MAX_MUTATE_TASKS_PER_PROJECT
    for pi, p in enumerate(projects, start=1):
        pid = str(p.get("id") or "")
        if pid:
            pmap[pi] = pid
        pname = str(p.get("name") or "")
        archived = p.get("archived", False)
        lines.append(f"• 【项{pi}】项目「{pname}」 archived={archived}")
        tasks = _tasks_for_project_snapshot_list(p, "", for_mutate=True)
        if not tasks:
            lines.append("   （无任务）")
            continue
        shown = tasks[:cap]
        for ti, t in enumerate(shown, start=1):
            tid = str(t.get("id") or "")
            if tid:
                tmap[(pi, ti)] = tid
            summ = (t.get("summary") or "")[:100]
            prog = _task_progress_val(t)
            due = (t.get("due_date") or "").strip() or "—"
            dex = _task_line_description_excerpt(t, 100)
            tail = f"  | 描述摘录:{dex}" if dex else ""
            lines.append(f"   【项{pi}·任{ti}】「{summ}」  {prog}%  截止 {due}" + tail)
            comments = t.get("comments") or []
            if isinstance(comments, list):
                for ci, c in enumerate(comments[:12], start=1):
                    if not isinstance(c, dict):
                        continue
                    cid = str(c.get("comment_id") or "")
                    if cid:
                        cmap[(pi, ti, ci)] = cid
                    body = str(c.get("content") or c.get("text") or "").strip()[:40]
                    ts = str(c.get("timestamp") or "")[:10]
                    lines.append(f"      →【项{pi}·任{ti}·评{ci}】 [{ts}] {body}")
        if len(tasks) > cap:
            lines.append(
                f"   … 另有 {len(tasks) - cap} 条任务未编入本表（请改项目或拆操作）"
            )
    text = "\n".join(lines)
    if len(text) > _MAX_SNAPSHOT_CHARS:
        text = text[:_MAX_SNAPSHOT_CHARS] + "\n...(变更引用表过长已截断)"
    return text, catalog


def build_mutate_ref_catalog_only(tm: TodoManager, question: str = "") -> Dict[str, Any]:
    return build_todo_mutate_snapshot_and_catalog(tm, question)[1]


def expand_natural_todo_refs(
    ops: List[Dict[str, Any]], catalog: Dict[str, Any]
) -> List[Dict[str, Any]]:
    if not ops or not catalog:
        return ops
    out = copy.deepcopy(ops)
    pmap: Dict[int, str] = catalog.get("projects") or {}
    tmap: Dict[Tuple[int, int], str] = catalog.get("tasks") or {}
    cmap: Dict[Tuple[int, int, int], str] = catalog.get("comments") or {}

    def exp_proj(v: Any) -> Any:
        if not isinstance(v, str):
            return v
        s = v.strip()
        if _is_uuid_like(s):
            return s
        m = _REF_PROJ.match(s)
        if m:
            idx = int(m.group(1))
            return pmap.get(idx, s)
        return s

    def exp_task(v: Any) -> Any:
        if not isinstance(v, str):
            return v
        s = v.strip()
        if _is_uuid_like(s):
            return s
        m = _REF_TASK.match(s)
        if m:
            pi, ti = int(m.group(1)), int(m.group(2))
            return tmap.get((pi, ti), s)
        return s

    def exp_comment(v: Any) -> Any:
        if not isinstance(v, str):
            return v
        s = v.strip()
        if _is_uuid_like(s):
            return s
        m = _REF_COMMENT.match(s)
        if m:
            a, b, c = int(m.group(1)), int(m.group(2)), int(m.group(3))
            return cmap.get((a, b, c), s)
        return s

    for op in out:
        if not isinstance(op, dict):
            continue
        if "project_id" in op and op["project_id"] is not None:
            op["project_id"] = exp_proj(str(op["project_id"]))
        if "task_id" in op and op["task_id"] is not None:
            op["task_id"] = exp_task(str(op["task_id"]))
        if "comment_id" in op and op["comment_id"] is not None:
            op["comment_id"] = exp_comment(str(op["comment_id"]))
    return out


_MAX_PROJECT_DETAIL_TASKS = 200
_MAX_TASK_HISTORY_LINES = 24
_MAX_COMMENT_LINES = 40


def build_todo_projects_summary_rows(tm: TodoManager) -> List[Dict[str, Any]]:
    """各项目任务数量统计（已完成=进度100%），供 API 与汇总层文本共用。"""
    data = tm.list_all()
    rows: List[Dict[str, Any]] = []
    for p in data.get("projects") or []:
        tasks = list(p.get("tasks") or [])
        done = sum(1 for t in tasks if _task_progress_val(t) >= 100)
        rows.append(
            {
                "id": p.get("id"),
                "name": p.get("name"),
                "archived": bool(p.get("archived", False)),
                "task_total": len(tasks),
                "completed": done,
                "incomplete": len(tasks) - done,
            }
        )
    return rows


def build_todo_summary_text_for_llm(tm: TodoManager) -> str:
    """第 1 层：仅各项目任务数量（已完成/未完成），不逐条列任务。"""
    rows = build_todo_projects_summary_rows(tm)
    lines: List[str] = [
        "[待办·第1层=项目汇总] 以下为各项目任务统计。"
        "若要查看某个项目下的任务列表，请在问题中写出该项目的完整名称；"
        "若要查看单条任务的描述/评论/历史，请在问题中写出该任务标题中的关键短语并加上「详情」或「展开」。",
    ]
    for r in rows:
        lines.append(
            f"• 项目「{r.get('name', '')}」  archived={r['archived']}  "
            f"任务共 {r['task_total']}  已完成 {r['completed']}  未完成 {r['incomplete']}"
        )
    return "\n".join(lines)


def _pick_project_for_question(q: str, projects: List[Dict[str, Any]]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """在问题文本中按「项目全名子串」匹配；优先最长名称，避免「测试」误匹配\"测试2\""""
    scored: List[Tuple[int, str, Dict[str, Any]]] = []
    for p in projects:
        name = str(p.get("name") or "")
        if name and name in q:
            scored.append((len(name), name, p))
    if not scored:
        return None, None
    scored.sort(key=lambda x: -x[0])
    best_len = scored[0][0]
    top = [x for x in scored if x[0] == best_len]
    names = [x[1] for x in top]
    if len(top) > 1 and len(set(names)) > 1:
        return None, "、".join(f"「{n}」" for n in sorted(set(names), key=len, reverse=True))
    return top[0][2], None


def _lookup_task_by_uuid(tm: TodoManager, uid: str) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
    uid = (uid or "").strip().lower()
    data = tm.list_all()
    for p in data.get("projects") or []:
        for t in p.get("tasks") or []:
            tid = str(t.get("id") or "").strip().lower()
            if tid == uid:
                return p, t
    return None


def _find_best_task_by_summary_in_query(q: str, projects: List[Dict[str, Any]]) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
    """任务 summary 出现在用户问题中；取最长 summary 且唯一胜出。"""
    qn = (q or "").strip()
    if len(qn) < 3:
        return None
    cand: List[Tuple[int, Dict[str, Any], Dict[str, Any]]] = []
    for p in projects:
        for t in p.get("tasks") or []:
            s = str(t.get("summary") or "").strip()
            if len(s) >= 4 and s in qn:
                cand.append((len(s), p, t))
    if not cand:
        return None
    cand.sort(key=lambda x: -x[0])
    if len(cand) == 1:
        return cand[0][1], cand[0][2]
    if cand[0][0] > cand[1][0]:
        return cand[0][1], cand[0][2]
    return None


def _wants_global_summary(q: str) -> bool:
    return any(
        k in q
        for k in (
            "全部",
            "所有",
            "每个项目",
            "各项目",
            "总体",
            "概况",
            "统计",
            "一共有",
            "一共多少",
            "任务总数",
            "全局",
            "整体",
        )
    )


def _wants_project_task_list(q: str) -> bool:
    return any(
        k in q
        for k in (
            "哪些任务",
            "什么任务",
            "有什么任务",
            "任务列表",
            "几条任务",
            "多少条任务",
            "列出任务",
            "罗列出",
        )
    )


def _wants_task_detail_layer(q: str) -> bool:
    return any(
        k in q
        for k in (
            "详情",
            "详细",
            "展开说说",
            "展开",
            "具体内容",
            "完整说明",
            "这条任务",
            "这个任务",
            "细说",
        )
    )


def _wants_full_flat_snapshot(q: str) -> bool:
    return any(
        k in q
        for k in (
            "完整列表",
            "全量",
            "导出",
            "逐条完整",
            "所有任务明细",
            "每个任务都列",
            "不要汇总",
        )
    )


def _wants_description_in_task_lines(q: str) -> bool:
    """列表层是否附加 description 摘录（否则只显示标题行以省篇幅）。"""
    m = (q or "").strip()
    if not m:
        return False
    return any(
        k in m
        for k in (
            "描述",
            "详情",
            "具体内容",
            "正文",
            "详细说明",
            "任务说明",
            "写的什么",
            "备注写什么",
        )
    )


def _wants_comments_or_history_in_task_lines(q: str) -> bool:
    m = (q or "").strip()
    if not m:
        return False
    return any(
        k in m
        for k in (
            "评论",
            "评论历史",
            "留言",
            "讨论",
            "更新历史",
            "变更历史",
            "历史记录",
            "过程记录",
        )
    )


def _task_line_description_excerpt(task: Dict[str, Any], max_chars: int = 140) -> str:
    d = (task.get("description") or "").strip().replace("\n", " ")
    if not d:
        return ""
    if len(d) <= max_chars:
        return d
    return d[:max_chars] + "…"


def _task_last_comment_excerpt(task: Dict[str, Any], max_chars: int = 90) -> str:
    com = task.get("comments") or []
    if not isinstance(com, list) or not com:
        return ""
    last = com[-1]
    if not isinstance(last, dict):
        return ""
    body = str(last.get("content") or last.get("text") or "").strip().replace("\n", " ")
    if not body:
        return ""
    return body if len(body) <= max_chars else body[:max_chars] + "…"


def _append_task_lines_for_project(
    lines: List[str],
    p: Dict[str, Any],
    question: str,
    max_tasks: int,
    max_lines_budget: int,
) -> None:
    incomplete_only = _question_focus_incomplete_tasks(question)
    tasks = _tasks_for_project_snapshot_list(p, question, for_mutate=False)
    total_t = len(tasks)
    if total_t == 0:
        lines.append("    （无任务可展示）" if not incomplete_only else "    （本项目无未完成任务）")
        return
    cap = min(max_tasks, total_t)
    want_desc = _wants_description_in_task_lines(question)
    want_ch = _wants_comments_or_history_in_task_lines(question)
    for idx, t in enumerate(tasks[:cap], start=1):
        if len(lines) >= max_lines_budget:
            lines.append("    …(已达本层行数上限)")
            break
        prog = _task_progress_val(t)
        due = (t.get("due_date") or "").strip()
        summ = (t.get("summary") or "")[:120]
        line = f'    {idx}. 「{summ}」  {prog}%  截止 {due or "—"}'
        if want_desc:
            ex = _task_line_description_excerpt(t, 160)
            if ex:
                line += f"  | 描述摘录:{ex}"
        if want_ch:
            cex = _task_last_comment_excerpt(t, 90)
            if cex:
                line += f"  | 最近评论:{cex}"
            h = t.get("update_history") or []
            if isinstance(h, list) and h:
                line += f"  | 历史条数:{len(h)}"
        lines.append(line)
    if total_t > cap:
        lines.append(f"    … 另有 {total_t - cap} 条未列出（本层每项目最多 {max_tasks} 条）")


def build_todo_project_detail_for_llm(tm: TodoManager, project: Dict[str, Any], question: str) -> str:
    """第 2 层：单个项目下的任务列表（可配合未完成筛选）。"""
    pname = str(project.get("name") or "")
    lines: List[str] = [
        f"[待办·第2层=单项目任务] 项目「{pname}」",
    ]
    if _question_focus_incomplete_tasks(question):
        lines.append("[本层已过滤] 仅显示进度未满 100% 的任务。")
    _append_task_lines_for_project(
        lines,
        project,
        question,
        max_tasks=_MAX_PROJECT_DETAIL_TASKS,
        max_lines_budget=_MAX_SNAPSHOT_LINES,
    )
    return "\n".join(lines)


def build_todo_task_detail_for_llm(project: Dict[str, Any], task: Dict[str, Any]) -> str:
    """第 3 层：单条任务展开（描述、评论、更新历史）。"""
    pname = str(project.get("name") or "")
    summ = str(task.get("summary") or "")
    lines: List[str] = [
        f"[待办·第3层=单任务详情] 项目「{pname}」",
        f"任务「{summ}」",
        f"进度 {_task_progress_val(task)}%  优先级 {task.get('priority', '')}  "
        f"截止 {(task.get('due_date') or '') or '—'}  周报字段 {(task.get('weekly_plan') or '') or '—'}",
        f"描述：{(task.get('description') or '').strip() or '—'}",
        f"结论/纪要：{(task.get('conclusion') or '').strip() or '—'}",
        "",
        "[评论]",
    ]
    comments = task.get("comments") or []
    if isinstance(comments, list) and comments:
        for i, c in enumerate(comments[:_MAX_COMMENT_LINES]):
            if not isinstance(c, dict):
                continue
            ts = str(c.get("timestamp") or "")[:19]
            body = str(c.get("content") or c.get("text") or "").strip()
            lines.append(f"  {i + 1}. [{ts}]  {body}")
        if len(comments) > _MAX_COMMENT_LINES:
            lines.append(f"  … 其余 {len(comments) - _MAX_COMMENT_LINES} 条评论已省略")
    else:
        lines.append("  （无评论）")
    lines.extend(["", "[更新历史]"])
    hist = task.get("update_history") or []
    if isinstance(hist, list) and hist:
        tail = hist[-_MAX_TASK_HISTORY_LINES :]
        for i, h in enumerate(tail):
            if not isinstance(h, dict):
                continue
            ts = str(h.get("timestamp") or "")[:19]
            field = h.get("field") or ""
            nv = h.get("new_value")
            lines.append(f"  {ts}  {field} → {nv}")
        if len(hist) > _MAX_TASK_HISTORY_LINES:
            lines.append(f"  … 更早的 {len(hist) - _MAX_TASK_HISTORY_LINES} 条已省略")
    else:
        lines.append("  （无历史）")
    return "\n".join(lines)


def build_task_card_payload(project: Dict[str, Any], task: Dict[str, Any]) -> Dict[str, Any]:
    """给前端渲染任务卡片的结构化信息（不含 UUID）。"""
    comments = task.get("comments") or []
    if not isinstance(comments, list):
        comments = []
    hist = task.get("update_history") or []
    if not isinstance(hist, list):
        hist = []
    return {
        "project": {
            "name": str(project.get("name") or ""),
            "archived": bool(project.get("archived", False)),
        },
        "task": {
            "summary": str(task.get("summary") or ""),
            "description": str(task.get("description") or ""),
            "progress": _task_progress_val(task),
            "priority": task.get("priority"),
            "due_date": task.get("due_date"),
            "task_type": task.get("task_type"),
            "weekly_plan": task.get("weekly_plan"),
            "conclusion": task.get("conclusion"),
            "show_in_report": task.get("show_in_report", True),
            "comment_count": len(comments),
            "history_count": len(hist),
            "comments": [
                {
                    "timestamp": c.get("timestamp"),
                    "content": str(c.get("content") or c.get("text") or ""),
                }
                for c in comments[-20:]
                if isinstance(c, dict)
            ],
            "update_history": [
                {
                    "timestamp": h.get("timestamp"),
                    "field": h.get("field"),
                    "old_value": h.get("old_value"),
                    "new_value": h.get("new_value"),
                }
                for h in hist[-30:]
                if isinstance(h, dict)
            ],
        },
    }


def build_adaptive_todo_context_and_meta(
    tm: TodoManager, question: str
) -> Tuple[str, Optional[Dict[str, Any]]]:
    """
    返回 (注入文本, meta)。
    meta 目前仅在命中「单任务详情层」时提供 task_card，供前端渲染。
    """
    q = (question or "").strip()
    data = tm.list_all()
    projects = list(data.get("projects") or [])

    if _wants_full_flat_snapshot(q):
        return build_todo_snapshot_for_llm(tm, q), None
    if _wants_comments_or_history_in_task_lines(q) and ("全部" in q or "所有" in q):
        return build_todo_snapshot_for_llm(tm, q), None

    for u in _UUID_RE.findall(q):
        found = _lookup_task_by_uuid(tm, u)
        if found:
            p, t = found
            return (
                build_todo_task_detail_for_llm(p, t),
                {"task_card": build_task_card_payload(p, t)},
            )

    if _wants_task_detail_layer(q):
        hit = _find_best_task_by_summary_in_query(q, projects)
        if hit:
            p, t = hit
            return (
                build_todo_task_detail_for_llm(p, t),
                {"task_card": build_task_card_payload(p, t)},
            )

    proj, amb_names = _pick_project_for_question(q, projects)
    if amb_names:
        return (
            f"[待办解析] 问题中可能匹配多个同级项目名，请用更完整的项目名重试：{amb_names}\n\n"
            + build_todo_summary_text_for_llm(tm),
            None,
        )

    g = _wants_global_summary(q)
    pl = _wants_project_task_list(q)

    want_project_layer = False
    if proj:
        if pl or _question_focus_incomplete_tasks(q):
            want_project_layer = True
        elif "任务" in q and not (g and not pl):
            want_project_layer = True
        elif "项目" in q and not g:
            want_project_layer = True

    if proj and want_project_layer:
        return build_todo_project_detail_for_llm(tm, proj, q), None

    return build_todo_summary_text_for_llm(tm), None

def build_adaptive_todo_context_for_llm(tm: TodoManager, question: str) -> str:
    """
    按对话意图选择注入：全局汇总 → 单项目列表 → 单任务详情；避免每轮塞入全量任务。
    变更类 JSON 仍由 propose_todo_ops_json 使用完整快照，不走本函数。
    """
    return build_adaptive_todo_context_and_meta(tm, question)[0]


def message_suggests_todo_context(message: str) -> bool:
    """
    在「通用 / 知识库」模式下是否应附加待办快照。
    与 mode=todo 分离：用户常留在 general/knowledge 却询问项目/任务，否则模型看不到数据。
    """
    m = (message or "").strip()
    if not m:
        return False
    low = m.lower()
    if any(k in m for k in ("待办", "任务清单", "to-do", "todolist")):
        return True
    if "todo" in low:
        return True
    if "任务" in m:
        return True
    # 「某项目」「这个项目下」类问法
    if "项目" in m and any(
        w in m
        for w in (
            "任务",
            "待办",
            "清单",
            "哪些",
            "什么",
            "多少",
            "列出",
            "查看",
            "统计",
            "有多少",
            "下有",
            "下面",
        )
    ):
        return True
    return False


def _heuristic_intent(message: str) -> str:
    m = message.strip()
    if any(
        x in m
        for x in (
            "创建任务",
            "新建任务",
            "添加任务",
            "加任务",
            "建任务",
            "写任务",
            "记任务",
            "录任务",
            "创建一个任务",
            "加一条任务",
            "帮我创建",
            "帮我加任务",
            "帮忙创建",
            "写一个任务",
        )
    ):
        return "mutate"
    mut_kw = (
        "创建",
        "新建",
        "删除",
        "移除",
        "归档",
        "修改",
        "更新",
        "设为",
        "添加任务",
        "加任务",
        "评论",
        "备注",
    )
    q_kw = ("哪些", "什么", "列出", "查看", "今天", "本周", "统计", "有多少")
    has_m = any(k in m for k in mut_kw)
    if "完成" in m and any(x in m for x in ("任务", "进度", "标记", "100%", "百分之百")):
        has_m = True
    has_q = any(k in m for k in q_kw)
    if "进度" in m and any(x in m for x in ("更新", "修改", "改为", "调到", "设为")):
        has_q = False
    if has_m and not has_q:
        return "mutate"
    if has_q and not has_m:
        return "query"
    if has_m and has_q:
        if any(
            k in m
            for k in (
                "创建",
                "新建",
                "删除",
                "移除",
                "归档",
                "添加任务",
                "加任务",
                "修改",
                "更新",
                "设为",
                "评论",
                "备注",
            )
        ):
            return "mutate"
    return "unknown"


TODO_PATCH_SYSTEM = """你是待办数据助手。用户可能想修改项目或任务。

快照中 **没有** UUID。请严格使用代号（与快照【】内一致）：
- project_id：填 `项1`、`项2` …（第几个项目）
- task_id：填 `项1·任2`（可用英文句点代替中间点：`项1.任2`）
- comment_id：填 `项1·任2·评3`（该任务下第几条评论）
禁止编造十六进制 id；不要写项目/任务的真实 UUID（即使你从别处知道）。
create_task：每条里的 summary 用短短的中文标题；用户口述的长说明、步骤、背景必须写入 **description** 字段（可多长文本），勿只写在 summary 里。
若用户说“修改结论/周计划/任务类型/描述/优先级”，请使用 `update_task` 对应字段；只有明确提到“评论/留言”才用 `add_task_comment`。
顶层 JSON 的 summary 字段：用一句话说明本次要执行的操作。

你必须只输出一个 JSON 对象（不要 markdown 代码块），格式如下：
{
  "ops": [
    {"op": "create_project", "name": "项目名称", "color": "#4facfe"},
    {"op": "update_project", "project_id": "项1", "name": "可选", "color": "可选", "phase": "可选", "archived": false, "show_in_report": true},
    {"op": "archive_project", "project_id": "项1"},
    {"op": "delete_project", "project_id": "项1"},
    {"op": "create_task", "project_id": "项1", "summary": "任务简述", "description": "", "priority": 3, "due_date": "YYYY-MM-DD或空", "progress": 0},
    {"op": "update_task", "project_id": "项1", "task_id": "项1·任1", "summary": "", "description": "", "progress": 0, "due_date": "", "priority": 3, "task_type": "", "weekly_plan": "", "conclusion": "", "show_in_report": true},
    {"op": "delete_task", "project_id": "项1", "task_id": "项1·任1"},
    {"op": "add_task_comment", "project_id": "项1", "task_id": "项1·任1", "text": "评论正文"},
    {"op": "delete_task_comment", "project_id": "项1", "task_id": "项1·任1", "comment_id": "项1·任1·评1"}
  ],
  "summary": "用中文简短说明这些操作"
}
若用户只是在问问题、不需要改数据，输出：{"ops":[],"summary":"仅查询，无变更"}"""


def propose_todo_ops_json(tm: TodoManager, user_message: str, llm_generate_fn) -> Dict[str, Any]:
    """调用 llm_generate_fn(messages, system) -> str 得到 JSON。"""
    snap, catalog = build_todo_mutate_snapshot_and_catalog(tm, user_message)
    system = (
        TODO_PATCH_SYSTEM + "\n\n" + TODO_LLM_SCHEMA_GUIDE + "\n\n当前数据快照：\n" + snap
    )
    raw = llm_generate_fn(
        [{"role": "user", "content": user_message}],
        system=system,
        max_new_tokens=1024,
    )
    raw = raw.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        return {"ok": False, "error": f"JSON 解析失败: {e}", "raw": raw, "preview": None}
    ops = data.get("ops")
    if not isinstance(ops, list):
        return {"ok": False, "error": "缺少 ops 数组", "raw": raw, "preview": None}
    ops = expand_natural_todo_refs(ops, catalog)
    ops = enrich_todo_ops_due_dates(ops, user_message)
    preview, err = validate_and_describe_ops(tm, ops)
    if err:
        return {"ok": False, "error": err, "raw": raw, "preview": preview}
    return {"ok": True, "summary": data.get("summary", ""), "ops": ops, "preview": preview, "raw": raw}


def validate_and_describe_ops(tm: TodoManager, ops: List[Dict[str, Any]]) -> Tuple[Optional[List[str]], Optional[str]]:
    """返回 (人类可读预览行列表, 错误信息)。"""
    lines: List[str] = []
    data = tm.list_all()
    proj_by_id = {p["id"]: p for p in data.get("projects", [])}

    for i, op in enumerate(ops):
        if not isinstance(op, dict):
            return None, f"操作#{i} 不是对象"
        kind = op.get("op")
        if kind == "create_project":
            name = op.get("name") or "未命名项目"
            lines.append(f"创建项目: {name}")
        elif kind == "archive_project":
            pid = op.get("project_id")
            p = proj_by_id.get(pid)
            if not p:
                return None, f"archive_project: 无效 project_id {pid}"
            lines.append(f"归档项目: 「{p.get('name')}」")
        elif kind == "delete_project":
            pid = op.get("project_id")
            p = proj_by_id.get(pid)
            if not p:
                return None, f"delete_project: 无效 project_id {pid}"
            lines.append(f"删除项目: 「{p.get('name')}」")
        elif kind == "create_task":
            pid = op.get("project_id")
            if pid not in proj_by_id:
                return None, f"create_task: 无效 project_id {pid}"
            pname = proj_by_id[pid].get("name")
            lines.append(f"在项目「{pname}」下创建任务「{op.get('summary', '')}」")
            if op.get("due_date"):
                lines.append(f"  · 截止: {op.get('due_date')}")
            pr = op.get("priority")
            if pr is not None:
                lines.append(f"  · 优先级: {pr}")
            if op.get("progress") is not None:
                lines.append(f"  · 进度: {op.get('progress')}%")
            desc = (op.get("description") or "").strip()
            if desc:
                clip = desc[:240] + ("…" if len(desc) > 240 else "")
                lines.append(f"  · 描述: {clip}")
        elif kind == "update_task":
            pid, tid = op.get("project_id"), op.get("task_id")
            p = proj_by_id.get(pid)
            if not p:
                return None, f"update_task: 无效 project_id {pid}"
            t = next((x for x in p.get("tasks", []) if x.get("id") == tid), None)
            if not t:
                return None, f"update_task: 无效 task_id {tid}"
            lines.append(f"更新任务: 「{t.get('summary')}」")
            ch: List[str] = []
            if "summary" in op:
                ch.append(f"标题→{op.get('summary')}")
            if "due_date" in op:
                ch.append(f"截止→{op.get('due_date')}")
            if "progress" in op:
                ch.append(f"进度→{op.get('progress')}%")
            if "description" in op:
                d0 = str(op.get("description") or "")
                ch.append("描述已更新" if len(d0) > 80 else f"描述→{d0}")
            if "priority" in op:
                ch.append(f"优先级→{op.get('priority')}")
            if "task_type" in op:
                ch.append(f"任务类型→{op.get('task_type')}")
            if "weekly_plan" in op:
                w0 = str(op.get("weekly_plan") or "")
                ch.append("周计划已更新" if len(w0) > 80 else f"周计划→{w0}")
            if "conclusion" in op:
                c0 = str(op.get("conclusion") or "")
                ch.append("结论已更新" if len(c0) > 80 else f"结论→{c0}")
            if "show_in_report" in op:
                ch.append(f"周报显示→{bool(op.get('show_in_report'))}")
            if not ch:
                return None, "update_task: 未提供可更新字段"
            lines.append("  · " + "；".join(ch))
        elif kind == "delete_task":
            pid, tid = op.get("project_id"), op.get("task_id")
            p = proj_by_id.get(pid)
            if not p:
                return None, f"delete_task: 无效 project_id {pid}"
            t = next((x for x in p.get("tasks", []) if x.get("id") == tid), None)
            if not t:
                return None, f"delete_task: 无效 task_id {tid}"
            lines.append(f"删除任务: 「{t.get('summary')}」")
        elif kind == "update_project":
            pid = op.get("project_id")
            p = proj_by_id.get(pid)
            if not p:
                return None, f"update_project: 无效 project_id {pid}"
            if not any(k in op for k in ("name", "color", "phase", "archived", "show_in_report")):
                return None, "update_project: 至少需要 name / color / phase / archived / show_in_report 之一"
            bits = []
            if "name" in op:
                bits.append("改名")
            if "color" in op:
                bits.append("颜色")
            if "phase" in op:
                bits.append("阶段")
            if "archived" in op:
                bits.append("归档状态")
            if "show_in_report" in op:
                bits.append("周报显示")
            lines.append(f"更新项目: 「{p.get('name')}」 ({', '.join(bits) or '字段'})")
        elif kind == "add_task_comment":
            pid, tid = op.get("project_id"), op.get("task_id")
            p = proj_by_id.get(pid)
            if not p:
                return None, f"add_task_comment: 无效 project_id {pid}"
            t = next((x for x in p.get("tasks", []) if x.get("id") == tid), None)
            if not t:
                return None, f"add_task_comment: 无效 task_id {tid}"
            tx = (op.get("text") or op.get("content") or "").strip()
            if not tx:
                return None, "add_task_comment: text 不能为空"
            preview = tx[:60] + ("…" if len(tx) > 60 else "")
            lines.append(f"向任务「{t.get('summary')}」添加评论: {preview}")
        elif kind == "delete_task_comment":
            pid, tid = op.get("project_id"), op.get("task_id")
            cid = (op.get("comment_id") or "").strip()
            p = proj_by_id.get(pid)
            if not p:
                return None, f"delete_task_comment: 无效 project_id {pid}"
            t = next((x for x in p.get("tasks", []) if x.get("id") == tid), None)
            if not t:
                return None, f"delete_task_comment: 无效 task_id {tid}"
            if not cid:
                return None, "delete_task_comment: 需要 comment_id"
            found = None
            for c in t.get("comments") or []:
                if isinstance(c, dict) and c.get("comment_id") == cid:
                    found = c
                    break
            if not found:
                return None, f"delete_task_comment: 未找到 comment_id {cid}"
            cprev = ((found.get("content") or "")[:40] + "…") if found.get("content") else ""
            lines.append(f"删除任务「{t.get('summary')}」下评论: {cprev}")
        else:
            return None, f"未知操作: {kind}"
    return lines, None


def apply_todo_ops(
    tm: TodoManager,
    ops: List[Dict[str, Any]],
    ref_question: str = "",
    *,
    expand_refs: bool = True,
) -> Tuple[bool, str]:
    if expand_refs:
        cat = build_mutate_ref_catalog_only(tm, ref_question)
        ops = expand_natural_todo_refs(ops, cat)
        ops = enrich_todo_ops_due_dates(ops, ref_question)
    for op in ops:
        kind = op.get("op")
        try:
            if kind == "create_project":
                tm.create_project(
                    {
                        "name": op.get("name"),
                        "color": op.get("color"),
                        "archived": False,
                    }
                )
            elif kind == "archive_project":
                tm.update_project(op["project_id"], {"archived": True})
            elif kind == "delete_project":
                tm.delete_project(op["project_id"])
            elif kind == "create_task":
                tm.create_task(
                    op["project_id"],
                    {
                        "summary": op.get("summary"),
                        "description": op.get("description", ""),
                        "priority": op.get("priority", 3),
                        "due_date": op.get("due_date") or None,
                        "progress": op.get("progress", 0),
                    },
                )
            elif kind == "update_task":
                payload = {}
                for k in (
                    "summary",
                    "description",
                    "priority",
                    "progress",
                    "due_date",
                    "show_in_report",
                    "task_type",
                    "weekly_plan",
                    "conclusion",
                ):
                    if k in op:
                        payload[k] = op[k]
                if not payload:
                    return False, "update_task: 无有效字段"
                tm.update_task(op["project_id"], op["task_id"], payload)
            elif kind == "delete_task":
                tm.delete_task(op["project_id"], op["task_id"])
            elif kind == "update_project":
                payload = {}
                for k in ("name", "color", "phase", "show_in_report", "archived"):
                    if k in op:
                        payload[k] = op[k]
                if not payload:
                    return False, "update_project: 无有效字段"
                tm.update_project(op["project_id"], payload)
            elif kind == "add_task_comment":
                txt = (op.get("text") or op.get("content") or "").strip()
                if not txt:
                    return False, "add_task_comment: text 不能为空"
                tm.add_comment(op["project_id"], op["task_id"], txt)
            elif kind == "delete_task_comment":
                tm.delete_comment(op["project_id"], op["task_id"], op["comment_id"])
            else:
                return False, f"未知操作 {kind}"
        except Exception as e:
            return False, str(e)
    return True, "ok"


def build_todo_overview_dict(
    tm: TodoManager,
    project_id: Optional[str] = None,
    limit_per_project: int = 80,
    *,
    redact_ids: bool = False,
    include_description: bool = False,
    include_comments: bool = False,
    include_history: bool = False,
) -> Dict[str, Any]:
    """结构化只读摘要，供 /api/local-ai/todo/overview 与调试使用。"""
    try:
        lim = max(1, min(int(limit_per_project), 500))
    except (TypeError, ValueError):
        lim = 80
    data = tm.list_all()
    out_projects: List[Dict[str, Any]] = []
    for p in data.get("projects") or []:
        if project_id and p.get("id") != project_id:
            continue
        raw_tasks = list(p.get("tasks") or [])
        raw_tasks.sort(key=_task_sort_updated_desc, reverse=True)
        tasks_out: List[Dict[str, Any]] = []
        for t in raw_tasks[:lim]:
            com = t.get("comments") or []
            nc = len(com) if isinstance(com, list) else 0
            last_cid = None
            if nc and isinstance(com, list) and isinstance(com[-1], dict):
                last_cid = com[-1].get("comment_id")
            row = {
                "summary": t.get("summary"),
                "progress": t.get("progress"),
                "due_date": t.get("due_date"),
                "updated_at": t.get("updated_at"),
                "comment_count": nc,
            }
            if include_description:
                d0 = (t.get("description") or "").strip()
                if d0:
                    row["description"] = d0[:220] + ("…" if len(d0) > 220 else "")
            if include_comments and isinstance(com, list) and com:
                cs = []
                for c in com[-8:]:
                    if not isinstance(c, dict):
                        continue
                    cs.append(
                        {
                            "timestamp": c.get("timestamp"),
                            "content": (str(c.get("content") or c.get("text") or "")[:220]),
                        }
                    )
                if cs:
                    row["comments"] = cs
            if include_history:
                h = t.get("update_history") or []
                if isinstance(h, list) and h:
                    hs = []
                    for one in h[-10:]:
                        if not isinstance(one, dict):
                            continue
                        hs.append(
                            {
                                "timestamp": one.get("timestamp"),
                                "field": one.get("field"),
                                "new_value": one.get("new_value"),
                            }
                        )
                    if hs:
                        row["update_history"] = hs
            if not redact_ids:
                row["id"] = t.get("id")
                row["latest_comment_id"] = last_cid
            tasks_out.append(row)
        prow = {
            "name": p.get("name"),
            "archived": p.get("archived", False),
            "task_count": len(raw_tasks),
            "tasks_in_snapshot": len(tasks_out),
            "tasks": tasks_out,
        }
        if not redact_ids:
            prow["id"] = p.get("id")
        out_projects.append(prow)
    return {"projects": out_projects}
