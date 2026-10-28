(function () {
    if (typeof SerialToolApp === 'undefined') {
        return;
    }

    const SOURCE_SERVER_PYSERIAL = 'server_pyserial';
    const SOURCE_BROWSER_SERIAL = 'browser_serial';

    const originalInit = SerialToolApp.prototype.init;
    const originalOnModeChange = SerialToolApp.prototype.onModeChange;
    const originalAddRemotePort = SerialToolApp.prototype.addRemotePort;
    const originalEnsureRemoteConnection = SerialToolApp.prototype.ensureRemoteConnection;
    const originalLoadHistoricalLog = SerialToolApp.prototype.loadHistoricalLog;
    const originalRefreshDataDisplay = SerialToolApp.prototype.refreshDataDisplay;
    const originalRefreshTerminalDisplay = SerialToolApp.prototype.refreshTerminalDisplay;
    const originalDisplayTerminalData = SerialToolApp.prototype.displayTerminalData;
    const originalStartCaptureLogging = SerialToolApp.prototype.startCaptureLogging;
    const originalStartCaptureStatusRefresh = SerialToolApp.prototype.startCaptureStatusRefresh;
    const originalStopCaptureStatusRefresh = SerialToolApp.prototype.stopCaptureStatusRefresh;
    const originalDisconnectPortTransport = SerialToolApp.prototype.disconnectPortTransport;
    const originalWritePortData = SerialToolApp.prototype.writePortData;
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

    function formatTerminalRecord(record, dataFormat, app) {
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

        const prefix =
            app && typeof app.formatTerminalTimePrefix === 'function'
                ? app.formatTerminalTimePrefix(record.timestamp)
                : '';
        if (record.direction === 'tx') {
            return `${prefix}[TX] ${content}`;
        }
        return `${prefix}${content}`;
    }

    SerialToolApp.prototype.init = function patchedInit() {
        this.mySharedChannelIds = new Set();
        this.browserSharedPorts = new Map();
        this.sharedChannelToLocalPortId = new Map();
        this.sharedChannelCatalog = new Map();
        this.serialRelays = new Map();
        this.remoteCatalogLoaded = false;
        this.historyPageSize = 200;
        this.maxHistoryEntriesPerPort = 1000;
        this.captureLogCursors = new Map();
        this.captureLogPollTimer = null;
        this.captureLogPollInFlight = false;
        const result = originalInit.call(this);
        this.connectWebSocket()
            .then(() => {
                this.requestSharedChannels();
                this.requestSerialRelays();
            })
            .catch(() => this.requestSharedChannels(false));
        return result;
    };

    SerialToolApp.prototype.ensureSharedUiElements = function ensureSharedUiElements() {
        const modeCard = document.querySelector('input[name="connectionMode"]')?.closest('.card');
        if (modeCard) {
            modeCard.remove();
        }

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

        const sharePortBtn = document.getElementById('sharePortBtn');
        if (sharePortBtn) {
            sharePortBtn.remove();
        }
        if (addPortBtn) {
            addPortBtn.title = '添加本地串口，可在添加时选择是否共享';
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
            sharePortBtn.remove();
        }
    };

    SerialToolApp.prototype.bindAdditionalEvents = function bindAdditionalEvents() {
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

        const startRelayBtn = document.getElementById('startRelayBtn');
        if (startRelayBtn && !startRelayBtn.dataset.bound) {
            startRelayBtn.dataset.bound = 'true';
            startRelayBtn.addEventListener('click', () => this.startSerialRelay());
        }

        const relayList = document.getElementById('relayList');
        if (relayList && !relayList.dataset.bound) {
            relayList.dataset.bound = 'true';
            relayList.addEventListener('click', (event) => {
                const button = event.target.closest('[data-relay-stop]');
                if (button) this.stopSerialRelay(button.dataset.relayStop);
            });
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

    SerialToolApp.prototype.requestSerialRelays = function requestSerialRelays() {
        if (this.websocket && this.websocket.connected) {
            this.websocket.emit('list_relays');
        }
    };

    SerialToolApp.prototype.handleSerialRelays = function handleSerialRelays(payload) {
        const relays = Array.isArray(payload?.relays) ? payload.relays : [];
        this.serialRelays = new Map(relays.map((relay) => [relay.relay_id, relay]));
        this.renderRelayControls();
        this.renderPortList();
    };

    SerialToolApp.prototype.renderRelayControls = function renderRelayControls() {
        const firstSelect = document.getElementById('relayChannelA');
        const secondSelect = document.getElementById('relayChannelB');
        const startButton = document.getElementById('startRelayBtn');
        const relayList = document.getElementById('relayList');
        if (!firstSelect || !secondSelect || !startButton || !relayList) return;

        const previousFirst = firstSelect.value;
        const previousSecond = secondSelect.value;
        const channels = Array.from(this.sharedChannelCatalog.values())
            .filter((channel) => channel.state !== 'offline' && !channel.relay_id)
            .sort((left, right) => String(left.display_name || left.channel_id).localeCompare(String(right.display_name || right.channel_id)));
        const options = ['<option value="">请选择共享通道</option>'].concat(
            channels.map((channel) => `<option value="${this.escapeHtml(channel.channel_id)}">${this.escapeHtml(channel.display_name || channel.device || channel.channel_id)}</option>`)
        ).join('');
        firstSelect.innerHTML = options;
        secondSelect.innerHTML = options;
        if (channels.some((channel) => channel.channel_id === previousFirst)) firstSelect.value = previousFirst;
        if (channels.some((channel) => channel.channel_id === previousSecond)) secondSelect.value = previousSecond;
        startButton.disabled = channels.length < 2;

        const relays = Array.from(this.serialRelays.values());
        relayList.innerHTML = relays.length === 0
            ? '暂无透传任务'
            : relays.map((relay) => `
                <div class="d-flex align-items-center justify-content-between gap-2 mb-1">
                    <span>${this.escapeHtml(relay.channel_a_name || relay.channel_a)} ↔ ${this.escapeHtml(relay.channel_b_name || relay.channel_b)}</span>
                    <button type="button" class="btn btn-sm btn-outline-danger py-0" data-relay-stop="${this.escapeHtml(relay.relay_id)}">停止</button>
                </div>
            `).join('');
    };

    SerialToolApp.prototype.startSerialRelay = async function startSerialRelay() {
        const channelA = document.getElementById('relayChannelA')?.value || '';
        const channelB = document.getElementById('relayChannelB')?.value || '';
        if (!channelA || !channelB || channelA === channelB) {
            alert('请选择两个不同的共享串口');
            return;
        }

        try {
            if (!this.websocket || !this.websocket.connected) {
                await this.connectWebSocket();
            }
            const result = await createSocketRequest(
                this.websocket,
                'start_relay',
                'relay_started',
                { channel_a: channelA, channel_b: channelB }
            );
            if (!result.success) {
                throw new Error(result.error || 'relay_start_failed');
            }
            this.addLog(`已启动串口透传: ${result.relay.channel_a_name} ↔ ${result.relay.channel_b_name}`, 'info');
        } catch (error) {
            this.addLog(`启动串口透传失败: ${error.message || error}`, 'error');
        }
    };

    SerialToolApp.prototype.stopSerialRelay = async function stopSerialRelay(relayId) {
        if (!relayId || !this.websocket || !this.websocket.connected) return;
        try {
            const result = await createSocketRequest(
                this.websocket,
                'stop_relay',
                'relay_stopped',
                { relay_id: relayId }
            );
            if (!result.success) {
                throw new Error(result.error || 'relay_stop_failed');
            }
            this.addLog('已停止串口透传', 'info');
        } catch (error) {
            this.addLog(`停止串口透传失败: ${error.message || error}`, 'error');
        }
    };

    SerialToolApp.prototype.findLocalPortIdBySharedChannel = function findLocalPortIdBySharedChannel(channelId) {
        if (!channelId) return null;
        const mappedPortId = this.sharedChannelToLocalPortId.get(channelId);
        if (mappedPortId && this.ports.has(mappedPortId)) {
            return mappedPortId;
        }
        for (const [portId, info] of this.ports.entries()) {
            if (info?.type === 'local' && info.sharedChannelId === channelId) {
                this.sharedChannelToLocalPortId.set(channelId, portId);
                return portId;
            }
        }
        return null;
    };

    SerialToolApp.prototype.applyLocalSharedChannel = function applyLocalSharedChannel(portId, channel) {
        const portInfo = this.ports.get(portId);
        if (!portInfo || !channel?.channel_id) return false;

        this.sharedChannelToLocalPortId.set(channel.channel_id, portId);
        this.mySharedChannelIds.add(channel.channel_id);
        this.browserSharedPorts.set(channel.channel_id, {
            ...(this.browserSharedPorts.get(channel.channel_id) || {}),
            port: portInfo.port,
            config: portInfo.config || {},
            localPortId: portId,
            mirrorLocal: true,
            active: Boolean(portInfo.connected),
            closing: false,
        });

        portInfo.sharedChannelId = channel.channel_id;
        portInfo.sharedDisplayName = channel.display_name || channel.device || portInfo.name;
        portInfo.sharedChannelState = channel.state || 'standby';
        portInfo.shareState = 'shared';
        portInfo.sourceType = channel.source_type || SOURCE_BROWSER_SERIAL;
        portInfo.subscriberCount = channel.subscriber_count || 0;
        portInfo.captureActive = Boolean(channel.capture_active);
        portInfo.captureStartedAt = channel.capture_started_at || null;
        portInfo.latestSeq = channel.latest_seq || 0;
        portInfo.lastError = channel.last_error || '';
        portInfo.relayId = channel.relay_id || null;
        this.ports.set(portId, portInfo);
        return true;
    };

    SerialToolApp.prototype.clearLocalSharedChannel = function clearLocalSharedChannel(portId, channelId) {
        const portInfo = this.ports.get(portId);
        if (!portInfo) return;
        const targetChannelId = channelId || portInfo.sharedChannelId;
        if (targetChannelId) {
            this.sharedChannelToLocalPortId.delete(targetChannelId);
            this.mySharedChannelIds.delete(targetChannelId);
            this.browserSharedPorts.delete(targetChannelId);
        }
        portInfo.sharedChannelId = null;
        portInfo.sharedDisplayName = null;
        portInfo.sharedChannelState = null;
        portInfo.shareState = 'private';
        portInfo.subscriberCount = 0;
        portInfo.captureActive = false;
        portInfo.captureStartedAt = null;
        portInfo.latestSeq = 0;
        portInfo.lastError = '';
        portInfo.relayId = null;
        this.ports.set(portId, portInfo);
    };

    SerialToolApp.prototype.handleSharedChannels = function handleSharedChannels(payload) {
        const channels = Array.isArray(payload?.channels) ? payload.channels : [];
        const validIds = new Set();
        this.sharedChannelCatalog = new Map();

        channels.forEach((channel) => {
            if (!channel || !channel.channel_id) return;
            validIds.add(channel.channel_id);
            this.sharedChannelCatalog.set(channel.channel_id, channel);
            this.applySharedChannel(channel);
        });

        for (const [channelId, localPortId] of Array.from(this.sharedChannelToLocalPortId.entries())) {
            if (!validIds.has(channelId)) {
                this.clearLocalSharedChannel(localPortId, channelId);
            }
        }

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
        this.renderRelayControls();
    };

    SerialToolApp.prototype.applySharedChannel = function applySharedChannel(channel) {
        const localPortId = this.findLocalPortIdBySharedChannel(channel?.channel_id);
        if (localPortId && channel?.source_type === SOURCE_BROWSER_SERIAL) {
            this.applyLocalSharedChannel(localPortId, channel);
            return;
        }

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
            relayId: channel.relay_id || null,
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
        this.sharedChannelCatalog.set(channel.channel_id, channel);
        this.applySharedChannel(channel);
        this.renderPortList();
        this.renderCapturePorts();
        this.updateLoadMoreHistoryButton();
        this.renderRelayControls();
    };

    SerialToolApp.prototype.bindSerialSocketFeatureEvents = function bindSerialSocketFeatureEvents(socket) {
        socket.on('ports_list', (data) => this.handleRemotePortsList(data));
        socket.on('shared_channels', (data) => this.handleSharedChannels(data));
        socket.on('serial_relays', (data) => this.handleSerialRelays(data));
        socket.on('channel_state', (data) => this.handleChannelState(data?.channel));
        socket.on('port_opened', (data) => this.handleRemotePortOpened(data));
        socket.on('port_closed', (data) => this.handleRemotePortClosed(data));
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
        socket.on('relay_error', (data) => {
            this.addLog(`串口透传已停止: ${data?.error || 'relay_error'}`, 'error');
        });
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

    SerialToolApp.prototype.shareLocalPortEntry = async function shareLocalPortEntry(portId) {
        const portInfo = this.ports.get(portId);
        if (!portInfo || portInfo.type !== 'local') return;
        if (portInfo.sharedChannelId) return;
        if (!this.websocket || !this.websocket.connected) {
            await this.connectWebSocket();
        }

        const browserPortInfo = portInfo.port?.getInfo ? portInfo.port.getInfo() : {};
        const config = portInfo.config || {};
        const result = await createSocketRequest(
            this.websocket,
            'register_browser_port',
            'browser_port_registered',
            {
                display_name: portInfo.name || portInfo.device || 'Local Serial',
                baudrate: config.baudRate || config.baudrate || 9600,
                bytesize: config.dataBits || config.bytesize || 8,
                parity: webSerialParityToSocket(config.parity || 'none'),
                stopbits: config.stopBits || config.stopbits || 1,
                browser_port: browserPortInfo,
            }
        );

        if (!result.success || !result.channel) {
            throw new Error(result.error || 'share_local_port_failed');
        }

        this.applyLocalSharedChannel(portId, result.channel);
        this.renderPortList();
        this.renderCapturePorts();
        this.addLog(`已共享本地串口: ${portInfo.name || portId}`, 'info');
        this.requestSharedChannels();
    };

    SerialToolApp.prototype.toggleLocalPortSharing = async function toggleLocalPortSharing(portId, shouldShare) {
        const portInfo = this.ports.get(portId);
        if (!portInfo || portInfo.type !== 'local') return;
        try {
            if (shouldShare) {
                await this.shareLocalPortEntry(portId);
            } else if (portInfo.sharedChannelId) {
                await this.unregisterSharedPort(portInfo.sharedChannelId);
            }
        } catch (error) {
            alert(`串口共享操作失败: ${error.message || error}`);
        }
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
        const localPortId = localShared.localPortId || this.sharedChannelToLocalPortId.get(channelId);
        if (!this.websocket || !this.websocket.connected) {
            await this.connectWebSocket();
        }

        try {
            if (!localShared.mirrorLocal) {
                await this.sleepSharedBrowserPort(channelId, false);
            }
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
            if (localPortId) {
                this.clearLocalSharedChannel(localPortId, channelId);
            }
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

        if (sharedPort.mirrorLocal) {
            const portInfo = this.ports.get(sharedPort.localPortId);
            if (!portInfo || !portInfo.connected) {
                throw new Error('local port is not connected');
            }
            sharedPort.active = true;
            sharedPort.closing = false;
            return;
        }

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

        if (sharedPort.mirrorLocal) {
            if (notifyServer && this.websocket && this.websocket.connected) {
                this.websocket.emit('browser_channel_ready', {
                    channel_id: channelId,
                    active: false,
                });
            }
            return;
        }

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
                if (sharedPort.mirrorLocal && typeof this.appendMirroredLocalTx === 'function') {
                    this.appendMirroredLocalTx(sharedPort.localPortId, new Uint8Array(data.data || []));
                }
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

    SerialToolApp.prototype.forwardLocalSharedRx = function forwardLocalSharedRx(portId, value) {
        const portInfo = this.ports.get(portId);
        if (!portInfo?.sharedChannelId || !this.websocket || !this.websocket.connected) return;
        this.websocket.emit('browser_port_data', {
            channel_id: portInfo.sharedChannelId,
            data: Array.from(value || []),
        });
    };

    SerialToolApp.prototype.mirrorLocalSharedTx = async function mirrorLocalSharedTx(portId, value) {
        const portInfo = this.ports.get(portId);
        if (!portInfo?.sharedChannelId || !this.websocket || !this.websocket.connected) return;
        this.websocket.emit('browser_port_tx', {
            channel_id: portInfo.sharedChannelId,
            data: Array.from(value || []),
        });
    };

    SerialToolApp.prototype.appendMirroredLocalTx = function appendMirroredLocalTx(portId, value) {
        const portInfo = this.ports.get(portId);
        if (!portInfo) return;
        const dataBytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
        const record = {
            portId,
            portName: portInfo.name || portId,
            direction: 'tx',
            data: dataBytes,
            timestamp: new Date(),
            format: this.dataFormat,
        };
        this.addPortBytes(portId, 'tx', dataBytes.length);
        this.dataLog.push(record);
        if (!this.isPaused && this.currentPort === portId) {
            this.displayData(record);
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
        const seq = data.entry?.seq ?? null;

        if (direction === 'rx') {
            this.addPortBytes(portId, 'rx', dataBytes.length);
            if (typeof this.ingestRxForDisplay === 'function') {
                this.ingestRxForDisplay(portId, dataBytes, timestamp, { seq });
            }
            return;
        }

        this.addPortBytes(portId, 'tx', dataBytes.length);

        const record = {
            portId,
            portName: portInfo.name || portId,
            direction: 'tx',
            data: dataBytes,
            timestamp,
            format: this.dataFormat,
        };
        if (seq != null) record.seq = seq;

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
        if (typeof this.flushAllBubbleRxPending === 'function') {
            this.flushAllBubbleRxPending();
        }
        if (this.isTerminalMode()) {
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

        const terminalText = this.getSortedPortRecords(this.currentPort)
            .filter((record) => !(this.isTerminalReplMode() && record.direction === 'tx'))
            .map((record) => formatTerminalRecord(record, this.dataFormat, this))
            .join('');
        this.resetTerminalDisplay(terminalText);
    };

    SerialToolApp.prototype.displayTerminalData = function patchedDisplayTerminalData(data) {
        const portInfo = data?.portId ? this.ports.get(data.portId) : null;
        if (!portInfo || portInfo.type === 'local') {
            return originalDisplayTerminalData.call(this, data);
        }

        if (this.isTerminalReplMode() && data.direction === 'tx') {
            return;
        }
        this.appendToTerminalDisplay(formatTerminalRecord(data, this.dataFormat, this));
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
                if (seq != null) {
                    this.captureLogCursors.set(
                        portId,
                        Math.max(this.captureLogCursors.get(portId) || 0, Number(seq))
                    );
                }
            });

            this.trimPortRecords(portId);
            this.historyMarkers.set(portId, {
                beforeSeq: result.has_more ? result.next_cursor : null,
                hasMore: Boolean(result.has_more),
            });

            if (portId === this.currentPort) {
                if (this.isTerminalMode()) {
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

    SerialToolApp.prototype.startCaptureLogPolling = function startCaptureLogPolling() {
        if (this.captureLogPollTimer) return;
        this.captureLogPollTimer = setInterval(() => this.pollSelectedCaptureLog(), 1000);
    };

    SerialToolApp.prototype.stopCaptureLogPolling = function stopCaptureLogPolling() {
        if (!this.captureLogPollTimer) return;
        clearInterval(this.captureLogPollTimer);
        this.captureLogPollTimer = null;
    };

    SerialToolApp.prototype.pollSelectedCaptureLog = async function pollSelectedCaptureLog() {
        const portId = this.currentPort;
        const portInfo = portId ? this.ports.get(portId) : null;
        if (
            this.captureLogPollInFlight ||
            !portId ||
            !this.captureSessions.has(portId) ||
            !portInfo ||
            portInfo.connected
        ) {
            return;
        }

        this.captureLogPollInFlight = true;
        try {
            const cursor = this.captureLogCursors.get(portId) || 0;
            const response = await fetch(
                `/api/serial/capture/log/${encodeURIComponent(portId)}?after_seq=${encodeURIComponent(cursor)}&limit=500`
            );
            const result = await response.json();
            if (!response.ok || !result.success) {
                throw new Error(result.error || '读取持续日志失败');
            }

            const entries = Array.isArray(result.entries) ? result.entries : [];
            entries.forEach((entry) => {
                const seq = Number(entry.seq || 0);
                if (!seq || seq <= (this.captureLogCursors.get(portId) || 0)) return;

                const data = this.hexToUint8(entry.hex);
                const timestamp = entry.ts ? new Date(entry.ts) : new Date();
                this.captureLogCursors.set(portId, seq);
                if (entry.dir === 'tx') {
                    const record = {
                        portId,
                        portName: portInfo.name || portId,
                        direction: 'tx',
                        data,
                        timestamp,
                        format: this.dataFormat,
                        seq,
                    };
                    this.addPortBytes(portId, 'tx', data.length);
                    this.dataLog.push(record);
                    if (!this.isPaused && this.currentPort === portId) this.displayData(record);
                } else {
                    this.addPortBytes(portId, 'rx', data.length);
                    this.ingestRxForDisplay(portId, data, timestamp, { seq });
                }
            });
            this.trimPortRecords(portId);
            if (result.has_more) {
                setTimeout(() => this.pollSelectedCaptureLog(), 0);
            }
        } catch (error) {
            console.warn('读取持续日志失败:', error);
        } finally {
            this.captureLogPollInFlight = false;
        }
    };

    SerialToolApp.prototype.startCaptureStatusRefresh = function patchedStartCaptureStatusRefresh() {
        originalStartCaptureStatusRefresh.call(this);
        this.startCaptureLogPolling();
    };

    SerialToolApp.prototype.stopCaptureStatusRefresh = function patchedStopCaptureStatusRefresh() {
        originalStopCaptureStatusRefresh.call(this);
        if (this.captureSessions.size === 0) this.stopCaptureLogPolling();
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

    SerialToolApp.prototype.renderPortList = function unifiedRenderPortList() {
        const portList = document.getElementById('portList');
        if (!portList) return;

        const entries = Array.from(this.ports.entries()).filter(([, info]) => info && !info.hidden);

        if (entries.length === 0) {
            portList.innerHTML = `
                <div class="text-center text-muted p-3">
                    <i class="fas fa-plug"></i>
                    <p class="mb-0 mt-2">暂无可用串口</p>
                    <small>已共享串口会自动出现；点击“添加”可选择本地串口</small>
                </div>
            `;
            return;
        }

        entries.sort((left, right) => {
            const rank = (info) => {
                if (info.type === 'local' && info.sharedChannelId) return 0;
                if (info.type === 'local') return 1;
                if (info.connected) return 2;
                if (info.available === false) return 4;
                return 3;
            };
            return rank(left[1]) - rank(right[1]) || String(left[1].name || left[0]).localeCompare(String(right[1].name || right[0]));
        });

        portList.innerHTML = '';
        entries.forEach(([portId, portInfo]) => {
            const item = document.createElement('div');
            const isLocal = portInfo.type === 'local';
            const isLocalShared = isLocal && Boolean(portInfo.sharedChannelId);
            const className = isLocal
                ? (isLocalShared ? 'port-local-shared' : 'port-local-private')
                : 'port-remote-shared';
            item.className = `port-item ${className} ${portId === this.currentPort ? 'active' : ''}`;

            const config = portInfo.config || {};
            const typeIcon = isLocal ? '💻' : getRemoteSourceIcon(portInfo.sourceType);
            const badgeClass = isLocal
                ? (isLocalShared ? 'local-shared' : 'local-private')
                : 'remote-shared';
            const badgeText = isLocal
                ? (isLocalShared ? '本地已共享' : '本地未共享')
                : '远程共享';
            const stateText = isLocal
                ? (isLocalShared ? `共享状态：${formatChannelState(portInfo.sharedChannelState, false)}` : '仅本机可用')
                : formatChannelState(portInfo.channelState, portInfo.connected);
            const logBadge = portInfo.captureActive ? '<span class="badge bg-warning text-dark ms-2">日志</span>' : '';
            const relayBadge = portInfo.relayId ? '<span class="badge bg-primary ms-2">透传</span>' : '';

            item.innerHTML = `
                <div class="port-info">
                    <span class="port-name">${typeIcon} ${this.escapeHtml(portInfo.name || portId)}<span class="port-badge ${badgeClass}">${badgeText}</span>${logBadge}${relayBadge}</span>
                    <span class="port-config">${this.escapeHtml(config.baudRate || config.baudrate || '--')} bps, ${this.escapeHtml(config.dataBits || config.bytesize || '--')} ${this.escapeHtml(String(config.parity || 'N'))} ${this.escapeHtml(config.stopBits || config.stopbits || '--')} (${this.escapeHtml(stateText)})</span>
                </div>
                <div class="port-status">
                    <span class="status-indicator ${portInfo.connected || portInfo.channelState === 'active' || portInfo.sharedChannelState === 'active' ? 'connected' : 'disconnected'}"></span>
                    <div class="port-actions"></div>
                </div>
            `;

            const actions = item.querySelector('.port-actions');
            const addAction = (className, title, iconClass, handler) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `btn btn-sm ${className}`;
                button.title = title;
                button.setAttribute('aria-label', title);
                button.innerHTML = `<i class="fas ${iconClass}"></i>`;
                button.addEventListener('click', handler);
                actions.appendChild(button);
            };

            if (isLocal) {
                addAction(
                    isLocalShared ? 'btn-outline-warning' : 'btn-outline-success',
                    isLocalShared ? '取消共享' : '共享串口',
                    isLocalShared ? 'fa-unlink' : 'fa-share-alt',
                    () => this.toggleLocalPortSharing(portId, !isLocalShared),
                );
                addAction('btn-outline-danger', '关闭本地串口', 'fa-times', () => this.disconnectPort(portId));
            } else {
                if (portInfo.connected) {
                    addAction('btn-outline-danger', '断开连接', 'fa-times', () => this.disconnectPort(portId));
                } else if (portInfo.available !== false) {
                    addAction('btn-outline-primary', '使用共享串口', 'fa-plug', () => this.connectSharedChannel(portId));
                }
                addAction(
                    portInfo.captureActive ? 'btn-outline-warning' : 'btn-outline-success',
                    portInfo.captureActive ? '停止后台记录' : '开启后台记录',
                    portInfo.captureActive ? 'fa-stop' : 'fa-circle',
                    () => this.toggleCaptureForPort(portId, !portInfo.captureActive),
                );
            }

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
            if (shouldStart) {
                await this.selectPort(portId, { resetHistory: true });
                this.startCaptureLogPolling();
            }
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
        const session = await originalStartCaptureLogging.call(this);
        const channelId = session?.channel_id || session?.port_id;
        if (channelId) {
            await this.selectPort(channelId, { resetHistory: true });
            this.startCaptureLogPolling();
        }
        return session;
    };

    SerialToolApp.prototype.disconnectPortTransport = async function disconnectPortTransport(portId, portInfo) {
        if (portInfo.type === 'local') {
            if (portInfo.sharedChannelId) {
                await this.unregisterSharedPort(portInfo.sharedChannelId);
            }
            return originalDisconnectPortTransport.call(this, portId, portInfo);
        }

        if (this.websocket && this.websocket.connected) {
            this.websocket.emit('close_port', { channel_id: portId });
        }
        portInfo.connected = false;
        this.ports.set(portId, portInfo);
        return { removePort: false };
    };

    SerialToolApp.prototype.writePortData = async function patchedWritePortData(portId, portInfo, data) {
        if (!portInfo || portInfo.type === 'local') {
            return originalWritePortData.call(this, portId, portInfo, data);
        }
        if (!portInfo.connected || !this.websocket || !this.websocket.connected) {
            throw new Error('远程共享串口连接已断开');
        }
        this.websocket.emit('write_data', {
            channel_id: portId,
            data: Array.from(data),
        });
        return { awaitRemoteRecord: true };
    };
})();
