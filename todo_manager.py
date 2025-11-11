import json
import os
import sys
import threading
from copy import deepcopy
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4


def _get_base_dir() -> str:
    """获取程序运行的基础目录（兼容打包与开发模式）"""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def _ensure_data_dir() -> str:
    """确保数据目录存在并返回路径"""
    data_dir = os.path.join(_get_base_dir(), "data")
    os.makedirs(data_dir, exist_ok=True)
    return data_dir


def _utc_now() -> str:
    """返回当前 UTC 时间的 ISO8601 字符串（秒级精度）"""
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


class TodoManager:
    """管理 ToDo 数据的线程安全工具"""

    DEFAULT_COLOR = "#4facfe"

    def __init__(self, storage_path: Optional[str] = None):
        data_dir = _ensure_data_dir()
        self.storage_path = storage_path or os.path.join(data_dir, "todos.json")
        self._lock = threading.RLock()
        self._data: Dict[str, Any] = {"todos": [], "projects": {}}
        self._load()

    # ===== 基础 I/O =====

    def _load(self) -> None:
        """从磁盘加载数据"""
        if not os.path.exists(self.storage_path):
            self._persist()
            return

        try:
            with open(self.storage_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, dict):
                    self._data = data
                elif isinstance(data, list):
                    # 兼容旧格式：仅包含 todos 列表
                    self._data = {"todos": data, "projects": {}}
                else:
                    raise ValueError("无效的 ToDo 数据格式")
        except Exception:
            # 如果加载失败，保留当前内存数据并重新写入
            self._data = {"todos": [], "projects": {}}
            self._persist()
            return
        finally:
            if "todos" not in self._data or not isinstance(self._data["todos"], list):
                self._data["todos"] = []
            if "projects" not in self._data or not isinstance(self._data["projects"], dict):
                self._data["projects"] = {}

    def _persist(self) -> None:
        """将数据持久化到磁盘（写入到临时文件后原子替换）"""
        tmp_path = self.storage_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, self.storage_path)

    # ===== 工具方法 =====

    def _find_todo_index(self, todo_id: str) -> int:
        for idx, todo in enumerate(self._data["todos"]):
            if todo.get("id") == todo_id:
                return idx
        raise ValueError("ToDo 不存在")

    @staticmethod
    def _sanitize_progress(progress: Optional[int]) -> int:
        if progress is None:
            return 0
        try:
            value = int(progress)
        except (TypeError, ValueError):
            return 0
        return max(0, min(100, value))

    @staticmethod
    def _normalize_color(color: Optional[str]) -> str:
        if not color:
            return TodoManager.DEFAULT_COLOR
        color = color.strip()
        if not color.startswith("#"):
            return TodoManager.DEFAULT_COLOR
        if len(color) not in (4, 7):
            return TodoManager.DEFAULT_COLOR
        return color

    @staticmethod
    def _normalize_due_date(due_date: Optional[str]) -> Optional[str]:
        if not due_date:
            return None
        due_date = due_date.strip()
        if not due_date:
            return None
        try:
            datetime.strptime(due_date, "%Y-%m-%d")
            return due_date
        except ValueError:
            return None

    def _get_project_color(self, project: str) -> Optional[str]:
        project = (project or "").strip()
        if not project:
            return None
        info = self._data.get("projects", {}).get(project)
        if isinstance(info, dict):
            return info.get("color")
        if isinstance(info, str):
            return info
        return None

    def _set_project_color(self, project: str, color: str) -> None:
        project = (project or "").strip()
        if not project:
            return
        self._data.setdefault("projects", {})
        self._data["projects"][project] = {"color": color}

    def _build_event(
        self,
        todo_id: str,
        event_type: str,
        summary: str,
        payload: Optional[Dict] = None,
    ) -> Dict:
        return {
            "event_id": str(uuid4()),
            "todo_id": todo_id,
            "type": event_type,
            "summary": summary,
            "timestamp": _utc_now(),
            "payload": payload or {},
        }

    # ===== 对外接口 =====

    def list_todos(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "todos": deepcopy(self._data["todos"]),
                "projects": deepcopy(self._data.get("projects", {})),
            }

    def get_projects(self) -> Dict[str, Any]:
        with self._lock:
            return deepcopy(self._data.get("projects", {}))

    def get_timeline(self) -> List[Dict]:
        with self._lock:
            events: List[Dict] = []
            for todo in self._data["todos"]:
                base_meta = {
                    "project": todo.get("project"),
                    "category": todo.get("category"),
                    "description": todo.get("description"),
                    "progress": todo.get("progress"),
                    "color": todo.get("color"),
                    "tag": todo.get("tag"),
                    "due_date": todo.get("due_date"),
                }
                for entry in todo.get("history", []):
                    event = deepcopy(entry)
                    event.update(base_meta)
                    events.append(event)
            events.sort(key=lambda item: item.get("timestamp", ""))
            return events

    def create_todo(self, payload: Dict) -> Tuple[Dict, Dict]:
        with self._lock:
            todo_id = str(uuid4())
            now = _utc_now()
            todo = {
                "id": todo_id,
                "project": payload.get("project") or "未命名项目",
                "category": payload.get("category") or "默认",
                "description": payload.get("description") or "",
                "tag": payload.get("tag") or "",
                "progress": self._sanitize_progress(payload.get("progress")),
                "color": self._normalize_color(payload.get("color")),
                "due_date": self._normalize_due_date(payload.get("due_date")),
                "created_at": now,
                "updated_at": now,
                "history": [],
                "comments": [],
            }

            project_color = self._get_project_color(todo["project"])
            if project_color:
                todo["color"] = project_color
            else:
                self._set_project_color(todo["project"], todo["color"])

            summary = f"创建 ToDo · {todo['project']}"
            event_payload = {
                "project": todo["project"],
                "category": todo["category"],
                "progress": todo["progress"],
                "color": todo["color"],
                "tag": todo["tag"],
                "description": todo["description"],
                "due_date": todo["due_date"],
            }
            event = self._build_event(todo_id, "create", summary, event_payload)
            todo["history"].append(event)

            self._data["todos"].append(todo)
            self._persist()
            return deepcopy(todo), deepcopy(event)

    def update_todo(self, todo_id: str, payload: Dict) -> Tuple[Dict, Optional[Dict]]:
        with self._lock:
            idx = self._find_todo_index(todo_id)
            todo = self._data["todos"][idx]

            changes = {}

            if "project" in payload:
                new_project = (payload.get("project") or todo.get("project") or "").strip()
                if new_project != todo.get("project"):
                    changes["project"] = {"old": todo.get("project"), "new": new_project}
                    todo["project"] = new_project

            if "category" in payload:
                new_category = payload.get("category") or todo.get("category") or ""
                if new_category != todo.get("category"):
                    changes["category"] = {"old": todo.get("category"), "new": new_category}
                    todo["category"] = new_category

            if "description" in payload:
                new_description = payload.get("description") or ""
                if new_description != todo.get("description"):
                    changes["description"] = {
                        "old": todo.get("description"),
                        "new": new_description,
                    }
                    todo["description"] = new_description

            if "progress" in payload:
                new_progress = self._sanitize_progress(payload.get("progress"))
                if new_progress != todo.get("progress"):
                    changes["progress"] = {
                        "old": todo.get("progress"),
                        "new": new_progress,
                    }
                    todo["progress"] = new_progress

            explicit_color_update = "color" in payload

            if explicit_color_update:
                new_color = self._normalize_color(payload.get("color"))
                if new_color != todo.get("color"):
                    changes["color"] = {"old": todo.get("color"), "new": new_color}
                    todo["color"] = new_color

            if "tag" in payload:
                new_tag = payload.get("tag") or ""
                if new_tag != todo.get("tag"):
                    changes["tag"] = {"old": todo.get("tag"), "new": new_tag}
                    todo["tag"] = new_tag

            if "due_date" in payload:
                new_due = self._normalize_due_date(payload.get("due_date"))
                if new_due != todo.get("due_date"):
                    changes["due_date"] = {"old": todo.get("due_date"), "new": new_due}
                    todo["due_date"] = new_due

            # 项目颜色保持最新
            project_color = self._get_project_color(todo.get("project", ""))
            if not explicit_color_update and project_color and project_color != todo.get("color"):
                old_color = todo.get("color")
                todo["color"] = project_color
                changes.setdefault("color", {"old": old_color, "new": project_color})

            self._set_project_color(todo.get("project", ""), todo.get("color", self.DEFAULT_COLOR))

            event = None
            if changes:
                todo["updated_at"] = _utc_now()
                fields = ", ".join(changes.keys())
                summary = f"更新 ToDo · {fields}"
                event = self._build_event(todo_id, "update", summary, {"changes": changes})
                todo.setdefault("history", []).append(event)
                self._persist()

            return deepcopy(todo), deepcopy(event) if event else None

    def add_comment(self, todo_id: str, comment_text: str) -> Tuple[Dict, Dict]:
        if not comment_text:
            raise ValueError("评论内容不能为空")

        with self._lock:
            idx = self._find_todo_index(todo_id)
            todo = self._data["todos"][idx]
            now = _utc_now()
            comment = {
                "comment_id": str(uuid4()),
                "todo_id": todo_id,
                "content": comment_text,
                "timestamp": now,
            }
            todo.setdefault("comments", []).append(comment)
            todo["updated_at"] = now

            summary = "评论 · " + comment_text[:20]
            event = self._build_event(
                todo_id,
                "comment",
                summary,
                {"comment_id": comment["comment_id"], "content": comment_text},
            )
            todo.setdefault("history", []).append(event)
            self._persist()
            return deepcopy(todo), deepcopy(event)

    def get_todo(self, todo_id: str) -> Dict:
        with self._lock:
            idx = self._find_todo_index(todo_id)
            return deepcopy(self._data["todos"][idx])

    def delete_todo(self, todo_id: str) -> Dict:
        with self._lock:
            idx = self._find_todo_index(todo_id)
            removed = deepcopy(self._data["todos"][idx])
            del self._data["todos"][idx]
            self._persist()
            return removed

    def delete_event(self, event_id: str) -> Dict:
        """删除单个时间轴事件（评论 / 更新）"""
        with self._lock:
            for todo in self._data["todos"]:
                history = todo.get("history", [])
                for idx, entry in enumerate(history):
                    if entry.get("event_id") == event_id:
                        event_type = entry.get("type")
                        # 清理关联数据
                        if event_type == "comment":
                            comment_id = entry.get("payload", {}).get("comment_id")
                            if comment_id:
                                todo["comments"] = [
                                    item for item in todo.get("comments", []) if item.get("comment_id") != comment_id
                                ]
                        # 删除历史事件
                        del history[idx]
                        todo["updated_at"] = _utc_now()
                        todo["history"] = history
                        self._persist()
                        updated = deepcopy(todo)
                        return {
                            "todo": updated,
                            "event_id": event_id,
                            "event_type": event_type,
                        }
            raise ValueError("未找到指定的时间轴事件")


# 单例管理：为 routes.init_app 提供方便的实例化方式
todo_manager = TodoManager()


