"""
本地 AI HTTP API：状态、加载/卸载、SSE 对话、知识库、Todo 预览/应用。
"""
from __future__ import annotations

import configparser
import copy
import hashlib
import json
import os
import time
import uuid
from typing import Any, Dict, Generator, List, Optional

from flask import Response, current_app, jsonify, request, session, stream_with_context

import drawio_text_dsl
import knowledge_store
import local_ai_engine
import local_mcp_bridge
import local_ai_skills
import todo_ai_bridge

# Draw.io 模式：不拼接通用 Skill；可选 drawio-ai-local.{md,txt}（节选思路参考 next-ai-draw-io，Apache-2.0）。
DRAWIO_SYSTEM = """你是 draw.io（diagrams.net）图表生成助手。

**输出（必须遵守）**
1. 只输出一段完整、可被 draw.io 打开的 XML，根元素为 <mxfile>...</mxfile>（可有 <?xml version="1.0" encoding="UTF-8"?> 声明）。
2. 尽量不要在 XML 外输出解释、Markdown 或 ``` 围栏。**尽量不要在 XML 内写 <!-- 注释 -->**（减少与工具链差异）。
3. 若用户消息中含「当前图表」的 XML，你必须输出**整份**修改后的 mxfile，不得只输出变化片段或省略未改节点。
4. 新建图骨架：<mxfile><diagram id="p1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>，再向 root 追加 mxCell；每个 diagram 内必须有且仅有一个 mxGraphModel/root。
5. **XML 必须可被解析**：标签闭合；**属性 value/style 等中凡出现 & 必须写成 &amp;**（含「A & B」、URL 参数等），否则报 xmlparseentityref；<、>、" 用 &lt; &gt; &quot;；**每个 mxCell 的 id 全局唯一**。
6. **同一标签上禁止重复同一属性名**（例如两个 edge= 或重复 vertex、parent），否则报 Attribute … redefined。
7. **mxCell 不得嵌套 mxCell**：只能并列在 <root> 下；子节点仅限 <mxGeometry> 等，不要把整块 <mxCell> 套进另一 <mxCell> 内。
8. 顶层形状 parent="1"；连线 edge="1" 且 **source、target 必须为已存在的 cell id**。
9. **布局**：尽量单屏可读，坐标大致在 x=0–800、y=0–600，从 (40,40) 起排；元素间距充足，减少线穿块。更细规则见下文 Skill「drawio-ai-local」。
10. **附图**：若用户消息中含图片，请结合图意生成或还原为 draw.io 图（仍只输出完整 mxfile）；草图/截图中的文字与连线尽量对应到形状与 edge。

**元素提示**：矩形 <mxCell id="2" value="标题" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="120" height="60" as="geometry"/></mxCell>；连线需有效 source/target。"""

DRAWIO_TEXT_DSL_SYSTEM = """你是 **yobboy-flow** 图表文本生成助手（类 Mermaid，但支持坐标，便于导入 draw.io 后可编辑）。

**输出（必须遵守）**
1. **只输出一个** Markdown 代码围栏：首行 ```yobboy-flow ，末行 ```；围栏内为纯文本，**禁止**输出 `<mxfile>`、XML、或围栏外的解释文字。
2. 首行可写 `kind: yobboy-flow-v1`（可选）；`#` 开头为注释。
3. **节点**：`node <id> <标签或引号标签> [形状] [@ x y width height]`
   - `id`：字母数字、`_`、`-`、`.`；**全局唯一**。
   - 形状（可选）：`rect` | `rounded` | `diamond` | `ellipse` | `circle` | `parallelogram`（默认 `rect`）。
   - `@` 后四个数字为像素坐标与宽高；省略则由系统自动网格排版。
4. **连线**：`edge <from> -> <to> ["线上标签"]`；或 Mermaid 简写一行 `<from> -> <to> [标签]`（未事先 `node` 声明的端点会自动生成默认节点）。
5. 若用户消息中含「当前图表」XML，请通读后输出 **整图** 的 yobboy-flow 文本（反映修改后完整结构），勿输出 XML。
6. **附图**：若有图片，尽量还原为 node/edge；坐标可估算，单图节点建议 ≤ 16 个以利弱模型稳定。

**正例**
```yobboy-flow
kind: yobboy-flow-v1
# 登录流程
node A "开始" rounded @ 40 40 100 50
node B "校验" rect @ 220 40 120 60
edge A -> B
B -> C
node C "结束" diamond @ 400 40 100 60
edge B -> C "成功"
```

**反例（禁止）**
- 输出 `<mxfile>...</mxfile>`
- 围栏语言写成 ```xml 或混入 HTML

**与 Mermaid 关系**：不要输出 ```mermaid；本格式由本地解析器转为可编辑 draw.io，**带 @ 的布局不会被 Mermaid 覆盖**。"""

_DRAWIO_XML_ATTACH_CAP = 120000


def _message_plain_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for p in content:
            if isinstance(p, dict) and str(p.get("type")) == "text":
                parts.append(str(p.get("text") or ""))
        return "\n".join(parts).strip()
    return str(content or "")


def _last_user_plain_text(messages: List[Dict[str, Any]]) -> str:
    for m in reversed(messages):
        if m.get("role") == "user":
            return _message_plain_text(m.get("content"))
    return ""


def _append_drawio_context_to_last_user(
    msgs: List[Dict[str, Any]], raw_xml: str, truncated_note: str, *, text_dsl: bool
) -> None:
    if not (raw_xml or "").strip():
        return
    if text_dsl:
        suffix = (
            "\n\n---\n[当前图表 draw.io XML，仅供参考；请通读后输出 **完整** 修改结果的 **yobboy-flow** 文本（```yobboy-flow 围栏），**禁止** 输出 <mxfile> XML。]\n"
            + truncated_note
            + "\n\n"
            + raw_xml
        )
    else:
        suffix = (
            "\n\n---\n[当前 draw.io 图表 XML；若用户要求修改，请输出**完整** <mxfile>…</mxfile>]\n"
            + truncated_note
            + "\n\n"
            + raw_xml
        )
    for idx in range(len(msgs) - 1, -1, -1):
        if msgs[idx].get("role") != "user":
            continue
        c = msgs[idx].get("content")
        if isinstance(c, list):
            appended = False
            for part in reversed(c):
                if isinstance(part, dict) and str(part.get("type")) == "text":
                    part["text"] = (part.get("text") or "") + suffix
                    appended = True
                    break
            if not appended:
                c.append({"type": "text", "text": suffix.lstrip()})
        else:
            base = c if isinstance(c, str) else str(c or "")
            msgs[idx]["content"] = base + suffix
        break


def _drawio_progress_payload(
    attempt: int,
    phase: str,
    received_chars: int = 0,
    *,
    message: str = "",
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "attempt": int(attempt),
        "phase": str(phase or ""),
        "received_chars": int(received_chars or 0),
    }
    if message:
        payload["message"] = str(message)
    if details:
        payload["details"] = details
    return payload


def _auth_ok() -> bool:
    return "logged_in" in session


