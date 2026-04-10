"""
从 AI/skills 目录加载供「本地推理模型」使用的 Skill 文本，注入到 system 提示前面。
"""
from __future__ import annotations

import os
from typing import List, Optional


def list_skill_files(skills_dir: str) -> List[str]:
    if not skills_dir or not os.path.isdir(skills_dir):
        return []
    out: List[str] = []
    try:
        for fn in sorted(os.listdir(skills_dir)):
            low = fn.lower()
            if low.endswith((".md", ".txt", ".skill")):
                p = os.path.join(skills_dir, fn)
                if os.path.isfile(p):
                    out.append(fn)
    except OSError:
        pass
    return out


def load_drawio_local_skill(skills_dir: str, max_chars: int = 14000) -> str:
    """
    仅加载 skills 目录下的 drawio-ai-local.md / .txt（若存在）。
    与 load_skills_text 分离，避免 Draw.io 模式混入其它长 Skill；完全本地、可离线。
    """
    if not skills_dir or not os.path.isdir(skills_dir):
        return ""
    for name in ("drawio-ai-local.md", "drawio-ai-local.txt"):
        path = os.path.join(skills_dir, name)
        if not os.path.isfile(path):
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                body = f.read().strip()
        except OSError:
            continue
        if not body:
            return ""
        if len(body) > max_chars:
            body = body[:max_chars] + "\n\n...[Draw.io 本地 Skill 过长已截断]"
        return (
            "[以下为管理员提供的本地 Draw.io 补充说明；仍须遵守主系统提示：只输出完整 <mxfile>]\n\n"
            + body
        )
    return ""


def load_skills_text(skills_dir: str, max_total_chars: int = 8000) -> str:
    files = list_skill_files(skills_dir)
    parts: List[str] = []
    for fn in files:
        path = os.path.join(skills_dir, fn)
        try:
            with open(path, "r", encoding="utf-8") as f:
                body = f.read().strip()
            if body:
                parts.append(f"### {fn}\n{body}")
        except OSError:
            continue
    text = "\n\n---\n\n".join(parts)
    if len(text) > max_total_chars:
        text = text[:max_total_chars] + "\n\n...[Skill 内容过长已截断]"
    if not text:
        return ""
    return (
        "以下由服务器管理员放置在 AI/skills/ 中的说明为你的专用 Skill，"
        "请在与本服务器、文件共享、知识库、待办相关的对话中遵守。\n\n"
        + text
    )


def prefix_system(base: Optional[str], skills_block: str) -> Optional[str]:
    if not skills_block:
        return base
    if base:
        return skills_block + "\n\n---\n\n" + base
    return skills_block


def merge_primary_then_skills(primary: Optional[str], skills_block: str) -> Optional[str]:
    """
    待办/知识库等业务内容在前，Skill 在后。
    本地推理会在超长时对 system 做「保留前段、截断尾部」；若 Skill 在前，会先砍掉待办快照。
    """
    s = (skills_block or "").strip()
    if not s:
        return (primary.strip() if primary else None) or None
    if not (primary and primary.strip()):
        return skills_block
    return primary.rstrip() + "\n\n---\n\n" + s
