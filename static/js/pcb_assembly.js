import * as THREE from 'three';
import { OBJLoader } from 'three/addons/OBJLoader.js';
import { MTLLoader } from 'three/addons/MTLLoader.js';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { ViewCube } from './view_cube.js';

const config = JSON.parse(document.getElementById('pcb-assembly-config').textContent);
const BACKGROUNDS = [0x17191d, 0x30343a, 0xf0f1f3, 0x0b0c0e];

class PcbAssemblyWorkspace {
    constructor(workspaceConfig) {
        this.config = workspaceConfig;
        this.stage = document.getElementById('assembly-stage');
        this.canvasContainer = document.getElementById('assembly-canvas');
        this.modelList = document.getElementById('assembly-model-list');
        this.emptyState = document.getElementById('assembly-model-empty');
        this.status = document.getElementById('assembly-receiver-status');
        this.statusLabel = document.getElementById('assembly-receiver-label');
        this.notice = document.getElementById('assembly-stage-notice');
        this.errorElement = document.getElementById('assembly-error');
        this.loading = document.getElementById('assembly-loading');
        this.loadingLabel = document.getElementById('assembly-loading-label');
        this.modelCount = document.getElementById('assembly-model-count');
        this.selectedName = document.getElementById('assembly-selected-name');
        this.transformForm = document.getElementById('assembly-transform-form');
        this.saveDialog = document.getElementById('assembly-save-dialog');
        this.saveForm = document.getElementById('assembly-save-form');
        this.saveName = document.getElementById('assembly-save-name');
        this.saveError = document.getElementById('assembly-save-error');
        this.saveProgress = document.getElementById('assembly-save-progress');
        this.saveProgressLabel = document.getElementById('assembly-save-progress-label');
        this.saveSuccess = document.getElementById('assembly-save-success');
        this.saveResult = document.getElementById('assembly-save-result');
        this.separateItems = document.getElementById('assembly-separate-items');
        this.separateItemsHint = document.getElementById('assembly-separate-items-hint');
        this.stepFormat = document.getElementById('assembly-step-format');
        this.stepSelection = document.getElementById('assembly-step-selection');
        this.stepItems = document.getElementById('assembly-step-items');
        this.stepSummary = document.getElementById('assembly-step-summary');
        this.reviewLink = document.getElementById('assembly-review-link');
        this.editor = document.getElementById('assembly-editor');
        this.presentation = document.getElementById('assembly-presentation');
        this.presentationFrame = document.getElementById('assembly-presentation-frame');
        this.presentationEmpty = document.getElementById('assembly-presentation-empty');
        this.toolbarActions = document.getElementById('assembly-toolbar-actions');
        this.modeDescription = document.getElementById('assembly-mode-description');
        this.modeButtons = Array.from(document.querySelectorAll('[data-workspace-mode]'));
        this.presentationButton = this.modeButtons.find((button) => button.dataset.workspaceMode === 'presentation');

        this.sessionId = null;
        this.listening = false;
        this.revision = -1;
        this.items = new Map();
        this.selectedId = null;
        this.selectionHelper = null;
        this.pollTimer = null;
        this.heartbeatTimer = null;
        this.polling = false;
        this.pointerDown = null;
        this.dirty = false;
        this.closed = false;
        this.currentMode = 'assembly';
        this.savedReviewUrl = null;
        this.backgroundIndex = 0;
        this.transformDrag = null;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x17191d);
        this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100000);
        this.camera.up.set(0, 0, 1);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.shadowMap.enabled = true;
        this.canvasContainer.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.07;
        this.controls.screenSpacePanning = true;
        this.controls.target.set(0, 0, 0);

        this.assemblyRoot = new THREE.Group();
        this.assemblyRoot.name = 'PCB Assembly';
        this.scene.add(this.assemblyRoot);
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();

        this.setupScene();
        this.viewCube = new ViewCube(document.getElementById('assembly-view-cube'), {
            labels: { px: '右', nx: '左', py: '后', ny: '前', pz: '上', nz: '下' },
            getOrientation: () => this.camera.quaternion.clone().invert(),
            onView: (direction) => this.setViewDirection(direction),
            onDrag: (deltaX, deltaY) => this.rotateViewFromCube(deltaX, deltaY),
        });
        this.bindEvents();
        this.resize();
        this.fitView();
        this.animate();
        this.createSession();
    }

    setupScene() {
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x434b55, 1.8));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.6);
        keyLight.position.set(180, -140, 220);
        keyLight.castShadow = true;
        this.scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0xa8cfff, 1.15);
        fillLight.position.set(-160, 120, 90);
        this.scene.add(fillLight);

        this.grid = new THREE.GridHelper(2000, 100, 0x68737c, 0x343b42);
        this.grid.rotation.x = Math.PI / 2;
        this.grid.material.transparent = true;
        this.grid.material.opacity = 0.72;
        this.scene.add(this.grid);
        this.axes = new THREE.AxesHelper(50);
        this.scene.add(this.axes);
    }

    bindEvents() {
        window.addEventListener('resize', () => this.resize());
        window.addEventListener('beforeunload', (event) => {
            if (!this.dirty) return;
            event.preventDefault();
            event.returnValue = '';
        });
        window.addEventListener('pagehide', () => this.closeSessionWithBeacon());
        document.addEventListener('fullscreenchange', () => this.syncFullscreenButton());

        document.addEventListener('click', (event) => {
            const button = event.target.closest('[data-action]');
            if (!button) return;
            const action = button.dataset.action;
            if (action === 'start-receiver') this.startReceiver();
            if (action === 'stop-receiver') this.stopReceiver();
            if (action === 'fit-view') this.fitView();
            if (action === 'grid') this.toggleHelper(this.grid, button);
            if (action === 'axes') this.toggleHelper(this.axes, button);
            if (action === 'background') this.changeBackground();
            if (action === 'fullscreen') this.toggleFullscreen();
            if (action === 'reset-transform') this.resetSelectedTransform();
            if (action === 'delete-selected') this.deleteSelected();
            if (action === 'open-save') this.openSaveDialog();
            if (action === 'close-save') this.saveDialog.close();
            if (action === 'toggle-models') this.togglePanel('models');
            if (action === 'toggle-transform') this.togglePanel('transform');
            if (action === 'close-panels') this.closePanels();
            if (action === 'switch-mode') this.switchMode(button.dataset.workspaceMode);
            if (action === 'switch-presentation') {
                this.saveDialog.close();
                this.switchMode('presentation');
            }
        });

        this.renderer.domElement.addEventListener('pointerdown', (event) => {
            this.pointerDown = { x: event.clientX, y: event.clientY };
        });
        this.renderer.domElement.addEventListener('pointerup', (event) => this.selectFromCanvas(event));
        this.transformForm.addEventListener('input', (event) => this.applyTransformInput(event));
        this.transformForm.addEventListener('pointerdown', (event) => this.startTransformDrag(event));
        this.transformForm.addEventListener('pointermove', (event) => this.updateTransformDrag(event));
        this.transformForm.addEventListener('pointerup', (event) => this.finishTransformDrag(event));
        this.transformForm.addEventListener('pointercancel', () => { this.transformDrag = null; });
        this.saveForm.addEventListener('submit', (event) => {
            event.preventDefault();
            this.saveAssembly(false);
        });
        this.saveForm.addEventListener('change', (event) => {
            if (event.target === this.stepFormat) this.syncStepExport();
            if (event.target.name === 'step_item') this.updateStepSummary();
        });
    }

    async requestJson(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            headers: { Accept: 'application/json', ...(options.headers || {}) },
            ...options,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(payload.error || `请求失败 (${response.status})`);
            error.status = response.status;
            throw error;
        }
        return payload;
    }

    sessionUrl(suffix = '') {
        return `${this.config.sessionUrl}/${encodeURIComponent(this.sessionId)}${suffix}`;
    }

    async createSession() {
        try {
            const payload = await this.requestJson(this.config.sessionUrl, { method: 'POST' });
            this.sessionId = payload.session.id;
            this.pollTimer = window.setInterval(() => this.pollItems(), 1000);
            await this.pollItems();
            if (this.config.mainPort === this.config.receiverPort) {
                this.setReceiverStatus('error', '端口冲突');
                this.showError(`主服务器正在使用 ${this.config.receiverPort} 端口，无法启动 PCB 接收。`);
                document.getElementById('assembly-start-receiver').disabled = true;
            } else {
                this.notice.textContent = '启动接收后，从嘉立创执行 3D 导出。';
            }
        } catch (error) {
            this.showError(error.message);
        }
    }

    async startReceiver() {
        if (!this.sessionId || this.listening) return;
        this.clearError();
        const startButton = document.getElementById('assembly-start-receiver');
        startButton.disabled = true;
        this.setReceiverStatus('idle', '正在启动');
        try {
            await this.requestJson(this.sessionUrl('/receiver/start'), { method: 'POST' });
            this.listening = true;
            this.syncReceiverControls();
            this.setReceiverStatus('listening', `监听 ${this.config.receiverPort}`);
            this.notice.textContent = '接收器已就绪，可以连续从嘉立创导出多个 PCB。';
            this.heartbeatTimer = window.setInterval(() => this.sendHeartbeat(), 10000);
        } catch (error) {
            this.setReceiverStatus('error', '启动失败');
            this.showError(error.message);
        } finally {
            startButton.disabled = false;
        }
    }

    async stopReceiver() {
        if (!this.sessionId || !this.listening) return;
        try {
            await this.requestJson(this.sessionUrl('/receiver/stop'), { method: 'POST' });
        } catch (error) {
            this.showError(error.message);
        } finally {
            this.markReceiverStopped();
        }
    }

    async sendHeartbeat() {
        if (!this.listening) return;
        try {
            await this.requestJson(this.sessionUrl('/heartbeat'), { method: 'POST' });
        } catch (error) {
            this.markReceiverStopped();
            this.setReceiverStatus('error', '监听已停止');
            this.showError(error.message);
        }
    }

    markReceiverStopped() {
        this.listening = false;
        window.clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
        this.syncReceiverControls();
        this.setReceiverStatus('idle', '未监听');
        this.notice.textContent = this.items.size
            ? '接收已停止，可以继续调整模型或保存装配。'
            : '接收已停止。';
    }

    syncReceiverControls() {
        document.getElementById('assembly-start-receiver').hidden = this.listening;
        document.getElementById('assembly-stop-receiver').hidden = !this.listening;
    }

    setReceiverStatus(state, label) {
        this.status.className = `receiver-status receiver-status--${state}`;
        this.statusLabel.textContent = label;
    }

    async pollItems() {
        if (!this.sessionId || this.polling) return;
        this.polling = true;
        try {
            const payload = await this.requestJson(this.sessionUrl('/items'));
            const hasMissingItem = payload.items.some((item) => !this.items.has(item.id));
            if (payload.revision === this.revision && !hasMissingItem) return;
            this.revision = payload.revision;
            for (const item of payload.items) {
                if (!this.items.has(item.id)) await this.loadItem(item);
            }
        } catch (error) {
            if (!this.closed) this.showError(error.message);
        } finally {
            this.polling = false;
        }
    }

    async loadItem(itemData) {
        this.loading.hidden = false;
        this.loadingLabel.textContent = `正在加载 ${itemData.name}`;
        const placementRoot = new THREE.Group();
        placementRoot.name = itemData.name;
        placementRoot.userData.assemblyItemId = itemData.id;
        const contentRoot = new THREE.Group();
        placementRoot.add(contentRoot);

        try {
            for (const model of itemData.models) {
                const objLoader = new OBJLoader();
                if (model.mtl_url) {
                    const materialLoader = new MTLLoader();
                    const materialUrl = new URL(model.mtl_url, window.location.href);
                    materialLoader.setResourcePath(new URL('.', materialUrl).href);
                    const materials = await materialLoader.loadAsync(model.mtl_url);
                    materials.preload();
                    objLoader.setMaterials(materials);
                }
                const modelRoot = await objLoader.loadAsync(model.obj_url);
                contentRoot.add(modelRoot);
            }

            contentRoot.traverse((object) => {
                if (!object.isMesh) return;
                object.castShadow = true;
                object.receiveShadow = true;
                object.userData.assemblyItemId = itemData.id;
            });
            contentRoot.updateWorldMatrix(true, true);
            const box = new THREE.Box3().setFromObject(contentRoot);
            if (box.isEmpty()) throw new Error('模型中没有可显示的几何体');
            const center = box.getCenter(new THREE.Vector3());
            contentRoot.position.sub(center);

            this.assemblyRoot.add(placementRoot);
            const item = {
                ...itemData,
                placementRoot,
                contentRoot,
                initialPosition: new THREE.Vector3(),
                initialRotation: new THREE.Euler(),
            };
            this.items.set(itemData.id, item);
            this.appendModelRow(item);
            this.selectItem(itemData.id);
            this.updateModelCount();
            this.fitView();
            this.markAssemblyChanged();
            this.notice.textContent = `${itemData.name} 已加入装配，可继续接收或调整位置。`;
        } catch (error) {
            this.showError(`${itemData.name} 加载失败：${error.message}`);
        } finally {
            this.loading.hidden = true;
        }
    }

    appendModelRow(item) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'assembly-model-row';
        row.dataset.itemId = item.id;
        row.setAttribute('role', 'option');
        const icon = document.createElement('i');
        icon.className = 'fas fa-microchip';
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = item.name;
        const detail = document.createElement('span');
        detail.textContent = `${item.models.length} 个 OBJ · ${item.created_at.replace('T', ' ')}`;
        text.append(title, detail);
        row.append(icon, text);
        row.addEventListener('click', () => this.selectItem(item.id));
        this.modelList.appendChild(row);
        this.emptyState.hidden = true;
    }

    selectItem(itemId) {
        this.selectedId = this.items.has(itemId) ? itemId : null;
        this.modelList.querySelectorAll('.assembly-model-row').forEach((row) => {
            const selected = row.dataset.itemId === this.selectedId;
            row.classList.toggle('is-selected', selected);
            row.setAttribute('aria-selected', String(selected));
        });
        if (this.selectionHelper) {
            this.scene.remove(this.selectionHelper);
            this.selectionHelper.dispose();
            this.selectionHelper = null;
        }
        const item = this.items.get(this.selectedId);
        if (item) {
            this.selectionHelper = new THREE.BoxHelper(item.placementRoot, 0xf2c044);
            this.selectionHelper.material.depthTest = false;
            this.selectionHelper.renderOrder = 999;
            this.scene.add(this.selectionHelper);
        }
        this.syncTransformPanel();
    }

    syncTransformPanel() {
        const item = this.items.get(this.selectedId);
        this.selectedName.textContent = item ? item.name : '未选择模型';
        this.transformForm.querySelectorAll('fieldset').forEach((fieldset) => {
            fieldset.disabled = !item;
        });
        document.querySelector('[data-action="reset-transform"]').disabled = !item;
        document.querySelector('[data-action="delete-selected"]').disabled = !item;
        if (!item) return;
        const inputs = this.transformForm.querySelectorAll('[data-transform-kind]');
        inputs.forEach((input) => {
            const axis = input.dataset.axis;
            const value = input.dataset.transformKind === 'position'
                ? item.placementRoot.position[axis]
                : THREE.MathUtils.radToDeg(item.placementRoot.rotation[axis]);
            input.value = Number(value.toFixed(3));
        });
    }

    applyTransformInput(event) {
        const input = event.target.closest('[data-transform-kind]');
        const item = this.items.get(this.selectedId);
        if (!input || !item) return;
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        const axis = input.dataset.axis;
        if (input.dataset.transformKind === 'position') {
            item.placementRoot.position[axis] = value;
        } else {
            item.placementRoot.rotation[axis] = THREE.MathUtils.degToRad(value);
        }
        item.placementRoot.updateMatrixWorld(true);
        this.selectionHelper?.update();
        this.markAssemblyChanged();
    }

    startTransformDrag(event) {
        const input = event.target.closest('[data-transform-kind]');
        if (!input || input.disabled || event.button !== 0) return;
        this.transformDrag = {
            input,
            pointerId: event.pointerId,
            startX: event.clientX,
            startValue: Number(input.value) || 0,
            previousSteps: 0,
            dragged: false,
        };
        input.setPointerCapture?.(event.pointerId);
    }

    updateTransformDrag(event) {
        const drag = this.transformDrag;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - drag.startX;
        if (Math.abs(deltaX) > 3) drag.dragged = true;
        if (!drag.dragged) return;
        event.preventDefault();
        const steps = Math.round(deltaX / 4);
        if (steps === drag.previousSteps) return;
        drag.previousSteps = steps;
        drag.input.value = (drag.startValue + steps * 0.1).toFixed(1);
        this.applyTransformInput({ target: drag.input });
    }

    finishTransformDrag(event) {
        if (!this.transformDrag || this.transformDrag.pointerId !== event.pointerId) return;
        this.transformDrag = null;
    }

    resetSelectedTransform() {
        const item = this.items.get(this.selectedId);
        if (!item) return;
        item.placementRoot.position.copy(item.initialPosition);
        item.placementRoot.rotation.copy(item.initialRotation);
        item.placementRoot.updateMatrixWorld(true);
        this.selectionHelper?.update();
        this.syncTransformPanel();
        this.markAssemblyChanged();
    }

    async deleteSelected() {
        const item = this.items.get(this.selectedId);
        if (!item || !window.confirm(`从当前装配中删除“${item.name}”？`)) return;
        try {
            await this.requestJson(this.sessionUrl(`/items/${encodeURIComponent(item.id)}`), { method: 'DELETE' });
            this.assemblyRoot.remove(item.placementRoot);
            this.items.delete(item.id);
            this.modelList.querySelector(`[data-item-id="${CSS.escape(item.id)}"]`)?.remove();
            this.selectItem(null);
            this.emptyState.hidden = this.items.size > 0;
            this.updateModelCount();
            this.fitView();
            this.markAssemblyChanged();
        } catch (error) {
            this.showError(error.message);
        }
    }

    selectFromCanvas(event) {
        if (!this.pointerDown) return;
        const distance = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
        this.pointerDown = null;
        if (distance > 5) return;
        const bounds = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const intersections = this.raycaster.intersectObject(this.assemblyRoot, true);
        if (!intersections.length) {
            this.selectItem(null);
            return;
        }
        let object = intersections[0].object;
        while (object && !object.userData.assemblyItemId) object = object.parent;
        this.selectItem(object?.userData.assemblyItemId || null);
    }

    updateModelCount() {
        this.modelCount.textContent = `${this.items.size} 个模型`;
        this.syncSeparateExport();
        this.syncStepExport();
    }

    syncSeparateExport() {
        const available = this.items.size >= 2;
        if (!available) this.separateItems.checked = false;
        this.separateItems.disabled = !available;
        this.separateItemsHint.textContent = available
            ? `额外生成 ${this.items.size} 个顶层板子模型`
            : '至少接收两块板子后可用';
    }

    syncStepExport() {
        if (!this.stepSelection || !this.stepItems) return;
        const previous = new Map(
            Array.from(this.stepItems.querySelectorAll('input[name="step_item"]'), (input) => [input.value, input.checked]),
        );
        this.stepItems.replaceChildren();
        this.items.forEach((item) => {
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.name = 'step_item';
            input.value = item.id;
            input.checked = previous.has(item.id) ? previous.get(item.id) : true;
            const name = document.createElement('span');
            name.textContent = item.name;
            label.append(input, name);
            this.stepItems.appendChild(label);
        });
        this.stepSelection.hidden = !this.stepFormat?.checked;
        this.updateStepSummary();
    }

    updateStepSummary() {
        if (!this.stepSummary) return;
        const selected = this.stepItems.querySelectorAll('input[name="step_item"]:checked').length;
        this.stepSummary.textContent = `已选择 ${selected}/${this.items.size} 个顶层板子`;
    }

    markAssemblyChanged() {
        this.dirty = true;
        if (!this.savedReviewUrl) return;
        this.savedReviewUrl = null;
        this.presentationButton.disabled = true;
        this.presentationButton.title = '装配已更改，请重新保存 GLB';
        this.presentationFrame.hidden = true;
        this.presentationFrame.removeAttribute('src');
        this.presentationEmpty.hidden = false;
        if (this.currentMode === 'presentation') {
            this.switchMode('assembly', true);
            this.notice.textContent = '装配内容已变化，重新保存后可进入演示。';
        }
    }

    setPresentationAvailable(reviewUrl) {
        this.savedReviewUrl = reviewUrl;
        this.presentationButton.disabled = false;
        this.presentationButton.title = '进入高级审阅与演示';
    }

    switchMode(mode, force = false) {
        if (!['assembly', 'presentation'].includes(mode)) return;
        if (mode === 'presentation' && !this.savedReviewUrl && !force) {
            this.showError('请先保存当前装配，再进入演示模式。');
            return;
        }
        this.currentMode = mode;
        const isPresentation = mode === 'presentation';
        this.modeButtons.forEach((button) => {
            button.setAttribute('aria-pressed', String(button.dataset.workspaceMode === mode));
        });
        this.editor.hidden = isPresentation;
        this.presentation.hidden = !isPresentation;
        this.toolbarActions.hidden = isPresentation;
        document.body.classList.toggle('is-presentation-mode', isPresentation);
        this.modeDescription.textContent = isPresentation ? '高级审阅、评论与报告' : '临时接收与整体变换';
        this.closePanels();

        if (isPresentation) {
            const url = new URL(this.savedReviewUrl, window.location.href);
            url.searchParams.set('embed', '1');
            if (this.presentationFrame.src !== url.href) this.presentationFrame.src = url.href;
            this.presentationFrame.hidden = false;
            this.presentationEmpty.hidden = true;
        } else {
            window.requestAnimationFrame(() => this.resize());
        }
    }

    fitView() {
        const box = new THREE.Box3().setFromObject(this.assemblyRoot);
        const empty = box.isEmpty();
        const center = empty ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
        const size = empty ? new THREE.Vector3(120, 120, 30) : box.getSize(new THREE.Vector3());
        const radius = Math.max(size.length() * 0.55, 30);
        const direction = new THREE.Vector3(1.15, -1.15, 0.85).normalize();
        this.camera.position.copy(center).addScaledVector(direction, radius * 2.25);
        this.camera.near = Math.max(radius / 500, 0.01);
        this.camera.far = Math.max(radius * 40, 2000);
        this.camera.updateProjectionMatrix();
        this.controls.target.copy(center);
        this.controls.update();
    }

    setViewDirection(direction) {
        const distance = Math.max(this.camera.position.distanceTo(this.controls.target), 1);
        this.camera.up.set(0, 0, 1);
        if (Math.abs(direction.z) > 0.99) {
            this.camera.up.set(0, direction.z > 0 ? 1 : -1, 0);
        }
        this.camera.position.copy(this.controls.target).addScaledVector(direction, distance);
        this.camera.lookAt(this.controls.target);
        this.controls.update();
    }

    rotateViewFromCube(deltaX, deltaY) {
        const offset = this.camera.position.clone().sub(this.controls.target);
        const cameraUp = this.camera.up.clone().normalize();
        const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
        const yaw = new THREE.Quaternion().setFromAxisAngle(cameraUp, -deltaX * 0.012);
        const pitch = new THREE.Quaternion().setFromAxisAngle(cameraRight, -deltaY * 0.012);
        offset.applyQuaternion(yaw).applyQuaternion(pitch);
        this.camera.up.applyQuaternion(yaw).applyQuaternion(pitch).normalize();
        this.camera.position.copy(this.controls.target).add(offset);
        this.camera.lookAt(this.controls.target);
        this.controls.update();
    }

    changeBackground() {
        this.backgroundIndex = (this.backgroundIndex + 1) % BACKGROUNDS.length;
        this.scene.background.setHex(BACKGROUNDS[this.backgroundIndex]);
    }

    toggleHelper(helper, button) {
        helper.visible = !helper.visible;
        button.setAttribute('aria-pressed', String(helper.visible));
    }

    async toggleFullscreen() {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await document.documentElement.requestFullscreen();
    }

    syncFullscreenButton() {
        const button = document.querySelector('[data-action="fullscreen"]');
        button?.setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
        const icon = button?.querySelector('i');
        if (icon) icon.className = document.fullscreenElement ? 'fas fa-compress' : 'fas fa-expand';
    }

    openSaveDialog() {
        if (!this.items.size) {
            this.showError('至少接收一个 PCB 后才能保存装配。');
            return;
        }
        this.saveError.hidden = true;
        this.saveSuccess.hidden = true;
        this.saveProgress.hidden = true;
        this.syncSeparateExport();
        if (!this.saveName.value) this.saveName.value = this.defaultSaveName();
        this.saveDialog.showModal();
        this.saveName.focus();
        this.saveName.select();
    }

    defaultSaveName() {
        const now = new Date();
        const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
            .map((value, index) => index === 0 ? String(value) : String(value).padStart(2, '0'))
            .join('-');
        const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
        return `PCB装配_${date}_${time}`;
    }

    async saveAssembly(overwrite) {
        const filename = this.saveName.value.trim();
        if (!filename || !this.items.size) return;
        this.setSaveBusy(true);
        this.saveError.hidden = true;
        this.saveSuccess.hidden = true;
        try {
            this.saveProgressLabel.textContent = '正在生成完整装配';
            const arrayBuffer = await this.exportGlb(this.assemblyRoot);
            const formData = new FormData();
            formData.append('filename', filename);
            formData.append('overwrite', overwrite ? 'true' : 'false');
            const additionalFormats = Array.from(
                this.saveForm.querySelectorAll('input[name="additional_format"]:checked'),
                (input) => input.value,
            );
            formData.append('additional_formats', JSON.stringify(additionalFormats));
            formData.append('model_glb', new Blob([arrayBuffer], { type: 'model/gltf-binary' }), 'assembly.glb');
            const stepItemIds = [];
            if (additionalFormats.includes('step')) {
                const selectedIds = Array.from(
                    this.stepItems.querySelectorAll('input[name="step_item"]:checked'),
                    (input) => input.value,
                );
                if (!selectedIds.length) throw new Error('请至少选择一个要写入 STEP 的顶层板子。');
                for (let index = 0; index < selectedIds.length; index += 1) {
                    const item = this.items.get(selectedIds[index]);
                    if (!item) continue;
                    this.saveProgressLabel.textContent = `正在准备 STEP 零件 ${index + 1}/${selectedIds.length}`;
                    const itemBuffer = await this.exportGlb(item.placementRoot);
                    stepItemIds.push(item.id);
                    formData.append(
                        `step_model_${index}`,
                        new Blob([itemBuffer], { type: 'model/gltf-binary' }),
                        `step-part-${index + 1}.glb`,
                    );
                }
            }
            formData.append('step_item_ids', JSON.stringify(stepItemIds));
            const separateItemIds = [];
            if (this.separateItems.checked && this.items.size >= 2) {
                let index = 0;
                for (const item of this.items.values()) {
                    this.saveProgressLabel.textContent = `正在生成单独板子 ${index + 1}/${this.items.size}`;
                    const itemBuffer = await this.exportGlb(item.placementRoot, true);
                    separateItemIds.push(item.id);
                    formData.append(
                        `separate_model_${index}`,
                        new Blob([itemBuffer], { type: 'model/gltf-binary' }),
                        `board-${index + 1}.glb`,
                    );
                    index += 1;
                }
            }
            formData.append('separate_item_ids', JSON.stringify(separateItemIds));
            this.saveProgressLabel.textContent = '正在保存模型文件';
            const response = await fetch(this.sessionUrl('/save'), {
                method: 'POST',
                body: formData,
                credentials: 'same-origin',
                headers: { Accept: 'application/json' },
            });
            const payload = await response.json().catch(() => ({}));
            if (response.status === 409 && !overwrite) {
                this.setSaveBusy(false);
                if (window.confirm(payload.error || '同名文件已经存在，是否覆盖？')) {
                    await this.saveAssembly(true);
                }
                return;
            }
            if (!response.ok) throw new Error(payload.error || `保存失败 (${response.status})`);
            this.dirty = false;
            this.saveResult.textContent = (payload.files || [{ filename: payload.filename }])
                .map((item) => item.filename)
                .join('、');
            this.setPresentationAvailable(payload.review_url);
            this.saveSuccess.hidden = false;
        } catch (error) {
            this.saveError.textContent = error.message;
            this.saveError.hidden = false;
        } finally {
            this.setSaveBusy(false);
        }
    }

    async exportGlb(sourceRoot, centerPlacement = false) {
        const exporter = new GLTFExporter();
        const wrapper = new THREE.Group();
        const exportRoot = sourceRoot.clone(true);
        if (centerPlacement) exportRoot.position.set(0, 0, 0);
        wrapper.add(exportRoot);
        wrapper.rotation.x = -Math.PI / 2;
        wrapper.updateMatrixWorld(true);
        return exporter.parseAsync(wrapper, {
            binary: true,
            onlyVisible: true,
            maxTextureSize: 4096,
        });
    }

    setSaveBusy(busy) {
        this.saveProgress.hidden = !busy;
        this.saveForm.querySelectorAll('button, input').forEach((control) => {
            control.disabled = busy;
        });
        if (!busy) {
            this.saveProgressLabel.textContent = '正在生成并保存模型';
            this.syncSeparateExport();
            this.syncStepExport();
        }
    }

    togglePanel(panel) {
        document.body.classList.toggle(`is-${panel}-panel-open`);
        document.body.classList.remove(`is-${panel === 'models' ? 'transform' : 'models'}-panel-open`);
    }

    closePanels() {
        document.body.classList.remove('is-models-panel-open', 'is-transform-panel-open');
    }

    showError(message) {
        this.errorElement.textContent = message;
        this.errorElement.hidden = false;
    }

    clearError() {
        this.errorElement.hidden = true;
        this.errorElement.textContent = '';
    }

    closeSessionWithBeacon() {
        if (this.closed || !this.sessionId) return;
        this.closed = true;
        window.clearInterval(this.pollTimer);
        window.clearInterval(this.heartbeatTimer);
        navigator.sendBeacon(this.sessionUrl('/close'), new Blob([], { type: 'application/octet-stream' }));
    }

    resize() {
        const width = Math.max(this.canvasContainer.clientWidth, 1);
        const height = Math.max(this.canvasContainer.clientHeight, 1);
        this.renderer.setSize(width, height, false);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.selectionHelper?.update();
        this.viewCube.update();
        this.renderer.render(this.scene, this.camera);
    }
}

new PcbAssemblyWorkspace(config);
