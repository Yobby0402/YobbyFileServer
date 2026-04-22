from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        return datetime.fromisoformat(text)
    except Exception:
        return None


def _parse_date(value: Any) -> Optional[date]:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) >= 10:
        text = text[:10]
    try:
        return date.fromisoformat(text)
    except Exception:
        dt = _parse_iso_datetime(text)
        return dt.date() if dt else None


def _today() -> date:
    return datetime.now().date()


def _week_key_for(day: date) -> str:
    iso = day.isocalendar()
    return f"{iso.year}-W{iso.week:02d}"


def _week_bounds(week_key: str) -> tuple[date, date]:
    year_str, _, week_str = str(week_key or "").partition("-W")
    if not year_str or not week_str:
        raise ValueError("week_key 格式必须为 YYYY-Www")
    year = int(year_str)
    week = int(week_str)
    start = date.fromisocalendar(year, week, 1)
    end = start + timedelta(days=6)
    return start, end


def _coerce_week_key(week_key: Optional[str] = None, ref_date: Optional[str] = None) -> str:
    if week_key:
        _week_bounds(week_key)
        return week_key
    if ref_date:
        d = _parse_date(ref_date)
        if d is not None:
            return _week_key_for(d)
    return _week_key_for(_today())


def _coerce_report_date(date_str: Optional[str] = None) -> str:
    if date_str:
        parsed = _parse_date(date_str)
        if parsed is None:
            raise ValueError("date 格式必须为 YYYY-MM-DD")
        return parsed.isoformat()
    return _today().isoformat()


def _progress(task: Dict[str, Any]) -> int:
    try:
        value = int(task.get("progress", 0) or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, min(100, value))


def _ensure_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _task_source(project: Dict[str, Any], task: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "project_id": str(project.get("id") or ""),
        "project_name": str(project.get("name") or ""),
        "task_id": str(task.get("id") or ""),
        "summary": str(task.get("summary") or ""),
        "progress": _progress(task),
        "weekly_plan": str(task.get("weekly_plan") or ""),
        "conclusion": str(task.get("conclusion") or ""),
        "updated_at": str(task.get("updated_at") or ""),
    }


def _task_touched_in_range(task: Dict[str, Any], start: date, end: date) -> bool:
    for field in ("created_at", "updated_at"):
        parsed = _parse_date(task.get(field))
        if parsed and start <= parsed <= end:
            return True
    for comment in _ensure_list(task.get("comments")):
        if not isinstance(comment, dict):
            continue
        parsed = _parse_date(comment.get("timestamp"))
        if parsed and start <= parsed <= end:
            return True
    for record in _ensure_list(task.get("update_history")):
        if not isinstance(record, dict):
            continue
        parsed = _parse_date(record.get("timestamp"))
        if parsed and start <= parsed <= end:
            return True
    return False


def _collect_task_updates(task: Dict[str, Any], start: date, end: date) -> List[str]:
    lines: List[str] = []
    for record in _ensure_list(task.get("update_history")):
        if not isinstance(record, dict):
            continue
        parsed = _parse_date(record.get("timestamp"))
        if not parsed or not (start <= parsed <= end):
            continue
        field = str(record.get("field") or "").strip()
        new_value = str(record.get("new_value") or "").strip()
        if field and new_value:
            lines.append(f"{field}: {new_value}")
    for comment in _ensure_list(task.get("comments"))[-10:]:
        if not isinstance(comment, dict):
            continue
        parsed = _parse_date(comment.get("timestamp"))
        if not parsed or not (start <= parsed <= end):
            continue
        content = str(comment.get("content") or comment.get("text") or "").strip()
        if content:
            lines.append(f"评论: {content}")
    deduped: List[str] = []
    for line in lines:
        if line not in deduped:
            deduped.append(line)
    return deduped[:6]


@dataclass
class ReportPayload:
    report_type: str
    key: str
    title: str
    content: str
    period_start: str
    period_end: str
    source_tasks: List[Dict[str, Any]]
    source_notes: List[Dict[str, Any]]

    def to_record(self) -> Dict[str, Any]:
        now = datetime.now().isoformat()
        return {
            "key": self.key,
            "title": self.title,
            "content": self.content,
            "period_start": self.period_start,
            "period_end": self.period_end,
            "source_tasks": self.source_tasks,
            "source_notes": self.source_notes,
            "created_at": now,
            "updated_at": now,
            "generated_at": now,
        }


