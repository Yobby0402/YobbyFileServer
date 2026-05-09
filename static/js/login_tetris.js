(function () {
    const config = window.loginTetrisConfig || {};
    const maxChars = Number(config.passwordMaxLength) || 25;
    const cols = 10;
    const rows = 10;
    const pieceColors = ["#28c8ff", "#ffd166", "#6ff3c2", "#ff8f70", "#8878ff", "#ff63a6", "#39da92"];
    const pieceIcons = ["\uf07c", "\uf0ae", "\uf24e", "\uf275", "\uf542", "\uf1e6"];
    const shapes = [
        { name: "I", cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
        { name: "O", cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
        { name: "T", cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
        { name: "S", cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
        { name: "Z", cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
        { name: "J", cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
        { name: "L", cells: [[2, 0], [0, 1], [1, 1], [2, 1]] }
    ];

    const MatterApi = window.Matter;
    if (!MatterApi) {
        return;
    }

    const Engine = MatterApi.Engine;
    const World = MatterApi.World;
    const Bodies = MatterApi.Bodies;
    const Body = MatterApi.Body;
    const Sleeping = MatterApi.Sleeping;
    const Vector = MatterApi.Vector;

    function byId(id) {
        return document.getElementById(id);
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function lerp(start, end, amount) {
        return start + (end - start) * amount;
    }

    function easeOutCubic(value) {
        return 1 - Math.pow(1 - value, 3);
    }

    function easeInOutQuad(value) {
        return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
    }

    function hexToRgb(hex) {
        const normalized = String(hex || "").replace("#", "");
        if (normalized.length !== 6) {
            return { r: 255, g: 255, b: 255 };
        }
        return {
            r: parseInt(normalized.slice(0, 2), 16),
            g: parseInt(normalized.slice(2, 4), 16),
            b: parseInt(normalized.slice(4, 6), 16)
        };
    }

    function mixColor(base, target, amount) {
        return {
            r: Math.round(base.r + (target.r - base.r) * amount),
            g: Math.round(base.g + (target.g - base.g) * amount),
            b: Math.round(base.b + (target.b - base.b) * amount)
        };
    }

    function makeIconColor(color, alpha) {
        const rgb = mixColor(hexToRgb(color), { r: 255, g: 255, b: 255 }, 0.68);
        return "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + "," + alpha + ")";
    }

    function pickRandom(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    function readCssVar(name, fallback) {
        const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return value || fallback;
    }

    function rotateCells(cells, turns) {
        let result = cells.map(function (cell) { return { x: cell[0], y: cell[1] }; });
        for (let i = 0; i < turns; i += 1) {
            result = result.map(function (cell) {
                return { x: -cell.y, y: cell.x };
            });
            const minX = Math.min.apply(null, result.map(function (cell) { return cell.x; }));
            const minY = Math.min.apply(null, result.map(function (cell) { return cell.y; }));
            result = result.map(function (cell) {
                return { x: cell.x - minX, y: cell.y - minY };
            });
        }
        return result;
    }

    function normalizeCells(cells) {
        return cells.map(function (cell) {
            return Array.isArray(cell) ? { x: cell[0], y: cell[1] } : { x: cell.x, y: cell.y };
        });
    }

    function chooseClearColumns(cellCount) {
        const candidateColumns = [10, 8, 6, 5, 4, 7, 9];
        let best = { columns: 10, fullRows: 0, remainder: cellCount };

        candidateColumns.forEach(function (candidate) {
            if (candidate > cellCount) {
                return;
            }
            const fullRows = Math.floor(cellCount / candidate);
            const remainder = cellCount % candidate;
            if (
                fullRows > best.fullRows ||
                (fullRows === best.fullRows && remainder < best.remainder)
            ) {
                best = { columns: candidate, fullRows: fullRows, remainder: remainder };
            }
        });

        return best.columns;
    }

    function makeEmptyBoard() {
        return Array.from({ length: rows }, function () {
            return Array(cols).fill(null);
        });
    }

    function LoginTetrisScene(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.stageEl = canvas.parentElement;
        this.cellSize = 24;
        this.boardWidth = cols * this.cellSize;
        this.boardHeight = rows * this.cellSize;
        this.boardOffsetX = 0;
        this.boardOffsetY = 0;
        this.stagePadding = 20;
        this.dynamicBodies = [];
        this.settledPieces = [];
        this.particles = [];
        this.celebrationCells = [];
        this.flashBands = [];
        this.spawnQueue = 0;
        this.spawnCooldown = 0;
        this.pendingRedirect = null;
        this.successReady = false;
        this.onFailureComplete = null;
        this.mode = "idle";
        this.lastFrame = performance.now();
        this.successTimeline = null;
        this.pointerInsideStage = false;
        this.pointerColumn = null;

        this.engine = Engine.create({
            gravity: { x: 0, y: 1.08, scale: 0.0016 },
            enableSleeping: true
        });
        this.world = this.engine.world;
        this.bounds = { left: null, right: null, floor: null };

        this.resize();
        this.bindPointerTracking();
        window.addEventListener("resize", this.resize.bind(this));
        requestAnimationFrame(this.frame.bind(this));
    }

    LoginTetrisScene.prototype.bindPointerTracking = function () {
        this.stageEl.addEventListener("mouseenter", function () {
            this.pointerInsideStage = true;
        }.bind(this));
        this.stageEl.addEventListener("mouseleave", function () {
            this.pointerInsideStage = false;
            this.pointerColumn = null;
        }.bind(this));
        this.stageEl.addEventListener("mousemove", function (event) {
            const rect = this.canvas.getBoundingClientRect();
            const localX = event.clientX - rect.left;
            const boardX = localX - this.boardOffsetX;
            const column = clamp(Math.floor(boardX / this.cellSize), 0, cols - 1);
            this.pointerInsideStage = true;
            this.pointerColumn = column;
        }.bind(this));
    };

    LoginTetrisScene.prototype.resize = function () {
        const previous = {
            width: this.boardWidth,
            height: this.boardHeight,
            x: this.boardOffsetX,
            y: this.boardOffsetY
        };
        const bounds = this.stageEl.getBoundingClientRect();
        const width = Math.max(320, Math.floor(bounds.width));
        const height = Math.max(320, Math.floor(bounds.height));
        const ratio = window.devicePixelRatio || 1;

        this.canvas.width = Math.floor(width * ratio);
        this.canvas.height = Math.floor(height * ratio);
        this.canvas.style.width = width + "px";
        this.canvas.style.height = height + "px";
        this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

        this.stagePadding = Math.max(14, Math.floor(Math.min(width, height) * 0.035));
        const availableWidth = Math.max(200, width - this.stagePadding * 2);
        const availableHeight = Math.max(140, height - this.stagePadding * 2);
        this.cellSize = Math.max(18, Math.floor(Math.min(availableWidth / cols, availableHeight / rows)));
        this.boardWidth = this.cellSize * cols;
        this.boardHeight = rows * this.cellSize;
        this.boardOffsetX = Math.floor((width - this.boardWidth) / 2);
        this.boardOffsetY = Math.floor((height - this.boardHeight) / 2);

        if (previous.width > 0 && previous.height > 0) {
            const scaleX = this.boardWidth / previous.width;
            const scaleY = this.boardHeight / previous.height;
            this.dynamicBodies.forEach(function (body) {
                const relativeX = (body.position.x - previous.x) * scaleX;
                const relativeY = (body.position.y - previous.y) * scaleY;
                Body.setPosition(body, {
                    x: this.boardOffsetX + relativeX,
                    y: this.boardOffsetY + relativeY
                });
                Body.scale(body, scaleX, scaleY);
                Body.setVelocity(body, {
                    x: body.velocity.x * scaleX,
                    y: body.velocity.y * scaleY
                });
            }, this);
            this.rebuildSettledBodies();
        }

        this.rebuildBounds();
    };

    LoginTetrisScene.prototype.rebuildBounds = function () {
        const thickness = this.cellSize * 1.6;
        const centerX = this.boardOffsetX + this.boardWidth / 2;
        const centerY = this.boardOffsetY + this.boardHeight / 2;

        Object.keys(this.bounds).forEach(function (key) {
            if (this.bounds[key]) {
                World.remove(this.world, this.bounds[key]);
            }
        }, this);

        this.bounds.left = Bodies.rectangle(
            this.boardOffsetX - thickness / 2,
            centerY,
            thickness,
            this.boardHeight + thickness * 2,
            { isStatic: true, restitution: 0.06, friction: 0.9 }
        );
        this.bounds.right = Bodies.rectangle(
            this.boardOffsetX + this.boardWidth + thickness / 2,
            centerY,
            thickness,
            this.boardHeight + thickness * 2,
            { isStatic: true, restitution: 0.06, friction: 0.9 }
        );
        this.bounds.floor = Bodies.rectangle(
            centerX,
            this.boardOffsetY + this.boardHeight + thickness / 2,
            this.boardWidth + thickness * 2,
            thickness,
            { isStatic: true, restitution: 0.06, friction: 1.1 }
        );
        World.add(this.world, [
            this.bounds.left,
            this.bounds.right,
            this.bounds.floor
        ]);
    };

    LoginTetrisScene.prototype.queuePieces = function (count) {
        if (count <= 0) {
            return;
        }
        this.spawnQueue += count;
        if (this.mode === "idle") {
            this.mode = "building";
        }
    };

    LoginTetrisScene.prototype.gridToWorldCenter = function (gridX, gridY) {
        return {
            x: this.boardOffsetX + (gridX + 0.5) * this.cellSize,
            y: this.boardOffsetY + (gridY + 0.5) * this.cellSize
        };
    };

    LoginTetrisScene.prototype.getSettledOccupancy = function () {
        const occupied = Object.create(null);
        this.settledPieces.forEach(function (piece) {
            piece.cells.forEach(function (cell) {
                occupied[cell.x + "," + cell.y] = true;
            });
        });
        return occupied;
    };

    LoginTetrisScene.prototype.findSpawnColumn = function (cells, preferredColumn) {
        const width = Math.max.apply(null, cells.map(function (cell) { return cell.x; })) + 1;
        const maxColumn = Math.max(0, cols - width);
        const tried = Object.create(null);
        const candidates = [];

        function pushCandidate(column) {
            const clamped = clamp(column, 0, maxColumn);
            if (tried[clamped]) {
                return;
            }
            tried[clamped] = true;
            candidates.push(clamped);
        }

        if (preferredColumn != null) {
            pushCandidate(preferredColumn - Math.floor(width / 2));
            for (let distance = 1; distance <= cols; distance += 1) {
                pushCandidate(preferredColumn - Math.floor(width / 2) - distance);
                pushCandidate(preferredColumn - Math.floor(width / 2) + distance);
            }
        }

        while (candidates.length < maxColumn + 1) {
            pushCandidate(Math.floor(Math.random() * (maxColumn + 1)));
        }

        return candidates;
    };

    LoginTetrisScene.prototype.canSpawnAt = function (spawnX, spawnY, width, height) {
        const padding = this.cellSize * 0.85;
        const minX = spawnX - width * this.cellSize * 0.5 - padding;
        const maxX = spawnX + width * this.cellSize * 0.5 + padding;
        const minY = spawnY - height * this.cellSize * 0.5 - padding;
        const maxY = spawnY + height * this.cellSize * 0.75 + padding;

        return !this.dynamicBodies.some(function (body) {
            return body.parts.slice(1).some(function (part) {
                return (
                    part.position.x >= minX &&
                    part.position.x <= maxX &&
                    part.position.y >= minY &&
                    part.position.y <= maxY
                );
            });
        });
    };

    LoginTetrisScene.prototype.createPieceBody = function () {
        const shape = shapes[Math.floor(Math.random() * shapes.length)];
        const turns = Math.floor(Math.random() * 4);
        const rotatedCells = rotateCells(shape.cells, turns);
        const width = Math.max.apply(null, rotatedCells.map(function (cell) { return cell.x; })) + 1;
        const height = Math.max.apply(null, rotatedCells.map(function (cell) { return cell.y; })) + 1;
        const cellBodySize = this.cellSize * 0.92;
        const preferredColumn = this.pointerInsideStage && this.pointerColumn != null ? this.pointerColumn : null;
        const candidateColumns = this.findSpawnColumn(rotatedCells, preferredColumn);
        const spawnY = this.boardOffsetY - Math.max(this.cellSize * 1.7, height * this.cellSize * 0.55);
        let spawnCol = null;
        let spawnX = null;

        for (let i = 0; i < candidateColumns.length; i += 1) {
            const testCol = candidateColumns[i];
            const testX = this.boardOffsetX + (testCol + width / 2) * this.cellSize;
            if (this.canSpawnAt(testX, spawnY, width, height)) {
                spawnCol = testCol;
                spawnX = testX;
                break;
            }
        }

        if (spawnCol == null) {
            return null;
        }

        const color = pickRandom(pieceColors);
        const partBodies = rotatedCells.map(function (cell) {
            return Bodies.rectangle(
                spawnX + (cell.x - (width - 1) / 2) * this.cellSize,
                spawnY + (cell.y - (height - 1) / 2) * this.cellSize,
                cellBodySize,
                cellBodySize,
                {
                    chamfer: { radius: Math.max(4, this.cellSize * 0.16) },
                    friction: 0.95,
                    frictionStatic: 1.35,
                    restitution: 0.08,
                    density: 0.0015,
                    render: { fillStyle: color }
                }
            );
        }, this);

        const body = Body.create({
            parts: partBodies,
            friction: 0.9,
            frictionStatic: 1.2,
            frictionAir: 0.012,
            restitution: 0.08,
            sleepThreshold: 45
        });

        body.plugin.loginColor = color;
        body.plugin.iconGlyph = pickRandom(pieceIcons);
        body.plugin.shapeCells = rotatedCells;
        body.plugin.stableTime = 0;
        body.plugin.snapped = false;
        body.plugin.lifeTime = 0;
        body.plugin.enteredBoardAt = null;
        body.plugin.spawnColumn = spawnCol;
        if (preferredColumn != null) {
            Body.setVelocity(body, {
                x: 0,
                y: Math.random() * this.cellSize * 0.08
            });
            Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.12);
        } else {
            Body.setVelocity(body, {
                x: (Math.random() - 0.5) * this.cellSize * 0.32,
                y: Math.random() * this.cellSize * 0.08
            });
            Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.075);
        }
        return body;
    };

    LoginTetrisScene.prototype.createSettledBody = function (cells, color, iconGlyph) {
        const size = this.cellSize * 0.92;
        const parts = cells.map(function (cell) {
            const center = this.gridToWorldCenter(cell.x, cell.y);
            return Bodies.rectangle(center.x, center.y, size, size, {
                isStatic: true,
                chamfer: { radius: Math.max(4, this.cellSize * 0.16) },
                friction: 1.1,
                restitution: 0.02,
                render: { fillStyle: color }
            });
        }, this);

        const body = Body.create({
            parts: parts,
            isStatic: true,
            friction: 1.1,
            restitution: 0.02
        });
        body.plugin.loginColor = color;
        body.plugin.iconGlyph = iconGlyph;
        return body;
    };

    LoginTetrisScene.prototype.rebuildSettledBodies = function () {
        this.settledPieces.forEach(function (piece) {
            if (piece.body) {
                World.remove(this.world, piece.body);
            }
            piece.body = this.createSettledBody(piece.cells, piece.color, piece.iconGlyph);
            World.add(this.world, piece.body);
        }, this);
    };

    LoginTetrisScene.prototype.spawnPendingPieces = function (dt) {
        this.spawnCooldown -= dt;
        while (this.spawnQueue > 0 && this.spawnCooldown <= 0) {
            const body = this.createPieceBody();
            if (!body) {
                this.spawnCooldown = 0.08;
                break;
            }
            this.dynamicBodies.push(body);
            World.add(this.world, body);
            this.spawnQueue -= 1;
            this.spawnCooldown += 0.05;
        }
    };

    LoginTetrisScene.prototype.pruneEscapedBodies = function () {
        const minX = this.boardOffsetX - this.cellSize * 6;
        const maxX = this.boardOffsetX + this.boardWidth + this.cellSize * 6;
        const maxY = this.boardOffsetY + this.boardHeight + this.cellSize * 8;

        this.dynamicBodies = this.dynamicBodies.filter(function (body) {
            const escaped =
                body.position.x < minX ||
                body.position.x > maxX ||
                body.position.y > maxY;
            if (escaped) {
                World.remove(this.world, body);
                return false;
            }
            return true;
        }, this);
    };

    LoginTetrisScene.prototype.findDiscretePlacement = function (body) {
        const quarterTurn = Math.PI / 2;
        const turnCount = ((Math.round(body.angle / quarterTurn) % 4) + 4) % 4;
        const discreteCells = rotateCells(
            normalizeCells(body.plugin.shapeCells).map(function (cell) { return [cell.x, cell.y]; }),
            turnCount
        );
        const occupancy = this.getSettledOccupancy();

        const minCellX = Math.min.apply(null, discreteCells.map(function (cell) { return cell.x; }));
        const minCellY = Math.min.apply(null, discreteCells.map(function (cell) { return cell.y; }));
        const relativeParts = body.parts.slice(1).map(function (part) {
            return {
                x: clamp(Math.round((part.position.x - this.boardOffsetX) / this.cellSize - 0.5), 0, cols - 1),
                y: clamp(Math.round((part.position.y - this.boardOffsetY) / this.cellSize - 0.5), 0, rows - 1)
            };
        }, this);
        const avgGridX = relativeParts.reduce(function (sum, part) { return sum + part.x; }, 0) / Math.max(1, relativeParts.length);
        const avgGridY = relativeParts.reduce(function (sum, part) { return sum + part.y; }, 0) / Math.max(1, relativeParts.length);
        const baseX = clamp(Math.round(avgGridX - (minCellX + Math.max.apply(null, discreteCells.map(function (cell) { return cell.x; })) ) / 2), 0, cols - 1);
        const baseY = clamp(Math.round(avgGridY - (minCellY + Math.max.apply(null, discreteCells.map(function (cell) { return cell.y; })) ) / 2), 0, rows - 1);

        const candidates = [];
        for (let dy = -2; dy <= 6; dy += 1) {
            for (let dx = -6; dx <= 6; dx += 1) {
                candidates.push({
                    x: baseX + dx,
                    y: baseY + dy,
                    score: Math.abs(dx) + Math.abs(dy) * 0.85
                });
            }
        }
        candidates.sort(function (a, b) { return a.score - b.score; });

        for (let i = 0; i < candidates.length; i += 1) {
            let anchorX = candidates[i].x;
            let anchorY = candidates[i].y;
            let valid = true;
            let supported = false;

            for (let j = 0; j < discreteCells.length; j += 1) {
                const testX = anchorX + discreteCells[j].x;
                const testY = anchorY + discreteCells[j].y;
                if (testX < 0 || testX >= cols || testY < 0 || testY >= rows || occupancy[testX + "," + testY]) {
                    valid = false;
                    break;
                }
                if (testY === rows - 1 || occupancy[testX + "," + (testY + 1)]) {
                    supported = true;
                }
            }
            if (!valid || !supported) {
                continue;
            }

            return discreteCells.map(function (cell) {
                return { x: anchorX + cell.x, y: anchorY + cell.y };
            });
        }

        return null;
    };

    LoginTetrisScene.prototype.snapBodyToGrid = function (body) {
        const settledCells = this.findDiscretePlacement(body);
        if (!settledCells) {
            return false;
        }

        const occupancy = this.getSettledOccupancy();
        for (let i = 0; i < settledCells.length; i += 1) {
            if (occupancy[settledCells[i].x + "," + settledCells[i].y]) {
                return false;
            }
        }

        World.remove(this.world, body);
        this.dynamicBodies = this.dynamicBodies.filter(function (item) {
            return item !== body;
        });
        const piece = {
            cells: settledCells,
            color: body.plugin.loginColor || "#28c8ff",
            iconGlyph: body.plugin.iconGlyph || pieceIcons[0],
            body: null
        };
        piece.body = this.createSettledBody(piece.cells, piece.color, piece.iconGlyph);
        this.settledPieces.push(piece);
        World.add(this.world, piece.body);
        return true;
    };

    LoginTetrisScene.prototype.updateBodyStability = function (dt) {
        this.dynamicBodies.slice().forEach(function (body) {
            if (body.plugin.snapped) {
                return;
            }

            body.plugin.lifeTime = (body.plugin.lifeTime || 0) + dt;
            if (body.position.y >= this.boardOffsetY + this.cellSize * 0.5 && body.plugin.enteredBoardAt == null) {
                body.plugin.enteredBoardAt = body.plugin.lifeTime;
            }

            const stable = body.speed < 0.18 && Math.abs(body.angularSpeed) < 0.02;
            if (!stable) {
                body.plugin.stableTime = 0;
                const timeoutReached =
                    body.plugin.enteredBoardAt != null &&
                    body.plugin.lifeTime - body.plugin.enteredBoardAt > 2.2 &&
                    body.position.y > this.boardOffsetY + this.cellSize * 1.2;
                if (!timeoutReached) {
                    return;
                }
            }

            body.plugin.stableTime += dt;
            if (body.plugin.stableTime >= 0.18 || body.plugin.lifeTime > 4.2) {
                this.snapBodyToGrid(body);
            }
        }, this);
    };

    LoginTetrisScene.prototype.collectCurrentCells = function () {
        const cells = [];
        const seen = Object.create(null);
        this.settledPieces.forEach(function (piece) {
            piece.cells.forEach(function (cell) {
                const key = cell.x + "," + cell.y;
                if (seen[key]) {
                    return;
                }
                seen[key] = true;
                cells.push({ x: cell.x, y: cell.y, color: piece.color, iconGlyph: piece.iconGlyph || pieceIcons[0] });
            });
        });
        this.dynamicBodies.forEach(function (body) {
            const color = body.plugin.loginColor || "#28c8ff";
            for (let i = 1; i < body.parts.length; i += 1) {
                const part = body.parts[i];
                const x = clamp(Math.round((part.position.x - this.boardOffsetX) / this.cellSize - 0.5), 0, cols - 1);
                const y = clamp(Math.round((part.position.y - this.boardOffsetY) / this.cellSize - 0.5), 0, rows - 1);
                const key = x + "," + y;
                if (seen[key]) {
                    continue;
                }
                seen[key] = true;
                cells.push({ x: x, y: y, color: color, iconGlyph: body.plugin.iconGlyph || pieceIcons[0] });
            }
        }, this);
        return cells;
    };

    LoginTetrisScene.prototype.spawnExplosion = function (cells) {
        const center = {
            x: this.boardOffsetX + this.boardWidth / 2,
            y: this.boardOffsetY + this.boardHeight * 0.58
        };
        cells.forEach(function (cell) {
            const world = this.gridToWorldCenter(cell.x, cell.y);
            const dx = world.x - center.x;
            const dy = world.y - center.y;
            const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.9;
            const speed = this.cellSize * (9.5 + Math.random() * 6.5);
            const shardSize = this.cellSize * (0.4 + Math.random() * 0.26);
            this.particles.push({
                x: world.x,
                y: world.y,
                vx: Math.cos(angle) * speed + dx * 0.18,
                vy: Math.sin(angle) * speed + dy * 0.12 - this.cellSize * (2.8 + Math.random() * 1.6),
                size: shardSize,
                rotation: Math.random() * Math.PI * 2,
                vr: (Math.random() - 0.5) * (8 + Math.random() * 10),
                life: 0.95 + Math.random() * 0.38,
                age: 0,
                color: cell.color,
                glow: true,
                drag: 0.988 - Math.random() * 0.01,
                gravityScale: 0.9 + Math.random() * 0.35
            });
            for (let i = 0; i < 2; i += 1) {
                const sparkAngle = angle + (Math.random() - 0.5) * 1.4;
                const sparkSpeed = this.cellSize * (5.5 + Math.random() * 5.2);
                this.particles.push({
                    x: world.x,
                    y: world.y,
                    vx: Math.cos(sparkAngle) * sparkSpeed,
                    vy: Math.sin(sparkAngle) * sparkSpeed - this.cellSize * (1.1 + Math.random() * 0.8),
                    size: this.cellSize * (0.08 + Math.random() * 0.1),
                    rotation: Math.random() * Math.PI * 2,
                    vr: (Math.random() - 0.5) * 14,
                    life: 0.32 + Math.random() * 0.18,
                    age: 0,
                    color: i === 0 ? "#ffffff" : cell.color,
                    glow: false,
                    drag: 0.978 - Math.random() * 0.012,
                    gravityScale: 0.65 + Math.random() * 0.25
                });
            }
        }, this);
    };

    LoginTetrisScene.prototype.clearDynamicBodies = function () {
        this.dynamicBodies.forEach(function (body) {
            World.remove(this.world, body);
        }, this);
        this.dynamicBodies = [];
        this.settledPieces.forEach(function (piece) {
            if (piece.body) {
                World.remove(this.world, piece.body);
            }
        }, this);
        this.settledPieces = [];
    };

    LoginTetrisScene.prototype.playFailure = function () {
        const cells = this.collectCurrentCells();
        this.mode = "failure";
        this.spawnQueue = 0;
        this.spawnCooldown = 0;
        this.successReady = false;
        this.clearDynamicBodies();
        this.spawnExplosion(cells);
        this.failureDeadline = performance.now() + 900;
    };

    LoginTetrisScene.prototype.prepareSuccess = function (redirectUrl) {
        const cells = this.collectCurrentCells().sort(function (a, b) {
            if (a.y !== b.y) {
                return b.y - a.y;
            }
            return a.x - b.x;
        });
        const totalCells = cells.length;

        this.clearDynamicBodies();
        this.particles = [];
        this.flashBands = [];
        this.spawnQueue = 0;
        this.spawnCooldown = 0;
        this.mode = "success-arranging";
        this.pendingRedirect = redirectUrl;
        this.successReady = true;

        if (!totalCells) {
            window.setTimeout(function () {
                window.location.href = redirectUrl;
            }, 220);
            return;
        }

        const board = makeEmptyBoard();
        cells.forEach(function (cell) {
            board[cell.y][cell.x] = {
                color: cell.color,
                iconGlyph: cell.iconGlyph || pieceIcons[0]
            };
        });

        this.successTimeline = {
            startedAt: performance.now(),
            arrangeDuration: 420,
            board: board,
            displayCells: cells.map(function (cell) {
                return {
                    x: cell.x,
                    y: cell.y,
                        color: cell.color,
                        iconGlyph: cell.iconGlyph || pieceIcons[0],
                        alpha: 1,
                        scale: 1
                    };
            }),
            filler: null,
            clearRows: [],
            clearStartedAt: null,
            lastStepAt: performance.now(),
            finished: false
        };
    };

    LoginTetrisScene.prototype.rebuildDisplayCellsFromBoard = function (board) {
        const cells = [];
        for (let y = 0; y < rows; y += 1) {
            for (let x = 0; x < cols; x += 1) {
                if (board[y][x]) {
                    cells.push({
                        x: x,
                        y: y,
                        color: board[y][x].color,
                        iconGlyph: board[y][x].iconGlyph || pieceIcons[0],
                        alpha: 1,
                        scale: 1
                    });
                }
            }
        }
        return cells;
    };

    LoginTetrisScene.prototype.findFullRows = function (board) {
        const fullRows = [];
        for (let y = 0; y < rows; y += 1) {
            let full = true;
            for (let x = 0; x < cols; x += 1) {
                if (!board[y][x]) {
                    full = false;
                    break;
                }
            }
            if (full) {
                fullRows.push(y);
            }
        }
        return fullRows;
    };

    LoginTetrisScene.prototype.applyBoardGravity = function (board) {
        const next = makeEmptyBoard();
        for (let x = 0; x < cols; x += 1) {
            let writeY = rows - 1;
            for (let y = rows - 1; y >= 0; y -= 1) {
                if (board[y][x]) {
                    next[writeY][x] = board[y][x];
                    writeY -= 1;
                }
            }
        }
        return next;
    };

    LoginTetrisScene.prototype.getColumnHeights = function (board) {
        return Array.from({ length: cols }, function (_, x) {
            for (let y = 0; y < rows; y += 1) {
                if (board[y][x]) {
                    return rows - y;
                }
            }
            return 0;
        });
    };

    LoginTetrisScene.prototype.isBoardEmpty = function (board) {
        for (let y = 0; y < rows; y += 1) {
            for (let x = 0; x < cols; x += 1) {
                if (board[y][x]) {
                    return false;
                }
            }
        }
        return true;
    };

    LoginTetrisScene.prototype.planNextFiller = function (timeline) {
        const board = timeline.board;
        const heights = this.getColumnHeights(board);
        const maxHeight = Math.max.apply(null, heights);
        if (maxHeight <= 0) {
            return null;
        }

        let targetColumn = -1;
        let targetHeight = -1;
        for (let x = 0; x < cols; x += 1) {
            if (heights[x] < maxHeight && heights[x] > targetHeight) {
                targetColumn = x;
                targetHeight = heights[x];
            }
        }

        if (targetColumn === -1) {
            for (let x = 0; x < cols; x += 1) {
                if (heights[x] === maxHeight) {
                    continue;
                }
                targetColumn = x;
                break;
            }
        }

        if (targetColumn === -1) {
            return null;
        }

        const targetY = rows - heights[targetColumn] - 1;
        return {
            x: targetColumn,
            y: targetY,
            color: pickRandom(pieceColors),
            iconGlyph: pickRandom(pieceIcons),
            progress: 0
        };
    };

    LoginTetrisScene.prototype.updateSuccess = function (now) {
        const timeline = this.successTimeline;
        if (!timeline || timeline.finished) {
            return;
        }

        const arrangeProgress = clamp((now - timeline.startedAt) / timeline.arrangeDuration, 0, 1);
        if (arrangeProgress < 1) {
            this.celebrationCells = timeline.displayCells.map(function (cell) {
                return {
                    x: cell.x,
                    y: lerp(cell.y - 0.6, cell.y, easeOutCubic(arrangeProgress)),
                    color: cell.color,
                    iconGlyph: cell.iconGlyph || pieceIcons[0],
                    alpha: 1,
                    scale: 0.96 + arrangeProgress * 0.04
                };
            });
            return;
        }

        if (timeline.clearRows.length) {
            if (!timeline.clearStartedAt) {
                timeline.clearStartedAt = now;
            }
            const progress = clamp((now - timeline.clearStartedAt) / 150, 0, 1);
            const rowsToClear = timeline.clearRows;
            this.celebrationCells = timeline.displayCells
                .filter(function (cell) {
                    return rowsToClear.indexOf(cell.y) === -1;
                })
                .concat(
                    timeline.displayCells
                        .filter(function (cell) { return rowsToClear.indexOf(cell.y) !== -1; })
                        .map(function (cell) {
                            return {
                                x: cell.x,
                                y: cell.y,
                                color: cell.color,
                                iconGlyph: cell.iconGlyph || pieceIcons[0],
                                alpha: 1 - easeInOutQuad(progress),
                                scale: 1 + progress * 0.28
                            };
                        })
                );

            if (progress >= 1) {
                rowsToClear.forEach(function (rowY) {
                    this.flashBands.push({ y: rowY, age: 0, life: 0.22 });
                }, this);
                rowsToClear.forEach(function (rowY) {
                    for (let x = 0; x < cols; x += 1) {
                        if (!timeline.board[rowY][x]) {
                            continue;
                        }
                        const center = this.gridToWorldCenter(x, rowY);
                        this.particles.push({
                            x: center.x,
                            y: center.y,
                            vx: (Math.random() - 0.5) * 240,
                            vy: -150 + Math.random() * 70,
                            size: this.cellSize * (0.12 + Math.random() * 0.18),
                            rotation: Math.random() * Math.PI * 2,
                            vr: (Math.random() - 0.5) * 11,
                            life: 0.32 + Math.random() * 0.18,
                            age: 0,
                            color: "#ffffff",
                            glow: false
                        });
                    }
                }, this);

                const clearedBoard = makeEmptyBoard();
                for (let y = 0; y < rows; y += 1) {
                    if (rowsToClear.indexOf(y) !== -1) {
                        continue;
                    }
                    clearedBoard[y] = timeline.board[y].slice();
                }
                timeline.board = this.applyBoardGravity(clearedBoard);
                timeline.displayCells = this.rebuildDisplayCellsFromBoard(timeline.board);
                timeline.clearRows = [];
                timeline.clearStartedAt = null;
            }
            return;
        }

        if (timeline.filler) {
            timeline.filler.progress = clamp(timeline.filler.progress + 0.32, 0, 1);
            const fillerY = lerp(-1.2, timeline.filler.y, easeOutCubic(timeline.filler.progress));
            this.celebrationCells = timeline.displayCells.map(function (cell) {
                return {
                    x: cell.x,
                    y: cell.y,
                    color: cell.color,
                    iconGlyph: cell.iconGlyph || pieceIcons[0],
                    alpha: 1,
                    scale: 1
                };
            }).concat([{
                x: timeline.filler.x,
                y: fillerY,
                color: timeline.filler.color,
                iconGlyph: timeline.filler.iconGlyph || pieceIcons[0],
                alpha: 1,
                scale: 1
            }]);

            if (timeline.filler.progress >= 1) {
                timeline.board[timeline.filler.y][timeline.filler.x] = {
                    color: timeline.filler.color,
                    iconGlyph: timeline.filler.iconGlyph || pieceIcons[0]
                };
                timeline.displayCells = this.rebuildDisplayCellsFromBoard(timeline.board);
                timeline.filler = null;
                timeline.lastStepAt = now;
                timeline.clearRows = this.findFullRows(timeline.board);
            }
            return;
        }

        if (this.isBoardEmpty(timeline.board)) {
            timeline.finished = true;
            this.successReady = false;
            window.setTimeout(function () {
                window.location.href = this.pendingRedirect || config.redirectUrl || "/";
            }.bind(this), 220);
            return;
        }

        this.celebrationCells = timeline.displayCells.map(function (cell) {
            return {
                x: cell.x,
                y: cell.y,
                color: cell.color,
                iconGlyph: cell.iconGlyph || pieceIcons[0],
                alpha: 1,
                scale: 1
            };
        });

        if (now - timeline.lastStepAt < 70) {
            return;
        }

        timeline.clearRows = this.findFullRows(timeline.board);
        if (timeline.clearRows.length) {
            timeline.clearStartedAt = now;
            return;
        }

        timeline.filler = this.planNextFiller(timeline);
        if (!timeline.filler) {
            timeline.finished = true;
            this.successReady = false;
            window.setTimeout(function () {
                window.location.href = this.pendingRedirect || config.redirectUrl || "/";
            }.bind(this), 220);
        }
    };

    LoginTetrisScene.prototype.skipSuccessAnimation = function () {
        if (!this.successReady) {
            return false;
        }
        this.successReady = false;
        window.location.href = this.pendingRedirect || config.redirectUrl || "/";
        return true;
    };

    LoginTetrisScene.prototype.updateParticles = function (dt) {
        for (let i = this.particles.length - 1; i >= 0; i -= 1) {
            const particle = this.particles[i];
            particle.age += dt;
            particle.vy += this.cellSize * 11 * (particle.gravityScale || 1) * dt;
            particle.x += particle.vx * dt;
            particle.y += particle.vy * dt;
            particle.rotation += particle.vr * dt;
            particle.vx *= particle.drag || 0.992;
            particle.vy *= (particle.drag || 0.992) + 0.002;
            if (particle.age >= particle.life) {
                this.particles.splice(i, 1);
            }
        }

        for (let i = this.flashBands.length - 1; i >= 0; i -= 1) {
            const band = this.flashBands[i];
            band.age += dt;
            if (band.age >= band.life) {
                this.flashBands.splice(i, 1);
            }
        }
    };

    LoginTetrisScene.prototype.updateFailure = function (now) {
        if (!this.failureDeadline) {
            return;
        }
        if (now >= this.failureDeadline) {
            this.clearDynamicBodies();
            this.failureDeadline = null;
            this.mode = "idle";
            if (typeof this.onFailureComplete === "function") {
                const callback = this.onFailureComplete;
                this.onFailureComplete = null;
                callback();
            }
        }
    };

    LoginTetrisScene.prototype.drawBackground = function () {
        const ctx = this.ctx;
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        ctx.clearRect(0, 0, width, height);

        const borderColor = readCssVar("--t-border", "rgba(120,140,160,0.24)");
        const gridColor = readCssVar("--t-border-light", "rgba(120,140,160,0.14)");
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 1.4;
        ctx.strokeRect(this.boardOffsetX + 0.5, this.boardOffsetY + 0.5, this.boardWidth - 1, this.boardHeight - 1);
        for (let x = 0; x <= cols; x += 1) {
            ctx.strokeStyle = gridColor;
            ctx.beginPath();
            ctx.moveTo(this.boardOffsetX + x * this.cellSize + 0.5, this.boardOffsetY);
            ctx.lineTo(this.boardOffsetX + x * this.cellSize + 0.5, this.boardOffsetY + this.boardHeight);
            ctx.stroke();
        }
        for (let y = 0; y <= rows; y += 1) {
            ctx.strokeStyle = gridColor;
            ctx.beginPath();
            ctx.moveTo(this.boardOffsetX, this.boardOffsetY + y * this.cellSize + 0.5);
            ctx.lineTo(this.boardOffsetX + this.boardWidth, this.boardOffsetY + y * this.cellSize + 0.5);
            ctx.stroke();
        }
    };

    LoginTetrisScene.prototype.drawRoundedCell = function (x, y, size, color, alpha) {
        const ctx = this.ctx;
        const radius = Math.max(5, size * 0.17);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + size, y, x + size, y + size, radius);
        ctx.arcTo(x + size, y + size, x, y + size, radius);
        ctx.arcTo(x, y + size, x, y, radius);
        ctx.arcTo(x, y, x + size, y, radius);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(255,255,255,0.23)";
        ctx.fillRect(x + 3, y + 3, size - 6, Math.max(4, size * 0.16));
        ctx.fillStyle = "rgba(0,0,0,0.1)";
        ctx.fillRect(x + 3, y + size - Math.max(4, size * 0.14), size - 6, Math.max(3, size * 0.12));
        ctx.restore();
    };

    LoginTetrisScene.prototype.drawCellIcon = function (centerX, centerY, size, glyph, alpha, color) {
        if (!glyph) {
            return;
        }
        const ctx = this.ctx;
        const glowColor = color || "#ffffff";
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.font = "900 " + Math.max(12, size * 0.7) + "px 'Font Awesome 5 Free', FontAwesome";
        ctx.lineWidth = Math.max(1.2, size * 0.038);
        ctx.strokeStyle = "rgba(255,255,255,0.24)";
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = Math.max(10, size * 0.34);
        ctx.strokeText(glyph, centerX, centerY + size * 0.03);
        ctx.fillStyle = makeIconColor(glowColor, 0.98);
        ctx.fillText(glyph, centerX, centerY + size * 0.03);
        ctx.restore();
    };

    LoginTetrisScene.prototype.drawPartPolygon = function (part, color, alpha, glyph) {
        const center = part.position;
        this.drawCellIcon(center.x, center.y, this.cellSize * 0.92, glyph, alpha, color);
    };

    LoginTetrisScene.prototype.drawBodies = function () {
        this.settledPieces.forEach(function (piece) {
            piece.cells.forEach(function (cell) {
                const world = this.gridToWorldCenter(cell.x, cell.y);
                const size = this.cellSize * 0.92;
                this.drawCellIcon(world.x, world.y, size, piece.iconGlyph, 1, piece.color);
            }, this);
        }, this);
        this.dynamicBodies.forEach(function (body) {
            const color = body.plugin.loginColor || "#28c8ff";
            const glyph = body.plugin.iconGlyph || pieceIcons[0];
            for (let i = 1; i < body.parts.length; i += 1) {
                this.drawPartPolygon(body.parts[i], color, 1, glyph);
            }
        }, this);
    };

    LoginTetrisScene.prototype.drawCelebration = function () {
        this.celebrationCells.forEach(function (cell) {
            const alpha = cell.alpha == null ? 1 : cell.alpha;
            if (alpha <= 0.01) {
                return;
            }
            const px = this.boardOffsetX + cell.currentX * this.cellSize;
            const py = this.boardOffsetY + cell.currentY * this.cellSize;
            const drawX = cell.x != null ? cell.x : cell.currentX;
            const drawY = cell.y != null ? cell.y : cell.currentY;
            const size = this.cellSize * (cell.scale || cell.sizeScale || 1);
            const centerX = this.boardOffsetX + drawX * this.cellSize + this.cellSize / 2;
            const centerY = this.boardOffsetY + drawY * this.cellSize + this.cellSize / 2;
            this.drawCellIcon(centerX, centerY, size, cell.iconGlyph || pieceIcons[0], alpha, cell.color);
        }, this);
    };

    LoginTetrisScene.prototype.drawFlashBands = function () {
        const ctx = this.ctx;
        this.flashBands.forEach(function (band) {
            const alpha = clamp(1 - band.age / band.life, 0, 1);
            const py = this.boardOffsetY + band.y * this.cellSize;
            const gradient = ctx.createLinearGradient(this.boardOffsetX, py, this.boardOffsetX + this.boardWidth, py);
            gradient.addColorStop(0, "rgba(255,255,255,0)");
            gradient.addColorStop(0.18, "rgba(255,255,255," + (alpha * 0.24) + ")");
            gradient.addColorStop(0.5, "rgba(110,224,255," + (alpha * 0.5) + ")");
            gradient.addColorStop(0.82, "rgba(255,255,255," + (alpha * 0.24) + ")");
            gradient.addColorStop(1, "rgba(255,255,255,0)");
            ctx.fillStyle = gradient;
            ctx.fillRect(this.boardOffsetX, py, this.boardWidth, this.cellSize);
        }, this);
    };

    LoginTetrisScene.prototype.drawParticles = function () {
        const ctx = this.ctx;
        this.particles.forEach(function (particle) {
            const lifeRatio = clamp(particle.age / particle.life, 0, 1);
            const alpha = 1 - Math.pow(lifeRatio, 1.55);
            ctx.save();
            ctx.translate(particle.x, particle.y);
            ctx.rotate(particle.rotation);
            ctx.globalAlpha = alpha;
            ctx.fillStyle = particle.color;
            if (particle.glow) {
                ctx.shadowColor = particle.color;
                ctx.shadowBlur = 16;
            }
            if (particle.glow) {
                ctx.fillRect(-particle.size / 2, -particle.size / 2, particle.size, particle.size);
            } else {
                ctx.fillRect(-particle.size / 2, -particle.size / 3, particle.size, particle.size * 0.66);
            }
            ctx.restore();
        });
    };

    LoginTetrisScene.prototype.frame = function (now) {
        const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
        this.lastFrame = now;

        if (this.mode === "building" || this.mode === "idle") {
            this.spawnPendingPieces(dt);
            Engine.update(this.engine, dt * 1000);
            this.updateBodyStability(dt);
            this.pruneEscapedBodies();
            if (this.mode === "building" && !this.spawnQueue && !this.dynamicBodies.length) {
                this.mode = "idle";
            }
        } else if (this.mode === "failure") {
            Engine.update(this.engine, dt * 1000);
            this.pruneEscapedBodies();
            this.updateFailure(now);
        } else if (this.mode === "success-arranging") {
            this.updateSuccess(now);
        }

        this.updateParticles(dt);
        this.drawBackground();
        this.drawBodies();
        this.drawCelebration();
        this.drawFlashBands();
        this.drawParticles();
        requestAnimationFrame(this.frame.bind(this));
    };

    document.addEventListener("DOMContentLoaded", function () {
        const form = byId("loginForm");
        const passwordInput = byId("password");
        const button = byId("loginButton");
        const errorEl = byId("loginError");
        const errorTextEl = byId("loginErrorText");
        const canvas = byId("tetrisCanvas");

        if (!form || !passwordInput || !button || !canvas) {
            return;
        }

        const scene = new LoginTetrisScene(canvas);
        let previousLength = passwordInput.value.length;

        function showError(message) {
            errorTextEl.textContent = message;
            errorEl.classList.remove("d-none");
        }

        function clearError() {
            errorTextEl.textContent = "";
            errorEl.classList.add("d-none");
        }

        function setButtonLoadingMode() {
            button.disabled = false;
            button.innerHTML = '<i class="fa fa-forward mr-2"></i>跳过动画并进入';
        }

        function resetButtonMode() {
            button.disabled = false;
            button.innerHTML = '<i class="fa fa-sign-in mr-2"></i>登录';
        }

        passwordInput.addEventListener("input", function () {
            const currentLength = passwordInput.value.length;
            const delta = currentLength - previousLength;
            previousLength = currentLength;
            if (delta > 0) {
                scene.queuePieces(delta);
            }
            clearError();
        });

        form.addEventListener("submit", function (event) {
            event.preventDefault();
            clearError();

            if (scene.skipSuccessAnimation()) {
                return;
            }

            const password = passwordInput.value || "";
            if (!password) {
                showError("请输入密码");
                return;
            }
            if (password.length > maxChars) {
                showError("密码长度超过限制");
                return;
            }

            button.disabled = true;
            passwordInput.disabled = true;

            const body = new URLSearchParams();
            body.set("password", password);

            fetch(config.loginUrl || form.action, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Accept": "application/json",
                    "X-Requested-With": "XMLHttpRequest"
                },
                body: body.toString(),
                credentials: "same-origin"
            })
                .then(function (response) {
                    return response.json().catch(function () {
                        return { ok: false, error: "登录响应解析失败" };
                    });
                })
                .then(function (data) {
                    if (data && data.ok) {
                        scene.prepareSuccess(data.redirect || config.redirectUrl || "/");
                        setButtonLoadingMode();
                        return;
                    }

                    scene.playFailure();
                    showError((data && data.error) || "密码错误");
                    passwordInput.value = "";
                    previousLength = 0;
                    scene.onFailureComplete = function () {
                        resetButtonMode();
                        passwordInput.disabled = false;
                        passwordInput.focus();
                    };
                })
                .catch(function () {
                    showError("登录请求失败，请稍后重试");
                    resetButtonMode();
                    passwordInput.disabled = false;
                });
        });
    });
})();
