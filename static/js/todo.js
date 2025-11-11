(() => {
    'use strict';

    const orientationCacheKey = 'todo:orientation';

    const state = {
        todos: [],
        timeline: [],
        projects: {},
        orientation: sessionStorage.getItem(orientationCacheKey) || 'vertical',
        selectedTodoId: null,
        directAccess: document.body.dataset.directAccess === 'true',
        filters: {
            text: '',
            project: 'all',
        },
    };

    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    if (!['vertical', 'horizontal'].includes(state.orientation)) {
        state.orientation = 'vertical';
    }

    const refs = {
        timeline: document.getElementById('timelineContainer'),
        timelineWrapper: document.querySelector('.timeline-container'),
        timelineCount: document.getElementById('timelineCount'),
        orientationToggle: document.getElementById('orientationToggle'),
        alertContainer: document.getElementById('alertContainer'),
        createForm: document.getElementById('createTodoForm'),
        commentForm: document.getElementById('commentForm'),
        editForm: document.getElementById('editTodoForm'),
        createModalEl: document.getElementById('createModal'),
        commentModalEl: document.getElementById('commentModal'),
        editModalEl: document.getElementById('editModal'),
        searchInput: document.getElementById('searchInput'),
        projectFilter: document.getElementById('projectFilter'),
        projectOptions: document.getElementById('projectOptions'),
        newTodoButton: document.getElementById('newTodoButton'),
        timelineNewButton: document.getElementById('timelineNewButton'),
        todayList: document.getElementById('todayList'),
        upcomingList: document.getElementById('upcomingList'),
        todayCount: document.getElementById('todayCount'),
        overdueCount: document.getElementById('overdueCount'),
        pendingCount: document.getElementById('pendingCount'),
    };

    const modals = {
        create: refs.createModalEl ? new bootstrap.Modal(refs.createModalEl) : null,
        comment: refs.commentModalEl ? new bootstrap.Modal(refs.commentModalEl) : null,
        edit: refs.editModalEl ? new bootstrap.Modal(refs.editModalEl) : null,
    };

    let commentTargetId = null;
    let editTargetId = null;

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatMultiline(text) {
        return escapeHtml(text).replace(/\r?\n/g, '<br>');
    }

    function pad(num) {
        return String(num).padStart(2, '0');
    }

    function formatDate(isoString) {
        if (!isoString) return '--';
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) {
            return isoString;
        }
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function normalizeProjectName(name) {
        return (name || '').trim();
    }

    function getProjectColor(project) {
        const key = normalizeProjectName(project);
        if (!key) return null;
        const info = state.projects[key];
        if (!info) {
            const fallback = state.todos.find((todo) => normalizeProjectName(todo.project) === key);
            return fallback ? fallback.color : null;
        }
        if (typeof info === 'string') {
            return info;
        }
        return info.color || null;
    }

    function hslToHex(h, s, l) {
        const hue = h / 360;
        const sat = s / 100;
        const light = l / 100;

        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };

        let r;
        let g;
        let b;

        if (sat === 0) {
            r = g = b = light;
        } else {
            const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
            const p = 2 * light - q;
            r = hue2rgb(p, q, hue + 1 / 3);
            g = hue2rgb(p, q, hue);
            b = hue2rgb(p, q, hue - 1 / 3);
        }

        const toHex = (x) => {
            const hex = Math.round(x * 255).toString(16).padStart(2, '0');
            return hex;
        };

        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    function randomColor() {
        const h = Math.floor(Math.random() * 360);
        const s = 65 + Math.random() * 25;
        const l = 47 + Math.random() * 12;
        return hslToHex(h, s, l);
    }

    function refreshProjectOptions() {
        const projects = new Set();
        Object.keys(state.projects || {}).forEach((project) => {
            const key = normalizeProjectName(project);
            if (key) {
                projects.add(key);
            }
        });
        state.todos.forEach((todo) => {
            const key = normalizeProjectName(todo.project);
            if (key) {
                projects.add(key);
            }
        });
        const projectList = Array.from(projects).sort((a, b) => a.localeCompare(b, 'zh-CN'));

        if (refs.projectOptions) {
            refs.projectOptions.innerHTML = projectList.map((project) => `<option value="${escapeHtml(project)}"></option>`).join('');
        }

        if (refs.projectFilter) {
            const previous = state.filters.project;
            const options = ['<option value="all">全部项目</option>'].concat(
                projectList.map((project) => `<option value="${escapeHtml(project)}">${escapeHtml(project)}</option>`)
            );
            refs.projectFilter.innerHTML = options.join('');
            if (projectList.includes(previous)) {
                refs.projectFilter.value = previous;
            } else {
                refs.projectFilter.value = 'all';
                state.filters.project = 'all';
            }
        }
    }

    function matchesSearchField(value, keyword) {
        if (value === undefined || value === null) return false;
        return String(value).toLowerCase().includes(keyword);
    }

    function todoMatchesSearch(todo, keyword) {
        if (!keyword) return true;
        const fields = [
            todo.project,
            todo.category,
            todo.description,
            todo.tag,
            todo.due_date,
        ];
        if (Array.isArray(todo.comments)) {
            todo.comments.forEach((comment) => fields.push(comment.content));
        }
        if (Array.isArray(todo.history)) {
            todo.history.forEach((entry) => fields.push(entry.summary));
        }
        return fields.some((field) => matchesSearchField(field, keyword));
    }

    function eventMatchesSearch(event, keyword) {
        if (!keyword) return true;
        const fields = [
            event.summary,
            event.project,
            event.category,
            event.description,
        ];
        if (event.type === 'comment' && event.payload && event.payload.content) {
            fields.push(event.payload.content);
        }
        if (event.payload && event.payload.changes) {
            Object.entries(event.payload.changes).forEach(([, diff]) => {
                if (diff && typeof diff === 'object') {
                    fields.push(diff.old, diff.new);
                }
            });
        }
        return fields.some((field) => matchesSearchField(field, keyword));
    }

    function getFilteredTodos() {
        const projectFilter = state.filters.project;
        const searchKeyword = (state.filters.text || '').trim().toLowerCase();
        return state.todos.filter((todo) => {
            if (projectFilter !== 'all' && normalizeProjectName(todo.project) !== projectFilter) {
                return false;
            }
            return todoMatchesSearch(todo, searchKeyword);
        });
    }

    function computeDueInfo(todo) {
        const raw = (todo && todo.due_date) || null;
        if (!raw) {
            return {
                dueDate: null,
                daysLeft: null,
                status: 'none',
                label: '未设置截止',
            };
        }
        const parts = raw.split('-').map((part) => Number(part));
        if (parts.length !== 3 || parts.some((num) => Number.isNaN(num))) {
            return {
                dueDate: raw,
                daysLeft: null,
                status: 'none',
                label: raw,
            };
        }
        const [year, month, day] = parts;
        const due = new Date(year, month - 1, day);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);
        const diff = Math.floor((due - today) / MS_PER_DAY);
        let status = 'upcoming';
        let label = `剩余 ${diff} 天`;
        if (diff < 0) {
            status = 'overdue';
            label = `逾期 ${Math.abs(diff)} 天`;
        } else if (diff === 0) {
            status = 'today';
            label = '今日截止';
        }
        return {
            dueDate: raw,
            daysLeft: diff,
            status,
            label,
        };
    }

    function showAlert(type, message, timeout = 3800) {
        if (!refs.alertContainer) return;
        refs.alertContainer.innerHTML = `
            <div class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${escapeHtml(message)}
                <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
            </div>
        `;
        if (timeout > 0) {
            setTimeout(() => {
                refs.alertContainer.innerHTML = '';
            }, timeout);
        }
    }

    function clearAlert() {
        if (refs.alertContainer) {
            refs.alertContainer.innerHTML = '';
        }
    }

    function setOrientation(next) {
        state.orientation = next;
        sessionStorage.setItem(orientationCacheKey, state.orientation);
        updateOrientationToggle();
        renderTimeline();
        updateTimelineScrollBehavior();
    }

    function toggleOrientation() {
        const next = state.orientation === 'vertical' ? 'horizontal' : 'vertical';
        setOrientation(next);
    }

    function updateOrientationToggle() {
        if (!refs.orientationToggle) return;
        if (state.orientation === 'vertical') {
            refs.orientationToggle.textContent = '切换为横向时间轴';
        } else {
            refs.orientationToggle.textContent = '切换为纵向时间轴';
        }
    }

    function setSelectedTodoId(todoId) {
        state.selectedTodoId = todoId;
        renderAll();
        if (todoId && refs.todoList) {
            window.requestAnimationFrame(() => {
                const card = refs.todoList.querySelector(`.todo-card[data-id="${todoId}"]`);
                if (card) {
                    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            });
        }
    }

    function syncSelection() {
        const filtered = getFilteredTodos();
        if (!filtered.length) {
            state.selectedTodoId = null;
            return;
        }
        const exists = filtered.some((todo) => todo.id === state.selectedTodoId);
        if (!exists) {
            state.selectedTodoId = filtered[0].id;
        }
    }

    function applyTodoUpdate(updatedTodo) {
        const idx = state.todos.findIndex((item) => item.id === updatedTodo.id);
        if (idx >= 0) {
            state.todos.splice(idx, 1, updatedTodo);
        } else {
            state.todos.push(updatedTodo);
        }
        state.selectedTodoId = updatedTodo.id;
    }

    function removeTodo(todoId) {
        const idx = state.todos.findIndex((item) => item.id === todoId);
        if (idx >= 0) {
            state.todos.splice(idx, 1);
        }
        if (state.selectedTodoId === todoId) {
            state.selectedTodoId = null;
        }
    }

    async function deleteTodo(todoId) {
        if (!todoId) {
            return;
        }
        const confirmed = window.confirm('确定删除该 ToDo 吗？删除后无法恢复。');
        if (!confirmed) {
            return;
        }
        try {
            const response = await fetch(`/api/todo/items/${todoId}`, {
                method: 'DELETE',
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '删除失败');
            }
            removeTodo(todoId);
            state.timeline = result.timeline || [];
            state.projects = result.projects || state.projects;
            syncSelection();
            renderAll();
            showAlert('success', 'ToDo 已删除');
        } catch (error) {
            showAlert('danger', error.message || String(error));
        }
    }

    async function deleteTimelineEvent(todoId, eventId) {
        if (!eventId) {
            // 没有事件 ID，则退化为删除整个 ToDo
            deleteTodo(todoId);
            return;
        }
        const confirmed = window.confirm('仅删除该时间轴记录？此操作不可恢复。');
        if (!confirmed) {
            return;
        }
        try {
            const response = await fetch(`/api/todo/events/${eventId}`, {
                method: 'DELETE',
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '删除记录失败');
            }
            state.timeline = result.timeline || state.timeline;
            if (result.todo) {
                const idx = state.todos.findIndex((item) => item.id === result.todo.id);
                if (idx >= 0) {
                    state.todos.splice(idx, 1, result.todo);
                }
            }
            syncSelection();
            renderAll();
            showAlert('success', '时间轴记录已删除');
        } catch (error) {
            showAlert('danger', error.message || String(error));
        }
    }

    function renderTimeline() {
        if (!refs.timeline || !refs.timelineWrapper) return;
        refs.timeline.className = `timeline ${state.orientation}`;
        refs.timeline.innerHTML = '';

        const filteredTodos = getFilteredTodos();
        const todoMap = new Map(filteredTodos.map((todo) => [todo.id, todo]));
        const visibleIds = new Set(todoMap.keys());
        const searchKeyword = (state.filters.text || '').trim().toLowerCase();

        const filteredEvents = state.timeline.filter(
            (event) => visibleIds.has(event.todo_id) && eventMatchesSearch(event, searchKeyword)
        );

        filteredEvents.forEach((event) => {
            const linkedTodo = todoMap.get(event.todo_id);
            const color = linkedTodo ? linkedTodo.color : event.color;
            const dueInfo = linkedTodo ? computeDueInfo(linkedTodo) : { dueDate: event.due_date, label: '', status: 'none' };

            const item = document.createElement('div');
            item.className = 'timeline-item';
            item.dataset.todoId = event.todo_id;
            if (color) {
                item.style.setProperty('--dot-color', color);
            }
            if (state.selectedTodoId && event.todo_id === state.selectedTodoId) {
                item.classList.add('active');
            }
            if (event.event_id) {
                item.dataset.eventId = event.event_id;
            }

            const badges = [];
            badges.push(`<span class="badge bg-primary">${escapeHtml(event.type === 'create' ? '创建' : event.type === 'update' ? '更新' : '评论')}</span>`);
            if (event.project) {
                badges.push(`<span class="badge bg-info text-dark">${escapeHtml(event.project)}</span>`);
            }
            if (event.category) {
                badges.push(`<span class="badge bg-secondary">${escapeHtml(event.category)}</span>`);
            }
            if (event.tag) {
                badges.push(`<span class="badge bg-success">${escapeHtml(event.tag)}</span>`);
            }
            if (dueInfo.dueDate) {
                const badgeClass = dueInfo.status === 'overdue'
                    ? 'bg-danger'
                    : dueInfo.status === 'today'
                        ? 'bg-warning text-dark'
                        : 'bg-light text-dark';
                badges.push(`<span class="badge ${badgeClass}">截止 ${escapeHtml(dueInfo.dueDate)} · ${escapeHtml(dueInfo.label)}</span>`);
            }

            let detailHtml = '';
            if (event.type === 'comment' && event.payload && event.payload.content) {
                detailHtml = `<p class="mb-0">${formatMultiline(event.payload.content)}</p>`;
            } else if (event.type === 'update' && event.payload && event.payload.changes) {
                const changeItems = Object.entries(event.payload.changes).map(([key, diff]) => {
                    const oldValue = diff && typeof diff === 'object' ? diff.old : '';
                    const newValue = diff && typeof diff === 'object' ? diff.new : '';
                    return `<li>${escapeHtml(key)}：<span class="text-muted">${escapeHtml(oldValue ?? '--')}</span> → <span class="text-primary">${escapeHtml(newValue ?? '--')}</span></li>`;
                });
                detailHtml = `<ul class="mb-0">${changeItems.join('')}</ul>`;
            } else if (event.type === 'create' && event.payload) {
                detailHtml = `<p class="mb-0 text-muted">${escapeHtml(event.payload.description || '已创建 ToDo')}</p>`;
            }

            const actionButtons = linkedTodo ? `
                <div class="timeline-actions">
                    <button type="button" class="btn btn-sm btn-outline-emerald" data-action="comment" data-todo-id="${event.todo_id}">
                        <i class="fas fa-comment-dots"></i> 评论
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-action="edit" data-todo-id="${event.todo_id}">
                        <i class="fas fa-pen"></i> 修改
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete" data-todo-id="${event.todo_id}">
                        <i class="fas fa-trash"></i> 删除
                    </button>
                </div>
            ` : '';

            item.innerHTML = `
                <span class="timeline-dot"></span>
                <div class="timeline-card">
                    <div class="timeline-summary">${escapeHtml(event.summary || '事件')}</div>
                    <div class="timeline-badges">${badges.join('')}</div>
                    <div class="timeline-detail">${detailHtml}</div>
                    ${actionButtons}
                    <div class="timestamp">${formatDate(event.timestamp)}</div>
                </div>
            `;

            item.addEventListener('click', () => setSelectedTodoId(event.todo_id));
            refs.timeline.appendChild(item);
        });

        if (refs.timelineCount) {
            refs.timelineCount.textContent = filteredEvents.length;
        }

        updateTimelineScrollBehavior();
    }

    function renderTodoList() {
        if (!refs.todoList) return;
        refs.todoList.innerHTML = '';

        const filteredTodos = getFilteredTodos();
        const sortedTodos = [...filteredTodos].sort((a, b) => {
            const aTime = a.updated_at || a.created_at || '';
            const bTime = b.updated_at || b.created_at || '';
            return bTime.localeCompare(aTime);
        });

        sortedTodos.forEach((todo) => {
            const card = document.createElement('div');
            card.className = 'todo-card';
            card.dataset.id = todo.id;
            card.style.setProperty('--accent-color', todo.color || '#4facfe');
            if (state.selectedTodoId === todo.id) {
                card.classList.add('active');
            }

            const metaParts = [
                `<span class="badge bg-primary">${escapeHtml(todo.project || '未命名项目')}</span>`,
                `<span class="badge bg-secondary">${escapeHtml(todo.category || '默认')}</span>`,
            ];
            if (todo.tag) {
                metaParts.push(`<span class="badge bg-success">${escapeHtml(todo.tag)}</span>`);
            }
            const dueInfo = computeDueInfo(todo);
            if (dueInfo.dueDate) {
                const badgeClass = dueInfo.status === 'overdue'
                    ? 'bg-danger'
                    : dueInfo.status === 'today'
                        ? 'bg-warning text-dark'
                        : 'bg-light text-dark';
                metaParts.push(`<span class="badge ${badgeClass}">截止 ${escapeHtml(dueInfo.dueDate)} · ${escapeHtml(dueInfo.label)}</span>`);
            } else {
                metaParts.push('<span class="badge bg-light text-dark">无截止时间</span>');
            }
            metaParts.push(`<span>创建于 ${formatDate(todo.created_at)}</span>`);
            metaParts.push(`<span>更新于 ${formatDate(todo.updated_at)}</span>`);

            const historyList = (todo.history || []).map((entry) => {
                return `<li>[${formatDate(entry.timestamp)}] ${escapeHtml(entry.summary || '')}</li>`;
            }).join('');

            const commentList = (todo.comments || []).map((comment) => {
                return `<li>${formatDate(comment.timestamp)} · ${formatMultiline(comment.content)}</li>`;
            }).join('');

            card.innerHTML = `
                <div class="todo-card-header">
                    <h3>${escapeHtml(todo.description || todo.project || '未命名任务')}</h3>
                    <span class="badge bg-dark text-light">${escapeHtml(todo.progress ?? 0)}%</span>
                </div>
                <div class="todo-meta">${metaParts.join('')}</div>
                <div class="todo-description">${formatMultiline(todo.description || '暂无说明')}</div>
                <div class="todo-progress">
                    <span class="text-muted">完成进度</span>
                    <div class="progress">
                        <div class="progress-bar" role="progressbar" style="width: ${Math.min(100, Math.max(0, Number(todo.progress || 0)))}%;" aria-valuenow="${escapeHtml(todo.progress ?? 0)}" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                </div>
                <div class="todo-actions">
                    <button type="button" class="btn btn-sm btn-outline-primary" data-action="comment" data-todo-id="${todo.id}">添加评论</button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-action="edit" data-todo-id="${todo.id}">编辑</button>
                </div>
                <details class="todo-history">
                    <summary>历史记录（${(todo.history || []).length}）</summary>
                    <ul>${historyList}</ul>
                </details>
                <div class="comment-list-wrapper mt-2">
                    <strong>评论 (${(todo.comments || []).length})</strong>
                    <ul class="comment-list">${commentList || '<li class="text-muted">暂无评论</li>'}</ul>
                </div>
            `;

            card.addEventListener('click', () => setSelectedTodoId(todo.id));

            refs.todoList.appendChild(card);
        });

        if (refs.todoCount) {
            refs.todoCount.textContent = filteredTodos.length;
        }
    }

    function renderPendingBoard() {
        if (!refs.todayList || !refs.upcomingList) {
            return;
        }

        const filteredTodos = getFilteredTodos();
        const pendingTodos = filteredTodos.filter((todo) => Number(todo.progress || 0) < 100);

        const withDue = pendingTodos.map((todo) => ({
            todo,
            due: computeDueInfo(todo),
        }));

        const overdue = withDue.filter((item) => item.due.status === 'overdue');
        const today = withDue.filter((item) => item.due.status === 'today');
        const upcoming = withDue.filter((item) => item.due.status === 'upcoming').sort((a, b) => (a.due.daysLeft || 0) - (b.due.daysLeft || 0));
        const undated = withDue.filter((item) => item.due.status === 'none');

        if (refs.todayList) {
            refs.todayList.innerHTML = '';
            overdue.concat(today).forEach((item) => {
                refs.todayList.appendChild(createPendingItemElement(item.todo, item.due));
            });
            if (refs.todayList.children.length === 0) {
                refs.todayList.innerHTML = '<li class="text-muted">今日暂无紧急任务</li>';
            }
        }

        if (refs.upcomingList) {
            refs.upcomingList.innerHTML = '';
            upcoming.concat(undated).forEach((item) => {
                refs.upcomingList.appendChild(createPendingItemElement(item.todo, item.due));
            });
            if (refs.upcomingList.children.length === 0) {
                refs.upcomingList.innerHTML = '<li class="text-muted">没有更多未完成任务</li>';
            }
        }

        if (refs.todayCount) {
            refs.todayCount.textContent = today.length + overdue.length;
        }
        if (refs.overdueCount) {
            refs.overdueCount.textContent = overdue.length;
        }
        if (refs.pendingCount) {
            refs.pendingCount.textContent = pendingTodos.length;
        }
    }

    function createPendingItemElement(todo, dueInfo) {
        const li = document.createElement('li');
        li.className = 'pending-item';
        if (dueInfo.status === 'overdue') {
            li.classList.add('overdue');
        } else if (dueInfo.status === 'today') {
            li.classList.add('today');
        }
        if (state.selectedTodoId === todo.id) {
            li.classList.add('active');
        }
        li.dataset.todoId = todo.id;
        const dueLabel = dueInfo.label || '无截止时间';
        li.innerHTML = `
            <div class="item-main">
                <div class="item-title">${escapeHtml(todo.project || '未命名项目')} · ${escapeHtml(todo.category || '默认')}</div>
                <div class="item-meta">
                    <span>进度 ${escapeHtml(todo.progress ?? 0)}%</span>
                    ${todo.tag ? `<span>标签：${escapeHtml(todo.tag)}</span>` : ''}
                    ${todo.due_date ? `<span>截止：${escapeHtml(todo.due_date)}</span>` : '<span>未设置截止</span>'}
                </div>
            </div>
            <div class="item-eta">${escapeHtml(dueLabel)}</div>
        `;
        li.addEventListener('click', () => setSelectedTodoId(todo.id));
        return li;
    }

    function renderAll() {
        renderTimeline();
        renderTodoList();
        renderPendingBoard();
    }

    function autoFillProjectColor(form) {
        if (!form) return;
        const projectField = form.querySelector('[name="project"]');
        const colorField = form.querySelector('[name="color"]');
        if (!projectField || !colorField) return;
        const color = getProjectColor(projectField.value);
        if (color) {
            colorField.value = color;
        } else if (!normalizeProjectName(projectField.value)) {
            colorField.value = '#4facfe';
        }
    }

    function attachFormEnhancements(form) {
        if (!form || form.dataset.enhanced === 'true') {
            return;
        }
        const projectField = form.querySelector('[name="project"]');
        if (projectField) {
            const handler = () => autoFillProjectColor(form);
            projectField.addEventListener('change', handler);
            projectField.addEventListener('input', handler);
            projectField.addEventListener('blur', handler);
        }
        form.addEventListener('click', (event) => {
            const button = event.target.closest('[data-action="random-color"]');
            if (!button) return;
            event.preventDefault();
            const colorField = form.querySelector('[name="color"]');
            if (colorField) {
                colorField.value = randomColor();
            }
        });
        form.dataset.enhanced = 'true';
    }

    async function loadData({ selectId } = {}) {
        try {
            const response = await fetch('/api/todo/items');
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '加载 ToDo 数据失败');
            }
            state.todos = result.todos || [];
            state.timeline = result.timeline || [];
            state.projects = result.projects || {};
            if (selectId) {
                state.selectedTodoId = selectId;
            }
            syncSelection();
            refreshProjectOptions();
            renderAll();
        } catch (error) {
            showAlert('danger', error.message || String(error));
        }
    }

    function collectTodoPayload(form) {
        const formData = new FormData(form);
        const payload = {};
        payload.project = formData.get('project') || '';
        payload.category = formData.get('category') || '';
        payload.description = formData.get('description') || '';
        payload.tag = formData.get('tag') || '';
        payload.color = formData.get('color') || '';
        const progressRaw = formData.get('progress');
        if (progressRaw !== null && progressRaw !== '') {
            payload.progress = Number(progressRaw);
        }
        const dueDate = formData.get('due_date');
        if (dueDate !== null) {
            payload.due_date = dueDate || null;
        }
        return payload;
    }

    async function createTodo(event) {
        event.preventDefault();
        clearAlert();
        const form = refs.createForm;
        form.classList.add('was-validated');
        if (!form.checkValidity()) {
            return;
        }
        const payload = collectTodoPayload(form);

        try {
            const response = await fetch('/api/todo/items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '创建 ToDo 失败');
            }
            applyTodoUpdate(result.todo);
            state.timeline = result.timeline || state.timeline;
            state.projects = result.projects || state.projects;
            refreshProjectOptions();
            syncSelection();
            renderAll();
            form.reset();
            form.classList.remove('was-validated');
            form.querySelector('input[name="progress"]').value = '0';
            form.querySelector('input[name="color"]').value = '#4facfe';
            if (modals.create) {
                modals.create.hide();
            }
            showAlert('success', 'ToDo 创建成功');
        } catch (error) {
            showAlert('danger', error.message || String(error));
        }
    }

    async function submitComment(event) {
        event.preventDefault();
        if (!commentTargetId) return;
        const form = refs.commentForm;
        form.classList.add('was-validated');
        if (!form.checkValidity()) {
            return;
        }
        const content = form.elements.content.value.trim();
        try {
            const response = await fetch(`/api/todo/items/${commentTargetId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '添加评论失败');
            }
            applyTodoUpdate(result.todo);
            state.timeline = result.timeline || state.timeline;
            state.projects = result.projects || state.projects;
            refreshProjectOptions();
            syncSelection();
            renderAll();
            modals.comment.hide();
            form.reset();
            form.classList.remove('was-validated');
            showAlert('success', '评论已添加');
        } catch (error) {
            showAlert('danger', error.message || String(error));
        }
    }

    async function submitEdit(event) {
        event.preventDefault();
        if (!editTargetId) return;
        const form = refs.editForm;
        form.classList.add('was-validated');
        if (!form.checkValidity()) {
            return;
        }
        const payload = collectTodoPayload(form);

        try {
            const response = await fetch(`/api/todo/items/${editTargetId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '更新 ToDo 失败');
            }
            applyTodoUpdate(result.todo);
            if (result.timeline) {
                state.timeline = result.timeline;
            }
            state.projects = result.projects || state.projects;
            refreshProjectOptions();
            syncSelection();
            renderAll();
            modals.edit.hide();
            showAlert('success', 'ToDo 已更新');
        } catch (error) {
            showAlert('danger', error.message || String(error));
        }
    }

    function openCreateModal() {
        if (!refs.createForm) return;
        refs.createForm.reset();
        refs.createForm.classList.remove('was-validated');
        const progressField = refs.createForm.querySelector('[name="progress"]');
        if (progressField) {
            progressField.value = '0';
        }
        const colorField = refs.createForm.querySelector('[name="color"]');
        const projectValue = state.filters.project !== 'all' ? state.filters.project : '';
        const projectField = refs.createForm.querySelector('[name="project"]');
        if (projectField) {
            projectField.value = projectValue;
        }
        if (colorField) {
            const preset = projectValue ? getProjectColor(projectValue) : null;
            colorField.value = preset || '#4facfe';
        }
        const dueField = refs.createForm.querySelector('[name="due_date"]');
        if (dueField) {
            dueField.value = '';
        }
        autoFillProjectColor(refs.createForm);
        if (modals.create) {
            modals.create.show();
        }
    }

    function openCommentModal(todoId) {
        commentTargetId = todoId;
        const todo = state.todos.find((item) => item.id === todoId);
        if (todo && refs.commentModalEl) {
            const titleEl = refs.commentModalEl.querySelector('.modal-title');
            if (titleEl) {
                titleEl.textContent = `添加评论 · ${todo.project || todo.description || 'ToDo'}`;
            }
        }
        if (refs.commentForm) {
            refs.commentForm.reset();
            refs.commentForm.classList.remove('was-validated');
        }
        if (modals.comment) {
            modals.comment.show();
        }
    }

    function openEditModal(todoId) {
        editTargetId = todoId;
        const todo = state.todos.find((item) => item.id === todoId);
        if (!todo || !refs.editForm) return;

        const titleEl = refs.editModalEl.querySelector('.modal-title');
        if (titleEl) {
            titleEl.textContent = `编辑 ToDo · ${todo.project || todo.description || '未命名'}`;
        }

        refs.editForm.classList.remove('was-validated');
        refs.editForm.querySelector('[name="project"]').value = todo.project || '';
        refs.editForm.querySelector('[name="category"]').value = todo.category || '';
        refs.editForm.querySelector('[name="description"]').value = todo.description || '';
        refs.editForm.querySelector('[name="tag"]').value = todo.tag || '';
        refs.editForm.querySelector('[name="color"]').value = todo.color || '#4facfe';
        refs.editForm.querySelector('[name="progress"]').value = todo.progress ?? 0;
        const dueField = refs.editForm.querySelector('[name="due_date"]');
        if (dueField) {
            dueField.value = todo.due_date || '';
        }
        autoFillProjectColor(refs.editForm);

        if (modals.edit) {
            modals.edit.show();
        }
    }

    function handleTodoAction(event) {
        const button = event.target.closest('button[data-action]');
        if (!button) {
            return;
        }
        event.stopPropagation();
        const action = button.dataset.action;
        const todoId = button.dataset.todoId;
        if (!todoId) return;

        if (action === 'comment') {
            openCommentModal(todoId);
        } else if (action === 'edit') {
            openEditModal(todoId);
        } else if (action === 'delete') {
            const eventItem = button.closest('.timeline-item');
            const eventId = eventItem ? eventItem.dataset.eventId : null;
            deleteTimelineEvent(todoId, eventId);
        }
    }

    function handleSearchInput(event) {
        state.filters.text = event.target.value || '';
        syncSelection();
        renderAll();
    }

    function handleProjectFilter(event) {
        const rawValue = event.target.value || 'all';
        const normalized = rawValue === 'all' ? 'all' : normalizeProjectName(rawValue);
        state.filters.project = normalized;
        if (event.target.value !== (normalized === 'all' ? 'all' : normalized)) {
            event.target.value = normalized === 'all' ? 'all' : normalized;
        }
        syncSelection();
        renderAll();
        if (refs.createForm) {
            const projectField = refs.createForm.querySelector('[name="project"]');
            if (projectField) {
                projectField.value = normalized === 'all' ? '' : normalized;
                autoFillProjectColor(refs.createForm);
            }
        }
    }

    function computeTimelineHeight() {
        if (!refs.timelineWrapper) return null;
        const viewportHeight = window.innerHeight;
        const rect = refs.timelineWrapper.getBoundingClientRect();
        const available = Math.max(viewportHeight - rect.top - 32, 320);
        return available;
    }

    function updateTimelineScrollBehavior() {
        if (!refs.timeline || !refs.timelineWrapper) return;
        const height = computeTimelineHeight();
        if (height) {
            refs.timelineWrapper.style.maxHeight = `${height}px`;
        }
        refs.timelineWrapper.classList.toggle('horizontal-mode', state.orientation === 'horizontal');
        refs.timelineWrapper.classList.toggle('vertical-mode', state.orientation === 'vertical');
        if (state.orientation === 'horizontal') {
            refs.timelineWrapper.style.overflowX = 'auto';
            refs.timelineWrapper.style.overflowY = 'hidden';
            refs.timeline.style.height = `${height}px`;
            refs.timeline.style.maxHeight = `${height}px`;
        } else {
            refs.timelineWrapper.style.overflowY = 'auto';
            refs.timelineWrapper.style.overflowX = 'hidden';
            refs.timeline.style.height = '';
            refs.timeline.style.maxHeight = '';
        }
    }

    function registerTimelineWheelBehavior() {
        if (!refs.timelineWrapper) return;
        refs.timelineWrapper.addEventListener('wheel', (event) => {
            if (state.orientation === 'horizontal') {
                if (Math.abs(event.deltaX) < Math.abs(event.deltaY)) {
                    refs.timelineWrapper.scrollLeft += event.deltaY;
                    event.preventDefault();
                }
            } else {
                if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) {
                    refs.timelineWrapper.scrollTop += event.deltaX;
                    event.preventDefault();
                }
            }
        }, { passive: false });

        window.addEventListener('resize', () => {
            updateTimelineScrollBehavior();
        });
    }

    function scrollToSection(targetId) {
        const section = document.getElementById(targetId);
        if (!section) return;
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function registerScrollButtons() {
        document.querySelectorAll('.scroll-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                const target = btn.dataset.target;
                scrollToSection(target);
            });
        });
    }

    function attachEventListeners() {
        if (refs.orientationToggle) {
            refs.orientationToggle.addEventListener('click', toggleOrientation);
        }
        if (refs.createForm) {
            attachFormEnhancements(refs.createForm);
            refs.createForm.addEventListener('submit', createTodo);
        }
        if (refs.commentForm) {
            refs.commentForm.addEventListener('submit', submitComment);
        }
        if (refs.editForm) {
            attachFormEnhancements(refs.editForm);
            refs.editForm.addEventListener('submit', submitEdit);
        }
        if (refs.todoList) {
            refs.todoList.addEventListener('click', handleTodoAction);
        }
        if (refs.timeline) {
            refs.timeline.addEventListener('click', handleTodoAction);
        }
        if (refs.searchInput) {
            refs.searchInput.addEventListener('input', handleSearchInput);
        }
        if (refs.projectFilter) {
            refs.projectFilter.addEventListener('change', handleProjectFilter);
        }
        if (refs.newTodoButton) {
            refs.newTodoButton.addEventListener('click', openCreateModal);
        }
        if (refs.timelineNewButton) {
            refs.timelineNewButton.addEventListener('click', openCreateModal);
        }
        if (refs.createModalEl) {
            refs.createModalEl.addEventListener('shown.bs.modal', () => {
                const projectField = refs.createForm ? refs.createForm.querySelector('[name="project"]') : null;
                if (projectField) {
                    projectField.focus();
                    projectField.select();
                }
            });
        }
        if (refs.timelineWrapper) {
            refs.timelineWrapper.addEventListener('click', handleTodoAction);
        }
    }

    function init() {
        updateOrientationToggle();
        if (refs.searchInput) {
            refs.searchInput.value = state.filters.text;
        }
        if (refs.projectFilter) {
            refs.projectFilter.value = state.filters.project;
        }
        attachEventListeners();
        registerTimelineWheelBehavior();
        registerScrollButtons();
        loadData();
    }

    document.addEventListener('DOMContentLoaded', init);
})();

