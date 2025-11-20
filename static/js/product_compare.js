/**
 * 产品对比功能 JavaScript
 */

// 全局状态
let currentFileId = null;
let currentFileData = null;
let radarChart = null;
let editingAttributeId = null;
let editingProductId = null;
let currentTab = 'attributes'; // 当前激活的tab
let selectedProductId = null; // 当前选中的产品ID

// 初始化
document.addEventListener('DOMContentLoaded', function() {
    initEventListeners();
    loadFileList();
});

// 初始化事件监听
function initEventListeners() {
    // 文件操作
    document.getElementById('newFileBtn').addEventListener('click', showNewFileModal);
    document.getElementById('openFileBtn').addEventListener('click', showOpenFileModal);
    document.getElementById('saveFileBtn').addEventListener('click', saveCurrentFile);
    document.getElementById('fileSelector').addEventListener('change', onFileSelect);
    document.getElementById('fileModalConfirmBtn').addEventListener('click', confirmFileModal);
    document.getElementById('deleteFileBtn').addEventListener('click', deleteCurrentFile);
    
    // 属性操作
    document.getElementById('attributeModalConfirmBtn').addEventListener('click', confirmAttributeModal);
    
    // 产品操作
    document.getElementById('addProductBtn').addEventListener('click', showAddProductModal);
    document.getElementById('productModalConfirmBtn').addEventListener('click', confirmProductModal);
}

// ===== 文件管理 =====

function loadFileList() {
    fetch('/api/product_compare/files')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const select = document.getElementById('fileSelector');
                select.innerHTML = '<option value="">-- 选择对比文件 --</option>';
                data.files.forEach(file => {
                    const option = document.createElement('option');
                    option.value = file.file_id;
                    // 修复问题7：使用实际的产品数量
                    const productCount = file.product_count || 0;
                    option.textContent = `${file.name} (${productCount}个产品)`;
                    select.appendChild(option);
                });
            }
        })
        .catch(err => {
            console.error('加载文件列表失败:', err);
            showAlert('加载文件列表失败', 'danger');
        });
}

function showNewFileModal() {
    editingAttributeId = null;
    editingProductId = null;
    document.getElementById('fileModalTitle').textContent = '新建产品对比';
    document.getElementById('fileNameInput').value = '';
    document.getElementById('fileListContainer').style.display = 'none';
    const modal = new bootstrap.Modal(document.getElementById('fileModal'));
    modal.show();
}

function showOpenFileModal() {
    loadFileList();
    document.getElementById('fileModalTitle').textContent = '打开产品对比';
    document.getElementById('fileNameInput').value = '';
    document.getElementById('fileListContainer').style.display = 'block';
    loadExistingFiles();
    const modal = new bootstrap.Modal(document.getElementById('fileModal'));
    modal.show();
}

function loadExistingFiles() {
    fetch('/api/product_compare/files')
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                const select = document.getElementById('existingFileSelect');
                select.innerHTML = '<option value="">-- 选择文件 --</option>';
                data.files.forEach(file => {
                    const option = document.createElement('option');
                    option.value = file.file_id;
                    option.textContent = `${file.name} (${file.product_count}个产品, ${file.attribute_count}个属性)`;
                    select.appendChild(option);
                });
            }
        });
}

function confirmFileModal() {
    const modalTitle = document.getElementById('fileModalTitle').textContent;
    const fileName = document.getElementById('fileNameInput').value.trim();
    const existingFileId = document.getElementById('existingFileSelect').value;
    
    if (modalTitle === '新建产品对比') {
        if (!fileName) {
            showAlert('请输入对比名称', 'warning');
            return;
        }
        createNewFile(fileName);
    } else {
        // 打开文件
        if (existingFileId) {
            openFile(existingFileId);
        } else if (fileName) {
            // 如果输入了名称，创建新文件
            createNewFile(fileName);
        } else {
            showAlert('请选择文件或输入名称', 'warning');
            return;
        }
    }
    
    bootstrap.Modal.getInstance(document.getElementById('fileModal')).hide();
}

function createNewFile(name) {
    fetch('/api/product_compare/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            currentFileId = data.file.file_id;
            currentFileData = data.file;
            loadFileList();
            renderFile();
            showAlert('文件创建成功', 'success');
        } else {
            showAlert(data.error || '创建失败', 'danger');
        }
    })
    .catch(err => {
        console.error('创建文件失败:', err);
        showAlert('创建文件失败', 'danger');
    });
}

function openFile(fileId) {
    fetch(`/api/product_compare/files/${fileId}`)
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                currentFileId = fileId;
                currentFileData = data.file;
                document.getElementById('fileSelector').value = fileId;
                renderFile();
                // 显示删除按钮
                document.getElementById('deleteFileBtn').style.display = 'block';
                // 修复问题7：更新文件列表以刷新产品数量
                loadFileList();
                showAlert('文件打开成功', 'success');
            } else {
                showAlert(data.error || '打开失败', 'danger');
            }
        })
        .catch(err => {
            console.error('打开文件失败:', err);
            showAlert('打开文件失败', 'danger');
        });
}

function onFileSelect() {
    const fileId = document.getElementById('fileSelector').value;
    if (fileId) {
        openFile(fileId);
        // 显示删除按钮
        document.getElementById('deleteFileBtn').style.display = 'block';
    } else {
        currentFileId = null;
        currentFileData = null;
        renderFile();
        // 隐藏删除按钮
        document.getElementById('deleteFileBtn').style.display = 'none';
    }
}

function deleteCurrentFile() {
    const fileId = currentFileId;
    if (!fileId) {
        showAlert('没有选中的文件', 'warning');
        return;
    }
    
    // 获取文件名用于确认
    const fileName = currentFileData ? currentFileData.name : '该文件';
    
    // 确认删除
    if (!confirm(`确定要删除对比文件"${fileName}"吗？\n\n此操作不可恢复！`)) {
        return;
    }
    
    fetch(`/api/product_compare/files/${fileId}`, {
        method: 'DELETE'
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            showAlert('文件删除成功', 'success');
            // 清空当前文件
            currentFileId = null;
            currentFileData = null;
            renderEmpty();
            // 刷新文件列表
            loadFileList();
        } else {
            showAlert(data.error || '删除失败', 'danger');
        }
    })
    .catch(err => {
        console.error('删除失败:', err);
        showAlert('删除失败', 'danger');
    });
}

function saveCurrentFile() {
    if (!currentFileId || !currentFileData) {
        showAlert('没有可保存的文件', 'warning');
        return;
    }
    
    fetch(`/api/product_compare/files/${currentFileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: currentFileData.name })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            currentFileData = data.file;
            showAlert('保存成功', 'success');
        } else {
            showAlert(data.error || '保存失败', 'danger');
        }
    })
    .catch(err => {
        console.error('保存失败:', err);
        showAlert('保存失败', 'danger');
    });
}

// ===== 渲染 =====

function renderFile() {
    if (!currentFileData) {
        renderEmpty();
        return;
    }
    
    document.getElementById('saveFileBtn').style.display = 'block';
    document.getElementById('addProductBtn').style.display = 'block';
    document.getElementById('tabNavigation').style.display = 'block';
    
    renderProductList();
    renderCurrentTab();
}

function renderEmpty() {
    document.getElementById('productList').innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">📦</div>
            <p>请先创建或打开一个产品对比文件</p>
        </div>
    `;
    document.getElementById('tabAttributes').innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">📋</div>
            <p>请先创建属性列表，然后添加产品</p>
        </div>
    `;
    document.getElementById('saveFileBtn').style.display = 'none';
    document.getElementById('addProductBtn').style.display = 'none';
    document.getElementById('tabNavigation').style.display = 'none';
    document.getElementById('deleteFileBtn').style.display = 'none';
    // 清空文件选择器
    document.getElementById('fileSelector').value = '';
}

function renderProductList() {
    const container = document.getElementById('productList');
    const products = currentFileData.products || [];
    
    if (products.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <p>暂无产品，点击"添加产品"开始</p>
            </div>
        `;
        return;
    }
    
    // 使用归属颜色作为左侧书签区域的颜色
    // 从文件数据中获取归属颜色映射
    const belongingColors = currentFileData.belonging_colors || {};
    
    container.innerHTML = products.map(product => {
        // 优先使用文件中的归属颜色，如果没有则使用产品颜色，最后使用默认颜色
        const belonging = product.belonging || '';
        const color = belongingColors[belonging] || product.color || '#36aa97';
        return `
        <div class="product-item" data-product-id="${product.id}" style="border-left: 8px solid ${color};">
            <input type="checkbox" class="product-checkbox" data-product-id="${product.id}">
            <span class="product-name" onclick="selectProduct('${product.id}')">${escapeHtml(product.name)}</span>
        </div>
    `;
    }).join('');
    
    // 绑定复选框事件
    container.querySelectorAll('.product-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', onProductCheckboxChange);
    });
}

