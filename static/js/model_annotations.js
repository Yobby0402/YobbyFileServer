import * as THREE from 'three';

const MAX_BUBBLE_GAP = 40;

export class ModelAnnotationsController {
    constructor(viewer, config) {
        this.viewer = viewer;
        this.config = config;
        this.annotations = [];
        this.overlayItems = new Map();
        this.selectedId = null;
        this.hoverId = null;
        this.editingId = null;
        this.pendingAnchor = null;
        this.placementMode = null;
        this.exploded = false;
        this.annotationsHidden = false;
        this.showAllLines = false;

        this.listElement = document.getElementById('annotation-list');
        this.emptyElement = document.getElementById('annotation-empty');
        this.statusElement = document.getElementById('annotation-status');
        this.detailElement = document.getElementById('annotation-detail');
        this.detailIndex = document.getElementById('annotation-detail-index');
        this.detailTitle = document.getElementById('annotation-detail-title');
        this.detailBody = document.getElementById('annotation-detail-body');
        this.editorElement = document.getElementById('annotation-editor');
        this.editorHeading = document.getElementById('annotation-editor-heading');
        this.titleInput = document.getElementById('annotation-title');
        this.markdownInput = document.getElementById('annotation-markdown');
        this.pointsElement = document.getElementById('annotation-points');
        this.bubblesElement = document.getElementById('annotation-bubbles');
        this.linesElement = document.getElementById('annotation-lines');
        this.placementHint = document.getElementById('placement-hint');
        this.addButton = document.querySelector('[data-action="add-annotation"]');

        this.detailElement.hidden = true;
        this.editorElement.hidden = true;
        this.titleInput.value = '';
        this.markdownInput.value = '';
        this.bindEvents();
    }

