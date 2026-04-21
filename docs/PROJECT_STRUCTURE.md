# 项目结构说明

> 本文档说明当前仓库的代码分层、资源目录和打包入口，避免业务模块继续散落在项目根目录。

## 目录职责

```text
YobboyFileServer/
├── main.py                         # 兼容启动入口：python main.py
├── mcp_server.py                   # 兼容 MCP 启动入口：python mcp_server.py
├── yobboy_file_server/             # 应用主包，所有后端业务代码放这里
│   ├── main.py                     # GUI / Flask 应用主实现
│   ├── routes.py                   # 主 Web 路由
│   ├── *_manager.py                # 业务管理器
│   ├── local_ai_*.py               # 本地 AI / MCP 集成
│   ├── git_*.py                    # Git 集成
│   ├── paths.py                    # 统一项目根目录解析
│   └── __init__.py
├── scripts/                        # 开发/构建/维护脚本
│   ├── build_exe.py                # PyInstaller 打包入口
│   ├── cleanserver.py
│   └── convert_icon.py
├── templates/                      # Flask/Jinja 页面模板
├── static/                         # 前端静态资源
├── tests/                          # 单元测试
├── docs/                           # 设计、实施和维护文档
├── data/                           # 运行期数据，通常不提交业务数据
├── logs/                           # 运行期日志
├── AI/                             # 本地 AI skills / models 目录
├── YobboyFileServer.spec           # PyInstaller spec
└── requirements.txt
```

## 开发入口

```bash
python main.py
```

根目录的 `main.py` 只是兼容启动器，真实实现位于 `yobboy_file_server/main.py`。

也可以使用包入口方式：

```bash
python -m yobboy_file_server.main
```

## MCP 入口

```bash
python mcp_server.py
```

根目录的 `mcp_server.py` 也是兼容启动器，真实实现位于 `yobboy_file_server/mcp_server.py`。

## 打包入口

```bash
python scripts/build_exe.py
```

打包脚本会：

- 使用根目录的 `YobboyFileServer.spec`
- 构建 `dist/YobboyFileServer.exe`
- 复制 `static/`、`templates/`、`AI/skills/`
- 复制 `yobboy_file_server/` 包，保证外部 MCP 兼容入口可运行

## 新增代码放置规则

- 新的后端模块放到 `yobboy_file_server/`
- 新的维护脚本放到 `scripts/`
- 新的页面模板放到 `templates/`
- 新的前端资源放到 `static/`
- 新的设计/实施文档放到 `docs/`
- 本地离线 ERP 功能与规划文档保留在 `dev-erp` 分支；非 ERP 分支不新增 ERP 模块
- 不要再把业务模块直接放到项目根目录