// Tab 切换功能
function switchTab(tabName) {
    currentTab = tabName;
    
    // 更新tab导航状态
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
        if (link.dataset.tab === tabName) {
            link.classList.add('active');
        }
    });
    
    // 隐藏所有tab内容
    document.querySelectorAll('.tab-content').forEach(content => {
        content.style.display = 'none';
    });
    
    // 显示当前tab内容
    renderCurrentTab();
}

function renderCurrentTab() {
    if (!currentFileData) {
        return;
    }
    
    switch(currentTab) {
        case 'attributes':
            renderAttributesTab();
            break;
        case 'productDetail':
            renderProductDetailTab();
            break;
        case 'radar':
            renderRadarTab();
            break;
        case 'sort':
            renderSortTab();
            break;
    }
}

function renderAttributesTab() {
    const container = document.getElementById('tabAttributes');
    if (!container) return; // 防止容器不存在
    
    const attributes = currentFileData.attributes || [];
    // 按 order 排序
    const sortedAttributes = [...attributes].sort((a, b) => (a.order || 0) - (b.order || 0));
    
    container.innerHTML = `
        <div class="attribute-panel">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h5>属性列表</h5>
                <button type="button" class="btn btn-sm btn-primary" onclick="showAddAttributeModal()">
                    <i class="fas fa-plus"></i> 添加属性
                </button>
            </div>
            <div class="attribute-list" id="attributeList">
                ${sortedAttributes.map(attr => {
                    const unit = attr.unit ? ` (${escapeHtml(attr.unit)})` : '';
                    return `
                    <div class="attribute-item" data-attr-id="${attr.id}" draggable="true">
                        <i class="fas fa-grip-vertical" style="color: var(--jasmine-muted); cursor: move; margin-right: 10px;" title="拖拽排序"></i>
                        <input type="checkbox" ${attr.is_common ? 'checked' : ''} disabled>
                        <span style="min-width: 100px;">${escapeHtml(attr.name)}${unit}</span>
                        ${attr.is_common ? '<span class="badge-common">通用参数</span>' : ''}
                        ${attr.is_default ? '<span class="badge bg-secondary">默认</span>' : ''}
                        <div class="btn-group-compact ms-auto">
                            ${!attr.is_default ? `
                                <button class="btn btn-sm btn-outline-primary" onclick="editAttribute('${attr.id}')">
                                    <i class="fas fa-edit"></i>
                                </button>
                                <button class="btn btn-sm btn-outline-danger" onclick="deleteAttribute('${attr.id}')">
                                    <i class="fas fa-trash"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                `;
                }).join('')}
            </div>
        </div>
    `;
    
    // 初始化拖拽排序
    initAttributeDragSort();
    
    container.style.display = 'block';
    document.getElementById('rightPanelTitle').textContent = '属性管理';
}

// 初始化属性拖拽排序
function initAttributeDragSort() {
    const attributeList = document.getElementById('attributeList');
    if (!attributeList) return;
    
    let draggedElement = null;
    
    attributeList.querySelectorAll('.attribute-item').forEach(item => {
        item.addEventListener('dragstart', function(e) {
            draggedElement = this;
            this.style.opacity = '0.5';
            e.dataTransfer.effectAllowed = 'move';
        });
        
        item.addEventListener('dragend', function(e) {
            this.style.opacity = '1';
            // 清除所有拖拽样式
            attributeList.querySelectorAll('.attribute-item').forEach(el => {
                el.classList.remove('drag-over');
            });
        });
        
        item.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            if (draggedElement && this !== draggedElement) {
                const rect = this.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                
                if (e.clientY < midY) {
                    this.classList.add('drag-over');
                    this.classList.remove('drag-over-bottom');
                } else {
                    this.classList.add('drag-over-bottom');
                    this.classList.remove('drag-over');
                }
            }
        });
        
        item.addEventListener('dragleave', function(e) {
            this.classList.remove('drag-over', 'drag-over-bottom');
        });
        
        item.addEventListener('drop', function(e) {
            e.preventDefault();
            this.classList.remove('drag-over', 'drag-over-bottom');
            
            if (draggedElement && this !== draggedElement) {
                const rect = this.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                
                if (e.clientY < midY) {
                    attributeList.insertBefore(draggedElement, this);
                } else {
                    attributeList.insertBefore(draggedElement, this.nextSibling);
                }
                
                // 保存新的排序
                saveAttributeOrder();
            }
        });
    });
}

// 保存属性排序
function saveAttributeOrder() {
    const attributeList = document.getElementById('attributeList');
    if (!attributeList || !currentFileId) return;
    
    const items = Array.from(attributeList.querySelectorAll('.attribute-item'));
    const orders = items.map((item, index) => ({
        id: item.dataset.attrId,
        order: index
    }));
    
    fetch(`/api/product_compare/files/${currentFileId}/attributes/reorder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orders })
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            currentFileData = data.file;
            // 重新渲染产品表单以更新顺序
            if (editingProductId) {
                const product = currentFileData.products.find(p => p.id === editingProductId);
                if (product) {
                    renderProductForm(product);
                }
            }
        } else {
            showAlert(data.error || '排序保存失败', 'danger');
            // 重新渲染以恢复原顺序
            renderAttributesTab();
        }
    })
    .catch(err => {
        console.error('保存排序失败:', err);
        showAlert('排序保存失败', 'danger');
        renderAttributesTab();
    });
}

function renderProductDetailTab() {
    const container = document.getElementById('tabProductDetail');
    const emptyState = document.getElementById('productDetailEmptyState');
    const content = document.getElementById('productDetailContent');
    
    if (!container) return;
    
    container.style.display = 'block';
    
    if (selectedProductId) {
        // 有选中的产品，显示详情
        emptyState.style.display = 'none';
        content.style.display = 'block';
        renderProductDetail(selectedProductId);
    } else {
        // 没有选中的产品，显示提示
        emptyState.style.display = 'block';
        content.style.display = 'none';
        document.getElementById('rightPanelTitle').textContent = '产品详情';
    }
}

function renderRadarTab() {
    const container = document.getElementById('tabRadar');
    if (!container) return;
    
    const checkedProducts = Array.from(document.querySelectorAll('.product-checkbox:checked'))
        .map(cb => cb.dataset.productId);
    
    // 支持单个产品展示
    if (checkedProducts.length < 1) {
        const emptyState = document.getElementById('radarEmptyState');
        const chartContainer = document.getElementById('radarChartContainer');
        if (emptyState) {
            emptyState.innerHTML = `
                <div class="empty-state-icon">📊</div>
                <p>请至少选择1个产品进行展示</p>
                <p style="font-size: 0.9rem; color: var(--jasmine-muted); margin-top: 10px;">
                    在左侧产品列表中勾选1个或更多产品，雷达图将自动显示
                </p>
            `;
            emptyState.style.display = 'block';
        }
        if (chartContainer) chartContainer.style.display = 'none';
    } else {
        const emptyState = document.getElementById('radarEmptyState');
        const chartContainer = document.getElementById('radarChartContainer');
        if (emptyState) emptyState.style.display = 'none';
        if (chartContainer) chartContainer.style.display = 'block';
        renderCompareChart();
    }
    
    container.style.display = 'block';
    document.getElementById('rightPanelTitle').textContent = '雷达图对比';
}

