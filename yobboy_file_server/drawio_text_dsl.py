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
from typing import Any, Dict, List, Optional, Tuple

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

_SIDE_LEFT = "left"
_SIDE_RIGHT = "right"
_SIDE_TOP = "top"
_SIDE_BOTTOM = "bottom"
_BRANCH_SLOT_SEQUENCE = (0.0, 1.2, -1.2, 2.4, -2.4, 3.6, -3.6)
_DECISION_POSITIVE_LABELS = frozenset(
    {"yes", "y", "true", "ok", "pass", "success", "是", "通过", "成功", "继续", "存在"}
)
_DECISION_NEGATIVE_LABELS = frozenset(
    {"no", "n", "false", "fail", "error", "reject", "否", "失败", "异常", "拒绝", "驳回", "不存在"}
)
_DECISION_UP_LABELS = frozenset({"back", "return", "retry", "返回", "回退", "重试"})


def _clamp_port(v: float, lo: float = 0.14, hi: float = 0.86) -> float:
    return max(lo, min(hi, v))


def _side_port_position(index: int, total: int) -> float:
    """将同侧多个端口均匀分散到边上，避免都挤在同一点。"""
    if total <= 1:
        return 0.5
    margin = 0.18
    return _clamp_port(margin + (1.0 - margin * 2.0) * ((index + 1) / (total + 1)))


def _side_point(side: str, pos: float) -> Tuple[float, float]:
    p = _clamp_port(pos)
    if side == _SIDE_LEFT:
        return 0.0, p
    if side == _SIDE_RIGHT:
        return 1.0, p
    if side == _SIDE_TOP:
        return p, 0.0
    return p, 1.0


def _normalize_branch_label(label: str) -> str:
    txt = (label or "").strip().lower()
    if not txt:
        return ""
    txt = re.sub(r"[\s:：\-_/()（）\[\]{}<>，。,.!?！？]+", "", txt)
    return txt


def _decision_branch_hint(label: str) -> str:
    txt = _normalize_branch_label(label)
    if not txt:
        return "neutral"
    if txt in _DECISION_POSITIVE_LABELS or any(one in txt for one in _DECISION_POSITIVE_LABELS):
        return "positive"
    if txt in _DECISION_NEGATIVE_LABELS or any(one in txt for one in _DECISION_NEGATIVE_LABELS):
        return "negative"
    if txt in _DECISION_UP_LABELS or any(one in txt for one in _DECISION_UP_LABELS):
        return "up"
    return "neutral"


def _pick_first_available(candidates: Tuple[float, ...], used: set[float]) -> float:
    for slot in candidates:
        if slot not in used:
            used.add(slot)
            return slot
    slot = float(len(used) + 1)
    used.add(slot)
    return slot


def _assign_decision_branch_offsets(items: List[Tuple[int, "EdgeSpec"]]) -> Dict[int, float]:
    used: set[float] = set()
    assigned: Dict[int, float] = {}
    buckets: Dict[str, List[int]] = {"positive": [], "negative": [], "up": [], "neutral": []}
    for edge_idx, edge in items:
        buckets[_decision_branch_hint(edge.label)].append(edge_idx)
    pref_map: Dict[str, Tuple[float, ...]] = {
        "positive": (0.0, -1.2, 1.2, -2.4, 2.4),
        "negative": (1.2, 2.4, -1.2, 3.6, -2.4),
        "up": (-1.2, -2.4, 1.2, -3.6, 2.4),
        "neutral": _BRANCH_SLOT_SEQUENCE,
    }
    for hint in ("positive", "negative", "up", "neutral"):
        for edge_idx in buckets[hint]:
            assigned[edge_idx] = _pick_first_available(pref_map[hint], used)
    return assigned


def _edge_side_sort_key(side: str, other_cx: float, other_cy: float) -> float:
    return other_cy if side in (_SIDE_LEFT, _SIDE_RIGHT) else other_cx


