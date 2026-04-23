import os
import tempfile
import unittest

from yobboy_file_server import todo_ai_bridge
from yobboy_file_server.todo_manager import TodoManager


class TodoAIBridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.storage_path = os.path.join(self.tmpdir.name, "todos_v2.json")
        self.manager = TodoManager(storage_path=self.storage_path)

    def test_mutate_catalog_keeps_refs_for_hidden_tasks(self):
        project = self.manager.create_project({"name": "Project A"})
        total_tasks = todo_ai_bridge._MAX_MUTATE_TASKS_PER_PROJECT + 5
        for index in range(total_tasks):
            self.manager.create_task(project["id"], {"summary": f"Task {index + 1}"})

        project_snapshot = self.manager.list_all()["projects"][0]
        ordered_tasks = todo_ai_bridge._tasks_for_project_snapshot_list(
            project_snapshot, "", for_mutate=True
        )
        hidden_task = ordered_tasks[todo_ai_bridge._MAX_MUTATE_TASKS_PER_PROJECT]

        _, catalog = todo_ai_bridge.build_todo_mutate_snapshot_and_catalog(self.manager, "")
        display_ops = todo_ai_bridge.display_todo_ops_with_refs(
            [
                {
                    "op": "update_task",
                    "project_id": project["id"],
                    "task_id": hidden_task["id"],
                }
            ],
            catalog,
        )

        self.assertEqual(display_ops[0]["project_id"], "项1")
        self.assertEqual(
            display_ops[0]["task_id"],
            f"项1·任{todo_ai_bridge._MAX_MUTATE_TASKS_PER_PROJECT + 1}",
        )

    def test_mutate_catalog_keeps_refs_for_hidden_comments(self):
        project = self.manager.create_project({"name": "Project A"})
        task, _ = self.manager.create_task(project["id"], {"summary": "Task A"})
        for index in range(15):
            self.manager.add_comment(project["id"], task["id"], f"Comment {index + 1}")

        hidden_comment_id = self.manager.get_project(project["id"])["tasks"][0]["comments"][12][
            "comment_id"
        ]

        _, catalog = todo_ai_bridge.build_todo_mutate_snapshot_and_catalog(self.manager, "")
        display_ops = todo_ai_bridge.display_todo_ops_with_refs(
            [
                {
                    "op": "delete_comment",
                    "project_id": project["id"],
                    "task_id": task["id"],
                    "comment_id": hidden_comment_id,
                }
            ],
            catalog,
        )

        self.assertEqual(display_ops[0]["project_id"], "项1")
        self.assertEqual(display_ops[0]["task_id"], "项1·任1")
        self.assertEqual(display_ops[0]["comment_id"], "项1·任1·评13")


if __name__ == "__main__":
    unittest.main()