def build_daily_report(todo_manager: Any, extended_manager: Any, *, date_str: Optional[str] = None) -> ReportPayload:
    target = _coerce_report_date(date_str)
    target_date = date.fromisoformat(target)
    data = todo_manager.list_all() if todo_manager is not None else {}
    sections: List[str] = [f"# 日报 {target}"]
    task_sources: List[Dict[str, Any]] = []
    progress_lines: List[str] = []
    completed_lines: List[str] = []
    next_lines: List[str] = []

    for project in data.get("projects") or []:
        if not isinstance(project, dict):
            continue
        project_name = str(project.get("name") or "未命名项目")
        for task in project.get("tasks") or []:
            if not isinstance(task, dict):
                continue
            if not _task_touched_in_range(task, target_date, target_date):
                continue
            task_sources.append(_task_source(project, task))
            updates = _collect_task_updates(task, target_date, target_date)
            status = "已完成" if _progress(task) >= 100 else "进行中"
            line = f"- {project_name} / {task.get('summary') or '未命名任务'}：{status}（{_progress(task)}%）"
            if updates:
                line += "；" + "；".join(updates)
            progress_lines.append(line)
            if _progress(task) >= 100:
                completed_lines.append(f"- {project_name} / {task.get('summary') or '未命名任务'}")
            if str(task.get("weekly_plan") or "").strip():
                next_lines.append(
                    f"- {project_name} / {task.get('summary') or '未命名任务'}：{str(task.get('weekly_plan') or '').strip()}"
                )

    if completed_lines:
        sections.extend(["", "## 今日完成", *completed_lines])
    if progress_lines:
        sections.extend(["", "## 今日进展", *progress_lines])

    source_notes: List[Dict[str, Any]] = []
    meeting_note = extended_manager.get_meeting_note(target) if extended_manager is not None else None
    if meeting_note:
        source_notes.append({"date": target, "content": str(meeting_note or "")})
        sections.extend(["", "## 会议记录", str(meeting_note or "").strip()])

    if next_lines:
        deduped_next: List[str] = []
        for line in next_lines:
            if line not in deduped_next:
                deduped_next.append(line)
        sections.extend(["", "## 后续计划", *deduped_next[:8]])

    if len(sections) == 1:
        sections.extend(["", "## 今日进展", "- 今日暂无待办更新记录"])

    return ReportPayload(
        report_type="daily",
        key=target,
        title=f"日报 {target}",
        content="\n".join(sections).strip(),
        period_start=target,
        period_end=target,
        source_tasks=task_sources,
        source_notes=source_notes,
    )


def build_weekly_report(
    todo_manager: Any,
    extended_manager: Any,
    *,
    week_key: Optional[str] = None,
    ref_date: Optional[str] = None,
) -> ReportPayload:
    resolved_week_key = _coerce_week_key(week_key, ref_date)
    start, end = _week_bounds(resolved_week_key)
    data = todo_manager.list_all() if todo_manager is not None else {}
    sections: List[str] = [f"# 周报 {resolved_week_key}", f"周期：{start.isoformat()} ~ {end.isoformat()}"]
    task_sources: List[Dict[str, Any]] = []

    for project in data.get("projects") or []:
        if not isinstance(project, dict):
            continue
        if project.get("show_in_report", True) is False:
            continue
        project_name = str(project.get("name") or "未命名项目")
        project_lines: List[str] = []
        for task in project.get("tasks") or []:
            if not isinstance(task, dict):
                continue
            if task.get("show_in_report", True) is False:
                continue
            touched = _task_touched_in_range(task, start, end)
            has_week_plan = bool(str(task.get("weekly_plan") or "").strip())
            if not touched and not has_week_plan:
                continue
            task_sources.append(_task_source(project, task))
            updates = _collect_task_updates(task, start, end)
            summary = str(task.get("summary") or "未命名任务")
            status = "已完成" if _progress(task) >= 100 else "进行中"
            line = f"- {summary}：{status}（{_progress(task)}%）"
            if task.get("due_date"):
                line += f"，截止 {task.get('due_date')}"
            project_lines.append(line)
            if updates:
                project_lines.append(f"  - 本周进展：{'；'.join(updates)}")
            if str(task.get("weekly_plan") or "").strip():
                project_lines.append(f"  - 下周计划：{str(task.get('weekly_plan') or '').strip()}")
            if str(task.get("conclusion") or "").strip() and _progress(task) >= 100:
                project_lines.append(f"  - 结果：{str(task.get('conclusion') or '').strip()}")
        if project_lines:
            sections.extend(["", f"## {project_name}", *project_lines])

    source_notes: List[Dict[str, Any]] = []
    if extended_manager is not None:
        for note in extended_manager.list_meeting_notes() or []:
            if not isinstance(note, dict):
                continue
            note_date = _parse_date(note.get("date"))
            if note_date and start <= note_date <= end:
                source_notes.append({"date": str(note.get("date") or ""), "content": str(note.get("content") or "")})
        if source_notes:
            sections.extend(["", "## 本周会议记录"])
            for item in source_notes:
                sections.append(f"- {item['date']}：{item['content']}")

    if len(sections) <= 2:
        sections.extend(["", "## 本周概览", "- 本周暂无可汇总的待办动态"])

    return ReportPayload(
        report_type="weekly",
        key=resolved_week_key,
        title=f"周报 {resolved_week_key}",
        content="\n".join(sections).strip(),
        period_start=start.isoformat(),
        period_end=end.isoformat(),
        source_tasks=task_sources,
        source_notes=source_notes,
    )
