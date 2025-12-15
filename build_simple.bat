@echo off
chcp 65001 >nul
echo ============================================================
echo Yobboy 文件服务器 - 打包脚本
echo ============================================================
echo.

echo 清理旧的构建文件...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist
echo ✓ 清理完成
echo.

echo 开始打包（这可能需要几分钟，请耐心等待...）
echo.

pyinstaller --onedir --windowed --name=YobboyFileServer --icon=文件服务器.ico --add-data "templates;templates" --add-data "static;static" --hidden-import=routes --hidden-import=markdown_it --hidden-import=mdit_py_plugins --hidden-import=serial_manager --hidden-import=todo_manager --hidden-import=share_links --hidden-import=product_compare_manager --hidden-import=serial.serialutil --hidden-import=engineio.async_drivers.threading --hidden-import=socketio --hidden-import=openpyxl --hidden-import=openpyxl.styles --hidden-import=openpyxl.utils --collect-all flask --collect-all markdown_it --collect-all mdit_py_plugins --collect-all Pygments --collect-all openpyxl main.py

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ✗ 打包失败！
    pause
    exit /b 1
)

echo.
echo ✓ PyInstaller 打包完成！
echo.

echo 复制资源文件到 dist 目录...
if not exist "dist\YobboyFileServer" (
    echo ✗ 错误：找不到 dist\YobboyFileServer 目录
    pause
    exit /b 1
)

if exist templates (
    xcopy /E /I /Y templates dist\YobboyFileServer\templates >nul
    echo ✓ 已复制 templates 目录
)

if exist static (
    xcopy /E /I /Y static dist\YobboyFileServer\static >nul
    echo ✓ 已复制 static 目录
)

if exist "文件服务器.ico" (
    copy /Y "文件服务器.ico" dist\YobboyFileServer\ >nul
    echo ✓ 已复制 文件服务器.ico
)

if exist "文件服务器.png" (
    copy /Y "文件服务器.png" dist\YobboyFileServer\ >nul
    echo ✓ 已复制 文件服务器.png
)

echo.
echo ============================================================
echo 打包成功！
echo ============================================================
echo 可执行文件: dist\YobboyFileServer\YobboyFileServer.exe
echo 资源文件位置:
echo   - dist\YobboyFileServer\templates
echo   - dist\YobboyFileServer\static
echo.
echo 可以分发整个 'dist\YobboyFileServer' 文件夹
echo ============================================================
echo.
pause


