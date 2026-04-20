(function (global) {
    'use strict';

    var HIST_KEY = 'yobboy_drawio_ai_hist_v1';
    var MCP_KEY = 'yobboy_drawio_ai_mcp_v1';

    function userDisplayText(content) {
        if (content == null) return '';
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
            var parts = [];
            for (var i = 0; i < content.length; i++) {
                var p = content[i];
                if (p && p.type === 'text') parts.push(p.text || '');
            }
            return parts.join('\n').trim();
        }
        return String(content);
    }

    function toPersistable(messages) {
        return messages.map(function (m) {
            if (m.role !== 'user') {
                var out = { role: m.role, content: m.content };
                if (m.meta && typeof m.meta === 'object') out.meta = m.meta;
                return out;
            }
            var c = m.content;
            if (typeof c === 'string') return { role: 'user', content: c };
            if (Array.isArray(c)) {
                var textParts = [];
                var hadImage = false;
                for (var i = 0; i < c.length; i++) {
                    var p = c[i];
                    if (p && p.type === 'text') textParts.push(p.text || '');
                    if (p && p.type === 'image_url') hadImage = true;
                }
                var joined = textParts.join('\n').trim();
                var note = hadImage ? '\n（本条曾含附图，刷新后需重新上传）' : '';
                return { role: 'user', content: joined + note };
            }
            return { role: 'user', content: String(c || '') };
        });
    }

    function drawioPhaseLabel(phase) {
        var map = {
            preparing: '准备上下文',
            generating: '模型生成',
            generated: '生成完成',
            parsing: '解析文本',
            validating: '校验 XML',
            repairing: '自动修复',
            retrying: '自动重试',
            finalizing: '最终收口',
            summarizing: '汇总结果',
            diffing: '对比变更',
            completed: '生成完成',
        };
        return map[String(phase || '')] || String(phase || '');
    }

    function formatDrawioMeta(meta) {
        if (!meta || typeof meta !== 'object') return '';
        var parts = [];
        if (meta.output) parts.push('输出 ' + (meta.output === 'xml' ? 'XML' : 'yobboy-flow'));
        if (meta.family && meta.family !== 'unknown') parts.push('图族 ' + String(meta.family));
        if (meta.direction && meta.direction !== 'unknown') parts.push('方向 ' + String(meta.direction));
        if (meta.routing && meta.routing !== 'unknown') parts.push('路由 ' + String(meta.routing));
        if (meta.node_count != null) parts.push('节点 ' + Number(meta.node_count || 0));
        if (meta.edge_count != null) parts.push('连线 ' + Number(meta.edge_count || 0));
        return parts.join(' · ');
    }

    function parseSseBlocks(textChunk, carry) {
        var buf = (carry || '') + textChunk;
        var events = [];
        var parts = buf.split('\n\n');
        var incomplete = parts.pop();
        for (var i = 0; i < parts.length; i++) {
            var lines = parts[i].split('\n');
            var evName = 'message';
            var dataStr = '';
            for (var j = 0; j < lines.length; j++) {
                var line = lines[j];
                if (line.indexOf('event:') === 0) evName = line.slice(6).trim();
                else if (line.indexOf('data:') === 0) dataStr += line.slice(5).trim();
            }
            if (dataStr) {
                try {
                    events.push({ event: evName, data: JSON.parse(dataStr) });
                } catch (e) {
                    events.push({ event: evName, data: { raw: dataStr } });
                }
            }
        }
        return { events: events, carry: incomplete };
    }

    function stripBom(s) {
        s = s == null ? '' : String(s);
        if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
        return s.trim();
    }

    /** 若模型把整块 XML 转成了 HTML 实体，尝试还原 */
    function maybeDecodeEntities(s) {
        if (/<mxfile\b/i.test(s)) return s;
        if (!/&lt;mxfile\b/i.test(s) && !/&lt;MXFILE\b/i.test(s)) return s;
        return s
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;/g, "'");
    }

    /**
     * 取首个 <mxfile> 到其对应的第一个 </mxfile>（不用 lastIndexOf，避免吞入后续垃圾或第二份不完整片段导致「diagram / mxfile 标签不匹配」）。
     */
    function extractMxfileGreedy(t) {
        var m = /<mxfile\b/i.exec(t);
        if (!m) return null;
        var sub = t.slice(m.index);
        var lc = sub.toLowerCase();
        var end = lc.indexOf('</mxfile>');
        if (end < 0) return null;
        return sub.slice(0, end + '</mxfile>'.length);
    }

    function extractAllFencedBlocks(t) {
        var re = /```(?:xml|drawio|yobboy-flow|flow|diagram)?\s*([\s\S]*?)```/gi;
        var out = [];
        var m;
        while ((m = re.exec(t)) !== null) {
            out.push(m[1].trim());
        }
        return out;
    }

    function wrapFragment(inner) {
        var g = extractMxfileGreedy(inner);
        if (g) return g;
        var dm = inner.match(/<diagram\b[\s\S]*?<\/diagram>/i);
        if (dm) return '<mxfile>' + dm[0] + '</mxfile>';
        var gm = inner.match(/<mxGraphModel\b[\s\S]*?<\/mxGraphModel>/i);
        if (gm) {
            return (
                '<mxfile><diagram id="ai-page" name="Page-1">' +
                gm[0] +
                '</diagram></mxfile>'
            );
        }
        return null;
    }

    /**
     * draw.io / expat 对裸 & 极敏感（xmlparseentityref: no name）。
     * 将非法实体头的 & 转为 &amp;，跳过已知合法引用。
     */
    function escapeXmlBareAmpersands(xml) {
        if (!xml) return xml;
        var cur = xml;
        for (var pass = 0; pass < 4; pass++) {
            var next = cur.replace(
                /&(?!(?:amp|lt|gt|quot|apos|nbsp);|#[0-9]{1,14};|#x[0-9A-Fa-f]{1,14};)/gi,
                '&amp;'
            );
            if (next === cur) break;
            cur = next;
        }
        return cur;
    }

    /** 在带引号的属性值内查找结束 > */
    function findTagEnd(xml, start) {
        var gt = start;
        var inQuote = null;
        while (gt < xml.length) {
            var c = xml[gt];
            if (inQuote) {
                if (c === inQuote) inQuote = null;
                gt++;
                continue;
            }
            if (c === '"' || c === "'") {
                inQuote = c;
                gt++;
                continue;
            }
            if (c === '>') return gt;
            gt++;
        }
        return -1;
    }

    /**
     * LLM 常在同一标签上重复 edge、vertex、parent 等属性 → Attribute ... redefined。
     * 对每个起始标签按「属性名小写」去重，保留第一次出现。
     */
    function dedupeXmlAttributesOnOpenTags(xml) {
        if (!xml) return xml;
        var i = 0;
        var out = '';
        while (i < xml.length) {
            var lt = xml.indexOf('<', i);
            if (lt < 0) {
                out += xml.slice(i);
                break;
            }
            out += xml.slice(i, lt);
            if (xml[lt + 1] === '/') {
                var ge = xml.indexOf('>', lt);
                if (ge < 0) {
                    out += xml.slice(lt);
                    break;
                }
                out += xml.slice(lt, ge + 1);
                i = ge + 1;
                continue;
            }
            if (xml.slice(lt, lt + 4) === '<!--') {
                var ce = xml.indexOf('-->', lt);
                if (ce < 0) {
                    out += xml.slice(lt);
                    break;
                }
                ce += 2;
                out += xml.slice(lt, ce + 1);
                i = ce + 1;
                continue;
            }
            if (xml.slice(lt, lt + 9) === '<![CDATA[') {
                var cd = xml.indexOf(']]>', lt);
                if (cd < 0) {
                    out += xml.slice(lt);
                    break;
                }
                cd += 2;
                out += xml.slice(lt, cd + 1);
                i = cd + 1;
                continue;
            }
            if (xml[lt + 1] === '?') {
                var pe = xml.indexOf('?>', lt);
                if (pe < 0) {
                    out += xml.slice(lt);
                    break;
                }
                out += xml.slice(lt, pe + 2);
                i = pe + 2;
                continue;
            }
            if (xml[lt + 1] === '!') {
                var fe = findTagEnd(xml, lt + 2);
                if (fe < 0) {
                    out += xml.slice(lt);
                    break;
                }
                out += xml.slice(lt, fe + 1);
                i = fe + 1;
                continue;
            }
            var gt = findTagEnd(xml, lt + 1);
            if (gt < 0) {
                out += xml.slice(lt);
                break;
            }
            var chunk = xml.slice(lt, gt + 1);
            var tm = chunk.match(/^<\s*([a-zA-Z_][\w:.-]*)/);
            if (!tm) {
                out += chunk;
                i = gt + 1;
                continue;
            }
            var tag = tm[1];
            var body = chunk.slice(tm[0].length, chunk.length - 1).trim();
            var selfClose = /\/\s*$/.test(body);
            if (selfClose) body = body.replace(/\/\s*$/, '').trim();
            if (!body) {
                out += chunk;
                i = gt + 1;
                continue;
            }
            var seen = Object.create(null);
            var atr = [];
            var re = /([\w:-]+)\s*=\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s/>]+)/g;
            var m;
            while ((m = re.exec(body)) !== null) {
                var k = m[1].toLowerCase();
                if (seen[k]) continue;
                seen[k] = true;
                atr.push(m[1] + '=' + m[2]);
            }
            if (atr.length === 0) {
                out += chunk;
            } else {
                out += '<' + tag + ' ' + atr.join(' ') + (selfClose ? '/>' : '>');
            }
            i = gt + 1;
        }
        return out;
    }

    /** 非自闭合的 <diagram ...> 数量与 </diagram> 对比，不足则在 </mxfile> 前补齐（模型常漏写 </diagram>）。 */
    function repairMxfileDiagramClosures(xml) {
        if (!xml || !/<mxfile\b/i.test(xml)) return xml;
        var mx = /<mxfile\b[^>]*>/i.exec(xml);
        if (!mx) return xml;
        var closeLower = '</mxfile>';
        var li = xml.toLowerCase().lastIndexOf(closeLower);
        if (li < mx.index + mx[0].length) return xml;
        var innerStart = mx.index + mx[0].length;
        var inner = xml.slice(innerStart, li);

        var diagramOpens = 0;
        var re = /<diagram\b/gi;
        var dm;
        while ((dm = re.exec(inner)) !== null) {
            var gt = inner.indexOf('>', dm.index);
            if (gt < 0) break;
            var openTag = inner.slice(dm.index, gt + 1).replace(/\s/g, '');
            if (!/\/\s*>$/.test(openTag)) diagramOpens++;
        }
        var diagramCloses = (inner.match(/<\/diagram\s*>/gi) || []).length;
        var missing = diagramOpens - diagramCloses;
        if (missing <= 0) return xml;
        var insert = '';
        for (var k = 0; k < missing; k++) insert += '</diagram>';
        return xml.slice(0, li) + insert + xml.slice(li);
    }

    function sanitizeMxfileForDrawio(xml) {
        xml = escapeXmlBareAmpersands(xml);
        xml = dedupeXmlAttributesOnOpenTags(xml);
        xml = repairMxfileDiagramClosures(xml);
        return xml;
    }

    function isWellFormedXml(xml) {
        try {
            var p = new DOMParser();
            var doc = p.parseFromString(xml, 'application/xml');
            return !doc.getElementsByTagName('parsererror').length;
        } catch (e) {
            return false;
        }
    }

    /**
     * 从模型原始回复中提取可交给 draw.io setFileData 的字符串。
     */
    function normalizeDiagramXml(raw) {
        if (raw == null) return null;
        var t = maybeDecodeEntities(stripBom(raw));
        if (!t) return null;

        if (global.YobboyFlow) {
            var tr = global.YobboyFlow.tryConvertReply(t);
            if (tr.ok) {
                var yXml = sanitizeMxfileForDrawio(tr.xml);
                if (isWellFormedXml(yXml)) return yXml;
            }
        }

        var candidates = [];
        var fenced = extractAllFencedBlocks(t);
        for (var i = 0; i < fenced.length; i++) {
            var w = wrapFragment(fenced[i]);
            if (w) candidates.push(w);
        }
        var w = wrapFragment(t);
        if (w) candidates.push(w);

        var best = null;
        for (var j = 0; j < candidates.length; j++) {
            var c = sanitizeMxfileForDrawio(candidates[j]);
            if (!isWellFormedXml(c)) continue;
            if (!best || c.length > best.length) best = c;
        }
        if (best) return best;

        for (var k = 0; k < candidates.length; k++) {
            var c2 = sanitizeMxfileForDrawio(candidates[k]);
            if (!best || c2.length > best.length) best = c2;
        }
        return best;
    }

    /** @deprecated 使用 normalizeDiagramXml */
    function extractMxfile(raw) {
        return normalizeDiagramXml(raw);
    }

    function loadHist() {
        try {
            var raw = localStorage.getItem(HIST_KEY);
            if (!raw) return [];
            var arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    function saveHist(messages) {
        try {
            localStorage.setItem(HIST_KEY, JSON.stringify(toPersistable(messages).slice(-24)));
        } catch (e) {}
    }

    function loadMcpLogs() {
        try {
            var raw = localStorage.getItem(MCP_KEY);
            if (!raw) return [];
            var arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    function saveMcpLogs(items) {
        try {
            localStorage.setItem(MCP_KEY, JSON.stringify((items || []).slice(-80)));
        } catch (e) {}
    }

    function compressImageFile(file, maxSide, quality) {
        maxSide = maxSide || 1280;
        quality = typeof quality === 'number' ? quality : 0.82;
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                URL.revokeObjectURL(url);
                var w = img.naturalWidth || img.width;
                var h = img.naturalHeight || img.height;
                if (!w || !h) {
                    reject(new Error('无效图片尺寸'));
                    return;
                }
                var scale = Math.min(1, maxSide / Math.max(w, h));
                var cw = Math.max(1, Math.round(w * scale));
                var ch = Math.max(1, Math.round(h * scale));
                var canvas = document.createElement('canvas');
                canvas.width = cw;
                canvas.height = ch;
                var ctx = canvas.getContext('2d');
                if (!ctx) {
                    reject(new Error('无法创建画布'));
                    return;
                }
                ctx.drawImage(img, 0, 0, cw, ch);
                try {
                    resolve(canvas.toDataURL('image/jpeg', quality));
                } catch (e) {
                    reject(e);
                }
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('图片解码失败'));
            };
            img.src = url;
        });
    }

    function $(id) {
        return document.getElementById(id);
    }

    /**
     * @param {{ getIframe: function(): HTMLIFrameElement|null, getCurrentXml: function(): string, onApplied?: function() }} opts
     */
    function init(opts) {
        var getIframe = opts.getIframe;
        var getCurrentXml = opts.getCurrentXml;
        var onApplied = opts.onApplied || function () {};

        var dock = $('drawioAiDock');
        var tab = $('drawioAiTab');
        var panel = $('drawioAiPanel');
        var statusEl = $('drawioAiStatus');
        var msgsEl = $('drawioAiMessages');
        var inputEl = $('drawioAiInput');
        var sendBtn = $('drawioAiSend');
        var mcpListEl = $('drawioAiMcpList');
        var attachCb = $('drawioAiAttach');
        var clrBtn = $('drawioAiClearHist');
        var pickBtn = $('drawioAiPickImages');
        var imgInput = $('drawioAiImages');
        var thumbRow = $('drawioAiThumbRow');
        var pendingImageDataUrls = [];
        var maxVisionImages = 4;

        var messages = loadHist();
        var lastAssistantRaw = '';
        var drawioOutputMode = 'text_dsl';
        var streaming = false;
        var mcpLogs = loadMcpLogs();
        var progressChars = 0;
        var progressPhase = '';
        var progressMessage = '';

        function renderMcpLogs() {
            if (!mcpListEl) return;
            mcpListEl.innerHTML = '';
            mcpLogs.slice(-25).reverse().forEach(function (it) {
                var d = document.createElement('div');
                d.className = 'drawio-ai-mcp-item ' + (it.ok ? 'ok' : 'err');
                d.innerHTML =
                    '<div><strong>' +
                    (it.tool || 'unknown') +
                    '</strong> ' +
                    (it.ok ? '✅' : '❌') +
                    '</div>' +
                    '<div style="color:#6b7280;">' +
                    (it.ts || '') +
                    ' · ' +
                    (it.elapsed_ms || 0) +
                    'ms' +
                    (it.trace_id ? ' · ' + it.trace_id : '') +
                    '</div>' +
                    (it.message ? '<div style="color:#6b7280;">' + it.message + '</div>' : '');
                mcpListEl.appendChild(d);
            });
        }

        function addMcpLog(it) {
            if (!it) return;
            mcpLogs.push({
                ts: it.ts || new Date().toLocaleTimeString(),
                tool: it.tool || '',
                ok: !!it.ok,
                elapsed_ms: it.elapsed_ms || 0,
                trace_id: it.trace_id || '',
                message: it.message || '',
            });
            saveMcpLogs(mcpLogs);
            renderMcpLogs();
        }

        function clearPendingImages() {
            pendingImageDataUrls = [];
            if (thumbRow) thumbRow.innerHTML = '';
            if (imgInput) imgInput.value = '';
        }

        function refreshThumbnails() {
            if (!thumbRow) return;
            thumbRow.innerHTML = '';
            for (var i = 0; i < pendingImageDataUrls.length; i++) {
                var im = document.createElement('img');
                im.src = pendingImageDataUrls[i];
                im.alt = '附图 ' + (i + 1);
                im.className = 'drawio-ai-thumb';
                thumbRow.appendChild(im);
            }
        }

        if (pickBtn && imgInput) {
            pickBtn.addEventListener('click', function () {
                imgInput.click();
            });
        }

        if (imgInput) {
            imgInput.addEventListener('change', async function () {
                var files = imgInput.files;
                if (!files || !files.length) return;
                for (var i = 0; i < files.length; i++) {
                    if (pendingImageDataUrls.length >= maxVisionImages) {
                        alert('最多 ' + maxVisionImages + ' 张附图，已忽略多余文件。');
                        break;
                    }
                    try {
                        var dataUrl = await compressImageFile(files[i], 1280, 0.82);
                        pendingImageDataUrls.push(dataUrl);
                    } catch (e) {
                        alert('附图处理失败: ' + (files[i].name || '') + ' — ' + e);
                    }
                }
                refreshThumbnails();
                imgInput.value = '';
            });
        }

        function scrollMsgs() {
            if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight;
        }

        function appendUserBubble(text, thumbUrls) {
            if (!msgsEl) return;
            var d = document.createElement('div');
            d.className = 'drawio-ai-msg drawio-ai-msg--user';
            var t = document.createElement('div');
            t.textContent = text == null ? '' : String(text);
            d.appendChild(t);
            if (thumbUrls && thumbUrls.length) {
                var row = document.createElement('div');
                row.className = 'drawio-ai-thumbs drawio-ai-thumbs--inline';
                for (var k = 0; k < thumbUrls.length; k++) {
                    var im = document.createElement('img');
                    im.src = thumbUrls[k];
                    im.alt = '附图';
                    im.className = 'drawio-ai-thumb';
                    row.appendChild(im);
                }
                d.appendChild(row);
            }
            msgsEl.appendChild(d);
            scrollMsgs();
        }

        function appendAssistantTurn(raw, hint, meta) {
            if (!msgsEl) return;
            var wrap = document.createElement('div');
            wrap.className = 'drawio-ai-msg drawio-ai-msg--assistant';
            var short = document.createElement('div');
            short.className = 'drawio-ai-msg--assistant-short';
            short.textContent =
                hint ||
                '· 已生成图表回复（约 ' +
                (raw && raw.length ? raw.length : 0) +
                ' 字符），可使用下方按钮应用到画布';
            wrap.appendChild(short);
            var metaText = formatDrawioMeta(meta);
            if (metaText) {
                var metaLine = document.createElement('div');
                metaLine.className = 'drawio-ai-msg--assistant-short';
                metaLine.style.opacity = '0.82';
                metaLine.style.fontSize = '0.78rem';
                metaLine.textContent = '· ' + metaText;
                wrap.appendChild(metaLine);
            }
            var row = document.createElement('div');
            row.className = 'drawio-ai-turn-actions';
            var snap = raw;
            var btnApply = document.createElement('button');
            btnApply.type = 'button';
            btnApply.className = 'drawio-ai-apply-turn';
            btnApply.textContent = '应用到画布';
            btnApply.addEventListener('click', function () {
                applyDiagramWithRaw(snap);
            });
            var btnCopy = document.createElement('button');
            btnCopy.type = 'button';
            btnCopy.className = 'drawio-ai-copy-xml';
            btnCopy.textContent = '复制 XML';
            btnCopy.title = '复制规范化后的 mxfile（若无权解析则复制原始回复）';
            btnCopy.addEventListener('click', function () {
                copyMxfileOrRawToClipboard(snap, btnCopy);
            });
            row.appendChild(btnApply);
            row.appendChild(btnCopy);
            wrap.appendChild(row);
            msgsEl.appendChild(wrap);
            scrollMsgs();
        }

        function renderHistory() {
            if (!msgsEl) return;
            msgsEl.innerHTML = '';
            for (var i = 0; i < messages.length; i++) {
                var m = messages[i];
                if (m.role === 'assistant') {
                    appendAssistantTurn(m.content, null, m.meta || null);
                } else {
                    appendUserBubble(userDisplayText(m.content), null);
                }
            }
        }

        function setOpen(open) {
            if (!dock || !tab) return;
            dock.classList.toggle('drawio-ai-dock--open', open);
            tab.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        function toggleDock() {
            setOpen(!dock.classList.contains('drawio-ai-dock--open'));
            if (dock.classList.contains('drawio-ai-dock--open')) refreshStatus();
        }

        async function refreshStatus() {
            if (!statusEl) return;
            try {
                var res = await fetch('/api/local-ai/status');
                var j = await res.json();
                if (!j.success) {
                    statusEl.textContent = '未登录或不可用';
                    return;
                }
                if (j.drawio_output === 'xml' || j.drawio_output === 'text_dsl') {
                    drawioOutputMode = j.drawio_output;
                }
                if (j.loaded) {
                    var outMode = j.drawio_output === 'xml' ? 'XML' : 'yobboy-flow';
                    statusEl.textContent =
                        '已连接 · ' +
                        (j.model_id || j.configured_model || '模型') +
                        ' · Draw.io:' +
                        outMode;
                } else {
                    statusEl.textContent = '未连接 LM Studio：' + (j.load_error || '请加载模型');
                }
            } catch (e) {
                statusEl.textContent = '状态请求失败';
            }
        }

        async function send() {
            if (!inputEl || streaming) return;
            var q = inputEl.value.trim();
            var thumbs = pendingImageDataUrls.slice();
            if (!q && thumbs.length === 0) return;
            var displayText = q || (thumbs.length ? '（附图）' : '');
            inputEl.value = '';

            var userContent;
            if (thumbs.length) {
                userContent = [
                    {
                        type: 'text',
                        text:
                            q ||
                            drawioOutputMode === 'xml'
                                ? '请根据附图生成或还原为 draw.io 图（输出完整 <mxfile>…</mxfile>，勿在 XML 外套 Markdown）。'
                                : '请根据附图生成或还原为 draw.io 图：输出 ```yobboy-flow 围栏内文本（勿输出 <mxfile> XML）。',
                    },
                ];
                for (var ti = 0; ti < thumbs.length; ti++) {
                    userContent.push({ type: 'image_url', image_url: { url: thumbs[ti] } });
                }
            } else {
                userContent = q;
            }
            messages.push({ role: 'user', content: userContent });
            appendUserBubble(displayText, thumbs.length ? thumbs : null);
            clearPendingImages();
            saveHist(messages);

            var payload = {
                mode: 'drawio',
                messages: messages,
            };
            if (attachCb && attachCb.checked) {
                var cx = (getCurrentXml && getCurrentXml()) || '';
                if (cx) payload.current_xml = cx;
            }

            streaming = true;
            lastAssistantRaw = '';
            var generationMeta = null;
            if (sendBtn) sendBtn.disabled = true;
            if (pickBtn) pickBtn.disabled = true;
            var asstEl = document.createElement('div');
            asstEl.className = 'drawio-ai-msg drawio-ai-msg--assistant';
            var loadingBox = document.createElement('div');
            loadingBox.className = 'drawio-ai-loading';
            loadingBox.innerHTML =
                '<div class="drawio-ai-loading-spinner" role="status" aria-label="加载中"></div>' +
                '<div class="drawio-ai-loading-title">正在准备图表生成…</div>' +
                '<div class="drawio-ai-progress-track" aria-hidden="true"><div class="drawio-ai-progress-ind"></div></div>' +
                '<div class="drawio-ai-loading-meta">已用 0.0 秒 · 已接收 0 字符</div>';
            var titleEl = loadingBox.querySelector('.drawio-ai-loading-title');
            var metaEl = loadingBox.querySelector('.drawio-ai-loading-meta');
            asstEl.appendChild(loadingBox);
            if (msgsEl) msgsEl.appendChild(asstEl);
            scrollMsgs();

            var t0 = performance.now();
            var tick = window.setInterval(function () {
                if (!metaEl) return;
                var sec = ((performance.now() - t0) / 1000).toFixed(1);
                var shownChars = Math.max(lastAssistantRaw.length, progressChars);
                if (titleEl) {
                    titleEl.textContent = progressMessage || '正在' + drawioPhaseLabel(progressPhase || 'generating') + '…';
                }
                metaEl.textContent =
                    '已用 ' +
                    sec +
                    ' 秒 · 已接收 ' +
                    shownChars +
                    ' 字符' +
                    (progressPhase ? ' · 阶段: ' + drawioPhaseLabel(progressPhase) : '') +
                    (generationMeta ? ' · ' + formatDrawioMeta(generationMeta) : '');
            }, 200);

            function finishOk() {
                window.clearInterval(tick);
                var snap = lastAssistantRaw;
                if (asstEl && asstEl.parentNode) asstEl.parentNode.removeChild(asstEl);
                var hint =
                    '· 生成完成（约 ' + snap.length + ' 字符），可使用下方按钮应用到画布';
                appendAssistantTurn(snap, hint, generationMeta);
            }

            function finishErr(msg) {
                window.clearInterval(tick);
                asstEl.innerHTML = '';
                var err = document.createElement('div');
                err.style.padding = '10px 12px';
                err.style.color = '#b91c1c';
                err.style.fontSize = '0.85rem';
                err.textContent = msg;
                asstEl.appendChild(err);
            }

            try {
                var res = await fetch('/api/local-ai/chat/stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (!res.ok) {
                    finishErr('请求失败 HTTP ' + res.status);
                    return;
                }
                var reader = res.body.getReader();
                var dec = new TextDecoder();
                var carry = '';
                while (true) {
                    var rd = await reader.read();
                    if (rd.done) break;
                    var chunk = dec.decode(rd.value, { stream: true });
                    var parsed = parseSseBlocks(chunk, carry);
                    carry = parsed.carry;
                    for (var i = 0; i < parsed.events.length; i++) {
                        var e = parsed.events[i];
                        if (e.event === 'token' && e.data && e.data.t) {
                            lastAssistantRaw += e.data.t;
                        } else if (e.event === 'drawio_progress' && e.data) {
                            progressChars = Math.max(progressChars, Number(e.data.received_chars || 0));
                            progressPhase = String(e.data.phase || '');
                            progressMessage = String(e.data.message || '');
                        } else if (e.event === 'drawio_generation_meta' && e.data) {
                            generationMeta = e.data;
                        } else if (e.event === 'mcp_call' && e.data) {
                            addMcpLog(e.data);
                        } else if (e.event === 'drawio_validation' && e.data) {
                            var valid = e.data.valid;
                            var msg = valid ? 'XML 校验通过' : 'XML 校验未通过';
                            if (valid && Array.isArray(e.data.issues)) {
                                var hasLay = e.data.issues.some(function (x) {
                                    return (
                                        x &&
                                        (x.code === 'LAYOUT_OVERLAP' ||
                                            x.code === 'LAYOUT_OUT_OF_BOUNDS')
                                    );
                                });
                                if (hasLay) msg += '（含布局提示，可在编辑器内微调）';
                            }
                            addMcpLog({
                                tool: 'drawio_validate_xml(result)',
                                ok: !!valid,
                                elapsed_ms: 0,
                                trace_id: '',
                                message: msg,
                                ts: new Date().toLocaleTimeString(),
                            });
                        } else if (e.event === 'drawio_summary' && e.data && e.data.summary) {
                            var s = e.data.summary;
                            addMcpLog({
                                tool: 'drawio_summarize_xml(result)',
                                ok: true,
                                elapsed_ms: 0,
                                trace_id: '',
                                message:
                                    '页 ' +
                                    (s.page_count || 0) +
                                    ' · 节点 ' +
                                    (s.vertex_count || 0) +
                                    ' · 连线 ' +
                                    (s.edge_count || 0),
                                ts: new Date().toLocaleTimeString(),
                            });
                        } else if (e.event === 'drawio_diff' && e.data && e.data.diff) {
                            var d = e.data.diff;
                            addMcpLog({
                                tool: 'drawio_diff_summary(result)',
                                ok: true,
                                elapsed_ms: 0,
                                trace_id: '',
                                message:
                                    '新增 ' +
                                    (d.cell_added || 0) +
                                    ' / 删除 ' +
                                    (d.cell_removed || 0) +
                                    ' · 边变化 ' +
                                    (d.edge_delta || 0),
                                ts: new Date().toLocaleTimeString(),
                            });
                        } else if (e.event === 'drawio_retry' && e.data) {
                            addMcpLog({
                                tool: 'drawio_feedback_loop',
                                ok: true,
                                elapsed_ms: 0,
                                trace_id: '',
                                message:
                                    '自动重试第 ' +
                                    String(e.data.attempt || '?') +
                                    ' 轮（原因: ' +
                                    String(e.data.reason || 'unknown') +
                                    '）',
                                ts: new Date().toLocaleTimeString(),
                            });
                        } else if (e.event === 'error' && e.data) {
                            if (e.data && e.data.details && Array.isArray(e.data.details.issues)) {
                                addMcpLog({
                                    tool: 'drawio_validation(final)',
                                    ok: false,
                                    elapsed_ms: 0,
                                    trace_id: '',
                                    message:
                                        '最终未通过校验：' +
                                        e.data.details.issues
                                            .map(function (x) {
                                                return (x && x.code) || 'ISSUE';
                                            })
                                            .slice(0, 6)
                                            .join(', '),
                                    ts: new Date().toLocaleTimeString(),
                                });
                            }
                            finishErr('[错误] ' + (e.data.message || JSON.stringify(e.data)));
                            streaming = false;
                            if (sendBtn) sendBtn.disabled = false;
                            if (pickBtn) pickBtn.disabled = false;
                            return;
                        }
                    }
                }
                messages.push({ role: 'assistant', content: lastAssistantRaw, meta: generationMeta || undefined });
                saveHist(messages);
                finishOk();
            } catch (err) {
                finishErr(String(err));
            } finally {
                window.clearInterval(tick);
                streaming = false;
                progressChars = 0;
                progressPhase = '';
                progressMessage = '';
                if (sendBtn) sendBtn.disabled = false;
                if (pickBtn) pickBtn.disabled = false;
            }
        }

        function fallbackCopyTextToClipboard(text) {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            try {
                document.execCommand('copy');
            } catch (e1) {}
            document.body.removeChild(ta);
        }

        /** @param {HTMLButtonElement|null} feedBtn 可选：短暂显示「已复制」 */
        function copyMxfileOrRawToClipboard(raw, feedBtn) {
            var xml = normalizeDiagramXml(raw);
            var text = xml ? sanitizeMxfileForDrawio(xml) : raw == null ? '' : String(raw);
            if (!text) {
                alert('没有可复制的内容。');
                return;
            }
            var done = function () {
                if (!feedBtn) return;
                var prev = feedBtn.textContent;
                feedBtn.textContent = '已复制';
                feedBtn.disabled = true;
                window.setTimeout(function () {
                    feedBtn.textContent = prev;
                    feedBtn.disabled = false;
                }, 1600);
            };
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(done).catch(function () {
                    fallbackCopyTextToClipboard(text);
                    done();
                });
            } else {
                fallbackCopyTextToClipboard(text);
                done();
            }
        }

        function applyDiagramWithRaw(raw) {
            var xml = normalizeDiagramXml(raw);
            if (!xml) {
                alert(
                    '未能得到可用的图表。\n\n可能原因：\n1) 当前为 yobboy-flow 模式时，回复中缺少 ```yobboy-flow 围栏或语法错误；\n2) XML 模式时缺少完整 <mxfile>…</mxfile> 或输出被截断；\n3) 特殊字符导致解析失败。\n\n可提高 LM Studio 输出上限，或在程序设置中将 Draw.io AI 输出格式改为 yobboy-flow（推荐）后重试。'
                );
                return;
            }
            xml = sanitizeMxfileForDrawio(xml);
            if (!isWellFormedXml(xml)) {
                if (
                    !confirm(
                        '提取到的 XML 在浏览器里校验未通过，仍尝试载入 draw.io（可能继续提示「非绘图文件」）。是否继续？'
                    )
                ) {
                    return;
                }
            }
            if (!/<mxfile\b/i.test(xml) || !/<\/mxfile>/i.test(xml)) {
                alert('内容缺少完整 mxfile 根节点。');
                return;
            }
            var iframe = getIframe && getIframe();
            if (!iframe || !iframe.contentWindow) {
                alert('编辑器未就绪');
                return;
            }
            try {
                var loadMsg = JSON.stringify({ action: 'load', xml: xml, autosave: 1 });
                iframe.contentWindow.postMessage(loadMsg, '*');
                onApplied();
            } catch (e) {
                alert('载入失败: ' + e);
            }
        }

        function clearHist() {
            if (!confirm('清空本页 AI 对话历史？')) return;
            messages = [];
            saveHist(messages);
            renderHistory();
            lastAssistantRaw = '';
            clearPendingImages();
        }

        if (tab) tab.addEventListener('click', toggleDock);
        if (sendBtn) sendBtn.addEventListener('click', send);
        if (clrBtn) clrBtn.addEventListener('click', clearHist);
        if (inputEl) {
            inputEl.addEventListener('keydown', function (ev) {
                if (ev.key === 'Enter' && !ev.shiftKey) {
                    ev.preventDefault();
                    send();
                }
            });
        }

        renderHistory();
        renderMcpLogs();
        refreshStatus();
    }

    global.DrawioAiPanel = {
        init: init,
        normalizeDiagramXml: normalizeDiagramXml,
        extractMxfile: extractMxfile,
        sanitizeMxfileForDrawio: sanitizeMxfileForDrawio,
    };
})(window);
