# Draw.io 本地 Skill（yobboy-flow）

在 **Draw.io AI 输出格式 = yobboy-flow（推荐）** 时，模型应只输出围栏内文本，**不要**写 `<mxfile>`。以下补充 **yobboy-flow** 写法；若你在设置里切回「直接 XML」，请改回只输出完整 mxfile 的规则。

## 语法速查

- 可选首行：`kind: yobboy-flow-v1`
- 注释：`# ...`
- 节点：`node <id> <标签> [形状] [@ x y width height]`
- 连线：`edge <from> -> <to> ["标签"]`，或简写一行 `<from> -> <to>`
- 形状：`rect`（默认）、`rounded`、`diamond`、`ellipse`、`circle`、`parallelogram`
- 省略 `@` 时由系统自动网格排版；需要可编辑布局时尽量写 `@`

## 弱模型建议

- 单图 **节点 ≤ 16**、**边 ≤ 24**；大图拆多轮。
- `id` 仅用字母数字与 `_-.`，全图唯一。
- 标签里若有 `& < >`，用引号包起来。
- **不要**输出 ```mermaid 或 ```xml。
- 自动连线会按源/目标的相对位置优先选择 **左右或上下边** 出入；同一侧的多条线会沿边均匀错开，避免都挤在一个点。声明 `node` 时仍建议主流程 **从左到右** 排 `@`，上下分支再放到主链上/下侧；边标签尽量短。
- 若节点是 `diamond`，分支标签尽量写清楚，例如 `是/否`、`成功/失败`、`通过/驳回`：系统会优先让“正向/通过”分支直行向右，“否定/失败”分支向下（必要时再微调）。

## 一行多节点范例

```yobboy-flow
node a "A" rounded @ 40 40 90 44
node b "B" rect @ 200 40 90 44
edge a -> b
```

## 与原生 Mermaid

本格式由 **YobboyFileServer 自带解析器** 转为带 `mxGeometry` 的 mxfile，**带 `@` 的坐标不会被 Mermaid 布局覆盖**。不要依赖 draw.io 内置「仅 Mermaid 字符串」导入路径来描述带坐标图。
