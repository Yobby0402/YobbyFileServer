(() => {
    'use strict';

    const DAY_MS = 24 * 60 * 60 * 1000;

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function parseDate(value) {
        if (!value) return null;
        const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
        const date = dateOnly
            ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]))
            : new Date(value);
        if (Number.isNaN(date.getTime())) return null;
        date.setHours(0, 0, 0, 0);
        return date;
    }

    function formatDate(date) {
        if (!date) return '未设置';
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function addDays(date, days) {
        const next = new Date(date);
        next.setDate(next.getDate() + days);
        return next;
    }

    function diffDays(start, end) {
        return Math.round((end - start) / DAY_MS);
    }

    function getDayWidth(totalDays, availableWidth) {
        return Math.max(6, availableWidth / totalDays);
    }

    function getTickInterval(dayWidth) {
        const minimumLabelWidth = 92;
        const desiredInterval = Math.ceil(minimumLabelWidth / dayWidth);
        const intervals = [1, 2, 3, 7, 14, 21, 30, 60, 90, 180, 365];
        return intervals.find(interval => interval >= desiredInterval) || desiredInterval;
    }

    function getProjectColor(color) {
        return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#6366f1';
    }

    function create(options) {
        const panel = options.panel;
        const container = options.container;
        const emptyMessage = options.emptyMessage;
        const rangeText = options.rangeText;
        const onTaskClick = options.onTaskClick;
        if (!panel || !container || !emptyMessage || !rangeText) return null;

        let lastRenderData = null;
        let resizeFrame = null;

        const tooltip = document.createElement('div');
        tooltip.className = 'timeline-tooltip';
        tooltip.setAttribute('role', 'tooltip');
        document.body.appendChild(tooltip);

        function hideTooltip() {
            tooltip.classList.remove('visible');
        }

        function fitPanelHeight() {
            const panelTop = Math.max(16, panel.getBoundingClientRect().top);
            const availableHeight = Math.floor(window.innerHeight - panelTop - 24);
            panel.style.height = `${Math.max(480, availableHeight)}px`;
        }

        function getAvailableTimelineWidth() {
            const labelWidth = parseFloat(getComputedStyle(container).getPropertyValue('--timeline-label-width')) || 260;
            return Math.max(1, container.clientWidth - labelWidth);
        }

        function positionTooltip(clientX, clientY) {
            const margin = 14;
            const rect = tooltip.getBoundingClientRect();
            const left = Math.min(clientX + margin, window.innerWidth - rect.width - margin);
            const top = Math.min(clientY + margin, window.innerHeight - rect.height - margin);
            tooltip.style.left = `${Math.max(margin, left)}px`;
            tooltip.style.top = `${Math.max(margin, top)}px`;
        }

        function showTooltip(item, clientX, clientY) {
            const dueText = item.dueDate ? formatDate(item.dueDate) : '未设置（延伸至今天）';
            tooltip.innerHTML = `
                <div class="timeline-tooltip-project">${escapeHtml(item.projectName)}</div>
                <div class="timeline-tooltip-title">${escapeHtml(item.summary || '未命名任务')}</div>
                <div class="timeline-tooltip-grid">
                    <span>时间</span><strong>${formatDate(item.startDate)} → ${dueText}</strong>
                    <span>进度</span><strong>${item.progress}%</strong>
                    <span>优先级</span><strong>${escapeHtml(item.priority)}</strong>
                </div>
                ${item.description ? `<div class="timeline-tooltip-description">${escapeHtml(item.description)}</div>` : ''}
                <div class="timeline-tooltip-action">点击可编辑任务</div>
            `;
            tooltip.classList.add('visible');
            positionTooltip(clientX, clientY);
        }

        function buildItems(projects, searchText) {
            const today = parseDate(new Date());
            const keyword = String(searchText || '').trim().toLowerCase();
            const groups = [];

            (projects || []).forEach((project) => {
                const projectMatches = String(project.name || '').toLowerCase().includes(keyword);
                const tasks = (project.tasks || [])
                    .filter(task => Number(task.progress || 0) < 100)
                    .filter(task => {
                        if (!keyword || projectMatches) return true;
                        return [task.summary, task.description].some(value =>
                            String(value || '').toLowerCase().includes(keyword)
                        );
                    })
                    .map((task) => {
                        const startDate = parseDate(task.created_at) || parseDate(project.created_at) || today;
                        const dueDate = parseDate(task.due_date);
                        const visualEndDate = dueDate && dueDate > startDate ? dueDate : (today > startDate ? today : startDate);
                        return {
                            ...task,
                            projectId: project.id,
                            projectName: project.name || '未命名项目',
                            projectColor: getProjectColor(project.color),
                            startDate,
                            dueDate,
                            visualEndDate,
                            progress: Math.max(0, Math.min(100, Number(task.progress || 0))),
                            priority: task.priority || 3,
                        };
                    });

                if (tasks.length) groups.push({ project, tasks });
            });

            return { groups, today };
        }

        function render({ projects, searchText }) {
            lastRenderData = { projects, searchText };
            fitPanelHeight();
            hideTooltip();
            const { groups, today } = buildItems(projects, searchText);
            const items = groups.flatMap(group => group.tasks);

            if (!items.length) {
                container.innerHTML = '';
                container.style.display = 'none';
                emptyMessage.style.display = 'flex';
                rangeText.textContent = searchText ? '当前搜索条件下没有进行中的任务' : '按创建时间与预计完成时间展示任务跨度';
                return;
            }

            container.style.display = 'block';
            emptyMessage.style.display = 'none';

            const rangeStart = new Date(Math.min(...items.map(item => item.startDate.getTime())));
            const rangeEnd = new Date(Math.max(today.getTime(), ...items.map(item => item.visualEndDate.getTime())));
            const totalDays = Math.max(1, diffDays(rangeStart, rangeEnd) + 1);
            const dayWidth = getDayWidth(totalDays, getAvailableTimelineWidth());
            const timelineWidth = Math.ceil(totalDays * dayWidth);
            const tickInterval = getTickInterval(dayWidth);
            const todayOffset = diffDays(rangeStart, today) * dayWidth;

            rangeText.textContent = `${formatDate(rangeStart)} 至 ${formatDate(rangeEnd)} · ${items.length} 个进行中任务`;

            const ticks = [];
            for (let day = 0; day < totalDays; day += tickInterval) {
                const date = addDays(rangeStart, day);
                const tickLeft = day * dayWidth;
                const tickWidth = Math.max(1, timelineWidth - tickLeft);
                ticks.push(`<span class="timeline-tick" style="left:${tickLeft}px;max-width:${tickWidth}px">${formatDate(date)}</span>`);
            }

            const groupHtml = groups.map(({ project, tasks }) => {
                const rows = tasks.map((item) => {
                    const left = diffDays(rangeStart, item.startDate) * dayWidth;
                    const width = Math.max(dayWidth, (diffDays(item.startDate, item.visualEndDate) + 1) * dayWidth);
                    const duration = diffDays(item.startDate, item.visualEndDate) + 1;
                    const taskLabel = escapeHtml(item.summary || '未命名任务');
                    return `
                        <div class="timeline-row">
                            <div class="timeline-task-label" title="${taskLabel}">
                                <span>${taskLabel}</span>
                                <small>${item.progress}%</small>
                            </div>
                            <div class="timeline-track">
                                <button type="button" class="timeline-bar" style="left:${left}px;width:${width}px;--project-color:${item.projectColor}" data-project-id="${escapeHtml(item.projectId)}" data-task-id="${escapeHtml(item.id)}" aria-label="${taskLabel}，${formatDate(item.startDate)} 至 ${item.dueDate ? formatDate(item.dueDate) : '今天'}，进度 ${item.progress}%">
                                    <span class="timeline-bar-progress" style="width:${item.progress}%"></span>
                                    <span class="timeline-bar-label">${taskLabel}</span>
                                    <span class="timeline-bar-duration">${duration}天</span>
                                </button>
                            </div>
                        </div>
                    `;
                }).join('');

                return `
                    <section class="timeline-project-group">
                        <div class="timeline-project-heading" style="--project-color:${getProjectColor(project.color)}">
                            <div class="timeline-project-heading-label">
                                <span class="timeline-project-dot"></span>
                                <strong>${escapeHtml(project.name || '未命名项目')}</strong>
                                ${project.phase ? `<small>${escapeHtml(project.phase)}</small>` : ''}
                                <span>${tasks.length} 项</span>
                            </div>
                        </div>
                        ${rows}
                    </section>
                `;
            }).join('');

            container.innerHTML = `
                <div class="timeline-canvas" style="--timeline-width:${timelineWidth}px;--day-width:${dayWidth}px">
                    <div class="timeline-axis-row">
                        <div class="timeline-axis-corner">项目 / 任务</div>
                        <div class="timeline-axis">${ticks.join('')}</div>
                    </div>
                    <div class="timeline-grid-layer" aria-hidden="true">
                        ${todayOffset >= 0 && todayOffset <= timelineWidth ? `<span class="timeline-today-line" style="left:calc(var(--timeline-label-width) + ${todayOffset}px)"><b>今天</b></span>` : ''}
                    </div>
                    ${groupHtml}
                </div>
            `;

            const itemMap = new Map(items.map(item => [`${item.projectId}:${item.id}`, item]));
            container.querySelectorAll('.timeline-bar').forEach((bar) => {
                const item = itemMap.get(`${bar.dataset.projectId}:${bar.dataset.taskId}`);
                bar.addEventListener('mouseenter', event => showTooltip(item, event.clientX, event.clientY));
                bar.addEventListener('mousemove', event => positionTooltip(event.clientX, event.clientY));
                bar.addEventListener('mouseleave', hideTooltip);
                bar.addEventListener('focus', () => {
                    const rect = bar.getBoundingClientRect();
                    showTooltip(item, rect.left + rect.width / 2, rect.bottom);
                });
                bar.addEventListener('blur', hideTooltip);
                bar.addEventListener('click', () => {
                    hideTooltip();
                    onTaskClick?.(item.projectId, item.id);
                });
            });
        }

        window.addEventListener('resize', () => {
            window.cancelAnimationFrame(resizeFrame);
            resizeFrame = window.requestAnimationFrame(() => {
                if (lastRenderData && panel.offsetParent !== null) {
                    render(lastRenderData);
                }
            });
        });

        return { render };
    }

    window.TodoTimelineView = { create };
})();
