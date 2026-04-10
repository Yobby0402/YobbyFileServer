"""
本地 MCP Bridge：让 Flask 后端作为 MCP Client 调用 mcp_server.py（stdio）。
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
import uuid
from typing import Any, Dict, Optional


class MCPBridgeError(Exception):
    pass


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


class LocalMCPBridge:
    def __init__(self):
        self._lock = threading.RLock()
        self._proc: Optional[subprocess.Popen] = None
        self._server_inproc: Optional[Any] = None
        self._msg_id = 1
        self._inited = False
        self._root_dir = ""
        self._todo_storage_path = ""
        self._server_cmd_sig = ""

    def _next_id(self) -> int:
        i = self._msg_id
        self._msg_id += 1
        return i

    def _write_message(self, obj: Dict[str, Any]) -> None:
        if not self._proc or not self._proc.stdin:
            raise MCPBridgeError("MCP 进程未启动")
        body = _json_dumps(obj).encode("utf-8")
        header = f"Content-Length: {len(body)}\r\nContent-Type: application/json\r\n\r\n".encode("utf-8")
        self._proc.stdin.write(header)
        self._proc.stdin.write(body)
        self._proc.stdin.flush()

    def _read_message(self, timeout_sec: float = 10.0) -> Dict[str, Any]:
        if not self._proc or not self._proc.stdout:
            raise MCPBridgeError("MCP 进程未启动")
        start = time.time()
        headers: Dict[str, str] = {}
        while True:
            if time.time() - start > timeout_sec:
                raise MCPBridgeError("读取 MCP 响应超时（header）")
            line = self._proc.stdout.readline()
            if not line:
                raise MCPBridgeError("MCP 进程已退出")
            if line in (b"\r\n", b"\n"):
                break
            s = line.decode("utf-8", errors="replace").strip()
            if ":" in s:
                k, v = s.split(":", 1)
                headers[k.strip().lower()] = v.strip()
        cl = headers.get("content-length")
        if not cl:
            raise MCPBridgeError("MCP 响应缺少 Content-Length")
        try:
            n = int(cl)
        except ValueError as e:
            raise MCPBridgeError(f"MCP Content-Length 非法: {cl}") from e
        payload = self._proc.stdout.read(n)
        if not payload:
            raise MCPBridgeError("MCP 响应体为空")
        try:
            return json.loads(payload.decode("utf-8", errors="replace"))
        except Exception as e:
            raise MCPBridgeError(f"MCP 响应 JSON 解析失败: {e}") from e

    def _rpc(self, method: str, params: Optional[Dict[str, Any]] = None, timeout_sec: float = 10.0) -> Dict[str, Any]:
        req_id = self._next_id()
        req: Dict[str, Any] = {"jsonrpc": "2.0", "id": req_id, "method": method}
        if params is not None:
            req["params"] = params
        self._write_message(req)
        while True:
            obj = self._read_message(timeout_sec=timeout_sec)
            if obj.get("id") == req_id:
                return obj

    def _resolve_server_command(self) -> tuple[list[str], str, str]:
        """
        解析 MCP 子进程启动命令。
        优先级：
        1) 环境变量 YFS_MCP_SERVER_EXE 指向的可执行文件
        2) 程序目录下的 mcp_server.exe（打包后推荐）
        3) 回退到 `python mcp_server.py`（开发环境）
        """
        base_dir = os.path.dirname(sys.executable) if getattr(sys, "frozen", False) else os.path.dirname(os.path.abspath(__file__))

        env_exe = (os.environ.get("YFS_MCP_SERVER_EXE") or "").strip()
        if env_exe and os.path.isfile(env_exe):
            exe = os.path.normpath(env_exe)
            return [exe], os.path.dirname(exe), f"exe:{exe}"

        bundled_exe = os.path.join(base_dir, "mcp_server.exe")
        if os.path.isfile(bundled_exe):
            exe = os.path.normpath(bundled_exe)
            return [exe], os.path.dirname(exe), f"exe:{exe}"

        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mcp_server.py")
        py = sys.executable
        return [py, script], os.path.dirname(script), f"py:{py}|{script}"

    def _use_inproc_server(self) -> bool:
        """
        是否使用进程内 MCP。
        默认开启（更适合单 EXE 部署）；设置 YFS_MCP_INPROC=0/false/off 可强制回退子进程模式。
        """
        raw = (os.environ.get("YFS_MCP_INPROC") or "").strip().lower()
        if raw in ("0", "false", "off", "no"):
            return False
        return True

    def _ensure_inproc_server(self, root_dir: str, todo_storage_path: str = "") -> None:
        need_restart = (
            self._server_inproc is None
            or self._root_dir != root_dir
            or self._todo_storage_path != (todo_storage_path or "")
            or self._server_cmd_sig != "inproc"
        )
        if not need_restart:
            return
        self._proc = None
        self._inited = False
        self._server_cmd_sig = "inproc"
        try:
            from mcp_server import YFSMCPServer
        except Exception as e:
            raise MCPBridgeError(f"加载内置 MCP 失败: {e}") from e
        self._server_inproc = YFSMCPServer(todo_storage_path, root_dir)
        self._root_dir = root_dir
        self._todo_storage_path = todo_storage_path or ""

    def _ensure_process(self, root_dir: str, todo_storage_path: str = "") -> None:
        base_cmd, cmd_cwd, cmd_sig = self._resolve_server_command()
        need_restart = (
            self._proc is None
            or self._proc.poll() is not None
            or self._root_dir != root_dir
            or self._todo_storage_path != (todo_storage_path or "")
            or self._server_cmd_sig != cmd_sig
        )
        if not need_restart:
            return
        self.close()
        cmd = list(base_cmd) + ["--root-dir", root_dir]
        if todo_storage_path:
            cmd.extend(["--todo-storage-path", todo_storage_path])
        self._proc = subprocess.Popen(
            cmd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            cwd=cmd_cwd,
        )
        self._inited = False
        self._root_dir = root_dir
        self._todo_storage_path = todo_storage_path or ""
        self._server_cmd_sig = cmd_sig

    def _ensure_initialized(self) -> None:
        if self._inited:
            return
        resp = self._rpc("initialize", {"protocolVersion": "2024-11-05", "clientInfo": {"name": "yfs-local-ai-bridge", "version": "0.1.0"}, "capabilities": {}}, timeout_sec=10.0)
        if resp.get("error"):
            raise MCPBridgeError(f"MCP initialize 失败: {resp.get('error')}")
        self._write_message({"jsonrpc": "2.0", "method": "notifications/initialized"})
        self._inited = True

    def call_tool(
        self,
        *,
        root_dir: str,
        tool_name: str,
        arguments: Optional[Dict[str, Any]] = None,
        todo_storage_path: str = "",
        timeout_sec: float = 12.0,
    ) -> Dict[str, Any]:
        with self._lock:
            if self._use_inproc_server():
                self._ensure_inproc_server(root_dir=root_dir, todo_storage_path=todo_storage_path)
                if not self._server_inproc:
                    raise MCPBridgeError("内置 MCP 未初始化")
                try:
                    return self._server_inproc.handle_tool_call(
                        str(tool_name or ""),
                        arguments or {},
                        uuid.uuid4().hex[:16],
                    )
                except Exception as e:
                    raise MCPBridgeError(f"内置 MCP 调用失败: {e}") from e

            self._ensure_process(root_dir=root_dir, todo_storage_path=todo_storage_path)
            self._ensure_initialized()
            try:
                resp = self._rpc("tools/call", {"name": tool_name, "arguments": arguments or {}}, timeout_sec=timeout_sec)
            except Exception:
                self.close()
                self._ensure_process(root_dir=root_dir, todo_storage_path=todo_storage_path)
                self._ensure_initialized()
                resp = self._rpc("tools/call", {"name": tool_name, "arguments": arguments or {}}, timeout_sec=timeout_sec)
            if resp.get("error"):
                raise MCPBridgeError(f"MCP tools/call 返回错误: {resp.get('error')}")
            result = resp.get("result") or {}
            structured = result.get("structuredContent")
            if isinstance(structured, dict):
                return structured
            content = result.get("content") or []
            if content and isinstance(content, list) and isinstance(content[0], dict):
                text = content[0].get("text")
                if isinstance(text, str) and text.strip():
                    try:
                        parsed = json.loads(text)
                        if isinstance(parsed, dict):
                            return parsed
                    except Exception:
                        pass
            raise MCPBridgeError("MCP 工具返回缺少 structuredContent")

    def close(self) -> None:
        with self._lock:
            p = self._proc
            self._proc = None
            self._server_inproc = None
            self._inited = False
            if not p:
                return
            try:
                p.terminate()
            except Exception:
                pass


_BRIDGE = LocalMCPBridge()


def get_bridge() -> LocalMCPBridge:
    return _BRIDGE

