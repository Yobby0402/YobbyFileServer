(() => {
    'use strict';

    // 表格列定义
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
    };

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
        },
        expandedProjects: new Set(), // 存储展开的项目ID
        directAccess: document.body.dataset.directAccess === 'true',
        currentStyle: localStorage.getItem('todoStyle') || 'scroll', // 'scroll', 'table' 或 'report'
        showArchivedProjects: localStorage.getItem('todoShowArchivedProjects') === 'true',
        pendingCollapsed: localStorage.getItem('pendingCollapsed') === 'true', // 待完成任务列表是否折叠
        // 表格风格相关状态
        flatTasks: [], // 扁平化的任务列表
        filteredTasks: [],
        columns: [],
        timeFilter: {
            type: 'none',
            start: null,
            end: null,
        },
        fontSize: parseInt(localStorage.getItem('todoFontSize') || '14'),
        tableFilter: {
            column: null,
            value: null,
            startDate: null,
            endDate: null,
        },
        tableSort: {
            column: null,
            direction: 'asc',
        },
    };

    const refs = {
        projectsContainer: document.getElementById('projectsContainer'),
        searchInput: document.getElementById('searchInput'),
        newProjectButton: document.getElementById('newProjectButton'),
        exportButton: document.getElementById('exportButton'),
        toggleArchivedProjectsBtn: document.getElementById('toggleArchivedProjectsBtn'),
        archivedProjectsCount: document.getElementById('archivedProjectsCount'),
        alertContainer: document.getElementById('alertContainer'),
        pendingOverview: document.getElementById('pendingOverview'),
        pendingHeader: document.getElementById('pendingHeader'),
        overdueCount: document.getElementById('overdueCount'),
        todayCount: document.getElementById('todayCount'),
        upcomingCount: document.getElementById('upcomingCount'),
        undatedCount: document.getElementById('undatedCount'),
        createProjectForm: document.getElementById('createProjectForm'),
        editProjectForm: document.getElementById('editProjectForm'),
        createTaskForm: document.getElementById('createTaskForm'),
        editTaskForm: document.getElementById('editTaskForm'),
        commentForm: document.getElementById('commentForm'),
        styleScrollBtn: document.getElementById('styleScrollBtn'),
        styleTableBtn: document.getElementById('styleTableBtn'),
        styleReportBtn: document.getElementById('styleReportBtn'),
        scrollStyleContainer: document.getElementById('scrollStyleContainer'),
        tableStyleContainer: document.getElementById('tableStyleContainer'),
        reportStyleContainer: document.getElementById('reportStyleContainer'),
        tableHead: document.getElementById('tableHead'),
        tableBody: document.getElementById('tableBody'),
        tableEmptyMessage: document.getElementById('tableEmptyMessage'),
        reportTable: document.getElementById('reportTable'),
        reportTableBody: document.getElementById('reportTableBody'),
        reportEmptyMessage: document.getElementById('reportEmptyMessage'),
        exportReportBtn: document.getElementById('exportReportBtn'),
        fullscreenReportBtn: document.getElementById('fullscreenReportBtn'),
        fontSizeInput: document.getElementById('fontSizeInput'),
    };

    /** 汇报表与导出共用的数据块（仅含 show_in_report 为 true 的项目与任务） */
    function getReportProjectBlocks() {
        const blocks = [];
        const reportProjects = getProjectsForCurrentViews()
            .filter(project => project.show_in_report !== false);

        reportProjects.forEach(project => {
            const reportTasks = getFilteredTasks(project)
                .filter(task => task.show_in_report !== false);
            if (reportTasks.length > 0) {
                blocks.push({ project, tasks: reportTasks });
            }
        });
        return blocks;
    }

    function updateReportHeaderActionsVisibility() {
        const show = state.currentStyle === 'report';
        const disp = show ? '' : 'none';
        if (refs.exportReportBtn) refs.exportReportBtn.style.display = disp;
        if (refs.fullscreenReportBtn) refs.fullscreenReportBtn.style.display = disp;
    }

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

    function formatMultilineHtml(text) {
        return escapeHtml(text || '').replace(/\r?\n/g, '<br>');
    }

    function isProjectArchived(project) {
        return project?.archived === true;
    }

    function getActiveProjects() {
        return state.projects.filter(project => !isProjectArchived(project));
    }

    function getArchivedProjects() {
        return state.projects.filter(project => isProjectArchived(project));
    }

    function getProjectsForCurrentViews() {
        return state.showArchivedProjects ? getArchivedProjects() : getActiveProjects();
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

    // 计算待完成概览
    function calculatePendingOverview(projects) {
        const allTasks = [];
        
        // 收集所有任务并添加项目信息
        for (const project of projects) {
            if (isProjectArchived(project)) {
                continue;
            }
            for (const task of project.tasks || []) {
                const taskWithProject = {
                    ...task,
                    project_id: project.id,
                    project_name: project.name,
                    project_color: project.color || '#4facfe',
                };
                allTasks.push(taskWithProject);
            }
        }
        
        // 过滤未完成的任务（进度 < 100%）
        const pendingTasks = allTasks.filter(task => (task.progress || 0) < 100);
        
        // 计算今日日期
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD格式
        
        const overdue = [];
        const today_due = [];
        const upcoming = [];
        const undated = [];
        
        for (const task of pendingTasks) {
            const dueDate = task.due_date;
            if (!dueDate) {
                undated.push(task);
                continue;
            }
            
            try {
                // 解析日期（格式：YYYY-MM-DD）
                const due = new Date(dueDate + 'T00:00:00');
                due.setHours(0, 0, 0, 0);
                
                const diffTime = due - today;
                const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                
                if (diffDays < 0) {
                    overdue.push(task);
                } else if (diffDays === 0) {
                    today_due.push(task);
                } else {
                    upcoming.push(task);
                }
            } catch (e) {
                // 日期解析失败，归类为未设置日期
                undated.push(task);
            }
        }
        
        // 对即将到期的任务按日期排序
        upcoming.sort((a, b) => {
            const dateA = a.due_date || '';
            const dateB = b.due_date || '';
            return dateA.localeCompare(dateB);
        });
        
        return {
            overdue,
            today_due,
            upcoming,
            undated,
            total_pending: pendingTasks.length,
        };
    }

    function calculateProjectProgress(tasks) {
        if (!tasks || tasks.length === 0) return 0;
        const total = tasks.reduce((sum, task) => sum + (task.progress || 0), 0);
        return Math.round(total / tasks.length);
    }

    function getDueDateStatus(dueDate) {
        if (!dueDate) return { status: 'none', label: '未设置截止' };
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

    function getFilteredProjects(projects = state.projects) {
        const searchKeyword = (state.filters.text || '').trim().toLowerCase();

        return projects.filter(project => {
            if (!searchKeyword) return true;

            // 检查项目名称
            if (project.name && project.name.toLowerCase().includes(searchKeyword)) {
                return true;
            }

            // 检查任务
            return (project.tasks || []).some(task => matchesSearch(project, task, searchKeyword));
        });
    }

    // ===== 渲染函数 =====

    function updateArchivedProjectsToggle() {
        const archivedCount = getArchivedProjects().length;
        if (refs.archivedProjectsCount) {
            refs.archivedProjectsCount.textContent = String(archivedCount);
        }
        if (refs.toggleArchivedProjectsBtn) {
            refs.toggleArchivedProjectsBtn.classList.toggle('active', state.showArchivedProjects);
            refs.toggleArchivedProjectsBtn.setAttribute('aria-pressed', state.showArchivedProjects ? 'true' : 'false');
            refs.toggleArchivedProjectsBtn.disabled = archivedCount === 0 && !state.showArchivedProjects;
        }
    }

    function renderProjects() {
        if (!refs.projectsContainer) return;

        const visibleProjects = getFilteredProjects(getProjectsForCurrentViews());
        const archivedCount = getArchivedProjects().length;
        updateArchivedProjectsToggle();
        refs.projectsContainer.innerHTML = '';

        if (state.showArchivedProjects) {
            renderArchivedProjectSection(visibleProjects, archivedCount);
            return;
        }

        if (visibleProjects.length === 0) {
            refs.projectsContainer.innerHTML = `
                <div class="panel">
                    <p class="text-center text-muted" style="padding: 40px;">
                        暂无项目，点击"新建项目"开始创建
                    </p>
                </div>
            `;
            return;
        }

        visibleProjects.forEach(project => {
            const projectElement = createProjectElement(project);
            refs.projectsContainer.appendChild(projectElement);
        });

        // 刷新项目筛选器选项
    }

    function renderArchivedProjectSection(archivedProjects, archivedCount) {
        if (state.showArchivedProjects) {
            const archivedSection = document.createElement('div');
            archivedSection.className = 'project-section-header archived-project-section';
            archivedSection.innerHTML = `
                <div class="project-section-title">
                    <i class="fas fa-archive"></i>
                    已归档项目 (${archivedProjects.length}/${archivedCount})
                </div>
                <div class="project-section-description">归档项目默认不参与日常展示，仅在这里手动查看。</div>
            `;
            refs.projectsContainer.appendChild(archivedSection);

            if (archivedProjects.length === 0) {
                const emptyArchived = document.createElement('div');
                emptyArchived.className = 'panel archived-empty-panel';
                emptyArchived.innerHTML = `
                    <p class="text-center text-muted" style="padding: 32px;">
                        暂无符合当前筛选条件的已归档项目。
                    </p>
                `;
                refs.projectsContainer.appendChild(emptyArchived);
            } else {
                archivedProjects.forEach(project => {
                    const projectElement = createProjectElement(project);
                    refs.projectsContainer.appendChild(projectElement);
                });
            }
        }

    }

    function createProjectElement(project) {
        const wrapper = document.createElement('div');
        const archived = isProjectArchived(project);
        wrapper.className = archived ? 'project-table-wrapper archived-project' : 'project-table-wrapper';
        wrapper.dataset.projectId = project.id;

        const isExpanded = state.expandedProjects.has(project.id);
        const progress = calculateProjectProgress(project.tasks);
        const filteredTasks = getFilteredTasks(project);

        wrapper.innerHTML = `
            <div class="project-header ${isExpanded ? 'expanded' : 'collapsed'}" data-project-id="${project.id}">
                <div class="project-color-indicator" style="background-color: ${project.color || '#4facfe'};"></div>
                <div class="project-header-content">
                    <div class="project-info">
                        <h3 class="project-name">${escapeHtml(project.name || '未命名项目')}${project.phase ? `(${escapeHtml(project.phase)})` : ''}</h3>
                        <div class="project-meta">
                            ${archived ? '<span class="project-archived-badge"><i class="fas fa-archive"></i> 已归档<\/span>' : ''}
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
                        <button type="button" class="btn btn-sm btn-outline-info" data-action="view-description" data-project-id="${project.id}" title="查看项目描述">
                            <i class="fas fa-file-alt"></i> 描述
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-info" data-action="manage-links" data-project-id="${project.id}" title="管理链接">
                            <i class="fas fa-link"></i> 链接
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-action="edit-project" data-project-id="${project.id}">
                            <i class="fas fa-pen"></i> 编辑
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-warning" data-action="${archived ? 'unarchive-project' : 'archive-project'}" data-project-id="${project.id}">
                            <i class="fas ${archived ? 'fa-undo' : 'fa-archive'}"></i> ${archived ? '恢复' : '归档'}
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
        // 保留描述中的换行格式
        // 去除每行开头的空白，但保留换行符
        const descriptionText = hasDescription ? task.description
            .split('\n')
            .map(line => line.trim())
            .join('\n')
            .trim() : '';
        // 将换行符转换为<br>标签以在HTML中正确显示
        const descriptionPreview = descriptionText ? escapeHtml(descriptionText).replace(/\n/g, '<br>') : '';
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
                        <button type="button" class="btn btn-sm btn-outline-info" data-action="manage-task-links" data-project-id="${projectId}" data-task-id="${task.id}" title="管理链接">
                            <i class="fas fa-link"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-secondary" data-action="edit-task" data-project-id="${projectId}" data-task-id="${task.id}">
                            <i class="fas fa-pen"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete-task" data-project-id="${projectId}" data-task-id="${task.id}">
                            <i class="fas fa-trash"></i>
                        </button>
                        ${hasHistory ? `
                        <button type="button" class="btn btn-sm btn-outline-info" data-action="view-history" data-project-id="${projectId}" data-task-id="${task.id}" title="查看改动和评论">
                            <i class="fas fa-list"></i>
                        </button>
                        ` : ''}
                    </div>
                </td>
            </tr>
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

        // 待完成概览只展示有截止日期的任务，未设置截止日期的任务不显示卡片
        const allPending = [...overdue, ...today_due, ...upcoming];

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

            // 初始化表格数据
            flattenTasks();
            applyTableFilters();

            renderProjects();
            renderPendingOverview();
            switchStyle(state.currentStyle);
            
            // 如果当前是表格风格，初始化并渲染表格
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

    async function setProjectArchived(projectId, archived) {
        if (archived && !confirm('确定要归档该项目吗？归档后默认会被隐藏。')) {
            return;
        }

        try {
            const response = await fetch(`/api/todo/v2/projects/${projectId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ archived }),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'Failed to update archive state');
            }
            if (archived) {
                state.expandedProjects.delete(projectId);
            }
            await loadData();
            showAlert('success', archived ? '项目已归档' : '项目已恢复');
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
        const phaseField = refs.editProjectForm.querySelector('[name="phase"]');
        if (phaseField) {
            phaseField.value = project.phase || '';
        }
        const showInReportField = refs.editProjectForm.querySelector('[name="show_in_report"]');
        if (showInReportField) {
            showInReportField.checked = project.show_in_report !== false;
        }
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
        const taskTypeField = refs.editTaskForm.querySelector('[name="task_type"]');
        if (taskTypeField) {
            taskTypeField.value = task.task_type || '';
        }
        const conclusionField = refs.editTaskForm.querySelector('[name="conclusion"]');
        if (conclusionField) {
            conclusionField.value = task.conclusion || '';
        }
        const weeklyPlanField = refs.editTaskForm.querySelector('[name="weekly_plan"]');
        if (weeklyPlanField) {
            weeklyPlanField.value = task.weekly_plan || '';
        }
        const showInReportField = refs.editTaskForm.querySelector('[name="show_in_report"]');
        if (showInReportField) {
            showInReportField.checked = task.show_in_report !== false;
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
            case 'view-description':
                openProjectDescriptionModal(projectId);
                break;
            case 'manage-links':
                openProjectLinksModal(projectId);
                break;
            case 'edit-project':
                openEditProjectModal(projectId);
                break;
            case 'archive-project':
                setProjectArchived(projectId, true);
                break;
            case 'unarchive-project':
                setProjectArchived(projectId, false);
                break;
            case 'delete-project':
                deleteProject(projectId);
                break;
            case 'manage-task-links':
                openTaskLinksModal(taskId);
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
            case 'view-history':
                showHistoryModal(taskId);
                break;
        }
    }

    function toggleArchivedProjects() {
        state.showArchivedProjects = !state.showArchivedProjects;
        localStorage.setItem('todoShowArchivedProjects', state.showArchivedProjects ? 'true' : 'false');
        flattenTasks();
        applyTableFilters();
        renderProjects();
        if (state.currentStyle === 'table') {
            renderTable();
        } else if (state.currentStyle === 'report') {
            renderReportTable();
        }
    }

    function handleSearchInput(e) {
        state.filters.text = e.target.value || '';
        renderProjects();
        
        // 同时更新表格筛选
        if (state.currentStyle === 'table') {
            applyTableFilters();
            renderTable();
        } else if (state.currentStyle === 'report') {
            renderReportTable();
        }
    }


    function handleFontSizeChange(e) {
        const size = parseInt(e.target.value);
        if (isNaN(size) || size < 10 || size > 48) {
            e.target.value = state.fontSize;
            return;
        }
        state.fontSize = size;
        localStorage.setItem('todoFontSize', size);
        
        // 更新显示的值
        const fontSizeValue = document.getElementById('fontSizeValue');
        if (fontSizeValue) {
            fontSizeValue.textContent = size;
        }
        
        applyFontSize();
    }

    function applyFontSize() {
        const fontSize = state.fontSize;
        const boldFontSize = fontSize + 2;
        
        // 应用到显示区域
        const style = document.createElement('style');
        style.id = 'todoFontSizeStyle';
        const existingStyle = document.getElementById('todoFontSizeStyle');
        if (existingStyle) {
            existingStyle.remove();
        }
        
        style.textContent = `
            .todo-main,
            .table-style,
            .scroll-style,
            .projects-container,
            .preview-table,
            .preview-table th,
            .preview-table td,
            .report-table,
            .report-table th,
            .report-table td {
                font-size: ${fontSize}px !important;
            }
            
            .todo-main b,
            .todo-main strong,
            .table-style b,
            .table-style strong,
            .scroll-style b,
            .scroll-style strong,
            .preview-table th,
            .project-table th,
            .panel-title,
            .task-summary,
            .pending-card-title {
                font-size: ${boldFontSize}px !important;
            }
            
            .pending-cards,
            .pending-card,
            .pending-card-content,
            .pending-card-meta,
            .pending-card-due {
                font-size: ${fontSize}px !important;
            }
            
            .pending-card-project {
                font-size: ${fontSize}px !important;
            }
            
            .pending-card-summary,
            .pending-card-title {
                font-size: ${boldFontSize}px !important;
            }
        `;
        
        document.head.appendChild(style);
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
            phase: formData.get('phase') || '',
            show_in_report: formData.get('show_in_report') === 'on',
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
            phase: formData.get('phase') || '',
            show_in_report: formData.get('show_in_report') === 'on',
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
            task_type: formData.get('task_type') || '',
            conclusion: formData.get('conclusion') || '',
            weekly_plan: formData.get('weekly_plan') || '',
            show_in_report: formData.get('show_in_report') === 'on',
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
            task_type: formData.get('task_type') || '',
            conclusion: formData.get('conclusion') || '',
            weekly_plan: formData.get('weekly_plan') || '',
            show_in_report: formData.get('show_in_report') === 'on',
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

        if (refs.exportButton) {
            refs.exportButton.addEventListener('click', () => {
                if (typeof openExportModal === 'function') {
                    openExportModal(state);
                } else {
                    showAlert('warning', '导出功能正在加载中...');
                }
            });
        }

        if (refs.toggleArchivedProjectsBtn) {
            refs.toggleArchivedProjectsBtn.addEventListener('click', toggleArchivedProjects);
        }

        if (refs.searchInput) {
            refs.searchInput.addEventListener('input', handleSearchInput);
        }

        if (refs.projectFilter) {
            refs.projectFilter.addEventListener('change', handleProjectFilter);
        }

        // 待完成任务列表折叠
        if (refs.pendingHeader) {
            refs.pendingHeader.addEventListener('click', togglePendingList);
        }

        // 字体大小设置
        if (refs.fontSizeInput) {
            refs.fontSizeInput.value = state.fontSize;
            refs.fontSizeInput.addEventListener('change', handleFontSizeChange);
            refs.fontSizeInput.addEventListener('input', handleFontSizeChange);
            
            // 初始化显示的值
            const fontSizeValue = document.getElementById('fontSizeValue');
            if (fontSizeValue) {
                fontSizeValue.textContent = state.fontSize;
            }
            
            applyFontSize();
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

    // ===== 表格风格相关函数 =====

    function flattenTasks() {
        state.flatTasks = [];
        getProjectsForCurrentViews().forEach((project) => {
            (project.tasks || []).forEach((task, taskIndex) => {
                const updateHistory = task.update_history || [];
                const comments = task.comments || [];
                // 计算改动数量（排除comment类型的记录，因为评论单独计算）
                const updateCount = updateHistory.filter(r => r.field !== 'comment').length;
                const commentCount = comments.length;
                
                state.flatTasks.push({
                    ...task,
                    project_id: project.id,
                    project_name: project.name,
                    project_color: project.color || '#4facfe',
                    project_archived: isProjectArchived(project),
                    index: taskIndex + 1,
                    change_count: updateCount + commentCount,
                    update_count: updateCount,
                    comment_count: commentCount,
                });
            });
        });
    }

    function applyTableFilters() {
        let filtered = [...state.flatTasks];

        // 搜索筛选
        if (state.filters.text && state.filters.text.trim()) {
            const searchLower = state.filters.text.trim().toLowerCase();
            filtered = filtered.filter(task => {
                const fields = [
                    task.project_name,
                    task.summary,
                    task.description,
                ];
                return fields.some(field => field && String(field).toLowerCase().includes(searchLower));
            });
        }

        // 列筛选
        if (state.tableFilter.column) {
            filtered = filtered.filter(task => {
                if (state.tableFilter.column === 'project_name') {
                    if (state.tableFilter.value === null) return true;
                    return task.project_id === state.tableFilter.value;
                } else if (state.tableFilter.column === 'created_at') {
                    if (!task.created_at) return false;
                    const taskDate = new Date(task.created_at);
                    taskDate.setHours(0, 0, 0, 0);
                    
                    if (state.tableFilter.startDate) {
                        const startDate = new Date(state.tableFilter.startDate);
                        startDate.setHours(0, 0, 0, 0);
                        if (taskDate < startDate) return false;
                    }
                    
                    if (state.tableFilter.endDate) {
                        const endDate = new Date(state.tableFilter.endDate);
                        endDate.setHours(23, 59, 59, 999);
                        if (taskDate > endDate) return false;
                    }
                    
                    return true;
                } else if (state.tableFilter.column === 'due_date') {
                    if (!task.due_date) return false;
                    const taskDate = new Date(task.due_date);
                    taskDate.setHours(0, 0, 0, 0);
                    
                    if (state.tableFilter.startDate) {
                        const startDate = new Date(state.tableFilter.startDate);
                        startDate.setHours(0, 0, 0, 0);
                        if (taskDate < startDate) return false;
                    }
                    
                    if (state.tableFilter.endDate) {
                        const endDate = new Date(state.tableFilter.endDate);
                        endDate.setHours(23, 59, 59, 999);
                        if (taskDate > endDate) return false;
                    }
                    
                    return true;
                } else if (state.tableFilter.column === 'updated_at') {
                    if (!task.updated_at) return false;
                    const taskDate = new Date(task.updated_at);
                    taskDate.setHours(0, 0, 0, 0);
                    
                    if (state.tableFilter.startDate) {
                        const startDate = new Date(state.tableFilter.startDate);
                        startDate.setHours(0, 0, 0, 0);
                        if (taskDate < startDate) return false;
                    }
                    
                    if (state.tableFilter.endDate) {
                        const endDate = new Date(state.tableFilter.endDate);
                        endDate.setHours(23, 59, 59, 999);
                        if (taskDate > endDate) return false;
                    }
                    
                    return true;
                } else if (state.tableFilter.column === 'priority') {
                    if (state.tableFilter.value === null) return true;
                    return (task.priority || 3) === parseInt(state.tableFilter.value);
                }
                return true;
            });
        }

        // 排序
        if (state.tableSort.column) {
            filtered.sort((a, b) => {
                let aVal, bVal;
                
                if (state.tableSort.column === 'project_name') {
                    aVal = a.project_name || '';
                    bVal = b.project_name || '';
                } else if (state.tableSort.column === 'created_at') {
                    aVal = a.created_at ? new Date(a.created_at).getTime() : 0;
                    bVal = b.created_at ? new Date(b.created_at).getTime() : 0;
                } else if (state.tableSort.column === 'updated_at') {
                    aVal = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                    bVal = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                } else if (state.tableSort.column === 'due_date') {
                    aVal = a.due_date ? new Date(a.due_date).getTime() : 0;
                    bVal = b.due_date ? new Date(b.due_date).getTime() : 0;
                } else if (state.tableSort.column === 'progress') {
                    aVal = a.progress || 0;
                    bVal = b.progress || 0;
                } else if (state.tableSort.column === 'priority') {
                    aVal = a.priority || 3;
                    bVal = b.priority || 3;
                } else {
                    return 0;
                }

                if (aVal < bVal) return state.tableSort.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return state.tableSort.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }

        state.filteredTasks = filtered;
    }

    function loadTableColumnOrder() {
        const saved = localStorage.getItem('todoTableColumnOrder');
        if (saved) {
            try {
                const savedOrder = JSON.parse(saved);
                state.columns = savedOrder.filter(key => COLUMN_DEFINITIONS[key]);
                Object.keys(COLUMN_DEFINITIONS).forEach(key => {
                    if (!state.columns.includes(key)) {
                        state.columns.push(key);
                    }
                });
            } catch (e) {
                initDefaultTableColumns();
            }
        } else {
            initDefaultTableColumns();
        }
    }

    function initDefaultTableColumns() {
        state.columns = Object.keys(COLUMN_DEFINITIONS).sort((a, b) => {
            return COLUMN_DEFINITIONS[a].order - COLUMN_DEFINITIONS[b].order;
        });
    }

    function saveTableColumnOrder() {
        localStorage.setItem('todoTableColumnOrder', JSON.stringify(state.columns));
    }

    function renderTable() {
        renderTableHead();
        renderTableBody();
    }

    let draggedTableColumn = null;

    function renderTableHead() {
        if (!refs.tableHead) return;

        const thead = refs.tableHead;
        thead.innerHTML = '';

        const tr = document.createElement('tr');
        state.columns.forEach((colKey) => {
            const colDef = COLUMN_DEFINITIONS[colKey];
            if (!colDef) return;

            const th = document.createElement('th');
            th.dataset.columnKey = colKey;
            th.draggable = true;
            
            const canFilter = ['project_name', 'created_at', 'due_date', 'updated_at', 'priority'].includes(colKey);
            const canSort = ['project_name', 'created_at', 'progress', 'priority', 'due_date', 'updated_at'].includes(colKey);
            
            let filterSortIcons = '';
            if (canFilter || canSort) {
                let icons = [];
                if (canFilter) {
                    const isFiltered = state.tableFilter.column === colKey;
                    icons.push(`<i class="fas fa-filter filter-icon ${isFiltered ? 'active' : ''}" data-action="filter" title="筛选"></i>`);
                }
                if (canSort) {
                    let sortIcon = 'fa-sort';
                    if (state.tableSort.column === colKey) {
                        sortIcon = state.tableSort.direction === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
                    }
                    icons.push(`<i class="fas ${sortIcon} sort-icon ${state.tableSort.column === colKey ? 'active' : ''}" data-action="sort" title="排序"></i>`);
                }
                filterSortIcons = `<span class="filter-sort-icons">${icons.join('')}</span>`;
            }
            
            th.innerHTML = `
                <i class="fas fa-grip-vertical drag-handle"></i>
                <span class="column-label">${escapeHtml(colDef.label)}</span>
                ${filterSortIcons}
            `;

            th.addEventListener('dragstart', (e) => {
                draggedTableColumn = colKey;
                th.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            th.addEventListener('dragend', () => {
                th.classList.remove('dragging');
                document.querySelectorAll('#tableHead th').forEach(h => h.classList.remove('drag-over'));
            });

            th.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggedTableColumn && draggedTableColumn !== colKey) {
                    document.querySelectorAll('#tableHead th').forEach(h => h.classList.remove('drag-over'));
                    th.classList.add('drag-over');
                }
            });

            th.addEventListener('drop', (e) => {
                e.preventDefault();
                if (draggedTableColumn && draggedTableColumn !== colKey) {
                    const oldIndex = state.columns.indexOf(draggedTableColumn);
                    const newIndex = state.columns.indexOf(colKey);
                    state.columns.splice(oldIndex, 1);
                    state.columns.splice(newIndex, 0, draggedTableColumn);
                    saveTableColumnOrder();
                    renderTable();
                }
                document.querySelectorAll('#tableHead th').forEach(h => h.classList.remove('drag-over'));
            });

            th.addEventListener('click', (e) => {
                const target = e.target.closest('[data-action]');
                if (!target) return;
                
                const action = target.dataset.action;
                if (action === 'filter') {
                    handleTableFilterClick(colKey);
                } else if (action === 'sort') {
                    handleTableSortClick(colKey);
                }
            });

            tr.appendChild(th);
        });
        
        // 添加操作列表头
        const actionsTh = document.createElement('th');
        actionsTh.textContent = '操作';
        actionsTh.style.width = '150px';
        actionsTh.style.textAlign = 'center';
        tr.appendChild(actionsTh);

        thead.appendChild(tr);
    }

    function renderTableBody() {
        if (!refs.tableBody) return;

        const tbody = refs.tableBody;
        tbody.innerHTML = '';

        if (state.filteredTasks.length === 0) {
            if (refs.tableEmptyMessage) refs.tableEmptyMessage.style.display = 'block';
            return;
        }

        if (refs.tableEmptyMessage) refs.tableEmptyMessage.style.display = 'none';

        state.filteredTasks.forEach((task, rowIndex) => {
            const tr = document.createElement('tr');
            tr.dataset.taskId = task.id;
            tr.dataset.projectId = task.project_id;

            state.columns.forEach(colKey => {
                const td = document.createElement('td');
                td.setAttribute('data-column', colKey);
                td.innerHTML = getTableCellContent(task, colKey);
                tr.appendChild(td);
            });
            
            // 添加操作列
            const actionsTd = document.createElement('td');
            actionsTd.className = 'task-actions-cell';
            const updateHistory = task.update_history || [];
            const comments = task.comments || [];
            const hasHistory = updateHistory.length > 0 || comments.length > 0;
            actionsTd.innerHTML = `
                <div class="task-actions">
                    <button type="button" class="btn btn-sm btn-outline-primary" data-action="comment-task" data-project-id="${task.project_id}" data-task-id="${task.id}" title="添加评论">
                        <i class="fas fa-comment"></i>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-secondary" data-action="edit-task" data-project-id="${task.project_id}" data-task-id="${task.id}" title="编辑任务">
                        <i class="fas fa-pen"></i>
                    </button>
                    <button type="button" class="btn btn-sm btn-outline-danger" data-action="delete-task" data-project-id="${task.project_id}" data-task-id="${task.id}" title="删除任务">
                        <i class="fas fa-trash"></i>
                    </button>
                    ${hasHistory ? `
                    <button type="button" class="btn btn-sm btn-outline-info" data-action="view-history" data-project-id="${task.project_id}" data-task-id="${task.id}" title="查看改动和评论">
                        <i class="fas fa-list"></i>
                    </button>
                    ` : ''}
                </div>
            `;
            tr.appendChild(actionsTd);

            tbody.appendChild(tr);
        });
        
        // 绑定操作按钮事件
        tbody.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                const projectId = btn.dataset.projectId;
                const taskId = btn.dataset.taskId;
                
                if (action === 'comment-task') {
                    openCommentModal(projectId, taskId);
                } else if (action === 'edit-task') {
                    openEditTaskModal(projectId, taskId);
                } else if (action === 'delete-task') {
                    deleteTask(projectId, taskId);
                } else if (action === 'view-history') {
                    showHistoryModal(taskId);
                }
            });
        });
    }

    function getTableCellContent(task, colKey) {
        switch (colKey) {
            case 'project_name':
                return `<span style="color: ${task.project_color}">${escapeHtml(task.project_name || '--')}</span>${task.project_archived ? ' <span class="project-archived-badge-inline">已归档<\/span>' : ''}`;
            case 'index':
                return String(task.index || '--');
            case 'summary':
                return escapeHtml(task.summary || '--');
            case 'description':
                const desc = task.description || '';
                if (!desc) return '--';
                // 保留换行格式：将换行符转换为<br>标签
                const descWithBreaks = escapeHtml(desc).replace(/\n/g, '<br>');
                // 对于长文本，显示完整内容（换行会自动处理），但添加title提示
                return desc.length > 100 
                    ? `<span title="${escapeHtml(desc)}">${descWithBreaks}</span>`
                    : descWithBreaks;
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
            default:
                return '--';
        }
    }

    function handleTableFilterClick(colKey) {
        if (state.tableFilter.column === colKey) {
            state.tableFilter.column = null;
            state.tableFilter.value = null;
            state.tableFilter.startDate = null;
            state.tableFilter.endDate = null;
            applyTableFilters();
            renderTable();
            return;
        }

        state.tableFilter.column = colKey;
        state.tableFilter.value = null;
        state.tableFilter.startDate = null;
        state.tableFilter.endDate = null;

        const filterPanel = document.getElementById('filterPanel');
        const filterBody = document.getElementById('filterBody');
        
        if (colKey === 'project_name') {
            const projects = [...new Map(state.flatTasks.map(t => [t.project_id, { id: t.project_id, name: t.project_name }])).values()];
            let options = '<option value="">全部项目</option>';
            projects.forEach(project => {
                options += `<option value="${project.id}">${escapeHtml(project.name)}</option>`;
            });
            
            filterBody.innerHTML = `
                <label class="form-label">选择项目：</label>
                <select class="form-select" id="filterProjectSelect">
                    ${options}
                </select>
            `;
        } else if (colKey === 'created_at' || colKey === 'due_date' || colKey === 'updated_at') {
            const labelMap = {
                'created_at': '创建时间',
                'due_date': '预计完成时间',
                'updated_at': '最后更新时间',
            };
            const label = labelMap[colKey] || '时间';
            
            filterBody.innerHTML = `
                <label class="form-label">${label}范围：</label>
                <div class="mb-2">
                    <label class="form-label small">开始时间：</label>
                    <input type="date" class="form-control" id="filterStartDateInput" value="${state.tableFilter.startDate || ''}">
                </div>
                <div>
                    <label class="form-label small">结束时间：</label>
                    <input type="date" class="form-control" id="filterEndDateInput" value="${state.tableFilter.endDate || ''}">
                </div>
                <p class="text-muted small mt-2 mb-0">留空表示不限制该边界</p>
            `;
        } else if (colKey === 'priority') {
            filterBody.innerHTML = `
                <label class="form-label">输入优先级 (1-5)：</label>
                <input type="number" class="form-control" id="filterPriorityInput" min="1" max="5" value="${state.tableFilter.value || ''}">
            `;
        }
        
        const filterOverlay = document.getElementById('filterOverlay');
        filterPanel.style.display = 'block';
        if (filterOverlay) filterOverlay.classList.add('show');
        
        const applyBtn = document.getElementById('applyFilter');
        const clearBtn = document.getElementById('clearFilter');
        const closeBtn = document.getElementById('closeFilterPanel');
        
        const closePanel = () => {
            filterPanel.style.display = 'none';
            if (filterOverlay) filterOverlay.classList.remove('show');
        };
        
        const applyFilter = () => {
            let value = null;
            let startDate = null;
            let endDate = null;
            
            if (colKey === 'project_name') {
                const select = document.getElementById('filterProjectSelect');
                value = select ? select.value : null;
                if (value === '') value = null;
            } else if (colKey === 'created_at' || colKey === 'due_date' || colKey === 'updated_at') {
                const startInput = document.getElementById('filterStartDateInput');
                const endInput = document.getElementById('filterEndDateInput');
                startDate = startInput && startInput.value ? startInput.value : null;
                endDate = endInput && endInput.value ? endInput.value : null;
                
                // 如果开始时间晚于结束时间，提示错误
                if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
                    alert('开始时间不能晚于结束时间');
                    return;
                }
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
            
            state.tableFilter.column = (value !== null || startDate !== null || endDate !== null) ? colKey : null;
            state.tableFilter.value = value;
            state.tableFilter.startDate = startDate;
            state.tableFilter.endDate = endDate;
            closePanel();
            applyTableFilters();
            renderTable();
        };
        
        const clearFilter = () => {
            state.tableFilter.column = null;
            state.tableFilter.value = null;
            state.tableFilter.startDate = null;
            state.tableFilter.endDate = null;
            closePanel();
            applyTableFilters();
            renderTable();
        };
        
        applyBtn.onclick = applyFilter;
        clearBtn.onclick = clearFilter;
        closeBtn.onclick = closePanel;
        if (filterOverlay) {
            filterOverlay.onclick = closePanel;
        }
    }

    function handleTableSortClick(colKey) {
        if (state.tableSort.column === colKey) {
            state.tableSort.direction = state.tableSort.direction === 'asc' ? 'desc' : 'asc';
        } else {
            state.tableSort.column = colKey;
            state.tableSort.direction = 'asc';
        }
        
        applyTableFilters();
        renderTable();
    }

    function showHistoryModal(taskId) {
        const task = state.flatTasks.find(t => t.id === taskId);
        if (!task) return;

        const updateHistory = (task.update_history || []).filter(r => r.field !== 'comment');
        const comments = task.comments || [];
        
        document.getElementById('historyTaskSummary').textContent = task.summary || '--';
        document.getElementById('historyProjectName').textContent = task.project_name || '--';

        const tbody = document.getElementById('historyTableBody');
        tbody.innerHTML = '';

        const allRecords = [];
        updateHistory.forEach(record => {
            allRecords.push({
                type: 'update',
                field: record.field,
                old_value: record.old_value,
                new_value: record.new_value,
                timestamp: record.timestamp,
            });
        });
        comments.forEach(comment => {
            allRecords.push({
                type: 'comment',
                content: comment.content,
                timestamp: comment.timestamp,
            });
        });

        allRecords.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

        if (allRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">暂无记录</td></tr>';
        } else {
            allRecords.forEach((record, index) => {
                const tr = document.createElement('tr');
                tr.dataset.type = record.type;
                const timestamp = record.timestamp || '';
                let formattedTime = '--';
                if (timestamp) {
                    try {
                        formattedTime = formatDateTime(timestamp);
                    } catch (e) {
                        formattedTime = timestamp;
                    }
                }

                if (record.type === 'comment') {
                    tr.innerHTML = `
                        <td>${index + 1}</td>
                        <td><span class="badge bg-primary">评论</span></td>
                        <td>${escapeHtml(formattedTime)}</td>
                        <td>${escapeHtml(record.content || '--')}</td>
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
                    
                    tr.innerHTML = `
                        <td>${index + 1}</td>
                        <td><span class="badge bg-secondary">修改</span></td>
                        <td>${escapeHtml(formattedTime)}</td>
                        <td><strong>${fieldName}</strong>: <span class="text-muted">${oldVal}</span> → <span class="text-primary">${newVal}</span></td>
                    `;
                }
                tbody.appendChild(tr);
            });
        }

        // 绑定筛选按钮
        const filterRadios = document.querySelectorAll('input[name="historyFilter"]');
        filterRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                const filter = radio.value;
                const rows = tbody.querySelectorAll('tr');
                rows.forEach(row => {
                    if (filter === 'all') {
                        row.style.display = '';
                    } else if (filter === 'update' && row.dataset.type === 'update') {
                        row.style.display = '';
                    } else if (filter === 'comment' && row.dataset.type === 'comment') {
                        row.style.display = '';
                    } else {
                        row.style.display = 'none';
                    }
                });
            });
        });

        const modal = new bootstrap.Modal(document.getElementById('historyModal'));
        modal.show();
    }

    // ===== 风格切换 =====

    function updateStyleButtons() {
        // 更新按钮的激活状态
        if (refs.styleScrollBtn) {
            if (state.currentStyle === 'scroll') {
                refs.styleScrollBtn.classList.add('active', 'btn-info');
                refs.styleScrollBtn.classList.remove('btn-outline-info');
            } else {
                refs.styleScrollBtn.classList.remove('active', 'btn-info');
                refs.styleScrollBtn.classList.add('btn-outline-info');
            }
        }
        if (refs.styleTableBtn) {
            if (state.currentStyle === 'table') {
                refs.styleTableBtn.classList.add('active', 'btn-info');
                refs.styleTableBtn.classList.remove('btn-outline-info');
            } else {
                refs.styleTableBtn.classList.remove('active', 'btn-info');
                refs.styleTableBtn.classList.add('btn-outline-info');
            }
        }
        if (refs.styleReportBtn) {
            if (state.currentStyle === 'report') {
                refs.styleReportBtn.classList.add('active', 'btn-info');
                refs.styleReportBtn.classList.remove('btn-outline-info');
            } else {
                refs.styleReportBtn.classList.remove('active', 'btn-info');
                refs.styleReportBtn.classList.add('btn-outline-info');
            }
        }
    }

    function switchStyle(style) {
        state.currentStyle = style;
        localStorage.setItem('todoStyle', style);
        updateStyleButtons();

        // 隐藏所有容器
            if (refs.scrollStyleContainer) {
            refs.scrollStyleContainer.style.display = 'none';
            refs.scrollStyleContainer.classList.remove('active');
            }
            if (refs.tableStyleContainer) {
                refs.tableStyleContainer.style.display = 'none';
                refs.tableStyleContainer.classList.remove('active');
            }
        if (refs.reportStyleContainer) {
            refs.reportStyleContainer.style.display = 'none';
            refs.reportStyleContainer.classList.remove('active');
        }

        // 显示对应的容器
        if (style === 'scroll') {
            if (refs.scrollStyleContainer) {
                refs.scrollStyleContainer.style.display = 'block';
                refs.scrollStyleContainer.classList.add('active');
            }
            // 显示待完成概览
            const pendingSection = document.querySelector('.pending-overview-section');
            if (pendingSection) {
                pendingSection.style.display = '';
            }
        } else if (style === 'table') {
            if (refs.tableStyleContainer) {
                refs.tableStyleContainer.style.display = 'block';
                refs.tableStyleContainer.classList.add('active');
            }
            // 显示待完成概览
            const pendingSection = document.querySelector('.pending-overview-section');
            if (pendingSection) {
                pendingSection.style.display = '';
            }
            // 只有在数据已加载时才初始化表格
            if (state.projects && state.projects.length >= 0) {
                flattenTasks();
                loadTableColumnOrder();
                applyTableFilters();
                renderTable();
            }
        } else if (style === 'report') {
            if (refs.reportStyleContainer) {
                refs.reportStyleContainer.style.display = 'block';
                refs.reportStyleContainer.classList.add('active');
            }
            // 隐藏待完成概览
            const pendingSection = document.querySelector('.pending-overview-section');
            if (pendingSection) {
                pendingSection.style.display = 'none';
            }
            // 渲染汇报表格
            if (state.projects && state.projects.length >= 0) {
                renderReportTable();
            }
        }
        updateReportHeaderActionsVisibility();
    }

    // ===== 汇报表格渲染 =====
    
    function renderReportTable() {
        if (!refs.reportTableBody) return;

        const projectBlocks = getReportProjectBlocks();

        if (projectBlocks.length === 0) {
            refs.reportTableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">暂无汇报数据</td></tr>';
            if (refs.reportEmptyMessage) {
                refs.reportEmptyMessage.style.display = 'block';
            }
            return;
        }
        
        if (refs.reportEmptyMessage) {
            refs.reportEmptyMessage.style.display = 'none';
        }
        
        let html = '';
        
        projectBlocks.forEach(({ project, tasks: reportTasks }) => {
            // 项目名称单元格的行数
            const rowspan = reportTasks.length;
            const projectName = project.name || '未命名项目';
            const projectPhase = project.phase || '';
            
            reportTasks.forEach((task, index) => {
                const isFirstRow = index === 0;
                const serialNumber = index + 1; // 序号
                const summary = escapeHtml(task.summary || '');
                const description = formatMultilineHtml(task.description || '');
                const isCompleted = (task.progress || 0) >= 100;
                const status = isCompleted ? '已完成' : '未完成';
                
                // 当前进展
                let currentProgress = '';
                if (isCompleted) {
                    // 已完成：显示结论（没有结论显示所有评论）
                    if (task.conclusion) {
                        currentProgress = formatMultilineHtml(task.conclusion);
                    } else {
                        const comments = task.comments || [];
                        if (comments.length > 0) {
                            currentProgress = '<ul>' + comments.map(c => `<li>${escapeHtml(c.content)}</li>`).join('') + '</ul>';
                        } else {
                            currentProgress = '已完成';
                        }
                    }
                } else {
                    // 未完成：显示所有评论（没有评论显示"进行中"）
                    const comments = task.comments || [];
                    if (comments.length > 0) {
                        currentProgress = '<ul>' + comments.map(c => `<li>${escapeHtml(c.content)}</li>`).join('') + '</ul>';
                    } else {
                        currentProgress = '进行中';
                    }
                }
                
                // 本周计划（显示weekly_plan属性）
                const weeklyPlan = formatMultilineHtml(task.weekly_plan || '');
                
                html += '<tr class="report-row" data-project-id="' + escapeHtml(project.id) + '" data-task-id="' + escapeHtml(task.id) + '">';
                
                // 项目名称（只在第一行显示，需要合并单元格）
                if (isFirstRow) {
                    html += '<td rowspan="' + rowspan + '" class="report-project-name" style="text-align: center; vertical-align: middle;">';
                    html += '<strong>' + escapeHtml(projectName) + '</strong>';
                    if (isProjectArchived(project)) {
                        html += '<br><span class="project-archived-badge-inline">已归档<\/span>';
                    }
                    if (projectPhase) {
                        html += '<br><span style="color: #666; font-size: 0.9em;">(' + escapeHtml(projectPhase) + ')</span>';
                    }
                    html += '</td>';
                }
                
                html += '<td class="report-serial">' + serialNumber + '</td>';
                html += '<td class="report-summary">' + summary + '</td>';
                html += '<td class="report-description">' + description + '</td>';
                html += '<td class="report-status">' + status + '</td>';
                html += '<td class="report-progress">' + currentProgress + '</td>';
                html += '<td class="report-weekly-plan">' + weeklyPlan + '</td>';
                html += '</tr>';
            });
        });

        if (!html) {
            refs.reportTableBody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">暂无汇报数据</td></tr>';
            if (refs.reportEmptyMessage) {
                refs.reportEmptyMessage.style.display = 'block';
            }
            return;
        }
        
        refs.reportTableBody.innerHTML = html;
        
        // 绑定行点击事件（高亮显示）
        refs.reportTableBody.querySelectorAll('.report-row').forEach(row => {
            row.addEventListener('click', function() {
                // 移除其他行的选中状态
                refs.reportTableBody.querySelectorAll('.report-row').forEach(r => {
                    r.classList.remove('selected');
                });
                // 添加当前行的选中状态
                this.classList.add('selected');
            });
        });

        refs.reportTableBody.querySelectorAll('.report-project-name').forEach(cell => {
            cell.setAttribute('title', '右键：关闭该项目的「显示在汇报页」');
            cell.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const tr = cell.closest('tr');
                const pid = tr && tr.getAttribute('data-project-id');
                if (!pid) return;
                if (!confirm('确定关闭该项目的「显示在汇报页」吗？\n\n将保存到数据文件，之后可在「编辑项目」中重新勾选。')) {
                    return;
                }
                updateProject(pid, { show_in_report: false }).catch(() => {});
            });
        });
        refs.reportTableBody.querySelectorAll('.report-summary').forEach(cell => {
            cell.setAttribute('title', '右键：关闭该任务的「显示在汇报页」');
            cell.addEventListener('contextmenu', function (e) {
                e.preventDefault();
                e.stopPropagation();
                const tr = cell.closest('tr');
                const pid = tr && tr.getAttribute('data-project-id');
                const tid = tr && tr.getAttribute('data-task-id');
                if (!pid || !tid) return;
                if (!confirm('确定关闭该任务的「显示在汇报页」吗？\n\n将保存到数据文件，之后可在「编辑任务」中重新勾选。')) {
                    return;
                }
                updateTask(pid, tid, { show_in_report: false }).catch(() => {});
            });
        });
        
        // 初始化列宽调整功能
        initReportTableResize();
        
        // 自动调整列宽
        autoResizeReportTableColumns();
    }
    
    function initReportTableResize() {
        const table = refs.reportTable;
        if (!table) return;
        
        const headers = table.querySelectorAll('thead th');
        let isResizing = false;
        let currentHeader = null;
        let startX = 0;
        let startWidth = 0;
        
        headers.forEach((header, index) => {
            if (index === headers.length - 1) return; // 最后一列不添加调整功能
            
            header.addEventListener('mousedown', (e) => {
                // 检查是否点击在调整区域
                const rect = header.getBoundingClientRect();
                const resizeArea = rect.right - 5;
                
                if (e.clientX >= resizeArea) {
                    isResizing = true;
                    currentHeader = header;
                    startX = e.clientX;
                    startWidth = header.offsetWidth;
                    
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                    
                    e.preventDefault();
                    e.stopPropagation();
                }
            });
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isResizing || !currentHeader) return;
            
            const diff = e.clientX - startX;
            const newWidth = Math.max(50, startWidth + diff); // 最小宽度50px
            currentHeader.style.width = newWidth + 'px';
            currentHeader.style.minWidth = newWidth + 'px';
            
            // 同步调整同一列的所有单元格
            const colIndex = Array.from(currentHeader.parentElement.children).indexOf(currentHeader);
            const table = currentHeader.closest('table');
            if (table) {
                table.querySelectorAll(`tbody td:nth-child(${colIndex + 1})`).forEach(cell => {
                    cell.style.width = newWidth + 'px';
                    cell.style.minWidth = newWidth + 'px';
                });
            }
        });
        
        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                currentHeader = null;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        });
    }
    
    function autoResizeReportTableColumns() {
        const table = refs.reportTable;
        if (!table) return;
        
        // 设置表格为自动布局以计算内容宽度
        table.style.tableLayout = 'auto';
        
        // 等待一帧以确保DOM已渲染
        requestAnimationFrame(() => {
            const headers = table.querySelectorAll('thead th');
            const firstRow = table.querySelector('tbody tr');
            
            if (!firstRow) return;
            
            headers.forEach((header, index) => {
                const colIndex = index + 1;
                const cells = table.querySelectorAll(`tbody td:nth-child(${colIndex})`);
                
                if (cells.length === 0) return;
                
                // 计算内容的最大宽度
                let maxWidth = header.scrollWidth;
                cells.forEach(cell => {
                    const cellWidth = cell.scrollWidth;
                    if (cellWidth > maxWidth) {
                        maxWidth = cellWidth;
                    }
                });
                
                // 设置最小宽度（但不超过屏幕宽度的30%）
                const minWidth = Math.min(maxWidth + 20, window.innerWidth * 0.3);
                header.style.minWidth = minWidth + 'px';
                cells.forEach(cell => {
                    cell.style.minWidth = minWidth + 'px';
                });
            });
            
            // 恢复为固定布局以提高性能
            table.style.tableLayout = 'fixed';
        });
    }
    
    function exportReportToExcel() {
        // 调用后端API导出汇报表格
        try {
            const projectBlocks = getReportProjectBlocks();
            if (projectBlocks.length === 0) {
                showAlert('warning', '暂无汇报数据可导出');
                return;
            }
            
            // 构建扁平化的任务列表（用于导出）
            const flatTasks = [];
            projectBlocks.forEach(({ project, tasks: reportTasks }) => {
                reportTasks.forEach((task, index) => {
                    // 构建当前进展内容
                    let currentProgress = '';
                    const isCompleted = (task.progress || 0) >= 100;
                    if (isCompleted) {
                        if (task.conclusion) {
                            currentProgress = task.conclusion;
                        } else {
                            const comments = task.comments || [];
                            if (comments.length > 0) {
                                currentProgress = comments.map(c => c.content).join('\n');
                            } else {
                                currentProgress = '已完成';
                            }
                        }
                    } else {
                        const comments = task.comments || [];
                        if (comments.length > 0) {
                            currentProgress = comments.map(c => c.content).join('\n');
                        } else {
                            currentProgress = '进行中';
                        }
                    }
                    
                    flatTasks.push({
                        ...task,
                        project_id: project.id,
                        project_name: project.name || '未命名项目',
                        project_phase: project.phase || '',
                        project_color: project.color || '#4facfe',
                        index: index + 1, // 序号
                        current_progress: currentProgress,
                        weekly_plan: task.weekly_plan || '',
                        status: isCompleted ? '已完成' : '未完成'
                    });
                });
            });
            
            if (flatTasks.length === 0) {
                showAlert('warning', '暂无汇报数据可导出');
                return;
            }
            
            // 获取当前表格的列宽
            const columnWidths = {};
            const table = refs.reportTable;
            if (table) {
                const headers = table.querySelectorAll('thead th');
                headers.forEach((header, index) => {
                    const colLetter = String.fromCharCode(65 + index); // A, B, C, ...
                    // 获取实际渲染的宽度（像素）
                    const widthPx = header.offsetWidth;
                    if (widthPx && widthPx > 0) {
                        // 将像素转换为Excel列宽单位
                        // Excel列宽单位：1单位 ≈ 7.4像素（根据字体大小调整）
                        // 为了稍微宽一些，使用 1单位 ≈ 7像素
                        const excelWidth = widthPx / 7;
                        columnWidths[colLetter] = Math.max(8, Math.min(excelWidth, 60)); // 限制在8-60之间
                    }
                });
            }
            
            // 调用导出API
            const url = '/api/todo/v2/export/report';
            fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tasks: flatTasks,
                    columnWidths: columnWidths, // 传递列宽信息
                    fileName: `汇报表格_${new Date().toISOString().split('T')[0]}.xlsx`
                })
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => { throw new Error(err.error || '导出失败'); });
                }
                return response.blob();
            })
            .then(blob => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `汇报表格_${new Date().toISOString().split('T')[0]}.xlsx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                showAlert('success', 'Excel文件导出成功！');
            })
            .catch(error => {
                showAlert('danger', '导出失败：' + (error.message || String(error)));
            });
        } catch (error) {
            showAlert('danger', '导出失败：' + (error.message || String(error)));
        }
    }
    
    function toggleReportFullscreen() {
        const container = refs.reportStyleContainer;
        if (!container) return;
        
        if (!document.fullscreenElement) {
            // 进入全屏
            if (container.requestFullscreen) {
                container.requestFullscreen();
            } else if (container.webkitRequestFullscreen) {
                container.webkitRequestFullscreen();
            } else if (container.mozRequestFullScreen) {
                container.mozRequestFullScreen();
            } else if (container.msRequestFullscreen) {
                container.msRequestFullscreen();
            }
        } else {
            // 退出全屏
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    }

    // ===== 会议记录（笔记）功能 =====
    
    let noteEditor = null;
    let noteOriginalContent = '';
    let currentNoteDate = null;
    let noteList = [];
    let filteredNoteList = [];
    let noteSearchKeyword = '';
    let noteSortMode = 'date_desc';

    // 打开笔记模态框
    function openMeetingNoteModal() {
        const modalElement = document.getElementById('meetingNoteModal');
        if (!modalElement) {
            console.error('找不到笔记模态框元素');
            return;
        }

        // 检查Bootstrap是否可用
        if (typeof bootstrap === 'undefined' || !bootstrap.Modal) {
            console.error('Bootstrap未加载');
            // 尝试使用jQuery Bootstrap（如果存在）
            if (typeof $ !== 'undefined' && $.fn.modal) {
                $('#meetingNoteModal').modal('show');
                resetNoteModal();
                loadNoteList();
                const today = new Date().toISOString().split('T')[0];
                document.getElementById('noteDateInput').value = today;
                currentNoteDate = today;
                loadNoteByDate(today);
                bindNoteEvents();
                return;
            } else {
                showAlert('danger', 'Bootstrap未正确加载，请刷新页面');
                return;
            }
        }

        let modal = bootstrap.Modal.getInstance(modalElement);
        if (!modal) {
            try {
                modal = new bootstrap.Modal(modalElement, {
                    backdrop: true,
                    keyboard: true,
                    focus: true
                });
            } catch (e) {
                console.error('创建Bootstrap Modal失败:', e);
                showAlert('danger', '无法打开笔记窗口：' + e.message);
                return;
            }
        }

        // 重置状态
        resetNoteModal();
        
        // 加载笔记列表
        loadNoteList();
        
        // 设置今天的日期为默认日期
        const today = new Date().toISOString().split('T')[0];
        const dateInput = document.getElementById('noteDateInput');
        if (dateInput) {
            dateInput.value = today;
        }
        currentNoteDate = today;
        
        // 尝试加载今天的笔记
        loadNoteByDate(today);
        
        // 绑定事件
        bindNoteEvents();
        
        try {
            modal.show();
        } catch (e) {
            console.error('显示Modal失败:', e);
            showAlert('danger', '无法打开笔记窗口：' + e.message);
        }
    }

    // 重置笔记模态框
    function resetNoteModal() {
        cleanupNoteEditor();
        currentNoteDate = null;
        noteOriginalContent = '';
        const previewMode = document.getElementById('notePreviewMode');
        const editMode = document.getElementById('noteEditMode');
        const footer = document.getElementById('noteModalFooter');
        
        if (previewMode) previewMode.style.display = 'flex';
        if (editMode) editMode.style.display = 'none';
        if (footer) footer.innerHTML = '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">关闭</button>';
    }

    // 清理笔记编辑器
    function cleanupNoteEditor() {
        if (noteEditor) {
            try {
                const wrapper = noteEditor.getWrapperElement();
                if (wrapper && wrapper.parentNode) {
                    wrapper.parentNode.removeChild(wrapper);
                }
            } catch (e) {
                console.warn('清理笔记编辑器失败:', e);
            }
            noteEditor = null;
        }
        
        const editorContainer = document.getElementById('noteEditorContainer');
        if (editorContainer) {
            const codeMirrorElements = editorContainer.querySelectorAll('.CodeMirror, .CodeMirror-scroll, .CodeMirror-sizer');
            codeMirrorElements.forEach(el => {
                try {
                    el.remove();
                } catch (e) {
                    // 忽略错误
                }
            });
            editorContainer.innerHTML = '';
        }
    }

    // 加载笔记列表
    function loadNoteList() {
        fetch('/api/todo/v2/meeting_notes')
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    noteList = result.notes || [];
                    applyNoteFilterAndSort();
                }
            })
            .catch(error => {
                console.error('加载笔记列表失败:', error);
            });
    }

    // 应用筛选和排序
    function applyNoteFilterAndSort() {
        if (!noteSearchKeyword) {
            // 没有搜索关键词，显示所有笔记
            filteredNoteList = [...noteList];
            applyNoteSort();
            renderNoteList();
            return;
        }

        // 有搜索关键词，先搜索日期匹配的
        const dateMatched = noteList.filter(note => {
            return note.date && note.date.includes(noteSearchKeyword);
        });

        // 然后搜索内容匹配的（异步）
        searchNotesByContent(noteSearchKeyword).then(contentMatchedDates => {
            // 合并日期匹配和内容匹配的结果
            const allMatchedDates = new Set();
            
            // 添加日期匹配的
            dateMatched.forEach(note => allMatchedDates.add(note.date));
            
            // 添加内容匹配的
            contentMatchedDates.forEach(date => allMatchedDates.add(date));
            
            // 筛选出匹配的笔记
            filteredNoteList = noteList.filter(note => allMatchedDates.has(note.date));
            
            // 在笔记对象中标记是否内容匹配（用于显示）
            filteredNoteList.forEach(note => {
                note.contentMatched = contentMatchedDates.includes(note.date);
            });
            
            applyNoteSort();
            renderNoteList();
        });
    }

    // 搜索笔记内容
    async function searchNotesByContent(keyword) {
        if (!keyword || !keyword.trim()) {
            return [];
        }

        const matchingDates = [];
        const keywordLower = keyword.toLowerCase().trim();
        
        // 并行加载所有笔记内容并搜索
        const searchPromises = noteList.map(note => {
            return fetch(`/api/todo/v2/meeting_notes/${note.date}`)
                .then(response => {
                    if (!response.ok) {
                        return null;
                    }
                    return response.json();
                })
                .then(result => {
                    if (result && result.success && result.content) {
                        const content = result.content.toLowerCase();
                        if (content.includes(keywordLower)) {
                            matchingDates.push(note.date);
                        }
                    }
                    return null;
                })
                .catch(error => {
                    console.warn(`搜索笔记 ${note.date} 失败:`, error);
                    return null;
                });
        });
        
        await Promise.all(searchPromises);
        return matchingDates;
    }

    // 应用排序
    function applyNoteSort() {
        filteredNoteList.sort((a, b) => {
            switch (noteSortMode) {
                case 'date_asc':
                    return a.date.localeCompare(b.date);
                case 'date_desc':
                    return b.date.localeCompare(a.date);
                case 'update_asc':
                    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                    return aTime - bTime;
                case 'update_desc':
                    const aTime2 = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                    const bTime2 = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                    return bTime2 - aTime2;
                default:
                    return b.date.localeCompare(a.date);
            }
        });
    }

    // 渲染笔记列表
    function renderNoteList() {
        const container = document.getElementById('noteListContainer');
        if (!container) return;

        if (filteredNoteList.length === 0) {
            if (noteSearchKeyword) {
                container.innerHTML = '<p class="text-muted small">未找到匹配的笔记</p>';
            } else {
                container.innerHTML = '<p class="text-muted small">暂无笔记</p>';
            }
            return;
        }

        let html = '<div class="list-group">';
        filteredNoteList.forEach(note => {
            const date = note.date;
            const dateObj = new Date(date + 'T00:00:00');
            const dateStr = dateObj.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
            const isActive = date === currentNoteDate;
            const isDateMatched = noteSearchKeyword && date.includes(noteSearchKeyword);
            const isContentMatched = note.contentMatched === true;
            const isMatched = isDateMatched || isContentMatched;
            
            html += `
                <div class="list-group-item list-group-item-action ${isActive ? 'active' : ''} ${isMatched ? 'border-primary border-2' : ''}" 
                     data-date="${date}" 
                     style="cursor: pointer; ${isActive ? 'background-color: var(--t-primary-faint);' : ''}">
                    <div class="d-flex justify-content-between align-items-center">
                        <div style="flex: 1;">
                            <strong>${dateStr}</strong>
                            <br>
                            <small class="text-muted">${note.updated_at ? new Date(note.updated_at).toLocaleString('zh-CN') : ''}</small>
                            ${isMatched ? `<br><small class="text-primary"><i class="fas fa-check-circle"></i> ${isContentMatched ? '内容匹配' : '日期匹配'}</small>` : ''}
                        </div>
                        <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteNote('${date}', event)" title="删除">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        container.innerHTML = html;

        // 绑定点击事件
        container.querySelectorAll('.list-group-item').forEach(item => {
            item.addEventListener('click', function(e) {
                if (e.target.closest('.btn')) return; // 忽略删除按钮的点击
                const date = this.dataset.date;
                currentNoteDate = date;
                document.getElementById('noteDateInput').value = date;
                loadNoteByDate(date);
                renderNoteList(); // 重新渲染以更新active状态
            });
        });

        // 如果有匹配的笔记且当前没有选中，自动选中第一个匹配的
        if (noteSearchKeyword && filteredNoteList.length > 0 && !currentNoteDate) {
            const firstMatched = filteredNoteList[0];
            if (firstMatched) {
                currentNoteDate = firstMatched.date;
                document.getElementById('noteDateInput').value = firstMatched.date;
                loadNoteByDate(firstMatched.date);
                renderNoteList();
            }
        }
    }

    // 加载指定日期的笔记
    function loadNoteByDate(dateStr) {
        fetch(`/api/todo/v2/meeting_notes/${dateStr}`)
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    noteOriginalContent = result.content || '';
                    updateNotePreview(noteOriginalContent);
                } else {
                    // 笔记不存在，显示空内容
                    noteOriginalContent = '';
                    updateNotePreview('');
                }
            })
            .catch(error => {
                console.error('加载笔记失败:', error);
                noteOriginalContent = '';
                updateNotePreview('');
            });
    }

    // 更新笔记预览
    function updateNotePreview(content) {
        const previewDiv = document.getElementById('notePreview');
        if (!previewDiv) return;

        if (!content || !content.trim()) {
            previewDiv.innerHTML = '<p class="text-muted">暂无内容</p>';
            return;
        }

        if (typeof marked !== 'undefined') {
            try {
                if (marked.setOptions) {
                    marked.setOptions({
                        breaks: true,
                        gfm: true,
                        headerIds: false,
                        mangle: false
                    });
                }
                const html = marked.parse(content);
                previewDiv.innerHTML = html;
            } catch (error) {
                console.error('Markdown渲染失败:', error);
                previewDiv.innerHTML = '<p class="text-danger">预览渲染失败</p>';
            }
        } else {
            // 使用后端API
            fetch(`/api/todo/v2/meeting_notes/${currentNoteDate}/preview`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: content })
            })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    previewDiv.innerHTML = result.html;
                } else {
                    previewDiv.innerHTML = '<p class="text-danger">预览失败：' + (result.error || '未知错误') + '</p>';
                }
            })
            .catch(error => {
                previewDiv.innerHTML = '<p class="text-danger">预览失败：' + error.message + '</p>';
            });
        }
    }

    // 切换到编辑模式
    function switchToNoteEditMode() {
        const previewMode = document.getElementById('notePreviewMode');
        const editMode = document.getElementById('noteEditMode');
        const editorContainer = document.getElementById('noteEditorContainer');
        const footer = document.getElementById('noteModalFooter');

        if (!previewMode || !editMode || !editorContainer || !footer) {
            console.error('切换编辑模式失败：找不到必要的DOM元素');
            return;
        }

        if (noteEditor) {
            cleanupNoteEditor();
        }

        previewMode.style.display = 'none';
        editMode.style.display = 'flex';
        footer.innerHTML = `
            <button type="button" class="btn btn-secondary" id="cancelNoteEditBtn">放弃更改</button>
            <button type="button" class="btn btn-primary" id="saveNoteBtn">保存</button>
        `;

        editorContainer.innerHTML = '';
        const containerDiv = document.createElement('div');
        containerDiv.id = 'noteCodeMirrorContainer';
        containerDiv.style.width = '100%';
        containerDiv.style.height = '100%';
        containerDiv.style.minHeight = '300px';
        editorContainer.appendChild(containerDiv);

        const initEditor = () => {
            if (typeof CodeMirror === 'undefined') {
                showAlert('danger', '代码编辑器未加载，请刷新页面重试');
                return;
            }

            if (editMode.style.display === 'none') {
                return;
            }

            const container = document.getElementById('noteCodeMirrorContainer');
            if (!container || !container.parentNode) {
                return;
            }

            if (noteEditor) {
                cleanupNoteEditor();
            }

            if (container.querySelector('.CodeMirror')) {
                container.innerHTML = '';
            }

            try {
                noteEditor = CodeMirror(container, {
                    value: noteOriginalContent || '',
                    mode: 'markdown',
                    theme: 'monokai',
                    lineNumbers: true,
                    lineWrapping: true,
                    indentUnit: 2,
                    tabSize: 2,
                    autofocus: true,
                    viewportMargin: Infinity
                });

                const updateSize = () => {
                    if (!noteEditor || editMode.style.display === 'none') return;
                    const modalBody = editorContainer.closest('.modal-body');
                    if (modalBody) {
                        const modalBodyHeight = modalBody.offsetHeight;
                        const footerHeight = 60;
                        const availableHeight = modalBodyHeight - footerHeight - 100;
                        noteEditor.setSize('100%', Math.max(availableHeight, 300) + 'px');
                    } else {
                        noteEditor.setSize('100%', '400px');
                    }
                };

                updateSize();
                window.addEventListener('resize', updateSize);

                const livePreviewDiv = document.getElementById('noteLivePreview');
                let previewUpdateTimer = null;

                const updateLivePreview = (markdownText) => {
                    if (typeof marked === 'undefined') {
                        fetch(`/api/todo/v2/meeting_notes/${currentNoteDate}/preview`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ content: markdownText })
                        })
                        .then(response => response.json())
                        .then(result => {
                            if (result.success && livePreviewDiv) {
                                livePreviewDiv.innerHTML = result.html;
                            }
                        })
                        .catch(error => {
                            if (livePreviewDiv) {
                                livePreviewDiv.innerHTML = '<p class="text-danger">预览更新失败</p>';
                            }
                        });
                        return;
                    }

                    try {
                        if (livePreviewDiv) {
                            if (!markdownText || !markdownText.trim()) {
                                livePreviewDiv.innerHTML = '<p class="text-muted">暂无内容</p>';
                            } else {
                                if (marked.setOptions) {
                                    marked.setOptions({
                                        breaks: true,
                                        gfm: true,
                                        headerIds: false,
                                        mangle: false
                                    });
                                }
                                const html = marked.parse(markdownText);
                                livePreviewDiv.innerHTML = html;
                            }
                        }
                    } catch (error) {
                        console.error('Markdown渲染失败:', error);
                        if (livePreviewDiv) {
                            livePreviewDiv.innerHTML = '<p class="text-danger">预览渲染失败</p>';
                        }
                    }
                };

                updateLivePreview(noteOriginalContent);

                noteEditor.on('change', function() {
                    clearTimeout(previewUpdateTimer);
                    previewUpdateTimer = setTimeout(() => {
                        const content = noteEditor.getValue();
                        updateLivePreview(content);
                    }, 300);
                });

                setTimeout(() => {
                    noteEditor.refresh();
                }, 100);
            } catch (error) {
                console.error('初始化笔记编辑器失败:', error);
                showAlert('danger', '初始化编辑器失败：' + error.message);
            }
        };

        const modalElement = document.getElementById('meetingNoteModal');
        if (modalElement) {
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal && modal._isShown) {
                initEditor();
            } else {
                modalElement.addEventListener('shown.bs.modal', initEditor, { once: true });
            }
        } else {
            setTimeout(initEditor, 100);
        }

        // 绑定保存和取消按钮
        setTimeout(() => {
            const saveBtn = document.getElementById('saveNoteBtn');
            const cancelBtn = document.getElementById('cancelNoteEditBtn');
            if (saveBtn) {
                saveBtn.onclick = saveNote;
            }
            if (cancelBtn) {
                cancelBtn.onclick = cancelNoteEdit;
            }
        }, 100);
    }

    // 保存笔记
    function saveNote() {
        if (!currentNoteDate) {
            const dateInput = document.getElementById('noteDateInput');
            if (dateInput && dateInput.value) {
                currentNoteDate = dateInput.value;
            } else {
                showAlert('warning', '请选择日期');
                return;
            }
        }

        const content = noteEditor ? noteEditor.getValue() : '';
        
        fetch('/api/todo/v2/meeting_notes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date: currentNoteDate,
                content: content
            })
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                noteOriginalContent = content;
                showAlert('success', '笔记保存成功');
                loadNoteList(); // 刷新列表
                cancelNoteEdit(); // 退出编辑模式
            } else {
                showAlert('danger', '保存失败：' + (result.error || '未知错误'));
            }
        })
        .catch(error => {
            console.error('保存笔记失败:', error);
            showAlert('danger', '保存失败：' + error.message);
        });
    }

    // 取消编辑
    function cancelNoteEdit() {
        const previewMode = document.getElementById('notePreviewMode');
        const editMode = document.getElementById('noteEditMode');
        const footer = document.getElementById('noteModalFooter');

        cleanupNoteEditor();
        
        previewMode.style.display = 'flex';
        editMode.style.display = 'none';
        footer.innerHTML = '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">关闭</button>';

        // 恢复原始内容
        updateNotePreview(noteOriginalContent);
    }

    // 删除笔记
    function deleteNote(dateStr, event) {
        if (event) {
            event.stopPropagation();
        }

        if (!confirm(`确定要删除 ${dateStr} 的笔记吗？`)) {
            return;
        }

        fetch(`/api/todo/v2/meeting_notes/${dateStr}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                showAlert('success', '笔记已删除');
                if (currentNoteDate === dateStr) {
                    currentNoteDate = null;
                    noteOriginalContent = '';
                    updateNotePreview('');
                }
                loadNoteList();
            } else {
                showAlert('danger', '删除失败：' + (result.error || '未知错误'));
            }
        })
        .catch(error => {
            console.error('删除笔记失败:', error);
            showAlert('danger', '删除失败：' + error.message);
        });
    }

    // 绑定笔记相关事件
    function bindNoteEvents() {
        // 新建笔记按钮
        const newNoteBtn = document.getElementById('newNoteBtn');
        if (newNoteBtn) {
            newNoteBtn.onclick = function() {
                const today = new Date().toISOString().split('T')[0];
                document.getElementById('noteDateInput').value = today;
                currentNoteDate = today;
                noteOriginalContent = '';
                updateNotePreview('');
                switchToNoteEditMode();
            };
        }

        // 编辑按钮
        const editNoteBtn = document.getElementById('editNoteBtn');
        if (editNoteBtn) {
            editNoteBtn.onclick = switchToNoteEditMode;
        }

        // 日期输入框变化
        const dateInput = document.getElementById('noteDateInput');
        if (dateInput) {
            dateInput.onchange = function() {
                const dateStr = this.value;
                if (dateStr) {
                    currentNoteDate = dateStr;
                    loadNoteByDate(dateStr);
                }
            };
        }

        // 搜索输入框
        const searchInput = document.getElementById('noteSearchInput');
        const searchBtn = document.getElementById('noteSearchBtn');
        const clearSearchBtn = document.getElementById('noteClearSearchBtn');
        
        if (searchInput) {
            searchInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    performNoteSearch();
                }
            });
        }
        
        if (searchBtn) {
            searchBtn.onclick = performNoteSearch;
        }
        
        if (clearSearchBtn) {
            clearSearchBtn.onclick = function() {
                noteSearchKeyword = '';
                document.getElementById('noteSearchInput').value = '';
                clearSearchBtn.style.display = 'none';
                applyNoteFilterAndSort();
            };
        }

        // 排序选择框
        const sortSelect = document.getElementById('noteSortSelect');
        if (sortSelect) {
            sortSelect.value = noteSortMode;
            sortSelect.onchange = function() {
                noteSortMode = this.value;
                applyNoteFilterAndSort();
            };
        }
    }

    // 执行笔记搜索
    function performNoteSearch() {
        const searchInput = document.getElementById('noteSearchInput');
        const clearSearchBtn = document.getElementById('noteClearSearchBtn');
        
        if (searchInput) {
            noteSearchKeyword = searchInput.value.trim();
            if (noteSearchKeyword) {
                clearSearchBtn.style.display = 'block';
                applyNoteFilterAndSort();
            } else {
                clearSearchBtn.style.display = 'none';
                applyNoteFilterAndSort();
            }
        }
    }

    // 将deleteNote暴露到全局作用域
    window.deleteNote = deleteNote;

    // ===== 日报 / 周报 =====

    let currentTodoReportType = 'daily';
    let currentTodoReportKey = null;
    let currentTodoReport = null;
    let todoReportEventsBound = false;

    function getTodoReportRefs() {
        return {
            modal: document.getElementById('todoReportModal'),
            typeSelect: document.getElementById('todoReportTypeSelect'),
            dateInput: document.getElementById('todoReportDateInput'),
            generateBtn: document.getElementById('generateTodoReportBtn'),
            refreshBtn: document.getElementById('refreshTodoReportListBtn'),
            listContainer: document.getElementById('todoReportListContainer'),
            title: document.getElementById('todoReportCurrentTitle'),
            meta: document.getElementById('todoReportCurrentMeta'),
            contentInput: document.getElementById('todoReportContentInput'),
            preview: document.getElementById('todoReportPreview'),
            sourceSummary: document.getElementById('todoReportSourceSummary'),
            saveBtn: document.getElementById('saveTodoReportBtn'),
            deleteBtn: document.getElementById('deleteTodoReportBtn'),
        };
    }

    function getLocalDateValue(dateValue = new Date()) {
        const year = dateValue.getFullYear();
        const month = String(dateValue.getMonth() + 1).padStart(2, '0');
        const day = String(dateValue.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function getTodoReportTypeLabel(reportType) {
        return reportType === 'weekly' ? '周报' : '日报';
    }

    function formatTodoReportPeriod(report) {
        if (!report) return '';
        const start = report.period_start || '';
        const end = report.period_end || '';
        if (start && end && start !== end) {
            return `${start} ~ ${end}`;
        }
        return start || end || report.key || '';
    }

    async function fetchTodoReportJson(url, options = {}) {
        const response = await fetch(url, options);
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.success) {
            throw new Error(result.error || `请求失败：${response.status}`);
        }
        return result;
    }

    function openTodoReportModal() {
        const reportRefs = getTodoReportRefs();
        if (!reportRefs.modal) {
            showAlert('danger', '找不到日报/周报窗口');
            return;
        }

        bindTodoReportEvents();

        currentTodoReportType = reportRefs.typeSelect?.value || currentTodoReportType || 'daily';
        if (reportRefs.dateInput && !reportRefs.dateInput.value) {
            reportRefs.dateInput.value = getLocalDateValue();
        }

        let modal = bootstrap.Modal.getInstance(reportRefs.modal);
        if (!modal) {
            modal = new bootstrap.Modal(reportRefs.modal);
        }
        modal.show();
        loadTodoReportList(currentTodoReportType);
    }

    function bindTodoReportEvents() {
        if (todoReportEventsBound) return;
        const reportRefs = getTodoReportRefs();

        if (reportRefs.typeSelect) {
            reportRefs.typeSelect.addEventListener('change', function() {
                currentTodoReportType = this.value || 'daily';
                currentTodoReportKey = null;
                currentTodoReport = null;
                resetTodoReportDetail();
                loadTodoReportList(currentTodoReportType);
            });
        }

        if (reportRefs.generateBtn) {
            reportRefs.generateBtn.addEventListener('click', generateTodoReport);
        }

        if (reportRefs.refreshBtn) {
            reportRefs.refreshBtn.addEventListener('click', function() {
                loadTodoReportList(currentTodoReportType);
            });
        }

        if (reportRefs.saveBtn) {
            reportRefs.saveBtn.addEventListener('click', saveTodoReport);
        }

        if (reportRefs.deleteBtn) {
            reportRefs.deleteBtn.addEventListener('click', deleteTodoReport);
        }

        if (reportRefs.contentInput) {
            reportRefs.contentInput.addEventListener('input', function() {
                updateTodoReportPreview(this.value);
            });
        }

        todoReportEventsBound = true;
    }

    function resetTodoReportDetail() {
        const reportRefs = getTodoReportRefs();
        if (reportRefs.title) reportRefs.title.textContent = '请选择或生成报表';
        if (reportRefs.meta) reportRefs.meta.textContent = '';
        if (reportRefs.contentInput) reportRefs.contentInput.value = '';
        if (reportRefs.sourceSummary) reportRefs.sourceSummary.textContent = '';
        updateTodoReportPreview('');
    }

    async function loadTodoReportList(reportType = currentTodoReportType) {
        currentTodoReportType = reportType || 'daily';
        const reportRefs = getTodoReportRefs();
        if (reportRefs.listContainer) {
            reportRefs.listContainer.innerHTML = '<p class="text-muted small">加载中...</p>';
        }

        try {
            const result = await fetchTodoReportJson(`/api/todo/v2/reports/${currentTodoReportType}`);
            renderTodoReportList(result.items || []);
        } catch (error) {
            if (reportRefs.listContainer) {
                reportRefs.listContainer.innerHTML = `<p class="text-danger small">${escapeHtml(error.message || '加载失败')}</p>`;
            }
            showAlert('danger', error.message || '加载报表列表失败');
        }
    }

    function renderTodoReportList(items) {
        const reportRefs = getTodoReportRefs();
        if (!reportRefs.listContainer) return;

        if (!items || items.length === 0) {
            reportRefs.listContainer.innerHTML = '<p class="text-muted small">暂无报表</p>';
            return;
        }

        let html = '<div class="list-group list-group-flush">';
        items.forEach(report => {
            const key = report.key || '';
            const isActive = key && key === currentTodoReportKey;
            const period = formatTodoReportPeriod(report);
            const updatedAt = report.updated_at ? formatDateTime(report.updated_at) : '';
            html += `
                <button type="button" class="list-group-item list-group-item-action ${isActive ? 'active' : ''}"
                        data-report-type="${escapeHtml(currentTodoReportType)}"
                        data-report-key="${escapeHtml(key)}">
                    <div class="d-flex justify-content-between align-items-start">
                        <strong>${escapeHtml(report.title || key || '未命名报表')}</strong>
                        <small>${escapeHtml(getTodoReportTypeLabel(currentTodoReportType))}</small>
                    </div>
                    <div class="small ${isActive ? '' : 'text-muted'}">${escapeHtml(period)}</div>
                    <div class="small ${isActive ? '' : 'text-muted'}">${escapeHtml(updatedAt)}</div>
                </button>
            `;
        });
        html += '</div>';
        reportRefs.listContainer.innerHTML = html;

        reportRefs.listContainer.querySelectorAll('[data-report-key]').forEach(button => {
            button.addEventListener('click', function() {
                const reportType = this.dataset.reportType || currentTodoReportType;
                const reportKey = this.dataset.reportKey || '';
                loadTodoReportDetail(reportType, reportKey);
            });
        });
    }

    async function generateTodoReport() {
        const reportRefs = getTodoReportRefs();
        const reportType = reportRefs.typeSelect?.value || currentTodoReportType || 'daily';
        const dateValue = reportRefs.dateInput?.value || getLocalDateValue();

        if (reportRefs.generateBtn) {
            reportRefs.generateBtn.disabled = true;
            reportRefs.generateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 生成中...';
        }

        try {
            const result = await fetchTodoReportJson(`/api/todo/v2/reports/${reportType}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: dateValue, save: true }),
            });
            currentTodoReportType = reportType;
            setCurrentTodoReport(result.report);
            await loadTodoReportList(reportType);
            showAlert('success', `${getTodoReportTypeLabel(reportType)}已生成`);
        } catch (error) {
            showAlert('danger', error.message || '生成报表失败');
        } finally {
            if (reportRefs.generateBtn) {
                reportRefs.generateBtn.disabled = false;
                reportRefs.generateBtn.innerHTML = '<i class="fas fa-magic"></i> 生成并保存';
            }
        }
    }

    async function loadTodoReportDetail(reportType, reportKey) {
        if (!reportKey) return;

        try {
            const result = await fetchTodoReportJson(
                `/api/todo/v2/reports/${reportType}/${encodeURIComponent(reportKey)}`
            );
            currentTodoReportType = reportType || 'daily';
            setCurrentTodoReport(result.report);
            await loadTodoReportList(currentTodoReportType);
        } catch (error) {
            showAlert('danger', error.message || '加载报表失败');
        }
    }

    function setCurrentTodoReport(report) {
        const reportRefs = getTodoReportRefs();
        currentTodoReport = report || null;
        currentTodoReportKey = report?.key || null;

        if (reportRefs.typeSelect) {
            reportRefs.typeSelect.value = currentTodoReportType;
        }
        if (reportRefs.title) {
            reportRefs.title.textContent = report?.title || '未命名报表';
        }
        if (reportRefs.meta) {
            const period = formatTodoReportPeriod(report);
            const updatedAt = report?.updated_at ? formatDateTime(report.updated_at) : '';
            reportRefs.meta.textContent = [period, updatedAt ? `更新：${updatedAt}` : ''].filter(Boolean).join(' · ');
        }
        if (reportRefs.contentInput) {
            reportRefs.contentInput.value = report?.content || '';
        }
        if (reportRefs.sourceSummary) {
            const taskCount = Array.isArray(report?.source_tasks) ? report.source_tasks.length : 0;
            const noteCount = Array.isArray(report?.source_notes) ? report.source_notes.length : 0;
            reportRefs.sourceSummary.textContent = `来源：${taskCount} 个任务，${noteCount} 条会议记录`;
        }
        updateTodoReportPreview(report?.content || '');
    }

    async function saveTodoReport() {
        const reportRefs = getTodoReportRefs();
        if (!currentTodoReportKey || !currentTodoReport) {
            showAlert('warning', '请先选择或生成报表');
            return;
        }

        const content = reportRefs.contentInput?.value || '';
        try {
            const result = await fetchTodoReportJson(
                `/api/todo/v2/reports/${currentTodoReportType}/${encodeURIComponent(currentTodoReportKey)}`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: currentTodoReport.title || `${getTodoReportTypeLabel(currentTodoReportType)} ${currentTodoReportKey}`,
                        content,
                    }),
                }
            );
            setCurrentTodoReport(result.report);
            await loadTodoReportList(currentTodoReportType);
            showAlert('success', '报表已保存');
        } catch (error) {
            showAlert('danger', error.message || '保存报表失败');
        }
    }

    async function deleteTodoReport() {
        if (!currentTodoReportKey) {
            showAlert('warning', '请先选择要删除的报表');
            return;
        }
        if (!confirm(`确定删除 ${currentTodoReportKey} 的${getTodoReportTypeLabel(currentTodoReportType)}吗？`)) {
            return;
        }

        try {
            await fetchTodoReportJson(
                `/api/todo/v2/reports/${currentTodoReportType}/${encodeURIComponent(currentTodoReportKey)}`,
                { method: 'DELETE' }
            );
            currentTodoReportKey = null;
            currentTodoReport = null;
            resetTodoReportDetail();
            await loadTodoReportList(currentTodoReportType);
            showAlert('success', '报表已删除');
        } catch (error) {
            showAlert('danger', error.message || '删除报表失败');
        }
    }

    function updateTodoReportPreview(content) {
        const reportRefs = getTodoReportRefs();
        if (!reportRefs.preview) return;

        if (!content || !content.trim()) {
            reportRefs.preview.innerHTML = '<p class="text-muted">预览将在这里显示</p>';
            return;
        }

        if (typeof marked !== 'undefined') {
            try {
                if (marked.setOptions) {
                    marked.setOptions({
                        breaks: true,
                        gfm: true,
                        headerIds: false,
                        mangle: false
                    });
                }
                reportRefs.preview.innerHTML = marked.parse(content);
                return;
            } catch (error) {
                console.error('日报/周报 Markdown 渲染失败:', error);
            }
        }

        reportRefs.preview.innerHTML = `<pre style="white-space: pre-wrap; word-break: break-word;">${escapeHtml(content)}</pre>`;
    }

    // ===== 项目描述和链接管理 =====
    
    let currentProjectIdForDescription = null;
    let currentProjectIdForLinks = null;
    let currentTaskIdForLinks = null;
    let currentLinkId = null;
    let isEditingLink = false;
    
    // 项目描述编辑器相关变量 - 完全按照文件浏览器的实现方式
    let descriptionEditor = null;
    let descriptionOriginalContent = '';
    
    // 项目描述编辑器 - 完全重构，参考文件浏览器的实现
    function openProjectDescriptionModal(projectId) {
        currentProjectIdForDescription = projectId;
        const modalElement = document.getElementById('projectDescriptionModal');
        
        // 获取或创建模态框实例
        let modal = bootstrap.Modal.getInstance(modalElement);
        if (!modal) {
            modal = new bootstrap.Modal(modalElement);
        }
        
        // 重置到预览模式
        const previewMode = document.getElementById('descriptionPreviewMode');
        const editMode = document.getElementById('descriptionEditMode');
        const footer = document.getElementById('descriptionModalFooter');
        
        previewMode.style.display = 'flex';
        editMode.style.display = 'none';
        footer.innerHTML = '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">关闭</button>';
        
        // 清理旧的编辑器
        cleanupDescriptionEditor();
        
        // 加载项目描述
        fetch(`/api/todo/v2/projects/${projectId}/description`)
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    descriptionOriginalContent = result.description || '';
                    updateDescriptionPreview(descriptionOriginalContent);
                }
            })
            .catch(error => {
                console.error('加载项目描述失败:', error);
                showAlert('danger', '加载项目描述失败：' + error.message);
            });
        
        // 绑定编辑按钮
        const editBtn = document.getElementById('editDescriptionBtn');
        if (editBtn) {
            editBtn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                switchToEditMode();
            };
        }
        
        // 显示模态框
        modal.show();
    }
    
    // 清理编辑器 - 完全按照文件浏览器的方式，确保彻底清理
    function cleanupDescriptionEditor() {
        if (descriptionEditor) {
            try {
                const wrapper = descriptionEditor.getWrapperElement();
                if (wrapper && wrapper.parentNode) {
                    wrapper.parentNode.removeChild(wrapper);
                }
            } catch (e) {
                console.warn('清理编辑器失败:', e);
            }
            descriptionEditor = null;
        }
        
        // 额外清理：确保容器中没有任何CodeMirror残留元素
        const editorContainer = document.getElementById('projectDescriptionEditorContainer');
        if (editorContainer) {
            // 移除所有CodeMirror相关的元素
            const codeMirrorElements = editorContainer.querySelectorAll('.CodeMirror, .CodeMirror-scroll, .CodeMirror-sizer');
            codeMirrorElements.forEach(el => {
                try {
                    el.remove();
                } catch (e) {
                    // 忽略错误
                }
            });
            // 清空容器
            editorContainer.innerHTML = '';
        }
    }
    
    // 更新预览内容
    function updateDescriptionPreview(content) {
        const previewDiv = document.getElementById('projectDescriptionPreview');
        if (!previewDiv) return;
        
        if (!content || !content.trim()) {
            previewDiv.innerHTML = '<p class="text-muted">暂无描述内容</p>';
            return;
        }
        
        fetch(`/api/todo/v2/projects/${currentProjectIdForDescription}/description/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: content })
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                previewDiv.innerHTML = result.html;
            } else {
                previewDiv.innerHTML = '<p class="text-danger">预览失败：' + (result.error || '未知错误') + '</p>';
            }
        })
        .catch(error => {
            previewDiv.innerHTML = '<p class="text-danger">预览失败：' + error.message + '</p>';
        });
    }
    
    // 切换到编辑模式 - 完全按照文件浏览器的方式，确保只初始化一次
    function switchToEditMode() {
        const previewMode = document.getElementById('descriptionPreviewMode');
        const editMode = document.getElementById('descriptionEditMode');
        const editorContainer = document.getElementById('projectDescriptionEditorContainer');
        const footer = document.getElementById('descriptionModalFooter');
        
        if (!previewMode || !editMode || !editorContainer || !footer) {
            console.error('切换编辑模式失败：找不到必要的DOM元素');
            return;
        }
        
        // 如果已经有编辑器实例，先清理
        if (descriptionEditor) {
            cleanupDescriptionEditor();
        }
        
        // 切换到编辑模式UI
        previewMode.style.display = 'none';
        editMode.style.display = 'flex';
        footer.innerHTML = `
            <button type="button" class="btn btn-secondary" id="cancelEditBtn">放弃更改</button>
            <button type="button" class="btn btn-primary" id="saveDescriptionBtn">保存并退出</button>
        `;
        
        // 确保容器完全清空（移除所有可能的残留元素）
        editorContainer.innerHTML = '';
        
        // 创建CodeMirror容器div（完全按照文件浏览器的方式）
        const containerDiv = document.createElement('div');
        containerDiv.id = 'descriptionCodeMirrorContainer';
        containerDiv.style.width = '100%';
        containerDiv.style.height = '100%';
        containerDiv.style.minHeight = '300px';
        editorContainer.appendChild(containerDiv);
        
        // 等待模态框完全显示后再初始化（使用模态框事件）
        const modalElement = document.getElementById('projectDescriptionModal');
        const initEditor = () => {
            if (typeof CodeMirror === 'undefined') {
                showAlert('danger', '代码编辑器未加载，请刷新页面重试');
                return;
            }
            
            // 再次检查编辑模式是否仍然显示
            if (editMode.style.display === 'none') {
                return;
            }
            
            const container = document.getElementById('descriptionCodeMirrorContainer');
            if (!container || !container.parentNode) {
                return;
            }
            
            // 再次确保没有已存在的编辑器实例
            if (descriptionEditor) {
                cleanupDescriptionEditor();
            }
            
            // 检查容器中是否已经有CodeMirror元素
            if (container.querySelector('.CodeMirror')) {
                container.innerHTML = '';
            }
            
                try {
                // 初始化CodeMirror - 完全按照文件浏览器的方式
                descriptionEditor = CodeMirror(container, {
                    value: descriptionOriginalContent || '',
                    mode: 'markdown',
                    theme: 'monokai',
                    lineNumbers: true,
                    lineWrapping: true,
                    indentUnit: 2,
                    tabSize: 2,
                    autofocus: true,
                    viewportMargin: Infinity
                });
                
                // 计算合适的高度
                const updateSize = () => {
                    if (!descriptionEditor || editMode.style.display === 'none') return;
                    const modalBody = editorContainer.closest('.modal-body');
                    if (modalBody) {
                        const modalBodyHeight = modalBody.offsetHeight;
                        const footerHeight = 60;
                        const availableHeight = modalBodyHeight - footerHeight - 50;
                        descriptionEditor.setSize('100%', Math.max(availableHeight, 300) + 'px');
                    } else {
                        descriptionEditor.setSize('100%', '400px');
                    }
                };
                
                updateSize();
                
                // 实时预览功能 - 使用前端Markdown渲染
                const livePreviewDiv = document.getElementById('descriptionLivePreview');
                let previewUpdateTimer = null;
                
                // 实时更新预览的函数（使用防抖）
                const updateLivePreview = (markdownText) => {
                    if (typeof marked === 'undefined') {
                        // 如果没有marked.js，使用后端API
                        fetch(`/api/todo/v2/projects/${currentProjectIdForDescription}/description/preview`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ description: markdownText })
                        })
                        .then(response => response.json())
                        .then(result => {
                            if (result.success && livePreviewDiv) {
                                livePreviewDiv.innerHTML = result.html;
                            }
                        })
                        .catch(error => {
                            if (livePreviewDiv) {
                                livePreviewDiv.innerHTML = '<p class="text-danger">预览更新失败</p>';
                            }
                        });
                        return;
                    }
                    
                    // 使用前端marked.js实时渲染（配置以支持扩展语法）
                    try {
                        if (livePreviewDiv) {
                            if (!markdownText || !markdownText.trim()) {
                                livePreviewDiv.innerHTML = '<p class="text-muted">暂无内容</p>';
                            } else {
                                // 配置marked.js支持扩展语法（与后端markdown-it保持一致）
                                if (typeof marked !== 'undefined' && marked.setOptions) {
                                    marked.setOptions({
                                        breaks: true,        // 支持换行（与后端一致）
                                        gfm: true,          // 启用GitHub Flavored Markdown（支持表格、任务列表等）
                                        headerIds: false,   // 禁用自动生成header ID（可选）
                                        mangle: false       // 不混淆邮箱地址（可选）
                                    });
                                }
                                const html = marked.parse(markdownText);
                                livePreviewDiv.innerHTML = html;
                            }
                        }
                    } catch (error) {
                        console.error('Markdown渲染失败:', error);
                        if (livePreviewDiv) {
                            livePreviewDiv.innerHTML = '<p class="text-danger">预览渲染失败</p>';
                        }
                    }
                };
                
                // 初始预览
                updateLivePreview(descriptionOriginalContent);
                
                // 监听编辑器内容变化，实时更新预览（使用防抖300ms）
                descriptionEditor.on('change', function() {
                    clearTimeout(previewUpdateTimer);
                    previewUpdateTimer = setTimeout(() => {
                        const content = descriptionEditor.getValue();
                        updateLivePreview(content);
                    }, 300);
                });
                
                // 强制刷新编辑器布局（完全按照文件浏览器的方式）
                setTimeout(() => {
                    if (descriptionEditor && editMode.style.display === 'flex') {
                        updateSize();
                        descriptionEditor.refresh();
                        descriptionEditor.focus();
                    }
                }, 150);
                
                // 绑定按钮事件
                const cancelBtn = document.getElementById('cancelEditBtn');
                const saveBtn = document.getElementById('saveDescriptionBtn');
                if (cancelBtn) {
                    cancelBtn.onclick = cancelEdit;
                }
                if (saveBtn) {
                    saveBtn.onclick = saveDescription;
                }
            } catch (error) {
                console.error('初始化编辑器失败:', error);
                showAlert('danger', '初始化编辑器失败：' + error.message);
            }
        };
        
        // 如果模态框已经显示，直接初始化；否则等待显示事件
        if (modalElement && modalElement.classList.contains('show')) {
            setTimeout(initEditor, 100);
        } else {
            const onShown = () => {
                setTimeout(initEditor, 100);
                modalElement.removeEventListener('shown.bs.modal', onShown);
            };
            modalElement.addEventListener('shown.bs.modal', onShown);
        }
    }
    
    // 取消编辑
    function cancelEdit() {
        cleanupDescriptionEditor();
        
        const previewMode = document.getElementById('descriptionPreviewMode');
        const editMode = document.getElementById('descriptionEditMode');
        const footer = document.getElementById('descriptionModalFooter');
        
        editMode.style.display = 'none';
        previewMode.style.display = 'flex';
        footer.innerHTML = '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">关闭</button>';
        
        // 恢复预览
        updateDescriptionPreview(descriptionOriginalContent);
        
        // 重新绑定编辑按钮
        const editBtn = document.getElementById('editDescriptionBtn');
        if (editBtn) {
            editBtn.onclick = function(e) {
                e.preventDefault();
                e.stopPropagation();
                switchToEditMode();
            };
        }
    }
    
    // 保存描述
    function saveDescription() {
        if (!descriptionEditor) return;
        
        const description = descriptionEditor.getValue();
        
        fetch(`/api/todo/v2/projects/${currentProjectIdForDescription}/description`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: description })
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                descriptionOriginalContent = description;
                showAlert('success', '项目描述已保存');
                
                // 退出编辑模式
                cleanupDescriptionEditor();
                
                const previewMode = document.getElementById('descriptionPreviewMode');
                const editMode = document.getElementById('descriptionEditMode');
                const footer = document.getElementById('descriptionModalFooter');
                
                editMode.style.display = 'none';
                previewMode.style.display = 'flex';
                footer.innerHTML = '<button type="button" class="btn btn-secondary" data-bs-dismiss="modal">关闭</button>';
                
                // 更新预览
                updateDescriptionPreview(description);
                
                // 重新绑定编辑按钮
                const editBtn = document.getElementById('editDescriptionBtn');
                if (editBtn) {
                    editBtn.onclick = function(e) {
                        e.preventDefault();
                        e.stopPropagation();
                        switchToEditMode();
                    };
                }
            } else {
                showAlert('danger', '保存失败：' + (result.error || '未知错误'));
            }
        })
        .catch(error => {
            showAlert('danger', '保存失败：' + error.message);
        });
    }
    
    function openProjectLinksModal(projectId) {
        currentProjectIdForLinks = projectId;
        currentTaskIdForLinks = null;
        isEditingLink = false;
        const modal = new bootstrap.Modal(document.getElementById('projectLinksModal'));
        
        // 加载链接列表
        loadProjectLinks(projectId);
        
        // 绑定添加链接按钮
        document.getElementById('addProjectLinkBtn').onclick = () => {
            openLinkEditModal('project', null);
        };
        
        modal.show();
    }
    
    function openTaskLinksModal(taskId) {
        currentTaskIdForLinks = taskId;
        currentProjectIdForLinks = null;
        isEditingLink = false;
        const modal = new bootstrap.Modal(document.getElementById('taskLinksModal'));
        
        // 加载链接列表
        loadTaskLinks(taskId);
        
        // 绑定添加链接按钮
        document.getElementById('addTaskLinkBtn').onclick = () => {
            openLinkEditModal('task', null);
        };
        
        modal.show();
    }
    
    function loadProjectLinks(projectId) {
        const linksList = document.getElementById('projectLinksList');
        
        fetch(`/api/todo/v2/projects/${projectId}/links`)
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    renderLinksList(linksList, result.links, 'project');
                } else {
                    linksList.innerHTML = '<p class="text-danger">加载失败：' + (result.error || '未知错误') + '</p>';
                }
            })
            .catch(error => {
                linksList.innerHTML = '<p class="text-danger">加载失败：' + error.message + '</p>';
            });
    }
    
    function loadTaskLinks(taskId) {
        const linksList = document.getElementById('taskLinksList');
        
        fetch(`/api/todo/v2/tasks/${taskId}/links`)
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    renderLinksList(linksList, result.links, 'task');
                } else {
                    linksList.innerHTML = '<p class="text-danger">加载失败：' + (result.error || '未知错误') + '</p>';
                }
            })
            .catch(error => {
                linksList.innerHTML = '<p class="text-danger">加载失败：' + error.message + '</p>';
            });
    }
    
    function renderLinksList(container, links, type) {
        if (!links || links.length === 0) {
            container.innerHTML = '<p class="text-muted">暂无链接</p>';
            return;
        }
        
        let html = '<div class="list-group">';
        links.forEach(link => {
            const isFileLink = link.url.startsWith('/file_browser') || link.url.startsWith('/preview');
            html += `
                <div class="list-group-item d-flex justify-content-between align-items-center">
                    <div>
                        <strong>${escapeHtml(link.name)}</strong>
                        <br>
                        <small class="text-muted">${escapeHtml(link.url)}</small>
                    </div>
                    <div>
                        <button type="button" class="btn btn-sm btn-outline-primary me-1" onclick="handleLinkClick('${escapeHtml(link.url)}')" title="打开链接">
                            <i class="fas fa-external-link-alt"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-secondary me-1" onclick="editLink('${type}', '${link.id}')" title="编辑">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteLink('${type}', '${link.id}')" title="删除">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        container.innerHTML = html;
    }
    
    window.handleLinkClick = function(url) {
        // 判断是文件浏览器链接还是外部链接
        if (url.startsWith('/file_browser') || url.startsWith('/preview')) {
            // 文件浏览器链接，在新窗口打开
            window.open(url, '_blank');
        } else if (url.startsWith('http://') || url.startsWith('https://')) {
            // 外部链接，在新窗口打开
            window.open(url, '_blank');
        } else {
            // 相对路径，在当前窗口打开
            window.location.href = url;
        }
    };
    
    window.editLink = function(type, linkId) {
        currentLinkId = linkId;
        isEditingLink = true;
        
        let links = [];
        if (type === 'project') {
            fetch(`/api/todo/v2/projects/${currentProjectIdForLinks}/links`)
                .then(response => response.json())
                .then(result => {
                    if (result.success) {
                        const link = result.links.find(l => l.id === linkId);
                        if (link) {
                            openLinkEditModal(type, link);
                        }
                    }
                });
        } else {
            fetch(`/api/todo/v2/tasks/${currentTaskIdForLinks}/links`)
                .then(response => response.json())
                .then(result => {
                    if (result.success) {
                        const link = result.links.find(l => l.id === linkId);
                        if (link) {
                            openLinkEditModal(type, link);
                        }
                    }
                });
        }
    };
    
    window.deleteLink = function(type, linkId) {
        if (!confirm('确定删除此链接吗？')) {
            return;
        }
        
        let url = '';
        if (type === 'project') {
            url = `/api/todo/v2/projects/${currentProjectIdForLinks}/links/${linkId}`;
        } else {
            url = `/api/todo/v2/tasks/${currentTaskIdForLinks}/links/${linkId}`;
        }
        
        fetch(url, { method: 'DELETE' })
            .then(response => response.json())
            .then(result => {
                if (result.success) {
                    showAlert('success', '链接已删除');
                    if (type === 'project') {
                        loadProjectLinks(currentProjectIdForLinks);
                    } else {
                        loadTaskLinks(currentTaskIdForLinks);
                    }
                } else {
                    showAlert('danger', '删除失败：' + (result.error || '未知错误'));
                }
            })
            .catch(error => {
                showAlert('danger', '删除失败：' + error.message);
            });
    };
    
    function openLinkEditModal(type, link) {
        const modal = new bootstrap.Modal(document.getElementById('linkEditModal'));
        const title = document.getElementById('linkEditModalTitle');
        const nameInput = document.getElementById('linkNameInput');
        const urlInput = document.getElementById('linkUrlInput');
        const form = document.getElementById('linkEditForm');
        const selectFileBtn = document.getElementById('selectFileBtn');
        
        if (link) {
            title.textContent = '编辑链接';
            nameInput.value = link.name || '';
            urlInput.value = link.url || '';
        } else {
            title.textContent = '添加链接';
            nameInput.value = '';
            urlInput.value = '';
        }
        
        // 移除旧的事件监听器
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);
        
        // 重新获取selectFileBtn（因为form被替换了）
        const newSelectFileBtn = document.getElementById('selectFileBtn');
        if (newSelectFileBtn) {
            newSelectFileBtn.onclick = () => {
                // 保存当前输入的引用，确保回调函数能访问到正确的元素
                const currentUrlInput = document.getElementById('linkUrlInput');
                const currentNameInput = document.getElementById('linkNameInput');
                openFolderSelector((folderPath, folderName) => {
                    // 回调时重新获取输入框元素（确保引用有效）
                    const urlInput = document.getElementById('linkUrlInput');
                    const nameInput = document.getElementById('linkNameInput');
                    
                    if (urlInput && folderPath !== undefined) {
                        // 文件夹路径直接用于文件浏览器
                        urlInput.value = `/file_browser?path=${encodeURIComponent(folderPath)}`;
                    }
                    if (nameInput && folderName && !nameInput.value.trim()) {
                        nameInput.value = folderName;
                    }
                });
            };
        }
        
        // 绑定提交事件
        newForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveLink(type);
        });
        
        modal.show();
    }
    
    // 完全重构的文件夹选择器（动态刷新模式）
    let currentFolderPath = ''; // 当前显示的文件夹路径
    let folderSelectorCallback = null; // 选择文件夹的回调函数
    
    function openFolderSelector(onSelect) {
        folderSelectorCallback = onSelect;
        currentFolderPath = ''; // 重置为根目录
        
        const modalElement = document.getElementById('fileSelectorModal');
        if (!modalElement) {
            console.error('文件夹选择器模态框不存在');
            showAlert('danger', '文件夹选择器模态框不存在');
            return;
        }
        
        // 更新模态框标题
        const modalTitle = modalElement.querySelector('.modal-title');
        if (modalTitle) {
            modalTitle.textContent = '选择文件夹';
        }
        
        let modal = bootstrap.Modal.getInstance(modalElement);
        if (!modal) {
            modal = new bootstrap.Modal(modalElement, {
                backdrop: true,
                keyboard: true,
                focus: true
            });
        }
        
        const container = document.getElementById('fileTreeContainer');
        if (!container) {
            console.error('文件树容器不存在');
            showAlert('danger', '文件树容器不存在');
            return;
        }
        
        // 显示加载状态
        container.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm" role="status"></div><span class="ms-2">正在加载文件夹列表...</span></div>';
        
        // 显示模态框
        modal.show();
        
        // 加载根目录
        loadFolderContent('');
    }
    
    // 加载文件夹内容
    function loadFolderContent(folderPath) {
        currentFolderPath = folderPath;
        const container = document.getElementById('fileTreeContainer');
        if (!container) return;
        
        // 显示加载状态
        container.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm" role="status"></div><span class="ms-2">正在加载...</span></div>';
        
        // 构建API URL
        const apiUrl = folderPath 
            ? `/api/todo/v2/file_tree/${encodeURIComponent(folderPath)}`
            : '/api/todo/v2/file_tree';
        
        // 获取文件夹内容
        fetch(apiUrl)
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => Promise.reject(err));
                }
                return response.json();
            })
            .then(result => {
                if (result.success) {
                    renderFolderContent(container, result.tree, folderPath);
                } else {
                    container.innerHTML = '<div class="alert alert-danger">加载失败：' + (result.error || '未知错误') + '</div>';
                }
            })
            .catch(error => {
                console.error('加载文件夹失败:', error);
                container.innerHTML = '<div class="alert alert-danger">加载失败：' + (error.error || error.message || '未知错误') + '</div>';
            });
    }
    
    // 渲染文件夹内容
    function renderFolderContent(container, tree, currentPath) {
        if (!tree || tree.length === 0) {
            container.innerHTML = '<p class="text-muted text-center py-3">该文件夹为空</p>';
            return;
        }
        
        // 构建面包屑导航
        let breadcrumbHtml = '<nav aria-label="breadcrumb" class="mb-3"><ol class="breadcrumb">';
        const pathParts = currentPath ? currentPath.split('/').filter(p => p) : [];
        
        // 根目录
        breadcrumbHtml += '<li class="breadcrumb-item"><a href="#" class="folder-nav-link" data-path="">根目录</a></li>';
        
        // 路径各部分
        let currentPathAccum = '';
        pathParts.forEach((part, index) => {
            currentPathAccum += (currentPathAccum ? '/' : '') + part;
            breadcrumbHtml += `<li class="breadcrumb-item"><a href="#" class="folder-nav-link" data-path="${escapeHtml(currentPathAccum)}">${escapeHtml(part)}</a></li>`;
        });
        
        breadcrumbHtml += '</ol></nav>';
        
        // 构建文件/文件夹列表
        let listHtml = '<ul class="list-group">';
        
        // 只显示文件夹（因为我们要选择文件夹）
        const folders = tree.filter(node => node.is_dir);
        
        if (folders.length === 0) {
            listHtml += '<li class="list-group-item text-muted text-center">该文件夹下没有子文件夹</li>';
        } else {
            folders.forEach(node => {
                const folderPath = node.path;
                listHtml += `
                    <li class="list-group-item folder-item" style="cursor: pointer;" data-path="${escapeHtml(folderPath)}">
                        <i class="fas fa-folder text-warning me-2"></i>
                        <span>${escapeHtml(node.name)}</span>
                        <i class="fas fa-chevron-right float-end mt-1"></i>
                    </li>
                `;
            });
        }
        
        listHtml += '</ul>';
        
        container.innerHTML = breadcrumbHtml + listHtml;
        
        // 绑定事件：面包屑导航
        container.querySelectorAll('.folder-nav-link').forEach(link => {
            link.addEventListener('click', function(e) {
                e.preventDefault();
                const path = this.dataset.path;
                loadFolderContent(path);
            });
        });
        
        // 绑定事件：文件夹项点击
        container.querySelectorAll('.folder-item').forEach(item => {
            item.addEventListener('click', function(e) {
                e.preventDefault();
                const path = this.dataset.path;
                
                // 进入子文件夹
                loadFolderContent(path);
            });
        });
        
        // 添加选择当前文件夹的按钮
        const selectCurrentBtn = document.createElement('div');
        selectCurrentBtn.className = 'mt-3';
        const currentFolderName = currentPath ? pathParts[pathParts.length - 1] : '根目录';
        selectCurrentBtn.innerHTML = `
            <button type="button" class="btn btn-primary w-100" id="selectCurrentFolderBtn">
                <i class="fas fa-check me-2"></i>选择当前文件夹: ${escapeHtml(currentFolderName)}
            </button>
        `;
        container.appendChild(selectCurrentBtn);
        
        // 绑定选择按钮
        document.getElementById('selectCurrentFolderBtn').addEventListener('click', function() {
            if (folderSelectorCallback) {
                folderSelectorCallback(currentPath || '', currentFolderName);
                bootstrap.Modal.getInstance(document.getElementById('fileSelectorModal')).hide();
            }
        });
    }
    
    function saveLink(type) {
        const nameInput = document.getElementById('linkNameInput');
        const urlInput = document.getElementById('linkUrlInput');
        const name = nameInput.value.trim();
        const url = urlInput.value.trim();
        
        if (!name || !url) {
            showAlert('warning', '请填写链接名称和地址');
            return;
        }
        
        let apiUrl = '';
        let method = 'POST';
        
        if (type === 'project') {
            if (isEditingLink && currentLinkId) {
                apiUrl = `/api/todo/v2/projects/${currentProjectIdForLinks}/links/${currentLinkId}`;
                method = 'PUT';
            } else {
                apiUrl = `/api/todo/v2/projects/${currentProjectIdForLinks}/links`;
            }
        } else {
            if (isEditingLink && currentLinkId) {
                apiUrl = `/api/todo/v2/tasks/${currentTaskIdForLinks}/links/${currentLinkId}`;
                method = 'PUT';
            } else {
                apiUrl = `/api/todo/v2/tasks/${currentTaskIdForLinks}/links`;
            }
        }
        
        fetch(apiUrl, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name, url: url })
        })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                showAlert('success', isEditingLink ? '链接已更新' : '链接已添加');
                bootstrap.Modal.getInstance(document.getElementById('linkEditModal')).hide();
                if (type === 'project') {
                    loadProjectLinks(currentProjectIdForLinks);
                } else {
                    loadTaskLinks(currentTaskIdForLinks);
                }
                isEditingLink = false;
                currentLinkId = null;
            } else {
                showAlert('danger', '保存失败：' + (result.error || '未知错误'));
            }
        })
        .catch(error => {
            showAlert('danger', '保存失败：' + error.message);
        });
    }

    // ===== 待完成任务列表折叠 =====

    function togglePendingList() {
        state.pendingCollapsed = !state.pendingCollapsed;
        localStorage.setItem('pendingCollapsed', state.pendingCollapsed);
        
        const section = document.querySelector('.pending-overview-section');
        const icon = refs.pendingHeader?.querySelector('.collapse-icon');
        
        if (state.pendingCollapsed) {
            section?.classList.add('collapsed');
            if (icon) icon.style.transform = 'rotate(-90deg)';
        } else {
            section?.classList.remove('collapsed');
            if (icon) icon.style.transform = 'rotate(0deg)';
        }
    }

    function init() {
        attachEventListeners();
        window.addEventListener('yobboy:todo-updated', function () {
            loadData();
        });
        
        // 初始化风格切换（三态切换）
        if (refs.styleScrollBtn) {
            refs.styleScrollBtn.addEventListener('click', () => switchStyle('scroll'));
        }
        if (refs.styleTableBtn) {
            refs.styleTableBtn.addEventListener('click', () => switchStyle('table'));
        }
        if (refs.styleReportBtn) {
            refs.styleReportBtn.addEventListener('click', () => switchStyle('report'));
        }
        
        // 初始化汇报页面按钮
        if (refs.exportReportBtn) {
            refs.exportReportBtn.addEventListener('click', exportReportToExcel);
        }
        if (refs.fullscreenReportBtn) {
            refs.fullscreenReportBtn.addEventListener('click', toggleReportFullscreen);
        }
        
        // 初始化会议记录按钮
        const meetingNoteBtn = document.getElementById('meetingNoteBtn');
        if (meetingNoteBtn) {
            meetingNoteBtn.addEventListener('click', openMeetingNoteModal);
        }

        const todoReportBtn = document.getElementById('todoReportBtn');
        if (todoReportBtn) {
            todoReportBtn.addEventListener('click', openTodoReportModal);
        }
        
        // 初始化待完成任务列表折叠状态
        if (state.pendingCollapsed) {
            togglePendingList();
        }
        
        // 初始化字体大小
        applyFontSize();
        
        // 先设置风格显示状态（不渲染内容）
        switchStyle(state.currentStyle);
        
        // 加载数据（数据加载完成后会自动渲染）
        loadData();
        
        // 初始化文件选择器
        initFileSelector();
    }

    // 初始化文件选择器
    function initFileSelector() {
        const fileSelector = document.getElementById('fileSelector');
        const fileSelectorBtn = document.getElementById('fileSelectorBtn');
        const fileSelectorDisplay = document.getElementById('fileSelectorDisplay');
        const resetFileBtn = document.getElementById('resetFileBtn');
        const fileStatus = document.getElementById('fileStatus');
        
        if (!fileSelector || !fileSelectorBtn || !fileSelectorDisplay) return;
        
        // 点击按钮触发文件选择
        fileSelectorBtn.addEventListener('click', () => {
            fileSelector.click();
        });
        
        // 文件选择变化
        fileSelector.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            if (!file.name.endsWith('.json')) {
                showAlert('danger', '请选择JSON文件');
                return;
            }
            
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                
                // 验证数据结构
                if (!data || typeof data !== 'object') {
                    throw new Error('无效的JSON格式');
                }
                
                // 检查是否包含projects字段
                if (!data.projects || !Array.isArray(data.projects)) {
                    throw new Error('JSON文件格式不正确：缺少projects数组');
                }
                
                // 更新显示
                fileSelectorDisplay.value = file.name;
                fileStatus.textContent = `已加载: ${file.name} (${data.projects.length}个项目)`;
                fileStatus.style.display = 'inline-block';
                fileStatus.className = 'badge bg-success ms-2';
                
                // 更新state并重新渲染
                state.projects = data.projects || [];
                
                // 计算待完成概览（如果JSON中没有overview或需要重新计算）
                state.overview = calculatePendingOverview(state.projects);
                
                // 初始化表格数据
                flattenTasks();
                applyTableFilters();
                
                renderProjects();
                renderPendingOverview();
                switchStyle(state.currentStyle);
                
                // 如果当前是表格风格，重新渲染表格
                
                showAlert('success', `成功加载文件: ${file.name}`);
            } catch (error) {
                fileStatus.textContent = `加载失败: ${error.message}`;
                fileStatus.style.display = 'inline-block';
                fileStatus.className = 'badge bg-danger ms-2';
                showAlert('danger', `文件解析失败: ${error.message}`);
            }
        });
        
        // 重置按钮
        if (resetFileBtn) {
            resetFileBtn.addEventListener('click', () => {
                fileSelector.value = '';
                fileSelectorDisplay.value = '';
                fileStatus.style.display = 'none';
                // 重新加载默认数据
                loadData();
                showAlert('info', '已重置为默认数据文件');
            });
        }
    }

    // 导出状态供导出功能使用
    window.getTodoState = () => state;

    document.addEventListener('DOMContentLoaded', init);
})();

