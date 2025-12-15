#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
打包脚本 - 将项目打包为 exe 并复制资源文件到 dist 目录
"""
import os
import sys
import shutil
import subprocess

def main():
    print("=" * 60)
    print("Yobboy 文件服务器 - 打包脚本")
    print("=" * 60)
    
    # 检查 PyInstaller 是否安装
    try:
        import PyInstaller
        print("✓ PyInstaller 已安装")
    except ImportError:
        print("✗ PyInstaller 未安装，正在安装...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])
        print("✓ PyInstaller 安装完成")
    
    # 清理旧的构建文件
    print("\n清理旧的构建文件...")
    for dir_name in ['build', 'dist', '__pycache__']:
        if os.path.exists(dir_name):
            if dir_name == '__pycache__':
                # 只清理根目录的 __pycache__
                for root, dirs, files in os.walk('.'):
                    if '__pycache__' in dirs and root == '.':
                        shutil.rmtree(os.path.join(root, '__pycache__'), ignore_errors=True)
            else:
                shutil.rmtree(dir_name, ignore_errors=True)
            print(f"  ✓ 已清理 {dir_name}/")
    
    # 清理 .spec 文件
    for spec_file in os.listdir('.'):
        if spec_file.endswith('.spec'):
            os.remove(spec_file)
            print(f"  ✓ 已删除 {spec_file}")
    
    print("\n开始打包...")
    
    # PyInstaller 命令
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onedir",  # 使用目录模式，而不是单文件模式
        "--windowed",  # 无控制台窗口
        "--name=YobboyFileServer",
        "--icon=文件服务器.ico",
        # 添加数据文件
        "--add-data", "templates;templates",
        "--add-data", "static;static",
        # 隐藏导入
        "--hidden-import=routes",
        "--hidden-import=markdown_it",
        "--hidden-import=mdit_py_plugins",
        "--hidden-import=serial_manager",
        "--hidden-import=todo_manager",
        "--hidden-import=share_links",
        "--hidden-import=product_compare_manager",
        "--hidden-import=serial.serialutil",
        "--hidden-import=engineio.async_drivers.threading",
        "--hidden-import=socketio",
        "--hidden-import=openpyxl",
        "--hidden-import=openpyxl.styles",
        "--hidden-import=openpyxl.utils",
        "--collect-all", "flask",
        "--collect-all", "flask_socketio",
        "--collect-all", "markdown_it",
        "--collect-all", "mdit_py_plugins",
        "--collect-all", "Pygments",
        "--collect-all", "openpyxl",
        "main.py"
    ]
    
    print("执行命令:")
    print(" ".join(cmd))
    print()
    
    # 执行打包
    result = subprocess.run(cmd, check=True)
    
    if result.returncode != 0:
        print("✗ 打包失败！")
        return 1
    
    print("\n✓ 打包完成！")
    
    # 复制资源文件到 dist 目录
    dist_dir = "dist/YobboyFileServer"
    if not os.path.exists(dist_dir):
        print(f"✗ 错误：找不到 {dist_dir} 目录")
        return 1
    
    print("\n复制资源文件到 dist 目录...")
    
    # 需要复制的文件和文件夹
    resources = [
        ("templates", "templates"),
        ("static", "static"),
        ("文件服务器.ico", "文件服务器.ico"),
        ("文件服务器.png", "文件服务器.png"),
    ]
    
    copied_count = 0
    for src, dst in resources:
        src_path = src
        dst_path = os.path.join(dist_dir, dst)
        
        if os.path.exists(src_path):
            if os.path.isdir(src_path):
                # 如果是目录，先删除目标目录（如果存在），然后复制
                if os.path.exists(dst_path):
                    shutil.rmtree(dst_path)
                shutil.copytree(src_path, dst_path)
                print(f"  ✓ 已复制目录: {src} -> {dst_path}")
            else:
                # 如果是文件，直接复制
                shutil.copy2(src_path, dst_path)
                print(f"  ✓ 已复制文件: {src} -> {dst_path}")
            copied_count += 1
        else:
            print(f"  ⚠ 警告：找不到 {src_path}，跳过")
    
    print(f"\n✓ 资源文件复制完成（共 {copied_count} 项）")
    
    # 显示结果
    exe_path = os.path.join(dist_dir, "YobboyFileServer.exe")
    if os.path.exists(exe_path):
        size_mb = os.path.getsize(exe_path) / (1024 * 1024)
        print(f"\n{'=' * 60}")
        print("打包成功！")
        print(f"{'=' * 60}")
        print(f"可执行文件: {exe_path}")
        print(f"文件大小: {size_mb:.2f} MB")
        print(f"\n资源文件位置:")
        print(f"  - {os.path.join(dist_dir, 'templates')}")
        print(f"  - {os.path.join(dist_dir, 'static')}")
        print(f"\n可以分发整个 '{dist_dir}' 文件夹")
        print("=" * 60)
    else:
        print(f"\n✗ 错误：找不到可执行文件 {exe_path}")
        return 1
    
    return 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\n\n打包已取消")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ 打包过程中出现错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

