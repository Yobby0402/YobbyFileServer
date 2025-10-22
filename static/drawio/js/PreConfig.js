/**
 * Copyright (c) 2006-2020, JGraph Ltd
 * Copyright (c) 2006-2020, draw.io AG
 */
// Overrides of global vars need to be pre-loaded
window.EXPORT_URL = 'REPLACE_WITH_YOUR_IMAGE_SERVER';
window.PLANT_URL = 'REPLACE_WITH_YOUR_PLANTUML_SERVER';
window.DRAWIO_BASE_URL = null; // Replace with path to base of deployment, e.g. https://www.example.com/folder
window.DRAWIO_VIEWER_URL = null; // Replace your path to the viewer js, e.g. https://www.example.com/js/viewer.min.js
window.DRAWIO_LIGHTBOX_URL = null; // Replace with your lightbox URL, eg. https://www.example.com
window.DRAW_MATH_URL = 'math/es5';

// 配置为完全离线模式，禁用所有第三方云服务
window.DRAWIO_CONFIG = {
    // 默认库
    defaultLibraries: 'general',
    
    // 禁用自定义库
    enableCustomLibraries: false,
    
    // 启用的库列表
    enabledLibraries: ['general', 'uml', 'entity', 'mockup', 'flowchart', 'basic', 'arrows2'],
    
    // 禁用所有云服务
    mode: 'device',  // 设备模式，只允许本地存储
    
    // 禁用的功能
    showStartScreen: false,  // 禁用启动屏幕
    
    // 禁用云存储选项
    disableGoogleDrive: true,
    disableDropbox: true,
    disableOneDrive: true,
    disableGitHub: true,
    disableGitLab: true,
    disableTrello: true,
    
    // 只允许设备和浏览器存储
    storageTypes: ['device', 'browser'],
    
    // 禁用外部服务
    plugins: [],
    
    // 离线模式
    offline: true,
    
    // 禁用追踪和分析
    analytics: false,
    
    // 禁用检查更新
    checkUpdates: false,
    
    // 设置界面语言为中文简体
    language: 'zh'
};

urlParams['sync'] = 'manual';
urlParams['offline'] = '1';
urlParams['stealth'] = '1';
urlParams['local'] = '1';
urlParams['lang'] = 'zh';  // 设置界面语言为中文
urlParams['proxy'] = '';  // 禁用代理
