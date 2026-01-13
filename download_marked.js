// 下载 marked.js 到本地
// 使用方法: node download_marked.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const url = 'https://cdn.jsdelivr.net/npm/marked@12.0.0/marked.min.js';
const outputDir = path.join(__dirname, 'static', 'libs', 'marked');
const outputFile = path.join(outputDir, 'marked.min.js');

// 确保目录存在
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

console.log('正在下载 marked.js...');
console.log(`URL: ${url}`);
console.log(`保存路径: ${outputFile}`);

const file = fs.createWriteStream(outputFile);

https.get(url, (response) => {
    if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
            file.close();
            console.log('✓ marked.js 下载成功！');
            console.log(`文件大小: ${fs.statSync(outputFile).size} 字节`);
        });
    } else if (response.statusCode === 301 || response.statusCode === 302) {
        // 处理重定向
        const redirectUrl = response.headers.location;
        console.log(`重定向到: ${redirectUrl}`);
        https.get(redirectUrl, (redirectResponse) => {
            redirectResponse.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log('✓ marked.js 下载成功！');
                console.log(`文件大小: ${fs.statSync(outputFile).size} 字节`);
            });
        }).on('error', (err) => {
            fs.unlinkSync(outputFile);
            console.error('下载失败:', err.message);
        });
    } else {
        fs.unlinkSync(outputFile);
        console.error(`下载失败: HTTP ${response.statusCode}`);
    }
}).on('error', (err) => {
    fs.unlinkSync(outputFile);
    console.error('下载失败:', err.message);
});
