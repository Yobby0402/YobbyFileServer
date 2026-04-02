(function () {
    if (typeof SerialToolApp === 'undefined') {
        return;
    }

    const SOURCE_SERVER_PYSERIAL = 'server_pyserial';
    const SOURCE_BROWSER_SERIAL = 'browser_serial';

    const originalInit = SerialToolApp.prototype.init;
    const originalBindEvents = SerialToolApp.prototype.bindEvents;
    const originalOnModeChange = SerialToolApp.prototype.onModeChange;
    const originalAddRemotePort = SerialToolApp.prototype.addRemotePort;
    const originalEnsureRemoteConnection = SerialToolApp.prototype.ensureRemoteConnection;
    const originalLoadHistoricalLog = SerialToolApp.prototype.loadHistoricalLog;
    const originalRefreshDataDisplay = SerialToolApp.prototype.refreshDataDisplay;
    const originalRefreshTerminalDisplay = SerialToolApp.prototype.refreshTerminalDisplay;
    const originalDisplayTerminalData = SerialToolApp.prototype.displayTerminalData;
    const originalStartCaptureLogging = SerialToolApp.prototype.startCaptureLogging;
    const originalDisconnectPort = SerialToolApp.prototype.disconnectPort;
    const originalSendRawBytes = SerialToolApp.prototype.sendRawBytes;
    const originalSendData = SerialToolApp.prototype.sendData;
    const originalRenderCapturePorts = SerialToolApp.prototype.renderCapturePorts;

    function socketParityToWebSerial(parityCode) {
        const value = String(parityCode || 'N').toUpperCase();
        return { N: 'none', E: 'even', O: 'odd', M: 'none', S: 'none' }[value] || 'none';
    }

    function webSerialParityToSocket(parityValue) {
        const value = String(parityValue || 'none').toLowerCase();
        return { none: 'N', even: 'E', odd: 'O' }[value] || 'N';
    }

    function getPortTimestamp(record) {
        if (record.seq != null) return Number(record.seq);
        return new Date(record.timestamp || 0).getTime();
    }

    function createSocketRequest(socket, emitName, responseEvent, payload) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                socket.off(responseEvent, onResponse);
                reject(new Error(`Timed out waiting for ${responseEvent}`));
            }, 10000);

            function onResponse(result) {
                clearTimeout(timeoutId);
                resolve(result || {});
            }

            socket.once(responseEvent, onResponse);
            socket.emit(emitName, payload);
        });
    }

    function getRemoteSourceIcon(sourceType) {
        return sourceType === SOURCE_BROWSER_SERIAL ? '🔗' : '☁️';
    }

    function formatChannelState(state, connected) {
        const value = String(state || '').toLowerCase();
        if (connected || value === 'active') return '在线';
        if (value === 'offline') return '离线';
        if (value === 'sleeping') return '休眠';
        if (value === 'standby') return '待机';
        return state || '待机';
    }

    function formatTerminalRecord(record, dataFormat) {
        if (!record) return '';

        let content = '';
        switch (dataFormat) {
            case 'hex':
                content = Array.from(record.data || [])
                    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
                    .join(' ');
                break;
            case 'dec':
                content = Array.from(record.data || []).join(' ');
                break;
            case 'bin':
                content = Array.from(record.data || [])
                    .map((byte) => byte.toString(2).padStart(8, '0'))
                    .join(' ');
                break;
            default:
                content = new TextDecoder().decode(record.data || new Uint8Array());
                break;
        }

        if (record.direction === 'tx') {
            return `[TX] ${content}`;
        }
        return content;
    }

    SerialToolApp.prototype.init = function patchedInit() {
        this.mySharedChannelIds = new Set();
        this.browserSharedPorts = new Map();
        this.remoteCatalogLoaded = false;
        this.historyPageSize = 200;
        this.maxHistoryEntriesPerPort = 1000;
        return originalInit.call(this);
    };

    SerialToolApp.prototype.ensureSharedUiElements = function ensureSharedUiElements() {
        const addPortBtn = document.getElementById('addPortBtn');
        if (addPortBtn && !document.getElementById('sharePortBtn')) {
            let actionContainer = addPortBtn.parentElement;
            if (actionContainer && !actionContainer.classList.contains('btn-group')) {
                const group = document.createElement('div');
                group.className = 'btn-group btn-group-sm';
                actionContainer.replaceChild(group, addPortBtn);
                group.appendChild(addPortBtn);
                actionContainer = group;
            }

            const sharePortBtn = document.createElement('button');
            sharePortBtn.type = 'button';
            sharePortBtn.id = 'sharePortBtn';
            sharePortBtn.className = 'btn btn-sm btn-outline-success';
            sharePortBtn.title = '共享本地串口到服务器';
            sharePortBtn.innerHTML = '<i class="fas fa-share-alt"></i> 共享';
            actionContainer.appendChild(sharePortBtn);
        }

        const tabs = document.querySelector('.data-format-tabs');
        if (tabs && !document.getElementById('loadMoreHistoryBtn')) {
            const loadMoreHistoryBtn = document.createElement('button');
            loadMoreHistoryBtn.type = 'button';
            loadMoreHistoryBtn.id = 'loadMoreHistoryBtn';
            loadMoreHistoryBtn.className = 'btn btn-sm btn-outline-secondary ms-2';
            loadMoreHistoryBtn.style.display = 'none';
            loadMoreHistoryBtn.innerHTML = '<i class="fas fa-angle-double-up"></i> 更多历史';
            tabs.appendChild(loadMoreHistoryBtn);
        }

        this.updateSharedUiElements();
    };

    SerialToolApp.prototype.updateSharedUiElements = function updateSharedUiElements() {
        const sharePortBtn = document.getElementById('sharePortBtn');
        if (sharePortBtn) {
            const visible = this.connectionMode === 'remote';
            sharePortBtn.style.display = visible ? 'inline-flex' : 'none';
            sharePortBtn.disabled = !visible;
        }
    };

    SerialToolApp.prototype.bindEvents = function patchedBindEvents() {
        originalBindEvents.call(this);
        this.ensureSharedUiElements();

        const sharePortBtn = document.getElementById('sharePortBtn');
        if (sharePortBtn && !sharePortBtn.dataset.bound) {
            sharePortBtn.dataset.bound = 'true';
            sharePortBtn.addEventListener('click', () => this.shareLocalPort());
        }

        const loadMoreHistoryBtn = document.getElementById('loadMoreHistoryBtn');
        if (loadMoreHistoryBtn && !loadMoreHistoryBtn.dataset.bound) {
            loadMoreHistoryBtn.dataset.bound = 'true';
            loadMoreHistoryBtn.addEventListener('click', () => this.loadMoreHistory());
        }
    };

    SerialToolApp.prototype.onModeChange = function patchedOnModeChange() {
        originalOnModeChange.call(this);

        if (this.currentPort) {
            const currentInfo = this.ports.get(this.currentPort);
            if (
                currentInfo &&
                ((this.connectionMode === 'local' && currentInfo.type !== 'local') ||
                    (this.connectionMode === 'remote' && currentInfo.type === 'local'))
            ) {
                this.currentPort = null;
            }
        }

        if (this.connectionMode === 'remote') {
            this.connectWebSocket()
                .then(() => this.requestSharedChannels())
                .catch((error) => {
                    this.addLog(`连接共享串口服务失败: ${error.message || error}`, 'error');
                    this.requestSharedChannels(false);
                });
        }

        this.renderPortList();
        this.updateSharedUiElements();
        this.updateLoadMoreHistoryButton();
    };

    SerialToolApp.prototype.requestSharedChannels = async function requestSharedChannels(preferSocket = true) {
        if (preferSocket && this.websocket && this.websocket.connected) {
            this.websocket.emit('list_channels');
            return;
        }

        try {
            const response = await fetch('/api/serial/channels');
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || '获取共享串口失败');
            }
            this.handleSharedChannels(result);
        } catch (error) {
            console.error('加载共享串口目录失败:', error);
        }
    };

    SerialToolApp.prototype.handleSharedChannels = function handleSharedChannels(payload) {
        const channels = Array.isArray(payload?.channels) ? payload.channels : [];
        const validIds = new Set();

        channels.forEach((channel) => {
            if (!channel || !channel.channel_id) return;
            validIds.add(channel.channel_id);
            this.applySharedChannel(channel);
        });

        this.ports.forEach((info, portId) => {
            if (info?.type === 'remote' && !validIds.has(portId) && !info.captureOnly) {
                this.ports.delete(portId);
                this.mySharedChannelIds.delete(portId);
                this.browserSharedPorts.delete(portId);
            }
        });

        this.remoteCatalogLoaded = true;
        this.renderPortList();
        this.renderCapturePorts();
        this.updateLoadMoreHistoryButton();
    };

    SerialToolApp.prototype.applySharedChannel = function applySharedChannel(channel) {
        const existing = this.ports.get(channel.channel_id) || {};
        const config = channel.config || {};

        this.ports.set(channel.channel_id, {
            ...existing,
            id: channel.channel_id,
            name: channel.display_name || channel.device || channel.channel_id,
            device: channel.device || channel.display_name || channel.channel_id,
            type: 'remote',
            sourceType: channel.source_type || SOURCE_SERVER_PYSERIAL,
            channelState: channel.state || 'standby',
            captureActive: Boolean(channel.capture_active),
            captureStartedAt: channel.capture_started_at || null,
            canBackgroundCapture: Boolean(channel.can_background_capture),
            subscriberCount: channel.subscriber_count || 0,
            latestSeq: channel.latest_seq || 0,
            lastError: channel.last_error || '',
            connected: Boolean(existing.connected),
            available: channel.state !== 'offline',
            isSharedByMe: this.mySharedChannelIds.has(channel.channel_id),
            browserPortInfo: channel.browser_port || {},
            config: {
                baudRate: config.baudrate || config.baudRate || 9600,
                dataBits: config.bytesize || config.dataBits || 8,
                stopBits: config.stopbits || config.stopBits || 1,
                parity: config.parity || 'N',
            },
        });
    };

    SerialToolApp.prototype.handleChannelState = function handleChannelState(channel) {
        if (!channel || !channel.channel_id) return;
        this.applySharedChannel(channel);
        this.renderPortList();
        this.renderCapturePorts();
        this.updateLoadMoreHistoryButton();
    };

    SerialToolApp.prototype.connectWebSocket = async function patchedConnectWebSocket() {
        if (this.websocket && this.websocket.connected) {
            return;
        }
        if (typeof this.ensureSocketIoLoaded === 'function') {
            await this.ensureSocketIoLoaded();
        }
        if (typeof io === 'undefined') {
            throw new Error('Socket.IO not loaded');
        }

        await new Promise((resolve, reject) => {
            const socket = io('/serial', {
                transports: ['websocket', 'polling'],
            });

            let settled = false;
            const finishResolve = () => {
                if (!settled) {
                    settled = true;
                    resolve();
                }
            };
            const finishReject = (error) => {
                if (!settled) {
                    settled = true;
                    reject(error);
                }
            };

            this.websocket = socket;

            socket.on('connected', () => {
                this.addLog('已连接到共享串口服务', 'info');
                finishResolve();
            });

            socket.on('connect_error', (error) => {
                console.error('WebSocket connect error:', error);
                finishReject(error);
            });

            socket.on('disconnect', () => {
                this.addLog('共享串口连接已断开', 'info');
                this.renderPortList();
            });

            socket.on('ports_list', (data) => this.handleRemotePortsList(data));
            socket.on('shared_channels', (data) => this.handleSharedChannels(data));
            socket.on('channel_state', (data) => this.handleChannelState(data?.channel));
            socket.on('port_opened', (data) => this.handleRemotePortOpened(data));
            socket.on('port_closed', (data) => this.handleRemotePortClosed(data));
            socket.on('serial_entry', (data) => this.handleRemoteSerialEvent(data));
            socket.on('serial_data', (data) => this.handleRemoteSerialEvent(data));
            socket.on('data_written', (data) => this.handleRemoteDataWritten(data));
            socket.on('browser_channel_activate', (data) => this.handleBrowserChannelActivate(data));
            socket.on('browser_channel_sleep', (data) => this.handleBrowserChannelSleep(data));
            socket.on('browser_write_request', (data) => this.handleBrowserWriteRequest(data));
            socket.on('channel_error', (data) => {
                if (data?.error) {
                    this.addLog(`共享串口错误: ${data.error}`, 'error');
                }
            });
        });

        this.requestSharedChannels();
    };

    SerialToolApp.prototype.addRemotePort = async function patchedAddRemotePort() {
        if (!this.websocket || !this.websocket.connected) {
            await this.connectWebSocket();
        }
        return originalAddRemotePort.call(this);
    };

    SerialToolApp.prototype.connectSharedChannel = async function connectSharedChannel(channelId) {
        if (!channelId) return;
        if (!this.websocket || !this.websocket.connected) {
            await this.connectWebSocket();
        }
        this.websocket.emit('open_port', { channel_id: channelId });
    };

    SerialToolApp.prototype.shareLocalPort = async function shareLocalPort() {
        if (!('serial' in navigator)) {
            alert('当前浏览器不支持 Web Serial API');
            return;
        }
        const config = await this.showPortConfigDialog();
        if (!config) return;

        try {
            const port = await navigator.serial.requestPort();
            const info = port.getInfo ? port.getInfo() : {};
            const defaultName = `WebSerial ${info.usbVendorId || 'NA'}-${info.usbProductId || 'NA'}`;
            const displayName = (window.prompt('共享名称', defaultName) || defaultName).trim();
            await this.connectWebSocket();

            const result = await createSocketRequest(
                this.websocket,
                'register_browser_port',
                'browser_port_registered',
                {
                    display_name: displayName,
                    baudrate: config.baudRate,
                    bytesize: config.dataBits,
                    parity: webSerialParityToSocket(config.parity),
                    stopbits: config.stopBits,
                    browser_port: info,
                }
            );

            if (!result.success || !result.channel) {
                throw new Error(result.error || '共享串口注册失败');
            }

            this.mySharedChannelIds.add(result.channel.channel_id);
            this.browserSharedPorts.set(result.channel.channel_id, {
                port,
                config,
                reader: null,
                readLoopActive: false,
                active: false,
                closing: false,
            });
            this.applySharedChannel(result.channel);
            this.renderPortList();
            this.renderCapturePorts();
            this.addLog(`已暴露共享串口: ${displayName}`, 'info');
        } catch (error) {
            console.error('暴露本地串口失败:', error);
            alert(`暴露本地串口失败: ${error.message || error}`);
        }
    };

    SerialToolApp.prototype.unregisterSharedPort = async function unregisterSharedPort(channelId) {
        const localShared = this.browserSharedPorts.get(channelId);
        if (!localShared) return;
        if (!this.websocket || !this.websocket.connected) {
            await this.connectWebSocket();
        }

        try {
            await this.sleepSharedBrowserPort(channelId, false);
            const result = await createSocketRequest(
                this.websocket,
                'unregister_browser_port',
                'browser_port_unregistered',
                { channel_id: channelId }
            );
            if (!result.success) {
                throw new Error(result.error || '取消暴露失败');
            }
            this.browserSharedPorts.delete(channelId);
            this.mySharedChannelIds.delete(channelId);
            if (this.ports.has(channelId) && !this.captureSessions.has(channelId)) {
                this.ports.delete(channelId);
            }
            this.renderPortList();
            this.renderCapturePorts();
            this.addLog(`已取消共享串口: ${channelId}`, 'info');
            this.requestSharedChannels();
        } catch (error) {
            alert(`取消共享串口失败: ${error.message || error}`);
        }
    };

    SerialToolApp.prototype.ensureSharedBrowserPortActive = async function ensureSharedBrowserPortActive(channelId, socketConfig) {
        const sharedPort = this.browserSharedPorts.get(channelId);
        if (!sharedPort) throw new Error('shared port not found');

        if (!sharedPort.active) {
            const config = sharedPort.config || {};
            const activeConfig = socketConfig || {
                baudrate: config.baudRate || 9600,
                bytesize: config.dataBits || 8,
                stopbits: config.stopBits || 1,
                parity: webSerialParityToSocket(config.parity || 'none'),
            };

            await sharedPort.port.open({
                baudRate: activeConfig.baudrate || 9600,
                dataBits: activeConfig.bytesize || 8,
                stopBits: activeConfig.stopbits || 1,
                parity: socketParityToWebSerial(activeConfig.parity || 'N'),
                flowControl: config.flowControl || 'none',
            });
            sharedPort.active = true;
            sharedPort.closing = false;
        }

        if (!sharedPort.readLoopActive) {
            this.startSharedBrowserReader(channelId);
        }
    };

    SerialToolApp.prototype.startSharedBrowserReader = async function startSharedBrowserReader(channelId) {
        const sharedPort = this.browserSharedPorts.get(channelId);
        if (!sharedPort || sharedPort.readLoopActive || !sharedPort.port?.readable) return;

        sharedPort.readLoopActive = true;
        sharedPort.closing = false;
        const reader = sharedPort.port.readable.getReader();
        sharedPort.reader = reader;

        try {
            while (sharedPort.active && !sharedPort.closing) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value && value.length && this.websocket && this.websocket.connected) {
                    this.websocket.emit('browser_port_data', {
                        channel_id: channelId,
                        data: Array.from(value),
                    });
                }
            }
        } catch (error) {
            if (!sharedPort.closing && this.websocket && this.websocket.connected) {
                this.websocket.emit('browser_channel_ready', {
                    channel_id: channelId,
                    active: false,
                    error: error.message || String(error),
                });
            }
        } finally {
            try {
                reader.releaseLock();
            } catch (error) {
                console.debug('releaseLock failed:', error);
            }
            sharedPort.reader = null;
            sharedPort.readLoopActive = false;
        }
    };

    SerialToolApp.prototype.sleepSharedBrowserPort = async function sleepSharedBrowserPort(channelId, notifyServer = true) {
        const sharedPort = this.browserSharedPorts.get(channelId);
        if (!sharedPort) return;

        sharedPort.closing = true;
        sharedPort.active = false;

        if (sharedPort.reader) {
            try {
                await sharedPort.reader.cancel();
            } catch (error) {
                console.debug('reader cancel failed:', error);
            }
        }

        try {
            await sharedPort.port.close();
        } catch (error) {
            console.debug('shared port close failed:', error);
        }

        if (notifyServer && this.websocket && this.websocket.connected) {
            this.websocket.emit('browser_channel_ready', {
                channel_id: channelId,
                active: false,
            });
        }
    };

    SerialToolApp.prototype.handleBrowserChannelActivate = async function handleBrowserChannelActivate(data) {
        const channelId = data?.channel_id;
        if (!channelId || !this.browserSharedPorts.has(channelId)) return;

        try {
            await this.ensureSharedBrowserPortActive(channelId, data.config || {});
            if (this.websocket && this.websocket.connected) {
                this.websocket.emit('browser_channel_ready', {
                    channel_id: channelId,
                    active: true,
                });
            }
        } catch (error) {
            console.error('activate shared browser port failed:', error);
            if (this.websocket && this.websocket.connected) {
                this.websocket.emit('browser_channel_ready', {
                    channel_id: channelId,
                    active: false,
                    error: error.message || String(error),
                });
            }
        }
    };

    SerialToolApp.prototype.handleBrowserChannelSleep = async function handleBrowserChannelSleep(data) {
        const channelId = data?.channel_id;
        if (!channelId || !this.browserSharedPorts.has(channelId)) return;
        await this.sleepSharedBrowserPort(channelId, true);
    };

    SerialToolApp.prototype.handleBrowserWriteRequest = async function handleBrowserWriteRequest(data) {
        const channelId = data?.channel_id;
        const requestId = data?.request_id;
        if (!channelId || !requestId || !this.browserSharedPorts.has(channelId)) return;

        try {
            await this.ensureSharedBrowserPortActive(channelId);
            const sharedPort = this.browserSharedPorts.get(channelId);
            const writer = sharedPort.port.writable.getWriter();
            try {
                await writer.write(new Uint8Array(data.data || []));
            } finally {
                writer.releaseLock();
            }
            this.websocket.emit('browser_write_result', {
                request_id: requestId,
                success: true,
            });
        } catch (error) {
            this.websocket.emit('browser_write_result', {
                request_id: requestId,
                success: false,
                error: error.message || String(error),
            });
        }
    };

    SerialToolApp.prototype.handleRemotePortOpened = function patchedHandleRemotePortOpened(data) {
        if (!data.success) {
            alert(`打开远程串口失败: ${data.error || 'unknown_error'}`);
            return;
        }

        const portId = data.port_id;
        const channel = data.channel || data.port_info || {};
        this.applySharedChannel({
            channel_id: portId,
            ...channel,
        });
        const portInfo = this.ports.get(portId) || {};
        portInfo.connected = true;
        portInfo.captureOnly = false;
        this.ports.set(portId, portInfo);
        this.renderPortList();
        this.selectPort(portId, { resetHistory: true });

        if (!this.startTime) {
            this.startTime = Date.now();
            this.startUptimeTimer();
        }

        this.addLog(`已连接共享串口: ${portInfo.name || portId}`, 'info');
    };

    SerialToolApp.prototype.handleRemotePortClosed = function patchedHandleRemotePortClosed(data) {
        if (!data.success) return;
        const info = this.ports.get(data.port_id);
        if (info) {
            info.connected = false;
            this.ports.set(data.port_id, info);
        }
        if (this.currentPort === data.port_id) {
            const sendBtn = document.getElementById('sendBtn');
            if (sendBtn) sendBtn.disabled = true;
        }
        this.renderPortList();
    };

    SerialToolApp.prototype.ensureRemoteConnection = async function patchedEnsureRemoteConnection(session) {
        if (!this.websocket || !this.websocket.connected) {
            await this.connectWebSocket();
        }
        const channelId = session?.channel_id || session?.port_id;
        if (channelId) {
            if (this.ports.has(channelId) && this.ports.get(channelId).connected) {
                await this.selectPort(channelId);
                return;
            }
            this.websocket.emit('open_port', { channel_id: channelId });
            return;
        }
        return originalEnsureRemoteConnection.call(this, session);
    };

    SerialToolApp.prototype.handleRemoteSerialEvent = function handleRemoteSerialEvent(data) {
        const portId = data.channel_id || data.port_id;
        if (!portId) return;

        const direction = data.direction || data.entry?.dir || 'rx';
        const dataBytes = new Uint8Array(data.data || []);
        const timestamp = data.timestamp ? new Date(data.timestamp) : new Date();
        const portInfo = this.ports.get(portId) || {};
        const record = {
            portId,
            portName: portInfo.name || portId,
            direction,
            data: dataBytes,
            timestamp,
            format: this.dataFormat,
            seq: data.entry?.seq ?? null,
        };

        if (direction === 'rx') {
            this.rxBytes += dataBytes.length;
        } else {
            this.txBytes += dataBytes.length;
        }
        this.updateStats();

        this.dataLog.push(record);
        this.trimPortRecords(portId);

        if (this.isPaused) {
            return;
        }

        if (portId === this.currentPort) {
            this.displayData(record);
        }
    };

    SerialToolApp.prototype.getSortedPortRecords = function getSortedPortRecords(portId) {
        return this.dataLog
            .filter((record) => record.portId === portId)
            .sort((left, right) => getPortTimestamp(left) - getPortTimestamp(right));
    };

    SerialToolApp.prototype.trimPortRecords = function trimPortRecords(portId) {
        const records = this.getSortedPortRecords(portId);
        if (records.length <= this.maxHistoryEntriesPerPort) return;

        const keepSeq = new Set(
            records
                .slice(records.length - this.maxHistoryEntriesPerPort)
                .map((record) => `${record.seq ?? ''}_${record.timestamp}`)
        );

        this.dataLog = this.dataLog.filter((record) => {
            if (record.portId !== portId) return true;
            return keepSeq.has(`${record.seq ?? ''}_${record.timestamp}`);
        });
    };

    SerialToolApp.prototype.refreshDataDisplay = function patchedRefreshDataDisplay() {
        if (this.displayMode === 'terminal') {
            this.refreshTerminalDisplay();
            return;
        }

        const display = document.getElementById('dataDisplay');
        if (!display) {
            originalRefreshDataDisplay.call(this);
            return;
        }

        display.innerHTML = '';
        this.getSortedPortRecords(this.currentPort).forEach((record) => {
            this.displayData(record);
        });
        this.updateLoadMoreHistoryButton();
    };

    SerialToolApp.prototype.refreshTerminalDisplay = function patchedRefreshTerminalDisplay() {
        const display = document.getElementById('terminalDisplay');
        if (!display) {
            originalRefreshTerminalDisplay.call(this);
            return;
        }

        display.innerHTML = '';
        const terminalText = this.getSortedPortRecords(this.currentPort)
            .map((record) => formatTerminalRecord(record, this.dataFormat))
            .join('');

        if (terminalText) {
            display.appendChild(document.createTextNode(terminalText));
        }

        const cursor = document.createElement('span');
        cursor.className = 'terminal-cursor';
        cursor.textContent = '\u00A0';
        display.appendChild(cursor);

        if (this.autoScroll) {
            display.scrollTop = display.scrollHeight;
        }
    };

    SerialToolApp.prototype.displayTerminalData = function patchedDisplayTerminalData(data) {
        const portInfo = data?.portId ? this.ports.get(data.portId) : null;
        if (!portInfo || portInfo.type === 'local') {
            return originalDisplayTerminalData.call(this, data);
        }

        this.appendToTerminalDisplay(formatTerminalRecord(data, this.dataFormat));
    };

    SerialToolApp.prototype.loadHistoricalLog = async function patchedLoadHistoricalLog(portId, options = {}) {
        const portInfo = this.ports.get(portId);
        if (!portInfo || portInfo.type === 'local') {
            return originalLoadHistoricalLog.call(this, portId, options);
        }

        const reset = Boolean(options.reset);
        const state = this.historyMarkers.get(portId) || { beforeSeq: null, hasMore: true };
        const params = new URLSearchParams();
        params.set('limit', String(options.limit || this.historyPageSize));
        if (!reset && state.beforeSeq) {
            params.set('before_seq', String(state.beforeSeq));
        }

        try {
            const response = await fetch(`/api/serial/capture/log/${encodeURIComponent(portId)}?${params.toString()}`);
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'load_history_failed');
            }

            const entries = Array.isArray(result.entries) ? result.entries : [];
            if (reset) {
                this.dataLog = this.dataLog.filter((record) => record.portId !== portId);
            }

            entries.forEach((entry) => {
                const bytes = this.hexToUint8(entry.hex);
                const seq = entry.seq ?? null;
                const exists = this.dataLog.some((record) => record.portId === portId && record.seq === seq);
                if (exists) return;
                this.dataLog.push({
                    portId,
                    portName: portInfo.name || portId,
                    direction: entry.dir === 'tx' ? 'tx' : 'rx',
                    data: bytes,
                    timestamp: entry.ts ? new Date(entry.ts) : new Date(),
                    format: this.dataFormat,
                    seq,
                });
            });

            this.trimPortRecords(portId);
            this.historyMarkers.set(portId, {
                beforeSeq: result.has_more ? result.next_cursor : null,
                hasMore: Boolean(result.has_more),
            });

            if (portId === this.currentPort) {
                if (this.displayMode === 'terminal') {
                    this.refreshTerminalDisplay();
                } else {
                    this.refreshDataDisplay();
                }
            }
            this.updateLoadMoreHistoryButton();
        } catch (error) {
            console.error('加载历史记录失败:', error);
            this.addLog(`加载历史记录失败: ${error.message || error}`, 'error');
        }
    };

    SerialToolApp.prototype.loadMoreHistory = async function loadMoreHistory() {
        if (!this.currentPort) return;
        const state = this.historyMarkers.get(this.currentPort);
        if (!state || !state.hasMore) return;
        await this.loadHistoricalLog(this.currentPort, { reset: false });
    };

    SerialToolApp.prototype.updateLoadMoreHistoryButton = function updateLoadMoreHistoryButton() {
        const button = document.getElementById('loadMoreHistoryBtn');
        if (!button) return;

        const currentInfo = this.currentPort ? this.ports.get(this.currentPort) : null;
        const state = this.currentPort ? this.historyMarkers.get(this.currentPort) : null;
        const visible = Boolean(currentInfo && currentInfo.type === 'remote' && state && state.hasMore);
        button.style.display = visible ? 'inline-flex' : 'none';
        button.disabled = !visible;
    };

    SerialToolApp.prototype.renderCapturePorts = function patchedRenderCapturePorts() {
        if (typeof originalRenderCapturePorts === 'function') {
            originalRenderCapturePorts.call(this);
        }

        const select = document.getElementById('capturePortSelect');
        if (!select) return;

        const previous = select.value;
        const seenValues = new Set(Array.from(select.options).map((option) => option.value));

        const sharedChannels = [];
        this.ports.forEach((info, portId) => {
            if (info?.type === 'remote') {
                sharedChannels.push([portId, info]);
            }
        });

        sharedChannels
            .sort((left, right) => String(left[1]?.name || left[0]).localeCompare(String(right[1]?.name || right[0])))
            .forEach(([portId, info]) => {
                if (seenValues.has(portId)) return;
                const option = document.createElement('option');
                option.value = portId;
                option.textContent = `${info.name || portId} - ${info.sourceType === SOURCE_BROWSER_SERIAL ? '共享串口' : '远程串口'}`;
                option.dataset.channelId = portId;
                select.appendChild(option);
                seenValues.add(portId);
            });

        if (previous && select.querySelector(`option[value="${previous}"]`)) {
            select.value = previous;
        }
    };

    SerialToolApp.prototype.renderPortList = function patchedRenderPortList() {
        const portList = document.getElementById('portList');
        if (!portList) return;

        const entries = [];
        this.ports.forEach((info, portId) => {
            if (this.connectionMode === 'local') {
                if (info.type === 'local') entries.push([portId, info]);
            } else if (info.type !== 'local') {
                entries.push([portId, info]);
            }
        });

        if (entries.length === 0) {
            portList.innerHTML = `
                <div class="text-center text-muted p-3">
                    <i class="fas fa-plug"></i>
                    <p class="mb-0 mt-2">暂无可用串口</p>
                    <small>${this.connectionMode === 'remote' ? '可连接服务器串口或共享本地串口' : '点击“添加”连接本地串口'}</small>
                </div>
            `;
            return;
        }

        entries.sort((left, right) => {
            const a = left[1];
            const b = right[1];
            const activeRank = (value) => (value.connected ? 0 : value.captureActive ? 1 : value.available === false ? 3 : 2);
            return activeRank(a) - activeRank(b) || String(a.name || '').localeCompare(String(b.name || ''));
        });

        portList.innerHTML = '';
        entries.forEach(([portId, portInfo]) => {
            const item = document.createElement('div');
            item.className = `port-item ${portId === this.currentPort ? 'active' : ''}`;

            const isRemote = portInfo.type !== 'local';
            const typeIcon = isRemote ? getRemoteSourceIcon(portInfo.sourceType) : '💻';
            const stateText = isRemote ? formatChannelState(portInfo.channelState, portInfo.connected) : '已连接';
            const config = portInfo.config || {};
            const actionButtons = [];

            if (isRemote) {
                if (portInfo.connected) {
                    actionButtons.push(`<button class="btn btn-sm btn-outline-danger" onclick="serialApp.disconnectPort('${portId}')"><i class="fas fa-times"></i></button>`);
                } else if (portInfo.available !== false) {
                    actionButtons.push(`<button class="btn btn-sm btn-outline-primary" onclick="serialApp.connectSharedChannel('${portId}')"><i class="fas fa-plug"></i></button>`);
                }
                if (portInfo.captureActive) {
                    actionButtons.push(`<button class="btn btn-sm btn-outline-warning" onclick="serialApp.toggleCaptureForPort('${portId}', false)"><i class="fas fa-stop"></i></button>`);
                } else {
                    actionButtons.push(`<button class="btn btn-sm btn-outline-success" onclick="serialApp.toggleCaptureForPort('${portId}', true)"><i class="fas fa-circle"></i></button>`);
                }
                if (portInfo.isSharedByMe) {
                    actionButtons.push(`<button class="btn btn-sm btn-outline-secondary" onclick="serialApp.unregisterSharedPort('${portId}')"><i class="fas fa-unlink"></i></button>`);
                }
            } else if (portInfo.connected) {
                actionButtons.push(`<button class="btn btn-sm btn-outline-danger" onclick="serialApp.disconnectPort('${portId}')"><i class="fas fa-times"></i></button>`);
            }

            item.innerHTML = `
                <div class="port-info">
                    <span class="port-name">${typeIcon} ${portInfo.name || portId}${portInfo.captureActive ? '<span class="badge bg-warning text-dark ms-2">日志</span>' : ''}</span>
                    <span class="port-config">${config.baudRate || config.baudrate || '--'} bps, ${config.dataBits || config.bytesize || '--'} ${String(config.parity || 'N')} ${config.stopBits || config.stopbits || '--'} (${stateText})</span>
                </div>
                <div class="port-status">
                    <span class="status-indicator ${portInfo.connected || portInfo.channelState === 'active' ? 'connected' : 'disconnected'}"></span>
                    <div class="port-actions">${actionButtons.join('')}</div>
                </div>
            `;

            item.addEventListener('click', (event) => {
                if (!event.target.closest('.port-actions')) {
                    this.selectPort(portId, { resetHistory: true });
                }
            });
            portList.appendChild(item);
        });
    };

    SerialToolApp.prototype.toggleCaptureForPort = async function toggleCaptureForPort(portId, shouldStart) {
        if (!portId) return;
        try {
            const response = await fetch(shouldStart ? '/api/serial/capture/start' : '/api/serial/capture/stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ channel_id: portId }),
            });
            const result = await response.json();
            if (!result.success) {
                throw new Error(result.error || 'capture_toggle_failed');
            }
            await this.loadCaptureStatus(true);
            this.requestSharedChannels();
        } catch (error) {
            alert(`持续记录操作失败: ${error.message || error}`);
        }
    };

    SerialToolApp.prototype.startCaptureLogging = async function patchedStartCaptureLogging() {
        const capturePortSelect = document.getElementById('capturePortSelect');
        const selectedPortId = capturePortSelect?.value || '';
        const selectedInfo = selectedPortId ? this.ports.get(selectedPortId) : null;
        if (selectedInfo && selectedInfo.type === 'remote') {
            return this.toggleCaptureForPort(selectedPortId, true);
        }

        const portInfo = this.currentPort ? this.ports.get(this.currentPort) : null;
        if (portInfo && portInfo.type === 'remote') {
            return this.toggleCaptureForPort(this.currentPort, true);
        }
        return originalStartCaptureLogging.call(this);
    };

    SerialToolApp.prototype.disconnectPort = async function patchedDisconnectPort(portId) {
        const portInfo = this.ports.get(portId);
        if (!portInfo || portInfo.type === 'local') {
            return originalDisconnectPort.call(this, portId);
        }

        if (this.websocket && this.websocket.connected) {
            this.websocket.emit('close_port', { channel_id: portId });
        }
        portInfo.connected = false;
        this.ports.set(portId, portInfo);
        if (this.currentPort === portId) {
            const sendBtn = document.getElementById('sendBtn');
            if (sendBtn) sendBtn.disabled = true;
        }
        this.renderPortList();
    };

    SerialToolApp.prototype.sendRawBytes = async function patchedSendRawBytes(bytes) {
        const portInfo = this.currentPort ? this.ports.get(this.currentPort) : null;
        if (!portInfo || portInfo.type === 'local') {
            return originalSendRawBytes.call(this, bytes);
        }
        if (!portInfo.connected || !this.websocket || !this.websocket.connected) {
            throw new Error('remote_channel_not_connected');
        }
        this.websocket.emit('write_data', {
            channel_id: this.currentPort,
            data: Array.from(new Uint8Array(bytes)),
        });
    };

    SerialToolApp.prototype.sendData = async function patchedSendData() {
        const portInfo = this.currentPort ? this.ports.get(this.currentPort) : null;
        if (!portInfo || portInfo.type === 'local') {
            return originalSendData.call(this);
        }

        if (!portInfo.connected) {
            alert('当前共享串口未连接');
            return;
        }

        const input = document.getElementById('sendInput').value;
        if (!input) {
            alert('请输入要发送的数据');
            return;
        }

        let dataToSend;
        if (this.sendFormat === 'hex') {
            const hexStr = input.replace(/\s+/g, '');
            if (!/^[0-9A-Fa-f]*$/.test(hexStr)) {
                alert('HEX 格式错误');
                return;
            }
            const bytes = [];
            for (let index = 0; index < hexStr.length; index += 2) {
                bytes.push(parseInt(hexStr.substr(index, 2), 16));
            }
            dataToSend = new Uint8Array(bytes);
        } else {
            let text = input;
            if (document.getElementById('appendCRLF').checked) {
                text += '\r\n';
            }
            dataToSend = new TextEncoder().encode(text);
        }

        this.websocket.emit('write_data', {
            channel_id: this.currentPort,
            data: Array.from(dataToSend),
        });
    };
})();
