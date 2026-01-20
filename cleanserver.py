# download_static_resources.py
import requests
import os

# 定义要下载的资源
resources = {
    'css/bootstrap.min.css': 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css',
    'css/font-awesome.min.css': 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'css/github-markdown-light.min.css': 'https://cdnjs.cloudflare.com/ajax/libs/github-markdown-css/5.2.0/github-markdown-light.min.css',
    'js/bootstrap.bundle.min.js': 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js',
    'js/jquery-3.6.0.min.js': 'https://code.jquery.com/jquery-3.6.0.min.js',
}

# 创建目录
os.makedirs('static/css', exist_ok=True)
os.makedirs('static/js', exist_ok=True)

# 下载文件
for local_path, url in resources.items():
    full_path = os.path.join('static', local_path)
    print(f"📥 正在下载: {url}")
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()  # 检查 HTTP 错误
        with open(full_path, 'wb') as f:
            f.write(response.content)
        print(f"✅ 已保存: {full_path}")
    except Exception as e:
        print(f"❌ 下载失败 {url}: {e}")

print("\n🎉 所有静态资源下载完成！")