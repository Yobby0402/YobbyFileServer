# Yobboy 文件服务器 / Yobboy File Server

<div align="center">

![Yobboy File Server](文件服务器.png)

**一个功能强大的本地文件浏览和编辑服务器**  
**A Powerful Local File Browser and Editor Server**

[![Python](https://img.shields.io/badge/Python-3.13+-blue.svg)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-3.1+-green.svg)](https://flask.palletsprojects.com/)
[![PyQt5](https://img.shields.io/badge/PyQt5-5.15+-orange.svg)](https://www.riverbankcomputing.com/software/pyqt/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[中文](#中文文档) | [English](#english-documentation) | [快速开始 🚀](快速开始.md)

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

- 🏢 **公司组会救星**：一键启动，浏览器访问，代码、图片、PDF、视频瞬间预览，老板再也不用等你拆电脑线了
- 🎓 **研究生汇报神器**：导师办公室投影仪在天花板上？没事，手机扫码打开网页，论文图表、实验数据、流程图直接展示
- 📊 **临时文件分享站**：同事要你的代码、设计图、文档？甩个局域网地址，自己下载去，比微信传文件快100倍还不压缩
- 🎨 **画图现场编辑**：客户突然要改流程图？掏出手机浏览器，Draw.io在线改，当场保存，专业度拉满
- 📁 **Markdown笔记展示**：写的技术文档、项目计划想让团队看？浏览器一开，表格、代码高亮、任务列表全都美美地渲染出来

**比 FileZilla 简单 10 倍，比 FTP 优雅 100 倍，比抱着电脑跑轻松 1000 倍！**

不需要复杂配置，不需要记住奇怪的命令，双击 exe，点击启动，扫码/输网址，搞定！
妈妈再也不用担心我不会搭建服务器了 😎

### ✨ 核心特性

#### 🗂️ 文件浏览器
- **多格式支持**：
  - 📷 图片格式：`.jpg`、`.jpeg`、`.png`、`.gif`、`.bmp`、`.svg`、`.webp`
  - 📝 文档格式：`.md`、`.markdown` (Markdown 文件)
  - 📊 Draw.io 图表：`.drawio`、`.diagram`、`.dio`、`.xml`
  - 📄 PDF 文件：`.pdf`
  - 🎬 视频文件：`.mp4`、`.avi`、`.mov`、`.wmv`
  - 📋 Office 文件：`.docx`、`.xlsx`、`.pptx` (仅下载，不预览)
- **实时预览**：支持 Markdown 文件的实时渲染，包括表格、任务列表、脚注、代码高亮等
- **文件操作**：上传、下载、删除、重命名等完整的文件管理功能
- **目录管理**：创建、删除文件夹，支持多级目录结构

#### 🎨 Draw.io 集成
- **完整编辑器**：内置完整的 Draw.io 离线编辑器（中文界面）
- **服务器保存**：编辑图表后直接保存到服务器，无需每次下载
- **快捷键支持**：支持 Ctrl+S 快速保存
- **实时预览**：在文件浏览器中实时预览 `.drawio` 文件
- **本地文件上传**：可以上传本地 Draw.io 文件到服务器进行编辑

#### 📝 Markdown 渲染
- **丰富语法**：支持表格、任务列表、脚注、定义列表等
- **图片路径处理**：自动处理相对路径图片

#### 💻 桌面 GUI
- **现代界面**：基于 PyQt5 的现代化图形界面
- **系统托盘**：支持最小化到系统托盘，后台运行
- **实时日志**：显示服务器运行日志和访问记录
- **一键操作**：一键启动/停止服务器，自动打开浏览器

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

### ⚙️ 配置说明

程序使用 `config.ini` 文件保存配置（首次运行自动创建）：

```ini
[settings]
root_dir = /path/to/your/files  # 文件服务器根目录
password = your_password         # 登录密码（默认：ats123）
```

**注意**：
- 配置文件位于程序所在目录或用户目录的 `.yobboy_file_server` 文件夹中
- 可以通过 GUI 界面的"设置"菜单修改配置
- 修改配置后需要重启服务器才能生效

### 🎯 使用指南

#### 文件浏览
1. 启动服务器后，在浏览器中访问主页
2. 选择"文件浏览器"进入文件管理界面
3. 点击文件夹可以进入子目录
4. 点击文件可以预览或下载

#### Draw.io 编辑
1. 在主页选择"Draw.io 编辑器"
2. 可以新建图表或打开本地文件
3. 编辑完成后按 Ctrl+S 保存
4. 首次保存需要输入文件名

#### 系统托盘
1. 点击"最小化到托盘"按钮可以隐藏主窗口
2. 双击托盘图标恢复窗口
3. 右键托盘图标显示菜单（启动/停止服务器、退出等）

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

Yobboy File Server is a local web server application that integrates file browsing, Markdown preview, and Draw.io diagram editing. With a modern GUI interface, you can easily start the server and manage/edit files in your browser.

### 🎬 Use Cases

**Say goodbye to the awkward moment of running around the conference room with your laptop!**

Still struggling with weekly meetings, project presentations, or advisor group meetings? Laptop too heavy to carry? Projector cable too short to reach? USB drives keep getting viruses?

This project was born to save your back and your dignity!

- 🏢 **Meeting Lifesaver**: One-click start, browser access, instantly preview code, images, PDFs, and videos - your boss won't have to wait for you to unplug your laptop anymore
- 🎓 **Graduate Student Savior**: Projector mounted on the ceiling in professor's office? No problem! Scan QR code, open webpage, display paper diagrams, experimental data, and flowcharts directly
- 📊 **Instant File Sharing Hub**: Colleague needs your code, designs, or documents? Throw them a LAN address, let them download themselves - 100x faster than WeChat without compression
- 🎨 **Live Diagram Editor**: Client suddenly wants flowchart changes? Pull out your phone browser, edit in Draw.io, save on the spot - professionalism maxed out
- 📁 **Markdown Showcase**: Want your team to see technical docs or project plans? Open in browser, beautifully rendered with tables, code highlighting, and task lists

**10x simpler than FileZilla, 100x more elegant than FTP, 1000x lighter than carrying your laptop around!**

No complex configuration needed, no weird commands to memorize. Double-click exe, hit start, scan/type URL, done!
Mom will never worry about me not knowing how to set up a server again 😎

### ✨ Key Features

#### 🗂️ File Browser
- **Multi-format Support**:
  - 📷 Images: `.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.svg`, `.webp`
  - 📝 Documents: `.md`, `.markdown` (Markdown files)
  - 📊 Draw.io diagrams: `.drawio`, `.diagram`, `.dio`, `.xml`
  - 📄 PDF files: `.pdf`
  - 🎬 Videos: `.mp4`, `.avi`, `.mov`, `.wmv`
  - 📋 Office files: `.docx`, `.xlsx`, `.pptx` (download only, no preview)
- **Real-time Preview**: Real-time rendering of Markdown files with tables, task lists, footnotes, code highlighting, etc.
- **File Operations**: Complete file management with upload, download, delete, and rename
- **Directory Management**: Create and delete folders with multi-level directory support

#### 🎨 Draw.io Integration
- **Full Editor**: Built-in complete Draw.io offline editor (Chinese interface)
- **Server-side Save**: Save diagrams directly to the server without downloading
- **Keyboard Shortcuts**: Support Ctrl+S for quick save
- **Real-time Preview**: Preview `.drawio` files in the file browser
- **Local File Upload**: Upload local Draw.io files to the server for editing

#### 📝 Markdown Rendering
- **Rich Syntax**: Support tables, task lists, footnotes, definition lists, and more
- **Code Highlighting**: Syntax highlighting with Pygments
- **Image Path Processing**: Automatic handling of relative image paths
- **GitHub Style**: GitHub Markdown styling

#### 💻 Desktop GUI
- **Modern Interface**: Modern graphical interface based on PyQt5
- **System Tray**: Support minimize to system tray for background running
- **Real-time Logs**: Display server logs and access records
- **One-click Operations**: Start/stop server with one click, auto-open browser

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
root_dir = /path/to/your/files  # File server root directory
password = your_password         # Login password (default: ats123)
```

**Notes**:
- Config file is located in the program directory or user's `.yobboy_file_server` folder
- You can modify settings through the GUI "Settings" menu
- Server restart required after configuration changes

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

