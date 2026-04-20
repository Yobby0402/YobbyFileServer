/**
 * Yobboy-flow-v1：类 Mermaid 文本 → draw.io mxfile（浏览器端确定性转换）。
 * 语法须与项目根目录 drawio_text_dsl.py 保持一致。
 */
(function (global) {
    'use strict';

    var KIND_LINE = 'yobboy-flow-v1';
    var KNOWN_SHAPES = {
        rect: true,
        rounded: true,
        diamond: true,
        ellipse: true,
        circle: true,
        parallelogram: true,
    };
    var SHAPE_STYLES = {
        rect: 'rounded=0;whiteSpace=wrap;html=1;spacingLeft=10;spacingRight=10;spacingTop=8;spacingBottom=8;',
        rounded:
            'rounded=1;whiteSpace=wrap;html=1;spacingLeft=10;spacingRight=10;spacingTop=8;spacingBottom=8;',
        diamond: 'rhombus;whiteSpace=wrap;html=1;spacingLeft=6;spacingRight=6;spacingTop=6;spacingBottom=6;',
        ellipse: 'ellipse;whiteSpace=wrap;html=1;spacingLeft=8;spacingRight=8;spacingTop=6;spacingBottom=6;',
        circle: 'ellipse;whiteSpace=wrap;html=1;spacingLeft=8;spacingRight=8;spacingTop=6;spacingBottom=6;',
        parallelogram:
            'shape=parallelogram;perimeter=parallelogramPerimeter;whiteSpace=wrap;html=1;spacingLeft=8;spacingRight=8;spacingTop=6;spacingBottom=6;',
    };
    var EDGE_BASE =
        'edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;' +
        'orthogonal=1;html=1;endArrow=classic;startArrow=none;' +
        'labelBackgroundColor=#ffffff;fontSize=11;fontColor=#333333;';
    var SIDE_LEFT = 'left';
    var SIDE_RIGHT = 'right';
    var SIDE_TOP = 'top';
    var SIDE_BOTTOM = 'bottom';
    var BRANCH_SLOT_SEQUENCE = [0, 1.2, -1.2, 2.4, -2.4, 3.6, -3.6];
    var DECISION_POSITIVE_LABELS = {
        yes: true,
        y: true,
        true: true,
        ok: true,
        pass: true,
        success: true,
        是: true,
        通过: true,
        成功: true,
        继续: true,
        存在: true,
    };
    var DECISION_NEGATIVE_LABELS = {
        no: true,
        n: true,
        false: true,
        fail: true,
        error: true,
        reject: true,
        否: true,
        失败: true,
        异常: true,
        拒绝: true,
        驳回: true,
        不存在: true,
    };
    var DECISION_UP_LABELS = {
        back: true,
        return: true,
        retry: true,
        返回: true,
        回退: true,
        重试: true,
    };

    function clampPort(v) {
        var lo = 0.14;
        var hi = 0.86;
        return Math.max(lo, Math.min(hi, v));
    }

    function sidePortPosition(index, total) {
        if (total <= 1) return 0.5;
        var margin = 0.18;
        return clampPort(margin + (1 - margin * 2) * ((index + 1) / (total + 1)));
    }

    function sidePoint(side, pos) {
        var p = clampPort(pos);
        if (side === SIDE_LEFT) return { x: 0, y: p };
        if (side === SIDE_RIGHT) return { x: 1, y: p };
        if (side === SIDE_TOP) return { x: p, y: 0 };
        return { x: p, y: 1 };
    }

    function normalizeBranchLabel(label) {
        var text = String(label || '')
            .trim()
            .toLowerCase()
            .replace(/[\s:：\-_/()（）\[\]{}<>，。,.!?！？]+/g, '');
        return text;
    }

    function hasBranchKeyword(map, text) {
        if (!text) return false;
        if (map[text]) return true;
        for (var key in map) {
            if (text.indexOf(key) >= 0) return true;
        }
        return false;
    }

    function decisionBranchHint(label) {
        var text = normalizeBranchLabel(label);
        if (!text) return 'neutral';
        if (hasBranchKeyword(DECISION_POSITIVE_LABELS, text)) return 'positive';
        if (hasBranchKeyword(DECISION_NEGATIVE_LABELS, text)) return 'negative';
        if (hasBranchKeyword(DECISION_UP_LABELS, text)) return 'up';
        return 'neutral';
    }

    function pickFirstAvailable(candidates, used) {
        for (var i = 0; i < candidates.length; i++) {
            var slot = String(candidates[i]);
            if (!used[slot]) {
                used[slot] = true;
                return candidates[i];
            }
        }
        var fallback = Object.keys(used).length + 1;
        used[String(fallback)] = true;
        return fallback;
    }

    function assignDecisionBranchOffsets(items, edges) {
        var used = {};
        var assigned = {};
        var buckets = { positive: [], negative: [], up: [], neutral: [] };
        var prefMap = {
            positive: [0, -1.2, 1.2, -2.4, 2.4],
            negative: [1.2, 2.4, -1.2, 3.6, -2.4],
            up: [-1.2, -2.4, 1.2, -3.6, 2.4],
            neutral: BRANCH_SLOT_SEQUENCE.slice(),
        };
        for (var i = 0; i < items.length; i++) {
            var edgeIndex = items[i];
            buckets[decisionBranchHint(edges[edgeIndex].label)].push(edgeIndex);
        }
        ['positive', 'negative', 'up', 'neutral'].forEach(function (hint) {
            for (var i = 0; i < buckets[hint].length; i++) {
                assigned[buckets[hint][i]] = pickFirstAvailable(prefMap[hint], used);
            }
        });
        return assigned;
    }

    function edgeSideSortKey(side, otherCx, otherCy) {
        return side === SIDE_LEFT || side === SIDE_RIGHT ? otherCy : otherCx;
    }

    function chooseAnchorSides(sx, sy, sw, sh, tx, ty, tw, th) {
        var scx = sx + sw / 2;
        var scy = sy + sh / 2;
        var tcx = tx + tw / 2;
        var tcy = ty + th / 2;
        var dx = tcx - scx;
        var dy = tcy - scy;
        var absDx = Math.abs(dx);
        var absDy = Math.abs(dy);

        if (absDx >= absDy * 1.25) {
            return dx >= 0 ? [SIDE_RIGHT, SIDE_LEFT] : [SIDE_LEFT, SIDE_RIGHT];
        }
        if (absDy >= absDx * 1.25) {
            return dy >= 0 ? [SIDE_BOTTOM, SIDE_TOP] : [SIDE_TOP, SIDE_BOTTOM];
        }
        if (absDx >= absDy) {
            return dx >= 0 ? [SIDE_RIGHT, SIDE_LEFT] : [SIDE_LEFT, SIDE_RIGHT];
        }
        return dy >= 0 ? [SIDE_BOTTOM, SIDE_TOP] : [SIDE_TOP, SIDE_BOTTOM];
    }

    function decisionExitSide(shape, label, ordinal, dx, dy) {
        if (shape !== 'diamond') return null;
        var hint = decisionBranchHint(label);
        if (hint === 'positive') {
            return dx >= -40 ? SIDE_RIGHT : dy >= 0 ? SIDE_BOTTOM : SIDE_TOP;
        }
        if (hint === 'negative') {
            return dy < -40 ? SIDE_TOP : SIDE_BOTTOM;
        }
        if (hint === 'up') return SIDE_TOP;
        if (ordinal === 0) return dx >= 0 ? SIDE_RIGHT : SIDE_LEFT;
        if (ordinal === 1) return dy >= 0 ? SIDE_BOTTOM : SIDE_TOP;
        return null;
    }

    function entrySideForExit(exitSide, dx, dy) {
        if (exitSide === SIDE_RIGHT) return dx >= 0 ? SIDE_LEFT : SIDE_RIGHT;
        if (exitSide === SIDE_LEFT) return dx <= 0 ? SIDE_RIGHT : SIDE_LEFT;
        if (exitSide === SIDE_BOTTOM) return dy >= 0 ? SIDE_TOP : SIDE_BOTTOM;
        return dy <= 0 ? SIDE_BOTTOM : SIDE_TOP;
    }

    function orthogonalEdgeStyle(exitSide, exitPos, entrySide, entryPos) {
        var exitPoint = sidePoint(exitSide, exitPos);
        var entryPoint = sidePoint(entrySide, entryPos);
        return (
            EDGE_BASE +
            'exitX=' +
            exitPoint.x +
            ';exitY=' +
            exitPoint.y +
            ';entryX=' +
            entryPoint.x +
            ';entryY=' +
            entryPoint.y +
            ';'
        );
    }

    function escAttr(val) {
        if (val == null) return '';
        return String(val)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function tokenizeLine(line) {
        var tokens = [];
        var i = 0;
        var len = line.length;
        while (i < len) {
            while (i < len && /\s/.test(line[i])) i++;
            if (i >= len) break;
            var c = line[i];
            if (c === '"' || c === "'") {
                var q = c;
                i++;
                var buf = '';
                while (i < len) {
                    if (line[i] === '\\' && i + 1 < len) {
                        buf += line[++i];
                        i++;
                        continue;
                    }
                    if (line[i] === q) {
                        i++;
                        break;
                    }
                    buf += line[i++];
                }
                tokens.push(buf);
                continue;
            }
            var start = i;
            while (i < len && !/\s/.test(line[i])) i++;
            tokens.push(line.slice(start, i));
        }
        return tokens;
    }

    function extractYobboyFlowSource(raw) {
        var text = raw == null ? '' : String(raw).trim();
        if (!text) return '';
        var patterns = [
            /```yobboy-flow\s*([\s\S]*?)```/gi,
            /```flow\s*([\s\S]*?)```/gi,
            /```diagram\s*([\s\S]*?)```/gi,
        ];
        for (var p = 0; p < patterns.length; p++) {
            patterns[p].lastIndex = 0;
            var m = patterns[p].exec(text);
            if (m) return m[1].trim();
        }
        if (/^\s*(node\s+\S|edge\s+\S|\S+\s*->\s*\S+)/m.test(text)) return text;
        return '';
    }

    function parseNodeLine(line, lineno) {
        var rest = line.slice(4).trim();
        var tokens = tokenizeLine(rest);
        if (tokens.length < 1) throw new Error('node 缺少 id（第 ' + lineno + ' 行）');
        var nid = tokens[0];
        if (!/^[\w.-]+$/.test(nid)) throw new Error('非法 node id: ' + nid + '（第 ' + lineno + ' 行）');
        var tail = tokens.slice(1);
        var geom = null;
        var atIx = tail.indexOf('@');
        if (atIx >= 0) {
            var before = tail.slice(0, atIx);
            var after = tail.slice(atIx + 1);
            if (after.length < 4)
                throw new Error('node 的 @ 后需要 4 个数字（第 ' + lineno + ' 行）');
            var x = parseFloat(after[0]);
            var y = parseFloat(after[1]);
            var w = parseFloat(after[2]);
            var h = parseFloat(after[3]);
            if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h))
                throw new Error('@ 后须为数字（第 ' + lineno + ' 行）');
            if (w <= 0 || h <= 0) throw new Error('width/height 须为正数（第 ' + lineno + ' 行）');
            geom = { x: x, y: y, w: w, h: h };
            tail = before;
        }
        var shape = 'rect';
        if (tail.length && KNOWN_SHAPES[String(tail[tail.length - 1]).toLowerCase()]) {
            shape = String(tail[tail.length - 1]).toLowerCase();
            tail = tail.slice(0, -1);
        }
        var label = tail.join(' ').trim();
        return {
            nid: nid,
            label: label || nid,
            shape: shape,
            x: geom ? geom.x : null,
            y: geom ? geom.y : null,
            w: geom ? geom.w : 120,
            h: geom ? geom.h : 60,
        };
    }

    function parseEdgeLine(line, lineno) {
        var rest = line.slice(4).trim();
        var tokens = tokenizeLine(rest);
        if (tokens.length < 3 || tokens[1] !== '->')
            throw new Error('edge 格式应为: edge <from> -> <to> ["标签"]（第 ' + lineno + ' 行）');
        var src = tokens[0];
        var tgt = tokens[2];
        var elabel = tokens.length > 3 ? tokens.slice(3).join(' ').trim() : '';
        return { src: src, tgt: tgt, label: elabel };
    }

    var MERMAID_EDGE = /^(\S+)\s*->\s*(\S+)(?:\s+(.*))?$/;

    function parseMermaidEdgeLine(line, lineno) {
        var m = MERMAID_EDGE.exec(line.trim());
        if (!m) throw new Error('无法解析的连线行（第 ' + lineno + ' 行）');
        var src = m[1];
        var tgt = m[2];
        var rest = (m[3] || '').trim();
        if (src === 'node' || tgt === 'node')
            throw new Error('请使用关键字 node / edge 声明（第 ' + lineno + ' 行）');
        return { src: src, tgt: tgt, label: rest };
    }

    function parseYobboyFlowBody(body) {
        if (!String(body || '').trim()) throw new Error('yobboy-flow 正文为空');
        var lines = String(body).split(/\r?\n/);
        var nodesOrder = [];
        var nodeMap = {};
        var edges = [];
        for (var li = 0; li < lines.length; li++) {
            var lineno = li + 1;
            var s = lines[li].trim();
            if (!s || s.charAt(0) === '#') continue;
            var low = s.toLowerCase();
            if (low.indexOf('kind:') === 0) {
                var v = s.slice(5).trim().toLowerCase();
                if (v && v !== KIND_LINE)
                    throw new Error('不支持的 kind（第 ' + lineno + ' 行），请使用 ' + KIND_LINE + ' 或省略');
                continue;
            }
            if (low.indexOf('node ') === 0) {
                var ns = parseNodeLine(s, lineno);
                if (nodeMap[ns.nid]) throw new Error('重复的 node id: ' + ns.nid + '（第 ' + lineno + ' 行）');
                nodeMap[ns.nid] = ns;
                nodesOrder.push(ns);
                continue;
            }
            if (low.indexOf('edge ') === 0) {
                edges.push(parseEdgeLine(s, lineno));
                continue;
            }
            if (s.indexOf('->') >= 0 && low.indexOf('node') !== 0) {
                edges.push(parseMermaidEdgeLine(s, lineno));
                continue;
            }
            throw new Error('无法识别的行（第 ' + lineno + ' 行）: ' + s.slice(0, 80));
        }
        for (var ei = 0; ei < edges.length; ei++) {
            var e = edges[ei];
            var ends = [e.src, e.tgt];
            for (var u = 0; u < ends.length; u++) {
                var en = ends[u];
                if (!nodeMap[en]) {
                    var im = {
                        nid: en,
                        label: en,
                        shape: 'rounded',
                        x: null,
                        y: null,
                        w: 120,
                        h: 60,
                    };
                    nodeMap[en] = im;
                    nodesOrder.push(im);
                }
            }
        }
        if (!nodesOrder.length && !edges.length) throw new Error('未声明任何 node 或连线');
        return { nodesOrder: nodesOrder, edges: edges, nodeMap: nodeMap };
    }

    function layoutNodes(nodesOrder, edges) {
        var need = [];
        for (var ni = 0; ni < nodesOrder.length; ni++) {
            if (nodesOrder[ni].x == null || nodesOrder[ni].y == null) {
                need.push(nodesOrder[ni]);
            }
        }
        if (!need.length) return;

        // --- 构建图 ---
        var indegree = {};
        var adj = {};
        var incoming = {};
        var outgoingEdgeIndexes = {};
        var incomingEdgeIndexes = {};
        var nodeMap = {};
        var orderIndex = {};
        for (var i = 0; i < nodesOrder.length; i++) {
            var node = nodesOrder[i];
            var id = node.nid;
            nodeMap[id] = node;
            orderIndex[id] = i;
            indegree[id] = 0;
            adj[id] = [];
            incoming[id] = [];
            outgoingEdgeIndexes[id] = [];
            incomingEdgeIndexes[id] = [];
        }

        for (var i = 0; i < edges.length; i++) {
            var e = edges[i];
            if (!adj[e.src] || !incoming[e.tgt]) continue;
            adj[e.src].push(e.tgt);
            incoming[e.tgt].push(e.src);
            outgoingEdgeIndexes[e.src].push(i);
            incomingEdgeIndexes[e.tgt].push(i);
            indegree[e.tgt] = (indegree[e.tgt] || 0) + 1;
        }

        var decisionOffsets = {};
        Object.keys(outgoingEdgeIndexes).forEach(function (src) {
            if (nodeMap[src].shape !== 'diamond' || outgoingEdgeIndexes[src].length < 2) return;
            var assigned = assignDecisionBranchOffsets(outgoingEdgeIndexes[src], edges);
            Object.keys(assigned).forEach(function (edgeIndex) {
                decisionOffsets[edgeIndex] = assigned[edgeIndex];
            });
        });

        // --- Kahn + longest-path 分层 ---
        var queue = [];
        var layerOf = {};
        var processed = [];
        for (var id in indegree) {
            if (indegree[id] === 0) {
                queue.push(id);
                layerOf[id] = 0;
            }
        }
        queue.sort(function (left, right) {
            return orderIndex[left] - orderIndex[right];
        });

        while (queue.length) {
            var u = queue.shift();
            processed.push(u);
            var baseLayer = layerOf[u] || 0;
            var list = adj[u] || [];
            for (var j = 0; j < list.length; j++) {
                var v = list[j];
                layerOf[v] = Math.max(layerOf[v] || 0, baseLayer + 1);
                indegree[v]--;
                if (indegree[v] === 0) {
                    queue.push(v);
                }
            }
            queue.sort(function (left, right) {
                return orderIndex[left] - orderIndex[right];
            });
        }

        if (processed.length < nodesOrder.length) {
            var maxLayer = -1;
            for (var lid in layerOf) {
                if (layerOf[lid] > maxLayer) maxLayer = layerOf[lid];
            }
            for (var pi = 0; pi < nodesOrder.length; pi++) {
                var pendingId = nodesOrder[pi].nid;
                if (layerOf[pendingId] == null) {
                    maxLayer += 1;
                    layerOf[pendingId] = maxLayer;
                }
            }
        }

        var computedMaxLayer = 0;
        for (var nid in layerOf) {
            if (layerOf[nid] > computedMaxLayer) computedMaxLayer = layerOf[nid];
        }

        var layers = {};
        for (var li = 0; li < nodesOrder.length; li++) {
            var layerId = layerOf[nodesOrder[li].nid] || 0;
            if (!layers[layerId]) layers[layerId] = [];
            layers[layerId].push(nodesOrder[li].nid);
        }

        function layerCenterOffset(count) {
            return (count - 1) / 2;
        }

        function initialSortKey(nid) {
            var node = nodeMap[nid];
            if (node.y != null) return [0, Number(node.y)];
            return [1, orderIndex[nid]];
        }

        var layerOrders = {};
        for (var layerIndex = 0; layerIndex <= computedMaxLayer; layerIndex++) {
            var group = (layers[layerIndex] || []).slice();
            group.sort(function (left, right) {
                var leftKey = initialSortKey(left);
                var rightKey = initialSortKey(right);
                if (leftKey[0] !== rightKey[0]) return leftKey[0] - rightKey[0];
                if (leftKey[1] !== rightKey[1]) return leftKey[1] - rightKey[1];
                return orderIndex[left] - orderIndex[right];
            });
            layerOrders[layerIndex] = group;
        }

        function rowPositions() {
            var out = {};
            for (var layerIndex = 0; layerIndex <= computedMaxLayer; layerIndex++) {
                var group = layerOrders[layerIndex] || [];
                var center = layerCenterOffset(group.length);
                for (var rank = 0; rank < group.length; rank++) {
                    out[group[rank]] = rank - center;
                }
            }
            return out;
        }

        function preferredRankFromParents(nid, rowPos) {
            var indexes = incomingEdgeIndexes[nid] || [];
            if (indexes.length) {
                var sum = 0;
                for (var i = 0; i < indexes.length; i++) {
                    var edge = edges[indexes[i]];
                    sum += (rowPos[edge.src] || 0) + (decisionOffsets[indexes[i]] || 0);
                }
                return sum / indexes.length;
            }
            var node = nodeMap[nid];
            if (node.y != null) return Number(node.y);
            return orderIndex[nid];
        }

        function preferredRankFromChildren(nid, rowPos) {
            var indexes = outgoingEdgeIndexes[nid] || [];
            if (indexes.length) {
                var sum = 0;
                for (var i = 0; i < indexes.length; i++) {
                    var edge = edges[indexes[i]];
                    sum += (rowPos[edge.tgt] || 0) - (decisionOffsets[indexes[i]] || 0);
                }
                return sum / indexes.length;
            }
            var node = nodeMap[nid];
            if (node.y != null) return Number(node.y);
            return orderIndex[nid];
        }

        for (var sweep = 0; sweep < 4; sweep++) {
            var forwardRows = rowPositions();
            for (var layerIndex = 1; layerIndex <= computedMaxLayer; layerIndex++) {
                layerOrders[layerIndex].sort(function (left, right) {
                    var leftRank = preferredRankFromParents(left, forwardRows);
                    var rightRank = preferredRankFromParents(right, forwardRows);
                    if (leftRank !== rightRank) return leftRank - rightRank;
                    return orderIndex[left] - orderIndex[right];
                });
            }
            var backwardRows = rowPositions();
            for (var layerIndex = computedMaxLayer - 1; layerIndex >= 0; layerIndex--) {
                layerOrders[layerIndex].sort(function (left, right) {
                    var leftRank = preferredRankFromChildren(left, backwardRows);
                    var rightRank = preferredRankFromChildren(right, backwardRows);
                    if (leftRank !== rightRank) return leftRank - rightRank;
                    return orderIndex[left] - orderIndex[right];
                });
            }
        }

        var colW = 220;
        var rowH = 130;
        var maxRows = 1;
        for (var layerIndex = 0; layerIndex <= computedMaxLayer; layerIndex++) {
            maxRows = Math.max(maxRows, (layerOrders[layerIndex] || []).length);
        }
        var centerY = 40 + layerCenterOffset(maxRows) * rowH;

        for (var layerIndex = 0; layerIndex <= computedMaxLayer; layerIndex++) {
            var group = layerOrders[layerIndex] || [];
            var center = layerCenterOffset(group.length);
            for (var rank = 0; rank < group.length; rank++) {
                var n = nodeMap[group[rank]];
                var autoX = 40 + layerIndex * colW;
                var autoY = centerY + (rank - center) * rowH;
                if (n.x == null) n.x = autoX;
                if (n.y == null) n.y = autoY;
            }
        }
    }

    function buildEdgeRoutes(edges, geom, nodeMap) {
        var routes = [];
        var outgoing = {};
        var incoming = {};
        var sourceOrdinals = {};

        function pushGroup(groupMap, key, edgeIndex) {
            if (!groupMap[key]) groupMap[key] = [];
            groupMap[key].push(edgeIndex);
        }

        for (var i = 0; i < edges.length; i++) {
            var edge = edges[i];
            var sourceGeom = geom[edge.src];
            var targetGeom = geom[edge.tgt];
            var sourceCx = sourceGeom.x + sourceGeom.w / 2;
            var sourceCy = sourceGeom.y + sourceGeom.h / 2;
            var targetCx = targetGeom.x + targetGeom.w / 2;
            var targetCy = targetGeom.y + targetGeom.h / 2;
            var dx = targetCx - sourceCx;
            var dy = targetCy - sourceCy;
            if (
                sourceGeom.x === targetGeom.x &&
                sourceGeom.y === targetGeom.y &&
                sourceGeom.w === targetGeom.w &&
                sourceGeom.h === targetGeom.h
            ) {
                routes.push({
                    exitSide: SIDE_RIGHT,
                    entrySide: SIDE_RIGHT,
                    exitSortKey: 0,
                    entrySortKey: 0,
                    exitPos: 0.28,
                    entryPos: 0.72,
                    isSelfLoop: true,
                });
                continue;
            }
            var ordinal = sourceOrdinals[edge.src] || 0;
            sourceOrdinals[edge.src] = ordinal + 1;
            var exitSide = decisionExitSide(nodeMap[edge.src].shape, edge.label, ordinal, dx, dy);
            var entrySide;
            if (exitSide) {
                entrySide = entrySideForExit(exitSide, dx, dy);
            } else {
                var sides = chooseAnchorSides(
                    sourceGeom.x,
                    sourceGeom.y,
                    sourceGeom.w,
                    sourceGeom.h,
                    targetGeom.x,
                    targetGeom.y,
                    targetGeom.w,
                    targetGeom.h
                );
                exitSide = sides[0];
                entrySide = sides[1];
            }
            routes.push({
                exitSide: exitSide,
                entrySide: entrySide,
                exitSortKey: edgeSideSortKey(exitSide, targetCx, targetCy),
                entrySortKey: edgeSideSortKey(entrySide, sourceCx, sourceCy),
                exitPos: 0.5,
                entryPos: 0.5,
                isSelfLoop: false,
            });
            pushGroup(outgoing, edge.src + '|' + exitSide, i);
            pushGroup(incoming, edge.tgt + '|' + entrySide, i);
        }

        Object.keys(outgoing).forEach(function (key) {
            var group = outgoing[key];
            group.sort(function (left, right) {
                var leftRoute = routes[left];
                var rightRoute = routes[right];
                if (leftRoute.exitSortKey !== rightRoute.exitSortKey) {
                    return leftRoute.exitSortKey - rightRoute.exitSortKey;
                }
                if (leftRoute.entrySortKey !== rightRoute.entrySortKey) {
                    return leftRoute.entrySortKey - rightRoute.entrySortKey;
                }
                return left - right;
            });
            for (var rank = 0; rank < group.length; rank++) {
                routes[group[rank]].exitPos = sidePortPosition(rank, group.length);
            }
        });

        Object.keys(incoming).forEach(function (key) {
            var group = incoming[key];
            group.sort(function (left, right) {
                var leftRoute = routes[left];
                var rightRoute = routes[right];
                if (leftRoute.entrySortKey !== rightRoute.entrySortKey) {
                    return leftRoute.entrySortKey - rightRoute.entrySortKey;
                }
                if (leftRoute.exitSortKey !== rightRoute.exitSortKey) {
                    return leftRoute.exitSortKey - rightRoute.exitSortKey;
                }
                return left - right;
            });
            for (var rank = 0; rank < group.length; rank++) {
                routes[group[rank]].entryPos = sidePortPosition(rank, group.length);
            }
        });

        return routes;
    }

    function yobboyFlowToMxfile(body) {
        var parsed = parseYobboyFlowBody(body);
        layoutNodes(parsed.nodesOrder, parsed.edges);
        var idMap = {};
        var nextId = 2;
        for (var i = 0; i < parsed.nodesOrder.length; i++) {
            idMap[parsed.nodesOrder[i].nid] = String(nextId++);
        }
        var parts = [];
        parts.push('<mxfile host="app.diagrams.net">');
        parts.push('<diagram id="p1" name="Page-1">');
        parts.push('<mxGraphModel><root>');
        parts.push('<mxCell id="0"/>');
        parts.push('<mxCell id="1" parent="0"/>');
        var geom = {};
        for (var gi = 0; gi < parsed.nodesOrder.length; gi++) {
            var gn = parsed.nodesOrder[gi];
            geom[gn.nid] = {
                x: Number(gn.x) || 0,
                y: Number(gn.y) || 0,
                w: Number(gn.w) || 120,
                h: Number(gn.h) || 60,
            };
        }
        var routes = buildEdgeRoutes(parsed.edges, geom, parsed.nodeMap);

        for (var ni = 0; ni < parsed.nodesOrder.length; ni++) {
            var n = parsed.nodesOrder[ni];
            var cid = idMap[n.nid];
            var st = SHAPE_STYLES[n.shape] || SHAPE_STYLES.rect;
            parts.push(
                '<mxCell id="' +
                    cid +
                    '" value="' +
                    escAttr(n.label) +
                    '" style="' +
                    st +
                    '" vertex="1" parent="1">' +
                    '<mxGeometry x="' +
                    (n.x | 0) +
                    '" y="' +
                    (n.y | 0) +
                    '" width="' +
                    (n.w | 0) +
                    '" height="' +
                    (n.h | 0) +
                    '" as="geometry"/>' +
                    '</mxCell>'
            );
        }
        for (var ej = 0; ej < parsed.edges.length; ej++) {
            var e = parsed.edges[ej];
            var sid = idMap[e.src];
            var tid = idMap[e.tgt];
            if (!sid || !tid) continue;
            var eid = String(nextId++);
            var ev = e.label ? escAttr(e.label) : '';
            var vattr = ev ? ' value="' + ev + '"' : '';
            var route = routes[ej];
            var est = orthogonalEdgeStyle(route.exitSide, route.exitPos, route.entrySide, route.entryPos);
            if (route.isSelfLoop) est += 'portConstraintRotation=false;';
            parts.push(
                '<mxCell id="' +
                    eid +
                    '"' +
                    vattr +
                    ' style="' +
                    est +
                    '" edge="1" parent="1" source="' +
                    sid +
                    '" target="' +
                    tid +
                    '">' +
                    '<mxGeometry relative="1" as="geometry"/>' +
                    '</mxCell>'
            );
        }
        parts.push('</root></mxGraphModel>');
        parts.push('</diagram></mxfile>');
        return parts.join('');
    }

    function convertModelReplyToMxfile(raw) {
        var src = extractYobboyFlowSource(raw);
        if (!src)
            throw new Error('未找到 yobboy-flow 内容（需要 ```yobboy-flow 围栏或 node/edge/-> 行）');
        return yobboyFlowToMxfile(src);
    }

    global.YobboyFlow = {
        KIND_LINE: KIND_LINE,
        extractSource: extractYobboyFlowSource,
        parseBody: parseYobboyFlowBody,
        toMxfile: yobboyFlowToMxfile,
        convertReply: convertModelReplyToMxfile,
        /** @returns {{ ok: boolean, xml?: string, error?: string }} */
        tryConvertReply: function (raw) {
            try {
                return { ok: true, xml: convertModelReplyToMxfile(raw) };
            } catch (err) {
                return { ok: false, error: String(err && err.message ? err.message : err) };
            }
        },
    };
})(window);