    bindEvents() {
        document.addEventListener('click', (event) => {
            const action = event.target.closest('[data-action]')?.dataset.action;
            if (action === 'add-annotation') this.togglePlacement();
            if (action === 'close-detail') this.closeDetail();
            if (action === 'edit-annotation') this.editSelected();
            if (action === 'reposition-annotation') this.startReposition();
            if (action === 'delete-annotation') this.deleteSelected();
            if (action === 'cancel-annotation') this.cancelEditing();
            if (action === 'toggle-annotations') this.toggleVisibility(event.target.closest('button'));
            if (action === 'toggle-all-lines') this.toggleAllLines(event.target.closest('button'));
        });

        this.editorElement.addEventListener('submit', (event) => {
            event.preventDefault();
            this.saveEditor();
        });

        window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && this.placementMode) {
                this.cancelPlacement();
            }
            if (event.key.toLowerCase() === 'c' && !event.ctrlKey && !event.metaKey && !event.altKey && !this.isTypingTarget(event.target)) {
                event.preventDefault();
                this.togglePlacement();
            }
        });
    }

    async load() {
        if (!this.config.capabilities.annotations) return;
        this.editorElement.hidden = true;
        this.setStatus('正在读取评论...');
        try {
            const data = await this.fetchJson(`${this.config.annotationsUrl}?path=${encodeURIComponent(this.config.filepath)}`);
            this.annotations = data.annotations || [];
            this.render();
            this.setStatus('');
        } catch (error) {
            this.setStatus(error.message, true);
        }
    }

    async fetchJson(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'same-origin',
            headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
            ...options,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            throw new Error(data.error || `请求失败 (${response.status})`);
        }
        return data;
    }

    setStatus(message, isError = false) {
        this.statusElement.textContent = message;
        this.statusElement.classList.toggle('is-error', isError);
    }

    render() {
        this.listElement.replaceChildren();
        this.pointsElement.replaceChildren();
        this.bubblesElement.replaceChildren();
        this.linesElement.replaceChildren();
        this.overlayItems.clear();
        this.emptyElement.hidden = this.annotations.length > 0;

        this.annotations.forEach((annotation, index) => {
            const number = index + 1;
            this.listElement.appendChild(this.createListItem(annotation, number));
            this.createOverlayItem(annotation, number);
        });
        this.syncSelectionClasses();
    }

    createListItem(annotation, number) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'annotation-list__item';
        button.dataset.annotationId = annotation.id;

        const index = document.createElement('span');
        index.className = 'annotation-index';
        index.textContent = String(number);

        const copy = document.createElement('span');
        const title = document.createElement('strong');
        title.textContent = annotation.title;
        const meta = document.createElement('small');
        meta.textContent = annotation.surface_part_path ? '已关联模型零件' : '空间锚点';
        copy.append(title, meta);
        button.append(index, copy);
        button.addEventListener('click', () => this.selectAnnotation(annotation.id, true));
        return button;
    }

    createOverlayItem(annotation, number) {
        const point = document.createElement('button');
        point.type = 'button';
        point.className = 'annotation-point';
        point.title = `${number}. ${annotation.title}`;
        point.setAttribute('aria-label', `${number}. ${annotation.title}`);

        const bubble = document.createElement('button');
        bubble.type = 'button';
        bubble.className = 'annotation-bubble';
        bubble.title = annotation.title;
        const bubbleNumber = document.createElement('span');
        bubbleNumber.className = 'annotation-bubble__number';
        bubbleNumber.textContent = String(number);
        const bubbleTitle = document.createElement('span');
        bubbleTitle.className = 'annotation-bubble__title';
        bubbleTitle.textContent = annotation.title;
        bubble.append(bubbleNumber, bubbleTitle);

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.classList.add('annotation-line');
        line.style.display = 'none';

        for (const element of [point, bubble]) {
            element.dataset.annotationId = annotation.id;
            element.addEventListener('click', () => this.selectAnnotation(annotation.id, true));
            element.addEventListener('pointerenter', () => {
                this.hoverId = annotation.id;
                this.syncLeaderLines();
            });
            element.addEventListener('pointerleave', () => {
                this.hoverId = null;
                this.syncLeaderLines();
            });
        }

        this.pointsElement.appendChild(point);
        this.bubblesElement.appendChild(bubble);
        this.linesElement.appendChild(line);
        this.overlayItems.set(annotation.id, { point, bubble, line });
    }

    annotationById(annotationId) {
        return this.annotations.find((annotation) => annotation.id === annotationId) || null;
    }

    exportAnnotations() {
        return this.annotations.map((annotation) => ({
            ...annotation,
            position: [...annotation.position],
            normal: [...annotation.normal],
        }));
    }

    selectAnnotation(annotationId, focusModel = false) {
        const annotation = this.annotationById(annotationId);
        if (!annotation) return;
        this.selectedId = annotationId;
        this.editingId = null;
        this.editorElement.hidden = true;
        this.showDetail(annotation);
        this.syncSelectionClasses();
        this.viewer.openCommentsPanel();
        if (focusModel) this.viewer.focusAnnotation(annotation);
    }

    showDetail(annotation) {
        const index = this.annotations.findIndex((item) => item.id === annotation.id) + 1;
        this.detailIndex.textContent = String(index);
        this.detailTitle.textContent = annotation.title;
        const renderer = window.marked?.parse ? window.marked.parse(annotation.markdown, { gfm: true, breaks: true }) : '';
        const sanitized = window.DOMPurify?.sanitize ? window.DOMPurify.sanitize(renderer) : '';
        this.detailBody.innerHTML = sanitized;
        this.detailBody.querySelectorAll('a').forEach((link) => {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        });
        this.detailElement.hidden = false;
    }

    closeDetail() {
        this.clearSelection();
    }

    clearSelection() {
        this.selectedId = null;
        this.detailElement.hidden = true;
        this.syncSelectionClasses();
    }

    isTypingTarget(target) {
        return target instanceof HTMLElement && (
            target.matches('input, textarea, select') || target.isContentEditable
        );
    }

    toggleVisibility(button) {
        this.annotationsHidden = !this.annotationsHidden;
        button?.setAttribute('aria-pressed', String(this.annotationsHidden));
        button?.setAttribute('title', this.annotationsHidden ? '显示所有评论' : '隐藏所有评论');
        button?.setAttribute('aria-label', this.annotationsHidden ? '显示所有评论' : '隐藏所有评论');
        const icon = button?.querySelector('i');
        if (icon) icon.className = `fas fa-${this.annotationsHidden ? 'eye' : 'eye-slash'}`;
        this.syncOverlayVisibility();
    }

    toggleAllLines(button) {
        this.showAllLines = !this.showAllLines;
        button?.setAttribute('aria-pressed', String(this.showAllLines));
        button?.setAttribute('title', this.showAllLines ? '隐藏常驻连线' : '显示所有连线');
        button?.setAttribute('aria-label', this.showAllLines ? '隐藏常驻评论连线' : '显示所有评论连线');
        this.syncLeaderLines();
    }

    syncOverlayVisibility() {
        this.pointsElement.hidden = this.annotationsHidden;
        this.bubblesElement.hidden = this.annotationsHidden;
        this.linesElement.hidden = this.annotationsHidden;
        this.syncLeaderLines();
    }

    togglePlacement() {
        if (this.placementMode === 'create') {
            this.cancelPlacement();
            return;
        }
        this.viewer.setExplosion(0);
        this.editingId = null;
        this.pendingAnchor = null;
        this.startPlacement('create');
    }

    startPlacement(mode) {
        if (!this.viewer.isModelReady()) {
            this.setStatus('模型尚未加载完成', true);
            return;
        }
        this.placementMode = mode;
        this.placementHint.hidden = false;
        this.addButton?.classList.add('is-active');
        this.viewer.setPlacementActive(true);
        this.viewer.closeMobilePanels();
    }

    cancelPlacement() {
        this.placementMode = null;
        this.placementHint.hidden = true;
        this.addButton?.classList.remove('is-active');
        this.viewer.setPlacementActive(false);
    }

    handleSurfacePick(anchor) {
        if (!this.placementMode) return false;
        if (this.placementMode === 'reposition') {
            this.finishReposition(anchor);
        } else {
            this.pendingAnchor = anchor;
            this.openEditor(null);
            this.viewer.openCommentsPanel();
        }
        this.cancelPlacement();
        return true;
    }

    openEditor(annotation) {
        this.editingId = annotation?.id || null;
        this.editorHeading.textContent = annotation ? '编辑评论' : '添加评论';
        this.titleInput.value = annotation?.title || '';
        this.markdownInput.value = annotation?.markdown || '';
        this.detailElement.hidden = true;
        this.editorElement.hidden = false;
        this.titleInput.focus();
    }

    editSelected() {
        const annotation = this.annotationById(this.selectedId);
        if (annotation) this.openEditor(annotation);
    }

    cancelEditing() {
        this.editorElement.hidden = true;
        this.editingId = null;
        this.pendingAnchor = null;
        const selected = this.annotationById(this.selectedId);
        if (selected) this.showDetail(selected);
    }

    async saveEditor() {
        const title = this.titleInput.value.trim();
        const markdown = this.markdownInput.value.trim();
        if (!title) {
            this.setStatus('评论标题不能为空', true);
            return;
        }

        const editing = this.annotationById(this.editingId);
        const payload = { path: this.config.filepath, title, markdown };
        let url = this.config.annotationsUrl;
        let method = 'POST';
        if (editing) {
            url = `${url}/${editing.id}`;
            method = 'PUT';
        } else if (this.pendingAnchor) {
            Object.assign(payload, this.pendingAnchor);
        } else {
            this.setStatus('请先在模型表面选择评论位置', true);
            return;
        }

        this.setStatus('正在保存...');
        try {
            const data = await this.fetchJson(url, { method, body: JSON.stringify(payload) });
            if (editing) {
                const index = this.annotations.findIndex((item) => item.id === editing.id);
                this.annotations[index] = data.annotation;
            } else {
                this.annotations.push(data.annotation);
            }
            this.selectedId = data.annotation.id;
            this.pendingAnchor = null;
            this.editingId = null;
            this.editorElement.hidden = true;
            this.render();
            this.showDetail(data.annotation);
            this.setStatus('已保存');
        } catch (error) {
            this.setStatus(error.message, true);
        }
    }

    startReposition() {
        if (!this.selectedId) return;
        this.viewer.setExplosion(0);
        this.startPlacement('reposition');
    }

    async finishReposition(anchor) {
        const annotation = this.annotationById(this.selectedId);
        if (!annotation) return;
        this.setStatus('正在更新位置...');
        try {
            const data = await this.fetchJson(`${this.config.annotationsUrl}/${annotation.id}`, {
                method: 'PUT',
                body: JSON.stringify({ path: this.config.filepath, ...anchor }),
            });
            const index = this.annotations.findIndex((item) => item.id === annotation.id);
            this.annotations[index] = data.annotation;
            this.render();
            this.showDetail(data.annotation);
            this.setStatus('位置已更新');
        } catch (error) {
            this.setStatus(error.message, true);
        }
    }

    async deleteSelected() {
        const annotation = this.annotationById(this.selectedId);
        if (!annotation || !window.confirm(`删除评论“${annotation.title}”？`)) return;
        this.setStatus('正在删除...');
        try {
            await this.fetchJson(`${this.config.annotationsUrl}/${annotation.id}?path=${encodeURIComponent(this.config.filepath)}`, { method: 'DELETE' });
            this.annotations = this.annotations.filter((item) => item.id !== annotation.id);
            this.selectedId = null;
            this.detailElement.hidden = true;
            this.render();
            this.setStatus('已删除');
        } catch (error) {
            this.setStatus(error.message, true);
        }
    }

    setExploded(exploded) {
        this.exploded = exploded;
        this.updateOverlay();
        this.syncListVisibility();
    }

    syncSelectionClasses() {
        document.querySelectorAll('[data-annotation-id]').forEach((element) => {
            element.classList.toggle('is-selected', element.dataset.annotationId === this.selectedId);
        });
        this.syncLeaderLines();
        this.syncListVisibility();
    }

    syncListVisibility() {
        this.annotations.forEach((annotation) => {
            const linkedPartHidden = annotation.surface_part_path && !this.viewer.isPartVisible(annotation.surface_part_path);
            const item = this.listElement.querySelector(`[data-annotation-id="${CSS.escape(annotation.id)}"]`);
            item?.classList.toggle('is-part-hidden', Boolean(linkedPartHidden));
        });
    }

    syncLeaderLines() {
        this.overlayItems.forEach((elements, annotationId) => {
            const annotation = this.annotationById(annotationId);
            const linkedPartHidden = annotation?.surface_part_path && !this.viewer.isPartVisible(annotation.surface_part_path);
            const visible = !this.annotationsHidden && !linkedPartHidden
                && (this.showAllLines || annotationId === this.selectedId || annotationId === this.hoverId);
            elements.line.style.display = visible ? '' : 'none';
        });
    }

    updateOverlay() {
        if (this.annotationsHidden || !this.annotations.length || !this.viewer.isModelReady()) return;
        const { width, height } = this.viewer.getStageSize();
        if (!width || !height) return;
        this.linesElement.setAttribute('viewBox', `0 0 ${width} ${height}`);

        const camera = this.viewer.getCamera();
        const visible = [];
        this.annotations.forEach((annotation) => {
            const elements = this.overlayItems.get(annotation.id);
            if (!elements) return;
            const linkedPartHidden = annotation.surface_part_path && !this.viewer.isPartVisible(annotation.surface_part_path);
            elements.point.hidden = Boolean(linkedPartHidden);
            elements.bubble.hidden = Boolean(linkedPartHidden);
            const lineVisible = !linkedPartHidden
                && (this.showAllLines || annotation.id === this.selectedId || annotation.id === this.hoverId);
            elements.line.style.display = lineVisible ? '' : 'none';
            if (linkedPartHidden) return;

            const worldPoint = this.viewer.annotationToWorldPoint(annotation);
            const projected = worldPoint.clone().project(camera);
            const rawX = (projected.x * 0.5 + 0.5) * width;
            const rawY = (-projected.y * 0.5 + 0.5) * height;
            const pointX = Math.max(5, Math.min(width - 5, rawX));
            const pointY = Math.max(5, Math.min(height - 5, rawY));
            const inFront = projected.z >= -1 && projected.z <= 1;
            elements.point.style.left = `${pointX}px`;
            elements.point.style.top = `${pointY}px`;
            elements.point.classList.toggle('is-behind', !inFront || this.isBackFacing(annotation, worldPoint));
            visible.push({ annotation, elements, pointX, pointY, rawX, rawY, side: rawX < width / 2 ? 'left' : 'right' });
        });

        this.arrangeBubbles(visible.filter((item) => item.side === 'left'), 'left', width, height);
        this.arrangeBubbles(visible.filter((item) => item.side === 'right'), 'right', width, height);
    }

    isBackFacing(annotation, worldPoint) {
        const normal = this.viewer.modelToWorldNormal(annotation.normal);
        const towardCamera = this.viewer.getCamera().position.clone().sub(worldPoint).normalize();
        return normal.dot(towardCamera) <= 0;
    }

    arrangeBubbles(items, side, width, height) {
        items.sort((a, b) => a.rawY - b.rawY);
        const bottomReserve = 68;
        let previousY = 8 - MAX_BUBBLE_GAP;
        items.forEach((item) => {
            const bubbleHeight = item.elements.bubble.offsetHeight || 34;
            let y = Math.max(8, Math.min(height - bottomReserve - bubbleHeight, item.rawY - bubbleHeight / 2));
            y = Math.max(y, previousY + MAX_BUBBLE_GAP);
            y = Math.min(y, height - bottomReserve - bubbleHeight);
            previousY = y;
            const bubbleWidth = item.elements.bubble.offsetWidth || 190;
            const x = side === 'left' ? 12 : width - bubbleWidth - 12;
            item.elements.bubble.style.left = `${Math.max(6, x)}px`;
            item.elements.bubble.style.top = `${Math.max(6, y)}px`;

            const lineX = side === 'left' ? x + bubbleWidth : x;
            const lineY = y + bubbleHeight / 2;
            item.elements.line.setAttribute('x1', String(item.pointX));
            item.elements.line.setAttribute('y1', String(item.pointY));
            item.elements.line.setAttribute('x2', String(lineX));
            item.elements.line.setAttribute('y2', String(lineY));
        });
    }
}
