#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
将PNG图标转换为ICO格式
用于PyInstaller打包
"""

from PIL import Image
import os

def convert_png_to_ico(png_path, ico_path):
    """将PNG图片转换为ICO格式"""
    try:
        # 打开PNG图片
        img = Image.open(png_path)
        
        # 转换为RGBA模式（如果不是的话）
        if img.mode != 'RGBA':
            img = img.convert('RGBA')
        
        # 创建多个尺寸的图标（Windows推荐）
        icon_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
        
        # 保存为ICO格式
        img.save(ico_path, format='ICO', sizes=icon_sizes)
        print(f"✓ 图标转换成功: {ico_path}")
        return True
        
    except Exception as e:
        print(f"✗ 图标转换失败: {e}")
        return False

if __name__ == '__main__':
    png_file = '文件服务器.png'
    ico_file = '文件服务器.ico'
    
    if not os.path.exists(png_file):
        print(f"✗ 找不到文件: {png_file}")
        print("请确保 文件服务器.png 文件存在")
        exit(1)
    
    if convert_png_to_ico(png_file, ico_file):
        print(f"\n现在可以使用以下命令打包:")
        print("pyinstaller YobboyFileServer.spec")
    else:
        print("\n如果转换失败，请先安装Pillow库:")
        print("pip install Pillow")