def _choose_anchor_sides(
    sx: float,
    sy: float,
    sw: float,
    sh: float,
    tx: float,
    ty: float,
    tw: float,
    th: float,
) -> Tuple[str, str]:
    """
    按源/目标相对方位选择出线与入线方向：
    - 横向优势明显时走左右；
    - 纵向优势明显时走上下；
    - 斜向接近时按主导轴兜底。
    """
    scx = sx + sw / 2
    scy = sy + sh / 2
    tcx = tx + tw / 2
    tcy = ty + th / 2
    dx = tcx - scx
    dy = tcy - scy
    abs_dx = abs(dx)
    abs_dy = abs(dy)

    if abs_dx >= abs_dy * 1.25:
        return (_SIDE_RIGHT, _SIDE_LEFT) if dx >= 0 else (_SIDE_LEFT, _SIDE_RIGHT)
    if abs_dy >= abs_dx * 1.25:
        return (_SIDE_BOTTOM, _SIDE_TOP) if dy >= 0 else (_SIDE_TOP, _SIDE_BOTTOM)
    if abs_dx >= abs_dy:
        return (_SIDE_RIGHT, _SIDE_LEFT) if dx >= 0 else (_SIDE_LEFT, _SIDE_RIGHT)
    return (_SIDE_BOTTOM, _SIDE_TOP) if dy >= 0 else (_SIDE_TOP, _SIDE_BOTTOM)


def _decision_exit_side(shape: str, label: str, ordinal: int, dx: float, dy: float) -> Optional[str]:
    if shape != "diamond":
        return None
    hint = _decision_branch_hint(label)
    if hint == "positive":
        return _SIDE_RIGHT if dx >= -40 else (_SIDE_BOTTOM if dy >= 0 else _SIDE_TOP)
    if hint == "negative":
        return _SIDE_TOP if dy < -40 else _SIDE_BOTTOM
    if hint == "up":
        return _SIDE_TOP
    if ordinal == 0:
        return _SIDE_RIGHT if dx >= 0 else _SIDE_LEFT
    if ordinal == 1:
        return _SIDE_BOTTOM if dy >= 0 else _SIDE_TOP
    return None


def _entry_side_for_exit(exit_side: str, dx: float, dy: float) -> str:
    if exit_side == _SIDE_RIGHT:
        return _SIDE_LEFT if dx >= 0 else _SIDE_RIGHT
    if exit_side == _SIDE_LEFT:
        return _SIDE_RIGHT if dx <= 0 else _SIDE_LEFT
    if exit_side == _SIDE_BOTTOM:
        return _SIDE_TOP if dy >= 0 else _SIDE_BOTTOM
    return _SIDE_BOTTOM if dy <= 0 else _SIDE_TOP


def _orthogonal_edge_style(
    exit_side: str,
    exit_pos: float,
    entry_side: str,
    entry_pos: float,
) -> str:
    ex, ey = _side_point(exit_side, exit_pos)
    ix, iy = _side_point(entry_side, entry_pos)
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


@dataclass
class EdgeRouteSpec:
    exit_side: str
    entry_side: str
    exit_sort_key: float
    entry_sort_key: float
    exit_pos: float = 0.5
    entry_pos: float = 0.5
    is_self_loop: bool = False


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
    """兼容旧签名；无边信息时退化为简单网格。"""
    _layout_nodes_with_edges(nodes, [])


def _layer_center_offset(count: int) -> float:
    return (count - 1) / 2.0


