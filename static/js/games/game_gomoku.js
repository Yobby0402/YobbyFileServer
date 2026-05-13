(function () {
    "use strict";

    const modules = window.GamesHubModules;
    if (!modules || typeof modules.register !== "function") {
        return;
    }
    function mountGomoku(savedPayload, ctx) {
        const state = ctx.state;
        const els = ctx.els;
        const escapeHtml = ctx.escapeHtml;
        const scheduleGameStateSave = ctx.scheduleGameStateSave;
        const setStatus = ctx.setStatus;
        const getGamesDeviceId = ctx.getGamesDeviceId;
        const GOMOKU_NAMESPACE = ctx.GOMOKU_NAMESPACE;
        const setTopdownSharedMetaState = ctx.setTopdownSharedMetaState;
        const getTopdownSharedMetaState = ctx.getTopdownSharedMetaState;
        const normalizeTopdownMetaState = ctx.normalizeTopdownMetaState;
        const serializeTopdownMetaState = ctx.serializeTopdownMetaState;
        const summarizeTopdownMetaState = ctx.summarizeTopdownMetaState;
        const topdownEquippedAppearance = ctx.topdownEquippedAppearance;
        const topdownColorCatalog = ctx.topdownColorCatalog;
        const topdownIconCatalog = ctx.topdownIconCatalog;
        const topdownBackgroundCatalog = ctx.topdownBackgroundCatalog;
        const topdownAppearanceColorStops = ctx.topdownAppearanceColorStops;
        const topdownIconPreviewGlyph = ctx.topdownIconPreviewGlyph;
        const topdownMetaTierLabel = ctx.topdownMetaTierLabel;
        const topdownBackgroundPreviewStyle = ctx.topdownBackgroundPreviewStyle;
        const roomKey = "gamesHub.gomoku.roomCode";
        const playerId = getGamesDeviceId();
        if (!window.io || typeof window.io !== "function") {
            setStatus("联机五子棋加载失败：Socket.IO 未就绪。", true);
            const fallback = document.createElement("div");
            fallback.className = "games-empty";
            fallback.textContent = "联机组件未加载完成，请刷新页面后重试。";
            els.stageBody.appendChild(fallback);
            return function cleanup() {
                state.topdownMetaRefresh = null;
            };
        }
        const socket = window.io(GOMOKU_NAMESPACE, { transports: ["websocket", "polling"], upgrade: true });
        let metaState = state.topdownMetaState || setTopdownSharedMetaState((savedPayload && savedPayload.state) || {});
        let room = null;
        let roomList = [];
        let rememberedRoomCode = "";
        let pendingMove = null;

        function loadRememberedRoomCode() {
            try {
                return window.localStorage.getItem(roomKey) || "";
            } catch (error) {
                return "";
            }
        }

        function saveRememberedRoomCode(value) {
            rememberedRoomCode = String(value || "").trim().toUpperCase();
            try {
                if (!rememberedRoomCode) {
                    window.localStorage.removeItem(roomKey);
                } else {
                    window.localStorage.setItem(roomKey, rememberedRoomCode);
                }
            } catch (error) {
                // ignore
            }
        }

        function playerDisplay(player) {
            return escapeHtml((player && player.display_name) || "玩家");
        }

        function stoneLabel(stone) {
            return stone === 1 ? "黑子" : (stone === 2 ? "白子" : "未分配");
        }

        function persistGomokuMeta() {
            scheduleGameStateSave("topdown-shooter-meta", serializeTopdownMetaState(metaState), summarizeTopdownMetaState(metaState));
        }

        function gomokuCosmeticsPayload() {
            const normalized = normalizeTopdownMetaState(metaState);
            return {
                color_key: normalized.equippedColor,
                icon_key: normalized.equippedIcon,
                background_key: normalized.equippedBackground
            };
        }

        function currentGomokuAppearance() {
            return topdownEquippedAppearance(metaState);
        }

        function playerCosmetics(player) {
            const payload = player && player.cosmetics ? player.cosmetics : {};
            return {
                colorKey: String(payload.color_key || payload.colorKey || "classic"),
                iconKey: String(payload.icon_key || payload.iconKey || "triangle")
            };
        }

        function playerAppearance(player) {
            const colors = topdownColorCatalog();
            const icons = topdownIconCatalog();
            const cosmetics = playerCosmetics(player);
            return {
                color: colors[cosmetics.colorKey] || colors.classic,
                icon: icons[cosmetics.iconKey] || icons.triangle
            };
        }

        function playerByStone(stone) {
            const players = room && Array.isArray(room.players) ? room.players : [];
            return players.find(function (player) {
                return Number(player.stone || 0) === Number(stone || 0);
            }) || null;
        }

        function opponentColorKey() {
            const players = room && Array.isArray(room.players) ? room.players : [];
            const opponent = players.find(function (player) {
                return player && player.player_id !== playerId;
            });
            return playerCosmetics(opponent).colorKey;
        }

        function gomokuColorStyle(color) {
            const safeColor = color || topdownColorCatalog().classic;
            const stops = topdownAppearanceColorStops(safeColor, Date.now() / 1000);
            const first = stops[0] || safeColor.fill || "#38bdf8";
            const last = stops[stops.length - 1] || safeColor.accent || "#67e8f9";
            return '--stone-fill:' + escapeHtml(first) + ';--stone-accent:' + escapeHtml(last) + ';--stone-gradient:linear-gradient(135deg,' + stops.join(",") + ');--stone-stroke:' + escapeHtml(safeColor.stroke || "#e2e8f0") + ';';
        }

        function gomokuIconHtml(icon) {
            if (icon && icon.kind === "svg" && icon.src) {
                return '<span class="game-gomoku-stone-icon is-svg-emblem" style="--stone-url:url(&quot;' + escapeHtml(icon.src) + '&quot;);"></span>';
            }
            return '<span class="game-gomoku-stone-icon">' + escapeHtml(topdownIconPreviewGlyph(icon)) + '</span>';
        }

        function gomokuStoneHtml(stone) {
            const appearance = playerAppearance(playerByStone(stone));
            return '<span class="game-gomoku-stone" style="' + gomokuColorStyle(appearance.color) + '">' + gomokuIconHtml(appearance.icon) + '</span>';
        }

        function updateGomokuCosmetics() {
            if (!room) {
                return;
            }
            emitWithIdentity("gomoku_update_cosmetics", {
                room_code: room.room_code,
                cosmetics: gomokuCosmeticsPayload()
            });
        }

        function gomokuOptionHtml(key, item, currentKey, disabled) {
            return '<option value="' + escapeHtml(key) + '"' + (currentKey === key ? " selected" : "") + (disabled ? " disabled" : "") + '>' + escapeHtml(item.label + " · " + topdownMetaTierLabel(item.tier, item.pattern ? "background" : (item.glyph || item.src ? "icon" : "color"))) + '</option>';
        }

        function renderGomokuCosmeticPanel() {
            const normalized = normalizeTopdownMetaState(metaState);
            const colorCatalog = topdownColorCatalog();
            const iconCatalog = topdownIconCatalog();
            const backgroundCatalog = topdownBackgroundCatalog();
            const blockedColor = opponentColorKey();
            const colorOptions = normalized.ownedColors.map(function (key) {
                return gomokuOptionHtml(key, colorCatalog[key] || colorCatalog.classic, normalized.equippedColor, Boolean(blockedColor && blockedColor === key));
            }).join("");
            const iconOptions = normalized.ownedIcons.map(function (key) {
                return gomokuOptionHtml(key, iconCatalog[key] || iconCatalog.triangle, normalized.equippedIcon, false);
            }).join("");
            const backgroundOptions = normalized.ownedBackgrounds.map(function (key) {
                return gomokuOptionHtml(key, backgroundCatalog[key] || backgroundCatalog.dojo, normalized.equippedBackground, false);
            }).join("");
            const appearance = currentGomokuAppearance();
            return [
                '<div class="game-gomoku-cosmetics">',
                '  <div class="game-gomoku-cosmetic-preview" style="' + topdownBackgroundPreviewStyle(appearance.background) + '">',
                '    <span class="game-gomoku-stone" style="' + gomokuColorStyle(appearance.color) + '">' + gomokuIconHtml(appearance.icon) + '</span>',
                '  </div>',
                '  <div class="game-gomoku-cosmetic-fields">',
                '    <label>棋子颜色<select class="game-room-select" data-gomoku-equip="color">' + colorOptions + '</select></label>',
                '    <label>棋子图标<select class="game-room-select" data-gomoku-equip="icon">' + iconOptions + '</select></label>',
                '    <label>棋盘背景<select class="game-room-select" data-gomoku-equip="background">' + backgroundOptions + '</select></label>',
                '  </div>',
                '  <div class="games-stage-meta">棋盘背景仅自己可见；棋子颜色和图标会同步给对手。双方不能使用同一个棋子颜色。</div>',
                '</div>'
            ].join("");
        }

        function bindGomokuCosmeticControls() {
            controlCardEl.querySelectorAll("[data-gomoku-equip]").forEach(function (select) {
                select.addEventListener("change", function () {
                    const type = select.getAttribute("data-gomoku-equip");
                    const key = select.value;
                    if (type === "color" && metaState.ownedColors.indexOf(key) !== -1) {
                        metaState.equippedColor = key;
                    } else if (type === "icon" && metaState.ownedIcons.indexOf(key) !== -1) {
                        metaState.equippedIcon = key;
                    } else if (type === "background" && metaState.ownedBackgrounds.indexOf(key) !== -1) {
                        metaState.equippedBackground = key;
                    }
                    persistGomokuMeta();
                    updateGomokuCosmetics();
                    renderAll();
                });
            });
        }

        const shell = document.createElement("div");
        shell.className = "game-gomoku-shell";
        shell.innerHTML = [
            '<div class="game-room-toolbar">',
            '  <div>',
            '    <div class="games-section-title">联机五子棋</div>',
            '    <div class="games-stage-meta" id="gomokuMeta">支持局域网房间、准备同步与实时落子。</div>',
            "  </div>",
            '  <div class="game-stat-grid">',
            '    <div class="game-stat-card"><div class="game-stat-label">房间</div><div class="game-stat-value" id="gomokuRoomValue">----</div></div>',
            '    <div class="game-stat-card"><div class="game-stat-label">状态</div><div class="game-stat-value" id="gomokuStageValue">大厅</div></div>',
            '    <div class="game-stat-card"><div class="game-stat-label">手数</div><div class="game-stat-value" id="gomokuMovesValue">0</div></div>',
            "  </div>",
            "</div>",
            '<div class="game-gomoku-stage">',
            '  <div class="games-panel game-gomoku-panel" id="gomokuControlCard"></div>',
            '  <div class="games-panel game-gomoku-panel game-gomoku-panel--board">',
            '    <div class="games-section-title">棋盘</div>',
            '    <div class="game-gomoku-board-wrap" id="gomokuBoardWrap"></div>',
            '    <div class="games-stage-meta" id="gomokuTurnMeta">创建或加入房间后即可开始。</div>',
            "  </div>",
            "</div>"
        ].join("");
        els.stageBody.appendChild(shell);

        const roomValueEl = shell.querySelector("#gomokuRoomValue");
        const stageValueEl = shell.querySelector("#gomokuStageValue");
        const movesValueEl = shell.querySelector("#gomokuMovesValue");
        const controlCardEl = shell.querySelector("#gomokuControlCard");
        const boardWrapEl = shell.querySelector("#gomokuBoardWrap");
        const turnMetaEl = shell.querySelector("#gomokuTurnMeta");

        rememberedRoomCode = loadRememberedRoomCode();

        function emitWithIdentity(eventName, payload) {
            socket.emit(eventName, Object.assign({ player_id: playerId }, payload || {}));
        }

        function renderLobbyCard() {
            controlCardEl.innerHTML = [
                '<div class="games-section-title">房间大厅</div>',
                '<div class="games-stage-meta">可以自己创建一局，也可以加入别人已经开的房间。</div>',
                renderGomokuCosmeticPanel(),
                '<div class="game-room-actions">',
                '  <button class="games-btn games-btn--primary" type="button" id="gomokuCreateBtn">创建房间</button>',
                (rememberedRoomCode ? ('  <button class="games-btn" type="button" id="gomokuRejoinBtn">重连 ' + escapeHtml(rememberedRoomCode) + "</button>") : ""),
                "</div>",
                '<div class="game-room-list">' + roomList.map(function (item) {
                    return [
                        '<div class="game-room-item">',
                        '  <div><strong>' + escapeHtml(item.room_code || "----") + "</strong> · " + escapeHtml(item.status === "playing" ? "对局中" : (item.status === "finished" ? "已结束" : "等待中")) + "</div>",
                        '  <div class="games-stage-meta">人数 ' + escapeHtml(String(item.player_count || 0)) + ' / 2 · 在线 ' + escapeHtml(String(item.online_count || 0)) + '</div>',
                        '  <button class="games-btn" type="button" data-join-gomoku-room="' + escapeHtml(item.room_code || "") + '">加入</button>',
                        "</div>"
                    ].join("");
                }).join("") + "</div>"
            ].join("");
            controlCardEl.querySelector("#gomokuCreateBtn").addEventListener("click", function () {
                emitWithIdentity("gomoku_join", { cosmetics: gomokuCosmeticsPayload() });
            });
            const rejoinBtn = controlCardEl.querySelector("#gomokuRejoinBtn");
            if (rejoinBtn) {
                rejoinBtn.addEventListener("click", function () {
                    emitWithIdentity("gomoku_join", { room_code: rememberedRoomCode, cosmetics: gomokuCosmeticsPayload() });
                });
            }
            controlCardEl.querySelectorAll("[data-join-gomoku-room]").forEach(function (button) {
                button.addEventListener("click", function () {
                    emitWithIdentity("gomoku_join", { room_code: button.getAttribute("data-join-gomoku-room") || "", cosmetics: gomokuCosmeticsPayload() });
                });
            });
            bindGomokuCosmeticControls();
        }

        function renderRoomCard() {
            const players = Array.isArray(room.players) ? room.players : [];
            const isHost = room.host_player_id === playerId;
            const canStart = Boolean(room.can_start);
            controlCardEl.innerHTML = [
                '<div class="games-section-title">房间 ' + escapeHtml(room.room_code || "----") + "</div>",
                '<div class="games-stage-meta">房主可在双方准备后开局，对局结束后可继续再来一盘。</div>',
                renderGomokuCosmeticPanel(),
                '<div class="game-room-players">' + players.map(function (player) {
                    const appearance = playerAppearance(player);
                    return '<span class="game-room-player-chip"><span class="game-room-player-stone" style="' + gomokuColorStyle(appearance.color) + '">' + gomokuIconHtml(appearance.icon) + '</span>' + playerDisplay(player) + ' · ' + stoneLabel(Number(player.stone || 0)) + (player.is_ready ? " · 已准备" : "") + "</span>";
                }).join("") + "</div>",
                '<div class="game-room-actions">',
                '  <button class="games-btn" type="button" id="gomokuReadyBtn">' + ((players.find(function (player) { return player.player_id === playerId; }) || {}).is_ready ? "取消准备" : "准备") + "</button>",
                (isHost ? '<button class="games-btn games-btn--primary" type="button" id="gomokuStartBtn" ' + (canStart ? "" : "disabled") + '>开始对局</button>' : ""),
                (isHost && room.status === "finished" ? '<button class="games-btn games-btn--primary" type="button" id="gomokuRematchBtn">再来一局</button>' : ""),
                '  <button class="games-btn" type="button" id="gomokuLeaveBtn">离开房间</button>',
                "</div>",
                '<div class="games-stage-meta">历史：' + escapeHtml(((room.history || []).slice(-3).map(function (item) { return "第 " + item.match_index + " 局 " + item.winner_label; }).join(" / ")) || "暂无") + "</div>"
            ].join("");
            controlCardEl.querySelector("#gomokuReadyBtn").addEventListener("click", function () {
                emitWithIdentity("gomoku_toggle_ready", { room_code: room.room_code });
            });
            const startBtn = controlCardEl.querySelector("#gomokuStartBtn");
            if (startBtn) {
                startBtn.addEventListener("click", function () {
                    emitWithIdentity("gomoku_start", { room_code: room.room_code });
                });
            }
            const rematchBtn = controlCardEl.querySelector("#gomokuRematchBtn");
            if (rematchBtn) {
                rematchBtn.addEventListener("click", function () {
                    emitWithIdentity("gomoku_rematch", { room_code: room.room_code });
                });
            }
            controlCardEl.querySelector("#gomokuLeaveBtn").addEventListener("click", function () {
                emitWithIdentity("gomoku_leave", { room_code: room.room_code });
                room = null;
                saveRememberedRoomCode("");
                renderAll();
            });
            bindGomokuCosmeticControls();
        }

        function renderBoard() {
            const board = (room && Array.isArray(room.board) ? room.board : []).map(function (row) {
                return Array.isArray(row) ? row.slice() : [];
            });
            if (pendingMove && board[pendingMove.row] && !board[pendingMove.row][pendingMove.col]) {
                board[pendingMove.row][pendingMove.col] = pendingMove.stone;
            }
            const isMyTurn = room && room.status === "playing" && room.turn_player_id === playerId;
            const latest = pendingMove || ((room && room.last_move && room.last_move.row != null) ? room.last_move : {});
            const background = currentGomokuAppearance().background;
            boardWrapEl.innerHTML = '<div class="game-gomoku-board" style="' + topdownBackgroundPreviewStyle(background) + '">' + new Array(15).fill(0).map(function (_, row) {
                return new Array(15).fill(0).map(function (_, col) {
                    const cell = board[row] && board[row][col] ? Number(board[row][col]) : 0;
                    const isLatest = Number(latest.row) === row && Number(latest.col) === col;
                    return '<button type="button" class="game-gomoku-cell' + (cell ? " has-stone" : "") + (cell === 1 ? " is-black" : (cell === 2 ? " is-white" : "")) + (isLatest ? " is-latest" : "") + '" data-row="' + row + '" data-col="' + col + '"' + ((cell || !isMyTurn) ? " disabled" : "") + ">" + (cell ? gomokuStoneHtml(cell) : "") + "</button>";
                }).join("");
            }).join("") + "</div>";
            boardWrapEl.querySelectorAll(".game-gomoku-cell").forEach(function (cell) {
                cell.addEventListener("click", function () {
                    if (!room || room.status !== "playing") {
                        return;
                    }
                    pendingMove = {
                        row: Number(cell.getAttribute("data-row")),
                        col: Number(cell.getAttribute("data-col")),
                        stone: Number(room.self_stone || 0)
                    };
                    renderBoard();
                    emitWithIdentity("gomoku_place", {
                        room_code: room.room_code,
                        row: pendingMove.row,
                        col: pendingMove.col
                    });
                });
            });
        }

        function renderAll() {
            if (!room) {
                roomValueEl.textContent = "----";
                stageValueEl.textContent = "大厅";
                movesValueEl.textContent = "0";
                turnMetaEl.textContent = "创建或加入房间后即可开始。";
                renderLobbyCard();
                boardWrapEl.innerHTML = '<div class="games-stage-meta">当前尚未加入房间。</div>';
                return;
            }
            roomValueEl.textContent = room.room_code || "----";
            stageValueEl.textContent = room.status === "playing" ? "对局中" : (room.status === "finished" ? "已结束" : "等待");
            movesValueEl.textContent = String(room.move_count || 0);
            if (room.status === "playing") {
                turnMetaEl.textContent = room.turn_player_id === playerId ? "轮到你落子。" : "等待对手落子。";
            } else if (room.status === "finished") {
                turnMetaEl.textContent = room.winner_label ? ("本局结果：" + room.winner_label) : "本局已结束。";
            } else {
                turnMetaEl.textContent = "双方准备后由房主开始。";
            }
            renderRoomCard();
            renderBoard();
        }

        socket.on("gomoku_room", function (payload) {
            room = payload;
            const selfPlayer = room && Array.isArray(room.players) ? room.players.find(function (player) { return player.player_id === playerId; }) : null;
            const selfCosmetics = playerCosmetics(selfPlayer);
            let selfCosmeticsChanged = false;
            if (selfCosmetics.colorKey && metaState.ownedColors.indexOf(selfCosmetics.colorKey) !== -1) {
                selfCosmeticsChanged = metaState.equippedColor !== selfCosmetics.colorKey || selfCosmeticsChanged;
                metaState.equippedColor = selfCosmetics.colorKey;
            }
            if (selfCosmetics.iconKey && metaState.ownedIcons.indexOf(selfCosmetics.iconKey) !== -1) {
                selfCosmeticsChanged = metaState.equippedIcon !== selfCosmetics.iconKey || selfCosmeticsChanged;
                metaState.equippedIcon = selfCosmetics.iconKey;
            }
            if (selfCosmeticsChanged) {
                persistGomokuMeta();
            }
            if (pendingMove && room && room.board && room.board[pendingMove.row] && Number(room.board[pendingMove.row][pendingMove.col] || 0) === Number(pendingMove.stone || 0)) {
                pendingMove = null;
            }
            saveRememberedRoomCode((payload && payload.room_code) || "");
            renderAll();
        });

        socket.on("gomoku_rooms", function (payload) {
            roomList = Array.isArray(payload) ? payload : [];
            if (!room) {
                renderAll();
            }
        });

        socket.on("gomoku_error", function (payload) {
            pendingMove = null;
            setStatus((payload && payload.error) || "五子棋操作失败", true);
            renderAll();
        });

        socket.on("connect", function () {
            setStatus("联机五子棋已连接房间服务。", false);
            if (rememberedRoomCode) {
                emitWithIdentity("gomoku_join", { room_code: rememberedRoomCode, cosmetics: gomokuCosmeticsPayload() });
            }
        });

        socket.on("disconnect", function () {
            setStatus("联机五子棋连接已断开。", true);
        });

        state.topdownMetaRefresh = function () {
            metaState = getTopdownSharedMetaState(metaState);
            updateGomokuCosmetics();
            renderAll();
        };

        renderAll();

        return function cleanup() {
            state.topdownMetaRefresh = null;
            socket.disconnect();
        };
    }

    modules.register("gomoku", mountGomoku);
})();