def _use_mcp_bridge() -> bool:
    return bool(current_app.config.get("LOCAL_AI_USE_MCP_BRIDGE", True))


def _mcp_caller_id() -> str:
    cookie_name = current_app.config.get("SESSION_COOKIE_NAME", "session")
    raw = request.cookies.get(cookie_name, "") or ""
    if not raw:
        return "web-anon"
    digest = hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest()[:16]
    return f"web-{digest}"


def _mcp_call(tool_name: str, arguments: Dict[str, Any], timeout_sec: float = 12.0) -> Optional[Dict[str, Any]]:
    payload, _meta = _mcp_call_with_meta(tool_name, arguments, timeout_sec=timeout_sec)
    return payload


def _mcp_call_with_meta(
    tool_name: str, arguments: Dict[str, Any], timeout_sec: float = 12.0
) -> tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    started = time.perf_counter()
    meta = {
        "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "tool": tool_name,
        "ok": False,
        "elapsed_ms": 0,
        "trace_id": "",
        "message": "",
    }
    if not _use_mcp_bridge():
        meta["message"] = "MCP bridge disabled"
        return None, meta
    root_dir = current_app.config.get("ROOT_DIR") or ""
    tm = current_app.config.get("TODO_MANAGER")
    todo_storage_path = ""
    if tm is not None:
        todo_storage_path = str(getattr(tm, "storage_path", "") or "")
    try:
        payload = local_mcp_bridge.get_bridge().call_tool(
            root_dir=str(root_dir),
            todo_storage_path=todo_storage_path,
            tool_name=tool_name,
            arguments=arguments or {},
            timeout_sec=timeout_sec,
        )
        meta["ok"] = bool(payload and payload.get("ok"))
        meta["trace_id"] = str((payload or {}).get("trace_id") or "")
        if payload and not payload.get("ok"):
            meta["message"] = str(((payload.get("error") or {}).get("message") or "tool error"))
        return payload, meta
    except Exception as e:
        current_app.logger.warning("[local-ai] MCP call failed: %s(%s) -> %s", tool_name, arguments, e)
        meta["message"] = str(e)
        return None, meta
    finally:
        meta["elapsed_ms"] = int((time.perf_counter() - started) * 1000)


def _refresh_todo_manager_from_disk() -> None:
    """
    MCP 侧写入后，同步刷新当前 Flask 进程里的 TODO_MANAGER 缓存。
    否则会出现“已应用成功，但页面列表仍是旧数据”的现象。
    """
    tm = current_app.config.get("TODO_MANAGER")
    if not tm:
        return
    try:
        lock = getattr(tm, "_lock", None)
        if lock:
            with lock:
                tm._load()  # noqa: SLF001 - 项目内受控调用，用于强制刷新缓存
        else:
            tm._load()  # noqa: SLF001
    except Exception as e:
        current_app.logger.warning("[local-ai] refresh TODO_MANAGER failed: %s", e)


def _persist_local_ai_ini(app) -> None:
    """将 LOCAL_AI_* 写入配置文件 [local_ai] 段，并保留其它段。"""
    path = app.config.get("CONFIG_FILE")
    if not path or not os.path.exists(path):
        return
    cfg = configparser.ConfigParser()
    if os.path.exists(path):
        cfg.read(path, encoding="utf-8")
    if not cfg.has_section("local_ai"):
        cfg.add_section("local_ai")
    from local_ai_paths import project_base_dir

    def _rel_for_ini(abs_path: str) -> str:
        if not abs_path:
            return ""
        base = project_base_dir()
        try:
            rel = os.path.relpath(abs_path, base)
            if not rel.startswith(".."):
                return rel.replace("\\", "/")
        except ValueError:
            pass
        return os.path.normpath(abs_path).replace("\\", "/")

    cfg.set("local_ai", "model_dir", _rel_for_ini(str(app.config.get("LOCAL_AI_MODEL_DIR", "") or "")))
    cfg.set("local_ai", "api_base_url", str(app.config.get("LOCAL_AI_API_BASE_URL", "") or ""))
    cfg.set("local_ai", "api_model", str(app.config.get("LOCAL_AI_API_MODEL", "") or ""))
    cfg.set("local_ai", "gguf_path", str(app.config.get("LOCAL_AI_GGUF_PATH", "") or ""))
    cfg.set("local_ai", "skills_dir", _rel_for_ini(str(app.config.get("LOCAL_AI_SKILLS_DIR", "") or "")))
    cfg.set("local_ai", "models_dir", _rel_for_ini(str(app.config.get("LOCAL_AI_MODELS_DIR", "") or "")))
    cfg.set("local_ai", "hf_home", _rel_for_ini(str(app.config.get("LOCAL_AI_HF_HOME", "") or "")))
    cfg.set("local_ai", "append_skills", str(bool(app.config.get("LOCAL_AI_APPEND_SKILLS", True))).lower())
    cfg.set("local_ai", "llama_ctx", str(int(app.config.get("LOCAL_AI_LLAMA_CTX", 4096) or 4096)))
    _pcap = app.config.get("LOCAL_AI_PROMPT_CONTEXT_CAP", 4096)
    cfg.set("local_ai", "prompt_context_cap", str(int(4096 if _pcap is None else _pcap)))
    cfg.set("local_ai", "llama_gpu_layers", str(int(app.config.get("LOCAL_AI_LLAMA_GPU_LAYERS", -1) or -1)))
    cfg.set("local_ai", "use_mcp_bridge", str(bool(app.config.get("LOCAL_AI_USE_MCP_BRIDGE", True))).lower())
    cfg.set(
        "local_ai",
        "drawio_max_new_tokens",
        str(int(app.config.get("LOCAL_AI_DRAWIO_MAX_NEW_TOKENS", 8192) or 8192)),
    )
    cfg.set(
        "local_ai",
        "drawio_output",
        str(app.config.get("LOCAL_AI_DRAWIO_OUTPUT", "text_dsl") or "text_dsl"),
    )
    with open(path, "w", encoding="utf-8") as f:
        cfg.write(f)


def _app_ai_config() -> Dict[str, Any]:
    c = current_app.config
    return {
        "LOCAL_AI_API_BASE_URL": c.get("LOCAL_AI_API_BASE_URL", ""),
        "LOCAL_AI_API_MODEL": c.get("LOCAL_AI_API_MODEL", ""),
        "LOCAL_AI_MODEL_DIR": c.get("LOCAL_AI_MODEL_DIR", ""),
        "LOCAL_AI_GGUF_PATH": c.get("LOCAL_AI_GGUF_PATH", ""),
        "LOCAL_AI_MAX_NEW_TOKENS": c.get("LOCAL_AI_MAX_NEW_TOKENS", 512),
        "LOCAL_AI_TEMPERATURE": c.get("LOCAL_AI_TEMPERATURE", 0.7),
        "LOCAL_AI_TOP_P": c.get("LOCAL_AI_TOP_P", 0.95),
        "LOCAL_AI_LLAMA_CTX": c.get("LOCAL_AI_LLAMA_CTX", 4096),
        "LOCAL_AI_PROMPT_CONTEXT_CAP": c.get("LOCAL_AI_PROMPT_CONTEXT_CAP", 4096),
        "LOCAL_AI_LLAMA_GPU_LAYERS": c.get("LOCAL_AI_LLAMA_GPU_LAYERS", -1),
        "LOCAL_AI_SKILLS_DIR": c.get("LOCAL_AI_SKILLS_DIR", ""),
        "LOCAL_AI_APPEND_SKILLS": c.get("LOCAL_AI_APPEND_SKILLS", True),
        "LOCAL_AI_MODELS_DIR": c.get("LOCAL_AI_MODELS_DIR", ""),
        "LOCAL_AI_HF_HOME": c.get("LOCAL_AI_HF_HOME", ""),
        "LOCAL_AI_DRAWIO_MAX_NEW_TOKENS": c.get("LOCAL_AI_DRAWIO_MAX_NEW_TOKENS", 8192),
        "LOCAL_AI_DRAWIO_OUTPUT": c.get("LOCAL_AI_DRAWIO_OUTPUT", "text_dsl"),
    }


