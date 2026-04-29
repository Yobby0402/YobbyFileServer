import os
import tempfile
import unittest
from unittest import mock

from yobboy_file_server.local_erp_manager import LocalERPManager


class LocalERPManagerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "erp.sqlite3")
        self.manager = LocalERPManager(db_path=self.db_path)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_create_item_and_purchase_in_document_updates_balance(self):
        warehouses = self.manager.list_warehouses()
        self.assertTrue(warehouses)

        item = self.manager.create_item(
            {
                "item_code": "ITEM001",
                "item_name": "测试物料",
                "item_type": "raw_material",
                "safety_stock": 10,
                "default_warehouse_id": warehouses[0]["id"],
            }
        )
        self.assertEqual(item["item_code"], "ITEM001")

        document = self.manager.create_stock_document(
            {
                "doc_type": "purchase_in",
                "target_warehouse_id": warehouses[0]["id"],
                "items": [
                    {
                        "item_id": item["id"],
                        "qty": 25,
                        "batch_no": "BATCH-001",
                    }
                ],
            }
        )
        self.assertEqual(document["status"], "draft")

        submitted = self.manager.submit_document(document["id"])
        self.assertEqual(submitted["status"], "submitted")

        balances = self.manager.list_inventory_balances(keyword="ITEM001")
        self.assertEqual(len(balances), 1)
        self.assertEqual(balances[0]["qty_on_hand"], 25.0)

        ledger = self.manager.list_inventory_ledger(limit=10)
        self.assertEqual(len(ledger), 1)
        self.assertEqual(ledger[0]["direction"], "in")

    def test_cancel_submitted_purchase_document_rolls_back_inventory(self):
        warehouse_id = self.manager.list_warehouses()[0]["id"]
        item = self.manager.create_item(
            {
                "item_code": "CANCEL001",
                "item_name": "待冲销物料",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse_id,
            }
        )
        document = self.manager.create_stock_document(
            {
                "doc_type": "purchase_in",
                "target_warehouse_id": warehouse_id,
                "items": [{"item_id": item["id"], "qty": 12, "batch_no": "C-LOT-1"}],
            }
        )
        self.manager.submit_document(document["id"])
        cancelled = self.manager.cancel_document(document["id"], {"remark": "测试冲销"})
        self.assertEqual(cancelled["status"], "cancelled")

        balances = self.manager.list_inventory_balances(keyword="CANCEL001")
        self.assertEqual(balances[0]["qty_on_hand"], 0.0)

        ledger = self.manager.list_inventory_ledger(limit=10)
        self.assertEqual(len(ledger), 2)
        self.assertEqual(ledger[0]["direction"], "out")

    def test_create_and_update_warehouse_and_item(self):
        warehouse = self.manager.create_warehouse(
            {
                "warehouse_code": "SUB01",
                "warehouse_name": "分仓一",
                "warehouse_type": "production",
                "remark": "测试分仓",
            }
        )
        self.assertEqual(warehouse["warehouse_code"], "SUB01")

        updated_warehouse = self.manager.update_warehouse(
            warehouse["id"],
            {
                "warehouse_name": "分仓一号",
                "warehouse_type": "returns",
                "is_enabled": False,
                "remark": "已停用",
            },
        )
        self.assertEqual(updated_warehouse["warehouse_name"], "分仓一号")
        self.assertEqual(updated_warehouse["warehouse_type"], "returns")
        self.assertEqual(updated_warehouse["is_enabled"], 0)

        item = self.manager.create_item(
            {
                "item_code": "EDIT001",
                "item_name": "待编辑物料",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse["id"],
            }
        )
        updated_item = self.manager.update_item(
            item["id"],
            {
                "item_code": "EDIT002",
                "item_name": "已编辑物料",
                "spec": "M8",
                "item_type": "semi_finished",
                "safety_stock": 12,
                "min_stock": 5,
                "default_warehouse_id": warehouse["id"],
                "is_enabled": False,
                "remark": "编辑成功",
            },
        )
        self.assertEqual(updated_item["item_code"], "EDIT002")
        self.assertEqual(updated_item["item_name"], "已编辑物料")
        self.assertEqual(updated_item["spec"], "M8")
        self.assertEqual(updated_item["item_type"], "semi_finished")
        self.assertEqual(updated_item["is_enabled"], 0)

    def test_custom_fields_and_warehouse_disable_guard(self):
        field = self.manager.upsert_custom_field(
            "items",
            {
                "field_name": "material_grade",
                "field_label": "材料等级",
                "field_type": "text",
                "default_value": "A",
            },
        )
        self.assertEqual(field["field_name"], "material_grade")

        warehouse = self.manager.create_warehouse(
            {
                "warehouse_code": "WH-DIS",
                "warehouse_name": "待停用仓库",
            }
        )
        item = self.manager.create_item(
            {
                "item_code": "CF001",
                "item_name": "带扩展字段物料",
                "default_warehouse_id": warehouse["id"],
                "custom_field_values": {"material_grade": "B"},
            }
        )
        self.assertEqual(item["custom_field_values"]["material_grade"], "B")
        listed_items = self.manager.list_items(keyword="CF001")
        self.assertEqual(listed_items[0]["custom_field_values"]["material_grade"], "B")

        with self.assertRaises(ValueError):
            self.manager.update_warehouse(warehouse["id"], {"is_enabled": False})

        self.manager.update_item(item["id"], {"is_enabled": False})
        disabled_warehouse = self.manager.update_warehouse(warehouse["id"], {"is_enabled": False})
        self.assertEqual(disabled_warehouse["is_enabled"], 0)

    def test_item_custom_properties_are_saved_per_item(self):
        warehouse_id = self.manager.list_warehouses()[0]["id"]
        item_a = self.manager.create_item(
            {
                "item_code": "ATTR001",
                "item_name": "独立属性物料A",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse_id,
                "custom_field_values": {"颜色": "红色", "版本": "V1"},
            }
        )
        item_b = self.manager.create_item(
            {
                "item_code": "ATTR002",
                "item_name": "独立属性物料B",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse_id,
                "custom_field_values": {"颜色": "蓝色"},
            }
        )

        self.assertEqual(item_a["custom_field_values"], {"颜色": "红色", "版本": "V1"})
        self.assertEqual(item_b["custom_field_values"], {"颜色": "蓝色"})

        updated_item_a = self.manager.update_item(
            item_a["id"],
            {
                "custom_field_values": {"版本": "V2", "负责人": "张三"},
            },
        )
        self.assertEqual(updated_item_a["custom_field_values"], {"版本": "V2", "负责人": "张三"})
        self.assertEqual(self.manager.get_item(item_b["id"])["custom_field_values"], {"颜色": "蓝色"})

    def test_delete_unused_item_and_reject_delete_when_referenced(self):
        warehouse_id = self.manager.list_warehouses()[0]["id"]
        deletable_item = self.manager.create_item(
            {
                "item_code": "DEL001",
                "item_name": "可删除物料",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse_id,
                "custom_field_values": {"备注属性": "待删除"},
            }
        )

        deleted_item = self.manager.delete_item(deletable_item["id"])
        self.assertEqual(deleted_item["item_code"], "DEL001")
        with self.assertRaises(ValueError):
            self.manager.get_item(deletable_item["id"])

        referenced_item = self.manager.create_item(
            {
                "item_code": "DEL002",
                "item_name": "不可删除物料",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse_id,
            }
        )
        purchase_doc = self.manager.create_stock_document(
            {
                "doc_type": "purchase_in",
                "target_warehouse_id": warehouse_id,
                "items": [{"item_id": referenced_item["id"], "qty": 3, "batch_no": "DEL-LOT-1"}],
            }
        )
        self.manager.submit_document(purchase_doc["id"])

        with self.assertRaises(ValueError):
            self.manager.delete_item(referenced_item["id"])

    def test_ai_query_returns_warning_summary(self):
        result = self.manager.ai_query("哪些物料低于安全库存")
        self.assertIn("低于安全库存", result["answer_text"])
        self.assertIn("warnings", result["structured_data"])

    def test_ai_query_returns_warehouse_names(self):
        self.manager.create_warehouse(
            {
                "warehouse_code": "SUB01",
                "warehouse_name": "分仓一",
                "warehouse_type": "normal",
            }
        )
        result = self.manager.ai_query("现在有什么仓库")
        self.assertIn("MAIN / 主仓库", result["answer_text"])
        self.assertIn("SUB01 / 分仓一", result["answer_text"])
        self.assertIn("warehouses", result["structured_data"])

    def test_build_ai_context_includes_focused_bom_and_work_order(self):
        warehouse_id = self.manager.list_warehouses()[0]["id"]
        raw_item = self.manager.create_item(
            {
                "item_code": "CTXRAW",
                "item_name": "上下文原料",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse_id,
            }
        )
        finished_item = self.manager.create_item(
            {
                "item_code": "CTXFG",
                "item_name": "上下文成品",
                "item_type": "finished_goods",
                "default_warehouse_id": warehouse_id,
            }
        )
        bom = self.manager.create_bom(
            {
                "parent_item_id": finished_item["id"],
                "version_no": "V1",
                "items": [{"component_item_id": raw_item["id"], "qty": 2}],
            }
        )
        work_order = self.manager.create_work_order(
            {
                "parent_item_id": finished_item["id"],
                "bom_id": bom["id"],
                "plan_qty": 3,
                "warehouse_id": warehouse_id,
            }
        )

        result = self.manager.build_ai_context(
            "解释这个工单和 BOM",
            {"active_page": "work_orders", "focused_bom_id": bom["id"], "focused_work_order_id": work_order["id"]},
        )

        self.assertIn("ERP 系统概览", result["text"])
        self.assertIn("当前聚焦 BOM", result["text"])
        self.assertIn("当前聚焦工单", result["text"])
        self.assertIn("work_order", result["structured_data"])

    def test_bom_work_order_issue_and_complete_flow(self):
        warehouse_id = self.manager.list_warehouses()[0]["id"]
        raw_item = self.manager.create_item(
            {
                "item_code": "RAW001",
                "item_name": "原料A",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse_id,
            }
        )
        finished_item = self.manager.create_item(
            {
                "item_code": "FG001",
                "item_name": "成品A",
                "item_type": "finished_goods",
                "default_warehouse_id": warehouse_id,
            }
        )

        purchase_doc = self.manager.create_stock_document(
            {
                "doc_type": "purchase_in",
                "target_warehouse_id": warehouse_id,
                "items": [{"item_id": raw_item["id"], "qty": 50, "batch_no": "RAW-BATCH-1"}],
            }
        )
        self.manager.submit_document(purchase_doc["id"])

        bom = self.manager.create_bom(
            {
                "parent_item_id": finished_item["id"],
                "version_no": "V1",
                "items": [{"component_item_id": raw_item["id"], "qty": 2}],
            }
        )
        work_order = self.manager.create_work_order(
            {
                "parent_item_id": finished_item["id"],
                "bom_id": bom["id"],
                "plan_qty": 5,
                "warehouse_id": warehouse_id,
            }
        )
        self.assertEqual(work_order["status"], "released")

        issued_work_order = self.manager.issue_work_order(work_order["id"])
        self.assertEqual(issued_work_order["status"], "in_progress")
        self.assertEqual(issued_work_order["materials"][0]["issued_qty"], 10.0)

        returned_work_order = self.manager.return_work_order(work_order["id"], {"items": [{"item_id": raw_item["id"], "qty": 2}]})
        self.assertEqual(returned_work_order["materials"][0]["returned_qty"], 2.0)
        self.assertEqual(returned_work_order["materials"][0]["consumed_qty"], 8.0)

        completed_work_order = self.manager.complete_work_order(work_order["id"], {"qty": 5, "batch_no": "FG-BATCH-1"})
        self.assertEqual(completed_work_order["status"], "completed")
        self.assertEqual(completed_work_order["finished_qty"], 5.0)

        balances = self.manager.list_inventory_balances()
        balance_map = {item["item_code"]: item["qty_on_hand"] for item in balances}
        self.assertEqual(balance_map["RAW001"], 42.0)
        self.assertEqual(balance_map["FG001"], 5.0)

        trace_links = self.manager.list_trace_links(item_keyword="RAW001")
        self.assertTrue(any(link["trace_type"] == "stock_to_issue" for link in trace_links))
        self.assertTrue(any(link["trace_type"] == "work_order_to_return" for link in trace_links))

    def test_update_and_compare_boms(self):
        warehouse_id = self.manager.list_warehouses()[0]["id"]
        raw_a = self.manager.create_item(
            {
                "item_code": "BOMRAW1",
                "item_name": "BOM原料1",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse_id,
            }
        )
        raw_b = self.manager.create_item(
            {
                "item_code": "BOMRAW2",
                "item_name": "BOM原料2",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse_id,
            }
        )
        finished = self.manager.create_item(
            {
                "item_code": "BOMFG1",
                "item_name": "BOM成品1",
                "item_type": "finished_goods",
                "default_warehouse_id": warehouse_id,
            }
        )

        bom_v1 = self.manager.create_bom(
            {
                "parent_item_id": finished["id"],
                "version_no": "V1",
                "bom_code": "BOM-BOMFG1-V1",
                "items": [{"component_item_id": raw_a["id"], "qty": 2}],
            }
        )
        bom_v2 = self.manager.create_bom(
            {
                "parent_item_id": finished["id"],
                "version_no": "V2",
                "bom_code": "BOM-BOMFG1-V2",
                "items": [{"component_item_id": raw_a["id"], "qty": 3}],
                "is_default_version": False,
            }
        )

        updated_v2 = self.manager.update_bom(
            bom_v2["id"],
            {
                "remark": "第二版",
                "items": [
                    {"component_item_id": raw_a["id"], "qty": 4, "remark": "增加用量"},
                    {"component_item_id": raw_b["id"], "qty": 1},
                ],
            },
        )
        self.assertEqual(updated_v2["remark"], "第二版")
        self.assertEqual(len(updated_v2["items"]), 2)

        comparison = self.manager.compare_boms(bom_v1["id"], bom_v2["id"])
        self.assertTrue(comparison["same_parent_item"])
        self.assertEqual(comparison["summary"]["added_count"], 1)
        self.assertEqual(comparison["summary"]["changed_count"], 1)
        self.assertEqual(comparison["summary"]["removed_count"], 0)

        filtered_boms = self.manager.list_boms(parent_item_id=finished["id"])
        self.assertEqual(len(filtered_boms), 2)

    def test_cancel_issue_document_rolls_back_work_order_materials(self):
        warehouse_id = self.manager.list_warehouses()[0]["id"]
        raw_item = self.manager.create_item(
            {
                "item_code": "ROLLRAW1",
                "item_name": "回滚原料",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse_id,
            }
        )
        finished_item = self.manager.create_item(
            {
                "item_code": "ROLLFG1",
                "item_name": "回滚成品",
                "item_type": "finished_goods",
                "default_warehouse_id": warehouse_id,
            }
        )
        purchase_doc = self.manager.create_stock_document(
            {
                "doc_type": "purchase_in",
                "target_warehouse_id": warehouse_id,
                "items": [{"item_id": raw_item["id"], "qty": 20, "batch_no": "ROLL-LOT-1"}],
            }
        )
        self.manager.submit_document(purchase_doc["id"])
        bom = self.manager.create_bom(
            {
                "parent_item_id": finished_item["id"],
                "version_no": "V1",
                "items": [{"component_item_id": raw_item["id"], "qty": 2}],
            }
        )
        work_order = self.manager.create_work_order(
            {
                "parent_item_id": finished_item["id"],
                "bom_id": bom["id"],
                "plan_qty": 3,
                "warehouse_id": warehouse_id,
            }
        )
        issued_work_order = self.manager.issue_work_order(work_order["id"])
        self.assertEqual(issued_work_order["materials"][0]["issued_qty"], 6.0)

        issue_document = self.manager.list_documents(limit=1)[0]
        cancelled_document = self.manager.cancel_document(issue_document["id"], {"remark": "撤销领料"})
        self.assertEqual(cancelled_document["status"], "cancelled")

        rolled_back_work_order = self.manager.get_work_order(work_order["id"])
        self.assertEqual(rolled_back_work_order["status"], "released")
        self.assertEqual(rolled_back_work_order["materials"][0]["issued_qty"], 0.0)
        self.assertEqual(rolled_back_work_order["materials"][0]["consumed_qty"], 0.0)

    def test_tracked_item_instances_follow_stock_and_logs(self):
        main_warehouse_id = self.manager.list_warehouses()[0]["id"]
        secondary_warehouse = self.manager.create_warehouse(
            {
                "warehouse_code": "INS-SUB",
                "warehouse_name": "个体测试分仓",
                "warehouse_type": "production",
            }
        )

        item = self.manager.create_item(
            {
                "item_code": "INST001",
                "item_name": "个体追踪物料",
                "item_type": "raw_material",
                "default_warehouse_id": main_warehouse_id,
                "track_individuals": True,
                "individual_code_prefix": "INST001",
                "initial_instance_count": 2,
                "initial_instance_location_code": "A-01",
            }
        )
        self.assertEqual(item["track_individuals"], 1)

        instances = self.manager.list_item_instances(item_id=item["id"])
        self.assertEqual(len(instances), 2)
        instance_codes = {entry["instance_code"] for entry in instances}
        self.assertEqual(instance_codes, {"INST001-0001", "INST001-0002"})

        balances = self.manager.list_inventory_balances(keyword="INST001")
        self.assertEqual(len(balances), 2)
        self.assertEqual({entry["batch_no"] for entry in balances}, instance_codes)
        self.assertTrue(all(entry["qty_on_hand"] == 1.0 for entry in balances))

        updated_instance = self.manager.update_item_instance(
            instances[0]["id"],
            {
                "serial_no": "SN-001",
                "owner_name": "测试工位",
                "location_code": "A-02",
                "attributes_json": {"firmware": "V1.0.0"},
                "remark": "初始化属性",
            },
        )
        self.assertEqual(updated_instance["serial_no"], "SN-001")
        self.assertEqual(updated_instance["owner_name"], "测试工位")
        self.assertIn("firmware", updated_instance["attributes_json"])

        transferred = self.manager.perform_item_instance_action(
            instances[0]["id"],
            {
                "action": "transfer",
                "target_warehouse_id": secondary_warehouse["id"],
                "target_location_code": "B-01",
                "owner_name": "线边仓",
                "remark": "转移到线边仓",
            },
        )
        self.assertEqual(transferred["instance"]["status"], "in_stock")
        self.assertEqual(transferred["instance"]["warehouse_id"], secondary_warehouse["id"])
        self.assertEqual(transferred["instance"]["location_code"], "B-01")

        checked_out = self.manager.perform_item_instance_action(
            instances[0]["id"],
            {
                "action": "checkout",
                "next_status": "in_use",
                "target_location_code": "产线一",
                "owner_name": "产线一",
                "remark": "发往产线",
            },
        )
        self.assertEqual(checked_out["instance"]["status"], "in_use")
        self.assertIsNone(checked_out["instance"]["warehouse_id"])

        checked_in = self.manager.perform_item_instance_action(
            instances[0]["id"],
            {
                "action": "checkin",
                "target_warehouse_id": main_warehouse_id,
                "target_location_code": "A-03",
                "owner_name": "主仓返库",
                "remark": "返库",
            },
        )
        self.assertEqual(checked_in["instance"]["status"], "in_stock")
        self.assertEqual(checked_in["instance"]["warehouse_id"], main_warehouse_id)
        self.assertEqual(checked_in["instance"]["location_code"], "A-03")

        action_logs = self.manager.list_item_instance_logs(instance_id=instances[0]["id"], limit=10)
        self.assertTrue(any(log["action_type"] == "create" for log in action_logs))
        self.assertTrue(any(log["action_type"] == "update" for log in action_logs))
        self.assertTrue(any(log["action_type"] == "transfer" for log in action_logs))
        self.assertTrue(any(log["action_type"] == "checkout" for log in action_logs))
        self.assertTrue(any(log["action_type"] == "checkin" for log in action_logs))

        with self.assertRaises(ValueError):
            self.manager.update_item(item["id"], {"track_individuals": False})

    def test_schema_path_falls_back_to_exe_side_package_copy(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            package_dir_path = os.path.join(temp_dir, "_MEI_missing")
            project_dir_path = os.path.join(temp_dir, "dist")
            schema_dir = os.path.join(project_dir_path, "yobboy_file_server", "sql")
            os.makedirs(schema_dir, exist_ok=True)
            schema_path = os.path.join(schema_dir, "local_erp_schema.sql")
            with open(schema_path, "w", encoding="utf-8") as handle:
                handle.write(
                    """
                    CREATE TABLE IF NOT EXISTS units (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        unit_code TEXT UNIQUE,
                        unit_name TEXT,
                        precision_digits INTEGER DEFAULT 2,
                        remark TEXT DEFAULT ''
                    );
                    CREATE TABLE IF NOT EXISTS item_categories (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        category_code TEXT UNIQUE,
                        category_name TEXT,
                        sort_order INTEGER DEFAULT 0,
                        is_enabled INTEGER DEFAULT 1,
                        remark TEXT DEFAULT ''
                    );
                    CREATE TABLE IF NOT EXISTS warehouses (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        warehouse_code TEXT UNIQUE,
                        warehouse_name TEXT,
                        warehouse_type TEXT DEFAULT 'normal',
                        is_enabled INTEGER DEFAULT 1,
                        remark TEXT DEFAULT '',
                        created_at TEXT DEFAULT '',
                        updated_at TEXT DEFAULT ''
                    );
                    CREATE TABLE IF NOT EXISTS settings (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        setting_key TEXT UNIQUE,
                        setting_value TEXT DEFAULT '',
                        updated_at TEXT DEFAULT ''
                    );
                    """
                )

            db_path = os.path.join(temp_dir, "erp.sqlite3")
            with mock.patch("yobboy_file_server.local_erp_manager.package_dir", return_value=package_dir_path), mock.patch(
                "yobboy_file_server.local_erp_manager.project_base_dir", return_value=project_dir_path
            ):
                manager = LocalERPManager(db_path=db_path)

            self.assertEqual(os.path.normpath(manager._schema_path), os.path.normpath(schema_path))
            self.assertTrue(os.path.exists(db_path))


if __name__ == "__main__":
    unittest.main()
