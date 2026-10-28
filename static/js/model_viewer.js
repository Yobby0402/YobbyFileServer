import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/GLTFLoader.js';
import { OBJLoader } from 'three/addons/OBJLoader.js';
import { STLLoader } from 'three/addons/STLLoader.js';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { ModelAnnotationsController } from './model_annotations.js';
import { ModelReportExportController } from './model_report_export.js';
import { ModelFileExportController } from './model_file_export.js';
import { ViewCube } from './view_cube.js';

const config = JSON.parse(document.getElementById('model-viewer-config').textContent);
const BACKGROUNDS = [0x17191d, 0x30343a, 0xf0f1f3, 0x0b0c0e];

class ModelViewer {
    constructor(viewerConfig) {
        this.config = viewerConfig;
        this.stage = document.getElementById('model-stage');
        this.container = document.getElementById('canvas-container');
        this.loading = document.getElementById('loading');
        this.loadingLabel = document.getElementById('loading-label');
        this.errorElement = document.getElementById('error-message');
        this.partTree = document.getElementById('part-tree');
        this.partsMessage = document.getElementById('parts-message');
        this.explodeSlider = document.getElementById('explode-slider');
        this.explodeValue = document.getElementById('explode-value');
        this.statsElement = document.getElementById('model-stats');

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(BACKGROUNDS[0]);
        this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10000);
        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.renderer.shadowMap.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.screenSpacePanning = true;
        this.controls.enableRotate = false;

        this.displayRoot = new THREE.Group();
        this.displayRoot.name = 'ReviewDisplayRoot';
        this.scene.add(this.displayRoot);

        this.modelRoot = null;
        this.modelSize = new THREE.Vector3(1, 1, 1);
        this.modelDiagonal = 1;
        this.resetRootPosition = new THREE.Vector3();
        this.parts = [];
        this.partByPath = new Map();
        this.explosionUnits = [];
        this.explosionPercent = 0;
        this.selectedPartPath = null;
        this.selectionHelper = null;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.pointerDown = null;
        this.rotationDrag = null;
        this.backgroundIndex = 0;
        this.wireframe = false;
        this.autoRotate = false;
        this.placementActive = false;
        this.focusTween = null;
        this.annotations = null;
        this.reportExport = null;
        this.fileExport = null;

        this.setupScene();
        this.viewCube = new ViewCube(document.getElementById('model-view-cube'), {
            labels: { px: '右', nx: '左', py: '上', ny: '下', pz: '前', nz: '后' },
            getOrientation: () => this.camera.quaternion.clone().invert().multiply(this.displayRoot.quaternion),
            onView: (direction) => this.setViewDirection(direction),
            onDrag: (deltaX, deltaY) => this.rotateViewFromCube(deltaX, deltaY),
        });
        this.bindEvents();
        this.resize();