def _layout_nodes_with_edges(nodes: List[NodeSpec], edges: List[EdgeSpec]) -> None:
    """为缺少坐标的节点赋分层坐标：主链横向，分支围绕主链上下展开。"""
    need = [n for n in nodes if n.x is None or n.y is None]
    if not need:
        return

    node_map: Dict[str, NodeSpec] = {node.nid: node for node in nodes}
    order_index = {node.nid: idx for idx, node in enumerate(nodes)}
    outgoing: Dict[str, List[str]] = {node.nid: [] for node in nodes}
    incoming: Dict[str, List[str]] = {node.nid: [] for node in nodes}
    outgoing_edge_indexes: Dict[str, List[int]] = {node.nid: [] for node in nodes}
    incoming_edge_indexes: Dict[str, List[int]] = {node.nid: [] for node in nodes}
    indegree: Dict[str, int] = {node.nid: 0 for node in nodes}

    for edge_idx, edge in enumerate(edges):
        if edge.src not in node_map or edge.tgt not in node_map:
            continue
        outgoing[edge.src].append(edge.tgt)
        incoming[edge.tgt].append(edge.src)
        outgoing_edge_indexes[edge.src].append(edge_idx)
        incoming_edge_indexes[edge.tgt].append(edge_idx)
        indegree[edge.tgt] += 1

    decision_offsets: Dict[int, float] = {}
    for src, edge_indexes in outgoing_edge_indexes.items():
        if node_map[src].shape != "diamond" or len(edge_indexes) < 2:
            continue
        decision_offsets.update(_assign_decision_branch_offsets([(idx, edges[idx]) for idx in edge_indexes]))

    queue = sorted([nid for nid, deg in indegree.items() if deg == 0], key=order_index.get)
    layer_of: Dict[str, int] = {nid: 0 for nid in queue}
    processed: List[str] = []

    while queue:
        nid = queue.pop(0)
        processed.append(nid)
        base_layer = layer_of.get(nid, 0)
        for target in outgoing.get(nid, []):
            layer_of[target] = max(layer_of.get(target, 0), base_layer + 1)
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
        queue.sort(key=order_index.get)

    if len(processed) < len(nodes):
        max_layer = max(layer_of.values(), default=-1)
        for node in nodes:
            if node.nid not in layer_of:
                max_layer += 1
                layer_of[node.nid] = max_layer
    max_layer = max(layer_of.values(), default=0)

    layers: Dict[int, List[str]] = defaultdict(list)
    for node in nodes:
        layers[layer_of.get(node.nid, 0)].append(node.nid)

    def _initial_sort_key(nid: str) -> Tuple[float, float]:
        node = node_map[nid]
        if node.y is not None:
            return (0.0, float(node.y))
        return (1.0, float(order_index[nid]))

    layer_orders: Dict[int, List[str]] = {}
    for layer_idx in range(max_layer + 1):
        layer_orders[layer_idx] = sorted(layers.get(layer_idx, []), key=_initial_sort_key)

    def _row_positions() -> Dict[str, float]:
        out: Dict[str, float] = {}
        for layer_idx, layer_nodes in layer_orders.items():
            center = _layer_center_offset(len(layer_nodes))
            for rank, nid in enumerate(layer_nodes):
                out[nid] = rank - center
        return out

    def _preferred_rank_from_parents(nid: str, row_pos: Dict[str, float]) -> float:
        edge_indexes = incoming_edge_indexes.get(nid, [])
        if edge_indexes:
            vals = []
            for edge_idx in edge_indexes:
                edge = edges[edge_idx]
                vals.append(row_pos.get(edge.src, 0.0) + decision_offsets.get(edge_idx, 0.0))
            return sum(vals) / len(vals)
        node = node_map[nid]
        if node.y is not None:
            return float(node.y)
        return float(order_index[nid])

    def _preferred_rank_from_children(nid: str, row_pos: Dict[str, float]) -> float:
        edge_indexes = outgoing_edge_indexes.get(nid, [])
        if edge_indexes:
            vals = []
            for edge_idx in edge_indexes:
                edge = edges[edge_idx]
                vals.append(row_pos.get(edge.tgt, 0.0) - decision_offsets.get(edge_idx, 0.0))
            return sum(vals) / len(vals)
        node = node_map[nid]
        if node.y is not None:
            return float(node.y)
        return float(order_index[nid])

    for _ in range(4):
        row_pos = _row_positions()
        for layer_idx in range(1, max_layer + 1):
            layer_orders[layer_idx].sort(
                key=lambda nid: (
                    _preferred_rank_from_parents(nid, row_pos),
                    order_index[nid],
                )
            )
        row_pos = _row_positions()
        for layer_idx in range(max_layer - 1, -1, -1):
            layer_orders[layer_idx].sort(
                key=lambda nid: (
                    _preferred_rank_from_children(nid, row_pos),
                    order_index[nid],
                )
            )

    col_w = 220.0
    row_h = 130.0
    max_rows = max((len(layer_nodes) for layer_nodes in layer_orders.values()), default=1)
    center_y = 40.0 + _layer_center_offset(max_rows) * row_h

    for layer_idx, layer_nodes in layer_orders.items():
        center = _layer_center_offset(len(layer_nodes))
        for rank, nid in enumerate(layer_nodes):
            node = node_map[nid]
            auto_x = 40.0 + layer_idx * col_w
            auto_y = center_y + (rank - center) * row_h
            if node.x is None:
                node.x = auto_x
            if node.y is None:
                node.y = auto_y


