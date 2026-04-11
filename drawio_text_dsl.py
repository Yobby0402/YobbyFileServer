"""
Yobboy-flow-v1：类 Mermaid 的声明式文本 → draw.io mxfile（确定性转换，不调用 LLM）。

语法需与 static/js/drawio_text_dsl.js 保持一致；修改时请同步两端。

与 draw.io 内置 Mermaid 导入：本模块不经过 mxMermaidToDrawio；显式 ``@ x y w h`` 仅由本解析器写入 mxGeometry，避免被 Mermaid 布局覆盖。
"""
from __future__ import annotations

import re
import shlex
import xml.sax.saxutils as saxutils
from collections import defaultdict
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

KIND_LINE = "yobboy-flow-v1"

KNOWN_SHAPES = frozenset(
    {"rect", "rounded", "diamond", "ellipse", "circle", "parallelogram"}
)

SHAPE_STYLES = {
    "rect": "rounded=0;whiteSpace=wrap;html=1;spacingLeft=10;spacingRight=10;spacingTop=8;spacingBottom=8;",
    "rounded": "rounded=1;whiteSpace=wrap;html=1;spacingLeft=10;spacingRight=10;spacingTop=8;spacingBottom=8;",
    "diamond": "rhombus;whiteSpace=wrap;html=1;spacingLeft=6;spacingRight=6;spacingTop=6;spacingBottom=6;",
    "ellipse": "ellipse;whiteSpace=wrap;html=1;spacingLeft=8;spacingRight=8;spacingTop=6;spacingBottom=6;",
    "circle": "ellipse;whiteSpace=wrap;html=1;spacingLeft=8;spacingRight=8;spacingTop=6;spacingBottom=6;",
    "parallelogram": "shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;spacingLeft=8;spacingRight=8;spacingTop=6;spacingBottom=6;",
}

_EDGE_BASE = (
    "edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;"
    "orthogonal=1;html=1;endArrow=classic;startArrow=none;"
    "labelBackgroundColor=#ffffff;fontSize=11;fontColor=#333333;"
)


def _clamp_port(v: float, lo: float = 0.14, hi: float = 0.86) -> float:
    return max(lo, min(hi, v))


def _stagger_delta(port_index: int) -> float:
    """同源多线时沿竖边轻微错开，幅度小，避免出现中间一整条竖干线。"""
    seq = (0.0, -0.1, 0.1, -0.18, 0.18, -0.06, 0.06)
    return seq[port_index % len(seq)]


def _orthogonal_edge_style(
    sx: float,
    sy: float,
    sw: float,
    sh: float,
    tx: float,
    ty: float,
    tw: float,
    th: float,
    port_index: int,
) -> str:
    """
    统一按「流程图」习惯：连线只从左右侧出入（右出→左进，或镜像），
    不把上下边当主端口，避免正交路由在中间拉出竖向「竹节」、两侧摆块的观感。
    上下关系由 draw.io 正交折线自行绕，不再强制顶/底对接。
    """
    scx = sx + sw / 2
    tcx = tx + tw / 2
    off = _stagger_delta(port_index)

    if sx == tx and sy == ty and sw == tw and sh == th:
        return (
            _EDGE_BASE
            + "exitX=1;exitY=0.28;entryX=1;entryY=0.72;portConstraintRotation=false;"
        )

    if tcx >= scx:
        ex, ey = 1.0, _clamp_port(0.5 + off)
        ix, iy = 0.0, _clamp_port(0.5 - off)
    else:
        ex, ey = 0.0, _clamp_port(0.5 - off)
        ix, iy = 1.0, _clamp_port(0.5 + off)
    return _EDGE_BASE + f"exitX={ex};exitY={ey};entryX={ix};entryY={iy};"


@dataclass
class NodeSpec:
    nid: str
    label: str
    shape: str = "rect"
    x: Optional[float] = None
    y: Optional[float] = None
    w: float = 120.0
    h: float = 60.0


@dataclass
class EdgeSpec:
    src: str
    tgt: str
    label: str = ""


class DrawioTextDslError(Exception):
    """解析或语义错误（供重试提示）。"""

    def __init__(self, message: str, line: int = 0):
        self.message = message
        self.line = line
        super().__init__(message if not line else f"第 {line} 行: {message}")


def _esc_attr(val: str) -> str:
    return saxutils.escape(val, entities={'"': "&quot;"})


