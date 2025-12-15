(() => {
    'use strict';

    // 列定义
    const COLUMN_DEFINITIONS = {
        'project_name': { key: 'project_name', label: '项目名称', default: true, order: 0 },
        'index': { key: 'index', label: '序号', default: true, order: 1 },
        'summary': { key: 'summary', label: '任务简述', default: true, order: 2 },
        'description': { key: 'description', label: '详细描述', default: true, order: 3 },
        'priority': { key: 'priority', label: '优先级', default: true, order: 4 },
        'progress': { key: 'progress', label: '进度', default: true, order: 5 },
        'due_date': { key: 'due_date', label: '预计完成时间', default: true, order: 6 },
        'created_at': { key: 'created_at', label: '创建时间', default: true, order: 7 },
        'updated_at': { key: 'updated_at', label: '最后更新时间', default: true, order: 8 },
        'comment_count': { key: 'comment_count', label: '评论数', default: false, order: 9 },
    };

    const state = {
        projects: [],
        flatTasks: [], // 扁平化的任务列表
        filteredTasks: [],
        columns: [],
        timeFilter: {
            type: 'none',
            start: null,
            end: null,
        },
        fontSize: localStorage.getItem('todoPreviewFontSize') || 'medium',
        directAccess: document.body.dataset.directAccess === 'true',
        searchText: '', // 搜索文本
        filter: {
            column: null, // 当前筛选的列：'project_name', 'created_at', 'priority'
            value: null, // 筛选值
        },
        sort: {
            column: null, // 当前排序的列：'project_name', 'created_at', 'progress', 'priority', 'due_date', 'updated_at'
            direction: 'asc', // 'asc' 或 'desc'
        },
    };

    const refs = {
        tableHead: document.getElementById('tableHead'),
        tableBody: document.getElementById('tableBody'),
        emptyMessage: document.getElementById('emptyMessage'),
        alertContainer: document.getElementById('alertContainer'),
        searchInput: document.getElementById('searchInput'),
        timeFilterType: document.getElementById('timeFilterType'),
        timeFilterStart: document.getElementById('timeFilterStart'),
        timeFilterEnd: document.getElementById('timeFilterEnd'),
        exportButton: document.getElementById('exportButton'),
        fontSizeSmall: document.getElementById('fontSizeSmall'),
        fontSizeMedium: document.getElementById('fontSizeMedium'),
        fontSizeLarge: document.getElementById('fontSizeLarge'),
    };

    let draggedColumn = null;

    // ===== 工具函数 =====

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(isoString) {
        if (!isoString) return '--';
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) {
            return isoString;
        }
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function formatDateTime(isoString) {
        if (!isoString) return '--';
        const date = new Date(isoString);
        if (Number.isNaN(date.getTime())) {
            return isoString;
        }
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day} ${hours}:${minutes}`;
    }

    function getDueDateStatus(dueDate) {
        if (!dueDate) return { status: 'none', label: '未设置', class: 'due-date-none' };
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        const diff = Math.floor((due - today) / (1000 * 60 * 60 * 24));
        if (diff < 0) return { status: 'overdue', label: `逾期 ${Math.abs(diff)} 天`, class: 'due-date-overdue' };
        if (diff === 0) return { status: 'today', label: '今日截止', class: 'due-date-today' };
        return { status: 'upcoming', label: `剩余 ${diff} 天`, class: 'due-date-upcoming' };
    }

    function showAlert(type, message, timeout = 3000) {
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

    // ===== 数据加载与处理 =====

    async function loadData() {
        try {
            const response = await fetch('/api/todo/v2/data');
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '加载数据失败');
            }

            state.projects = result.data.projects || [];
            flattenTasks();
            applyFilters();
            loadColumnOrder();
            renderTable();
        } catch (error) {
            showAlert('danger', error.message || String(error));
        }
    }

    function flattenTasks() {
        state.flatTasks = [];
        state.projects.forEach((project, projectIndex) => {
            (project.tasks || []).forEach((task, taskIndex) => {
                state.flatTasks.push({
                    ...task,
                    project_id: project.id,
                    project_name: project.name,
                    project_color: project.color || '#4facfe',
                    index: taskIndex + 1,
                    comment_count: (task.comments || []).length,
                });
            });
        });
    }

    function applyFilters() {
        let filtered = [...state.flatTasks];

        // 搜索筛选
        if (state.searchText && state.searchText.trim()) {
            const searchLower = state.searchText.trim().toLowerCase();
            filtered = filtered.filter(task => {
                const fields = [
                    task.project_name,
                    task.summary,
                    task.description,
                ];
                return fields.some(field => field && String(field).toLowerCase().includes(searchLower));
            });
        }

        // 时间筛选
        if (state.timeFilter.type !== 'none' && (state.timeFilter.start || state.timeFilter.end)) {
            filtered = filtered.filter(task => {
                let dateValue = null;
                if (state.timeFilter.type === 'created') {
                    dateValue = task.created_at;
                } else if (state.timeFilter.type === 'updated') {
                    dateValue = task.updated_at;
                } else if (state.timeFilter.type === 'due') {
                    dateValue = task.due_date;
                }

                if (!dateValue) return false;

                const taskDate = new Date(dateValue);
                taskDate.setHours(0, 0, 0, 0);

                if (state.timeFilter.start) {
                    const startDate = new Date(state.timeFilter.start);
                    startDate.setHours(0, 0, 0, 0);
                    if (taskDate < startDate) return false;
                }

                if (state.timeFilter.end) {
                    const endDate = new Date(state.timeFilter.end);
                    endDate.setHours(23, 59, 59, 999);
                    if (taskDate > endDate) return false;
                }

                return true;
            });
        }

        // 列筛选
        if (state.filter.column && state.filter.value !== null) {
            filtered = filtered.filter(task => {
                if (state.filter.column === 'project_name') {
                    return task.project_id === state.filter.value;
                } else if (state.filter.column === 'created_at') {
                    if (!task.created_at) return false;
                    const taskDate = new Date(task.created_at);
                    taskDate.setHours(0, 0, 0, 0);
                    const filterDate = new Date(state.filter.value);
                    filterDate.setHours(0, 0, 0, 0);
                    return taskDate.getTime() === filterDate.getTime();
                } else if (state.filter.column === 'priority') {
                    return (task.priority || 3) === parseInt(state.filter.value);
                }
                return true;
            });
        }

        // 排序
        if (state.sort.column) {
            filtered.sort((a, b) => {
                let aVal, bVal;
                
                if (state.sort.column === 'project_name') {
                    aVal = a.project_name || '';
                    bVal = b.project_name || '';
                } else if (state.sort.column === 'created_at') {
                    aVal = a.created_at ? new Date(a.created_at).getTime() : 0;
                    bVal = b.created_at ? new Date(b.created_at).getTime() : 0;
                } else if (state.sort.column === 'updated_at') {
                    aVal = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                    bVal = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                } else if (state.sort.column === 'due_date') {
                    aVal = a.due_date ? new Date(a.due_date).getTime() : 0;
                    bVal = b.due_date ? new Date(b.due_date).getTime() : 0;
                } else if (state.sort.column === 'progress') {
                    aVal = a.progress || 0;
                    bVal = b.progress || 0;
                } else if (state.sort.column === 'priority') {
                    aVal = a.priority || 3;
                    bVal = b.priority || 3;
                } else {
                    return 0;
                }

                if (aVal < bVal) return state.sort.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return state.sort.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        state.filteredTasks = filtered;
    }

    // ===== 列管理 =====

    function loadColumnOrder() {
        const saved = localStorage.getItem('todoPreviewColumnOrder');
        if (saved) {
            try {
                const savedOrder = JSON.parse(saved);
                state.columns = savedOrder.filter(key => COLUMN_DEFINITIONS[key]);
                // 添加新列
                Object.keys(COLUMN_DEFINITIONS).forEach(key => {
                    if (!state.columns.includes(key)) {
                        state.columns.push(key);
                    }
                });
            } catch (e) {
                initDefaultColumns();
            }
        } else {
            initDefaultColumns();
        }
    }

    function initDefaultColumns() {
        state.columns = Object.keys(COLUMN_DEFINITIONS).sort((a, b) => {
            return COLUMN_DEFINITIONS[a].order - COLUMN_DEFINITIONS[b].order;
        });
    }

    function saveColumnOrder() {
        localStorage.setItem('todoPreviewColumnOrder', JSON.stringify(state.columns));
    }

    // ===== 渲染 =====

    function renderTable() {
        renderTableHead();
        renderTableBody();
    }

    function renderTableHead() {
        if (!refs.tableHead) return;

        const thead = refs.tableHead;
        thead.innerHTML = '';

        const tr = document.createElement('tr');
        state.columns.forEach((colKey, index) => {
            const colDef = COLUMN_DEFINITIONS[colKey];
            if (!colDef) return;

            const th = document.createElement('th');
            th.dataset.columnKey = colKey;
            th.draggable = true;
            
            // 检查是否可以筛选/排序
            const canFilter = ['project_name', 'created_at', 'priority'].includes(colKey);
            const canSort = ['project_name', 'created_at', 'progress', 'priority', 'due_date', 'updated_at'].includes(colKey);
            
            let filterSortIcons = '';
            if (canFilter || canSort) {
                let icons = [];
                if (canFilter) {
                    const isFiltered = state.filter.column === colKey;
                    icons.push(`<i class="fas fa-filter filter-icon ${isFiltered ? 'active' : ''}" data-action="filter" title="筛选"></i>`);
                }
                if (canSort) {
                    let sortIcon = 'fa-sort';
                    if (state.sort.column === colKey) {
                        sortIcon = state.sort.direction === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
                    }
                    icons.push(`<i class="fas ${sortIcon} sort-icon ${state.sort.column === colKey ? 'active' : ''}" data-action="sort" title="排序"></i>`);
                }
                filterSortIcons = `<span class="filter-sort-icons">${icons.join('')}</span>`;
            }
            
            th.innerHTML = `
                <i class="fas fa-grip-vertical drag-handle"></i>
                <span class="column-label">${escapeHtml(colDef.label)}</span>
                ${filterSortIcons}
            `;

            // 拖拽事件
            th.addEventListener('dragstart', (e) => {
                draggedColumn = colKey;
                th.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            th.addEventListener('dragend', () => {
                th.classList.remove('dragging');
                document.querySelectorAll('th').forEach(h => h.classList.remove('drag-over'));
            });

            th.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggedColumn && draggedColumn !== colKey) {
                    document.querySelectorAll('th').forEach(h => h.classList.remove('drag-over'));
                    th.classList.add('drag-over');
                }
            });

            th.addEventListener('drop', (e) => {
                e.preventDefault();
                if (draggedColumn && draggedColumn !== colKey) {
                    const oldIndex = state.columns.indexOf(draggedColumn);
                    const newIndex = state.columns.indexOf(colKey);
                    state.columns.splice(oldIndex, 1);
                    state.columns.splice(newIndex, 0, draggedColumn);
                    saveColumnOrder();
                    renderTable();
                }
                document.querySelectorAll('th').forEach(h => h.classList.remove('drag-over'));
            });

            // 筛选和排序点击事件
            th.addEventListener('click', (e) => {
                const target = e.target.closest('[data-action]');
                if (!target) return;
                
                const action = target.dataset.action;
                if (action === 'filter') {
                    handleFilterClick(colKey);
                } else if (action === 'sort') {
                    handleSortClick(colKey);
                }
            });

            tr.appendChild(th);
        });

        thead.appendChild(tr);
    }

    function handleFilterClick(colKey) {
        // 如果点击的是已筛选的列，清除筛选
        if (state.filter.column === colKey) {
            state.filter.column = null;
            state.filter.value = null;
            applyFilters();
            renderTable();
            return;
        }

        // 清除之前的筛选
        state.filter.column = colKey;
        state.filter.value = null;

        const filterPanel = document.getElementById('filterPanel');
        const filterBody = document.getElementById('filterBody');
        
        if (colKey === 'project_name') {
            // 项目名称：显示选择框
            const projects = [...new Map(state.flatTasks.map(t => [t.project_id, { id: t.project_id, name: t.project_name }])).values()];
            const currentValue = state.filter.value;
            
            let options = '<option value="">全部项目</option>';
            projects.forEach(project => {
                const selected = currentValue === project.id ? 'selected' : '';
                options += `<option value="${project.id}" ${selected}>${escapeHtml(project.name)}</option>`;
            });
            
            filterBody.innerHTML = `
                <label class="form-label">选择项目：</label>
                <select class="form-select" id="filterProjectSelect">
                    ${options}
                </select>
            `;
        } else if (colKey === 'created_at') {
            // 创建时间：日期选择
            filterBody.innerHTML = `
                <label class="form-label">选择创建日期：</label>
                <input type="date" class="form-control" id="filterDateInput" value="${state.filter.value || ''}">
            `;
        } else if (colKey === 'priority') {
            // 优先级：数字输入
            filterBody.innerHTML = `
                <label class="form-label">输入优先级 (1-5)：</label>
                <input type="number" class="form-control" id="filterPriorityInput" min="1" max="5" value="${state.filter.value || ''}">
            `;
        }
        
        const filterOverlay = document.getElementById('filterOverlay');
        filterPanel.style.display = 'block';
        if (filterOverlay) filterOverlay.classList.add('show');
        
        // 绑定应用筛选按钮
        const applyBtn = document.getElementById('applyFilter');
        const clearBtn = document.getElementById('clearFilter');
        const closeBtn = document.getElementById('closeFilterPanel');
        
        const closePanel = () => {
            filterPanel.style.display = 'none';
            if (filterOverlay) filterOverlay.classList.remove('show');
        };
        
        const applyFilter = () => {
            let value = null;
            if (colKey === 'project_name') {
                const select = document.getElementById('filterProjectSelect');
                value = select ? select.value : null;
                if (value === '') value = null;
            } else if (colKey === 'created_at') {
                const input = document.getElementById('filterDateInput');
                value = input ? input.value : null;
                if (value === '') value = null;
            } else if (colKey === 'priority') {
                const input = document.getElementById('filterPriorityInput');
                const val = input ? parseInt(input.value) : null;
                if (!isNaN(val) && val >= 1 && val <= 5) {
                    value = val;
                } else if (input && input.value === '') {
                    value = null;
                } else {
                    alert('请输入1-5之间的数字');
                    return;
                }
            }
            
            state.filter.column = value !== null ? colKey : null;
            state.filter.value = value;
            closePanel();
            applyFilters();
            renderTable();
        };
        
        const clearFilter = () => {
            state.filter.column = null;
            state.filter.value = null;
            closePanel();
            applyFilters();
            renderTable();
        };
        
        applyBtn.onclick = applyFilter;
        clearBtn.onclick = clearFilter;
        closeBtn.onclick = closePanel;
        if (filterOverlay) {
            filterOverlay.onclick = closePanel;
        }
        
        // 回车键应用筛选
        const inputs = filterBody.querySelectorAll('input, select');
        inputs.forEach(input => {
            input.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    applyFilter();
                }
            });
        });
    }

    function handleSortClick(colKey) {
        if (state.sort.column === colKey) {
            // 切换排序方向
            state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            // 设置新的排序列
            state.sort.column = colKey;
            state.sort.direction = 'asc';
        }
        
        applyFilters();
        renderTable();
    }

    function renderTableBody() {
        if (!refs.tableBody) return;

        const tbody = refs.tableBody;
        tbody.innerHTML = '';

        if (state.filteredTasks.length === 0) {
            refs.emptyMessage.style.display = 'block';
            return;
        }

        refs.emptyMessage.style.display = 'none';

        state.filteredTasks.forEach((task, rowIndex) => {
            const tr = document.createElement('tr');
            tr.dataset.taskId = task.id;

            state.columns.forEach(colKey => {
                const td = document.createElement('td');
                td.innerHTML = getCellContent(task, colKey);
                tr.appendChild(td);
            });

            tbody.appendChild(tr);
        });

        // 绑定评论数点击事件
        tbody.querySelectorAll('.comment-count-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const taskId = link.dataset.taskId;
                showCommentModal(taskId);
            });
        });
    }

    function showCommentModal(taskId) {
        // 查找任务
        const task = state.flatTasks.find(t => t.id === taskId);
        if (!task) return;

        const comments = task.comments || [];
        
        // 设置任务信息
        document.getElementById('commentTaskSummary').textContent = task.summary || '--';
        document.getElementById('commentProjectName').textContent = task.project_name || '--';

        // 渲染评论表格
        const tbody = document.getElementById('commentTableBody');
        tbody.innerHTML = '';

        if (comments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">暂无评论</td></tr>';
        } else {
            comments.forEach((comment, index) => {
                const tr = document.createElement('tr');
                const timestamp = comment.timestamp || '';
                let formattedTime = '--';
                if (timestamp) {
                    try {
                        const date = new Date(timestamp);
                        formattedTime = formatDateTime(timestamp);
                    } catch (e) {
                        formattedTime = timestamp;
                    }
                }
                tr.innerHTML = `
                    <td>${index + 1}</td>
                    <td>${escapeHtml(formattedTime)}</td>
                    <td>${escapeHtml(comment.content || '--')}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        // 显示模态框
        const modal = new bootstrap.Modal(document.getElementById('commentModal'));
        modal.show();
    }

    function getCellContent(task, colKey) {
        switch (colKey) {
            case 'project_name':
                return `<span style="color: ${task.project_color}">${escapeHtml(task.project_name || '--')}</span>`;
            case 'index':
                return String(task.index || '--');
            case 'summary':
                return escapeHtml(task.summary || '--');
            case 'description':
                const desc = task.description || '';
                return desc.length > 100 
                    ? `<span title="${escapeHtml(desc)}">${escapeHtml(desc.substring(0, 100))}...</span>`
                    : escapeHtml(desc || '--');
            case 'priority':
                return `<span class="priority-${task.priority || 3}">${task.priority || 3}</span>`;
            case 'progress':
                const progress = task.progress || 0;
                return `
                    <div class="progress-cell">
                        <div class="progress-bar-inline">
                            <div class="progress-fill-inline" style="width: ${progress}%"></div>
                        </div>
                        <span>${progress}%</span>
                    </div>
                `;
            case 'due_date':
                if (!task.due_date) return '<span class="due-date-none">--</span>';
                const dueStatus = getDueDateStatus(task.due_date);
                return `<span class="${dueStatus.class}">${formatDate(task.due_date)}</span>`;
            case 'created_at':
                return formatDateTime(task.created_at);
            case 'updated_at':
                return formatDateTime(task.updated_at);
            case 'comment_count':
                const count = task.comment_count || 0;
                if (count > 0) {
                    return `<span class="comment-count-link" data-task-id="${task.id}" style="color: #0066cc; cursor: pointer; text-decoration: underline;" title="点击查看评论">${count}</span>`;
                }
                return '0';
            default:
                return '--';
        }
    }

    // ===== 事件处理 =====

    function handleTimeFilterChange() {
        const type = refs.timeFilterType.value;
        state.timeFilter.type = type;

        if (type === 'none') {
            refs.timeFilterStart.style.display = 'none';
            refs.timeFilterEnd.style.display = 'none';
            document.querySelector('.filter-separator').style.display = 'none';
            state.timeFilter.start = null;
            state.timeFilter.end = null;
        } else {
            refs.timeFilterStart.style.display = 'inline-block';
            refs.timeFilterEnd.style.display = 'inline-block';
            document.querySelector('.filter-separator').style.display = 'inline-block';
        }

        if (refs.timeFilterStart.value) {
            state.timeFilter.start = refs.timeFilterStart.value;
        }
        if (refs.timeFilterEnd.value) {
            state.timeFilter.end = refs.timeFilterEnd.value;
        }

        applyFilters();
        renderTable();
    }

    function handleFontSizeChange(size) {
        state.fontSize = size;
        localStorage.setItem('todoPreviewFontSize', size);
        
        const page = document.querySelector('.todo-preview-page');
        page.classList.remove('font-size-small', 'font-size-medium', 'font-size-large');
        page.classList.add(`font-size-${size}`);

        [refs.fontSizeSmall, refs.fontSizeMedium, refs.fontSizeLarge].forEach(btn => {
            if (btn) btn.classList.remove('active');
        });

        if (size === 'small' && refs.fontSizeSmall) refs.fontSizeSmall.classList.add('active');
        if (size === 'medium' && refs.fontSizeMedium) refs.fontSizeMedium.classList.add('active');
        if (size === 'large' && refs.fontSizeLarge) refs.fontSizeLarge.classList.add('active');
    }

    // ===== 初始化 =====

    function attachEventListeners() {
        // 搜索输入
        if (refs.searchInput) {
            refs.searchInput.addEventListener('input', (e) => {
                state.searchText = e.target.value || '';
                applyFilters();
                renderTable();
            });
        }

        if (refs.timeFilterType) {
            refs.timeFilterType.addEventListener('change', handleTimeFilterChange);
        }

        if (refs.timeFilterStart) {
            refs.timeFilterStart.addEventListener('change', () => {
                state.timeFilter.start = refs.timeFilterStart.value;
                applyFilters();
                renderTable();
            });
        }

        if (refs.timeFilterEnd) {
            refs.timeFilterEnd.addEventListener('change', () => {
                state.timeFilter.end = refs.timeFilterEnd.value;
                applyFilters();
                renderTable();
            });
        }

        if (refs.exportButton) {
            refs.exportButton.addEventListener('click', () => {
                if (typeof openExportModal === 'function') {
                    openExportModal(state);
                } else {
                    showAlert('warning', '导出功能正在加载中...');
                }
            });
        }

        if (refs.fontSizeSmall) {
            refs.fontSizeSmall.addEventListener('click', () => handleFontSizeChange('small'));
        }

        if (refs.fontSizeMedium) {
            refs.fontSizeMedium.addEventListener('click', () => handleFontSizeChange('medium'));
        }

        if (refs.fontSizeLarge) {
            refs.fontSizeLarge.addEventListener('click', () => handleFontSizeChange('large'));
        }
    }

    function init() {
        attachEventListeners();
        handleFontSizeChange(state.fontSize);
        loadData();
    }

    // 导出状态供导出功能使用
    window.getPreviewState = () => state;

    document.addEventListener('DOMContentLoaded', init);
})();

