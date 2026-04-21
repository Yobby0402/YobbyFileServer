#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
打包脚本 - 将项目打包为单个exe文件
运行方式: python scripts/build_exe.py
"""

import os
import sys
import shutil
import subprocess
from pathlib import Path
from typing import Iterable, Iterator, Optional, TypeVar

try:
    from tqdm import tqdm  # type: ignore
except Exception:
    tqdm = None

T = TypeVar('T')
PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.chdir(PROJECT_ROOT)


def log(message):
    """Use console-safe output on Windows terminals with legacy encodings."""
    if tqdm is not None:
        try:
            tqdm.write(str(message))
            return
        except Exception:
            pass
    print(message)


def progress_iter(items: Iterable[T], *, desc: str, unit: str = 'item') -> Iterator[T]:
    """Wrap iterable with tqdm when available."""
    if tqdm is None:
        return iter(items)
    try:
        total = len(items)  # type: ignore[arg-type]
    except Exception:
        total = None
    return tqdm(items, total=total, desc=desc, unit=unit, dynamic_ncols=True)


def should_build_external_mcp_exe() -> bool:
    """
    是否额外构建独立 mcp_server.exe。
    默认关闭（单 EXE 集成模式）；设置 BUILD_MCP_EXE=1/true/on 可开启。
    """
    raw = (os.environ.get('BUILD_MCP_EXE') or '').strip().lower()
    return raw in ('1', 'true', 'yes', 'on')

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


def build_mcp_server_exe():
    """构建独立 MCP 服务可执行文件（无 Python 环境也可运行）。"""
    log('\n开始打包 mcp_server.exe...')
    if not Path('mcp_server.py').exists():
        log('[ERROR] 未找到 mcp_server.py')
        return False
    cmd = [
        'pyinstaller',
        '--clean',
        '--noconfirm',
        '--onefile',
        '--console',
        '--name',
        'mcp_server',
        '--distpath',
        'dist',
        '--workpath',
        'build/mcp_server_build',
        '--specpath',
        'build/mcp_server_spec',
        'mcp_server.py',
    ]
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True, encoding='utf-8', errors='ignore')
        if result.stdout:
            log(result.stdout)
        log('[OK] mcp_server.exe 打包完成')
        return True
    except subprocess.CalledProcessError as e:
        log(f'[ERROR] mcp_server.exe 打包失败: {e}')
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
    optional_folders_to_copy = ['AI/skills']
    
    # 需要复制的文件（根目录资源 + MCP 运行时脚本）
    files_to_copy = []
    root_files = [
        '文件服务器.ico',
        '文件服务器.png',
        'mcp_server.py',
        'README.md',
        'CHANGELOG.md',
        '快速开始.md',
        '功能说明.md',
    ]
    for file_name in root_files:
        file_path = Path(file_name)
        if file_path.exists():
            files_to_copy.append(file_path)
    
    copied_count = 0
    
    # 复制必需文件夹
    for folder_name in progress_iter(folders_to_copy, desc='复制必需目录', unit='dir'):
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

    # 复制可选文件夹（存在才复制，不存在不视为错误）
    for folder_name in progress_iter(optional_folders_to_copy, desc='复制可选目录', unit='dir'):
        src_folder = Path(folder_name)
        if src_folder.exists() and src_folder.is_dir():
            dst_folder = dist_path / folder_name
            if dst_folder.exists():
                shutil.rmtree(dst_folder)
            dst_folder.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(src_folder, dst_folder)
            log(f'[OK] 已复制可选文件夹: {folder_name}')
            copied_count += 1
        else:
            log(f'[INFO] 可选文件夹不存在，已跳过: {folder_name}')
    
    # 复制文件
    for file_path in progress_iter(files_to_copy, desc='复制资源文件', unit='file'):
        dst_file = dist_path / file_path.name
        shutil.copy2(file_path, dst_file)
        log(f'[OK] 已复制文件: {file_path.name}')
        copied_count += 1

    package_src = Path('yobboy_file_server')
    package_dst = dist_path / 'yobboy_file_server'
    if package_src.exists():
        if package_dst.exists():
            shutil.rmtree(package_dst)
        shutil.copytree(
            package_src,
            package_dst,
            ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.pyo'),
        )
        log('[OK] 已复制应用包: yobboy_file_server')
        copied_count += 1

    if copied_count > 0:
        log(f'\n[OK] 资源文件复制完成（共{copied_count}项）')
    else:
        log('\n[WARN] 没有复制任何资源文件')

    # 确保 AI 目录结构存在（模型目录默认只创建，不自动复制大文件）
    (dist_path / 'AI' / 'models').mkdir(parents=True, exist_ok=True)
    (dist_path / 'AI' / 'skills').mkdir(parents=True, exist_ok=True)
    log('[OK] AI 目录结构已准备: dist/AI/models, dist/AI/skills')

    return True


def verify_dist_resources(include_external_mcp_exe=False):
    """Verify that key runtime files exist after packaging."""
    log('\n正在校验打包产物...')
    required_paths = [
        Path('dist/YobboyFileServer.exe'),
        Path('dist/static/js/serial_tool.js'),
        Path('dist/static/js/serial_tool_shared.js'),
        Path('dist/static/js/socket.io.min.js'),
        Path('dist/templates/serial_tool.html'),
        Path('dist/static/css/local_ai.css'),
        Path('dist/static/js/local_ai_panel.js'),
        Path('dist/static/js/drawio_ai_panel.js'),
        Path('dist/static/libs/purify/purify.min.js'),
        Path('dist/templates/partials/local_ai_dock.html'),
        Path('dist/templates/local_erp.html'),
        Path('dist/mcp_server.py'),
        Path('dist/README.md'),
        Path('dist/CHANGELOG.md'),
        Path('dist/快速开始.md'),
        Path('dist/功能说明.md'),
        Path('dist/yobboy_file_server/main.py'),
        Path('dist/yobboy_file_server/todo_ai_bridge.py'),
        Path('dist/yobboy_file_server/embedding_client.py'),
        Path('dist/yobboy_file_server/knowledge_index_db.py'),
        Path('dist/yobboy_file_server/knowledge_job_manager.py'),
        Path('dist/yobboy_file_server/knowledge_store.py'),
        Path('dist/yobboy_file_server/local_ai_paths.py'),
        Path('dist/yobboy_file_server/local_erp_manager.py'),
        Path('dist/yobboy_file_server/local_erp_routes.py'),
        Path('dist/yobboy_file_server/sql/local_erp_schema.sql'),
        Path('dist/yobboy_file_server/todo_manager.py'),
    ]
    if include_external_mcp_exe:
        required_paths.append(Path('dist/mcp_server.exe'))

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
    
    build_external_mcp = should_build_external_mcp_exe()
    total_steps = 5 if build_external_mcp else 4

    flow_bar: Optional[object] = None
    if tqdm is not None:
        flow_bar = tqdm(total=total_steps, desc='打包流程', unit='step', dynamic_ncols=True)
    else:
        log('[INFO] 未检测到 tqdm，使用普通日志模式（可选安装: pip install tqdm）')

    # 1. 清除dist文件夹
    clear_dist_folder()
    if flow_bar is not None:
        flow_bar.update(1)

    # 2. 打包主程序 exe
    if not build_exe():
        if flow_bar is not None:
            flow_bar.close()
        log('\n[ERROR] 打包失败，请检查错误信息')
        return
    if flow_bar is not None:
        flow_bar.update(1)

    # 3. 可选：打包独立 MCP 服务 exe（默认关闭，单 EXE 集成模式不需要）
    if build_external_mcp:
        if not build_mcp_server_exe():
            if flow_bar is not None:
                flow_bar.close()
            log('\n[ERROR] mcp_server.exe 打包失败')
            return
        if flow_bar is not None:
            flow_bar.update(1)
    else:
        log('\n[INFO] 已启用单 EXE 集成模式：跳过 mcp_server.exe 打包。')

    # 4. 复制资源文件
    if not copy_resources():
        if flow_bar is not None:
            flow_bar.close()
        log('\n[ERROR] 资源文件复制失败')
        return
    if flow_bar is not None:
        flow_bar.update(1)

    # 5. 校验关键资源
    if not verify_dist_resources(include_external_mcp_exe=build_external_mcp):
        if flow_bar is not None:
            flow_bar.close()
        log('\n[ERROR] 打包产物校验失败')
        return
    if flow_bar is not None:
        flow_bar.update(1)
        flow_bar.close()

    log('\n' + '=' * 60)
    log('[OK] 打包完成！')
    log('=' * 60)
    log(f'\n输出目录: {Path("dist").absolute()}')
    log('exe文件位置: dist\\YobboyFileServer.exe')
    if build_external_mcp:
        log('MCP服务位置: dist\\mcp_server.exe')
    else:
        log('MCP服务: 内置到主程序（不需要单独 exe）')
    log('\n注意: exe文件需要与static和templates文件夹在同一目录下运行')

if __name__ == '__main__':
    main()
