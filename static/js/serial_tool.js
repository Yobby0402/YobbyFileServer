// 串口调试助手 JavaScript

class SerialToolApp {
    constructor() {
        this.ports = new Map(); // 存储所有串口连接
        this.currentPort = null; // 当前选中的串口
        this.dataLog = []; // 数据日志
        this.connectionMode = 'local'; // 连接模式：local 或 remote
        this.isPaused = false; // 是否暂停显示
        this.autoScroll = true; // 是否自动滚动
        this.dataFormat = 'text'; // 数据显示格式
        this.sendFormat = 'text'; // 发送数据格式
        this.rxBytes = 0; // 接收字节数
        this.txBytes = 0; // 发送字节数
        this.startTime = null; // 开始时间
        this.uptimeInterval = null; // 运行时间定时器
        this.timerInterval = null; // 定时发送定时器
        this.commands = []; // 快捷指令列表
        this.websocket = null; // WebSocket 连接
        this.dataBuffer = { rx: null, tx: null }; // 数据缓冲，用于合并连续数据
        this.bufferTimeout = null; // 缓冲超时定时器
        this.displayMode = 'bubble'; // 显示模式：bubble 或 terminal
        this.localEcho = true; // 本地回显：是否显示用户输入的字符
        this.captureSessions = new Map(); // 持续日志会话
        this.historyMarkers = new Map(); // 已加载日志的时间戳
        this.capturePortOptions = []; // 可用串口列表
        this.captureStatusRefreshTimer = null; // 持续日志状态定时刷新
        this.serverConfig = window.SERIAL_SERVER_CONFIG || {};

        this.init();
    }
    
    init() {
        // 检查浏览器兼容性
        this.checkBrowserCompatibility();
        
        // 加载保存的配置
        this.loadSettings();
        
        // 绑定事件
        this.bindEvents();
        
        // 初始化模态框
        this.initModals();

        // 加载持续日志信息
        this.loadCapturePorts();
        this.loadCaptureStatus();
        
        console.log('串口调试助手已初始化');
    }
    
    // 检查浏览器兼容性
    checkBrowserCompatibility() {
        console.log('=== 浏览器兼容性检测 ===');
        console.log('User Agent:', navigator.userAgent);
        console.log('协议:', window.location.protocol);
        console.log('主机:', window.location.host);
        console.log('isSecureContext:', window.isSecureContext);
        console.log('navigator.serial 存在?', 'serial' in navigator);
        
        const ua = navigator.userAgent;
        const isChromiumBased = ua.includes('Chrome') || ua.includes('Edg/') || ua.includes('OPR/');
        const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
        const isHTTPS = window.location.protocol === 'https:';
        const isSecure = isLocalhost || isHTTPS;
        
        if (!('serial' in navigator)) {
            // Web Serial API 不可用
            if (isChromiumBased && !isSecure) {
                // 是 Chromium 浏览器，但不是安全上下文
                this.showSecurityContextWarning();
                console.warn('Web Serial API 被禁用：不是安全上下文');
            } else {
                // 真的不支持
                this.showBrowserWarning();
                console.warn('浏览器不支持 Web Serial API');
            }
        } else {
            console.log('✅ 浏览器支持 Web Serial API');
            this.showBrowserInfo();
        }
    }
    
    // 显示浏览器信息（支持时）
    showBrowserInfo() {
        const info = document.createElement('div');
        info.className = 'browser-info';
        info.style.cssText = `
            position: fixed;
            top: 70px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            background: #d4edda;
            color: #155724;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            border: 1px solid #c3e6cb;
            max-width: 600px;
            animation: slideDown 0.3s ease;
        `;
        info.innerHTML = `
            <button class="close-btn" onclick="this.parentElement.remove()" style="position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #155724; opacity: 0.7;">×</button>
            <strong><i class="fas fa-check-circle"></i> 浏览器支持 Web Serial API</strong>
            <p class="mb-0 mt-2" style="font-size: 0.9rem;">
                当前浏览器: <strong>${this.getBrowserName()}</strong><br>
                点击左侧"添加"按钮即可连接串口设备
            </p>
        `;
        document.body.appendChild(info);
        
        // 3秒后自动关闭
        setTimeout(() => {
            info.style.transition = 'opacity 0.3s ease';
            info.style.opacity = '0';
            setTimeout(() => info.remove(), 300);
        }, 3000);
    }
    
    // 获取浏览器名称
    getBrowserName() {
        const ua = navigator.userAgent;
        if (ua.includes('Edg/')) {
            const version = ua.match(/Edg\/([\d.]+)/);
            return `Microsoft Edge ${version ? version[1] : ''}`;
        }
        if (ua.includes('Chrome/')) {
            const version = ua.match(/Chrome\/([\d.]+)/);
            return `Google Chrome ${version ? version[1] : ''}`;
        }
        if (ua.includes('OPR/')) {
            const version = ua.match(/OPR\/([\d.]+)/);
            return `Opera ${version ? version[1] : ''}`;
        }
        return '未知浏览器';
    }
    
    // 显示安全上下文警告（关键！）
    showSecurityContextWarning() {
        const warning = document.createElement('div');
        warning.className = 'browser-warning';
        warning.style.cssText = `
            position: fixed;
            top: 70px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            background: #fff3cd;
            color: #856404;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            border: 1px solid #ffeeba;
            max-width: 650px;
            animation: slideDown 0.3s ease;
        `;
        
        const remoteSerialEnabled = !!this.serverConfig.remote_serial_enabled;
        const serialHttpsUrl = this.serverConfig.serial_https_url || 'https://服务器地址:端口/serial_tool';
        const recommendation = remoteSerialEnabled
            ? `
                <li><strong>服务器已启用远程串口</strong>：<br>
                    请改用 <code>${serialHttpsUrl}</code> 访问当前页面。
                </li>
                <li><strong>如果仍显示 HTTP</strong>：<br>
                    请在服务器 PyQt 设置里检查证书配置并重启服务。
                </li>
              `
            : `
                <li><strong>当前远程串口未启用</strong>：<br>
                    服务器保持 HTTP 属于正常行为。
                </li>
                <li><strong>如需客户端连接本机串口</strong>：<br>
                    请在服务器 PyQt 设置中启用远程串口（自动 HTTPS）。
                </li>
              `;
        
        warning.innerHTML = `
            <button class="close-btn" onclick="this.parentElement.remove()" style="position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #856404; opacity: 0.7;">×</button>
            <strong><i class="fas fa-exclamation-triangle"></i> 本地串口功能被限制</strong>
            <p class="mb-2 mt-2">
                您的浏览器是 <strong>${this.getBrowserName()}</strong>，支持 Web Serial API。<br>
                但当前访问地址 <code>${window.location.protocol}//${window.location.host}</code> 不是安全上下文。
            </p>
            <p class="mb-2" style="font-size: 0.95rem;">
                <strong>🔒 原因：</strong><br>
                Web Serial API 需要<strong>安全上下文</strong>（HTTPS 或 localhost），这是浏览器的安全策略。
            </p>
            <p class="mb-2" style="font-size: 0.95rem;">
                <strong>✅ 建议操作：</strong>
            </p>
            <ol style="font-size: 0.9rem; margin-left: 20px;">
                ${recommendation}
                <li><strong>使用“远程串口”模式</strong>：<br>
                    可访问服务器自身串口（不受 Web Serial 的安全上下文限制）。
                </li>
            </ol>
            <p class="mb-0" style="font-size: 0.85rem; background: #e7f3ff; padding: 10px; border-radius: 4px; margin-top: 10px;">
                <strong>💡 提示：</strong>本地串口模式访问的是<strong>你自己电脑的串口</strong>，与服务器地址无关。<br>
                该限制来自浏览器安全策略，不是串口工具自身逻辑问题。
            </p>
        `;
        document.body.appendChild(warning);
    }
    
    // 显示浏览器兼容性警告
    showBrowserWarning() {
        const warning = document.createElement('div');
        warning.className = 'browser-warning';
        warning.style.cssText = `
            position: fixed;
            top: 70px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 9999;
            background: #f8d7da;
            color: #721c24;
            padding: 15px 20px;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            border: 1px solid #f5c6cb;
            max-width: 600px;
            animation: slideDown 0.3s ease;
        `;
        
        const ua = navigator.userAgent;
        let browserInfo = '';
        
        if (ua.includes('Firefox')) {
            browserInfo = '<strong>Firefox</strong> 浏览器暂不支持 Web Serial API';
        } else if (ua.includes('Safari') && !ua.includes('Chrome')) {
            browserInfo = '<strong>Safari</strong> 浏览器暂不支持 Web Serial API';
        } else {
            browserInfo = '当前浏览器不支持 Web Serial API';
        }
        
        warning.innerHTML = `
            <button class="close-btn" onclick="this.parentElement.remove()" style="position: absolute; top: 10px; right: 10px; background: none; border: none; font-size: 1.2rem; cursor: pointer; color: #721c24; opacity: 0.7;">×</button>
            <strong><i class="fas fa-times-circle"></i> 浏览器不支持</strong>
            <p class="mb-2 mt-2">
                ${browserInfo}
            </p>
            <p class="mb-0" style="font-size: 0.9rem;">
                <strong>解决方案：</strong><br>
                1. 使用 <strong>Chrome 89+</strong>、<strong>Edge 89+</strong> 或 <strong>Opera 76+</strong> 浏览器<br>
                2. 或切换到"☁️ 远程串口"模式（所有浏览器都支持）
            </p>
        `;
        document.body.appendChild(warning);
    }
    
    // 加载保存的配置
    async loadSettings() {
        try {
            // 从服务器加载快捷指令
            const response = await fetch('/load_serial_commands');
            const result = await response.json();
            
            if (result.success && result.commands) {
                this.commands = result.commands;
                this.renderCommandList();
                console.log('快捷指令已加载:', this.commands.length, '条');
            }
            
            // 加载其他设置（仍用 localStorage）
            const appendCRLF = localStorage.getItem('serialToolAppendCRLF');
            if (appendCRLF) {
                document.getElementById('appendCRLF').checked = appendCRLF === 'true';
            }
        } catch (error) {
            console.error('加载设置失败:', error);
        }
    }
    
