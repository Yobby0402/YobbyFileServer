(function () {
    "use strict";

    const modules = window.GamesHubModules;
    if (!modules || typeof modules.register !== "function") {
        return;
    }

    function create2048Session() {
        const session = {
            sessionKey: "g2048-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            score: 0,
            moves: 0,
            maxTile: 2,
            status: "playing",
            startedAt: Date.now(),
            elapsedSeconds: 0,
            submittedScore: false,
            nextTileId: 1,
            tiles: []
        };
        spawn2048Tile(session);
        spawn2048Tile(session);
        return session;
    }

    function normalize2048Session(raw) {
        if (!raw || !Array.isArray(raw.tiles) || !raw.tiles.length) {
            return create2048Session();
        }
        const normalizedStatus = raw.status === "over" ? "over" : "playing";
        const normalizedElapsed = Math.max(0, Number(raw.elapsedSeconds || 0));
        return {
            sessionKey: String(raw.sessionKey || ("g2048-" + Date.now())),
            score: Math.max(0, Number(raw.score || 0)),
            moves: Math.max(0, Number(raw.moves || 0)),
            maxTile: Math.max(2, Number(raw.maxTile || 2)),
            status: normalizedStatus,
            startedAt: normalizedStatus === "playing"
                ? (Date.now() - normalizedElapsed * 1000)
                : Number(raw.startedAt || Date.now()),
            elapsedSeconds: normalizedElapsed,
            submittedScore: Boolean(raw.submittedScore),
            nextTileId: Math.max(1, Number(raw.nextTileId || 1)),
            tiles: raw.tiles.map(function (tile) {
                return {
                    id: String(tile.id || ("tile-" + Math.random().toString(36).slice(2))),
                    row: Math.max(0, Math.min(3, Number(tile.row || 0))),
                    col: Math.max(0, Math.min(3, Number(tile.col || 0))),
                    value: Math.max(2, Number(tile.value || 2))
                };
            }).slice(0, 16)
        };
    }

    function sync2048Clock(session) {
        if (session.status === "playing") {
            session.elapsedSeconds = Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
        }
    }

    function serialize2048Session(session) {
        sync2048Clock(session);
        return {
            sessionKey: session.sessionKey,
            score: session.score,
            moves: session.moves,
            maxTile: session.maxTile,
            status: session.status,
            startedAt: session.startedAt,
            elapsedSeconds: session.elapsedSeconds,
            submittedScore: session.submittedScore,
            nextTileId: session.nextTileId,
            tiles: session.tiles.map(function (tile) {
                return { id: tile.id, row: tile.row, col: tile.col, value: tile.value };
            })
        };
    }

    function summarize2048Session(session) {
        sync2048Clock(session);
        return {
            score: session.score,
            max_tile: session.maxTile,
            moves: session.moves,
            status: session.status,
            elapsed_seconds: session.elapsedSeconds
        };
    }

    function spawn2048Tile(session) {
        const occupied = {};
        session.tiles.forEach(function (tile) {
            occupied[tile.row + ":" + tile.col] = true;
        });
        const cells = [];
        for (let row = 0; row < 4; row += 1) {
            for (let col = 0; col < 4; col += 1) {
                if (!occupied[row + ":" + col]) {
                    cells.push({ row: row, col: col });
                }
            }
        }
        if (!cells.length) {
            return;
        }
        const cell = cells[Math.floor(Math.random() * cells.length)];
        session.tiles.push({
            id: "t" + session.nextTileId,
            row: cell.row,
            col: cell.col,
            value: Math.random() < 0.88 ? 2 : 4,
            newNow: true
        });
        session.nextTileId += 1;
    }

    function get2048Lines(direction) {
        const lines = [];
        for (let index = 0; index < 4; index += 1) {
            const line = [];
            for (let offset = 0; offset < 4; offset += 1) {
                if (direction === "left") {
                    line.push({ row: index, col: offset });
                } else if (direction === "right") {
                    line.push({ row: index, col: 3 - offset });
                } else if (direction === "up") {
                    line.push({ row: offset, col: index });
                } else {
                    line.push({ row: 3 - offset, col: index });
                }
            }
            lines.push(line);
        }
        return lines;
    }

    function move2048Session(session, direction) {
        const byCell = {};
        session.tiles.forEach(function (tile) {
            byCell[tile.row + ":" + tile.col] = tile;
            delete tile.mergedNow;
            delete tile.newNow;
        });
        let moved = false;
        let scoreDelta = 0;
        const nextTiles = [];

        get2048Lines(direction).forEach(function (line) {
            const sourceTiles = line.map(function (cell) {
                return byCell[cell.row + ":" + cell.col];
            }).filter(Boolean);
            const merged = [];
            for (let index = 0; index < sourceTiles.length; index += 1) {
                const tile = sourceTiles[index];
                const next = sourceTiles[index + 1];
                if (next && next.value === tile.value) {
                    const value = tile.value * 2;
                    merged.push({
                        id: tile.id,
                        row: 0,
                        col: 0,
                        value: value,
                        mergedNow: true
                    });
                    scoreDelta += value;
                    index += 1;
                } else {
                    merged.push({
                        id: tile.id,
                        row: 0,
                        col: 0,
                        value: tile.value
                    });
                }
            }
            merged.forEach(function (tile, index) {
                tile.row = line[index].row;
                tile.col = line[index].col;
                nextTiles.push(tile);
                const oldTile = byCell[tile.id] || session.tiles.find(function (item) { return item.id === tile.id; });
                if (!oldTile || oldTile.row !== tile.row || oldTile.col !== tile.col || tile.mergedNow) {
                    moved = true;
                }
            });
        });

        if (!moved) {
            return false;
        }
        session.tiles = nextTiles;
        session.score += scoreDelta;
        session.moves += 1;
        session.maxTile = Math.max.apply(null, session.tiles.map(function (tile) { return tile.value; }).concat([session.maxTile]));
        spawn2048Tile(session);
        sync2048Clock(session);
        if (!canMove2048(session.tiles)) {
            session.status = "over";
        }
        return true;
    }

    function canMove2048(tiles) {
        if (tiles.length < 16) {
            return true;
        }
        const matrix = [];
        for (let row = 0; row < 4; row += 1) {
            matrix[row] = [0, 0, 0, 0];
        }
        tiles.forEach(function (tile) {
            matrix[tile.row][tile.col] = tile.value;
        });
        for (let row = 0; row < 4; row += 1) {
            for (let col = 0; col < 4; col += 1) {
                const value = matrix[row][col];
                if (row < 3 && matrix[row + 1][col] === value) {
                    return true;
                }
                if (col < 3 && matrix[row][col + 1] === value) {
                    return true;
                }
            }
        }
        return false;
    }

    function get2048TileColors(value) {
        const map = {
            2: ["#f8fafc", "#111827"],
            4: ["#dbeafe", "#1d4ed8"],
            8: ["#93c5fd", "#0f172a"],
            16: ["#60a5fa", "#0f172a"],
            32: ["#38bdf8", "#082f49"],
            64: ["#2dd4bf", "#042f2e"],
            128: ["#34d399", "#052e16"],
            256: ["#a3e635", "#1f2937"],
            512: ["#facc15", "#422006"],
            1024: ["#fb7185", "#4c0519"],
            2048: ["#f472b6", "#4a044e"]
        };
        return map[value] || ["#e879f9", "#3b0764"];
    }

    function mount2048(savedPayload, ctx) {
        let session = normalize2048Session((savedPayload && savedPayload.state) || {});
        const tileMap = Object.create(null);
        let timerId = null;
        const helpConfig2048 = {
            title: "2048",
            subtitle: "合并数字、控制棋盘空间，尽量把局面滚大。",
            bullets: [
                "操作：方向键或 WASD 一次推动整盘数字。",
                "相同数字相撞会合并，连锁越顺，分数涨得越快。",
                "真正稀缺的是可操作空间，不只是大数字。",
                "本局会自动保存，随时可以关闭页面，下次继续。"
            ],
            hint: "优先保持角落和边线稳定，再考虑高数字的合并路线。"
        };

        ctx.addStageButton("重新开始", function () {
            finalizeScoreIfNeeded("restart").finally(function () {
                session = create2048Session();
                render();
                persist();
            });
        }, true);

        const shell = document.createElement("div");
        shell.className = "game-2048-shell";
        shell.innerHTML = [
            '<div class="game-2048-top">',
            "  <div>",
            '    <div class="games-section-title">操作方式</div>',
            '    <div class="games-stage-meta">方向键或 WASD 控制移动，分数、用时和进度会自动保存。</div>',
            "  </div>",
            '  <div class="game-stat-grid">',
            '    <div class="game-stat-card"><div class="game-stat-label">分数</div><div class="game-stat-value" id="game2048Score">0</div></div>',
            '    <div class="game-stat-card"><div class="game-stat-label">最大块</div><div class="game-stat-value" id="game2048Max">0</div></div>',
            '    <div class="game-stat-card"><div class="game-stat-label">步数</div><div class="game-stat-value" id="game2048Moves">0</div></div>',
            '    <div class="game-stat-card"><div class="game-stat-label">用时</div><div class="game-stat-value" id="game2048Time">00:00</div></div>',
            "  </div>",
            "</div>",
            '<div class="games-stage-meta" id="game2048StatusLine"></div>',
            '<div class="game-2048-board game-start-host" id="game2048Board"><div class="game-2048-grid" id="game2048Grid"></div><div class="game-2048-tile-layer" id="game2048TileLayer"></div></div>'
        ].join("");
        ctx.els.stageBody.appendChild(shell);

        const localStatGrid = shell.querySelector(".game-stat-grid");
        const scoreEl = shell.querySelector("#game2048Score");
        const maxEl = shell.querySelector("#game2048Max");
        const movesEl = shell.querySelector("#game2048Moves");
        const timeEl = shell.querySelector("#game2048Time");
        const statusEl = shell.querySelector("#game2048StatusLine");
        const boardHost = shell.querySelector("#game2048Board");
        const gridEl = shell.querySelector("#game2048Grid");
        const tileLayerEl = shell.querySelector("#game2048TileLayer");
        let introShownAt = Date.now();
        let introActive = true;

        ctx.addStageButton("帮助", function () {
            ctx.openGameInfoOverlay(boardHost, helpConfig2048);
        }, false);

        if (localStatGrid) {
            localStatGrid.hidden = true;
        }

        for (let i = 0; i < 16; i += 1) {
            const bg = document.createElement("div");
            bg.className = "game-2048-cell-bg";
            gridEl.appendChild(bg);
        }

        function persist() {
            ctx.scheduleGameStateSave("2048", serialize2048Session(session), summarize2048Session(session));
        }

        function render() {
            sync2048Clock(session);
            scoreEl.textContent = String(session.score);
            maxEl.textContent = String(session.maxTile);
            movesEl.textContent = String(session.moves);
            timeEl.textContent = ctx.formatSeconds(session.elapsedSeconds);
            ctx.setStageStats([
                { label: "分数", value: String(session.score) },
                { label: "最大块", value: String(session.maxTile) },
                { label: "步数", value: String(session.moves) },
                { label: "用时", value: ctx.formatSeconds(session.elapsedSeconds) }
            ]);
            statusEl.textContent = session.status === "over" ? "本局结束，成绩已保存。" : "进度会自动保存。";
            ctx.syncPresence(session.status === "over" ? "2048 结算中" : "正在玩 2048", "");

            const activeIds = {};
            session.tiles.forEach(function (tile) {
                activeIds[tile.id] = true;
                let tileEl = tileMap[tile.id];
                if (!tileEl) {
                    tileEl = document.createElement("div");
                    tileEl.className = "game-2048-tile";
                    tileMap[tile.id] = tileEl;
                    tileLayerEl.appendChild(tileEl);
                }
                const colors = get2048TileColors(tile.value);
                tileEl.textContent = String(tile.value);
                tileEl.style.setProperty("--row", tile.row);
                tileEl.style.setProperty("--col", tile.col);
                tileEl.style.background = colors[0];
                tileEl.style.color = colors[1];
                tileEl.classList.remove("is-new", "is-merged");
                if (tile.newNow) {
                    tileEl.classList.add("is-new");
                }
                if (tile.mergedNow) {
                    tileEl.classList.add("is-merged");
                }
            });

            Object.keys(tileMap).forEach(function (key) {
                if (!activeIds[key]) {
                    tileMap[key].remove();
                    delete tileMap[key];
                }
            });

            window.setTimeout(function () {
                session.tiles.forEach(function (tile) {
                    delete tile.newNow;
                    delete tile.mergedNow;
                });
                Object.keys(tileMap).forEach(function (key) {
                    tileMap[key].classList.remove("is-new", "is-merged");
                });
            }, 220);
        }

        function finalizeScoreIfNeeded(reason) {
            sync2048Clock(session);
            if (session.submittedScore || session.score <= 0) {
                return Promise.resolve();
            }
            session.submittedScore = true;
            return ctx.submitScore("2048", session.score, "standard", session.sessionKey, {
                mode_key: "2048-standard",
                elapsed_seconds: session.elapsedSeconds,
                max_tile: session.maxTile,
                moves: session.moves,
                reason: reason
            }).catch(function (error) {
                session.submittedScore = false;
                ctx.setStatus(error.message || "2048 成绩提交失败", true);
            });
        }

        function move(direction) {
            if (session.status === "over") {
                return;
            }
            if (!move2048Session(session, direction)) {
                return;
            }
            render();
            persist();
            if (session.status === "over") {
                finalizeScoreIfNeeded("game_over");
            }
        }

        function keyHandler(event) {
            if (ctx.state.activeGameId !== "2048" || introActive) {
                return;
            }
            const map = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", a: "left", s: "down", d: "right", W: "up", A: "left", S: "down", D: "right" };
            if (!map[event.key]) {
                return;
            }
            event.preventDefault();
            move(map[event.key]);
        }

        document.addEventListener("keydown", keyHandler);
        timerId = window.setInterval(function () {
            if (ctx.state.activeGameId === "2048") {
                render();
            }
        }, 1000);

        ctx.createGameStartOverlay(boardHost, Object.assign({}, helpConfig2048, {
            buttonLabel: session.moves > 0 || session.elapsedSeconds > 0 ? "继续本局" : "开始游戏",
            useStageActionButton: true,
            onStart: function () {
                introActive = false;
                session.startedAt += Date.now() - introShownAt;
                render();
                persist();
            }
        }));

        render();
        persist();

        return function cleanup() {
            document.removeEventListener("keydown", keyHandler);
            if (timerId) {
                window.clearInterval(timerId);
            }
            persist();
            if (session.status === "over") {
                finalizeScoreIfNeeded("teardown");
            }
        };
    }

    modules.register("2048", mount2048);
})();
