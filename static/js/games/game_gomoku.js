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
        const topdownApplyAchievementProgress = ctx.topdownApplyAchievementProgress;
        const loadProfile = ctx.loadProfile;
        const refreshScorePanels = ctx.refreshScorePanels;
        const roomKey = "gamesHub.gomoku.roomCode";
        const playerId = getGamesDeviceId();
        if (!window.io || typeof window.io !== "function") {
            setStatus("联机五子棋加载失败：Socket.IO 未就绪", true);
            const fallback = document.createElement("div");
            fallback.className = "games-empty";
            fallback.textContent = "联机组件未加载完成，请刷新页面后重试。";
            els.stageBody.appendChild(fallback);
            return function cleanup() {
                state.topdownMetaRefresh = null;
            };
        }

        const socket = window.io(GOMOKU_NAMESPACE, {
            transports: ["polling", "websocket"],
            upgrade: true,
            rememberUpgrade: true,
            timeout: 8000
        });
        let metaState = state.topdownMetaState || setTopdownSharedMetaState((savedPayload && savedPayload.state) || {});
        let room = null;
        let roomList = [];
        let rememberedRoomCode = "";
        let pendingMove = null;
        let pendingMarker = null;
        let pendingAction = null;
        let lastAnimatedMoveKey = "";
        let expiryTimer = 0;
        let chatDraft = "";
        let selectedChatEmoji = "";
        let wagerDraft = "";
        let settlementRefreshKeys = [];
        let socketTransportLabel = "WEBSOCKET";
        const quickChatEmojis = ["😀", "😎", "🔥", "👏", "💥", "😅", "🤔", "😭", "🎯", "⏳"];

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
                void error;
            }
        }

        function emitWithIdentity(eventName, payload) {
            socket.emit(eventName, Object.assign({ player_id: playerId }, payload || {}));
        }

        function refreshSocketTransportLabel() {
            try {
                const engine = socket && socket.io && socket.io.engine ? socket.io.engine : null;
                socketTransportLabel = String((engine && engine.transport && engine.transport.name) || "websocket").toUpperCase();
            } catch (error) {
                socketTransportLabel = "WEBSOCKET";
            }
        }

        function clearPendingAction() {
            pendingAction = null;
        }

        function setPendingAction(label) {
            pendingAction = {
                label: String(label || "操作"),
                startedAt: Date.now()
            };
            setStatus("\u8054\u673a\u4e94\u5b50\u68cb\u5df2\u901a\u8fc7 " + socketTransportLabel + " \u8fde\u63a5\u3002", false);
        }

        function emitRealtimeAction(eventName, payload, pendingLabel) {
            if (pendingAction) {
                return false;
            }
            if (!socket.connected) {
            setStatus("WebSocket \u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5\u3002", true);
                return false;
            }
            setPendingAction(pendingLabel || "操作");
            emitWithIdentity(eventName, payload);
            return true;
        }

        function playerDisplay(player) {
            return escapeHtml((player && player.display_name) || "玩家");
        }

        function stoneLabel(stone) {
            return stone === 1 ? "黑子" : (stone === 2 ? "白子" : "未分配");
        }

        function persistGomokuMeta() {
            metaState = setTopdownSharedMetaState(metaState);
            scheduleGameStateSave("topdown-shooter-meta", serializeTopdownMetaState(metaState), summarizeTopdownMetaState(metaState));
        }

        function syncSettledRoomProfile(roomSnapshot) {
            const history = roomSnapshot && Array.isArray(roomSnapshot.history) ? roomSnapshot.history : [];
            const latest = history.length ? history[history.length - 1] : null;
            if (!latest || roomSnapshot.status !== "finished") {
                return;
            }
            const scoreChanges = latest && latest.score_changes && typeof latest.score_changes === "object" ? latest.score_changes : {};
            if (!Object.prototype.hasOwnProperty.call(scoreChanges, playerId)) {
                return;
            }
            const key = "settlement:" + String(roomSnapshot.room_code || "") + ":" + String(latest.match_index || 0) + ":" + String(latest.finish_reason || "result");
            if (settlementRefreshKeys.indexOf(key) !== -1) {
                return;
            }
            settlementRefreshKeys = settlementRefreshKeys.concat([key]).slice(-64);
            Promise.all([
                loadProfile().catch(function () { return null; }),
                refreshScorePanels().catch(function () { return null; })
            ]).catch(function () { return null; });
        }

        function recordGomokuMatch(roomSnapshot) {
            const history = roomSnapshot && Array.isArray(roomSnapshot.history) ? roomSnapshot.history : [];
            const latest = history.length ? history[history.length - 1] : null;
            if (!latest || !roomSnapshot || roomSnapshot.status !== "finished") {
                return;
            }
            const eventKey = "gomoku:" + String(roomSnapshot.room_code || "") + ":" + String(latest.match_index || 0);
            const recordedKeys = Array.isArray(metaState.achievementEventKeys) ? metaState.achievementEventKeys.slice() : [];
            if (recordedKeys.indexOf(eventKey) !== -1) {
                return;
            }
            recordedKeys.push(eventKey);
            metaState.achievementEventKeys = recordedKeys.slice(-256);
            const won = String(latest.winner_player_id || "") === playerId;
            metaState = setTopdownSharedMetaState(topdownApplyAchievementProgress(metaState, {
                add: {
                    gomokuMatchTotal: 1,
                    gomokuWinTotal: won ? 1 : 0
                }
            }));
            persistGomokuMeta();
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

        function selfPlayer() {
            const players = room && Array.isArray(room.players) ? room.players : [];
            return players.find(function (player) {
                return player && player.player_id === playerId;
            }) || null;
        }

        function gomokuColorStyle(color) {
            const safeColor = color || topdownColorCatalog().classic;
            const stops = topdownAppearanceColorStops(safeColor, Date.now() / 1000);
            const first = stops[0] || safeColor.fill || "#38bdf8";
            const last = stops[stops.length - 1] || safeColor.accent || "#67e8f9";
            const glow = safeColor.glow || safeColor.accent || last;
            const glowAlpha = safeColor.tier === "superrare" ? 0.72 : (safeColor.tier === "rare" ? 0.5 : 0.26);
            const glowSize = safeColor.tier === "superrare" ? 28 : (safeColor.tier === "rare" ? 18 : 10);
            return "--stone-fill:" + escapeHtml(first) + ";--stone-accent:" + escapeHtml(last) + ";--stone-gradient:linear-gradient(135deg," + stops.join(",") + ");--stone-stroke:" + escapeHtml(safeColor.stroke || "#e2e8f0") + ";--stone-glow:" + escapeHtml(glow) + ";--stone-glow-alpha:" + String(glowAlpha) + ";--stone-glow-size:" + String(glowSize) + "px;--stone-icon-color:" + escapeHtml(safeColor.stroke || "#ffffff") + ";";
        }

        function gomokuBoardStyle(background) {
            const safeBackground = background || topdownBackgroundCatalog().dojo;
            const shadow = safeBackground.effect ? "0 24px 60px rgba(0,0,0,0.34)" : "0 18px 40px rgba(0,0,0,0.18)";
            const patternTint = safeBackground.accent || safeBackground.line || "#ffffff";
            return topdownBackgroundPreviewStyle(safeBackground)
                + "--gomoku-board-line:" + escapeHtml(safeBackground.line || "#6f4324") + ";"
                + "--gomoku-board-accent:" + escapeHtml(patternTint) + ";"
                + "--gomoku-board-shadow:" + escapeHtml(shadow) + ";";
        }

        function gomokuChatMessages() {
            const list = room && Array.isArray(room.chat_messages) ? room.chat_messages : [];
            const now = Date.now();
            return list.filter(function (entry) {
                const createdAt = Date.parse(String(entry && entry.created_at || ""));
                return Number.isFinite(createdAt) && now - createdAt <= 5000;
            });
        }

        function gomokuMarkers() {
            const list = room && Array.isArray(room.markers) ? room.markers : [];
            const now = Date.now();
            return list.filter(function (entry) {
                const createdAt = Date.parse(String(entry && entry.created_at || ""));
                return Number.isFinite(createdAt) && now - createdAt <= 1400;
            });
        }

        function scheduleExpiryRefresh() {
            if (expiryTimer) {
                window.clearTimeout(expiryTimer);
                expiryTimer = 0;
            }
            const items = gomokuChatMessages().concat(gomokuMarkers());
            if (!items.length) {
                return;
            }
            const now = Date.now();
            const nextExpiry = items.reduce(function (earliest, entry) {
                const createdAt = Date.parse(String(entry && entry.created_at || ""));
                if (!Number.isFinite(createdAt)) {
                    return earliest;
                }
                const ttl = entry.message_id ? 5000 : 1400;
                const expiry = createdAt + ttl;
                return expiry < earliest ? expiry : earliest;
            }, now + 5000);
            expiryTimer = window.setTimeout(function () {
                renderAll();
            }, Math.max(80, nextExpiry - now + 50));
        }

        function gomokuLiveChatHtml() {
            const messages = gomokuChatMessages();
            if (!messages.length) {
                return '<div class="games-stage-meta">当前没有临时消息，发送的消息和表情会显示 5 秒。</div>';
            }
            return messages.map(function (entry) {
                const roleText = entry.role === "spectator" ? "观战" : "对局";
                const content = [String(entry.emoji || ""), String(entry.content || "")].join(" ").trim();
                return '<div class="game-gomoku-chat-bubble"><strong>' + escapeHtml(String(entry.display_name || "玩家")) + '</strong><span>' + escapeHtml(roleText + " · " + content) + '</span></div>';
            }).join("");
        }

        function gomokuIconHtml(icon) {
            if (icon && icon.kind === "svg" && icon.src) {
                return '<span class="game-gomoku-stone-icon is-svg-emblem" style="--stone-url:url(&quot;' + escapeHtml(icon.src) + '&quot;);"></span>';
            }
            return '<span class="game-gomoku-stone-icon">' + escapeHtml(topdownIconPreviewGlyph(icon)) + "</span>";
        }

        function gomokuMarkerHtml(marker, offsetIndex) {
            const colors = topdownColorCatalog();
            const icons = topdownIconCatalog();
            const color = colors[String(marker.color_key || "classic")] || colors.classic;
            const icon = icons[String(marker.icon_key || "triangle")] || icons.triangle;
            return '<span class="game-gomoku-marker game-gomoku-marker--' + String(offsetIndex || 0) + '" style="' + gomokuColorStyle(color) + '" title="' + escapeHtml(String(marker.display_name || "观众")) + '">' + gomokuIconHtml(icon) + "</span>";
        }

        function updateGomokuCosmetics() {
            if (!room || room.self_role !== "player") {
                return;
            }
            emitWithIdentity("gomoku_update_cosmetics", {
                room_code: room.room_code,
                cosmetics: gomokuCosmeticsPayload()
            });
        }

        function gomokuOptionHtml(key, item, currentKey, disabled) {
            return '<option value="' + escapeHtml(key) + '"' + (currentKey === key ? " selected" : "") + (disabled ? " disabled" : "") + ">" + escapeHtml(item.label + " · " + topdownMetaTierLabel(item.tier, item.pattern ? "background" : (item.glyph || item.src ? "icon" : "color"))) + "</option>";
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
                '    <span class="game-gomoku-stone" style="' + gomokuColorStyle(appearance.color) + '">' + gomokuIconHtml(appearance.icon) + "</span>",
                "  </div>",
                '  <div class="game-gomoku-cosmetic-fields">',
                '    <label>棋子颜色<select class="game-room-select" data-gomoku-equip="color">' + colorOptions + "</select></label>",
                '    <label>棋子图标<select class="game-room-select" data-gomoku-equip="icon">' + iconOptions + "</select></label>",
                '    <label>棋盘背景<select class="game-room-select" data-gomoku-equip="background">' + backgroundOptions + "</select></label>",
                "  </div>",
                '  <div class="games-stage-meta">棋盘背景仅自己可见；棋子颜色和图标会同步给对手；观战提示也会使用你当前装备的图标。</div>',
                "</div>"
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
            "  <div>",
            '    <div class="games-section-title">联机五子棋</div>',
            '    <div class="games-stage-meta" id="gomokuMeta">支持大厅匹配、观战提示、临时聊天与押注结算。</div>',
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
            '    <div class="game-gomoku-board-layout">',
            '      <div class="game-gomoku-board-wrap" id="gomokuBoardWrap"></div>',
            '      <div class="game-gomoku-chat-side">',
            '        <div class="game-gomoku-live-chat" id="gomokuLiveChat"></div>',
            '        <div class="game-gomoku-chat-compose" id="gomokuChatCompose"></div>',
            "      </div>",
            "    </div>",
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
        const liveChatEl = shell.querySelector("#gomokuLiveChat");
        const chatComposeEl = shell.querySelector("#gomokuChatCompose");
        const turnMetaEl = shell.querySelector("#gomokuTurnMeta");

        rememberedRoomCode = loadRememberedRoomCode();

        function renderLobbyCard() {
            controlCardEl.innerHTML = [
                '<div class="games-section-title">房间大厅</div>',
                '<div class="games-stage-meta">可以自己创建一局，也可以加入别人已经开的房间；满员房间会自动变成观战入口。</div>',
                renderGomokuCosmeticPanel(),
                '<div class="game-room-actions">',
                '  <button class="games-btn games-btn--primary" type="button" id="gomokuCreateBtn">创建房间</button>',
                (rememberedRoomCode ? ('  <button class="games-btn" type="button" id="gomokuRejoinPlayBtn">重连对局 ' + escapeHtml(rememberedRoomCode) + "</button>") : ""),
                (rememberedRoomCode ? ('  <button class="games-btn" type="button" id="gomokuRejoinWatchBtn">重连观战 ' + escapeHtml(rememberedRoomCode) + "</button>") : ""),
                "</div>",
                '<div class="game-room-list">' + roomList.map(function (item) {
                    const canJoinAsPlayer = Number(item.player_count || 0) < 2;
                    return [
                        '<div class="game-room-item">',
                        "  <div><strong>" + escapeHtml(item.room_code || "----") + "</strong> · " + escapeHtml(item.status === "playing" ? "对局中" : (item.status === "finished" ? "已结束" : "等待中")) + "</div>",
                        "  <div class=\"games-stage-meta\">人数 " + escapeHtml(String(item.player_count || 0)) + " / 2 · 在线 " + escapeHtml(String(item.online_count || 0)) + " · 玩家在线 " + escapeHtml(String(item.online_player_count || 0)) + " · 观战 " + escapeHtml(String(item.spectator_count || 0)) + "</div>",
                        '  <div class="game-room-actions">',
                        '    <button class="games-btn" type="button" data-join-gomoku-room="' + escapeHtml(item.room_code || "") + '" data-spectate="0"' + (canJoinAsPlayer ? "" : " disabled") + ">加入对局</button>",
                        '    <button class="games-btn" type="button" data-join-gomoku-room="' + escapeHtml(item.room_code || "") + '" data-spectate="1">进入观战</button>',
                        "  </div>",
                        "</div>"
                    ].join("");
                }).join("") + "</div>"
            ].join("");
            controlCardEl.querySelector("#gomokuCreateBtn").addEventListener("click", function () {
                if (emitRealtimeAction("gomoku_join", { cosmetics: gomokuCosmeticsPayload() }, "创建房间")) {
                    renderAll();
                }
            });
            const rejoinPlayBtn = controlCardEl.querySelector("#gomokuRejoinPlayBtn");
            if (rejoinPlayBtn) {
                rejoinPlayBtn.addEventListener("click", function () {
                    if (emitRealtimeAction("gomoku_join", { room_code: rememberedRoomCode, spectate: false, cosmetics: gomokuCosmeticsPayload() }, "重连对局")) {
                        renderAll();
                    }
                });
            }
            const rejoinWatchBtn = controlCardEl.querySelector("#gomokuRejoinWatchBtn");
            if (rejoinWatchBtn) {
                rejoinWatchBtn.addEventListener("click", function () {
                    if (emitRealtimeAction("gomoku_join", { room_code: rememberedRoomCode, spectate: true, cosmetics: gomokuCosmeticsPayload() }, "重连观战")) {
                        renderAll();
                    }
                });
            }
            controlCardEl.querySelectorAll("[data-join-gomoku-room]").forEach(function (button) {
                button.addEventListener("click", function () {
                    if (emitRealtimeAction("gomoku_join", {
                        room_code: button.getAttribute("data-join-gomoku-room") || "",
                        spectate: button.getAttribute("data-spectate") === "1",
                        cosmetics: gomokuCosmeticsPayload()
                    }, button.getAttribute("data-spectate") === "1" ? "进入观战" : "加入对局")) {
                        renderAll();
                    }
                });
            });
            bindGomokuCosmeticControls();
        }

        function latestHistoryLine() {
            const history = room && Array.isArray(room.history) ? room.history : [];
            const latest = history.length ? history[history.length - 1] : null;
            if (!latest) {
                return "暂无";
            }
            const winner = String(latest.winner_label || "平局");
            const reasonMap = {
                five_in_row: "五连胜出",
                draw: "平局",
                resign: "投降结算",
                leave: "退出判负"
            };
            const reason = reasonMap[String(latest.finish_reason || "")] || "结算";
            const scoreChanges = latest.score_changes && typeof latest.score_changes === "object" ? latest.score_changes : {};
            const parts = [winner + " · " + reason];
            if (Object.keys(scoreChanges).length) {
                Object.keys(scoreChanges).forEach(function (key) {
                    const player = (room.players || []).find(function (item) { return item.player_id === key; });
                    const label = player ? player.display_name : (key === latest.loser_player_id ? latest.loser_label : latest.winner_label);
                    const delta = Number(scoreChanges[key] || 0);
                    parts.push(String(label || "玩家") + " " + (delta > 0 ? "+" : "") + String(delta));
                });
            }
            return parts.join(" / ");
        }

        function renderRoomCard() {
            const players = Array.isArray(room.players) ? room.players : [];
            const spectators = Array.isArray(room.spectators) ? room.spectators : [];
            const isHost = room.host_player_id === playerId;
            const canStart = Boolean(room.can_start);
            const selfRole = String(room.self_role || "");
            const me = selfPlayer();
            if (me && !wagerDraft) {
                wagerDraft = String(Math.max(0, Number(me.wager || 0)));
            }
            controlCardEl.innerHTML = [
                '<div class="games-section-title">房间 ' + escapeHtml(room.room_code || "----") + "</div>",
                '<div class="games-stage-meta">双方先各自设置押注再准备。正常胜利：赢家吃对方押注倍率奖励，败者扣自己押注；投降只扣半注；中途退出直接判负。</div>',
                renderGomokuCosmeticPanel(),
                '<div class="game-room-players">' + players.map(function (player) {
                    const appearance = playerAppearance(player);
                    const isSelf = player.player_id === playerId;
                    return '<span class="game-room-player-chip"><span class="game-room-player-stone" style="' + gomokuColorStyle(appearance.color) + '">' + gomokuIconHtml(appearance.icon) + "</span>" + playerDisplay(player) + " · " + stoneLabel(Number(player.stone || 0)) + (player.is_ready ? " · 已准备" : "") + (player.is_online ? "" : " · 离线") + (isSelf ? " · 你" : "") + "</span>";
                }).join("") + "</div>",
                '<div class="game-gomoku-stakes">' + players.map(function (player) {
                    const isSelf = player.player_id === playerId;
                    const wagerText = player.wager_set ? String(player.wager || 0) : "未设置";
                    return '<div class="game-gomoku-stake-row"><strong>' + playerDisplay(player) + '</strong><span>押注：' + escapeHtml(wagerText) + (isSelf ? (" / 总分：" + escapeHtml(String(room.self_total_score || 0))) : "") + "</span></div>";
                }).join("") + "</div>",
                (selfRole === "player" && room.status !== "playing" ? [
                    '<div class="game-gomoku-wager-bar">',
                    '  <input type="number" min="0" step="1" class="game-room-select game-gomoku-wager-input" id="gomokuWagerInput" value="' + escapeHtml(wagerDraft || "0") + '" placeholder="设置本局押注">',
                    '  <button class="games-btn" type="button" id="gomokuWagerBtn">设置押注</button>',
                    "</div>"
                ].join("") : ""),
                (spectators.length ? ('<div class="games-stage-meta">观战席：' + spectators.map(function (spectator) { return escapeHtml(String(spectator.display_name || "观众")) + (spectator.is_online ? "" : "（离线）"); }).join(" / ") + "</div>") : '<div class="games-stage-meta">当前暂无观战者。</div>'),
                '<div class="games-stage-meta">房间在线：' + escapeHtml(String(room.online_count || 0)) + '，玩家在线：' + escapeHtml(String(room.online_player_count || 0)) + '，观战在线：' + escapeHtml(String(room.online_spectator_count || 0)) + "</div>",
                '<div class="game-room-actions">',
                (selfRole === "player" ? ('  <button class="games-btn" type="button" id="gomokuReadyBtn">' + ((me || {}).is_ready ? "取消准备" : "准备") + "</button>") : '<span class="games-stage-meta">当前身份：观战</span>'),
                (selfRole === "player" && isHost ? '<button class="games-btn games-btn--primary" type="button" id="gomokuStartBtn" ' + (canStart ? "" : "disabled") + ">开始对局</button>" : ""),
                (selfRole === "player" && isHost && room.status === "finished" ? '<button class="games-btn games-btn--primary" type="button" id="gomokuRematchBtn">再来一局</button>' : ""),
                (selfRole === "player" && players.length > 1 ? '<button class="games-btn" type="button" id="gomokuSwitchWatchBtn">进入观战席</button>' : ""),
                (selfRole === "spectator" && Number(room.player_count || 0) < 2 ? '<button class="games-btn" type="button" id="gomokuSwitchPlayBtn">加入对局席</button>' : ""),
                (selfRole === "player" && room.status === "playing" ? '<button class="games-btn" type="button" id="gomokuResignBtn">投降</button>' : ""),
                '  <button class="games-btn" type="button" id="gomokuLeaveBtn">' + (selfRole === "player" && room.status === "playing" ? "退出判负" : "离开房间") + "</button>",
                "</div>",
                '<div class="games-stage-meta">最近战报：' + escapeHtml(latestHistoryLine()) + "</div>"
            ].join("");

            const readyBtn = controlCardEl.querySelector("#gomokuReadyBtn");
            if (readyBtn) {
                readyBtn.addEventListener("click", function () {
                    if (emitRealtimeAction("gomoku_toggle_ready", { room_code: room.room_code }, (me && me.is_ready) ? "取消准备" : "准备")) {
                        renderAll();
                    }
                });
            }
            const startBtn = controlCardEl.querySelector("#gomokuStartBtn");
            if (startBtn) {
                startBtn.addEventListener("click", function () {
                    if (emitRealtimeAction("gomoku_start", { room_code: room.room_code }, "开始对局")) {
                        renderAll();
                    }
                });
            }
            const rematchBtn = controlCardEl.querySelector("#gomokuRematchBtn");
            if (rematchBtn) {
                rematchBtn.addEventListener("click", function () {
                    if (emitRealtimeAction("gomoku_rematch", { room_code: room.room_code }, "再来一局")) {
                        renderAll();
                    }
                });
            }
            const switchWatchBtn = controlCardEl.querySelector("#gomokuSwitchWatchBtn");
            if (switchWatchBtn) {
                switchWatchBtn.addEventListener("click", function () {
                    if (emitRealtimeAction("gomoku_switch_role", {
                        room_code: room.room_code,
                        spectate: true,
                        cosmetics: gomokuCosmeticsPayload()
                    }, "切到观战")) {
                        renderAll();
                    }
                });
            }
            const switchPlayBtn = controlCardEl.querySelector("#gomokuSwitchPlayBtn");
            if (switchPlayBtn) {
                switchPlayBtn.addEventListener("click", function () {
                    if (emitRealtimeAction("gomoku_switch_role", {
                        room_code: room.room_code,
                        spectate: false,
                        cosmetics: gomokuCosmeticsPayload()
                    }, "加入对局")) {
                        renderAll();
                    }
                });
            }
            const resignBtn = controlCardEl.querySelector("#gomokuResignBtn");
            if (resignBtn) {
                resignBtn.addEventListener("click", function () {
                    if (emitRealtimeAction("gomoku_resign", { room_code: room.room_code }, "投降")) {
                        renderAll();
                    }
                });
            }
            const wagerInput = controlCardEl.querySelector("#gomokuWagerInput");
            const wagerBtn = controlCardEl.querySelector("#gomokuWagerBtn");
            if (wagerInput) {
                wagerInput.addEventListener("input", function () {
                    wagerDraft = wagerInput.value || "";
                });
                wagerInput.addEventListener("keydown", function (event) {
                    if (event.key === "Enter" && wagerBtn) {
                        event.preventDefault();
                        wagerBtn.click();
                    }
                });
            }
            if (wagerBtn) {
                wagerBtn.addEventListener("click", function () {
                    if (emitRealtimeAction("gomoku_set_wager", {
                        room_code: room.room_code,
                        wager: Math.max(0, Number(wagerDraft || 0))
                    }, "设置押注")) {
                        renderAll();
                    }
                });
            }
            controlCardEl.querySelector("#gomokuLeaveBtn").addEventListener("click", function () {
                const leavingDuringMatch = room && room.status === "playing" && room.self_role === "player";
                if (!emitRealtimeAction("gomoku_leave", { room_code: room.room_code }, "离开房间")) {
                    return;
                }
                room = null;
                pendingMove = null;
                pendingMarker = null;
                saveRememberedRoomCode("");
                clearPendingAction();
                renderAll();
                if (leavingDuringMatch) {
                    window.setTimeout(function () {
                        Promise.all([
                            loadProfile().catch(function () { return null; }),
                            refreshScorePanels().catch(function () { return null; })
                        ]).catch(function () { return null; });
                    }, 450);
                }
            });
            bindGomokuCosmeticControls();
        }

        function markersAt(row, col) {
            const markers = gomokuMarkers().filter(function (marker) {
                return Number(marker.row) === row && Number(marker.col) === col;
            });
            if (pendingMarker && Number(pendingMarker.row) === row && Number(pendingMarker.col) === col) {
                markers.push(pendingMarker);
            }
            return markers;
        }

        function renderChatSide() {
            if (!room) {
                liveChatEl.innerHTML = '<div class="games-stage-meta">进入房间后可发送临时消息与表情。</div>';
                chatComposeEl.innerHTML = '<div class="games-stage-meta">聊天区会显示在这里。</div>';
                return;
            }
            liveChatEl.innerHTML = gomokuLiveChatHtml();
            chatComposeEl.innerHTML = [
                '<div class="game-gomoku-chat-compose-head">',
                '  <div class="games-section-title">临时聊天</div>',
                '  <div class="games-stage-meta">所有人都可发言，消息仅显示 5 秒。</div>',
                "</div>",
                '  <div class="game-gomoku-chat-toolbar">' + quickChatEmojis.map(function (emoji) {
                    return '<button class="games-btn games-btn--ghost game-gomoku-emoji-btn' + (selectedChatEmoji === emoji ? " is-active" : "") + '" type="button" data-gomoku-emoji="' + escapeHtml(emoji) + '">' + escapeHtml(emoji) + "</button>";
                }).join("") + "</div>",
                '  <div class="game-gomoku-chat-input-row">',
                '    <input type="text" class="game-room-select game-gomoku-chat-input" id="gomokuChatInput" maxlength="120" placeholder="发一句话，5 秒后自动消失" value="' + escapeHtml(chatDraft) + '">',
                '    <button class="games-btn games-btn--primary" type="button" id="gomokuChatSendBtn">发送</button>',
                "  </div>"
            ].join("");
            chatComposeEl.querySelectorAll("[data-gomoku-emoji]").forEach(function (button) {
                button.addEventListener("click", function () {
                    const emoji = button.getAttribute("data-gomoku-emoji") || "";
                    selectedChatEmoji = selectedChatEmoji === emoji ? "" : emoji;
                    renderChatSide();
                });
            });
            const sendChat = function () {
                if (!room) {
                    return;
                }
                if (!String(chatDraft || "").trim() && !selectedChatEmoji) {
                    return;
                }
                if (!socket.connected) {
                    setStatus("WebSocket 尚未连接，聊天消息没有发出。", true);
                    return;
                }
                emitWithIdentity("gomoku_chat", {
                    room_code: room.room_code,
                    content: chatDraft,
                    emoji: selectedChatEmoji
                });
                chatDraft = "";
                selectedChatEmoji = "";
                renderChatSide();
            };
            const chatInput = chatComposeEl.querySelector("#gomokuChatInput");
            if (chatInput) {
                chatInput.addEventListener("input", function () {
                    chatDraft = chatInput.value || "";
                });
                chatInput.addEventListener("keydown", function (event) {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        sendChat();
                    }
                });
            }
            const sendBtn = chatComposeEl.querySelector("#gomokuChatSendBtn");
            if (sendBtn) {
                sendBtn.addEventListener("click", sendChat);
            }
        }

        function renderBoard() {
            const board = (room && Array.isArray(room.board) ? room.board : []).map(function (row) {
                return Array.isArray(row) ? row.slice() : [];
            });
            if (pendingMove && board[pendingMove.row] && !board[pendingMove.row][pendingMove.col]) {
                board[pendingMove.row][pendingMove.col] = pendingMove.stone;
            }
            const isPlayer = room && room.self_role === "player";
            const isSpectator = room && room.self_role === "spectator";
            const isMyTurn = Boolean(room && room.status === "playing" && isPlayer && room.turn_player_id === playerId && !pendingMove);
            const latest = pendingMove || ((room && room.last_move && room.last_move.row != null) ? room.last_move : {});
            const background = currentGomokuAppearance().background;
            const latestKey = latest && latest.row != null && latest.col != null
                ? [String(room && room.match_index || 0), String(latest.row), String(latest.col), String(latest.stone || 0)].join(":")
                : "";
            boardWrapEl.innerHTML = '<div class="game-gomoku-board" style="' + gomokuBoardStyle(background) + '">' + new Array(15).fill(0).map(function (_, rowIndex) {
                return new Array(15).fill(0).map(function (_, colIndex) {
                    const cell = board[rowIndex] && board[rowIndex][colIndex] ? Number(board[rowIndex][colIndex]) : 0;
                    const isLatest = Number(latest.row) === rowIndex && Number(latest.col) === colIndex;
                    const isFresh = isLatest && latestKey && latestKey !== lastAnimatedMoveKey;
                    const markerHtml = markersAt(rowIndex, colIndex).slice(0, 3).map(function (marker, markerIndex) {
                        return gomokuMarkerHtml(marker, markerIndex);
                    }).join("");
                    const disabled = isSpectator ? "" : ((cell || !isMyTurn) ? " disabled" : "");
                    const spectatorClass = isSpectator ? " is-pingable" : "";
                    return '<button type="button" class="game-gomoku-cell' + spectatorClass + (cell ? " has-stone" : "") + (cell === 1 ? " is-black" : (cell === 2 ? " is-white" : "")) + (isLatest ? " is-latest" : "") + '" data-row="' + rowIndex + '" data-col="' + colIndex + '"' + disabled + ">" + (cell ? ('<span class="game-gomoku-stone' + (isFresh ? " is-fresh" : "") + '" style="' + gomokuColorStyle(playerAppearance(playerByStone(cell)).color) + '">' + gomokuIconHtml(playerAppearance(playerByStone(cell)).icon) + "</span>") : "") + (markerHtml ? ('<span class="game-gomoku-markers">' + markerHtml + "</span>") : "") + "</button>";
                }).join("");
            }).join("") + "</div>";
            lastAnimatedMoveKey = latestKey || lastAnimatedMoveKey;
            boardWrapEl.querySelectorAll(".game-gomoku-cell").forEach(function (cell) {
                cell.addEventListener("click", function () {
                    if (!room) {
                        return;
                    }
                    const row = Number(cell.getAttribute("data-row"));
                    const col = Number(cell.getAttribute("data-col"));
                    if (room.self_role === "spectator") {
                        if (pendingAction) {
                            return;
                        }
                        if (!socket.connected) {
                            setStatus("WebSocket 尚未连接，提示标记没有发出。", true);
                            return;
                        }
                        pendingMarker = {
                            player_id: playerId,
                            display_name: String((state.profile && state.profile.display_name) || "观众"),
                            row: row,
                            col: col,
                            icon_key: gomokuCosmeticsPayload().icon_key,
                            color_key: gomokuCosmeticsPayload().color_key,
                            created_at: new Date().toISOString()
                        };
                        setPendingAction("提示标记");
                        emitWithIdentity("gomoku_ping", {
                            room_code: room.room_code,
                            row: row,
                            col: col,
                            cosmetics: gomokuCosmeticsPayload()
                        });
                        renderAll();
                        return;
                    }
                    if (room.status !== "playing") {
                        return;
                    }
                    if (!socket.connected) {
                        setStatus("WebSocket 尚未连接，当前落子没有发出。", true);
                        return;
                    }
                    pendingMove = {
                        row: row,
                        col: col,
                        stone: Number(room.self_stone || 0)
                    };
                    setPendingAction("落子");
                    emitWithIdentity("gomoku_place", {
                        room_code: room.room_code,
                        row: pendingMove.row,
                        col: pendingMove.col
                    });
                    renderAll();
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
                renderChatSide();
                scheduleExpiryRefresh();
                return;
            }
            roomValueEl.textContent = room.room_code || "----";
            stageValueEl.textContent = room.status === "playing" ? "对局中" : (room.status === "finished" ? "已结束" : "等待");
            movesValueEl.textContent = String(room.move_count || 0);
            if (room.self_role === "spectator" && room.status === "playing") {
                const turnPlayer = (room.players || []).find(function (player) { return player.player_id === room.turn_player_id; }) || null;
                turnMetaEl.textContent = "观战中，当前由 " + String((turnPlayer && turnPlayer.display_name) || "当前玩家") + " 落子。点击棋盘可发出临时提示。";
            } else if (room.status === "playing") {
                turnMetaEl.textContent = room.turn_player_id === playerId ? "轮到你落子。" : "等待对手落子。";
            } else if (room.status === "finished") {
                turnMetaEl.textContent = room.winner_label ? ("本局结果：" + room.winner_label) : "本局已结束。";
            } else {
                turnMetaEl.textContent = "双方设置押注并准备后，由房主开始。";
            }
            if (pendingAction) {
                turnMetaEl.textContent = "已发送「" + String(pendingAction.label || "操作") + "」，正在通过 " + socketTransportLabel + " 同步…";
            }
            renderRoomCard();
            renderBoard();
            renderChatSide();
            scheduleExpiryRefresh();
        }

        socket.on("gomoku_room", function (payload) {
            clearPendingAction();
            room = payload;
            if (!room || Number(room.move_count || 0) <= 0) {
                lastAnimatedMoveKey = "";
            }
            recordGomokuMatch(room);
            syncSettledRoomProfile(room);
            const selfPlayerPayload = room && Array.isArray(room.players) ? room.players.find(function (player) { return player.player_id === playerId; }) : null;
            const selfCosmetics = playerCosmetics(selfPlayerPayload);
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
            if (pendingMove && room && room.status === "playing" && room.turn_player_id !== playerId) {
                pendingMove = null;
            }
            if (pendingMarker && Array.isArray(room && room.markers) && room.markers.some(function (marker) {
                return marker && marker.player_id === pendingMarker.player_id && Number(marker.row) === Number(pendingMarker.row) && Number(marker.col) === Number(pendingMarker.col);
            })) {
                pendingMarker = null;
            }
            if (room && room.self_role === "player") {
                const me = selfPlayer();
                if (me) {
                    wagerDraft = String(Math.max(0, Number(me.wager || 0)));
                }
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
            clearPendingAction();
            pendingMove = null;
            pendingMarker = null;
            setStatus((payload && payload.error) || "\u4e94\u5b50\u68cb\u64cd\u4f5c\u5931\u8d25", true);
            renderAll();
        });

        socket.on("connect", function () {
            refreshSocketTransportLabel();
            clearPendingAction();
            setStatus("\u8054\u673a\u4e94\u5b50\u68cb\u5df2\u901a\u8fc7 " + socketTransportLabel + " \u8fde\u63a5\u3002", false);
            if (rememberedRoomCode) {
                emitWithIdentity("gomoku_join", { room_code: rememberedRoomCode, spectate: true, cosmetics: gomokuCosmeticsPayload() });
            }
        });

        socket.on("connect_error", function () {
            clearPendingAction();
            setStatus("WebSocket \u8fde\u63a5\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u7f51\u7edc\u540e\u91cd\u8bd5\u3002", true);
            renderAll();
        });

        socket.on("disconnect", function () {
            clearPendingAction();
            pendingMove = null;
            pendingMarker = null;
            setStatus("\u8054\u673a\u4e94\u5b50\u68cb\u7684 WebSocket \u5df2\u65ad\u5f00\u3002", true);
            renderAll();
        });

        state.topdownMetaRefresh = function () {
            metaState = getTopdownSharedMetaState(metaState);
            updateGomokuCosmetics();
            renderAll();
        };

        renderAll();

        return function cleanup() {
            state.topdownMetaRefresh = null;
            if (expiryTimer) {
                window.clearTimeout(expiryTimer);
                expiryTimer = 0;
            }
            socket.disconnect();
        };
    }

    modules.register("gomoku", mountGomoku);
})();
