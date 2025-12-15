#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
打包脚本 - 将项目打包为 exe 并复制资源文件到 dist 目录
"""
import os
import sys
import shutil
import subprocess
import time

def print_progress(message):
    """打印进度信息"""
    print(f"[{time.strftime('%H:%M:%S')}] {message}")

def main():
    print("=" * 60)
    print("Yobboy 文件服务器 - 打包脚本")
    print("=" * 60)
    print()
    
    # 检测是否在虚拟环境中
    in_venv = hasattr(sys, 'real_prefix') or (hasattr(sys, 'base_prefix') and sys.base_prefix != sys.prefix)
    if in_venv:
        print_progress(f"✓ 检测到虚拟环境: {sys.prefix}")
    else:
        print_progress("⚠ 未检测到虚拟环境，使用系统Python")
        print_progress("  建议在虚拟环境中打包以确保依赖版本一致")
    
    # 检查 PyInstaller 是否安装
    try:
        import PyInstaller
        print_progress("✓ PyInstaller 已安装")
    except ImportError:
        print_progress("✗ PyInstaller 未安装，正在安装...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])
        print_progress("✓ PyInstaller 安装完成")
    
    # 清理旧的构建文件
    print_progress("清理旧的构建文件...")
    for dir_name in ['build']:
        if os.path.exists(dir_name):
            shutil.rmtree(dir_name, ignore_errors=True)
            print_progress(f"  ✓ 已清理 {dir_name}/")
    
    # 如果dist目录存在，询问是否清理
    if os.path.exists('dist'):
        print_progress("发现已存在的 dist 目录")
        # 直接清理，不询问
        shutil.rmtree('dist', ignore_errors=True)
        print_progress("  ✓ 已清理 dist/")
    
    print_progress("开始打包（这可能需要5-10分钟，请耐心等待...）")
    print()
    
    # 使用spec文件打包（如果存在）
    spec_file = "YobboyFileServer.spec"
    if os.path.exists(spec_file):
        print_progress(f"使用现有的 spec 文件: {spec_file}")
        cmd = [sys.executable, "-m", "PyInstaller", spec_file, "--clean", "--noconfirm"]
    else:
        print_progress("创建新的打包配置...")
        cmd = [
            sys.executable, "-m", "PyInstaller",
            "--onedir",
            "--windowed",
            "--name=YobboyFileServer",
            "--icon=文件服务器.ico",
            "--add-data", "templates;templates",
            "--add-data", "static;static",
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
            "--collect-all", "markdown_it",
            "--collect-all", "mdit_py_plugins",
            "--collect-all", "Pygments",
            "--collect-all", "openpyxl",
            "main.py"
        ]
    
    print_progress("执行 PyInstaller 打包命令...")
    print("（这个过程可能需要几分钟，请勿中断）")
    print()
    
    # 执行打包
    try:
        result = subprocess.run(cmd, check=True, capture_output=False)
    except subprocess.CalledProcessError as e:
        print_progress(f"✗ 打包失败！错误代码: {e.returncode}")
        return 1
    except KeyboardInterrupt:
        print_progress("\n✗ 打包被用户中断")
        return 1
    
    print()
    print_progress("✓ PyInstaller 打包完成！")
    
    # 检查dist目录
    dist_dir = "dist/YobboyFileServer"
    if not os.path.exists(dist_dir):
        print_progress(f"✗ 错误：找不到 {dist_dir} 目录")
        return 1
    
    # 复制资源文件到 dist 目录
    print()
    print_progress("复制资源文件到 dist 目录...")
    
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
            try:
                if os.path.isdir(src_path):
                    # 如果是目录，先删除目标目录（如果存在），然后复制
                    if os.path.exists(dst_path):
                        shutil.rmtree(dst_path)
                    shutil.copytree(src_path, dst_path)
                    print_progress(f"  ✓ 已复制目录: {src} -> {dst_path}")
                else:
                    # 如果是文件，直接复制
                    shutil.copy2(src_path, dst_path)
                    print_progress(f"  ✓ 已复制文件: {src} -> {dst_path}")
                copied_count += 1
            except Exception as e:
                print_progress(f"  ✗ 复制失败 {src}: {e}")
        else:
            print_progress(f"  ⚠ 警告：找不到 {src_path}，跳过")
    
    print()
    print_progress(f"✓ 资源文件复制完成（共 {copied_count} 项）")
    
    # 显示结果
    exe_path = os.path.join(dist_dir, "YobboyFileServer.exe")
    if os.path.exists(exe_path):
        size_mb = os.path.getsize(exe_path) / (1024 * 1024)
        print()
        print("=" * 60)
        print("打包成功！")
        print("=" * 60)
        print(f"可执行文件: {exe_path}")
        print(f"文件大小: {size_mb:.2f} MB")
        print(f"\n资源文件位置:")
        print(f"  - {os.path.join(dist_dir, 'templates')}")
        print(f"  - {os.path.join(dist_dir, 'static')}")
        print(f"\n可以分发整个 '{dist_dir}' 文件夹")
        print("=" * 60)
    else:
        print_progress(f"✗ 错误：找不到可执行文件 {exe_path}")
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

