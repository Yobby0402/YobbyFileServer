# Yobboy 文件服务器 / Yobboy File Server

<div align="center">

![Yobboy File Server](文件服务器.png)

**一个功能强大的本地文件浏览和编辑服务器**  
**A Powerful Local File Browser and Editor Server**

[![Python](https://img.shields.io/badge/Python-3.13+-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.1+-green.svg)](https://flask.palletsprojects.com/)
[![PyQt5](https://img.shields.io/badge/PyQt5-5.15+-orange.svg)](https://www.riverbankcomputing.com/software/pyqt/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[中文](#中文文档) | [English](#english-documentation) | [快速开始Quick Start 🚀](快速开始.md)

</div>

> **🚀 新手？** 查看 [快速开始指南](快速开始.md) 3分钟快速上手！  
> **当前版本：R1 (Release V1) · 发布日期 2026-01-13**  
> **开发版本：dev · 包含实验性功能**

---

## 中文文档

### 📖 简介

Yobboy 文件服务器是一个集成了文件浏览、Markdown 预览、Draw.io 图表编辑等功能的本地 Web 服务器应用。通过现代化的 GUI 界面，您可以轻松启动服务器，在浏览器中管理和编辑文件。

### 🎬 使用场景

**告别抱着电脑满会议室跑的尴尬时刻！**

还在为公司周会、项目汇报、导师组会而烦恼吗？笔记本太重懒得搬？投影仪线太短够不着？U盘拷来拷去容易中病毒？

这个项目就是为了拯救你的腰和你的尊严而生的！

- 🏢 **公司组会救星**：一键启动，浏览器访问，代码、图片、PDF、视频瞬间预览，现场编辑代码文档，老板再也不用等你拆电脑线了
- 🎓 **研究生汇报神器**：导师办公室投影仪在天花板上？没事，手机扫码打开网页，论文图表、实验数据、代码文件直接展示和编辑
- 📊 **临时文件分享站**：同事要你的代码、设计图、文档？甩个局域网地址或者二维码，在线预览，需要的话自己下载，比微信传文件快100倍还不压缩
- 🎨 **代码现场修改**：客户突然要改配置文件？掏出手机浏览器，CodeMirror在线编辑，语法高亮，当场保存，专业度拉满
- 📁 **文档在线编辑**：Markdown笔记、Python脚本、配置文件想实时编辑？浏览器一开，语法高亮、代码折叠、查找替换全都有
- 🧭 **团队任务中控**：ToDo 任务管理系统按项目分组管理，表格展示、拖拽排序、待完成概览，任务进度一目了然
- 🔌 **硬件调试实验室**：串口助手实时读取与下发指令，无需额外工具即可调试嵌入式设备
- 📊 **产品选型助手**：产品对比工具帮助快速对比不同产品的参数，雷达图可视化展示优劣，智能分析最优选择

**比 FileZilla 简单 10 倍，比 FTP 优雅 100 倍，比抱着电脑跑轻松 1000 倍！**

不需要复杂配置，不需要记住奇怪的命令，双击 exe，点击启动，扫码/输网址，搞定！
妈妈再也不用担心我不会搭建服务器了 😎

### 🌟 R1 (Release V1) 正式版本功能

本版本整合了所有开发版本的功能，包括：

- 📋 **ToDo 任务管理系统 v2**：完整的项目-任务层级结构，支持Excel导出、汇报视图
- 📊 **产品对比工具**：产品参数对比和雷达图可视化分析
- 🍃 **20种主题系统**：统一的主题风格，支持实时切换
- 🔌 **串口调试助手**：本地和远程串口调试，持续日志记录
- 📁 **文件浏览器**：多格式预览、在线编辑、文件管理
- 🎨 **Draw.io 编辑器**：完整的图表编辑功能
- 🔗 **分享链接系统**：密码保护、过期时间、访问统计

### 🌟 dev 开发版本功能（历史）

- 📊 **ToDo v2 Excel 导出**：支持灵活配置的 Excel 导出功能，包括时间范围、列选择、项目导出方式、评论处理方式等
- 🎨 **双风格界面切换**：卷轴风格和表格风格一键切换，表格风格支持列拖拽排序、筛选和排序
- 📈 **改动数量显示**：显示任务修改次数和评论数量，点击查看详细历史记录
- 🔍 **表格筛选排序**：支持多列筛选和排序，日期范围筛选，提升数据查找效率
- 🎛️ **字体大小滑块**：10-48px 可调字体大小，统一应用到所有显示区域
- 📋 **导出当前预览**：一键导出当前表格显示的内容，保持顺序和筛选结果

#### dev v3.2 功能

- 📋 **新版ToDo任务管理系统**：完全重构的ToDo系统，采用项目-任务层级结构
  - **项目表格展示**：可折叠的项目表格，每个项目显示主题色、创建时间、整体进度
  - **任务列表管理**：表格形式展示任务，包含序号、简述、详细描述、创建时间、预计完成、优先级、进度、上次更新
  - **拖拽排序**：任务支持拖拽重新排序，灵活调整优先级
  - **详细描述展开**：长描述自动折叠，点击展开查看完整内容
  - **更新历史记录**：每次任务更新都会记录时间和变更内容
  - **待完成概览卡片**：卡片方式展示待完成任务，按逾期、今日、即将到期、未设置分类
  - **搜索和过滤**：支持按项目名称、任务简述、描述搜索，支持按项目筛选
  - **完整CRUD操作**：支持新建/编辑/删除项目和任务，添加评论等
  - **数据持久化**：使用新的数据格式（`todos_v2.json`），与旧版数据分离

#### dev v4.0 功能

- 📊 **产品对比工具**：全新的产品参数对比功能，支持多产品参数管理和可视化对比
  - **属性管理**：自定义产品属性列表，支持通用参数（数值型）和普通属性（文本型）
  - **通用参数配置**：为每个通用参数设置单位、方向（越大越好/越小越好），用于智能对比分析
  - **归属分类**：产品归属自动分类，每个归属可自定义颜色，产品列表左侧书签显示归属颜色
  - **雷达图对比**：基于 Chart.js 的雷达图可视化，支持多产品叠加对比，每个参数独立归一化
  - **智能分析**：自动识别每个参数的最优产品，统计各产品的最优项数量
  - **参数排序**：按任意通用参数对产品进行排序，支持升序/降序
  - **数据持久化**：所有对比数据保存在本地 JSON 文件，支持多文件管理

#### dev v3.1 功能

#### dev v3.0 功能

- 🍃 **茉莉奶白主题焕新**：全站（除选择页）统一采用 Jasmine Green × Snow White 渐变风格，按钮、卡片、表单等组件全面适配
- 🗂️ **ToDo 时间轴中心**：新增独立 ToDo 工作台，支持后门直达、搜索、项目筛选、颜色继承/随机、预计完成时间等字段
- 📆 **双向时间轴**：时间轴支持纵向与横向视图切换，滚动自动匹配方向，并配备上下浮动跳转按钮
- 🧷 **事件操作增强**：时间轴卡片提供评论、修改、单条记录删除操作，历史追踪与评论同步更新
- ⏱️ **待完成概览**：今日目标、逾期与剩余时间排序板块固定一屏显示，智能分组并与时间轴联动高亮
- 🔌 **串口调试助手**：后端基于 PySerial + Socket.IO，实现串口实时读写、回显与参数配置，支持浏览器端在线调试，并可为指定端口持续写入日志、随时载入历史数据

#### dev v2.2 功能

- 🎮 **3D模型查看器**：集成Three.js，支持GLTF/GLB、OBJ、STL等格式的3D模型在线预览，iframe嵌入式预览
- 🔄 **交互式查看**：鼠标旋转、缩放、平移，线框模式、网格显示等多种查看模式
- 📊 **模型统计**：显示顶点数、三角形数、模型尺寸等详细信息
- ➕ **新建功能**：支持新建文件、Draw.io图表、文件夹，快速创建内容
- 📤 **文件上传**：支持多文件同时上传，拖拽上传文件到服务器
- ⚙️ **关闭行为可配置**：可选择关闭按钮是退出程序还是最小化到托盘

#### dev v2.1 功能

- ✏️ **在线代码编辑器**：集成CodeMirror，支持30+种语言的语法高亮，直接在预览区域编辑文件
- 💾 **实时保存**：Ctrl+S快捷键保存，支持保存并关闭，自动刷新预览
- 🎨 **专业编辑体验**：行号、代码折叠、括号匹配、查找替换等完整功能

#### dev v2.0 功能

- 🔍 **智能搜索**：实时搜索文件，支持按类型过滤
- 🔗 **分享链接**：一键生成分享链接，支持密码、过期时间、访问限制
- 🎵 **音频播放**：MP3/WAV/FLAC等音频文件在线播放
- 🖼️ **图片灯箱**：点击图片全屏查看，支持下载
- 📺 **全屏预览**：预览区域全屏显示，专注查看内容
- 🔒 **管理员密码**：双重密码保护，防止随意修改目录
- 🌐 **智能网络**：自动识别真实IP，排除虚拟网络接口

### ✨ 核心特性

#### 🎮 3D模型查看器（v2.2）
- **Three.js集成**：完全离线的3D渲染引擎，无需外部CDN
- **多格式支持**：
  - **GLTF/GLB** - 现代Web 3D标准格式，推荐使用
  - **OBJ** - 传统通用3D格式
  - **STL** - 3D打印常用格式
  - **FBX** - Autodesk格式（计划支持）
- **交互式控制**：
  - 🖱️ 鼠标左键旋转模型
  - 🖱️ 鼠标右键平移视角
  - 🖱️ 滚轮缩放模型
- **查看工具**：
  - 重置视角 - 一键恢复默认视角
  - 线框模式 - 查看模型网格结构
  - 网格显示 - 显示参考网格
  - 坐标轴显示 - 显示XYZ坐标轴
  - 背景切换 - 5种背景颜色可选
  - 自动旋转 - 自动展示模型
- **模型信息**：实时显示顶点数、三角形数、模型尺寸等统计数据
- **专业渲染**：支持材质、光照、阴影等高级渲染效果

#### ✏️ 在线代码编辑器（v2.1）
- **CodeMirror集成**：专业的代码编辑体验，支持100+种编程语言和标记语言
- **语法高亮完整支持**：
  - **Web开发**: HTML, CSS, SCSS, Less, JavaScript, TypeScript, JSX, Vue, PHP
  - **编程语言**: Python, Java, C/C++, C#, Go, Rust, Ruby, Swift, Kotlin, Perl, Lua
  - **脚本语言**: Shell, PowerShell, Bash, Batch
  - **数据格式**: JSON, XML, YAML, TOML, Protobuf
  - **标记语言**: Markdown, reStructuredText, LaTeX, Textile
  - **数据库**: SQL, MySQL, PostgreSQL, Cypher
  - **配置文件**: Nginx, Dockerfile, Properties, INI
  - **模板引擎**: Jinja2, Django, Handlebars, Pug, Smarty
  - **其他**: Diff, Git, HTTP, Verilog, VHDL等
- **无缝编辑**：直接在预览区域编辑，点击"编辑文件"按钮即可切换
- **专业功能**：行号显示、代码折叠、括号自动匹配、查找替换
- **快捷键支持**：Ctrl+S保存、Ctrl+F查找、Ctrl+H替换、ESC取消
- **智能保存**：保存、保存并关闭、取消三种操作，未保存会提示
- **Monokai主题**：暗色护眼主题，专业美观
- **编码支持**：自动检测UTF-8和GBK编码

#### 🔍 智能搜索与过滤
- **实时搜索**：输入关键词即时过滤文件列表
- **类型过滤**：按文件类型快速筛选（图片、文档、视频、音频、代码等）
- **组合使用**：搜索和过滤可同时使用，快速定位文件

#### 🔗 分享链接系统
- **一键分享**：点击分享按钮即可生成分享链接
- **密码保护**：可选密码保护，保证分享安全
- **灵活过期**：支持1小时到30天的过期时间设置
- **访问限制**：可设置最大访问次数
- **二维码分享**：自动生成二维码，手机扫码即可访问
- **访问统计**：详细的访问记录和统计数据
- **智能预览**：Drawio/Markdown文件在线预览，无需下载
- **智能网络**：自动识别真实网卡IP，排除虚拟网络接口

#### 🎵 多媒体增强
- **音频播放**：支持MP3、WAV、FLAC等格式在线播放
- **图片灯箱**：点击图片全屏查看，支持下载
- **全屏预览**：预览区域支持全屏显示
- **视频播放**：HTML5视频播放器，支持进度控制

#### 📋 ToDo 任务管理系统（v3.1+）
- **项目-任务层级结构**：项目包含多个任务，每个项目可自定义主题色
- **可折叠项目表格**：项目表格可完全折叠到一行，显示项目名称、创建时间、整体进度
- **任务表格展示**：
  - 序号、简述、详细描述（可展开/折叠）、创建时间
  - 预计完成时间（带状态标识：逾期/今日/即将到期）
  - 优先级（1-5级，不同颜色标识）
  - 进度条和百分比显示
  - 上次更新时间
- **拖拽排序**：任务支持拖拽重新排序，灵活调整任务优先级
- **更新历史**：每次任务更新都会记录时间和变更内容，完整追踪任务变更历史
- **评论系统**：为任务添加评论，记录进展和补充说明
- **待完成概览**：卡片方式展示待完成任务，按逾期、今日、即将到期、未设置分类
- **搜索和过滤**：支持按项目名称、任务简述、描述搜索，支持按项目筛选
- **完整操作**：新建/编辑/删除项目和任务，添加/删除评论等完整功能
- **数据持久化**：使用新的数据格式（`todos_v2.json`），与旧版数据分离，保留旧版入口

#### 🗂️ 文件浏览器
- **多格式预览**：
  - 📷 图片格式：`.jpg`、`.jpeg`、`.png`、`.gif`、`.bmp`、`.svg`、`.webp`
  - 📝 Markdown文档：`.md`、`.markdown` - 实时渲染预览
  - 📊 Draw.io图表：`.drawio`、`.diagram`、`.dio`、`.xml`
  - 📄 PDF文件：`.pdf`
  - 🎬 视频文件：`.mp4`、`.avi`、`.mov`、`.wmv`、`.webm`
  - 🎵 音频文件：`.mp3`、`.wav`、`.flac`、`.ogg`、`.m4a`、`.aac`、`.wma`
  - 🎮 3D模型：`.gltf`、`.glb`、`.obj`、`.stl` - 交互式3D查看器
  - 📋 Office文件：`.docx`、`.xlsx`、`.pptx` (仅下载)
  - 💻 代码文件：100+种语言支持在线编辑
- **在线编辑**：文本和代码文件可直接在预览区域编辑，支持100+种语言的语法高亮
- **文件操作**：下载、删除、分享等文件管理功能
- **新建功能**：
  - 📝 新建文件 - 快速创建文本文件
  - 📊 新建Draw.io图表 - 一键创建并打开图表编辑器
  - 📁 新建文件夹 - 创建目录结构
- **文件上传**：支持单文件或多文件同时上传到当前目录
- **目录管理**：创建、删除文件夹，支持多级目录结构
- **分享链接**：为任意文件生成带密码和过期时间的分享链接

#### 🎨 Draw.io 集成
- **完整编辑器**：内置完整的 Draw.io 离线编辑器（中文界面）
- **服务器保存**：编辑图表后直接保存到服务器，无需每次下载
- **快捷键支持**：支持 Ctrl+S 快速保存
- **实时预览**：在文件浏览器中实时预览 `.drawio` 文件
- **新建图表**：可以创建新的Draw.io图表并保存

#### 📝 Markdown 渲染
- **丰富语法**：支持表格、任务列表、脚注、定义列表等
- **图片路径处理**：自动处理相对路径图片

#### 📊 产品对比工具（v4.0）
- **属性管理**：灵活定义产品属性，支持默认属性（品名、归属）和自定义属性
- **通用参数**：标记为通用参数的属性支持数值输入，可设置单位和方向（越大越好/越小越好）
- **归属分类**：产品按归属自动分类，每个归属可自定义颜色，便于视觉区分
- **雷达图可视化**：基于 Chart.js 的雷达图，支持多产品叠加对比
  - 每个参数独立归一化，基于选中产品的最大最小值动态缩放
  - 支持单产品或多产品对比，不同产品用不同颜色区分
  - 多边形叠加显示，确保所有产品都可见
- **智能分析**：
  - 自动识别每个参数的最优产品（根据方向判断）
  - 统计各产品的最优项数量
  - 生成详细的对比分析报告
- **参数排序**：按任意通用参数对产品进行排序，支持升序/降序切换
- **数据管理**：支持创建多个对比文件，每个文件独立管理产品和属性
- **数据持久化**：所有数据保存在本地 JSON 文件，支持导入导出

#### 🔌 串口调试助手（v3.0）
- **PySerial 驱动**：后端使用 PySerial 读取/写入串口，支持常见串口参数配置
- **持续日志捕获**：为选定串口开启后台 JSONL 日志，可在页面一键载入或持续监控
- **实时回显**：Socket.IO 推送串口数据到浏览器，毫秒级刷新，支持下载日志
- **命令发送**：Web 端发送指令、换行模式、自动补齐尾字符
- **多端协作**：浏览器即可调试嵌入式设备，无需安装额外串口工具
- **安全可控**：支持关闭端口、查看统计、阻止重复打开

#### 💻 桌面 GUI
- **现代界面**：基于 PyQt5 的现代化图形界面
- **系统托盘**：支持最小化到系统托盘，后台运行
- **关闭行为配置**：可选择关闭按钮行为（退出程序 或 最小化到托盘）
- **实时日志**：显示服务器运行日志和访问记录
- **一键操作**：一键启动/停止服务器，自动打开浏览器
- **双重密码**：登录密码 + 管理员密码，保护目录修改

### 🚀 快速开始

#### 方式一：使用预编译的 exe（推荐）

1. **下载**：从 [Releases](https://github.com/Yobby0402/YobbyFileServer/releases) 下载最新的 `YobboyFileServer.exe`
2. **运行**：双击 `YobboyFileServer.exe` 启动程序
3. **配置**：首次运行时设置文件根目录
4. **使用**：点击"启动服务器"按钮，程序会自动打开浏览器

#### 方式二：从源码运行

1. **克隆仓库**
```bash
git clone https://github.com/Yobby0402/YobbyFileServer.git
cd YobbyFileServer
```

2. **安装依赖**
```bash
pip install -r requirements.txt
```

3. **运行程序**
```bash
python main.py
```

### 📦 依赖项

```
Flask>=3.1.0
PyQt5>=5.15.0
markdown-it-py>=3.0.0
mdit-py-plugins>=0.4.0
Pygments>=2.18.0
Pillow>=10.0.0
```

**前端库（离线集成）**：
- Three.js r160 - 3D渲染引擎（需手动下载到 `static/libs/three/`）
- CodeMirror 5.65 - 代码编辑器
- Draw.io 最新版 - 图表编辑器
- Bootstrap 5.3 - UI框架

**Three.js 文件下载（使用3D功能需要）**：
将以下文件保存到 `static/libs/three/` 目录：
1. `three.module.js` - https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js
2. `GLTFLoader.js` - https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js
3. `OBJLoader.js` - https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/OBJLoader.js
4. `STLLoader.js` - https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/STLLoader.js
5. `OrbitControls.js` - https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js
6. `utils/BufferGeometryUtils.js` - https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js

### ⚙️ 配置说明

程序使用 `config.ini` 文件保存配置（首次运行自动创建）：

```ini
[settings]
root_dir = /path/to/your/files   # 文件服务器根目录
password = password               # 登录密码（默认：password）
admin_password = admin123         # 管理员密码（默认：admin123）
close_to_tray = false             # 关闭按钮行为（true=最小化到托盘，false=退出程序）
port = 5000                       # 服务器端口（默认：5000，范围：1-65535）
```

**注意**：
- 配置文件位于程序所在目录或用户目录的 `.yobboy_file_server` 文件夹中
- 可以通过 GUI 界面的"设置"菜单修改配置
- 修改共享目录需要输入管理员密码
- 修改配置后需要重启服务器才能生效
- ⚠️ **首次运行请立即修改默认密码！**

### 🎯 使用指南

#### 文件浏览
1. 启动服务器后，在浏览器中访问主页
2. 选择"文件浏览器"进入文件管理界面
3. 点击文件夹可以进入子目录
4. 点击文件可以预览或下载

#### 新建文件和文件夹
1. 在文件浏览器界面，点击右上角"新建"下拉按钮
2. 选择"新建文件"、"新建Draw.io图表"或"新建文件夹"
3. 输入名称后确认创建
4. 新建的Draw.io图表会自动打开编辑器

#### 上传文件
1. 在文件浏览器界面，点击右上角"上传"按钮
2. 选择一个或多个文件（支持多选）
3. 点击"开始上传"
4. 文件将上传到当前浏览的目录

#### Draw.io 编辑
1. 在主页选择"Draw.io 编辑器"
2. 可以新建图表或打开本地文件
3. 编辑完成后按 Ctrl+S 保存
4. 首次保存需要输入文件名

#### 系统托盘
1. 点击"最小化到托盘"按钮可以隐藏主窗口
2. 双击托盘图标恢复窗口
3. 右键托盘图标显示菜单（启动/停止服务器、退出等）
4. 在设置中可配置关闭按钮行为（退出 或 最小化到托盘）

### 🛠️ 开发与构建

#### 开发模式
```bash
python main.py
```

#### 打包为 exe
```bash
python -m PyInstaller --onefile --windowed \
  --add-data "templates;templates" \
  --add-data "static;static" \
  --hidden-import=routes \
  --hidden-import=markdown_it \
  --hidden-import=mdit_py_plugins \
  --name="YobboyFileServer" \
  main.py
```

生成的 exe 文件位于 `dist/YobboyFileServer.exe`

### 📸 截图

> *TODO: 添加应用截图*

### 🤝 贡献

欢迎提交 Issue 和 Pull Request！

### 📄 许可证

本项目采用 MIT 许可证。详见 [LICENSE](LICENSE) 文件。

**第三方组件许可证**：
- **Draw.io**：本项目集成的 Draw.io 编辑器遵循 [Apache License 2.0](https://github.com/jgraph/drawio)
- **Bootstrap**：MIT License
- **Font Awesome**：字体遵循 SIL OFL 1.1，CSS 遵循 MIT License

### 👨‍💻 作者

Copyright © 2025 Yobboy. All rights reserved.

---

## English Documentation

### 📖 Introduction

Yobboy File Server is a powerful local web server application that integrates file browsing, online code editing, Markdown previewing, and Draw.io diagram editing. With a modern GUI interface and professional CodeMirror editor, you can easily start the server and manage/edit files in your browser.

### 🎬 Use Cases

**Say goodbye to the awkward moment of running around the conference room with your laptop!**

Still struggling with weekly meetings, project presentations, or advisor group meetings? Laptop too heavy to carry? Projector cable too short to reach? USB drives keep getting viruses?

This project was born to save your back and your dignity!

- 🏢 **Meeting Lifesaver**: One-click start, browser access, instantly preview and edit code, images, PDFs, and videos - your boss won't have to wait for you to unplug your laptop anymore
- 🎓 **Graduate Student Savior**: Projector mounted on the ceiling in professor's office? No problem! Scan QR code, open webpage, display and edit paper diagrams, experimental data, code files directly
- 📊 **Instant File Sharing Hub**: Colleague needs your code, designs, or documents? Throw them a LAN address or QRCode, preview online, download if needed - 100x faster than WeChat without compression
- 🎨 **Live Code Editor**: Client suddenly wants config file changes? Pull out your phone browser, edit with CodeMirror, syntax highlighted, save on the spot - professionalism maxed out
- 📁 **Document Online Editor**: Want to edit Markdown notes, Python scripts, config files in real-time? Open in browser, syntax highlighting, code folding, find & replace all available
- 🧭 **Team Task Command Center**: ToDo Timeline Center keeps every project and category aligned, perfect for standups and on-site reviews
- 🔌 **Hardware Lab Debugging**: Built-in serial assistant streams logs, issues commands, and tunes parameters without any extra tooling

**10x simpler than FileZilla, 100x more elegant than FTP, 1000x lighter than carrying your laptop around!**

No complex configuration needed, no weird commands to memorize. Double-click exe, hit start, scan/type URL, done!
Mom will never worry about me not knowing how to set up a server again 😎

### 🌟 v4.0 Latest Features

- 📊 **Product Comparison Tool**: Brand new product parameter comparison feature with multi-product management and visual comparison
  - **Attribute Management**: Customize product attributes with drag-and-drop sorting, support common parameters (numeric) and regular attributes (text)
  - **Common Parameter Configuration**: Set unit and direction (higher/lower is better) for each common parameter
  - **Belonging Classification**: Automatic product classification by belonging, each belonging with customizable color displayed in product list bookmark area
  - **Product Links**: Add external URLs, local file paths, or shared links to products for quick access to datasheets and documentation
  - **Radar Chart Comparison**: Chart.js-based radar chart visualization with multi-product overlay comparison
    - Independent normalization for each parameter based on all products' min/max values
    - Support single or multiple product comparison with distinct colors
    - Overlay display ensures all products are visible
  - **Smart Analysis**: Automatically identify optimal products for each parameter, count optimal items per product
  - **Parameter Sorting**: Sort products by any common parameter with column drag-and-drop reordering, support ascending/descending order
  - **Multi-select Comparison**: Select multiple parameters to compare relationships
  - **Data Persistence**: All comparison data saved in local JSON files with multi-file management and automatic format repair
  - **Jasmine Snow Theme**: Product comparison page uses unified Jasmine Snow theme

### 🌟 v3.0 Features

- 🍃 **Jasmine Snow Theme Refresh**: Unified cyan-green × snow-white gradient styling across every page (except the choice hub), with buttons, cards, and forms redesigned
- 🗂️ **ToDo Timeline Center**: Dedicated workspace with backdoor access, search & project filters, inherited/random project colors, and estimated completion tracking
- 📆 **Bidirectional Timeline**: Switch seamlessly between vertical and horizontal views; scroll automatically matches orientation with floating jump buttons for quick navigation
- 🧷 **Event Operations Upgrade**: Each timeline card now supports comment, edit, and single-event delete actions with history/comment sync
- ⏱️ **Pending Overview Board**: Fullscreen summary panel highlighting today's targets, overdue tasks, and remaining-time ranking, kept in sync with the timeline selection
- 🔌 **Serial Diagnostics Assistant**: PySerial + Socket.IO powered console for real-time serial monitoring, parameter tuning, browser-side command sending, plus continuous logging and history replay for paired ports

### 🌟 v2.2 Latest Features

- 🎮 **3D Model Viewer**: Integrated Three.js, supports GLTF/GLB, OBJ, STL formats with iframe embedded preview
- 🔄 **Interactive Viewing**: Mouse rotation, zoom, pan, wireframe mode, grid display and more
- 📊 **Model Statistics**: Display vertices, triangles, model dimensions and other details
- ➕ **Create New**: Support creating files, Draw.io diagrams, and folders quickly
- 📤 **File Upload**: Support multiple file uploads simultaneously
- ⚙️ **Configurable Close Behavior**: Choose between exit or minimize to tray when closing

### 🌟 v2.1 Features

- ✏️ **Online Code Editor**: Integrated CodeMirror with syntax highlighting for 30+ languages, edit directly in preview area
- 💾 **Real-time Save**: Ctrl+S quick save, save and close, auto-refresh preview
- 🎨 **Professional Editing**: Line numbers, code folding, bracket matching, find & replace

### 🌟 v2.0 Core Features

- 🔍 **Smart Search**: Real-time file search with type filtering
- 🔗 **Share Links**: One-click share with password, expiration, and access limits
- 🎵 **Audio Player**: Play MP3/WAV/FLAC and other audio files online
- 🖼️ **Image Lightbox**: Click images for fullscreen view with download
- 📺 **Fullscreen Preview**: Fullscreen mode for focused viewing
- 🔒 **Admin Password**: Dual password protection for directory changes
- 🌐 **Smart Network**: Auto-detect real IP, exclude virtual networks

### ✨ Key Features

#### ✏️ Online Code Editor (v2.1)
- **CodeMirror Integration**: Professional code editing experience with 100+ programming languages
- **Full Syntax Highlighting Support**:
  - **Web Development**: HTML, CSS, SCSS, Less, JavaScript, TypeScript, JSX, Vue, PHP
  - **Programming Languages**: Python, Java, C/C++, C#, Go, Rust, Ruby, Swift, Kotlin, Perl, Lua, Haskell, Erlang, Elixir
  - **Scripting**: Shell, PowerShell, Bash, Batch
  - **Data Formats**: JSON, XML, YAML, TOML, Protobuf
  - **Markup Languages**: Markdown, reStructuredText, LaTeX, Textile
  - **Databases**: SQL, MySQL, PostgreSQL, Cypher
  - **Config Files**: Nginx, Dockerfile, Properties, INI
  - **Template Engines**: Jinja2, Django, Handlebars, Pug, Smarty
  - **Others**: Diff, Git, HTTP, Verilog, VHDL, and more
- **Seamless Editing**: Edit directly in preview area, click "Edit File" button to switch
- **Professional Features**: Line numbers, code folding, auto-bracket matching, find & replace
- **Keyboard Shortcuts**: Ctrl+S save, Ctrl+F find, Ctrl+H replace, ESC cancel
- **Smart Save**: Save, Save & Close, Cancel options with unsaved change warnings
- **Monokai Theme**: Dark professional theme, easy on the eyes
- **Encoding Support**: Auto-detect UTF-8 and GBK encoding

#### 🔍 Smart Search & Filter
- **Real-time Search**: Instantly filter files as you type
- **Type Filter**: Quick filter by file type (images, documents, videos, audio, code, etc.)
- **Combined Use**: Use search and filter together to locate files quickly

#### 🔗 Share Link System
- **One-Click Share**: Generate share links with a single click
- **Password Protection**: Optional password protection for security
- **Flexible Expiration**: Set expiration from 1 hour to 30 days
- **Access Limit**: Set maximum visit count
- **QR Code**: Auto-generate QR codes for mobile access
- **Visit Statistics**: Detailed access logs and statistics
- **Smart Preview**: Online preview for Drawio/Markdown files
- **Smart Network**: Auto-detect real LAN IP, exclude virtual networks

#### 🎵 Multimedia Enhancement
- **Audio Player**: Play MP3, WAV, FLAC and other formats online
- **Image Lightbox**: Click to view images in fullscreen
- **Fullscreen Preview**: Preview area supports fullscreen mode
- **Video Player**: HTML5 video player with progress control

#### 🗂️ File Browser
- **Multi-format Support**:
  - 📷 Images: `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.svg`, `.webp`
  - 📝 Documents: `.md`, `.markdown` (Markdown files)
  - 📊 Draw.io diagrams: `.drawio`, `.diagram`, `.dio`, `.xml`
  - 📄 PDF files: `.pdf`
  - 🎬 Videos: `.mp4`, `.avi`, `.mov`, `.wmv`
  - 🎮 3D Models: `.gltf`, `.glb`, `.obj`, `.stl` - Interactive 3D viewer
  - 📋 Office files: `.docx`, `.xlsx`, `.pptx` (download only, no preview)
- **Real-time Preview**: Real-time rendering of Markdown files with tables, task lists, footnotes, code highlighting, etc.
- **Online Editing**: Text and code files can be edited directly in preview area with syntax highlighting for 100+ languages
- **File Operations**: Download, delete, and share files
- **Create New**:
  - 📝 Create File - Quick create text files
  - 📊 Create Draw.io Diagram - One-click create and open diagram editor
  - 📁 Create Folder - Build directory structure
- **File Upload**: Support single or multiple file uploads to current directory
- **Directory Management**: Create and delete folders with multi-level directory support

#### 🎨 Draw.io Integration
- **Full Editor**: Built-in complete Draw.io offline editor (Chinese interface)
- **Server-side Save**: Save diagrams directly to the server without downloading
- **Keyboard Shortcuts**: Support Ctrl+S for quick save
- **Real-time Preview**: Preview `.drawio` files in the file browser
- **Create New Diagrams**: Create new Draw.io diagrams and save them

#### 📝 Markdown Rendering
- **Rich Syntax**: Support tables, task lists, footnotes, definition lists, and more
- **Code Highlighting**: Syntax highlighting with Pygments
- **Image Path Processing**: Automatic handling of relative image paths
- **GitHub Style**: GitHub Markdown styling

#### 📊 Product Comparison Tool (v4.0)
- **Attribute Management**: Flexible product attribute definition with drag-and-drop sorting, support default attributes (name, belonging) and custom attributes
- **Common Parameters**: Attributes marked as common parameters support numeric input with unit and direction configuration (higher/lower is better)
- **Belonging Classification**: Automatic product classification by belonging, each belonging with customizable color displayed in the left bookmark area of product list
- **Product Links**: Add external URLs, local file paths, or shared links to products for quick access to datasheets and documentation
- **Radar Chart Visualization**: Chart.js-based radar chart with multi-product overlay comparison
  - Independent normalization for each parameter based on all products' min/max values
  - Support single or multiple product comparison with distinct colors
  - Overlay display ensures all products are visible
- **Smart Analysis**:
  - Automatically identify optimal products for each parameter (based on direction)
  - Count optimal items per product
  - Generate detailed comparison analysis reports
- **Parameter Sorting**: Sort products by any common parameter with column drag-and-drop reordering, support ascending/descending toggle
- **Multi-select Comparison**: Select multiple parameters to compare relationships
- **Data Management**: Support creating multiple comparison files, each file independently manages products and attributes
- **Data Persistence**: All data saved in local JSON files with automatic format repair and backward compatibility

#### 🔌 Serial Diagnostics Assistant (v3.0)
- **PySerial Backend**: Configure baud rate, data bits, parity, stop bits, and timeouts directly from the server
- **Continuous Logging**: Pair a port for always-on JSONL logging and reload the history from the browser at any time
- **Real-time Streaming**: Socket.IO pushes live serial logs to the browser with millisecond-level updates
- **Command Console**: Send commands, auto-append newline characters, and manage quick presets without extra tools
- **Multi-device Ready**: Debug embedded boards from any device with a browser—no need for vendor-specific utilities
- **Safe Controls**: Close ports, monitor statistics, and prevent duplicate access with built-in guards

#### 💻 Desktop GUI
- **Modern Interface**: Modern graphical interface based on PyQt5
- **System Tray**: Support minimize to system tray for background running
- **Configurable Close Behavior**: Choose close button behavior (exit or minimize to tray)
- **Real-time Logs**: Display server logs and access records
- **One-click Operations**: Start/stop server with one click, auto-open browser
- **Dual Password**: Login password + Admin password to protect directory changes

### 🚀 Quick Start

#### Option 1: Use Pre-compiled exe (Recommended)

1. **Download**: Download the latest `YobboyFileServer.exe` from [Releases](https://github.com/Yobby0402/YobbyFileServer/releases)
2. **Run**: Double-click `YobboyFileServer.exe` to launch
3. **Configure**: Set the file root directory on first run
4. **Use**: Click "Start Server" button, the program will automatically open the browser

#### Option 2: Run from Source

1. **Clone Repository**
```bash
git clone https://github.com/Yobby0402/YobbyFileServer.git
cd YobbyFileServer
```

2. **Install Dependencies**
```bash
pip install -r requirements.txt
```

3. **Run Program**
```bash
python main.py
```

### 📦 Dependencies

```
Flask>=3.1.0
PyQt5>=5.15.0
markdown-it-py>=3.0.0
mdit-py-plugins>=0.4.0
Pygments>=2.18.0
Pillow>=10.0.0
```

### ⚙️ Configuration

The program uses `config.ini` to save configuration (automatically created on first run):

```ini
[settings]
root_dir = /path/to/your/files   # File server root directory
password = ats123                 # Login password (default: ats123)
admin_password = admin123         # Admin password (default: admin123)
```

**Notes**:
- Config file is located in the program directory or user's `.yobboy_file_server` folder
- You can modify settings through the GUI "Settings" menu
- Changing shared directory requires admin password
- Server restart required after configuration changes
- ⚠️ **Please change default passwords immediately after first run!**

### 🎯 User Guide

#### File Browsing
1. After starting the server, visit the homepage in your browser
2. Select "File Browser" to enter the file management interface
3. Click folders to navigate into subdirectories
4. Click files to preview or download

#### Draw.io Editing
1. Select "Draw.io Editor" on the homepage
2. Create a new diagram or open a local file
3. Press Ctrl+S to save after editing
4. Enter a filename when saving for the first time

#### System Tray
1. Click "Minimize to Tray" button to hide the main window
2. Double-click the tray icon to restore the window
3. Right-click the tray icon to show menu (start/stop server, quit, etc.)

### 🛠️ Development & Build

#### Development Mode
```bash
python main.py
```

#### Package as exe
```bash
python -m PyInstaller --onefile --windowed \
  --add-data "templates;templates" \
  --add-data "static;static" \
  --hidden-import=routes \
  --hidden-import=markdown_it \
  --hidden-import=mdit_py_plugins \
  --name="YobboyFileServer" \
  main.py
```

The generated exe file is located at `dist/YobboyFileServer.exe`

### 📸 Screenshots

> *TODO: Add application screenshots*

### 🤝 Contributing

Issues and Pull Requests are welcome!

### 📄 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

**Third-party Component Licenses**:
- **Draw.io**: The integrated Draw.io editor is licensed under [Apache License 2.0](https://github.com/jgraph/drawio)
- **Bootstrap**: MIT License
- **Font Awesome**: Fonts under SIL OFL 1.1, CSS under MIT License

### 👨‍💻 Author

Copyright © 2025 Yobboy. All rights reserved.

---

<div align="center">

**如有问题或建议，请提交 Issue** / **For questions or suggestions, please submit an Issue**

Made with ❤️ by Yobboy

</div>

