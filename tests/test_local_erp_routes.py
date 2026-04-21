import os
import tempfile
import unittest

from flask import Flask

from yobboy_file_server.local_erp_manager import LocalERPManager
from yobboy_file_server.local_erp_routes import register_local_erp_routes


class LocalERPRoutesTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = os.path.join(self.temp_dir.name, "erp.sqlite3")
        self.manager = LocalERPManager(db_path=self.db_path)
        self.app = Flask(__name__, template_folder=os.path.join(os.getcwd(), "templates"))
        self.app.secret_key = "test-secret"
        self.app.add_url_rule("/login", "login", lambda: "login")
        register_local_erp_routes(self.app, manager=self.manager)
        self.client = self.app.test_client()

        with self.client.session_transaction() as session:
            session["logged_in"] = True

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_items_document_and_ai_endpoints(self):
        item_response = self.client.post(
            "/api/erp/items",
            json={
                "item_code": "ITEM100",
                "item_name": "接口测试物料",
                "item_type": "raw_material",
                "safety_stock": 5,
            },
        )
        self.assertEqual(item_response.status_code, 201)
        item_payload = item_response.get_json()
        self.assertTrue(item_payload["success"])
        item_id = item_payload["item"]["id"]

        warehouses = self.client.get("/api/erp/warehouses").get_json()["warehouses"]
        self.assertTrue(warehouses)
        warehouse_id = warehouses[0]["id"]

        doc_response = self.client.post(
            "/api/erp/inventory/documents",
            json={
                "doc_type": "purchase_in",
                "target_warehouse_id": warehouse_id,
                "items": [{"item_id": item_id, "qty": 8, "batch_no": "LOT-01"}],
            },
        )
        self.assertEqual(doc_response.status_code, 201)
        doc_id = doc_response.get_json()["document"]["id"]

        submit_response = self.client.post(f"/api/erp/inventory/documents/{doc_id}/submit", json={})
        self.assertEqual(submit_response.status_code, 200)
        self.assertTrue(submit_response.get_json()["success"])

        balances_response = self.client.get("/api/erp/inventory/balances")
        balances_payload = balances_response.get_json()
        self.assertTrue(balances_payload["success"])
        self.assertEqual(len(balances_payload["balances"]), 1)

        ai_response = self.client.post("/api/erp/ai/query", json={"query": "查询物料 ITEM100 当前库存"})
        self.assertEqual(ai_response.status_code, 200)
        ai_payload = ai_response.get_json()
        self.assertTrue(ai_payload["success"])
        self.assertIn("ITEM100", ai_payload["result"]["answer_text"])

        cancel_response = self.client.post(f"/api/erp/inventory/documents/{doc_id}/cancel", json={"remark": "接口冲销"})
        self.assertEqual(cancel_response.status_code, 200)
        cancel_payload = cancel_response.get_json()
        self.assertTrue(cancel_payload["success"])
        self.assertEqual(cancel_payload["document"]["status"], "cancelled")

    def test_warehouse_and_item_update_endpoints(self):
        warehouse_response = self.client.post(
            "/api/erp/warehouses",
            json={
                "warehouse_code": "WH200",
                "warehouse_name": "测试仓库200",
                "warehouse_type": "production",
            },
        )
        self.assertEqual(warehouse_response.status_code, 201)
        warehouse = warehouse_response.get_json()["warehouse"]

        warehouse_update_response = self.client.put(
            f"/api/erp/warehouses/{warehouse['id']}",
            json={
                "warehouse_name": "测试仓库200-修改",
                "warehouse_type": "returns",
                "is_enabled": False,
            },
        )
        self.assertEqual(warehouse_update_response.status_code, 200)
        self.assertEqual(warehouse_update_response.get_json()["warehouse"]["warehouse_type"], "returns")

        item = self.client.post(
            "/api/erp/items",
            json={
                "item_code": "UPD001",
                "item_name": "待修改物料",
                "item_type": "raw_material",
            },
        ).get_json()["item"]

        item_update_response = self.client.put(
            f"/api/erp/items/{item['id']}",
            json={
                "item_code": "UPD002",
                "item_name": "已修改物料",
                "spec": "10x10",
                "item_type": "finished_goods",
                "safety_stock": 6,
                "is_enabled": False,
                "default_warehouse_id": warehouse["id"],
            },
        )
        self.assertEqual(item_update_response.status_code, 200)
        item_payload = item_update_response.get_json()["item"]
        self.assertEqual(item_payload["item_code"], "UPD002")
        self.assertEqual(item_payload["item_name"], "已修改物料")
        self.assertEqual(item_payload["item_type"], "finished_goods")

    def test_custom_field_endpoints(self):
        field_response = self.client.post(
            "/api/erp/custom-fields/items",
            json={
                "field_name": "origin_area",
                "field_label": "产地",
                "field_type": "text",
                "default_value": "CN",
            },
        )
        self.assertEqual(field_response.status_code, 201)
        self.assertTrue(field_response.get_json()["success"])

        item = self.client.post(
            "/api/erp/items",
            json={
                "item_code": "CF200",
                "item_name": "扩展字段物料",
                "custom_field_values": {"origin_area": "SZ"},
            },
        ).get_json()["item"]
        self.assertEqual(item["custom_field_values"]["origin_area"], "SZ")

        field_list_response = self.client.get("/api/erp/custom-fields/items")
        self.assertEqual(field_list_response.status_code, 200)
        field_payload = field_list_response.get_json()
        self.assertTrue(field_payload["success"])
        self.assertGreaterEqual(len(field_payload["fields"]), 1)

    def test_bom_and_work_order_endpoints(self):
        warehouse_id = self.client.get("/api/erp/warehouses").get_json()["warehouses"][0]["id"]

        raw_item = self.client.post(
            "/api/erp/items",
            json={"item_code": "RAW200", "item_name": "原料200", "item_type": "raw_material"},
        ).get_json()["item"]
        finished_item = self.client.post(
            "/api/erp/items",
            json={"item_code": "FG200", "item_name": "成品200", "item_type": "finished_goods"},
        ).get_json()["item"]

        purchase = self.client.post(
            "/api/erp/inventory/documents",
            json={
                "doc_type": "purchase_in",
                "target_warehouse_id": warehouse_id,
                "items": [{"item_id": raw_item["id"], "qty": 30, "batch_no": "B-200"}],
            },
        ).get_json()["document"]
        self.client.post(f"/api/erp/inventory/documents/{purchase['id']}/submit", json={})

        bom_response = self.client.post(
            "/api/erp/boms",
            json={
                "parent_item_id": finished_item["id"],
                "version_no": "V1",
                "items": [{"component_item_id": raw_item["id"], "qty": 3}],
            },
        )
        self.assertEqual(bom_response.status_code, 201)
        bom = bom_response.get_json()["bom"]

        work_order_response = self.client.post(
            "/api/erp/work-orders",
            json={
                "parent_item_id": finished_item["id"],
                "bom_id": bom["id"],
                "plan_qty": 4,
                "warehouse_id": warehouse_id,
            },
        )
        self.assertEqual(work_order_response.status_code, 201)
        work_order = work_order_response.get_json()["work_order"]

        issue_response = self.client.post(f"/api/erp/work-orders/{work_order['id']}/issue", json={})
        self.assertEqual(issue_response.status_code, 200)
        self.assertTrue(issue_response.get_json()["success"])

        return_response = self.client.post(
            f"/api/erp/work-orders/{work_order['id']}/return",
            json={"items": [{"item_id": raw_item["id"], "qty": 2}]},
        )
        self.assertEqual(return_response.status_code, 200)
        self.assertTrue(return_response.get_json()["success"])

        complete_response = self.client.post(
            f"/api/erp/work-orders/{work_order['id']}/complete",
            json={"qty": 4, "batch_no": "FG-200"},
        )
        self.assertEqual(complete_response.status_code, 200)
        complete_payload = complete_response.get_json()
        self.assertTrue(complete_payload["success"])
        self.assertEqual(complete_payload["work_order"]["status"], "completed")

        trace_response = self.client.get("/api/erp/trace/links?keyword=RAW200")
        self.assertEqual(trace_response.status_code, 200)
        trace_payload = trace_response.get_json()
        self.assertTrue(trace_payload["success"])
        self.assertGreaterEqual(len(trace_payload["links"]), 1)

    def test_bom_update_and_compare_endpoints(self):
        raw_a = self.client.post(
            "/api/erp/items",
            json={"item_code": "RAWCMP1", "item_name": "比较原料1", "item_type": "raw_material"},
        ).get_json()["item"]
        raw_b = self.client.post(
            "/api/erp/items",
            json={"item_code": "RAWCMP2", "item_name": "比较原料2", "item_type": "raw_material"},
        ).get_json()["item"]
        finished_item = self.client.post(
            "/api/erp/items",
            json={"item_code": "FGCMP1", "item_name": "比较成品", "item_type": "finished_goods"},
        ).get_json()["item"]

        bom_v1 = self.client.post(
            "/api/erp/boms",
            json={
                "parent_item_id": finished_item["id"],
                "version_no": "V1",
                "bom_code": "BOM-FGCMP1-V1",
                "items": [{"component_item_id": raw_a["id"], "qty": 2}],
            },
        ).get_json()["bom"]
        bom_v2 = self.client.post(
            "/api/erp/boms",
            json={
                "parent_item_id": finished_item["id"],
                "version_no": "V2",
                "bom_code": "BOM-FGCMP1-V2",
                "items": [{"component_item_id": raw_a["id"], "qty": 3}],
                "is_default_version": False,
            },
        ).get_json()["bom"]

        update_response = self.client.put(
            f"/api/erp/boms/{bom_v2['id']}",
            json={
                "remark": "已更新",
                "items": [
                    {"component_item_id": raw_a["id"], "qty": 4},
                    {"component_item_id": raw_b["id"], "qty": 1},
                ],
            },
        )
        self.assertEqual(update_response.status_code, 200)
        update_payload = update_response.get_json()
        self.assertTrue(update_payload["success"])
        self.assertEqual(update_payload["bom"]["remark"], "已更新")
        self.assertEqual(len(update_payload["bom"]["items"]), 2)

        compare_response = self.client.get(
            f"/api/erp/boms/compare?left_bom_id={bom_v1['id']}&right_bom_id={bom_v2['id']}"
        )
        self.assertEqual(compare_response.status_code, 200)
        compare_payload = compare_response.get_json()
        self.assertTrue(compare_payload["success"])
        self.assertEqual(compare_payload["comparison"]["summary"]["added_count"], 1)
        self.assertEqual(compare_payload["comparison"]["summary"]["changed_count"], 1)

        filtered_list_response = self.client.get(f"/api/erp/boms?parent_item_id={finished_item['id']}")
        self.assertEqual(filtered_list_response.status_code, 200)
        filtered_payload = filtered_list_response.get_json()
        self.assertTrue(filtered_payload["success"])
        self.assertEqual(len(filtered_payload["boms"]), 2)


if __name__ == "__main__":
    unittest.main()
