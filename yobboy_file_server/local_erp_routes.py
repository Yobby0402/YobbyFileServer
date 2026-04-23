from __future__ import annotations

from flask import jsonify, redirect, render_template, request, session, url_for

from .local_erp_manager import LocalERPManager


def register_local_erp_routes(app, manager: LocalERPManager | None = None) -> None:
    erp_manager = manager or LocalERPManager()
    app.config["LOCAL_ERP_MANAGER"] = erp_manager

    def _require_login():
        if "logged_in" not in session:
            return redirect(url_for("login"))
        return None

    def _page(active_page: str):
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        return render_template("local_erp.html", active_page=active_page)

    @app.route("/erp")
    def erp_home():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        return redirect(url_for("erp_dashboard"))

    @app.route("/erp/dashboard")
    def erp_dashboard():
        return _page("dashboard")

    @app.route("/erp/master-data/items")
    def erp_items_page():
        return _page("items")

    @app.route("/erp/inventory/balances")
    def erp_inventory_page():
        return _page("inventory")

    @app.route("/erp/inventory/documents")
    def erp_documents_page():
        return _page("documents")

    @app.route("/erp/bom")
    def erp_bom_page():
        return _page("bom")

    @app.route("/erp/work-orders")
    def erp_work_orders_page():
        return _page("work_orders")

    @app.route("/erp/trace")
    def erp_trace_page():
        return _page("trace")

    @app.route("/erp/ai")
    def erp_ai_page():
        return _page("ai")

    @app.route("/api/erp/runtime")
    def erp_runtime():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        return jsonify({"success": True, "runtime": erp_manager.get_runtime_info()})

    @app.route("/api/erp/dashboard/summary")
    def erp_dashboard_summary():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        return jsonify({"success": True, "data": erp_manager.get_dashboard_summary()})

    @app.route("/api/erp/warehouses", methods=["GET", "POST"])
    def erp_warehouses():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        if request.method == "GET":
            return jsonify({"success": True, "warehouses": erp_manager.list_warehouses()})
        payload = request.get_json(silent=True) or {}
        try:
            warehouse = erp_manager.create_warehouse(payload)
            return jsonify({"success": True, "warehouse": warehouse}), 201
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/warehouses/<int:warehouse_id>", methods=["GET", "PUT"])
    def erp_warehouse_detail(warehouse_id: int):
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        try:
            if request.method == "GET":
                return jsonify({"success": True, "warehouse": erp_manager.get_warehouse(warehouse_id)})
            payload = request.get_json(silent=True) or {}
            warehouse = erp_manager.update_warehouse(warehouse_id, payload)
            return jsonify({"success": True, "warehouse": warehouse})
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/items", methods=["GET", "POST"])
    def erp_items():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        if request.method == "GET":
            return jsonify(
                {
                    "success": True,
                    "items": erp_manager.list_items(request.args.get("keyword", "")),
                }
            )

        payload = request.get_json(silent=True) or {}
        try:
            item = erp_manager.create_item(payload)
            return jsonify({"success": True, "item": item}), 201
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/items/<int:item_id>", methods=["GET", "PUT"])
    def erp_item_detail(item_id: int):
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        try:
            if request.method == "GET":
                return jsonify({"success": True, "item": erp_manager.get_item(item_id)})

            payload = request.get_json(silent=True) or {}
            item = erp_manager.update_item(item_id, payload)
            return jsonify({"success": True, "item": item})
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/custom-fields/<entity_name>", methods=["GET", "POST"])
    def erp_custom_fields(entity_name: str):
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        try:
            if request.method == "GET":
                return jsonify({"success": True, "fields": erp_manager.list_custom_fields(entity_name)})
            payload = request.get_json(silent=True) or {}
            field = erp_manager.upsert_custom_field(entity_name, payload)
            return jsonify({"success": True, "field": field}), 201
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/inventory/balances")
    def erp_inventory_balances():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        balances = erp_manager.list_inventory_balances(
            keyword=request.args.get("keyword", ""),
            warehouse_id=request.args.get("warehouse_id", type=int),
            only_warning=request.args.get("only_warning", "").lower() in {"1", "true", "yes"},
        )
        return jsonify({"success": True, "balances": balances})

    @app.route("/api/erp/inventory/ledger")
    def erp_inventory_ledger():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        return jsonify({"success": True, "ledger": erp_manager.list_inventory_ledger(limit=request.args.get("limit", 100, type=int))})

    @app.route("/api/erp/inventory/documents", methods=["GET", "POST"])
    def erp_inventory_documents():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        if request.method == "GET":
            return jsonify({"success": True, "documents": erp_manager.list_documents()})
        payload = request.get_json(silent=True) or {}
        try:
            document = erp_manager.create_stock_document(payload)
            return jsonify({"success": True, "document": document}), 201
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/inventory/documents/<int:doc_id>")
    def erp_inventory_document_detail(doc_id: int):
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        try:
            return jsonify({"success": True, "document": erp_manager.get_document(doc_id)})
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 404

    @app.route("/api/erp/inventory/documents/<int:doc_id>/submit", methods=["POST"])
    def erp_inventory_document_submit(doc_id: int):
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        try:
            document = erp_manager.submit_document(doc_id)
            return jsonify({"success": True, "document": document})
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/inventory/documents/<int:doc_id>/cancel", methods=["POST"])
    def erp_inventory_document_cancel(doc_id: int):
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        payload = request.get_json(silent=True) or {}
        try:
            document = erp_manager.cancel_document(doc_id, payload)
            return jsonify({"success": True, "document": document})
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/boms", methods=["GET", "POST"])
    def erp_boms():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        if request.method == "GET":
            parent_item_id = int(request.args.get("parent_item_id", "0") or "0")
            return jsonify({"success": True, "boms": erp_manager.list_boms(parent_item_id=parent_item_id)})
        payload = request.get_json(silent=True) or {}
        try:
            bom = erp_manager.create_bom(payload)
            return jsonify({"success": True, "bom": bom}), 201
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/boms/compare")
    def erp_bom_compare():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        try:
            left_bom_id = int(request.args.get("left_bom_id", "0"))
            right_bom_id = int(request.args.get("right_bom_id", "0"))
            result = erp_manager.compare_boms(left_bom_id, right_bom_id)
            return jsonify({"success": True, "comparison": result})
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/boms/<int:bom_id>", methods=["GET", "PUT"])
    def erp_bom_detail(bom_id: int):
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        try:
            if request.method == "GET":
                return jsonify({"success": True, "bom": erp_manager.get_bom(bom_id)})
            payload = request.get_json(silent=True) or {}
            return jsonify({"success": True, "bom": erp_manager.update_bom(bom_id, payload)})
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 404 if request.method == "GET" else 400

    @app.route("/api/erp/work-orders", methods=["GET", "POST"])
    def erp_work_orders():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        if request.method == "GET":
            return jsonify({"success": True, "work_orders": erp_manager.list_work_orders()})
        payload = request.get_json(silent=True) or {}
        try:
            work_order = erp_manager.create_work_order(payload)
            return jsonify({"success": True, "work_order": work_order}), 201
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/work-orders/<int:work_order_id>")
    def erp_work_order_detail(work_order_id: int):
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        try:
            return jsonify({"success": True, "work_order": erp_manager.get_work_order(work_order_id)})
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 404

    @app.route("/api/erp/work-orders/<int:work_order_id>/issue", methods=["POST"])
    def erp_work_order_issue(work_order_id: int):
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        payload = request.get_json(silent=True) or {}
        try:
            work_order = erp_manager.issue_work_order(work_order_id, payload)
            return jsonify({"success": True, "work_order": work_order})
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/work-orders/<int:work_order_id>/return", methods=["POST"])
    def erp_work_order_return(work_order_id: int):
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        payload = request.get_json(silent=True) or {}
        try:
            work_order = erp_manager.return_work_order(work_order_id, payload)
            return jsonify({"success": True, "work_order": work_order})
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/work-orders/<int:work_order_id>/complete", methods=["POST"])
    def erp_work_order_complete(work_order_id: int):
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        payload = request.get_json(silent=True) or {}
        try:
            work_order = erp_manager.complete_work_order(work_order_id, payload)
            return jsonify({"success": True, "work_order": work_order})
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400

    @app.route("/api/erp/trace/links")
    def erp_trace_links():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        links = erp_manager.list_trace_links(
            item_keyword=request.args.get("keyword", ""),
            batch_no=request.args.get("batch_no", ""),
            limit=request.args.get("limit", 100, type=int),
        )
        return jsonify({"success": True, "links": links})

    @app.route("/api/erp/ai/query", methods=["POST"])
    def erp_ai_query():
        login_redirect = _require_login()
        if login_redirect is not None:
            return login_redirect
        payload = request.get_json(silent=True) or {}
        try:
            result = erp_manager.ai_query(payload.get("query", ""))
            return jsonify({"success": True, "result": result})
        except ValueError as exc:
            return jsonify({"success": False, "error": str(exc)}), 400