_FENCE_RES = (
    re.compile(r"```yobboy-flow\s*([\s\S]*?)```", re.IGNORECASE),
    re.compile(r"```flow\s*([\s\S]*?)```", re.IGNORECASE),
    re.compile(r"```diagram\s*([\s\S]*?)```", re.IGNORECASE),
)


def extract_yobboy_flow_source(raw: str) -> str:
    """从模型回复中取出 yobboy-flow 正文（围栏或整段）。"""
    text = (raw or "").strip()
    if not text:
        return ""
    for cre in _FENCE_RES:
        m = cre.search(text)
        if m:
            return m.group(1).strip()
    if re.search(r"(?m)^\s*(node\s+\S|edge\s+\S|\S+\s*->\s*\S+)", text):
        return text.strip()
    return ""


def _parse_node_line(line: str, lineno: int) -> NodeSpec:
    rest = line[4:].strip()  # after "node"
    try:
        tokens = shlex.split(rest, posix=True)
    except ValueError as e:
        raise DrawioTextDslError(f"node 行引号未闭合: {e}", lineno) from e
    if len(tokens) < 1:
        raise DrawioTextDslError("node 缺少 id", lineno)
    nid = tokens[0]
    if not re.match(r"^[\w.-]+$", nid):
        raise DrawioTextDslError(f"非法 node id: {nid}", lineno)
    tail = tokens[1:]
    geom: Optional[Tuple[float, float, float, float]] = None
    if "@" in tail:
        at = tail.index("@")
        before = tail[:at]
        after = tail[at + 1 :]
        if len(after) < 4:
            raise DrawioTextDslError("node 的 @ 后需要 4 个数字: x y width height", lineno)
        try:
            x, y, w, h = (float(after[0]), float(after[1]), float(after[2]), float(after[3]))
        except ValueError as e:
            raise DrawioTextDslError("@ 后须为数字", lineno) from e
        if w <= 0 or h <= 0:
            raise DrawioTextDslError("width/height 须为正数", lineno)
        geom = (x, y, w, h)
        tail = before
    shape = "rect"
    if tail and tail[-1].lower() in KNOWN_SHAPES:
        shape = tail[-1].lower()
        tail = tail[:-1]
    label = " ".join(tail).strip()
    ns = NodeSpec(nid=nid, label=label or nid, shape=shape)
    if geom:
        ns.x, ns.y, ns.w, ns.h = geom[0], geom[1], geom[2], geom[3]
    return ns


def _parse_edge_line(line: str, lineno: int) -> EdgeSpec:
    rest = line[4:].strip()
    try:
        tokens = shlex.split(rest, posix=True)
    except ValueError as e:
        raise DrawioTextDslError(f"edge 行引号未闭合: {e}", lineno) from e
    if len(tokens) < 3 or tokens[1] != "->":
        raise DrawioTextDslError('edge 格式应为: edge <from> -> <to> ["标签"]', lineno)
    src, tgt = tokens[0], tokens[2]
    elabel = " ".join(tokens[3:]).strip() if len(tokens) > 3 else ""
    return EdgeSpec(src=src, tgt=tgt, label=elabel)


_MERMAID_EDGE = re.compile(r"^(\S+)\s*->\s*(\S+)(?:\s+(.*))?$")


def _parse_mermaid_edge_line(line: str, lineno: int) -> EdgeSpec:
    m = _MERMAID_EDGE.match(line.strip())
    if not m:
        raise DrawioTextDslError(f"无法解析的连线行: {line[:80]}", lineno)
    src, tgt, rest = m.group(1), m.group(2), (m.group(3) or "").strip()
    if src == "node" or tgt == "node":
        raise DrawioTextDslError("请使用关键字 node / edge 声明，勿混写", lineno)
    return EdgeSpec(src=src, tgt=tgt, label=rest)


