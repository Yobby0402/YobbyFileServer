(() => {
    'use strict';

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
        'change_count': { key: 'change_count', label: '改动数量', default: false, order: 9 },
        'conclusion': { key: 'conclusion', label: '结论', default: false, order: 10 },
    };

    // 周报专用列定义
    const WEEKLY_COLUMN_DEFINITIONS = {
        'project_name': { key: 'project_name', label: '项目名称', default: true, order: 0 },
        'index': { key: 'index', label: '序号', default: true, order: 1 },
        'summary': { key: 'summary', label: '任务简述', default: true, order: 2 },
        'description': { key: 'description', label: '详细描述', default: true, order: 3 },
        'priority': { key: 'priority', label: '优先级', default: true, order: 4 },
        'progress': { key: 'progress', label: '进度', default: true, order: 5 },
        'last_week_progress': { key: 'last_week_progress', label: '上周进展', default: true, order: 6 },
        'this_week_plan': { key: 'this_week_plan', label: '本周计划', default: true, order: 7 },
        'due_date': { key: 'due_date', label: '预计完成时间', default: false, order: 8 },
        'created_at': { key: 'created_at', label: '创建时间', default: false, order: 9 },
        'updated_at': { key: 'updated_at', label: '最后更新时间', default: false, order: 10 },
    };

    let exportModal = null;
    let draggedColumnItem = null;

    // ===== 打开导出配置对话框 =====

    let currentTodoState = null;

    window.openExportModal = function(todoState) {
        if (!exportModal) {
            exportModal = new bootstrap.Modal(document.getElementById('exportModal'));
        }

        // 保存当前状态
        currentTodoState = todoState;

        // 初始化列选择列表
        initColumnList(todoState);

        // 绑定事件
        attachExportEventListeners();

        exportModal.show();
    };

    function initColumnList(todoState) {
        const columnList = document.getElementById('columnList');
        if (!columnList) return;

        // 检查当前选择的导出范围
        const exportRange = document.querySelector('input[name="exportRange"]:checked')?.value || 'all';
        
        // 根据导出范围选择列定义
        let columnDefs = COLUMN_DEFINITIONS;
        let defaultColumnOrder;
        
        if (exportRange === 'weekly') {
            // 周报模式：使用周报专用列定义
            columnDefs = WEEKLY_COLUMN_DEFINITIONS;
            defaultColumnOrder = Object.keys(WEEKLY_COLUMN_DEFINITIONS);
        } else {
            // 其他模式：使用标准列定义
            defaultColumnOrder = Object.keys(COLUMN_DEFINITIONS);
            if (todoState && todoState.columns && todoState.columns.length > 0) {
                defaultColumnOrder = todoState.columns;
            } else if (window.getPreviewState) {
                const previewState = window.getPreviewState();
                if (previewState && previewState.columns) {
                    defaultColumnOrder = previewState.columns;
                }
            }
        }
        
        columnList.innerHTML = '';

        defaultColumnOrder.forEach(colKey => {
            const colDef = columnDefs[colKey];
            if (!colDef) return;

            const li = document.createElement('li');
            li.className = 'column-item';
            li.dataset.columnKey = colKey;
            li.draggable = true;
            li.innerHTML = `
                <i class="fas fa-grip-vertical drag-icon"></i>
                <input type="checkbox" class="form-check-input column-checkbox" ${colDef.default ? 'checked' : ''} data-column-key="${colKey}">
                <span class="column-name">${colDef.label}</span>
            `;

            // 拖拽事件
            li.addEventListener('dragstart', (e) => {
                draggedColumnItem = colKey;
                li.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            li.addEventListener('dragend', () => {
                li.classList.remove('dragging');
                document.querySelectorAll('.column-item').forEach(item => item.classList.remove('drag-over'));
            });

            li.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (draggedColumnItem && draggedColumnItem !== colKey) {
                    document.querySelectorAll('.column-item').forEach(item => item.classList.remove('drag-over'));
                    li.classList.add('drag-over');
                }
            });

            li.addEventListener('drop', (e) => {
                e.preventDefault();
                if (draggedColumnItem && draggedColumnItem !== colKey) {
                    const allItems = Array.from(columnList.querySelectorAll('.column-item'));
                    const oldIndex = allItems.findIndex(item => item.dataset.columnKey === draggedColumnItem);
                    const newIndex = allItems.findIndex(item => item.dataset.columnKey === colKey);
                    
                    if (oldIndex !== -1 && newIndex !== -1) {
                        const oldItem = allItems[oldIndex];
                        if (newIndex > oldIndex) {
                            columnList.insertBefore(oldItem, allItems[newIndex].nextSibling);
                        } else {
                            columnList.insertBefore(oldItem, allItems[newIndex]);
                        }
                    }
                }
                document.querySelectorAll('.column-item').forEach(item => item.classList.remove('drag-over'));
            });

            columnList.appendChild(li);
        });
    }

    function attachExportEventListeners() {
        // 导出范围选项显示/隐藏
        const weeklyOptions = document.getElementById('weeklyOptions');
        const exportRangeRadios = document.querySelectorAll('input[name="exportRange"]');
        
        exportRangeRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.value === 'weekly') {
                    if (weeklyOptions) weeklyOptions.style.display = 'block';
                } else {
                    if (weeklyOptions) weeklyOptions.style.display = 'none';
                }
                // 当导出范围改变时，重新初始化列列表
                const todoState = window.getTodoState ? window.getTodoState() : null;
                initColumnList(todoState);
            });
        });

        // 表单提交
        const exportForm = document.getElementById('exportForm');
        if (exportForm) {
            exportForm.addEventListener('submit', handleExportSubmit);
        }

        // 预览按钮点击事件
        const previewBtn = document.getElementById('previewExportBtn');
        if (previewBtn) {
            previewBtn.addEventListener('click', handlePreviewExport);
        }
    }

    async function handleExportSubmit(e) {
        e.preventDefault();

        // 收集配置
        const exportRange = document.querySelector('input[name="exportRange"]:checked')?.value || 'all';
        const config = {
            exportRange: exportRange,
            includeCompletedTasks: exportRange === 'weekly' ? (document.getElementById('includeCompletedTasks')?.checked || false) : false,
            includeCompletedTaskUpdateTime: exportRange === 'weekly' ? (document.getElementById('includeCompletedTaskUpdateTime')?.checked || false) : false,
            columns: [],
            columnOrder: [],
            projectMode: document.querySelector('input[name="projectMode"]:checked').value,
            commentMode: document.querySelector('input[name="commentMode"]:checked').value,
            mergeProjectName: document.getElementById('mergeProjectName')?.checked || false,
            addGlobalIndex: document.getElementById('addGlobalIndex')?.checked || false,
            fileName: document.getElementById('exportFileName')?.value || null,
        };

        // 如果是导出当前预览，需要获取当前表格状态
        if (exportRange === 'preview') {
            const todoState = window.getTodoState ? window.getTodoState() : null;
            if (!todoState || todoState.currentStyle !== 'table') {
                alert('当前不在表格预览模式，无法导出当前预览');
                return;
            }
            const columns = todoState.columns || [];
            const filteredTasks = todoState.filteredTasks || [];
            if (filteredTasks.length === 0) {
                alert('当前预览没有数据可导出');
                return;
            }
            config.previewData = filteredTasks;
            config.columns = columns.filter(col => col !== 'actions');
            config.columnOrder = columns.filter(col => col !== 'actions');
        }

        // 如果不是导出当前预览，收集列配置
        if (exportRange !== 'preview') {
            const columnItems = document.querySelectorAll('.column-item');
            columnItems.forEach(item => {
                const colKey = item.dataset.columnKey;
                const checkbox = item.querySelector('.column-checkbox');
                if (checkbox && checkbox.checked) {
                    config.columns.push(colKey);
                    config.columnOrder.push(colKey);
                }
            });

            if (config.columns.length === 0) {
                alert('请至少选择一列进行导出');
                return;
            }
        }

        // 显示加载提示
        const submitBtn = exportForm.querySelector('button[type="submit"]');
        const originalText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在导出...';

        try {
            // 发送导出请求
            const response = await fetch('/api/todo/v2/export/excel', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(config),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '导出失败');
            }

            // 获取文件名
            const contentDisposition = response.headers.get('Content-Disposition');
            let filename = config.fileName || `todo_export_${new Date().toISOString().split('T')[0]}.xlsx`;
            if (contentDisposition && !config.fileName) {
                const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                if (filenameMatch && filenameMatch[1]) {
                    filename = filenameMatch[1].replace(/['"]/g, '');
                }
            }
            
            // 确保文件名有.xlsx扩展名
            if (!filename.endsWith('.xlsx')) {
                filename += '.xlsx';
            }

            // 下载文件
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);

            // 关闭模态框
            if (exportModal) {
                exportModal.hide();
            }

            // 显示成功提示
            if (window.showAlert) {
                window.showAlert('success', 'Excel文件导出成功！');
            } else {
                alert('Excel文件导出成功！');
            }
        } catch (error) {
            alert('导出失败：' + (error.message || String(error)));
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    }

    // 预览导出数据
    async function handlePreviewExport() {
        // 收集配置（复用handleExportSubmit的配置收集逻辑）
        const exportRange = document.querySelector('input[name="exportRange"]:checked')?.value || 'all';
        const config = {
            exportRange: exportRange,
            includeCompletedTasks: exportRange === 'weekly' ? (document.getElementById('includeCompletedTasks')?.checked || false) : false,
            includeCompletedTaskUpdateTime: exportRange === 'weekly' ? (document.getElementById('includeCompletedTaskUpdateTime')?.checked || false) : false,
            columns: [],
            columnOrder: [],
            projectMode: document.querySelector('input[name="projectMode"]:checked').value,
            commentMode: document.querySelector('input[name="commentMode"]:checked').value,
            mergeProjectName: document.getElementById('mergeProjectName')?.checked || false,
            addGlobalIndex: document.getElementById('addGlobalIndex')?.checked || false,
            fileName: document.getElementById('exportFileName')?.value || null,
        };

        // 如果是导出当前预览，需要获取当前表格状态
        if (exportRange === 'preview') {
            const todoState = window.getTodoState ? window.getTodoState() : null;
            if (!todoState || todoState.currentStyle !== 'table') {
                alert('当前不在表格预览模式，无法预览当前数据');
                return;
            }
            const columns = todoState.columns || [];
            const filteredTasks = todoState.filteredTasks || [];
            if (filteredTasks.length === 0) {
                alert('当前预览没有数据');
                return;
            }
            config.previewData = filteredTasks;
            config.columns = columns.filter(col => col !== 'actions');
            config.columnOrder = columns.filter(col => col !== 'actions');
        } else {
            // 收集列配置
            const columnItems = document.querySelectorAll('.column-item');
            columnItems.forEach(item => {
                const colKey = item.dataset.columnKey;
                const checkbox = item.querySelector('.column-checkbox');
                if (checkbox && checkbox.checked) {
                    config.columns.push(colKey);
                    config.columnOrder.push(colKey);
                }
            });

            if (config.columns.length === 0) {
                alert('请至少选择一列进行预览');
                return;
            }
        }

        // 显示加载提示
        const previewBtn = document.getElementById('previewExportBtn');
        const originalText = previewBtn.innerHTML;
        previewBtn.disabled = true;
        previewBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在加载预览...';

        try {
            // 发送预览请求
            const response = await fetch('/api/todo/v2/export/preview', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(config),
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || '预览失败');
            }

            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '预览失败');
            }

            // 使用sessionStorage存储预览数据（更可靠的方式）
            const previewDataKey = 'todo_export_preview_data_' + Date.now();
            sessionStorage.setItem(previewDataKey, JSON.stringify({
                data: result,
                config: config
            }));

            // 打开预览页面，通过URL参数传递数据key
            const previewUrl = `/todo/v2/export/preview?dataKey=${encodeURIComponent(previewDataKey)}`;
            window.open(previewUrl, '_blank');

        } catch (error) {
            console.error('预览失败:', error);
            alert('预览失败: ' + error.message);
        } finally {
            previewBtn.disabled = false;
            previewBtn.innerHTML = originalText;
        }
    }

    // 初始化
    document.addEventListener('DOMContentLoaded', () => {
        // 导出模态框已通过HTML定义，这里只需要确保事件绑定
    });
})();

