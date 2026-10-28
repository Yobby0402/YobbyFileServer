# Superdesign 动效参考调研

调研日期：2026-10-28。用途：为现有网站的局部视觉改造提供参考，属于研究笔记，不是已确认的开发 spec。

## 取证方式与边界

- 读取用户提供的 [设计库页面](https://superdesign.dev/library?category=all&selected=timeline-vertical-journey&tags=animation)、该页面加载的第一方前端脚本及其公开只读 API。脚本明确使用 `https://api.superdesign.dev/v1/prompt-library` 获取公开条目。
- [animation 分类接口](https://api.superdesign.dev/v1/prompt-library?tags=animation&limit=200&lite=true) 本次返回 114 项；这个数量仅记录本次调研，不作为选型理由。
- 核对下面组件的名称、描述、生成提示中附带的实现代码；另外通过 HTTP 读取 Vertical Journey、Status Tracker、Interactive Folder、Radiant Prompt Input、Dynamic Data Display 的实际预览 HTML。
- 本笔记的“源码核实”不等于完成浏览器运行、交互、性能或无障碍验证。预览 iframe 在主调研浏览器中未能稳定加载；不声称已经体验其实际动画。
- 组件介绍中的“高性能”“60fps”“生产可用”等词属于发布者说明，本次没有测量证明。预览 HTML 还注入了 Superdesign 编辑桥、Tailwind CDN 和部分运行时；不能把整个预览页面体积当成组件本体体积，也不应把预览页面原封不动嵌进项目。

## 优先参考

| 组件及第一方条目 | 源码/说明确认的效果 | 当前网站建议位置 | 实现成本与取舍 |
| --- | --- | --- | --- |
| [Timeline: Vertical Journey](https://superdesign.dev/library/timeline-vertical-journey) | 日期、节点与正文卡片沿垂直轴排列；单个 IntersectionObserver 触发条目进入，轴线按已出现条目数量填充；减少动态效果时全部内容直接可读。 | ToDo 的改动与评论 `historyModal`、Git 的 `gitHistoryList`。当前 ToDo 横向工期时间线有排期语义，应保留。 | 核心是普通 HTML/CSS/JS，无需新增 React 或动画库。历史记录的节点语义是事件先后，不应让滚动填充被误读成任务完成率。可只用淡入和节点强调。 |
| [Timeline: Status Tracker](https://superdesign.dev/library/timeline-status-tracker) | 每一行独立绘制连接线；完成为勾选，进行中为脉冲标记，等待为弱色；显示完成数量与状态文案。 | 本地 AI 面板已有的真实执行状态、文件转换或报告生成过程。 | 核心原生 CSS/JS；参考中状态来自固定演示数组，并没有进度 API。必须只映射现有系统实际提供的状态，不能为了动画虚构“检索/分析/生成”等步骤。没有阶段事件时，先保留一个明确的处理中状态和结束反馈。 |
| [Interactive Folder](https://superdesign.dev/library/interactive-folder) | 文件夹开合，纸张展开并响应鼠标移动。生成提示与预览均包含 React / Framer Motion 实现。 | `choice` 页“文件管理”入口图标；可选地应用于文件网格中的文件夹图标。 | 原实现依赖 React、Framer Motion、图标与样式工具。现有普通网页可用 SVG/CSS transform 重做简单开合；只增强图标，不让整个入口晃动。触屏及键盘仍能直接进入目录。 |
| [Tilted Card](https://superdesign.dev/library/tilted-card) | 卡片随指针倾斜、悬停放大，提示跟随鼠标；生成源码使用 Framer Motion 的 useSpring/useMotionValue。 | `choice` 页工具入口中的图片区域，作为可选轻量效果。 | 不建议直接照搬默认 14° 倾角和 1.1 放大。现有入口已具有浮起与阴影，若采用应替换或弱化旧效果，控制角度并避免叠加。可用局部 CSS 变量和指针事件实现，触屏使用静态状态。 |
| [Radiant Prompt Input](https://superdesign.dev/library/radiant-prompt-input) | 输入框边缘以 CSS `@property` 和 conic-gradient 旋转；源码动画周期 5 秒，含提交/键盘处理。 | 本地 AI 输入框的聚焦或生成中反馈。 | 示例是 React 包装，但核心边框是 CSS；无需为边框引入框架。建议收敛到现有主题色，仅在聚焦或进行中激活，减少动态效果时变成静态描边。不是用动画掩盖输入禁用、失败或停止按钮状态。 |
| [Light Beam Button](https://superdesign.dev/library/light-beam-button) | 旋转边缘光束、内部光泽和 hover/tap 反馈；核心为 CSS `@property` / conic-gradient，包装使用 React / Framer Motion。 | 每个视图中的一个主操作，例如“开始生成”；作为第二批增强。 | 发布者明确定位深色界面。全站按钮普及会模糊主次；浅色主题需另验对比度。可用 CSS 伪元素简化为一次性 hover/focus 光泽，既有按钮行为不变。 |
| [Dynamic Data Display](https://superdesign.dev/library/dynamic-data-display) | 生成提示指定统计数字进入视口时递增；预览 HTML 包含 React / Framer Motion。 | 分享统计等已有非实时数字展示；当前 `choice` 页没有统计区，不为采用此效果新增统计功能。 | 属于低优先级装饰。原生 requestAnimationFrame 可实现，但没有必要引入库。避免用于实时串口计数、上传进度或必须准确读取的即时数据；不要在每次刷新重播。 |
| [SGW - Enhanced Modal Interaction](https://superdesign.dev/library/sgw-enhanced-modal-interaction) | 不是独立通用弹窗组件：公开条目的正文是订单确认按钮放大需求，附带整页示例，包含分段出现的表单项、模拟鼠标、浮动装饰和页面转场。 | 仅可参考弹窗容器淡入/短距离上移，不建议直接作为全站弹窗改造来源。 | 原代码分段表单出现长达 600ms，且夹带大型展示页逻辑；对工具站成本和干扰均偏高。更合理的是保留现有弹窗机制，只统一短时进入/退出、焦点和遮罩。 |

上述“当前网站建议位置”是结合主调研者对现有源码的检查作出的设计建议，不是 Superdesign 的原始用途说明，也尚未得到用户确认。

## 关键实现证据

- [Vertical Journey 公共数据](https://api.superdesign.dev/v1/prompt-library/by-slug/timeline-vertical-journey) 与 [预览源码](https://p.superdesign.dev/draft/e6377d13-bb0f-4a24-aa90-a098927d8b3a)：实际使用 `.ev.in` 激活节点、14px 上移恢复、600ms 过渡和按序 90ms 延迟；观察器阈值为 0.3，显示一次后取消观察；减少动态效果时显示所有条目。产品中建议缩短时长并限制批量出现的累计延迟。
- [Status Tracker 公共数据](https://api.superdesign.dev/v1/prompt-library/by-slug/timeline-status-tracker) 与 [预览源码](https://p.superdesign.dev/draft/b5d92237-8d65-49c1-96e3-10f64ae0dd3b)：状态数组采用 done/live/wait；进行中点以 1.8 秒周期缩放和改变透明度；无网络获取业务进度逻辑。减少动态效果规则取消动画。
- [Interactive Folder 公共数据及生成源码](https://api.superdesign.dev/v1/prompt-library/by-slug/interactive-folder)：列出 React、Framer Motion、lucide-react、clsx、tailwind-merge，纸张交互绑定鼠标移动和离开。主交互是否满足键盘要求仍需在实施时自行设计与验证。
- [Tilted Card 公共数据及生成源码](https://api.superdesign.dev/v1/prompt-library/by-slug/tilted-card)：鼠标驱动 rotateX/rotateY 与 scale，弹簧过渡是示例风格的一部分，不是本项目必须引入的依赖。
- [Radiant Prompt Input 公共数据及生成源码](https://api.superdesign.dev/v1/prompt-library/by-slug/radiant-prompt-input)：边框通过角度自定义属性旋转；React 负责输入和提交。示例还包含图标/工具依赖；可抽取视觉思想而保留现有输入框实现。
- [Light Beam Button 公共数据及生成源码](https://api.superdesign.dev/v1/prompt-library/by-slug/light-beam-button)：光束为 CSS 角度属性动画，Framer Motion 处理交互包装。示例宣称的流畅度未经本次性能测试。
- [Dynamic Data Display 公共数据](https://api.superdesign.dev/v1/prompt-library/by-slug/dynamic-data-display) 与其 `previewUrl` 指向的公开预览：条目只提供简短计数递增需求；预览内打包了 Framer Motion。不能从名称推断具备实时数据、图表或可访问性完整能力。
- [SGW 条目数据及整页参考源码](https://api.superdesign.dev/v1/prompt-library/by-slug/sgw-enhanced-modal-interaction)：标题与正文的具体范围有偏差；不应仅凭“Enhanced Modal Interaction”名字将其当成可直接接入的独立弹窗库。

## 建议收束范围

首批优先做历史记录的垂直时间线、六个入口卡片的一致反馈、AI 输入与忙碌状态。这三处有现成内容与真实操作可映射。文件列表和工作表格维持稳定，不使用滚动锁定、指针追踪背景或长时序逐项表演。

依赖策略：以项目现有 CSS 变量、Bootstrap 弹窗、原生 JS 为起点，借鉴效果并重做适合当前结构的实现。不要为了少量特效引入整套 React、GSAP 或 Framer Motion。需要共用的样式集中管理，但具体页面接入仍保持小范围。

后续验收应包含桌面/移动尺寸、所有现有主题、键盘焦点、系统减少动态效果、内容仍可立即读取，以及在长历史列表和连续 AI 输出时没有持续布局抖动。完整浏览器运行与性能验收尚未进行。
