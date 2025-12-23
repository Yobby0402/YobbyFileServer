# 预览功能实现路径

## 功能需求
添加一个预览表格功能，跳转到一个新界面可以直接预览导出的结果。

## 实现方案

### 方案一：新窗口预览（推荐）

#### 1. 后端API端点
在 `routes.py` 中添加新的预览API端点：

```python
@app.route('/api/todo/v2/export/preview', methods=['POST'])
def todo_v2_export_preview():
    """预览导出数据（返回JSON格式）"""
    # 复用导出Excel的逻辑，但不生成Excel文件
    # 返回JSON格式的预览数据，包含：
    # - headers: 表头列表
    # - rows: 数据行列表（每行是一个字典或列表）
    # - metadata: 元数据（如项目数量、任务数量等）
    pass
```

#### 2. 前端预览页面
创建 `templates/todo_v2_export_preview.html`：
- 使用HTML表格展示数据
- 可以复用导出Excel的样式（表头、行样式等）
- 支持基本的样式美化（Bootstrap表格样式）

#### 3. 前端JavaScript修改
在 `static/js/todo_v2_export.js` 中：
- 在导出配置模态框中添加"预览"按钮
- 点击预览按钮时：
  1. 收集当前导出配置
  2. 发送POST请求到 `/api/todo/v2/export/preview`
  3. 接收JSON数据
  4. 使用 `window.open()` 打开新窗口
  5. 通过URL参数或postMessage传递数据到预览页面
  6. 预览页面渲染表格

#### 4. 数据传递方式
**方式A：URL参数（适合小数据量）**
- 将数据编码为URL参数（使用base64编码）
- 预览页面通过URL参数获取数据

**方式B：postMessage（推荐）**
- 新窗口打开后，父窗口通过 `postMessage` 发送数据
- 预览页面监听 `message` 事件接收数据

**方式C：Session Storage（推荐用于大数据量）**
- 将数据存储到 `sessionStorage`，使用唯一key
- 预览页面通过key从 `sessionStorage` 读取数据

### 方案二：模态框预览（简单但有限制）

在导出配置模态框中添加一个预览区域：
- 优点：实现简单，无需新页面
- 缺点：数据量大时可能卡顿，预览区域大小受限

### 推荐实现细节

#### 后端预览API实现要点：
1. **复用现有逻辑**：尽可能复用 `todo_v2_export_excel` 中的数据准备逻辑
2. **数据格式**：
```python
{
    "success": True,
    "data": {
        "headers": ["项目名称", "任务简述", ...],
        "rows": [
            {"project_name": "...", "summary": "...", ...},
            ...
        ],
        "metadata": {
            "project_count": 5,
            "task_count": 20,
            "export_range": "weekly",
            ...
        }
    }
}
```

3. **性能优化**：
   - 限制预览数据量（如最多1000行）
   - 使用分页（可选）

#### 前端预览页面实现要点：
1. **表格渲染**：
   - 使用Bootstrap表格组件
   - 支持列宽自适应
   - 支持固定表头（如果数据量大）

2. **样式**：
   - 复用导出Excel的样式（表头背景色、行交替色等）
   - 响应式设计，适配不同屏幕

3. **功能**：
   - 显示元数据（项目数、任务数等）
   - 提供"导出Excel"按钮（使用相同配置）
   - 支持打印

#### 数据传递推荐使用 postMessage：
```javascript
// 在导出配置模态框中
function handlePreview() {
    const config = collectExportConfig();
    fetch('/api/todo/v2/export/preview', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(config)
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            const previewWindow = window.open('/todo/v2/export/preview', '_blank');
            previewWindow.addEventListener('load', () => {
                previewWindow.postMessage(data.data, window.location.origin);
            });
        }
    });
}

// 在预览页面中
window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    renderPreviewTable(data.headers, data.rows, data.metadata);
});
```

## 实施步骤

1. **第一步**：创建后端预览API端点，返回JSON格式数据
2. **第二步**：创建预览HTML页面，实现表格渲染
3. **第三步**：在导出配置模态框中添加"预览"按钮
4. **第四步**：实现前端JavaScript逻辑，连接预览功能
5. **第五步**：测试和优化

## 注意事项

1. **数据量限制**：预览时可能需要限制数据量，避免浏览器卡顿
2. **样式一致性**：预览表格的样式应尽量与导出的Excel保持一致
3. **错误处理**：预览失败时要有友好的错误提示
4. **性能优化**：大数据量时考虑虚拟滚动或分页

