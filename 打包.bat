@echo off
chcp 65001 >nul
echo ============================================================
echo Yobboy 文件服务器 - 打包脚本
echo ============================================================
echo.

REM 检测并使用虚拟环境
if exist .venv\Scripts\python.exe (
    set PYTHON_EXE=.venv\Scripts\python.exe
    echo 使用虚拟环境: .venv
) else if exist venv\Scripts\python.exe (
    set PYTHON_EXE=venv\Scripts\python.exe
    echo 使用虚拟环境: venv
) else (
    set PYTHON_EXE=python
    echo 使用系统Python环境
)
echo Python路径: %PYTHON_EXE%
echo.

echo 清理旧的构建文件...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
echo ✓ 清理完成
echo.

echo 开始打包（这可能需要几分钟，请耐心等待...）
echo 使用 spec 文件: YobboyFileServer.spec
echo.

%PYTHON_EXE% -m PyInstaller YobboyFileServer.spec --clean --noconfirm

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ✗ 打包失败！
    pause
    exit /b 1
)

echo.
echo ============================================================
echo 打包完成！
echo ============================================================
echo 可执行文件位置: dist\YobboyFileServer.exe
echo.
echo 注意：资源文件（templates 和 static）需要手动复制到
echo      dist\ 目录中（与exe文件同一目录）
echo ============================================================
echo.
pause

