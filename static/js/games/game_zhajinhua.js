(function () {
    "use strict";

    const modules = window.GamesHubModules;
    if (!modules || typeof modules.register !== "function") {
        return;
    }

    function mountZhajinhua(savedPayload, ctx) {
        const state = ctx.state;
        const els = ctx.els;
        const escapeHtml = ctx.escapeHtml;
        const scheduleGameStateSave = ctx.scheduleGameStateSave;
        const setStageStats = ctx.setStageStats;
        const setStatus = ctx.setStatus;
        const getGamesDeviceId = ctx.getGamesDeviceId;
        const ZHAJINHUA_NAMESPACE = ctx.ZHAJINHUA_NAMESPACE;
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
        const topdownBackgroundPreviewStyle = ctx.topdownBackgroundPreviewStyle;
        const loadProfile = ctx.loadProfile;
        const refreshScorePanels = ctx.refreshScorePanels;
        const roomKey = "gamesHub.zhajinhua.roomCode";
        const playerId = getGamesDeviceId();
        if (!window.io || typeof window.io !== "function") {
            setStatus("炸金花加载失败：Socket.IO 未就绪", true);
            const fallback = document.createElement("div");
            fallback.className = "games-empty";
            fallback.textContent = "联机组件尚未加载完成，请刷新页面后重试。";
            els.stageBody.appendChild(fallback);
            return function cleanup() {
                state.topdownMetaRefresh = null;
            };
        }

        const socket = window.io(ZHAJINHUA_NAMESPACE, {
            transports: ["polling", "websocket"],
            upgrade: true,
            rememberUpgrade: true,
            timeout: 8000
        });
        let metaState = state.topdownMetaState || setTopdownSharedMetaState((savedPayload && savedPayload.state) || {});
        let room = null;
        let roomList = [];
        let globalRecords = [];
        let rememberedRoomCode = "";
        let baseStakeDraft = "";
        let compareTargetDraft = "";
        let raiseAmountDraft = "";
        let settlementRefreshKeys = [];
        let pendingAction = null;
        let pendingActionTimer = 0;
        let recordsExpanded = false;
        let socketTransportLabel = "WEBSOCKET";

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
            if (pendingActionTimer) {
                window.clearTimeout(pendingActionTimer);
                pendingActionTimer = 0;
            }
        }

        function setPendingAction(label) {
            clearPendingAction();
            pendingAction = {
                label: String(label || "操作"),
                startedAt: Date.now()
            };
            pendingActionTimer = window.setTimeout(function () {
                pendingActionTimer = 0;
                renderActionPanel();
                renderLogPanel();
            }, 180);
            renderActionPanel();
            renderLogPanel();
        }

        function emitRealtimeAction(eventName, payload, pendingLabel) {
            if (!socket.connected) {
                setStatus("WebSocket 尚未连接，当前操作没有发出。", true);
                return;
            }
            setPendingAction(pendingLabel || "操作");
            emitWithIdentity(eventName, payload);
        }

        function persistMeta() {
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

        function zhajinhuaCosmeticsPayload() {
            const normalized = normalizeTopdownMetaState(metaState);
            return {
                color_key: normalized.equippedColor,
                icon_key: normalized.equippedIcon,
                background_key: normalized.equippedBackground
            };
        }

        function currentAppearance() {
            return topdownEquippedAppearance(metaState);
        }

        function playerCosmetics(player) {
            const payload = player && player.cosmetics ? player.cosmetics : {};
            return {
                colorKey: String(payload.color_key || payload.colorKey || "classic"),
                iconKey: String(payload.icon_key || payload.iconKey || "triangle"),
                backgroundKey: String(payload.background_key || payload.backgroundKey || "dojo")
            };
        }

        function playerAppearance(player) {
            const colors = topdownColorCatalog();
            const icons = topdownIconCatalog();
            const backgrounds = topdownBackgroundCatalog();
            const cosmetics = playerCosmetics(player);
            return {
                color: colors[cosmetics.colorKey] || colors.classic,
                icon: icons[cosmetics.iconKey] || icons.triangle,
                background: backgrounds[cosmetics.backgroundKey] || backgrounds.dojo
            };
        }

        function cardIconHtml(icon) {
            if (icon && icon.kind === "svg" && icon.src) {
                return '<span class="game-zhajinhua-card-icon is-svg-emblem" style="--stone-url:url(&quot;' + escapeHtml(icon.src) + '&quot;);"></span>';
            }
            return '<span class="game-zhajinhua-card-icon">' + escapeHtml(topdownIconPreviewGlyph(icon)) + "</span>";
        }

        function cardStyle(color) {
            const safeColor = color || topdownColorCatalog().classic;
            const stops = topdownAppearanceColorStops(safeColor, Date.now() / 1000);
            const first = stops[0] || safeColor.fill || "#38bdf8";
            const last = stops[stops.length - 1] || safeColor.accent || "#67e8f9";
            return "--card-fill:" + escapeHtml(first) + ";" +
                "--card-accent:" + escapeHtml(last) + ";" +
                "--card-gradient:linear-gradient(160deg," + stops.join(",") + ");" +
                "--card-stroke:" + escapeHtml(safeColor.stroke || "#ffffff") + ";" +
                "--card-glow:" + escapeHtml(safeColor.glow || safeColor.accent || last) + ";" +
                "--stone-fill:" + escapeHtml(first) + ";" +
                "--stone-accent:" + escapeHtml(last) + ";" +
                "--stone-gradient:linear-gradient(160deg," + stops.join(",") + ");" +
                "--stone-stroke:" + escapeHtml(safeColor.stroke || "#ffffff") + ";" +
                "--stone-glow:" + escapeHtml(safeColor.glow || safeColor.accent || last) + ";";
        }

        function roomBackgroundStyle(background) {
            const safeBackground = background || topdownBackgroundCatalog().dojo;
            return topdownBackgroundPreviewStyle(safeBackground)
                + "--zhajinhua-room-line:" + escapeHtml(safeBackground.line || "#6f4324") + ";"
                + "--zhajinhua-room-accent:" + escapeHtml(safeBackground.accent || "#f7d08a") + ";";
        }

        function selfPlayer() {
            const players = room && Array.isArray(room.players) ? room.players : [];
            return players.find(function (player) {
                return player && player.player_id === playerId;
            }) || null;
        }

        function remainingPlayers() {
            const players = room && Array.isArray(room.players) ? room.players : [];
            return players.filter(function (player) {
                return player && !player.is_folded;
            });
        }

        function compareTargets() {
            const me = selfPlayer();
            const players = remainingPlayers();
            return players.filter(function (player) {
                return me && player && player.player_id !== me.player_id;
            });
        }

        function isMyActionTurn() {
            const me = selfPlayer();
            return Boolean(
                room
                && room.status === "playing"
                && me
                && room.turn_player_id === playerId
                && !me.is_folded
                && !me.is_dead
            );
        }

        function availableRaiseAmounts() {
            const maxBetAmount = Math.max(1, Number((room && room.max_bet_amount) || 10000000));
            const list = room && Array.isArray(room.raise_options) ? room.raise_options : [2, 5, 10, 20, 50, 100];
            return list.map(function (value) {
                return Math.max(1, Number(value || 0));
            }).filter(function (value, index, values) {
                return value > Number((room && room.current_bet) || 0) && value <= maxBetAmount && values.indexOf(value) === index;
            });
        }

        function maxBetAmountText() {
            return String(Math.max(1, Number((room && room.max_bet_amount) || 10000000)));
        }

        function specialRoundChanceText() {
            const ratio = Number((room && room.special_round_probability) || 0.05);
            const percent = ratio * 100;
            return (Math.round(percent * 10) / 10).toString().replace(/\.0$/, "") + "%";
        }

        function visibleCards(player) {
            const cards = player && Array.isArray(player.cards) ? player.cards : [];
            return cards.slice(0, 3);
        }

        function shouldRevealPlayerCards(player) {
            if (!player) {
                return false;
            }
            return Boolean(player.is_revealed);
        }

        function latestFinishedRecord() {
            const history = room && Array.isArray(room.history) ? room.history : [];
            return history.length ? history[history.length - 1] : null;
        }

        function latestHistoryLine() {
            const latest = latestFinishedRecord();
            if (!latest) {
                return "暂无结算记录。";
            }
            return String(latest.winner_label || "本局") + " 赢下 " + String(latest.pot || 0) + " 积分奖池。"
                + (latest.is_special_round ? " 本局为爽局。" : "");
        }
        function zhajinhuaHandRankGuide() {
            if (room && room.straight_gt_flush) {
                return ["豹子", "顺金", "顺子", "金花", "对子", "单张"].join(" > ");
            }
            const labels = ["豹子", "顺金", "金花", "顺子", "对子", "单张"];
            if (room && room.enable_235_rule) {
                labels.push("特殊：235 可压豹子");
            }
            return labels.join(" > ");
        }

        function formatEntryTime(value) {
            const parsed = Date.parse(String(value || ""));
            if (!Number.isFinite(parsed)) {
                return "";
            }
            const date = new Date(parsed);
            return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
        }

        function playerById(targetPlayerId) {
            const players = room && Array.isArray(room.players) ? room.players : [];
            return players.find(function (player) {
                return player && player.player_id === targetPlayerId;
            }) || null;
        }

        function bubbleStyleForAppearance(appearance) {
            const safeAppearance = appearance || currentAppearance();
            const safeColor = safeAppearance && safeAppearance.color ? safeAppearance.color : topdownColorCatalog().classic;
            const stops = topdownAppearanceColorStops(safeColor, Date.now() / 1000);
            const first = stops[0] || safeColor.fill || "#38bdf8";
            const last = stops[stops.length - 1] || safeColor.accent || "#67e8f9";
            return [
                "--bubble-fill:" + escapeHtml(first),
                "--bubble-accent:" + escapeHtml(last),
                "--bubble-gradient:linear-gradient(155deg," + stops.join(",") + ")",
                "--bubble-stroke:" + escapeHtml(safeColor.stroke || "#ffffff"),
                "--bubble-glow:" + escapeHtml(safeColor.glow || safeColor.accent || last)
            ].join(";");
        }

        function logBubbleStyle(entry) {
            const actor = entry && entry.actor_player_id ? playerById(entry.actor_player_id) : null;
            return bubbleStyleForAppearance(actor ? playerAppearance(actor) : currentAppearance());
        }

        function tableLayoutMode(playerCount) {
            const count = Math.max(0, Number(playerCount || 0));
            const viewportWidth = Math.max(window.innerWidth || 0, document.documentElement ? document.documentElement.clientWidth : 0);
            const listLayout = count >= 6 || (count >= 5 && viewportWidth < 1520) || viewportWidth < 1180;
            const compactCards = count >= 5 || viewportWidth < 1420;
            const stackedCards = count >= 8 || (count >= 6 && viewportWidth < 1480);
            return {
                listLayout: listLayout,
                compactCards: compactCards,
                stackedCards: stackedCards
            };
        }

        function normalizeRecords() {
            if (Array.isArray(globalRecords) && globalRecords.length) {
                return globalRecords.slice();
            }
            return roomList.reduce(function (items, item) {
                const history = item && Array.isArray(item.history) ? item.history : [];
                history.forEach(function (record) {
                    const payload = Object.assign({}, record || {});
                    payload.room_code = String(payload.room_code || item.room_code || "");
                    items.push(payload);
                });
                return items;
            }, []).sort(function (left, right) {
                return Date.parse(String(right.finished_at || right.recorded_at || "")) - Date.parse(String(left.finished_at || left.recorded_at || ""));
            });
        }

        function recordWinnerAppearance(record) {
            const winnerId = String((record && record.winner_player_id) || "");
            const players = record && Array.isArray(record.players) ? record.players : [];
            const winner = players.find(function (player) {
                return player && String(player.player_id || "") === winnerId;
            }) || null;
            return winner ? playerAppearance(winner) : currentAppearance();
        }

        function formatRecordCardText(card) {
            if (!card || typeof card !== "object") {
                return "";
            }
            const suitMap = {
                spades: "黑桃",
                hearts: "红桃",
                clubs: "梅花",
                diamonds: "方块"
            };
            const suit = suitMap[String(card.suit || "")] || "";
            const rank = String(card.rank_label || rankText(card.rank) || "");
            return suit && rank ? (suit + rank) : String(card.label || "");
        }

        function renderRecordDetailPlayer(player) {
            const tags = [];
            const cards = player && Array.isArray(player.cards) ? player.cards : [];
            const cardsText = cards.map(formatRecordCardText).filter(Boolean).join(" / ");
            if (player && player.hand_kind_label) {
                tags.push(String(player.hand_kind_label));
            }
            if (player && player.is_folded) {
                tags.push("已弃牌");
            }
            tags.push("投入 " + String((player && player.total_bet) || 0));
            return [
                '<div class="game-zhajinhua-record-player-row">',
                '  <div class="game-zhajinhua-record-player-head">',
                '    <strong>' + escapeHtml(String((player && player.display_name) || "玩家")) + '</strong>',
                '    <span>' + escapeHtml(tags.join(" · ")) + '</span>',
                "  </div>",
                '  <div class="game-zhajinhua-record-cards-text">' + escapeHtml(cardsText || "未记录牌面") + '</div>',
                '</div>'
            ].join("");
        }

        function renderRecordsModalContent() {
            const records = normalizeRecords();
            if (!records.length) {
                return '<div class="games-stage-meta">还没有可查看的对局记录。</div>';
            }
            return '<div class="game-zhajinhua-record-modal-list">' + records.map(function (record) {
                const appearance = recordWinnerAppearance(record);
                const players = record && Array.isArray(record.players) ? record.players : [];
                return [
                    '<div class="game-zhajinhua-record-card" style="' + bubbleStyleForAppearance(appearance) + '">',
                    '  <div class="game-zhajinhua-record-head">',
                    '    <strong>房间 ' + escapeHtml(String(record.room_code || "----")) + ' · 第 ' + escapeHtml(String(record.match_index || 0)) + ' 手牌</strong>',
                    '    <span>' + escapeHtml(formatEntryTime(record.finished_at || record.recorded_at)) + '</span>',
                    "  </div>",
                    '  <div class="game-zhajinhua-record-summary">' + escapeHtml(String(record.winner_label || "本局")) + ' 赢得奖池 ' + escapeHtml(String(record.pot || 0)) + '</div>',
                    (record && record.is_special_round ? '  <div class="games-stage-meta">本局为爽局：本手发牌时所有玩家都拿到了对子以上牌型。</div>' : ''),
                    '  <div class="game-zhajinhua-record-detail-list">' + players.map(renderRecordDetailPlayer).join("") + '</div>',
                    '</div>'
                ].join("");
            }).join("") + '</div>';
        }

        function openRecordsModal() {
            recordsExpanded = true;
            recordsModalBodyEl.innerHTML = renderRecordsModalContent();
            recordsModalEl.hidden = false;
        }

        function closeRecordsModal() {
            recordsExpanded = false;
            recordsModalEl.hidden = true;
        }

        function renderRecordsSection() {
            return [
                '<div class="game-zhajinhua-records">',
                '  <div class="game-zhajinhua-records-head">',
                '    <div class="games-section-title">对局记录</div>',
                '    <button class="games-btn" type="button" id="zhajinhuaToggleRecordsBtn">查看对局记录</button>',
                "  </div>",
                '  <div class="games-stage-meta">点击弹窗查看每一手的赢家、投入、牌型和各玩家牌面记录。</div>',
                "</div>"
            ].join("");
        }

        function rankText(rank) {
            const value = Number(rank || 0);
            if (value === 14) {
                return "A";
            }
            if (value === 13) {
                return "K";
            }
            if (value === 12) {
                return "Q";
            }
            if (value === 11) {
                return "J";
            }
            return String(value || "");
        }

        function suitSymbol(card) {
            return String((card && card.suit_symbol) || "");
        }

        function suitClass(card) {
            const suit = String((card && card.suit) || "");
            return suit === "hearts" || suit === "diamonds" ? "is-red" : "is-black";
        }

        function renderCard(card, player, options) {
            const appearance = playerAppearance(player);
            const cardOptions = options || {};
            const className = "game-zhajinhua-card"
                + (card ? (" " + suitClass(card)) : " is-hidden")
                + (cardOptions.compact ? " is-compact" : "")
                + (cardOptions.stacked ? " is-stacked" : "");
            const inlineStyle = cardStyle(appearance.color)
                + (cardOptions.stacked ? ("--stack-index:" + String(Math.max(0, Number(cardOptions.index || 0))) + ";z-index:" + String(10 + Math.max(0, Number(cardOptions.index || 0))) + ";") : "");
            if (!card) {
                return '<div class="' + className + '" style="' + inlineStyle + '">' + cardIconHtml(appearance.icon) + "</div>";
            }
            return [
                '<div class="' + className + '" style="' + inlineStyle + '">',
                '  <div class="game-zhajinhua-card-corner is-top"><strong>' + escapeHtml(rankText(card.rank)) + '</strong><span>' + escapeHtml(suitSymbol(card)) + "</span></div>",
                '  <div class="game-zhajinhua-card-center">' + cardIconHtml(appearance.icon) + "</div>",
                '  <div class="game-zhajinhua-card-corner is-bottom"><strong>' + escapeHtml(rankText(card.rank)) + '</strong><span>' + escapeHtml(suitSymbol(card)) + "</span></div>",
                "</div>"
            ].join("");
        }

        const shell = document.createElement("div");
        shell.className = "game-zhajinhua-shell";
        shell.innerHTML = [
            '<div class="game-zhajinhua-stage">',
            '  <div class="games-panel game-zhajinhua-panel game-zhajinhua-panel--control" id="zhajinhuaControlCard"></div>',
            '  <div class="games-panel game-zhajinhua-panel game-zhajinhua-panel--table">',
            '    <div class="game-zhajinhua-table-layout">',
            '      <div class="game-zhajinhua-main-column">',
            '        <div class="game-zhajinhua-table-wrap" id="zhajinhuaTableWrap"></div>',
            "      </div>",
            '      <div class="game-zhajinhua-side-column">',
            '        <div class="game-zhajinhua-side-card game-zhajinhua-log-side">',
            '          <div class="games-section-title">操作流程</div>',
            '          <div class="game-zhajinhua-log" id="zhajinhuaLogPanel"></div>',
            "        </div>",
            '        <div class="game-zhajinhua-side-card game-zhajinhua-action-side">',
            '          <div class="games-section-title">当前操作</div>',
            '          <div class="game-zhajinhua-action-panel" id="zhajinhuaActionPanel"></div>',
            "        </div>",
            "      </div>",
            "    </div>",
            '    <div class="games-stage-meta" id="zhajinhuaTurnMeta">创建或加入房间后即可开始。</div>',
            '    <div class="games-modal" id="zhajinhuaRecordsModal" hidden>',
            '      <div class="games-modal-backdrop" data-close-zhajinhua-records></div>',
            '      <div class="games-modal-dialog games-modal-dialog--wide">',
            '        <div class="games-modal-head">',
            '          <div>',
            '            <div class="games-section-title">对局记录</div>',
            '            <div class="games-stage-meta">按房间与手数查看结算，支持追溯到每位玩家的文字牌面。</div>',
            '          </div>',
            '          <button type="button" class="games-modal-close" data-close-zhajinhua-records>&times;</button>',
            '        </div>',
            '        <div class="games-modal-body" id="zhajinhuaRecordsModalBody"></div>',
            '      </div>',
            '    </div>',
            "  </div>",
            "</div>"
        ].join("");
        els.stageBody.appendChild(shell);

        const turnMetaEl = shell.querySelector("#zhajinhuaTurnMeta");
        const controlCardEl = shell.querySelector("#zhajinhuaControlCard");
        const tableWrapEl = shell.querySelector("#zhajinhuaTableWrap");
        const logPanelEl = shell.querySelector("#zhajinhuaLogPanel");
        const actionPanelEl = shell.querySelector("#zhajinhuaActionPanel");
        const recordsModalEl = shell.querySelector("#zhajinhuaRecordsModal");
        const recordsModalBodyEl = shell.querySelector("#zhajinhuaRecordsModalBody");

        function updateStageHeader() {
            setStageStats([
                { label: "房间", value: room ? String(room.room_code || "----") : "----" },
                { label: "奖池", value: room ? String(room.pot || 0) : "0" },
                { label: "当前注", value: room ? String(room.current_bet || 0) : "0" },
                { label: "手数", value: room ? String(room.match_index || 0) : "0" }
            ]);
            if (!els.stageMeta) {
                return;
            }
            if (!room) {
                els.stageMeta.textContent = "\u623f\u4e3b\u8bbe\u7f6e\u5e95\u91d1\uff0c\u4e0a\u684c 2-10 \u4eba\uff0c\u6bcf\u624b\u90fd\u91cd\u65b0\u6d17\u724c\uff0c\u652f\u6301\u89c2\u6218\u548c\u5168\u5c40\u804a\u5929\u3002 \u724c\u578b\u5927\u5c0f\uff1a" + zhajinhuaHandRankGuide();
                return;
            }
            els.stageMeta.textContent = "底金 " + String(room.base_stake || 0)
                + " · 在线 " + String(room.online_count || 0)
                + " · 玩家 " + String(room.player_count || 0) + "/10"
                + " · 观战 " + String(room.spectator_count || 0)
                + " · 牌型大小 " + zhajinhuaHandRankGuide()
                + " · 爽局概率 " + specialRoundChanceText()
                + " · 单次押注上限 " + maxBetAmountText();
        }

        function renderLobbyCard() {
            controlCardEl.innerHTML = [
                '<div class="games-stage-meta">\u53ef\u4ee5\u81ea\u5df1\u5f00\u4e00\u684c\uff0c\u4e5f\u53ef\u4ee5\u52a0\u5165\u522b\u4eba\u5df2\u7ecf\u521b\u5efa\u7684\u623f\u95f4\uff1b\u724c\u5c40\u8fdb\u884c\u4e2d\u9ed8\u8ba4\u4ee5\u89c2\u6218\u8eab\u4efd\u8fdb\u5165\u3002</div>',
                '<div class="games-stage-meta">扑克牌颜色、徽标和房间背景统一跟随页面里的局外养成，这里不再单独设置。</div>',
                '<div class="game-zhajinhua-join-bar">',
                '  <input class="game-room-select" id="zhajinhuaRoomInput" type="text" maxlength="8" placeholder="输入房间号加入" value="' + escapeHtml(rememberedRoomCode) + '">',
                '  <button class="games-btn games-btn--primary" type="button" id="zhajinhuaCreateBtn">创建房间</button>',
                '  <button class="games-btn" type="button" id="zhajinhuaJoinBtn">加入上桌</button>',
                '  <button class="games-btn" type="button" id="zhajinhuaWatchBtn">观战</button>',
                "</div>",
                '<div class="game-room-list">' + roomList.map(function (item) {
                    const canJoinPlayer = item.status !== "playing" && Number(item.player_count || 0) < 10;
                    const players = Array.isArray(item.players) ? item.players : [];
                    return [
                        '<div class="game-room-item">',
                        '  <div class="game-room-item-main">',
                        '    <strong>房间 ' + escapeHtml(String(item.room_code || "")) + "</strong>",
                        "    <div class=\"games-stage-meta\">状态 " + escapeHtml(String(item.status || "lobby")) + " · 底金 " + escapeHtml(String(item.base_stake || 0)) + " · 在线 " + escapeHtml(String(item.online_count || 0)) + "</div>",
                        "    <div class=\"games-stage-meta\">人数 " + escapeHtml(String(item.player_count || 0)) + " / 10 · 观战 " + escapeHtml(String(item.spectator_count || 0)) + "</div>",
                        (
                            players.length
                                ? ('    <div class="game-room-players">' + players.map(function (player) {
                                    const statusBits = [];
                                    if (player && player.is_ready) {
                                        statusBits.push("已准备");
                                    }
                                    if (player && player.is_seen) {
                                        statusBits.push("已看牌");
                                    }
                                    if (player && player.is_folded) {
                                        statusBits.push("已弃牌");
                                    }
                                    if (player && !player.is_online) {
                                        statusBits.push("离线");
                                    }
                                    return '<span class="game-room-player-chip">' + escapeHtml(String((player && player.display_name) || "玩家")) + (statusBits.length ? (' · ' + escapeHtml(statusBits.join(" · "))) : "") + '</span>';
                                }).join("") + '</div>')
                                : ""
                        ),
                        "  </div>",
                        '  <div class="game-room-actions">',
                        '    <button class="games-btn' + (canJoinPlayer ? " games-btn--primary" : "") + '" type="button" data-zhajinhua-enter="' + escapeHtml(String(item.room_code || "")) + '" data-zhajinhua-spectate="' + (canJoinPlayer ? "0" : "1") + '">' + (canJoinPlayer ? "加入上桌" : "进入观战") + "</button>",
                        '    <button class="games-btn" type="button" data-zhajinhua-enter="' + escapeHtml(String(item.room_code || "")) + '" data-zhajinhua-spectate="1">仅观战</button>',
                        "  </div>",
                        "</div>"
                    ].join("");
                }).join("") + "</div>"
            ].join("");
            controlCardEl.insertAdjacentHTML("beforeend", renderRecordsSection());
            const roomInput = controlCardEl.querySelector("#zhajinhuaRoomInput");
            const readRoomCode = function () {
                return String((roomInput && roomInput.value) || rememberedRoomCode || "").trim().toUpperCase();
            };
            controlCardEl.querySelector("#zhajinhuaCreateBtn").addEventListener("click", function () {
                emitWithIdentity("zhajinhua_join", { cosmetics: zhajinhuaCosmeticsPayload() });
            });
            controlCardEl.querySelector("#zhajinhuaJoinBtn").addEventListener("click", function () {
                const roomCode = readRoomCode();
                if (!roomCode) {
                    setStatus("请输入房间号", true);
                    return;
                }
                emitWithIdentity("zhajinhua_join", { room_code: roomCode, spectate: false, cosmetics: zhajinhuaCosmeticsPayload() });
            });
            controlCardEl.querySelector("#zhajinhuaWatchBtn").addEventListener("click", function () {
                const roomCode = readRoomCode();
                if (!roomCode) {
                    setStatus("请输入房间号", true);
                    return;
                }
                emitWithIdentity("zhajinhua_join", { room_code: roomCode, spectate: true, cosmetics: zhajinhuaCosmeticsPayload() });
            });
            controlCardEl.querySelectorAll("[data-zhajinhua-enter]").forEach(function (button) {
                button.addEventListener("click", function () {
                    emitWithIdentity("zhajinhua_join", {
                        room_code: String(button.getAttribute("data-zhajinhua-enter") || ""),
                        spectate: String(button.getAttribute("data-zhajinhua-spectate") || "") === "1",
                        cosmetics: zhajinhuaCosmeticsPayload()
                    });
                });
            });
            const lobbyRecordsBtn = controlCardEl.querySelector("#zhajinhuaToggleRecordsBtn");
            if (lobbyRecordsBtn) {
                lobbyRecordsBtn.addEventListener("click", function () {
                    openRecordsModal();
                });
            }
        }

        function renderRoomCard() {
            const players = room && Array.isArray(room.players) ? room.players : [];
            const spectators = room && Array.isArray(room.spectators) ? room.spectators : [];
            const me = selfPlayer();
            const selfRole = room ? room.self_role : "";
            const isHost = room && room.host_player_id === playerId;
            const isPlaying = room && room.status === "playing";
            const startLabel = room && room.status === "finished" ? "开始下一手" : "开始发牌";
            controlCardEl.innerHTML = [
                '<div class="games-stage-meta">底金由房主统一设置。首局需要上桌玩家全部准备，之后每一手都由房主手动开始；发牌后默认暗牌，是否看牌由玩家自己决定。</div>',
                '<div class="games-stage-meta">当前配置：爽局概率 ' + escapeHtml(specialRoundChanceText()) + '，单次押注/跟注/比牌支付上限 ' + escapeHtml(maxBetAmountText()) + '。</div>',
                '<div class="games-stage-meta">扑克牌颜色、徽标和房间背景统一跟随页面里的局外养成，这里不再单独设置。</div>',
                '<div class="game-room-players">' + players.map(function (player) {
                    const appearance = playerAppearance(player);
                    const selfText = player.player_id === playerId ? " · 你" : "";
                    const deadText = player.is_dead ? " · 比牌失败" : "";
                    const foldedText = player.is_folded ? " · 已弃牌" : "";
                    const seenText = player.is_seen ? " · 已看牌" : " · 暗牌";
                    const readyText = !isPlaying && player.is_ready ? " · 已准备" : "";
                    const lockedText = player.is_score_locked ? " · 负分锁定" : "";
                    return '<span class="game-room-player-chip"><span class="game-room-player-stone" style="' + cardStyle(appearance.color) + '"></span>' + escapeHtml(String(player.display_name || "玩家")) + readyText + seenText + foldedText + deadText + lockedText + selfText + (player.is_online ? "" : " · 离线") + '</span>';
                }).join("") + '</div>',
                '<div class="game-zhajinhua-stakes">' + players.map(function (player) {
                    return '<div class="game-zhajinhua-stake-row"><strong>' + escapeHtml(String(player.display_name || "玩家")) + '</strong><span>本局投入 ' + escapeHtml(String(player.total_bet || 0)) + ' / 积分 ' + escapeHtml(String(player.total_score || 0)) + (player.is_score_locked ? ' / 负分锁定' : '') + '</span></div>';
                }).join("") + '</div>',
                (isHost && !isPlaying ? (
                    '<div class="game-zhajinhua-base-bar">' +
                    '  <input type="number" min="1" max="' + escapeHtml(maxBetAmountText()) + '" step="1" class="game-room-select game-zhajinhua-base-input" id="zhajinhuaBaseStakeInput" value="' + escapeHtml(baseStakeDraft || String(room.base_stake || 0)) + '" placeholder="设置底金">' +
                    '  <button class="games-btn" type="button" id="zhajinhuaBaseStakeBtn">设置底金</button>' +
                    '</div>'
                ) : ('<div class="games-stage-meta">当前底金：' + escapeHtml(String(room.base_stake || 0)) + '</div>')),
                (spectators.length ? ('<div class="games-stage-meta">观战席：' + spectators.map(function (spectator) { return escapeHtml(String(spectator.display_name || "观众")) + (spectator.is_online ? "" : "（离线）"); }).join(" / ") + '</div>') : '<div class="games-stage-meta">当前暂无观战者。</div>'),
                '<div class="games-stage-meta">房间在线：' + escapeHtml(String(room.online_count || 0)) + '，玩家在线：' + escapeHtml(String(room.online_player_count || 0)) + '，观战在线：' + escapeHtml(String(room.online_spectator_count || 0)) + '</div>',
                '<div class="game-room-actions">',
                (selfRole === "player" && !isPlaying ? ('  <button class="games-btn" type="button" id="zhajinhuaReadyBtn"' + (me && me.is_score_locked ? ' disabled' : '') + '>' + (me && me.is_ready ? "取消准备" : "准备") + '</button>') : ""),
                (selfRole === "player" && isHost && !isPlaying ? '<button class="games-btn games-btn--primary" type="button" id="zhajinhuaStartBtn" ' + (room.can_start ? '' : 'disabled') + '>' + startLabel + '</button>' : ""),
                (selfRole === "player" && players.length > 1 ? '<button class="games-btn" type="button" id="zhajinhuaSwitchWatchBtn">转为观战</button>' : ""),
                (selfRole === "spectator" && !isPlaying && Number(room.player_count || 0) < 10 ? '<button class="games-btn" type="button" id="zhajinhuaSwitchPlayBtn">加入上桌</button>' : ""),
                '  <button class="games-btn" type="button" id="zhajinhuaLeaveBtn">离开房间</button>',
                '</div>',
                '<div class="games-stage-meta">最近战报：' + escapeHtml(latestHistoryLine()) + '</div>'
            ].join("");
            controlCardEl.insertAdjacentHTML("beforeend", renderRecordsSection());

            const readyBtn = controlCardEl.querySelector("#zhajinhuaReadyBtn");
            if (readyBtn) {
                readyBtn.addEventListener("click", function () {
                    emitWithIdentity("zhajinhua_toggle_ready", { room_code: room.room_code });
                });
            }
            const baseInput = controlCardEl.querySelector("#zhajinhuaBaseStakeInput");
            const baseBtn = controlCardEl.querySelector("#zhajinhuaBaseStakeBtn");
            if (baseInput) {
                baseInput.addEventListener("input", function () {
                    baseStakeDraft = baseInput.value || "";
                });
                baseInput.addEventListener("keydown", function (event) {
                    if (event.key === "Enter" && baseBtn) {
                        event.preventDefault();
                        baseBtn.click();
                    }
                });
            }
            if (baseBtn) {
                baseBtn.addEventListener("click", function () {
                    emitWithIdentity("zhajinhua_set_base_stake", {
                        room_code: room.room_code,
                        base_stake: Math.max(1, Number(baseStakeDraft || room.base_stake || 1))
                    });
                });
            }
            const startBtn = controlCardEl.querySelector("#zhajinhuaStartBtn");
            if (startBtn) {
                startBtn.addEventListener("click", function () {
                    emitWithIdentity("zhajinhua_start", { room_code: room.room_code });
                });
            }
            const switchWatchBtn = controlCardEl.querySelector("#zhajinhuaSwitchWatchBtn");
            if (switchWatchBtn) {
                switchWatchBtn.addEventListener("click", function () {
                    emitWithIdentity("zhajinhua_switch_role", {
                        room_code: room.room_code,
                        spectate: true,
                        cosmetics: zhajinhuaCosmeticsPayload()
                    });
                });
            }
            const switchPlayBtn = controlCardEl.querySelector("#zhajinhuaSwitchPlayBtn");
            if (switchPlayBtn) {
                switchPlayBtn.addEventListener("click", function () {
                    emitWithIdentity("zhajinhua_switch_role", {
                        room_code: room.room_code,
                        spectate: false,
                        cosmetics: zhajinhuaCosmeticsPayload()
                    });
                });
            }
            if (selfRole === "player" && isHost) {
                const actionsRow = controlCardEl.querySelector(".game-room-actions");
                const leaveAnchor = controlCardEl.querySelector("#zhajinhuaLeaveBtn");
                if (actionsRow && leaveAnchor && !controlCardEl.querySelector("#zhajinhuaDissolveBtn")) {
                    const dissolveBtn = document.createElement("button");
                    dissolveBtn.className = "games-btn";
                    dissolveBtn.type = "button";
                    dissolveBtn.id = "zhajinhuaDissolveBtn";
                    dissolveBtn.textContent = "解散房间";
                    actionsRow.insertBefore(dissolveBtn, leaveAnchor);
                }
            }
            const dissolveBtn = controlCardEl.querySelector("#zhajinhuaDissolveBtn");
            if (dissolveBtn) {
                dissolveBtn.addEventListener("click", function () {
                    if (!window.confirm("确定要解散这个房间吗？房内所有人都会被退出到大厅。")) {
                        return;
                    }
                    emitWithIdentity("zhajinhua_dissolve", { room_code: room.room_code });
                });
            }
            const leaveBtn = controlCardEl.querySelector("#zhajinhuaLeaveBtn");
            if (leaveBtn) {
                leaveBtn.addEventListener("click", function () {
                    emitWithIdentity("zhajinhua_leave", { room_code: room.room_code });
                    room = null;
                    saveRememberedRoomCode("");
                    renderAll();
                });
            }
            const roomRecordsBtn = controlCardEl.querySelector("#zhajinhuaToggleRecordsBtn");
            if (roomRecordsBtn) {
                roomRecordsBtn.addEventListener("click", function () {
                    openRecordsModal();
                });
            }
        }

        function bindActionControls(root) {
            if (!root || !room) {
                return;
            }
            const lookBtn = root.querySelector("#zhajinhuaLookBtn");
            if (lookBtn) {
                lookBtn.addEventListener("click", function () {
                    emitRealtimeAction("zhajinhua_look", { room_code: room.room_code }, "看牌");
                });
            }
            const followBtn = root.querySelector("#zhajinhuaFollowBtn");
            if (followBtn) {
                followBtn.addEventListener("click", function () {
                    emitRealtimeAction("zhajinhua_follow", { room_code: room.room_code }, "跟注");
                });
            }
            const raiseInput = root.querySelector("#zhajinhuaRaiseInput");
            if (raiseInput) {
                raiseInput.addEventListener("input", function () {
                    raiseAmountDraft = raiseInput.value || "";
                });
                raiseInput.addEventListener("keydown", function (event) {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        const raiseBtn = root.querySelector("#zhajinhuaRaiseBtn");
                        if (raiseBtn) {
                            raiseBtn.click();
                        }
                    }
                });
            }
            const raiseBtn = root.querySelector("#zhajinhuaRaiseBtn");
            if (raiseBtn) {
                raiseBtn.addEventListener("click", function () {
                    const rawAmount = raiseInput ? raiseInput.value : raiseAmountDraft;
                    const nextAmount = Math.max(1, Number(rawAmount || 0));
                    const currentBet = Math.max(0, Number(room.current_bet || 0));
                    raiseAmountDraft = String(nextAmount);
                    if (nextAmount <= currentBet) {
                        setStatus("加注金额必须大于当前注", true);
                        return;
                    }
                    emitRealtimeAction("zhajinhua_raise", {
                        room_code: room.room_code,
                        amount: nextAmount
                    }, "加注 " + String(nextAmount));
                });
            }
            const foldBtn = root.querySelector("#zhajinhuaFoldBtn");
            if (foldBtn) {
                foldBtn.addEventListener("click", function () {
                    emitRealtimeAction("zhajinhua_fold", { room_code: room.room_code }, "弃牌");
                });
            }
            const compareSelect = root.querySelector("#zhajinhuaCompareSelect");
            if (compareSelect) {
                compareSelect.addEventListener("change", function () {
                    compareTargetDraft = compareSelect.value || "";
                });
            }
            const compareBtn = root.querySelector("#zhajinhuaCompareBtn");
            if (compareBtn) {
                compareBtn.addEventListener("click", function () {
                    if (!compareTargetDraft) {
                        setStatus("请选择比牌目标", true);
                        return;
                    }
                    const compareTarget = compareTargets().find(function (player) {
                        return player && player.player_id === compareTargetDraft;
                    });
                    emitRealtimeAction("zhajinhua_compare", {
                        room_code: room.room_code,
                        target_player_id: compareTargetDraft
                    }, "比牌" + (compareTarget ? " · " + String(compareTarget.display_name || "玩家") : ""));
                });
            }
        }



        function renderTable() {
            if (!room) {
                tableWrapEl.innerHTML = '<div class="games-stage-meta">\u5f53\u524d\u5c1a\u672a\u52a0\u5165\u623f\u95f4\u3002</div>';
                return;
            }
            const players = room && Array.isArray(room.players) ? room.players : [];
            const appearance = currentAppearance();
            const layout = tableLayoutMode(players.length);
            tableWrapEl.innerHTML = [
                '<div class="game-zhajinhua-table" style="' + roomBackgroundStyle(appearance.background) + '">',
                '  <div class="game-zhajinhua-player-grid' + (layout.listLayout ? ' is-list' : '') + '">',
                players.map(function (player) {
                    const isSelf = player.player_id === playerId;
                    const isTurn = room.turn_player_id === player.player_id && room.status === "playing";
                    const cards = visibleCards(player);
                    const reveal = shouldRevealPlayerCards(player);
                    const shownCards = reveal ? cards : [null, null, null];
                    const statusText = player.is_score_locked
                        ? "\u79ef\u5206\u8d1f\u6570\u9501\u5b9a"
                        : (player.is_dead ? "\u6bd4\u724c\u5931\u8d25" : (player.is_folded ? "\u5df2\u5f03\u724c" : (player.is_seen ? "\u5df2\u770b\u724c" : "\u6697\u724c")));
                    return [
                        '<div class="game-zhajinhua-player-card' + (isSelf ? ' is-self' : '') + (isTurn ? ' is-turn' : '') + (player.is_folded ? ' is-folded' : '') + (layout.compactCards ? ' is-compact' : '') + '">',
                        '  <div class="game-zhajinhua-player-head">',
                        '    <strong>' + escapeHtml(String(player.display_name || "\u73a9\u5bb6")) + (isSelf ? " \u00b7 \u4f60" : "") + (isTurn ? ' <span class="game-zhajinhua-turn-badge">\u64cd\u4f5c\u4e2d</span>' : "") + '</strong>',
                        '    <span>' + escapeHtml(statusText) + '</span>',
                        '  </div>',
                        '  <div class="game-zhajinhua-player-meta">\u6295\u5165 ' + escapeHtml(String(player.total_bet || 0)) + ' \u00b7 \u79ef\u5206 ' + escapeHtml(String(player.total_score || 0)) + (player.is_online ? '' : ' \u00b7 \u79bb\u7ebf') + '</div>',
                        '  <div class="game-zhajinhua-cards' + (layout.stackedCards ? ' is-stacked' : '') + '">' + shownCards.map(function (card, index) {
                            return renderCard(card, player, {
                                compact: layout.compactCards,
                                stacked: layout.stackedCards,
                                index: index
                            });
                        }).join('') + '</div>',
                        '  <div class="game-zhajinhua-player-meta">' + escapeHtml(reveal ? (player.hand_kind_label || "\u672a\u5f00\u724c") : "\u724c\u578b\u672a\u516c\u5f00") + '</div>',
                        '</div>'
                    ].join('');
                }).join(''),
                '  </div>',
                '</div>'
            ].join('');
        }

        function renderLogPanel() {
            if (!room) {
                logPanelEl.innerHTML = '<div class="games-stage-meta">\u8fdb\u5165\u623f\u95f4\u540e\uff0c\u8fd9\u91cc\u4f1a\u663e\u793a\u6bcf\u4e00\u6b65\u64cd\u4f5c\u8bb0\u5f55\u3002</div>';
                return;
            }
            const entries = Array.isArray(room.action_log) ? room.action_log : [];
            const pendingRow = pendingAction
                ? [
                    '<div class="game-zhajinhua-log-bubble is-pending" style="' + bubbleStyleForAppearance(currentAppearance()) + '">',
                    '  <div class="game-zhajinhua-log-meta"><strong>SYNC</strong><span>' + escapeHtml(socketTransportLabel) + '</span></div>',
                    '  <div class="game-zhajinhua-log-text">\u5df2\u53d1\u9001\uff1a' + escapeHtml(String(pendingAction.label || "\u64cd\u4f5c")) + '\uff0c\u6b63\u5728\u540c\u6b65\u724c\u5c40\u2026</div>',
                    '</div>'
                ].join("")
                : "";
            logPanelEl.innerHTML = (pendingRow || entries.length)
                ? pendingRow + entries.map(function (entry) {
                    const actor = entry && entry.actor_player_id ? playerById(entry.actor_player_id) : null;
                    const actorLabel = actor ? String(actor.display_name || "\u73a9\u5bb6") : "SYSTEM";
                    return [
                        '<div class="game-zhajinhua-log-bubble' + (actor ? '' : ' is-system') + '" style="' + logBubbleStyle(entry) + '">',
                        '  <div class="game-zhajinhua-log-meta"><strong>' + escapeHtml(actorLabel) + '</strong><span>' + escapeHtml(formatEntryTime(entry.created_at)) + '</span></div>',
                        '  <div class="game-zhajinhua-log-text">' + escapeHtml(String(entry.text || '')) + '</div>',
                        '</div>'
                    ].join("");
                }).join('')
                : '<div class="games-stage-meta">\u672c\u5c40\u8fd8\u6ca1\u6709\u65b0\u7684\u64cd\u4f5c\u8bb0\u5f55\u3002</div>';
            logPanelEl.scrollTop = logPanelEl.scrollHeight;
        }

        function renderActionPanel() {
            if (!room) {
                actionPanelEl.innerHTML = '<div class="games-stage-meta">\u8fdb\u5165\u623f\u95f4\u540e\u53ef\u5728\u8fd9\u91cc\u5b8c\u6210\u770b\u724c\u3001\u8ddf\u6ce8\u3001\u52a0\u6ce8\u3001\u6bd4\u724c\u548c\u5f03\u724c\u3002</div>';
                return;
            }
            const me = selfPlayer();
            const isMyTurn = isMyActionTurn();
            const turnPlayer = (room.players || []).find(function (player) {
                return player && player.player_id === room.turn_player_id;
            }) || null;
            const targets = compareTargets();
            const raiseOptions = availableRaiseAmounts();
            const minRaiseAmount = Math.max(Number(room.current_bet || 0) + 1, Number(room.base_stake || 1));
            const suggestedRaiseAmount = raiseOptions.length ? Math.max(minRaiseAmount, Number(raiseOptions[0] || 0)) : minRaiseAmount;
            const isPending = Boolean(pendingAction);
            const canAct = Boolean(isMyTurn && me && !isPending);
            const canLook = Boolean(canAct && !me.is_seen);
            if (targets.length && !targets.some(function (player) { return player.player_id === compareTargetDraft; })) {
                compareTargetDraft = String(targets[0].player_id || "");
            }
            if (!compareTargetDraft && targets.length) {
                compareTargetDraft = String(targets[0].player_id || "");
            }
            if (!raiseAmountDraft || Number(raiseAmountDraft || 0) <= Number(room.current_bet || 0)) {
                raiseAmountDraft = String(suggestedRaiseAmount);
            }
            actionPanelEl.innerHTML = [
                '<div class="game-zhajinhua-action-state' + (canAct ? ' is-active' : ' is-disabled') + (isPending ? ' is-pending' : '') + '">',
                '  <div class="game-zhajinhua-turn-hint">' + escapeHtml(
                    isPending
                        ? ("\u5df2\u53d1\u9001\u300c" + String((pendingAction && pendingAction.label) || "\u64cd\u4f5c") + "\u300d\uff0c\u6b63\u5728\u901a\u8fc7 " + socketTransportLabel + " \u540c\u6b65\u2026")
                        : (canAct
                        ? "\u8f6e\u5230\u4f60\u64cd\u4f5c\uff0c\u76f4\u63a5\u5728\u8fd9\u91cc\u5b8c\u6210\u52a8\u4f5c\u3002"
                        : (turnPlayer ? ("\u5f53\u524d\u7531 " + String(turnPlayer.display_name || "\u73a9\u5bb6") + " \u64cd\u4f5c\uff0c\u6309\u94ae\u5df2\u6682\u65f6\u7f6e\u7070\u3002") : "\u5f53\u524d\u8fd8\u6ca1\u6709\u8f6e\u5230\u4efb\u4f55\u73a9\u5bb6\u64cd\u4f5c\u3002"))
                ) + '</div>',
                '  <div class="game-zhajinhua-action-bar">',
                '    <button class="games-btn" type="button" id="zhajinhuaLookBtn"' + (canLook ? '' : ' disabled') + '>\u770b\u724c</button>',
                '    <button class="games-btn games-btn--primary" type="button" id="zhajinhuaFollowBtn"' + (canAct ? '' : ' disabled') + '>\u8ddf\u6ce8</button>',
                '    <button class="games-btn" type="button" id="zhajinhuaFoldBtn"' + (canAct ? '' : ' disabled') + '>\u5f03\u724c</button>',
                '  </div>',
                '  <div class="game-zhajinhua-action-bar">',
                '    <input type="number" min="' + escapeHtml(String(minRaiseAmount)) + '" max="' + escapeHtml(maxBetAmountText()) + '" step="1" class="game-room-select game-zhajinhua-raise-input" id="zhajinhuaRaiseInput" value="' + escapeHtml(String(raiseAmountDraft || suggestedRaiseAmount)) + '" placeholder="\u8f93\u5165\u52a0\u6ce8\u91d1\u989d"' + (canAct ? '' : ' disabled') + '>',
                '    <button class="games-btn" type="button" id="zhajinhuaRaiseBtn"' + (canAct ? '' : ' disabled') + '>\u52a0\u6ce8</button>',
                '  </div>',
                (targets.length ? (
                    '  <div class="game-zhajinhua-compare-row">' +
                    '    <select class="game-room-select" id="zhajinhuaCompareSelect"' + (canAct ? '' : ' disabled') + '>' + targets.map(function (player) {
                        const selected = compareTargetDraft === player.player_id ? ' selected' : '';
                        return '<option value="' + escapeHtml(String(player.player_id || '')) + '"' + selected + '>' + escapeHtml(String(player.display_name || "\u73a9\u5bb6")) + '</option>';
                    }).join('') + '</select>' +
                    '    <button class="games-btn" type="button" id="zhajinhuaCompareBtn"' + (canAct ? '' : ' disabled') + '>\u6bd4\u724c</button>' +
                    '  </div>'
                ) : '  <div class="game-zhajinhua-turn-hint">\u5f53\u524d\u6ca1\u6709\u53ef\u9009\u7684\u6bd4\u724c\u76ee\u6807\u3002</div>'),
                '  <div class="game-zhajinhua-turn-hint">\u5f53\u524d\u6ce8 ' + escapeHtml(String(room.current_bet || 0)) + ' \u00b7 \u5956\u6c60 ' + escapeHtml(String(room.pot || 0)) + ' \u00b7 \u5e95\u91d1 ' + escapeHtml(String(room.base_stake || 0)) + ' \u00b7 \u5355\u6b21\u4e0a\u9650 ' + escapeHtml(maxBetAmountText()) + ' \u00b7 ' + socketTransportLabel + '</div>',
                '</div>'
            ].join('');
            bindActionControls(actionPanelEl);
        }

        function renderAll() {
            updateStageHeader();
            if (!room) {
                turnMetaEl.textContent = "创建或加入房间后即可开始。";
                renderLobbyCard();
                renderTable();
                renderLogPanel();
                renderActionPanel();
                if (recordsExpanded) {
                    recordsModalBodyEl.innerHTML = renderRecordsModalContent();
                    recordsModalEl.hidden = false;
                }
                return;
            }
            if (room.self_role === "spectator" && room.status === "playing") {
                const turnPlayer = (room.players || []).find(function (player) { return player.player_id === room.turn_player_id; }) || null;
                turnMetaEl.textContent = "第 " + String(room.round_count || 0) + " / " + String(room.max_round || 20) + " 轮 · 观战中，当前由 " + String((turnPlayer && turnPlayer.display_name) || "某位玩家") + " 操作。";
            } else if (room.status === "playing") {
                turnMetaEl.textContent = "第 " + String(room.round_count || 0) + " / " + String(room.max_round || 20) + " 轮 · " + (room.turn_player_id === playerId ? "轮到你操作，请直接在牌桌上的操作层选择动作。" : "等待其他玩家操作。") ;
            } else if (room.status === "finished") {
                turnMetaEl.textContent = room.winner_label
                    ? ("本手结束，" + room.winner_label + " 赢下奖池。下一手由房主手动开始。" + (room.is_special_round ? " 本局为爽局。" : ""))
                    : ("本手已结束，下一手由房主手动开始。" + (room.is_special_round ? " 本局为爽局。" : ""));
            } else {
                turnMetaEl.textContent = "房主设置底金后，首局需要上桌玩家全部准备；之后每一手都由房主手动开始。";
            }
            renderRoomCard();
            renderTable();
            renderLogPanel();
            renderActionPanel();
            if (recordsExpanded) {
                recordsModalBodyEl.innerHTML = renderRecordsModalContent();
                recordsModalEl.hidden = false;
            }
        }

        socket.on("zhajinhua_room", function (payload) {
            clearPendingAction();
            room = payload;
            syncSettledRoomProfile(room);
            const me = selfPlayer();
            if (me) {
                const selfCosmetics = playerCosmetics(me);
                let cosmeticsChanged = false;
                if (selfCosmetics.colorKey && metaState.ownedColors.indexOf(selfCosmetics.colorKey) !== -1) {
                    cosmeticsChanged = cosmeticsChanged || metaState.equippedColor !== selfCosmetics.colorKey;
                    metaState.equippedColor = selfCosmetics.colorKey;
                }
                if (selfCosmetics.iconKey && metaState.ownedIcons.indexOf(selfCosmetics.iconKey) !== -1) {
                    cosmeticsChanged = cosmeticsChanged || metaState.equippedIcon !== selfCosmetics.iconKey;
                    metaState.equippedIcon = selfCosmetics.iconKey;
                }
                if (selfCosmetics.backgroundKey && metaState.ownedBackgrounds.indexOf(selfCosmetics.backgroundKey) !== -1) {
                    cosmeticsChanged = cosmeticsChanged || metaState.equippedBackground !== selfCosmetics.backgroundKey;
                    metaState.equippedBackground = selfCosmetics.backgroundKey;
                }
                if (cosmeticsChanged) {
                    persistMeta();
                }
            }
            baseStakeDraft = String(room.base_stake || 0);
            saveRememberedRoomCode((payload && payload.room_code) || "");
            renderAll();
        });

        socket.on("zhajinhua_rooms", function (payload) {
            roomList = Array.isArray(payload) ? payload : [];
            if (!room || recordsExpanded) {
                renderAll();
            }
            if (recordsExpanded) {
                recordsModalBodyEl.innerHTML = renderRecordsModalContent();
            }
        });

        socket.on("zhajinhua_records", function (payload) {
            globalRecords = Array.isArray(payload) ? payload : [];
            if (!room || recordsExpanded) {
                renderAll();
            }
            if (recordsExpanded) {
                recordsModalBodyEl.innerHTML = renderRecordsModalContent();
            }
        });

        socket.on("zhajinhua_error", function (payload) {
            clearPendingAction();
            setStatus((payload && payload.error) || "炸金花操作失败", true);
            renderAll();
        });

        socket.on("connect", function () {
            refreshSocketTransportLabel();
            clearPendingAction();
            setStatus("联机炸金花已通过 " + socketTransportLabel + " 连接。", false);
            if (rememberedRoomCode) {
                emitWithIdentity("zhajinhua_join", { room_code: rememberedRoomCode, spectate: true, cosmetics: zhajinhuaCosmeticsPayload() });
            }
        });

        socket.on("connect_error", function () {
            clearPendingAction();
            setStatus("WebSocket 连接失败，请检查网络后重试。", true);
            renderAll();
        });

        socket.on("disconnect", function () {
            clearPendingAction();
            setStatus("联机炸金花的 WebSocket 已断开。", true);
            renderAll();
        });

        socket.on("zhajinhua_room_closed", function (payload) {
            clearPendingAction();
            if (room && payload && payload.room_code && String(payload.room_code) !== String(room.room_code || "")) {
                return;
            }
            room = null;
            saveRememberedRoomCode("");
            closeRecordsModal();
            setStatus("房间已被房主解散，已返回大厅。", false);
            renderAll();
        });

        shell.querySelectorAll("[data-close-zhajinhua-records]").forEach(function (element) {
            element.addEventListener("click", function () {
                closeRecordsModal();
            });
        });

        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && !recordsModalEl.hidden) {
                closeRecordsModal();
            }
        });

        state.topdownMetaRefresh = function () {
            metaState = getTopdownSharedMetaState(metaState);
            if (room) {
                emitWithIdentity("zhajinhua_update_cosmetics", {
                    room_code: room.room_code,
                    cosmetics: zhajinhuaCosmeticsPayload()
                });
            }
            renderAll();
        };

        rememberedRoomCode = loadRememberedRoomCode();
        renderAll();

        return function cleanup() {
            state.topdownMetaRefresh = null;
            setStageStats([]);
            socket.disconnect();
        };
    }

    modules.register("zhajinhua", mountZhajinhua);
})();
