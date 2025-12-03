(() => {
    'use strict';

    const state = {
        projects: [],
        overview: {
            overdue: [],
            today_due: [],
            upcoming: [],
            undated: [],
            total_pending: 0,
        },
        filters: {
            text: '',
            project: 'all',
        },
        expandedProjects: new Set(), // 存储展开的项目ID
        directAccess: document.body.dataset.directAccess === 'true',
    };

    const refs = {
        projectsContainer: document.getElementById('projectsContainer'),
        searchInput: document.getElementById('searchInput'),
        projectFilter: document.getElementById('projectFilter'),
        newProjectButton: document.getElementById('newProjectButton'),
        alertContainer: document.getElementById('alertContainer'),
        pendingOverview: document.getElementById('pendingOverview'),
        overdueCount: document.getElementById('overdueCount'),
        todayCount: document.getElementById('todayCount'),
        upcomingCount: document.getElementById('upcomingCount'),
        undatedCount: document.getElementById('undatedCount'),
        createProjectForm: document.getElementById('createProjectForm'),
        editProjectForm: document.getElementById('editProjectForm'),
        createTaskForm: document.getElementById('createTaskForm'),
        editTaskForm: document.getElementById('editTaskForm'),
        commentForm: document.getElementById('commentForm'),
    };

    const modals = {
        createProject: refs.createProjectForm ? new bootstrap.Modal(document.getElementById('createProjectModal')) : null,
        editProject: refs.editProjectForm ? new bootstrap.Modal(document.getElementById('editProjectModal')) : null,
        createTask: refs.createTaskForm ? new bootstrap.Modal(document.getElementById('createTaskModal')) : null,
        editTask: refs.editTaskForm ? new bootstrap.Modal(document.getElementById('editTaskModal')) : null,
        comment: refs.commentForm ? new bootstrap.Modal(document.getElementById('commentModal')) : null,
    };

    let currentProjectId = null;
    let currentTaskId = null;
    let currentProjectIdForTask = null;
    let draggedElement = null;

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

    function randomColor() {
        const colors = [
            '#4facfe', '#00f2fe', '#43e97b', '#fa709a',
            '#fee140', '#30cfd0', '#a8edea', '#fed6e3',
            '#ff9a9e', '#fecfef', '#fecfef', '#ffecd2',
        ];
        return colors[Math.floor(Math.random() * colors.length)];
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

        let r, g, b;

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

    function randomColorHSL() {
        const h = Math.floor(Math.random() * 360);
        const s = 65 + Math.random() * 25;
        const l = 47 + Math.random() * 12;
        return hslToHex(h, s, l);
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

    function calculateProjectProgress(tasks) {
        if (!tasks || tasks.length === 0) return 0;
        const total = tasks.reduce((sum, task) => sum + (task.progress || 0), 0);
        return Math.round(total / tasks.length);
    }

    function getDueDateStatus(dueDate) {
        if (!dueDate) return { status: 'none', label: '未设置' };
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        const diff = Math.floor((due - today) / (1000 * 60 * 60 * 24));
        if (diff < 0) return { status: 'overdue', label: `逾期 ${Math.abs(diff)} 天` };
        if (diff === 0) return { status: 'today', label: '今日截止' };
        return { status: 'upcoming', label: `剩余 ${diff} 天` };
    }

    function matchesSearch(project, task, keyword) {
        if (!keyword) return true;
        const lowerKeyword = keyword.toLowerCase();
        const fields = [
            project.name,
            task.summary,
            task.description,
        ];
        return fields.some(field => field && String(field).toLowerCase().includes(lowerKeyword));
    }

    function getFilteredProjects() {
        const projectFilter = state.filters.project;
        const searchKeyword = (state.filters.text || '').trim().toLowerCase();

        return state.projects.filter(project => {
            if (projectFilter !== 'all' && project.id !== projectFilter) {
                return false;
            }

            if (!searchKeyword) return true;

            // 检查项目名称
            if (project.name && project.name.toLowerCase().includes(searchKeyword)) {
                return true;
            }

            // 检查任务
            return project.tasks.some(task => matchesSearch(project, task, searchKeyword));
        });
    }

    // ===== 渲染函数 =====

    function renderProjects() {
        if (!refs.projectsContainer) return;

        const filteredProjects = getFilteredProjects();
        refs.projectsContainer.innerHTML = '';

        if (filteredProjects.length === 0) {
            refs.projectsContainer.innerHTML = `
                <div class="panel">
                    <p class="text-center text-muted" style="padding: 40px;">
                        暂无项目，点击"新建项目"开始创建
                    </p>
                </div>
            `;
            return;
        }

        filteredProjects.forEach(project => {
            const projectElement = createProjectElement(project);
            refs.projectsContainer.appendChild(projectElement);
        });

        // 刷新项目筛选器选项
        refreshProjectFilter();
    }

    function createProjectElement(project) {
        const wrapper = document.createElement('div');
        wrapper.className = 'project-table-wrapper';
        wrapper.dataset.projectId = project.id;

        const isExpanded = state.expandedProjects.has(project.id);
        const progress = calculateProjectProgress(project.tasks);
        const filteredTasks = getFilteredTasks(project);

        wrapper.innerHTML = `
            <div class="project-header ${isExpanded ? 'expanded' : 'collapsed'}" data-project-id="${project.id}">
                <div class="project-color-indicator" style="background-color: ${project.color || '#4facfe'};"></div>
                <div class="project-header-content">
                    <div class="project-info">
                        <h3 class="project-name">${escapeHtml(project.name || '未命名项目')}</h3>
                        <div class="project-meta">
                            <span>创建于 ${formatDate(project.created_at)}</span>
                            <span>任务数: ${project.tasks.length}</span>
                        </div>
                    </div>
                    <div class="project-progress">
                        <div class="project-progress-bar">
                            <div class="project-progress-fill" style="width: ${progress}%;"></div>
                        </div>
                        <span class="project-progress-text">${progress}%</span>
                    </div>
                    <div class="project-actions">
                        <button type="button" class="btn btn-sm btn-outline-primary" data-action="new-task" data-project-id="${project.id}">
                            <i class="fas fa-plus"></i> 新建任务
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-action="edit-project" data-project-id="${project.id}">
                            <i class="fas fa-pen"></i> 编辑
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete-project" data-project-id="${project.id}">
                            <i class="fas fa-trash"></i> 删除
                        </button>
                        <i class="fas fa-chevron-down project-toggle-icon"></i>
                    </div>
                </div>
            </div>
            <table class="project-table ${isExpanded ? 'expanded' : ''}">
                <thead>
                    <tr>
                        <th>序号</th>
                        <th>简述</th>
                        <th>详细描述</th>
                        <th>创建时间</th>
                        <th>预计完成</th>
                        <th>优先级</th>
                        <th>进度</th>
                        <th>上次更新</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${filteredTasks.map((task, index) => createTaskRow(task, index + 1, project.id)).join('')}
                </tbody>
            </table>
        `;

        // 绑定事件
        const header = wrapper.querySelector('.project-header');
        header.addEventListener('click', (e) => {
            if (!e.target.closest('button')) {
                toggleProject(project.id);
            }
        });

        // 绑定按钮事件
        wrapper.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', handleAction);
        });

        // 绑定详细描述展开/折叠事件
        wrapper.querySelectorAll('.task-description-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetId = btn.dataset.target;
                const content = document.getElementById(targetId);
                const isExpanded = btn.dataset.expanded === 'true';
                const toggleText = btn.querySelector('.toggle-text');

                if (content) {
                    if (isExpanded) {
                        content.classList.add('collapsed');
                        btn.querySelector('i').className = 'fas fa-chevron-down';
                        if (toggleText) toggleText.textContent = '展开';
                        btn.dataset.expanded = 'false';
                    } else {
                        content.classList.remove('collapsed');
                        btn.querySelector('i').className = 'fas fa-chevron-up';
                        if (toggleText) toggleText.textContent = '收起';
                        btn.dataset.expanded = 'true';
                    }
                }
            });
        });

        // 绑定历史记录展开/折叠事件
        wrapper.querySelectorAll('.task-history-toggle').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const targetId = btn.dataset.target;
                const taskId = btn.dataset.taskId;
                const content = document.getElementById(targetId);
                const isExpanded = btn.dataset.expanded === 'true';

                if (content) {
                    if (isExpanded) {
                        content.classList.add('collapsed');
                        btn.querySelector('i').className = 'fas fa-history';
                        btn.dataset.expanded = 'false';
                    } else {
                        content.classList.remove('collapsed');
                        btn.querySelector('i').className = 'fas fa-history';
                        btn.classList.add('active');
                        btn.dataset.expanded = 'true';
                        // 滚动到历史记录区域
                        const historyRow = wrapper.querySelector(`.task-history-row[data-task-id="${taskId}"]`);
                        if (historyRow) {
                            setTimeout(() => {
                                historyRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                            }, 100);
                        }
                    }
                }
            });
        });

        // 绑定历史记录筛选事件
        wrapper.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const filter = btn.dataset.filter;
                const taskId = btn.dataset.taskId;
                const historyRow = wrapper.querySelector(`.task-history-row[data-task-id="${taskId}"]`);
                if (!historyRow) return;

                // 更新按钮状态
                historyRow.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                // 筛选记录
                const allItems = historyRow.querySelectorAll('.history-item');
                allItems.forEach(item => {
                    const itemType = item.dataset.type;
                    if (filter === 'all') {
                        item.style.display = '';
                    } else if (filter === 'update' && itemType === 'update') {
                        item.style.display = '';
                    } else if (filter === 'comment' && itemType === 'comment') {
                        item.style.display = '';
                    } else {
                        item.style.display = 'none';
                    }
                });
            });
        });

        // 绑定拖拽事件
        if (isExpanded) {
            setupDragAndDrop(wrapper, project.id);
        }

        return wrapper;
    }

    function getFilteredTasks(project) {
        const searchKeyword = (state.filters.text || '').trim().toLowerCase();
        if (!searchKeyword) return project.tasks || [];

        return (project.tasks || []).filter(task => {
            return matchesSearch(project, task, searchKeyword);
        });
    }

    function createHistoryContent(task, updateHistory, comments) {
        // 合并所有记录并按时间排序
        const allRecords = [];
        
        // 添加更新记录（排除comment类型的记录，因为评论已经在comments数组中）
        updateHistory.forEach(record => {
            // 跳过field为'comment'的记录，这些是评论记录，应该从comments数组中获取
            if (record.field === 'comment') {
                return;
            }
            allRecords.push({
                type: 'update',
                field: record.field,
                old_value: record.old_value,
                new_value: record.new_value,
                timestamp: record.timestamp,
            });
        });
        
        // 添加评论记录
        comments.forEach(comment => {
            allRecords.push({
                type: 'comment',
                content: comment.content,
                comment_id: comment.comment_id,
                timestamp: comment.timestamp,
            });
        });
        
        // 按时间倒序排序
        allRecords.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
        
        if (allRecords.length === 0) {
            return '<div class="text-muted text-center" style="padding: 20px;">暂无记录</div>';
        }
        
        return allRecords.map(record => {
            if (record.type === 'comment') {
                return `
                    <div class="history-item history-comment" data-type="comment">
                        <span class="history-type-badge badge bg-primary">评论</span>
                        <span class="history-time">${formatDateTime(record.timestamp)}</span>
                        <span class="history-item-content">${escapeHtml(record.content).replace(/\n/g, ' ')}</span>
                    </div>
                `;
            } else {
                const fieldNames = {
                    'summary': '简述',
                    'description': '详细描述',
                    'priority': '优先级',
                    'progress': '进度',
                    'due_date': '预计完成时间',
                    'create': '创建',
                };
                const fieldName = fieldNames[record.field] || record.field;
                const oldVal = record.old_value !== null && record.old_value !== undefined ? escapeHtml(String(record.old_value)) : '--';
                const newVal = record.new_value !== null && record.new_value !== undefined ? escapeHtml(String(record.new_value)) : '--';
                
                return `
                    <div class="history-item history-update" data-type="update">
                        <span class="history-type-badge badge bg-secondary">修改</span>
                        <span class="history-time">${formatDateTime(record.timestamp)}</span>
                        <span class="history-item-content">
                            <strong>${fieldName}</strong>: 
                            <span class="text-muted">${oldVal}</span> 
                            → 
                            <span class="text-primary">${newVal}</span>
                        </span>
                    </div>
                `;
            }
        }).join('');
    }

    function createTaskRow(task, index, projectId) {
        const dueStatus = getDueDateStatus(task.due_date);
        const progress = task.progress || 0;
        const hasDescription = task.description && task.description.trim().length > 0;
        // 去除描述前后的空白字符，但保留内容内部的换行
        // 先去除每行开头的空白，然后去除首尾空白
        const descriptionText = hasDescription ? task.description
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n')
            .trim() : '';
        const descriptionPreview = descriptionText ? escapeHtml(descriptionText) : '';
        const descriptionId = `desc-${task.id}`;
        // 如果描述超过150字符或包含换行符，则视为长描述，需要展开/折叠
        const isLongDescription = descriptionText && (descriptionText.length > 150 || descriptionText.includes('\n'));

        // 准备历史记录数据
        const updateHistory = task.update_history || [];
        const comments = task.comments || [];
        const historyId = `history-${task.id}`;
        const hasHistory = updateHistory.length > 0 || comments.length > 0;

        return `
            <tr data-task-id="${task.id}" data-project-id="${projectId}">
                <td class="drag-handle" draggable="true">${index}</td>
                <td>
                    <div class="task-summary">${escapeHtml(task.summary || '未命名任务')}</div>
                </td>
                <td class="task-description-cell">
                    ${hasDescription ? `<div class="task-description-wrapper"><div class="task-description-content ${isLongDescription ? 'collapsed' : ''}" id="${descriptionId}">${descriptionPreview}</div>${isLongDescription ? `<button type="button" class="btn btn-link btn-sm task-description-toggle" data-target="${descriptionId}" data-expanded="false"><i class="fas fa-chevron-down"></i> <span class="toggle-text">展开</span></button>` : ''}</div>` : '<span class="text-muted">--</span>'}
                </td>
                <td>${formatDate(task.created_at)}</td>
                <td>
                    <span class="task-due-date ${dueStatus.status}">${task.due_date ? formatDate(task.due_date) : '--'}</span>
                </td>
                <td>
                    <span class="task-priority priority-${task.priority || 3}">${task.priority || 3}</span>
                </td>
                <td>
                    <div class="task-progress">
                        <div class="task-progress-bar">
                            <div class="task-progress-fill" style="width: ${progress}%;"></div>
                        </div>
                        <span class="task-progress-text">${progress}%</span>
                    </div>
                </td>
                <td class="task-updated-at">${formatDateTime(task.updated_at)}</td>
                <td>
                    <div class="task-actions">
                        <button type="button" class="btn btn-sm btn-outline-primary" data-action="comment-task" data-project-id="${projectId}" data-task-id="${task.id}">
                            <i class="fas fa-comment"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-action="edit-task" data-project-id="${projectId}" data-task-id="${task.id}">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete-task" data-project-id="${projectId}" data-task-id="${task.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                        ${hasHistory ? `
                        <button type="button" class="btn btn-sm btn-outline-info task-history-toggle" data-target="${historyId}" data-expanded="false" data-task-id="${task.id}" title="展开记录">
                            <i class="fas fa-history"></i>
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
            ${hasHistory ? `
            <tr class="task-history-row" data-task-id="${task.id}">
                <td colspan="9">
                    <div class="task-history-section">
                        <div class="task-history-header">
                            <span class="history-count">共 ${updateHistory.length} 条修改, ${comments.length} 条评论</span>
                            <div class="task-history-filters">
                                <button type="button" class="btn btn-sm btn-outline-secondary filter-btn active" data-filter="all" data-task-id="${task.id}">全部</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary filter-btn" data-filter="update" data-task-id="${task.id}">仅修改</button>
                                <button type="button" class="btn btn-sm btn-outline-secondary filter-btn" data-filter="comment" data-task-id="${task.id}">仅评论</button>
                            </div>
                        </div>
                        <div class="task-history-content collapsed" id="${historyId}">
                            ${createHistoryContent(task, updateHistory, comments)}
                        </div>
                    </div>
                </td>
            </tr>
            ` : ''}
        `;
    }

    function setupDragAndDrop(wrapper, projectId) {
        const tbody = wrapper.querySelector('tbody');
        if (!tbody) return;

        const rows = Array.from(tbody.querySelectorAll('tr'));

        rows.forEach(row => {
            const handle = row.querySelector('.drag-handle');
            if (!handle) return;

            handle.addEventListener('dragstart', (e) => {
                draggedElement = row;
                row.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/html', row.innerHTML);
            });

            handle.addEventListener('dragend', () => {
                row.classList.remove('dragging');
                rows.forEach(r => r.classList.remove('drag-over'));
            });

            row.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (row !== draggedElement) {
                    rows.forEach(r => r.classList.remove('drag-over'));
                    row.classList.add('drag-over');
                }
            });

            row.addEventListener('drop', (e) => {
                e.preventDefault();
                if (draggedElement && row !== draggedElement) {
                    const allRows = Array.from(tbody.querySelectorAll('tr'));
                    const draggedIndex = allRows.indexOf(draggedElement);
                    const targetIndex = allRows.indexOf(row);

                    if (draggedIndex < targetIndex) {
                        tbody.insertBefore(draggedElement, row.nextSibling);
                    } else {
                        tbody.insertBefore(draggedElement, row);
                    }

                    // 保存新顺序
                    const newOrder = Array.from(tbody.querySelectorAll('tr')).map(r => r.dataset.taskId);
                    reorderTasks(projectId, newOrder);
                }
                rows.forEach(r => r.classList.remove('drag-over'));
            });
        });
    }

    function renderPendingOverview() {
        if (!refs.pendingOverview) return;

        const { overdue, today_due, upcoming, undated } = state.overview;

        // 更新计数
        if (refs.overdueCount) refs.overdueCount.textContent = overdue.length;
        if (refs.todayCount) refs.todayCount.textContent = today_due.length;
        if (refs.upcomingCount) refs.upcomingCount.textContent = upcoming.length;
        if (refs.undatedCount) refs.undatedCount.textContent = undated.length;

        const allPending = [...overdue, ...today_due, ...upcoming, ...undated];

        if (allPending.length === 0) {
            refs.pendingOverview.innerHTML = `
                <div class="text-center text-muted" style="padding: 40px;">
                    暂无待完成任务
                </div>
            `;
            return;
        }

        refs.pendingOverview.innerHTML = allPending.map(task => createPendingCard(task)).join('');

        // 绑定卡片点击事件
        refs.pendingOverview.querySelectorAll('.pending-card').forEach(card => {
            card.addEventListener('click', () => {
                const projectId = card.dataset.projectId;
                const taskId = card.dataset.taskId;
                if (projectId && taskId) {
                    // 展开项目并滚动到任务
                    state.expandedProjects.add(projectId);
                    renderProjects();
                    // 滚动到项目位置
                    setTimeout(() => {
                        const projectElement = document.querySelector(`[data-project-id="${projectId}"]`);
                        if (projectElement) {
                            projectElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }, 100);
                }
            });
        });
    }

    function createPendingCard(task) {
        const dueStatus = getDueDateStatus(task.due_date);
        const progress = task.progress || 0;
        const projectColor = task.project_color || '#4facfe';

        return `
            <div class="pending-card ${dueStatus.status}" data-project-id="${task.project_id}" data-task-id="${task.id}" style="border-left-color: ${projectColor};">
                <div class="pending-card-header">
                    <div>
                        <div class="pending-card-project" style="color: ${projectColor}">
                            ${escapeHtml(task.project_name || '未命名项目')}
                        </div>
                        <h4 class="pending-card-summary">${escapeHtml(task.summary || '未命名任务')}</h4>
                    </div>
                </div>
                <div class="pending-card-meta">
                    <span>优先级: ${task.priority || 3}</span>
                    <span>进度: ${progress}%</span>
                </div>
                <div class="pending-card-progress">
                    <div class="task-progress-bar">
                        <div class="task-progress-fill" style="width: ${progress}%;"></div>
                    </div>
                </div>
                ${task.due_date ? `
                    <div class="pending-card-due ${dueStatus.status}">
                        ${formatDate(task.due_date)} · ${dueStatus.label}
                    </div>
                ` : ''}
            </div>
        `;
    }

    function refreshProjectFilter() {
        if (!refs.projectFilter) return;

        const options = ['<option value="all">全部项目</option>'];
        state.projects.forEach(project => {
            options.push(`<option value="${project.id}">${escapeHtml(project.name || '未命名项目')}</option>`);
        });

        const currentValue = refs.projectFilter.value;
        refs.projectFilter.innerHTML = options.join('');
        if (currentValue && state.projects.some(p => p.id === currentValue)) {
            refs.projectFilter.value = currentValue;
        } else {
            refs.projectFilter.value = 'all';
            state.filters.project = 'all';
        }
    }

    // ===== 交互函数 =====

    function toggleProject(projectId) {
        if (state.expandedProjects.has(projectId)) {
            state.expandedProjects.delete(projectId);
        } else {
            state.expandedProjects.add(projectId);
        }
        renderProjects();
    }

    async function loadData() {
        try {
            const response = await fetch('/api/todo/v2/data');
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '加载数据失败');
            }

            state.projects = result.data.projects || [];
            state.overview = result.overview || {
                overdue: [],
                today_due: [],
                upcoming: [],
                undated: [],
                total_pending: 0,
            };

            renderProjects();
            renderPendingOverview();
        } catch (error) {
            showAlert('danger', error.message || String(error));
        }
    }

    async function createProject(payload) {
        try {
            const response = await fetch('/api/todo/v2/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '创建项目失败');
            }
            await loadData();
            showAlert('success', '项目创建成功');
            return result.project;
        } catch (error) {
            showAlert('danger', error.message || String(error));
            throw error;
        }
    }

    async function updateProject(projectId, payload) {
        try {
            const response = await fetch(`/api/todo/v2/projects/${projectId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '更新项目失败');
            }
            await loadData();
            showAlert('success', '项目更新成功');
            return result.project;
        } catch (error) {
            showAlert('danger', error.message || String(error));
            throw error;
        }
    }

    async function deleteProject(projectId) {
        if (!confirm('确定删除该项目吗？删除后所有任务也将被删除，此操作不可恢复。')) {
            return;
        }
        try {
            const response = await fetch(`/api/todo/v2/projects/${projectId}`, {
                method: 'DELETE',
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '删除项目失败');
            }
            state.expandedProjects.delete(projectId);
            await loadData();
            showAlert('success', '项目已删除');
        } catch (error) {
            showAlert('danger', error.message || String(error));
        }
    }

    async function createTask(projectId, payload) {
        try {
            const response = await fetch(`/api/todo/v2/projects/${projectId}/tasks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '创建任务失败');
            }
            // 确保项目展开
            state.expandedProjects.add(projectId);
            await loadData();
            showAlert('success', '任务创建成功');
            return result.task;
        } catch (error) {
            showAlert('danger', error.message || String(error));
            throw error;
        }
    }

    async function updateTask(projectId, taskId, payload) {
        try {
            const response = await fetch(`/api/todo/v2/projects/${projectId}/tasks/${taskId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '更新任务失败');
            }
            await loadData();
            showAlert('success', '任务更新成功');
            return result.task;
        } catch (error) {
            showAlert('danger', error.message || String(error));
            throw error;
        }
    }

    async function deleteTask(projectId, taskId) {
        if (!confirm('确定删除该任务吗？此操作不可恢复。')) {
            return;
        }
        try {
            const response = await fetch(`/api/todo/v2/projects/${projectId}/tasks/${taskId}`, {
                method: 'DELETE',
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '删除任务失败');
            }
            await loadData();
            showAlert('success', '任务已删除');
        } catch (error) {
            showAlert('danger', error.message || String(error));
        }
    }

    async function reorderTasks(projectId, taskIds) {
        try {
            const response = await fetch(`/api/todo/v2/projects/${projectId}/tasks/reorder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task_ids: taskIds }),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '排序失败');
            }
            await loadData();
        } catch (error) {
            showAlert('danger', error.message || String(error));
        }
    }

    async function addComment(projectId, taskId, content) {
        try {
            const response = await fetch(`/api/todo/v2/projects/${projectId}/tasks/${taskId}/comments`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content }),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '添加评论失败');
            }
            await loadData();
            showAlert('success', '评论已添加');
            return result.task;
        } catch (error) {
            showAlert('danger', error.message || String(error));
            throw error;
        }
    }

    // ===== 模态框处理 =====

    function openCreateProjectModal() {
        if (refs.createProjectForm) {
            refs.createProjectForm.reset();
            refs.createProjectForm.classList.remove('was-validated');
            const colorField = refs.createProjectForm.querySelector('[name="color"]');
            if (colorField) {
                colorField.value = randomColorHSL();
            }
        }
        if (modals.createProject) {
            modals.createProject.show();
        }
    }

    function openEditProjectModal(projectId) {
        const project = state.projects.find(p => p.id === projectId);
        if (!project || !refs.editProjectForm) return;

        refs.editProjectForm.dataset.projectId = projectId;
        refs.editProjectForm.querySelector('[name="name"]').value = project.name || '';
        refs.editProjectForm.querySelector('[name="color"]').value = project.color || '#4facfe';
        refs.editProjectForm.classList.remove('was-validated');

        if (modals.editProject) {
            modals.editProject.show();
        }
    }

    function openCreateTaskModal(projectId) {
        currentProjectId = projectId;
        if (refs.createTaskForm) {
            refs.createTaskForm.reset();
            refs.createTaskForm.classList.remove('was-validated');
            refs.createTaskForm.querySelector('[name="progress"]').value = '0';
            refs.createTaskForm.querySelector('[name="priority"]').value = '3';
        }
        if (modals.createTask) {
            modals.createTask.show();
        }
    }

    function openEditTaskModal(projectId, taskId) {
        const project = state.projects.find(p => p.id === projectId);
        if (!project) return;
        const task = project.tasks.find(t => t.id === taskId);
        if (!task || !refs.editTaskForm) return;

        currentProjectId = projectId;
        currentTaskId = taskId;

        refs.editTaskForm.querySelector('[name="summary"]').value = task.summary || '';
        refs.editTaskForm.querySelector('[name="description"]').value = task.description || '';
        refs.editTaskForm.querySelector('[name="priority"]').value = task.priority || 3;
        refs.editTaskForm.querySelector('[name="progress"]').value = task.progress || 0;
        const dueField = refs.editTaskForm.querySelector('[name="due_date"]');
        if (dueField) {
            dueField.value = task.due_date || '';
        }
        refs.editTaskForm.classList.remove('was-validated');

        if (modals.editTask) {
            modals.editTask.show();
        }
    }

    function openCommentModal(projectId, taskId) {
        currentProjectId = projectId;
        currentTaskId = taskId;
        if (refs.commentForm) {
            refs.commentForm.reset();
            refs.commentForm.classList.remove('was-validated');
        }
        if (modals.comment) {
            modals.comment.show();
        }
    }

    // ===== 事件处理 =====

    function handleAction(e) {
        const button = e.target.closest('[data-action]');
        if (!button) return;
        e.stopPropagation();

        const action = button.dataset.action;
        const projectId = button.dataset.projectId;
        const taskId = button.dataset.taskId;

        switch (action) {
            case 'new-task':
                openCreateTaskModal(projectId);
                break;
            case 'edit-project':
                openEditProjectModal(projectId);
                break;
            case 'delete-project':
                deleteProject(projectId);
                break;
            case 'edit-task':
                openEditTaskModal(projectId, taskId);
                break;
            case 'delete-task':
                deleteTask(projectId, taskId);
                break;
            case 'comment-task':
                openCommentModal(projectId, taskId);
                break;
        }
    }

    function handleSearchInput(e) {
        state.filters.text = e.target.value || '';
        renderProjects();
    }

    function handleProjectFilter(e) {
        state.filters.project = e.target.value || 'all';
        renderProjects();
    }

    // ===== 表单提交 =====

    async function handleCreateProject(e) {
        e.preventDefault();
        clearAlert();
        const form = refs.createProjectForm;
        form.classList.add('was-validated');
        if (!form.checkValidity()) return;

        const formData = new FormData(form);
        const payload = {
            name: formData.get('name') || '',
            color: formData.get('color') || '#4facfe',
        };

        try {
            await createProject(payload);
            if (modals.createProject) {
                modals.createProject.hide();
            }
        } catch (error) {
            // 错误已在createProject中处理
        }
    }

    async function handleEditProject(e) {
        e.preventDefault();
        clearAlert();
        const form = refs.editProjectForm;
        form.classList.add('was-validated');
        if (!form.checkValidity()) return;

        const projectId = form.dataset.projectId;
        if (!projectId) return;

        const formData = new FormData(form);
        const payload = {
            name: formData.get('name') || '',
            color: formData.get('color') || '#4facfe',
        };

        try {
            await updateProject(projectId, payload);
            if (modals.editProject) {
                modals.editProject.hide();
            }
        } catch (error) {
            // 错误已在updateProject中处理
        }
    }

    async function handleCreateTask(e) {
        e.preventDefault();
        clearAlert();
        const form = refs.createTaskForm;
        form.classList.add('was-validated');
        if (!form.checkValidity()) return;

        if (!currentProjectId) return;

        const formData = new FormData(form);
        const payload = {
            summary: formData.get('summary') || '',
            description: formData.get('description') || '',
            priority: parseInt(formData.get('priority') || '3'),
            progress: parseInt(formData.get('progress') || '0'),
            due_date: formData.get('due_date') || null,
        };

        try {
            await createTask(currentProjectId, payload);
            if (modals.createTask) {
                modals.createTask.hide();
            }
        } catch (error) {
            // 错误已在createTask中处理
        }
    }

    async function handleEditTask(e) {
        e.preventDefault();
        clearAlert();
        const form = refs.editTaskForm;
        form.classList.add('was-validated');
        if (!form.checkValidity()) return;

        if (!currentProjectId || !currentTaskId) return;

        const formData = new FormData(form);
        const payload = {
            summary: formData.get('summary') || '',
            description: formData.get('description') || '',
            priority: parseInt(formData.get('priority') || '3'),
            progress: parseInt(formData.get('progress') || '0'),
            due_date: formData.get('due_date') || null,
        };

        try {
            await updateTask(currentProjectId, currentTaskId, payload);
            if (modals.editTask) {
                modals.editTask.hide();
            }
        } catch (error) {
            // 错误已在updateTask中处理
        }
    }

    async function handleComment(e) {
        e.preventDefault();
        clearAlert();
        const form = refs.commentForm;
        form.classList.add('was-validated');
        if (!form.checkValidity()) return;

        if (!currentProjectId || !currentTaskId) return;

        const content = form.elements.content.value.trim();
        if (!content) {
            showAlert('danger', '评论内容不能为空');
            return;
        }

        try {
            await addComment(currentProjectId, currentTaskId, content);
            if (modals.comment) {
                modals.comment.hide();
            }
        } catch (error) {
            // 错误已在addComment中处理
        }
    }

    // ===== 初始化 =====

    function attachEventListeners() {
        if (refs.newProjectButton) {
            refs.newProjectButton.addEventListener('click', openCreateProjectModal);
        }

        if (refs.searchInput) {
            refs.searchInput.addEventListener('input', handleSearchInput);
        }

        if (refs.projectFilter) {
            refs.projectFilter.addEventListener('change', handleProjectFilter);
        }

        if (refs.createProjectForm) {
            refs.createProjectForm.addEventListener('submit', handleCreateProject);
            refs.createProjectForm.addEventListener('click', (e) => {
                if (e.target.closest('[data-action="random-color"]')) {
                    e.preventDefault();
                    const colorField = refs.createProjectForm.querySelector('[name="color"]');
                    if (colorField) {
                        colorField.value = randomColorHSL();
                    }
                }
            });
        }

        if (refs.editProjectForm) {
            refs.editProjectForm.addEventListener('submit', handleEditProject);
            refs.editProjectForm.addEventListener('click', (e) => {
                if (e.target.closest('[data-action="random-color"]')) {
                    e.preventDefault();
                    const colorField = refs.editProjectForm.querySelector('[name="color"]');
                    if (colorField) {
                        colorField.value = randomColorHSL();
                    }
                }
            });
        }

        if (refs.createTaskForm) {
            refs.createTaskForm.addEventListener('submit', handleCreateTask);
        }

        if (refs.editTaskForm) {
            refs.editTaskForm.addEventListener('submit', handleEditTask);
        }

        if (refs.commentForm) {
            refs.commentForm.addEventListener('submit', handleComment);
        }

        // 字体大小切换
        const fontSizeSmall = document.getElementById('fontSizeSmall');
        const fontSizeMedium = document.getElementById('fontSizeMedium');
        const fontSizeLarge = document.getElementById('fontSizeLarge');
        const page = document.querySelector('.todo-v2-page');

        // 从localStorage读取保存的字体大小
        const savedFontSize = localStorage.getItem('todoFontSize') || 'medium';
        if (page) {
            page.classList.add(`font-size-${savedFontSize}`);
            // 更新按钮状态
            [fontSizeSmall, fontSizeMedium, fontSizeLarge].forEach(btn => {
                if (btn) btn.classList.remove('active');
            });
            if (savedFontSize === 'small' && fontSizeSmall) fontSizeSmall.classList.add('active');
            if (savedFontSize === 'medium' && fontSizeMedium) fontSizeMedium.classList.add('active');
            if (savedFontSize === 'large' && fontSizeLarge) fontSizeLarge.classList.add('active');
        }

        if (fontSizeSmall) {
            fontSizeSmall.addEventListener('click', () => {
                if (page) {
                    page.classList.remove('font-size-medium', 'font-size-large');
                    page.classList.add('font-size-small');
                }
                [fontSizeSmall, fontSizeMedium, fontSizeLarge].forEach(btn => {
                    if (btn) btn.classList.remove('active');
                });
                fontSizeSmall.classList.add('active');
                localStorage.setItem('todoFontSize', 'small');
            });
        }

        if (fontSizeMedium) {
            fontSizeMedium.addEventListener('click', () => {
                if (page) {
                    page.classList.remove('font-size-small', 'font-size-large');
                    page.classList.add('font-size-medium');
                }
                [fontSizeSmall, fontSizeMedium, fontSizeLarge].forEach(btn => {
                    if (btn) btn.classList.remove('active');
                });
                fontSizeMedium.classList.add('active');
                localStorage.setItem('todoFontSize', 'medium');
            });
        }

        if (fontSizeLarge) {
            fontSizeLarge.addEventListener('click', () => {
                if (page) {
                    page.classList.remove('font-size-small', 'font-size-medium');
                    page.classList.add('font-size-large');
                }
                [fontSizeSmall, fontSizeMedium, fontSizeLarge].forEach(btn => {
                    if (btn) btn.classList.remove('active');
                });
                fontSizeLarge.classList.add('active');
                localStorage.setItem('todoFontSize', 'large');
            });
        }
    }

    function init() {
        attachEventListeners();
        loadData();
    }

    document.addEventListener('DOMContentLoaded', init);
})();

