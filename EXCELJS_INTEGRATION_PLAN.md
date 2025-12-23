# ExcelJS集成方案

## 你的方案分析

你的想法是可行的！但需要注意几点：

### ExcelJS的特点
- **ExcelJS是一个JavaScript库**，主要用于在浏览器或Node.js中生成Excel文件
- 它可以在浏览器端直接使用，不需要服务器端支持
- 但ExcelJS本身**不能直接预览Excel文件**，它主要是用来**生成Excel文件**

### 最佳实现方案

#### 方案A：ExcelJS + HTML表格预览（推荐）

1. **后端预览API**：返回JSON格式的数据（表头、数据行）
2. **前端预览页面**：
   - 使用HTML表格展示数据（简单、快速）
   - 使用ExcelJS在浏览器端生成Excel文件供下载
   - 样式尽量与后端导出的Excel保持一致

#### 方案B：ExcelJS生成Excel后转换预览

1. 使用ExcelJS在浏览器端生成Excel文件
2. 使用其他库（如SheetJS的xlsx.js）读取并预览
3. 复杂度较高，不推荐

## 推荐实现步骤

### 1. 下载ExcelJS库

从以下地址下载ExcelJS的浏览器版本：
- CDN: https://cdn.jsdelivr.net/npm/exceljs@latest/dist/exceljs.min.js
- 或下载到本地：`static/libs/exceljs/exceljs.min.js`

### 2. 后端预览API

创建 `/api/todo/v2/export/preview`，返回JSON数据：
```python
@app.route('/api/todo/v2/export/preview', methods=['POST'])
def todo_v2_export_preview():
    """预览导出数据（返回JSON格式）"""
    # 复用 todo_v2_export_excel 的数据准备逻辑
    # 但不生成Excel文件，返回JSON格式的表格数据
    pass
```

### 3. 预览页面实现

**预览页面功能：**
1. 接收JSON数据
2. 使用HTML表格展示（简单高效）
3. 使用ExcelJS提供"下载Excel"功能（可选，如果用户需要）
4. 样式与导出的Excel保持一致

**为什么用HTML表格而不是ExcelJS预览？**
- ExcelJS主要用于生成Excel文件，不是预览工具
- HTML表格更简单、快速、灵活
- 可以直接在浏览器中查看，无需额外库

### 4. 在导出按钮旁添加预览按钮

在 `templates/todo_v2.html` 的导出模态框footer中：
```html
<div class="modal-footer">
    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
    <button type="button" class="btn btn-info" id="previewExportBtn">
        <i class="fas fa-eye"></i> 预览
    </button>
    <button type="submit" class="btn btn-primary">
        <i class="fas fa-download"></i> 开始导出
    </button>
</div>
```

## 总结

你的方案可行，但建议：
- ✅ 使用ExcelJS：主要用于在浏览器端生成Excel文件（如果需要在预览页面提供下载功能）
- ✅ 预览方式：使用HTML表格展示数据（更简单高效）
- ✅ 后端API：返回JSON格式数据，复用现有数据准备逻辑

这样的实现既满足了预览需求，又保持了代码的简洁性。

