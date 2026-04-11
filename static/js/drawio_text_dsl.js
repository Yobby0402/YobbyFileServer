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

    function clampPort(v) {
        var lo = 0.14;
        var hi = 0.86;
        return Math.max(lo, Math.min(hi, v));
    }

    function staggerDelta(portIndex) {
        var seq = [0, -0.1, 0.1, -0.18, 0.18, -0.06, 0.06];
        return seq[portIndex % seq.length];
    }

    function orthogonalEdgeStyle(sx, sy, sw, sh, tx, ty, tw, th, portIndex) {
        var scx = sx + sw / 2;
        var tcx = tx + tw / 2;
        var off = staggerDelta(portIndex);

        if (sx === tx && sy === ty && sw === tw && sh === th) {
            return (
                EDGE_BASE +
                'exitX=1;exitY=0.28;entryX=1;entryY=0.72;portConstraintRotation=false;'
            );
        }

        var ex, ey, ix, iy;
        if (tcx >= scx) {
            ex = 1;
            ey = clampPort(0.5 + off);
            ix = 0;
            iy = clampPort(0.5 - off);
        } else {
            ex = 0;
            ey = clampPort(0.5 - off);
            ix = 1;
            iy = clampPort(0.5 + off);
        }
        return EDGE_BASE + 'exitX=' + ex + ';exitY=' + ey + ';entryX=' + ix + ';entryY=' + iy + ';';
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
        // --- 构建图 ---
        var indegree = {};
        var adj = {};
        for (var i = 0; i < nodesOrder.length; i++) {
            var id = nodesOrder[i].nid;
            indegree[id] = 0;
            adj[id] = [];
        }
    
        for (var i = 0; i < edges.length; i++) {
            var e = edges[i];
            adj[e.src].push(e.tgt);
            indegree[e.tgt] = (indegree[e.tgt] || 0) + 1;
        }
    
        // --- Kahn 拓扑分层 ---
        var layers = [];
        var queue = [];
    
        for (var id in indegree) {
            if (indegree[id] === 0) queue.push(id);
        }
    
        while (queue.length) {
            var nextQueue = [];
            var layer = [];
    
            for (var i = 0; i < queue.length; i++) {
                var u = queue[i];
                layer.push(u);
                var list = adj[u] || [];
                for (var j = 0; j < list.length; j++) {
                    var v = list[j];
                    indegree[v]--;
                    if (indegree[v] === 0) nextQueue.push(v);
                }
            }
    
            layers.push(layer);
            queue = nextQueue;
        }
    
        // --- fallback（有环图） ---
        if (!layers.length) {
            layers = [nodesOrder.map(n => n.nid)];
        }
    
        // --- 设置坐标 ---
        var colW = 220;
        var rowH = 120;
    
        var nodeMap = {};
        for (var i = 0; i < nodesOrder.length; i++) {
            nodeMap[nodesOrder[i].nid] = nodesOrder[i];
        }
    
        for (var col = 0; col < layers.length; col++) {
            var layer = layers[col];
            for (var row = 0; row < layer.length; row++) {
                var n = nodeMap[layer[row]];
                if (n.x == null) {
                    n.x = 60 + col * colW;
                    n.y = 60 + row * rowH;
                }
            }
        }
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
        var outPort = {};

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
            var gs = geom[e.src];
            var gt = geom[e.tgt];
            var pi = outPort[e.src] || 0;
            outPort[e.src] = pi + 1;
            var est = orthogonalEdgeStyle(gs.x, gs.y, gs.w, gs.h, gt.x, gt.y, gt.w, gt.h, pi);
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
