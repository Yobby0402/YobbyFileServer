import json
import logging
import os
import threading
from copy import deepcopy
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

from .paths import get_data_path, project_base_dir

_todo_ext_log = logging.getLogger('yobboy_file_server.todo_extended')
_SUPPORTED_REPORT_TYPES = ("daily", "weekly")


def _now_local_iso() -> str:
    return datetime.now().isoformat()


def _get_base_dir() -> str:
    """获取程序运行的基础目录（兼容打包与开发模式）"""
    return project_base_dir()


def _ensure_data_dir() -> str:
    """确保数据目录存在并返回路径"""
    return get_data_path()


class TodoExtendedManager:
    """管理 ToDo 扩展数据（项目描述和链接）的线程安全工具"""

    def __init__(self, storage_path: Optional[str] = None):
        data_dir = _ensure_data_dir()
        todos_dir = os.path.join(data_dir, "todos")
        os.makedirs(todos_dir, exist_ok=True)
        self.storage_path = storage_path or os.path.join(todos_dir, "todos_extended.json")
        self._lock = threading.RLock()
        self._data: Dict[str, Any] = {
            "project_descriptions": {},  # project_id -> description_md
            "project_links": {},  # project_id -> [{"id": str, "name": str, "url": str}]
            "task_links": {},  # task_id -> [{"id": str, "name": str, "url": str}]
            "meeting_notes": {},  # date_str -> {"date": str, "content": str, "created_at": str, "updated_at": str}
            "daily_reports": {},  # date_str -> report data
            "weekly_reports": {},  # week_key -> report data
        }
        self._load()

    def _load(self) -> None:
        """从磁盘加载数据"""
        if not os.path.exists(self.storage_path):
            self._persist()
            return

        try:
            with open(self.storage_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    self._data = {
                        "project_descriptions": data.get("project_descriptions", {}),
                        "project_links": data.get("project_links", {}),
                        "task_links": data.get("task_links", {}),
                        "meeting_notes": data.get("meeting_notes", {}),
                        "daily_reports": data.get("daily_reports", {}),
                        "weekly_reports": data.get("weekly_reports", {}),
                    }
                else:
                    self._data = {
                        "project_descriptions": {},
                        "project_links": {},
                        "task_links": {},
                        "meeting_notes": {},
                        "daily_reports": {},
                        "weekly_reports": {},
                    }
        except Exception:
            self._data = {
                "project_descriptions": {},
                "project_links": {},
                "task_links": {},
                "meeting_notes": {},
                "daily_reports": {},
                "weekly_reports": {},
            }
            self._persist()

    def _persist(self) -> None:
        """持久化数据到磁盘"""
        try:
            with open(self.storage_path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            _todo_ext_log.error("Error persisting extended data: %s", e)

    # ===== 项目描述相关 =====

    def get_project_description(self, project_id: str) -> str:
        """获取项目描述"""
        with self._lock:
            return self._data["project_descriptions"].get(project_id, "")

    def set_project_description(self, project_id: str, description_md: str) -> None:
        """设置项目描述"""
        with self._lock:
            self._data["project_descriptions"][project_id] = description_md
            self._persist()

    def delete_project_description(self, project_id: str) -> None:
        """删除项目描述"""
        with self._lock:
            if project_id in self._data["project_descriptions"]:
                del self._data["project_descriptions"][project_id]
                self._persist()

    # ===== 项目链接相关 =====

    def get_project_links(self, project_id: str) -> List[Dict[str, str]]:
        """获取项目链接列表"""
        with self._lock:
            return deepcopy(self._data["project_links"].get(project_id, []))

    def add_project_link(self, project_id: str, name: str, url: str) -> Dict[str, str]:
        """添加项目链接"""
        with self._lock:
            if project_id not in self._data["project_links"]:
                self._data["project_links"][project_id] = []
            link_id = str(uuid4())
            link = {"id": link_id, "name": name, "url": url}
            self._data["project_links"][project_id].append(link)
            self._persist()
            return deepcopy(link)

    def update_project_link(self, project_id: str, link_id: str, name: str, url: str) -> Optional[Dict[str, str]]:
        """更新项目链接"""
        with self._lock:
            if project_id not in self._data["project_links"]:
                return None
            links = self._data["project_links"][project_id]
            for link in links:
                if link["id"] == link_id:
                    link["name"] = name
                    link["url"] = url
                    self._persist()
                    return deepcopy(link)
            return None

    def delete_project_link(self, project_id: str, link_id: str) -> bool:
        """删除项目链接"""
        with self._lock:
            if project_id not in self._data["project_links"]:
                return False
            links = self._data["project_links"][project_id]
            original_len = len(links)
            self._data["project_links"][project_id] = [l for l in links if l["id"] != link_id]
            if len(self._data["project_links"][project_id]) < original_len:
                self._persist()
                return True
            return False

    def delete_all_project_links(self, project_id: str) -> None:
        """删除项目的所有链接"""
        with self._lock:
            if project_id in self._data["project_links"]:
                del self._data["project_links"][project_id]
                self._persist()

    # ===== 任务链接相关 =====

    def get_task_links(self, task_id: str) -> List[Dict[str, str]]:
        """获取任务链接列表"""
        with self._lock:
            return deepcopy(self._data["task_links"].get(task_id, []))

    def add_task_link(self, task_id: str, name: str, url: str) -> Dict[str, str]:
        """添加任务链接"""
        with self._lock:
            if task_id not in self._data["task_links"]:
                self._data["task_links"][task_id] = []
            link_id = str(uuid4())
            link = {"id": link_id, "name": name, "url": url}
            self._data["task_links"][task_id].append(link)
            self._persist()
            return deepcopy(link)

    def update_task_link(self, task_id: str, link_id: str, name: str, url: str) -> Optional[Dict[str, str]]:
        """更新任务链接"""
        with self._lock:
            if task_id not in self._data["task_links"]:
                return None
            links = self._data["task_links"][task_id]
            for link in links:
                if link["id"] == link_id:
                    link["name"] = name
                    link["url"] = url
                    self._persist()
                    return deepcopy(link)
            return None

    def delete_task_link(self, task_id: str, link_id: str) -> bool:
        """删除任务链接"""
        with self._lock:
            if task_id not in self._data["task_links"]:
                return False
            links = self._data["task_links"][task_id]
            original_len = len(links)
            self._data["task_links"][task_id] = [l for l in links if l["id"] != link_id]
            if len(self._data["task_links"][task_id]) < original_len:
                self._persist()
                return True
            return False

    def delete_all_task_links(self, task_id: str) -> None:
        """删除任务的所有链接"""
        with self._lock:
            if task_id in self._data["task_links"]:
                del self._data["task_links"][task_id]
                self._persist()

    # ===== 会议记录（笔记）相关 =====

    def list_meeting_notes(self) -> List[Dict[str, Any]]:
        """获取所有会议记录列表，按日期倒序排列"""
        with self._lock:
            notes = []
            for date_str, note_data in self._data["meeting_notes"].items():
                notes.append({
                    "date": date_str,
                    "content": note_data.get("content", ""),
                    "created_at": note_data.get("created_at", ""),
                    "updated_at": note_data.get("updated_at", "")
                })
            # 按日期倒序排列（最新的在前）
            notes.sort(key=lambda x: x["date"], reverse=True)
            return notes

    def get_meeting_note(self, date_str: str) -> Optional[str]:
        """获取指定日期的会议记录内容"""
        with self._lock:
            note_data = self._data["meeting_notes"].get(date_str)
            if note_data:
                return note_data.get("content", "")
            return None

    def set_meeting_note(self, date_str: str, content: str) -> None:
        """设置指定日期的会议记录"""
        with self._lock:
            if date_str not in self._data["meeting_notes"]:
                self._data["meeting_notes"][date_str] = {
                    "date": date_str,
                    "content": content,
                    "created_at": _now_local_iso(),
                    "updated_at": _now_local_iso(),
                }
            else:
                self._data["meeting_notes"][date_str]["content"] = content
                self._data["meeting_notes"][date_str]["updated_at"] = _now_local_iso()
            self._persist()

    def delete_meeting_note(self, date_str: str) -> bool:
        """删除指定日期的会议记录"""
        with self._lock:
            if date_str in self._data["meeting_notes"]:
                del self._data["meeting_notes"][date_str]
                self._persist()
                return True
            return False

    # ===== 日报 / 周报 =====

    def _report_bucket_name(self, report_type: str) -> str:
        kind = str(report_type or "").strip().lower()
        if kind not in _SUPPORTED_REPORT_TYPES:
            raise ValueError("不支持的 report_type")
        return f"{kind}_reports"

    def list_reports(self, report_type: str) -> List[Dict[str, Any]]:
        bucket_name = self._report_bucket_name(report_type)
        with self._lock:
            items = []
            for key, raw in self._data.get(bucket_name, {}).items():
                if not isinstance(raw, dict):
                    continue
                item = deepcopy(raw)
                item.setdefault("key", key)
                items.append(item)
            items.sort(key=lambda item: str(item.get("key") or ""), reverse=True)
            return items

    def get_report(self, report_type: str, key: str) -> Optional[Dict[str, Any]]:
        bucket_name = self._report_bucket_name(report_type)
        with self._lock:
            raw = self._data.get(bucket_name, {}).get(key)
            if not isinstance(raw, dict):
                return None
            item = deepcopy(raw)
            item.setdefault("key", key)
            return item

    def set_report(self, report_type: str, key: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        bucket_name = self._report_bucket_name(report_type)
        with self._lock:
            bucket = self._data.setdefault(bucket_name, {})
            previous = bucket.get(key) if isinstance(bucket.get(key), dict) else {}
            now = _now_local_iso()
            item = {
                "key": key,
                "title": str(payload.get("title") or previous.get("title") or ""),
                "content": str(payload.get("content") or previous.get("content") or ""),
                "period_start": str(payload.get("period_start") or previous.get("period_start") or ""),
                "period_end": str(payload.get("period_end") or previous.get("period_end") or ""),
                "source_tasks": deepcopy(payload.get("source_tasks") or previous.get("source_tasks") or []),
                "source_notes": deepcopy(payload.get("source_notes") or previous.get("source_notes") or []),
                "generated_at": str(payload.get("generated_at") or previous.get("generated_at") or now),
                "created_at": str(previous.get("created_at") or payload.get("created_at") or now),
                "updated_at": now,
            }
            bucket[key] = item
            self._persist()
            return deepcopy(item)

    def delete_report(self, report_type: str, key: str) -> bool:
        bucket_name = self._report_bucket_name(report_type)
        with self._lock:
            bucket = self._data.get(bucket_name, {})
            if key not in bucket:
                return False
            del bucket[key]
            self._persist()
            return True


# 全局实例
todo_extended_manager = TodoExtendedManager()
