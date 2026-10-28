import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const EXPORT_WIDTH = 1600;
const EXPORT_HEIGHT = 900;
const EXPORT_ASPECT = EXPORT_WIDTH / EXPORT_HEIGHT;

const VIEW_PRESETS = [
    { id: 'front', label: '前视图', direction: [0, 0, 1], up: [0, 1, 0] },
    { id: 'back', label: '后视图', direction: [0, 0, -1], up: [0, 1, 0] },
    { id: 'left', label: '左视图', direction: [-1, 0, 0], up: [0, 1, 0] },
    { id: 'right', label: '右视图', direction: [1, 0, 0], up: [0, 1, 0] },
    { id: 'top', label: '顶视图', direction: [0, 1, 0], up: [0, 0, -1] },
    { id: 'bottom', label: '底视图', direction: [0, -1, 0], up: [0, 0, 1] },
    { id: 'front_top_right', label: '右前上等轴视图', direction: [1, 1, 1], up: [0, 1, 0] },
    { id: 'back_bottom_left', label: '左后下等轴视图', direction: [-1, -1, -1], up: [0, 1, 0] },
    { id: 'front_top_left', label: '左前上等轴视图', direction: [-1, 1, 1], up: [0, 1, 0] },
    { id: 'back_bottom_right', label: '右后下等轴视图', direction: [1, -1, -1], up: [0, 1, 0] },
    { id: 'front_bottom_right', label: '右前下等轴视图', direction: [1, -1, 1], up: [0, 1, 0] },
    { id: 'back_top_left', label: '左后上等轴视图', direction: [-1, 1, -1], up: [0, 1, 0] },
    { id: 'front_bottom_left', label: '左前下等轴视图', direction: [-1, -1, 1], up: [0, 1, 0] },
    { id: 'back_top_right', label: '右后上等轴视图', direction: [1, 1, -1], up: [0, 1, 0] },
];

export class ModelReportExportController {
    constructor(viewer, config) {
        this.viewer = viewer;
        this.config = config;
        this.dialog = document.getElementById('report-dialog');
        this.form = document.getElementById('report-form');
        this.titleInput = document.getElementById('report-title');
        this.annotationToggle = document.getElementById('report-include-annotations');
        this.annotationCount = document.getElementById('report-annotation-count');
        this.annotationViews = document.getElementById('report-annotation-views');
        this.annotationViewSummary = document.getElementById('report-annotation-view-summary');
        this.previewCount = document.getElementById('report-preview-count');
        this.include3dToggle = document.getElementById('report-include-3d');
        this.include3dRow = document.getElementById('report-include-3d-row');
        this.separate3dToggle = document.getElementById('report-separate-3d');
        this.separate3dRow = document.getElementById('report-separate-3d-row');
        this.separate3dHint = document.getElementById('report-separate-3d-hint');
        this.progress = document.getElementById('report-progress');
        this.progressLabel = document.getElementById('report-progress-label');
        this.progressValue = document.getElementById('report-progress-value');
        this.progressBar = document.getElementById('report-progress-bar');
        this.error = document.getElementById('report-error');
        this.submitButton = document.getElementById('report-submit');
        this.busy = false;
        this.bindEvents();
    }

    bindEvents() {
        document.addEventListener('click', (event) => {
            const action = event.target.closest('[data-action]')?.dataset.action;
            if (action === 'export-report') this.open();
            if (action === 'close-report') this.close();
        });
        this.form?.addEventListener('submit', (event) => this.submit(event));
        this.form?.addEventListener('change', () => this.syncOptionStates());
        this.dialog?.addEventListener('cancel', (event) => {
            if (this.busy) event.preventDefault();
        });
    }

