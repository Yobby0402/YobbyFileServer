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
- 自动连线按 **左→右** 从方块**左右边**出入（不会从顶/底主接，避免出现中间一条竖线、两侧摆块的「竹子」布局）；声明 `node` 时仍建议 **从左到右** 排 `@`；边标签尽量短。

## 一行多节点范例

```yobboy-flow
node a "A" rounded @ 40 40 90 44
node b "B" rect @ 200 40 90 44
edge a -> b
```

## 与原生 Mermaid

本格式由 **YobboyFileServer 自带解析器** 转为带 `mxGeometry` 的 mxfile，**带 `@` 的坐标不会被 Mermaid 布局覆盖**。不要依赖 draw.io 内置「仅 Mermaid 字符串」导入路径来描述带坐标图。