    // 保存设置
    async saveSettings() {
        try {
            // 保存快捷指令到服务器
            const response = await fetch('/save_serial_commands', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    commands: this.commands
                })
            });
            
            const result = await response.json();
            if (result.success) {
                console.log('快捷指令已保存到服务器');
            } else {
                console.error('保存快捷指令失败:', result.error);
            }
            
            // 保存其他设置到 localStorage
            localStorage.setItem('serialToolAppendCRLF', document.getElementById('appendCRLF').checked);
        } catch (error) {
            console.error('保存设置失败:', error);
        }
    }
    
    async loadCapturePorts(force = false) {
        try {
            const response = await fetch('/api/serial/ports');
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '获取串口列表失败');
            }
            this.capturePortOptions = Array.isArray(result.ports) ? result.ports : [];
            this.renderCapturePorts();
            if (force) {
                this.addLog('串口列表已刷新', 'info');
            }
        } catch (error) {
            console.error('加载串口列表失败:', error);
            this.addLog(`获取串口列表失败: ${error.message || error}`, 'error');
        }
    }

    renderCapturePorts() {
        const select = document.getElementById('capturePortSelect');
        if (!select) return;
        const previous = select.value;
        select.innerHTML = '<option value="">请选择服务器串口</option>';
        this.capturePortOptions.forEach((port) => {
            const option = document.createElement('option');
            option.value = port.device;
            option.textContent = `${port.device} - ${port.name || '未命名设备'}`;
            select.appendChild(option);
        });
        if (previous && select.querySelector(`option[value="${previous}"]`)) {
            select.value = previous;
        }
    }

    async loadCaptureStatus(force = false) {
        try {
            const response = await fetch('/api/serial/capture/status');
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '获取日志状态失败');
            }
            this.captureSessions.clear();
            const sessions = Array.isArray(result.sessions) ? result.sessions : [];
            sessions.forEach((session) => {
                if (session && session.port_id) {
                    this.captureSessions.set(session.port_id, session);
                    // 为持续日志创建占位串口信息，便于直接查看历史
                    if (!this.ports.has(session.port_id)) {
                        this.ports.set(session.port_id, {
                            id: session.port_id,
                            name: session.device || session.port_id,
                            type: 'remote',
                            config: session.config || {},
                            connected: false,
                            captureOnly: true,
                        });
                    }
                }
            });
            // 清理已停止的占位端口
            const removeIds = [];
            this.ports.forEach((info, portId) => {
                if (info.captureOnly && !this.captureSessions.has(portId)) {
                    removeIds.push(portId);
                }
            });
            removeIds.forEach((pid) => this.ports.delete(pid));
            this.renderCaptureStatus();
            this.updatePortLoggingFlags();
            if (force) {
                this.addLog('持续日志状态已刷新', 'info');
            }
        } catch (error) {
            console.error('加载持续日志状态失败:', error);
            this.addLog(`获取持续日志状态失败: ${error.message || error}`, 'error');
        }
    }

    formatDuration(ms) {
        if (!Number.isFinite(ms) || ms < 0) return '--';
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        const parts = [];
        if (h > 0) parts.push(h + ' 时');
        parts.push((m % 60) + ' 分');
        parts.push((s % 60) + ' 秒');
        return parts.join(' ');
    }

    formatBytes(n) {
        if (!Number.isFinite(n) || n < 0) return '--';
        if (n >= 1048576) return (n / 1048576).toFixed(2) + ' MB';
        if (n >= 1024) return (n / 1024).toFixed(2) + ' KB';
        return n + ' B';
    }

    renderCaptureStatus() {
        const list = document.getElementById('captureSessionList');
        if (!list) return;

        if (this.captureSessions.size === 0) {
            this.stopCaptureStatusRefresh();
            list.innerHTML = `
                <div class="list-group-item text-muted small text-center py-2">
                    暂无持续日志任务
                </div>
            `;
            return;
        }

        this.startCaptureStatusRefresh();

        list.innerHTML = '';
        this.captureSessions.forEach((session) => {
            const item = document.createElement('div');
            item.className = 'list-group-item';
            item.dataset.portId = session.port_id;

            const startedAt = session.started_at ? new Date(session.started_at).toLocaleString() : '--';
            const startedMs = session.started_at ? new Date(session.started_at).getTime() : null;
            const durationMs = startedMs ? (Date.now() - startedMs) : 0;
            const durationStr = this.formatDuration(durationMs);
            const bytesLogged = session.bytes_logged != null ? session.bytes_logged : 0;
            const bytesStr = this.formatBytes(bytesLogged);

            const config = session.config || {};
            const parityMap = {
                N: '无',
                NONE: '无',
                E: '偶',
                EVEN: '偶',
                O: '奇',
                ODD: '奇',
                M: '标记',
                S: '空格',
            };
            const parityCode = (config.parity || 'N').toString().toUpperCase();
            const parityLabel = parityMap[parityCode] || '无';

            item.innerHTML = `
                <div>
                    <div class="fw-bold">${session.device || session.port_id}</div>
                    <div class="session-meta small">
                        波特率 ${config.baudrate || '--'} · 数据位 ${config.bytesize || '--'} · 停止位 ${config.stopbits || '--'} · 校验 ${parityLabel}<br>
                        启动时间：${startedAt}<br>
                        <strong>记录时长：</strong><span class="capture-duration" data-started-at="${session.started_at || ''}">${durationStr}</span>
                        <strong class="ms-2">记录长度：</strong><span class="capture-bytes">${bytesStr}</span>
                    </div>
                </div>
                <div class="capture-session-actions btn-group btn-group-sm flex-wrap" role="group">
                    <button type="button" class="btn btn-outline-secondary" data-action="view-log" data-port-id="${session.port_id}" title="在弹窗中查看记录内容">
                        <i class="fas fa-external-link-alt me-1"></i>弹窗查看
                    </button>
                    <button type="button" class="btn btn-outline-secondary" data-action="load-log" data-port-id="${session.port_id}" title="将历史记录加载到下方数据监控区">
                        <i class="fas fa-tv me-1"></i>加载到监控区
                    </button>
                    <button type="button" class="btn btn-outline-secondary" data-action="open-port" data-port-id="${session.port_id}" title="连接此串口进行收发">
                        <i class="fas fa-plug me-1"></i>连接
                    </button>
                    <button type="button" class="btn btn-outline-danger" data-action="stop-log" data-port-id="${session.port_id}" title="停止持续日志">
                        <i class="fas fa-stop me-1"></i>停止
                    </button>
                </div>
            `;
            list.appendChild(item);
        });
    }

    startCaptureStatusRefresh() {
        if (this.captureStatusRefreshTimer) return;
        const interval = 3000;
        this.captureStatusRefreshTimer = setInterval(() => {
            if (this.captureSessions.size === 0) {
                this.stopCaptureStatusRefresh();
                return;
            }
            this.loadCaptureStatus(false);
        }, interval);
    }

    stopCaptureStatusRefresh() {
        if (this.captureStatusRefreshTimer) {
            clearInterval(this.captureStatusRefreshTimer);
            this.captureStatusRefreshTimer = null;
        }
    }

    updatePortLoggingFlags() {
        this.ports.forEach((info, portId) => {
            info.captureActive = this.captureSessions.has(portId);
        });
        this.renderPortList();
    }

    async startCaptureLogging() {
        const select = document.getElementById('capturePortSelect');
        if (!select || !select.value) {
            alert('请选择要记录的串口设备');
            return;
        }

        const device = select.value;
        const baudRateField = document.getElementById('captureBaudRate');
        const dataBitsField = document.getElementById('captureDataBits');
        const parityField = document.getElementById('captureParity');
        const stopBitsField = document.getElementById('captureStopBits');

        const config = {
            baudrate: parseInt(baudRateField?.value || '9600', 10),
            bytesize: parseInt(dataBitsField?.value || '8', 10),
            parity: parityField?.value || 'none',
            stopbits: parseInt(stopBitsField?.value || '1', 10),
        };
        if (!Number.isFinite(config.baudrate) || config.baudrate <= 0) {
            alert('请输入正确的波特率');
            return;
        }
        if (!Number.isFinite(config.bytesize) || ![7, 8].includes(config.bytesize)) {
            alert('数据位必须为 7 或 8');
            return;
        }
        if (!Number.isFinite(config.stopbits) || ![1, 2].includes(config.stopbits)) {
            alert('停止位必须为 1 或 2');
            return;
        }

        const portId = this.buildRemotePortId(device, config.baudrate);

        try {
            const response = await fetch('/api/serial/capture/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    device,
                    port_id: portId,
                    baudrate: config.baudrate,
                    bytesize: config.bytesize,
                    parity: config.parity,
                    stopbits: config.stopbits,
                }),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '开启持续日志失败');
            }
            this.addLog(`已启动持续日志：${device}`, 'info');
            await this.loadCaptureStatus(true);
        } catch (error) {
            console.error('开启持续日志失败:', error);
            alert(`开启持续日志失败：${error.message || error}`);
        }
    }

    async handleCaptureSessionAction(event) {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = button.dataset.action;
        const portId = button.dataset.portId;
        if (!portId) return;

        if (action === 'stop-log') {
            if (!confirm('确定要停止此串口的持续日志吗？')) {
                return;
            }
            try {
                const response = await fetch('/api/serial/capture/stop', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ port_id: portId }),
                });
                const result = await response.json();
                if (!result.success) {
                    throw new Error(result.error || '停止持续日志失败');
                }
                this.addLog(`已停止持续日志：${portId}`, 'info');
                await this.loadCaptureStatus(true);
            } catch (error) {
                console.error('停止持续日志失败:', error);
                alert(`停止持续日志失败：${error.message || error}`);
            }
        } else if (action === 'load-log') {
            await this.selectPort(portId, { resetHistory: true });
            this.addLog(`已加载历史日志：${portId}`, 'info');
        } else if (action === 'open-port') {
            const session = this.captureSessions.get(portId);
            if (!session) {
                alert('未找到对应的日志会话');
                return;
            }
            await this.ensureRemoteConnection(session);
        } else if (action === 'view-log') {
            await this.openCaptureLogModal(portId);
        }
    }

    async openCaptureLogModal(portId) {
        const session = this.captureSessions.get(portId);
        const titleEl = document.getElementById('captureLogViewTitle');
        const contentEl = document.getElementById('captureLogViewContent');
        const statsEl = document.getElementById('captureLogViewStats');
        const modalEl = document.getElementById('captureLogViewModal');
        if (!modalEl || !contentEl) return;

        if (titleEl) titleEl.textContent = (session?.device || portId) + ' - 持续日志记录';
        this._captureLogModalPortId = portId;

        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
        contentEl.textContent = '加载中...';
        if (statsEl) statsEl.textContent = '-- 条 · -- 字节';
        await this.refreshCaptureLogModalContent(portId);
    }

    async refreshCaptureLogModalContent(portId) {
        const contentEl = document.getElementById('captureLogViewContent');
        const statsEl = document.getElementById('captureLogViewStats');
        const refreshBtn = document.getElementById('captureLogViewRefreshBtn');
        if (!contentEl || !portId) return;

        if (refreshBtn) refreshBtn.disabled = true;
        try {
            const response = await fetch(`/api/serial/capture/log/${encodeURIComponent(portId)}?limit=2000`);
            const result = await response.json();
            if (!result.success) {
                contentEl.textContent = '加载失败：' + (result.error || '未知错误');
                if (statsEl) statsEl.textContent = '-- 条 · -- 字节';
                return;
            }
            const entries = Array.isArray(result.entries) ? result.entries : [];
            let totalBytes = 0;
            const lines = [];
            entries.forEach((entry) => {
                const ts = entry.ts || '';
                const dir = entry.dir === 'tx' ? 'TX' : 'RX';
                const text = entry.text != null ? entry.text : (entry.hex ? this.hexToDisplay(entry.hex) : '');
                const hex = entry.hex || '';
                totalBytes += hex.length / 2 || text.length;
                const dirTag = dir === 'RX' ? '[RX]' : '[TX]';
                const safe = text.replace(/[\r\n]/g, ' ').trim() || hex;
                lines.push(`${ts} ${dirTag} ${safe}`);
            });
            contentEl.textContent = lines.length ? lines.join('\n') : '暂无记录';
            contentEl.scrollTop = contentEl.scrollHeight;
            if (statsEl) statsEl.textContent = `${entries.length} 条 · ${this.formatBytes(totalBytes)}`;
        } catch (e) {
            contentEl.textContent = '加载失败：' + (e.message || String(e));
            if (statsEl) statsEl.textContent = '-- 条 · -- 字节';
        } finally {
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }

    hexToDisplay(hexStr) {
        if (!hexStr || typeof hexStr !== 'string') return '';
        const bytes = [];
        for (let i = 0; i < hexStr.length; i += 2) {
            const b = parseInt(hexStr.substr(i, 2), 16);
            bytes.push(b);
        }
        return String.fromCharCode.apply(null, bytes.map((b) => (b >= 32 && b < 127 ? b : 46)));
    }

    async ensureRemoteConnection(session) {
        const device = session.device;
        const config = session.config || {};
        if (!device) {
            alert('日志会话缺少串口设备信息');
            return;
        }
        const baudRate = parseInt(config.baudrate || config.baudRate || 9600, 10);
        const dataBits = parseInt(config.bytesize || config.dataBits || 8, 10);
        const stopBits = parseInt(config.stopbits || config.stopBits || 1, 10);
        const parityRaw = (config.parity || 'N').toString().toUpperCase();
        const parityMap = { N: 'none', E: 'even', O: 'odd' };
        const parityLabel = parityMap[parityRaw] || 'none';

        if (!this.websocket || this.websocket.disconnected) {
            await this.connectWebSocket();
        }
        const portId = this.buildRemotePortId(device, baudRate);
        // 如果已经连接则直接选中
        if (this.ports.has(portId) && this.ports.get(portId).connected) {
            await this.selectPort(portId);
            return;
        }
        this.pendingConfig = {
            baudRate,
            dataBits,
            stopBits,
            parity: parityLabel,
            flowControl: 'none',
        };
        this.websocket.emit('open_port', {
            port_id: portId,
            device,
            baudrate: baudRate,
            bytesize: dataBits,
            parity: parityRaw || 'N',
            stopbits: stopBits,
        });
    }

    async loadHistoricalLog(portId, options = {}) {
        if (!portId) return;
        const { reset = false } = options;
        if (reset) {
            this.historyMarkers.delete(portId);
            this.dataLog = this.dataLog.filter((item) => item.portId !== portId);
        }
        const params = new URLSearchParams();
        if (!reset && this.historyMarkers.has(portId)) {
            params.set('since', this.historyMarkers.get(portId));
        } else {
            params.set('limit', '500');
        }
        try {
            const response = await fetch(`/api/serial/capture/log/${encodeURIComponent(portId)}?${params.toString()}`);
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '读取日志失败');
            }
            const entries = Array.isArray(result.entries) ? result.entries : [];
            if (!entries.length) {
                return;
            }
            const portName = this.ports.get(portId)?.name || portId;
            entries.forEach((entry) => {
                const bytes = this.hexToUint8(entry.hex);
                const record = {
                    portId,
                    portName,
                    direction: entry.dir === 'tx' ? 'tx' : 'rx',
                    data: bytes,
                    timestamp: entry.ts ? new Date(entry.ts) : new Date(),
                    format: this.dataFormat,
                };
                this.dataLog.push(record);
            });
            const lastEntry = entries[entries.length - 1];
            if (lastEntry && lastEntry.ts) {
                this.historyMarkers.set(portId, lastEntry.ts);
            }
            if (this.currentPort === portId) {
                this.refreshDataDisplay();
            }
        } catch (error) {
            console.error('加载历史日志失败:', error);
            this.addLog(`加载历史日志失败：${error.message || error}`, 'error');
        }
    }
    
    // 自动保存当前会话日志到服务器
    async autoSaveLog() {
        if (this.dataLog.length === 0 || !this.currentPort) {
            return;
        }
        
        const portInfo = this.ports.get(this.currentPort);
        if (!portInfo) return;
        
        try {
            let logContent = '=== 串口调试日志 ===\n';
            logContent += `端口: ${portInfo.name}\n`;
            logContent += `生成时间: ${new Date().toLocaleString('zh-CN')}\n`;
            logContent += `总接收: ${this.rxBytes} 字节\n`;
            logContent += `总发送: ${this.txBytes} 字节\n`;
            logContent += '=' .repeat(50) + '\n\n';
            
            this.dataLog.forEach(data => {
                if (data.portId === this.currentPort) {
                    // 格式化时间戳，包含毫秒
                    const date = data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp);
                    const hours = date.getHours().toString().padStart(2, '0');
                    const minutes = date.getMinutes().toString().padStart(2, '0');
                    const seconds = date.getSeconds().toString().padStart(2, '0');
                    const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
                    const timestamp = `${hours}:${minutes}:${seconds}.${milliseconds}`;
                    const direction = data.direction === 'rx' ? 'RX' : 'TX';
                    const content = new TextDecoder().decode(data.data);
                    logContent += `[${timestamp}] ${direction}: ${content}\n`;
                }
            });
            
            const response = await fetch('/save_serial_log', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    log_content: logContent,
                    port_name: portInfo.name.replace(/[^a-zA-Z0-9]/g, '_')
                })
            });
            
            const result = await response.json();
            if (result.success) {
                console.log('日志已自动保存:', result.filename);
                this.addLog(`日志已保存: ${result.filename}`, 'info');
                return result.filename;
            }
        } catch (error) {
            console.error('自动保存日志失败:', error);
        }
    }
    
    // 绑定事件
    bindEvents() {
        // 模式切换
        document.querySelectorAll('input[name="connectionMode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.connectionMode = e.target.value;
                this.onModeChange();
            });
        });
        
        // 添加串口
        document.getElementById('addPortBtn').addEventListener('click', () => {
            this.addPort();
        });
        
        // 应用配置
        document.getElementById('applyConfigBtn').addEventListener('click', () => {
            this.applyPortConfig();
        });
        
        // 数据显示控制
        document.getElementById('clearDataBtn').addEventListener('click', () => {
            this.clearData();
        });
        
        document.getElementById('pauseBtn').addEventListener('click', () => {
            this.togglePause();
        });
        
        document.getElementById('autoScrollBtn').addEventListener('click', (e) => {
            this.toggleAutoScroll(e.target.closest('button'));
        });
        
        document.getElementById('saveLogBtn').addEventListener('click', () => {
            this.saveLog();
        });
        
        // 显示模式切换
        document.querySelectorAll('input[name="displayMode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.displayMode = e.target.value;
                this.switchDisplayMode();
            });
        });
        
        // 数据格式切换
        document.querySelectorAll('input[name="dataFormat"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.dataFormat = e.target.value;
                this.refreshDataDisplay();
            });
        });
        
        // 真实终端交互 - 实时发送字符
        this.setupInteractiveTerminal();
        
        // 终端快捷键按钮（延迟绑定，因为按钮在页面加载时存在）
        this.bindTerminalShortcuts();
        
        // 本地回显开关
        const localEchoCheckbox = document.getElementById('localEcho');
        if (localEchoCheckbox) {
            localEchoCheckbox.addEventListener('change', (e) => {
                this.localEcho = e.target.checked;
                console.log('Local echo:', this.localEcho ? 'ON' : 'OFF');
            });
        }

        const refreshCapturePortsBtn = document.getElementById('refreshCapturePortsBtn');
        if (refreshCapturePortsBtn) {
            refreshCapturePortsBtn.addEventListener('click', () => this.loadCapturePorts(true));
        }

        const refreshCaptureStatusBtn = document.getElementById('refreshCaptureStatusBtn');
        if (refreshCaptureStatusBtn) {
            refreshCaptureStatusBtn.addEventListener('click', () => this.loadCaptureStatus(true));
        }

        const startCaptureBtn = document.getElementById('startCaptureBtn');
        if (startCaptureBtn) {
            startCaptureBtn.addEventListener('click', () => this.startCaptureLogging());
        }

        const captureSessionList = document.getElementById('captureSessionList');
        if (captureSessionList) {
            captureSessionList.addEventListener('click', (event) => this.handleCaptureSessionAction(event));
        }

        const captureLogViewRefreshBtn = document.getElementById('captureLogViewRefreshBtn');
        if (captureLogViewRefreshBtn) {
            captureLogViewRefreshBtn.addEventListener('click', () => {
                if (this._captureLogModalPortId) {
                    this.refreshCaptureLogModalContent(this._captureLogModalPortId);
                }
            });
        }

        // 发送数据
        document.getElementById('sendBtn').addEventListener('click', () => {
            this.sendData();
        });
        
        document.getElementById('clearSendBtn').addEventListener('click', () => {
            document.getElementById('sendInput').value = '';
        });
        
        // 发送格式切换
        document.querySelectorAll('input[name="sendFormat"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.sendFormat = e.target.value;
            });
        });
        
        // 快捷指令
        document.getElementById('addCommandBtn').addEventListener('click', () => {
            this.showAddCommandModal();
        });
        
        document.getElementById('saveCommandBtn').addEventListener('click', () => {
            this.saveCommand();
        });
        
        // 定时发送
        document.getElementById('enableTimer').addEventListener('change', (e) => {
            if (e.target.checked) {
                this.startTimerSend();
            } else {
                this.stopTimerSend();
            }
        });
        
        // 查看历史记录按钮
        document.getElementById('viewHistoryBtn').addEventListener('click', () => {
            this.showHistoryModal();
        });
        
        // 帮助按钮
        document.getElementById('helpBtn').addEventListener('click', () => {
            const modal = new bootstrap.Modal(document.getElementById('helpModal'));
            modal.show();
        });
        
        // 快捷键
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    this.sendData();
                } else if (e.key === 'l' || e.key === 'L') {
                    e.preventDefault();
                    this.clearData();
                } else if (e.key === 's' || e.key === 'S') {
                    e.preventDefault();
                    this.saveLog();
                }
            }
        });
    }
    
    sanitizeDeviceName(device) {
        if (!device) return 'serial';
        return device.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'serial';
    }

    normalizeParityForForm(parity) {
        if (!parity) return 'none';
        const value = parity.toString().toLowerCase();
        if (value === 'n' || value === 'none') return 'none';
        if (value === 'e' || value === 'even') return 'even';
        if (value === 'o' || value === 'odd') return 'odd';
        return value;
    }

    buildRemotePortId(device, baudRate) {
        const base = this.sanitizeDeviceName(device);
        return `remote_${base}_${baudRate || 9600}`;
    }

    hexToUint8(hexString) {
        if (!hexString) {
            return new Uint8Array();
        }
        const clean = hexString.replace(/[^0-9A-Fa-f]/g, '');
        if (clean.length % 2 !== 0) {
            // 如果长度为奇数，忽略最后一个字符
            console.warn('HEX 长度为奇数，已忽略最后一个字符');
        }
        const length = Math.floor(clean.length / 2);
        const bytes = new Uint8Array(length);
        for (let i = 0; i < length; i += 1) {
            const byte = clean.substr(i * 2, 2);
            bytes[i] = parseInt(byte, 16);
        }
        return bytes;
    }

    // 初始化模态框
    initModals() {
        // 这里可以添加模态框的初始化逻辑
    }
    
    // 模式切换
    onModeChange() {
        const hint = document.getElementById('modeHint');
        if (this.connectionMode === 'local') {
            hint.textContent = '连接本地计算机的串口设备';
        } else {
            hint.textContent = '连接到服务器，监控远程串口';
            this.loadCapturePorts(true);
            this.loadCaptureStatus(true);
        }
        console.log(`切换到${this.connectionMode === 'local' ? '本地' : '远程'}模式`);
    }
    
    // 添加串口
    async addPort() {
        if (this.connectionMode === 'local') {
            await this.addLocalPort();
        } else {
            await this.addRemotePort();
        }
    }
    
    // 添加本地串口
    async addLocalPort() {
        if (!('serial' in navigator)) {
            alert('您的浏览器不支持 Web Serial API\n\n请使用以下浏览器：\n• Chrome 89+\n• Edge 89+\n• Opera 76+\n\n当前浏览器：' + this.getBrowserName());
            return;
        }
        
        // 先显示配置对话框
        const config = await this.showPortConfigDialog();
        if (!config) {
            return; // 用户取消
        }
        
        try {
            console.log('正在请求串口访问权限...');
            
            // 请求串口权限
            const port = await navigator.serial.requestPort();
            
            // 获取串口信息
            const info = port.getInfo();
            const portId = `port_${Date.now()}`;
            const portName = `COM${info.usbProductId || '?'}`;
            
            // 使用用户配置的参数打开串口
            await port.open({
                baudRate: config.baudRate,
                dataBits: config.dataBits,
                stopBits: config.stopBits,
                parity: config.parity,
                flowControl: config.flowControl
            });
            
            // 保存串口信息（不保存 writer，每次使用时临时获取）
            const portInfo = {
                id: portId,
                name: portName,
                type: 'local',  // 本地串口标识
                port: port,
                config: config,
                reader: null,
                connected: true
            };
            
            this.ports.set(portId, portInfo);
            
            // 开始读取数据
            this.startReading(portId);
            
            // 渲染串口列表
            this.renderPortList();
            
            // 选中新添加的串口
            this.selectPort(portId);
            
            // 启动运行时间计时器
            if (!this.startTime) {
                this.startTime = Date.now();
                this.startUptimeTimer();
            }
            
            console.log(`成功连接串口: ${portName}`);
            this.addLog(`已连接串口: ${portName}`, 'info');
            
        } catch (error) {
            console.error('连接串口失败:', error);
            alert(`连接串口失败: ${error.message}`);
        }
    }
    
    // 显示串口配置对话框
    showPortConfigDialog() {
        return new Promise((resolve) => {
            const modalHtml = `
                <div class="modal fade" id="portConfigModal" tabindex="-1">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">串口配置</h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <div class="mb-3">
                                    <label class="form-label">波特率</label>
                                    <select class="form-select" id="modalBaudRate">
                                        <option value="300">300</option>
                                        <option value="1200">1200</option>
                                        <option value="2400">2400</option>
                                        <option value="4800">4800</option>
                                        <option value="9600" selected>9600</option>
                                        <option value="14400">14400</option>
                                        <option value="19200">19200</option>
                                        <option value="38400">38400</option>
                                        <option value="57600">57600</option>
                                        <option value="115200">115200</option>
                                        <option value="230400">230400</option>
                                        <option value="460800">460800</option>
                                        <option value="921600">921600</option>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">数据位</label>
                                    <select class="form-select" id="modalDataBits">
                                        <option value="7">7</option>
                                        <option value="8" selected>8</option>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">停止位</label>
                                    <select class="form-select" id="modalStopBits">
                                        <option value="1" selected>1</option>
                                        <option value="2">2</option>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">校验位</label>
                                    <select class="form-select" id="modalParity">
                                        <option value="none" selected>无</option>
                                        <option value="even">偶校验</option>
                                        <option value="odd">奇校验</option>
                                    </select>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label">流控制</label>
                                    <select class="form-select" id="modalFlowControl">
                                        <option value="none" selected>无</option>
                                        <option value="hardware">硬件流控</option>
                                    </select>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal" id="cancelConfigBtn">取消</button>
                                <button type="button" class="btn btn-primary" id="confirmConfigBtn">确定并连接</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // 移除旧的模态框
            const oldModal = document.getElementById('portConfigModal');
            if (oldModal) oldModal.remove();
            
            // 添加新模态框
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            const modal = new bootstrap.Modal(document.getElementById('portConfigModal'));
            modal.show();
            
            // 确认按钮
            document.getElementById('confirmConfigBtn').onclick = () => {
                const config = {
                    baudRate: parseInt(document.getElementById('modalBaudRate').value),
                    dataBits: parseInt(document.getElementById('modalDataBits').value),
                    stopBits: parseInt(document.getElementById('modalStopBits').value),
                    parity: document.getElementById('modalParity').value,
                    flowControl: document.getElementById('modalFlowControl').value
                };
                modal.hide();
                resolve(config);
            };
            
            // 取消按钮
            document.getElementById('cancelConfigBtn').onclick = () => {
                modal.hide();
                resolve(null);
            };
            
            // 关闭模态框时
            document.getElementById('portConfigModal').addEventListener('hidden.bs.modal', () => {
                document.getElementById('portConfigModal').remove();
            });
        });
    }
    
    // 添加远程串口
    async addRemotePort() {
        // 先显示配置对话框
        const config = await this.showPortConfigDialog();
        if (!config) {
            return; // 用户取消
        }
        
        // 检查 WebSocket 连接
        if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
            // 连接 WebSocket
            await this.connectWebSocket();
        }
        
        // 保存配置，传递给远程串口选择
        this.pendingConfig = config;
        
        // 请求服务器列出可用串口
        this.websocket.emit('list_ports');
    }

    loadExternalScript(src) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                if (existing.dataset.loaded === 'true') {
                    resolve();
                    return;
                }
                existing.addEventListener('load', () => resolve(), { once: true });
                existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.addEventListener('load', () => {
                script.dataset.loaded = 'true';
                resolve();
            }, { once: true });
            script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
            document.head.appendChild(script);
        });
    }

    async ensureSocketIoLoaded() {
        if (typeof io !== 'undefined') {
            return;
        }

        if (!this._socketIoLoadPromise) {
            const sources = [
                '/static/js/socket.io.min.js',
                'https://cdn.socket.io/4.5.4/socket.io.min.js'
            ];

            this._socketIoLoadPromise = (async () => {
                let lastError = null;
                for (const src of sources) {
                    try {
                        await this.loadExternalScript(src);
                        if (typeof io !== 'undefined') {
                            return;
                        }
                    } catch (error) {
                        lastError = error;
                    }
                }
                throw lastError || new Error('Socket.IO client failed to load');
            })();
        }

        try {
            await this._socketIoLoadPromise;
        } finally {
            if (typeof io === 'undefined') {
                this._socketIoLoadPromise = null;
            }
        }
    }
    
    // 连接 WebSocket
    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            try {
                if (this.websocket && this.websocket.connected) {
                    resolve();
                    return;
                }
                this.ensureSocketIoLoaded().then(() => {
                    if (typeof io === 'undefined') {
                        throw new Error('Socket.IO not loaded');
                    }

                    // 连接到服务器
                    const socket = io('/serial', {
                        transports: ['websocket', 'polling']
                    });

                    this.websocket = socket;

                    // 连接成功
                    socket.on('connected', (data) => {
                        console.log('WebSocket 已连接:', data.client_id);
                        this.addLog('已连接到服务器', 'info');
                        resolve();
                    });

                    // 连接错误
                    socket.on('connect_error', (error) => {
                        console.error('WebSocket 连接失败:', error);
                        this.addLog(`连接服务器失败: ${error}`, 'error');
                        reject(error);
                    });

                    // 断开连接
                    socket.on('disconnect', () => {
                        console.log('WebSocket 已断开');
                        this.addLog('与服务器断开连接', 'info');
                    });

                    // 接收串口列表
                    socket.on('ports_list', (data) => {
                        this.handleRemotePortsList(data);
                    });

                    // 接收串口打开结果
                    socket.on('port_opened', (data) => {
                        this.handleRemotePortOpened(data);
                    });

                    // 接收串口关闭结果
                    socket.on('port_closed', (data) => {
                        this.handleRemotePortClosed(data);
                    });

                    // 接收串口数据
                    socket.on('serial_data', (data) => {
                        this.handleRemoteSerialData(data);
                    });

                    // 接收数据写入结果
                    socket.on('data_written', (data) => {
                        this.handleRemoteDataWritten(data);
                    });
                }).catch((error) => {
                    alert('Socket.IO 客户端未加载\n请刷新页面重试');
                    reject(error);
                });
                
            } catch (error) {
                console.error('创建 WebSocket 失败:', error);
                reject(error);
            }
        });
    }
    
    // 处理远程串口列表
    handleRemotePortsList(data) {
        if (data.success) {
            const ports = data.ports;
            console.log('可用串口:', ports);
            
            if (ports.length === 0) {
                alert('服务器上没有可用的串口设备');
                return;
            }
            
            // 显示串口选择对话框
            this.showRemotePortSelector(ports);
        } else {
            alert(`获取串口列表失败: ${data.error}`);
        }
    }
    
    // 显示远程串口选择对话框
    showRemotePortSelector(ports) {
        // 创建选择HTML
        let options = ports.map((port, index) => {
            return `<option value="${index}">${port.device} - ${port.name}</option>`;
        }).join('');
        
        // 使用 Bootstrap Modal 显示
        const modalHtml = `
            <div class="modal fade" id="remotePortModal" tabindex="-1">
                <div class="modal-dialog">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">选择服务器串口</h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                        </div>
                        <div class="modal-body">
                            <div class="mb-3">
                                <label class="form-label">可用串口：</label>
                                <select class="form-select" id="remotePortSelect">
                                    ${options}
                                </select>
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">取消</button>
                            <button type="button" class="btn btn-primary" id="confirmRemotePort">连接</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        // 移除旧的模态框
        const oldModal = document.getElementById('remotePortModal');
        if (oldModal) oldModal.remove();
        
        // 添加新模态框
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        
        const modal = new bootstrap.Modal(document.getElementById('remotePortModal'));
        modal.show();
        
        // 确认按钮事件
        document.getElementById('confirmRemotePort').onclick = () => {
            const selectIndex = document.getElementById('remotePortSelect').value;
            const selectedPort = ports[selectIndex];
            
            // 打开远程串口（使用之前配置的参数）
            this.openRemotePort(selectedPort);
            modal.hide();
        };
    }
    
    // 打开远程串口
    openRemotePort(portInfo) {
        const portId = this.buildRemotePortId(portInfo.device, (this.pendingConfig && this.pendingConfig.baudRate) || 9600);
        const config = this.pendingConfig || {
            baudRate: 9600,
            dataBits: 8,
            stopBits: 1,
            parity: 'none',
            flowControl: 'none'
        };
        
        // 转换 parity 格式
        const parityMap = {
            'none': 'N',
            'even': 'E',
            'odd': 'O'
        };
        
        this.websocket.emit('open_port', {
            port_id: portId,
            device: portInfo.device,
            baudrate: config.baudRate,
            bytesize: config.dataBits,
            parity: parityMap[config.parity] || 'N',
            stopbits: config.stopBits
        });
        
        console.log('正在打开远程串口:', portInfo.device, '配置:', config);
        this.pendingConfig = null;
    }
    
    // 处理远程串口打开结果
    handleRemotePortOpened(data) {
        if (data.success) {
            const portId = data.port_id;
            const portInfo = data.port_info;
            
            const existing = this.ports.get(portId) || {};
            const remotePortInfo = Object.assign({}, existing, {
                id: portId,
                name: portInfo.device,
                type: 'remote',
                config: {
                    baudRate: portInfo.baudrate,
                    dataBits: portInfo.bytesize,
                    stopBits: portInfo.stopbits,
                    parity: portInfo.parity,
                },
                connected: true,
                captureActive: this.captureSessions.has(portId),
            });
            
            this.ports.set(portId, remotePortInfo);
            
            // 渲染串口列表
            this.renderPortList();
            
            // 选中新添加的串口
            this.selectPort(portId);
            
            // 启动运行时间计时器
            if (!this.startTime) {
                this.startTime = Date.now();
                this.startUptimeTimer();
            }
            
            console.log(`成功连接远程串口: ${portInfo.device}`);
            this.addLog(`已连接远程串口: ${portInfo.device}`, 'info');
        } else {
            alert(`打开远程串口失败: ${data.error}`);
        }
    }
    
    // 处理远程串口关闭
    handleRemotePortClosed(data) {
        if (data.success) {
            console.log(`远程串口已关闭: ${data.port_id}`);
            const info = this.ports.get(data.port_id);
            if (info) {
                info.connected = false;
            }
            this.renderPortList();
        }
    }
    
    // 处理远程串口数据
    handleRemoteSerialData(data) {
        const portId = data.port_id;
        const dataBytes = new Uint8Array(data.data);
        
        // 使用服务器发送的时间戳（ISO格式，包含毫秒）
        const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
        
        // 更新接收字节数
        this.rxBytes += dataBytes.length;
        this.updateStats();
        
        // 如果暂停，只记录不显示
        if (this.isPaused) {
            this.dataLog.push({
                portId: portId,
                portName: this.ports.get(portId)?.name || portId,
                direction: 'rx',
                data: dataBytes,
                timestamp: timestamp,
                format: this.dataFormat
            });
            this.historyMarkers.set(portId, new Date(Date.now() - 500).toISOString());
            return;
        }
        
        // 合并数据到缓冲区（与本地串口相同的逻辑）
        if (!this.dataBuffer.rx) {
            this.dataBuffer.rx = {
                portId: portId,
                portName: this.ports.get(portId)?.name || portId,
                direction: 'rx',
                data: dataBytes,
                timestamp: timestamp,
                format: this.dataFormat
            };
        } else {
            const combined = new Uint8Array(this.dataBuffer.rx.data.length + dataBytes.length);
            combined.set(this.dataBuffer.rx.data);
            combined.set(dataBytes, this.dataBuffer.rx.data.length);
            this.dataBuffer.rx.data = combined;
        }
        
        // 清除之前的超时
        if (this.bufferTimeout) {
            clearTimeout(this.bufferTimeout);
        }
        
        // 设置新的超时，100ms 内没有新数据则显示
        this.bufferTimeout = setTimeout(() => {
            if (this.dataBuffer.rx && portId === this.currentPort) {
                this.dataLog.push(this.dataBuffer.rx);
                this.displayData(this.dataBuffer.rx);
                this.dataBuffer.rx = null;
            }
            this.historyMarkers.set(portId, new Date(Date.now() - 500).toISOString());
        }, 100);
    }
    
    // 处理远程数据写入结果
    handleRemoteDataWritten(data) {
        if (data.success) {
            console.log(`数据已发送: ${data.bytes_written} 字节`);
        } else {
            alert(`发送数据失败: ${data.error}`);
        }
    }
    
    // 开始读取数据
    async startReading(portId) {
        const portInfo = this.ports.get(portId);
        if (!portInfo || !portInfo.port) return;
        
        try {
            const reader = portInfo.port.readable.getReader();
            portInfo.reader = reader;
            
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    console.log('串口读取结束');
                    break;
                }
                
                // 处理接收到的数据
                this.handleReceivedData(portId, value);
            }
        } catch (error) {
            console.error('读取数据失败:', error);
            this.addLog(`读取数据失败: ${error.message}`, 'error');
        } finally {
            if (portInfo.reader) {
                portInfo.reader.releaseLock();
                portInfo.reader = null;
            }
        }
    }
    
    // 处理接收到的数据
    handleReceivedData(portId, value) {
        const portInfo = this.ports.get(portId);
        if (!portInfo) return;
        
        // 更新接收字节数
        this.rxBytes += value.length;
        this.updateStats();
        
        // 如果暂停，只记录不显示
        if (this.isPaused) {
            this.dataLog.push({
                portId: portId,
                portName: portInfo.name,
                direction: 'rx',
                data: value,
                timestamp: new Date(),
                format: this.dataFormat
            });
            return;
        }
        
        // 合并数据到缓冲区
        if (!this.dataBuffer.rx) {
            // 创建新的接收数据缓冲
            this.dataBuffer.rx = {
                portId: portId,
                portName: portInfo.name,
                direction: 'rx',
                data: value,
                timestamp: new Date(),
                format: this.dataFormat
            };
        } else {
            // 合并到现有缓冲
            const combined = new Uint8Array(this.dataBuffer.rx.data.length + value.length);
            combined.set(this.dataBuffer.rx.data);
            combined.set(value, this.dataBuffer.rx.data.length);
            this.dataBuffer.rx.data = combined;
        }
        
        // 清除之前的超时
        if (this.bufferTimeout) {
            clearTimeout(this.bufferTimeout);
        }
        
        // 设置新的超时，100ms 内没有新数据则显示
        this.bufferTimeout = setTimeout(() => {
            if (this.dataBuffer.rx && portId === this.currentPort) {
                this.dataLog.push(this.dataBuffer.rx);
                this.displayData(this.dataBuffer.rx);
                this.dataBuffer.rx = null;
            }
        }, 100);
    }
    
    // 切换显示模式
    switchDisplayMode() {
        const bubbleDisplay = document.getElementById('dataDisplay');
        const terminalContainer = document.getElementById('terminalContainer');
        
        if (this.displayMode === 'terminal') {
            // 切换到终端模式
            bubbleDisplay.style.display = 'none';
            terminalContainer.style.display = 'flex';
            
            // 刷新终端显示
            this.refreshTerminalDisplay();
            
            // 聚焦到终端输入框
            setTimeout(() => {
                const input = document.getElementById('terminalInput');
                if (input) input.focus();
            }, 100);
        } else {
            // 切换到气泡模式
            bubbleDisplay.style.display = 'block';
            terminalContainer.style.display = 'none';
            
            // 刷新气泡显示
            this.refreshDataDisplay();
        }
    }
    
    // 刷新终端显示
    refreshTerminalDisplay() {
        const display = document.getElementById('terminalDisplay');
        if (!display) return;
        
        display.innerHTML = '';
        
        // 重新显示所有历史数据
        this.dataLog.forEach(data => {
            if (data.portId === this.currentPort) {
                let content = '';
                switch (this.dataFormat) {
                    case 'text':
                        content = new TextDecoder().decode(data.data);
                        break;
                    case 'hex':
                        content = Array.from(data.data)
                            .map(b => b.toString(16).padStart(2, '0').toUpperCase())
                            .join(' ') + ' ';
                        break;
                    case 'dec':
                        content = Array.from(data.data).join(' ') + ' ';
                        break;
                    case 'bin':
                        content = Array.from(data.data)
                            .map(b => b.toString(2).padStart(8, '0'))
                            .join(' ') + ' ';
                        break;
                }
                
                this.appendToTerminalDisplay(content);
            }
        });
        
        // 添加初始光标
        const cursor = document.createElement('span');
        cursor.className = 'terminal-cursor';
        cursor.textContent = '\u00A0';
        display.appendChild(cursor);
        
        // 聚焦到输入框
        const input = document.getElementById('terminalInput');
        if (input) input.focus();
    }
    
    // 在终端模式显示数据
    displayTerminalData(data) {
        // 只显示接收的数据（发送的已经在界面上显示了）
        if (data.direction !== 'rx') {
            return;
        }
        
        let content = '';
        switch (this.dataFormat) {
            case 'text':
                content = new TextDecoder().decode(data.data);
                break;
            case 'hex':
                content = Array.from(data.data)
                    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
                    .join(' ') + ' ';
                break;
            case 'dec':
                content = Array.from(data.data).join(' ') + ' ';
                break;
            case 'bin':
                content = Array.from(data.data)
                    .map(b => b.toString(2).padStart(8, '0'))
                    .join(' ') + ' ';
                break;
        }
        
        // 直接追加到终端显示区域
        this.appendToTerminalDisplay(content);
    }
    
    // 绑定终端快捷键按钮
    bindTerminalShortcuts() {
        const buttons = {
            'termCtrlC': 0x03,
            'termCtrlD': 0x04,
            'termCtrlZ': 0x1A,
            'termTab': 0x09,
            'termEsc': 0x1B
        };
        
        for (const [id, charCode] of Object.entries(buttons)) {
            const btn = document.getElementById(id);
            if (btn) {
                console.log(`Binding button: ${id}`);
                btn.addEventListener('click', async () => {
                    console.log(`Button clicked: ${id}, sending char: 0x${charCode.toString(16)}`);
                    await this.sendControlChar(charCode);
                });
            } else {
                console.warn(`Button not found: ${id}`);
            }
        }
        
        const clearBtn = document.getElementById('termClearScreen');
        if (clearBtn) {
            console.log('Binding clear screen button');
            clearBtn.addEventListener('click', () => {
                console.log('Clear screen clicked');
                this.clearTerminalScreen();
            });
        } else {
            console.warn('Clear screen button not found');
        }
    }
    
    // 设置交互式终端（使用隐藏 input 方案）
    setupInteractiveTerminal() {
        const input = document.getElementById('terminalInput');
        const display = document.getElementById('terminalDisplay');
        
        if (!input || !display) {
            console.warn('Terminal input or display not found');
            return;
        }
        
        // 防止多次绑定
        if (input._terminalSetup) return;
        input._terminalSetup = true;
        
        console.log('Setting up interactive terminal with hidden input');
        
        // 键盘事件处理 - 同步函数，立即阻止
        input.addEventListener('keydown', (e) => {
            // 只在终端模式时处理
            if (this.displayMode !== 'terminal') {
                return;
            }
            
            console.log('Terminal input keydown:', e.key, 'input.value before:', JSON.stringify(input.value));
            
            const needsPort = this.currentPort !== null;
            let handled = false;
            
            // 处理特殊键（同步处理，立即阻止）
            if (e.ctrlKey && !e.altKey && !e.shiftKey) {
                if (e.key === 'c') {
                    e.preventDefault();
                    if (this.localEcho) this.appendToTerminalDisplay('^C\n');
                    if (needsPort) this.sendRawBytes([0x03]);
                    input.value = '';
                    handled = true;
                } else if (e.key === 'd') {
                    e.preventDefault();
                    if (this.localEcho) this.appendToTerminalDisplay('^D\n');
                    if (needsPort) this.sendRawBytes([0x04]);
                    input.value = '';
                    handled = true;
                } else if (e.key === 'z') {
                    e.preventDefault();
                    if (this.localEcho) this.appendToTerminalDisplay('^Z\n');
                    if (needsPort) this.sendRawBytes([0x1A]);
                    input.value = '';
                    handled = true;
                } else if (e.key === 'l') {
                    e.preventDefault();
                    this.clearTerminalScreen();
                    input.value = '';
                    handled = true;
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                console.log('Enter blocked, appending newline, needsPort:', needsPort, 'localEcho:', this.localEcho);
                if (this.localEcho) {
                    this.appendToTerminalDisplay('\n');
                }
                if (needsPort) {
                    console.log('Calling sendRawBytes with CR+LF');
                    this.sendRawBytes([0x0D, 0x0A]);
                }
                input.value = ''; // 清空 input
                handled = true;
            } else if (e.key === 'Backspace') {
                e.preventDefault();
                console.log('Backspace pressed, localEcho:', this.localEcho);
                if (needsPort) {
                    console.log('Sending BS to serial port');
                    this.sendRawBytes([0x08]);
                }
                if (this.localEcho) {
                    this.handleBackspaceInTerminal();
                }
                input.value = ''; // 清空 input 防止触发 input 事件
                handled = true;
            } else if (e.key === 'Tab') {
                e.preventDefault();
                if (this.localEcho) {
                    this.appendToTerminalDisplay('\t'); // Tab 字符
                }
                if (needsPort) this.sendRawBytes([0x09]);
                input.value = '';
                handled = true;
            } else if (e.key === 'Escape') {
                e.preventDefault();
                if (needsPort) this.sendRawBytes([0x1B]);
                input.value = '';
                handled = true;
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                if (needsPort) this.sendRawBytes([0x1B, 0x5B, 0x41]);
                input.value = '';
                // 强制重置光标位置
                setTimeout(() => {
                    input.setSelectionRange(0, 0);
                    input.focus();
                }, 0);
                handled = true;
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                if (needsPort) this.sendRawBytes([0x1B, 0x5B, 0x42]);
                input.value = '';
                setTimeout(() => {
                    input.setSelectionRange(0, 0);
                    input.focus();
                }, 0);
                handled = true;
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                if (needsPort) this.sendRawBytes([0x1B, 0x5B, 0x43]);
                input.value = '';
                setTimeout(() => {
                    input.setSelectionRange(0, 0);
                    input.focus();
                }, 0);
                handled = true;
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault();
                e.stopPropagation();
                if (needsPort) this.sendRawBytes([0x1B, 0x5B, 0x44]);
                input.value = '';
                setTimeout(() => {
                    input.setSelectionRange(0, 0);
                    input.focus();
                }, 0);
                handled = true;
            }
            
            return !handled;
        });
        
        // input 事件 - 捕获普通字符输入
        let lastProcessedValue = '';
        let processingInput = false;
        
        input.addEventListener('input', (e) => {
            // 防止重复处理
            if (processingInput) {
                console.log('Already processing input, skipping');
                return;
            }
            
            processingInput = true;
            
            // 立即保存并清空值
            const value = input.value;
            input.value = '';
            
            console.log('input event triggered, displayMode:', this.displayMode, 'value:', JSON.stringify(value), 'length:', value.length);
            
            if (this.displayMode !== 'terminal') {
                console.log('Not in terminal mode, ignoring input');
                processingInput = false;
                return;
            }
            
            // 过滤空值或重复值
            if (!value || value === lastProcessedValue) {
                console.log('Empty or duplicate value, skipping');
                processingInput = false;
                return;
            }
            
            lastProcessedValue = value;
            
            console.log('Input value chars:', value.split('').map(c => c.charCodeAt(0)), 'localEcho:', this.localEcho);
            
            // 只在本地回显开启时显示用户输入
            if (this.localEcho) {
                this.appendToTerminalDisplay(value);
            }
            
            if (this.currentPort) {
                console.log('Sending input to serial port');
                const bytes = new TextEncoder().encode(value);
                console.log('Encoded bytes:', Array.from(bytes));
                this.sendRawBytes(Array.from(bytes));
            } else {
                console.warn('No current port, not sending');
            }
            
            // 重置标志和光标位置
            setTimeout(() => {
                processingInput = false;
                lastProcessedValue = '';
                // 确保光标位置在开头
                if (input === document.activeElement) {
                    input.setSelectionRange(0, 0);
                }
            }, 50);
        });
        
        // 点击显示区域时聚焦到 input
        display.addEventListener('click', () => {
            input.focus();
            // 确保光标位置在开头
            setTimeout(() => {
                input.setSelectionRange(0, 0);
            }, 0);
        });
        
        // 当 input 获得焦点时，确保光标位置在开头
        input.addEventListener('focus', () => {
            setTimeout(() => {
                input.setSelectionRange(0, 0);
            }, 0);
        });
        
        // 监听 selectionchange 事件，防止光标被移动
        document.addEventListener('selectionchange', () => {
            if (this.displayMode === 'terminal' && document.activeElement === input) {
                // 如果光标位置不在开头，强制重置
                if (input.selectionStart !== 0 || input.selectionEnd !== 0) {
                    input.setSelectionRange(0, 0);
                }
            }
        });
        
        // 粘贴支持
        input.addEventListener('paste', (e) => {
            if (this.displayMode !== 'terminal') return;
            
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            if (text) {
                this.appendToTerminalDisplay(text);
                if (this.currentPort) {
                    const bytes = new TextEncoder().encode(text);
                    this.sendRawBytes(Array.from(bytes));
                }
            }
        });
    }
    
    // 追加文本到终端显示区域
    appendToTerminalDisplay(text) {
        const display = document.getElementById('terminalDisplay');
        if (!display) return;
        
        console.log('appendToTerminalDisplay called with:', JSON.stringify(text), 'length:', text.length);
        
        // 移除所有旧光标（可能有多个）
        const oldCursors = display.querySelectorAll('.terminal-cursor');
        oldCursors.forEach(cursor => cursor.remove());
        
        const textNode = document.createTextNode(text);
        display.appendChild(textNode);
        
        // 添加新光标（只添加一个）
        const cursor = document.createElement('span');
        cursor.className = 'terminal-cursor';
        cursor.textContent = '\u00A0'; // 不间断空格
        display.appendChild(cursor);
        
        // 自动滚动
        if (this.autoScroll) {
            display.scrollTop = display.scrollHeight;
        }
    }
    
    // 处理终端中的退格
    handleBackspaceInTerminal() {
        const display = document.getElementById('terminalDisplay');
        if (!display) return;
        
        // 移除所有光标
        const oldCursors = display.querySelectorAll('.terminal-cursor');
        oldCursors.forEach(cursor => cursor.remove());
        
        // 删除最后一个文本节点
        const lastChild = display.lastChild;
        if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
            const text = lastChild.textContent;
            if (text.length > 0) {
                lastChild.textContent = text.slice(0, -1);
            } else {
                lastChild.remove();
            }
        } else if (lastChild && lastChild.nodeType === Node.ELEMENT_NODE) {
            // 如果最后一个是元素（光标），删除它前面的文本节点
            const prevSibling = lastChild.previousSibling;
            if (prevSibling && prevSibling.nodeType === Node.TEXT_NODE) {
                const text = prevSibling.textContent;
                if (text.length > 0) {
                    prevSibling.textContent = text.slice(0, -1);
                } else {
                    prevSibling.remove();
                }
            }
        }
        
        // 重新添加光标
        const cursor = document.createElement('span');
        cursor.className = 'terminal-cursor';
        cursor.textContent = '\u00A0';
        display.appendChild(cursor);
    }
    
    // 发送原始字节
    async sendRawBytes(bytes) {
        console.log('sendRawBytes called with:', bytes, 'currentPort:', this.currentPort);
        
        if (!this.currentPort) {
            console.warn('No current port');
            return;
        }
        
        const portInfo = this.ports.get(this.currentPort);
        console.log('Port info:', portInfo);
        console.log('Port info details - type:', portInfo?.type, 'writer:', portInfo?.writer, 'connected:', portInfo?.connected);
        
        if (!portInfo) {
            console.warn('Port info not found for:', this.currentPort);
            return;
        }
        
        try {
            const data = new Uint8Array(bytes);
            console.log('Sending bytes:', Array.from(data), 'to port type:', portInfo.type);
            
            if (portInfo.type === 'local') {
                // 每次使用时临时获取 writer，使用后立即释放
                const writer = portInfo.port.writable.getWriter();
                try {
                    await writer.write(data);
                    console.log('Data written to local port successfully');
                } finally {
                    writer.releaseLock();
                }
            } else if (portInfo.type === 'remote') {
                if (this.websocket && this.websocket.connected) {
                    this.websocket.emit('write_data', {
                        port_id: this.currentPort,
                        data: Array.from(data)
                    });
                    console.log('Data sent to remote port via WebSocket');
                }
            }
            
            this.txBytes += data.length;
            this.updateStats();
            console.log('TX bytes updated:', this.txBytes);
            
        } catch (error) {
            console.error('发送数据失败:', error);
        }
    }
    
    // 发送原始文本
    async sendRawText(text) {
        const bytes = new TextEncoder().encode(text);
        await this.sendRawBytes(Array.from(bytes));
    }
    
    
    // 发送控制字符（工具栏按钮用）
    async sendControlChar(charCode) {
        if (!this.currentPort) {
            alert('请先连接串口');
            return;
        }
        
        // 使用统一的 sendRawBytes 方法
        await this.sendRawBytes([charCode]);
        
        // 在终端显示控制字符标记
        const charName = this.getControlCharName(charCode);
        
        if (this.displayMode === 'terminal' && this.localEcho) {
            // 终端模式且本地回显开启时才显示
            if (charCode === 0x03) {
                this.appendToTerminalDisplay('^C\n');
            } else if (charCode === 0x04) {
                this.appendToTerminalDisplay('^D\n');
            } else if (charCode === 0x1A) {
                this.appendToTerminalDisplay('^Z\n');
            } else if (charCode === 0x09) {
                this.appendToTerminalDisplay('\t'); // Tab 字符
            }
        }
        
        console.log('Control char sent:', charName);
    }
    
    // 获取控制字符名称
    getControlCharName(charCode) {
        const names = {
            0x03: '^C (Ctrl+C)',
            0x04: '^D (Ctrl+D)',
            0x09: '\\t (Tab)',
            0x1A: '^Z (Ctrl+Z)',
            0x1B: 'ESC'
        };
        return names[charCode] || `0x${charCode.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    
    // 清空终端屏幕
    clearTerminalScreen() {
        const display = document.getElementById('terminalDisplay');
        if (display) {
            display.innerHTML = '';
            // 添加初始光标
            const cursor = document.createElement('span');
            cursor.className = 'terminal-cursor';
            cursor.textContent = '\u00A0';
            display.appendChild(cursor);
        }
        const input = document.getElementById('terminalInput');
        if (input) {
            input.focus();
        }
    }
    
    // 显示数据（聊天气泡样式）
    displayData(data) {
        // 根据显示模式选择不同的显示方法
        if (this.displayMode === 'terminal') {
            this.displayTerminalData(data);
            return;
        }
        
        const display = document.getElementById('dataDisplay');
        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${data.direction}`;
        
        // 格式化时间戳，包含毫秒
        const date = data.timestamp instanceof Date ? data.timestamp : new Date(data.timestamp);
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
        const timestamp = `${hours}:${minutes}:${seconds}.${milliseconds}`;
        
        const badge = data.direction === 'rx' ? 'RX' : 'TX';
        
        let content = '';
        let isHex = false;
        
        switch (this.dataFormat) {
            case 'text':
                content = new TextDecoder().decode(data.data);
                break;
            case 'hex':
                content = Array.from(data.data)
                    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
                    .join(' ');
                isHex = true;
                break;
            case 'dec':
                content = Array.from(data.data).join(' ');
                break;
            case 'bin':
                content = Array.from(data.data)
                    .map(b => b.toString(2).padStart(8, '0'))
                    .join(' ');
                break;
        }
        
        const bubble = document.createElement('div');
        bubble.className = `message-bubble${isHex ? ' hex' : ''}`;
        bubble.innerHTML = `
            <div class="message-badge">${badge}</div>
            <div class="message-content">${this.escapeHtml(content)}</div>
            <div class="message-time">${timestamp}</div>
        `;
        
        wrapper.appendChild(bubble);
        display.appendChild(wrapper);
        
        // 强制自动滚动到底部
        if (this.autoScroll) {
            // 使用 requestAnimationFrame 确保 DOM 更新后再滚动
            requestAnimationFrame(() => {
                display.scrollTop = display.scrollHeight;
            });
        }
    }
    
    // 刷新数据显示
    refreshDataDisplay() {
        const display = document.getElementById('dataDisplay');
        display.innerHTML = '';
        
        this.dataLog.forEach(data => {
            if (data.portId === this.currentPort) {
                this.displayData(data);
            }
        });
    }
    
    // 发送数据
    async sendData() {
        if (!this.currentPort) {
            alert('请先选择一个串口');
            return;
        }
        
        const portInfo = this.ports.get(this.currentPort);
        if (!portInfo || !portInfo.connected) {
            alert('串口未连接');
            return;
        }
        
        const input = document.getElementById('sendInput').value;
        if (!input) {
            alert('请输入要发送的数据');
            return;
        }
        
        try {
            let dataToSend;
            
            if (this.sendFormat === 'hex') {
                // HEX 格式
                const hexStr = input.replace(/\s+/g, '');
                if (!/^[0-9A-Fa-f]*$/.test(hexStr)) {
                    alert('HEX 格式错误，请输入有效的十六进制字符');
                    return;
                }
                const bytes = [];
                for (let i = 0; i < hexStr.length; i += 2) {
                    bytes.push(parseInt(hexStr.substr(i, 2), 16));
                }
                dataToSend = new Uint8Array(bytes);
            } else {
                // 文本格式
                let text = input;
                if (document.getElementById('appendCRLF').checked) {
                    text += '\r\n';
                }
                dataToSend = new TextEncoder().encode(text);
            }
            
            // 判断是本地串口还是远程串口
            if (portInfo.type === 'remote') {
                // 远程串口：通过 WebSocket 发送
                this.websocket.emit('write_data', {
                    port_id: this.currentPort,
                    data: Array.from(dataToSend)
                });
            } else {
                // 本地串口：直接写入
                const writer = portInfo.port.writable.getWriter();
                await writer.write(dataToSend);
                writer.releaseLock();
            }
            
            // 更新发送字节数
            this.txBytes += dataToSend.length;
            this.updateStats();
            
            // 立即显示发送的数据（不缓冲）
            const data = {
                portId: this.currentPort,
                portName: portInfo.name,
                direction: 'tx',
                data: dataToSend,
                timestamp: new Date(),
                format: this.dataFormat
            };
            
            this.dataLog.push(data);
            
            // 如果有接收数据缓冲，先显示它
            if (this.dataBuffer.rx) {
                this.dataLog.push(this.dataBuffer.rx);
                this.displayData(this.dataBuffer.rx);
                this.dataBuffer.rx = null;
            }
            
            // 显示发送的数据
            this.displayData(data);
            
            console.log('数据已发送');
            
        } catch (error) {
            console.error('发送数据失败:', error);
            alert(`发送数据失败: ${error.message}`);
        }
    }
    
    // 渲染串口列表
    renderPortList() {
        const portList = document.getElementById('portList');
        
        if (this.ports.size === 0) {
            portList.innerHTML = `
                <div class="text-center text-muted p-3">
                    <i class="fas fa-plug"></i>
                    <p class="mb-0 mt-2">暂无连接的串口</p>
                    <small>点击"添加"按钮连接串口</small>
                </div>
            `;
            return;
        }
        
        portList.innerHTML = '';
        
        this.ports.forEach((portInfo, portId) => {
            const item = document.createElement('div');
            item.className = `port-item ${portId === this.currentPort ? 'active' : ''}`;
            
            // 判断是本地还是远程串口
            const typeIcon = portInfo.type === 'remote' ? '☁️' : '💻';
            const typeText = portInfo.type === 'remote' ? '远程' : '本地';
            const config = portInfo.config || {};
            const baudRate = config.baudRate || config.baudrate || '--';
            const parityLabel = config.parity || 'none';
            const stopBits = config.stopBits || config.stopbits || '--';
            const dataBits = config.dataBits || config.bytesize || '--';
            const logBadge = portInfo.captureActive ? '<span class="badge bg-warning text-dark ms-2">日志</span>' : '';
            
            item.innerHTML = `
                <div class="port-info">
                    <span class="port-name">${typeIcon} ${portInfo.name || portId}${logBadge}</span>
                    <span class="port-config">${baudRate} bps, ${dataBits}N${stopBits} (${typeText})</span>
                </div>
                <div class="port-status">
                    <span class="status-indicator ${portInfo.connected ? 'connected' : 'disconnected'}"></span>
                    <div class="port-actions">
                        ${portInfo.connected ? `
                        <button class="btn btn-sm btn-outline-danger" onclick="serialApp.disconnectPort('${portId}')">
                            <i class="fas fa-times"></i>
                        </button>` : ''}
                    </div>
                </div>
            `;
            
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.port-actions')) {
                    this.selectPort(portId);
                }
            });
            
            portList.appendChild(item);
        });
    }
    
    // 选中串口
    async selectPort(portId, options = {}) {
        this.currentPort = portId;
        const portInfo = this.ports.get(portId);
        const { resetHistory = false } = options;
        
        // 更新配置显示
        document.getElementById('portConfigCard').style.display = 'block';
        document.getElementById('currentPortName').textContent = portInfo?.name || portId;
        document.getElementById('baudRate').value = portInfo?.config?.baudRate || 9600;
        document.getElementById('dataBits').value = portInfo?.config?.dataBits || 8;
        document.getElementById('stopBits').value = portInfo?.config?.stopBits || 1;
        document.getElementById('parity').value = this.normalizeParityForForm(portInfo?.config?.parity);
        document.getElementById('flowControl').value = portInfo?.config?.flowControl || 'none';
        
        // 启用发送按钮
        const sendBtn = document.getElementById('sendBtn');
        if (sendBtn) {
            sendBtn.disabled = !(portInfo && portInfo.connected);
        }
        
        // 刷新显示
        this.renderPortList();
        await this.loadHistoricalLog(portId, { reset: resetHistory });
        this.refreshDataDisplay();
    }
    
    // 断开串口
    async disconnectPort(portId) {
        const portInfo = this.ports.get(portId);
        if (!portInfo) return;
        
        try {
            // 断开前自动保存日志
            if (portId === this.currentPort && this.dataLog.length > 0) {
                await this.autoSaveLog();
            }
            
            // 判断是本地串口还是远程串口
            if (portInfo.type === 'remote') {
                // 远程串口：通知服务器关闭
                this.websocket.emit('close_port', {
                    port_id: portId
                });
            } else {
                // 本地串口：直接关闭
                if (portInfo.reader) {
                    await portInfo.reader.cancel();
                    portInfo.reader.releaseLock();
                }
                
                if (portInfo.writer) {
                    portInfo.writer.releaseLock();
                }
                
                if (portInfo.port) {
                    await portInfo.port.close();
                }
            }
            
            // 移除串口
            this.ports.delete(portId);
            
            // 如果是当前串口，清空选择
            if (this.currentPort === portId) {
                this.currentPort = null;
                document.getElementById('portConfigCard').style.display = 'none';
                document.getElementById('sendBtn').disabled = true;
            }
            
            // 刷新列表
            this.renderPortList();
            this.loadCaptureStatus();
            
            console.log(`已断开串口: ${portInfo.name}`);
            this.addLog(`已断开串口: ${portInfo.name}`, 'info');
            
        } catch (error) {
            console.error('断开串口失败:', error);
        }
    }
    
    // 应用串口配置（现在只是更新显示，不实际修改）
    async applyPortConfig() {
        if (!this.currentPort) {
            alert('请先选择一个串口');
            return;
        }
        
        const portInfo = this.ports.get(this.currentPort);
        if (!portInfo) return;
        
        // 提示用户：配置在连接时已确定
        alert('串口配置在连接时已设定，无法动态修改。\n如需更改配置，请断开串口后重新连接。');
    }
    
    // 清空数据显示
    clearData() {
        document.getElementById('dataDisplay').innerHTML = '';
        const terminalDisplay = document.getElementById('terminalDisplay');
        if (terminalDisplay) terminalDisplay.innerHTML = '';
        this.dataLog = [];
        this.rxBytes = 0;
        this.txBytes = 0;
        this.updateStats();
        
        // 清空数据缓冲
        this.dataBuffer = { rx: null, tx: null };
        if (this.bufferTimeout) {
            clearTimeout(this.bufferTimeout);
            this.bufferTimeout = null;
        }
    }
    
    // 切换暂停
    togglePause() {
        this.isPaused = !this.isPaused;
        const btn = document.getElementById('pauseBtn');
        btn.innerHTML = this.isPaused ? '<i class="fas fa-play"></i>' : '<i class="fas fa-pause"></i>';
        btn.classList.toggle('active');
    }
    
    // 切换自动滚动
    toggleAutoScroll(btn) {
        this.autoScroll = !this.autoScroll;
        btn.setAttribute('data-active', this.autoScroll);
        btn.classList.toggle('active');
    }
    
    // 保存日志（改为保存到服务器）
    async saveLog() {
        if (this.dataLog.length === 0) {
            alert('没有数据可保存');
            return;
        }
        
        const filename = await this.autoSaveLog();
        if (filename) {
            alert(`日志已保存到服务器 logs/serial_logs 目录\n文件名: ${filename}`);
        } else {
            alert('保存日志失败，请查看控制台错误信息');
        }
    }
    
    // 更新统计信息
    updateStats() {
        document.getElementById('rxBytes').textContent = this.formatBytes(this.rxBytes);
        document.getElementById('txBytes').textContent = this.formatBytes(this.txBytes);
    }
    
    // 格式化字节数
    formatBytes(bytes) {
        if (bytes < 1024) return bytes;
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + 'K';
        return (bytes / 1024 / 1024).toFixed(2) + 'M';
    }
    
    // 启动运行时间计时器
    startUptimeTimer() {
        this.uptimeInterval = setInterval(() => {
            const elapsed = Date.now() - this.startTime;
            const hours = Math.floor(elapsed / 3600000);
            const minutes = Math.floor((elapsed % 3600000) / 60000);
            const seconds = Math.floor((elapsed % 60000) / 1000);
            
            const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
            document.getElementById('uptime').textContent = timeStr;
        }, 1000);
    }
    
    // 显示添加快捷指令模态框
    showAddCommandModal() {
        document.getElementById('commandName').value = '';
        document.getElementById('commandContent').value = '';
        document.querySelector('input[name="commandFormat"][value="text"]').checked = true;
        
        const modal = new bootstrap.Modal(document.getElementById('addCommandModal'));
        modal.show();
    }
    
    // 保存快捷指令
    saveCommand() {
        const name = document.getElementById('commandName').value.trim();
        const content = document.getElementById('commandContent').value.trim();
        const format = document.querySelector('input[name="commandFormat"]:checked').value;
        
        if (!name || !content) {
            alert('请填写完整的指令信息');
            return;
        }
        
        const command = {
            id: `cmd_${Date.now()}`,
            name: name,
            content: content,
            format: format
        };
        
        this.commands.push(command);
        this.saveSettings();
        this.renderCommandList();
        
        bootstrap.Modal.getInstance(document.getElementById('addCommandModal')).hide();
    }
    
    // 渲染快捷指令列表
    renderCommandList() {
        const commandList = document.getElementById('commandList');
        
        if (this.commands.length === 0) {
            commandList.innerHTML = `
                <div class="text-center text-muted p-2">
                    <small>暂无快捷指令</small>
                </div>
            `;
            return;
        }
        
        commandList.innerHTML = '';
        
        this.commands.forEach(cmd => {
            const item = document.createElement('div');
            item.className = 'command-item';
            item.innerHTML = `
                <div class="command-info">
                    <div class="command-name">${cmd.name}</div>
                    <div class="command-content">${cmd.content}</div>
                </div>
                <div class="command-actions">
                    <button class="btn btn-sm btn-primary" onclick="serialApp.sendCommand('${cmd.id}')">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="serialApp.deleteCommand('${cmd.id}')">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            
            commandList.appendChild(item);
        });
    }
    
    // 发送快捷指令
    async sendCommand(cmdId) {
        const cmd = this.commands.find(c => c.id === cmdId);
        if (!cmd) return;
        
        document.getElementById('sendInput').value = cmd.content;
        this.sendFormat = cmd.format;
        document.querySelector(`input[name="sendFormat"][value="${cmd.format}"]`).checked = true;
        
        await this.sendData();
    }
    
    // 删除快捷指令
    deleteCommand(cmdId) {
        if (!confirm('确定要删除这条快捷指令吗？')) return;
        
        this.commands = this.commands.filter(c => c.id !== cmdId);
        this.saveSettings();
        this.renderCommandList();
    }
    
    // 启动定时发送
    startTimerSend() {
        const interval = parseInt(document.getElementById('timerInterval').value);
        if (interval < 100) {
            alert('间隔时间不能小于 100 毫秒');
            document.getElementById('enableTimer').checked = false;
            return;
        }
        
        this.timerInterval = setInterval(() => {
            this.sendData();
        }, interval);
        
        console.log(`定时发送已启动，间隔: ${interval}ms`);
    }
    
    // 停止定时发送
    stopTimerSend() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
            console.log('定时发送已停止');
        }
    }
    
    // 添加日志消息
    addLog(message, type = 'info') {
        const display = document.getElementById('dataDisplay');
        const line = document.createElement('div');
        line.className = 'data-line';
        line.style.color = type === 'error' ? '#e74c3c' : '#95a5a6';
        
        // 格式化时间戳，包含毫秒
        const date = new Date();
        const hours = date.getHours().toString().padStart(2, '0');
        const minutes = date.getMinutes().toString().padStart(2, '0');
        const seconds = date.getSeconds().toString().padStart(2, '0');
        const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
        const timestamp = `${hours}:${minutes}:${seconds}.${milliseconds}`;
        
        line.innerHTML = `
            <span class="timestamp">[${timestamp}]</span>
            <span class="content">[系统] ${this.escapeHtml(message)}</span>
        `;
        display.appendChild(line);
        
        if (this.autoScroll) {
            display.scrollTop = display.scrollHeight;
        }
    }
    
    // 显示历史记录模态框
    async showHistoryModal() {
        const modal = new bootstrap.Modal(document.getElementById('historyModal'));
        modal.show();
        
        const historyList = document.getElementById('historyList');
        historyList.innerHTML = `
            <div class="text-center text-muted p-3">
                <div class="spinner-border" role="status">
                    <span class="visually-hidden">加载中...</span>
                </div>
                <p class="mt-2">正在加载历史记录...</p>
            </div>
        `;
        
        try {
            const response = await fetch('/get_serial_logs');
            const result = await response.json();
            
            if (result.success) {
                const logs = result.logs;
                
                if (logs.length === 0) {
                    historyList.innerHTML = `
                        <div class="text-center text-muted p-3">
                            <i class="fas fa-inbox" style="font-size: 3rem; opacity: 0.3;"></i>
                            <p class="mt-2">暂无历史记录</p>
                        </div>
                    `;
                    return;
                }
                
                historyList.innerHTML = '';
                
                logs.forEach(log => {
                    const date = new Date(log.modified * 1000);
                    const dateStr = date.toLocaleString('zh-CN');
                    const sizeStr = this.formatBytes(log.size);
                    
                    const item = document.createElement('div');
                    item.className = 'list-group-item list-group-item-action';
                    item.style.cursor = 'pointer';
                    item.innerHTML = `
                        <div class="d-flex justify-content-between align-items-center">
                            <div>
                                <h6 class="mb-1"><i class="fas fa-file-alt"></i> ${log.filename}</h6>
                                <small class="text-muted">
                                    <i class="fas fa-clock"></i> ${dateStr} | 
                                    <i class="fas fa-database"></i> ${sizeStr}
                                </small>
                            </div>
                            <button class="btn btn-sm btn-primary" onclick="serialApp.viewHistoryLog('${log.filename}')">
                                <i class="fas fa-eye"></i> 查看
                            </button>
                        </div>
                    `;
                    
                    historyList.appendChild(item);
                });
            } else {
                historyList.innerHTML = `
                    <div class="alert alert-danger">加载失败: ${result.error}</div>
                `;
            }
        } catch (error) {
            console.error('加载历史记录失败:', error);
            historyList.innerHTML = `
                <div class="alert alert-danger">加载失败: ${error.message}</div>
            `;
        }
    }
    
    // 查看历史日志
    async viewHistoryLog(filename) {
        try {
            const response = await fetch(`/read_serial_log/${filename}`);
            const result = await response.json();
            
            if (result.success) {
                // 在新窗口显示日志内容
                const win = window.open('', '_blank');
                win.document.write(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>${filename}</title>
                        <style>
                            body {
                                font-family: 'Consolas', monospace;
                                background: #1e1e1e;
                                color: #d4d4d4;
                                padding: 20px;
                                margin: 0;
                            }
                            pre {
                                white-space: pre-wrap;
                                word-wrap: break-word;
                            }
                        </style>
                    </head>
                    <body>
                        <pre>${this.escapeHtml(result.content)}</pre>
                    </body>
                    </html>
                `);
                win.document.close();
            } else {
                alert(`读取日志失败: ${result.error}`);
            }
        } catch (error) {
            console.error('读取日志失败:', error);
            alert(`读取日志失败: ${error.message}`);
        }
    }
    
    // HTML 转义
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 初始化应用
let serialApp;
document.addEventListener('DOMContentLoaded', () => {
    serialApp = new SerialToolApp();
});
