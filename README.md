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

**比 FileZilla 简单 10 倍，比 FTP 优雅 100 倍，比抱着电脑跑轻松 1000 倍！**

不需要复杂配置，不需要记住奇怪的命令，双击 exe，点击启动，扫码/输网址，搞定！
妈妈再也不用担心我不会搭建服务器了 😎

### 🌟 v2.2 最新功能

- 🎮 **3D模型查看器**：集成Three.js，支持GLTF/GLB、OBJ、STL等格式的3D模型在线预览，iframe嵌入式预览
- 🔄 **交互式查看**：鼠标旋转、缩放、平移，线框模式、网格显示等多种查看模式
- 📊 **模型统计**：显示顶点数、三角形数、模型尺寸等详细信息
- ➕ **新建功能**：支持新建文件、Draw.io图表、文件夹，快速创建内容
- 📤 **文件上传**：支持多文件同时上传，拖拽上传文件到服务器
- ⚙️ **关闭行为可配置**：可选择关闭按钮是退出程序还是最小化到托盘

### 🌟 v2.1 功能

- ✏️ **在线代码编辑器**：集成CodeMirror，支持30+种语言的语法高亮，直接在预览区域编辑文件
- 💾 **实时保存**：Ctrl+S快捷键保存，支持保存并关闭，自动刷新预览
- 🎨 **专业编辑体验**：行号、代码折叠、括号匹配、查找替换等完整功能

### 🌟 v2.0 核心功能

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
password = ats123                 # 登录密码（默认：ats123）
admin_password = admin123         # 管理员密码（默认：admin123）
close_to_tray = false             # 关闭按钮行为（true=最小化到托盘，false=退出程序）
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

**10x simpler than FileZilla, 100x more elegant than FTP, 1000x lighter than carrying your laptop around!**

No complex configuration needed, no weird commands to memorize. Double-click exe, hit start, scan/type URL, done!
Mom will never worry about me not knowing how to set up a server again 😎

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