def analyze_yobboy_flow(body: str) -> Dict[str, Any]:
    """分析 DSL 的图族/方向/路由特征，供 UI 展示。"""
    nodes, edges = parse_yobboy_flow(body)
    explicit_pos = sum(1 for node in nodes if node.x is not None and node.y is not None)
    _layout_nodes_with_edges(nodes, edges)
    node_map: Dict[str, NodeSpec] = {node.nid: node for node in nodes}
    indegree: Dict[str, int] = {node.nid: 0 for node in nodes}
    outdegree: Dict[str, int] = {node.nid: 0 for node in nodes}
    abs_dx_total = 0.0
    abs_dy_total = 0.0
    for edge in edges:
        if edge.src not in node_map or edge.tgt not in node_map:
            continue
        indegree[edge.tgt] += 1
        outdegree[edge.src] += 1
        src = node_map[edge.src]
        tgt = node_map[edge.tgt]
        abs_dx_total += abs((float(tgt.x or 0) + tgt.w / 2.0) - (float(src.x or 0) + src.w / 2.0))
        abs_dy_total += abs((float(tgt.y or 0) + tgt.h / 2.0) - (float(src.y or 0) + src.h / 2.0))
    root_count = sum(1 for nid in indegree if indegree[nid] == 0)
    leaf_count = sum(1 for nid in outdegree if outdegree[nid] == 0)
    max_in_degree = max(indegree.values(), default=0)
    max_out_degree = max(outdegree.values(), default=0)
    decision_count = sum(1 for node in nodes if node.shape == "diamond")
    edge_count = len(edges)
    node_count = len(nodes)
    is_tree_like = max_in_degree <= 1 and edge_count == max(0, node_count - root_count)
    family = "tree" if decision_count == 0 and node_count >= 3 and is_tree_like and max_out_degree >= 2 else "flow"
    if edge_count <= 1 and explicit_pos == node_count:
        family = "free"
    direction = "LR" if abs_dx_total >= abs_dy_total else "TB"
    if family == "free":
        direction = "manual"
    routing = "layered_orthogonal"
    if family == "tree":
        routing = "tree_bus" if direction == "TB" else "tree_orthogonal"
    elif family == "free":
        routing = "manual_geometry"
    elif decision_count > 0:
        routing = "decision_aware_orthogonal"
    return {
        "family": family,
        "direction": direction,
        "routing": routing,
        "node_count": node_count,
        "edge_count": edge_count,
        "root_count": root_count,
        "leaf_count": leaf_count,
        "decision_count": decision_count,
        "explicit_pos_count": explicit_pos,
        "max_in_degree": max_in_degree,
        "max_out_degree": max_out_degree,
    }


def analyze_model_reply(raw: str) -> Dict[str, Any]:
    src = extract_yobboy_flow_source(raw)
    if not src:
        raise DrawioTextDslError("未找到 yobboy-flow 内容（需要 ```yobboy-flow 围栏或 node/edge/-> 行）")
    return analyze_yobboy_flow(src)