        if (config.mode === 'review' && config.capabilities.annotations) {
            this.annotations = new ModelAnnotationsController(this, config);
        }
        if (config.mode === 'review') {
            this.reportExport = new ModelReportExportController(this, config);
            this.fileExport = new ModelFileExportController(this, config);
        }
    }

    setupScene() {
        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4a515c, 1.7));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
        keyLight.position.set(5, 8, 7);
        keyLight.castShadow = true;
        this.scene.add(keyLight);
        const fillLight = new THREE.DirectionalLight(0x9ecbff, 1.0);
        fillLight.position.set(-6, 1, -4);
        this.scene.add(fillLight);

        this.gridHelper = new THREE.GridHelper(10, 20, 0x69717c, 0x3e444c);
        this.gridHelper.visible = false;
        this.scene.add(this.gridHelper);
        this.axesHelper = new THREE.AxesHelper(2);
        this.axesHelper.visible = false;
        this.scene.add(this.axesHelper);
    }

    bindEvents() {
        window.addEventListener('resize', () => this.resize());
        this.renderer.domElement.addEventListener('pointerdown', (event) => {
            this.pointerDown = { x: event.clientX, y: event.clientY, button: event.button, moved: false };
            if (event.button === 0 && !this.placementActive && this.modelRoot) {
                this.startFreeRotation(event);
            }
        });
        this.renderer.domElement.addEventListener('pointermove', (event) => this.updateFreeRotation(event));
        this.renderer.domElement.addEventListener('pointerup', (event) => this.handleCanvasPointerUp(event));
        this.renderer.domElement.addEventListener('pointercancel', () => { this.rotationDrag = null; });
        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') this.closeMobilePanels();
        });

        document.addEventListener('click', (event) => {
            const action = event.target.closest('[data-action]')?.dataset.action;
            if (!action) return;
            if (action === 'reset-view') this.resetView();
            if (action === 'wireframe') this.toggleWireframe(event.target.closest('button'));
            if (action === 'grid') this.toggleHelper(this.gridHelper, event.target.closest('button'));
            if (action === 'axes') this.toggleHelper(this.axesHelper, event.target.closest('button'));
            if (action === 'background') this.changeBackground();
            if (action === 'auto-rotate') this.toggleAutoRotate(event.target.closest('button'));
            if (action === 'open-review') window.open(this.config.reviewUrl, '_blank', 'noopener');
            if (action === 'back') this.navigateBack();
            if (action === 'fullscreen') this.toggleFullscreen();
            if (action === 'show-all-parts') this.showAllParts();
            if (action === 'toggle-parts') this.toggleMobilePanel('parts');
            if (action === 'toggle-comments') this.toggleMobilePanel('comments');
            if (action === 'close-panels') this.closeMobilePanels();
        });

        this.explodeSlider?.addEventListener('input', () => this.setExplosion(Number(this.explodeSlider.value)));
        document.addEventListener('fullscreenchange', () => this.syncFullscreenButton());
    }

    async load() {
        const extension = this.config.fileExt.toLowerCase();
        if (!this.config.capabilities.loadable) {
            this.showError('该格式暂不支持在浏览器中直接加载。请在 Blender、FreeCAD 或其他 CAD 工具中转换为单文件 GLB 后再审阅。');
            return;
        }

        try {
            let root;
            if (extension === '.gltf' || extension === '.glb') {
                const gltf = await new GLTFLoader().loadAsync(this.config.modelUrl, (event) => this.showProgress(event));
                root = gltf.scene;
            } else if (extension === '.obj') {
                root = await new OBJLoader().loadAsync(this.config.modelUrl, (event) => this.showProgress(event));
            } else if (extension === '.stl') {
                const geometry = await new STLLoader().loadAsync(this.config.modelUrl, (event) => this.showProgress(event));
                geometry.computeVertexNormals();
                root = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x8caaa0, roughness: 0.62, metalness: 0.08 }));
                root.name = this.config.filename.replace(/\.[^.]+$/, '') || 'STL 模型';
            }
            this.onModelLoaded(root);
        } catch (error) {
            console.error('Model load failed:', error);
            this.showError(`模型加载失败：${error.message || '无法读取模型资源'}`);
        }
    }

    showProgress(event) {
        if (!event.total) return;
        const percent = Math.min(100, Math.round(event.loaded / event.total * 100));
        this.loadingLabel.textContent = `正在加载模型 ${percent}%`;
    }

    onModelLoaded(root) {
        this.modelRoot = root;
        root.traverse((object) => {
            if (!object.isMesh) return;
            object.castShadow = true;
            object.receiveShadow = true;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.filter(Boolean).forEach((material) => {
                material.side = THREE.FrontSide;
            });
        });
        this.displayRoot.add(root);
        root.updateWorldMatrix(true, true);

        const sourceBox = new THREE.Box3().setFromObject(root);
        if (sourceBox.isEmpty()) {
            this.showError('模型中没有可显示的几何体。');
            return;
        }
        const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
        this.modelSize = sourceBox.getSize(new THREE.Vector3());
        this.modelDiagonal = Math.max(this.modelSize.length(), 0.001);
        this.displayRoot.position.copy(sourceCenter).multiplyScalar(-1);
        this.resetRootPosition.copy(this.displayRoot.position);
        this.displayRoot.updateWorldMatrix(true, true);

        this.rebuildHelpers();
        this.buildParts();
        this.configureExplosion();
        this.resetView();
        this.updateStats();
        this.loading.hidden = true;
        this.annotations?.load();
    }

    rebuildHelpers() {
        this.scene.remove(this.gridHelper, this.axesHelper);
        const helperSize = Math.max(this.modelSize.x, this.modelSize.z, 1) * 2.2;
        this.gridHelper = new THREE.GridHelper(helperSize, 20, 0x69717c, 0x3e444c);
        this.gridHelper.visible = false;
        this.gridHelper.position.y = -this.modelSize.y / 2;
        this.scene.add(this.gridHelper);
        this.axesHelper = new THREE.AxesHelper(Math.max(this.modelDiagonal * 0.28, 0.5));
        this.axesHelper.visible = false;
        this.scene.add(this.axesHelper);
    }

    updateStats() {
        let triangles = 0;
        this.modelRoot.traverse((object) => {
            if (!object.isMesh || !object.geometry?.attributes?.position) return;
            triangles += object.geometry.index ? object.geometry.index.count / 3 : object.geometry.attributes.position.count / 3;
        });
        if (this.statsElement) {
            this.statsElement.textContent = `${Math.round(triangles).toLocaleString()} 个三角面 · ${this.modelSize.x.toFixed(2)} × ${this.modelSize.y.toFixed(2)} × ${this.modelSize.z.toFixed(2)}`;
        }
    }

    buildParts() {
        this.parts = [];
        this.partByPath.clear();
        let fallbackIndex = 0;
        const containsMesh = (object) => {
            let result = false;
            object.traverse((child) => { if (child.isMesh) result = true; });
            return result;
        };

        const visit = (object, parentItem, siblingIndex) => {
            if (!containsMesh(object)) return null;
            const fallbackName = object.isMesh ? `零件 ${++fallbackIndex}` : `组件 ${++fallbackIndex}`;
            const name = String(object.name || fallbackName).trim() || fallbackName;
            const safeName = name.replaceAll('/', '∕');
            const path = parentItem ? `${parentItem.path}/${safeName}#${siblingIndex}` : `${safeName}#${siblingIndex}`;
            const item = {
                object,
                name,
                path,
                parent: parentItem,
                children: [],
                collapsed: false,
                lockedToParent: true,
                restPosition: object.position.clone(),
            };
            object.userData.modelReviewPartPath = path;
            this.parts.push(item);
            this.partByPath.set(path, item);
            object.children.filter(containsMesh).forEach((child, index) => {
                const childItem = visit(child, item, index);
                if (childItem) item.children.push(childItem);
            });
            return item;
        };

        const roots = this.modelRoot.isMesh ? [this.modelRoot] : this.modelRoot.children.filter(containsMesh);
        roots.forEach((object, index) => visit(object, null, index));
        if (!roots.length && containsMesh(this.modelRoot)) visit(this.modelRoot, null, 0);
        this.renderPartTree();
    }

    renderPartTree() {
        if (!this.partTree) return;
        this.partTree.replaceChildren();
        const roots = this.parts.filter((item) => !item.parent);
        roots.forEach((item) => this.appendPartRow(item, 0));
        if (!this.parts.length) {
            this.partsMessage.textContent = '未识别到可控制零件';
        } else if (this.config.fileExt === '.obj') {
            this.partsMessage.textContent = `已尽量识别 ${this.parts.length} 个 OBJ 分组`;
        } else {
            this.partsMessage.textContent = `已识别 ${this.parts.length} 个节点`;
        }
    }

    appendPartRow(item, depth) {
        const row = document.createElement('div');
        row.className = 'part-row';
        row.style.setProperty('--part-depth', String(depth));
        row.classList.toggle('is-selected', item.path === this.selectedPartPath);
        row.classList.toggle('is-hidden', !this.isObjectVisible(item.object));
        row.setAttribute('role', 'treeitem');

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'part-row__toggle';
        toggle.disabled = item.children.length === 0;
        toggle.title = item.collapsed ? '展开' : '折叠';
        toggle.innerHTML = `<i class="fas fa-caret-${item.collapsed ? 'right' : 'down'}" aria-hidden="true"></i>`;
        toggle.addEventListener('click', () => {
            item.collapsed = !item.collapsed;
            this.renderPartTree();
        });

        const select = document.createElement('button');
        select.type = 'button';
        select.className = 'part-row__select';
        select.textContent = item.name;
        select.title = item.name;
        select.addEventListener('click', () => this.selectPart(item));

        const lockState = item.parent ? (item.lockedToParent ? 'locked' : 'unlocked') : this.rootLockState(item);
        const lock = document.createElement('button');
        lock.type = 'button';
        lock.className = `part-row__lock is-${lockState}`;
        lock.title = item.parent
            ? (item.lockedToParent ? '与父级一起爆炸' : '作为独立爆炸组')
            : (lockState === 'locked' ? '解锁整组零件' : '锁定整组零件');
        lock.setAttribute('aria-label', lock.title);
        lock.setAttribute('aria-pressed', String(lockState === 'locked'));
        lock.innerHTML = `<i class="fas fa-${lockState === 'locked' ? 'lock' : lockState === 'mixed' ? 'minus-square' : 'lock-open'}" aria-hidden="true"></i>`;
        lock.disabled = !item.parent && !this.descendantParts(item).length;
        lock.addEventListener('click', () => this.togglePartLock(item));

        const visibility = document.createElement('button');
        visibility.type = 'button';
        visibility.className = 'part-row__visibility';
        visibility.title = item.object.visible ? '隐藏零件' : '显示零件';
        visibility.setAttribute('aria-label', visibility.title);
        visibility.innerHTML = `<i class="fas fa-${item.object.visible ? 'eye' : 'eye-slash'}" aria-hidden="true"></i>`;
        visibility.addEventListener('click', () => {
            item.object.visible = !item.object.visible;
            if (!item.object.visible && this.selectedPartPath === item.path) this.clearPartSelection();
            this.renderPartTree();
            this.annotations?.syncListVisibility();
        });

        row.append(toggle, select, lock, visibility);
        this.partTree.appendChild(row);
        if (!item.collapsed) item.children.forEach((child) => this.appendPartRow(child, depth + 1));
    }

    selectPart(item) {
        this.selectedPartPath = item.path;
        if (this.selectionHelper) this.scene.remove(this.selectionHelper);
        this.selectionHelper = new THREE.BoxHelper(item.object, 0xf2b84b);
        this.scene.add(this.selectionHelper);
        this.renderPartTree();
    }

    clearPartSelection() {
        this.selectedPartPath = null;
        if (this.selectionHelper) this.scene.remove(this.selectionHelper);
        this.selectionHelper = null;
        this.renderPartTree();
    }

    showAllParts() {
        this.parts.forEach((item) => { item.object.visible = true; });
        this.renderPartTree();
        this.annotations?.syncListVisibility();
    }

    descendantParts(item) {
        const descendants = [];
        const visit = (node) => {
            node.children.forEach((child) => {
                descendants.push(child);
                visit(child);
            });
        };
        visit(item);
        return descendants;
    }

    rootLockState(item) {
        const descendants = this.descendantParts(item);
        if (!descendants.length || descendants.every((child) => child.lockedToParent)) return 'locked';
        if (descendants.every((child) => !child.lockedToParent)) return 'unlocked';
        return 'mixed';
    }

    togglePartLock(item) {
        if (item.parent) {
            item.lockedToParent = !item.lockedToParent;
        } else {
            const descendants = this.descendantParts(item);
            const nextLocked = this.rootLockState(item) !== 'locked';
            descendants.forEach((child) => { child.lockedToParent = nextLocked; });
        }
        this.configureExplosion(true);
        this.renderPartTree();
    }

    explosionAnchor(item) {
        let splitAnchor = null;
        let current = item;
        while (current.parent) {
            if (!current.lockedToParent && !splitAnchor) splitAnchor = current;
            current = current.parent;
        }
        return splitAnchor || current;
    }

    restoreExplosionPositions() {
        this.parts.forEach((item) => {
            if (!item.children.length && containsRenderableMesh(item.object)) {
                item.object.position.copy(item.restPosition);
            }
        });
        this.displayRoot.updateWorldMatrix(true, true);
    }

    configureExplosion(preserveValue = false) {
        const previousPercent = preserveValue ? this.explosionPercent : 0;
        this.restoreExplosionPositions();
        const leaves = this.parts.filter((item) => item.children.length === 0 && containsRenderableMesh(item.object));
        const groups = new Map();
        leaves.forEach((item) => {
            const anchor = this.explosionAnchor(item);
            if (!groups.has(anchor.path)) groups.set(anchor.path, { anchor, members: [] });
            groups.get(anchor.path).members.push(item);
        });

        this.displayRoot.updateWorldMatrix(true, true);
        const assemblyCenter = new THREE.Box3().setFromObject(this.modelRoot).getCenter(new THREE.Vector3());
        this.explosionUnits = Array.from(groups.values()).filter((group) => group.members.length).map((group, index) => {
            const box = new THREE.Box3();
            group.members.forEach((item) => box.union(new THREE.Box3().setFromObject(item.object)));
            const center = box.getCenter(new THREE.Vector3());
            const directionWorld = center.clone().sub(assemblyCenter);
            if (directionWorld.lengthSq() < 1e-10) {
                directionWorld.set(index % 3 === 0 ? 1 : 0, index % 3 === 1 ? 1 : 0, index % 3 === 2 ? 1 : 0);
            }
            directionWorld.normalize();
            return {
                anchor: group.anchor,
                members: group.members.map((item) => {
                    const parentQuaternion = item.object.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
                    return { item, direction: directionWorld.clone().applyQuaternion(parentQuaternion).normalize() };
                }),
            };
        });
        const enabled = Boolean(this.config.capabilities.explode && this.explosionUnits.length >= 2);
        if (this.explodeSlider) this.explodeSlider.disabled = !enabled;
        if (!enabled && this.partsMessage) {
            this.partsMessage.textContent += ' · 当前模型不支持爆炸视图';
        }
        this.setExplosion(enabled ? previousPercent : 0);
    }

    setExplosion(value) {
        if (!this.explodeSlider || this.explodeSlider.disabled) value = 0;
        const percent = Math.max(0, Math.min(100, Number(value) || 0));
        const factor = percent / 100;
        const maxOffset = this.modelDiagonal * 0.36;
        this.explosionUnits.forEach((unit) => {
            unit.members.forEach(({ item, direction }) => {
                item.object.position.copy(item.restPosition).addScaledVector(direction, maxOffset * factor);
            });
        });
        this.explosionPercent = percent;
        if (this.explodeSlider) this.explodeSlider.value = String(percent);
        if (this.explodeValue) this.explodeValue.textContent = `${Math.round(percent)}%`;
        this.displayRoot.updateWorldMatrix(true, true);
        this.selectionHelper?.update();
        this.annotations?.setExploded(percent > 0);
    }

    handleCanvasPointerUp(event) {
        if (!this.pointerDown) return;
        const pointerDown = this.pointerDown;
        const distance = pointerDown.moved ? Infinity : Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
        this.pointerDown = null;
        this.rotationDrag = null;
        if (pointerDown.button !== 0 || distance > 5 || !this.modelRoot) return;

        const hit = this.pickSurface(event.clientX, event.clientY);
        if (this.placementActive) {
            if (hit) this.annotations?.handleSurfacePick(this.anchorFromHit(hit));
            return;
        }
        if (this.config.mode === 'review' && hit) {
            const item = this.partForObject(hit.object);
            if (item) this.selectPart(item);
        } else if (this.config.mode === 'review') {
            this.clearPartSelection();
            this.annotations?.clearSelection();
        }
    }

    startFreeRotation(event) {
        this.focusTween = null;
        this.controls.enabled = true;
        this.renderer.domElement.setPointerCapture?.(event.pointerId);
        this.displayRoot.updateWorldMatrix(true, false);
        this.rotationDrag = {
            pointerId: event.pointerId,
            previousVector: this.arcballVector(event.clientX, event.clientY),
            pivotWorld: this.controls.target.clone(),
            pivotLocal: this.displayRoot.worldToLocal(this.controls.target.clone()),
        };
    }

    updateFreeRotation(event) {
        const drag = this.rotationDrag;
        if (!drag || drag.pointerId !== event.pointerId || (event.buttons & 1) === 0) return;
        if (this.pointerDown && Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) > 5) {
            this.pointerDown.moved = true;
        }
        const currentVector = this.arcballVector(event.clientX, event.clientY);
        const axisCamera = drag.previousVector.clone().cross(currentVector);
        const axisLength = axisCamera.length();
        if (axisLength > 1e-6) {
            const angle = Math.acos(THREE.MathUtils.clamp(drag.previousVector.dot(currentVector), -1, 1));
            const axisWorld = axisCamera.normalize().applyQuaternion(this.camera.quaternion).normalize();
            const delta = new THREE.Quaternion().setFromAxisAngle(axisWorld, angle * 1.15);
            this.displayRoot.quaternion.premultiply(delta).normalize();
            const rotatedPivot = drag.pivotLocal.clone().applyQuaternion(this.displayRoot.quaternion);
            this.displayRoot.position.copy(drag.pivotWorld).sub(rotatedPivot);
            this.displayRoot.updateWorldMatrix(true, true);
            drag.previousVector.copy(currentVector);
        }
    }

    arcballVector(clientX, clientY) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const scale = Math.max(Math.min(rect.width, rect.height), 1);
        const vector = new THREE.Vector3(
            (2 * (clientX - rect.left) - rect.width) / scale,
            (rect.height - 2 * (clientY - rect.top)) / scale,
            0,
        );
        const lengthSquared = vector.x * vector.x + vector.y * vector.y;
        if (lengthSquared <= 1) {
            vector.z = Math.sqrt(1 - lengthSquared);
        } else {
            vector.normalize();
        }
        return vector;
    }

    pickSurface(clientX, clientY) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        return this.raycaster.intersectObjects(this.visibleMeshes(), false)[0] || null;
    }

    anchorFromHit(hit) {
        const modelPoint = this.displayRoot.worldToLocal(hit.point.clone());
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
        const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
        const rootQuaternion = this.displayRoot.getWorldQuaternion(new THREE.Quaternion()).invert();
        const modelNormal = worldNormal.applyQuaternion(rootQuaternion).normalize();
        const part = this.partForObject(hit.object);
        return {
            position: modelPoint.toArray(),
            normal: modelNormal.toArray(),
            surface_part_path: part?.path || null,
        };
    }

    visibleMeshes() {
        const meshes = [];
        this.modelRoot.traverse((object) => {
            if (object.isMesh && this.isObjectVisible(object)) meshes.push(object);
        });
        return meshes;
    }

    isObjectVisible(object) {
        let current = object;
        while (current && current !== this.scene) {
            if (!current.visible) return false;
            current = current.parent;
        }
        return true;
    }

    partForObject(object) {
        let current = object;
        while (current && current !== this.modelRoot.parent) {
            const path = current.userData.modelReviewPartPath;
            if (path && this.partByPath.has(path)) return this.partByPath.get(path);
            current = current.parent;
        }
        return null;
    }

    isPartVisible(path) {
        const item = this.partByPath.get(path);
        return item ? this.isObjectVisible(item.object) : true;
    }

    isModelReady() {
        return Boolean(this.modelRoot);
    }

    getCamera() {
        return this.camera;
    }

    getStageSize() {
        return { width: this.stage.clientWidth, height: this.stage.clientHeight };
    }

    modelToWorldPoint(position) {
        return this.displayRoot.localToWorld(new THREE.Vector3().fromArray(position));
    }

    annotationToWorldPoint(annotation) {
        const worldPoint = this.modelToWorldPoint(annotation.position);
        const item = annotation.surface_part_path ? this.partByPath.get(annotation.surface_part_path) : null;
        if (!item?.object.parent) return worldPoint;
        const localOffset = item.object.position.clone().sub(item.restPosition);
        const parentTransform = new THREE.Matrix3().setFromMatrix4(item.object.parent.matrixWorld);
        return worldPoint.add(localOffset.applyMatrix3(parentTransform));
    }

    modelToWorldNormal(normal) {
        return new THREE.Vector3().fromArray(normal).applyQuaternion(this.displayRoot.getWorldQuaternion(new THREE.Quaternion())).normalize();
    }

    focusAnnotation(annotation) {
        if (!this.modelRoot) return;
        const anchorWorld = this.annotationToWorldPoint(annotation);
        const localAnchor = this.displayRoot.worldToLocal(anchorWorld.clone());
        const normalWorld = this.modelToWorldNormal(annotation.normal);
        const towardCamera = this.camera.position.clone().sub(anchorWorld).normalize();
        if (normalWorld.lengthSq() < 1e-10 || towardCamera.lengthSq() < 1e-10) return;

        const startQuaternion = this.displayRoot.quaternion.clone();
        const delta = new THREE.Quaternion().setFromUnitVectors(normalWorld, towardCamera);
        const targetQuaternion = delta.multiply(startQuaternion).normalize();
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const duration = reducedMotion ? 0 : 450;
        this.controls.enabled = false;
        this.focusTween = {
            startedAt: performance.now(),
            duration,
            localAnchor,
            startQuaternion,
            targetQuaternion,
            anchorWorld,
        };
        if (!duration) this.updateFocusTween(performance.now());
    }

    updateFocusTween(now) {
        if (!this.focusTween) return;
        const tween = this.focusTween;
        const progress = tween.duration ? Math.min(1, (now - tween.startedAt) / tween.duration) : 1;
        const eased = 1 - Math.pow(1 - progress, 3);
        this.displayRoot.quaternion.slerpQuaternions(tween.startQuaternion, tween.targetQuaternion, eased);
        const rotatedAnchor = tween.localAnchor.clone().applyQuaternion(this.displayRoot.quaternion);
        this.displayRoot.position.copy(tween.anchorWorld).sub(rotatedAnchor);
        if (progress >= 1) {
            this.controls.target.copy(tween.anchorWorld);
            this.controls.enabled = true;
            this.controls.update();
            this.focusTween = null;
        }
    }

    resetView() {
        if (!this.modelRoot) return;
        this.focusTween = null;
        this.controls.enabled = true;
        this.displayRoot.position.copy(this.resetRootPosition);
        this.displayRoot.quaternion.identity();
        this.displayRoot.updateWorldMatrix(true, true);
        const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
        const fitFov = Math.max(Math.min(verticalFov, horizontalFov), THREE.MathUtils.degToRad(5));
        const distance = Math.max((this.modelDiagonal / 2) / Math.sin(fitFov / 2) * 1.2, 1);
        this.camera.position.copy(new THREE.Vector3(1, 0.72, 1).normalize().multiplyScalar(distance));
        this.camera.up.set(0, 1, 0);
        this.camera.near = Math.max(distance / 1000, 0.001);
        this.camera.far = Math.max(distance * 100, 100);
        this.camera.updateProjectionMatrix();
        this.controls.target.set(0, 0, 0);
        this.controls.minDistance = Math.max(this.modelDiagonal * 0.05, 0.01);
        this.controls.maxDistance = Math.max(this.modelDiagonal * 20, 10);
        this.controls.update();
    }

    setViewDirection(direction) {
        if (!this.modelRoot) return;
        this.focusTween = null;
        this.controls.enabled = true;
        const distance = Math.max(this.camera.position.distanceTo(this.controls.target), 1);
        this.displayRoot.position.copy(this.resetRootPosition);
        this.displayRoot.quaternion.identity();
        this.controls.target.set(0, 0, 0);
        this.camera.up.set(0, 1, 0);
        if (Math.abs(direction.y) > 0.99) {
            this.camera.up.set(0, 0, direction.y > 0 ? -1 : 1);
        }
        this.camera.position.copy(direction).multiplyScalar(distance);
        this.camera.lookAt(this.controls.target);
        this.controls.update();
        this.displayRoot.updateWorldMatrix(true, true);
    }

    rotateViewFromCube(deltaX, deltaY) {
        if (!this.modelRoot) return;
        this.focusTween = null;
        const pivotWorld = this.controls.target.clone();
        const pivotLocal = this.displayRoot.worldToLocal(pivotWorld.clone());
        const cameraUp = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).normalize();
        const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
        const yaw = new THREE.Quaternion().setFromAxisAngle(cameraUp, deltaX * 0.012);
        const pitch = new THREE.Quaternion().setFromAxisAngle(cameraRight, deltaY * 0.012);
        this.displayRoot.quaternion.premultiply(yaw).premultiply(pitch).normalize();
        const rotatedPivot = pivotLocal.applyQuaternion(this.displayRoot.quaternion);
        this.displayRoot.position.copy(pivotWorld).sub(rotatedPivot);
        this.displayRoot.updateWorldMatrix(true, true);
    }

    toggleWireframe(button) {
        if (!this.modelRoot) return;
        this.wireframe = !this.wireframe;
        this.modelRoot.traverse((object) => {
            if (!object.isMesh) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.filter(Boolean).forEach((material) => {
                material.wireframe = this.wireframe;
                material.needsUpdate = true;
            });
        });
        button?.setAttribute('aria-pressed', String(this.wireframe));
    }

    toggleHelper(helper, button) {
        helper.visible = !helper.visible;
        button?.setAttribute('aria-pressed', String(helper.visible));
    }

    changeBackground() {
        this.backgroundIndex = (this.backgroundIndex + 1) % BACKGROUNDS.length;
        this.scene.background.setHex(BACKGROUNDS[this.backgroundIndex]);
    }

    toggleAutoRotate(button) {
        this.autoRotate = !this.autoRotate;
        button?.setAttribute('aria-pressed', String(this.autoRotate));
    }

    async toggleFullscreen() {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                await document.documentElement.requestFullscreen();
            }
        } catch (error) {
            console.warn('Fullscreen request was rejected:', error);
        }
    }

    navigateBack() {
        let sameOriginReferrer = false;
        try {
            sameOriginReferrer = Boolean(document.referrer && new URL(document.referrer).origin === window.location.origin);
        } catch (error) {
            sameOriginReferrer = false;
        }
        if (sameOriginReferrer && window.history.length > 1) {
            window.history.back();
        } else {
            window.location.assign(this.config.returnUrl);
        }
    }

    syncFullscreenButton() {
        const button = document.querySelector('[data-action="fullscreen"]');
        const active = Boolean(document.fullscreenElement);
        button?.setAttribute('aria-pressed', String(active));
        const icon = button?.querySelector('i');
        if (icon) icon.className = active ? 'fas fa-compress' : 'fas fa-expand';
    }

    setPlacementActive(active) {
        this.placementActive = active;
        this.stage.classList.toggle('is-placing', active);
        this.controls.enabled = !active;
    }

    toggleMobilePanel(panel) {
        const className = `${panel}-open`;
        const wasOpen = document.body.classList.contains(className);
        this.closeMobilePanels();
        if (!wasOpen) document.body.classList.add(className);
    }

    openCommentsPanel() {
        if (window.matchMedia('(max-width: 900px)').matches) {
            this.closeMobilePanels();
            document.body.classList.add('comments-open');
        }
    }

    closeMobilePanels() {
        document.body.classList.remove('parts-open', 'comments-open');
    }

    resize() {
        const width = Math.max(this.stage.clientWidth, 1);
        const height = Math.max(this.stage.clientHeight, 1);
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height, false);
    }

    showError(message) {
        this.loading.hidden = true;
        this.errorElement.textContent = message;
        this.errorElement.hidden = false;
    }

    animate(now = performance.now()) {
        requestAnimationFrame((time) => this.animate(time));
        if (this.autoRotate && this.modelRoot && !this.focusTween && !this.placementActive) {
            this.displayRoot.rotateY(0.004);
        }
        this.updateFocusTween(now);
        this.controls.update();
        this.selectionHelper?.update();
        this.annotations?.updateOverlay();
        this.viewCube.update();
        this.renderer.render(this.scene, this.camera);
    }
}

function containsRenderableMesh(object) {
    let result = false;
    object.traverse((child) => { if (child.isMesh) result = true; });
    return result;
}

const viewer = new ModelViewer(config);
window.__modelReviewViewer = viewer;
viewer.load();
viewer.animate();
