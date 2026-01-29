# Git 版本管理整理指南

当本地/远程分支、标签较多且命名不统一时，可按以下步骤整理，并形成清晰的发布流程。

---

## 一、本仓库当前状态（诊断）

### 分支

| 分支 | 最新提交 | 说明 |
|------|----------|------|
| **main** | 8e44182 版本 R1.2 | 当前主分支，与 origin/main 同步 |
| v3.7 | e234159 | 落后于 main，远程也有 origin/v3.7 |
| v3.7-dev | fde644c | 落后于 main，为 main 历史中的提交 |
| v3.8-edit | cf0c8d6 | 落后于 main |

结论：**main 已包含后续所有改动**，v3.7 / v3.7-dev / v3.8-edit 均可视为历史开发分支，若不再需要可删除。

### 标签（当前较多且不统一）

- 存在 **分支与标签同名/近似** 的情况（如分支 `v3.7` 与标签 `V3.7`/`v3.7`），会导致 `git log v3.7` 等命令出现 “refname is ambiguous” 警告。
- 命名混用：大写 `V2.1`、`V3.0` 与小写 `v1.0`、`v2.0`，以及 `R1.2`、`vR1`、`vR1.1` 等。

建议：**旧标签保留不动**（作为历史），今后**新版本只用一套命名**（例如统一用 `R1.2.1`、`R1.3` 与 CHANGELOG 一致）。

### 未提交变更

- 已修改：CHANGELOG.md、git_manager.py、git_routes.py、main.py、serial_manager.py、todo_v2.css、product_compare.js、serial_tool.js、todo_v2.js、serial_tool.html
- 未跟踪：`docs/` 目录（含本指南）

---

## 二、推荐做法（长期）

### 1. 分支策略

- **main**：唯一主分支，只合并已测试完成的代码，对应「当前可发布版本」
- **开发**：如需并行开发，可保留一个 `develop`，或短期分支如 `feature/xxx`，合并后删除
- **发布/修 bug**：在 main 上打 tag，或从 main 拉 `release/R1.2.1`，发布后删除该分支

### 2. 标签（Tag）规范

- 每个在 CHANGELOG 里记录的版本，建议打一个**轻量标签**：
  - 正式版：`v1.0`、`R1`、`R1.1`、`R1.2.1`（与 CHANGELOG 版本号一致即可，选一种命名）
  - 示例：`git tag R1.2.1` 打在当前要发布的提交上
- 推送标签：`git push origin R1.2.1`
- 查看：`git tag -l`

### 3. 提交信息

- 建议格式：`类型: 简短说明`，例如：
  - `fix: 串口持续日志 Serial 导入错误`
  - `feat: 持续日志显示记录时长与弹窗查看`
  - `docs: CHANGELOG 增加 R1.2.1 修复说明`

---

## 三、针对本仓库的整理步骤（按顺序执行）

### 步骤 1：先提交当前修改（R1.2.1 相关）

把未提交的 bug 修复和 CHANGELOG、文档一起纳入版本管理：

```powershell
cd f:\Work\YobboyFileServer
git add CHANGELOG.md git_manager.py git_routes.py main.py serial_manager.py
git add static/css/todo_v2.css static/js/product_compare.js static/js/serial_tool.js static/js/todo_v2.js
git add templates/serial_tool.html docs/
git status
git commit -m "fix: R1.2.1 串口/产品对比/ToDo 问题修复与 CHANGELOG、Git 指南更新"
```

### 步骤 2：为本次发布打标签

```powershell
git tag R1.2.1
git tag -l "R1*"
```

### 步骤 3：推送到 GitHub

```powershell
git push origin main
git push origin R1.2.1
```

### 步骤 4：删除本地已不需要的分支（可选）

main 已包含所有后续改动，若不再需要这些历史分支，可删除以简化 `git branch -a`：

```powershell
git branch -d v3.7
git branch -d v3.7-dev
git branch -d v3.8-edit
```

若提示“未合并”而确定要删，用 `-D`：`git branch -D v3.7`。

### 步骤 5：删除远程分支 v3.7（可选，谨慎）

仅在确定远程也不再需要 v3.7 时执行：

```powershell
git push origin --delete v3.7
```

### 步骤 6：今后避免“分支与标签同名”

- 新功能/修 bug 只在 **main** 上开发，或拉短期分支（如 `feature/xxx`），合并后删除。
- 发布时只打 **标签**（如 `R1.2.1`、`R1.3`），不再用版本号当分支名（如不再新建 `v3.9` 分支），可避免再次出现 “refname 'v3.7' is ambiguous”。

---

## 四、通用整理步骤（参考）

### 1. 确认要保留的分支

```bash
git branch -a
```

- 只保留还在用的分支（例如 `main`），其余准备删除或合并后再删。

### 2. 删除本地已合并且不再需要的分支

```bash
git branch -d v3.7
git branch -d v3.7-dev
git branch -d v3.8-edit
```

若提示未合并，可先 `git merge main` 再删，或确认废弃后 `git branch -D 分支名` 强制删除。

### 3. 删除远程已废弃分支（谨慎）

```bash
git push origin --delete v3.7
```

### 4. 清理本地已删除的远程分支引用

```bash
git fetch --prune
```

---

## 五、日常推荐流程

1. 在 `main` 上开发、修 bug，或从 `main` 拉短期分支，合并回 `main` 后删分支。
2. 每个在 CHANGELOG 中记录的版本：提交 → 打 tag（如 `R1.2.1`）→ `git push origin main` 和 `git push origin R1.2.1`。
3. 定期删除已合并且不再使用的本地/远程分支，保持 `git branch -a` 简洁。

这样版本管理会以 **main + 标签** 为主线，CHANGELOG 与 Git 标签一一对应，便于回溯和发布。
