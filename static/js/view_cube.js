import * as THREE from 'three';

const FACE_KEYS = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

export class ViewCube {
    constructor(element, options) {
        this.element = element;
        this.options = options;
        this.pointerState = null;
        this.scene = new THREE.Scene();
        this.camera = new THREE.OrthographicCamera(-1.25, 1.25, 1.25, -1.25, 0.1, 10);
        this.camera.position.set(0, 0, 4);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.element.appendChild(this.renderer.domElement);

        const materials = FACE_KEYS.map((key) => new THREE.MeshBasicMaterial({
            map: this.createFaceTexture(options.labels[key]),
        }));
        this.cube = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.25, 1.25), materials);
        this.cube.add(new THREE.LineSegments(
            new THREE.EdgesGeometry(this.cube.geometry),
            new THREE.LineBasicMaterial({ color: 0x293137, transparent: true, opacity: 0.9 }),
        ));
        this.scene.add(this.cube);

        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this.element.tabIndex = 0;
        this.element.setAttribute('role', 'application');
        this.bindEvents();
        this.resize();
    }

    createFaceTexture(label) {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 160;
        const context = canvas.getContext('2d');
        context.fillStyle = '#e9eef1';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = '#aeb8bf';
        context.lineWidth = 8;
        context.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
        context.fillStyle = '#263139';
        context.font = '700 66px "Microsoft YaHei", "Segoe UI", sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    }

    bindEvents() {
        this.element.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.stopPropagation();
            this.element.setPointerCapture?.(event.pointerId);
            this.pointerState = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                previousX: event.clientX,
                previousY: event.clientY,
                dragged: false,
            };
        });
        this.element.addEventListener('pointermove', (event) => {
            const state = this.pointerState;
            if (!state || state.pointerId !== event.pointerId) return;
            const totalDistance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
            if (totalDistance > 3) state.dragged = true;
            if (state.dragged) {
                this.options.onDrag(event.clientX - state.previousX, event.clientY - state.previousY);
                state.previousX = event.clientX;
                state.previousY = event.clientY;
            }
        });
        this.element.addEventListener('pointerup', (event) => {
            const state = this.pointerState;
            if (!state || state.pointerId !== event.pointerId) return;
            if (!state.dragged) this.pickDirection(event.clientX, event.clientY);
            this.pointerState = null;
        });
        this.element.addEventListener('pointercancel', () => { this.pointerState = null; });
        window.addEventListener('resize', () => this.resize());
    }

    pickDirection(clientX, clientY) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.pointer, this.camera);
        const hit = this.raycaster.intersectObject(this.cube, false)[0];
        if (!hit?.face) return;

        const localPoint = this.cube.worldToLocal(hit.point.clone());
        const direction = hit.face.normal.clone();
        const primaryAxis = ['x', 'y', 'z'].reduce((best, axis) => (
            Math.abs(direction[axis]) > Math.abs(direction[best]) ? axis : best
        ), 'x');
        for (const axis of ['x', 'y', 'z']) {
            if (axis !== primaryAxis && Math.abs(localPoint[axis]) > 0.34) {
                direction[axis] = Math.sign(localPoint[axis]);
            }
        }
        this.options.onView(direction.normalize());
    }

    resize() {
        const width = Math.max(this.element.clientWidth, 1);
        const height = Math.max(this.element.clientHeight, 1);
        this.renderer.setSize(width, height, false);
    }

    update() {
        const orientation = this.options.getOrientation();
        if (orientation) this.cube.quaternion.copy(orientation);
        this.renderer.render(this.scene, this.camera);
    }
}
