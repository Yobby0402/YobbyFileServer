# 安装指南 / Installation Guide

[中文](#中文安装指南) | [English](#english-installation-guide)

---

## 中文安装指南

### 🚀 方式一：使用预编译的 exe（推荐新手）

这是最简单的方式，无需安装 Python 环境。

#### 步骤：

1. **下载程序**
   - 从 [Releases](https://github.com/Yobby0402/YobbyFileServer/releases) 页面下载最新的 `YobboyFileServer.exe`
   - 或直接下载项目 ZIP 包并解压使用

2. **准备图标文件（可选）**
   - 将 `文件服务器.png` 或 `文件服务器.ico` 放在与 exe 相同的目录下
   - 这将使托盘图标更美观

3. **运行程序**
   - 双击 `YobboyFileServer.exe`
   - 首次运行时，会提示设置文件根目录
   - 点击"浏览"选择一个文件夹作为服务器根目录

4. **启动服务器**
   - 点击"🟢 启动服务器"按钮
   - 程序会自动打开浏览器访问 `http://localhost:5000`

5. **开始使用**
   - 选择"文件浏览器"管理文件
   - 选择"Draw.io 编辑器"创建和编辑图表

#### 系统要求：
- Windows 10/11（64位）
- 无需安装 Python
- 至少 100MB 可用磁盘空间

---


### 项目结构说明

后端业务代码位于 `yobboy_file_server/`，维护脚本位于 `scripts/`。打包请使用：

```bash
python scripts/build_exe.py
```

更多说明见 `docs/PROJECT_STRUCTURE.md`。

### 🔧 方式二：从源码运行（推荐开发者）

适合需要修改代码或进行二次开发的用户。

#### 步骤：

1. **检查 Python 版本**
   ```bash
   python --version
   ```
   需要 Python 3.13 或更高版本。如果没有，请从 [python.org](https://www.python.org/) 下载安装。

2. **克隆或下载项目**
   ```bash
   # 使用 Git 克隆
   git clone https://github.com/Yobby0402/YobbyFileServer.git
   cd YobbyFileServer
   
   # 或者直接下载 ZIP 并解压
   ```

3. **创建虚拟环境（推荐）**
   ```bash
   # Windows
   python -m venv venv
   venv\Scripts\activate
   
   # Linux/Mac
   python3 -m venv venv
   source venv/bin/activate
   ```

4. **安装依赖**
   ```bash
   pip install -r requirements.txt
   ```
   
   **依赖说明**：
   - Flask：Web框架
   - PyQt5：GUI界面
   - markdown-it-py：Markdown渲染
   - CodeMirror/Vditor：前端编辑器（已包含在static/libs/中）

5. **配置程序（首次运行会自动创建）**
   ```bash
   # 首次运行时会自动创建 config.ini
   # 配置文件包含：
   # - root_dir: 文件服务器根目录
   # - password: 登录密码（默认：ats123）
   ```

6. **运行程序**
   ```bash
   python main.py
   ```

7. **访问服务器**
   - 程序会自动打开浏览器
   - 或手动访问 `http://localhost:5000`

#### 系统要求：
- Python 3.13+
- Windows/Linux/macOS
- 约 500MB 磁盘空间（包括依赖）

---

### 🔨 方式三：自己打包 exe

如果您修改了源码，想要打包成 exe 文件。

#### 步骤：

1. **完成"方式二"的步骤 1-4**（安装 Python 和依赖）

2. **安装 PyInstaller**（如果还没安装）
   ```bash
   pip install pyinstaller
   ```

3. **运行打包命令**
   ```bash
   python scripts/build_exe.py
   ```

4. **查找生成的 exe**
   - 生成的文件位于 `dist/YobboyFileServer.exe`
   - 将 `文件服务器.png` 和 `文件服务器.ico` 复制到 `dist/` 目录

5. **分发**
   - 可以直接分发 `dist/YobboyFileServer.exe`
   - 建议同时打包图标文件

---

### 🐛 常见问题

#### 1. 提示"找不到 Python"
**解决**：安装 Python 3.13+ 并确保添加到 PATH 环境变量。

#### 2. 安装依赖时出错
**解决**：
```bash
# 升级 pip
pip install --upgrade pip

# 使用国内镜像加速（中国用户）
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

#### 3. 程序启动后托盘图标不显示
**解决**：确保 `文件服务器.png` 或 `文件服务器.ico` 与 exe 在同一目录。

#### 4. 无法访问网页
**解决**：
- 检查防火墙是否阻止了 5000 端口
- 尝试使用 `127.0.0.1:5000` 而不是 `localhost:5000`
- 查看程序日志窗口的错误信息

#### 5. Draw.io 保存失败
**解决**：
- 确保文件路径有写入权限
- 尝试使用 Ctrl+S 而不是右下角按钮
- 检查文件名是否包含特殊字符

#### 6. 代码编辑器不显示语法高亮
**解决**：
- 确保CodeMirror文件完整（static/libs/codemirror/）
- 清除浏览器缓存后重试
- 检查浏览器控制台是否有错误

#### 7. 编辑器无法滚动
**解决**：
- 已在v2.1中使用CodeMirror解决此问题
- 如仍有问题，请清除浏览器缓存

---

## English Installation Guide

### 🚀 Option 1: Use Pre-compiled exe (Recommended for Beginners)

This is the simplest method, no Python environment required.

#### Steps:

1. **Download the Program**
   - Download the latest `YobboyFileServer.exe` from the [Releases](https://github.com/Yobby0402/YobbyFileServer/releases) page
   - Or download the project ZIP package and extract it

2. **Prepare Icon Files (Optional)**
   - Place `文件服务器.png` or `文件服务器.ico` in the same directory as the exe
   - This will make the tray icon look better

3. **Run the Program**
   - Double-click `YobboyFileServer.exe`
   - On first run, you'll be prompted to set the file root directory
   - Click "Browse" to select a folder as the server root directory

4. **Start the Server**
   - Click the "🟢 Start Server" button
   - The program will automatically open the browser to `http://localhost:5000`

5. **Start Using**
   - Select "File Browser" to manage files
   - Select "Draw.io Editor" to create and edit diagrams

#### System Requirements:
- Windows 10/11 (64-bit)
- No Python installation required
- At least 100MB free disk space

---

### 🔧 Option 2: Run from Source (Recommended for Developers)

Suitable for users who need to modify the code or do secondary development.

#### Steps:

1. **Check Python Version**
   ```bash
   python --version
   ```
   Requires Python 3.13 or higher. If not installed, download from [python.org](https://www.python.org/).

2. **Clone or Download the Project**
   ```bash
   # Clone with Git
   git clone https://github.com/Yobby0402/YobbyFileServer.git
   cd YobbyFileServer
   
   # Or download ZIP and extract
   ```

3. **Create Virtual Environment (Recommended)**
   ```bash
   # Windows
   python -m venv venv
   venv\Scripts\activate
   
   # Linux/Mac
   python3 -m venv venv
   source venv/bin/activate
   ```

4. **Install Dependencies**
   ```bash
   pip install -r requirements.txt
   ```

5. **Configure the Program (Auto-created on first run)**
   ```bash
   # Config file will be auto-created on first run
   # Configuration includes:
   # - root_dir: File server root directory
   # - password: Login password (default: ats123)
   ```

6. **Run the Program**
   ```bash
   python main.py
   ```

7. **Access the Server**
   - The program will automatically open the browser
   - Or manually visit `http://localhost:5000`

#### System Requirements:
- Python 3.13+
- Windows/Linux/macOS
- About 500MB disk space (including dependencies)

---

### 🔨 Option 3: Build Your Own exe

If you've modified the source code and want to package it as an exe.

#### Steps:

1. **Complete Steps 1-4 of "Option 2"** (Install Python and dependencies)

2. **Install PyInstaller** (if not already installed)
   ```bash
   pip install pyinstaller
   ```

3. **Run the Build Command**
   ```bash
   python scripts/build_exe.py
   ```

4. **Locate the Generated exe**
   - The generated file is at `dist/YobboyFileServer.exe`
   - Copy `文件服务器.png` and `文件服务器.ico` to the `dist/` directory

5. **Distribution**
   - You can directly distribute `dist/YobboyFileServer.exe`
   - It's recommended to package the icon files as well

---

### 🐛 Common Issues

#### 1. "Python not found" error
**Solution**: Install Python 3.13+ and ensure it's added to the PATH environment variable.

#### 2. Error when installing dependencies
**Solution**:
```bash
# Upgrade pip
pip install --upgrade pip

# Use China mirror for faster downloads (China users)
pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

#### 3. Tray icon doesn't show after program starts
**Solution**: Ensure `文件服务器.png` or `文件服务器.ico` is in the same directory as the exe.

#### 4. Cannot access the web page
**Solution**:
- Check if the firewall is blocking port 5000
- Try using `127.0.0.1:5000` instead of `localhost:5000`
- Check the program log window for error messages

#### 5. Draw.io save fails
**Solution**:
- Ensure the file path has write permissions
- Try using Ctrl+S instead of the bottom-right button
- Check if the filename contains special characters

---

<div align="center">

**需要帮助？请提交 Issue** / **Need Help? Submit an Issue**

[返回主页 / Back to README](README.md)

</div>


