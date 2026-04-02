#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
打包脚本 - 将项目打包为单个exe文件
运行方式: python build_exe.py
"""

import os
import sys
import shutil
import subprocess
from pathlib import Path


def log(message):
    """Use console-safe output on Windows terminals with legacy encodings."""
    print(message)

def clear_dist_folder():
    """清除dist文件夹内容"""
    dist_path = Path('dist')
    if dist_path.exists():
        log('正在清除dist文件夹...')
        for item in dist_path.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
            else:
                item.unlink()
        log('[OK] dist文件夹已清空')
    else:
        dist_path.mkdir(exist_ok=True)
        log('[OK] dist文件夹已创建')

def build_exe():
    """使用PyInstaller打包exe（使用spec文件）"""
    log('\n开始打包exe文件...')
    
    # 检查spec文件是否存在
    if not Path('YobboyFileServer.spec').exists():
        log('[ERROR] 未找到YobboyFileServer.spec文件')
        return False
    
    # 使用spec文件打包（更可靠）
    cmd = [
        'pyinstaller',
        '--clean',                      # 清理临时文件
        '--noconfirm',                  # 不询问确认
        'YobboyFileServer.spec'         # 使用spec文件
    ]
    
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, encoding='utf-8', errors='ignore')
        if result.stdout:
            log(result.stdout)
        log('[OK] exe文件打包完成')
        return True
    except subprocess.CalledProcessError as e:
        log(f'[ERROR] 打包失败: {e}')
        if e.stdout:
            log(f'标准输出: {e.stdout}')
        if e.stderr:
            log(f'错误输出: {e.stderr}')
        return False
    except FileNotFoundError:
        log('[ERROR] 未找到pyinstaller，请先安装: pip install pyinstaller')
        return False

def copy_resources():
    """复制资源文件到dist文件夹"""
    log('\n正在复制资源文件...')
    
    dist_path = Path('dist')
    if not dist_path.exists():
        log('[ERROR] dist文件夹不存在')
        return False
    
    # 需要复制的文件夹
    folders_to_copy = ['static', 'templates']
    
    # 需要复制的文件（ico和png）- 只复制根目录下的
    files_to_copy = []
    root_files = ['文件服务器.ico', '文件服务器.png']
    for file_name in root_files:
        file_path = Path(file_name)
        if file_path.exists():
            files_to_copy.append(file_path)
    
    copied_count = 0
    
    # 复制文件夹
    for folder_name in folders_to_copy:
        src_folder = Path(folder_name)
        if src_folder.exists() and src_folder.is_dir():
            dst_folder = dist_path / folder_name
            if dst_folder.exists():
                shutil.rmtree(dst_folder)
            shutil.copytree(src_folder, dst_folder)
            log(f'[OK] 已复制文件夹: {folder_name}')
            copied_count += 1
        else:
            log(f'[WARN] 文件夹不存在: {folder_name}')
    
    # 复制文件
    for file_path in files_to_copy:
        dst_file = dist_path / file_path.name
        shutil.copy2(file_path, dst_file)
        log(f'[OK] 已复制文件: {file_path.name}')
        copied_count += 1

    if copied_count > 0:
        log(f'\n[OK] 资源文件复制完成（共{copied_count}项）')
    else:
        log('\n[WARN] 没有复制任何资源文件')

    return True


def verify_dist_resources():
    """Verify that key runtime files exist after packaging."""
    log('\n正在校验打包产物...')
    required_paths = [
        Path('dist/YobboyFileServer.exe'),
        Path('dist/static/js/serial_tool.js'),
        Path('dist/static/js/serial_tool_shared.js'),
        Path('dist/static/js/socket.io.min.js'),
        Path('dist/templates/serial_tool.html'),
    ]

    missing = [str(path) for path in required_paths if not path.exists()]
    if missing:
        log('[ERROR] 以下关键文件缺失:')
        for item in missing:
            log(f'  - {item}')
        return False

    log('[OK] 关键打包文件校验通过')
    return True

def main():
    """主函数"""
    log('=' * 60)
    log('Yobboy 文件服务器 - 打包脚本')
    log('=' * 60)
    
    # 检查主程序文件
    if not Path('main.py').exists():
        log('[ERROR] 未找到main.py文件')
        return
    
    # 检查图标文件
    if not Path('文件服务器.ico').exists():
        log('[WARN] 未找到图标文件 文件服务器.ico')
    
    # 1. 清除dist文件夹
    clear_dist_folder()
    
    # 2. 打包exe
    if not build_exe():
        log('\n[ERROR] 打包失败，请检查错误信息')
        return
    
    # 3. 复制资源文件
    if not copy_resources():
        log('\n[ERROR] 资源文件复制失败')
        return

    # 4. 校验关键资源
    if not verify_dist_resources():
        log('\n[ERROR] 打包产物校验失败')
        return

    log('\n' + '=' * 60)
    log('[OK] 打包完成！')
    log('=' * 60)
    log(f'\n输出目录: {Path("dist").absolute()}')
    log('exe文件位置: dist\\YobboyFileServer.exe')
    log('\n注意: exe文件需要与static和templates文件夹在同一目录下运行')

if __name__ == '__main__':
    main()
