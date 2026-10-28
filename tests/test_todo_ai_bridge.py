import os
import tempfile
import unittest

from yobboy_file_server import context_router
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

    def test_task_ref_expansion_fills_missing_project_id(self):
        project_a = self.manager.create_project({"name": "Project A"})
        project_b = self.manager.create_project({"name": "Project B"})
        self.manager.create_task(project_a["id"], {"summary": "A1"})
        for index in range(3):
            self.manager.create_task(project_b["id"], {"summary": f"B{index + 1}"})

        _, catalog = todo_ai_bridge.build_todo_mutate_snapshot_and_catalog(self.manager, "")
        expanded = todo_ai_bridge.expand_natural_todo_refs(
            [
                {
                    "op": "update_task",
                    "task_id": "项2·任3",
                    "priority": 1,
                    "progress": 100,
                    "description": "",
                }
            ],
            catalog,
        )
        preview, err = todo_ai_bridge.validate_and_describe_ops(self.manager, expanded)

        self.assertIsNone(err)
        self.assertEqual(expanded[0]["project_id"], project_b["id"])
        self.assertIn("更新任务", preview[0])

    def test_update_task_target_is_rechecked_from_user_message(self):
        wrong_project = self.manager.create_project({"name": "1405 项目"})
        self.manager.create_task(wrong_project["id"], {"summary": "无关任务 A"})
        self.manager.create_task(wrong_project["id"], {"summary": "无关任务 B"})
        target_project = self.manager.create_project({"name": "1521 项目"})
        target_task, _ = self.manager.create_task(target_project["id"], {"summary": "样机问题解决"})

        result = todo_ai_bridge.propose_todo_ops_json(
            self.manager,
            "1521项目的样机问题解决任务改为100%进度",
            lambda *_args, **_kwargs: (
                '{"ops":[{"op":"update_task","project_id":"项1","task_id":"项1·任2",'
                '"summary":null,"description":null,"priority":null,"due_date":null,'
                '"progress":100}],"summary":"更新进度"}'
            ),
        )

        self.assertTrue(result["ok"], result.get("error"))
        self.assertEqual(result["ops"][0]["project_id"], target_project["id"])
        self.assertEqual(result["ops"][0]["task_id"], target_task["id"])
        self.assertEqual(result["ops_display"][0]["project_id"], "项1")
        self.assertEqual(result["ops_display"][0]["task_id"], "项1·任1")
        self.assertEqual(result["ops"][0]["progress"], 100)
        self.assertNotIn("summary", result["ops"][0])
        self.assertNotIn("description", result["ops"][0])
        self.assertNotIn("priority", result["ops"][0])
        self.assertNotIn("due_date", result["ops"][0])
        self.assertIn("项目「1521 项目」", result["preview"][0])
        self.assertIn(target_task["summary"], result["preview"][0])

    def test_update_task_rejects_conflicting_project_when_target_unclear(self):
        wrong_project = self.manager.create_project({"name": "1405 项目"})
        wrong_task, _ = self.manager.create_task(wrong_project["id"], {"summary": "无关任务"})
        self.manager.create_project({"name": "1521 项目"})

        expanded = [
            {
                "op": "update_task",
                "project_id": wrong_project["id"],
                "task_id": wrong_task["id"],
                "progress": 100,
            }
        ]
        normalized, err = todo_ai_bridge.normalize_todo_ops_for_user_message(
            self.manager,
            "1521项目的样机问题解决任务改为100%进度",
            expanded,
        )

        self.assertIsNotNone(err)
        self.assertIn("用户指定「1521 项目」", err)
        self.assertEqual(normalized[0]["project_id"], wrong_project["id"])

    def test_todo_context_strategy_prefers_structured_data_for_lists(self):
        strategy = todo_ai_bridge.build_todo_context_strategy(
            "列出 ERP 项目下面还有哪些任务",
            mode="todo",
        )

        self.assertTrue(strategy["needs_todo"])
        self.assertEqual(strategy["primary_source"], "structured")
        self.assertFalse(strategy["use_semantic_kb"])

    def test_todo_context_strategy_uses_kb_only_for_long_text_search(self):
        strategy = todo_ai_bridge.build_todo_context_strategy(
            "搜索一下评论里提到返工原因的待办",
            mode="todo",
        )

        self.assertTrue(strategy["needs_todo"])
        self.assertEqual(strategy["primary_source"], "structured")
        self.assertTrue(strategy["use_semantic_kb"])

    def test_todo_context_strategy_does_not_use_kb_for_mutations(self):
        strategy = todo_ai_bridge.build_todo_context_strategy(
            "给 ERP 项目添加任务：整理日报说明",
            mode="todo",
        )

        self.assertEqual(strategy["intent"], "mutate")
        self.assertFalse(strategy["use_semantic_kb"])

    def test_short_project_code_with_todo_question_opens_task_list(self):
        project = self.manager.create_project({"name": "1521 客诉处理"})
        self.manager.create_task(project["id"], {"summary": "整理返工记录", "progress": 20})

        text, meta = todo_ai_bridge.build_adaptive_todo_context_and_meta(
            self.manager,
            "1521有什么待办",
        )

        self.assertIsNone(meta)
        self.assertIn("单项目任务", text)
        self.assertIn("1521 客诉处理", text)
        self.assertIn("整理返工记录", text)

    def test_context_router_plans_todo_kb_and_erp_sources(self):
        plan = context_router.build_context_plan(
            "根据文档和 ERP 库存，顺便看下项目任务",
            mode="knowledge",
            page_context={"source": "erp"},
            has_root_dir=True,
            has_todo_manager=True,
        )

        self.assertTrue(plan["needs_todo"])
        self.assertTrue(plan["needs_kb"])
        self.assertTrue(plan["needs_erp"])
        self.assertIn("kb_retrieve", plan["tools"])
        self.assertIn("erp_get_context", plan["tools"])


if __name__ == "__main__":
    unittest.main()
