# 预览功能实现方案（基于ExcelJS）

## 技术方案

### 1. ExcelJS库集成
- 下载ExcelJS库（推荐使用CDN或npm）
- 放置到 `static/libs/exceljs/` 目录
- 在预览页面中引入

### 2. 后端API设计

创建 `/api/todo/v2/export/preview` 端点：
- 复用 `todo_v2_export_excel` 的数据准备逻辑
- 但不生成Excel文件，而是返回JSON格式数据
- 返回格式：
```json
{
    "success": true,
    "data": {
        "headers": ["项目名称", "任务简述", ...],
        "rows": [
            ["项目A", "任务1", ...],
            ["项目A", "任务2", ...],
            ...
        ],
        "metadata": {
            "project_count": 5,
            "task_count": 20,
            "export_range": "weekly",
            ...
        },
        "styles": {
            "header_style": {...},
            "row_styles": [...],
            ...
        }
    }
}
```

### 3. 前端实现

#### 3.1 在导出模态框中添加预览按钮
在"开始导出"按钮旁添加"预览"按钮

#### 3.2 预览页面 (`templates/todo_v2_export_preview.html`)
- 使用ExcelJS处理数据（可选，主要用于生成Excel下载）
- 使用HTML表格展示数据（更简单的预览方式）
- 提供"导出Excel"按钮，调用现有导出API

### 4. 实现步骤

1. 下载ExcelJS库到本地
2. 创建预览API端点（返回JSON数据）
3. 创建预览HTML页面
4. 在导出模态框中添加预览按钮
5. 实现前端JavaScript逻辑

## 注意：ExcelJS主要用于生成Excel文件

ExcelJS的主要用途是生成Excel文件，而不是预览。对于预览，更简单的方式是：
- 使用HTML表格直接展示数据
- 如果用户需要Excel文件，可以：
  - 在预览页面提供"下载Excel"按钮，调用现有导出API
  - 或者使用ExcelJS在浏览器端生成Excel文件供下载

因此，预览功能可以简化为：
1. 后端API返回JSON数据
2. 前端使用HTML表格展示
3. 预览页面提供"下载Excel"按钮，使用ExcelJS生成Excel文件

