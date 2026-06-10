# 这个脚本用于启动本地服务并自动登录后直达《士》游戏页面。
from __future__ import annotations

import configparser
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config.ini"


def load_settings() -> tuple[int, str]:
    parser = configparser.ConfigParser()
    parser.read(CONFIG_PATH, encoding="utf-8")
    port = int(parser.get("settings", "port", fallback="5000"))
    password = parser.get("settings", "password", fallback="passwo").strip()
    if len(password) != 6:
        raise RuntimeError(f"当前配置密码不是 6 位：{password!r}")
    return port, password


def port_is_open(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        return sock.connect_ex((host, port)) == 0


def url_ready(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=1.2) as response:
            body = response.read(200).decode("utf-8", errors="ignore")
            return response.status == 200 and ("password_length" in body or "登录" in body or "login" in body.lower())
    except urllib.error.HTTPError as error:
        try:
            body = error.read(200).decode("utf-8", errors="ignore")
        except Exception:
            body = ""
        return error.code == 200 or ("登录" in body or "login" in body.lower())
    except Exception:
        return False


def wait_for_login(url: str, timeout_s: float = 20.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if url_ready(url):
            return True
        time.sleep(0.35)
    return False


def build_auto_login_page(base_url: str, password: str) -> Path:
    html = f"""<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>启动《士》测试</title>
<body style="font-family:Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px">
<h2>正在登录并打开《士》...</h2>
<p>如果浏览器没有自动跳转，请稍后手动打开：<code>{base_url}/games?game=shi</code></p>
<iframe name="loginFrame" style="display:none"></iframe>
<form id="loginForm" method="post" action="{base_url}/login" target="loginFrame" style="display:none">
  <input type="hidden" name="password" value="{password}">
</form>
<script>
document.getElementById("loginForm").submit();
setTimeout(function () {{
  window.location.href = "{base_url}/games?game=shi";
}}, 1200);
</script>
</body>
</html>"""
    file_path = Path(tempfile.gettempdir()) / "shi_auto_login_test.html"
    file_path.write_text(html, encoding="utf-8")
    return file_path


def start_server() -> subprocess.Popen[str]:
    return subprocess.Popen(
        [sys.executable, "main.py", "run"],
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
    )


def main() -> int:
    port, password = load_settings()
    base_url = f"http://127.0.0.1:{port}"
    login_url = f"{base_url}/login"

    server_process: subprocess.Popen[str] | None = None
    if not url_ready(login_url):
        if port_is_open("127.0.0.1", port):
            raise RuntimeError(f"端口 {port} 已被占用，但当前响应不是本项目登录页。")
        server_process = start_server()
        if not wait_for_login(login_url):
            if server_process.poll() is not None:
                raise RuntimeError("测试服务启动失败，请检查依赖或端口配置。")
            raise RuntimeError("等待测试服务超时，未能打开登录页。")

    page_path = build_auto_login_page(base_url, password)
    webbrowser.open(page_path.as_uri())
    print("已打开自动登录页，目标地址：", f"{base_url}/games?game=shi")
    print("按 Ctrl+C 可结束本脚本。")

    try:
        while server_process and server_process.poll() is None:
            time.sleep(0.8)
    except KeyboardInterrupt:
        pass
    finally:
        if server_process and server_process.poll() is None:
            server_process.terminate()
            try:
                server_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                server_process.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
