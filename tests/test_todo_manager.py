import os
import tempfile
import unittest

from todo_manager import TodoManager


class TodoManagerTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.storage_path = os.path.join(self.tmpdir.name, "todos_v2.json")
        self.manager = TodoManager(storage_path=self.storage_path)

    def test_update_task_persists_weekly_plan(self):
        project = self.manager.create_project({"name": "Project A"})
        task, _ = self.manager.create_task(project["id"], {"summary": "Task A"})

        updated_task, update_records = self.manager.update_task(
            project["id"],
            task["id"],
            {"weekly_plan": "This week"},
        )

        self.assertEqual(updated_task["weekly_plan"], "This week")
        self.assertIn("weekly_plan", [record["field"] for record in update_records])

        reloaded = TodoManager(storage_path=self.storage_path)
        reloaded_project = reloaded.get_project(project["id"])
        self.assertEqual(reloaded_project["tasks"][0]["weekly_plan"], "This week")

    def test_project_archive_flag_roundtrip(self):
        project = self.manager.create_project({"name": "Project A", "archived": True})
        self.assertTrue(project["archived"])

        updated_project = self.manager.update_project(project["id"], {"archived": False})
        self.assertFalse(updated_project["archived"])

        reloaded = TodoManager(storage_path=self.storage_path)
        reloaded_project = reloaded.get_project(project["id"])
        self.assertFalse(reloaded_project["archived"])

    def test_pending_overview_excludes_archived_projects(self):
        active_project = self.manager.create_project({"name": "Active"})
        archived_project = self.manager.create_project({"name": "Archived", "archived": True})

        self.manager.create_task(
            active_project["id"],
            {"summary": "Visible Task", "progress": 10, "due_date": "2020-01-01"},
        )
        self.manager.create_task(
            archived_project["id"],
            {"summary": "Hidden Task", "progress": 10, "due_date": "2020-01-01"},
        )

        overview = self.manager.get_pending_overview()
        overdue_project_ids = {task["project_id"] for task in overview["overdue"]}

        self.assertEqual(overview["total_pending"], 1)
        self.assertEqual(overdue_project_ids, {active_project["id"]})


if __name__ == "__main__":
    unittest.main()