    open() {
        if (!this.dialog) return;
        const annotations = this.viewer.annotations?.exportAnnotations() || [];
        this.titleInput.value = `${this.config.filename.replace(/\.[^.]+$/, '')} 3D 审阅报告`;
        this.annotationToggle.disabled = annotations.length === 0;
        this.annotationToggle.checked = annotations.length > 0;
        this.annotationToggle.closest('.report-toggle')?.classList.toggle('is-disabled', annotations.length === 0);
        this.annotationCount.textContent = annotations.length
            ? `共 ${annotations.length} 条，每条评论各占一页`
            : '当前模型没有评论';
        this.syncOptionStates();
        this.setError('');
        this.setProgress('', 0, false);
        if (typeof this.dialog.showModal === 'function') this.dialog.showModal();
        else this.dialog.setAttribute('open', '');
        this.titleInput.focus();
        this.titleInput.select();
    }

    close() {
        if (!this.dialog || this.busy) return;
        if (typeof this.dialog.close === 'function') this.dialog.close();
        else this.dialog.removeAttribute('open');
    }

    selectedFormats() {
        const mode = this.form.querySelector('input[name="output_mode"]:checked')?.value || 'both';
        if (mode === 'pdf') return ['pdf'];
        if (mode === 'docx') return ['docx'];
        return ['pdf', 'docx'];
    }

    setBusy(busy) {
        this.busy = busy;
        this.submitButton.disabled = busy;
        this.form.querySelectorAll('input, button').forEach((element) => {
            element.disabled = busy;
        });
        this.syncOptionStates();
    }

    syncOptionStates() {
        const annotationsAvailable = Boolean(this.viewer.annotations?.exportAnnotations().length);
        const annotationsSelected = Boolean(annotationsAvailable && this.annotationToggle.checked);
        const wordSelected = this.selectedFormats().includes('docx');
        const separateRoots = this.separate3dRoots();
        const separateAvailable = wordSelected && this.include3dToggle.checked && separateRoots.length >= 2;
        this.annotationToggle.disabled = this.busy || !annotationsAvailable;
        this.annotationToggle.closest('.report-toggle')?.classList.toggle('is-disabled', !annotationsAvailable);
        this.include3dToggle.disabled = this.busy || !wordSelected;
        this.include3dRow.classList.toggle('is-disabled', !wordSelected);
        this.separate3dToggle.disabled = this.busy || !separateAvailable;
        this.separate3dRow.classList.toggle('is-disabled', !separateAvailable);
        this.separate3dHint.textContent = separateRoots.length >= 2
            ? `在同一 Word 中额外嵌入 ${separateRoots.length} 个独立板子模型`
            : '当前模型未识别出多个顶层板子';
        this.annotationViews.querySelectorAll('input').forEach((input) => {
            input.disabled = this.busy || !annotationsSelected;
        });
        this.annotationViews.classList.toggle('is-disabled', !annotationsSelected);

        this.form.querySelectorAll('.report-choice, .report-segment, .report-toggle').forEach((label) => {
            const input = label.querySelector('input');
            label.classList.toggle('is-selected', Boolean(input?.checked && !input.disabled));
        });
        const previewCount = Number(this.form.querySelector('input[name="preview_count"]:checked')?.value || 6);
        const annotationViewCount = Number(this.form.querySelector('input[name="annotation_view_count"]:checked')?.value || 2);
        this.previewCount.textContent = `已选择 ${previewCount} 张，将生成 ${previewCount} 页基础预览`;
        this.annotationViewSummary.textContent = annotationsSelected
            ? `每条评论将生成 ${annotationViewCount} 个完整模型视角`
            : '未包含评论页面';
        this.annotationViewSummary.classList.toggle('is-disabled', !annotationsSelected);
        this.annotationCount.textContent = annotationsAvailable
            ? `共 ${this.viewer.annotations.exportAnnotations().length} 条，每条评论各占一页`
            : '当前模型没有评论';
    }

    setProgress(label, value, visible = true) {
        this.progress.hidden = !visible;
        this.progressLabel.textContent = label || '正在准备导出';
        this.progressValue.textContent = `${Math.round(value)}%`;
        this.progressBar.value = value;
    }

