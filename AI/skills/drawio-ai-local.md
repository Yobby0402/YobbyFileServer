# Draw.io 本地 Skill（补充规则）

仅补充 **system 消息未展开的写法细节**。输出仍须：**只输出一份完整 `<mxfile>…</mxfile>`**，无 Markdown、无代码围栏、无正文解释。

**附图**：消息里若有图，按图还原形状与连线，文字进 `value`；输出仍为单份 mxfile。

---

## 1. 结构（漏一项即损坏）

- 层级唯一：`mxfile` → `diagram` → `mxGraphModel` → `root` → **仅并列** `mxCell`；**必须写 `</diagram></mxfile>`**，勿只关 `mxfile`。
- 骨架头两个 cell 固定：`<mxCell id="0"/>`、`<mxCell id="1" parent="0"/>`；其余 shape 从 `id="2"` 起递增，**全文 id 不重复**。
- 形状：`vertex="1"`、`parent="1"`，子元素只能是 `<mxGeometry …/>`，**禁止 `mxCell` 套 `mxCell`**。
- 连线：`edge="1"`、`parent="1"`，`source` / `target` 指向已存在的 id。
- 同一 `<mxCell …>` 上**同一属性名只出现一次**（勿重复 `edge=`、`vertex=` 等）。
- 属性值里的 `&` 必须写 `&amp;`；尽量少用 `<!-- 注释 -->`。

## 2. 弱模型建议（减少报错）

- **优先单页、单 `diagram`**；一次生成 **形状 ≤ 10** 更稳；大图让用户多轮并附带「当前图表」XML 增量改。
- 样式从简：`style="rounded=1;whiteSpace=wrap;html=1;"` 即可；少用大段 `style`、少用复杂折点数组。
- 边：`edgeStyle=orthogonalEdgeStyle;endArrow=classic;html=1`，尽量带 `exitX/exitY/entryX/entryY`（如 0.5）；同两点多条边时用不同 `exitY`/`entryY` 略错开。

## 3. 一行可解析范例（对齐后再扩写）

```xml
<mxfile><diagram id="d1" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="A" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="40" y="40" width="96" height="40" as="geometry"/></mxCell><mxCell id="3" value="B" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="220" y="40" width="96" height="40" as="geometry"/></mxCell><mxCell id="4" style="edgeStyle=orthogonalEdgeStyle;exitX=1;exitY=0.5;entryX=0;entryY=0.5;endArrow=classic;html=1;" edge="1" parent="1" source="2" target="3"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>
```

生成前先对照本节：闭合标签、root 内并列、id 与 source/target 一致。