def _sse(event: str, obj: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(obj, ensure_ascii=False)}\n\n"


def register_local_ai_routes(app) -> None:
    # 多模态 JSON（base64 图）体积大，放宽单次请求上限（未配置时）
    app.config.setdefault("MAX_CONTENT_LENGTH", 32 * 1024 * 1024)
    app.config.setdefault("LOCAL_AI_USE_MCP_BRIDGE", True)

    @app.route("/api/local-ai/status", methods=["GET"])
    def local_ai_status():
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        c = current_app.config
        cfg = _app_ai_config()
        st = local_ai_engine.get_status(cfg)
        skills_dir = c.get("LOCAL_AI_SKILLS_DIR", "") or ""
        models_dir = c.get("LOCAL_AI_MODELS_DIR", "") or ""
        _do = str(c.get("LOCAL_AI_DRAWIO_OUTPUT", "text_dsl") or "text_dsl").strip().lower()
        if _do not in ("text_dsl", "xml"):
            _do = "text_dsl"
        return jsonify(
            {
                "success": True,
                **st,
                "use_mcp_bridge": bool(c.get("LOCAL_AI_USE_MCP_BRIDGE", True)),
                "skills_dir": skills_dir,
                "models_dir": models_dir,
                "hf_home": c.get("LOCAL_AI_HF_HOME", "") or "",
                "append_skills": bool(c.get("LOCAL_AI_APPEND_SKILLS", True)),
                "skill_files": local_ai_skills.list_skill_files(skills_dir),
                "drawio_output": _do,
            }
        )

    @app.route("/api/local-ai/load", methods=["POST"])
    def local_ai_load():
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        r = local_ai_engine.load(_app_ai_config())
        return jsonify({"success": r.get("success"), **r})

    @app.route("/api/local-ai/unload", methods=["POST"])
    def local_ai_unload():
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        return jsonify({"success": True, "message": "LM Studio 模式无需卸载，关闭 LM Studio 或切换模型即可。"})

    @app.route("/api/local-ai/chat/stream", methods=["POST"])
    def local_ai_chat_stream():
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        body = request.get_json(silent=True) or {}
        mode = (body.get("mode") or "general").strip().lower()
        if mode not in ("general", "knowledge", "todo", "drawio"):
            mode = "general"
        messages: List[Dict[str, Any]] = body.get("messages") or []
        if not messages:
            return jsonify({"success": False, "error": "messages 不能为空"}), 400
        last_user = _last_user_plain_text(messages)

        cfg = _app_ai_config()
        tm = current_app.config.get("TODO_MANAGER")
        root_dir = current_app.config.get("ROOT_DIR") or ""
        skills_block = ""
        if mode != "drawio" and cfg.get("LOCAL_AI_APPEND_SKILLS", True):
            _ctx_eff = int(local_ai_engine._effective_lm_context_tokens(cfg))
            _skill_cap = min(12000, max(4096, _ctx_eff * 2))
            skills_block = local_ai_skills.load_skills_text(
                cfg.get("LOCAL_AI_SKILLS_DIR") or "",
                max_total_chars=_skill_cap,
            )

        def generate() -> Generator[str, None, None]:
            drawio_out_meta = "text_dsl"
            if mode == "drawio":
                drawio_out_meta = str(
                    current_app.config.get("LOCAL_AI_DRAWIO_OUTPUT", "text_dsl") or "text_dsl"
                ).strip().lower()
                if drawio_out_meta not in ("text_dsl", "xml"):
                    drawio_out_meta = "text_dsl"
                yield _sse("meta", {"mode": mode, "drawio_output": drawio_out_meta})
            else:
                yield _sse("meta", {"mode": mode})

            if mode == "drawio":
                if not local_ai_engine.get_status(cfg)["loaded"]:
                    yield _sse(
                        "error",
                        {"message": "请先确认 LM Studio 已开启并已加载模型（网页可访问 /api/local-ai/status）。"},
                    )
                    yield _sse("done", {})
                    return
                raw_xml = (body.get("current_xml") or "").strip()
                truncated_note = ""
                if len(raw_xml) > _DRAWIO_XML_ATTACH_CAP:
                    raw_xml = raw_xml[:_DRAWIO_XML_ATTACH_CAP]
                    truncated_note = (
                        f"\n（当前图表 XML 已截断至前 {_DRAWIO_XML_ATTACH_CAP} 字符；图很大时请分步修改。）"
                    )
                msgs_work = copy.deepcopy(messages)
                text_dsl = drawio_out_meta == "text_dsl"
                _append_drawio_context_to_last_user(
                    msgs_work, raw_xml, truncated_note, text_dsl=text_dsl
                )
                yield _sse(
                    "drawio_progress",
                    _drawio_progress_payload(
                        1,
                        "preparing",
                        0,
                        message="正在准备上下文、技能规则与输出格式",
                        details={"output": drawio_out_meta, "has_current_xml": bool(raw_xml)},
                    ),
                )
                try:
                    drawio_max = int(cfg.get("LOCAL_AI_DRAWIO_MAX_NEW_TOKENS", 8192) or 8192)
                except (TypeError, ValueError):
                    drawio_max = 8192
                drawio_max = max(512, min(drawio_max, 65536))
                drawio_skill = local_ai_skills.load_drawio_local_skill(
                    cfg.get("LOCAL_AI_SKILLS_DIR") or "",
                    max_chars=14000,
                )
                system: str = DRAWIO_TEXT_DSL_SYSTEM if text_dsl else DRAWIO_SYSTEM
                if drawio_skill:
                    system = system + "\n\n---\n\n" + drawio_skill
                max_attempts = 3
                msgs_loop = copy.deepcopy(msgs_work)
                retry_base_msgs: List[Dict[str, Any]] = []
                if msgs_work and isinstance(msgs_work[-1], dict) and msgs_work[-1].get("role") == "user":
                    retry_base_msgs = [copy.deepcopy(msgs_work[-1])]
                final_out = ""
                final_valid = False
                final_issues: List[Dict[str, Any]] = []
                final_display_meta: Dict[str, Any] = {
                    "output": drawio_out_meta,
                    "family": "unknown",
                    "direction": "unknown",
                    "routing": "unknown",
                }
                for attempt in range(1, max_attempts + 1):
                    try:
                        raw_out = ""
                        last_emit = 0
                        yield _sse(
                            "drawio_progress",
                            _drawio_progress_payload(
                                attempt,
                                "generating",
                                0,
                                message="正在调用模型生成图表文本",
                                details={"output": drawio_out_meta},
                            ),
                        )
                        for piece in local_ai_engine.stream_generate(
                            cfg, msgs_loop, system=system, max_new_tokens=drawio_max
                        ):
                            raw_out += piece
                            # drawio 反馈循环下不直接透传 token，避免前端显示未校验中间稿；
                            # 但实时回传接收长度，让用户看到“正在生成”而非 0 字符。
                            now = len(raw_out)
                            if now - last_emit >= 240:
                                yield _sse(
                                    "drawio_progress",
                                    _drawio_progress_payload(
                                        attempt,
                                        "generating",
                                        now,
                                        message="模型正在生成图表内容",
                                    ),
                                )
                                last_emit = now
                        yield _sse(
                            "drawio_progress",
                            _drawio_progress_payload(
                                attempt,
                                "generated",
                                len(raw_out),
                                message="模型输出完成，准备进入解析与校验",
                            ),
                        )
                    except Exception as e:
                        raw_out = f"[生成失败] {e}"
                    model_raw = raw_out or ""
                    final_out = model_raw
                    if text_dsl:
                        yield _sse(
                            "drawio_progress",
                            _drawio_progress_payload(
                                attempt,
                                "parsing",
                                len(model_raw),
                                message="正在解析 yobboy-flow 并推断图表布局信息",
                            ),
                        )
                        try:
                            final_display_meta = {
                                "output": drawio_out_meta,
                                **drawio_text_dsl.analyze_model_reply(model_raw),
                            }
                            yield _sse("drawio_generation_meta", final_display_meta)
                            final_out = drawio_text_dsl.convert_model_reply_to_mxfile(model_raw)
                        except drawio_text_dsl.DrawioTextDslError as e:
                            final_issues = [{"code": "TEXT_DSL_ERROR", "message": str(e)}]
                            if attempt >= max_attempts:
                                yield _sse(
                                    "error",
                                    {
                                        "message": "yobboy-flow 解析失败，请重试或检查模型输出格式。",
                                        "details": {"issues": final_issues},
                                    },
                                )
                                yield _sse("done", {})
                                return
                            retry_user_msg = (
                                "你上一次输出的 yobboy-flow 无法解析。请按语法修正，只输出 ```yobboy-flow 围栏内文本，"
                                "**不要**输出 <mxfile> XML 或 ```xml。\n\n解析错误：\n"
                                + str(e)
                                + "\n\n上一次输出：\n"
                                + model_raw[:8000]
                            )
                            prev_clip = model_raw[:8000]
                            msgs_loop = (
                                copy.deepcopy(retry_base_msgs)
                                + [{"role": "assistant", "content": prev_clip}]
                                + [{"role": "user", "content": retry_user_msg}]
                            )
                            yield _sse(
                                "drawio_retry",
                                {"attempt": attempt + 1, "reason": "text_dsl_parse_failed"},
                            )
                            yield _sse(
                                "drawio_progress",
                                _drawio_progress_payload(
                                    attempt + 1,
                                    "retrying",
                                    len(model_raw),
                                    message="解析失败，正在准备带错误反馈的自动重试",
                                ),
                            )
                            continue
                    else:
                        final_display_meta = {
                            "output": drawio_out_meta,
                            "family": "unknown",
                            "direction": "unknown",
                            "routing": "mxfile_direct",
                        }
                        yield _sse("drawio_generation_meta", final_display_meta)

                    yield _sse(
                        "drawio_progress",
                        _drawio_progress_payload(
                            attempt,
                            "validating",
                            len(final_out),
                            message="正在校验 draw.io XML 结构与布局",
                        ),
                    )
                    mcp_val, mcp_meta = _mcp_call_with_meta(
                        "drawio_validate_xml",
                        {"xml": final_out},
                        timeout_sec=12.0,
                    )
                    yield _sse("mcp_call", mcp_meta)
                    val_data = (mcp_val.get("data") if (mcp_val and mcp_val.get("ok")) else {}) or {}
                    yield _sse("drawio_validation", val_data)
                    if val_data.get("valid"):
                        final_valid = True
                        break
                    final_issues = list(val_data.get("issues") or [])

                    mcp_repair, mcp_meta_r = _mcp_call_with_meta(
                        "drawio_repair_xml",
                        {"xml": final_out},
                        timeout_sec=12.0,
                    )
                    yield _sse("mcp_call", mcp_meta_r)
                    yield _sse(
                        "drawio_progress",
                        _drawio_progress_payload(
                            attempt,
                            "repairing",
                            len(final_out),
                            message="校验未通过，正在尝试自动修复 XML",
                        ),
                    )
                    rep_data = (mcp_repair.get("data") if (mcp_repair and mcp_repair.get("ok")) else {}) or {}
                    if rep_data.get("repaired_xml"):
                        repaired_xml = str(rep_data.get("repaired_xml") or "")
                        yield _sse(
                            "drawio_progress",
                            _drawio_progress_payload(
                                attempt,
                                "validating",
                                len(repaired_xml),
                                message="修复完成，正在复检 XML",
                            ),
                        )
                        mcp_val2, mcp_meta2 = _mcp_call_with_meta(
                            "drawio_validate_xml",
                            {"xml": repaired_xml},
                            timeout_sec=12.0,
                        )
                        yield _sse("mcp_call", mcp_meta2)
                        val2_data = (mcp_val2.get("data") if (mcp_val2 and mcp_val2.get("ok")) else {}) or {}
                        yield _sse("drawio_validation", val2_data)
                        if val2_data.get("valid"):
                            final_out = repaired_xml
                            final_valid = True
                            break
                        final_issues = list(val2_data.get("issues") or final_issues)

                    if attempt >= max_attempts:
                        break
                    issues = list(final_issues or val_data.get("issues") or [])[:8]
                    issue_lines = []
                    for one in issues:
                        if not isinstance(one, dict):
                            continue
                        issue_lines.append(
                            f"- {one.get('code') or 'ISSUE'}: {one.get('message') or ''}"
                        )
                    if not issue_lines:
                        issue_lines.append("- VALIDATION_ERROR: 未通过校验")
                    if text_dsl:
                        retry_user_msg = (
                            "由 yobboy-flow 转换得到的 draw.io 图未通过校验。请调整节点 id、连线端点、布局或简化图形后重新输出。"
                            "\n要求：只输出 ```yobboy-flow 围栏，不要输出 XML。"
                            "\n\n校验问题：\n"
                            + "\n".join(issue_lines)
                            + "\n\n上一次 yobboy-flow 原文：\n"
                            + model_raw[:8000]
                        )
                        prev_clip = model_raw[:8000]
                    else:
                        retry_user_msg = (
                            "你上一次输出的 draw.io XML 未通过校验，请根据以下错误修复并重新输出。"
                            "\n要求：只输出完整 <mxfile>...</mxfile>，不要任何解释文本。"
                            "\n\n校验问题：\n"
                            + "\n".join(issue_lines)
                            + "\n\n上一次输出：\n"
                            + final_out[:8000]
                        )
                        prev_clip = final_out[:8000]
                    msgs_loop = (
                        copy.deepcopy(retry_base_msgs)
                        + [{"role": "assistant", "content": prev_clip}]
                        + [{"role": "user", "content": retry_user_msg}]
                    )
                    yield _sse("drawio_retry", {"attempt": attempt + 1, "reason": "validation_failed"})
                    yield _sse(
                        "drawio_progress",
                        _drawio_progress_payload(
                            attempt + 1,
                            "retrying",
                            len(final_out),
                            message="校验失败，正在根据错误信息重新生成",
                        ),
                    )

                if not final_valid:
                    issue_codes = []
                    for it in final_issues[:12]:
                        if isinstance(it, dict):
                            issue_codes.append(str(it.get("code") or "ISSUE"))
                    yield _sse(
                        "error",
                        {
                            "message": "生成结果未通过 draw.io 校验，请重试。"
                            + (f" 主要问题: {', '.join(issue_codes)}" if issue_codes else ""),
                            "details": {"issues": final_issues[:12]},
                        },
                    )
                    yield _sse("done", {})
                    return

                # 最终收口：统一走一次 repair + validate，确保后续 summarize/apply 使用的是稳定可解析版本。
                mcp_repair_final, mcp_meta_rf = _mcp_call_with_meta(
                    "drawio_repair_xml",
                    {"xml": final_out},
                    timeout_sec=12.0,
                )
                yield _sse("mcp_call", mcp_meta_rf)
                yield _sse(
                    "drawio_progress",
                    _drawio_progress_payload(
                        max_attempts,
                        "finalizing",
                        len(final_out),
                        message="正在做最终修复与收口校验",
                    ),
                )
                if mcp_repair_final and mcp_repair_final.get("ok"):
                    rf_data = mcp_repair_final.get("data") or {}
                    if rf_data.get("repaired_xml"):
                        final_out = str(rf_data.get("repaired_xml") or final_out)

                mcp_val_final, mcp_meta_vf = _mcp_call_with_meta(
                    "drawio_validate_xml",
                    {"xml": final_out},
                    timeout_sec=12.0,
                )
                yield _sse("mcp_call", mcp_meta_vf)
                vf_data = (mcp_val_final.get("data") if (mcp_val_final and mcp_val_final.get("ok")) else {}) or {}
                yield _sse("drawio_validation", vf_data)
                if not vf_data.get("valid"):
                    final_issues = list(vf_data.get("issues") or final_issues)
                    issue_codes = []
                    for it in final_issues[:12]:
                        if isinstance(it, dict):
                            issue_codes.append(str(it.get("code") or "ISSUE"))
                    yield _sse(
                        "error",
                        {
                            "message": "最终收口校验失败。"
                            + (f" 主要问题: {', '.join(issue_codes)}" if issue_codes else ""),
                            "details": {"issues": final_issues[:12]},
                        },
                    )
                    yield _sse("done", {})
                    return

                for i in range(0, len(final_out), 800):
                    yield _sse("token", {"t": final_out[i : i + 800]})

                yield _sse(
                    "drawio_progress",
                    _drawio_progress_payload(
                        max_attempts,
                        "summarizing",
                        len(final_out),
                        message="正在汇总图表统计与变化信息",
                    ),
                )
                mcp_sum, mcp_meta2 = _mcp_call_with_meta(
                    "drawio_summarize_xml",
                    {"xml": final_out},
                    timeout_sec=12.0,
                )
                yield _sse("mcp_call", mcp_meta2)
                if mcp_sum and mcp_sum.get("ok"):
                    yield _sse("drawio_summary", mcp_sum.get("data") or {})
                if raw_xml:
                    yield _sse(
                        "drawio_progress",
                        _drawio_progress_payload(
                            max_attempts,
                            "diffing",
                            len(final_out),
                            message="正在比较当前图与原图的变化",
                        ),
                    )
                    mcp_diff, mcp_meta3 = _mcp_call_with_meta(
                        "drawio_diff_summary",
                        {"old_xml": raw_xml, "new_xml": final_out},
                        timeout_sec=12.0,
                    )
                    yield _sse("mcp_call", mcp_meta3)
                    if mcp_diff and mcp_diff.get("ok"):
                        yield _sse("drawio_diff", mcp_diff.get("data") or {})
                yield _sse(
                    "drawio_progress",
                    _drawio_progress_payload(
                        max_attempts,
                        "completed",
                        len(final_out),
                        message="图表生成完成，可应用到画布",
                    ),
                )
                yield _sse("done", {})
                return

            # 用户在 UI 中常停留在「通用 / 知识库」却询问项目与任务；仅 mode=todo 时注入会导致模型看不到数据。
            todo_attach = ""
            if (
                tm
                and mode in ("general", "knowledge")
                and todo_ai_bridge.message_suggests_todo_context(last_user)
            ):
                todo_text = ""
                mcp_ctx, mcp_meta = _mcp_call_with_meta(
                    "todo_get_context_preview",
                    {"level": "auto", "q": last_user},
                    timeout_sec=8.0,
                )
                yield _sse("mcp_call", mcp_meta)
                if mcp_ctx and mcp_ctx.get("ok"):
                    todo_text = str((mcp_ctx.get("data") or {}).get("text") or "")
                if not todo_text:
                    todo_text = todo_ai_bridge.build_adaptive_todo_context_for_llm(tm, last_user)
                todo_attach = (
                    todo_ai_bridge.TODO_LLM_SCHEMA_GUIDE
                    + "\n\n[当前待办快照 — 按问题选层级；仅用于待办相关回答，勿编造]\n"
                    + todo_text
                )

            # 通用模式下若明显在问「知识库/文档」，也自动挂知识库摘录，避免用户忘记切到知识库模式。
            knowledge_attach = ""
            knowledge_meta: Optional[Dict[str, Any]] = None
            if root_dir and mode in ("general", "knowledge"):
                ask_kb = (mode == "knowledge") or any(
                    k in (last_user or "")
                    for k in ("知识库", "文档", "根据文档", "根据知识库", "资料里", "README", ".md")
                )
                if ask_kb:
                    ctx = ""
                    hits: List[Dict[str, Any]] = []
                    names: List[str] = []
                    mcp_kb, mcp_meta = _mcp_call_with_meta(
                        "kb_retrieve",
                        {"query": last_user, "top_k": 6, "max_file_bytes": 200000},
                        timeout_sec=10.0,
                    )
                    yield _sse("mcp_call", mcp_meta)
                    if mcp_kb and mcp_kb.get("ok"):
                        kb_data = mcp_kb.get("data") or {}
                        ctx = str(kb_data.get("context") or "")
                        hits = list(kb_data.get("hits") or [])
                        names = list(kb_data.get("name_suggestions") or [])
                    if not ctx and not hits and not names:
                        ctx, hits, names = knowledge_store.retrieve_for_query(root_dir, last_user)
                    if ctx.strip():
                        knowledge_attach = "\n\n--- 知识库摘录 ---\n\n" + ctx.strip()
                    else:
                        knowledge_attach = (
                            "\n\n--- 知识库摘录 ---\n\n"
                            "(未命中正文；请确认已把目标 .md/.txt 加入知识库，或换更精确关键词。)"
                        )
                    knowledge_meta = {"hits": hits, "name_suggestions": names}

            if mode == "todo":
                intent = todo_ai_bridge._heuristic_intent(last_user)
                force_mutate = bool(body.get("force_todo_mutate"))
                if force_mutate or intent == "mutate":
                    if local_ai_engine.get_status(cfg)["loaded"]:

                        def gen_fn(msgs, system=None, max_new_tokens=1024):
                            return local_ai_engine.generate_once(
                                cfg,
                                msgs,
                                system=local_ai_skills.merge_primary_then_skills(system, skills_block),
                                max_new_tokens=max_new_tokens,
                            )

                        pr = todo_ai_bridge.propose_todo_ops_json(tm, last_user, gen_fn)
                        if pr.get("ok") and isinstance(pr.get("ops"), list) and pr.get("ops"):
                            mcp_plan, mcp_meta = _mcp_call_with_meta(
                                "todo_plan_ops",
                                {
                                    "ops": pr.get("ops"),
                                    "caller_id": _mcp_caller_id(),
                                    "auto_due_date": True,
                                },
                                timeout_sec=15.0,
                            )
                            yield _sse("mcp_call", mcp_meta)
                            if mcp_plan and mcp_plan.get("ok"):
                                d = mcp_plan.get("data") or {}
                                pr["preview"] = d.get("preview_lines") or pr.get("preview") or []
                                pr["confirm_token"] = d.get("confirm_token")
                                pr["expires_at"] = d.get("expires_at")
                            elif mcp_plan and not mcp_plan.get("ok"):
                                pr.setdefault("warnings", [])
                                pr["warnings"].append(f"MCP 预览失败，已回退本地预览: {((mcp_plan.get('error') or {}).get('message') or '')}")
                        yield _sse("todo_patch", pr)
                        yield _sse("done", {})
                        return
                    yield _sse(
                        "error",
                        {"message": "变更类请求需要先加载模型。"},
                    )
                    yield _sse("done", {})
                    return

                snap = ""
                meta = None
                mcp_ctx, mcp_meta = _mcp_call_with_meta(
                    "todo_get_context_preview",
                    {"level": "auto", "q": last_user},
                    timeout_sec=8.0,
                )
                yield _sse("mcp_call", mcp_meta)
                if mcp_ctx and mcp_ctx.get("ok"):
                    snap = str((mcp_ctx.get("data") or {}).get("text") or "")
                if not snap:
                    snap, meta = todo_ai_bridge.build_adaptive_todo_context_and_meta(tm, last_user)
                if meta and isinstance(meta, dict) and meta.get("task_card"):
                    yield _sse("todo_task_card", meta.get("task_card"))
                overview_extra = ""
                if last_user and any(
                    k in last_user
                    for k in (
                        "结构化",
                        "概览表",
                        "完整列表",
                        "JSON",
                        "所有任务id",
                        "全部任务id",
                        "描述",
                        "详情",
                        "评论",
                        "评论历史",
                        "更新历史",
                        "变更历史",
                        "属性",
                        "字段",
                    )
                ):
                    ov = todo_ai_bridge.build_todo_overview_dict(
                        tm,
                        limit_per_project=40,
                        redact_ids=True,
                        include_description=True,
                        include_comments=True,
                        include_history=True,
                    )
                    jtxt = json.dumps(ov, ensure_ascii=False)
                    if len(jtxt) <= 8000:
                        overview_extra = "\n\n[以下为结构化摘要 JSON，可与上文快照对照]\n" + jtxt
                system = local_ai_skills.merge_primary_then_skills(
                    todo_ai_bridge.TODO_LLM_SCHEMA_GUIDE
                    + "\n\n你是待办助手。根据下方数据用中文回答，不要编造。\n"
                    "**可读性**：用「项目名称」「任务标题」与快照中的序号指代，不要输出十六进制 id。\n"
                    "**写入类需求**：若用户要创建/修改任务，应提示在「待办」模式下勾选 **「强制解析为变更」**（或与列举类词分开提问）；"
                    "服务器会返回待确认补丁，**不要**只让用户去网页里手工添加。\n\n"
                    + snap
                    + overview_extra,
                    skills_block,
                )
                for piece in local_ai_engine.stream_generate(cfg, messages, system=system):
                    yield _sse("token", {"t": piece})
                yield _sse("done", {})
                return

            system: Optional[str] = None
            if mode == "knowledge" and root_dir:
                kb_body = (knowledge_attach.replace("\n\n--- 知识库摘录 ---\n\n", "") if knowledge_attach else "(无正文命中)").strip()
                if todo_attach:
                    kb_intro = (
                        "你是助手：若问题涉及知识库内容，请仅根据下方「知识库摘录」回答；"
                        "若涉及待办、项目或任务，请仅根据「当前待办快照」回答，不要编造。\n\n"
                        + todo_attach
                        + "\n\n--- 知识库摘录 ---\n\n"
                    )
                else:
                    kb_intro = "你是知识库助手。请仅根据以下摘录回答；若不足以回答，说明缺口并可参考文件名建议。\n\n"
                system = local_ai_skills.merge_primary_then_skills(kb_intro + kb_body, skills_block)
                yield _sse("knowledge_meta", knowledge_meta or {"hits": [], "name_suggestions": []})
            elif skills_block:
                gen_base: Optional[str] = None
                if todo_attach:
                    gen_base = (
                        "你是本服务器助手。待办说明见前文；若用户要**写入**待办，提示其切换到待办模式并勾选「强制解析为变更」。\n\n"
                        + todo_attach
                    )
                if knowledge_attach:
                    gen_base = (gen_base or "你是本服务器助手。") + knowledge_attach
                system = local_ai_skills.merge_primary_then_skills(gen_base, skills_block)
            elif todo_attach:
                system = (
                    "你是本服务器助手。待办字段与查询方式见下文；写入类需求请提示用户：待办模式 + 「强制解析为变更」。\n\n"
                    + todo_attach
                )
                if knowledge_attach:
                    system = system + knowledge_attach
            elif knowledge_attach:
                system = "你是本服务器助手。请仅根据以下知识库摘录回答，不要编造。\n" + knowledge_attach
                if knowledge_meta is not None:
                    yield _sse("knowledge_meta", knowledge_meta)

            for piece in local_ai_engine.stream_generate(cfg, messages, system=system):
                yield _sse("token", {"t": piece})
            yield _sse("done", {})

        return Response(
            stream_with_context(generate()),
            mimetype="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    @app.route("/api/local-ai/todo/preview", methods=["POST"])
    def local_ai_todo_preview():
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        body = request.get_json(silent=True) or {}
        msg = (body.get("message") or "").strip()
        if not msg:
            return jsonify({"success": False, "error": "message 不能为空"}), 400
        if not local_ai_engine.get_status(_app_ai_config())["loaded"]:
            return jsonify({"success": False, "error": "请先加载模型"}), 400
        tm = current_app.config.get("TODO_MANAGER")
        cfg = _app_ai_config()
        skills_block = ""
        if cfg.get("LOCAL_AI_APPEND_SKILLS", True):
            _ctx_eff = int(local_ai_engine._effective_lm_context_tokens(cfg))
            _skill_cap = min(12000, max(4096, _ctx_eff * 2))
            skills_block = local_ai_skills.load_skills_text(
                cfg.get("LOCAL_AI_SKILLS_DIR") or "",
                max_total_chars=_skill_cap,
            )

        def gen_fn(msgs, system=None, max_new_tokens=1024):
            return local_ai_engine.generate_once(
                cfg,
                msgs,
                system=local_ai_skills.merge_primary_then_skills(system, skills_block),
                max_new_tokens=max_new_tokens,
            )

        pr = todo_ai_bridge.propose_todo_ops_json(tm, msg, gen_fn)
        mcp_meta: Optional[Dict[str, Any]] = None
        if pr.get("ok") and isinstance(pr.get("ops"), list) and pr.get("ops"):
            mcp_plan, mcp_meta = _mcp_call_with_meta(
                "todo_plan_ops",
                {"ops": pr.get("ops"), "caller_id": _mcp_caller_id(), "auto_due_date": True},
                timeout_sec=15.0,
            )
            if mcp_plan and mcp_plan.get("ok"):
                d = mcp_plan.get("data") or {}
                pr["preview"] = d.get("preview_lines") or pr.get("preview") or []
                pr["confirm_token"] = d.get("confirm_token")
                pr["expires_at"] = d.get("expires_at")
        return jsonify({"success": True, **pr, "mcp_call": mcp_meta})

    @app.route("/api/local-ai/todo/overview", methods=["GET"])
    def local_ai_todo_overview():
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        tm = current_app.config.get("TODO_MANAGER")
        if not tm:
            return jsonify({"success": False, "error": "TODO_MANAGER 未初始化"}), 500
        project_id = (request.args.get("project_id") or "").strip() or None
        try:
            limit = int(request.args.get("limit_per_project", "80"))
        except ValueError:
            limit = 80
        incl_desc = (request.args.get("include_description") or "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        incl_comments = (request.args.get("include_comments") or "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        incl_history = (request.args.get("include_history") or "").strip().lower() in (
            "1",
            "true",
            "yes",
        )
        payload = todo_ai_bridge.build_todo_overview_dict(
            tm,
            project_id=project_id,
            limit_per_project=limit,
            include_description=incl_desc,
            include_comments=incl_comments,
            include_history=incl_history,
        )
        return jsonify({"success": True, **payload})

    @app.route("/api/local-ai/todo/validate", methods=["POST"])
    def local_ai_todo_validate():
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        body = request.get_json(silent=True) or {}
        ops = body.get("ops")
        if not isinstance(ops, list):
            return jsonify({"success": False, "error": "ops 必须为数组"}), 400
        ref_q = (body.get("ref_question") or "").strip()
        if _use_mcp_bridge():
            mcp_res, mcp_meta = _mcp_call_with_meta(
                "todo_validate_ops",
                {"ops": ops, "ref_question": ref_q, "auto_due_date": True},
                timeout_sec=15.0,
            )
            if mcp_res and mcp_res.get("ok"):
                d = mcp_res.get("data") or {}
                return jsonify(
                    {
                        "success": True,
                        "ops": d.get("ops") or ops,
                        "preview": d.get("preview_lines") or [],
                        "mcp_call": mcp_meta,
                        "trace_id": mcp_res.get("trace_id"),
                    }
                )
            if mcp_res and not mcp_res.get("ok"):
                err = (mcp_res.get("error") or {}).get("message") or "MCP 校验失败"
                details = (mcp_res.get("error") or {}).get("details") or {}
                return jsonify({"success": False, "error": err, "preview": details.get("preview_lines") or [], "mcp_call": mcp_meta}), 400

        tm = current_app.config.get("TODO_MANAGER")
        cat = todo_ai_bridge.build_mutate_ref_catalog_only(tm, ref_q)
        ops_expanded = todo_ai_bridge.expand_natural_todo_refs(ops, cat)
        ops_expanded = todo_ai_bridge.enrich_todo_ops_due_dates(ops_expanded, ref_q)
        preview, err = todo_ai_bridge.validate_and_describe_ops(tm, ops_expanded)
        if err:
            return jsonify({"success": False, "error": err, "preview": preview or []}), 400
        return jsonify({"success": True, "ops": ops_expanded, "preview": preview or []})

    @app.route("/api/local-ai/todo/summary", methods=["GET"])
    def local_ai_todo_summary_api():
        """只读：各项目任务总数、已完成/未完成（供前端或其它工具拉取）。"""
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        tm = current_app.config.get("TODO_MANAGER")
        if not tm:
            return jsonify({"success": False, "error": "TODO_MANAGER 未初始化"}), 500
        rows = todo_ai_bridge.build_todo_projects_summary_rows(tm)
        return jsonify({"success": True, "projects": rows})

    @app.route("/api/local-ai/todo/context", methods=["GET"])
    def local_ai_todo_context_layer():
        """
        只读：与注入 LLM 相同的分层正文预览。
        level=auto|summary|project|project_tasks|task|full，q=用户问题或补充说明；
        project_id / task_id 在 level 为 project_tasks、task 时使用。
        """
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        tm = current_app.config.get("TODO_MANAGER")
        if not tm:
            return jsonify({"success": False, "error": "TODO_MANAGER 未初始化"}), 500
        level = (request.args.get("level") or "auto").strip().lower()
        q = request.args.get("q") or ""
        pid = (request.args.get("project_id") or "").strip()
        tid = (request.args.get("task_id") or "").strip()

        if level == "auto":
            text = todo_ai_bridge.build_adaptive_todo_context_for_llm(tm, q)
        elif level == "summary":
            text = todo_ai_bridge.build_todo_summary_text_for_llm(tm)
        elif level == "full":
            text = todo_ai_bridge.build_todo_snapshot_for_llm(tm, q)
        elif level in ("project", "project_tasks"):
            data = tm.list_all()
            proj = None
            for p in data.get("projects") or []:
                if p.get("id") == pid:
                    proj = p
                    break
            if not proj:
                return jsonify({"success": False, "error": "找不到 project_id"}), 400
            text = todo_ai_bridge.build_todo_project_detail_for_llm(tm, proj, q)
        elif level == "task":
            if not pid or not tid:
                return jsonify({"success": False, "error": "task 层需要 project_id 与 task_id"}), 400
            data = tm.list_all()
            task = None
            project = None
            for p in data.get("projects") or []:
                if p.get("id") != pid:
                    continue
                project = p
                for t in p.get("tasks") or []:
                    if t.get("id") == tid:
                        task = t
                        break
                break
            if not task or not project:
                return jsonify({"success": False, "error": "找不到任务"}), 400
            text = todo_ai_bridge.build_todo_task_detail_for_llm(project, task)
        else:
            return jsonify({"success": False, "error": "未知 level"}), 400
        return jsonify({"success": True, "level": level, "text": text})

    @app.route("/api/local-ai/todo/apply", methods=["POST"])
    def local_ai_todo_apply():
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        body = request.get_json(silent=True) or {}
        ops = body.get("ops")
        if not isinstance(ops, list):
            return jsonify({"success": False, "error": "ops 必须为数组"}), 400
        confirm_token = (body.get("confirm_token") or "").strip()
        caller_id = str(body.get("caller_id") or _mcp_caller_id())
        idem = (body.get("idempotency_key") or "").strip() or f"web-{uuid.uuid4().hex[:12]}"
        mcp_meta: Optional[Dict[str, Any]] = None
        if _use_mcp_bridge():
            if not confirm_token:
                mcp_plan, mcp_meta = _mcp_call_with_meta(
                    "todo_plan_ops",
                    {"ops": ops, "caller_id": caller_id, "auto_due_date": True},
                    timeout_sec=15.0,
                )
                if mcp_plan and mcp_plan.get("ok"):
                    confirm_token = str(((mcp_plan.get("data") or {}).get("confirm_token") or "")).strip()
                elif mcp_plan and not mcp_plan.get("ok"):
                    return (
                        jsonify(
                            {
                                "success": False,
                                "error": f"MCP 预校验失败: {((mcp_plan.get('error') or {}).get('message') or 'unknown')}",
                                "mcp_call": mcp_meta,
                            }
                        ),
                        400,
                    )
            if confirm_token:
                mcp_apply, mcp_meta = _mcp_call_with_meta(
                    "todo_apply_ops",
                    {
                        "ops": ops,
                        "confirm_token": confirm_token,
                        "caller_id": caller_id,
                        "idempotency_key": idem,
                    },
                    timeout_sec=20.0,
                )
                if mcp_apply and mcp_apply.get("ok"):
                    _refresh_todo_manager_from_disk()
                    return jsonify(
                        {
                            "success": True,
                            "message": "已应用",
                            "mcp": True,
                            "trace_id": mcp_apply.get("trace_id"),
                            "mcp_call": mcp_meta,
                        }
                    )
                if mcp_apply and not mcp_apply.get("ok"):
                    err_msg = ((mcp_apply.get("error") or {}).get("message") or "MCP 应用失败")
                    err_code = str(((mcp_apply.get("error") or {}).get("code") or "")).strip().upper()
                    # token 过期/失效时自动重签一次，避免用户关闭弹窗后再次确认失败。
                    if err_code in ("CONFIRM_TOKEN_INVALID", "CONFIRM_TOKEN_USED", "CONFIRM_TOKEN_MISMATCH"):
                        replan, replan_meta = _mcp_call_with_meta(
                            "todo_plan_ops",
                            {"ops": ops, "caller_id": caller_id, "auto_due_date": True},
                            timeout_sec=15.0,
                        )
                        if replan and replan.get("ok"):
                            new_token = str(((replan.get("data") or {}).get("confirm_token") or "")).strip()
                            if new_token:
                                mcp_apply2, mcp_meta2 = _mcp_call_with_meta(
                                    "todo_apply_ops",
                                    {
                                        "ops": ops,
                                        "confirm_token": new_token,
                                        "caller_id": caller_id,
                                        "idempotency_key": idem,
                                    },
                                    timeout_sec=20.0,
                                )
                                if mcp_apply2 and mcp_apply2.get("ok"):
                                    _refresh_todo_manager_from_disk()
                                    return jsonify(
                                        {
                                            "success": True,
                                            "message": "已应用",
                                            "mcp": True,
                                            "trace_id": mcp_apply2.get("trace_id"),
                                            "mcp_call": mcp_meta2,
                                        }
                                    )
                                if mcp_apply2 and not mcp_apply2.get("ok"):
                                    err_msg = ((mcp_apply2.get("error") or {}).get("message") or err_msg)
                                    mcp_meta = mcp_meta2
                        elif replan and not replan.get("ok"):
                            err_msg = ((replan.get("error") or {}).get("message") or err_msg)
                            mcp_meta = replan_meta
                    return (
                        jsonify(
                            {
                                "success": False,
                                "error": err_msg,
                                "mcp": True,
                                "trace_id": mcp_apply.get("trace_id"),
                                "mcp_call": mcp_meta,
                            }
                        ),
                        400,
                    )
        tm = current_app.config.get("TODO_MANAGER")
        ref_q = (body.get("ref_question") or "").strip()
        cat = todo_ai_bridge.build_mutate_ref_catalog_only(tm, ref_q)
        ops = todo_ai_bridge.expand_natural_todo_refs(ops, cat)
        ops = todo_ai_bridge.enrich_todo_ops_due_dates(ops, ref_q)
        preview, err = todo_ai_bridge.validate_and_describe_ops(tm, ops)
        if err:
            return jsonify({"success": False, "error": err, "preview": preview}), 400
        ok, err_msg = todo_ai_bridge.apply_todo_ops(tm, ops, expand_refs=False)
        if not ok:
            return jsonify({"success": False, "error": err_msg}), 400
        return jsonify({"success": True, "message": "已应用"})

    @app.route("/api/knowledge/entry", methods=["GET"])
    def knowledge_get():
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        path = request.args.get("path", "")
        meta = knowledge_store.get_meta(path)
        return jsonify({"success": True, "in_knowledge": meta is not None, "meta": meta})

    @app.route("/api/knowledge/list", methods=["GET"])
    def knowledge_list():
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        root = current_app.config.get("ROOT_DIR")
        if not root:
            return jsonify({"success": False, "error": "未设置根目录"}), 400
        items = knowledge_store.list_entries(root)
        return jsonify({"success": True, "items": items})

    @app.route("/api/knowledge/entry", methods=["POST"])
    def knowledge_set():
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        root = current_app.config.get("ROOT_DIR")
        if not root:
            return jsonify({"success": False, "error": "未设置根目录"}), 400
        body = request.get_json(silent=True) or {}
        path = body.get("path", "")
        tags = body.get("tags")
        note = body.get("note", "")
        try:
            ent = knowledge_store.set_entry(root, path, tags=tags, note=note or "")
            return jsonify({"success": True, "entry": ent})
        except ValueError as e:
            return jsonify({"success": False, "error": str(e)}), 400

    @app.route("/api/knowledge/entry", methods=["DELETE"])
    def knowledge_delete():
        if not _auth_ok():
            return jsonify({"success": False, "error": "未登录"}), 401
        root = current_app.config.get("ROOT_DIR")
        path = request.args.get("path", "")
        if not root or not path:
            return jsonify({"success": False, "error": "参数无效"}), 400
        knowledge_store.remove_entry(root, path)
        return jsonify({"success": True})
