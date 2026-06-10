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
    var sendHandler = null;
    var currentKbPreviewPath = '';
    var kbPreviewPollTimer = null;
    var kbManagerPollTimer = null;
    var kbLinePollTimer = null;
    var kbLastFiles = [];
    var kbLastFileListMeta = {};
    var kbRootFolders = [];
    var kbManagerCache = {};

    function kbFetchJson(url, options) {
        return fetch(url, options || {}).then(function (r) {
            return r.json();
        });
    }

    function kbFetchJsonSafe(url, options) {
        var fetchOptions = Object.assign({}, options || {});
        var timeoutMs = Number(fetchOptions.timeout_ms || 10000);
        if (!isFinite(timeoutMs) || timeoutMs <= 0) timeoutMs = 10000;
        delete fetchOptions.timeout_ms;
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = null;
        if (controller) {
            fetchOptions.signal = controller.signal;
            timer = setTimeout(function () {
                controller.abort();
            }, timeoutMs);
        }
        function clearTimer() {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
        }
        return fetch(url, fetchOptions).then(function (r) {
            clearTimer();
            return r
                .text()
                .then(function (text) {
                    try {
                        return { ok: true, payload: JSON.parse(text) };
                    } catch (e) {
                        return {
                            ok: false,
                            error: 'JSON 解析失败',
                            status: r.status,
                            raw: String(text || '').slice(0, 400),
                        };
                    }
                })
                .catch(function (e) {
                    return { ok: false, error: (e && e.message) || String(e), status: r.status };
                });
        }).catch(function (e) {
            clearTimer();
            var timedOut = !!(controller && controller.signal && controller.signal.aborted);
            return { ok: false, error: timedOut ? '请求超时' : ((e && e.message) || String(e)), status: 0 };
        });
    }

    function kbJobRunning(job) {
        return !!job && ['queued', 'running'].indexOf(job.status) >= 0;
    }

    function kbManagerFailureLabel(key) {
        var labels = {
            knowledgeStatus: '知识库概况',
            knowledgeList: '候选文件列表',
            knowledgeJobs: '后台任务列表',
            knowledgeSnippets: '零散知识列表',
            todoStatus: '待办知识库概况',
            todoEntries: '待办知识库条目',
            productStatus: '产品对比知识库概况',
            productEntries: '产品对比知识库条目',
        };
        return labels[key] || key || '未知接口';
    }

    function kbFileSearchQuery() {
        var input = $('localAiKbFileSearchInput');
        return input ? String(input.value || '').trim() : '';
    }
    function kbEscapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function kbFormatSize(bytes) {
        var n = Number(bytes || 0);
        if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
        if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
        return n + ' B';
    }

    function renderKbScanSettings(settings) {
        var dirs = settings && Array.isArray(settings.scan_excluded_dirs) ? settings.scan_excluded_dirs : [];
        var hint = $('localAiKbExcludedHint');
        if (hint) {
            hint.textContent = dirs.length
                ? '当前已排除一级文件夹 ' + dirs.length + ' 个'
                : '当前扫描分享根目录下所有一级文件夹。';
        }
    }

    function kbHasActiveJobs(status) {
        var counts = status && status.job_counts ? status.job_counts : {};
        return Number(counts.running || 0) > 0 || Number(counts.queued || 0) > 0;
    }

    function kbCountText(item) {
        var current = Number(item && item.current_count || 0);
        var total = Number(item && item.total_count || 0);
        var jobType = String((item && item.job_type) || '');
        var unit = jobType === 'file_scan' ? '目录' : '项';
        if (total > 0) return '已处理 ' + current + ' / 共 ' + total + ' ' + unit;
        if (current > 0) return '已处理 ' + current + ' ' + unit;
        return '';
    }

    function renderKbRootFolders(items) {
        var wrap = $('localAiKbFolderList');
        if (!wrap) return;
        kbRootFolders = Array.isArray(items) ? items : [];
        if (!kbRootFolders.length) {
            wrap.innerHTML = '<div class="local-ai-kb-empty">分享根目录下没有可设置的一级文件夹。</div>';
            return;
        }
        wrap.innerHTML = kbRootFolders
            .map(function (item, idx) {
                var path = String(item.path || item.name || '');
                var checked = item.excluded ? '' : ' checked';
                var skipped = item.skipped_by_default ? '<span class="badge bg-secondary">默认跳过</span>' : '';
                return (
                    '<label class="local-ai-kb-folder-item">' +
                    '<span class="local-ai-kb-folder-name">' +
                    '<input class="form-check-input me-2" type="checkbox" data-kb-folder-idx="' +
                    idx +
                    '"' +
                    checked +
                    '> ' +
                    kbEscapeHtml(path) +
                    '</span>' +
                    '<span class="local-ai-kb-folder-meta">' +
                    (item.excluded ? '已排除' : '会扫描') +
                    skipped +
                    '</span>' +
                    '</label>'
                );
            })
            .join('');
    }

    function loadKbRootFolders() {
        var wrap = $('localAiKbFolderList');
        if (wrap) wrap.innerHTML = '<div class="local-ai-kb-empty">正在加载文件夹…</div>';
        return kbFetchJson('/api/knowledge/root-folders')
            .then(function (j) {
                if (!j.success) {
                    if (wrap) wrap.innerHTML = '<div class="local-ai-kb-empty">' + kbEscapeHtml(j.error || '加载文件夹失败') + '</div>';
                    return;
                }
                renderKbRootFolders(j.items || []);
            })
            .catch(function () {
                if (wrap) wrap.innerHTML = '<div class="local-ai-kb-empty">加载文件夹失败</div>';
            });
    }

    function collectExcludedRootFolders() {
        var wrap = $('localAiKbFolderList');
        if (!wrap) return [];
        return Array.prototype.slice.call(wrap.querySelectorAll('input[data-kb-folder-idx]'))
            .filter(function (input) {
                return !input.checked;
            })
            .map(function (input) {
                var idx = Number(input.getAttribute('data-kb-folder-idx'));
                var item = kbRootFolders[idx] || {};
                return String(item.path || '').trim();
            })
            .filter(Boolean);
    }

    function kbStatusLabel(item) {
        var job = item && item.latest_job;
        if (kbJobRunning(job)) return '处理中 ' + Math.round(Number(job.progress || 0) * 100) + '%';
        if (item && item.excluded) return '已排除';
        if (item && !item.exists) return '源文件缺失';
        if (item && item.stale) return '已变更';
        var status = String((item && item.index_status) || (item && item.scan_status) || 'discovered');
        if (status.indexOf('indexed') === 0) return '已入库';
        if (status === 'excluded') return '已排除';
        if (status === 'missing') return '源文件缺失';
        if (status === 'failed') return '失败';
        return '未处理';
    }

    function kbStatusClass(item) {
        var job = item && item.latest_job;
        if (kbJobRunning(job)) return 'bg-primary';
        if (item && item.excluded) return 'bg-dark';
        if (item && !item.exists) return 'bg-danger';
        if (item && item.stale) return 'bg-warning text-dark';
        var status = String((item && item.index_status) || '');
        if (status.indexOf('indexed') === 0) return 'bg-success';
        if (status === 'failed') return 'bg-danger';
        return 'bg-secondary';
    }

    function kbNeedsIndex(item) {
        if (!item || !item.exists || !item.supported || item.excluded) return false;
        if (kbJobRunning(item.latest_job)) return false;
        return !item.indexed || !!item.stale;
    }


    function renderKbLineFromStatus(status) {
        var line = $('localAiKbLine');
        if (!line) return;
        if (!status) {
            line.style.display = 'none';
            line.textContent = '';
            return;
        }
        var jobCounts = status.job_counts || {};
        var running = Number(jobCounts.running || 0);
        var queued = Number(jobCounts.queued || 0);
        line.style.display = '';
        line.textContent =
            '知识库：' +
            (Number(status.registered_files || 0) || 0) +
            ' 文件 / ' +
            (Number(status.snippet_count || 0) || 0) +
            ' 条零散知识 / 运行中 ' +
            running +
            ' / 排队 ' +
            queued;
    }

    function refreshKbLine() {
        return kbFetchJson('/api/knowledge/status')
            .then(function (j) {
                if (j && j.success) {
                    renderKbLineFromStatus(j.status);
                    scheduleKbLinePoll(j.status);
                }
            })
            .catch(function () {});
    }

    function scheduleKbLinePoll(status) {
        if (kbLinePollTimer) {
            clearTimeout(kbLinePollTimer);
            kbLinePollTimer = null;
        }
        if (!kbHasActiveJobs(status)) return;
        kbLinePollTimer = setTimeout(refreshKbLine, 4000);
    }

    function todoKbHasActiveJob(status) {
        var jobs = (status && Array.isArray(status.latest_jobs)) ? status.latest_jobs : [];
        return jobs.some(kbJobRunning);
    }

    function entityKbJobs(status) {
        return (status && Array.isArray(status.latest_jobs)) ? status.latest_jobs : [];
    }

    function entityKbFindRunningJob(status) {
        var jobs = entityKbJobs(status);
        for (var i = 0; i < jobs.length; i += 1) {
            if (kbJobRunning(jobs[i])) return jobs[i];
        }
        return null;
    }

    function entityKbPanelState(status, loadFailed) {
        if (loadFailed) return 'load_failed';
        if (!status) return 'load_failed';
        if (todoKbHasActiveJob(status)) return 'building';
        if (Number(status.total_sources || 0) > 0 || Number(status.total_chunks || 0) > 0) return 'ready';
        var jobs = entityKbJobs(status);
        if (jobs.some(function (item) { return String((item && item.status) || '') === 'completed'; })) return 'ready';
        if (jobs.some(function (item) { return String((item && item.status) || '') === 'failed'; })) return 'build_failed';
        return 'unbuilt';
    }

    function renderEntityKbDefaultPlaceholder(summaryId, listId, titlePrefix) {
        var summary = $(summaryId);
        var wrap = $(listId);
        if (summary) {
            summary.textContent = titlePrefix + '未建立，点击“重建”开始建立知识库';
        }
        if (wrap) {
            wrap.innerHTML = '<div class="local-ai-kb-empty">知识库尚未建立。点击“重建”后会开始 embedding。</div>';
        }
    }

    function rebuildTodoKb() {
        var btn = $('localAiTodoKbManagerRebuildBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '已提交…';
        }
        return kbFetchJson('/api/local-ai/todo-kb/rebuild', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ async: true }),
        })
            .then(function (j) {
                if (!j || !j.success) {
                    alert((j && j.error) || 'Todo 知识库重建失败');
                }
            })
            .catch(function () {
                alert('Todo 知识库重建请求失败');
            })
            .finally(function () {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '重建';
                }
                refreshKbManager({ forceFull: true });
            });
    }

    function ensureKbPreviewPoll() {
        if (kbPreviewPollTimer) clearTimeout(kbPreviewPollTimer);
        if (!currentKbPreviewPath) return;
        kbPreviewPollTimer = setTimeout(function () {
            if (!currentKbPreviewPath) return;
            kbFetchJson('/api/knowledge/entry?path=' + encodeURIComponent(currentKbPreviewPath))
                .then(function (j) {
                    if (window.YobboyLocalAI && typeof window.YobboyLocalAI._renderPreviewMeta === 'function') {
                        window.YobboyLocalAI._renderPreviewMeta(j);
                    }
                    var meta = j && j.meta ? j.meta : null;
                    var job = meta && meta.latest_job ? meta.latest_job : null;
                    if (kbJobRunning(job)) ensureKbPreviewPoll();
                })
                .catch(function () {
                    ensureKbPreviewPoll();
                });
        }, 1800);
    }

    function renderKbProgress(container, job, fallbackStatus) {
        if (!container) return;
        var fill = container.querySelector('.knowledge-preview-progress-fill');
        var text = container.querySelector('.knowledge-preview-progress-text');
        if (!fill || !text) return;
        if (job && kbJobRunning(job)) {
            var pct = Math.max(0, Math.min(100, Math.round(Number(job.progress || 0) * 100)));
            var countText = kbCountText(job);
            fill.style.width = pct + '%';
            text.textContent = (job.message || job.stage || '处理中') + (countText ? ' · ' + countText : '') + ' · ' + pct + '%';
            container.style.display = '';
            return;
        }
        if (fallbackStatus && String(fallbackStatus).indexOf('indexed') === 0) {
            fill.style.width = '100%';
            text.textContent = '索引已完成';
            container.style.display = '';
            return;
        }
        fill.style.width = '0%';
        text.textContent = '';
        container.style.display = 'none';
    }

    function kbPathParts(path) {
        return String(path || '')
            .split('/')
            .filter(function (part) {
                return !!part;
            });
    }

    function kbPathBaseName(path) {
        var parts = kbPathParts(path);
        return parts.length ? parts[parts.length - 1] : String(path || '');
    }

    function kbPathDirName(path) {
        var parts = kbPathParts(path);
        if (parts.length <= 1) return '';
        return parts.slice(0, -1).join('/');
    }

    function kbFileMetaBits(item, dirPath) {
        var metaBits = [];
        if (dirPath) metaBits.push('目录 ' + dirPath);
        metaBits.push((item.ext || '').replace('.', '').toUpperCase() || 'TEXT');
        metaBits.push(kbFormatSize(item.size || 0));
        metaBits.push('片段 ' + Number(item.chunk_count || 0));
        if (item.excluded) metaBits.push('排除目录');
        if (item.stale) metaBits.push('需要重建');
        if (item.latest_job && item.latest_job.message) metaBits.push(String(item.latest_job.message));
        if (item.last_error) metaBits.push(String(item.last_error));
        return metaBits.map(function (part) {
            return kbEscapeHtml(String(part || ''));
        });
    }

    function kbRenderFileItem(item, options) {
        var path = String(item.path || '');
        var encodedPath = encodeURIComponent(path);
        var title = String((options && options.title) || kbPathBaseName(path) || path || '未命名文件');
        var dirPath = String((options && options.dirPath) || kbPathDirName(path));
        var actionBtn = '';
        if (kbNeedsIndex(item)) {
            actionBtn =
                '<button type="button" class="btn btn-sm btn-primary" data-kb-action="queue">' +
                (item.stale ? '重建' : '加入') +
                '</button>';
        }
        var removeBtn = item.indexed
            ? '<button type="button" class="btn btn-sm btn-outline-danger" data-kb-action="remove">移除</button>'
            : '';
        var metaBits = kbFileMetaBits(item, dirPath);
        return (
            '<div class="local-ai-kb-item' +
            (item.excluded ? ' is-excluded' : '') +
            (path === currentKbPreviewPath ? ' is-active' : '') +
            '" data-path="' +
            encodedPath +
            '">' +
            '<div class="local-ai-kb-item-head">' +
            '<span class="local-ai-kb-item-title" title="' +
            kbEscapeHtml(path) +
            '">' +
            kbEscapeHtml(title) +
            '</span>' +
            '<span class="badge ' +
            kbStatusClass(item) +
            '">' +
            kbEscapeHtml(kbStatusLabel(item)) +
            '</span>' +
            '</div>' +
            '<div class="local-ai-kb-item-meta"><span>' +
            metaBits.join('</span><span>') +
            '</span></div>' +
            '<div class="local-ai-kb-item-actions">' +
            actionBtn +
            removeBtn +
            '</div>' +
            '</div>'
        );
    }

    function kbBuildFileTree(items, meta) {
        var root = {
            name: '',
            path: '',
            folders: Object.create(null),
            folderOrder: [],
            files: [],
            fileCount: 0,
            loadedFileCount: 0,
            indexedCount: 0,
            pendingCount: 0,
            issueCount: 0,
            rootFilesSummary: null,
        };
        (Array.isArray(items) ? items : []).forEach(function (item) {
            var path = String(item.path || '');
            var parts = kbPathParts(path);
            var pending = kbNeedsIndex(item) ? 1 : 0;
            var issue = item.last_error ? 1 : 0;
            var indexed = item.indexed ? 1 : 0;
            var fileName = parts.length ? parts[parts.length - 1] : path || '未命名文件';
            var folders = parts.slice(0, -1);
            var node = root;
            node.fileCount += 1;
            node.loadedFileCount += 1;
            node.indexedCount += indexed;
            node.pendingCount += pending;
            node.issueCount += issue;
            folders.forEach(function (folderName) {
                var child = node.folders[folderName];
                if (!child) {
                    child = {
                        name: folderName,
                        path: node.path ? node.path + '/' + folderName : folderName,
                        folders: Object.create(null),
                        folderOrder: [],
                        files: [],
                        fileCount: 0,
                        loadedFileCount: 0,
                        indexedCount: 0,
                        pendingCount: 0,
                        issueCount: 0,
                    };
                    node.folders[folderName] = child;
                    node.folderOrder.push(folderName);
                }
                node = child;
                node.fileCount += 1;
                node.loadedFileCount += 1;
                node.indexedCount += indexed;
                node.pendingCount += pending;
                node.issueCount += issue;
            });
            node.files.push({
                item: item,
                title: fileName,
            });
        });
        var topFolders = (meta && Array.isArray(meta.top_folders)) ? meta.top_folders : [];
        topFolders.forEach(function (folder) {
            var name = String(folder && (folder.path || folder.name) || '').trim();
            if (!name) return;
            var child = root.folders[name];
            if (!child) {
                child = {
                    name: name,
                    path: name,
                    folders: Object.create(null),
                    folderOrder: [],
                    files: [],
                    fileCount: 0,
                    loadedFileCount: 0,
                    indexedCount: 0,
                    pendingCount: 0,
                    issueCount: 0,
                };
                root.folders[name] = child;
                root.folderOrder.push(name);
            }
            child.fileCount = Number(folder.file_count || 0);
            child.indexedCount = Number(folder.indexed_count || 0);
            child.pendingCount = Number(folder.pending_count || 0);
            child.issueCount = Number(folder.issue_count || 0);
        });
        if (meta && meta.root_files) {
            root.rootFilesSummary = {
                fileCount: Number(meta.root_files.file_count || 0),
                indexedCount: Number(meta.root_files.indexed_count || 0),
                pendingCount: Number(meta.root_files.pending_count || 0),
                issueCount: Number(meta.root_files.issue_count || 0),
            };
        }
        root.folderOrder.sort(function (a, b) {
            return String(a || '').localeCompare(String(b || ''), 'zh-Hans-CN');
        });
        return root;
    }

    function kbRenderTreeHint(text) {
        return '<div class="local-ai-kb-empty local-ai-kb-tree-hint">' + kbEscapeHtml(String(text || '')) + '</div>';
    }

    function kbRenderTreeNode(node, depth, meta) {
        var html = [];
        (node.folderOrder || []).forEach(function (name) {
            var child = node.folders && node.folders[name];
            if (!child) return;
            var metaBits = [child.fileCount + ' 个文件'];
            if (child.indexedCount) metaBits.push('已入库 ' + child.indexedCount);
            if (child.pendingCount) metaBits.push('待处理 ' + child.pendingCount);
            if (child.issueCount) metaBits.push('异常 ' + child.issueCount);
            var folderActions = '';
            if (depth === 0) {
                folderActions =
                    '<button type="button" class="btn btn-sm btn-outline-primary local-ai-kb-tree-action" ' +
                    'data-kb-folder-action="queue" data-folder-path="' +
                    encodeURIComponent(child.path || child.name) +
                    '">处理此目录</button>';
            }
            html.push(
                '<details class="local-ai-kb-tree-folder">' +
                    '<summary class="local-ai-kb-tree-summary">' +
                    '<span class="local-ai-kb-tree-folder-name" title="' +
                    kbEscapeHtml(child.path || child.name) +
                    '">📁 ' +
                    kbEscapeHtml(child.name) +
                    '</span>' +
                    '<span class="local-ai-kb-tree-summary-right">' +
                    '<span class="local-ai-kb-tree-folder-meta">' +
                    kbEscapeHtml(metaBits.join(' · ')) +
                    '</span>' +
                    folderActions +
                    '</span>' +
                    '</summary>' +
                    '<div class="local-ai-kb-tree-children">' +
                    kbRenderTreeNode(child, depth + 1, meta) +
                    ((depth === 0 && Number(child.loadedFileCount || 0) < Number(child.fileCount || 0))
                        ? kbRenderTreeHint(
                            '当前仅加载 ' +
                            Number(child.loadedFileCount || 0) +
                            ' / ' +
                            Number(child.fileCount || 0) +
                            ' 个文件，一级目录已完整显示。'
                        )
                        : '') +
                    '</div>' +
                    '</details>'
            );
        });
        var rootSummary = node.rootFilesSummary;
        var hasRootFiles = depth === 0 && (
            (rootSummary && Number(rootSummary.fileCount || 0) > 0) ||
            (node.files || []).length
        );
        if (hasRootFiles) {
            var rootFilePendingCount = (node.files || []).filter(function (entry) {
                return kbNeedsIndex(entry.item);
            }).length;
            var totalRootFiles = Number((rootSummary && rootSummary.fileCount) || (node.files || []).length || 0);
            var summaryRootPending = Number((rootSummary && rootSummary.pendingCount) || rootFilePendingCount || 0);
            var rootFileMetaBits = [totalRootFiles + ' 个文件'];
            if (summaryRootPending) rootFileMetaBits.push('待处理 ' + summaryRootPending);
            html.push(
                '<details class="local-ai-kb-tree-folder">' +
                    '<summary class="local-ai-kb-tree-summary">' +
                    '<span class="local-ai-kb-tree-folder-name">📄 根目录文件</span>' +
                    '<span class="local-ai-kb-tree-summary-right">' +
                    '<span class="local-ai-kb-tree-folder-meta">' +
                    kbEscapeHtml(rootFileMetaBits.join(' · ')) +
                    '</span>' +
                    '<button type="button" class="btn btn-sm btn-outline-primary local-ai-kb-tree-action" ' +
                    'data-kb-root-files-action="queue">处理根目录文件</button>' +
                    '</span>' +
                    '</summary>' +
                    '<div class="local-ai-kb-tree-children">' +
                    node.files.map(function (entry) {
                        return kbRenderFileItem(entry.item, {
                            title: entry.title,
                            dirPath: kbPathDirName(String((entry.item || {}).path || '')),
                        });
                    }).join('') +
                    (((node.files || []).length < totalRootFiles)
                        ? kbRenderTreeHint(
                            '当前仅加载 ' +
                            Number((node.files || []).length) +
                            ' / ' +
                            totalRootFiles +
                            ' 个根目录文件，一级目录已完整显示。'
                        )
                        : '') +
                    '</div>' +
                    '</details>'
            );
        } else {
            (node.files || []).forEach(function (entry) {
                html.push(
                    kbRenderFileItem(entry.item, {
                        title: entry.title,
                        dirPath: kbPathDirName(String((entry.item || {}).path || '')),
                    })
                );
            });
        }
        return html.join('');
    }

    function renderKbManagerFiles(items, meta) {
        var wrap = $('localAiKbFileList');
        if (!wrap) return;
        kbLastFiles = Array.isArray(items) ? items : [];
        kbLastFileListMeta = meta || {};
        if (!kbLastFiles.length) {
            if (kbLastFileListMeta.query) {
                wrap.innerHTML =
                    '<div class="local-ai-kb-empty">没有匹配“' +
                    kbEscapeHtml(kbLastFileListMeta.query) +
                    '”的知识库文件。</div>';
                return;
            }
            if (Number(kbLastFileListMeta.total || 0) > 0) {
                wrap.innerHTML = '<div class="local-ai-kb-empty">候选文件较多，当前页没有数据，请刷新重试。</div>';
                return;
            }
            wrap.innerHTML = '<div class="local-ai-kb-empty">暂无候选文件。点击“重新扫描”查找 md/txt 文件。</div>';
            return;
        }
        var hintHtml = '';
        if (kbLastFileListMeta.query) {
            hintHtml =
                '<div class="local-ai-kb-empty">搜索“' +
                kbEscapeHtml(kbLastFileListMeta.query) +
                '”，显示 ' +
                kbLastFiles.length +
                ' / 共 ' +
                Number(kbLastFileListMeta.total || kbLastFiles.length) +
                ' 项匹配结果。</div>';
        } else if (Number(kbLastFileListMeta.total || 0) > kbLastFiles.length || kbLastFileListMeta.has_more) {
            hintHtml =
                '<div class="local-ai-kb-empty">候选文件较多，当前仅显示前 ' +
                kbLastFiles.length +
                ' / 共 ' +
                Number(kbLastFileListMeta.total || kbLastFiles.length) +
                ' 项，已优先展示待处理和异常文件。</div>';
        }
        wrap.innerHTML =
            hintHtml +
            '<div class="local-ai-kb-tree">' +
            kbRenderTreeNode(kbBuildFileTree(kbLastFiles, kbLastFileListMeta), 0, kbLastFileListMeta) +
            '</div>';
    }

    function renderKbManagerJobs(items) {
        var wrap = $('localAiKbJobList');
        if (!wrap) return;
        if (!items || !items.length) {
            wrap.innerHTML = '<div class="local-ai-kb-empty">暂无后台任务</div>';
            return;
        }
        wrap.innerHTML = items
            .map(function (item) {
                var pct = Math.max(0, Math.min(100, Math.round(Number(item.progress || 0) * 100)));
                var countText = kbCountText(item);
                return (
                    '<div class="local-ai-kb-item">' +
                    '<div class="local-ai-kb-item-head">' +
                    '<span class="local-ai-kb-item-title">' +
                    (item.source_key || item.job_id || '') +
                    '</span>' +
                    '<span class="badge ' +
                    (kbJobRunning(item) ? 'bg-primary' : item.status === 'completed' ? 'bg-success' : item.status === 'failed' ? 'bg-danger' : 'bg-secondary') +
                    '">' +
                    (item.status || 'unknown') +
                    '</span>' +
                    '</div>' +
                    '<div class="local-ai-kb-item-meta">' +
                    '<span>' +
                    (item.message || item.stage || '') +
                    '</span>' +
                    (countText ? '<span>' + kbEscapeHtml(countText) + '</span>' : '') +
                    '<span>' +
                    pct +
                    '%</span>' +
                    (item.error_text ? '<span>' + item.error_text + '</span>' : '') +
                    '</div>' +
                    '</div>'
                );
            })
            .join('');
    }

    function renderKbManagerSnippets(items) {
        var wrap = $('localAiKbSnippetList');
        if (!wrap) return;
        if (!items || !items.length) {
            wrap.innerHTML = '<div class="local-ai-kb-empty">暂无零散知识</div>';
            return;
        }
        wrap.innerHTML = items
            .map(function (item) {
                return (
                    '<div class="local-ai-kb-item" data-snippet-id="' +
                    encodeURIComponent(item.id || '') +
                    '">' +
                    '<div class="local-ai-kb-item-head">' +
                    '<span class="local-ai-kb-item-title">' +
                    (item.title || item.id || '') +
                    '</span>' +
                    '<span class="badge ' +
                    (String(item.index_status || '').indexOf('indexed') === 0 ? 'bg-success' : 'bg-secondary') +
                    '">' +
                    (item.index_status || 'unknown') +
                    '</span>' +
                    '</div>' +
                    '<div class="local-ai-kb-item-meta"><span>' +
                    (item.text || '') +
                    '</span></div>' +
                    '<div class="local-ai-kb-item-actions">' +
                    '<button type="button" class="btn btn-sm btn-outline-danger" data-kb-action="remove-snippet">删除</button>' +
                    '</div>' +
                    '</div>'
                );
            })
            .join('');
    }

    function entityKbItemStatusClass(item) {
        var job = item && item.latest_job;
        if (kbJobRunning(job)) return 'bg-primary';
        var status = String((item && item.index_status) || '');
        if (status.indexOf('indexed') === 0) return 'bg-success';
        if (status === 'failed') return 'bg-danger';
        return 'bg-secondary';
    }

    function entityKbItemStatusLabel(item) {
        var job = item && item.latest_job;
        if (kbJobRunning(job)) return '处理中 ' + Math.round(Number(job.progress || 0) * 100) + '%';
        var status = String((item && item.index_status) || 'unknown');
        if (status.indexOf('indexed') === 0) return '已入库';
        if (status === 'failed') return '失败';
        return status || 'unknown';
    }

    function renderEntityKbPanel(listId, summaryId, titlePrefix, status, items, loadFailed) {
        var wrap = $(listId);
        var summary = $(summaryId);
        var jobs = (status && Array.isArray(status.latest_jobs)) ? status.latest_jobs : [];
        var running = jobs.filter(kbJobRunning).length;
        var total = Number((status && status.total_sources) || 0);
        var chunks = Number((status && status.total_chunks) || 0);
        if (summary) {
            summary.textContent = loadFailed
                ? titlePrefix + '加载失败，请重试'
                : status
                ? titlePrefix + '条目 ' + total + ' / 片段 ' + chunks + ' / 运行中 ' + running + ' / 最近任务 ' + jobs.length
                : '知识库概况加载失败';
        }
        if (!wrap) return;
        if (loadFailed) {
            wrap.innerHTML = '<div class="local-ai-kb-empty">加载失败，请点击刷新重试</div>';
            return;
        }
        if ((!items || !items.length) && !jobs.length) {
            wrap.innerHTML = '<div class="local-ai-kb-empty">暂无已索引条目</div>';
            return;
        }
        var jobHtml = jobs.slice(0, 6).map(function (item) {
            var pct = Math.max(0, Math.min(100, Math.round(Number(item.progress || 0) * 100)));
            var countText = kbCountText(item);
            return (
                '<div class="local-ai-kb-item">' +
                '<div class="local-ai-kb-item-head">' +
                '<span class="local-ai-kb-item-title">任务 / ' + kbEscapeHtml(item.source_key || item.job_id || '') + '</span>' +
                '<span class="badge ' +
                (kbJobRunning(item) ? 'bg-primary' : item.status === 'completed' ? 'bg-success' : item.status === 'failed' ? 'bg-danger' : 'bg-secondary') +
                '">' +
                kbEscapeHtml(item.status || 'unknown') +
                '</span>' +
                '</div>' +
                '<div class="local-ai-kb-item-meta"><span>' +
                kbEscapeHtml(item.message || item.stage || '') +
                '</span>' +
                (countText ? '<span>' + kbEscapeHtml(countText) + '</span>' : '') +
                '<span>' + pct + '%</span>' +
                (item.error_text ? '<span>' + kbEscapeHtml(item.error_text) + '</span>' : '') +
                '</div>' +
                '</div>'
            );
        });
        var entryHtml = (items || []).slice(0, 120).map(function (item) {
            var metaBits = [
                kbEscapeHtml(item.entity_type || 'item'),
                '片段 ' + Number(item.chunk_count || 0),
            ];
            if (item.latest_job && item.latest_job.message) metaBits.push(kbEscapeHtml(item.latest_job.message));
            if (item.last_error) metaBits.push(kbEscapeHtml(item.last_error));
            return (
                '<div class="local-ai-kb-item">' +
                '<div class="local-ai-kb-item-head">' +
                '<span class="local-ai-kb-item-title">' + kbEscapeHtml(item.display_name || item.title || item.source_key || '') + '</span>' +
                '<span class="badge ' + entityKbItemStatusClass(item) + '">' + kbEscapeHtml(entityKbItemStatusLabel(item)) + '</span>' +
                '</div>' +
                '<div class="local-ai-kb-item-meta"><span>' + metaBits.join('</span><span>') + '</span></div>' +
                '</div>'
            );
        });
        wrap.innerHTML = jobHtml.concat(entryHtml).join('');
    }

    function rebuildProductCompareKb() {
        var btn = $('localAiProductKbManagerRebuildBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = '已提交…';
        }
        return kbFetchJson('/api/local-ai/product-compare-kb/rebuild', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ async: true }),
        })
            .then(function (j) {
                if (!j || !j.success) alert((j && j.error) || '产品对比知识库重建失败');
            })
            .catch(function () {
                alert('产品对比知识库重建请求失败');
            })
            .finally(function () {
                if (btn) {
                    btn.disabled = false;
                    btn.textContent = '重建';
                }
                refreshKbManager({ forceFull: true });
            });
    }

    function queueKbFiles(paths) {
        if (!paths || !paths.length) {
            alert('没有需要加入或重建的文件');
            return Promise.resolve();
        }
        return kbFetchJson('/api/knowledge/bulk-index', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: paths }),
        }).then(function (j) {
            if (!j.success) {
                alert(j.error || '加入知识库失败');
                return;
            }
            if (j.error_count) {
                alert('已提交 ' + j.queued_count + ' 个任务，失败 ' + j.error_count + ' 个');
            }
            refreshKbManager();
        });
    }

    function queueKbFolder(folderPath) {
        var cleanPath = String(folderPath || '').trim();
        if (!cleanPath) {
            alert('目录参数无效');
            return Promise.resolve();
        }
        return kbFetchJson('/api/knowledge/bulk-index', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ folder_path: cleanPath }),
        }).then(function (j) {
            if (!j.success) {
                alert(j.error || '目录批量处理失败');
                return;
            }
            if (!j.queued_count) {
                alert('该目录下没有需要加入或重建的文件');
            } else if (j.error_count) {
                alert('目录已提交 ' + j.queued_count + ' 个任务，失败 ' + j.error_count + ' 个');
            } else {
                alert('目录已提交 ' + j.queued_count + ' 个任务');
            }
            refreshKbManager();
        });
    }

    function refreshKbManager() {
        var requests = {
            knowledgeStatus: '/api/knowledge/status',
            knowledgeList: '/api/knowledge/list',
            knowledgeJobs: '/api/knowledge/jobs?limit=30',
            knowledgeSnippets: '/api/knowledge/snippets',
            todoStatus: '/api/local-ai/todo-kb/status',
            todoEntries: '/api/local-ai/todo-kb/entries',
            productStatus: '/api/local-ai/product-compare-kb/status',
            productEntries: '/api/local-ai/product-compare-kb/entries',
        };
        var pairs = Object.keys(requests).map(function (key) {
            return kbFetchJsonSafe(requests[key]).then(function (result) {
                return { key: key, result: result };
            });
        });
        return Promise.all(pairs)
            .then(function (all) {
                var data = {};
                var failed = [];
                all.forEach(function (item) {
                    var result = item.result || {};
                    if (!result.ok) {
                        failed.push(item.key);
                        console.warn('[local-ai] kb manager request failed:', item.key, result.status, result.error || result.raw || '');
                        data[item.key] = null;
                        return;
                    }
                    var payload = result.payload || {};
                    if (!payload.success) {
                        failed.push(item.key);
                    }
                    data[item.key] = payload;
                });
                var status = data.knowledgeStatus && data.knowledgeStatus.success ? data.knowledgeStatus.status : null;
                var files = data.knowledgeList && data.knowledgeList.success ? data.knowledgeList.items || [] : [];
                var jobs = data.knowledgeJobs && data.knowledgeJobs.success ? data.knowledgeJobs.items || [] : [];
                var snippets = data.knowledgeSnippets && data.knowledgeSnippets.success ? data.knowledgeSnippets.items || [] : [];
                var todoStatus = data.todoStatus && data.todoStatus.success ? data.todoStatus.status : null;
                var todoEntries = data.todoEntries && data.todoEntries.success ? data.todoEntries.items || [] : [];
                var productStatus = data.productStatus && data.productStatus.success ? data.productStatus.status : null;
                var productEntries = data.productEntries && data.productEntries.success ? data.productEntries.items || [] : [];
                var summary = $('localAiKbManagerSummary');
                if (summary) {
                    var registeredCount = status
                        ? Number(status.registered_files != null ? status.registered_files : (fileListMeta.total || files.length))
                        : files.length;
                    var indexedCount = status && status.indexed_files != null
                        ? Number(status.indexed_files || 0)
                        : files.filter(function (item) { return !!item.indexed; }).length;
                    var pendingCount = status && status.pending_files != null
                        ? Number(status.pending_files || 0)
                        : files.filter(kbNeedsIndex).length;
                    var excludedCount = status
                        ? Number(status.excluded_files || 0)
                        : files.filter(function (item) { return !!item.excluded; }).length;
                    summary.textContent = status
                        ? '候选文件 ' +
                          registeredCount +
                          ' / 已入库 ' +
                          indexedCount +
                          ' / 待处理 ' +
                          pendingCount +
                          ' / 已排除 ' +
                          excludedCount +
                          ' / 片段 ' +
                          Number(status.total_chunks || 0) +
                          ' / 零散知识 ' +
                          Number(status.snippet_count || 0)
                        : '知识库概况加载失败';
                    if (failed.length) {
                        summary.textContent += ' / 接口失败：' + failed.map(kbManagerFailureLabel).join('、');
                    }
                }
                renderKbScanSettings(status && status.scan_settings ? status.scan_settings : null);
                renderKbManagerFiles(files, fileListMeta);
                renderKbManagerJobs(jobs);
                renderKbManagerSnippets(snippets);
                renderEntityKbPanel(
                    'localAiTodoKbEntryList',
                    'localAiTodoKbManagerSummary',
                    '待办知识库 ',
                    todoStatus,
                    todoEntries,
                    failed.indexOf('todoStatus') >= 0 || failed.indexOf('todoEntries') >= 0
                );
                renderEntityKbPanel(
                    'localAiProductKbEntryList',
                    'localAiProductKbManagerSummary',
                    '产品对比知识库 ',
                    productStatus,
                    productEntries,
                    failed.indexOf('productStatus') >= 0 || failed.indexOf('productEntries') >= 0
                );
                renderKbLineFromStatus(status);
                scheduleKbManagerPoll(status, todoStatus, productStatus);
            })
            .catch(function (e) {
                var summary = $('localAiKbManagerSummary');
                if (summary) summary.textContent = '知识库概况加载失败：' + ((e && e.message) || String(e));
            });
    }

    function scheduleKbManagerPoll(status, todoStatus, productStatus) {
        if (kbManagerPollTimer) {
            clearTimeout(kbManagerPollTimer);
            kbManagerPollTimer = null;
        }
        var modal = $('localAiKbManagerModal');
        var active = kbHasActiveJobs(status) || todoKbHasActiveJob(todoStatus) || todoKbHasActiveJob(productStatus);
        if (!modal || !modal.classList.contains('show') || !active) return;
        kbManagerPollTimer = setTimeout(refreshKbManager, 2500);
    }

    function renderEntityKbPanel(listId, summaryId, titlePrefix, status, items, loadFailed) {
        var wrap = $(listId);
        var summary = $(summaryId);
        var jobs = entityKbJobs(status);
        var running = jobs.filter(kbJobRunning).length;
        var total = Number((status && status.total_sources) || 0);
        var chunks = Number((status && status.total_chunks) || 0);
        var state = entityKbPanelState(status, loadFailed);
        var runningJob = entityKbFindRunningJob(status);
        var runningPct = Math.max(0, Math.min(100, Math.round(Number((runningJob && runningJob.progress) || 0) * 100)));

        if (summary) {
            if (state === 'load_failed') {
                summary.textContent = titlePrefix + '加载失败，请重试';
            } else if (state === 'unbuilt') {
                summary.textContent = titlePrefix + '未建立，点击“重建”开始建立知识库';
            } else if (state === 'build_failed') {
                summary.textContent = titlePrefix + '建立失败，请点击“重建”重试';
            } else if (state === 'building') {
                summary.textContent =
                    titlePrefix +
                    '建立中 ' +
                    runningPct +
                    '%' +
                    ' / 条目 ' +
                    total +
                    ' / 片段 ' +
                    chunks +
                    ' / 运行中 ' +
                    running +
                    (runningJob && runningJob.message ? ' / ' + runningJob.message : '');
            } else {
                summary.textContent = titlePrefix + '已建立 / 条目 ' + total + ' / 片段 ' + chunks + ' / 最近任务 ' + jobs.length;
            }
        }
        if (!wrap) return;
        if (state === 'load_failed') {
            wrap.innerHTML = '<div class="local-ai-kb-empty">加载失败，请点击刷新重试</div>';
            return;
        }
        if (state === 'unbuilt') {
            wrap.innerHTML = '<div class="local-ai-kb-empty">知识库尚未建立。点击“重建”后会开始 embedding。</div>';
            return;
        }
        if (state === 'build_failed') {
            wrap.innerHTML = '<div class="local-ai-kb-empty">最近一次建立失败，请点击“重建”重新执行。</div>';
            return;
        }

        var jobHtml = jobs.slice(0, 6).map(function (item) {
            var pct = Math.max(0, Math.min(100, Math.round(Number(item.progress || 0) * 100)));
            var countText = kbCountText(item);
            return (
                '<div class="local-ai-kb-item">' +
                '<div class="local-ai-kb-item-head">' +
                '<span class="local-ai-kb-item-title">任务 / ' + kbEscapeHtml(item.source_key || item.job_id || '') + '</span>' +
                '<span class="badge ' +
                (kbJobRunning(item) ? 'bg-primary' : item.status === 'completed' ? 'bg-success' : item.status === 'failed' ? 'bg-danger' : 'bg-secondary') +
                '">' +
                kbEscapeHtml(item.status || 'unknown') +
                '</span>' +
                '</div>' +
                '<div class="local-ai-kb-item-meta"><span>' +
                kbEscapeHtml(item.message || item.stage || '') +
                '</span>' +
                (countText ? '<span>' + kbEscapeHtml(countText) + '</span>' : '') +
                '<span>' + pct + '%</span>' +
                (item.error_text ? '<span>' + kbEscapeHtml(item.error_text) + '</span>' : '') +
                '</div>' +
                '</div>'
            );
        });
        if (state === 'building') {
            wrap.innerHTML = jobHtml.length ? jobHtml.join('') : '<div class="local-ai-kb-empty">正在建立知识库，请稍候…</div>';
            return;
        }

        var entryHtml = (items || []).slice(0, 120).map(function (item) {
            var metaBits = [
                kbEscapeHtml(item.entity_type || 'item'),
                '片段 ' + Number(item.chunk_count || 0),
            ];
            if (item.latest_job && item.latest_job.message) metaBits.push(kbEscapeHtml(item.latest_job.message));
            if (item.last_error) metaBits.push(kbEscapeHtml(item.last_error));
            return (
                '<div class="local-ai-kb-item">' +
                '<div class="local-ai-kb-item-head">' +
                '<span class="local-ai-kb-item-title">' + kbEscapeHtml(item.display_name || item.title || item.source_key || '') + '</span>' +
                '<span class="badge ' + entityKbItemStatusClass(item) + '">' + kbEscapeHtml(entityKbItemStatusLabel(item)) + '</span>' +
                '</div>' +
                '<div class="local-ai-kb-item-meta"><span>' + metaBits.join('</span><span>') + '</span></div>' +
                '</div>'
            );
        });

        if (!jobHtml.length && !entryHtml.length) {
            wrap.innerHTML = '<div class="local-ai-kb-empty">知识库已建立，但当前没有可展示的条目。</div>';
            return;
        }
        wrap.innerHTML = jobHtml.concat(entryHtml).join('');
    }

    function refreshKbManager(options) {
        var opts =
            options && typeof options === 'object' && typeof options.preventDefault !== 'function'
                ? options
                : {};
        var lightweight = !!opts.lightweight && !opts.forceFull;
        var fileSearchQuery = kbFileSearchQuery();
        var requests = {
            knowledgeStatus: '/api/knowledge/status',
            knowledgeJobs: '/api/knowledge/jobs?limit=30',
            todoStatus: '/api/local-ai/todo-kb/status',
            productStatus: '/api/local-ai/product-compare-kb/status',
        };
        if (!lightweight) {
            requests.knowledgeList =
                '/api/knowledge/list?limit=200&offset=0&problem_first=1' +
                (fileSearchQuery ? '&q=' + encodeURIComponent(fileSearchQuery) : '');
            requests.knowledgeSnippets = '/api/knowledge/snippets';
            requests.todoEntries = '/api/local-ai/todo-kb/entries';
            requests.productEntries = '/api/local-ai/product-compare-kb/entries';
        }
        var pairs = Object.keys(requests).map(function (key) {
            return kbFetchJsonSafe(requests[key], { timeout_ms: lightweight ? 8000 : 12000 }).then(function (result) {
                return { key: key, result: result };
            });
        });
        return Promise.all(pairs)
            .then(function (all) {
                var data = Object.assign({}, kbManagerCache);
                var failed = [];
                all.forEach(function (item) {
                    var result = item.result || {};
                    if (!result.ok) {
                        failed.push(item.key);
                        console.warn('[local-ai] kb manager request failed:', item.key, result.status, result.error || result.raw || '');
                        return;
                    }
                    var payload = result.payload || {};
                    if (!payload.success) {
                        failed.push(item.key);
                        return;
                    }
                    data[item.key] = payload;
                    kbManagerCache[item.key] = payload;
                });
                var status = data.knowledgeStatus && data.knowledgeStatus.success ? data.knowledgeStatus.status : null;
                var files = data.knowledgeList && data.knowledgeList.success ? data.knowledgeList.items || [] : [];
                var fileListMeta = data.knowledgeList && data.knowledgeList.success ? data.knowledgeList : {};
                var jobs = data.knowledgeJobs && data.knowledgeJobs.success ? data.knowledgeJobs.items || [] : [];
                var snippets = data.knowledgeSnippets && data.knowledgeSnippets.success ? data.knowledgeSnippets.items || [] : [];
                var todoStatus = data.todoStatus && data.todoStatus.success ? data.todoStatus.status : null;
                var todoEntries = data.todoEntries && data.todoEntries.success ? data.todoEntries.items || [] : [];
                var productStatus = data.productStatus && data.productStatus.success ? data.productStatus.status : null;
                var productEntries = data.productEntries && data.productEntries.success ? data.productEntries.items || [] : [];
                var summary = $('localAiKbManagerSummary');
                if (summary) {
                    var registeredCount = status
                        ? Number(status.registered_files != null ? status.registered_files : (fileListMeta.total || files.length))
                        : files.length;
                    var indexedCount = status && status.indexed_files != null
                        ? Number(status.indexed_files || 0)
                        : files.filter(function (item) { return !!item.indexed; }).length;
                    var pendingCount = status && status.pending_files != null
                        ? Number(status.pending_files || 0)
                        : files.filter(kbNeedsIndex).length;
                    var excludedCount = status
                        ? Number(status.excluded_files || 0)
                        : files.filter(function (item) { return !!item.excluded; }).length;
                    summary.textContent = status
                        ? '候选文件 ' +
                          registeredCount +
                          ' / 已入库 ' +
                          indexedCount +
                          ' / 待处理 ' +
                          pendingCount +
                          ' / 已排除 ' +
                          excludedCount +
                          ' / 片段 ' +
                          Number(status.total_chunks || 0) +
                          ' / 零散知识 ' +
                          Number(status.snippet_count || 0)
                        : '知识库概况加载失败';
                    if (failed.length) {
                        summary.textContent += ' / 接口失败：' + failed.map(kbManagerFailureLabel).join('、');
                    }
                }
                renderKbScanSettings(status && status.scan_settings ? status.scan_settings : null);
                renderKbManagerFiles(files, fileListMeta);
                renderKbManagerJobs(jobs);
                renderKbManagerSnippets(snippets);
                renderEntityKbPanel(
                    'localAiTodoKbEntryList',
                    'localAiTodoKbManagerSummary',
                    '待办知识库',
                    todoStatus,
                    todoEntries,
                    failed.indexOf('todoStatus') >= 0 || (failed.indexOf('todoEntries') >= 0 && !kbManagerCache.todoEntries)
                );
                renderEntityKbPanel(
                    'localAiProductKbEntryList',
                    'localAiProductKbManagerSummary',
                    '产品对比知识库',
                    productStatus,
                    productEntries,
                    failed.indexOf('productStatus') >= 0 || (failed.indexOf('productEntries') >= 0 && !kbManagerCache.productEntries)
                );
                renderKbLineFromStatus(status);
                var stillActive = kbHasActiveJobs(status) || todoKbHasActiveJob(todoStatus) || todoKbHasActiveJob(productStatus);
                if (lightweight && !stillActive) {
                    return refreshKbManager({ forceFull: true });
                }
                scheduleKbManagerPoll(status, todoStatus, productStatus);
            })
            .catch(function (e) {
                var summary = $('localAiKbManagerSummary');
                if (summary) summary.textContent = '知识库概况加载失败：' + ((e && e.message) || String(e));
            });
    }

    function scheduleKbManagerPoll(status, todoStatus, productStatus) {
        if (kbManagerPollTimer) {
            clearTimeout(kbManagerPollTimer);
            kbManagerPollTimer = null;
        }
        var modal = $('localAiKbManagerModal');
        var active = kbHasActiveJobs(status) || todoKbHasActiveJob(todoStatus) || todoKbHasActiveJob(productStatus);
        if (!modal || !modal.classList.contains('show') || !active) return;
        kbManagerPollTimer = setTimeout(function () {
            refreshKbManager({ lightweight: true });
        }, 4000);
    }

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
        if (['general', 'knowledge', 'todo', 'erp'].indexOf(mode) < 0) mode = 'general';
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

    function localAiPhaseLabel(phase) {
        var map = {
            idle: '空闲',
            requesting: '请求中',
            request_ok: '请求成功',
            preparing: '处理中',
            processing: '处理中',
            mcp: '工具处理中',
            model_loading: '模型加载中',
            prompt_processing: '提示词处理中',
            generating: '生成回答中',
            planning: '规划处理中',
            completed: '处理完成',
            error: '请求失败',
            stopped: '已停止',
        };
        return map[String(phase || '')] || String(phase || '') || '处理中';
    }

    function setRunStatus(text) {
        var el = $('localAiRunStatusLine');
        if (el) el.textContent = text || '对话状态：空闲';
    }

    function appendAssistantLoadingBubble() {
        var box = $('localAiMessages');
        if (!box) return null;
        var wrap = document.createElement('div');
        wrap.className = 'local-ai-msg assistant';
        var loadingBox = document.createElement('div');
        loadingBox.className = 'local-ai-loading';
        loadingBox.innerHTML =
            '<div class="local-ai-loading-spinner" role="status" aria-label="加载中"></div>' +
            '<div class="local-ai-loading-title">正在发起请求…</div>' +
            '<div class="drawio-ai-progress-track local-ai-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="drawio-ai-progress-ind local-ai-progress-ind is-determinate"></div></div>' +
            '<div class="local-ai-loading-percent">进度 0%</div>' +
            '<div class="local-ai-loading-meta">已用 0.0 秒 · 已接收 0 字符 · 阶段: 请求中</div>';
        wrap.appendChild(loadingBox);
        box.appendChild(wrap);
        box.scrollTop = box.scrollHeight;
        return {
            wrap: wrap,
            titleEl: loadingBox.querySelector('.local-ai-loading-title'),
            progressTrackEl: loadingBox.querySelector('.local-ai-progress-track'),
            progressFillEl: loadingBox.querySelector('.local-ai-progress-ind'),
            percentEl: loadingBox.querySelector('.local-ai-loading-percent'),
            metaEl: loadingBox.querySelector('.local-ai-loading-meta'),
        };
    }

    function clampProgressPercent(value) {
        var n = Number(value);
        if (!isFinite(n)) return null;
        return Math.max(0, Math.min(100, n));
    }

    function formatProgressPercent(value) {
        var n = clampProgressPercent(value);
        if (n == null) return '';
        return n >= 99.5 ? '100%' : n.toFixed(n >= 10 ? 0 : 1) + '%';
    }

    function applyLoadingProgress(refs, percent, stagePercent) {
        if (!refs) return;
        var n = clampProgressPercent(percent);
        if (n == null) return;
        var text = '进度 ' + formatProgressPercent(n);
        var sp = clampProgressPercent(stagePercent);
        if (sp != null && n < 99.5) {
            text += ' · 当前阶段 ' + formatProgressPercent(sp);
        }
        if (refs.percentEl) refs.percentEl.textContent = text;
        if (refs.progressFillEl) refs.progressFillEl.style.width = n + '%';
        if (refs.progressTrackEl) refs.progressTrackEl.setAttribute('aria-valuenow', String(Math.round(n)));
    }

    function replaceLoadingBubbleWithMarkdown(wrap, rawText) {
        if (!wrap) return null;
        wrap.innerHTML = '';
        var inner = document.createElement('div');
        inner.className = 'local-ai-md markdown-body';
        wrap.appendChild(inner);
        renderAssistantMarkdown(inner, rawText);
        return inner;
    }

    function replaceLoadingBubbleWithPlainText(wrap, rawText) {
        if (!wrap) return null;
        wrap.innerHTML = '';
        var inner = document.createElement('div');
        inner.className = 'local-ai-md markdown-body';
        inner.style.whiteSpace = 'pre-wrap';
        wrap.appendChild(inner);
        setAssistantPlain(inner, rawText);
        return inner;
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

    function resolvePageContext() {
        try {
            if (typeof window.YobboyLocalAIContextProvider === 'function') {
                var ctx = window.YobboyLocalAIContextProvider();
                if (ctx && typeof ctx === 'object') return ctx;
            }
        } catch (e) {}
        return null;
    }

    function openPanelWithOptions(options) {
        options = options || {};
        if (options.mode) setLocalAiMode(options.mode);
        togglePanel(true);
        var input = $('localAiInput');
        if (input && typeof options.message === 'string') {
            input.value = options.message;
        }
        if (input && options.focus !== false) {
            setTimeout(function () {
                input.focus();
            }, 0);
        }
        if (options.send && sendHandler) {
            setTimeout(function () {
                sendHandler();
            }, 0);
        }
    }

    async function sendStream(messages, mode, forceMutate) {
        var loadingRefs = appendAssistantLoadingBubble();
        var assistantEl = loadingRefs ? loadingRefs.wrap : appendMsg('assistant', '');
        var inner = assistantMarkdownRoot(assistantEl);
        var full = '';
        var progressChars = 0;
        var progressPhase = 'requesting';
        var progressMessage = '正在发起请求…';
        var progressPercent = 2;
        var stageProgressPercent = null;
        var requestStart = performance.now();
        var loadingRemoved = false;
        var reader = null;
        var doneSeen = false;
        var ctl = new AbortController();
        currentStreamAbort = ctl;
        setGeneratingState(true);
        setRunStatus('对话状态：请求中');
        applyLoadingProgress(loadingRefs, progressPercent, stageProgressPercent);

        var tick = window.setInterval(function () {
            if (!loadingRefs || loadingRemoved || !loadingRefs.metaEl) return;
            var sec = ((performance.now() - requestStart) / 1000).toFixed(1);
            if (loadingRefs.titleEl) {
                loadingRefs.titleEl.textContent = progressMessage || '正在' + localAiPhaseLabel(progressPhase) + '…';
            }
            applyLoadingProgress(loadingRefs, progressPercent, stageProgressPercent);
            loadingRefs.metaEl.textContent =
                '进度 ' +
                formatProgressPercent(progressPercent) +
                ' · 已用 ' +
                sec +
                ' 秒 · 已接收 ' +
                Math.max(progressChars, full.length) +
                ' 字符 · 阶段: ' +
                localAiPhaseLabel(progressPhase);
        }, 200);

        function setPhase(phase, message, percent, stagePercent) {
            progressPhase = String(phase || progressPhase || 'processing');
            progressMessage = String(message || progressMessage || '');
            var pct = clampProgressPercent(percent);
            if (pct != null) {
                progressPercent = pct;
            } else if (progressPhase === 'completed') {
                progressPercent = 100;
            } else if (progressPhase === 'generating' && progressPercent < 66) {
                progressPercent = 66;
            }
            var stagePct = clampProgressPercent(stagePercent);
            stageProgressPercent = stagePct == null ? stageProgressPercent : stagePct;
            applyLoadingProgress(loadingRefs, progressPercent, stageProgressPercent);
            setRunStatus(
                '对话状态：' +
                    localAiPhaseLabel(progressPhase) +
                    (progressMessage ? ' · ' + progressMessage : '') +
                    ' · ' +
                    formatProgressPercent(progressPercent)
            );
        }

        function removeLoadingBubble() {
            if (loadingRemoved) return;
            loadingRemoved = true;
            window.clearInterval(tick);
            if (assistantEl && assistantEl.parentNode) assistantEl.parentNode.removeChild(assistantEl);
        }

        function renderStreamingAssistantBubble(rawText) {
            if (!assistantEl || !assistantEl.parentNode) return;
            if (!loadingRemoved) {
                loadingRemoved = true;
                window.clearInterval(tick);
                inner = replaceLoadingBubbleWithPlainText(assistantEl, rawText || '');
            } else if (inner) {
                setAssistantPlain(inner, rawText || '');
            }
            var box = $('localAiMessages');
            if (box) box.scrollTop = box.scrollHeight;
        }

        function finalizeAssistantBubble(rawText) {
            if (!assistantEl || !assistantEl.parentNode) return;
            window.clearInterval(tick);
            inner = replaceLoadingBubbleWithMarkdown(assistantEl, rawText || '');
            loadingRemoved = true;
        }

        function handleParsedEvents(events) {
            for (var i = 0; i < events.length; i++) {
                var e = events[i];
                if (e.event === 'token' && e.data && e.data.t) {
                    full += e.data.t;
                    progressChars = Math.max(progressChars, full.length);
                    progressPercent = Math.max(
                        clampProgressPercent(progressPercent) || 0,
                        Math.min(96, 68 + Math.log(Math.max(full.length, 1) + 1) * 4.2)
                    );
                    renderStreamingAssistantBubble(full);
                    setPhase('generating', '正在生成回答…', progressPercent);
                } else if (e.event === 'meta' && e.data) {
                    if (e.data.trace_id) {
                        window._localAiLastTraceId = String(e.data.trace_id);
                        if (window.console && typeof window.console.info === 'function') {
                            window.console.info('[local-ai-trace] trace_id=', window._localAiLastTraceId);
                        }
                    }
                    setPhase('preparing', '请求成功，正在准备上下文', 5);
                } else if (e.event === 'chat_progress' && e.data) {
                    progressChars = Math.max(progressChars, Number(e.data.received_chars || 0), full.length);
                    setPhase(
                        e.data.phase || 'processing',
                        e.data.message || '',
                        e.data.percent,
                        e.data.stage_percent
                    );
                } else if (e.event === 'todo_patch') {
                    if (!full.trim() && assistantEl && assistantEl.parentNode) {
                        removeLoadingBubble();
                    }
                    setPhase('planning', '已生成待确认变更', 35);
                    handleTodoPatch(e.data);
                } else if (e.event === 'mcp_call' && e.data) {
                    setPhase('mcp', '正在调用工具：' + String(e.data.tool || 'MCP'), 18);
                    addMcpLog(e.data);
                } else if (e.event === 'done') {
                    doneSeen = true;
                    stageProgressPercent = 100;
                    setPhase('completed', '回答生成完成', 100, 100);
                    break;
                } else if (e.event === 'error' && e.data) {
                    full += '\n[错误] ' + (e.data.message || JSON.stringify(e.data));
                    progressChars = Math.max(progressChars, full.length);
                    setPhase('error', e.data.message || '处理失败');
                }
            }
        }

        try {
            var payload = {
                messages: messages,
                mode: mode,
                force_todo_mutate: !!forceMutate,
            };
            var pageContext = resolvePageContext();
            if (pageContext) payload.page_context = pageContext;
            var res = await fetch('/api/local-ai/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: ctl.signal,
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                setPhase('error', '请求失败 HTTP ' + res.status);
                finalizeAssistantBubble('请求失败: HTTP ' + res.status);
                return full;
            }
            setPhase('request_ok', '请求成功，等待服务端处理', 3);
            reader = res.body.getReader();
            var dec = new TextDecoder();
            var carry = '';
            while (!doneSeen) {
                var rd = await reader.read();
                if (rd.done) {
                    if (carry) {
                        var tailParsed = parseSseBlocks('\n\n', carry);
                        carry = tailParsed.carry;
                        handleParsedEvents(tailParsed.events || []);
                    }
                    break;
                }
                var chunk = dec.decode(rd.value, { stream: true });
                var parsed = parseSseBlocks(chunk, carry);
                carry = parsed.carry;
                handleParsedEvents(parsed.events || []);
                var box = $('localAiMessages');
                if (box) box.scrollTop = box.scrollHeight;
            }
            if (doneSeen && reader) {
                try {
                    await reader.cancel();
                } catch (e) {}
            }
        } catch (err) {
            if (!(err && err.name === 'AbortError')) {
                full += '\n[错误] ' + ((err && err.message) || String(err));
                progressChars = Math.max(progressChars, full.length);
                setPhase('error', (err && err.message) || String(err));
            } else if (!full.trim()) {
                full = '已停止生成。';
                setPhase('stopped', '已停止生成');
            }
        } finally {
            if (reader) {
                try {
                    reader.releaseLock();
                } catch (e) {}
            }
            currentStreamAbort = null;
            setGeneratingState(false);
            window.clearInterval(tick);
        }
        if (!loadingRemoved && !String(full || '').trim()) {
            full = '（本次请求未返回可展示文本）';
        }
        if (assistantEl && assistantEl.parentNode) {
            finalizeAssistantBubble(full);
        }
        return full;
    }

    var pendingPatchOps = null;
    var pendingPatchRefQuestion = '';
    var pendingPatchConfirmToken = '';
    var pendingPatchSummary = '';
    var pendingPatchJsonDirty = false;
    var pendingPatchJsonRendering = false;

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

    function syncPatchJsonFromOps(force) {
        var ta = $('localAiPatchOpsJson');
        if (!ta) return;
        if (!force && pendingPatchJsonDirty) return;
        pendingPatchJsonRendering = true;
        try {
            ta.value = JSON.stringify(Array.isArray(pendingPatchOps) ? pendingPatchOps : [], null, 2);
            pendingPatchJsonDirty = false;
        } catch (e) {
            ta.value = '';
        } finally {
            pendingPatchJsonRendering = false;
        }
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
        pendingPatchJsonDirty = false;
        ensureRefCache().finally(function () {
            renderOpsEditor();
        });
        $('localAiPatchSummary').textContent = pendingPatchSummary || '有待确认的操作';
        renderOpsEditor();
        syncPatchJsonFromOps(true);
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
            options.push('<option value="' + p.ref + '"' + selected + '>' + p.name + '（' + p.ref + '）</option>');
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
            options.push('<option value="' + t.ref + '"' + selected + '>' + t.summary + '（' + t.ref + '）</option>');
        });
        if (cur && !matched) {
            options.push('<option value="' + cur + '" selected>当前值（' + cur + '）</option>');
        }
        return options.join('');
    }

    function renderOpsEditor() {
        var box = $('localAiPatchOpsEditor');
        if (!box) return;
        syncPatchJsonFromOps(false);
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
            pendingPatchJsonDirty = false;
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
                pendingPatchJsonDirty = false;
                renderOpsEditor();
                persistPendingPatch();
                return;
            }
            var fieldSel = ev.target.closest('select[data-key][data-type]');
            if (fieldSel && fieldSel.getAttribute('data-key') === 'project_id') {
                pendingPatchOps = collectOpsFromEditor();
                pendingPatchJsonDirty = false;
                renderOpsEditor();
                persistPendingPatch();
                return;
            }
            pendingPatchOps = collectOpsFromEditor();
            syncPatchJsonFromOps(true);
            persistPendingPatch();
        });
        box.addEventListener('input', function () {
            pendingPatchOps = collectOpsFromEditor();
            syncPatchJsonFromOps(true);
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
        pendingPatchJsonDirty = false;
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
        syncPatchJsonFromOps(true);
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
        if (pendingPatchJsonDirty && ta && ta.value && ta.value.trim()) {
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
            syncPatchJsonFromOps(true);
        } else {
            pendingPatchOps = ops;
            pendingPatchJsonDirty = false;
            renderOpsEditor();
            syncPatchJsonFromOps(true);
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
        pendingPatchJsonDirty = false;
        persistPendingPatch();
        renderOpsEditor();
        syncPatchJsonFromOps(true);
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
            pendingPatchJsonDirty = false;
            persistPendingPatch();
            try {
                window.dispatchEvent(new CustomEvent('yobboy:todo-updated', { detail: { source: 'local-ai' } }));
            } catch (e) {}
            refreshKbManager();
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
        setRunStatus('对话状态：空闲');
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
            if (sm && ['general', 'knowledge', 'todo', 'erp'].indexOf(sm) >= 0) setLocalAiMode(sm);
            else onModeChange();
        } catch (e) {
            onModeChange();
        }

        $('localAiClearHistBtn').addEventListener('click', function () {
            localStorage.removeItem(STORAGE_KEY);
            $('localAiMessages').innerHTML = '';
        });
        var kbManageBtn = $('localAiKbManageBtn');
        var kbModalEl = $('localAiKbManagerModal');
        var kbModal = kbModalEl && typeof bootstrap !== 'undefined' ? new bootstrap.Modal(kbModalEl) : null;
        if (kbManageBtn && kbModal) {
            kbManageBtn.addEventListener('click', function () {
                kbModal.show();
                refreshKbManager();
            });
        }
        if (kbModalEl) {
            kbModalEl.addEventListener('hidden.bs.modal', function () {
                if (kbManagerPollTimer) {
                    clearTimeout(kbManagerPollTimer);
                    kbManagerPollTimer = null;
                }
            });
        }
        renderEntityKbDefaultPlaceholder('localAiTodoKbManagerSummary', 'localAiTodoKbEntryList', '待办知识库');
        renderEntityKbDefaultPlaceholder('localAiProductKbManagerSummary', 'localAiProductKbEntryList', '产品对比知识库');
        var todoKbManagerRefreshBtn = $('localAiTodoKbManagerRefreshBtn');
        if (todoKbManagerRefreshBtn) {
            todoKbManagerRefreshBtn.addEventListener('click', refreshKbManager);
        }
        var todoKbManagerRebuildBtn = $('localAiTodoKbManagerRebuildBtn');
        if (todoKbManagerRebuildBtn) {
            todoKbManagerRebuildBtn.addEventListener('click', rebuildTodoKb);
        }
        var productKbManagerRefreshBtn = $('localAiProductKbManagerRefreshBtn');
        if (productKbManagerRefreshBtn) {
            productKbManagerRefreshBtn.addEventListener('click', refreshKbManager);
        }
        var productKbManagerRebuildBtn = $('localAiProductKbManagerRebuildBtn');
        if (productKbManagerRebuildBtn) {
            productKbManagerRebuildBtn.addEventListener('click', rebuildProductCompareKb);
        }

        var kbRefreshBtn = $('localAiKbRefreshBtn');
        if (kbRefreshBtn) {
            kbRefreshBtn.addEventListener('click', refreshKbManager);
        }
        var kbFileSearchInput = $('localAiKbFileSearchInput');
        var kbFileSearchBtn = $('localAiKbFileSearchBtn');
        var kbFileSearchClearBtn = $('localAiKbFileSearchClearBtn');
        if (kbFileSearchBtn) {
            kbFileSearchBtn.addEventListener('click', function () {
                refreshKbManager({ forceFull: true });
            });
        }
        if (kbFileSearchInput) {
            kbFileSearchInput.addEventListener('keydown', function (ev) {
                if (ev.key !== 'Enter') return;
                ev.preventDefault();
                refreshKbManager({ forceFull: true });
            });
        }
        if (kbFileSearchClearBtn) {
            kbFileSearchClearBtn.addEventListener('click', function () {
                if (kbFileSearchInput) kbFileSearchInput.value = '';
                refreshKbManager({ forceFull: true });
            });
        }
        var kbFolderSettingsModalEl = $('localAiKbFolderSettingsModal');
        var kbFolderSettingsModal =
            kbFolderSettingsModalEl && typeof bootstrap !== 'undefined' ? new bootstrap.Modal(kbFolderSettingsModalEl) : null;
        var kbOpenFolderSettingsBtn = $('localAiKbOpenFolderSettingsBtn');
        if (kbOpenFolderSettingsBtn && kbFolderSettingsModal) {
            kbOpenFolderSettingsBtn.addEventListener('click', function () {
                kbFolderSettingsModal.show();
                loadKbRootFolders();
            });
        }
        var kbSaveFolderSettingsBtn = $('localAiKbSaveFolderSettingsBtn');
        if (kbSaveFolderSettingsBtn) {
            kbSaveFolderSettingsBtn.addEventListener('click', function () {
                var dirs = collectExcludedRootFolders();
                kbSaveFolderSettingsBtn.disabled = true;
                kbFetchJson('/api/knowledge/settings', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scan_excluded_dirs: dirs }),
                })
                    .then(function (j) {
                        if (!j.success) {
                            alert(j.error || '保存扫描设置失败');
                            return null;
                        }
                        renderKbScanSettings(j.settings || {});
                        if (kbFolderSettingsModal) kbFolderSettingsModal.hide();
                        return kbFetchJson('/api/knowledge/scan', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ async: true }),
                        });
                    })
                    .then(function (scanResult) {
                        if (scanResult && !scanResult.success) {
                            alert(scanResult.error || '重新扫描启动失败');
                        }
                        refreshKbManager();
                    })
                    .finally(function () {
                        kbSaveFolderSettingsBtn.disabled = false;
                    });
            });
        }
        var kbFolderList = $('localAiKbFolderList');
        if (kbFolderList) {
            kbFolderList.addEventListener('change', function (ev) {
                var input = ev.target.closest('input[data-kb-folder-idx]');
                if (!input) return;
                var item = kbRootFolders[Number(input.getAttribute('data-kb-folder-idx'))] || {};
                item.excluded = !input.checked;
                item.included = !!input.checked;
                renderKbRootFolders(kbRootFolders);
            });
        }
        var kbScanBtn = $('localAiKbScanBtn');
        if (kbScanBtn) {
            kbScanBtn.addEventListener('click', function () {
                kbScanBtn.disabled = true;
                kbFetchJson('/api/knowledge/scan', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ async: true }),
                })
                    .then(function (j) {
                        if (!j.success) alert(j.error || '扫描启动失败');
                        refreshKbManager();
                    })
                    .finally(function () {
                        setTimeout(function () {
                            kbScanBtn.disabled = false;
                        }, 800);
                    });
            });
        }
        var kbQueueAllBtn = $('localAiKbQueueAllBtn');
        if (kbQueueAllBtn) {
            kbQueueAllBtn.addEventListener('click', function () {
                var paths = (kbLastFiles || []).filter(kbNeedsIndex).map(function (item) { return item.path; });
                queueKbFiles(paths);
            });
        }
        var kbSnippetAddBtn = $('localAiKbSnippetAddBtn');
        if (kbSnippetAddBtn) {
            kbSnippetAddBtn.addEventListener('click', function () {
                var title = $('localAiKbSnippetTitle');
                var text = $('localAiKbSnippetText');
                var payload = {
                    title: title ? title.value.trim() : '',
                    text: text ? text.value.trim() : '',
                };
                if (!payload.text) {
                    alert('请输入零散知识内容');
                    return;
                }
                kbFetchJson('/api/knowledge/snippet', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }).then(function (j) {
                    if (!j.success) {
                        alert(j.error || '添加失败');
                        return;
                    }
                    if (title) title.value = '';
                    if (text) text.value = '';
                    refreshKbManager();
                });
            });
        }
        var kbFileList = $('localAiKbFileList');
        if (kbFileList) {
            kbFileList.addEventListener('click', function (ev) {
                var folderBtn = ev.target.closest('[data-kb-folder-action]');
                if (folderBtn) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    var folderPath = decodeURIComponent(folderBtn.getAttribute('data-folder-path') || '');
                    if (folderBtn.getAttribute('data-kb-folder-action') === 'queue') {
                        queueKbFolder(folderPath);
                    }
                    return;
                }
                var rootFilesBtn = ev.target.closest('[data-kb-root-files-action]');
                if (rootFilesBtn) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    var rootPaths = (kbLastFiles || [])
                        .filter(function (item) {
                            return String(item.path || '').indexOf('/') < 0 && kbNeedsIndex(item);
                        })
                        .map(function (item) {
                            return item.path;
                        });
                    queueKbFiles(rootPaths);
                    return;
                }
                var btn = ev.target.closest('[data-kb-action]');
                var item = ev.target.closest('[data-path]');
                if (!btn || !item) return;
                var path = decodeURIComponent(item.getAttribute('data-path') || '');
                if (!path) return;
                var action = btn.getAttribute('data-kb-action');
                if (action === 'queue') {
                    queueKbFiles([path]).then(function () {
                        if (path === currentKbPreviewPath && window.YobboyLocalAI && window.YobboyLocalAI._syncPreviewKb) {
                            window.YobboyLocalAI._syncPreviewKb();
                        }
                    });
                    return;
                }
                if (action === 'remove') {
                    if (!confirm('确定移除该知识库文件吗？')) return;
                    kbFetchJson('/api/knowledge/entry?path=' + encodeURIComponent(path), { method: 'DELETE' }).then(function () {
                        refreshKbManager();
                        if (path === currentKbPreviewPath && window.YobboyLocalAI && window.YobboyLocalAI._syncPreviewKb) {
                            window.YobboyLocalAI._syncPreviewKb();
                        }
                    });
                }
            });
        }
        var kbSnippetList = $('localAiKbSnippetList');
        if (kbSnippetList) {
            kbSnippetList.addEventListener('click', function (ev) {
                var btn = ev.target.closest('[data-kb-action]');
                var item = ev.target.closest('[data-snippet-id]');
                if (!btn || !item) return;
                if (btn.getAttribute('data-kb-action') !== 'remove-snippet') return;
                var snippetId = decodeURIComponent(item.getAttribute('data-snippet-id') || '');
                if (!snippetId) return;
                if (!confirm('确定删除这条零散知识吗？')) return;
                kbFetchJson('/api/knowledge/snippet?id=' + encodeURIComponent(snippetId), { method: 'DELETE' }).then(function () {
                    refreshKbManager();
                });
            });
        }
        $('localAiPendingPatchBtn').addEventListener('click', openPendingPatchModal);
        $('localAiPatchAddOpBtn').addEventListener('click', function () {
            if (!Array.isArray(pendingPatchOps)) pendingPatchOps = [];
            pendingPatchOps.push(_opDefault('create_task'));
            pendingPatchJsonDirty = false;
            renderOpsEditor();
            persistPendingPatch();
        });
        var patchJson = $('localAiPatchOpsJson');
        if (patchJson) {
            patchJson.addEventListener('input', function () {
                if (!pendingPatchJsonRendering) pendingPatchJsonDirty = true;
            });
        }
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
        sendHandler = doSend;

        $('localAiSendBtn').addEventListener('click', doSend);
        $('localAiInput').addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                doSend();
            }
        });

        setInterval(function () {
            if ($('localAiPanel') && $('localAiPanel').classList.contains('visible') && !isGenerating) {
                refreshStatus();
            }
        }, 4000);
        refreshKbLine();
    });

    window.YobboyLocalAI = {
        open: openPanelWithOptions,
        close: function () {
            togglePanel(false);
        },
        setMode: setLocalAiMode,
        setInput: function (text) {
            var input = $('localAiInput');
            if (input) input.value = text == null ? '' : String(text);
        },
        send: function () {
            if (sendHandler) return sendHandler();
        },
        _renderPreviewMeta: function (j) {
            var st = $('kbStatus');
            var addBtn = $('kbAddBtn');
            var rebuildBtn = $('kbRebuildBtn');
            var removeBtn = $('kbRemoveBtn');
            var progress = $('kbProgress');
            var meta = j && j.meta ? j.meta : null;
            var job = meta && meta.latest_job ? meta.latest_job : null;
            var indexed = !!(j && j.in_knowledge);
            if (st) {
                if (indexed) {
                    if (kbJobRunning(job)) {
                        st.textContent = '处理中';
                        st.className = 'badge bg-primary badge-kb';
                    } else if (meta && String(meta.index_status || '').indexOf('indexed') === 0) {
                        st.textContent = '已纳入';
                        st.className = 'badge bg-success badge-kb';
                    } else {
                        st.textContent = '已登记';
                        st.className = 'badge bg-secondary badge-kb';
                    }
                } else {
                    st.textContent = '未纳入';
                    st.className = 'badge bg-secondary badge-kb';
                }
            }
            if (addBtn) addBtn.style.display = indexed ? 'none' : '';
            if (rebuildBtn) rebuildBtn.style.display = indexed ? '' : 'none';
            if (removeBtn) removeBtn.disabled = kbJobRunning(job);
            if (rebuildBtn) rebuildBtn.disabled = kbJobRunning(job);
            renderKbProgress(progress, job, meta && meta.index_status);
        },
        _syncPreviewKb: function () {
            if (!currentKbPreviewPath) return;
            kbFetchJson('/api/knowledge/entry?path=' + encodeURIComponent(currentKbPreviewPath))
                .then(function (j) {
                    if (window.YobboyLocalAI && window.YobboyLocalAI._renderPreviewMeta) {
                        window.YobboyLocalAI._renderPreviewMeta(j);
                    }
                    var meta = j && j.meta ? j.meta : null;
                    var job = meta && meta.latest_job ? meta.latest_job : null;
                    if (kbJobRunning(job)) ensureKbPreviewPoll();
                })
                .catch(function () {});
        },
        onPreviewMdTxt: function (filepath, filename) {
            var ext = (filename.split('.').pop() || '').toLowerCase();
            if (!['md', 'markdown', 'txt'].includes(ext)) return;
            currentKbPreviewPath = filepath;

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
                '<span>知识库</span><span id="kbStatus" class="badge bg-secondary badge-kb">…</span>' +
                '<div class="knowledge-preview-progress" id="kbProgress" style="display:none;">' +
                '<div class="knowledge-preview-progress-track"><div class="knowledge-preview-progress-fill"></div></div>' +
                '<span class="knowledge-preview-progress-text"></span>' +
                '</div>' +
                '<button type="button" class="btn btn-sm btn-primary" id="kbAddBtn">加入知识库</button>' +
                '<button type="button" class="btn btn-sm btn-outline-primary" id="kbRebuildBtn" style="display:none;">重建索引</button>' +
                '<button type="button" class="btn btn-sm btn-outline-secondary" id="kbManageBtn">管理</button>' +
                '<button type="button" class="btn btn-sm btn-outline-danger" id="kbRemoveBtn">移除</button>' +
                '</div>';

            function syncKb() {
                kbFetchJson('/api/knowledge/entry?path=' + encodeURIComponent(filepath))
                    .then(function (j) {
                        if (window.YobboyLocalAI && window.YobboyLocalAI._renderPreviewMeta) {
                            window.YobboyLocalAI._renderPreviewMeta(j);
                        }
                        var meta = j && j.meta ? j.meta : null;
                        var job = meta && meta.latest_job ? meta.latest_job : null;
                        if (kbJobRunning(job)) ensureKbPreviewPoll();
                    });
            }

            syncKb();

            $('kbAddBtn').onclick = function () {
                kbFetchJson('/api/knowledge/entry', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: filepath, tags: ['default'], note: '', async: true }),
                })
                    .then(function (j) {
                        alert(j.success ? '已加入后台队列，可随时查看进度' : j.error || '失败');
                        syncKb();
                    });
            };
            $('kbRebuildBtn').onclick = function () {
                kbFetchJson('/api/knowledge/rebuild', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: filepath, async: true }),
                }).then(function (j) {
                    alert(j.success ? '已加入后台重建队列' : j.error || '失败');
                    syncKb();
                });
            };
            $('kbManageBtn').onclick = function () {
                var btn = $('localAiKbManageBtn');
                if (btn) btn.click();
            };
            $('kbRemoveBtn').onclick = function () {
                kbFetchJson('/api/knowledge/entry?path=' + encodeURIComponent(filepath), { method: 'DELETE' })
                    .then(function (j) {
                        alert(j.success ? '已移除' : j.error || '失败');
                        syncKb();
                    });
            };
        },
        hideKnowledgeBar: function () {
            var w = document.getElementById('knowledgePreviewBarWrap');
            if (w) w.style.display = 'none';
            currentKbPreviewPath = '';
            if (kbPreviewPollTimer) {
                clearTimeout(kbPreviewPollTimer);
                kbPreviewPollTimer = null;
            }
        },
    };

    window.addEventListener('yobboy:local-ai-open', function (event) {
        openPanelWithOptions((event && event.detail) || {});
    });
})();