def _build_edge_routes(
    edges: List[EdgeSpec],
    geom: Dict[str, Tuple[float, float, float, float]],
    node_map: Dict[str, NodeSpec],
) -> List[EdgeRouteSpec]:
    routes: List[EdgeRouteSpec] = []
    outgoing: Dict[Tuple[str, str], List[int]] = defaultdict(list)
    incoming: Dict[Tuple[str, str], List[int]] = defaultdict(list)
    source_ordinals: Dict[str, int] = defaultdict(int)

    for idx, edge in enumerate(edges):
        sx, sy, sw, sh = geom[edge.src]
        tx, ty, tw, th = geom[edge.tgt]
        if sx == tx and sy == ty and sw == tw and sh == th:
            routes.append(
                EdgeRouteSpec(
                    exit_side=_SIDE_RIGHT,
                    entry_side=_SIDE_RIGHT,
                    exit_sort_key=0.0,
                    entry_sort_key=0.0,
                    exit_pos=0.28,
                    entry_pos=0.72,
                    is_self_loop=True,
                )
            )
            continue
        scx = sx + sw / 2
        scy = sy + sh / 2
        tcx = tx + tw / 2
        tcy = ty + th / 2
        dx = tcx - scx
        dy = tcy - scy
        ordinal = source_ordinals[edge.src]
        source_ordinals[edge.src] += 1
        decision_exit = _decision_exit_side(node_map[edge.src].shape, edge.label, ordinal, dx, dy)
        if decision_exit:
            exit_side = decision_exit
            entry_side = _entry_side_for_exit(exit_side, dx, dy)
        else:
            exit_side, entry_side = _choose_anchor_sides(sx, sy, sw, sh, tx, ty, tw, th)
        scx = sx + sw / 2
        scy = sy + sh / 2
        tcx = tx + tw / 2
        tcy = ty + th / 2
        routes.append(
            EdgeRouteSpec(
                exit_side=exit_side,
                entry_side=entry_side,
                exit_sort_key=_edge_side_sort_key(exit_side, tcx, tcy),
                entry_sort_key=_edge_side_sort_key(entry_side, scx, scy),
            )
        )
        outgoing[(edge.src, exit_side)].append(idx)
        incoming[(edge.tgt, entry_side)].append(idx)

    for idxs in outgoing.values():
        idxs.sort(key=lambda one: (routes[one].exit_sort_key, routes[one].entry_sort_key, one))
        total = len(idxs)
        for rank, edge_idx in enumerate(idxs):
            routes[edge_idx].exit_pos = _side_port_position(rank, total)

    for idxs in incoming.values():
        idxs.sort(key=lambda one: (routes[one].entry_sort_key, routes[one].exit_sort_key, one))
        total = len(idxs)
        for rank, edge_idx in enumerate(idxs):
            routes[edge_idx].entry_pos = _side_port_position(rank, total)

    return routes


def yobboy_flow_to_mxfile(body: str) -> str:
    """正文 → 完整 mxfile XML 字符串。"""
    nodes, edges = parse_yobboy_flow(body)
    _layout_nodes_with_edges(nodes, edges)
    node_map = {node.nid: node for node in nodes}
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
    routes = _build_edge_routes(edges, geom, node_map)

    for edge_idx, e in enumerate(edges):
        sid = id_map.get(e.src)
        tid = id_map.get(e.tgt)
        if not sid or not tid:
            continue
        eid = str(next_id)
        next_id += 1
        ev = _esc_attr(e.label) if e.label else ""
        vattr = f' value="{ev}"' if ev else ""
        route = routes[edge_idx]
        est = _orthogonal_edge_style(
            route.exit_side,
            route.exit_pos,
            route.entry_side,
            route.entry_pos,
        )
        if route.is_self_loop:
            est += "portConstraintRotation=false;"
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
