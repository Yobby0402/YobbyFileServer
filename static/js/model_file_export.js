import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';


export class ModelFileExportController {
    constructor(viewer, config) {
        this.viewer = viewer;
        this.config = config;
        this.dialog = document.getElementById('model-export-dialog');
        this.form = document.getElementById('model-export-form');
        this.format = document.getElementById('model-export-format');
        this.parts = document.getElementById('model-export-parts');
        this.selectAll = document.getElementById('model-export-select-all');
        this.summary = document.getElementById('model-export-summary');
        this.progress = document.getElementById('model-export-progress');
        this.progressLabel = document.getElementById('model-export-progress-label');
        this.error = document.getElementById('model-export-error');

        document.addEventListener('click', (event) => {
            const action = event.target.closest('[data-action]')?.dataset.action;
            if (action === 'export-model') this.open();
            if (action === 'close-model-export') this.close();
        });
        this.form?.addEventListener('submit', (event) => {
            event.preventDefault();
            this.export();
        });
        this.parts?.addEventListener('change', () => this.syncSelection());
        this.selectAll?.addEventListener('change', () => {
            this.partInputs().forEach((input) => { input.checked = this.selectAll.checked; });
            this.syncSelection();
        });
    }

    open() {
        if (!this.viewer.isModelReady()) return;
        this.error.hidden = true;
        this.progress.hidden = true;
        this.renderParts();
        this.dialog.showModal();
    }

    close() {
        if (!this.dialog.open || this.form.dataset.busy === 'true') return;
        this.dialog.close();
    }

    rootParts() {
        return this.viewer.parts.filter((item) => !item.parent);
    }

    renderParts() {
        this.parts.replaceChildren();
        this.rootParts().forEach((item) => {
            const label = document.createElement('label');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.name = 'model_export_part';
            input.value = item.path;
            input.checked = true;
            const text = document.createElement('span');
            text.textContent = item.name;
            label.append(input, text);
            this.parts.appendChild(label);
        });
        this.selectAll.checked = true;
        this.syncSelection();
    }

    partInputs() {
        return Array.from(this.parts.querySelectorAll('input[name="model_export_part"]'));
    }

    selectedParts() {
        return this.partInputs()
            .filter((input) => input.checked)
            .map((input) => this.viewer.partByPath.get(input.value))
            .filter(Boolean);
    }

    syncSelection() {
        const inputs = this.partInputs();
        const selected = inputs.filter((input) => input.checked).length;
        this.selectAll.checked = Boolean(inputs.length && selected === inputs.length);
        this.selectAll.indeterminate = selected > 0 && selected < inputs.length;
        this.summary.textContent = `已选择 ${selected}/${inputs.length} 个顶层零件`;
    }

    clonePart(item) {
        const clone = item.object.clone(true);
        clone.traverse((object) => {
            object.visible = true;
            const path = object.userData.modelReviewPartPath;
            const sourcePart = path ? this.viewer.partByPath.get(path) : null;
            if (sourcePart) object.position.copy(sourcePart.restPosition);
        });
        return clone;
    }

    async exportGlb(parts) {
        const root = new THREE.Group();
        root.name = 'Exported Model';
        parts.forEach((item) => root.add(this.clonePart(item)));
        root.updateMatrixWorld(true);
        return new GLTFExporter().parseAsync(root, {
            binary: true,
            onlyVisible: true,
            maxTextureSize: 4096,
        });
    }

    async export() {
        const selected = this.selectedParts();
        if (!selected.length) {
            this.showError('请至少选择一个顶层零件。');
            return;
        }
        this.setBusy(true);
        this.error.hidden = true;
        try {
            const fileFormat = this.format.value;
            const formData = new FormData();
            formData.append('path', this.config.filepath);
            formData.append('format', fileFormat);

            if (fileFormat === 'step') {
                formData.append('entity_names', JSON.stringify(selected.map((item) => item.name)));
                for (let index = 0; index < selected.length; index += 1) {
                    this.progressLabel.textContent = `正在准备 STEP 实体 ${index + 1}/${selected.length}`;
                    const buffer = await this.exportGlb([selected[index]]);
                    formData.append(
                        `entity_${index}`,
                        new Blob([buffer], { type: 'model/gltf-binary' }),
                        `entity-${index + 1}.glb`,
                    );
                }
            } else {
                this.progressLabel.textContent = '正在准备所选模型';
                const buffer = await this.exportGlb(selected);
                formData.append('model_glb', new Blob([buffer], { type: 'model/gltf-binary' }), 'model.glb');
            }

            this.progressLabel.textContent = `正在生成 ${fileFormat.toUpperCase()}`;
            const response = await fetch(this.config.modelExportUrl, {
                method: 'POST',
                body: formData,
                credentials: 'same-origin',
                headers: { Accept: 'application/octet-stream, application/json' },
            });
            if (!response.ok) {
                const payload = await response.json().catch(() => ({}));
                throw new Error(payload.error || `模型导出失败 (${response.status})`);
            }
            const blob = await response.blob();
            const encodedName = response.headers.get('X-Model-Export-Filename');
            const filename = encodedName ? decodeURIComponent(encodedName) : `model.${fileFormat}`;
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
            URL.revokeObjectURL(url);
            this.dialog.close();
        } catch (error) {
            this.showError(error.message || '模型导出失败');
        } finally {
            this.setBusy(false);
        }
    }

    setBusy(busy) {
        this.form.dataset.busy = String(busy);
        this.progress.hidden = !busy;
        this.form.querySelectorAll('button, input, select').forEach((control) => {
            control.disabled = busy;
        });
    }

    showError(message) {
        this.error.textContent = message;
        this.error.hidden = false;
    }
}
