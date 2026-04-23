import os
import tempfile

from yobboy_file_server.mcp_server import YFSMCPServer


def test_mcp_server_exposes_erp_context_tool():
    with tempfile.TemporaryDirectory() as tmpdir:
        todo_path = os.path.join(tmpdir, "todos_v2.json")
        erp_db_path = os.path.join(tmpdir, "erp.sqlite3")
        server = YFSMCPServer(todo_path, tmpdir, erp_db_path=erp_db_path)

        payload = server.handle_tool_call(
            "erp_get_context",
            {
                "query_text": "当前有哪些仓库",
                "page_context": {"source": "erp", "active_page": "inventory"},
            },
            "trace-test",
        )

        assert payload["ok"] is True
        assert "text" in payload["data"]
        assert "structured_data" in payload["data"]
