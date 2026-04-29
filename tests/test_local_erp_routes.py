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

    def test_item_custom_properties_and_delete_endpoints(self):
        warehouse_id = self.client.get("/api/erp/warehouses").get_json()["warehouses"][0]["id"]
        create_response = self.client.post(
            "/api/erp/items",
            json={
                "item_code": "ITEM-DEL-1",
                "item_name": "待删除物料",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse_id,
                "custom_field_values": {"颜色": "黑色", "版本": "V1"},
            },
        )
        self.assertEqual(create_response.status_code, 201)
        created_item = create_response.get_json()["item"]
        self.assertEqual(created_item["custom_field_values"], {"颜色": "黑色", "版本": "V1"})

        update_response = self.client.put(
            f"/api/erp/items/{created_item['id']}",
            json={"custom_field_values": {"负责人": "李四"}},
        )
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.get_json()["item"]["custom_field_values"], {"负责人": "李四"})

        delete_response = self.client.delete(f"/api/erp/items/{created_item['id']}", json={})
        self.assertEqual(delete_response.status_code, 200)
        self.assertTrue(delete_response.get_json()["success"])

        missing_response = self.client.get(f"/api/erp/items/{created_item['id']}")
        self.assertEqual(missing_response.status_code, 400)

        referenced_item = self.client.post(
            "/api/erp/items",
            json={
                "item_code": "ITEM-DEL-2",
                "item_name": "已引用物料",
                "item_type": "raw_material",
                "default_warehouse_id": warehouse_id,
            },
        ).get_json()["item"]
        document = self.client.post(
            "/api/erp/inventory/documents",
            json={
                "doc_type": "purchase_in",
                "target_warehouse_id": warehouse_id,
                "items": [{"item_id": referenced_item["id"], "qty": 2, "batch_no": "ITEM-DEL-BATCH"}],
            },
        ).get_json()["document"]
        self.client.post(f"/api/erp/inventory/documents/{document['id']}/submit", json={})

        blocked_delete_response = self.client.delete(f"/api/erp/items/{referenced_item['id']}", json={})
        self.assertEqual(blocked_delete_response.status_code, 400)
        self.assertFalse(blocked_delete_response.get_json()["success"])

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

        number_field_response = self.client.post(
            "/api/erp/custom-fields/items",
            json={
                "field_name": "pcb_index",
                "field_label": "PCB编号",
                "field_type": "number",
                "default_value": "0",
            },
        )
        self.assertEqual(number_field_response.status_code, 201)
        self.assertTrue(number_field_response.get_json()["success"])

        item = self.client.post(
            "/api/erp/items",
            json={
                "item_code": "CF200",
                "item_name": "扩展字段物料",
                "custom_field_values": {"origin_area": "SZ", "pcb_index": "12"},
            },
        ).get_json()["item"]
        self.assertEqual(item["custom_field_values"]["origin_area"], "SZ")
        self.assertEqual(item["custom_field_values"]["pcb_index"], "12")

        field_list_response = self.client.get("/api/erp/custom-fields/items")
        self.assertEqual(field_list_response.status_code, 200)
        field_payload = field_list_response.get_json()
        self.assertTrue(field_payload["success"])
        self.assertGreaterEqual(len(field_payload["fields"]), 1)

        item_list_response = self.client.get("/api/erp/items?keyword=CF200")
        self.assertEqual(item_list_response.status_code, 200)
        listed_item = item_list_response.get_json()["items"][0]
        self.assertEqual(listed_item["custom_field_values"]["origin_area"], "SZ")
        self.assertEqual(listed_item["custom_field_values"]["pcb_index"], "12")

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

    def test_item_instance_endpoints(self):
        page_response = self.client.get("/erp/master-data/instances")
        self.assertEqual(page_response.status_code, 200)

        warehouse_payload = self.client.get("/api/erp/warehouses").get_json()
        main_warehouse_id = warehouse_payload["warehouses"][0]["id"]

        secondary_warehouse_response = self.client.post(
            "/api/erp/warehouses",
            json={
                "warehouse_code": "ROUTE-INS",
                "warehouse_name": "接口个体分仓",
                "warehouse_type": "production",
            },
        )
        self.assertEqual(secondary_warehouse_response.status_code, 201)
        secondary_warehouse_id = secondary_warehouse_response.get_json()["warehouse"]["id"]

        create_item_response = self.client.post(
            "/api/erp/items",
            json={
                "item_code": "INSAPI1",
                "item_name": "接口个体物料",
                "item_type": "raw_material",
                "default_warehouse_id": main_warehouse_id,
                "track_individuals": True,
                "individual_code_prefix": "INSAPI1",
                "initial_instance_count": 2,
                "initial_instance_location_code": "A-01",
            },
        )
        self.assertEqual(create_item_response.status_code, 201)
        created_item = create_item_response.get_json()["item"]
        self.assertEqual(created_item["track_individuals"], 1)
        self.assertEqual(created_item["instance_count"], 2)

        instances_response = self.client.get(f"/api/erp/item-instances?item_id={created_item['id']}")
        self.assertEqual(instances_response.status_code, 200)
        instances_payload = instances_response.get_json()
        self.assertTrue(instances_payload["success"])
        self.assertEqual(len(instances_payload["instances"]), 2)
        instance_id = instances_payload["instances"][0]["id"]

        bulk_create_response = self.client.post(
            "/api/erp/item-instances/bulk-create",
            json={
                "item_id": created_item["id"],
                "count": 1,
                "warehouse_id": main_warehouse_id,
                "location_code": "A-02",
                "remark": "补充一件",
            },
        )
        self.assertEqual(bulk_create_response.status_code, 201)
        self.assertEqual(bulk_create_response.get_json()["result"]["created_count"], 1)

        updated_instances_payload = self.client.get(f"/api/erp/item-instances?item_id={created_item['id']}").get_json()
        self.assertEqual(len(updated_instances_payload["instances"]), 3)

        update_instance_response = self.client.put(
            f"/api/erp/item-instances/{instance_id}",
            json={
                "serial_no": "API-SN-001",
                "owner_name": "接口测试工位",
                "location_code": "A-03",
                "attributes_json": "{\"version\":\"V1\"}",
                "remark": "接口更新",
            },
        )
        self.assertEqual(update_instance_response.status_code, 200)
        updated_instance = update_instance_response.get_json()["instance"]
        self.assertEqual(updated_instance["serial_no"], "API-SN-001")
        self.assertEqual(updated_instance["owner_name"], "接口测试工位")

        transfer_response = self.client.post(
            f"/api/erp/item-instances/{instance_id}/action",
            json={
                "action": "transfer",
                "target_warehouse_id": secondary_warehouse_id,
                "target_location_code": "B-01",
                "owner_name": "线边仓",
            },
        )
        self.assertEqual(transfer_response.status_code, 200)
        self.assertEqual(transfer_response.get_json()["instance"]["warehouse_id"], secondary_warehouse_id)

        checkout_response = self.client.post(
            f"/api/erp/item-instances/{instance_id}/action",
            json={
                "action": "checkout",
                "next_status": "in_use",
                "target_location_code": "产线一",
                "owner_name": "产线一",
            },
        )
        self.assertEqual(checkout_response.status_code, 200)
        self.assertEqual(checkout_response.get_json()["instance"]["status"], "in_use")

        checkin_response = self.client.post(
            f"/api/erp/item-instances/{instance_id}/action",
            json={
                "action": "checkin",
                "target_warehouse_id": main_warehouse_id,
                "target_location_code": "A-04",
                "owner_name": "主仓返库",
            },
        )
        self.assertEqual(checkin_response.status_code, 200)
        checked_in_instance = checkin_response.get_json()["instance"]
        self.assertEqual(checked_in_instance["status"], "in_stock")
        self.assertEqual(checked_in_instance["warehouse_id"], main_warehouse_id)

        logs_response = self.client.get(f"/api/erp/item-instances/logs?instance_id={instance_id}")
        self.assertEqual(logs_response.status_code, 200)
        logs_payload = logs_response.get_json()
        self.assertTrue(logs_payload["success"])
        self.assertGreaterEqual(len(logs_payload["logs"]), 4)


if __name__ == "__main__":
    unittest.main()