function renderSortTab() {
    const container = document.getElementById('tabSort');
    if (!container) return;
    
    const attributes = currentFileData.attributes || [];
    const sortedAttributes = [...attributes].sort((a, b) => (a.order || 0) - (b.order || 0));
    
    if (attributes.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📊</div>
                <p>没有属性可排序，请先添加属性</p>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="mb-3">
                <label class="form-label">选择要显示的参数（可多选）：</label>
                <div class="attribute-select-list" style="max-height: 200px; overflow-y: auto; border: 1px solid rgba(95, 191, 174, 0.2); border-radius: 8px; padding: 10px;">
                    ${sortedAttributes.map(attr => {
                        const unit = attr.unit ? ` (${escapeHtml(attr.unit)})` : '';
                        return `
                        <div class="form-check">
                            <input class="form-check-input" type="checkbox" value="${attr.id}" id="sortAttr_${attr.id}" 
                                   ${attr.is_common ? '' : 'data-non-common="true"'} 
                                   onchange="updateSortTable()">
                            <label class="form-check-label" for="sortAttr_${attr.id}">
                                ${escapeHtml(attr.name)}${unit}
                            </label>
                        </div>
                    `;
                    }).join('')}
                    <!-- 归属选项 -->
                    <div class="form-check" style="margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(95, 191, 174, 0.2);">
                        <input class="form-check-input" type="checkbox" value="attr_belonging" id="sortAttr_belonging" 
                               onchange="updateSortTable()">
                        <label class="form-check-label" for="sortAttr_belonging">
                            归属
                        </label>
                    </div>
                </div>
            </div>
            <div id="sortResultContainer"></div>
        `;
    }
    
    container.style.display = 'block';
    document.getElementById('rightPanelTitle').textContent = '参数排序';
    
    // 初始化时显示所有通用参数（不包括归属）
    setTimeout(() => {
        const checkboxes = container.querySelectorAll('.form-check-input[data-non-common!="true"]:not([value="attr_belonging"])');
        checkboxes.forEach(cb => cb.checked = true);
        updateSortTable();
    }, 100);
}

// 问题5：显示参数排序（已整合到tab中，保留函数用于兼容）
function showAttributeSortPanel() {
    switchTab('sort');
}

// 全局变量：存储选中的参数和排序状态
let selectedSortAttributes = [];
let sortColumnOrder = [];
let sortColumnState = {}; // {attrId: {order: 'asc'|'desc'|null, index: 0}}

function updateSortTable() {
    const container = document.getElementById('sortResultContainer');
    if (!container) return;
    
    // 获取选中的参数（包括归属）
    const checkedBoxes = Array.from(document.querySelectorAll('#tabSort .form-check-input:checked'));
    selectedSortAttributes = checkedBoxes.map(cb => {
        const attrId = cb.value;
        // 如果是归属，创建一个特殊属性对象
        if (attrId === 'attr_belonging') {
            return {
                id: 'attr_belonging',
                name: '归属',
                is_common: false,
                is_default: true,
                unit: '',
                order: 9999 // 归属放在最后
            };
        }
        return currentFileData.attributes.find(a => a.id === attrId);
    }).filter(attr => attr);
    
    if (selectedSortAttributes.length === 0) {
        container.innerHTML = '<div class="alert alert-info">请至少选择一个参数</div>';
        return;
    }
    
    // 初始化列顺序（如果还没有）
    if (sortColumnOrder.length === 0 || sortColumnOrder.length !== selectedSortAttributes.length) {
        sortColumnOrder = selectedSortAttributes.map(attr => attr.id);
    } else {
        // 过滤掉已取消选择的列
        sortColumnOrder = sortColumnOrder.filter(id => selectedSortAttributes.some(attr => attr.id === id));
        // 添加新选择的列
        selectedSortAttributes.forEach(attr => {
            if (!sortColumnOrder.includes(attr.id)) {
                sortColumnOrder.push(attr.id);
            }
        });
    }
    
    const products = currentFileData.products || [];
    
    // 找出当前排序的列（通用参数）
    const sortColumn = Object.keys(sortColumnState).find(attrId => {
        const state = sortColumnState[attrId];
        return state && state.order && selectedSortAttributes.some(a => a.id === attrId && a.is_common);
    });
    
    // 如果有排序列，对产品进行排序
    let sortedProducts = [...products];
    if (sortColumn) {
        const state = sortColumnState[sortColumn];
        const attr = selectedSortAttributes.find(a => a.id === sortColumn);
        if (attr && attr.is_common) {
            sortedProducts.sort((a, b) => {
                const valA = a.attributes && a.attributes[sortColumn];
                const valB = b.attributes && b.attributes[sortColumn];
                const numA = valA !== undefined && valA !== null ? parseFloat(valA) : null;
                const numB = valB !== undefined && valB !== null ? parseFloat(valB) : null;
                
                if (numA === null && numB === null) return 0;
                if (numA === null) return 1;
                if (numB === null) return -1;
                
                if (state.order === 'desc') {
                    return numB - numA;
                } else {
                    return numA - numB;
                }
            });
        }
    }
    
    // 按列顺序生成表头
    const headers = sortColumnOrder.map(attrId => {
        const attr = selectedSortAttributes.find(a => a.id === attrId);
        return attr;
    }).filter(attr => attr);
    
    container.innerHTML = `
        <div style="overflow-x: auto; width: 100%;">
            <table class="table table-hover table-bordered" id="sortTable" style="width: 100%; table-layout: auto; margin: 0 auto;">
                <thead>
                    <tr>
                        <th style="position: sticky; left: 0; background: white; z-index: 10; text-align: center; min-width: 60px;">排名</th>
                        <th style="position: sticky; left: 60px; background: white; z-index: 10; text-align: center; min-width: 120px;">产品名称</th>
                        ${headers.map(attr => {
                            const unit = attr.unit ? ` (${escapeHtml(attr.unit)})` : '';
                            const state = sortColumnState[attr.id] || {};
                            const sortIcon = state.order === 'asc' ? '↑' : state.order === 'desc' ? '↓' : '';
                            const sortable = attr.is_common ? 'sortable-column' : '';
                            return `
                            <th class="${sortable}" data-attr-id="${attr.id}" 
                                style="text-align: center; white-space: nowrap; position: relative; ${attr.is_common ? 'cursor: pointer;' : ''}"
                                ${attr.is_common ? `onclick="sortByColumn('${attr.id}')" title="点击排序"` : ''}>
                                <span>${escapeHtml(attr.name)}${unit} ${sortIcon}</span>
                                <i class="fas fa-grip-vertical" style="float: right; color: var(--jasmine-muted); cursor: move; margin-left: 5px;" 
                                   draggable="true" ondragstart="onColumnDragStart(event, '${attr.id}')" 
                                   title="拖拽调整列顺序"></i>
                            </th>
                        `;
                        }).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${sortedProducts.map((product, index) => {
                        const color = product.color || '#ffffff';
                        return `
                        <tr style="border-left: 4px solid ${color};">
                            <td style="position: sticky; left: 0; background: white; text-align: center;"><strong>${index + 1}</strong></td>
                            <td style="position: sticky; left: 60px; background: white; text-align: center;">${escapeHtml(product.name)}</td>
                            ${headers.map(attr => {
                                let value = '';
                                if (attr.id === 'attr_name') {
                                    value = product.name || '';
                                } else if (attr.id === 'attr_belonging') {
                                    value = product.belonging || '';
                                } else {
                                    value = product.attributes && product.attributes[attr.id] !== undefined 
                                        ? product.attributes[attr.id] 
                                        : '';
                                }
                                return `<td style="text-align: center;">${escapeHtml(String(value))}</td>`;
                            }).join('')}
                        </tr>
                    `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
    
    // 初始化列拖拽
    initColumnDragSort();
}

// 按列排序
function sortByColumn(attrId) {
    const attr = selectedSortAttributes.find(a => a.id === attrId);
    if (!attr || !attr.is_common) return;
    
    // 切换排序状态：null -> asc -> desc -> null
    if (!sortColumnState[attrId]) {
        sortColumnState[attrId] = { order: 'asc', index: 0 };
    } else if (sortColumnState[attrId].order === 'asc') {
        sortColumnState[attrId].order = 'desc';
    } else if (sortColumnState[attrId].order === 'desc') {
        // 清除排序
        delete sortColumnState[attrId];
    }
    
    // 清除其他列的排序状态
    Object.keys(sortColumnState).forEach(id => {
        if (id !== attrId) {
            delete sortColumnState[id];
        }
    });
    
    updateSortTable();
}

// 初始化列拖拽排序
let draggedColumnId = null;

function onColumnDragStart(event, attrId) {
    draggedColumnId = attrId;
    event.dataTransfer.effectAllowed = 'move';
    event.stopPropagation();
}

function initColumnDragSort() {
    const table = document.getElementById('sortTable');
    if (!table) return;
    
    const headers = table.querySelectorAll('th[data-attr-id]');
    
    headers.forEach(header => {
        header.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            if (draggedColumnId && this.dataset.attrId !== draggedColumnId) {
                this.style.borderLeft = '3px solid var(--jasmine-green-500)';
            }
        });
        
        header.addEventListener('dragleave', function(e) {
            this.style.borderLeft = '';
        });
        
        header.addEventListener('drop', function(e) {
            e.preventDefault();
            this.style.borderLeft = '';
            
            if (draggedColumnId && this.dataset.attrId !== draggedColumnId) {
                const oldIndex = sortColumnOrder.indexOf(draggedColumnId);
                const newIndex = sortColumnOrder.indexOf(this.dataset.attrId);
                
                if (oldIndex !== -1 && newIndex !== -1) {
                    // 移动列顺序
                    sortColumnOrder.splice(oldIndex, 1);
                    sortColumnOrder.splice(newIndex, 0, draggedColumnId);
                    updateSortTable();
                }
            }
            draggedColumnId = null;
        });
    });
}

function hideAttributeSortPanel() {
    // 已整合到tab，此函数保留用于兼容
}

// 问题5：显示某个参数的对比
function showAttributeCompare(attrId) {
    const attr = currentFileData.attributes.find(a => a.id === attrId);
    if (!attr || !attr.is_common) return;
    
    switchTab('sort');
    // 等待DOM更新后设置选择
    setTimeout(() => {
        const select = document.getElementById('sortAttributeSelect');
        if (select) {
            select.value = attrId;
            renderAttributeSortList();
        }
    }, 100);
}

function renderProductDetail(productId) {
    const product = currentFileData.products.find(p => p.id === productId);
    if (!product) {
        selectedProductId = null;
        renderProductDetailTab();
        return;
    }
    
    const attributes = currentFileData.attributes || [];
    // 按 order 排序属性
    const sortedAttributes = [...attributes].sort((a, b) => (a.order || 0) - (b.order || 0));
    const container = document.getElementById('productDetailContent');
    
    if (!container) return;
    
    // 修复问题2：正确显示品名和归属
    container.innerHTML = `
        <div class="product-detail-panel">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h5>产品详情: ${escapeHtml(product.name)}</h5>
                <button type="button" class="btn btn-sm btn-primary" onclick="editProduct('${product.id}')">
                    <i class="fas fa-edit"></i> 编辑
                </button>
            </div>
            <div class="product-form">
                ${sortedAttributes.map(attr => {
                    let value = '';
                    // 修复问题2：正确获取品名、归属和链接
                    if (attr.id === 'attr_name') {
                        value = product.name || '';
                    } else if (attr.id === 'attr_belonging') {
                        value = product.belonging || '';
                    } else if (attr.id === 'attr_link') {
                        value = product.link || '';
                    } else {
                        value = product.attributes && product.attributes[attr.id] !== undefined 
                            ? product.attributes[attr.id] 
                            : '';
                    }
                    
                    // 修复问题3：显示单位
                    const unit = attr.unit ? ` (${escapeHtml(attr.unit)})` : '';
                    const unitLabel = attr.is_common && attr.unit ? unit : '';
                    
                    // 如果是链接属性，显示为可点击的按钮
                    if (attr.id === 'attr_link') {
                        const linkValue = value || '';
                        return `
                            <div class="form-group ${attr.is_default ? 'required' : ''}">
                                <label>${escapeHtml(attr.name)}${unitLabel}${attr.is_common ? ' <span class="badge-common">通用参数</span>' : ''}</label>
                                <div style="display: flex; gap: 10px; align-items: center;">
                                    <input type="text" 
                                           class="form-control" 
                                           value="${escapeHtml(linkValue)}" 
                                           disabled
                                           style="flex: 1;">
                                    ${linkValue ? `
                                        <a href="${escapeHtml(linkValue)}" target="_blank" class="btn btn-sm btn-primary" 
                                           title="${escapeHtml(linkValue)}">
                                            <i class="fas fa-external-link-alt"></i> 打开链接
                                        </a>
                                    ` : `
                                        <button type="button" class="btn btn-sm btn-outline-secondary" disabled>
                                            <i class="fas fa-link"></i> 无链接
                                        </button>
                                    `}
                                </div>
                                <small class="form-text text-muted">${linkValue ? '点击"打开链接"按钮可在新标签页中查看' : '该产品暂无链接'}</small>
                            </div>
                        `;
                    }
                    
                    return `
                        <div class="form-group ${attr.is_default ? 'required' : ''}">
                            <label>${escapeHtml(attr.name)}${unitLabel}${attr.is_common ? ' <span class="badge-common">通用参数</span>' : ''}</label>
                            <input type="${attr.type === 'number' ? 'number' : 'text'}" 
                                   class="form-control" 
                                   value="${escapeHtml(String(value))}" 
                                   ${attr.is_default ? 'required' : ''}
                                   ${attr.is_common ? 'step="0.01"' : ''}
                                   disabled>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
    `;
    
    document.getElementById('rightPanelTitle').textContent = `产品: ${escapeHtml(product.name)}`;
    
    // 高亮选中的产品
    document.querySelectorAll('.product-item').forEach(item => {
        item.classList.remove('selected');
        if (item.dataset.productId === productId) {
            item.classList.add('selected');
        }
    });
}

function renderCompareChart() {
    const checkedProducts = Array.from(document.querySelectorAll('.product-checkbox:checked'))
        .map(cb => cb.dataset.productId);
    
    // 支持单个产品展示
    if (checkedProducts.length < 1) {
        return;
    }
    
    const selectedProducts = currentFileData.products.filter(p => checkedProducts.includes(p.id));
    const commonAttributes = currentFileData.attributes.filter(attr => attr.is_common);
    
    if (commonAttributes.length === 0) {
        return;
    }
    
    // 修复问题1和6：计算每个属性的最大最小值，并找出优势产品
    // 归一化应该基于所有产品的最大最小值，而不是仅选中的产品
    const allProducts = currentFileData.products || [];
    const attrStats = commonAttributes.map(attr => {
        // 从所有产品中获取该属性的值，用于计算归一化的最大最小值
        const allValues = allProducts.map(product => {
            const val = product.attributes && product.attributes[attr.id];
            return val !== undefined && val !== null ? parseFloat(val) : null;
        }).filter(v => v !== null);
        
        // 从选中的产品中获取值，用于找出优势产品
        const selectedValues = selectedProducts.map(product => {
            const val = product.attributes && product.attributes[attr.id];
            return val !== undefined && val !== null ? parseFloat(val) : null;
        }).filter(v => v !== null);
        
        if (allValues.length === 0) {
            return { attr, min: 0, max: 100, bestProducts: [], bestValue: 0 };
        }
        
        // 使用所有产品的最大最小值进行归一化
        let min = Math.min(...allValues);
        let max = Math.max(...allValues);
        
        // 如果只有一个产品或所有值相同，需要扩展范围以避免所有值归一化到50
        // 如果min === max，扩展范围，让值显示在中间偏上的位置
        if (min === max) {
            // 如果值为0，设置min=-10, max=10
            if (min === 0) {
                min = -10;
                max = 10;
            } else {
                // 否则，以当前值为中心，扩展20%的范围
                const center = min;
                const range = Math.max(Math.abs(center) * 0.2, 1); // 至少扩展1
                min = center - range;
                max = center + range;
            }
        } else {
            // 如果有多个不同的值，扩展范围10%，让边界值不会贴边
            const range = max - min;
            const padding = range * 0.1; // 10%的边距
            min = min - padding;
            max = max + padding;
        }
        
        // 找出最优产品（根据direction判断，仅从选中的产品中找）
        let bestValue;
        let bestProducts = [];
        const actualValues = selectedValues.length > 0 ? selectedValues : allValues;
        
        if (actualValues.length === 0) {
            return { attr, min, max, bestProducts: [], bestValue: 0 };
        }
        
        if (attr.direction === 'higher') {
            bestValue = Math.max(...actualValues);
            selectedProducts.forEach((product) => {
                const val = product.attributes && product.attributes[attr.id];
                if (val !== undefined && val !== null && parseFloat(val) === bestValue) {
                    bestProducts.push(product.name);
                }
            });
        } else {
            bestValue = Math.min(...actualValues);
            selectedProducts.forEach((product) => {
                const val = product.attributes && product.attributes[attr.id];
                if (val !== undefined && val !== null && parseFloat(val) === bestValue) {
                    bestProducts.push(product.name);
                }
            });
        }
        
        return { attr, min, max, bestProducts, bestValue };
    });
    
    // 统计每个产品的最优项数量
    const productBestCounts = {};
    selectedProducts.forEach(product => {
        productBestCounts[product.name] = 0;
    });
    attrStats.forEach(stat => {
        stat.bestProducts.forEach(productName => {
            if (productBestCounts[productName] !== undefined) {
                productBestCounts[productName]++;
            }
        });
    });
    
    const unitLabels = commonAttributes.map(attr => {
        const unit = attr.unit ? ` (${escapeHtml(attr.unit)})` : '';
        return escapeHtml(attr.name) + unit;
    });
    
    // 生成优势总结HTML（放在下面）
    const advantageSummary = `
        <div style="margin-top: 20px; padding: 15px; background: var(--jasmine-green-100); border-radius: 8px;">
            <h6 style="margin-bottom: 10px; color: var(--jasmine-green-700);">📊 对比分析</h6>
            <div style="margin-bottom: 10px;">
                <strong>单项优势：</strong>
                <ul style="margin: 5px 0; padding-left: 20px;">
                    ${attrStats.map(stat => {
                        const directionText = stat.attr.direction === 'higher' ? '最大' : '最小';
                        const bestText = stat.bestProducts.length > 0 
                            ? stat.bestProducts.join('、') 
                            : '无';
                        return `<li>${escapeHtml(stat.attr.name)}：${directionText}值 ${stat.bestValue}${stat.attr.unit || ''} - <strong>${bestText}</strong></li>`;
                    }).join('')}
                </ul>
            </div>
            <div>
                <strong>产品最优项统计：</strong>
                <ul style="margin: 5px 0; padding-left: 20px;">
                    ${Object.entries(productBestCounts).map(([name, count]) => 
                        `<li><strong>${escapeHtml(name)}</strong>：${count}项最优</li>`
                    ).join('')}
                </ul>
            </div>
        </div>
    `;
    
    // 更新分析面板（放在下面）
    document.getElementById('radarAnalysisPanel').innerHTML = advantageSummary;
    
    // 将颜色转换为rgba格式的辅助函数
    function hexToRgba(hex, alpha) {
        if (!hex || (hex.length !== 7 && hex.length !== 4)) {
            hex = '#FF6B6B'; // 默认颜色
        }
        // 处理3位hex颜色
        if (hex.length === 4) {
            hex = '#' + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3];
        }
        // 确保是有效的hex颜色
        if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) {
            hex = '#FF6B6B';
        }
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    
    // 判断两个颜色是否太接近（用于避免颜色相似）
    function areColorsSimilar(color1, color2, threshold = 50) {
        if (!color1 || !color2) return false;
        
        // 确保颜色格式正确
        if (!color1.startsWith('#')) color1 = '#' + color1;
        if (!color2.startsWith('#')) color2 = '#' + color2;
        
        if (color1.length === 4) {
            color1 = '#' + color1[1] + color1[1] + color1[2] + color1[2] + color1[3] + color1[3];
        }
        if (color2.length === 4) {
            color2 = '#' + color2[1] + color2[1] + color2[2] + color2[2] + color2[3] + color2[3];
        }
        
        const r1 = parseInt(color1.slice(1, 3), 16);
        const g1 = parseInt(color1.slice(3, 5), 16);
        const b1 = parseInt(color1.slice(5, 7), 16);
        
        const r2 = parseInt(color2.slice(1, 3), 16);
        const g2 = parseInt(color2.slice(3, 5), 16);
        const b2 = parseInt(color2.slice(5, 7), 16);
        
        // 计算欧几里得距离
        const distance = Math.sqrt(
            Math.pow(r1 - r2, 2) + 
            Math.pow(g1 - g2, 2) + 
            Math.pow(b1 - b2, 2)
        );
        
        return distance < threshold;
    }
    
    // 默认颜色列表（差异明显的颜色，确保容易区分）
    const defaultColors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
        '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#E74C3C',
        '#3498DB', '#2ECC71', '#9B59B6', '#E67E22', '#1ABC9C',
        '#F39C12', '#E91E63', '#00BCD4', '#8BC34A', '#FF5722',
        '#795548', '#607D8B', '#FFC107', '#009688', '#3F51B5'
    ];
    
    // 准备数据 - 修复问题1：使用实际的最大最小值范围，每个属性独立归一化
    // 修复：不同产品使用不同颜色的多边形，确保每个产品都有明显的颜色
    // 为每个选中的产品分配差异明显的颜色
    const usedColors = new Set(); // 跟踪已使用的颜色
    
    // 计算每个产品的数值总和，用于排序（让数值小的先绘制，数值大的后绘制，这样大的在上面但小的也能看到）
    const productsWithSum = selectedProducts.map((product, index) => {
        const sum = commonAttributes.reduce((acc, attr) => {
            const value = product.attributes && product.attributes[attr.id];
            if (value !== undefined && value !== null) {
                return acc + parseFloat(value);
            }
            return acc;
        }, 0);
        return { product, sum, index };
    });
    
    // 按数值总和排序，大的在前（先绘制，在下面），小的在后（后绘制，会在上面）
    // 这样即使一个产品完全优于另一个，小的产品也会显示在上面
    productsWithSum.sort((a, b) => b.sum - a.sum);
    
    const datasets = productsWithSum.map(({ product, index: originalIndex }, mapIndex) => {
        // 优先使用产品颜色（归属颜色），但确保颜色差异明显
        let productColor = product.color;
        
        // 如果产品没有颜色或颜色无效，从默认颜色列表中选择
        if (!productColor || productColor === '#ffffff' || productColor === '#fff' || productColor === 'white') {
            // 从默认颜色列表中选择一个未使用的颜色（使用当前map的索引）
            let colorIndex = mapIndex;
            while (usedColors.has(defaultColors[colorIndex % defaultColors.length])) {
                colorIndex++;
            }
            productColor = defaultColors[colorIndex % defaultColors.length];
            usedColors.add(productColor);
        } else {
            // 如果产品有颜色，检查是否与已使用的颜色太接近
            // 如果太接近，使用默认颜色列表中的颜色
            const isTooClose = Array.from(usedColors).some(usedColor => {
                return areColorsSimilar(productColor, usedColor);
            });
            
            if (isTooClose && defaultColors.length > usedColors.size) {
                // 找一个差异明显的颜色
                for (let i = 0; i < defaultColors.length; i++) {
                    const candidateColor = defaultColors[i];
                    if (!usedColors.has(candidateColor)) {
                        const isSimilar = Array.from(usedColors).some(usedColor => {
                            return areColorsSimilar(candidateColor, usedColor);
                        });
                        if (!isSimilar) {
                            productColor = candidateColor;
                            break;
                        }
                    }
                }
            }
            usedColors.add(productColor);
        }
        
        // 确保颜色格式正确
        if (!productColor.startsWith('#')) {
            productColor = '#' + productColor;
        }
        
        // 修复：根据每个属性的最大最小值独立归一化
        // 每个参数按照该参数的已有数据最大值和最小值进行归一化
        // 例如：某个产品某个数据是6，这个参数所有产品对应的参数，最大值可能是10，最小值为1
        // 那么这个产品的这项数据应该归一化到：(6-1)/(10-1) * 100 = 55.56%
        const data = commonAttributes.map((attr, attrIdx) => {
            const value = product.attributes && product.attributes[attr.id];
            if (value === undefined || value === null) {
                // 如果没有值，返回-10（最小位置，对应雷达图中心）
                return -10;
            }
            
            // 获取该属性的统计信息（包含最大最小值，基于所有产品）
            const stat = attrStats[attrIdx];
            const min = stat.min;
            const max = stat.max;
            const range = max - min;
            
            if (range === 0 || range <= 0) {
                // 如果范围是0或无效，检查是否有值
                // 获取所有产品的该属性值
                const allAttrValues = allProducts.map(p => {
                    const val = p.attributes && p.attributes[attr.id];
                    return val !== undefined && val !== null ? parseFloat(val) : null;
                }).filter(v => v !== null);
                
                if (allAttrValues.length > 0 && allAttrValues[0] !== null) {
                    return 45; // 中间偏上位置
                }
                return -10; // 没有值，返回最小值
            }
            
            // 归一化：每个参数独立使用该参数的最大最小值（基于所有产品）
            // 公式：(value - min) / (max - min) * 110 - 10
            // 映射到-10到100的范围（雷达图从-10开始）
            const normalized = ((parseFloat(value) - min) / range) * 110 - 10;
            // 确保在-10到100范围内
            return Math.max(-10, Math.min(100, normalized));
        });
        
        const borderColor = hexToRgba(productColor, 1);
        // 进一步降低填充透明度，确保叠加时所有产品都可见
        // 使用更低的透明度（0.2），让叠加区域更透明，能看到下面的产品
        const backgroundColor = hexToRgba(productColor, 0.2);
        
        return {
            label: product.name,
            data: data,
            borderColor: borderColor,
            backgroundColor: backgroundColor,
            borderWidth: 3, // 增加边框宽度，确保边框清晰可见
            pointBackgroundColor: borderColor,
            pointBorderColor: '#fff',
            pointHoverBackgroundColor: '#fff',
            pointHoverBorderColor: borderColor,
            pointRadius: 5,
            pointHoverRadius: 7,
            fill: true, // 确保填充多边形区域
            // 添加边框样式，让叠加时更容易区分
            borderJoinStyle: 'round',
            borderCapStyle: 'round',
            // 使用不同的填充模式，让叠加更明显
            order: mapIndex // 确保绘制顺序正确
        };
    });
    
    // 确保数据集按order排序，小的产品在上面（后绘制，order值大）
    // 由于我们已经按数值总和从大到小排序了productsWithSum，mapIndex小的对应数值大的产品
    // 所以order值小的（数值大的）先绘制，order值大的（数值小的）后绘制，这样小的会在上面
    const sortedDatasets = [...datasets].sort((a, b) => (a.order || 0) - (b.order || 0));
    
    // 创建雷达图
    const ctx = document.getElementById('radarChart').getContext('2d');
    if (radarChart) {
        radarChart.destroy();
    }
    
    radarChart = new Chart(ctx, {
        type: 'radar',
        data: {
            labels: unitLabels,
            datasets: sortedDatasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            elements: {
                line: {
                    borderWidth: 3,
                    tension: 0.1
                },
                point: {
                    radius: 5,
                    hoverRadius: 7,
                    borderWidth: 2
                }
            },
            scales: {
                r: {
                    beginAtZero: false, // 不从0开始
                    max: 100,
                    min: -10, // 从-10开始，避免最差产品多边形聚集到一个点
                    ticks: {
                        stepSize: 20,
                        showLabelBackdrop: false,
                        color: 'rgba(0, 0, 0, 0.6)'
                    },
                    pointLabels: {
                        font: {
                            size: 12
                        },
                        color: 'rgba(0, 0, 0, 0.8)'
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    },
                    angleLines: {
                        color: 'rgba(0, 0, 0, 0.1)'
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        padding: 15,
                        usePointStyle: true,
                        font: {
                            size: 12
                        },
                        generateLabels: function(chart) {
                            const original = Chart.defaults.plugins.legend.labels.generateLabels;
                            const labels = original.call(this, chart);
                            // 确保图例显示正确的颜色
                            labels.forEach((label, index) => {
                                if (datasets[index]) {
                                    label.fillStyle = datasets[index].backgroundColor;
                                    label.strokeStyle = datasets[index].borderColor;
                                }
                            });
                            return labels;
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const attr = commonAttributes[context.dataIndex];
                            // 找到对应的产品
                            const product = selectedProducts.find(p => p.name === context.dataset.label);
                            const rawValue = product && product.attributes ? product.attributes[attr.id] : undefined;
                            const unit = attr.unit ? ` ${attr.unit}` : '';
                            const stat = attrStats[context.dataIndex];
                            // 显示实际值和归一化值
                            const normalizedValue = context.parsed.r;
                            return `${context.dataset.label}: ${rawValue !== undefined ? rawValue : 'N/A'}${unit} (范围: ${stat.min.toFixed(1)}-${stat.max.toFixed(1)}, 归一化: ${normalizedValue.toFixed(1)})`;
                        }
                    }
                }
            }
        }
    });
}

// ===== 属性管理 =====

function showAddAttributeModal() {
    editingAttributeId = null;
    document.getElementById('attributeModalTitle').textContent = '添加属性';
    document.getElementById('attributeNameInput').value = '';
    document.getElementById('attributeIsCommonCheck').checked = false;
    document.getElementById('attributeUnitInput').value = '';
    document.getElementById('attributeDirectionSelect').value = 'higher';
    updateAttributeModalVisibility();
    const modal = new bootstrap.Modal(document.getElementById('attributeModal'));
    modal.show();
}

function updateAttributeModalVisibility() {
    const isCommon = document.getElementById('attributeIsCommonCheck').checked;
    document.getElementById('attributeUnitGroup').style.display = isCommon ? 'block' : 'none';
    document.getElementById('attributeDirectionGroup').style.display = isCommon ? 'block' : 'none';
}

// 绑定通用参数复选框变化事件
document.addEventListener('DOMContentLoaded', function() {
    const commonCheck = document.getElementById('attributeIsCommonCheck');
    if (commonCheck) {
        commonCheck.addEventListener('change', updateAttributeModalVisibility);
    }
});

function editAttribute(attrId) {
    const attr = currentFileData.attributes.find(a => a.id === attrId);
    if (!attr) return;
    
    editingAttributeId = attrId;
    document.getElementById('attributeModalTitle').textContent = '编辑属性';
    document.getElementById('attributeNameInput').value = attr.name;
    document.getElementById('attributeIsCommonCheck').checked = attr.is_common;
    document.getElementById('attributeIsCommonCheck').disabled = attr.is_default;
    document.getElementById('attributeUnitInput').value = attr.unit || '';
    document.getElementById('attributeDirectionSelect').value = attr.direction || 'higher';
    updateAttributeModalVisibility();
    const modal = new bootstrap.Modal(document.getElementById('attributeModal'));
    modal.show();
}

function confirmAttributeModal() {
    const name = document.getElementById('attributeNameInput').value.trim();
    const isCommon = document.getElementById('attributeIsCommonCheck').checked;
    const unit = document.getElementById('attributeUnitInput').value.trim();
    const direction = document.getElementById('attributeDirectionSelect').value;
    
    if (!name) {
        showAlert('请输入属性名称', 'warning');
        return;
    }
    
    const url = editingAttributeId
        ? `/api/product_compare/files/${currentFileId}/attributes/${editingAttributeId}`
        : `/api/product_compare/files/${currentFileId}/attributes`;
    
    const method = editingAttributeId ? 'PUT' : 'POST';
    const body = {
        name,
        is_common: isCommon,
        type: isCommon ? 'number' : 'text',
        unit: isCommon ? unit : '',
        direction: isCommon ? direction : 'higher'
    };
    
    fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            currentFileData = data.file;
            renderProductList();
            renderCurrentTab(); // 重新渲染当前tab
            bootstrap.Modal.getInstance(document.getElementById('attributeModal')).hide();
            showAlert(editingAttributeId ? '属性更新成功' : '属性添加成功', 'success');
            editingAttributeId = null;
        } else {
            showAlert(data.error || '操作失败', 'danger');
        }
    })
    .catch(err => {
        console.error('操作失败:', err);
        showAlert('操作失败', 'danger');
    });
}

function deleteAttribute(attrId) {
    if (!confirm('确定要删除这个属性吗？所有产品的该属性值也将被删除。')) {
        return;
    }
    
    fetch(`/api/product_compare/files/${currentFileId}/attributes/${attrId}`, {
        method: 'DELETE'
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            currentFileData = data.file;
            renderProductList();
            renderCurrentTab(); // 重新渲染当前tab
            showAlert('属性删除成功', 'success');
        } else {
            showAlert(data.error || '删除失败', 'danger');
        }
    })
    .catch(err => {
        console.error('删除失败:', err);
        showAlert('删除失败', 'danger');
    });
}

// ===== 产品管理 =====

function selectProduct(productId) {
    // 设置选中的产品ID
    selectedProductId = productId;
    // 切换到产品详情tab
    switchTab('productDetail');
}

function showAddProductModal() {
    editingProductId = null;
    document.getElementById('productModalTitle').textContent = '添加产品';
    renderProductForm();
    const modal = new bootstrap.Modal(document.getElementById('productModal'));
    modal.show();
}

function editProduct(productId) {
    const product = currentFileData.products.find(p => p.id === productId);
    if (!product) return;
    
    editingProductId = productId;
    document.getElementById('productModalTitle').textContent = '编辑产品';
    renderProductForm(product);
    const modal = new bootstrap.Modal(document.getElementById('productModal'));
    modal.show();
}

// 全局变量：存储已有归属列表
let existingBelongings = [];

function renderProductForm(product = null) {
    const attributes = currentFileData.attributes || [];
    // 按 order 排序属性
    const sortedAttributes = [...attributes].sort((a, b) => (a.order || 0) - (b.order || 0));
    const container = document.getElementById('productModalBody');
    
    // 获取已有归属列表（包含颜色信息）
    existingBelongings = [];
    let currentBelongingColor = '#36aa97';
    if (currentFileId) {
        fetch(`/api/product_compare/files/${currentFileId}/belongings`)
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    existingBelongings = data.belongings;
                    updateBelongingInput(existingBelongings, product);
                    // 如果编辑产品，设置当前归属的颜色
                    if (product && product.belonging) {
                        const belongingInfo = existingBelongings.find(b => 
                            (typeof b === 'string' ? b : b.name) === product.belonging
                        );
                        if (belongingInfo && typeof belongingInfo === 'object' && belongingInfo.color) {
                            currentBelongingColor = belongingInfo.color;
                            updateBelongingColorDisplay(currentBelongingColor);
                        }
                    }
                }
            });
    }
    
    container.innerHTML = `
        <div class="product-form">
            ${sortedAttributes.map(attr => {
                const isDefault = attr.id === 'attr_name' || attr.id === 'attr_belonging' || attr.id === 'attr_link';
                let value = '';
                
                // 获取属性值
                if (attr.id === 'attr_name') {
                    value = product ? product.name : '';
                } else if (attr.id === 'attr_belonging') {
                    value = product ? product.belonging : '';
                } else if (attr.id === 'attr_link') {
                    value = product ? (product.link || '') : '';
                } else {
                    value = product && product.attributes && product.attributes[attr.id] !== undefined
                        ? product.attributes[attr.id]
                        : '';
                }
                
                if (attr.id === 'attr_name') {
                    return `
                        <div class="form-group required">
                            <label>${escapeHtml(attr.name)}</label>
                            <input type="text" class="form-control" id="product_${attr.id}" 
                                   value="${escapeHtml(product ? product.name : '')}" required>
                        </div>
                    `;
                } else if (attr.id === 'attr_belonging') {
                    // 添加归属选择功能和颜色选择
                    return `
                        <div class="form-group required">
                            <label>${escapeHtml(attr.name)}</label>
                            <div style="display: flex; gap: 10px; margin-bottom: 10px;">
                                <input type="text" class="form-control" id="product_${attr.id}" 
                                       value="${escapeHtml(product ? product.belonging : '')}" 
                                       list="belongingList" required
                                       onchange="updateBelongingColor()">
                                <datalist id="belongingList">
                                    ${existingBelongings.map(b => `<option value="${escapeHtml(typeof b === 'string' ? b : b.name)}">`).join('')}
                                </datalist>
                                <div class="form-check" style="display: flex; align-items: center;">
                                    <input class="form-check-input" type="checkbox" id="belongingSelectCheck" 
                                           ${existingBelongings.length > 0 ? '' : 'disabled'}>
                                    <label class="form-check-label" for="belongingSelectCheck" style="white-space: nowrap; margin-left: 5px;">
                                        选择已有
                                    </label>
                                </div>
                            </div>
                            <select class="form-select" id="belongingSelect" style="display: none; margin-bottom: 10px;" onchange="onBelongingSelectChange()">
                                <option value="">-- 选择归属 --</option>
                                ${existingBelongings.map(b => {
                                    const name = typeof b === 'string' ? b : b.name;
                                    const color = typeof b === 'string' ? '' : (b.color || '');
                                    return `<option value="${escapeHtml(name)}" data-color="${escapeHtml(color)}">${escapeHtml(name)}</option>`;
                                }).join('')}
                            </select>
                            <div class="form-group">
                                <label>归属颜色（用于产品列表和雷达图显示）</label>
                                <div style="display: flex; gap: 10px; align-items: center;">
                                    <input type="color" class="form-control form-control-color" id="belongingColorPicker" 
                                           value="#36aa97" 
                                           style="width: 60px; height: 40px; cursor: pointer;"
                                           onchange="onBelongingColorChange()">
                                    <input type="text" class="form-control" id="belongingColorInput" 
                                           value="#36aa97" 
                                           placeholder="#36aa97" style="flex: 1;"
                                           onchange="onBelongingColorInputChange()">
                                    <button type="button" class="btn btn-outline-secondary" id="randomBelongingColorBtn" title="随机颜色" onclick="randomBelongingColor()">
                                        <i class="fas fa-dice"></i> 随机
                                    </button>
                                </div>
                                <small class="form-text text-muted">选择颜色用于产品列表左侧书签和雷达图显示，建议选择对比明显的颜色</small>
                            </div>
                        </div>
                    `;
                } else {
                    // 问题3：显示单位
                    const unit = attr.unit ? ` (${escapeHtml(attr.unit)})` : '';
                    return `
                        <div class="form-group">
                            <label>${escapeHtml(attr.name)}${unit}${attr.is_common ? ' <span class="badge-common">通用参数</span>' : ''}</label>
                            <input type="${attr.type === 'number' ? 'number' : 'text'}" 
                                   class="form-control" 
                                   id="product_${attr.id}" 
                                   value="${escapeHtml(value)}"
                                   ${attr.is_common ? 'step="0.01"' : ''}
                                   placeholder="${attr.is_common ? '请输入数值' : '可选'}">
                        </div>
                    `;
                }
            }).join('')}
            <!-- 产品链接 - 始终显示，即使产品没有 link 字段 -->
            <div class="form-group" style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(95, 191, 174, 0.2);">
                <label><i class="fas fa-link"></i> 产品链接（可选）</label>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <input type="text" class="form-control" id="productLink" 
                           value="${(product && product.link) ? (() => {
                               // 如果是 view_file 路径，还原为原始路径用于编辑
                               let link = product.link;
                               if (link.startsWith('/view_file?filepath=')) {
                                   try {
                                       link = decodeURIComponent(link.replace('/view_file?filepath=', ''));
                                   } catch(e) {
                                       // 如果解码失败，使用原始链接
                                   }
                               }
                               return link;
                           })() : ''}" 
                           placeholder="输入链接地址（支持外部URL、本地文件路径或分享链接）">
                    <button type="button" class="btn btn-outline-secondary" id="browseFileBtn" title="浏览本地文件">
                        <i class="fas fa-folder-open"></i>
                    </button>
                </div>
                <small class="form-text text-muted">
                    支持格式：<br>
                    • 外部链接：https://example.com<br>
                    • 本地文件：相对路径（如：datasheets/product.pdf）<br>
                    • 分享链接：/share/xxxxx
                </small>
            </div>
        </div>
    `;
    
    // 绑定归属选择事件
    const belongingCheck = document.getElementById('belongingSelectCheck');
    const belongingSelect = document.getElementById('belongingSelect');
    const belongingInput = document.getElementById('product_attr_belonging');
    
    if (belongingCheck && belongingSelect && belongingInput) {
        belongingCheck.addEventListener('change', function() {
            if (this.checked) {
                belongingSelect.style.display = 'block';
                belongingInput.style.display = 'none';
            } else {
                belongingSelect.style.display = 'none';
                belongingInput.style.display = 'block';
            }
        });
    }
    
    // 绑定文件浏览按钮（打开文件浏览器选择文件）
    const browseFileBtn = document.getElementById('browseFileBtn');
    if (browseFileBtn) {
        browseFileBtn.addEventListener('click', function() {
            // 打开新窗口显示文件浏览器
            const fileBrowserUrl = window.location.origin + '/';
            window.open(fileBrowserUrl, '_blank', 'width=1200,height=800');
        });
    }
}

// 归属颜色相关函数
function updateBelongingColor() {
    const belongingInput = document.getElementById('product_attr_belonging');
    if (!belongingInput) return;
    
    const belonging = belongingInput.value.trim();
    if (!belonging) return;
    
    // 查找该归属的颜色
    const belongingInfo = existingBelongings.find(b => 
        (typeof b === 'string' ? b : b.name) === belonging
    );
    
    if (belongingInfo && typeof belongingInfo === 'object' && belongingInfo.color) {
        // 如果找到已有归属，使用其颜色
        updateBelongingColorDisplay(belongingInfo.color);
    } else {
        // 如果是新归属，生成随机颜色
        randomBelongingColor();
    }
}

function onBelongingSelectChange() {
    const belongingSelect = document.getElementById('belongingSelect');
    const belongingInput = document.getElementById('product_attr_belonging');
    
    if (!belongingSelect || !belongingInput) return;
    
    if (belongingSelect.value) {
        belongingInput.value = belongingSelect.value;
        
        // 获取选中归属的颜色
        const selectedOption = belongingSelect.options[belongingSelect.selectedIndex];
        const color = selectedOption.dataset.color;
        if (color) {
            updateBelongingColorDisplay(color);
        } else {
            randomBelongingColor();
        }
    }
}

function onBelongingColorChange() {
    const colorPicker = document.getElementById('belongingColorPicker');
    const colorInput = document.getElementById('belongingColorInput');
    if (colorPicker && colorInput) {
        colorInput.value = colorPicker.value;
    }
}

function onBelongingColorInputChange() {
    const colorPicker = document.getElementById('belongingColorPicker');
    const colorInput = document.getElementById('belongingColorInput');
    if (colorPicker && colorInput) {
        const color = colorInput.value.trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
            colorPicker.value = color;
        }
    }
}

function updateBelongingColorDisplay(color) {
    const colorPicker = document.getElementById('belongingColorPicker');
    const colorInput = document.getElementById('belongingColorInput');
    if (colorPicker && colorInput && color) {
        colorPicker.value = color;
        colorInput.value = color;
    }
}

function randomBelongingColor() {
    // 生成随机颜色（差异明显的颜色列表）
    const randomColors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
        '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#E74C3C',
        '#3498DB', '#2ECC71', '#9B59B6', '#E67E22', '#1ABC9C',
        '#F39C12', '#E91E63', '#00BCD4', '#8BC34A', '#FF5722',
        '#795548', '#607D8B', '#FFC107', '#009688', '#3F51B5'
    ];
    const randomColor = randomColors[Math.floor(Math.random() * randomColors.length)];
    updateBelongingColorDisplay(randomColor);
}

function updateBelongingInput(belongings, product) {
    const datalist = document.getElementById('belongingList');
    const select = document.getElementById('belongingSelect');
    const check = document.getElementById('belongingSelectCheck');
    
    if (datalist) {
        datalist.innerHTML = belongings.map(b => {
            const name = typeof b === 'string' ? b : b.name;
            return `<option value="${escapeHtml(name)}">`;
        }).join('');
    }
    if (select) {
        select.innerHTML = '<option value="">-- 选择归属 --</option>' + 
            belongings.map(b => {
                const name = typeof b === 'string' ? b : b.name;
                const color = typeof b === 'string' ? '' : (b.color || '');
                return `<option value="${escapeHtml(name)}" data-color="${escapeHtml(color)}">${escapeHtml(name)}</option>`;
            }).join('');
        if (product && product.belonging) {
            select.value = product.belonging;
            // 设置颜色
            const belongingInfo = belongings.find(b => 
                (typeof b === 'string' ? b : b.name) === product.belonging
            );
            if (belongingInfo && typeof belongingInfo === 'object' && belongingInfo.color) {
                updateBelongingColorDisplay(belongingInfo.color);
            }
        }
    }
    if (check) {
        check.disabled = belongings.length === 0;
    }
}

function confirmProductModal() {
    const attributes = currentFileData.attributes || [];
    const productData = {
        name: document.getElementById('product_attr_name').value.trim(),
        belonging: document.getElementById('product_attr_belonging').value.trim(),
        attributes: {}
    };
    
    if (!productData.name || !productData.belonging) {
        showAlert('品名和归属为必填项', 'warning');
        return;
    }
    
    // 获取产品链接（从链接属性输入框获取）
    const linkInput = document.getElementById('product_attr_link');
    if (linkInput) {
        const linkValue = linkInput.value.trim();
        if (linkValue) {
            let link = linkValue;
            // 处理本地文件路径：如果不是完整URL或分享链接，转换为文件服务器路径
            if (!link.startsWith('http://') && !link.startsWith('https://') && !link.startsWith('/share/')) {
                // 本地文件路径，转换为文件服务器访问路径
                if (!link.startsWith('/')) {
                    link = '/' + link;
                }
                // 转换为 view_file 路径
                link = '/view_file?filepath=' + encodeURIComponent(link);
            }
            productData.link = link;
        } else {
            // 如果链接为空，传递空字符串以删除链接
            productData.link = '';
        }
    }
    
    // 获取归属颜色
    const colorInput = document.getElementById('belongingColorInput');
    if (colorInput) {
        let color = colorInput.value.trim();
        // 确保颜色格式正确
        if (!color.startsWith('#')) {
            color = '#' + color;
        }
        // 验证颜色格式
        if (/^#[0-9A-Fa-f]{6}$/.test(color)) {
            // 保存归属颜色
            fetch(`/api/product_compare/files/${currentFileId}/belongings/${encodeURIComponent(productData.belonging)}/color`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ color: color })
            })
            .then(res => res.json())
            .then(data => {
                if (data.success) {
                    currentFileData = data.file;
                }
            })
            .catch(err => {
                console.error('保存归属颜色失败:', err);
            });
        }
    }
    
    // 收集其他属性值（不包括默认属性：品名、归属、链接）
    attributes.forEach(attr => {
        if (attr.id !== 'attr_name' && attr.id !== 'attr_belonging' && attr.id !== 'attr_link') {
            const input = document.getElementById(`product_${attr.id}`);
            if (input && input.value.trim() !== '') {
                productData.attributes[attr.id] = input.value.trim();
            }
        }
    });
    
    const url = editingProductId
        ? `/api/product_compare/files/${currentFileId}/products/${editingProductId}`
        : `/api/product_compare/files/${currentFileId}/products`;
    
    const method = editingProductId ? 'PUT' : 'POST';
    
    fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(productData)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            currentFileData = data.file;
            renderProductList();
            renderCurrentTab(); // 重新渲染当前tab
            // 修复问题7：更新文件列表以刷新产品数量
            loadFileList();
            bootstrap.Modal.getInstance(document.getElementById('productModal')).hide();
            showAlert(editingProductId ? '产品更新成功' : '产品添加成功', 'success');
            editingProductId = null;
        } else {
            showAlert(data.error || '操作失败', 'danger');
        }
    })
    .catch(err => {
        console.error('操作失败:', err);
        showAlert('操作失败', 'danger');
    });
}

function onProductCheckboxChange(e) {
    const checkedCount = document.querySelectorAll('.product-checkbox:checked').length;
    // 如果当前在雷达图tab，自动更新雷达图
    if (currentTab === 'radar') {
        renderRadarTab();
    }
}

function exportRadarChart() {
    if (!radarChart) {
        showAlert('没有可导出的图表', 'warning');
        return;
    }
    
    const url = radarChart.toBase64Image('image/png');
    const link = document.createElement('a');
    link.download = `产品对比雷达图_${new Date().getTime()}.png`;
    link.href = url;
    link.click();
}

// ===== 工具函数 =====

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showAlert(message, type = 'info') {
    // 简单的提示实现，可以后续优化
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show`;
    alertDiv.style.position = 'fixed';
    alertDiv.style.top = '20px';
    alertDiv.style.right = '20px';
    alertDiv.style.zIndex = '9999';
    alertDiv.style.minWidth = '300px';
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    document.body.appendChild(alertDiv);
    
    setTimeout(() => {
        alertDiv.remove();
    }, 3000);
}

