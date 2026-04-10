(function () {
    'use strict';

    var STORAGE_KEY = 'yobboy_local_ai_hist_v1';
    var MCP_LOG_KEY = 'yobboy_local_ai_mcp_logs_v1';
    var PENDING_PATCH_KEY = 'yobboy_local_ai_pending_patch_v1';
    var LAYOUT_KEY = 'yobboy_local_ai_panel_layout_v1';
    var MODE_KEY = 'yobboy_local_ai_mode_v1';

    function $(id) {
        return document.getElementById(id);
    }

    function assistantMarkdownRoot(msgEl) {
        if (!msgEl) return null;
        return msgEl.querySelector('.local-ai-md');
    }

    function renderAssistantMarkdown(inner, rawText) {
        if (!inner) return;
        var t = rawText == null ? '' : String(rawText);
        if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
            try {
                inner.innerHTML = DOMPurify.sanitize(marked.parse(t));
                return;
            } catch (err) {}
        }
        inner.textContent = t;
    }

    function setAssistantPlain(inner, rawText) {
        if (!inner) return;
        inner.textContent = rawText == null ? '' : String(rawText);
    }

    function loadHistory() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            var arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    function saveHistory(messages) {
        try {
            var trimmed = messages.slice(-40);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
        } catch (e) {}
    }

    function loadMcpLogs() {
        try {
            var raw = localStorage.getItem(MCP_LOG_KEY);
            if (!raw) return [];
            var arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr : [];
        } catch (e) {
            return [];
        }
    }

    function saveMcpLogs(items) {
        try {
            localStorage.setItem(MCP_LOG_KEY, JSON.stringify((items || []).slice(-120)));
        } catch (e) {}
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

    var currentStreamAbort = null;
    var isGenerating = false;

    function setGeneratingState(on) {
        isGenerating = !!on;
        var panel = $('localAiPanel');
        var fab = $('localAiOpenBtn');
        var badge = $('localAiGeneratingBadge');
        var sendBtn = $('localAiSendBtn');
        var stopBtn = $('localAiStopBtn');
        if (panel) panel.classList.toggle('local-ai-panel--generating', isGenerating);
        if (fab) fab.classList.toggle('local-ai-fab--busy', isGenerating);
        if (badge) badge.hidden = !isGenerating;
        if (sendBtn) sendBtn.disabled = isGenerating;
        if (stopBtn) stopBtn.style.display = isGenerating ? '' : 'none';
    }

    async function refreshStatus() {
        var el = $('localAiStatusLine');
        var ramFill = $('localAiRamFill');
        var ramCap = $('localAiRamCaption');
        var ramTrack = $('localAiRamTrack');
        var vramRow = $('localAiVramRow');
        var vramFill = $('localAiVramFill');
        var vramCap = $('localAiVramCaption');
        var vramTrack = $('localAiVramTrack');
        try {
            var res = await fetch('/api/local-ai/status');
            var j = await res.json();
            if (!j.success) {
                if (el) el.textContent = '未登录或状态不可用';
                return;
            }
            var bits = [
                j.loaded ? 'LM Studio 已连接' : 'LM Studio 未连接',
                j.model_id ? '模型 ' + j.model_id : '模型未选择',
                j.api_base_url ? j.api_base_url : 'API 未配置',
            ];
            if (j.gpu_name) bits.push(j.gpu_name);
            if (!j.loaded && j.load_error) bits.push(j.load_error);
            if (el) el.textContent = bits.join(' · ');

            var ramPct = j.ram_percent;
            if ((ramPct == null || ramPct === '') && j.ram_total_mb > 0) {
                ramPct = (Number(j.ram_used_mb) / Number(j.ram_total_mb)) * 100;
            }
            if (ramFill && ramTrack) {
                var rp = Math.min(100, Math.max(0, Number(ramPct) || 0));
                ramFill.style.width = rp + '%';
                ramTrack.setAttribute('aria-valuenow', String(Math.round(rp)));
            }
            if (ramCap) {
                ramCap.textContent =
                    j.ram_used_mb != null && j.ram_total_mb != null
                        ? j.ram_used_mb + '/' + j.ram_total_mb + ' MB'
                        : '—';
            }

            if (vramRow && vramFill && vramCap && vramTrack) {
                if (j.vram_total_mb != null && Number(j.vram_total_mb) > 0) {
                    vramRow.hidden = false;
                    var vp = (Number(j.vram_used_mb) / Number(j.vram_total_mb)) * 100;
                    vp = Math.min(100, Math.max(0, vp));
                    vramFill.style.width = vp + '%';
                    vramTrack.setAttribute('aria-valuenow', String(Math.round(vp)));
                    vramCap.textContent = j.vram_used_mb + '/' + j.vram_total_mb + ' MB';
                } else {
                    vramRow.hidden = true;
                }
            }
        } catch (e) {
            if (el) el.textContent = '状态请求失败';
        }
    }

    function getLocalAiMode() {
        var seg = $('localAiModeSeg');
        if (!seg) return 'general';
        var a = seg.querySelector('.local-ai-mode-btn.active');
        return a ? a.getAttribute('data-mode') || 'general' : 'general';
    }

    function setLocalAiMode(mode) {
        if (['general', 'knowledge', 'todo'].indexOf(mode) < 0) mode = 'general';
        var seg = $('localAiModeSeg');
        if (!seg) return;
        var btns = seg.querySelectorAll('.local-ai-mode-btn');
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle('active', btns[i].getAttribute('data-mode') === mode);
        }
        try {
            localStorage.setItem(MODE_KEY, mode);
        } catch (e) {}
        onModeChange();
    }

    function applySavedLayout(panel) {
        if (!panel || window.matchMedia('(max-width: 768px)').matches) return;
        try {
            var raw = localStorage.getItem(LAYOUT_KEY);
            if (!raw) return;
            var r = JSON.parse(raw);
            if (typeof r.left !== 'number' || typeof r.top !== 'number') return;
            panel.style.left = r.left + 'px';
            panel.style.top = r.top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            if (typeof r.width === 'number' && r.width >= 260) panel.style.width = r.width + 'px';
            if (typeof r.height === 'number' && r.height >= 240) panel.style.height = r.height + 'px';
        } catch (e) {}
    }

    function savePanelLayout(panel) {
        if (!panel || !panel.classList.contains('visible')) return;
        if (window.matchMedia('(max-width: 768px)').matches) return;
        var br = panel.getBoundingClientRect();
        try {
            localStorage.setItem(
                LAYOUT_KEY,
                JSON.stringify({
                    left: Math.round(br.left),
                    top: Math.round(br.top),
                    width: Math.round(br.width),
                    height: Math.round(br.height),
                })
            );
        } catch (e) {}
    }

    function resetPanelLayout(panel) {
        if (!panel) return;
        try {
            localStorage.removeItem(LAYOUT_KEY);
        } catch (e) {}
        panel.style.left = '';
        panel.style.top = '';
        panel.style.width = '';
        panel.style.height = '';
        panel.style.right = '';
        panel.style.bottom = '';
    }

    function initPanelDrag(panel, handle) {
        if (!panel || !handle) return;
        var sx,
            sy,
            sl,
            st,
            sw,
            sh;
        handle.addEventListener('mousedown', function (e) {
            if (e.button !== 0) return;
            if (e.target.closest('button')) return;
            sx = e.clientX;
            sy = e.clientY;
            var r = panel.getBoundingClientRect();
            sl = r.left;
            st = r.top;
            sw = r.width;
            sh = r.height;
            panel.style.left = sl + 'px';
            panel.style.top = st + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.width = sw + 'px';
            panel.style.height = sh + 'px';

            function mm(ev) {
                panel.style.left = sl + (ev.clientX - sx) + 'px';
                panel.style.top = st + (ev.clientY - sy) + 'px';
            }
            function mu() {
                document.removeEventListener('mousemove', mm);
                document.removeEventListener('mouseup', mu);
                savePanelLayout(panel);
            }
            document.addEventListener('mousemove', mm);
            document.addEventListener('mouseup', mu);
            e.preventDefault();
        });
    }

    function appendMsg(role, text) {
        var box = $('localAiMessages');
        if (!box) return null;
        var d = document.createElement('div');
        d.className = 'local-ai-msg ' + (role === 'user' ? 'user' : 'assistant');
        if (role === 'user') {
            d.textContent = text;
        } else {
            var inner = document.createElement('div');
            inner.className = 'local-ai-md markdown-body';
            d.appendChild(inner);
            renderAssistantMarkdown(inner, text);
        }
        box.appendChild(d);
        box.scrollTop = box.scrollHeight;
        return d;
    }

    function renderHistory(messages) {
        var box = $('localAiMessages');
        if (!box) return;
        box.innerHTML = '';
        messages.forEach(function (m) {
            appendMsg(m.role, m.content);
        });
    }

    function pushAssistantHistory(text) {
        if (!text || !String(text).trim()) return;
        try {
            var hs = loadHistory();
            hs.push({ role: 'assistant', content: String(text) });
            saveHistory(hs);
        } catch (e) {}
    }

    function togglePanel(show) {
        var p = $('localAiPanel');
        var b = $('localAiBackdrop');
        if (!p) return;
        if (show) {
            p.classList.add('visible');
            if (b) b.classList.add('visible');
            refreshStatus();
        } else {
            p.classList.remove('visible');
            if (b) b.classList.remove('visible');
        }
    }

    async function sendStream(messages, mode, forceMutate) {
        var assistantEl = appendMsg('assistant', '');
        var inner = assistantMarkdownRoot(assistantEl);
        var full = '';
        var ctl = new AbortController();
        currentStreamAbort = ctl;
        setGeneratingState(true);
        try {
            var res = await fetch('/api/local-ai/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: ctl.signal,
                body: JSON.stringify({
                    messages: messages,
                    mode: mode,
                    force_todo_mutate: !!forceMutate,
                }),
            });
            if (!res.ok) {
                setAssistantPlain(inner, '请求失败: HTTP ' + res.status);
                return full;
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
                        full += e.data.t;
                        setAssistantPlain(inner, full);
                    } else if (e.event === 'todo_patch') {
                        if (!full.trim() && assistantEl && assistantEl.parentNode) {
                            assistantEl.parentNode.removeChild(assistantEl);
                        }
                        handleTodoPatch(e.data);
                    } else if (e.event === 'mcp_call' && e.data) {
                        addMcpLog(e.data);
                    } else if (e.event === 'error' && e.data) {
                        full += '\n[错误] ' + (e.data.message || JSON.stringify(e.data));
                        setAssistantPlain(inner, full);
                    }
                }
                var box = $('localAiMessages');
                if (box) box.scrollTop = box.scrollHeight;
            }
        } catch (err) {
            if (!(err && err.name === 'AbortError')) {
                full += '\n[错误] ' + ((err && err.message) || String(err));
                setAssistantPlain(inner, full);
            } else if (!full.trim()) {
                full = '已停止生成。';
                setAssistantPlain(inner, full);
            }
        } finally {
            currentStreamAbort = null;
            setGeneratingState(false);
        }
        renderAssistantMarkdown(inner, full);
        return full;
    }

    var pendingPatchOps = null;
    var pendingPatchRefQuestion = '';
    var pendingPatchConfirmToken = '';
    var pendingPatchSummary = '';

    function persistPendingPatch() {
        try {
            if (!pendingPatchOps || !pendingPatchOps.length) {
                localStorage.removeItem(PENDING_PATCH_KEY);
                refreshPendingPatchHint();
                return;
            }
            localStorage.setItem(
                PENDING_PATCH_KEY,
                JSON.stringify({
                    ops: pendingPatchOps,
                    ref_question: pendingPatchRefQuestion || '',
                    confirm_token: pendingPatchConfirmToken || '',
                    summary: pendingPatchSummary || '',
                })
            );
        } catch (e) {}
        refreshPendingPatchHint();
    }

    function restorePendingPatch() {
        try {
            var raw = localStorage.getItem(PENDING_PATCH_KEY);
            if (!raw) {
                refreshPendingPatchHint();
                return;
            }
            var one = JSON.parse(raw);
            if (!one || !Array.isArray(one.ops) || !one.ops.length) {
                refreshPendingPatchHint();
                return;
            }
            pendingPatchOps = one.ops;
            pendingPatchRefQuestion = one.ref_question || '';
            pendingPatchConfirmToken = one.confirm_token || '';
            pendingPatchSummary = one.summary || '';
        } catch (e) {}
        refreshPendingPatchHint();
        renderOpsEditor();
    }

    function refreshPendingPatchHint() {
        var btn = $('localAiPendingPatchBtn');
        var fab = $('localAiOpenBtn');
        var hasPending = !!(pendingPatchOps && pendingPatchOps.length);
        if (btn) {
            btn.classList.toggle('visible', hasPending);
            btn.textContent = hasPending ? '待执行操作（' + pendingPatchOps.length + '）' : '待执行操作';
        }
        if (fab) fab.classList.toggle('local-ai-fab--pending', hasPending);
    }

    function openPendingPatchModal() {
        if (!pendingPatchOps || !pendingPatchOps.length) return;
        ensureRefCache().finally(function () {
            renderOpsEditor();
        });
        $('localAiPatchSummary').textContent = pendingPatchSummary || '有待确认的操作';
        renderOpsEditor();
        var ta = $('localAiPatchOpsJson');
        if (ta) {
            try {
                ta.value = JSON.stringify(pendingPatchOps, null, 2);
            } catch (e) {}
        }
        var modalEl = $('localAiTodoPatchModal');
        if (typeof bootstrap !== 'undefined' && modalEl) {
            var modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            modal.show();
        }
    }

    function addMcpLog(item) {
        var list = loadMcpLogs();
        list.push({
            ts: item.ts || new Date().toISOString(),
            tool: item.tool || '',
            ok: !!item.ok,
            elapsed_ms: item.elapsed_ms || 0,
            trace_id: item.trace_id || '',
            message: item.message || '',
        });
        saveMcpLogs(list);
        renderMcpLogs();
    }

    function renderMcpLogs() {
        var box = $('localAiMcpList');
        if (!box) return;
        var list = loadMcpLogs();
        box.innerHTML = '';
        list.slice(-30).reverse().forEach(function (it) {
            var d = document.createElement('div');
            d.className = 'local-ai-mcp-item ' + (it.ok ? 'ok' : 'err');
            var time = new Date(it.ts || Date.now()).toLocaleTimeString();
            d.innerHTML =
                '<div><strong>' +
                (it.tool || 'unknown') +
                '</strong> ' +
                (it.ok ? '✅' : '❌') +
                '</div>' +
                '<div class="local-ai-mcp-meta">' +
                time +
                ' · ' +
                (it.elapsed_ms || 0) +
                'ms' +
                (it.trace_id ? ' · ' + it.trace_id : '') +
                '</div>' +
                (it.message ? '<div class="local-ai-mcp-meta">' + String(it.message) + '</div>' : '');
            box.appendChild(d);
        });
    }

    var OP_OPTIONS = [
        'create_project',
        'update_project',
        'archive_project',
        'delete_project',
        'create_task',
        'update_task',
        'delete_task',
        'add_task_comment',
        'delete_task_comment',
    ];
    var OP_LABELS = {
        create_project: '创建项目',
        update_project: '更新项目',
        archive_project: '归档项目',
        delete_project: '删除项目',
        create_task: '创建任务',
        update_task: '更新任务',
        delete_task: '删除任务',
        add_task_comment: '添加评论',
        delete_task_comment: '删除评论',
    };
    var REF_CACHE = {
        loaded: false,
        projects: [],
        tasksByProject: {},
    };

    var OP_FIELD_MAP = {
        create_project: [
            { key: 'name', label: '项目名', type: 'text', placeholder: '例如：测试项目' },
            { key: 'color', label: '颜色', type: 'text', placeholder: '#4facfe' },
        ],
        update_project: [
            { key: 'project_id', label: '项目', type: 'project_ref', placeholder: '项1' },
            { key: 'name', label: '新项目名', type: 'text' },
            { key: 'color', label: '颜色', type: 'text' },
            { key: 'phase', label: '阶段', type: 'text' },
            { key: 'archived', label: '归档', type: 'bool' },
            { key: 'show_in_report', label: '周报显示', type: 'bool' },
        ],
        archive_project: [{ key: 'project_id', label: '项目', type: 'project_ref', placeholder: '项1' }],
        delete_project: [{ key: 'project_id', label: '项目', type: 'project_ref', placeholder: '项1' }],
        create_task: [
            { key: 'project_id', label: '项目', type: 'project_ref', placeholder: '项1' },
            { key: 'summary', label: '任务标题', type: 'text' },
            { key: 'description', label: '描述', type: 'textarea' },
            { key: 'priority', label: '优先级', type: 'int', placeholder: '1-5' },
            { key: 'due_date', label: '截止日', type: 'text', placeholder: 'YYYY-MM-DD' },
            { key: 'progress', label: '进度', type: 'int', placeholder: '0-100' },
        ],
        update_task: [
            { key: 'project_id', label: '项目', type: 'project_ref', placeholder: '项1' },
            { key: 'task_id', label: '任务', type: 'task_ref', placeholder: '项1·任1' },
            { key: 'summary', label: '任务标题', type: 'text' },
            { key: 'description', label: '描述', type: 'textarea' },
            { key: 'priority', label: '优先级', type: 'int' },
            { key: 'due_date', label: '截止日', type: 'text', placeholder: 'YYYY-MM-DD' },
            { key: 'progress', label: '进度', type: 'int' },
            { key: 'task_type', label: '任务类型', type: 'text' },
            { key: 'weekly_plan', label: '周计划', type: 'textarea' },
            { key: 'conclusion', label: '结论', type: 'textarea' },
            { key: 'show_in_report', label: '周报显示', type: 'bool' },
        ],
        delete_task: [
            { key: 'project_id', label: '项目', type: 'project_ref', placeholder: '项1' },
            { key: 'task_id', label: '任务', type: 'task_ref', placeholder: '项1·任1' },
        ],
        add_task_comment: [
            { key: 'project_id', label: '项目', type: 'project_ref' },
            { key: 'task_id', label: '任务', type: 'task_ref' },
            { key: 'text', label: '评论内容', type: 'textarea' },
        ],
        delete_task_comment: [
            { key: 'project_id', label: '项目', type: 'project_ref' },
            { key: 'task_id', label: '任务', type: 'task_ref' },
            { key: 'comment_id', label: '评论引用', type: 'text', placeholder: '项1·任1·评1' },
        ],
    };

    function _opDefault(kind) {
        var op = { op: kind || 'create_task' };
        var defs = OP_FIELD_MAP[op.op] || [];
        defs.forEach(function (f) {
            if (f.type === 'bool') op[f.key] = false;
        });
        return op;
    }

    function _opFieldValueToText(v) {
        if (v == null) return '';
        return String(v);
    }

    function _displayOpLabel(kind) {
        return OP_LABELS[kind] || kind;
    }

    function _displayRef(raw) {
        var v = String(raw || '').trim();
        if (!v) return '';
        for (var i = 0; i < REF_CACHE.projects.length; i++) {
            var p = REF_CACHE.projects[i];
            if (p.id === v || p.ref === v || p.name === v) return p.name + '（' + p.ref + '）';
        }
        var tasks = REF_CACHE.tasksByProject || {};
        var keys = Object.keys(tasks);
        for (var j = 0; j < keys.length; j++) {
            var arr = tasks[keys[j]] || [];
            for (var k = 0; k < arr.length; k++) {
                var t = arr[k];
                if (t.id === v || t.ref === v || t.summary === v) return t.summary + '（' + t.ref + '）';
            }
        }
        return v;
    }

    async function ensureRefCache() {
        if (REF_CACHE.loaded) return;
        try {
            var sumRes = await fetch('/api/local-ai/todo/summary');
            var sumJson = await sumRes.json();
            if (sumJson && sumJson.success && Array.isArray(sumJson.projects)) {
                REF_CACHE.projects = sumJson.projects.map(function (p, i) {
                    return {
                        id: String(p.id || ''),
                        ref: '项' + (i + 1),
                        name: String(p.name || ''),
                    };
                });
            }
            var ovRes = await fetch('/api/local-ai/todo/overview?limit_per_project=200');
            var ovJson = await ovRes.json();
            if (ovJson && ovJson.success && Array.isArray(ovJson.projects)) {
                var tasksByProject = {};
                ovJson.projects.forEach(function (p, i) {
                    var projRef = '项' + (i + 1);
                    var pid = String(p.id || '');
                    var arr = [];
                    (p.tasks || []).forEach(function (t, j) {
                        arr.push({
                            id: String(t.id || ''),
                            ref: projRef + '·任' + (j + 1),
                            summary: String(t.summary || ''),
                            projectId: pid,
                        });
                    });
                    tasksByProject[pid || projRef] = arr;
                });
                REF_CACHE.tasksByProject = tasksByProject;
            }
            REF_CACHE.loaded = true;
        } catch (e) {}
    }

    function _projectOptionsHtml(cur) {
        var options = ['<option value="">（请选择）</option>'];
        var matched = false;
        REF_CACHE.projects.forEach(function (p) {
            var selected = cur === p.id || cur === p.ref || cur === p.name ? ' selected' : '';
            if (selected) matched = true;
            options.push('<option value="' + p.id + '"' + selected + '>' + p.name + '（' + p.ref + '）</option>');
        });
        if (cur && !matched) {
            options.push('<option value="' + cur + '" selected>当前值（' + cur + '）</option>');
        }
        return options.join('');
    }

    function _taskOptionsHtml(projectVal, cur) {
        var options = ['<option value="">（请选择）</option>'];
        var pid = String(projectVal || '').trim();
        var proj = REF_CACHE.projects.find(function (x) {
            return x.id === pid || x.ref === pid || x.name === pid;
        });
        var key = proj ? proj.id || proj.ref : pid;
        var arr = (REF_CACHE.tasksByProject[key] || []).slice(0, 300);
        var matched = false;
        arr.forEach(function (t) {
            var selected = cur === t.id || cur === t.ref || cur === t.summary ? ' selected' : '';
            if (selected) matched = true;
            options.push('<option value="' + t.id + '"' + selected + '>' + t.summary + '（' + t.ref + '）</option>');
        });
        if (cur && !matched) {
            options.push('<option value="' + cur + '" selected>当前值（' + cur + '）</option>');
        }
        return options.join('');
    }

    function renderOpsEditor() {
        var box = $('localAiPatchOpsEditor');
        if (!box) return;
        var ta = $('localAiPatchOpsJson');
        if (ta) {
            try {
                ta.value = JSON.stringify(Array.isArray(pendingPatchOps) ? pendingPatchOps : [], null, 2);
            } catch (e) {}
        }
        box.innerHTML = '';
        var arr = Array.isArray(pendingPatchOps) ? pendingPatchOps : [];
        if (!arr.length) {
            box.innerHTML = '<div class="small text-muted">暂无操作，可点击“添加操作”。</div>';
            return;
        }
        arr.forEach(function (op, idx) {
            var kind = (op && op.op) || 'create_task';
            if (OP_OPTIONS.indexOf(kind) < 0) kind = 'create_task';
            var card = document.createElement('div');
            card.className = 'local-ai-op-card';
            card.setAttribute('data-index', String(idx));
            var optionsHtml = OP_OPTIONS.map(function (k) {
                return '<option value="' + k + '"' + (k === kind ? ' selected' : '') + '>' + _displayOpLabel(k) + '</option>';
            }).join('');
            card.innerHTML =
                '<div class="local-ai-op-head">' +
                '<div class="small fw-semibold">操作 #' + (idx + 1) + '</div>' +
                '<div class="d-flex gap-1">' +
                '<button type="button" class="btn btn-sm btn-outline-secondary" data-action="up">上移</button>' +
                '<button type="button" class="btn btn-sm btn-outline-secondary" data-action="down">下移</button>' +
                '<button type="button" class="btn btn-sm btn-outline-danger" data-action="remove">删除</button>' +
                '</div>' +
                '</div>' +
                '<div class="mb-2"><label class="form-label small mb-1">操作类型</label><select class="form-select form-select-sm" data-action="kind">' +
                optionsHtml +
                '</select></div>' +
                '<div class="local-ai-op-grid"></div>';
            var grid = card.querySelector('.local-ai-op-grid');
            (OP_FIELD_MAP[kind] || []).forEach(function (f) {
                var wrap = document.createElement('div');
                if (f.type === 'textarea') wrap.className = 'local-ai-op-full';
                var v = op ? op[f.key] : '';
                if (f.type === 'bool') {
                    wrap.innerHTML =
                        '<label class="form-label small mb-1">' + f.label + '</label>' +
                        '<div><input type="checkbox" data-key="' + f.key + '" data-type="bool" ' + (v ? 'checked' : '') + '></div>';
                } else if (f.type === 'project_ref') {
                    wrap.innerHTML =
                        '<label class="form-label small mb-1">' + f.label + '</label>' +
                        '<select class="form-select form-select-sm" data-key="' + f.key + '" data-type="' + f.type + '">' +
                        _projectOptionsHtml(String(v || '')) +
                        '</select>' +
                        '<div class="small text-muted mt-1">' + (v ? '当前值：' + _displayRef(v) : '') + '</div>';
                } else if (f.type === 'task_ref') {
                    var pval = op ? op.project_id : '';
                    wrap.innerHTML =
                        '<label class="form-label small mb-1">' + f.label + '</label>' +
                        '<select class="form-select form-select-sm" data-key="' + f.key + '" data-type="' + f.type + '">' +
                        _taskOptionsHtml(String(pval || ''), String(v || '')) +
                        '</select>' +
                        '<div class="small text-muted mt-1">' + (v ? '当前值：' + _displayRef(v) : '') + '</div>';
                } else if (f.type === 'textarea') {
                    wrap.innerHTML =
                        '<label class="form-label small mb-1">' + f.label + '</label>' +
                        '<textarea class="form-control form-control-sm" rows="2" data-key="' +
                        f.key +
                        '" data-type="' +
                        f.type +
                        '" placeholder="' +
                        (f.placeholder || '') +
                        '">' +
                        _opFieldValueToText(v) +
                        '</textarea>';
                } else {
                    wrap.innerHTML =
                        '<label class="form-label small mb-1">' + f.label + '</label>' +
                        '<input class="form-control form-control-sm" data-key="' +
                        f.key +
                        '" data-type="' +
                        f.type +
                        '" value="' +
                        _opFieldValueToText(v).replace(/"/g, '&quot;') +
                        '" placeholder="' +
                        (f.placeholder || '') +
                        '">';
                }
                grid.appendChild(wrap);
            });
            box.appendChild(card);
        });
    }

    function collectOpsFromEditor() {
        var box = $('localAiPatchOpsEditor');
        if (!box) return Array.isArray(pendingPatchOps) ? pendingPatchOps : [];
        var cards = box.querySelectorAll('.local-ai-op-card');
        var out = [];
        for (var i = 0; i < cards.length; i++) {
            var c = cards[i];
            var kindSel = c.querySelector('select[data-action="kind"]');
            var kind = kindSel ? kindSel.value : 'create_task';
            var one = { op: kind };
            var fields = c.querySelectorAll('[data-key]');
            for (var j = 0; j < fields.length; j++) {
                var el = fields[j];
                var k = el.getAttribute('data-key');
                var typ = el.getAttribute('data-type') || 'text';
                var val;
                if (typ === 'bool') val = !!el.checked;
                else if (typ === 'int') {
                    var raw = String(el.value || '').trim();
                    if (!raw) continue;
                    var n = parseInt(raw, 10);
                    if (!isNaN(n)) val = n;
                    else continue;
                } else if (typ === 'project_ref' || typ === 'task_ref') {
                    val = String(el.value || '').trim();
                    if (!val) continue;
                } else {
                    val = String(el.value || '').trim();
                    if (!val) continue;
                }
                one[k] = val;
            }
            out.push(one);
        }
        return out;
    }

    function bindOpsEditorEvents() {
        var box = $('localAiPatchOpsEditor');
        if (!box || box.__bound) return;
        box.__bound = true;
        box.addEventListener('click', function (ev) {
            var btn = ev.target.closest('button[data-action]');
            if (!btn) return;
            var card = ev.target.closest('.local-ai-op-card');
            if (!card) return;
            var idx = parseInt(card.getAttribute('data-index') || '-1', 10);
            if (idx < 0 || idx >= (pendingPatchOps || []).length) return;
            var act = btn.getAttribute('data-action');
            if (act === 'remove') pendingPatchOps.splice(idx, 1);
            else if (act === 'up' && idx > 0) {
                var t = pendingPatchOps[idx - 1];
                pendingPatchOps[idx - 1] = pendingPatchOps[idx];
                pendingPatchOps[idx] = t;
            } else if (act === 'down' && idx < pendingPatchOps.length - 1) {
                var t2 = pendingPatchOps[idx + 1];
                pendingPatchOps[idx + 1] = pendingPatchOps[idx];
                pendingPatchOps[idx] = t2;
            }
            renderOpsEditor();
            persistPendingPatch();
        });
        box.addEventListener('change', function (ev) {
            var sel = ev.target.closest('select[data-action="kind"]');
            if (sel) {
                var card = sel.closest('.local-ai-op-card');
                if (!card) return;
                var idx = parseInt(card.getAttribute('data-index') || '-1', 10);
                if (idx < 0) return;
                pendingPatchOps[idx] = _opDefault(sel.value);
                renderOpsEditor();
                persistPendingPatch();
                return;
            }
            var fieldSel = ev.target.closest('select[data-key][data-type]');
            if (fieldSel && fieldSel.getAttribute('data-key') === 'project_id') {
                pendingPatchOps = collectOpsFromEditor();
                renderOpsEditor();
                persistPendingPatch();
                return;
            }
            pendingPatchOps = collectOpsFromEditor();
            persistPendingPatch();
        });
        box.addEventListener('input', function () {
            pendingPatchOps = collectOpsFromEditor();
            persistPendingPatch();
        });
    }

    function handleTodoPatch(data) {
        pendingPatchOps = null;
        pendingPatchRefQuestion = '';
        pendingPatchConfirmToken = '';
        pendingPatchSummary = '';
        if (!data || !data.ok) {
            var msg = (data && data.error) || '无法生成变更预览';
            appendMsg('assistant', msg + (data && data.raw ? '\n\n' + data.raw : ''));
            return;
        }
        if (!data.ops || !data.ops.length) {
            appendMsg('assistant', data.summary || '无待应用变更');
            return;
        }
        pendingPatchOps = data.ops;
        pendingPatchRefQuestion = window._localAiLastUserMessage || '';
        pendingPatchConfirmToken = (data.confirm_token || '').trim();
        pendingPatchSummary = data.summary || '';
        persistPendingPatch();
        ensureRefCache().finally(function () {
            renderOpsEditor();
        });
        renderOpsEditor();
        var tip =
            '已生成待确认操作（' +
            data.ops.length +
            ' 条）。可在弹窗中确认，或稍后点「待执行操作」继续。';
        appendMsg('assistant', tip);
        pushAssistantHistory(tip);
        $('localAiPatchSummary').textContent = data.summary || '';
        var sv = $('localAiPatchValidateStatus');
        if (sv) {
            sv.textContent = '';
            sv.className = 'small mb-2';
        }
        var prevEl = $('localAiPatchPreview');
        if (prevEl) prevEl.textContent = (data.preview || []).join('\n');
        var ta = $('localAiPatchOpsJson');
        if (ta) {
            try {
                ta.value = JSON.stringify(data.ops, null, 2);
            } catch (e) {
                ta.value = '';
            }
        }
        var modalEl = $('localAiTodoPatchModal');
        if (typeof bootstrap !== 'undefined' && modalEl) {
            var modal = bootstrap.Modal.getInstance(modalEl);
            if (!modal) modal = new bootstrap.Modal(modalEl);
            modal.show();
        } else {
            if (window.confirm((data.preview || []).join('\n'))) {
                applyPendingPatch();
            }
        }
    }

    function readOpsFromPatchEditor() {
        var ta = $('localAiPatchOpsJson');
        var ops = null;
        if (ta && ta.value && ta.value.trim()) {
            try {
                var parsed = JSON.parse(ta.value);
                if (Array.isArray(parsed)) ops = parsed;
                else if (parsed && Array.isArray(parsed.ops)) ops = parsed.ops;
                else return { ok: false, error: 'JSON 须为操作数组，或形如 {"ops":[...]}' };
            } catch (e) {
                return { ok: false, error: 'JSON 无法解析：' + (e.message || e) };
            }
        }
        if (!ops) {
            pendingPatchOps = collectOpsFromEditor();
            ops = pendingPatchOps;
        } else {
            pendingPatchOps = ops;
            renderOpsEditor();
        }
        persistPendingPatch();
        if (!ops || !ops.length) return { ok: false, error: '没有可校验的操作' };
        return { ok: true, ops: ops };
    }

    async function validatePendingPatch() {
        var st = $('localAiPatchValidateStatus');
        var parsed = readOpsFromPatchEditor();
        if (!parsed.ok) {
            if (st) {
                st.textContent = parsed.error;
                st.className = 'small mb-2 text-danger';
            }
            return false;
        }
        if (st) {
            st.textContent = '校验中...';
            st.className = 'small mb-2 text-muted';
        }
        var res = await fetch('/api/local-ai/todo/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ops: parsed.ops,
                ref_question: pendingPatchRefQuestion || '',
            }),
        });
        var j = await res.json();
        if (j && j.mcp_call) addMcpLog(j.mcp_call);
        if (!j.success) {
            if (st) {
                st.textContent = '校验失败: ' + (j.error || '');
                st.className = 'small mb-2 text-danger';
            }
            var p0 = $('localAiPatchPreview');
            if (p0 && Array.isArray(j.preview)) p0.textContent = j.preview.join('\n');
            return false;
        }
        pendingPatchOps = j.ops || parsed.ops;
        pendingPatchConfirmToken = '';
        persistPendingPatch();
        renderOpsEditor();
        var ta = $('localAiPatchOpsJson');
        if (ta) ta.value = JSON.stringify(pendingPatchOps, null, 2);
        var p = $('localAiPatchPreview');
        if (p && Array.isArray(j.preview)) p.textContent = j.preview.join('\n');
        if (st) {
            st.textContent = '校验通过，可安全应用。';
            st.className = 'small mb-2 text-success';
        }
        return true;
    }

    async function applyPendingPatch() {
        var ok = await validatePendingPatch();
        if (!ok) return;
        var ops = pendingPatchOps;
        var res = await fetch('/api/local-ai/todo/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ops: ops,
                ref_question: pendingPatchRefQuestion || '',
                confirm_token: pendingPatchConfirmToken || '',
            }),
        });
        var j = await res.json();
        if (j && j.mcp_call) addMcpLog(j.mcp_call);
        var modalEl = $('localAiTodoPatchModal');
        if (modalEl && typeof bootstrap !== 'undefined') {
            var m = bootstrap.Modal.getInstance(modalEl);
            if (m) m.hide();
        }
        if (j.success) {
            pendingPatchOps = null;
            pendingPatchRefQuestion = '';
            pendingPatchConfirmToken = '';
            pendingPatchSummary = '';
            persistPendingPatch();
            try {
                window.dispatchEvent(new CustomEvent('yobboy:todo-updated', { detail: { source: 'local-ai' } }));
            } catch (e) {}
            var okText = '变更已成功应用。';
            appendMsg('assistant', okText);
            pushAssistantHistory(okText);
        } else {
            var failText = '应用失败: ' + (j.error || '');
            appendMsg('assistant', failText);
            pushAssistantHistory(failText);
            persistPendingPatch();
        }
    }

    function onModeChange() {
        var wrap = $('localAiForceMutateWrap');
        if (wrap) wrap.style.display = getLocalAiMode() === 'todo' ? '' : 'none';
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (typeof marked !== 'undefined' && marked.setOptions) {
            marked.setOptions({ gfm: true, breaks: true });
        }

        var fab = $('localAiOpenBtn');
        var panel = $('localAiPanel');
        var toolbar = document.querySelector('.floating-toolbar');
        if (toolbar && fab) {
            toolbar.insertBefore(fab, toolbar.firstChild);
        } else if (fab) {
            fab.classList.add('standalone-fab');
        }

        applySavedLayout(panel);
        initPanelDrag(panel, $('localAiDragHandle'));
        var layoutSaveTimer;
        if (panel && typeof ResizeObserver !== 'undefined') {
            var ro = new ResizeObserver(function () {
                if (!panel.classList.contains('visible')) return;
                clearTimeout(layoutSaveTimer);
                layoutSaveTimer = setTimeout(function () {
                    savePanelLayout(panel);
                }, 350);
            });
            ro.observe(panel);
        }

        $('localAiOpenBtn').addEventListener('click', function () {
            togglePanel(true);
        });
        $('localAiCloseBtn').addEventListener('click', function () {
            togglePanel(false);
        });
        var resetBtn = $('localAiResetLayoutBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                resetPanelLayout(panel);
            });
        }
        $('localAiBackdrop').addEventListener('click', function () {
            togglePanel(false);
        });

        var seg = $('localAiModeSeg');
        if (seg) {
            seg.addEventListener('click', function (ev) {
                var btn = ev.target.closest('.local-ai-mode-btn');
                if (!btn || !seg.contains(btn)) return;
                setLocalAiMode(btn.getAttribute('data-mode') || 'general');
            });
        }
        try {
            var sm = localStorage.getItem(MODE_KEY);
            if (sm && ['general', 'knowledge', 'todo'].indexOf(sm) >= 0) setLocalAiMode(sm);
            else onModeChange();
        } catch (e) {
            onModeChange();
        }

        $('localAiClearHistBtn').addEventListener('click', function () {
            localStorage.removeItem(STORAGE_KEY);
            $('localAiMessages').innerHTML = '';
        });
        $('localAiPendingPatchBtn').addEventListener('click', openPendingPatchModal);
        $('localAiPatchAddOpBtn').addEventListener('click', function () {
            if (!Array.isArray(pendingPatchOps)) pendingPatchOps = [];
            pendingPatchOps.push(_opDefault('create_task'));
            renderOpsEditor();
            persistPendingPatch();
        });
        $('localAiMcpToggleBtn').addEventListener('click', function () {
            var list = $('localAiMcpList');
            if (!list) return;
            var hidden = !!list.hidden;
            list.hidden = !hidden;
            $('localAiMcpToggleBtn').textContent = hidden ? '收起' : '展开';
        });
        $('localAiMcpClearBtn').addEventListener('click', function () {
            localStorage.removeItem(MCP_LOG_KEY);
            renderMcpLogs();
        });

        $('localAiPatchApplyBtn').addEventListener('click', applyPendingPatch);
        $('localAiPatchValidateBtn').addEventListener('click', validatePendingPatch);
        $('localAiStopBtn').addEventListener('click', function () {
            if (currentStreamAbort) currentStreamAbort.abort();
        });

        var hist = loadHistory();
        renderHistory(hist);
        renderMcpLogs();
        restorePendingPatch();
        bindOpsEditorEvents();

        async function doSend() {
            if (isGenerating) return;
            var input = $('localAiInput');
            var text = (input.value || '').trim();
            if (!text) return;
            window._localAiLastUserMessage = text;
            var mode = getLocalAiMode();
            var force = $('localAiForceMutate') && $('localAiForceMutate').checked;
            input.value = '';

            var messages = loadHistory();
            appendMsg('user', text);
            messages.push({ role: 'user', content: text });
            saveHistory(messages);

            var reply = await sendStream(messages, mode, force);
            if ((reply || '').trim()) {
                messages.push({ role: 'assistant', content: reply || '' });
                saveHistory(messages);
            }
            refreshStatus();
        }

        $('localAiSendBtn').addEventListener('click', doSend);
        $('localAiInput').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                doSend();
            }
        });

        setInterval(function () {
            if ($('localAiPanel') && $('localAiPanel').classList.contains('visible')) {
                refreshStatus();
            }
        }, 4000);
    });

    window.YobboyLocalAI = {
        onPreviewMdTxt: function (filepath, filename) {
            var ext = (filename.split('.').pop() || '').toLowerCase();
            if (!['md', 'markdown', 'txt'].includes(ext)) return;

            var titleRow = document.getElementById('previewTitle');
            if (!titleRow) return;
            var wrap = document.getElementById('knowledgePreviewBarWrap');
            if (!wrap) {
                wrap = document.createElement('div');
                wrap.id = 'knowledgePreviewBarWrap';
                titleRow.parentElement.insertBefore(wrap, titleRow.nextSibling);
            }
            wrap.style.display = 'block';
            wrap.innerHTML =
                '<div class="knowledge-preview-bar" id="knowledgePreviewBarInner">' +
                '<span>知识库</span><span id="kbStatus" class="badge bg-secondary knowledge-preview-bar">…</span>' +
                '<button type="button" class="btn btn-sm btn-primary" id="kbAddBtn">加入知识库</button>' +
                '<button type="button" class="btn btn-sm btn-outline-danger" id="kbRemoveBtn">移除</button>' +
                '</div>';

            function syncKb() {
                fetch('/api/knowledge/entry?path=' + encodeURIComponent(filepath))
                    .then(function (r) {
                        return r.json();
                    })
                    .then(function (j) {
                        var st = $('kbStatus');
                        if (!st) return;
                        if (j.in_knowledge) {
                            st.textContent = '已纳入';
                            st.className = 'badge bg-success badge-kb';
                        } else {
                            st.textContent = '未纳入';
                            st.className = 'badge bg-secondary badge-kb';
                        }
                    });
            }

            syncKb();

            $('kbAddBtn').onclick = function () {
                fetch('/api/knowledge/entry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: filepath, tags: ['default'], note: '' }),
                })
                    .then(function (r) {
                        return r.json();
                    })
                    .then(function (j) {
                        alert(j.success ? '已加入知识库' : j.error || '失败');
                        syncKb();
                    });
            };
            $('kbRemoveBtn').onclick = function () {
                fetch('/api/knowledge/entry?path=' + encodeURIComponent(filepath), { method: 'DELETE' })
                    .then(function (r) {
                        return r.json();
                    })
                    .then(function (j) {
                        alert(j.success ? '已移除' : j.error || '失败');
                        syncKb();
                    });
            };
        },
        hideKnowledgeBar: function () {
            var w = document.getElementById('knowledgePreviewBarWrap');
            if (w) w.style.display = 'none';
        },
    };
})();
