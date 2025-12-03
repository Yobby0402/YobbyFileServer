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

        // 获取当前界面的列顺序（优先从表格风格获取，否则使用默认顺序）
        let columnOrder = Object.keys(COLUMN_DEFINITIONS);
        if (todoState && todoState.columns && todoState.columns.length > 0) {
            columnOrder = todoState.columns;
        } else if (window.getPreviewState) {
            const previewState = window.getPreviewState();
            if (previewState && previewState.columns) {
                columnOrder = previewState.columns;
            }
        }

        columnList.innerHTML = '';

        columnOrder.forEach(colKey => {
            const colDef = COLUMN_DEFINITIONS[colKey];
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
        // 自定义时间范围显示/隐藏
        const customTimeRange = document.getElementById('customTimeRange');
        const timeRangeRadios = document.querySelectorAll('input[name="timeRange"]');
        
        timeRangeRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                if (radio.value === 'custom') {
                    customTimeRange.style.display = 'block';
                } else {
                    customTimeRange.style.display = 'none';
                }
            });
        });

        // 表单提交
        const exportForm = document.getElementById('exportForm');
        if (exportForm) {
            exportForm.addEventListener('submit', handleExportSubmit);
        }

        // 导出当前预览按钮
        const exportCurrentPreviewBtn = document.getElementById('exportCurrentPreviewBtn');
        if (exportCurrentPreviewBtn) {
            exportCurrentPreviewBtn.addEventListener('click', handleExportCurrentPreview);
        }
    }

    async function handleExportCurrentPreview(e) {
        e.preventDefault();

        // 获取当前状态
        const todoState = window.getTodoState ? window.getTodoState() : null;
        
        if (!todoState || todoState.currentStyle !== 'table') {
            alert('当前不在表格预览模式，无法导出当前预览');
            return;
        }

        // 获取当前表格的列顺序和筛选结果
        const columns = todoState.columns || [];
        const filteredTasks = todoState.filteredTasks || [];

        if (filteredTasks.length === 0) {
            alert('当前预览没有数据可导出');
            return;
        }

        // 只读取评论处理方式，其他参数不应用
        const commentMode = document.querySelector('input[name="commentMode"]:checked')?.value || 'inline';

        // 构建导出配置（使用当前预览的列顺序和筛选结果）
        const config = {
            timeRange: 'preview', // 特殊标记，表示使用预览数据
            previewData: filteredTasks, // 直接传递筛选后的任务数据
            columns: columns.filter(col => col !== 'actions'), // 排除操作列，使用当前表格的所有列
            columnOrder: columns.filter(col => col !== 'actions'), // 使用当前表格的列顺序
            projectMode: 'single', // 预览模式固定使用单sheet
            commentMode: commentMode, // 只应用评论处理方式
            fileName: document.getElementById('exportFileName')?.value || null,
        };

        // 显示加载提示
        const btn = e.target.closest('button');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在导出...';

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
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    async function handleExportSubmit(e) {
        e.preventDefault();

        // 收集配置
        const config = {
            timeRange: document.querySelector('input[name="timeRange"]:checked').value,
            customTimeRange: null,
            columns: [],
            columnOrder: [],
            projectMode: document.querySelector('input[name="projectMode"]:checked').value,
            commentMode: document.querySelector('input[name="commentMode"]:checked').value,
            fileName: document.getElementById('exportFileName')?.value || null,
        };

        // 自定义时间范围
        if (config.timeRange === 'custom') {
            const startDate = document.getElementById('customStartDate').value;
            const endDate = document.getElementById('customEndDate').value;
            const timeField = document.getElementById('customTimeField').value;
            if (startDate && endDate) {
                config.customTimeRange = {
                    start: startDate,
                    end: endDate,
                    field: timeField,
                };
            } else {
                alert('请选择自定义时间范围');
                return;
            }
        }

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
            alert('请至少选择一列进行导出');
            return;
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

    // 初始化
    document.addEventListener('DOMContentLoaded', () => {
        // 导出模态框已通过HTML定义，这里只需要确保事件绑定
    });
})();