    setError(message) {
        this.error.textContent = message;
        this.error.hidden = !message;
    }

    async submit(event) {
        event.preventDefault();
        if (this.busy) return;
        if (!this.viewer.modelRoot) {
            this.setError('模型尚未加载完成。');
            return;
        }

        const title = this.titleInput.value.trim();
        const formats = this.selectedFormats();
        const previewCount = Number(this.form.querySelector('input[name="preview_count"]:checked')?.value || 6);
        const includeAnnotations = Boolean(this.annotationToggle.checked && !this.annotationToggle.disabled);
        const annotationViewCount = Number(this.form.querySelector('input[name="annotation_view_count"]:checked')?.value || 2);
        const include3d = Boolean(formats.includes('docx') && this.include3dToggle.checked);
        const separateRoots = this.separate3dRoots();
        const separate3d = Boolean(include3d && this.separate3dToggle.checked && !this.separate3dToggle.disabled);
        const annotations = includeAnnotations ? (this.viewer.annotations?.exportAnnotations() || []) : [];
        if (!title) {
            this.setError('请输入报告标题。');
            return;
        }
        if (!formats.length) {
            this.setError('请至少选择一种输出格式。');
            return;
        }

        this.setBusy(true);
        this.setError('');
        let exportScene;
        try {
            this.setProgress('正在准备模型', 3);
            exportScene = this.createExportScene();
            const presets = VIEW_PRESETS.slice(0, previewCount);
            const previewImages = new Map();
            for (let index = 0; index < presets.length; index += 1) {
                const preset = presets[index];
                this.setProgress(`正在渲染${preset.label}`, 5 + (index / Math.max(presets.length, 1)) * 38);
                previewImages.set(preset.id, await this.capturePreset(exportScene, preset));
            }

            const annotationImages = new Map();
            const annotationFrameCount = annotations.length * annotationViewCount;
            let annotationFrameIndex = 0;
            for (let annotationIndex = 0; annotationIndex < annotations.length; annotationIndex += 1) {
                const annotation = annotations[annotationIndex];
                for (let viewIndex = 0; viewIndex < annotationViewCount; viewIndex += 1) {
                    this.setProgress(
                        `正在渲染评论 ${annotationIndex + 1}/${annotations.length} · 视角 ${viewIndex + 1}/${annotationViewCount}`,
                        45 + (annotationFrameIndex / Math.max(annotationFrameCount, 1)) * 28,
                    );
                    const key = `${annotation.id}_${viewIndex + 1}`;
                    annotationImages.set(key, await this.captureAnnotation(exportScene, annotation, annotationIndex + 1, viewIndex));
                    annotationFrameIndex += 1;
                }
            }

            let modelGlb = null;
            const separateModelFiles = [];
            if (include3d) {
                this.setProgress('正在生成 Word 交互模型', 76);
                modelGlb = await this.exportGlb(exportScene.root);
                if (separate3d) {
                    for (let index = 0; index < separateRoots.length; index += 1) {
                        const source = separateRoots[index];
                        this.setProgress(`正在生成独立板子 ${index + 1}/${separateRoots.length}`, 77 + (index / separateRoots.length) * 6);
                        const itemScene = this.createExportScene(source.object);
                        try {
                            separateModelFiles.push({
                                name: source.name,
                                maxDimension: itemScene.maxDimension,
                                glb: await this.exportGlb(itemScene.root),
                                poster: await this.capturePreset(itemScene, VIEW_PRESETS[0]),
                            });
                        } finally {
                            this.disposeExportScene(itemScene);
                        }
                    }
                }
            }

            this.setProgress('正在生成报告文件', 84);
            const formData = new FormData();
            formData.append('config', JSON.stringify({
                path: this.config.filepath,
                title,
                formats,
                preview_count: previewCount,
                include_annotations: includeAnnotations,
                annotation_view_count: annotationViewCount,
                include_3d: include3d,
                separate_3d: separate3d,
                separate_models: separateModelFiles.map((item) => ({
                    name: item.name,
                    max_dimension: item.maxDimension,
                })),
                views: presets.map(({ id, label }) => ({ id, label })),
                annotation_ids: annotations.map((annotation) => annotation.id),
                model_max_dimension: exportScene.maxDimension,
            }));
            previewImages.forEach((blob, id) => formData.append(`preview_${id}`, blob, `${id}.jpg`));
            annotationImages.forEach((blob, key) => formData.append(`annotation_${key}`, blob, `${key}.jpg`));
            if (modelGlb) formData.append('model_glb', modelGlb, 'model.glb');
            separateModelFiles.forEach((item, index) => {
                formData.append(`separate_model_${index}`, item.glb, `separate-${index + 1}.glb`);
                formData.append(`separate_poster_${index}`, item.poster, `separate-${index + 1}.jpg`);
            });

            const response = await fetch(this.config.reportsUrl, { method: 'POST', body: formData });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || `报告生成失败（HTTP ${response.status}）`);
            }
            const blob = await response.blob();
            const filename = this.responseFilename(response) || `${title}.${formats.length > 1 ? 'zip' : formats[0]}`;
            this.downloadBlob(blob, filename);
            const partial = response.headers.get('X-Model-Review-Partial');
            this.setProgress(partial ? 'PDF 已生成，Word 生成失败，请查看压缩包说明' : '报告已生成', 100);
            if (partial) this.setError('Word 文档生成失败，压缩包中仍包含 PDF 和失败说明。');
            setTimeout(() => {
                this.setBusy(false);
                if (!partial) this.close();
            }, 450);
        } catch (error) {
            console.error('Model report export failed:', error);
            this.setError(error.message || '报告生成失败。');
            this.setBusy(false);
        } finally {
            this.disposeExportScene(exportScene);
        }
    }

    separate3dRoots() {
        if (!this.viewer.modelRoot) return [];
        const containsMesh = (object) => {
            let found = false;
            object.traverse((child) => { if (child.isMesh) found = true; });
            return found;
        };
        const assemblyItems = new Map();
        this.viewer.modelRoot.traverse((object) => {
            const itemId = object.userData?.assemblyItemId;
            if (itemId && !assemblyItems.has(itemId) && containsMesh(object)) {
                assemblyItems.set(itemId, {
                    object,
                    name: String(object.name || `板子 ${assemblyItems.size + 1}`),
                });
            }
        });
        if (assemblyItems.size >= 2) return Array.from(assemblyItems.values());
        return this.viewer.parts
            .filter((item) => !item.parent && containsMesh(item.object))
            .map((item) => ({ object: item.object, name: item.name }));
    }

    createExportScene(sourceObject = this.viewer.modelRoot) {
        const leafPositions = this.viewer.parts
            .filter((item) => item.children.length === 0)
            .map((item) => ({ item, position: item.object.position.clone() }));
        leafPositions.forEach(({ item }) => item.object.position.copy(item.restPosition));
        this.viewer.modelRoot.updateWorldMatrix(true, true);
        const clone = sourceObject.clone(true);
        leafPositions.forEach(({ item, position }) => item.object.position.copy(position));
        this.viewer.modelRoot.updateWorldMatrix(true, true);
        clone.traverse((object) => {
            object.visible = true;
            if (!object.isMesh) return;
            object.material = Array.isArray(object.material)
                ? object.material.map((material) => material?.clone())
                : object.material?.clone();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.filter(Boolean).forEach((material) => {
                material.wireframe = false;
                material.side = THREE.DoubleSide;
                if (material.isMeshStandardMaterial || material.isMeshPhysicalMaterial) {
                    material.metalness = Math.min(material.metalness, 0.6);
                    material.roughness = Math.max(material.roughness, 0.3);
                }
                material.needsUpdate = true;
            });
        });
        const sourceBox = new THREE.Box3().setFromObject(clone);
        const center = sourceBox.getCenter(new THREE.Vector3());
        const root = new THREE.Group();
        root.name = 'ExportedModel';
        root.add(clone);
        clone.position.sub(center);
        root.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(root);
        const size = box.getSize(new THREE.Vector3());
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        return {
            root,
            box,
            size,
            sourceCenter: center,
            radius: Math.max(sphere.radius, 0.001),
            maxDimension: Math.max(size.x, size.y, size.z, 0.001),
        };
    }

    disposeExportScene(exportScene) {
        if (!exportScene?.root) return;
        exportScene.root.traverse((object) => {
            if (!object.isMesh) return;
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            materials.filter(Boolean).forEach((material) => material.dispose());
        });
        exportScene.root.removeFromParent();
    }

    async capturePreset(exportScene, preset) {
        const direction = new THREE.Vector3().fromArray(preset.direction).normalize();
        const up = new THREE.Vector3().fromArray(preset.up).normalize();
        const camera = this.fitOrthographicCamera(exportScene, direction, up);
        return this.captureFrame(exportScene.root, camera);
    }

    async captureAnnotation(exportScene, annotation, number, viewIndex) {
        const anchor = new THREE.Vector3().fromArray(annotation.position).sub(exportScene.sourceCenter);
        const normal = new THREE.Vector3().fromArray(annotation.normal).normalize();
        const reference = Math.abs(normal.y) < 0.92 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const tangent = reference.clone().cross(normal).normalize();
        const bitangent = normal.clone().cross(tangent).normalize();
        const directions = [
            normal,
            normal.clone().multiplyScalar(0.82).addScaledVector(tangent, 0.57).normalize(),
            normal.clone().multiplyScalar(0.82).addScaledVector(tangent, -0.57).normalize(),
            normal.clone().multiplyScalar(0.82).addScaledVector(bitangent, 0.57).normalize(),
        ];
        const direction = directions[viewIndex] || normal;
        const up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(direction.dot(up)) > 0.96) up.set(0, 0, 1);
        const camera = this.fitOrthographicCamera(exportScene, direction, up);
        const blob = await this.captureFrame(exportScene.root, camera, (context) => {
            this.drawAnnotationCallout(context, camera, anchor, annotation.title, number);
        });
        return blob;
    }

    fitOrthographicCamera(exportScene, direction, up) {
        const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.001, 1000);
        const distance = Math.max(exportScene.radius * 4, 1);
        camera.position.copy(direction).multiplyScalar(distance);
        camera.up.copy(up);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);

        const minimum = new THREE.Vector3(Infinity, Infinity, Infinity);
        const maximum = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
        const corner = new THREE.Vector3();
        let hasBounds = false;
        exportScene.root.updateWorldMatrix(true, true);
        exportScene.root.traverse((object) => {
            if (!object.isMesh || !object.geometry) return;
            if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
            const box = object.geometry.boundingBox;
            if (!box || box.isEmpty()) return;
            for (let mask = 0; mask < 8; mask += 1) {
                corner.set(
                    mask & 1 ? box.max.x : box.min.x,
                    mask & 2 ? box.max.y : box.min.y,
                    mask & 4 ? box.max.z : box.min.z,
                );
                corner.applyMatrix4(object.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
                minimum.min(corner);
                maximum.max(corner);
                hasBounds = true;
            }
        });
        if (!hasBounds) {
            minimum.set(-exportScene.radius, -exportScene.radius, -distance - exportScene.radius);
            maximum.set(exportScene.radius, exportScene.radius, -distance + exportScene.radius);
        }

        const margin = 1.06;
        const centerX = (minimum.x + maximum.x) / 2;
        const centerY = (minimum.y + maximum.y) / 2;
        const projectedWidth = Math.max((maximum.x - minimum.x) * margin, 0.001);
        const projectedHeight = Math.max((maximum.y - minimum.y) * margin, 0.001);
        const viewWidth = Math.max(projectedWidth, projectedHeight * EXPORT_ASPECT);
        const viewHeight = viewWidth / EXPORT_ASPECT;
        camera.left = centerX - viewWidth / 2;
        camera.right = centerX + viewWidth / 2;
        camera.top = centerY + viewHeight / 2;
        camera.bottom = centerY - viewHeight / 2;
        camera.near = Math.max(exportScene.radius * 0.01, 0.001);
        camera.far = Math.max(distance + exportScene.radius * 10, 1000);
        camera.updateProjectionMatrix();
        return camera;
    }

    async captureFrame(root, camera, overlayRenderer = null) {
        const renderer = this.viewer.renderer;
        const scene = this.viewer.scene;
        const target = new THREE.WebGLRenderTarget(EXPORT_WIDTH, EXPORT_HEIGHT, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
            type: THREE.UnsignedByteType,
        });
        target.texture.colorSpace = THREE.SRGBColorSpace;
        const previousTarget = renderer.getRenderTarget();
        const previousBackground = scene.background;
        const previousExposure = renderer.toneMappingExposure;
        const displayVisible = this.viewer.displayRoot.visible;
        const gridVisible = this.viewer.gridHelper.visible;
        const axesVisible = this.viewer.axesHelper.visible;
        const selectionVisible = this.viewer.selectionHelper?.visible;
        scene.add(root);
        const existingLights = [];
        scene.traverse((object) => {
            if (object.isLight) existingLights.push({ object, visible: object.visible });
        });
        const exportLights = new THREE.Group();
        exportLights.add(new THREE.HemisphereLight(0xffffff, 0x7f8790, 1.25));
        exportLights.add(new THREE.AmbientLight(0xffffff, 0.65));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
        keyLight.position.copy(camera.position);
        exportLights.add(keyLight);
        const backLight = new THREE.DirectionalLight(0xe6efff, 0.9);
        backLight.position.copy(camera.position).multiplyScalar(-1);
        exportLights.add(backLight);
        const cameraRight = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        const sideDistance = Math.max(camera.position.length() * 0.75, 1);
        const rightFill = new THREE.DirectionalLight(0xffffff, 0.75);
        rightFill.position.copy(camera.position).multiplyScalar(0.35).addScaledVector(cameraRight, sideDistance).addScaledVector(camera.up, sideDistance * 0.4);
        exportLights.add(rightFill);
        const leftFill = new THREE.DirectionalLight(0xdcecff, 0.6);
        leftFill.position.copy(camera.position).multiplyScalar(0.3).addScaledVector(cameraRight, -sideDistance).addScaledVector(camera.up, -sideDistance * 0.25);
        exportLights.add(leftFill);
        scene.add(exportLights);
        existingLights.forEach(({ object }) => { object.visible = false; });
        this.viewer.displayRoot.visible = false;
        this.viewer.gridHelper.visible = false;
        this.viewer.axesHelper.visible = false;
        if (this.viewer.selectionHelper) this.viewer.selectionHelper.visible = false;
        scene.background = new THREE.Color(0xf3f4f6);
        renderer.toneMappingExposure = Math.max(previousExposure, 1.05);
        try {
            renderer.setRenderTarget(target);
            renderer.clear();
            renderer.render(scene, camera);
            const pixels = new Uint8Array(EXPORT_WIDTH * EXPORT_HEIGHT * 4);
            renderer.readRenderTargetPixels(target, 0, 0, EXPORT_WIDTH, EXPORT_HEIGHT, pixels);
            const canvas = document.createElement('canvas');
            canvas.width = EXPORT_WIDTH;
            canvas.height = EXPORT_HEIGHT;
            const context = canvas.getContext('2d');
            const imageData = context.createImageData(EXPORT_WIDTH, EXPORT_HEIGHT);
            const rowBytes = EXPORT_WIDTH * 4;
            for (let y = 0; y < EXPORT_HEIGHT; y += 1) {
                const sourceStart = (EXPORT_HEIGHT - y - 1) * rowBytes;
                imageData.data.set(pixels.subarray(sourceStart, sourceStart + rowBytes), y * rowBytes);
            }
            context.putImageData(imageData, 0, 0);
            overlayRenderer?.(context);
            return await new Promise((resolve, reject) => {
                canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成预览图片。')), 'image/jpeg', 0.9);
            });
        } finally {
            renderer.setRenderTarget(previousTarget);
            renderer.toneMappingExposure = previousExposure;
            scene.background = previousBackground;
            this.viewer.displayRoot.visible = displayVisible;
            this.viewer.gridHelper.visible = gridVisible;
            this.viewer.axesHelper.visible = axesVisible;
            if (this.viewer.selectionHelper && selectionVisible !== undefined) this.viewer.selectionHelper.visible = selectionVisible;
            existingLights.forEach(({ object, visible }) => { object.visible = visible; });
            exportLights.removeFromParent();
            root.removeFromParent();
            target.dispose();
        }
    }

    drawAnnotationCallout(context, camera, anchor, title, number) {
        const projected = anchor.clone().project(camera);
        const pointX = (projected.x * 0.5 + 0.5) * EXPORT_WIDTH;
        const pointY = (-projected.y * 0.5 + 0.5) * EXPORT_HEIGHT;
        const bubbleWidth = 390;
        const bubbleHeight = 72;
        const placeRight = pointX < EXPORT_WIDTH * 0.56;
        const bubbleX = placeRight ? EXPORT_WIDTH - bubbleWidth - 48 : 48;
        const bubbleY = Math.max(38, Math.min(EXPORT_HEIGHT - bubbleHeight - 38, pointY - bubbleHeight / 2));
        const lineX = placeRight ? bubbleX : bubbleX + bubbleWidth;
        const lineY = bubbleY + bubbleHeight / 2;

        context.save();
        context.strokeStyle = 'rgba(32, 35, 40, 0.82)';
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(pointX, pointY);
        context.lineTo(lineX, lineY);
        context.stroke();
        context.fillStyle = '#f2b84b';
        context.strokeStyle = '#ffffff';
        context.lineWidth = 5;
        context.beginPath();
        context.arc(pointX, pointY, 13, 0, Math.PI * 2);
        context.fill();
        context.stroke();

        context.fillStyle = 'rgba(32, 35, 40, 0.95)';
        context.strokeStyle = '#52b788';
        context.lineWidth = 2;
        context.beginPath();
        context.roundRect(bubbleX, bubbleY, bubbleWidth, bubbleHeight, 8);
        context.fill();
        context.stroke();
        context.fillStyle = '#f2b84b';
        context.beginPath();
        context.arc(bubbleX + 36, bubbleY + 36, 21, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = '#272014';
        context.font = '700 22px Arial, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(String(number), bubbleX + 36, bubbleY + 37);
        context.fillStyle = '#f3f4f6';
        context.font = '600 24px Arial, "Microsoft YaHei", sans-serif';
        context.textAlign = 'left';
        const safeTitle = title.length > 21 ? `${title.slice(0, 20)}…` : title;
        context.fillText(safeTitle, bubbleX + 70, bubbleY + 37);
        context.restore();
    }

    async exportGlb(root) {
        const exporter = new GLTFExporter();
        const result = await exporter.parseAsync(root, {
            binary: true,
            onlyVisible: true,
            trs: false,
            maxTextureSize: 4096,
        });
        return new Blob([result], { type: 'model/gltf-binary' });
    }

    responseFilename(response) {
        const reviewFilename = response.headers.get('X-Model-Review-Filename');
        if (reviewFilename) return decodeURIComponent(reviewFilename);
        const disposition = response.headers.get('Content-Disposition') || '';
        const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
        if (utf8Match) return decodeURIComponent(utf8Match[1]);
        const simpleMatch = disposition.match(/filename="?([^";]+)"?/i);
        return simpleMatch?.[1] || '';
    }

    downloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