def parse_yobboy_flow(body: str) -> Tuple[List[NodeSpec], List[EdgeSpec]]:
    """解析正文（不含围栏）为节点有序列表与边列表。"""
    if not (body or "").strip():
        raise DrawioTextDslError("yobboy-flow 正文为空")
    nodes_order: List[NodeSpec] = []
    node_map: Dict[str, NodeSpec] = {}
    edges: List[EdgeSpec] = []
    for lineno, line in enumerate(body.splitlines(), 1):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        low = s.lower()
        if low.startswith("kind:"):
            v = s.split(":", 1)[1].strip().lower()
            if v and v != KIND_LINE:
                raise DrawioTextDslError(f"不支持的 kind（请使用 {KIND_LINE} 或省略）: {v}", lineno)
            continue
        if low.startswith("node "):
            spec = _parse_node_line(s, lineno)
            if spec.nid in node_map:
                raise DrawioTextDslError(f"重复的 node id: {spec.nid}", lineno)
            node_map[spec.nid] = spec
            nodes_order.append(spec)
            continue
        if low.startswith("edge "):
            edges.append(_parse_edge_line(s, lineno))
            continue
        if "->" in s and not low.startswith("node"):
            edges.append(_parse_mermaid_edge_line(s, lineno))
            continue
        raise DrawioTextDslError(f"无法识别的行: {s[:100]}", lineno)

    for e in edges:
        for end in (e.src, e.tgt):
            if end not in node_map:
                node_map[end] = NodeSpec(nid=end, label=end, shape="rounded")
                nodes_order.append(node_map[end])

    if not nodes_order and not edges:
        raise DrawioTextDslError("未声明任何 node 或连线")

    return nodes_order, edges


def _layout_nodes(nodes: List[NodeSpec]) -> None:
    """为缺少坐标的节点赋网格位置：多列少行，偏左→右阅读，减轻竖向主干观感。"""
    need = [n for n in nodes if n.x is None or n.y is None]
    col_w, row_h, cols = 220, 130, 6
    for i, n in enumerate(need):
        col = i % cols
        row = i // cols
        n.x = 40.0 + col * col_w
        n.y = 40.0 + row * row_h


def yobboy_flow_to_mxfile(body: str) -> str:
    """正文 → 完整 mxfile XML 字符串。"""
    nodes, edges = parse_yobboy_flow(body)
    _layout_nodes(nodes)
    id_map: Dict[str, str] = {}
    next_id = 2
    for n in nodes:
        id_map[n.nid] = str(next_id)
        next_id += 1

    parts: List[str] = []
    parts.append('<mxfile host="app.diagrams.net">')
    parts.append('<diagram id="p1" name="Page-1">')
    parts.append("<mxGraphModel><root>")
    parts.append('<mxCell id="0"/>')
    parts.append('<mxCell id="1" parent="0"/>')

    for n in nodes:
        cid = id_map[n.nid]
        st = SHAPE_STYLES.get(n.shape, SHAPE_STYLES["rect"])
        vx = _esc_attr(n.label)
        parts.append(
            f'<mxCell id="{cid}" value="{vx}" style="{st}" vertex="1" parent="1">'
            f'<mxGeometry x="{int(n.x)}" y="{int(n.y)}" width="{int(n.w)}" height="{int(n.h)}" as="geometry"/>'
            f"</mxCell>"
        )

    geom: Dict[str, Tuple[float, float, float, float]] = {
        n.nid: (float(n.x or 0), float(n.y or 0), float(n.w), float(n.h)) for n in nodes
    }
    out_port: Dict[str, int] = defaultdict(int)

    for e in edges:
        sid = id_map.get(e.src)
        tid = id_map.get(e.tgt)
        if not sid or not tid:
            continue
        eid = str(next_id)
        next_id += 1
        ev = _esc_attr(e.label) if e.label else ""
        vattr = f' value="{ev}"' if ev else ""
        sx, sy, sw, sh = geom[e.src]
        tx, ty, tw, th = geom[e.tgt]
        pi = out_port[e.src]
        out_port[e.src] += 1
        est = _orthogonal_edge_style(sx, sy, sw, sh, tx, ty, tw, th, pi)
        parts.append(
            f'<mxCell id="{eid}"{vattr} style="{est}" edge="1" parent="1" '
            f'source="{sid}" target="{tid}">'
            f'<mxGeometry relative="1" as="geometry"/>'
            f"</mxCell>"
        )

    parts.append("</root></mxGraphModel>")
    parts.append("</diagram></mxfile>")
    return "".join(parts)


def convert_model_reply_to_mxfile(raw: str) -> str:
    """模型完整回复 → mxfile（抽取围栏 + 转换）。"""
    src = extract_yobboy_flow_source(raw)
    if not src:
        raise DrawioTextDslError("未找到 yobboy-flow 内容（需要 ```yobboy-flow 围栏或 node/edge/-> 行）")
    return yobboy_flow_to_mxfile(src)
