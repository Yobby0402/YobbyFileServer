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
    """管理 ToDo 数据的线程安全工具 - 新版基于项目和任务的层级结构"""

    DEFAULT_COLOR = "#4facfe"
    DEFAULT_PRIORITY = 3  # 1-5，3为中等优先级
    DEFAULT_PHASE = "预研阶段"  # 项目阶段默认值
    DEFAULT_TASK_TYPE = "预研任务"  # 任务类型默认值（对于没有设定的任务，统一按照预研任务处理）

    def __init__(self, storage_path: Optional[str] = None):
        data_dir = _ensure_data_dir()
        self.storage_path = storage_path or os.path.join(data_dir, "todos_v2.json")
        self._lock = threading.RLock()
        self._data: Dict[str, Any] = {"projects": []}
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
                if isinstance(data, dict) and "projects" in data:
                    self._data = data
                else:
                    # 兼容旧格式或其他格式，初始化为空
                    self._data = {"projects": []}
        except Exception:
            # 如果加载失败，保留当前内存数据并重新写入
            self._data = {"projects": []}
            self._persist()
            return
        finally:
            if "projects" not in self._data or not isinstance(self._data["projects"], list):
                self._data["projects"] = []

    def _persist(self) -> None:
        """将数据持久化到磁盘（写入到临时文件后原子替换）"""
        tmp_path = self.storage_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, self.storage_path)

    # ===== 工具方法 =====

    def _find_project_index(self, project_id: str) -> int:
        for idx, project in enumerate(self._data["projects"]):
            if project.get("id") == project_id:
                return idx
        raise ValueError("项目不存在")

    def _find_task_index(self, project_id: str, task_id: str) -> int:
        project_idx = self._find_project_index(project_id)
        project = self._data["projects"][project_idx]
        tasks = project.get("tasks", [])
        for idx, task in enumerate(tasks):
            if task.get("id") == task_id:
                return idx
        raise ValueError("任务不存在")

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

    @staticmethod
    def _sanitize_priority(priority: Optional[int]) -> int:
        if priority is None:
            return TodoManager.DEFAULT_PRIORITY
        try:
            value = int(priority)
        except (TypeError, ValueError):
            return TodoManager.DEFAULT_PRIORITY
        return max(1, min(5, value))

    @staticmethod
    def _normalize_phase(phase: Optional[str]) -> str:
        """标准化项目阶段"""
        valid_phases = ["预研阶段", "ES1阶段", "PL阶段", "MP阶段", "完成", "暂停", "终止"]
        if not phase or phase not in valid_phases:
            return TodoManager.DEFAULT_PHASE
        return phase

    @staticmethod
    def _normalize_task_type(task_type: Optional[str]) -> str:
        """标准化任务类型（对于没有设定的任务，统一按照预研任务处理）"""
        valid_types = ["预研任务", "研发任务"]
        if not task_type or task_type not in valid_types:
            return "预研任务"  # 默认使用预研任务
        return task_type

    def _calculate_project_progress(self, tasks: List[Dict]) -> int:
        """计算项目整体进度"""
        if not tasks:
            return 0
        total_progress = sum(self._sanitize_progress(task.get("progress", 0)) for task in tasks)
        return int(total_progress / len(tasks))

    def _build_update_record(self, field: str, old_value: Any, new_value: Any) -> Dict:
        """构建更新记录"""
        return {
            "field": field,
            "old_value": old_value,
            "new_value": new_value,
            "timestamp": _utc_now(),
        }

    # ===== 对外接口 =====

    def list_all(self) -> Dict[str, Any]:
        """获取所有项目和任务"""
        with self._lock:
            return deepcopy(self._data)

    def get_project(self, project_id: str) -> Dict:
        """获取单个项目"""
        with self._lock:
            idx = self._find_project_index(project_id)
            return deepcopy(self._data["projects"][idx])

    def create_project(self, payload: Dict) -> Dict:
        """创建新项目"""
        with self._lock:
            project_id = str(uuid4())
            now = _utc_now()
            project = {
                "id": project_id,
                "name": payload.get("name") or "未命名项目",
                "color": self._normalize_color(payload.get("color")),
                "phase": self._normalize_phase(payload.get("phase")),
                "created_at": now,
                "updated_at": now,
                "tasks": [],
            }
            self._data["projects"].append(project)
            self._persist()
            return deepcopy(project)

    def update_project(self, project_id: str, payload: Dict) -> Dict:
        """更新项目"""
        with self._lock:
            idx = self._find_project_index(project_id)
            project = self._data["projects"][idx]

            if "name" in payload:
                project["name"] = payload.get("name") or "未命名项目"
            if "color" in payload:
                project["color"] = self._normalize_color(payload.get("color"))
            if "phase" in payload:
                project["phase"] = self._normalize_phase(payload.get("phase"))

            project["updated_at"] = _utc_now()
            self._persist()
            return deepcopy(project)

    def delete_project(self, project_id: str) -> Dict:
        """删除项目"""
        with self._lock:
            idx = self._find_project_index(project_id)
            removed = deepcopy(self._data["projects"][idx])
            del self._data["projects"][idx]
            self._persist()
            return removed

    def create_task(self, project_id: str, payload: Dict) -> Tuple[Dict, Dict]:
        """在项目中创建新任务"""
        with self._lock:
            task_id = str(uuid4())
            now = _utc_now()
            task = {
                "id": task_id,
                "summary": payload.get("summary") or "未命名任务",
                "description": payload.get("description") or "",
                "priority": self._sanitize_priority(payload.get("priority")),
                "progress": self._sanitize_progress(payload.get("progress")),
                "due_date": self._normalize_due_date(payload.get("due_date")),
                "task_type": self._normalize_task_type(payload.get("task_type")),
                "conclusion": payload.get("conclusion") or "",
                "created_at": now,
                "updated_at": now,
                "update_history": [],
                "comments": [],
            }

            project_idx = self._find_project_index(project_id)
            project = self._data["projects"][project_idx]
            project["tasks"].append(task)
            project["updated_at"] = now

            # 记录创建历史
            update_record = self._build_update_record("create", None, "任务已创建")
            task["update_history"].append(update_record)

            self._persist()
            return deepcopy(task), deepcopy(update_record)

    def update_task(self, project_id: str, task_id: str, payload: Dict) -> Tuple[Dict, List[Dict]]:
        """更新任务"""
        with self._lock:
            project_idx = self._find_project_index(project_id)
            project = self._data["projects"][project_idx]
            task_idx = self._find_task_index(project_id, task_id)
            task = project["tasks"][task_idx]

            update_records = []

            if "summary" in payload:
                old_value = task.get("summary")
                new_value = payload.get("summary") or "未命名任务"
                if old_value != new_value:
                    task["summary"] = new_value
                    update_records.append(self._build_update_record("summary", old_value, new_value))

            if "description" in payload:
                old_value = task.get("description")
                new_value = payload.get("description") or ""
                if old_value != new_value:
                    task["description"] = new_value
                    update_records.append(self._build_update_record("description", old_value, new_value))

            if "priority" in payload:
                old_value = task.get("priority")
                new_value = self._sanitize_priority(payload.get("priority"))
                if old_value != new_value:
                    task["priority"] = new_value
                    update_records.append(self._build_update_record("priority", old_value, new_value))

            if "progress" in payload:
                old_value = task.get("progress")
                new_value = self._sanitize_progress(payload.get("progress"))
                if old_value != new_value:
                    task["progress"] = new_value
                    update_records.append(self._build_update_record("progress", old_value, new_value))

            if "due_date" in payload:
                old_value = task.get("due_date")
                new_value = self._normalize_due_date(payload.get("due_date"))
                if old_value != new_value:
                    task["due_date"] = new_value
                    update_records.append(self._build_update_record("due_date", old_value, new_value))

            if "task_type" in payload:
                old_value = task.get("task_type")
                new_value = self._normalize_task_type(payload.get("task_type"))
                if old_value != new_value:
                    task["task_type"] = new_value
                    update_records.append(self._build_update_record("task_type", old_value, new_value))

            if "conclusion" in payload:
                old_value = task.get("conclusion")
                new_value = payload.get("conclusion") or ""
                if old_value != new_value:
                    task["conclusion"] = new_value
                    update_records.append(self._build_update_record("conclusion", old_value, new_value))

            if update_records:
                task.setdefault("update_history", []).extend(update_records)
                task["updated_at"] = _utc_now()
                project["updated_at"] = _utc_now()
                self._persist()

            return deepcopy(task), deepcopy(update_records)

    def delete_task(self, project_id: str, task_id: str) -> Dict:
        """删除任务"""
        with self._lock:
            project_idx = self._find_project_index(project_id)
            project = self._data["projects"][project_idx]
            task_idx = self._find_task_index(project_id, task_id)
            removed = deepcopy(project["tasks"][task_idx])
            del project["tasks"][task_idx]
            project["updated_at"] = _utc_now()
            self._persist()
            return removed

    def reorder_tasks(self, project_id: str, task_ids: List[str]) -> Dict:
        """重新排序任务"""
        with self._lock:
            project_idx = self._find_project_index(project_id)
            project = self._data["projects"][project_idx]
            tasks = project.get("tasks", [])

            # 创建任务ID到任务的映射
            task_map = {task["id"]: task for task in tasks}

            # 按照新的顺序重新排列
            new_tasks = []
            for task_id in task_ids:
                if task_id in task_map:
                    new_tasks.append(task_map[task_id])

            # 添加未在列表中的任务（防止数据不一致）
            existing_ids = set(task_ids)
            for task in tasks:
                if task["id"] not in existing_ids:
                    new_tasks.append(task)

            project["tasks"] = new_tasks
            project["updated_at"] = _utc_now()
            self._persist()
            return deepcopy(project)

    def add_comment(self, project_id: str, task_id: str, comment_text: str) -> Tuple[Dict, Dict]:
        """为任务添加评论"""
        if not comment_text or not comment_text.strip():
            raise ValueError("评论内容不能为空")

        with self._lock:
            project_idx = self._find_project_index(project_id)
            project = self._data["projects"][project_idx]
            task_idx = self._find_task_index(project_id, task_id)
            task = project["tasks"][task_idx]

            now = _utc_now()
            comment = {
                "comment_id": str(uuid4()),
                "content": comment_text.strip(),
                "timestamp": now,
            }
            task.setdefault("comments", []).append(comment)
            task["updated_at"] = now
            project["updated_at"] = now

            # 记录评论历史
            update_record = self._build_update_record("comment", None, comment_text[:50])
            task.setdefault("update_history", []).append(update_record)

            self._persist()
            return deepcopy(task), deepcopy(update_record)

    def delete_comment(self, project_id: str, task_id: str, comment_id: str) -> Dict:
        """删除评论"""
        with self._lock:
            project_idx = self._find_project_index(project_id)
            project = self._data["projects"][project_idx]
            task_idx = self._find_task_index(project_id, task_id)
            task = project["tasks"][task_idx]

            comments = task.get("comments", [])
            task["comments"] = [c for c in comments if c.get("comment_id") != comment_id]
            task["updated_at"] = _utc_now()
            project["updated_at"] = _utc_now()
            self._persist()
            return deepcopy(task)

    def get_pending_overview(self) -> Dict[str, Any]:
        """获取待完成概览数据"""
        with self._lock:
            all_tasks = []
            for project in self._data["projects"]:
                for task in project.get("tasks", []):
                    task_with_project = deepcopy(task)
                    task_with_project["project_id"] = project["id"]
                    task_with_project["project_name"] = project["name"]
                    task_with_project["project_color"] = project.get("color", self.DEFAULT_COLOR)
                    all_tasks.append(task_with_project)

            # 过滤未完成的任务
            pending_tasks = [t for t in all_tasks if self._sanitize_progress(t.get("progress", 0)) < 100]

            # 计算今日截止和逾期
            today = datetime.utcnow().date()
            today_str = today.isoformat()

            overdue = []
            today_due = []
            upcoming = []
            undated = []

            for task in pending_tasks:
                due_date = task.get("due_date")
                if not due_date:
                    undated.append(task)
                    continue

                try:
                    due = datetime.strptime(due_date, "%Y-%m-%d").date()
                    if due < today:
                        overdue.append(task)
                    elif due == today:
                        today_due.append(task)
                    else:
                        upcoming.append(task)
                except ValueError:
                    undated.append(task)

            # 按剩余天数排序
            upcoming.sort(key=lambda t: t.get("due_date", ""))

            return {
                "overdue": overdue,
                "today_due": today_due,
                "upcoming": upcoming,
                "undated": undated,
                "total_pending": len(pending_tasks),
            }

    # ===== 兼容旧版ToDo API的方法 =====

    def list_todos(self) -> Dict[str, Any]:
        """兼容旧版：返回空的todos列表和projects字典"""
        with self._lock:
            return {
                "todos": [],
                "projects": {},
            }

    def get_timeline(self) -> List[Dict]:
        """兼容旧版：返回空的时间轴"""
        with self._lock:
            return []

    def get_projects(self) -> Dict[str, Any]:
        """兼容旧版：返回空的projects字典"""
        with self._lock:
            return {}

    def create_todo(self, payload: Dict) -> Tuple[Dict, Dict]:
        """兼容旧版：返回空数据，提示使用新版"""
        raise ValueError("旧版ToDo API已废弃，请使用新版界面 /todo/v2")

    def update_todo(self, todo_id: str, payload: Dict) -> Tuple[Dict, Optional[Dict]]:
        """兼容旧版：返回空数据，提示使用新版"""
        raise ValueError("旧版ToDo API已废弃，请使用新版界面 /todo/v2")

    def delete_todo(self, todo_id: str) -> Dict:
        """兼容旧版：返回空数据，提示使用新版"""
        raise ValueError("旧版ToDo API已废弃，请使用新版界面 /todo/v2")

    def get_todo(self, todo_id: str) -> Dict:
        """兼容旧版：返回空数据，提示使用新版"""
        raise ValueError("旧版ToDo API已废弃，请使用新版界面 /todo/v2")

    def add_comment_legacy(self, todo_id: str, comment_text: str) -> Tuple[Dict, Dict]:
        """兼容旧版：返回空数据，提示使用新版（已重命名避免方法冲突）"""
        raise ValueError("旧版ToDo API已废弃，请使用新版界面 /todo/v2")

    def delete_event(self, event_id: str) -> Dict:
        """兼容旧版：返回空数据，提示使用新版"""
        raise ValueError("旧版ToDo API已废弃，请使用新版界面 /todo/v2")


# 单例管理：为 routes.init_app 提供方便的实例化方式
todo_manager = TodoManager()
