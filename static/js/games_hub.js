(function () {
    "use strict";

    const config = window.gamesHubConfig || {};
    const HEX_SYMBOLS = "0123456789ABCDEF".split("");
    const CLASSIC_SYMBOLS = "123456789".split("");
    const DRAWHONE_NAMESPACE = "/games-drawphone";

    const state = {
        manifest: { games: [] },
        profile: null,
        history: [],
        leaderboards: null,
        onlineVisitors: [],
        activeGameId: null,
        activeCleanup: null,
        saveTimers: Object.create(null),
        presenceTimer: null,
        currentPresence: {
            current_game: "",
            play_status: "空闲中",
            room_code: ""
        },
        drawphoneRoomCode: config.initialRoomCode || "",
        launchToken: 0
    };

    function fnv1aHash(input) {
        let hash = 0x811c9dc5;
        const value = String(input || "");
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
    }

    function getGamesDeviceId() {
        if (window.__gamesDeviceId) {
            return String(window.__gamesDeviceId);
        }
        if (window.__nativeMachineId) {
            return String(window.__nativeMachineId);
        }
        const nav = window.navigator || {};
        const screenInfo = window.screen || {};
        const timezone = (window.Intl && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
        return "hw-" + fnv1aHash([
            nav.userAgent || "",
            nav.platform || "",
            nav.language || "",
            (nav.languages || []).join(","),
            nav.hardwareConcurrency || "",
            nav.deviceMemory || "",
            screenInfo.width || "",
            screenInfo.height || "",
            screenInfo.colorDepth || "",
            nav.maxTouchPoints || "",
            timezone || "",
            new Date().getTimezoneOffset()
        ].join("|")) + fnv1aHash([
            nav.vendor || "",
            nav.appVersion || "",
            nav.product || ""
        ].join("|"));
    }

    const classicPuzzles = [
        {
            id: "classic-easy-01",
            name: "入门 01",
            variant: "classic",
            difficulty: "easy",
            size: 9,
            subgrid: 3,
            symbols: CLASSIC_SYMBOLS,
            puzzle: "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
            solution: "534678912672195348198342567859761423426853791713924856961537284287419635345286179"
        },
        {
            id: "classic-easy-02",
            name: "入门 02",
            variant: "classic",
            difficulty: "easy",
            size: 9,
            subgrid: 3,
            symbols: CLASSIC_SYMBOLS,
            puzzle: "200080300060070084030500209000105408000000000402706000301007040720040060004010003",
            solution: "245981376169273584837564219976125438513498627482736951391657842728349165654812793"
        },
        {
            id: "classic-medium-01",
            name: "标准 01",
            variant: "classic",
            difficulty: "medium",
            size: 9,
            subgrid: 3,
            symbols: CLASSIC_SYMBOLS,
            puzzle: "000260701680070090190004500820100040004602900050003028009300074040050036703018000",
            solution: "435269781682571493197834562826195347374682915951743628519326874248957136763418259"
        },
        {
            id: "classic-medium-02",
            name: "标准 02",
            variant: "classic",
            difficulty: "medium",
            size: 9,
            subgrid: 3,
            symbols: CLASSIC_SYMBOLS,
            puzzle: "302609005000000040000010200700304009090000010800507003001040000080000000600708104",
            solution: "312649875958273641467815239721384569593426718846597423175942386284136957639758124"
        },
        {
            id: "classic-hard-01",
            name: "进阶 01",
            variant: "classic",
            difficulty: "hard",
            size: 9,
            subgrid: 3,
            symbols: CLASSIC_SYMBOLS,
            puzzle: "300000000005009000200504000020000700160000058704310600000890100000067080000005437",
            solution: "391682745475139826286574913823456791169723458754318692537894162942167385618245437"
        },
        {
            id: "classic-hard-02",
            name: "进阶 02",
            variant: "classic",
            difficulty: "hard",
            size: 9,
            subgrid: 3,
            symbols: CLASSIC_SYMBOLS,
            puzzle: "000000907000420180000705026100904000050000040000507009920108000034059000507000000",
            solution: "462831957795426183381795426173984265659312748248567319926178534834259671517643892"
        }
    ];

    function buildHexPuzzleDefinition(id, name, keepRule) {
        const size = 16;
        const subgrid = 4;
        const solutionChars = [];
        const puzzleChars = [];

        for (let row = 0; row < size; row += 1) {
            for (let col = 0; col < size; col += 1) {
                const index = (subgrid * (row % subgrid) + Math.floor(row / subgrid) + col) % size;
                const symbol = HEX_SYMBOLS[index];
                solutionChars.push(symbol);
                const keep = keepRule(row, col);
                puzzleChars.push(keep ? symbol : ".");
            }
        }

        return {
            id: id,
            name: name,
            variant: "hex",
            difficulty: "super",
            size: 16,
            subgrid: 4,
            symbols: HEX_SYMBOLS,
            puzzle: puzzleChars.join(""),
            solution: solutionChars.join("")
        };
    }

    const hexPuzzles = [
        buildHexPuzzleDefinition("hex-16-01", "HEX-16 Grid A", function (row, col) {
            return ((row * 11 + col * 7 + row * col) % 5 === 0) || ((row + col) % 7 === 0) || (row === col);
        }),
        buildHexPuzzleDefinition("hex-16-02", "HEX-16 Grid B", function (row, col) {
            return ((row * 13 + col * 5 + row + col) % 6 === 0) || ((row % 5) === (col % 5)) || ((row + col) % 9 === 0);
        }),
        buildHexPuzzleDefinition("hex-16-03", "HEX-16 Grid C", function (row, col) {
            return ((row * 3 + col * 17) % 7 === 0) || ((row ^ col) % 5 === 0) || (row === (15 - col));
        })
    ];
    const allSudokuPuzzles = classicPuzzles.concat(hexPuzzles);

    const els = {
        navList: document.getElementById("gamesNavList"),
        manifestList: document.getElementById("gamesManifestList"),
        stageToolbar: document.querySelector(".games-stage-toolbar"),
        stageTitle: document.getElementById("gamesStageTitle"),
        stageMeta: document.getElementById("gamesStageMeta"),
        stageBody: document.getElementById("gamesStageBody"),
        stageActions: document.getElementById("gamesStageActions"),
        statusBar: document.getElementById("gamesStatusBar"),
        statusChip: document.getElementById("gamesCurrentStatusChip"),
        onlineList: document.getElementById("gamesOnlineList"),
        nicknameInput: document.getElementById("gameNicknameInput"),
        bossPathInput: document.getElementById("gameBossPathInput"),
        bossKeySelect: document.getElementById("gameBossKeySelect"),
        bossKeyHint: document.getElementById("gamesBossKeyHint"),
        profileSaveBtn: document.getElementById("gameProfileSaveBtn"),
        profileEditBtn: document.getElementById("gameProfileEditBtn"),
        insightsBtn: document.getElementById("gamesInsightsBtn"),
        profileModal: document.getElementById("gamesProfileModal"),
        insightsModal: document.getElementById("gamesInsightsModal"),
        avatarInput: document.getElementById("gameAvatarInput"),
        avatarUploadBtn: document.getElementById("gameAvatarUploadBtn"),
        bossKeyBtn: document.getElementById("gamesBossKeyBtn"),
        profileName: document.getElementById("gameProfileName"),
        profileIp: document.getElementById("gameProfileIp"),
        avatarFrame: document.querySelector(".games-avatar-frame"),
        avatarImg: document.getElementById("gameProfileAvatar"),
        avatarFallback: document.getElementById("gameProfileAvatarFallback"),
        historyList: document.getElementById("gamesHistoryList"),
        weeklyTotalList: document.getElementById("gamesWeeklyTotalList"),
        weeklyGameList: document.getElementById("gamesWeeklyGameList"),
        weeklyGameTitle: document.getElementById("gamesWeeklyGameTitle"),
        weekKey: document.getElementById("gamesWeekKey")
    };

    function normalizeBossKeyValue(value) {
        const raw = String(value || "F9").trim().toUpperCase();
        return raw === "TAB" || raw === "SPACE" ? raw : "F9";
    }

    function getBossKeyValue(profile) {
        return normalizeBossKeyValue(profile && profile.boss_key);
    }

    function formatBossKeyLabel(value) {
        if (value === "TAB") {
            return "Tab";
        }
        if (value === "SPACE") {
            return "Space";
        }
        return "F9";
    }

    function isBossKeyEvent(event) {
        const bossKey = getBossKeyValue(state.profile);
        if (bossKey === "TAB") {
            return event.code === "Tab";
        }
        if (bossKey === "SPACE") {
            return event.code === "Space";
        }
        return event.code === "F9" || event.key === "F9";
    }

    function setStatus(message, isError) {
        if (!els.statusBar) {
            return;
        }
        els.statusBar.textContent = message;
        els.statusBar.style.color = isError ? "#fca5a5" : "#9cc7ff";
    }

    async function requestJson(url, options) {
        const requestOptions = Object.assign({}, options || {});
        const headers = new Headers(requestOptions.headers || {});
        headers.set("X-Games-Device-Id", getGamesDeviceId());
        const legacyDeviceId = window.sessionStorage ? String(sessionStorage.getItem("games-legacy-device-id") || "").trim() : "";
        if (legacyDeviceId && legacyDeviceId !== getGamesDeviceId()) {
            headers.set("X-Games-Legacy-Device-Id", legacyDeviceId);
        }
        requestOptions.headers = headers;
        const response = await fetch(url, requestOptions);
        const payload = await response.json().catch(function () {
            return { success: false, error: "响应解析失败" };
        });
        if (!response.ok || !payload.success) {
            throw new Error(payload.error || ("请求失败: " + response.status));
        }
        return payload.data;
    }

    function getStateUrl(gameId) {
        return String(config.stateUrlTemplate || "").replace("__GAME_ID__", encodeURIComponent(gameId));
    }

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function emptyNode(message) {
        const node = document.createElement("div");
        node.className = "games-empty-list";
        node.textContent = message;
        return node;
    }

    function formatSeconds(seconds) {
        const total = Math.max(0, Number(seconds || 0));
        const hours = Math.floor(total / 3600);
        const mins = Math.floor((total % 3600) / 60);
        const secs = total % 60;
        if (hours > 0) {
            return String(hours).padStart(2, "0") + ":" + String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
        }
        return String(mins).padStart(2, "0") + ":" + String(secs).padStart(2, "0");
    }

    function createGameStartOverlay(host, options) {
        const config = Object.assign({
            eyebrow: "开始说明",
            title: "准备开始",
            subtitle: "",
            bullets: [],
            hint: "",
            buttonLabel: "开始游戏",
            useStageActionButton: false
        }, options || {});
        const overlay = document.createElement("div");
        overlay.className = "game-start-overlay";
        overlay.innerHTML = [
            '<div class="game-start-frame' + (config.useStageActionButton ? "" : " game-start-frame--with-inline-button") + '">',
            (config.useStageActionButton ? "" : ('  <button type="button" class="games-btn games-btn--primary game-start-button">' + escapeHtml(config.buttonLabel) + "</button>")),
            '  <div class="game-start-card">',
            '    <div class="game-start-eyebrow">' + escapeHtml(config.eyebrow) + "</div>",
            '    <div class="game-start-title">' + escapeHtml(config.title) + "</div>",
            (config.subtitle ? '    <div class="game-start-subtitle">' + escapeHtml(config.subtitle) + "</div>" : ""),
            (config.bullets && config.bullets.length ? ('    <div class="game-start-list">' + config.bullets.map(function (item) {
                return '<div class="game-start-item">' + escapeHtml(item) + "</div>";
            }).join("") + "</div>") : ""),
            (config.hint ? '    <div class="game-start-hint">' + escapeHtml(config.hint) + "</div>" : ""),
            "  </div>",
            "</div>"
        ].join("");
        host.appendChild(overlay);
        let active = true;
        let stageButton = null;
        const button = overlay.querySelector(".game-start-button");

        function startNow() {
            if (!active) {
                return;
            }
            active = false;
            if (stageButton && stageButton.parentNode) {
                stageButton.remove();
            }
            overlay.classList.add("is-hidden");
            window.setTimeout(function () {
                overlay.remove();
            }, 220);
            if (typeof config.onStart === "function") {
                config.onStart();
            }
        }

        if (config.useStageActionButton) {
            stageButton = addStageButton(config.buttonLabel, startNow, true);
            stageButton.classList.add("game-start-stage-action");
        } else if (button) {
            button.addEventListener("click", startNow);
        }
        return {
            isActive: function () {
                return active;
            },
            dismiss: function () {
                if (active) {
                    startNow();
                }
            }
        };
    }

    function renderStageLoadingState(game, detailText) {
        if (!els.stageBody) {
            return;
        }
        const node = document.createElement("div");
        node.className = "games-loading-shell";
        node.innerHTML = [
            '<div class="games-loading-card">',
            '  <div class="games-loading-spinner" aria-hidden="true"></div>',
            '  <div class="games-loading-kicker">游戏正在加载中</div>',
            '  <div class="games-loading-title">' + escapeHtml(game && game.title ? game.title : "正在进入游戏") + "</div>",
            '  <div class="games-loading-meta">' + escapeHtml(detailText || "正在同步进度、初始化画面与资源，请稍候。") + "</div>",
            (game && game.summary ? ('  <div class="games-loading-summary">' + escapeHtml(game.summary) + "</div>") : ""),
            "</div>"
        ].join("");
        els.stageBody.innerHTML = "";
        els.stageBody.appendChild(node);
    }

    function getPuzzleById(id) {
        return allSudokuPuzzles.find(function (item) { return item.id === id; }) || classicPuzzles[0];
    }

    function getPuzzlesForMode(modeKey) {
        if (modeKey === "hex-16") {
            return hexPuzzles.slice();
        }
        const parts = String(modeKey || "classic-medium").split("-");
        const difficulty = parts[1] || "medium";
        return classicPuzzles.filter(function (item) {
            return item.difficulty === difficulty;
        });
    }

    function choosePuzzle(modeKey, previousPuzzleId) {
        const list = getPuzzlesForMode(modeKey);
        if (!list.length) {
            return classicPuzzles[0];
        }
        if (!previousPuzzleId) {
            return list[Math.floor(Math.random() * list.length)];
        }
        const currentIndex = list.findIndex(function (item) {
            return item.id === previousPuzzleId;
        });
        if (currentIndex === -1) {
            return list[Math.floor(Math.random() * list.length)];
        }
        return list[(currentIndex + 1) % list.length];
    }

    function getSudokuScoreSpec(modeKey) {
        const table = {
            "classic-easy": { base: 2200, difficultyBonus: 900, targetSeconds: 1800, timeRate: 1.1 },
            "classic-medium": { base: 3000, difficultyBonus: 1700, targetSeconds: 2400, timeRate: 1.35 },
            "classic-hard": { base: 4200, difficultyBonus: 3000, targetSeconds: 3000, timeRate: 1.8 },
            "hex-16": { base: 8800, difficultyBonus: 7600, targetSeconds: 5400, timeRate: 3.0 }
        };
        return table[modeKey] || table["classic-medium"];
    }

    function computeSudokuScore(modeKey, elapsedSeconds) {
        const spec = getSudokuScoreSpec(modeKey);
        const scoreMultiplier = 20;
        const timeBonus = Math.max(0, Math.round((spec.targetSeconds - Math.max(0, elapsedSeconds)) * spec.timeRate)) * scoreMultiplier;
        return {
            baseSalary: spec.base * scoreMultiplier,
            difficultyBonus: spec.difficultyBonus * scoreMultiplier,
            timeBonus: timeBonus,
            total: spec.base * scoreMultiplier + spec.difficultyBonus * scoreMultiplier + timeBonus
        };
    }

    function openProfileModal() {
        if (els.profileModal) {
            els.profileModal.hidden = false;
        }
    }

    function closeProfileModal() {
        if (els.profileModal) {
            els.profileModal.hidden = true;
        }
    }

    function openInsightsModal() {
        if (els.insightsModal) {
            els.insightsModal.hidden = false;
        }
    }

    function closeInsightsModal() {
        if (els.insightsModal) {
            els.insightsModal.hidden = true;
        }
    }

    function getRankTierClass(rank) {
        return "games-rank--" + String((rank && rank.key) || "blackiron");
    }

    function renderRankedName(entry) {
        const rank = entry && entry.rank ? entry.rank : { key: "blackiron", name: "黑铁" };
        const displayName = escapeHtml(entry.display_name || "");
        const totalScore = Number(entry.lifetime_score != null ? entry.lifetime_score : (entry.total_score != null ? entry.total_score : 0));
        return [
            '<span class="games-rank-badge ' + getRankTierClass(rank) + '">' + escapeHtml(rank.name || "黑铁") + "</span>",
            '<span class="games-ranked-name ' + getRankTierClass(rank) + '">' + displayName + "</span>",
            '<span class="games-ranked-total">总积分 ' + escapeHtml(totalScore) + "</span>"
        ].join(" ");
    }

    function renderProfile(profile) {
        state.profile = profile;
        const displayName = profile.display_name || profile.nickname || ("访客 " + String(profile.ip || "unknown").slice(-6).toUpperCase());
        if (els.profileName) {
            els.profileName.innerHTML = renderRankedName(profile);
        }
        if (els.profileIp) {
            els.profileIp.textContent = profile.identity_label || ("设备 " + String(profile.ip || "").slice(-8));
        }
        if (els.nicknameInput) {
            els.nicknameInput.value = profile.nickname || "";
        }
        if (els.bossPathInput) {
            els.bossPathInput.value = profile.boss_path || "";
        }
        if (els.bossKeySelect) {
            els.bossKeySelect.value = getBossKeyValue(profile);
        }
        if (els.statusChip) {
            els.statusChip.textContent = state.currentPresence.play_status || "空闲中";
        }
        if (els.bossKeyBtn) {
            els.bossKeyBtn.textContent = "触发老板键 " + formatBossKeyLabel(getBossKeyValue(profile));
        }
        renderBossKeyHint();
        const stageBossButton = document.querySelector("[data-boss-key-trigger='1']");
        if (stageBossButton) {
            stageBossButton.textContent = "老板键 " + formatBossKeyLabel(getBossKeyValue(profile));
        }

        const avatarUrl = profile.avatar_url || "";
        if (els.avatarImg) {
            els.avatarImg.src = avatarUrl;
        }
        if (els.avatarFrame) {
            els.avatarFrame.classList.toggle("has-image", Boolean(avatarUrl));
        }
        if (els.avatarFallback) {
            els.avatarFallback.textContent = (displayName || config.fallbackAvatarText || "I").slice(0, 1).toUpperCase();
        }
    }

    function renderBossKeyHint() {
        if (!els.bossKeyHint) {
            return;
        }
        const savedKey = getBossKeyValue(state.profile);
        const savedPath = state.profile && state.profile.boss_path ? String(state.profile.boss_path).trim() : "";
        const draftKey = normalizeBossKeyValue(els.bossKeySelect ? els.bossKeySelect.value : savedKey);
        const draftPath = els.bossPathInput ? els.bossPathInput.value.trim() : savedPath;
        const hasPendingChange = draftKey !== savedKey || draftPath !== savedPath;
        if (hasPendingChange) {
            els.bossKeyHint.textContent = "老板键将保存为 " + formatBossKeyLabel(draftKey) + "，安全目录为 " + (draftPath || "默认目录") + "；点击保存后立刻生效。";
            return;
        }
        els.bossKeyHint.textContent = "老板键当前为 " + formatBossKeyLabel(savedKey) + "，触发后会立刻切到安全目录；当前游玩状态会展示给同一局域网内的在线访客。";
    }

    function renderManifestList() {
        if (!els.manifestList) {
            return;
        }
        els.manifestList.innerHTML = "";
        (state.manifest.games || []).forEach(function (game) {
            const node = document.createElement("div");
            node.className = "games-manifest-item";
            node.innerHTML = [
                '<div class="games-manifest-title">' + escapeHtml(game.title || game.id) + "</div>",
                '<div class="games-manifest-meta">id: ' + escapeHtml(game.id || "") + " / " + escapeHtml(game.engine || "builtin") + "</div>",
                '<div class="games-manifest-meta">status: ' + escapeHtml(game.status || "ready") + "</div>"
            ].join("");
            els.manifestList.appendChild(node);
        });
    }

    function renderGameNav() {
        if (!els.navList) {
            return;
        }
        els.navList.innerHTML = "";
        (state.manifest.games || []).forEach(function (game, index) {
            if (!state.activeGameId && index === 0) {
                state.activeGameId = game.id;
            }
            const button = document.createElement("button");
            button.type = "button";
            button.className = "games-nav-item";
            button.classList.toggle("is-active", state.activeGameId === game.id);
            button.innerHTML = [
                '<div class="games-nav-title">' + escapeHtml(game.title || game.id) + "</div>",
                '<div class="games-nav-meta">' + escapeHtml(game.summary || "暂无说明") + "</div>"
            ].join("");
            button.addEventListener("click", function () {
                launchGame(game.id).catch(function (error) {
                    setStatus(error.message || "游戏加载失败", true);
                });
            });
            els.navList.appendChild(button);
        });
    }

    function updateActiveNav() {
        if (!els.navList) {
            return;
        }
        const items = state.manifest.games || [];
        Array.from(els.navList.children).forEach(function (node, index) {
            const game = items[index];
            node.classList.toggle("is-active", Boolean(game) && game.id === state.activeGameId);
        });
    }

    function renderOnlineVisitors() {
        if (!els.onlineList) {
            return;
        }
        els.onlineList.innerHTML = "";
        const others = state.onlineVisitors.filter(function (visitor) {
            return !(state.profile && visitor.ip === state.profile.ip);
        });
        if (!others.length) {
            els.onlineList.appendChild(emptyNode("暂时没有其他在线访客。"));
            return;
        }
        others.forEach(function (visitor) {
            const node = document.createElement("div");
            node.className = "games-online-item";
            const avatar = visitor.avatar_url
                ? '<img src="' + escapeHtml(visitor.avatar_url) + '" alt="">'
                : '<div class="games-online-avatar-fallback">' + escapeHtml((visitor.display_name || "I").slice(0, 1).toUpperCase()) + "</div>";
            node.innerHTML = [
                '<div class="games-online-avatar">' + avatar + "</div>",
                "<div>",
                '  <div class="games-online-name">' + renderRankedName(visitor) + "</div>",
                '  <div class="games-online-meta">' + escapeHtml(visitor.current_game || "idle") + " / " + escapeHtml(visitor.play_status || "空闲中") + (visitor.room_code ? (" / 房间 " + escapeHtml(visitor.room_code)) : "") + "</div>",
                "</div>"
            ].join("");
            els.onlineList.appendChild(node);
        });
    }

    function formatHistoryMeta(entry) {
        const parts = [new Date(entry.created_at).toLocaleString("zh-CN")];
        if (entry.meta && entry.meta.mode_key) {
            parts.push(entry.meta.mode_key);
        }
        if (entry.meta && typeof entry.meta.elapsed_seconds === "number") {
            parts.push("用时 " + formatSeconds(entry.meta.elapsed_seconds));
        }
        if (entry.meta && entry.meta.auto_solved) {
            parts.push("自动解题");
        }
        if (entry.meta && entry.meta.max_tile) {
            parts.push("最大块 " + entry.meta.max_tile);
        }
        return parts.join(" / ");
    }

    function renderHistory() {
        if (!els.historyList) {
            return;
        }
        els.historyList.innerHTML = "";
        if (!state.history.length) {
            els.historyList.appendChild(emptyNode("还没有成绩记录。"));
            return;
        }
        state.history.forEach(function (entry) {
            const node = document.createElement("div");
            node.className = "games-history-item";
            node.innerHTML = [
                "<div>",
                '  <div class="games-ranking-main">' + escapeHtml(entry.game_id.toUpperCase()) + " / " + escapeHtml(entry.mode || "default") + "</div>",
                '  <div class="games-history-meta">' + escapeHtml(formatHistoryMeta(entry)) + "</div>",
                "</div>",
                '<div class="games-history-score">' + escapeHtml(entry.score) + "</div>"
            ].join("");
            els.historyList.appendChild(node);
        });
    }

    function renderLeaderboards() {
        if (!els.weeklyTotalList || !els.weeklyGameList || !els.weekKey || !els.weeklyGameTitle) {
            return;
        }
        els.weeklyTotalList.innerHTML = "";
        els.weeklyGameList.innerHTML = "";
        if (!state.leaderboards) {
            els.weeklyTotalList.appendChild(emptyNode("榜单尚未加载。"));
            els.weeklyGameList.appendChild(emptyNode("榜单尚未加载。"));
            return;
        }

        els.weekKey.textContent = "统计周期: " + (state.leaderboards.week_key || "");
        const weeklyTotal = state.leaderboards.weekly_total || [];
        if (!weeklyTotal.length) {
            els.weeklyTotalList.appendChild(emptyNode("本周还没有总分记录。"));
        } else {
            weeklyTotal.forEach(function (entry, index) {
                const node = document.createElement("div");
                node.className = "games-ranking-item";
                node.innerHTML = [
                    "<div>",
                    '  <div class="games-ranking-main">#' + (index + 1) + " " + renderRankedName(entry) + "</div>",
                    '  <div class="games-ranking-meta">本周局数 ' + escapeHtml(entry.play_count) + " · 本周积分 " + escapeHtml(entry.total_score) + "</div>",
                    "</div>",
                    '<div class="games-ranking-score">' + escapeHtml(entry.total_score) + "</div>"
                ].join("");
                els.weeklyTotalList.appendChild(node);
            });
        }

        const activeGameId = state.activeGameId || "";
        els.weeklyGameTitle.textContent = activeGameId ? (activeGameId.toUpperCase() + " 周榜") : "当前游戏周榜";
        const byGame = (state.leaderboards.weekly_by_game || {})[activeGameId] || [];
        if (!byGame.length) {
            els.weeklyGameList.appendChild(emptyNode("当前游戏本周还没有成绩。"));
        } else {
            byGame.forEach(function (entry, index) {
                const node = document.createElement("div");
                node.className = "games-ranking-item";
                node.innerHTML = [
                    "<div>",
                    '  <div class="games-ranking-main">#' + (index + 1) + " " + renderRankedName(entry) + "</div>",
                    '  <div class="games-ranking-meta">本周局数 ' + escapeHtml(entry.play_count) + " · 累计积分 " + escapeHtml(entry.lifetime_score) + "</div>",
                    "</div>",
                    '<div class="games-ranking-score">' + escapeHtml(entry.best_score) + "</div>"
                ].join("");
                els.weeklyGameList.appendChild(node);
            });
        }
    }

    function renderStatCards(stats) {
        return (Array.isArray(stats) ? stats : []).map(function (item) {
            return '<div class="game-stat-card"><div class="game-stat-label">' + escapeHtml(item.label) + '</div><div class="game-stat-value">' + escapeHtml(item.value) + "</div></div>";
        }).join("");
    }

    function ensureStageStatsContainer() {
        if (els.stageStats && document.body.contains(els.stageStats)) {
            return els.stageStats;
        }
        if (!els.stageToolbar) {
            return null;
        }
        if (els.stageToolbar.firstElementChild) {
            els.stageToolbar.firstElementChild.classList.add("games-stage-overview");
        }
        let container = els.stageToolbar.querySelector("#gamesStageStats");
        if (!container) {
            container = document.createElement("div");
            container.id = "gamesStageStats";
            container.className = "games-stage-stats";
            els.stageToolbar.appendChild(container);
        }
        els.stageStats = container;
        return container;
    }

    function clearStageStats() {
        const container = ensureStageStatsContainer();
        if (!container) {
            return;
        }
        container.innerHTML = "";
        container.hidden = true;
    }

    function setStageStats(stats) {
        const container = ensureStageStatsContainer();
        if (!container) {
            return;
        }
        const safeStats = Array.isArray(stats) ? stats.filter(function (item) {
            return item && item.label != null && item.value != null;
        }) : [];
        container.innerHTML = renderStatCards(safeStats);
        container.hidden = !safeStats.length;
    }

    function clearStage() {
        if (typeof state.activeCleanup === "function") {
            state.activeCleanup();
        }
        state.activeCleanup = null;
        if (els.stageBody) {
            els.stageBody.innerHTML = "";
        }
        if (els.stageActions) {
            els.stageActions.innerHTML = "";
        }
        clearStageStats();
    }

    function addStageButton(label, onClick, primary) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = primary ? "games-btn games-btn--primary" : "games-btn";
        button.textContent = label;
        button.addEventListener("click", onClick);
        els.stageActions.appendChild(button);
        return button;
    }

    function addStageTagButton(label, onClick) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "game-tag-btn";
        button.textContent = label;
        button.addEventListener("click", onClick);
        els.stageActions.appendChild(button);
        return button;
    }

    function addGlobalStageButtons() {
        addStageButton("沉浸模式", toggleFullscreen, false);
        const bossButton = addStageButton("老板键 " + formatBossKeyLabel(getBossKeyValue(state.profile)), triggerBossKey, false);
        bossButton.setAttribute("data-boss-key-trigger", "1");
    }

    function renderEmptyStage(message) {
        const node = document.createElement("div");
        node.className = "games-empty";
        node.textContent = message;
        els.stageBody.appendChild(node);
    }

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(function () {
                setStatus("浏览器拒绝进入全屏。", true);
            });
            return;
        }
        document.exitFullscreen().catch(function () {
            setStatus("浏览器拒绝退出全屏。", true);
        });
    }

    function triggerBossKey() {
        const path = state.profile && state.profile.boss_path ? String(state.profile.boss_path).trim() : "";
        let url = String(config.safeFileUrl || "/file_browser");
        if (path) {
            url += "?path=" + encodeURIComponent(path);
        }
        window.location.href = url;
    }

    async function loadProfile() {
        const profile = await requestJson(config.profileUrl, { method: "GET" });
        if (window.sessionStorage) {
            sessionStorage.removeItem("games-legacy-device-id");
        }
        renderProfile(profile);
    }

    async function loadManifest() {
        state.manifest = await requestJson(config.manifestUrl, { method: "GET" });
        renderManifestList();
        renderGameNav();
    }

    async function loadHistory() {
        state.history = await requestJson(config.historyUrl + "?limit=20", { method: "GET" });
        renderHistory();
    }

    async function loadLeaderboards() {
        state.leaderboards = await requestJson(config.leaderboardsUrl + "?limit=10", { method: "GET" });
        renderLeaderboards();
    }

    async function loadOnlineVisitors() {
        state.onlineVisitors = await requestJson(config.onlineUrl, { method: "GET" });
        renderOnlineVisitors();
    }

    async function refreshScorePanels() {
        await Promise.all([loadHistory(), loadLeaderboards()]);
    }

    async function saveProfile() {
        setStatus("正在保存资料...", false);
        const profile = await requestJson(config.profileUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                nickname: els.nicknameInput ? els.nicknameInput.value.trim() : "",
                boss_path: els.bossPathInput ? els.bossPathInput.value.trim() : "",
                boss_key: els.bossKeySelect ? els.bossKeySelect.value : "F9"
            })
        });
        renderProfile(profile);
        closeProfileModal();
        setStatus("资料已保存，老板键已切换为 " + formatBossKeyLabel(getBossKeyValue(profile)) + "。", false);
    }

    async function uploadAvatar() {
        const file = els.avatarInput && els.avatarInput.files ? els.avatarInput.files[0] : null;
        if (!file) {
            setStatus("请先选择一个头像文件。", true);
            return;
        }
        const formData = new FormData();
        formData.append("avatar", file);
        setStatus("正在上传头像...", false);
        const profile = await requestJson(config.avatarUploadUrl, { method: "POST", body: formData });
        renderProfile(profile);
        if (els.avatarInput) {
            els.avatarInput.value = "";
        }
        setStatus("头像已更新。", false);
    }

    function scheduleGameStateSave(gameId, gameState, summary) {
        if (state.saveTimers[gameId]) {
            window.clearTimeout(state.saveTimers[gameId]);
        }
        state.saveTimers[gameId] = window.setTimeout(function () {
            requestJson(getStateUrl(gameId), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ state: gameState || {}, summary: summary || {} })
            }).catch(function (error) {
                setStatus(error.message || "进度保存失败", true);
            });
        }, 280);
    }

    async function loadGameState(gameId) {
        return requestJson(getStateUrl(gameId), { method: "GET" });
    }

    async function submitScore(gameId, score, mode, sessionKey, meta) {
        await requestJson(config.scoreUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                game_id: gameId,
                score: score,
                mode: mode,
                session_key: sessionKey,
                meta: meta || {}
            })
        });
        await refreshScorePanels();
    }

    function syncPresence(playStatus, roomCode) {
        state.currentPresence = {
            current_game: state.activeGameId || "",
            play_status: playStatus || "空闲中",
            room_code: roomCode || ""
        };
        if (els.statusChip) {
            els.statusChip.textContent = state.currentPresence.play_status;
        }
    }

    async function postPresence() {
        try {
            await requestJson(config.onlineUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(state.currentPresence)
            });
            await loadOnlineVisitors();
        } catch (error) {
            void error;
        }
    }

    function startPresenceLoop() {
        if (state.presenceTimer) {
            window.clearInterval(state.presenceTimer);
        }
        postPresence();
        state.presenceTimer = window.setInterval(postPresence, 15000);
    }

    async function launchGame(gameId) {
        const launchToken = ++state.launchToken;
        const loadingStartedAt = Date.now();
        state.activeGameId = gameId;
        updateActiveNav();
        renderLeaderboards();
        const game = (state.manifest.games || []).find(function (item) {
            return item.id === gameId;
        });
        if (els.stageTitle) {
            els.stageTitle.textContent = game ? (game.title || game.id) : gameId;
        }
        if (els.stageMeta) {
            els.stageMeta.textContent = game ? (game.summary || "") : "";
        }
        clearStage();
        addGlobalStageButtons();
        renderStageLoadingState(game, "正在读取本地存档、恢复上次进度，并挂载游戏界面。");
        syncPresence(gameId === "drawphone" ? "等待房间" : "游玩中", state.drawphoneRoomCode);
        postPresence();

        async function mountIfCurrent(factory) {
            if (launchToken !== state.launchToken) {
                return;
            }
            const minLoadingMs = 220;
            const waitMs = Math.max(0, minLoadingMs - (Date.now() - loadingStartedAt));
            if (waitMs > 0) {
                await new Promise(function (resolve) {
                    window.setTimeout(resolve, waitMs);
                });
            }
            if (launchToken !== state.launchToken) {
                return;
            }
            if (els.stageBody) {
                els.stageBody.innerHTML = "";
            }
            state.activeCleanup = factory();
        }

        if (gameId === "2048") {
            const payload2048 = await loadGameState("2048").catch(function () { return { state: {} }; });
            await mountIfCurrent(function () { return mount2048(payload2048); });
            return;
        }
        if (gameId === "sudoku") {
            const payloadSudoku = await loadGameState("sudoku").catch(function () { return { state: {} }; });
            await mountIfCurrent(function () { return mountSudoku(payloadSudoku); });
            return;
        }
        if (gameId === "drawphone") {
            await mountIfCurrent(function () { return mountDrawphone(); });
            return;
        }
        if (gameId === "frontline") {
            const payloadFrontline = await loadGameState("frontline").catch(function () { return { state: {} }; });
            await mountIfCurrent(function () { return mountFrontline(payloadFrontline); });
            return;
        }
        if (gameId === "topdown-shooter") {
            const topdownPayloads = await Promise.all([
                loadGameState("topdown-shooter").catch(function () { return { state: {} }; }),
                loadGameState("topdown-shooter-meta").catch(function () { return { state: {} }; })
            ]);
            await mountIfCurrent(function () {
                return mountTopdownShooter({
                    state: topdownPayloads[0].state || {},
                    metaState: topdownPayloads[1].state || {}
                });
            });
            return;
        }
        if (gameId === "space-rocks") {
            const payloadSpaceRocks = await loadGameState("space-rocks").catch(function () { return { state: {} }; });
            await mountIfCurrent(function () { return mountSpaceRocks(payloadSpaceRocks); });
            return;
        }
        if (launchToken === state.launchToken) {
            renderEmptyStage("当前入口暂时还没有接入内容。");
        }
    }

    function create2048Session() {
        const session = {
            sessionKey: "g2048-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            nextTileId: 1,
            tiles: [],
            score: 0,
            moves: 0,
            maxTile: 0,
            status: "playing",
            startedAt: Date.now(),
            elapsedSeconds: 0,
            submittedScore: false
        };
        spawn2048Tile(session);
        spawn2048Tile(session);
        return session;
    }

    function normalize2048Session(raw) {
        if (!raw || !Array.isArray(raw.tiles) || !raw.tiles.length) {
            return create2048Session();
        }
        return {
            sessionKey: String(raw.sessionKey || ("g2048-" + Date.now())),
            nextTileId: Number(raw.nextTileId || 1),
            tiles: raw.tiles.map(function (tile) {
                return { id: Number(tile.id), row: Number(tile.row), col: Number(tile.col), value: Number(tile.value) };
            }),
            score: Number(raw.score || 0),
            moves: Number(raw.moves || 0),
            maxTile: Number(raw.maxTile || 0),
            status: raw.status === "over" ? "over" : "playing",
            startedAt: Number(raw.startedAt || Date.now()),
            elapsedSeconds: Number(raw.elapsedSeconds || 0),
            submittedScore: Boolean(raw.submittedScore)
        };
    }

    function sync2048Clock(session) {
        if (session.status !== "over") {
            session.elapsedSeconds = Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
        }
    }

    function serialize2048Session(session) {
        sync2048Clock(session);
        return {
            sessionKey: session.sessionKey,
            nextTileId: session.nextTileId,
            tiles: session.tiles.map(function (tile) { return { id: tile.id, row: tile.row, col: tile.col, value: tile.value }; }),
            score: session.score,
            moves: session.moves,
            maxTile: session.maxTile,
            status: session.status,
            startedAt: session.startedAt,
            elapsedSeconds: session.elapsedSeconds,
            submittedScore: session.submittedScore
        };
    }

    function summarize2048Session(session) {
        sync2048Clock(session);
        return {
            score: session.score,
            moves: session.moves,
            max_tile: session.maxTile,
            elapsed_seconds: session.elapsedSeconds,
            status: session.status
        };
    }

    function spawn2048Tile(session) {
        const occupied = {};
        session.tiles.forEach(function (tile) {
            occupied[tile.row + ":" + tile.col] = true;
        });
        const empty = [];
        for (let row = 0; row < 4; row += 1) {
            for (let col = 0; col < 4; col += 1) {
                if (!occupied[row + ":" + col]) {
                    empty.push({ row: row, col: col });
                }
            }
        }
        if (!empty.length) {
            return;
        }
        const spot = empty[Math.floor(Math.random() * empty.length)];
        session.tiles.push({
            id: session.nextTileId,
            row: spot.row,
            col: spot.col,
            value: Math.random() < 0.9 ? 2 : 4,
            newNow: true
        });
        session.nextTileId += 1;
    }

    function get2048Lines(direction) {
        const lines = [];
        for (let index = 0; index < 4; index += 1) {
            if (direction === "left") {
                lines.push([{ row: index, col: 0 }, { row: index, col: 1 }, { row: index, col: 2 }, { row: index, col: 3 }]);
            } else if (direction === "right") {
                lines.push([{ row: index, col: 3 }, { row: index, col: 2 }, { row: index, col: 1 }, { row: index, col: 0 }]);
            } else if (direction === "up") {
                lines.push([{ row: 0, col: index }, { row: 1, col: index }, { row: 2, col: index }, { row: 3, col: index }]);
            } else {
                lines.push([{ row: 3, col: index }, { row: 2, col: index }, { row: 1, col: index }, { row: 0, col: index }]);
            }
        }
        return lines;
    }

    function move2048Session(session, direction) {
        const matrix = [];
        for (let row = 0; row < 4; row += 1) {
            matrix[row] = [null, null, null, null];
        }
        session.tiles.forEach(function (tile) {
            matrix[tile.row][tile.col] = tile;
        });

        let moved = false;
        let scoreDelta = 0;
        const nextTiles = [];

        get2048Lines(direction).forEach(function (line) {
            const original = line.map(function (pos) { return matrix[pos.row][pos.col]; });
            const compact = original.filter(Boolean);
            const produced = [];
            for (let i = 0; i < compact.length; i += 1) {
                const current = compact[i];
                const next = compact[i + 1];
                if (next && next.value === current.value) {
                    produced.push({ id: current.id, row: 0, col: 0, value: current.value * 2, mergedNow: true });
                    scoreDelta += current.value * 2;
                    i += 1;
                } else {
                    produced.push({ id: current.id, row: 0, col: 0, value: current.value });
                }
            }
            produced.forEach(function (tile, targetIndex) {
                tile.row = line[targetIndex].row;
                tile.col = line[targetIndex].col;
                nextTiles.push(tile);
            });
            for (let i = 0; i < 4; i += 1) {
                const before = original[i];
                const after = produced[i] || null;
                if (!before && after) {
                    moved = true;
                } else if (before && !after) {
                    moved = true;
                } else if (before && after && (before.id !== after.id || before.value !== after.value || before.row !== after.row || before.col !== after.col)) {
                    moved = true;
                }
            }
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

    function mount2048(savedPayload) {
        let session = normalize2048Session(savedPayload.state || {});
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

        addStageButton("重新开始", function () {
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
        els.stageBody.appendChild(shell);

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

        addStageButton("帮助", function () {
            openGameInfoOverlay(boardHost, helpConfig2048);
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
            scheduleGameStateSave("2048", serialize2048Session(session), summarize2048Session(session));
        }

        function render() {
            sync2048Clock(session);
            scoreEl.textContent = String(session.score);
            maxEl.textContent = String(session.maxTile);
            movesEl.textContent = String(session.moves);
            timeEl.textContent = formatSeconds(session.elapsedSeconds);
            setStageStats([
                { label: "分数", value: String(session.score) },
                { label: "最大块", value: String(session.maxTile) },
                { label: "步数", value: String(session.moves) },
                { label: "用时", value: formatSeconds(session.elapsedSeconds) }
            ]);
            statusEl.textContent = session.status === "over" ? "本局结束，成绩已保存。" : "进度会自动保存。";
            syncPresence(session.status === "over" ? "2048 结算中" : "正在玩 2048", "");

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
            return submitScore("2048", session.score, "standard", session.sessionKey, {
                mode_key: "2048-standard",
                elapsed_seconds: session.elapsedSeconds,
                max_tile: session.maxTile,
                moves: session.moves,
                reason: reason
            }).catch(function (error) {
                session.submittedScore = false;
                setStatus(error.message || "2048 成绩提交失败", true);
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
            if (state.activeGameId !== "2048" || introActive) {
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
            if (state.activeGameId === "2048") {
                render();
            }
        }, 1000);

        createGameStartOverlay(boardHost, Object.assign({}, helpConfig2048, {
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

    function frontlineDifficultyConfig(key) {
        const table = {
            easy: { key: "easy", label: "简单", mainNodes: [5, 6], branchCount: [1, 2], specialCount: 1, neutralGuard: [8, 15], mainJitter: 20 },
            normal: { key: "normal", label: "普通", mainNodes: [6, 7], branchCount: [2, 3], specialCount: 2, neutralGuard: [10, 19], mainJitter: 28 },
            hard: { key: "hard", label: "困难", mainNodes: [7, 8], branchCount: [3, 4], specialCount: 3, neutralGuard: [13, 24], mainJitter: 34 }
        };
        return table[key] || table.normal;
    }

    function frontlineTowerTypeMeta(towerType) {
        const table = {
            core: { key: "core", label: "核心", shortLabel: "CORE", intervalMultiplier: 1, amountMultiplier: 1, capMultiplier: 1.05, defenseMultiplier: 1.05, priorityScore: 12 },
            normal: { key: "normal", label: "前哨", shortLabel: "OUT", intervalMultiplier: 1, amountMultiplier: 1, capMultiplier: 1, defenseMultiplier: 1, priorityScore: 0 },
            foundry: { key: "foundry", label: "工坊", shortLabel: "FND", intervalMultiplier: 0.8, amountMultiplier: 1, capMultiplier: 0.95, defenseMultiplier: 0.95, priorityScore: 34 },
            bastion: { key: "bastion", label: "堡垒", shortLabel: "BST", intervalMultiplier: 1.08, amountMultiplier: 1, capMultiplier: 1.28, defenseMultiplier: 1.35, priorityScore: 28 },
            surge: { key: "surge", label: "脉冲塔", shortLabel: "SRG", intervalMultiplier: 1.18, amountMultiplier: 1.55, capMultiplier: 1.08, defenseMultiplier: 1, priorityScore: 22 }
        };
        return table[towerType] || table.normal;
    }

    function frontlineTowerTypeDescription(towerType) {
        const meta = frontlineTowerTypeMeta(towerType);
        if (meta.key === "foundry") {
            return "工坊塔：批次更快，适合滚经济。";
        }
        if (meta.key === "bastion") {
            return "堡垒塔：容量更高，防守更硬。";
        }
        if (meta.key === "surge") {
            return "脉冲塔：批次更大，爆发更强。";
        }
        if (meta.key === "core") {
            return "核心塔：起始阵地，属性更稳。";
        }
        return "前哨塔：标准属性，适合均衡推进。";
    }

    function frontlineRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function frontlineShuffle(items) {
        const list = items.slice();
        for (let index = list.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            const tmp = list[index];
            list[index] = list[swapIndex];
            list[swapIndex] = tmp;
        }
        return list;
    }

    function frontlineNodeLabel(index) {
        const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        if (index < alphabet.length) {
            return alphabet.charAt(index);
        }
        return "N" + String(index + 1);
    }

    function frontlineEdgeTravelMs(nodeA, nodeB) {
        const dx = nodeA.x - nodeB.x;
        const dy = nodeA.y - nodeB.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        return Math.round(1350 + distance * 4.4 + frontlineRandomInt(-90, 110));
    }

    function createFrontlineMap(difficultyKey) {
        const config = frontlineDifficultyConfig(difficultyKey);
        const width = 920;
        const height = 560;
        const centerY = 290;
        const mainCount = frontlineRandomInt(config.mainNodes[0], config.mainNodes[1]);
        const stepX = (width - 160) / Math.max(1, mainCount - 1);
        const nodes = [];
        const edges = [];
        const mainNodes = [];
        let nextIndex = 0;

        for (let index = 0; index < mainCount; index += 1) {
            const label = frontlineNodeLabel(nextIndex);
            nextIndex += 1;
            const x = Math.round(80 + stepX * index + (index > 0 && index < mainCount - 1 ? frontlineRandomInt(-14, 14) : 0));
            const y = Math.round(centerY + (index > 0 && index < mainCount - 1 ? frontlineRandomInt(-config.mainJitter, config.mainJitter) : 0));
            const owner = index === 0 ? "player" : (index === mainCount - 1 ? "ai" : "neutral");
            const towerType = owner === "neutral" ? "normal" : "core";
            const node = {
                id: label,
                label: label,
                x: x,
                y: y,
                owner: owner,
                level: 1,
                towerType: towerType,
                unitCount: owner === "neutral" ? 0 : 20
            };
            nodes.push(node);
            mainNodes.push(node);
        }

        function addEdge(nodeA, nodeB) {
            const edgeId = nodeA.id + "-" + nodeB.id;
            edges.push({
                id: edgeId,
                a: nodeA.id,
                b: nodeB.id,
                travelMs: frontlineEdgeTravelMs(nodeA, nodeB)
            });
        }

        for (let index = 0; index < mainNodes.length - 1; index += 1) {
            addEdge(mainNodes[index], mainNodes[index + 1]);
        }

        const branchTargetCount = frontlineRandomInt(config.branchCount[0], config.branchCount[1]);
        const candidateSlots = [];
        for (let index = 1; index < mainNodes.length - 2; index += 1) {
            candidateSlots.push({ from: index, to: index + 2, side: (index % 2 === 0 ? "top" : "bottom") });
            if (index + 3 < mainNodes.length && config.key !== "easy") {
                candidateSlots.push({ from: index, to: index + 3, side: (index % 2 === 0 ? "bottom" : "top") });
            }
        }
        const pickedSlots = frontlineShuffle(candidateSlots).slice(0, branchTargetCount);
        let topDepth = 0;
        let bottomDepth = 0;
        pickedSlots.forEach(function (slot) {
            const fromNode = mainNodes[slot.from];
            const toNode = mainNodes[slot.to];
            const label = frontlineNodeLabel(nextIndex);
            nextIndex += 1;
            const depth = slot.side === "top" ? topDepth++ : bottomDepth++;
            const levelY = slot.side === "top"
                ? 126 - depth * 32 + frontlineRandomInt(-12, 12)
                : 454 + depth * 26 + frontlineRandomInt(-10, 10);
            const branchNode = {
                id: label,
                label: label,
                x: Math.round((fromNode.x + toNode.x) / 2 + frontlineRandomInt(-18, 18)),
                y: Math.round(levelY),
                owner: "neutral",
                level: 1,
                towerType: "normal",
                unitCount: 0
            };
            nodes.push(branchNode);
            addEdge(fromNode, branchNode);
            addEdge(branchNode, toNode);
        });

        const neutralNodes = nodes.filter(function (node) {
            return node.owner === "neutral";
        });
        const specialPool = frontlineShuffle(neutralNodes);
        const availableTypes = frontlineShuffle(["foundry", "bastion", "surge"]);
        for (let index = 0; index < Math.min(config.specialCount, specialPool.length); index += 1) {
            specialPool[index].towerType = availableTypes[index % availableTypes.length];
        }

        neutralNodes.forEach(function (node) {
            const progress = clamp((node.x - 80) / Math.max(1, width - 160), 0, 1);
            let guard = Math.round(config.neutralGuard[0] + (config.neutralGuard[1] - config.neutralGuard[0]) * progress) + frontlineRandomInt(-2, 2);
            if (node.towerType === "bastion") {
                guard += 4;
            } else if (node.towerType === "surge") {
                guard += 2;
            } else if (node.towerType === "foundry") {
                guard += 1;
            }
            node.unitCount = Math.max(6, guard);
        });

        return {
            key: "frontline-" + config.key + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
            width: width,
            height: height,
            difficulty: config.key,
            nodes: nodes,
            edges: edges
        };
    }

    function getFrontlineTowerSpec(level, towerType) {
        const baseTable = {
            1: { cap: 30, productionInterval: 3400, productionAmount: 4, upgradeCost: 15 },
            2: { cap: 45, productionInterval: 2800, productionAmount: 6, upgradeCost: 25 },
            3: { cap: 65, productionInterval: 2200, productionAmount: 8, upgradeCost: 0 }
        };
        const base = baseTable[level] || baseTable[1];
        const meta = frontlineTowerTypeMeta(towerType);
        return {
            cap: Math.max(20, Math.round(base.cap * meta.capMultiplier)),
            productionInterval: Math.max(1200, Math.round(base.productionInterval * meta.intervalMultiplier)),
            productionAmount: Math.max(1, Math.round(base.productionAmount * meta.amountMultiplier)),
            upgradeCost: level >= 3 ? 0 : Math.max(8, Math.round(base.upgradeCost)),
            defenseMultiplier: meta.defenseMultiplier,
            priorityScore: meta.priorityScore,
            label: meta.label,
            shortLabel: meta.shortLabel
        };
    }

    function createFrontlineSession(difficultyKey) {
        const difficulty = String(difficultyKey || "normal");
        const currentMap = createFrontlineMap(difficulty);
        return {
            sessionKey: "frontline-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            mapKey: currentMap.key,
            difficulty: difficulty,
            status: "playing",
            startedAt: Date.now(),
            elapsedSeconds: 0,
            nextSquadId: 1,
            selectedTowerId: currentMap.nodes.length ? currentMap.nodes[0].id : "",
            submittedScore: false,
            celebrationPlayed: false,
            map: currentMap,
            towers: currentMap.nodes.map(function (node) {
                return {
                    id: node.id,
                    owner: node.owner,
                    level: node.level,
                    unitCount: node.unitCount,
                    prodProgressMs: 0
                };
            }),
            squads: []
        };
    }

    function normalizeFrontlineSession(raw) {
        if (!raw || !Array.isArray(raw.towers) || !raw.towers.length) {
            return createFrontlineSession("normal");
        }
        const rawMap = raw.map && Array.isArray(raw.map.nodes) && Array.isArray(raw.map.edges) ? raw.map : createFrontlineMap(String(raw.difficulty || "normal"));
        const currentMap = {
            key: String(rawMap.key || ("frontline-" + Date.now())),
            width: Number(rawMap.width || 920),
            height: Number(rawMap.height || 560),
            difficulty: String(rawMap.difficulty || raw.difficulty || "normal"),
            nodes: rawMap.nodes.map(function (node, index) {
                return {
                    id: String(node.id || frontlineNodeLabel(index)),
                    label: String(node.label || node.id || frontlineNodeLabel(index)),
                    x: Number(node.x || 0),
                    y: Number(node.y || 0),
                    owner: node.owner === "player" || node.owner === "ai" ? node.owner : "neutral",
                    level: clamp(Number(node.level || 1), 1, 3),
                    towerType: String(node.towerType || "normal"),
                    unitCount: Math.max(0, Number(node.unitCount || 0))
                };
            }),
            edges: rawMap.edges.map(function (edge, index) {
                return {
                    id: String(edge.id || ("edge-" + index)),
                    a: String(edge.a || ""),
                    b: String(edge.b || ""),
                    travelMs: Math.max(800, Number(edge.travelMs || 1800))
                };
            })
        };
        const nodeIds = {};
        currentMap.nodes.forEach(function (node) {
            nodeIds[node.id] = true;
        });
        const towerById = {};
        raw.towers.forEach(function (tower) {
            if (tower && nodeIds[tower.id]) {
                towerById[tower.id] = tower;
            }
        });
        const edgeByNodePair = {};
        currentMap.edges.forEach(function (edge) {
            edgeByNodePair[edge.a + ":" + edge.b] = edge;
            edgeByNodePair[edge.b + ":" + edge.a] = edge;
        });
        return {
            sessionKey: String(raw.sessionKey || ("frontline-" + Date.now())),
            mapKey: currentMap.key,
            difficulty: String(raw.difficulty || currentMap.difficulty || "normal"),
            status: raw.status === "victory" || raw.status === "defeat" ? raw.status : "playing",
            startedAt: Number(raw.startedAt || Date.now()),
            elapsedSeconds: Number(raw.elapsedSeconds || 0),
            nextSquadId: Math.max(1, Number(raw.nextSquadId || 1)),
            selectedTowerId: nodeIds[raw.selectedTowerId] ? raw.selectedTowerId : (currentMap.nodes[0] ? currentMap.nodes[0].id : ""),
            submittedScore: Boolean(raw.submittedScore),
            celebrationPlayed: Boolean(raw.celebrationPlayed),
            map: currentMap,
            towers: currentMap.nodes.map(function (node) {
                const source = towerById[node.id] || {};
                return {
                    id: node.id,
                    owner: source.owner === "player" || source.owner === "ai" || source.owner === "neutral" ? source.owner : node.owner,
                    level: clamp(Number(source.level || node.level), 1, 3),
                    unitCount: Math.max(0, Number(source.unitCount != null ? source.unitCount : node.unitCount)),
                    prodProgressMs: Math.max(0, Number(source.prodProgressMs || 0))
                };
            }),
            squads: Array.isArray(raw.squads) ? raw.squads.map(function (squad) {
                const edge = edgeByNodePair[(squad && squad.fromId) + ":" + (squad && squad.toId)];
                if (!edge) {
                    return null;
                }
                return {
                    id: Math.max(1, Number(squad.id || 0)),
                    owner: squad.owner === "player" || squad.owner === "ai" ? squad.owner : "neutral",
                    fromId: edge.a === squad.fromId ? edge.a : squad.fromId,
                    toId: edge.a === squad.fromId ? edge.b : squad.toId,
                    count: Math.max(0, Number(squad.count || 0)),
                    progress: clamp(Number(squad.progress || 0), 0, 1),
                    travelMs: Math.max(800, Number(squad.travelMs || edge.travelMs))
                };
            }).filter(function (squad) {
                return squad && squad.count > 0 && squad.owner !== "neutral";
            }) : []
        };
    }

    function syncFrontlineClock(session) {
        if (session.status === "playing") {
            session.elapsedSeconds = Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
        }
    }

    function serializeFrontlineSession(session) {
        syncFrontlineClock(session);
        return {
            sessionKey: session.sessionKey,
            mapKey: session.mapKey,
            difficulty: session.difficulty,
            status: session.status,
            startedAt: session.startedAt,
            elapsedSeconds: session.elapsedSeconds,
            nextSquadId: session.nextSquadId,
            selectedTowerId: session.selectedTowerId,
            submittedScore: session.submittedScore,
            celebrationPlayed: session.celebrationPlayed,
            map: session.map,
            towers: session.towers.map(function (tower) {
                return {
                    id: tower.id,
                    owner: tower.owner,
                    level: tower.level,
                    unitCount: Math.round(tower.unitCount * 10) / 10,
                    prodProgressMs: Math.round(tower.prodProgressMs || 0)
                };
            }),
            squads: session.squads.map(function (squad) {
                return {
                    id: squad.id,
                    owner: squad.owner,
                    fromId: squad.fromId,
                    toId: squad.toId,
                    count: Math.round(squad.count),
                    progress: Math.round(clamp(squad.progress, 0, 1) * 1000) / 1000,
                    travelMs: Math.round(squad.travelMs)
                };
            })
        };
    }

    function summarizeFrontlineSession(session) {
        syncFrontlineClock(session);
        const towerCounts = { player: 0, ai: 0, neutral: 0 };
        const units = { player: 0, ai: 0 };
        session.towers.forEach(function (tower) {
            towerCounts[tower.owner] += 1;
            if (tower.owner === "player" || tower.owner === "ai") {
                units[tower.owner] += tower.unitCount;
            }
        });
        session.squads.forEach(function (squad) {
            if (squad.owner === "player" || squad.owner === "ai") {
                units[squad.owner] += squad.count;
            }
        });
        return {
            status: session.status,
            elapsed_seconds: session.elapsedSeconds,
            player_towers: towerCounts.player,
            ai_towers: towerCounts.ai,
            player_units: Math.round(units.player),
            ai_units: Math.round(units.ai)
        };
    }

    function computeFrontlineScore(session) {
        const summary = summarizeFrontlineSession(session);
        const difficultyMultiplier = session.difficulty === "hard" ? 1.75 : (session.difficulty === "easy" ? 1 : 1.35);
        const survivedUnits = Number(summary.player_units || 0);
        const playerTowers = Number(summary.player_towers || 0);
        const victoryBonus = session.status === "victory" ? Math.round(1200 * difficultyMultiplier) : 0;
        const mapControlBonus = Math.round(playerTowers * 140 * difficultyMultiplier);
        const unitBonus = Math.round(survivedUnits * 12 * difficultyMultiplier);
        const timeBonus = session.status === "victory" ? Math.max(0, 720 - session.elapsedSeconds) * Math.round(4 * difficultyMultiplier) : 0;
        return {
            victoryBonus: victoryBonus,
            mapControlBonus: mapControlBonus,
            unitBonus: unitBonus,
            timeBonus: timeBonus,
            total: Math.max(0, Math.round(victoryBonus + mapControlBonus + unitBonus + timeBonus))
        };
    }

    function mountFrontline(savedPayload) {
        const nodeById = {};
        const edgeById = {};
        const edgeByPair = {};
        const neighbors = {};
        let session = normalizeFrontlineSession(savedPayload.state || {});
        let currentMap = session.map;
        let timerId = null;
        let introActive = true;
        let introShownAt = Date.now();
        let lastFrameAt = Date.now();
        let aiAccumulatorMs = 0;
        let autosaveAccumulatorMs = 0;
        let dragState = null;
        const frontlineHelpConfig = {
            title: "攻占前线",
            subtitle: "随机地图单机版，包含难度分档、不同塔类型、拖拽派兵和基础 AI。",
            bullets: [
                "从塔的四宫格区域按下并拖到相邻塔，可以按 25/50/75/100% 派兵。",
                "不同难度会改变主路径长度、分支数量、中立守军和特殊塔数量。",
                "工坊塔偏经济，堡垒塔偏防守，脉冲塔偏爆发；胜利后会播放结算动画并展示加分。"
            ],
            hint: "点击“新地图”会按当前难度重新生成一张图；刷新页面仍可续玩当前随机图。"
        };

        function rebuildMapIndexes() {
            Object.keys(nodeById).forEach(function (key) { delete nodeById[key]; });
            Object.keys(edgeById).forEach(function (key) { delete edgeById[key]; });
            Object.keys(edgeByPair).forEach(function (key) { delete edgeByPair[key]; });
            Object.keys(neighbors).forEach(function (key) { delete neighbors[key]; });
            currentMap = session.map;
            currentMap.nodes.forEach(function (node) {
                nodeById[node.id] = node;
                neighbors[node.id] = [];
            });
            currentMap.edges.forEach(function (edge) {
                edgeById[edge.id] = edge;
                edgeByPair[edge.a + ":" + edge.b] = edge;
                edgeByPair[edge.b + ":" + edge.a] = edge;
                if (neighbors[edge.a]) {
                    neighbors[edge.a].push(edge.b);
                }
                if (neighbors[edge.b]) {
                    neighbors[edge.b].push(edge.a);
                }
            });
        }

        function restartFrontline(difficultyKey) {
            finalizeScoreIfNeeded("restart").finally(function () {
                session = createFrontlineSession(difficultyKey || session.difficulty);
                rebuildMapIndexes();
                introShownAt = Date.now();
                introActive = true;
                lastFrameAt = Date.now();
                clearVictoryVisuals();
                render();
                persist();
                showIntro();
            });
        }

        rebuildMapIndexes();

        addStageButton("重新开局", function () {
            restartFrontline(session.difficulty);
        }, true);
        addStageButton("新地图", function () {
            restartFrontline(session.difficulty);
        }, false);
        addStageButton("简单", function () {
            restartFrontline("easy");
        }, false);
        addStageButton("普通", function () {
            restartFrontline("normal");
        }, false);
        addStageButton("困难", function () {
            restartFrontline("hard");
        }, false);

        const shell = document.createElement("div");
        shell.className = "game-frontline-shell";
        shell.innerHTML = [
            '<div class="game-frontline-top">',
            '  <div>',
            '    <div class="games-section-title">地图情报</div>',
            '    <div class="games-stage-meta" id="frontlineMapMeta"></div>',
            "  </div>",
            '  <div class="game-stat-grid">',
            '    <div class="game-stat-card"><div class="game-stat-label">难度</div><div class="game-stat-value" id="frontlineDifficulty">普通</div></div>',
            '    <div class="game-stat-card"><div class="game-stat-label">玩家塔</div><div class="game-stat-value" id="frontlinePlayerTowers">0</div></div>',
            '    <div class="game-stat-card"><div class="game-stat-label">AI 塔</div><div class="game-stat-value" id="frontlineAiTowers">0</div></div>',
            '    <div class="game-stat-card"><div class="game-stat-label">行军队伍</div><div class="game-stat-value" id="frontlineSquads">0</div></div>',
            '    <div class="game-stat-card"><div class="game-stat-label">用时</div><div class="game-stat-value" id="frontlineTime">00:00</div></div>',
            "  </div>",
            "</div>",
            '<div class="games-stage-meta" id="frontlineStatusLine"></div>',
            '<div class="game-frontline-stage">',
            '  <div class="game-frontline-mapwrap game-start-host" id="frontlineMapWrap">',
            '    <svg class="game-frontline-svg" id="frontlineSvg" viewBox="0 0 ' + currentMap.width + " " + currentMap.height + '" preserveAspectRatio="xMidYMid meet"></svg>',
            '    <canvas class="game-frontline-victory-canvas" id="frontlineVictoryCanvas"></canvas>',
            '    <div class="game-frontline-victory-banner" id="frontlineVictoryBanner"></div>',
            "  </div>",
            '  <div class="game-frontline-sidecard">',
            '    <div class="game-frontline-panel">',
            '      <div class="games-section-title" id="frontlinePanelTitle">塔信息</div>',
            '      <div class="game-frontline-selection" id="frontlineSelectionCard"></div>',
            "    </div>",
            "  </div>",
            "</div>"
        ].join("");
        els.stageBody.appendChild(shell);

        const localStatGrid = shell.querySelector(".game-stat-grid");
        const mapWrapEl = shell.querySelector("#frontlineMapWrap");
        const svgEl = shell.querySelector("#frontlineSvg");
        const victoryCanvasEl = shell.querySelector("#frontlineVictoryCanvas");
        const victoryBannerEl = shell.querySelector("#frontlineVictoryBanner");
        const mapMetaEl = shell.querySelector("#frontlineMapMeta");
        const difficultyEl = shell.querySelector("#frontlineDifficulty");
        const playerTowersEl = shell.querySelector("#frontlinePlayerTowers");
        const aiTowersEl = shell.querySelector("#frontlineAiTowers");
        const squadsEl = shell.querySelector("#frontlineSquads");
        const timeEl = shell.querySelector("#frontlineTime");
        const statusEl = shell.querySelector("#frontlineStatusLine");
        const panelTitleEl = shell.querySelector("#frontlinePanelTitle");
        const selectionCardEl = shell.querySelector("#frontlineSelectionCard");
        let victoryAnimFrame = 0;
        let victoryAnimTimeout = 0;

        addStageButton("帮助", function () {
            openGameInfoOverlay(mapWrapEl, frontlineHelpConfig);
        }, false);

        if (localStatGrid) {
            localStatGrid.hidden = true;
        }

        function createSvgNode(tagName, attrs) {
            const node = document.createElementNS("http://www.w3.org/2000/svg", tagName);
            Object.keys(attrs || {}).forEach(function (key) {
                node.setAttribute(key, String(attrs[key]));
            });
            return node;
        }

        function syncVictoryCanvasSize() {
            if (!victoryCanvasEl || !mapWrapEl) {
                return;
            }
            const rect = mapWrapEl.getBoundingClientRect();
            const ratio = window.devicePixelRatio || 1;
            victoryCanvasEl.width = Math.max(1, Math.round(rect.width * ratio));
            victoryCanvasEl.height = Math.max(1, Math.round(rect.height * ratio));
            victoryCanvasEl.style.width = rect.width + "px";
            victoryCanvasEl.style.height = rect.height + "px";
        }

        function clearVictoryVisuals() {
            if (victoryAnimFrame) {
                window.cancelAnimationFrame(victoryAnimFrame);
                victoryAnimFrame = 0;
            }
            if (victoryAnimTimeout) {
                window.clearTimeout(victoryAnimTimeout);
                victoryAnimTimeout = 0;
            }
            if (mapWrapEl) {
                mapWrapEl.classList.remove("is-victory-active");
            }
            if (victoryBannerEl) {
                victoryBannerEl.classList.remove("is-visible");
                victoryBannerEl.textContent = "";
            }
            if (victoryCanvasEl) {
                const context = victoryCanvasEl.getContext("2d");
                if (context) {
                    context.clearRect(0, 0, victoryCanvasEl.width, victoryCanvasEl.height);
                }
            }
        }

        function playFrontlineVictoryCelebration(scoreData) {
            if (!victoryCanvasEl || !victoryBannerEl) {
                return;
            }
            syncVictoryCanvasSize();
            clearVictoryVisuals();
            mapWrapEl.classList.add("is-victory-active");
            const ratio = window.devicePixelRatio || 1;
            const context = victoryCanvasEl.getContext("2d");
            if (!context) {
                return;
            }
            const width = victoryCanvasEl.width;
            const height = victoryCanvasEl.height;
            const particles = [];
            const colors = ["#fde68a", "#f59e0b", "#bfdbfe", "#fca5a5", "#ffffff"];
            for (let index = 0; index < 52; index += 1) {
                particles.push({
                    x: Math.random() * width,
                    y: -Math.random() * height * 0.45,
                    vx: (Math.random() - 0.5) * 3.4 * ratio,
                    vy: (1.8 + Math.random() * 3.6) * ratio,
                    size: (4 + Math.random() * 8) * ratio,
                    angle: Math.random() * Math.PI * 2,
                    spin: (Math.random() - 0.5) * 0.22,
                    color: colors[index % colors.length]
                });
            }
            const startedAt = Date.now();
            function frame() {
                const elapsed = Date.now() - startedAt;
                context.clearRect(0, 0, width, height);
                particles.forEach(function (particle) {
                    particle.x += particle.vx;
                    particle.y += particle.vy;
                    particle.angle += particle.spin;
                    particle.vy += 0.06 * ratio;
                    context.save();
                    context.translate(particle.x, particle.y);
                    context.rotate(particle.angle);
                    context.fillStyle = particle.color;
                    context.fillRect(-particle.size / 2, -particle.size / 3, particle.size, particle.size * 0.66);
                    context.restore();
                });
                if (elapsed < 3200) {
                    victoryAnimFrame = window.requestAnimationFrame(frame);
                } else {
                    victoryAnimFrame = 0;
                }
            }
            victoryBannerEl.textContent = "胜利 +" + scoreData.total;
            victoryBannerEl.classList.add("is-visible");
            victoryAnimFrame = window.requestAnimationFrame(frame);
            victoryAnimTimeout = window.setTimeout(function () {
                if (victoryBannerEl) {
                    victoryBannerEl.classList.remove("is-visible");
                }
            }, 3600);
        }

        function clientPointToSvg(event) {
            const ctm = svgEl.getScreenCTM();
            if (!ctm) {
                return { x: 0, y: 0 };
            }
            const point = svgEl.createSVGPoint();
            point.x = event.clientX;
            point.y = event.clientY;
            const result = point.matrixTransform(ctm.inverse());
            return { x: result.x, y: result.y };
        }

        function frontlineTowerHalfSize() {
            return 38;
        }

        function frontlineTowerHitRadius() {
            return 54;
        }

        function frontlineRatioLabel(ratio) {
            const table = {
                1: "100%",
                0.75: "75%",
                0.5: "50%",
                0.25: "25%"
            };
            return table[ratio] || (Math.round(ratio * 100) + "%");
        }

        function frontlineRatioFromCell(offsetX, offsetY) {
            const right = offsetX >= 0;
            const bottom = offsetY >= 0;
            if (!right && !bottom) {
                return 0.25;
            }
            if (right && !bottom) {
                return 0.5;
            }
            if (!right && bottom) {
                return 0.75;
            }
            return 1;
        }

        function pickTowerAtPoint(point) {
            let best = null;
            session.towers.forEach(function (tower) {
                const node = nodeById[tower.id];
                if (!node) {
                    return;
                }
                const dx = point.x - node.x;
                const dy = point.y - node.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= frontlineTowerHitRadius() && (!best || distance < best.distance)) {
                    best = { tower: tower, distance: distance };
                }
            });
            return best ? best.tower : null;
        }

        function getTower(towerId) {
            return session.towers.find(function (tower) {
                return tower.id === towerId;
            }) || null;
        }

        function getEdge(fromId, toId) {
            return edgeByPair[fromId + ":" + toId] || null;
        }

        function isAdjacent(fromId, toId) {
            return Boolean(getEdge(fromId, toId));
        }

        function persist() {
            scheduleGameStateSave("frontline", serializeFrontlineSession(session), summarizeFrontlineSession(session));
        }

        function countOwnedTowers(owner) {
            return session.towers.filter(function (tower) {
                return tower.owner === owner;
            }).length;
        }

        function countActiveSquads(owner) {
            return session.squads.filter(function (squad) {
                return squad.owner === owner;
            }).length;
        }

        function getTowerNode(towerId) {
            return nodeById[towerId] || null;
        }

        function getTowerSpecForTower(tower) {
            const node = tower ? getTowerNode(tower.id) : null;
            return getFrontlineTowerSpec(tower ? tower.level : 1, node ? node.towerType : "normal");
        }

        function canUpgradeTower(tower) {
            if (!tower || tower.owner !== "player" || tower.level >= 3) {
                return false;
            }
            const spec = getTowerSpecForTower(tower);
            return tower.unitCount >= spec.upgradeCost;
        }

        function upgradeTower(towerId, silent) {
            const tower = getTower(towerId);
            if (!tower || tower.owner !== "player") {
                return false;
            }
            if (tower.level >= 3) {
                if (!silent) {
                    setStatus("该塔已经满级。", true);
                }
                return false;
            }
            const spec = getTowerSpecForTower(tower);
            if (tower.unitCount < spec.upgradeCost) {
                if (!silent) {
                    setStatus("驻军不足，无法升级。", true);
                }
                return false;
            }
            tower.unitCount -= spec.upgradeCost;
            tower.level += 1;
            tower.prodProgressMs = 0;
            if (!silent) {
                setStatus("塔 " + tower.id + " 已升级到 Lv." + tower.level + "。", false);
            }
            render();
            persist();
            return true;
        }

        function beginDrag(towerId, event) {
            const tower = getTower(towerId);
            const node = nodeById[towerId];
            if (!tower || !node || tower.owner !== "player" || session.status !== "playing" || introActive) {
                return;
            }
            const previousSelectedId = session.selectedTowerId;
            const point = clientPointToSvg(event);
            const ratio = frontlineRatioFromCell(point.x - node.x, point.y - node.y);
            session.selectedTowerId = towerId;
            dragState = {
                sourceId: towerId,
                ratio: ratio,
                previousSelectedId: previousSelectedId,
                startPoint: point,
                currentPoint: point,
                hoveredTargetId: "",
                moved: false
            };
            render();
        }

        function updateDrag(event) {
            if (!dragState) {
                return;
            }
            const point = clientPointToSvg(event);
            dragState.currentPoint = point;
            const sourceNode = nodeById[dragState.sourceId];
            const dx = point.x - dragState.startPoint.x;
            const dy = point.y - dragState.startPoint.y;
            dragState.moved = dragState.moved || Math.sqrt(dx * dx + dy * dy) > 10;
            const hovered = pickTowerAtPoint(point);
            dragState.hoveredTargetId = hovered && hovered.id !== dragState.sourceId && isAdjacent(dragState.sourceId, hovered.id) ? hovered.id : "";
            if (sourceNode) {
                dragState.ratio = frontlineRatioFromCell(dragState.startPoint.x - sourceNode.x, dragState.startPoint.y - sourceNode.y);
            }
            render();
        }

        function endDrag() {
            if (!dragState) {
                return;
            }
            const sourceId = dragState.sourceId;
            const targetId = dragState.hoveredTargetId;
            const moved = dragState.moved;
            const ratio = dragState.ratio;
            const previousSelectedId = dragState.previousSelectedId;
            dragState = null;
            if (targetId) {
                if (dispatchSquad(sourceId, targetId, ratio, "player")) {
                    setStatus("已从 " + sourceId + " 向 " + targetId + " 派出 " + frontlineRatioLabel(ratio) + " 兵力。", false);
                    render();
                    persist();
                    return;
                }
            }
            if (!moved) {
                session.selectedTowerId = previousSelectedId === sourceId ? "" : sourceId;
            }
            render();
        }

        function dispatchSquad(fromId, toId, ratio, owner) {
            const source = getTower(fromId);
            const target = getTower(toId);
            const edge = getEdge(fromId, toId);
            if (!source || !target || !edge) {
                return false;
            }
            if (source.owner !== owner) {
                return false;
            }
            const available = Math.max(0, Math.floor(source.unitCount) - 1);
            if (available <= 0) {
                return false;
            }
            const sendCount = getFrontlineDispatchCount(source, ratio);
            if (sendCount <= 0) {
                return false;
            }
            source.unitCount = Math.max(0, source.unitCount - sendCount);
            session.squads.push({
                id: session.nextSquadId,
                owner: owner,
                fromId: fromId,
                toId: toId,
                count: sendCount,
                progress: 0,
                travelMs: edge.travelMs
            });
            session.nextSquadId += 1;
            return true;
        }

        function getFrontlineDispatchCount(source, ratio) {
            if (!source) {
                return 0;
            }
            const available = Math.max(0, Math.floor(source.unitCount) - 1);
            if (available <= 0) {
                return 0;
            }
            let sendCount = ratio >= 1 ? available : Math.floor(source.unitCount * ratio);
            sendCount = clamp(sendCount, 0, available);
            return sendCount;
        }

        function handleArrival(squad) {
            const tower = getTower(squad.toId);
            if (!tower) {
                return;
            }
            if (tower.owner === squad.owner) {
                tower.unitCount += squad.count;
                return;
            }
            const spec = getTowerSpecForTower(tower);
            const effectiveGuard = tower.unitCount * (spec.defenseMultiplier || 1);
            if (squad.count > effectiveGuard) {
                const remainder = squad.count - effectiveGuard;
                const previousOwner = tower.owner;
                tower.owner = squad.owner;
                tower.unitCount = remainder;
                tower.prodProgressMs = 0;
                if (previousOwner === "player" || previousOwner === "ai") {
                    tower.level = Math.max(1, tower.level - 1);
                }
                return;
            }
            tower.unitCount -= squad.count / Math.max(1, spec.defenseMultiplier || 1);
            if (tower.unitCount < 0.01) {
                tower.unitCount = 0;
            }
        }

        function resolveSquadEncounters() {
            const removed = {};
            for (let index = 0; index < session.squads.length; index += 1) {
                const squad = session.squads[index];
                if (!squad || removed[squad.id]) {
                    continue;
                }
                for (let otherIndex = index + 1; otherIndex < session.squads.length; otherIndex += 1) {
                    const other = session.squads[otherIndex];
                    if (!other || removed[other.id] || squad.owner === other.owner) {
                        continue;
                    }
                    if (squad.fromId === other.toId && squad.toId === other.fromId && squad.progress >= (1 - other.progress)) {
                        const loss = Math.min(squad.count, other.count);
                        squad.count -= loss;
                        other.count -= loss;
                        if (squad.count <= 0) {
                            removed[squad.id] = true;
                        }
                        if (other.count <= 0) {
                            removed[other.id] = true;
                        }
                    }
                }
            }
            if (Object.keys(removed).length) {
                session.squads = session.squads.filter(function (squad) {
                    return !removed[squad.id] && squad.count > 0;
                });
            }
        }

        function updateVictoryState() {
            const playerTowerCount = countOwnedTowers("player");
            const aiTowerCount = countOwnedTowers("ai");
            const playerSquads = countActiveSquads("player");
            const aiSquads = countActiveSquads("ai");
            if (session.status !== "playing") {
                return;
            }
            if (aiTowerCount === 0 && aiSquads === 0) {
                session.status = "victory";
                finalizeScoreIfNeeded("victory");
                setStatus("攻占前线：玩家胜利。", false);
            } else if (playerTowerCount === 0 && playerSquads === 0) {
                session.status = "defeat";
                clearVictoryVisuals();
                finalizeScoreIfNeeded("defeat");
                setStatus("攻占前线：本局失败。", true);
            }
        }

        function runAiTurn() {
            if (session.status !== "playing") {
                return;
            }
            const aiTowers = session.towers.filter(function (tower) {
                return tower.owner === "ai";
            }).sort(function (left, right) {
                return right.unitCount - left.unitCount;
            });
            let acted = false;

            aiTowers.forEach(function (tower) {
                if (acted) {
                    return;
                }
                const towerNode = getTowerNode(tower.id);
                const spec = getTowerSpecForTower(tower);
                const outgoingThreshold = Math.max(10, Math.floor(spec.cap * 0.66));
                if (tower.unitCount < outgoingThreshold) {
                    return;
                }

                const candidates = neighbors[tower.id].map(function (targetId) {
                    const target = getTower(targetId);
                    if (!target || target.owner === "ai") {
                        return null;
                    }
                    const targetSpec = getTowerSpecForTower(target);
                    const advantage = tower.unitCount - target.unitCount;
                    let score = advantage * 8;
                    if (target.owner === "player") {
                        score += 60;
                    } else {
                        score += 30;
                    }
                    score += Number(targetSpec.priorityScore || 0);
                    if (towerNode && towerNode.towerType === "foundry") {
                        score += 8;
                    }
                    return { targetId: targetId, score: score };
                }).filter(Boolean).sort(function (left, right) {
                    return right.score - left.score;
                });

                if (candidates.length && candidates[0].score > 20) {
                    acted = dispatchSquad(tower.id, candidates[0].targetId, tower.unitCount > spec.cap * 0.88 ? 1 : 0.5, "ai");
                    return;
                }

                const aiNeighbors = neighbors[tower.id].map(function (targetId) {
                    return getTower(targetId);
                }).filter(function (target) {
                    return target && target.owner === "ai";
                }).sort(function (left, right) {
                    return left.unitCount - right.unitCount;
                });
                if (aiNeighbors.length && tower.unitCount - aiNeighbors[0].unitCount >= 14) {
                    acted = dispatchSquad(tower.id, aiNeighbors[0].id, 0.5, "ai");
                    return;
                }
                if (tower.level < 3 && tower.unitCount >= spec.upgradeCost + 14) {
                    tower.unitCount -= spec.upgradeCost;
                    tower.level += 1;
                    tower.prodProgressMs = 0;
                    acted = true;
                }
            });
        }

        function advanceSimulation(deltaMs) {
            if (session.status !== "playing") {
                return;
            }
            syncFrontlineClock(session);
            session.towers.forEach(function (tower) {
                const spec = getTowerSpecForTower(tower);
                if (tower.owner === "neutral") {
                    tower.prodProgressMs = 0;
                    return;
                }
                if (tower.unitCount >= spec.cap) {
                    tower.unitCount = Math.min(tower.unitCount, spec.cap);
                    tower.prodProgressMs = 0;
                    return;
                }
                tower.prodProgressMs += deltaMs;
                while (tower.prodProgressMs >= spec.productionInterval && tower.unitCount < spec.cap) {
                    tower.prodProgressMs -= spec.productionInterval;
                    tower.unitCount = Math.min(spec.cap, tower.unitCount + spec.productionAmount);
                }
            });

            session.squads.forEach(function (squad) {
                squad.progress += deltaMs / Math.max(800, squad.travelMs);
            });
            resolveSquadEncounters();

            const arrivals = [];
            session.squads = session.squads.filter(function (squad) {
                if (squad.count <= 0) {
                    return false;
                }
                if (squad.progress >= 1) {
                    arrivals.push(squad);
                    return false;
                }
                return true;
            });
            arrivals.forEach(handleArrival);

            aiAccumulatorMs += deltaMs;
            if (aiAccumulatorMs >= 1100) {
                aiAccumulatorMs = 0;
                runAiTurn();
            }
            updateVictoryState();
        }

        function finalizeScoreIfNeeded(reason) {
            syncFrontlineClock(session);
            const scoreData = computeFrontlineScore(session);
            if (session.submittedScore || scoreData.total <= 0 || session.status === "playing") {
                return Promise.resolve();
            }
            if (session.status === "victory" && !session.celebrationPlayed) {
                session.celebrationPlayed = true;
                playFrontlineVictoryCelebration(scoreData);
            }
            session.submittedScore = true;
            return submitScore("frontline", scoreData.total, session.difficulty, session.sessionKey, {
                mode_key: session.mapKey,
                status: session.status,
                elapsed_seconds: session.elapsedSeconds,
                player_towers: countOwnedTowers("player"),
                ai_towers: countOwnedTowers("ai"),
                squads_remaining: countActiveSquads("player"),
                reason: reason
            }).catch(function (error) {
                session.submittedScore = false;
                setStatus(error.message || "攻占前线成绩提交失败", true);
            });
        }

        function renderLines(linesGroup, selectedTowerId) {
            currentMap.edges.forEach(function (edge) {
                const nodeA = nodeById[edge.a];
                const nodeB = nodeById[edge.b];
                const active = selectedTowerId && (edge.a === selectedTowerId || edge.b === selectedTowerId);
                const line = createSvgNode("line", {
                    x1: nodeA.x,
                    y1: nodeA.y,
                    x2: nodeB.x,
                    y2: nodeB.y,
                    "class": active ? "game-frontline-edge is-active" : "game-frontline-edge"
                });
                linesGroup.appendChild(line);
            });
        }

        function renderSelectionCard(selectedTower) {
            if (!selectedTower) {
                if (panelTitleEl) {
                    panelTitleEl.textContent = "塔信息";
                }
                selectionCardEl.innerHTML = "";
                selectionCardEl.classList.add("is-empty");
                return;
            }
            selectionCardEl.classList.remove("is-empty");
            const node = getTowerNode(selectedTower.id);
            const towerType = node ? node.towerType : "normal";
            const spec = getTowerSpecForTower(selectedTower);
            const canUpgrade = canUpgradeTower(selectedTower);
            if (panelTitleEl) {
                panelTitleEl.textContent = "塔 " + selectedTower.id + " · " + frontlineTowerTypeMeta(towerType).label;
            }
            const ownerLabel = selectedTower.owner === "player" ? "玩家控制" : (selectedTower.owner === "ai" ? "AI 控制" : "中立塔");
            const neighborLabel = escapeHtml((neighbors[selectedTower.id] || []).join("、") || "无");
            const upgradeMarkup = selectedTower.owner === "player"
                ? (
                    selectedTower.level >= 3
                        ? '<div class="game-frontline-note">已满级，无可用升级项。</div>'
                        : [
                            '<div class="game-frontline-upgrade-card">',
                            '  <div class="game-frontline-note"><strong>升级到 Lv.' + escapeHtml(selectedTower.level + 1) + '</strong></div>',
                            '  <div class="game-frontline-note">消耗 ' + escapeHtml(spec.upgradeCost) + ' 兵，下一档容量 ' + escapeHtml(getFrontlineTowerSpec(selectedTower.level + 1, towerType).cap) + '。</div>',
                            '  <div class="game-frontline-note">下一档批次：每 ' + escapeHtml((getFrontlineTowerSpec(selectedTower.level + 1, towerType).productionInterval / 1000).toFixed(1)) + ' 秒 + ' + escapeHtml(getFrontlineTowerSpec(selectedTower.level + 1, towerType).productionAmount) + ' 兵。</div>',
                            '  <button type="button" class="games-btn games-btn--primary" id="frontlineUpgradeBtn" ' + (canUpgrade ? "" : "disabled") + '>升级这座塔</button>',
                            (!canUpgrade ? '<div class="game-frontline-note">当前驻军不足，无法升级。</div>' : ''),
                            '</div>'
                        ].join("")
                )
                : '<div class="game-frontline-note">只有玩家控制的塔可以升级。</div>';
            selectionCardEl.innerHTML = [
                '<div class="game-frontline-selection-main">',
                '  <div class="game-frontline-note"><strong>' + escapeHtml(ownerLabel) + '</strong></div>',
                '  <div class="game-frontline-note">塔型 ' + escapeHtml(frontlineTowerTypeMeta(towerType).label) + ' · ' + escapeHtml(frontlineTowerTypeDescription(towerType)) + '</div>',
                '  <div class="game-frontline-note">驻军 ' + escapeHtml(Math.floor(selectedTower.unitCount)) + ' / ' + escapeHtml(spec.cap) + ' · 当前等级 Lv.' + escapeHtml(selectedTower.level) + '</div>',
                '  <div class="game-frontline-note">产兵批次：每 ' + escapeHtml((spec.productionInterval / 1000).toFixed(1)) + ' 秒 + ' + escapeHtml(spec.productionAmount) + ' 兵</div>',
                '  <div class="game-frontline-note">邻接塔：' + neighborLabel + '</div>',
                upgradeMarkup,
                '</div>'
            ].join("");
            const upgradeButton = selectionCardEl.querySelector("#frontlineUpgradeBtn");
            if (upgradeButton) {
                upgradeButton.addEventListener("click", function () {
                    upgradeTower(selectedTower.id, false);
                });
            }
        }

        function renderTowers(towersGroup) {
            const selectedTower = getTower(session.selectedTowerId);
            session.towers.forEach(function (tower) {
                const node = getTowerNode(tower.id);
                const towerType = node ? node.towerType : "normal";
                const spec = getTowerSpecForTower(tower);
                const ownedByPlayer = tower.owner === "player";
                const actionable = dragState
                    ? dragState.hoveredTargetId === tower.id
                    : (selectedTower && selectedTower.owner === "player" && selectedTower.id !== tower.id && isAdjacent(selectedTower.id, tower.id));
                const selected = selectedTower && selectedTower.id === tower.id;
                const dragSource = dragState && dragState.sourceId === tower.id;
                const hoveredTarget = dragState && dragState.hoveredTargetId === tower.id;
                const progress = tower.owner === "neutral" || tower.unitCount >= spec.cap ? 0 : clamp((tower.prodProgressMs || 0) / spec.productionInterval, 0, 1);
                const half = frontlineTowerHalfSize();
                const cell = 28;
                const group = createSvgNode("g", {
                    "class": [
                        "game-frontline-tower",
                        "is-" + tower.owner,
                        selected ? "is-selected" : "",
                        actionable ? "is-targetable" : "",
                        dragSource ? "is-drag-source" : "",
                        hoveredTarget ? "is-hovered-target" : "",
                        "is-type-" + towerType
                    ].join(" ").trim(),
                    transform: "translate(" + nodeById[tower.id].x + " " + nodeById[tower.id].y + ")",
                    "data-tower-id": tower.id
                });
                const frame = createSvgNode("rect", {
                    x: -half - 4,
                    y: -half - 4,
                    width: (half + 4) * 2,
                    height: (half + 4) * 2,
                    rx: 16,
                    ry: 16,
                    "class": "game-frontline-tower-ring"
                });
                const body = createSvgNode("rect", {
                    x: -half,
                    y: -half,
                    width: half * 2,
                    height: half * 2,
                    rx: 12,
                    ry: 12,
                    "class": "game-frontline-tower-body"
                });
                const q1 = createSvgNode("rect", { x: -half + 6, y: -half + 6, width: cell, height: cell, rx: 7, ry: 7, "class": "game-frontline-tower-cell" });
                const q2 = createSvgNode("rect", { x: 4, y: -half + 6, width: cell, height: cell, rx: 7, ry: 7, "class": "game-frontline-tower-cell" });
                const q3 = createSvgNode("rect", { x: -half + 6, y: 4, width: cell, height: cell, rx: 7, ry: 7, "class": "game-frontline-tower-cell" });
                const q4 = createSvgNode("rect", { x: 4, y: 4, width: cell, height: cell, rx: 7, ry: 7, "class": "game-frontline-tower-cell" });
                const activeCellClass = dragSource ? " game-frontline-tower-cell--active" : "";
                if (dragSource) {
                    if (dragState.ratio === 0.25) {
                        q1.setAttribute("class", q1.getAttribute("class") + activeCellClass);
                    } else if (dragState.ratio === 0.5) {
                        q2.setAttribute("class", q2.getAttribute("class") + activeCellClass);
                    } else if (dragState.ratio === 0.75) {
                        q3.setAttribute("class", q3.getAttribute("class") + activeCellClass);
                    } else {
                        q4.setAttribute("class", q4.getAttribute("class") + activeCellClass);
                    }
                }
                const pBg = createSvgNode("rect", {
                    x: -half + 6,
                    y: half - 16,
                    width: half * 2 - 12,
                    height: 8,
                    rx: 4,
                    ry: 4,
                    "class": "game-frontline-progress-bg"
                });
                const pFill = createSvgNode("rect", {
                    x: -half + 6,
                    y: half - 16,
                    width: (half * 2 - 12) * progress,
                    height: 8,
                    rx: 4,
                    ry: 4,
                    "class": "game-frontline-progress-fill"
                });
                const idText = createSvgNode("text", {
                    x: 0,
                    y: -half - 12,
                    "text-anchor": "middle",
                    "class": "game-frontline-tower-id"
                });
                idText.textContent = tower.id;
                const countText = createSvgNode("text", {
                    x: 0,
                    y: -2,
                    "text-anchor": "middle",
                    "class": "game-frontline-tower-count"
                });
                countText.textContent = String(Math.floor(tower.unitCount));
                const metaText = createSvgNode("text", {
                    x: 0,
                    y: half + 16,
                    "text-anchor": "middle",
                    "class": "game-frontline-tower-meta"
                });
                metaText.textContent = "Lv." + tower.level + " · " + spec.shortLabel;
                function makeRatioText(x, y, value) {
                    const ratioText = createSvgNode("text", {
                        x: x,
                        y: y,
                        "text-anchor": "middle",
                        "class": "game-frontline-cell-ratio"
                    });
                    ratioText.textContent = value;
                    return ratioText;
                }
                group.appendChild(frame);
                group.appendChild(body);
                group.appendChild(q1);
                group.appendChild(q2);
                group.appendChild(q3);
                group.appendChild(q4);
                group.appendChild(makeRatioText(-half + 20, -half + 22, "25"));
                group.appendChild(makeRatioText(half - 20, -half + 22, "50"));
                group.appendChild(makeRatioText(-half + 20, 24, "75"));
                group.appendChild(makeRatioText(half - 20, 24, "100"));
                group.appendChild(pBg);
                group.appendChild(pFill);
                group.appendChild(idText);
                group.appendChild(countText);
                group.appendChild(metaText);

                group.addEventListener("pointerdown", function (event) {
                    event.preventDefault();
                    beginDrag(tower.id, event);
                });
                towersGroup.appendChild(group);
            });
            renderSelectionCard(selectedTower);
        }

        function renderSquads(squadsGroup) {
            session.squads.forEach(function (squad) {
                const fromNode = nodeById[squad.fromId];
                const toNode = nodeById[squad.toId];
                if (!fromNode || !toNode) {
                    return;
                }
                const x = fromNode.x + (toNode.x - fromNode.x) * clamp(squad.progress, 0, 1);
                const y = fromNode.y + (toNode.y - fromNode.y) * clamp(squad.progress, 0, 1);
                const group = createSvgNode("g", {
                    "class": "game-frontline-squad is-" + squad.owner,
                    transform: "translate(" + x + " " + y + ")"
                });
                const bubble = createSvgNode("rect", {
                    x: -18,
                    y: -13,
                    width: 36,
                    height: 26,
                    rx: 13,
                    ry: 13,
                    "class": "game-frontline-squad-pill"
                });
                const label = createSvgNode("text", {
                    x: 0,
                    y: 5,
                    "text-anchor": "middle",
                    "class": "game-frontline-squad-label"
                });
                label.textContent = String(Math.round(squad.count));
                group.appendChild(bubble);
                group.appendChild(label);
                squadsGroup.appendChild(group);
            });
        }

        function renderDragOverlay(overlayGroup) {
            if (!dragState) {
                return;
            }
            const sourceNode = nodeById[dragState.sourceId];
            const sourceTower = getTower(dragState.sourceId);
            const targetNode = dragState.hoveredTargetId ? nodeById[dragState.hoveredTargetId] : null;
            const endX = targetNode ? targetNode.x : dragState.currentPoint.x;
            const endY = targetNode ? targetNode.y : dragState.currentPoint.y;
            overlayGroup.appendChild(createSvgNode("line", {
                x1: sourceNode.x,
                y1: sourceNode.y,
                x2: endX,
                y2: endY,
                "class": "game-frontline-dragline" + (targetNode ? " is-valid" : "")
            }));
            const badgeX = sourceNode.x;
            const badgeY = sourceNode.y - 60;
            const sendCount = getFrontlineDispatchCount(sourceTower, dragState.ratio);
            overlayGroup.appendChild(createSvgNode("rect", {
                x: badgeX - 42,
                y: badgeY - 16,
                width: 84,
                height: 24,
                rx: 12,
                ry: 12,
                "class": "game-frontline-dragbadge"
            }));
            const label = createSvgNode("text", {
                x: badgeX,
                y: badgeY + 1,
                "text-anchor": "middle",
                "class": "game-frontline-dragbadge-text"
            });
            label.textContent = frontlineRatioLabel(dragState.ratio) + " · " + sendCount;
            overlayGroup.appendChild(label);
        }

        function render() {
            syncFrontlineClock(session);
            const difficultyInfo = frontlineDifficultyConfig(session.difficulty);
            const specialTowers = currentMap.nodes.filter(function (node) {
                return node.towerType !== "normal" && node.towerType !== "core";
            }).length;
            playerTowersEl.textContent = String(countOwnedTowers("player"));
            aiTowersEl.textContent = String(countOwnedTowers("ai"));
            squadsEl.textContent = String(session.squads.length);
            timeEl.textContent = formatSeconds(session.elapsedSeconds);
            if (difficultyEl) {
                difficultyEl.textContent = difficultyInfo.label;
            }
            if (mapMetaEl) {
                mapMetaEl.textContent = "主路径与分支会随难度变化。当前地图：" + currentMap.nodes.length + " 塔 / " + currentMap.edges.length + " 线路 / " + specialTowers + " 特殊塔。";
            }
            setStageStats([
                { label: "难度", value: difficultyInfo.label },
                { label: "玩家塔", value: String(countOwnedTowers("player")) },
                { label: "AI 塔", value: String(countOwnedTowers("ai")) },
                { label: "行军队伍", value: String(session.squads.length) },
                { label: "用时", value: formatSeconds(session.elapsedSeconds) }
            ]);
            statusEl.textContent =
                session.status === "victory" ? "你已经攻占所有敌方势力，本局已记录成绩。" :
                    (session.status === "defeat" ? "前线失守，本局已结束。" : ("随机地图进行中：" + difficultyInfo.label + " 难度，进度会自动保存。"));
            syncPresence(
                session.status === "victory" ? "攻占前线 胜利" :
                    (session.status === "defeat" ? "攻占前线 失败" : "正在玩 攻占前线"),
                ""
            );
            svgEl.setAttribute("viewBox", "0 0 " + currentMap.width + " " + currentMap.height);
            svgEl.innerHTML = "";
            const linesGroup = createSvgNode("g", { "class": "game-frontline-lines" });
            const squadsGroup = createSvgNode("g", { "class": "game-frontline-squads" });
            const overlayGroup = createSvgNode("g", { "class": "game-frontline-overlay" });
            const towersGroup = createSvgNode("g", { "class": "game-frontline-towers" });
            renderLines(linesGroup, session.selectedTowerId);
            renderSquads(squadsGroup);
            renderDragOverlay(overlayGroup);
            renderTowers(towersGroup);
            svgEl.appendChild(linesGroup);
            svgEl.appendChild(squadsGroup);
            svgEl.appendChild(overlayGroup);
            svgEl.appendChild(towersGroup);
        }

        function tick() {
            const now = Date.now();
            const deltaMs = Math.min(250, Math.max(16, now - lastFrameAt));
            lastFrameAt = now;
            if (!introActive && state.activeGameId === "frontline") {
                advanceSimulation(deltaMs);
                autosaveAccumulatorMs += deltaMs;
                if (autosaveAccumulatorMs >= 900) {
                    autosaveAccumulatorMs = 0;
                    persist();
                }
            }
            render();
        }

        function showIntro() {
            createGameStartOverlay(mapWrapEl, Object.assign({}, frontlineHelpConfig, {
                buttonLabel: session.elapsedSeconds > 0 || session.squads.length > 0 ? "继续本局" : "开始推进",
                useStageActionButton: true,
                onStart: function () {
                    introActive = false;
                    session.startedAt += Date.now() - introShownAt;
                    lastFrameAt = Date.now();
                    render();
                    persist();
                }
            }));
        }

        timerId = window.setInterval(tick, 100);
        syncVictoryCanvasSize();
        window.addEventListener("resize", syncVictoryCanvasSize);
        window.addEventListener("pointermove", updateDrag);
        window.addEventListener("pointerup", endDrag);
        window.addEventListener("pointercancel", endDrag);
        render();
        persist();
        showIntro();

        return function cleanup() {
            if (timerId) {
                window.clearInterval(timerId);
            }
            window.removeEventListener("resize", syncVictoryCanvasSize);
            window.removeEventListener("pointermove", updateDrag);
            window.removeEventListener("pointerup", endDrag);
            window.removeEventListener("pointercancel", endDrag);
            clearVictoryVisuals();
            persist();
            if (session.status !== "playing") {
                finalizeScoreIfNeeded("teardown");
            }
        };
    }

    function openGameInfoOverlay(host, options) {
        if (!host) {
            return null;
        }
        if (host.__gamesInfoOverlay && typeof host.__gamesInfoOverlay.isActive === "function" && host.__gamesInfoOverlay.isActive()) {
            return host.__gamesInfoOverlay;
        }
        const base = Object.assign({}, options || {});
        const previousOnClose = base.onStart;
        const controller = createGameStartOverlay(host, Object.assign({}, base, {
            eyebrow: base.eyebrow || "帮助说明",
            buttonLabel: base.buttonLabel || "关闭帮助",
            onStart: function () {
                host.__gamesInfoOverlay = null;
                if (typeof previousOnClose === "function") {
                    previousOnClose();
                }
            }
        }));
        host.__gamesInfoOverlay = controller;
        return controller;
    }

    function createSudokuSession(modeKey, options) {
        const opts = options || {};
        const nextModeKey = modeKey || "classic-medium";
        const puzzle = opts.puzzleId
            ? getPuzzleById(opts.puzzleId)
            : choosePuzzle(nextModeKey, opts.previousPuzzleId);
        return {
            sessionKey: "sdk-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            puzzleId: puzzle.id,
            modeKey: nextModeKey,
            board: puzzle.puzzle.split("").map(function (char) { return char === "0" || char === "." ? "" : char; }),
            elapsedSeconds: 0,
            checks: 0,
            completed: false,
            submittedScore: false,
            usedSolver: false,
            celebrationPlayed: false,
            startedAt: Date.now(),
            pausedElapsed: 0,
            paused: false
        };
    }

    function normalizeSudokuSession(raw) {
        if (!raw || !raw.puzzleId) {
            return createSudokuSession("classic-medium");
        }
        const puzzle = getPuzzleById(raw.puzzleId);
        return {
            sessionKey: String(raw.sessionKey || ("sdk-" + Date.now())),
            puzzleId: puzzle.id,
            modeKey: String(raw.modeKey || (puzzle.variant === "hex" ? "hex-16" : ("classic-" + puzzle.difficulty))),
            board: Array.isArray(raw.board) && raw.board.length ? raw.board.slice(0, puzzle.size * puzzle.size) : puzzle.puzzle.split("").map(function (char) { return char === "0" || char === "." ? "" : char; }),
            elapsedSeconds: Number(raw.elapsedSeconds || 0),
            checks: Number(raw.checks || 0),
            completed: Boolean(raw.completed),
            submittedScore: Boolean(raw.submittedScore),
            usedSolver: Boolean(raw.usedSolver),
            celebrationPlayed: Boolean(raw.celebrationPlayed),
            startedAt: Date.now(),
            pausedElapsed: Number(raw.pausedElapsed == null ? raw.elapsedSeconds || 0 : raw.pausedElapsed),
            paused: Boolean(raw.paused)
        };
    }

    function syncSudokuClock(session) {
        if (!session.completed && !session.paused) {
            session.elapsedSeconds = session.pausedElapsed + Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
        }
    }

    function serializeSudokuSession(session) {
        syncSudokuClock(session);
        return {
            sessionKey: session.sessionKey,
            puzzleId: session.puzzleId,
            modeKey: session.modeKey,
            board: session.board.slice(),
            elapsedSeconds: session.elapsedSeconds,
            checks: session.checks,
            completed: session.completed,
            submittedScore: session.submittedScore,
            usedSolver: session.usedSolver,
            celebrationPlayed: Boolean(session.celebrationPlayed),
            pausedElapsed: session.completed || session.paused ? session.pausedElapsed : session.elapsedSeconds,
            paused: Boolean(session.paused)
        };
    }

    function summarizeSudokuSession(session) {
        syncSudokuClock(session);
        const puzzle = getPuzzleById(session.puzzleId);
        const scoreData = computeSudokuScore(session.modeKey, session.elapsedSeconds);
        const filled = session.board.filter(Boolean).length;
        return {
            mode_key: session.modeKey,
            puzzle_name: puzzle.name,
            elapsed_seconds: session.elapsedSeconds,
            completion: Math.floor((filled / (puzzle.size * puzzle.size)) * 100),
            estimated_score: session.usedSolver ? 0 : scoreData.total
        };
    }

    function parseSudokuInput(raw, symbols) {
        const value = String(raw || "").toUpperCase().slice(-1);
        return symbols.indexOf(value) !== -1 ? value : "";
    }

    function getSudokuGroups(puzzle) {
        const groups = [];
        for (let row = 0; row < puzzle.size; row += 1) {
            groups.push(Array.from({ length: puzzle.size }, function (_, col) { return row * puzzle.size + col; }));
        }
        for (let col = 0; col < puzzle.size; col += 1) {
            groups.push(Array.from({ length: puzzle.size }, function (_, row) { return row * puzzle.size + col; }));
        }
        for (let boxRow = 0; boxRow < puzzle.size / puzzle.subgrid; boxRow += 1) {
            for (let boxCol = 0; boxCol < puzzle.size / puzzle.subgrid; boxCol += 1) {
                const group = [];
                for (let row = 0; row < puzzle.subgrid; row += 1) {
                    for (let col = 0; col < puzzle.subgrid; col += 1) {
                        group.push((boxRow * puzzle.subgrid + row) * puzzle.size + (boxCol * puzzle.subgrid + col));
                    }
                }
                groups.push(group);
            }
        }
        return groups;
    }

    function findSudokuConflicts(board, puzzle) {
        const conflicts = new Set();
        getSudokuGroups(puzzle).forEach(function (group) {
            const seen = {};
            group.forEach(function (index) {
                const value = board[index];
                if (!value) {
                    return;
                }
                seen[value] = seen[value] || [];
                seen[value].push(index);
            });
            Object.keys(seen).forEach(function (key) {
                if (seen[key].length > 1) {
                    seen[key].forEach(function (index) {
                        conflicts.add(index);
                    });
                }
            });
        });
        return conflicts;
    }

    function summarizeSudokuConflictHints(board, puzzle, limit) {
        const hints = [];
        const maxHints = Math.max(1, Number(limit || 3));

        function pushHint(scopeLabel, seenMap) {
            Object.keys(seenMap).forEach(function (key) {
                if (hints.length >= maxHints || seenMap[key].length < 2) {
                    return;
                }
                hints.push(scopeLabel + "重复了 " + key);
            });
        }

        for (let row = 0; row < puzzle.size && hints.length < maxHints; row += 1) {
            const seen = {};
            for (let col = 0; col < puzzle.size; col += 1) {
                const value = board[row * puzzle.size + col];
                if (!value) {
                    continue;
                }
                seen[value] = seen[value] || [];
                seen[value].push(col);
            }
            pushHint("第 " + (row + 1) + " 行", seen);
        }
        for (let col = 0; col < puzzle.size && hints.length < maxHints; col += 1) {
            const seen = {};
            for (let row = 0; row < puzzle.size; row += 1) {
                const value = board[row * puzzle.size + col];
                if (!value) {
                    continue;
                }
                seen[value] = seen[value] || [];
                seen[value].push(row);
            }
            pushHint("第 " + (col + 1) + " 列", seen);
        }
        for (let boxRow = 0; boxRow < puzzle.size / puzzle.subgrid && hints.length < maxHints; boxRow += 1) {
            for (let boxCol = 0; boxCol < puzzle.size / puzzle.subgrid && hints.length < maxHints; boxCol += 1) {
                const seen = {};
                for (let row = 0; row < puzzle.subgrid; row += 1) {
                    for (let col = 0; col < puzzle.subgrid; col += 1) {
                        const index = (boxRow * puzzle.subgrid + row) * puzzle.size + (boxCol * puzzle.subgrid + col);
                        const value = board[index];
                        if (!value) {
                            continue;
                        }
                        seen[value] = seen[value] || [];
                        seen[value].push(index);
                    }
                }
                pushHint("宫格 (" + (boxRow + 1) + "," + (boxCol + 1) + ") ", seen);
            }
        }
        return hints;
    }

    function getSudokuVictoryFireworkCount(modeKey) {
        if (modeKey === "hex-16") {
            return 26;
        }
        if (modeKey === "classic-hard") {
            return 18;
        }
        if (modeKey === "classic-medium") {
            return 14;
        }
        return 10;
    }

    function getSudokuVictoryOrder(puzzle) {
        const order = [];
        const size = Number(puzzle.size || 9);
        const ringCount = Math.ceil(size / 2);
        for (let ring = 0; ring < ringCount; ring += 1) {
            const top = ring;
            const left = ring;
            const bottom = size - 1 - ring;
            const right = size - 1 - ring;
            for (let col = left; col <= right; col += 1) {
                order.push(top * size + col);
            }
            for (let row = top + 1; row <= bottom; row += 1) {
                order.push(row * size + right);
            }
            if (bottom > top) {
                for (let col = right - 1; col >= left; col -= 1) {
                    order.push(bottom * size + col);
                }
            }
            if (right > left) {
                for (let row = bottom - 1; row > top; row -= 1) {
                    order.push(row * size + left);
                }
            }
        }
        return order;
    }

    function mountSudoku(savedPayload) {
        let session = normalizeSudokuSession(savedPayload.state || {});
        let manualCheckpoint = savedPayload && savedPayload.state && savedPayload.state.manualCheckpoint
            ? Object.assign({}, savedPayload.state.manualCheckpoint, {
                board: Array.isArray(savedPayload.state.manualCheckpoint.board)
                    ? savedPayload.state.manualCheckpoint.board.slice()
                    : []
            })
            : null;
        let timerId = null;
        let inputs = [];
        const sudokuHelpConfig = {
            title: "数独",
            subtitle: "看清盘面、稳定落子，尽量保住高分倍率。",
            bullets: [
                "目标：让每一行、每一列、每个宫内都不出现重复，并最终全部填满。",
                "重复提示会直接告诉你当前哪些行、列或宫格出现了重复，适合排错。",
                "经典模式分为简单、中等、困难；HEX-16 是最高难度，盘面更大、奖励也更高。",
                "自动解题只用于预览或跳关，完成后也会播结算动画，但本局分数会归零。"
            ],
            hint: "数独采用高底薪模型，完整手动解出通常就是几千分起步；HEX-16 会更高。"
        };
        const modeButtons = [];

        addStageButton("校验", function () {
            session.checks += 1;
            validateAndMaybeFinish(true);
            persist();
        }, true);
        addStageButton("重复提示", function () {
            session.checks += 1;
            const puzzle = getPuzzleById(session.puzzleId);
            const conflicts = findSudokuConflicts(session.board, puzzle);
            validateAndMaybeFinish(false);
            if (!conflicts.size) {
                setStatus("当前没有重复冲突。", false);
            } else {
                setStatus("重复提示：" + summarizeSudokuConflictHints(session.board, puzzle, 3).join("；"), true);
            }
            persist();
        }, false);
        addStageButton("自动解题", function () {
            const puzzle = getPuzzleById(session.puzzleId);
            session.board = puzzle.solution.split("");
            session.usedSolver = true;
            session.completed = true;
            syncSudokuClock(session);
            session.pausedElapsed = session.elapsedSeconds;
            drawBoard();
            persist();
            setStatus("已自动解题，本局不计分。", false);
        }, false);
        addStageButton("存档点", function () {
            const snapshot = serializeSudokuSession(session);
            snapshot.pausedElapsed = snapshot.elapsedSeconds;
            snapshot.paused = false;
            manualCheckpoint = snapshot;
            persist();
            setStatus("已记录 1 个数独存档点。", false);
        }, false);
        addStageButton("读档", function () {
            if (!manualCheckpoint) {
                setStatus("当前还没有可读取的存档点。", true);
                return;
            }
            const restored = Object.assign({}, manualCheckpoint, {
                board: Array.isArray(manualCheckpoint.board) ? manualCheckpoint.board.slice() : []
            });
            restored.pausedElapsed = restored.elapsedSeconds;
            restored.paused = false;
            session = normalizeSudokuSession(restored);
            drawBoard();
            persist();
            setStatus("已恢复到手动存档点。", false);
        }, false);
        addStageButton("重置当前题", function () {
            const puzzle = getPuzzleById(session.puzzleId);
            session = createSudokuSession(session.modeKey, { puzzleId: puzzle.id });
            drawBoard();
            persist();
        }, false);
        addStageButton("换一题", function () {
            session = createSudokuSession(session.modeKey, { previousPuzzleId: session.puzzleId });
            drawBoard();
            persist();
        }, false);
        let pauseButton = addStageButton("暂停", function () {
            if (introActive || session.completed) {
                return;
            }
            if (session.paused) {
                session.startedAt = Date.now();
                session.paused = false;
            } else {
                syncSudokuClock(session);
                session.pausedElapsed = session.elapsedSeconds;
                session.paused = true;
            }
            updatePauseState();
            updateHeader();
            persist();
        }, false);
        addStageButton("帮助", function () {
            openGameInfoOverlay(playfieldEl, sudokuHelpConfig);
        }, false);

        const shell = document.createElement("div");
        shell.className = "game-sudoku-shell";
        shell.innerHTML = [
            '<div class="game-sudoku-stage">',
            '  <div class="game-sudoku-playfield game-start-host" id="gameSudokuPlayfield"><div class="game-sudoku-board" id="gameSudokuBoard"></div><div class="game-sudoku-pause-overlay" id="gameSudokuPauseOverlay" hidden><div class="game-sudoku-pause-card"><div class="game-sudoku-pause-title">已暂停</div><div class="game-sudoku-pause-text">当前题面已遮罩，点击下方按钮继续。</div></div></div><canvas class="game-sudoku-victory-canvas" id="gameSudokuVictoryCanvas"></canvas><div class="game-sudoku-victory-banner" id="gameSudokuVictoryBanner"></div></div>',
            '  <div class="game-sudoku-sidecard">',
            '    <div class="game-sudoku-panel"><div class="games-section-title">当前题面</div><div class="games-stage-meta" id="gameSudokuMetaLine"></div></div>',
            '    <div class="game-sudoku-panel"><div class="games-section-title">积分说明</div><div class="game-sudoku-scoreline" id="gameSudokuScoreline"></div></div>',
            "  </div>",
            "</div>"
        ].join("");
        els.stageBody.appendChild(shell);

        const metaEl = shell.querySelector("#gameSudokuMetaLine");
        const scorelineEl = shell.querySelector("#gameSudokuScoreline");
        const playfieldEl = shell.querySelector("#gameSudokuPlayfield");
        const boardEl = shell.querySelector("#gameSudokuBoard");
        const pauseOverlayEl = shell.querySelector("#gameSudokuPauseOverlay");
        const victoryCanvas = shell.querySelector("#gameSudokuVictoryCanvas");
        const victoryBannerEl = shell.querySelector("#gameSudokuVictoryBanner");
        const sidecardEl = shell.querySelector(".game-sudoku-sidecard");
        let introShownAt = Date.now();
        let introActive = true;
        let victoryAnimationId = 0;
        let victoryAnimationEndsAt = 0;
        let victoryTimeouts = [];
        let victoryParticles = [];

        [
            { key: "classic-easy", label: "经典 简单" },
            { key: "classic-medium", label: "经典 中等" },
            { key: "classic-hard", label: "经典 困难" },
            { key: "hex-16", label: "HEX-16" }
        ].forEach(function (mode) {
            const btn = addStageTagButton(mode.label, function () {
                session = createSudokuSession(mode.key);
                drawBoard();
                persist();
            });
            btn.dataset.modeKey = mode.key;
            btn.addEventListener("click", function () {
                Array.from(modeButtons).forEach(function (node) {
                    node.classList.toggle("is-active", node === btn);
                });
            });
            modeButtons.push(btn);
        });

        function clearSudokuVictoryAnimation(keepGoldState) {
            victoryTimeouts.forEach(function (timer) {
                window.clearTimeout(timer);
            });
            victoryTimeouts = [];
            if (victoryAnimationId) {
                window.cancelAnimationFrame(victoryAnimationId);
                victoryAnimationId = 0;
            }
            victoryAnimationEndsAt = 0;
            victoryParticles = [];
            boardEl.classList.remove("is-victory-glow");
            playfieldEl.classList.remove("is-victory-active");
            victoryBannerEl.classList.remove("is-visible");
            victoryBannerEl.textContent = "";
            inputs.forEach(function (item) {
                if (!item || !item.wrapper) {
                    return;
                }
                item.wrapper.classList.remove("is-celebrate-gold");
                item.wrapper.classList.toggle("is-victory-complete", Boolean(keepGoldState));
            });
            const ctx = victoryCanvas.getContext("2d");
            ctx.clearRect(0, 0, victoryCanvas.width, victoryCanvas.height);
        }

        function resizeSudokuVictoryCanvas() {
            const rect = playfieldEl.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            victoryCanvas.width = Math.max(1, Math.round(rect.width * dpr));
            victoryCanvas.height = Math.max(1, Math.round(rect.height * dpr));
            victoryCanvas.style.width = rect.width + "px";
            victoryCanvas.style.height = rect.height + "px";
            const ctx = victoryCanvas.getContext("2d");
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            return { width: rect.width, height: rect.height };
        }

        function syncSudokuBoardLayout() {
            const puzzle = getPuzzleById(session.puzzleId);
            const rect = playfieldEl.getBoundingClientRect();
            const stageRect = shell.getBoundingClientRect();
            const isSingleColumn = stageRect.width < 1180;
            const maxBoardSize = puzzle.size >= 16 ? 860 : 540;
            const minBoardSize = puzzle.size >= 16 ? 300 : 260;
            const verticalSpace = Math.max(260, rect.height - 28);
            const horizontalSpace = Math.max(260, rect.width - (isSingleColumn ? 20 : 28));
            const targetSize = Math.max(minBoardSize, Math.min(maxBoardSize, horizontalSpace, verticalSpace));
            const fontSize = Math.max(puzzle.size >= 16 ? 12 : 18, Math.floor(targetSize / puzzle.size * (puzzle.size >= 16 ? 0.44 : 0.54)));
            boardEl.style.setProperty("--board-size", targetSize + "px");
            boardEl.style.setProperty("--sudoku-cell-font", fontSize + "px");
        }

        function spawnSudokuFireworkBurst(x, y, power) {
            const burstSize = Math.max(18, Math.floor(18 + power * 0.55));
            const palette = ["#fbbf24", "#f59e0b", "#fde68a", "#fff7cc", "#f97316"];
            for (let index = 0; index < burstSize; index += 1) {
                const angle = Math.PI * 2 * index / burstSize + randomBetween(-0.08, 0.08);
                const speed = randomBetween(54, 160 + power);
                victoryParticles.push({
                    x: x,
                    y: y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life: randomBetween(0.9, 1.8),
                    maxLife: randomBetween(0.9, 1.8),
                    radius: randomBetween(1.6, 3.8),
                    color: palette[Math.floor(Math.random() * palette.length)]
                });
            }
        }

        function playSudokuVictoryAnimation() {
            const puzzle = getPuzzleById(session.puzzleId);
            const revealOrder = getSudokuVictoryOrder(puzzle);
            const revealDuration = puzzle.size >= 16 ? 2400 : 1700;
            const revealStep = Math.max(8, Math.floor(revealDuration / Math.max(1, revealOrder.length)));
            const fireworkCount = getSudokuVictoryFireworkCount(session.modeKey);
            const fireworkWindow = puzzle.size >= 16 ? 3600 : 2800;

            clearSudokuVictoryAnimation(false);
            resizeSudokuVictoryCanvas();
            playfieldEl.classList.add("is-victory-active");
            victoryBannerEl.textContent = session.modeKey === "hex-16" ? "SUPER CLEAR" : "BRILLIANT CLEAR";
            victoryAnimationEndsAt = Date.now() + revealOrder.length * revealStep + fireworkWindow + 2400;

            revealOrder.forEach(function (cellIndex, orderIndex) {
                victoryTimeouts.push(window.setTimeout(function () {
                    if (inputs[cellIndex] && inputs[cellIndex].wrapper) {
                        inputs[cellIndex].wrapper.classList.add("is-celebrate-gold");
                    }
                }, orderIndex * revealStep));
            });

            victoryTimeouts.push(window.setTimeout(function () {
                inputs.forEach(function (item) {
                    if (item && item.wrapper) {
                        item.wrapper.classList.add("is-victory-complete");
                    }
                });
                boardEl.classList.add("is-victory-glow");
                victoryBannerEl.classList.add("is-visible");
            }, revealOrder.length * revealStep + 80));

            for (let burstIndex = 0; burstIndex < fireworkCount; burstIndex += 1) {
                victoryTimeouts.push(window.setTimeout(function () {
                    const rect = resizeSudokuVictoryCanvas();
                    spawnSudokuFireworkBurst(
                        randomBetween(rect.width * 0.14, rect.width * 0.86),
                        randomBetween(rect.height * 0.12, rect.height * 0.56),
                        24 + burstIndex * 2
                    );
                }, revealOrder.length * revealStep + 220 + Math.floor(burstIndex * (fireworkWindow / Math.max(1, fireworkCount)))));
            }

            (function animateSudokuFireworks() {
                const rect = resizeSudokuVictoryCanvas();
                const ctx = victoryCanvas.getContext("2d");
                ctx.clearRect(0, 0, rect.width, rect.height);
                ctx.globalCompositeOperation = "lighter";
                victoryParticles = victoryParticles.filter(function (particle) {
                    particle.life -= 1 / 60;
                    if (particle.life <= 0) {
                        return false;
                    }
                    particle.x += particle.vx / 60;
                    particle.y += particle.vy / 60;
                    particle.vx *= 0.988;
                    particle.vy = particle.vy * 0.988 + 2.8;
                    const alpha = Math.max(0, particle.life / particle.maxLife);
                    ctx.fillStyle = particle.color;
                    ctx.globalAlpha = alpha;
                    ctx.beginPath();
                    ctx.arc(particle.x, particle.y, particle.radius * (0.62 + alpha * 0.5), 0, Math.PI * 2);
                    ctx.fill();
                    return true;
                });
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = "source-over";
                if (victoryParticles.length || Date.now() < victoryAnimationEndsAt) {
                    victoryAnimationId = window.requestAnimationFrame(animateSudokuFireworks);
                } else {
                    victoryAnimationId = 0;
                }
            }());
        }

        function persist() {
            const payload = serializeSudokuSession(session);
            payload.manualCheckpoint = manualCheckpoint
                ? Object.assign({}, manualCheckpoint, {
                    board: Array.isArray(manualCheckpoint.board) ? manualCheckpoint.board.slice() : []
                })
                : null;
            scheduleGameStateSave("sudoku", payload, summarizeSudokuSession(session));
        }

        function updatePauseState() {
            if (pauseButton) {
                pauseButton.textContent = session.paused ? "继续" : "暂停";
            }
            if (pauseOverlayEl) {
                pauseOverlayEl.hidden = !session.paused;
            }
            boardEl.classList.toggle("is-paused", Boolean(session.paused));
            inputs.forEach(function (item) {
                if (!item || !item.input || !item.wrapper) {
                    return;
                }
                item.input.readOnly = session.paused || session.completed || item.wrapper.classList.contains("is-fixed");
                if (session.paused) {
                    item.input.blur();
                }
            });
        }

        function updateHeader() {
            const puzzle = getPuzzleById(session.puzzleId);
            syncSudokuClock(session);
            const scoreData = computeSudokuScore(session.modeKey, session.elapsedSeconds);
            const conflictCount = findSudokuConflicts(session.board, puzzle).size;
            metaEl.textContent = "题目: " + puzzle.name + "，校验次数 " + session.checks + "，冲突格 " + conflictCount + "，" + (session.paused ? "当前已暂停，可随时继续。" : "关闭页面后可从当前盘面继续。");
            setStageStats([
                { label: "模式", value: session.modeKey.toUpperCase() },
                { label: "状态", value: session.completed ? "完成" : (session.paused ? "暂停" : "进行中") },
                { label: "用时", value: formatSeconds(session.elapsedSeconds) },
                { label: "积分", value: String(session.usedSolver ? 0 : scoreData.total) },
                { label: "冲突格", value: String(conflictCount) },
                { label: "存档点", value: manualCheckpoint ? "已记录" : "无" }
            ]);
            scorelineEl.textContent = session.usedSolver
                ? "已使用自动解题，本局不计算分数。"
                : ("积分 =（底薪 " + scoreData.baseSalary + " + 难度提成 " + scoreData.difficultyBonus + " + 时间提成 " + scoreData.timeBonus + "），数独总奖励已整体提升到 20 倍。");
            modeButtons.forEach(function (btn) {
                btn.classList.toggle("is-active", btn.dataset.modeKey === session.modeKey);
            });
            syncPresence(session.paused ? "数独 已暂停" : (session.usedSolver ? "数独自动解题中" : ("正在玩 " + session.modeKey)), "");
            syncSudokuBoardLayout();
            updatePauseState();
        }

        function drawBoard() {
            const puzzle = getPuzzleById(session.puzzleId);
            const fixed = puzzle.puzzle.split("").map(function (char) { return char !== "0" && char !== "."; });
            clearSudokuVictoryAnimation(Boolean(session.completed && !session.usedSolver));
            boardEl.innerHTML = "";
            boardEl.style.gridTemplateColumns = "repeat(" + puzzle.size + ", 1fr)";
            boardEl.classList.toggle("is-hex", puzzle.size === 16);
            boardEl.classList.toggle("is-victory-glow", Boolean(session.completed && !session.usedSolver));
            inputs = [];
            updateHeader();

            session.board.forEach(function (value, index) {
                const wrapper = document.createElement("div");
                wrapper.className = "game-sudoku-cell";
                if (puzzle.size === 16) {
                    wrapper.classList.add("is-hex");
                }
                if (fixed[index]) {
                    wrapper.classList.add("is-fixed");
                }
                if (session.completed && !session.usedSolver) {
                    wrapper.classList.add("is-victory-complete");
                }
                if ((Math.floor(index / puzzle.size) + 1) % puzzle.subgrid === 0) {
                    wrapper.style.borderBottomColor = "rgba(203, 213, 225, 0.8)";
                    wrapper.style.borderBottomWidth = "2px";
                }
                if (((index % puzzle.size) + 1) % puzzle.subgrid === 0) {
                    wrapper.style.borderRightColor = "rgba(203, 213, 225, 0.8)";
                    wrapper.style.borderRightWidth = "2px";
                }
                const input = document.createElement("input");
                input.type = "text";
                input.maxLength = 1;
                input.autocomplete = "off";
                input.spellcheck = false;
                input.value = value;
                input.readOnly = fixed[index] || session.completed || session.paused;
                input.addEventListener("input", function (event) {
                    if (introActive || session.paused) {
                        event.target.value = session.board[index] || "";
                        return;
                    }
                    const nextValue = parseSudokuInput(event.target.value, puzzle.symbols);
                    event.target.value = nextValue;
                    session.board[index] = nextValue;
                    validateAndMaybeFinish(false);
                    persist();
                });
                wrapper.appendChild(input);
                boardEl.appendChild(wrapper);
                inputs.push({ wrapper: wrapper, input: input });
            });

            validateAndMaybeFinish(false);
            syncSudokuBoardLayout();
        }

        function maybeSubmitScore() {
            if (session.submittedScore || session.usedSolver) {
                return;
            }
            syncSudokuClock(session);
            const scoreData = computeSudokuScore(session.modeKey, session.elapsedSeconds);
            session.submittedScore = true;
            submitScore("sudoku", scoreData.total, session.modeKey, session.sessionKey, {
                mode_key: session.modeKey,
                elapsed_seconds: session.elapsedSeconds,
                checks: session.checks,
                base_salary: scoreData.baseSalary,
                difficulty_bonus: scoreData.difficultyBonus,
                time_bonus: scoreData.timeBonus,
                auto_solved: false,
                puzzle_id: session.puzzleId
            }).catch(function (error) {
                session.submittedScore = false;
                setStatus(error.message || "数独成绩提交失败", true);
            });
        }

        function validateAndMaybeFinish(showMessage) {
            const puzzle = getPuzzleById(session.puzzleId);
            const conflicts = findSudokuConflicts(session.board, puzzle);
            inputs.forEach(function (item, index) {
                item.wrapper.classList.toggle("is-error", conflicts.has(index));
                item.input.classList.toggle("is-error", conflicts.has(index));
            });
            updateHeader();

            if (showMessage && session.usedSolver && session.completed && !conflicts.size && session.board.every(Boolean) && session.board.join("") === puzzle.solution) {
                playSudokuVictoryAnimation();
                setStatus("已自动解题，当前为庆祝动画预览，不计分。", false);
                persist();
                return;
            }

            if (showMessage) {
                if (conflicts.size > 0) {
                    setStatus("当前有冲突格，请先修正。", true);
                    return;
                }
                if (session.board.some(function (item) { return !item; })) {
                    setStatus("还有空格未填完。", true);
                    return;
                }
            }

            if (!conflicts.size && session.board.every(Boolean) && session.board.join("") === puzzle.solution) {
                session.completed = true;
                syncSudokuClock(session);
                session.pausedElapsed = session.elapsedSeconds;
                if (session.usedSolver) {
                    setStatus("已完成，但由于使用了自动解题，本局不计分。", false);
                } else {
                    maybeSubmitScore();
                    if (!session.celebrationPlayed) {
                        session.celebrationPlayed = true;
                        playSudokuVictoryAnimation();
                    }
                    setStatus("数独完成，成绩已记录。", false);
                }
                persist();
            }
        }

        timerId = window.setInterval(function () {
            if (state.activeGameId === "sudoku") {
                updateHeader();
            }
        }, 1000);
        window.addEventListener("resize", syncSudokuBoardLayout);

        createGameStartOverlay(playfieldEl, Object.assign({}, sudokuHelpConfig, {
            buttonLabel: session.elapsedSeconds > 0 || session.checks > 0 ? "继续本局" : "开始游戏",
            useStageActionButton: true,
            onStart: function () {
                introActive = false;
                if (session.paused) {
                    session.startedAt = Date.now();
                    session.paused = false;
                } else {
                    session.startedAt += Date.now() - introShownAt;
                }
                updateHeader();
                persist();
            }
        }));

        drawBoard();
        persist();

        return function cleanup() {
            if (timerId) {
                window.clearInterval(timerId);
            }
            window.removeEventListener("resize", syncSudokuBoardLayout);
            clearSudokuVictoryAnimation(Boolean(session.completed && !session.usedSolver));
            syncSudokuClock(session);
            session.pausedElapsed = session.elapsedSeconds;
            persist();
        };
    }

    function randomBetween(min, max) {
        return min + Math.random() * (max - min);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function distanceBetween(a, b) {
        const dx = Number(a.x || 0) - Number(b.x || 0);
        const dy = Number(a.y || 0) - Number(b.y || 0);
        return Math.sqrt(dx * dx + dy * dy);
    }

    function createArcadeShell(title, guideText, accentText) {
        const shell = document.createElement("div");
        shell.className = "game-arcade-shell";
        shell.innerHTML = [
            '<div class="game-arcade-toolbar">',
            '  <div class="game-arcade-head">',
            '    <div class="games-section-title">' + escapeHtml(title) + "</div>",
            '    <div class="games-stage-meta game-arcade-guide">' + escapeHtml(guideText) + "</div>",
            "  </div>",
            '  <div class="game-stat-grid" id="gameArcadeStatGrid"></div>',
            "</div>",
            '<div class="games-stage-meta game-arcade-accent">' + escapeHtml(accentText) + "</div>",
            '<div class="game-arcade-stage">',
            '  <div class="game-arcade-canvas-wrap">',
            '    <canvas class="game-arcade-canvas" width="960" height="600"></canvas>',
            '    <div class="game-arcade-controls-card">',
            '      <div class="games-section-title">操作说明</div>',
            '      <div class="game-arcade-list" id="gameArcadeControls"></div>',
            "    </div>",
            "  </div>",
            '  <div class="game-arcade-sidecard">',
            '    <div class="games-section-title">战局信息</div>',
            '    <div class="game-arcade-list" id="gameArcadeStatus"></div>',
            "  </div>",
            "</div>"
        ].join("");
        els.stageBody.appendChild(shell);
        const statGrid = shell.querySelector("#gameArcadeStatGrid");
        if (statGrid) {
            statGrid.hidden = true;
        }
        return {
            shell: shell,
            toolbar: shell.querySelector(".game-arcade-toolbar"),
            head: shell.querySelector(".game-arcade-head"),
            guideMeta: shell.querySelector(".game-arcade-guide"),
            accentMeta: shell.querySelector(".game-arcade-accent"),
            canvas: shell.querySelector("canvas"),
            canvasWrap: shell.querySelector(".game-arcade-canvas-wrap"),
            statGrid: statGrid,
            controlsCard: shell.querySelector(".game-arcade-controls-card"),
            controls: shell.querySelector("#gameArcadeControls"),
            status: shell.querySelector("#gameArcadeStatus")
        };
    }

    function setArcadeStats(statGrid, stats) {
        if (statGrid) {
            statGrid.innerHTML = renderStatCards(stats);
        }
        setStageStats(stats);
    }

    function setArcadeList(container, items, className) {
        if (!container) {
            return;
        }
        container.innerHTML = items.map(function (item) {
            return '<div class="' + (className || "games-stage-meta") + '">' + item + "</div>";
        }).join("");
    }

    function drawStarfield(ctx, width, height, tick) {
        ctx.fillStyle = "#020617";
        ctx.fillRect(0, 0, width, height);
        for (let i = 0; i < 80; i += 1) {
            const x = (i * 127 + tick * 12) % width;
            const y = (i * 53 + tick * 7) % height;
            const alpha = 0.2 + ((i * 17) % 10) / 20;
            ctx.fillStyle = "rgba(148,163,184," + alpha.toFixed(2) + ")";
            ctx.fillRect(x, y, 2, 2);
        }
    }

    const TOPDOWN_BALANCE = {
        // 得分与节奏
        killScore: 2,
        waveStepKills: 10,
        waveBonusScore: 4,
        comboResetWindow: 8,
        comboResetWindowPerLevel: 0.8,
        comboResetWindowMin: 5,
        comboScoreStep: 5,
        comboItemEvery: 60,
        comboItemEveryStep: 5,
        comboItemEveryMin: 25,
        itemBuffDuration: 30,
        bonusRerollsAmount: 5,
        // 基础生存
        playerLives: 1,
        baseShieldLayers: 2,
        shieldLayerPerLevel: 1,
        shieldCapacityCap: 6,
        shieldRechargeDelay: 5.4,
        shieldRechargeDelayStep: 0.7,
        shieldRechargeDelayMin: 1.8,
        shieldRechargeDuration: 4.6,
        shieldRechargeDurationStep: 0.55,
        shieldRechargeDurationMin: 1.5,
        // 玩家基础数值
        baseMoveSpeed: 236,
        moveSpeedPerLevel: 18,
        moveSpeedRollMin: 24,
        moveSpeedRollMax: 42,
        baseFireInterval: 0.22,
        fireRateStep: 0.07,
        fireRateRollMin: 0.035,
        fireRateRollMax: 0.07,
        minFireInterval: 0.085,
        baseBulletDamage: 3.2,
        attackPerLevel: 0.75,
        attackRollMin: 0.85,
        attackRollMax: 1.65,
        damageSoftCap: 15.5,
        damageOverflowFactor: 0.55,
        bulletSpeed: 480,
        bulletRadius: 4,
        bulletLife: 1.4,
        projectileCap: 6,
        projectileRadiusPerLevel: 0.45,
        projectileLifePerLevel: 0.14,
        moveSpeedSoftCap: 360,
        moveSpeedOverflowFactor: 0.45,
        fireRateSoftCapPerSecond: 7.2,
        fireRateHardCapPerSecond: 10.5,
        fireRateOverflowFactor: 0.45,
        playerRadius: 14,
        arenaWidth: 960,
        arenaHeight: 720,
        arenaPadding: 20,
        arenaPlayerMargin: 18,
        multishotSpread: 0.18,
        wingmanMax: 4,
        wingmanOrbitRadius: 42,
        wingmanDamageFactor: 0.5,
        wingmanFireRateFactor: 1.35,
        pickupRadius: 13,
        pickupLifetime: 20,
        // 敌人刷新与成长
        targetEnemyBase: 4,
        targetEnemyPerWave: 1.15,
        targetEnemyCap: 22,
        spawnBaseInterval: 1.18,
        spawnIntervalWaveStep: 0.16,
        spawnIntervalMin: 0.33,
        enemyBaseRadius: 16,
        enemyRadiusVariance: 8,
        enemyBaseSpeed: 28,
        enemySpeedPerWave: 1.6,
        enemySpeedVariance: 14,
        enemyBaseHp: 6,
        enemyHpPerWave: 1.35,
        enemyHpPerKill: 0.14,
        enemyHpPerBoss: 5,
        latePressureStartWave: 9,
        lateEnemyHpPerWave: 1.9,
        lateEnemySpeedPerWave: 1.05,
        enemyFireMin: 1.2,
        enemyFireMax: 2.9,
        enemyFireRange: 340,
        enemyBulletSpeed: 182,
        // 精英怪
        eliteEveryKills: 9,
        eliteHpMultiplier: 1.55,
        eliteFireRateMultiplier: 0.78,
        eliteBulletSpread: 0.16,
        eliteBulletCount: 1,
        eliteSpeedMultiplier: 1.16,
        eliteBulletSpeedPerWave: 5,
        bossWaveEvery: 4,
        bossHpMultiplier: 5.2,
        bossShieldBase: 24,
        bossShieldPerWave: 5,
        bossShieldPerBoss: 8,
        bossRadius: 30,
        bossFireRateMultiplier: 0.68,
        bossBulletCount: 5,
        bossBulletSpeedMultiplier: 1.45,
        bossSpeedMultiplier: 0.78,
        bossBonusScore: 24,
        bossRelicChoiceCount: 2,
        // 强化上限
        elementCap: 7,
        statCap: 7,
        multishotCap: 5,
        comboWindowCap: 5,
        comboThresholdCap: 7,
        // 火 / 电 / 冰 / 核
        burnDuration: 2.2,
        burnTickInterval: 0.35,
        burnStackMax: 6,
        burnDamageBase: 0.8,
        burnDamagePerLevel: 0.7,
        burnDamagePerStack: 0.4,
        fireSpreadOverlapPadding: 2,
        elementAoeBaseInterval: 10,
        elementAoeIntervalStep: 1,
        elementAoeMinInterval: 5,
        fireAoeBaseRadius: 46,
        fireAoeRadiusPerLevel: 7,
        iceAoeBaseRadius: 50,
        iceAoeRadiusPerLevel: 8,
        electricBaseChains: 1,
        electricRadius: 150,
        electricDamageFactor: 0.7,
        electricBeamLife: 0.1,
        electricMaxRange: 420,
        electricShockChance: 0.34,
        electricShockBonus: 1.45,
        iceSlowPerStack: 0.11,
        iceMaxSlow: 0.78,
        iceFreezeStacks: 6,
        iceFreezeDuration: 1.35,
        iceShatterChance: 0.24,
        nuclearBaseRadius: 52,
        nuclearRadiusPerLevel: 18,
        nuclearDamageFactor: 0.8,
        nuclearBurstLife: 0.24,
        nuclearRadiationChance: 0.26,
        nuclearRadiationDuration: 3,
        nuclearRadiationAlpha: 0.22,
        enemySpecialAttackWave: 6,
        eliteSpecialAttackChance: 0.28,
        bossSpecialAttackChance: 0.46,
        enemySpecialCooldownMin: 3.2,
        enemySpecialCooldownMax: 5.8,
        enemyBeamLife: 0.18,
        enemyBeamRange: 760,
        enemyBeamWidth: 9,
        enemyRingBulletCount: 6,
        bossRingBulletCount: 6,
        enemyRingSpeedFactor: 0.76,
        enemyBarrageBulletCount: 6,
        enemyBarrageSpread: 0.34,
        enemyContactDamage: 1,
        enemyDefaultBulletDamage: 1,
        maxPlayerBullets: 320,
        maxEnemyBullets: 420,
        maxFriendlyBeams: 140,
        maxEnemyBeams: 64,
        maxAoeBursts: 80,
        maxPickups: 28,
        maxEnemiesHard: 40,
        // 道具与精英
        totalRerolls: 5,
        eliteTypes: ["dash", "冷锋", "杀马特团长", "self-destruct", "buffer", "splitter", "repulsor", "blackhand", "nightmare", "liangzi"],
        eliteDashCooldown: 3.2,
        eliteDashSpeed: 270,
        eliteDashDuration: 0.5,
        eliteSniperRange: 520,
        eliteSniperBulletSpeed: 286,
        eliteSniperDamage: 2,
        eliteSummonCooldown: 5.2,
        eliteSummonCount: 1,
        bufferAuraRadius: 136,
        bufferAuraOnDuration: 2.6,
        bufferAuraOffDuration: 1.65,
        bufferEnemySpeedMultiplier: 1.12,
        bufferEnemyFireRateMultiplier: 0.84,
        bufferHpFactor: 0.62,
        selfDestructRushSpeed: 228,
        selfDestructDelay: 1.15,
        selfDestructRadius: 76,
        selfDestructBurstLife: 0.42,
        repulsorRange: 130,
        repulsorKnockDistance: 128,
        repulsorKnockSpeed: 360,
        repulsorCooldown: 3.1,
        blackhandHookRange: 430,
        blackhandHookSpeed: 226,
        blackhandPullSpeed: 258,
        blackhandHookCooldown: 2.8,
        nightmareBlindDuration: 5,
        nightmareVisionRadius: 108,
        nightmareTouchCooldown: 1.1,
        liangziConsumeCooldown: 1,
        liangziConsumeHpFactor: 1.5,
        // 普通小怪幸运掉落
        luckyDropChance: 0.01,
        luckyDropItemWeight: 0.6,
        // 首领装备：这里集中调节每层收益
        bossRelicMaxStacks: 16,
        bossRelicEnemySpeedStep: 0.08,
        bossRelicEnemyBulletSpeedStep: 0.08,
        bossRelicEnemyFireRateStep: 0.08,
        bossRelicEnemyMinMultiplier: 0.2,
        bossRelicEnemyFireCooldownMaxMultiplier: 2.28,
        shrinkEngineScaleStep: 0.03,
        shrinkEngineMaxStacks: 20,
        magneticTrapMaxStacks: 12,
        magneticTrapOrbitRadius: 68,
        magneticTrapBulletRadius: 6,
        magneticTrapDamageFactor: 1.5,
        magneticTrapSpinFactor: 3.1,
        magneticTrapHitIntervalFactor: 0.72,
        splitterChildCount: 5,
        splitterChildHpFactor: 0.3,
        splitterChildSpeedFactor: 1.18,
        splitterChildRadiusFactor: 0.56,
        // 技能
        skillCooldown: 60,
        blinkTapWindow: 0.24,
        blinkDistance: 138,
        blinkDuration: 0.14,
        missileSpeed: 540,
        missileTurnRate: 8.8,
        missileRadius: 6,
        missileDamageFactor: 1.85,
        invincibleDuration: 10,
        maxSkillProjectiles: 180,
        // 局外养成
        metaSkinDrawCost: 1600,
        metaSkinDuplicateRefundRate: 0.2,
        metaPointsBaseReward: 120,
        metaPointsScoreRate: 1.1,
        metaPointsBossBonus: 180,
        metaPointsComboBonus: 4
    };

    function topdownPickupVisual(pickup) {
        const itemKey = pickup && pickup.itemKey;
        const map = {
            upgrade: { label: "UP", color: "#38bdf8", accent: "#e0f2fe" },
            "score-double": { label: "2X", color: "#facc15", accent: "#fef3c7" },
            "screen-clear": { label: "SK", color: "#fb7185", accent: "#fecdd3" },
            "clear-bullets": { label: "CL", color: "#a78bfa", accent: "#ede9fe" },
            "rapid-fire": { label: "RF", color: "#f97316", accent: "#ffedd5" },
            "speed-boost": { label: "MV", color: "#22c55e", accent: "#dcfce7" },
            "bonus-rerolls": { label: "R" + String(TOPDOWN_BALANCE.bonusRerollsAmount), color: "#06b6d4", accent: "#cffafe" },
            "random-upgrade": { label: "RD", color: "#60a5fa", accent: "#dbeafe" },
            "element-swap": { label: "SW", color: "#f472b6", accent: "#fce7f3" }
        };
        return map[itemKey] || map.upgrade;
    }

    function topdownItemCatalog() {
        return {
            "score-double": { label: "分数翻倍", description: TOPDOWN_BALANCE.itemBuffDuration + " 秒内得分翻倍。", instant: true },
            "screen-clear": { label: "全屏秒杀", description: "立刻清除场上全部敌人，精英仍会掉落强化。", instant: true },
            "clear-bullets": { label: "清弹", description: "立刻消除所有敌方子弹，并让敌人 " + TOPDOWN_BALANCE.itemBuffDuration + " 秒无法开火。", instant: true },
            "rapid-fire": { label: "射速翻倍", description: TOPDOWN_BALANCE.itemBuffDuration + " 秒内射速翻倍。", instant: true },
            "speed-boost": { label: "移速翻倍", description: TOPDOWN_BALANCE.itemBuffDuration + " 秒内移速翻倍。", instant: true },
            "bonus-rerolls": { label: "刷新补给", description: "立刻获得 " + TOPDOWN_BALANCE.bonusRerollsAmount + " 次强化刷新机会。", instant: true },
            "random-upgrade": { label: "随机增强", description: "随机获得一个当前可用且不冲突的增强。", instant: true },
            "element-swap": { label: "元素换轨", description: "从另外三种元素里选择一种切换，并保留当前元素等级；放弃则改为随机增强。", instant: false }
        };
    }

    function formatTopdownPercent(step) {
        return Math.round(Number(step || 0) * 100) + "%";
    }

    function topdownBossRelicCatalog() {
        return {
            "field-dampener": {
                label: "力场",
                shortLabel: "力场",
                description: "敌方子弹速度 -" + formatTopdownPercent(TOPDOWN_BALANCE.bossRelicEnemyBulletSpeedStep) + "。可叠加，最多 " + TOPDOWN_BALANCE.bossRelicMaxStacks + " 层。",
                maxStacks: TOPDOWN_BALANCE.bossRelicMaxStacks
            },
            "fluid-dynamics": {
                label: "流体力学装置",
                shortLabel: "流体",
                description: "敌方移速 -" + formatTopdownPercent(TOPDOWN_BALANCE.bossRelicEnemySpeedStep) + "。可叠加，最多 " + TOPDOWN_BALANCE.bossRelicMaxStacks + " 层。",
                maxStacks: TOPDOWN_BALANCE.bossRelicMaxStacks
            },
            "rate-disruptor": {
                label: "射速扰动器",
                shortLabel: "扰动",
                description: "敌方射速 -" + formatTopdownPercent(TOPDOWN_BALANCE.bossRelicEnemyFireRateStep) + "。可叠加，最多 " + TOPDOWN_BALANCE.bossRelicMaxStacks + " 层。",
                maxStacks: TOPDOWN_BALANCE.bossRelicMaxStacks
            },
            "shrink-engine": {
                label: "缩小引擎",
                shortLabel: "缩小",
                description: "每层使自身体积缩小 " + formatTopdownPercent(TOPDOWN_BALANCE.shrinkEngineScaleStep) + "。可叠加，最多 " + TOPDOWN_BALANCE.shrinkEngineMaxStacks + " 层。",
                maxStacks: TOPDOWN_BALANCE.shrinkEngineMaxStacks
            },
            "magnetic-trap": {
                label: "磁力阱",
                shortLabel: "磁阱",
                description: "每层新增 1 颗环绕子弹，接触敌人造成当前攻击力 " + TOPDOWN_BALANCE.magneticTrapDamageFactor.toFixed(1) + " 倍伤害。可叠加，最多 " + TOPDOWN_BALANCE.magneticTrapMaxStacks + " 层。",
                maxStacks: TOPDOWN_BALANCE.magneticTrapMaxStacks
            }
        };
    }

    function topdownRelicStacks(session, key) {
        return Math.max(0, Number((((session || {}).bossRelics) || {})[key] || 0));
    }

    function topdownRelicEnemySpeedMultiplier(session) {
        return Math.max(TOPDOWN_BALANCE.bossRelicEnemyMinMultiplier, 1 - topdownRelicStacks(session, "fluid-dynamics") * TOPDOWN_BALANCE.bossRelicEnemySpeedStep);
    }

    function topdownRelicEnemyBulletSpeedMultiplier(session) {
        return Math.max(TOPDOWN_BALANCE.bossRelicEnemyMinMultiplier, 1 - topdownRelicStacks(session, "field-dampener") * TOPDOWN_BALANCE.bossRelicEnemyBulletSpeedStep);
    }

    function topdownRelicEnemyFireCooldownMultiplier(session) {
        return Math.min(TOPDOWN_BALANCE.bossRelicEnemyFireCooldownMaxMultiplier, 1 + topdownRelicStacks(session, "rate-disruptor") * TOPDOWN_BALANCE.bossRelicEnemyFireRateStep);
    }

    function topdownCurrentPlayerRadius(session) {
        return Math.max(
            TOPDOWN_BALANCE.playerRadius * 0.42,
            TOPDOWN_BALANCE.playerRadius * Math.pow(1 - TOPDOWN_BALANCE.shrinkEngineScaleStep, topdownRelicStacks(session, "shrink-engine"))
        );
    }

    function topdownMagneticTrapOrbs(session) {
        const count = topdownRelicStacks(session, "magnetic-trap");
        if (count <= 0) {
            return [];
        }
        const stats = getTopdownDerivedStats(session, false);
        const spinSpeed = Math.max(1.4, (1 / Math.max(0.05, stats.fireInterval)) * TOPDOWN_BALANCE.magneticTrapSpinFactor);
        const orbitRadius = Math.max(TOPDOWN_BALANCE.magneticTrapOrbitRadius, TOPDOWN_BALANCE.wingmanOrbitRadius + 20);
        const orbRadius = TOPDOWN_BALANCE.magneticTrapBulletRadius;
        const orbs = [];
        for (let index = 0; index < count; index += 1) {
            const angle = session.tick * spinSpeed + (Math.PI * 2 / count) * index;
            orbs.push({
                x: session.player.x + Math.cos(angle) * orbitRadius,
                y: session.player.y + Math.sin(angle) * orbitRadius,
                radius: orbRadius
            });
        }
        return orbs;
    }

    function buildTopdownBossRelicChoices(session) {
        const catalog = topdownBossRelicCatalog();
        return Object.keys(catalog)
            .filter(function (key) {
                return topdownRelicStacks(session, key) < Number(catalog[key].maxStacks || TOPDOWN_BALANCE.bossRelicMaxStacks);
            })
            .sort(function () { return Math.random() - 0.5; })
            .slice(0, TOPDOWN_BALANCE.bossRelicChoiceCount)
            .map(function (key) {
                return {
                    key: key,
                    label: catalog[key].label,
                    description: catalog[key].description + " 当前 " + topdownRelicStacks(session, key) + "/" + catalog[key].maxStacks + " 层。"
                };
            });
    }

    function applyTopdownBossRelic(session, key) {
        const catalog = topdownBossRelicCatalog();
        const relic = catalog[key];
        if (!relic) {
            return false;
        }
        if (!session.bossRelics) {
            session.bossRelics = {};
        }
        const nextStacks = Math.min(Number(relic.maxStacks || TOPDOWN_BALANCE.bossRelicMaxStacks), topdownRelicStacks(session, key) + 1);
        if (nextStacks === topdownRelicStacks(session, key)) {
            return false;
        }
        session.bossRelics[key] = nextStacks;
        return true;
    }

    function topdownBossRelicSummary(session) {
        const catalog = topdownBossRelicCatalog();
        return Object.keys(catalog)
            .map(function (key) {
                const stacks = topdownRelicStacks(session, key);
                return stacks > 0 ? (catalog[key].shortLabel + " " + stacks) : "";
            })
            .filter(Boolean)
            .join(" / ") || "暂无首领装备";
    }

    function topdownBuffRemaining(session, key) {
        return Math.max(0, Number((session.itemBuffs && session.itemBuffs[key]) || 0) - session.tick);
    }

    function topdownScoreMultiplier(session) {
        return topdownBuffRemaining(session, "scoreDoubleUntil") > 0 ? 2 : 1;
    }

    function topdownCurrentComboResetWindow(session) {
        const build = (session && session.build) || {};
        return Math.max(
            TOPDOWN_BALANCE.comboResetWindowMin,
            TOPDOWN_BALANCE.comboResetWindow + Number(build.comboWindowLevel || 0) * TOPDOWN_BALANCE.comboResetWindowPerLevel
        );
    }

    function topdownCurrentComboItemEvery(session) {
        const build = (session && session.build) || {};
        return Math.max(
            TOPDOWN_BALANCE.comboItemEveryMin,
            TOPDOWN_BALANCE.comboItemEvery - Number(build.comboThresholdLevel || 0) * TOPDOWN_BALANCE.comboItemEveryStep
        );
    }

    function topdownCurrentProjectileRadius(session, owner) {
        const build = (session && session.build) || {};
        const ownerFactor = owner === "wingman" ? 0.82 : 1;
        return (TOPDOWN_BALANCE.bulletRadius + Number(build.projectileLevel || 0) * TOPDOWN_BALANCE.projectileRadiusPerLevel) * ownerFactor;
    }

    function topdownCurrentProjectileLife(session) {
        const build = (session && session.build) || {};
        return TOPDOWN_BALANCE.bulletLife + Number(build.projectileLevel || 0) * TOPDOWN_BALANCE.projectileLifePerLevel;
    }

    function topdownDifficultyScale(session) {
        const wave = Math.max(1, Number(session.wave || 1));
        const latePressure = topdownLatePressure(session);
        return 1
            + Math.pow(Math.max(0, wave - 1), 1.16) * 0.09
            + Number(session.bossesDefeated || 0) * 0.28
            + latePressure * 0.18
            + latePressure * latePressure * 0.015;
    }

    function topdownTargetEnemyCount(session) {
        const wavePressure = Math.floor(Math.pow(Math.max(1, Number(session.wave || 1)), 1.08) * TOPDOWN_BALANCE.targetEnemyPerWave);
        return Math.min(
            TOPDOWN_BALANCE.targetEnemyCap,
            TOPDOWN_BALANCE.targetEnemyBase + wavePressure + Math.floor(Number(session.bossesDefeated || 0) * 0.8) + Math.floor(topdownLatePressure(session) * 0.45)
        );
    }

    function topdownSpawnInterval(session) {
        return Math.max(
            TOPDOWN_BALANCE.spawnIntervalMin,
            TOPDOWN_BALANCE.spawnBaseInterval
                - Math.min(0.72, Math.log1p(Math.max(0, Number(session.wave || 1) - 1)) * TOPDOWN_BALANCE.spawnIntervalWaveStep)
                - Math.min(0.16, topdownLatePressure(session) * 0.012)
        );
    }

    function topdownBossShieldValue(session) {
        return TOPDOWN_BALANCE.bossShieldBase
            + Math.max(0, Number(session.wave || 1) - 1) * TOPDOWN_BALANCE.bossShieldPerWave
            + Number(session.bossesDefeated || 0) * TOPDOWN_BALANCE.bossShieldPerBoss;
    }

    function topdownHasLivingBoss(session) {
        return Array.isArray(session.enemies) && session.enemies.some(function (enemy) {
            return enemy && enemy.isBoss && enemy.hp > 0;
        });
    }

    function topdownActiveBuffSummary(session) {
        const parts = [];
        const scoreDouble = topdownBuffRemaining(session, "scoreDoubleUntil");
        const rapidFire = topdownBuffRemaining(session, "rapidFireUntil");
        const speedBoost = topdownBuffRemaining(session, "moveSpeedUntil");
        const enemySilence = topdownBuffRemaining(session, "enemySilenceUntil");
        const invincible = Math.max(0, Number((session.player && session.player.invulnerableUntil) || 0) - Number(session.tick || 0));
        if (scoreDouble > 0) {
            parts.push("2X " + scoreDouble.toFixed(0) + "s");
        }
        if (rapidFire > 0) {
            parts.push("射速+ " + rapidFire.toFixed(0) + "s");
        }
        if (speedBoost > 0) {
            parts.push("移速+ " + speedBoost.toFixed(0) + "s");
        }
        if (enemySilence > 0) {
            parts.push("哑火 " + enemySilence.toFixed(0) + "s");
        }
        if (invincible > 0) {
            parts.push("无敌 " + invincible.toFixed(0) + "s");
        }
        return parts.join(" / ") || "无";
    }

    function topdownApplySoftCap(value, cap, overflowFactor) {
        const numeric = Number(value || 0);
        if (numeric <= cap) {
            return numeric;
        }
        return cap + (numeric - cap) * Number(overflowFactor || 0.5);
    }

    function topdownLatePressure(session) {
        return Math.max(0, Number(session.wave || 1) - TOPDOWN_BALANCE.latePressureStartWave);
    }

    function topdownSkinCatalog() {
        return {
            classic: { key: "classic", label: "经典蓝", icon: "▲", fill: "#38bdf8", stroke: "#bae6fd", accent: "#67e8f9" },
            ember: { key: "ember", label: "余烬红", icon: "◆", fill: "#f97316", stroke: "#fdba74", accent: "#fb7185" },
            frost: { key: "frost", label: "冰棱白", icon: "❄", fill: "#93c5fd", stroke: "#dbeafe", accent: "#e0f2fe" },
            volt: { key: "volt", label: "电弧黄", icon: "⚡", fill: "#facc15", stroke: "#fde68a", accent: "#fef08a" },
            nuclear: { key: "nuclear", label: "核域绿", icon: "☢", fill: "#4ade80", stroke: "#bbf7d0", accent: "#86efac" },
            void: { key: "void", label: "虚空紫", icon: "✦", fill: "#8b5cf6", stroke: "#c4b5fd", accent: "#a78bfa" },
            sakura: { key: "sakura", label: "樱雾粉", icon: "✿", fill: "#f472b6", stroke: "#fbcfe8", accent: "#f9a8d4" },
            ghost: { key: "ghost", label: "幽灵银", icon: "☄", fill: "#94a3b8", stroke: "#e2e8f0", accent: "#cbd5e1" }
        };
    }

    function createTopdownMetaState() {
        return {
            points: 0,
            totalEarned: 0,
            totalSpent: 0,
            pulls: 0,
            ownedSkins: ["classic"],
            equippedSkin: "classic"
        };
    }

    function normalizeTopdownMetaState(raw) {
        const catalog = topdownSkinCatalog();
        const meta = Object.assign(createTopdownMetaState(), raw || {});
        meta.points = Math.max(0, Number(meta.points || 0));
        meta.totalEarned = Math.max(0, Number(meta.totalEarned || 0));
        meta.totalSpent = Math.max(0, Number(meta.totalSpent || 0));
        meta.pulls = Math.max(0, Number(meta.pulls || 0));
        meta.ownedSkins = Array.isArray(meta.ownedSkins) ? meta.ownedSkins.filter(function (key) {
            return Object.prototype.hasOwnProperty.call(catalog, key);
        }) : ["classic"];
        if (meta.ownedSkins.indexOf("classic") === -1) {
            meta.ownedSkins.unshift("classic");
        }
        meta.ownedSkins = meta.ownedSkins.filter(function (key, index, list) {
            return list.indexOf(key) === index;
        });
        meta.equippedSkin = meta.ownedSkins.indexOf(String(meta.equippedSkin || "")) !== -1 ? String(meta.equippedSkin) : "classic";
        return meta;
    }

    function serializeTopdownMetaState(meta) {
        return JSON.parse(JSON.stringify(normalizeTopdownMetaState(meta)));
    }

    function summarizeTopdownMetaState(meta) {
        const state = normalizeTopdownMetaState(meta);
        return {
            points: state.points,
            pulls: state.pulls,
            equipped_skin: state.equippedSkin,
            owned_skins: state.ownedSkins.length
        };
    }

    function topdownEquippedSkin(meta) {
        const catalog = topdownSkinCatalog();
        const state = normalizeTopdownMetaState(meta);
        return catalog[state.equippedSkin] || catalog.classic;
    }

    function topdownSkillCatalog() {
        return {
            blink: {
                key: "blink",
                label: "闪现",
                shortLabel: "闪现",
                description: "快速双击方向键，朝对应方向闪现一段距离，闪现期间无敌。每 60 秒可触发一次。"
            },
            missile: {
                key: "missile",
                label: "导弹矩阵",
                shortLabel: "导弹",
                description: "按 Q 发动。把场上的子弹重定向成追踪导弹，优先锁定首领和精英。每 60 秒一次。"
            },
            invincible: {
                key: "invincible",
                label: "绝对无敌",
                shortLabel: "无敌",
                description: "按 Q 发动。立刻获得 10 秒无敌时间。每 60 秒一次。"
            }
        };
    }

    function buildTopdownSkillChoices() {
        const catalog = topdownSkillCatalog();
        return Object.keys(catalog).map(function (key) {
            return {
                key: key,
                label: catalog[key].label,
                description: catalog[key].description
            };
        });
    }

    function topdownSkillCooldownRemaining(session) {
        const skill = (session && session.skill) || {};
        if (!skill.key || skill.key === "none") {
            return 0;
        }
        return Math.max(0, Number(skill.readyAt || 0) - Number(session.tick || 0));
    }

    function topdownSkillReady(session) {
        return topdownSkillCooldownRemaining(session) <= 0;
    }

    function topdownSkillSummary(session) {
        const skill = (session && session.skill) || {};
        const catalog = topdownSkillCatalog();
        if (!skill.key || skill.key === "none" || !catalog[skill.key]) {
            return "未获得";
        }
        return catalog[skill.key].shortLabel + " / " + (topdownSkillReady(session) ? "已就绪" : (topdownSkillCooldownRemaining(session).toFixed(0) + "s"));
    }

    function topdownMetaRewardAmount(session) {
        return Math.max(
            TOPDOWN_BALANCE.metaPointsBaseReward,
            Math.round(
                Number(session.score || 0) * TOPDOWN_BALANCE.metaPointsScoreRate
                + Number(session.bossesDefeated || 0) * TOPDOWN_BALANCE.metaPointsBossBonus
                + Number(session.bestCombo || 0) * TOPDOWN_BALANCE.metaPointsComboBonus
            )
        );
    }

    function awardTopdownScore(session, amount) {
        const multiplier = topdownScoreMultiplier(session);
        const finalAmount = Math.max(0, Math.round(amount * multiplier));
        session.score += finalAmount;
        return finalAmount;
    }

    function topdownComboBonus(session) {
        return Math.floor(Math.max(0, session.combo || 0) / TOPDOWN_BALANCE.comboScoreStep);
    }

    function resetTopdownCombo(session) {
        session.combo = 0;
        session.comboTimer = 0;
        session.nextItemComboAt = topdownCurrentComboItemEvery(session);
    }

    function drawTopdownStatusRing(ctx, enemy, stackCount, maxStacks, color, radiusOffset) {
        if (!stackCount || !maxStacks) {
            return;
        }
        const segments = Math.max(1, maxStacks);
        const gap = 0.12;
        const innerRadius = enemy.radius + radiusOffset - 5;
        const outerRadius = enemy.radius + radiusOffset + 3;
        for (let index = 0; index < segments; index += 1) {
            const start = -Math.PI / 2 + (Math.PI * 2 * index / segments) + gap * 0.5;
            const end = -Math.PI / 2 + (Math.PI * 2 * (index + 1) / segments) - gap * 0.5;
            ctx.beginPath();
            ctx.moveTo(enemy.x + Math.cos(start) * innerRadius, enemy.y + Math.sin(start) * innerRadius);
            ctx.arc(enemy.x, enemy.y, outerRadius, start, end);
            ctx.lineTo(enemy.x + Math.cos(end) * innerRadius, enemy.y + Math.sin(end) * innerRadius);
            ctx.arc(enemy.x, enemy.y, innerRadius, end, start, true);
            ctx.closePath();
            ctx.fillStyle = index < stackCount ? color : "rgba(71, 85, 105, 0.26)";
            ctx.fill();
            ctx.strokeStyle = "rgba(2, 6, 23, 0.72)";
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }
    }

    function getTopdownElementSwapChoices(session) {
        if (!session.build || session.build.element === "none") {
            return [];
        }
        return ["fire", "electric", "ice", "nuclear"]
            .filter(function (key) { return key !== session.build.element; })
            .map(function (key) {
                return {
                    key: key,
                    label: key === "fire" ? "火元素" : (key === "electric" ? "电元素" : (key === "ice" ? "冰元素" : "核元素")),
                    description:
                        key === "fire" ? "切到火系，命中附带燃烧。"
                            : (key === "electric" ? "切到电系，主武器改为激光连锁。"
                                : (key === "ice" ? "切到冰系，持续减速并冻结。"
                                    : "切到核系，命中形成范围爆圈。"))
                };
            });
    }

    function applyTopdownElementSwap(session, elementKey) {
        if (["fire", "electric", "ice", "nuclear"].indexOf(elementKey) === -1) {
            return false;
        }
        const currentElement = session.build.element;
        const currentLevel = currentElement === "fire"
            ? Number(session.build.fireLevel || 0)
            : (currentElement === "electric"
                ? Number(session.build.electricLevel || 0)
                : (currentElement === "ice"
                    ? Number(session.build.iceLevel || 0)
                    : Number(session.build.nuclearLevel || 0)));
        session.build.element = elementKey;
        if (elementKey === "fire") {
            session.build.fireLevel = Math.max(1, Number(session.build.fireLevel || 0), currentLevel);
        } else if (elementKey === "electric") {
            session.build.electricLevel = Math.max(1, Number(session.build.electricLevel || 0), currentLevel);
        } else if (elementKey === "ice") {
            session.build.iceLevel = Math.max(1, Number(session.build.iceLevel || 0), currentLevel);
        } else if (elementKey === "nuclear") {
            session.build.nuclearLevel = Math.max(1, Number(session.build.nuclearLevel || 0), currentLevel);
        }
        if (session.elementBurstTracker) {
            session.elementBurstTracker.playerFire = 0;
            session.elementBurstTracker.playerIce = 0;
        }
        return true;
    }

    function roundTopdownRoll(value, digits) {
        const precision = Math.pow(10, digits || 0);
        return Math.round(value * precision) / precision;
    }

    function rollTopdownBetween(min, max, digits) {
        return roundTopdownRoll(min + Math.random() * (max - min), digits || 0);
    }

    function normalizeTopdownBuild(raw) {
        return Object.assign({
            element: "none",
            fireLevel: 0,
            electricLevel: 0,
            iceLevel: 0,
            nuclearLevel: 0,
            wingmanElement: "none",
            wingmanFireLevel: 0,
            wingmanElectricLevel: 0,
            wingmanIceLevel: 0,
            wingmanNuclearLevel: 0,
            shieldCapacityLevel: 0,
            shieldCooldownLevel: 0,
            shieldRechargeLevel: 0,
            moveSpeedLevel: 0,
            moveSpeedBonus: 0,
            attackLevel: 0,
            attackBonus: 0,
            fireRateLevel: 0,
            fireRateBonus: 0,
            wingmanLevel: 0,
            multishotLevel: 0,
            projectileLevel: 0,
            comboWindowLevel: 0,
            comboThresholdLevel: 0
        }, raw || {});
    }

    function topdownBuildSummary(session) {
        const build = session.build || normalizeTopdownBuild();
        const parts = [];
        if (build.element !== "none") {
            parts.push(formatTopdownElement(build));
        }
        if (build.attackLevel || build.attackBonus) { parts.push("ATK +" + (Number(build.attackBonus || 0) + build.attackLevel * TOPDOWN_BALANCE.attackPerLevel).toFixed(1)); }
        if (build.fireRateLevel || build.fireRateBonus) { parts.push("射速 +" + Math.round((build.fireRateLevel * TOPDOWN_BALANCE.fireRateStep + Number(build.fireRateBonus || 0)) * 100) + "%"); }
        if (build.moveSpeedLevel || build.moveSpeedBonus) { parts.push("移速 +" + Math.round(build.moveSpeedLevel * TOPDOWN_BALANCE.moveSpeedPerLevel + Number(build.moveSpeedBonus || 0))); }
        if (build.wingmanLevel) { parts.push("僚机 " + build.wingmanLevel + (build.wingmanElement !== "none" ? (" [" + formatTopdownElement(build, true) + "]") : "")); }
        if (build.multishotLevel) { parts.push("弹道 " + build.multishotLevel); }
        if (build.projectileLevel) { parts.push("弹体 " + build.projectileLevel); }
        if (build.comboWindowLevel) { parts.push("续连 +" + build.comboWindowLevel); }
        if (build.comboThresholdLevel) { parts.push("连杀阈值 -" + (build.comboThresholdLevel * TOPDOWN_BALANCE.comboItemEveryStep)); }
        return parts.join(" / ") || "基础配置";
    }

    function serializeTopdownShooterSession(session) {
        syncTopdownClock(session);
        return JSON.parse(JSON.stringify(session));
    }

    function summarizeTopdownShooterSession(session) {
        syncTopdownClock(session);
        return {
            score: session.score,
            kills: session.kills,
            wave: session.wave,
            elapsed_seconds: session.elapsedSeconds,
            status: session.status,
            build: topdownBuildSummary(session),
            rerolls_remaining: session.rerollsRemaining
        };
    }

    function topdownElementName(element) {
        if (element === "fire") {
            return "火";
        }
        if (element === "electric") {
            return "电";
        }
        if (element === "nuclear") {
            return "核";
        }
        if (element === "ice") {
            return "冰";
        }
        return "未装配";
    }

    function topdownBuildElementKey(build, isWingman) {
        return isWingman ? String((build && build.wingmanElement) || "none") : String((build && build.element) || "none");
    }

    function topdownBuildElementLevel(build, isWingman, element) {
        const key = element || topdownBuildElementKey(build, isWingman);
        if (isWingman) {
            return key !== "none" && key === String((build && build.wingmanElement) || "none")
                ? Math.max(0, Number((build && build.wingmanLevel) || 0))
                : 0;
        }
        if (key === "fire") {
            return Number(build.fireLevel) || 0;
        }
        if (key === "electric") {
            return Number(build.electricLevel) || 0;
        }
        if (key === "nuclear") {
            return Number(build.nuclearLevel) || 0;
        }
        if (key === "ice") {
            return Number(build.iceLevel) || 0;
        }
        return 0;
    }

    function topdownHighestWingmanElementLevel(build) {
        return String((build && build.wingmanElement) || "none") === "none"
            ? 0
            : Math.max(0, Number((build && build.wingmanLevel) || 0));
    }

    function formatTopdownElement(build, isWingman) {
        const element = topdownBuildElementKey(build, Boolean(isWingman));
        if (!build || element === "none") {
            return isWingman ? "未装配" : "未选择";
        }
        return topdownElementName(element) + " Lv." + topdownBuildElementLevel(build, Boolean(isWingman), element);
    }

    function buildTopdownWingmanElementChoices(session) {
        const build = session.build || normalizeTopdownBuild();
        const sharedLevel = Math.max(1, Number(build.wingmanLevel || 1));
        const sharedDamageFactor = TOPDOWN_BALANCE.wingmanDamageFactor.toFixed(2) + "x";
        return ["fire", "electric", "ice", "nuclear"].map(function (key) {
            return {
                key: key,
                label: "僚机" + topdownElementName(key),
                description:
                    (build.wingmanElement === key ? "当前已装配，" : "装配后，")
                    + (key === "fire"
                        ? "僚机会改为火弹，负责灼烧、挂火层与火系范围叠层。"
                        : (key === "electric"
                            ? "僚机会改为电系激光，固定折射最近敌人，但不触发感电终极。"
                            : (key === "ice"
                                ? "僚机会改为冰弹，负责减速、冻结与冰系范围叠层。"
                                : "僚机会改为核弹小爆圈，负责范围压制，但不触发辐射终极。")))
                    + " 共享弹种等级 " + sharedLevel + "，伤害系数 " + sharedDamageFactor + "。"
            };
        });
    }

    function topdownWingmanStatusInfo(session) {
        const build = (session && session.build) || normalizeTopdownBuild();
        const count = Math.max(0, Number(build.wingmanLevel || 0));
        const element = topdownBuildElementKey(build, true);
        const bulletLevel = element === "none" ? 0 : count;
        return {
            count: count,
            element: element,
            elementLabel: formatTopdownElement(build, true),
            bulletLevel: bulletLevel,
            damageFactor: TOPDOWN_BALANCE.wingmanDamageFactor,
            aoeStacking: (element === "fire" || element === "ice") && bulletLevel > 0
        };
    }

    function topdownWingmanDetailLines(session) {
        const info = topdownWingmanStatusInfo(session);
        if (info.count <= 0) {
            return ["僚机详情：未部署"];
        }
        const lines = [
            "僚机总览：数量 " + info.count + " / 共享弹种等级 " + info.bulletLevel + " / 伤害系数 " + info.damageFactor.toFixed(2) + "x / 范围叠层 " + (info.aoeStacking ? "已装配" : "未装配")
        ];
        for (let index = 0; index < info.count; index += 1) {
            lines.push("僚机 " + (index + 1) + "：弹种 " + info.elementLabel + " / 伤害系数 " + info.damageFactor.toFixed(2) + "x");
        }
        return lines;
    }

    function syncTopdownWingmanLoadout(session) {
        const build = session && session.build;
        if (!build) {
            return;
        }
        const count = Math.max(0, Number(build.wingmanLevel || 0));
        const element = String(build.wingmanElement || "none");
        build.wingmanFireLevel = element === "fire" ? count : 0;
        build.wingmanElectricLevel = element === "electric" ? count : 0;
        build.wingmanIceLevel = element === "ice" ? count : 0;
        build.wingmanNuclearLevel = element === "nuclear" ? count : 0;
    }

    function openTopdownWingmanElementChoice(session, subtitle) {
        if (!session || !session.build || session.build.wingmanLevel <= 0) {
            return false;
        }
        session.pendingPickupChoice = {
            type: "wingman-element",
            itemKey: "wingman-element",
            title: "选择僚机弹种",
            subtitle: subtitle || "当前已获得僚机，请立刻为僚机装配一种子弹类型。",
            allowDecline: false,
            detailLines: [
                "当前僚机等级：" + Math.max(0, Number(session.build.wingmanLevel || 0)),
                "当前僚机弹种等级：" + Math.max(0, Number(session.build.wingmanLevel || 0)),
                "当前僚机伤害系数：" + TOPDOWN_BALANCE.wingmanDamageFactor.toFixed(2) + "x",
                "当前是否已装配同类元素范围叠层效果：" + (topdownWingmanStatusInfo(session).aoeStacking ? "是" : "否")
            ],
            choices: buildTopdownWingmanElementChoices(session)
        };
        return true;
    }

    function applyTopdownWingmanElementChoice(session, elementKey) {
        if (["fire", "electric", "ice", "nuclear"].indexOf(elementKey) === -1 || !session || !session.build) {
            return false;
        }
        session.build.wingmanElement = elementKey;
        if (elementKey === "fire") {
            if (session.elementBurstTracker) {
                session.elementBurstTracker.wingmanFire = 0;
            }
        } else if (elementKey === "ice") {
            if (session.elementBurstTracker) {
                session.elementBurstTracker.wingmanIce = 0;
            }
        }
        syncTopdownWingmanLoadout(session);
        return true;
    }

    function topdownAttributeLines(session) {
        const stats = getTopdownDerivedStats(session, false);
        return [
            "元素：" + formatTopdownElement(session.build),
            "僚机元素：" + (session.build.wingmanLevel > 0 ? formatTopdownElement(session.build, true) : "未部署"),
            "攻击：" + stats.damage.toFixed(1),
            "射速：" + (1 / Math.max(0.01, stats.fireInterval)).toFixed(1) + "/s",
            "移速：" + stats.moveSpeed.toFixed(0),
            "弹道：" + stats.multishot,
            "僚机：" + session.build.wingmanLevel + "/" + TOPDOWN_BALANCE.wingmanMax,
            "刷新：" + session.rerollsRemaining + "/" + TOPDOWN_BALANCE.totalRerolls,
            "下个精英还需：" + Math.max(0, session.nextEliteAt - session.kills) + " 击败"
        ];
    }

    function renderTopdownAttributeCards(session) {
        return '<div class="game-arcade-attr-grid">' + topdownAttributeCards(session).map(function (item) {
            return [
                '<div class="game-arcade-attr-card" data-tone="' + escapeHtml(item.tone || "default") + '">',
                '  <span class="game-arcade-attr-label">' + escapeHtml(item.label) + '</span>',
                '  <strong class="game-arcade-attr-value">' + escapeHtml(item.value) + '</strong>',
                "</div>"
            ].join("");
        }).join("") + "</div>";
    }

    function getTopdownDerivedStats(session, isWingman) {
        const factor = isWingman ? TOPDOWN_BALANCE.wingmanDamageFactor : 1;
        const build = session.build;
        const rapidFireMultiplier = topdownBuffRemaining(session, "rapidFireUntil") > 0 ? 0.5 : 1;
        const moveSpeedMultiplier = topdownBuffRemaining(session, "moveSpeedUntil") > 0 ? 2 : 1;
        const element = topdownBuildElementKey(build, Boolean(isWingman));
        const elementLevel = topdownBuildElementLevel(build, Boolean(isWingman), element);
        const rawMoveSpeed = (TOPDOWN_BALANCE.baseMoveSpeed + build.moveSpeedLevel * TOPDOWN_BALANCE.moveSpeedPerLevel + Number(build.moveSpeedBonus || 0)) * moveSpeedMultiplier;
        const rawFireInterval = Math.max(
            0.02,
            TOPDOWN_BALANCE.baseFireInterval * (1 - build.fireRateLevel * TOPDOWN_BALANCE.fireRateStep - Number(build.fireRateBonus || 0)) * (isWingman ? TOPDOWN_BALANCE.wingmanFireRateFactor : 1) * rapidFireMultiplier
        );
        const rawShotsPerSecond = 1 / rawFireInterval;
        const cappedShotsPerSecond = Math.min(
            TOPDOWN_BALANCE.fireRateHardCapPerSecond,
            topdownApplySoftCap(rawShotsPerSecond, TOPDOWN_BALANCE.fireRateSoftCapPerSecond, TOPDOWN_BALANCE.fireRateOverflowFactor)
        );
        const rawDamage = TOPDOWN_BALANCE.baseBulletDamage + build.attackLevel * TOPDOWN_BALANCE.attackPerLevel + Number(build.attackBonus || 0);
        return {
            moveSpeed: topdownApplySoftCap(rawMoveSpeed, TOPDOWN_BALANCE.moveSpeedSoftCap, TOPDOWN_BALANCE.moveSpeedOverflowFactor),
            fireInterval: Math.max(TOPDOWN_BALANCE.minFireInterval, 1 / Math.max(0.01, cappedShotsPerSecond)),
            damage: topdownApplySoftCap(rawDamage, TOPDOWN_BALANCE.damageSoftCap, TOPDOWN_BALANCE.damageOverflowFactor) * factor,
            multishot: Math.min(1 + build.multishotLevel, 1 + TOPDOWN_BALANCE.multishotCap),
            element: element,
            elementLevel: elementLevel,
            canUltimate: !isWingman && elementLevel >= TOPDOWN_BALANCE.elementCap
        };
    }

    function getTopdownShieldStats(session) {
        const build = session.build;
        return {
            max: TOPDOWN_BALANCE.baseShieldLayers + build.shieldCapacityLevel * TOPDOWN_BALANCE.shieldLayerPerLevel,
            rechargeDelay: Math.max(TOPDOWN_BALANCE.shieldRechargeDelayMin, TOPDOWN_BALANCE.shieldRechargeDelay - build.shieldCooldownLevel * TOPDOWN_BALANCE.shieldRechargeDelayStep),
            rechargeDuration: Math.max(TOPDOWN_BALANCE.shieldRechargeDurationMin, TOPDOWN_BALANCE.shieldRechargeDuration - build.shieldRechargeLevel * TOPDOWN_BALANCE.shieldRechargeDurationStep)
        };
    }

    function syncTopdownShieldCapacity(session) {
        const shieldStats = getTopdownShieldStats(session);
        session.shield.max = shieldStats.max;
        session.shield.current = Math.min(session.shield.current, shieldStats.max);
        return shieldStats;
    }

    function topdownElementAoeInterval(level) {
        return Math.max(TOPDOWN_BALANCE.elementAoeMinInterval, TOPDOWN_BALANCE.elementAoeBaseInterval - Math.max(0, level - 1) * TOPDOWN_BALANCE.elementAoeIntervalStep);
    }

    function topdownElementAoeRadius(element, level) {
        if (element === "fire") {
            return TOPDOWN_BALANCE.fireAoeBaseRadius + Math.max(0, level - 1) * TOPDOWN_BALANCE.fireAoeRadiusPerLevel;
        }
        return TOPDOWN_BALANCE.iceAoeBaseRadius + Math.max(0, level - 1) * TOPDOWN_BALANCE.iceAoeRadiusPerLevel;
    }

    function shouldSpawnElementAoeBullet(session, element, level, owner) {
        if (!session.elementBurstTracker || (element !== "fire" && element !== "ice") || level <= 0) {
            return false;
        }
        const trackerKey = (owner === "wingman" ? "wingman" : "player") + (element === "fire" ? "Fire" : "Ice");
        session.elementBurstTracker[trackerKey] = Number(session.elementBurstTracker[trackerKey] || 0) + 1;
        if (session.elementBurstTracker[trackerKey] < topdownElementAoeInterval(level)) {
            return false;
        }
        session.elementBurstTracker[trackerKey] = 0;
        return true;
    }

    function chooseDistinctEntries(list, count) {
        const pool = list.slice();
        const result = [];
        while (pool.length && result.length < count) {
            const index = Math.floor(Math.random() * pool.length);
            result.push(pool[index]);
            pool.splice(index, 1);
        }
        return result;
    }

    function buildTopdownUpgradeChoices(session, options) {
        const config = options || {};
        const excludeKeys = Array.isArray(config.excludeKeys) ? config.excludeKeys.map(function (key) { return String(key); }) : [];
        const fullPool = buildTopdownUpgradePool(session);
        let selected = [];
        if (excludeKeys.length) {
            selected = chooseDistinctEntries(fullPool.filter(function (entry) {
                return excludeKeys.indexOf(String(entry.key)) === -1;
            }), 3);
        }
        if (selected.length < 3) {
            const selectedKeys = selected.map(function (entry) { return String(entry.key); });
            const remainder = fullPool.filter(function (entry) {
                return selectedKeys.indexOf(String(entry.key)) === -1;
            });
            selected = selected.concat(chooseDistinctEntries(remainder, 3 - selected.length));
        }
        return selected.map(function (entry) {
            return { key: entry.key, label: entry.label, description: entry.description, meta: entry.meta || {} };
        });
    }

    function applyTopdownUpgrade(session, upgradeChoice) {
        const upgradeKey = typeof upgradeChoice === "string" ? upgradeChoice : upgradeChoice.key;
        const upgradeMeta = typeof upgradeChoice === "string" ? {} : (upgradeChoice.meta || {});
        const entry = buildTopdownUpgradePool(session).find(function (item) { return item.key === upgradeKey; });
        if (!entry) {
            return false;
        }
        entry.apply(upgradeMeta);
        syncTopdownWingmanLoadout(session);
        session.pendingUpgrade = null;
        session.player.wingmanCooldowns = session.player.wingmanCooldowns.slice(0, session.build.wingmanLevel);
        if (upgradeKey === "wingman") {
            openTopdownWingmanElementChoice(
                session,
                session.build.wingmanElement === "none"
                    ? "已获得僚机，请先为当前僚机装配一种子弹类型。"
                    : "僚机数量已提升。你可以顺手重设当前僚机的子弹类型。"
            );
        }
        return true;
    }

    function topdownEnemyHp(session) {
        const latePressure = topdownLatePressure(session);
        return TOPDOWN_BALANCE.enemyBaseHp
            + Math.pow(Math.max(1, Number(session.wave || 1)), 1.22) * TOPDOWN_BALANCE.enemyHpPerWave
            + Number(session.kills || 0) * TOPDOWN_BALANCE.enemyHpPerKill
            + Number(session.bossesDefeated || 0) * TOPDOWN_BALANCE.enemyHpPerBoss
            + latePressure * latePressure * TOPDOWN_BALANCE.lateEnemyHpPerWave;
    }

    function spawnTopdownEnemy(session) {
        if (Array.isArray(session.enemies) && session.enemies.length >= TOPDOWN_BALANCE.maxEnemiesHard) {
            return;
        }
        const side = Math.floor(Math.random() * 4);
        const spawnBoss = Number(session.elitesSinceBoss || 0) >= Number(session.nextBossEliteGoal || 5) && !topdownHasLivingBoss(session);
        const radius = spawnBoss ? TOPDOWN_BALANCE.bossRadius : (TOPDOWN_BALANCE.enemyBaseRadius + Math.random() * TOPDOWN_BALANCE.enemyRadiusVariance);
        const isElite = !spawnBoss && session.kills >= session.nextEliteAt && !session.enemies.some(function (item) { return item.isElite && !item.isBoss; });
        const difficultyScale = topdownDifficultyScale(session);
        const latePressure = topdownLatePressure(session);
        const hpMultiplier = spawnBoss ? TOPDOWN_BALANCE.bossHpMultiplier : (isElite ? TOPDOWN_BALANCE.eliteHpMultiplier : 1);
        const hp = (topdownEnemyHp(session) + randomBetween(0, Math.max(1, session.wave) * 0.9) + difficultyScale) * hpMultiplier;
        const fireRateMultiplier = spawnBoss ? TOPDOWN_BALANCE.bossFireRateMultiplier : (isElite ? TOPDOWN_BALANCE.eliteFireRateMultiplier : 1);
        const bulletCount = spawnBoss ? TOPDOWN_BALANCE.bossBulletCount : (isElite ? TOPDOWN_BALANCE.eliteBulletCount : 1);
        const bulletSpeedMultiplier = spawnBoss ? TOPDOWN_BALANCE.bossBulletSpeedMultiplier : (1 + Math.max(0, session.wave - 1) * TOPDOWN_BALANCE.eliteBulletSpeedPerWave / 100);
        const speedMultiplier = spawnBoss ? TOPDOWN_BALANCE.bossSpeedMultiplier : (isElite ? TOPDOWN_BALANCE.eliteSpeedMultiplier : 1);
        const bossShield = spawnBoss ? topdownBossShieldValue(session) : 0;
        const eliteType = spawnBoss ? "boss" : (isElite ? TOPDOWN_BALANCE.eliteTypes[Math.floor(Math.random() * TOPDOWN_BALANCE.eliteTypes.length)] : "");
        const enemySpeedFactor = topdownRelicEnemySpeedMultiplier(session);
        const enemyFireFactor = topdownRelicEnemyFireCooldownMultiplier(session);
        const enemy = {
            id: session.nextId,
            radius: radius,
            speed: (
                TOPDOWN_BALANCE.enemyBaseSpeed
                + Math.pow(Math.max(1, session.wave), 1.08) * TOPDOWN_BALANCE.enemySpeedPerWave
                + Math.random() * TOPDOWN_BALANCE.enemySpeedVariance
                + difficultyScale * 4
                + latePressure * TOPDOWN_BALANCE.lateEnemySpeedPerWave
            ) * speedMultiplier * enemySpeedFactor,
            fireCooldown: randomBetween(TOPDOWN_BALANCE.enemyFireMin, TOPDOWN_BALANCE.enemyFireMax) * fireRateMultiplier * enemyFireFactor * Math.max(0.62, 1 - latePressure * 0.012),
            hp: hp,
            maxHp: hp,
            bossShield: bossShield,
            bossShieldMax: bossShield,
            burnTime: 0,
            burnStacks: 0,
            burnDamage: 0,
            burnTick: 0,
            iceStacks: 0,
            frozenTime: 0,
            shocked: false,
            isElite: isElite || spawnBoss,
            isBoss: spawnBoss,
            bulletCount: bulletCount,
            fireRateMultiplier: fireRateMultiplier,
            bulletSpeedMultiplier: bulletSpeedMultiplier,
            eliteType: eliteType,
            dashCooldown: TOPDOWN_BALANCE.eliteDashCooldown,
            dashTime: 0,
            dashVx: 0,
            dashVy: 0,
            summonCooldown: TOPDOWN_BALANCE.eliteSummonCooldown,
            auraActive: eliteType === "buffer",
            auraTimer: eliteType === "buffer" ? TOPDOWN_BALANCE.bufferAuraOnDuration : 0,
            auraRadius: TOPDOWN_BALANCE.bufferAuraRadius,
            hasSplit: false,
            remnantActive: false,
            explodeDelay: 0,
            suicideTargetX: 0,
            suicideTargetY: 0,
            specialAttackCooldown: randomBetween(TOPDOWN_BALANCE.enemySpecialCooldownMin, TOPDOWN_BALANCE.enemySpecialCooldownMax),
            repulseCooldown: TOPDOWN_BALANCE.repulsorCooldown,
            hookCooldown: TOPDOWN_BALANCE.blackhandHookCooldown,
            touchCooldown: 0,
            consumeCooldown: 0
        };
        if (eliteType === "buffer") {
            enemy.hp *= TOPDOWN_BALANCE.bufferHpFactor;
            enemy.maxHp = enemy.hp;
            enemy.speed *= 0.74;
        } else if (eliteType === "self-destruct") {
            enemy.speed *= 0.92;
        } else if (eliteType === "splitter") {
            enemy.speed *= 1.05;
        } else if (eliteType === "repulsor") {
            enemy.speed *= 0.82;
            enemy.hp *= 1.18;
            enemy.maxHp = enemy.hp;
        } else if (eliteType === "blackhand") {
            enemy.speed *= 0.88;
            enemy.hp *= 1.12;
            enemy.maxHp = enemy.hp;
        } else if (eliteType === "nightmare") {
            enemy.speed *= 1.38;
            enemy.hp *= 0.6;
            enemy.maxHp = enemy.hp;
            enemy.radius *= 0.88;
        } else if (eliteType === "liangzi") {
            enemy.speed *= 1.04;
            enemy.hp *= 0.86;
            enemy.maxHp = enemy.hp;
        }
        session.nextId += 1;
        if (isElite) {
            session.wave += 1;
            session.nextEliteAt += TOPDOWN_BALANCE.eliteEveryKills;
            awardTopdownScore(session, TOPDOWN_BALANCE.waveBonusScore);
        }
        if (side === 0) {
            enemy.x = -TOPDOWN_BALANCE.arenaPadding;
            enemy.y = randomBetween(30, TOPDOWN_BALANCE.arenaHeight - 30);
        } else if (side === 1) {
            enemy.x = TOPDOWN_BALANCE.arenaWidth + TOPDOWN_BALANCE.arenaPadding;
            enemy.y = randomBetween(30, TOPDOWN_BALANCE.arenaHeight - 30);
        } else if (side === 2) {
            enemy.x = randomBetween(30, TOPDOWN_BALANCE.arenaWidth - 30);
            enemy.y = -TOPDOWN_BALANCE.arenaPadding;
        } else {
            enemy.x = randomBetween(30, TOPDOWN_BALANCE.arenaWidth - 30);
            enemy.y = TOPDOWN_BALANCE.arenaHeight + TOPDOWN_BALANCE.arenaPadding;
        }
        session.enemies.push(enemy);
    }

    function spawnTopdownPickup(session, x, y, kind, itemKey) {
        session.pickups.push({
            id: session.nextId,
            x: x,
            y: y,
            radius: TOPDOWN_BALANCE.pickupRadius,
            ttl: TOPDOWN_BALANCE.pickupLifetime,
            kind: kind || "upgrade",
            itemKey: itemKey || "upgrade"
        });
        session.nextId += 1;
    }

    function spawnTopdownItemPickup(session, x, y) {
        const keys = Object.keys(topdownItemCatalog());
        const itemKey = keys[Math.floor(Math.random() * keys.length)];
        spawnTopdownPickup(session, x, y, "item", itemKey);
    }

    function spawnTopdownLuckyDrop(session, x, y) {
        if (Math.random() < TOPDOWN_BALANCE.luckyDropItemWeight) {
            spawnTopdownItemPickup(session, x, y);
            return;
        }
        spawnTopdownPickup(session, x, y, "upgrade", "upgrade");
    }

    function applyTopdownRandomUpgrade(session) {
        const pool = buildTopdownUpgradePool(session);
        if (!pool.length) {
            awardTopdownScore(session, TOPDOWN_BALANCE.killScore);
            setStatus("没有可用增强，已改为补发分数。", false);
            return false;
        }
        const choice = pool[Math.floor(Math.random() * pool.length)];
        choice.apply(choice.meta || {});
        session.player.wingmanCooldowns = session.player.wingmanCooldowns.slice(0, session.build.wingmanLevel);
        setStatus("已获得随机增强：" + choice.label, false);
        return true;
    }

    function applyTopdownItemEffect(session, itemKey) {
        const item = topdownItemCatalog()[itemKey];
        if (!item) {
            return false;
        }
        if (itemKey === "score-double") {
            session.itemBuffs.scoreDoubleUntil = Math.max(session.itemBuffs.scoreDoubleUntil, session.tick + TOPDOWN_BALANCE.itemBuffDuration);
            setStatus("已获得道具：分数翻倍 " + TOPDOWN_BALANCE.itemBuffDuration + " 秒。", false);
            return true;
        }
        if (itemKey === "screen-clear") {
            session.enemies.slice().forEach(function (enemy) {
                damageTopdownEnemy(session, enemy, enemy.hp + enemy.maxHp);
            });
            session.enemies = session.enemies.filter(function (enemy) { return enemy.hp > 0; });
            setStatus("已触发全屏秒杀。", false);
            return true;
        }
        if (itemKey === "clear-bullets") {
            session.enemyBullets = [];
            session.itemBuffs.enemySilenceUntil = Math.max(Number(session.itemBuffs.enemySilenceUntil || 0), session.tick + TOPDOWN_BALANCE.itemBuffDuration);
            setStatus("已清除全部敌方子弹，敌人 " + TOPDOWN_BALANCE.itemBuffDuration + " 秒内无法开火。", false);
            return true;
        }
        if (itemKey === "rapid-fire") {
            session.itemBuffs.rapidFireUntil = Math.max(session.itemBuffs.rapidFireUntil, session.tick + TOPDOWN_BALANCE.itemBuffDuration);
            setStatus("已获得道具：射速翻倍 " + TOPDOWN_BALANCE.itemBuffDuration + " 秒。", false);
            return true;
        }
        if (itemKey === "speed-boost") {
            session.itemBuffs.moveSpeedUntil = Math.max(session.itemBuffs.moveSpeedUntil, session.tick + TOPDOWN_BALANCE.itemBuffDuration);
            setStatus("已获得道具：移速翻倍 " + TOPDOWN_BALANCE.itemBuffDuration + " 秒。", false);
            return true;
        }
        if (itemKey === "bonus-rerolls") {
            session.rerollsRemaining += TOPDOWN_BALANCE.bonusRerollsAmount;
            setStatus("已获得 " + TOPDOWN_BALANCE.bonusRerollsAmount + " 次强化刷新机会。", false);
            return true;
        }
        if (itemKey === "random-upgrade") {
            return applyTopdownRandomUpgrade(session);
        }
        if (itemKey === "element-swap") {
            const choices = getTopdownElementSwapChoices(session);
            if (!choices.length) {
                setStatus("当前没有可切换元素，已改为随机增强。", false);
                return applyTopdownRandomUpgrade(session);
            }
            session.pendingPickupChoice = {
                type: "element-swap",
                itemKey: itemKey,
                title: "元素换轨",
                subtitle: "选择一个新元素；如果放弃，将改为随机增强。",
                choices: choices
            };
            return true;
        }
        return false;
    }

    function spawnTopdownAoeBurst(session, x, y, radius) {
        session.aoeBursts.push({
            id: session.nextId,
            type: "burst",
            x: x,
            y: y,
            radius: radius,
            life: TOPDOWN_BALANCE.nuclearBurstLife
        });
        session.nextId += 1;
    }

    function spawnTopdownRadiationZone(session, x, y, radius, damage, interval) {
        session.aoeBursts.push({
            id: session.nextId,
            type: "radiation",
            x: x,
            y: y,
            radius: radius,
            life: TOPDOWN_BALANCE.nuclearRadiationDuration,
            tickInterval: Math.max(0.08, interval),
            tickLeft: Math.max(0.08, interval),
            damage: damage
        });
        session.nextId += 1;
    }

    function spawnTopdownEnemyExplosion(session, x, y, radius) {
        session.aoeBursts.push({
            id: session.nextId,
            type: "enemy-explosion",
            x: x,
            y: y,
            radius: radius,
            life: TOPDOWN_BALANCE.selfDestructBurstLife,
            hostile: true,
            hitApplied: false
        });
        session.nextId += 1;
    }

    function createTopdownBullet(session, origin, angle, damage, owner, element, elementLevel, extra) {
        const bulletExtra = extra || {};
        session.bullets.push({
            id: session.nextId,
            x: origin.x,
            y: origin.y,
            prevX: origin.x,
            prevY: origin.y,
            vx: Math.cos(angle) * TOPDOWN_BALANCE.bulletSpeed,
            vy: Math.sin(angle) * TOPDOWN_BALANCE.bulletSpeed,
            radius: topdownCurrentProjectileRadius(session, owner),
            life: topdownCurrentProjectileLife(session),
            damage: damage,
            owner: owner,
            element: element,
            elementLevel: elementLevel,
            canUltimate: bulletExtra.canUltimate !== false,
            aoeStacks: Number(bulletExtra.aoeStacks || 0),
            aoeRadius: Number(bulletExtra.aoeRadius || 0)
        });
        session.nextId += 1;
    }

    function distanceToSegmentSquared(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= 0.0001) {
            const lx = px - x1;
            const ly = py - y1;
            return lx * lx + ly * ly;
        }
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
        const cx = x1 + dx * t;
        const cy = y1 + dy * t;
        const ex = px - cx;
        const ey = py - cy;
        return ex * ex + ey * ey;
    }

    function getWingmanSlots(session) {
        const count = Math.min(session.build.wingmanLevel, TOPDOWN_BALANCE.wingmanMax);
        const result = [];
        for (let index = 0; index < count; index += 1) {
            const angle = session.tick * 1.8 + (Math.PI * 2 / Math.max(1, count)) * index;
            result.push({
                x: session.player.x + Math.cos(angle) * TOPDOWN_BALANCE.wingmanOrbitRadius,
                y: session.player.y + Math.sin(angle) * TOPDOWN_BALANCE.wingmanOrbitRadius
            });
        }
        return result;
    }

    function topdownEliteLabel(enemy) {
        if (!enemy) {
            return "";
        }
        if (enemy.isBoss) {
            return "首领";
        }
        if (enemy.remnantActive) {
            return "自爆";
        }
        if (enemy.eliteType === "dash") {
            return "突进";
        }
        if (enemy.eliteType === "sniper") {
            return "冷锋";
        }
        if (enemy.eliteType === "summoner") {
            return "召唤";
        }
        if (enemy.eliteType === "self-destruct") {
            return "自爆";
        }
        if (enemy.eliteType === "buffer") {
            return "强化";
        }
        if (enemy.eliteType === "splitter") {
            return "分裂";
        }
        if (enemy.eliteType === "repulsor") {
            return "击飞";
        }
        if (enemy.eliteType === "blackhand") {
            return "黑手";
        }
        if (enemy.eliteType === "nightmare") {
            return "噩梦";
        }
        if (enemy.eliteType === "liangzi") {
            return "良子";
        }
        return "精英";
    }

    function topdownEnemyProtectedByBuffer(session, enemy) {
        if (!enemy || enemy.remnantActive) {
            return false;
        }
        if (enemy.isElite && enemy.eliteType === "buffer" && enemy.auraActive) {
            return true;
        }
        return session.enemies.some(function (candidate) {
            return candidate
                && candidate.id !== enemy.id
                && candidate.hp > 0
                && candidate.isElite
                && candidate.eliteType === "buffer"
                && candidate.auraActive
                && !candidate.remnantActive
                && distanceBetween(candidate, enemy) <= Number(candidate.auraRadius || TOPDOWN_BALANCE.bufferAuraRadius) + enemy.radius;
        });
    }

    function topdownEnemyAuraBoost(session, enemy) {
        const boosted = session.enemies.some(function (candidate) {
            return candidate
                && candidate.id !== enemy.id
                && candidate.hp > 0
                && candidate.isElite
                && candidate.eliteType === "buffer"
                && candidate.auraActive
                && !candidate.remnantActive
                && distanceBetween(candidate, enemy) <= Number(candidate.auraRadius || TOPDOWN_BALANCE.bufferAuraRadius) + enemy.radius;
        });
        return {
            boosted: boosted,
            speedMultiplier: boosted ? TOPDOWN_BALANCE.bufferEnemySpeedMultiplier : 1,
            fireRateMultiplier: boosted ? TOPDOWN_BALANCE.bufferEnemyFireRateMultiplier : 1
        };
    }

    function topdownFindEnemyById(session, enemyId) {
        if (!enemyId) {
            return null;
        }
        for (let index = 0; index < session.enemies.length; index += 1) {
            const enemy = session.enemies[index];
            if (enemy && enemy.id === enemyId && enemy.hp > 0) {
                return enemy;
            }
        }
        return null;
    }

    function topdownAxisKnockVector(fromX, fromY, toX, toY) {
        const dx = toX - fromX;
        const dy = toY - fromY;
        if (Math.abs(dx) >= Math.abs(dy)) {
            return { x: dx >= 0 ? 1 : -1, y: 0 };
        }
        return { x: 0, y: dy >= 0 ? 1 : -1 };
    }

    function applyTopdownPlayerBlind(session, duration) {
        session.player.blindUntil = Math.max(Number(session.player.blindUntil || 0), session.tick + Math.max(0, Number(duration || 0)));
    }

    function applyTopdownPlayerKnockback(session, sourceX, sourceY, distance, speed) {
        const axis = topdownAxisKnockVector(sourceX, sourceY, session.player.x, session.player.y);
        const travelSpeed = Math.max(1, Number(speed || TOPDOWN_BALANCE.repulsorKnockSpeed));
        const travelDistance = Math.max(0, Number(distance || TOPDOWN_BALANCE.repulsorKnockDistance));
        session.player.knockbackVx = axis.x * travelSpeed;
        session.player.knockbackVy = axis.y * travelSpeed;
        session.player.controlLock = Math.max(Number(session.player.controlLock || 0), travelDistance / travelSpeed);
        session.player.pullLeft = 0;
        session.player.pullEnemyId = 0;
    }

    function applyTopdownPlayerPull(session, enemy) {
        if (!enemy) {
            return;
        }
        const distance = Math.max(1, distanceBetween(session.player, enemy));
        const duration = Math.min(1.4, distance / Math.max(1, TOPDOWN_BALANCE.blackhandPullSpeed));
        session.player.pullEnemyId = enemy.id;
        session.player.pullSpeed = TOPDOWN_BALANCE.blackhandPullSpeed;
        session.player.pullLeft = Math.max(Number(session.player.pullLeft || 0), duration);
        session.player.controlLock = Math.max(Number(session.player.controlLock || 0), duration);
        session.player.knockbackVx = 0;
        session.player.knockbackVy = 0;
    }

    function topdownNearestEnemy(session) {
        let nearest = null;
        let bestDistance = Infinity;
        (session.enemies || []).forEach(function (enemy) {
            if (!enemy || enemy.hp <= 0 || enemy.remnantActive) {
                return;
            }
            const distance = distanceBetween(session.player, enemy);
            if (distance < bestDistance) {
                bestDistance = distance;
                nearest = enemy;
            }
        });
        return nearest;
    }

    function topdownCurrentAimAngle(session, pointer) {
        if (session.fireControl === "auto") {
            const targetEnemy = topdownNearestEnemy(session);
            if (targetEnemy) {
                return Math.atan2(targetEnemy.y - session.player.y, targetEnemy.x - session.player.x);
            }
        }
        return Math.atan2(pointer.y - session.player.y, pointer.x - session.player.x);
    }

    function damageTopdownPlayer(session, amount, options) {
        const settings = Object.assign({
            ignoreInvulnerability: false,
            hitCooldown: 0.9,
            applyDamageFlash: true
        }, options || {});
        if (session.status === "over") {
            return false;
        }
        if (Number((session.player && session.player.invulnerableUntil) || 0) > Number(session.tick || 0)) {
            return false;
        }
        if (!settings.ignoreInvulnerability && Number(session.player.hitCooldown || 0) > 0) {
            return false;
        }
        const shieldStats = syncTopdownShieldCapacity(session);
        session.shield.cooldownLeft = shieldStats.rechargeDelay;
        session.shield.rechargeProgress = 0;
        session.player.hitCooldown = Math.max(0, Number(settings.hitCooldown || 0));
        if (settings.applyDamageFlash !== false) {
            session.player.damageFlash = Math.max(Number(session.player.damageFlash || 0), 0.9);
        }
        let damageLeft = Math.max(1, Math.round(Number(amount || 1)));
        while (damageLeft > 0 && session.shield.current > 0) {
            session.shield.current -= 1;
            damageLeft -= 1;
        }
        if (damageLeft <= 0) {
            return true;
        }
        session.status = "over";
        return true;
    }

    function spawnTopdownEnemyBullet(session, x, y, angle, speed, radius, extra) {
        const bullet = Object.assign({
            id: session.nextId,
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            radius: radius,
            damage: TOPDOWN_BALANCE.enemyDefaultBulletDamage,
            kind: "bullet"
        }, extra || {});
        session.enemyBullets.push(bullet);
        session.nextId += 1;
    }

    function spawnTopdownEnemyBeam(session, enemy, angle) {
        const range = TOPDOWN_BALANCE.enemyBeamRange;
        session.enemyBeams.push({
            id: session.nextId,
            fromX: enemy.x,
            fromY: enemy.y,
            toX: enemy.x + Math.cos(angle) * range,
            toY: enemy.y + Math.sin(angle) * range,
            color: enemy.isBoss ? "#f472b6" : "#fb7185",
            life: TOPDOWN_BALANCE.enemyBeamLife,
            width: enemy.isBoss ? TOPDOWN_BALANCE.enemyBeamWidth + 3 : TOPDOWN_BALANCE.enemyBeamWidth,
            damage: TOPDOWN_BALANCE.enemyDefaultBulletDamage,
            hitApplied: false
        });
        session.nextId += 1;
    }

    function spawnTopdownEnemyHook(session, enemy, angle, speed) {
        spawnTopdownEnemyBullet(session, enemy.x, enemy.y, angle, speed, 7, {
            kind: "hook",
            color: "#f472b6",
            damage: 1,
            sourceEnemyId: enemy.id
        });
    }

    function spawnTopdownEnemyRingBurst(session, enemy, bulletSpeed) {
        const count = enemy.isBoss ? TOPDOWN_BALANCE.bossRingBulletCount : TOPDOWN_BALANCE.enemyRingBulletCount;
        const speed = bulletSpeed * TOPDOWN_BALANCE.enemyRingSpeedFactor;
        const radius = enemy.isBoss ? 6.8 : 5.8;
        for (let shotIndex = 0; shotIndex < count; shotIndex += 1) {
            const angle = Math.PI * 2 * shotIndex / count;
            spawnTopdownEnemyBullet(session, enemy.x, enemy.y, angle, speed, radius, { kind: "ring", damage: 1 });
        }
    }

    function spawnTopdownEnemyBarrage(session, enemy, aimAngle, bulletSpeed) {
        const shots = enemy.isBoss ? TOPDOWN_BALANCE.bossRingBulletCount : TOPDOWN_BALANCE.enemyBarrageBulletCount;
        for (let shotIndex = 0; shotIndex < shots; shotIndex += 1) {
            const shotAngle = aimAngle + Math.PI * 2 * shotIndex / shots;
            spawnTopdownEnemyBullet(session, enemy.x, enemy.y, shotAngle, bulletSpeed * 0.92, enemy.isBoss ? 6.3 : 5.3, {
                kind: "ring",
                damage: 1
            });
        }
    }

    function trimTopdownArray(list, maxCount) {
        if (!Array.isArray(list) || list.length <= maxCount) {
            return list;
        }
        return list.slice(list.length - maxCount);
    }

    function topdownFireEnemyAttack(session, enemy, aimAngle, bulletSpeed, auraBoost) {
        const cooldownBase = randomBetween(TOPDOWN_BALANCE.enemyFireMin, TOPDOWN_BALANCE.enemyFireMax) * Math.max(0.2, Number(enemy.fireRateMultiplier || 1)) * (auraBoost && auraBoost.fireRateMultiplier ? auraBoost.fireRateMultiplier : 1);
        if (enemy.isElite && enemy.eliteType === "sniper") {
            spawnTopdownEnemyBullet(session, enemy.x, enemy.y, aimAngle, bulletSpeed, 6.2, {
                kind: "sniper",
                damage: TOPDOWN_BALANCE.eliteSniperDamage,
                color: "#fca5a5"
            });
            enemy.fireCooldown = cooldownBase * 1.18;
            return;
        }
        if (enemy.isElite && enemy.eliteType === "blackhand" && Number(enemy.hookCooldown || 0) <= 0 && distanceBetween(enemy, session.player) <= TOPDOWN_BALANCE.blackhandHookRange && Math.random() < 0.34) {
            spawnTopdownEnemyHook(session, enemy, aimAngle, TOPDOWN_BALANCE.blackhandHookSpeed * topdownRelicEnemyBulletSpeedMultiplier(session));
            enemy.hookCooldown = TOPDOWN_BALANCE.blackhandHookCooldown;
            enemy.fireCooldown = cooldownBase * 1.08;
            return;
        }
        if (enemy.isElite || enemy.isBoss) {
            const allowBeam = Number(session.wave || 1) >= TOPDOWN_BALANCE.enemySpecialAttackWave && Number(enemy.specialAttackCooldown || 0) <= 0;
            const allowRing = (enemy.isBoss || Number(session.wave || 1) >= TOPDOWN_BALANCE.enemySpecialAttackWave + 1) && Number(enemy.specialAttackCooldown || 0) <= 0;
            const roll = Math.random();
            if (allowBeam && roll < (enemy.isBoss ? 0.12 : 0.07)) {
                spawnTopdownEnemyBeam(session, enemy, aimAngle);
                enemy.specialAttackCooldown = randomBetween(TOPDOWN_BALANCE.enemySpecialCooldownMin, TOPDOWN_BALANCE.enemySpecialCooldownMax) * (enemy.isBoss ? 0.92 : 1.06);
                enemy.fireCooldown = cooldownBase * 1.22;
                return;
            }
            if (allowRing && roll < (enemy.isBoss ? 0.24 : 0.13)) {
                spawnTopdownEnemyRingBurst(session, enemy, bulletSpeed);
                enemy.specialAttackCooldown = randomBetween(TOPDOWN_BALANCE.enemySpecialCooldownMin, TOPDOWN_BALANCE.enemySpecialCooldownMax) * (enemy.isBoss ? 0.96 : 1.08);
                enemy.fireCooldown = cooldownBase * 1.28;
                return;
            }
            if (roll < (enemy.isBoss ? 0.52 : 0.32)) {
                spawnTopdownEnemyBarrage(session, enemy, aimAngle, bulletSpeed);
                enemy.fireCooldown = cooldownBase * 1.12;
                return;
            }
        }
        const shots = Math.max(1, Number(enemy.bulletCount || (enemy.isElite ? TOPDOWN_BALANCE.eliteBulletCount : 1)));
        const spreadBase = -(shots - 1) / 2;
        for (let shotIndex = 0; shotIndex < shots; shotIndex += 1) {
            const shotAngle = aimAngle + (spreadBase + shotIndex) * TOPDOWN_BALANCE.eliteBulletSpread;
            spawnTopdownEnemyBullet(
                session,
                enemy.x,
                enemy.y,
                shotAngle,
                bulletSpeed,
                enemy.isBoss ? 6.5 : (enemy.isElite ? 5.5 : 5),
                { damage: 1 }
            );
        }
        enemy.fireCooldown = cooldownBase;
    }

    function resolveTopdownLaserHit(session, origin, angle, stats, owner) {
        const endX = origin.x + Math.cos(angle) * TOPDOWN_BALANCE.electricMaxRange;
        const endY = origin.y + Math.sin(angle) * TOPDOWN_BALANCE.electricMaxRange;
        let hitEnemy = null;
        let bestDistance = TOPDOWN_BALANCE.electricMaxRange + 1;
        session.enemies.forEach(function (enemy) {
            const distSq = distanceToSegmentSquared(enemy.x, enemy.y, origin.x, origin.y, endX, endY);
            if (distSq <= (enemy.radius + 8) * (enemy.radius + 8)) {
                const direct = Math.sqrt((enemy.x - origin.x) * (enemy.x - origin.x) + (enemy.y - origin.y) * (enemy.y - origin.y));
                if (direct < bestDistance) {
                    bestDistance = direct;
                    hitEnemy = enemy;
                }
            }
        });
        const beamEndX = hitEnemy ? hitEnemy.x : endX;
        const beamEndY = hitEnemy ? hitEnemy.y : endY;
        session.beams.push({
            fromX: origin.x,
            fromY: origin.y,
            toX: beamEndX,
            toY: beamEndY,
            color: owner === "wingman" ? "#fde68a" : "#facc15",
            life: TOPDOWN_BALANCE.electricBeamLife,
            width: owner === "wingman" ? 2.2 : 3.2
        });
        if (!hitEnemy) {
            return;
        }
        const removedEnemyIds = [];
        if (damageTopdownEnemy(session, hitEnemy, applyElectricDamageModifier(hitEnemy, stats.damage, stats.canUltimate))) {
            removedEnemyIds.push(hitEnemy.id);
        }
        applyTopdownElement(session, { element: "electric", elementLevel: stats.elementLevel, damage: stats.damage, canUltimate: stats.canUltimate }, hitEnemy, removedEnemyIds);
        if (removedEnemyIds.length) {
            session.enemies = session.enemies.filter(function (enemy) {
                return removedEnemyIds.indexOf(enemy.id) === -1 && enemy.hp > 0;
            });
        }
    }

    function spawnTopdownVolley(session, origin, angle, stats, owner) {
        const count = Math.max(1, stats.multishot);
        const offsetBase = -(count - 1) / 2;
        for (let shot = 0; shot < count; shot += 1) {
            const shotAngle = angle + (offsetBase + shot) * TOPDOWN_BALANCE.multishotSpread;
            if (stats.element === "electric") {
                resolveTopdownLaserHit(session, origin, shotAngle, stats, owner);
            } else {
                const emitElementAoe = shouldSpawnElementAoeBullet(session, stats.element, stats.elementLevel, owner);
                createTopdownBullet(
                    session,
                    origin,
                    shotAngle,
                    stats.damage,
                    owner,
                    stats.element,
                    stats.elementLevel,
                    emitElementAoe ? {
                        canUltimate: stats.canUltimate,
                        aoeStacks: 1,
                        aoeRadius: topdownElementAoeRadius(stats.element, stats.elementLevel)
                    } : { canUltimate: stats.canUltimate }
                );
            }
        }
    }

    function awardTopdownEnemyKill(session, enemy) {
        if (enemy.deathHandled) {
            return;
        }
        enemy.deathHandled = true;
        session.kills += 1;
        session.combo += 1;
        session.bestCombo = Math.max(session.bestCombo, session.combo);
        session.comboTimer = topdownCurrentComboResetWindow(session);
        awardTopdownScore(session, TOPDOWN_BALANCE.killScore + topdownComboBonus(session));
        if (session.combo >= session.nextItemComboAt) {
            spawnTopdownItemPickup(session, enemy.x, enemy.y);
            session.nextItemComboAt += topdownCurrentComboItemEvery(session);
        }
        if (enemy.isElite && !enemy.isBoss) {
            session.elitesSinceBoss = Number(session.elitesSinceBoss || 0) + 1;
        }
        if (enemy.isBoss) {
            session.bossesDefeated = Number(session.bossesDefeated || 0) + 1;
            session.elitesSinceBoss = 0;
            session.nextBossEliteGoal = Math.max(1, 5 - session.bossesDefeated);
            session.wave += 1;
            awardTopdownScore(session, TOPDOWN_BALANCE.bossBonusScore);
            if (!session.skill || session.skill.key === "none") {
                session.pendingPickupChoice = {
                    type: "skill",
                    itemKey: "skill",
                    title: "战术技能选择",
                    subtitle: "每局只能带 1 个技能。首领已为你解锁本局唯一的技能栏位。",
                    detailLines: [
                        "闪现：双击方向键触发，期间无敌。",
                        "导弹 / 无敌：按 Q 主动施放，冷却 60 秒。"
                    ],
                    allowDecline: false,
                    choices: buildTopdownSkillChoices()
                };
            } else {
                const relicChoices = buildTopdownBossRelicChoices(session);
                if (relicChoices.length) {
                    session.pendingPickupChoice = {
                        type: "boss-relic",
                        itemKey: "boss-relic",
                        title: "首领装备选择",
                        subtitle: "击败首领后可从下列整局装备中选择其一。装备可叠加。",
                        detailLines: [
                            "当前装备：" + topdownBossRelicSummary(session),
                            "已拥有的首领装备会直接作用于后续所有敌人。"
                        ],
                        allowDecline: false,
                        choices: relicChoices
                    };
                } else {
                    setStatus("首领装备已全部满层，本次改为直接结算首领分数。", false);
                }
            }
        } else if (enemy.isElite) {
            spawnTopdownPickup(session, enemy.x, enemy.y, "upgrade", "upgrade");
        } else if (Math.random() < TOPDOWN_BALANCE.luckyDropChance) {
            spawnTopdownLuckyDrop(session, enemy.x, enemy.y);
        }
    }

    function spawnTopdownSplitterChildren(session, enemy) {
        const childCount = TOPDOWN_BALANCE.splitterChildCount;
        const childHp = Math.max(4, enemy.maxHp * TOPDOWN_BALANCE.splitterChildHpFactor);
        const childRadius = Math.max(9, enemy.radius * TOPDOWN_BALANCE.splitterChildRadiusFactor);
        for (let index = 0; index < childCount; index += 1) {
            const angle = (Math.PI * 2 * index / childCount) + randomBetween(-0.14, 0.14);
            session.enemies.push({
                id: session.nextId,
                x: enemy.x + Math.cos(angle) * (enemy.radius + 6),
                y: enemy.y + Math.sin(angle) * (enemy.radius + 6),
                radius: childRadius,
                speed: enemy.speed * TOPDOWN_BALANCE.splitterChildSpeedFactor,
                fireCooldown: randomBetween(TOPDOWN_BALANCE.enemyFireMin, TOPDOWN_BALANCE.enemyFireMax),
                hp: childHp,
                maxHp: childHp,
                bossShield: 0,
                bossShieldMax: 0,
                burnTime: 0,
                burnStacks: 0,
                burnDamage: 0,
                burnTick: 0,
                iceStacks: 0,
                frozenTime: 0,
                shocked: false,
                isElite: false,
                isBoss: false,
                bulletCount: 1,
                fireRateMultiplier: 1,
                bulletSpeedMultiplier: 1,
                eliteType: "",
                dashCooldown: 0,
                dashTime: 0,
                dashVx: 0,
                dashVy: 0,
                summonCooldown: 0,
                auraActive: false,
                auraTimer: 0,
                auraRadius: 0,
                hasSplit: true,
                remnantActive: false,
                explodeDelay: 0,
                suicideTargetX: 0,
                suicideTargetY: 0,
                specialAttackCooldown: randomBetween(TOPDOWN_BALANCE.enemySpecialCooldownMin, TOPDOWN_BALANCE.enemySpecialCooldownMax),
                isSplitterMinion: true
            });
            session.nextId += 1;
        }
    }

    function transformTopdownSelfDestructEnemy(session, enemy) {
        awardTopdownEnemyKill(session, enemy);
        enemy.remnantActive = true;
        enemy.isElite = false;
        enemy.isBoss = false;
        enemy.bulletCount = 0;
        enemy.fireCooldown = 999;
        enemy.specialAttackCooldown = 999;
        enemy.bossShield = 0;
        enemy.bossShieldMax = 0;
        enemy.radius = Math.max(10, enemy.radius * 0.58);
        enemy.hp = 1;
        enemy.maxHp = 1;
        enemy.speed = TOPDOWN_BALANCE.selfDestructRushSpeed;
        enemy.suicideTargetX = session.player.x;
        enemy.suicideTargetY = session.player.y;
        enemy.explodeDelay = TOPDOWN_BALANCE.selfDestructDelay;
        enemy.auraActive = false;
        enemy.auraTimer = 0;
    }

    function damageTopdownEnemy(session, enemy, amount) {
        if (!enemy || enemy.remnantActive || topdownEnemyProtectedByBuffer(session, enemy)) {
            return false;
        }
        let damageLeft = Number(amount || 0);
        if (enemy.isBoss && Number(enemy.bossShield || 0) > 0) {
            const absorbed = Math.min(Number(enemy.bossShield || 0), damageLeft);
            enemy.bossShield = Math.max(0, Number(enemy.bossShield || 0) - absorbed);
            damageLeft -= absorbed;
            if (damageLeft <= 0) {
                return false;
            }
        }
        enemy.hp -= damageLeft;
        if (enemy.isElite && enemy.eliteType === "splitter" && !enemy.hasSplit && enemy.hp <= enemy.maxHp * 0.5) {
            enemy.hasSplit = true;
            spawnTopdownSplitterChildren(session, enemy);
            spawnTopdownPickup(session, enemy.x, enemy.y, "upgrade", "upgrade");
            enemy.hp = 0;
            return false;
        }
        if (enemy.hp > 0) {
            return false;
        }
        if (enemy.eliteType === "self-destruct" && !enemy.remnantActive) {
            transformTopdownSelfDestructEnemy(session, enemy);
            return false;
        }
        awardTopdownEnemyKill(session, enemy);
        return true;
    }

    function applyElectricDamageModifier(enemy, amount, canUltimate) {
        if (canUltimate && enemy.shocked) {
            return amount * TOPDOWN_BALANCE.electricShockBonus;
        }
        return amount;
    }

    function applyTopdownElement(session, bullet, enemy, killedIds) {
        if (!enemy || enemy.remnantActive || topdownEnemyProtectedByBuffer(session, enemy)) {
            return;
        }
        if (bullet.element === "fire" && bullet.elementLevel > 0) {
            enemy.burnStacks = Math.min(TOPDOWN_BALANCE.burnStackMax, Number(enemy.burnStacks || 0) + 1);
            enemy.burnTime = Math.max(enemy.burnTime, TOPDOWN_BALANCE.burnDuration + bullet.elementLevel * 0.2);
            enemy.burnDamage = Math.max(
                enemy.burnDamage,
                TOPDOWN_BALANCE.burnDamageBase
                    + bullet.elementLevel * TOPDOWN_BALANCE.burnDamagePerLevel
                    + enemy.burnStacks * TOPDOWN_BALANCE.burnDamagePerStack
            );
            if (bullet.aoeStacks > 0 && bullet.aoeRadius > 0) {
                spawnTopdownAoeBurst(session, enemy.x, enemy.y, bullet.aoeRadius);
                session.enemies.forEach(function (target) {
                    if (target.id === enemy.id || target.remnantActive || topdownEnemyProtectedByBuffer(session, target) || distanceBetween(target, enemy) > bullet.aoeRadius + target.radius) {
                        return;
                    }
                    target.burnStacks = Math.min(TOPDOWN_BALANCE.burnStackMax, Number(target.burnStacks || 0) + bullet.aoeStacks);
                    target.burnTime = Math.max(target.burnTime, TOPDOWN_BALANCE.burnDuration + bullet.elementLevel * 0.18);
                    target.burnDamage = Math.max(
                        Number(target.burnDamage || 0),
                        TOPDOWN_BALANCE.burnDamageBase
                            + bullet.elementLevel * TOPDOWN_BALANCE.burnDamagePerLevel
                            + target.burnStacks * TOPDOWN_BALANCE.burnDamagePerStack
                    );
                });
            }
        }
        if (bullet.element === "ice" && bullet.elementLevel > 0) {
            enemy.iceStacks += 1 + Math.floor(bullet.elementLevel / 2);
            if (bullet.aoeStacks > 0 && bullet.aoeRadius > 0) {
                spawnTopdownAoeBurst(session, enemy.x, enemy.y, bullet.aoeRadius);
                session.enemies.forEach(function (target) {
                    if (target.id === enemy.id || target.remnantActive || topdownEnemyProtectedByBuffer(session, target) || distanceBetween(target, enemy) > bullet.aoeRadius + target.radius) {
                        return;
                    }
                    target.iceStacks += bullet.aoeStacks;
                    if (target.iceStacks >= TOPDOWN_BALANCE.iceFreezeStacks) {
                        target.frozenTime = Math.max(Number(target.frozenTime || 0), TOPDOWN_BALANCE.iceFreezeDuration + bullet.elementLevel * 0.08);
                        target.iceStacks = 0;
                    }
                });
            }
            if (enemy.iceStacks >= TOPDOWN_BALANCE.iceFreezeStacks) {
                enemy.frozenTime = Math.max(enemy.frozenTime, TOPDOWN_BALANCE.iceFreezeDuration + bullet.elementLevel * 0.08);
                enemy.iceStacks = 0;
                if (bullet.canUltimate && Math.random() < TOPDOWN_BALANCE.iceShatterChance) {
                    damageTopdownEnemy(session, enemy, enemy.hp + enemy.maxHp);
                    killedIds.push(enemy.id);
                }
            }
        }
        if (bullet.element === "electric" && bullet.elementLevel > 0) {
            const chains = Math.max(TOPDOWN_BALANCE.electricBaseChains, bullet.elementLevel);
            if (enemy.hp > 0 && bullet.canUltimate && Math.random() < TOPDOWN_BALANCE.electricShockChance) {
                enemy.shocked = true;
            }
            session.enemies
                .filter(function (target) {
                    return target.id !== enemy.id
                        && !target.remnantActive
                        && !topdownEnemyProtectedByBuffer(session, target)
                        && killedIds.indexOf(target.id) === -1;
                })
                .sort(function (a, b) { return distanceBetween(a, enemy) - distanceBetween(b, enemy); })
                .slice(0, chains)
                .forEach(function (target) {
                    session.beams.push({
                        fromX: enemy.x,
                        fromY: enemy.y,
                        toX: target.x,
                        toY: target.y,
                        color: "#facc15",
                        life: TOPDOWN_BALANCE.electricBeamLife,
                        width: 2 + bullet.elementLevel * 0.35
                    });
                    const chainDamage = applyElectricDamageModifier(target, bullet.damage * TOPDOWN_BALANCE.electricDamageFactor, bullet.canUltimate);
                    if (damageTopdownEnemy(session, target, chainDamage)) {
                        killedIds.push(target.id);
                    } else if (bullet.canUltimate && Math.random() < TOPDOWN_BALANCE.electricShockChance) {
                        target.shocked = true;
                    }
                });
        }
        if (bullet.element === "nuclear" && bullet.elementLevel > 0) {
            const radius = TOPDOWN_BALANCE.nuclearBaseRadius + bullet.elementLevel * TOPDOWN_BALANCE.nuclearRadiusPerLevel;
            spawnTopdownAoeBurst(session, enemy.x, enemy.y, radius);
            if (bullet.canUltimate && Math.random() < TOPDOWN_BALANCE.nuclearRadiationChance) {
                spawnTopdownRadiationZone(session, enemy.x, enemy.y, radius, bullet.damage * TOPDOWN_BALANCE.nuclearDamageFactor, getTopdownDerivedStats(session, false).fireInterval);
            }
            session.enemies.forEach(function (target) {
                if (target.id !== enemy.id && !target.remnantActive && distanceBetween(target, enemy) <= radius + target.radius) {
                    damageTopdownEnemy(session, target, bullet.damage * TOPDOWN_BALANCE.nuclearDamageFactor);
                }
            });
        }
    }

    function createTopdownShooterSession() {
        const build = normalizeTopdownBuild();
        return {
            sessionKey: "tds-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            startedAt: Date.now(),
            pausedElapsed: 0,
            elapsedSeconds: 0,
            nextId: 1,
            player: {
                x: TOPDOWN_BALANCE.arenaWidth / 2,
                y: TOPDOWN_BALANCE.arenaHeight / 2,
                radius: TOPDOWN_BALANCE.playerRadius,
                fireCooldown: 0,
                hitCooldown: 0,
                damageFlash: 0,
                wingmanCooldowns: [],
                controlLock: 0,
                knockbackVx: 0,
                knockbackVy: 0,
                blindUntil: 0,
                pullLeft: 0,
                pullEnemyId: 0,
                pullSpeed: 0,
                invulnerableUntil: 0,
                dashLeft: 0,
                dashVx: 0,
                dashVy: 0
            },
            bullets: [],
            beams: [],
            enemyBeams: [],
            aoeBursts: [],
            enemies: [],
            enemyBullets: [],
            skillProjectiles: [],
            pickups: [],
            build: build,
            score: 0,
            kills: 0,
            combo: 0,
            bestCombo: 0,
            comboTimer: 0,
            nextItemComboAt: topdownCurrentComboItemEvery({ build: build }),
            wave: 1,
            shield: {
                current: TOPDOWN_BALANCE.baseShieldLayers,
                max: TOPDOWN_BALANCE.baseShieldLayers,
                cooldownLeft: 0,
                rechargeProgress: 0
            },
            spawnClock: 0,
            tick: 0,
            status: "playing",
            submittedScore: false,
            pendingUpgrade: null,
            pendingPickupChoice: null,
            rerollsRemaining: TOPDOWN_BALANCE.totalRerolls,
            nextEliteAt: TOPDOWN_BALANCE.eliteEveryKills,
            elitesSinceBoss: 0,
            nextBossEliteGoal: 5,
            bossesDefeated: 0,
            metaRewardGranted: false,
            moveControl: "keyboard",
            fireControl: "manual",
            elementBurstTracker: {
                playerFire: 0,
                playerIce: 0,
                wingmanFire: 0,
                wingmanIce: 0
            },
            skill: {
                key: "none",
                readyAt: 0
            },
            bossRelics: {
                "field-dampener": 0,
                "fluid-dynamics": 0,
                "rate-disruptor": 0,
                "shrink-engine": 0,
                "magnetic-trap": 0
            },
            itemBuffs: {
                scoreDoubleUntil: 0,
                rapidFireUntil: 0,
                moveSpeedUntil: 0,
                enemySilenceUntil: 0
            }
        };
    }

    function normalizeTopdownShooterSession(raw) {
        if (!raw || !raw.sessionKey) {
            return createTopdownShooterSession();
        }
        const build = normalizeTopdownBuild(raw.build);
        const comboItemEvery = topdownCurrentComboItemEvery({ build: build });
        const session = {
            sessionKey: String(raw.sessionKey || ("tds-" + Date.now())),
            startedAt: Number(raw.startedAt || Date.now()),
            pausedElapsed: Number(raw.pausedElapsed || 0),
            elapsedSeconds: Number(raw.elapsedSeconds || 0),
            nextId: Number(raw.nextId || 1),
            player: Object.assign({
                x: TOPDOWN_BALANCE.arenaWidth / 2,
                y: TOPDOWN_BALANCE.arenaHeight / 2,
                radius: TOPDOWN_BALANCE.playerRadius,
                fireCooldown: 0,
                hitCooldown: 0,
                damageFlash: 0,
                wingmanCooldowns: [],
                controlLock: 0,
                knockbackVx: 0,
                knockbackVy: 0,
                blindUntil: 0,
                pullLeft: 0,
                pullEnemyId: 0,
                pullSpeed: 0,
                invulnerableUntil: 0,
                dashLeft: 0,
                dashVx: 0,
                dashVy: 0
            }, raw.player || {}),
            bullets: Array.isArray(raw.bullets) ? raw.bullets.slice() : [],
            beams: Array.isArray(raw.beams) ? raw.beams.slice() : [],
            enemyBeams: Array.isArray(raw.enemyBeams) ? raw.enemyBeams.slice() : [],
            aoeBursts: Array.isArray(raw.aoeBursts) ? raw.aoeBursts.slice() : [],
            enemies: Array.isArray(raw.enemies) ? raw.enemies.slice() : [],
            enemyBullets: Array.isArray(raw.enemyBullets) ? raw.enemyBullets.slice() : [],
            skillProjectiles: Array.isArray(raw.skillProjectiles) ? raw.skillProjectiles.slice() : [],
            pickups: Array.isArray(raw.pickups) ? raw.pickups.slice() : [],
            build: build,
            score: Number(raw.score || 0),
            kills: Number(raw.kills || 0),
            combo: Math.max(0, Number(raw.combo || 0)),
            bestCombo: Math.max(0, Number(raw.bestCombo || 0)),
            comboTimer: Math.max(0, Number(raw.comboTimer || 0)),
            nextItemComboAt: Math.max(comboItemEvery, Number(raw.nextItemComboAt || comboItemEvery)),
            wave: Math.max(1, Number(raw.wave || 1)),
            shield: Object.assign({
                current: TOPDOWN_BALANCE.baseShieldLayers,
                max: TOPDOWN_BALANCE.baseShieldLayers,
                cooldownLeft: 0,
                rechargeProgress: 0
            }, raw.shield || {}),
            spawnClock: Number(raw.spawnClock || 0),
            tick: Number(raw.tick || 0),
            status: raw.status === "over" ? "over" : (raw.status === "paused" ? "paused" : "playing"),
            submittedScore: Boolean(raw.submittedScore),
            pendingUpgrade: raw.pendingUpgrade && Array.isArray(raw.pendingUpgrade.choices) ? raw.pendingUpgrade : null,
            pendingPickupChoice: raw.pendingPickupChoice && Array.isArray(raw.pendingPickupChoice.choices) ? raw.pendingPickupChoice : null,
            rerollsRemaining: Math.max(0, Number(raw.rerollsRemaining == null ? TOPDOWN_BALANCE.totalRerolls : raw.rerollsRemaining)),
            nextEliteAt: Math.max(TOPDOWN_BALANCE.eliteEveryKills, Number(raw.nextEliteAt || TOPDOWN_BALANCE.eliteEveryKills)),
            elitesSinceBoss: Math.max(0, Number(raw.elitesSinceBoss || 0)),
            nextBossEliteGoal: Math.max(1, Number(raw.nextBossEliteGoal || Math.max(1, 5 - Number(raw.bossesDefeated || 0)))),
            bossesDefeated: Math.max(0, Number(raw.bossesDefeated || 0)),
            metaRewardGranted: Boolean(raw.metaRewardGranted),
            moveControl: raw.moveControl === "mouse" ? "mouse" : (raw.controlMode === "mouse-auto" ? "mouse" : "keyboard"),
            fireControl: raw.fireControl === "auto" ? "auto" : (raw.controlMode === "mouse-auto" ? "auto" : "manual"),
            elementBurstTracker: Object.assign({
                playerFire: 0,
                playerIce: 0,
                wingmanFire: 0,
                wingmanIce: 0
            }, raw.elementBurstTracker || {}),
            skill: Object.assign({
                key: "none",
                readyAt: 0
            }, raw.skill || {}),
            bossRelics: Object.assign({
                "field-dampener": 0,
                "fluid-dynamics": 0,
                "rate-disruptor": 0,
                "shrink-engine": 0,
                "magnetic-trap": 0
            }, raw.bossRelics || {}),
            itemBuffs: Object.assign({
                scoreDoubleUntil: 0,
                rapidFireUntil: 0,
                moveSpeedUntil: 0,
                enemySilenceUntil: 0
            }, raw.itemBuffs || {})
        };
        while (session.player.wingmanCooldowns.length < session.build.wingmanLevel) {
            session.player.wingmanCooldowns.push(0);
        }
        session.player.wingmanCooldowns = session.player.wingmanCooldowns.slice(0, session.build.wingmanLevel);
        syncTopdownShieldCapacity(session);
        session.player.radius = topdownCurrentPlayerRadius(session);
        return session;
    }

    function syncTopdownClock(session) {
        if (session.status === "playing") {
            session.elapsedSeconds = session.pausedElapsed + Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
        } else if (session.status === "paused") {
            session.elapsedSeconds = session.pausedElapsed;
        }
    }

    function topdownAttributeCards(session) {
        const stats = getTopdownDerivedStats(session, false);
        const build = session.build;
        const shieldStats = getTopdownShieldStats(session);
        const comboItemEvery = topdownCurrentComboItemEvery(session);
        const comboResetWindow = topdownCurrentComboResetWindow(session);
        return [
            { label: "元素", value: formatTopdownElement(build), tone: "element" },
            { label: "移动", value: session.moveControl === "mouse" ? "鼠标" : "键盘", tone: "buff" },
            { label: "射击", value: session.fireControl === "auto" ? "自动" : "手动", tone: "buff" },
            { label: "僚机弹种", value: build.wingmanLevel > 0 ? formatTopdownElement(build, true) : "未部署", tone: "wing" },
            { label: "攻击", value: stats.damage.toFixed(1), tone: "attack" },
            { label: "射速", value: (1 / Math.max(0.01, stats.fireInterval)).toFixed(1) + "/s", tone: "rate" },
            { label: "移速", value: stats.moveSpeed.toFixed(0), tone: "move" },
            { label: "机体", value: Math.round(topdownCurrentPlayerRadius(session) / TOPDOWN_BALANCE.playerRadius * 100) + "%", tone: "shield" },
            { label: "护盾", value: session.shield.current + "/" + shieldStats.max, tone: "shield" },
            { label: "冷却", value: session.shield.cooldownLeft > 0 ? session.shield.cooldownLeft.toFixed(1) + "s" : "就绪", tone: "shield-cd" },
            { label: "恢复", value: Math.round(session.shield.rechargeProgress * 100) + "%", tone: "shield-regen" },
            { label: "弹道", value: String(stats.multishot), tone: "multi" },
            { label: "僚机", value: build.wingmanLevel + "/" + TOPDOWN_BALANCE.wingmanMax, tone: "wing" },
            { label: "弹体", value: "Lv." + build.projectileLevel, tone: "multi" },
            { label: "续连", value: comboResetWindow.toFixed(1) + "s", tone: "combo" },
            { label: "阈值", value: comboItemEvery + " 连", tone: "item" },
            { label: "单杀分", value: String(TOPDOWN_BALANCE.killScore + topdownComboBonus(session)), tone: "score" },
            { label: "刷新", value: session.rerollsRemaining + "/" + TOPDOWN_BALANCE.totalRerolls, tone: "reroll" },
            { label: "精英", value: Math.max(0, session.nextEliteAt - session.kills) + " 击败", tone: "elite" },
            { label: "首领", value: topdownHasLivingBoss(session) ? "场上存在" : (Math.max(0, session.nextBossEliteGoal - session.elitesSinceBoss) + " 精英"), tone: "elite" },
            { label: "道具", value: Math.max(0, session.nextItemComboAt - session.combo) + " 连", tone: "item" },
            { label: "幸运掉落", value: formatTopdownPercent(TOPDOWN_BALANCE.luckyDropChance), tone: "item" }
        ];
    }

    function buildTopdownUpgradePool(session) {
        const build = session.build;
        const pool = [];

        function addUpgrade(key, label, description, apply, meta) {
            pool.push({ key: key, label: label, description: description, apply: apply, meta: meta || {} });
        }

        if ((build.element === "none" || build.element === "fire") && build.fireLevel < TOPDOWN_BALANCE.elementCap) {
            addUpgrade("fire", build.element === "fire" ? "火元素升级" : "火元素解锁", "命中附加燃烧伤害。", function () { build.element = "fire"; build.fireLevel += 1; });
        }
        if ((build.element === "none" || build.element === "electric") && build.electricLevel < TOPDOWN_BALANCE.elementCap) {
            addUpgrade("electric", build.element === "electric" ? "电元素升级" : "电元素解锁", "改为瞬时激光并继续连锁。", function () { build.element = "electric"; build.electricLevel += 1; });
        }
        if ((build.element === "none" || build.element === "ice") && build.iceLevel < TOPDOWN_BALANCE.elementCap) {
            addUpgrade("ice", build.element === "ice" ? "冰元素升级" : "冰元素解锁", "减速叠层直到冰冻。", function () { build.element = "ice"; build.iceLevel += 1; });
        }
        if ((build.element === "none" || build.element === "nuclear") && build.nuclearLevel < TOPDOWN_BALANCE.elementCap) {
            addUpgrade("nuclear", build.element === "nuclear" ? "核元素升级" : "核元素解锁", "命中后形成绿色范围爆发圈。", function () { build.element = "nuclear"; build.nuclearLevel += 1; });
        }
        if (build.moveSpeedLevel < TOPDOWN_BALANCE.statCap) {
            const moveRoll = rollTopdownBetween(TOPDOWN_BALANCE.moveSpeedRollMin, TOPDOWN_BALANCE.moveSpeedRollMax, 0);
            addUpgrade("move", "移动速度", "本次提升 +" + moveRoll + " 移速。", function (meta) {
                build.moveSpeedLevel += 1;
                build.moveSpeedBonus = Number(build.moveSpeedBonus || 0) + Number(meta.rollValue || 0);
            }, { rollValue: moveRoll });
        }
        if (build.attackLevel < TOPDOWN_BALANCE.statCap) {
            const attackRoll = rollTopdownBetween(TOPDOWN_BALANCE.attackRollMin, TOPDOWN_BALANCE.attackRollMax, 2);
            addUpgrade("attack", "攻击力", "本次提升 +" + attackRoll.toFixed(2) + " 伤害。", function (meta) {
                build.attackLevel += 1;
                build.attackBonus = Number(build.attackBonus || 0) + Number(meta.rollValue || 0);
            }, { rollValue: attackRoll });
        }
        if (build.fireRateLevel < TOPDOWN_BALANCE.statCap) {
            const fireRateRoll = rollTopdownBetween(TOPDOWN_BALANCE.fireRateRollMin, TOPDOWN_BALANCE.fireRateRollMax, 3);
            addUpgrade("fire-rate", "射速", "本次提升 +" + Math.round(fireRateRoll * 100) + "% 射速。", function (meta) {
                build.fireRateLevel += 1;
                build.fireRateBonus = Number(build.fireRateBonus || 0) + Number(meta.rollValue || 0);
            }, { rollValue: fireRateRoll });
        }
        if (build.wingmanLevel < TOPDOWN_BALANCE.wingmanMax) {
            addUpgrade("wingman", "僚机", "增加一个跟随机。", function () { build.wingmanLevel += 1; session.player.wingmanCooldowns.push(0); });
        }
        if (build.wingmanLevel > 0 && build.wingmanElement !== "fire") {
            addUpgrade("wingman-fire", "僚机改装火系", "将全部僚机改为火弹，共享当前僚机数量对应的弹种等级。", function () {
                build.wingmanElement = "fire";
                session.elementBurstTracker.wingmanFire = 0;
                syncTopdownWingmanLoadout(session);
            });
        }
        if (build.wingmanLevel > 0 && build.wingmanElement !== "electric") {
            addUpgrade("wingman-electric", "僚机改装电系", "将全部僚机改为电系激光，仍共享当前僚机数量对应的弹种等级。", function () {
                build.wingmanElement = "electric";
                syncTopdownWingmanLoadout(session);
            });
        }
        if (build.wingmanLevel > 0 && build.wingmanElement !== "ice") {
            addUpgrade("wingman-ice", "僚机改装冰系", "将全部僚机改为冰弹，仍共享当前僚机数量对应的弹种等级。", function () {
                build.wingmanElement = "ice";
                session.elementBurstTracker.wingmanIce = 0;
                syncTopdownWingmanLoadout(session);
            });
        }
        if (build.wingmanLevel > 0 && build.wingmanElement !== "nuclear") {
            addUpgrade("wingman-nuclear", "僚机改装核系", "将全部僚机改为核弹小爆圈，仍共享当前僚机数量对应的弹种等级。", function () {
                build.wingmanElement = "nuclear";
                syncTopdownWingmanLoadout(session);
            });
        }
        if (build.multishotLevel < TOPDOWN_BALANCE.multishotCap) {
            addUpgrade("multishot", "弹道", "增加齐射数量。", function () { build.multishotLevel += 1; });
        }
        if (build.projectileLevel < TOPDOWN_BALANCE.projectileCap) {
            addUpgrade("projectile", "弹体强化", "提升弹体尺寸与留场时间。", function () { build.projectileLevel += 1; });
        }
        if (build.shieldCapacityLevel < TOPDOWN_BALANCE.shieldCapacityCap) {
            addUpgrade("shield-capacity", "护盾层数", "增加 1 层最大护盾并立即补 1 层。", function () {
                build.shieldCapacityLevel += 1;
                const shieldStats = syncTopdownShieldCapacity(session);
                session.shield.current = Math.min(shieldStats.max, session.shield.current + 1);
            });
        }
        if (build.shieldCooldownLevel < TOPDOWN_BALANCE.statCap) {
            addUpgrade("shield-cooldown", "护盾冷却", "缩短护盾恢复前的等待时间。", function () { build.shieldCooldownLevel += 1; });
        }
        if (build.shieldRechargeLevel < TOPDOWN_BALANCE.statCap) {
            addUpgrade("shield-recharge", "护盾恢复", "加快每层护盾的恢复速度。", function () { build.shieldRechargeLevel += 1; });
        }
        if (build.comboWindowLevel < TOPDOWN_BALANCE.comboWindowCap) {
            addUpgrade("combo-window", "续连时间", "延长连杀中断前的可持续时间。", function () {
                build.comboWindowLevel += 1;
                session.comboTimer = Math.max(session.comboTimer, topdownCurrentComboResetWindow(session));
            });
        }
        if (build.comboThresholdLevel < TOPDOWN_BALANCE.comboThresholdCap) {
            addUpgrade("combo-threshold", "连杀阈值", "降低连杀掉落道具所需的击败数。", function () {
                build.comboThresholdLevel += 1;
                session.nextItemComboAt = Math.min(session.nextItemComboAt, session.combo + topdownCurrentComboItemEvery(session));
            });
        }
        return pool;
    }

    function mountTopdownShooter(savedPayload) {
        let session = normalizeTopdownShooterSession(savedPayload.state || {});
        let metaState = normalizeTopdownMetaState(savedPayload.metaState || {});
        const topdownHelpConfig = {
            title: "俯视射击",
            subtitle: "先稳住护盾和走位，再围绕元素方向滚出能成型的一套构筑。",
            bullets: [
                "操作：移动和射击控制现已拆分，可分别切换。WASD / 方向键负责键盘移动；鼠标模式会自动朝指针位置移动。",
                "射击可切成手动或自动：手动时按住鼠标左键或 J 开火；自动时会持续索敌并自动射击最近敌人。",
                "火会灼烧叠层并周期性打出火系范围叠层弹；电是瞬发激光并固定折射最近敌人；冰会减速叠层直到冰冻；核会生成绿色范围爆发圈。",
                "主武器满级后：火可传染燃烧，电可附加感电增伤，冰冻敌人有概率碎裂秒杀，核会概率留下持续辐射区。",
                "僚机会共享当前僚机数量对应的弹种等级，但不触发主武器的满级终极效果。",
                "首个首领必定掉技能。闪现需双击方向键；导弹矩阵和绝对无敌按 Q 发动，技能冷却 60 秒。",
                "普通小怪也有 1% 概率掉落随机补给，可能是升级球，也可能是随机道具。",
                "后期精英和首领会使用单发、散射、环形弹幕或线性光束；黑手会抓钩，噩梦会致盲，良子会吞怪回血。",
                "护盾被打空后，再吃到一次伤害就会直接结束，本局没有额外命数。"
            ],
            hint: "优先决定元素方向，再补攻击、射速、护盾、僚机和弹道。高连杀会给道具，首领会掉技能或整局装备，局外积分可用来抽取皮肤。"
        };
        const arcade = createArcadeShell(
            "俯视射击",
            "WASD 或方向键移动，鼠标瞄准，按住鼠标左键或 J 射击，P 暂停。",
            "单屏展示，右侧只保留战局属性。护盾会按冷却与进度自动恢复。"
        );
        arcade.shell.classList.add("game-arcade-shell--topdown");
        if (arcade.head) {
            arcade.head.hidden = true;
        }
        if (arcade.guideMeta) {
            arcade.guideMeta.hidden = true;
        }
        if (arcade.accentMeta) {
            arcade.accentMeta.hidden = true;
        }
        if (arcade.controlsCard) {
            arcade.controlsCard.hidden = true;
        }
        const ctx = arcade.canvas.getContext("2d");
        const arenaWidth = TOPDOWN_BALANCE.arenaWidth;
        const arenaHeight = TOPDOWN_BALANCE.arenaHeight;
        const arenaPadding = TOPDOWN_BALANCE.arenaPadding;
        const arenaPlayerMargin = TOPDOWN_BALANCE.arenaPlayerMargin;
        arcade.canvas.width = arenaWidth;
        arcade.canvas.height = arenaHeight;
        const pointer = { x: arenaWidth / 2, y: arenaHeight / 2, down: false };
        const pressed = Object.create(null);
        const blockedKeys = { Space: true, ArrowUp: true, ArrowDown: true, ArrowLeft: true, ArrowRight: true, KeyW: true, KeyA: true, KeyS: true, KeyD: true, KeyJ: true, KeyQ: true, KeyR: true, KeyP: true, Digit0: true, Digit1: true, Digit2: true, Digit3: true };
        const lastDirectionTap = {};
        let animationId = 0;
        let lastFrame = 0;
        let persistStamp = 0;
        let upgradeRects = [];
        let pickupChoiceRects = [];
        let introShownAt = Date.now();
        let introActive = true;
        let metaModal = null;

        addStageButton("重新开局", function () {
            finalizeRunRewardIfNeeded();
            finalizeScoreIfNeeded().finally(function () {
                session = createTopdownShooterSession();
                updateControlButtons();
                updateHud();
                persist();
            });
        }, true);
        addStageButton("暂停 / 继续", function () {
            togglePause();
        }, false);
        const moveControlButton = addStageButton("", function () {
            session.moveControl = session.moveControl === "mouse" ? "keyboard" : "mouse";
            pointer.down = false;
            updateControlButtons();
            updateHud();
            persist();
        }, false);
        const fireControlButton = addStageButton("", function () {
            session.fireControl = session.fireControl === "auto" ? "manual" : "auto";
            pointer.down = false;
            updateControlButtons();
            updateHud();
            persist();
        }, false);
        addStageButton("帮助", function () {
            openGameInfoOverlay(arcade.canvasWrap, topdownHelpConfig);
        }, false);
        addStageButton("局外养成", function () {
            openMetaModal();
        }, false);

        function updateControlButtons() {
            if (moveControlButton) {
                moveControlButton.textContent = session.moveControl === "mouse" ? "移动: 鼠标" : "移动: 键盘";
            }
            if (fireControlButton) {
                fireControlButton.textContent = session.fireControl === "auto" ? "射击: 自动" : "射击: 手动";
            }
        }
        updateControlButtons();

        function persistMeta() {
            scheduleGameStateSave("topdown-shooter-meta", serializeTopdownMetaState(metaState), summarizeTopdownMetaState(metaState));
        }

        function persist() {
            scheduleGameStateSave("topdown-shooter", serializeTopdownShooterSession(session), summarizeTopdownShooterSession(session));
            persistMeta();
        }

        function finalizeRunRewardIfNeeded() {
            if (session.metaRewardGranted || session.status !== "over") {
                return 0;
            }
            const reward = topdownMetaRewardAmount(session);
            session.metaRewardGranted = true;
            metaState.points += reward;
            metaState.totalEarned += reward;
            persistMeta();
            return reward;
        }

        function topdownMetaPanelHtml(message) {
            const catalog = topdownSkinCatalog();
            const cost = TOPDOWN_BALANCE.metaSkinDrawCost;
            const refundLabel = Math.round(TOPDOWN_BALANCE.metaSkinDuplicateRefundRate * 100);
            const skinCards = Object.keys(catalog).map(function (key) {
                const skin = catalog[key];
                const owned = metaState.ownedSkins.indexOf(key) !== -1;
                const equipped = metaState.equippedSkin === key;
                return [
                    '<button type="button" class="topdown-meta-skin' + (owned ? " is-owned" : "") + (equipped ? " is-equipped" : "") + '" data-topdown-equip="' + escapeHtml(key) + '"' + (owned ? "" : " disabled") + '>',
                    '  <span class="topdown-meta-skin-icon" style="--skin-fill:' + escapeHtml(skin.fill) + ';--skin-stroke:' + escapeHtml(skin.stroke) + ';">' + escapeHtml(skin.icon) + "</span>",
                    '  <span class="topdown-meta-skin-name">' + escapeHtml(skin.label) + "</span>",
                    '  <span class="topdown-meta-skin-state">' + (equipped ? "已装备" : (owned ? "已拥有" : "未解锁")) + "</span>",
                    "</button>"
                ].join("");
            }).join("");
            return [
                '<div class="games-insight-panel topdown-meta-panel">',
                '  <div class="games-section-title">积分与抽奖</div>',
                '  <div class="games-stage-meta">当前可用积分：' + escapeHtml(String(metaState.points)) + '</div>',
                '  <div class="games-stage-meta">单次抽奖：' + escapeHtml(String(cost)) + ' 积分。重复皮肤返还 ' + escapeHtml(String(refundLabel)) + '%。</div>',
                '  <div class="games-stage-meta">累计抽奖：' + escapeHtml(String(metaState.pulls)) + ' 次，累计获得：' + escapeHtml(String(metaState.totalEarned)) + ' 积分。</div>',
                '  <div class="topdown-meta-actions">',
                '    <button type="button" class="games-btn games-btn--primary" data-topdown-draw="1">抽取 1 次皮肤</button>',
                '  </div>',
                (message ? ('  <div class="games-stage-meta topdown-meta-flash">' + escapeHtml(message) + "</div>") : ""),
                "</div>",
                '<div class="games-insight-panel topdown-meta-panel topdown-meta-panel--wide">',
                '  <div class="games-section-title">皮肤仓库</div>',
                '  <div class="topdown-meta-skins">' + skinCards + "</div>",
                "</div>"
            ].join("");
        }

        function ensureMetaModal() {
            if (metaModal) {
                return metaModal;
            }
            metaModal = document.createElement("div");
            metaModal.className = "games-modal";
            metaModal.hidden = true;
            metaModal.innerHTML = [
                '<div class="games-modal-backdrop" data-topdown-meta-close="1"></div>',
                '<div class="games-modal-dialog games-modal-dialog--wide topdown-meta-dialog">',
                '  <div class="games-modal-head">',
                '    <div>',
                '      <div class="games-section-title">Topdown 局外养成</div>',
                '      <div class="games-stage-meta">抽到的皮肤可永久保留并在本地访客档案中复用。</div>',
                "    </div>",
                '    <button type="button" class="games-modal-close" data-topdown-meta-close="1">关闭</button>',
                "  </div>",
                '  <div class="games-modal-body games-modal-body--insights" data-topdown-meta-body="1"></div>',
                '  <div class="games-modal-actions">',
                '    <button type="button" class="games-btn" data-topdown-meta-close="1">关闭</button>',
                "  </div>",
                "</div>"
            ].join("");
            document.body.appendChild(metaModal);
            metaModal.addEventListener("click", function (event) {
                const target = event.target;
                if (!(target instanceof HTMLElement)) {
                    return;
                }
                if (target.hasAttribute("data-topdown-meta-close")) {
                    closeMetaModal();
                    return;
                }
                const equipKey = target.getAttribute("data-topdown-equip");
                if (equipKey) {
                    if (metaState.ownedSkins.indexOf(equipKey) !== -1) {
                        metaState.equippedSkin = equipKey;
                        persistMeta();
                        renderMetaModal("已装备皮肤：" + (topdownSkinCatalog()[equipKey] || {}).label);
                    }
                    return;
                }
                if (target.hasAttribute("data-topdown-draw")) {
                    drawTopdownSkin();
                }
            });
            return metaModal;
        }

        function renderMetaModal(message) {
            const modal = ensureMetaModal();
            const body = modal.querySelector("[data-topdown-meta-body='1']");
            if (body) {
                body.innerHTML = topdownMetaPanelHtml(message || "");
            }
        }

        function openMetaModal() {
            if (session.status === "playing" && !session.pendingUpgrade && !session.pendingPickupChoice) {
                togglePause();
            }
            const modal = ensureMetaModal();
            renderMetaModal("");
            modal.hidden = false;
        }

        function closeMetaModal() {
            if (metaModal) {
                metaModal.hidden = true;
            }
        }

        function drawTopdownSkin() {
            if (metaState.points < TOPDOWN_BALANCE.metaSkinDrawCost) {
                renderMetaModal("积分不足，当前无法抽取新皮肤。");
                return;
            }
            const pool = Object.keys(topdownSkinCatalog()).filter(function (key) { return key !== "classic"; });
            const rolledKey = pool[Math.floor(Math.random() * pool.length)];
            const skin = topdownSkinCatalog()[rolledKey];
            metaState.points -= TOPDOWN_BALANCE.metaSkinDrawCost;
            metaState.totalSpent += TOPDOWN_BALANCE.metaSkinDrawCost;
            metaState.pulls += 1;
            if (metaState.ownedSkins.indexOf(rolledKey) !== -1) {
                const refund = Math.round(TOPDOWN_BALANCE.metaSkinDrawCost * TOPDOWN_BALANCE.metaSkinDuplicateRefundRate);
                metaState.points += refund;
                persistMeta();
                renderMetaModal("重复获得 " + skin.label + "，已返还 " + refund + " 积分。");
                return;
            }
            metaState.ownedSkins.push(rolledKey);
            metaState.equippedSkin = rolledKey;
            persistMeta();
            renderMetaModal("获得新皮肤：" + skin.label + "。已自动装备。");
        }

        function updateHud() {
            syncTopdownClock(session);
            const shieldStats = syncTopdownShieldCapacity(session);
            const wingmanLines = topdownWingmanDetailLines(session);
            const activeBuffSummary = topdownActiveBuffSummary(session);
            const sideLines = [
                "状态：" + (session.status === "over" ? "已失败" : (session.status === "paused" ? "已暂停" : (session.pendingUpgrade ? "正在选强化" : (session.pendingPickupChoice ? "正在选择道具" : "战斗中")))),
                "构筑：" + topdownBuildSummary(session),
                "技能：" + topdownSkillSummary(session),
                "首领装备：" + topdownBossRelicSummary(session),
                renderTopdownAttributeCards(session),
                wingmanLines[0],
                "局外积分：" + metaState.points + " / 皮肤：" + topdownEquippedSkin(metaState).label
            ];
            if (activeBuffSummary && activeBuffSummary !== "无") {
                sideLines.push("临时增益：" + activeBuffSummary);
            }
            if (topdownBuffRemaining(session, "enemySilenceUntil") > 0) {
                sideLines.push("敌方哑火：" + topdownBuffRemaining(session, "enemySilenceUntil").toFixed(1) + " 秒");
            }
            setArcadeStats(arcade.statGrid, [
                { label: "分数", value: String(session.score) },
                { label: "击败", value: String(session.kills) },
                { label: "连杀", value: String(session.combo) },
                { label: "波次", value: String(session.wave) },
                { label: "护盾", value: session.shield.current + "/" + shieldStats.max },
                { label: "技能", value: topdownSkillReady(session) ? "就绪" : (topdownSkillCooldownRemaining(session).toFixed(0) + "s") },
                { label: "用时", value: formatSeconds(session.elapsedSeconds) }
            ]);
            setArcadeList(arcade.status, sideLines, "game-arcade-status-card");
            syncPresence(session.status === "over" ? "俯视射击 已失败" : (session.status === "paused" ? "俯视射击 已暂停" : ("俯视射击 第 " + session.wave + " 波")), "");
        }

        function togglePause() {
            if (session.status === "over" || session.pendingUpgrade || session.pendingPickupChoice) {
                return;
            }
            if (session.status === "paused") {
                session.startedAt = Date.now();
                session.status = "playing";
            } else {
                syncTopdownClock(session);
                session.pausedElapsed = session.elapsedSeconds;
                session.status = "paused";
                pointer.down = false;
            }
            persist();
        }

        function selectUpgrade(index) {
            if (!session.pendingUpgrade || !session.pendingUpgrade.choices[index]) {
                return;
            }
            if (applyTopdownUpgrade(session, session.pendingUpgrade.choices[index])) {
                persist();
            }
        }

        function resolvePendingPickupChoice(index) {
            if (!session.pendingPickupChoice) {
                return;
            }
            const choice = session.pendingPickupChoice.choices[index];
            if (!choice) {
                return;
            }
            if (session.pendingPickupChoice.type === "element-swap" && applyTopdownElementSwap(session, choice.key)) {
                setStatus("元素已切换为：" + choice.label, false);
            } else if (session.pendingPickupChoice.type === "wingman-element" && applyTopdownWingmanElementChoice(session, choice.key)) {
                setStatus("僚机已装配：" + choice.label, false);
            } else if (session.pendingPickupChoice.type === "skill" && applySkillChoice(choice.key)) {
                setStatus("已获得技能：" + choice.label, false);
            } else if (session.pendingPickupChoice.type === "boss-relic" && applyTopdownBossRelic(session, choice.key)) {
                setStatus("首领装备已装配：" + choice.label + " Lv." + topdownRelicStacks(session, choice.key), false);
            }
            session.pendingPickupChoice = null;
            persist();
        }

        function declinePendingPickupChoice() {
            if (!session.pendingPickupChoice || session.pendingPickupChoice.allowDecline === false) {
                return;
            }
            const itemKey = session.pendingPickupChoice.itemKey;
            session.pendingPickupChoice = null;
            if (itemKey === "element-swap") {
                applyTopdownRandomUpgrade(session);
            }
            persist();
        }

        function rerollUpgradeChoices() {
            if (!session.pendingUpgrade || session.rerollsRemaining <= 0 || session.pendingUpgrade.rerolled) {
                return;
            }
            const choices = buildTopdownUpgradeChoices(session);
            if (!choices.length) {
                return;
            }
            session.pendingUpgrade.choices = choices;
            session.pendingUpgrade.rerolled = true;
            session.rerollsRemaining -= 1;
            persist();
        }

        function applySkillChoice(key) {
            const skill = topdownSkillCatalog()[key];
            if (!skill) {
                return false;
            }
            session.skill.key = key;
            session.skill.readyAt = session.tick;
            return true;
        }

        function topdownSkillTargetFrom(x, y) {
            let target = null;
            let bestRank = Infinity;
            let bestDistance = Infinity;
            session.enemies.forEach(function (enemy) {
                if (!enemy || enemy.hp <= 0 || enemy.remnantActive) {
                    return;
                }
                const rank = enemy.isBoss ? 0 : (enemy.isElite ? 1 : 2);
                const distance = Math.pow(enemy.x - x, 2) + Math.pow(enemy.y - y, 2);
                if (rank < bestRank || (rank === bestRank && distance < bestDistance)) {
                    bestRank = rank;
                    bestDistance = distance;
                    target = enemy;
                }
            });
            return target;
        }

        function spawnTopdownSkillMissile(x, y, damage, targetId) {
            const target = topdownFindEnemyById(session, targetId) || topdownSkillTargetFrom(x, y);
            if (!target) {
                return false;
            }
            session.skillProjectiles.push({
                id: session.nextId,
                x: x,
                y: y,
                vx: 0,
                vy: 0,
                radius: TOPDOWN_BALANCE.missileRadius,
                damage: damage,
                targetId: target.id,
                life: 6
            });
            session.nextId += 1;
            return true;
        }

        function activateTopdownSkill() {
            if (!session.skill || !session.skill.key || session.skill.key === "none") {
                return false;
            }
            if (!topdownSkillReady(session)) {
                setStatus("技能冷却中，还需 " + topdownSkillCooldownRemaining(session).toFixed(0) + " 秒。", true);
                return false;
            }
            if (session.skill.key === "missile") {
                const playerStats = getTopdownDerivedStats(session, false);
                const sources = [];
                session.bullets.forEach(function (bullet) {
                    sources.push({ x: bullet.x, y: bullet.y, damage: Math.max(playerStats.damage * TOPDOWN_BALANCE.missileDamageFactor, Number(bullet.damage || 0) * 2) });
                });
                session.enemyBullets.forEach(function (bullet) {
                    sources.push({ x: bullet.x, y: bullet.y, damage: playerStats.damage * TOPDOWN_BALANCE.missileDamageFactor });
                });
                if (!sources.length) {
                    const nearest = topdownNearestEnemy(session);
                    if (!nearest) {
                        setStatus("场上没有可锁定目标，导弹矩阵未触发。", true);
                        return false;
                    }
                    for (let index = 0; index < 8; index += 1) {
                        sources.push({ x: session.player.x, y: session.player.y, damage: playerStats.damage * TOPDOWN_BALANCE.missileDamageFactor });
                    }
                }
                session.bullets = [];
                session.enemyBullets = [];
                session.enemyBeams = [];
                sources.slice(0, TOPDOWN_BALANCE.maxSkillProjectiles).forEach(function (source) {
                    spawnTopdownSkillMissile(source.x, source.y, source.damage, 0);
                });
                session.skill.readyAt = session.tick + TOPDOWN_BALANCE.skillCooldown;
                setStatus("已发动导弹矩阵。", false);
                return true;
            }
            if (session.skill.key === "invincible") {
                session.player.invulnerableUntil = Math.max(Number(session.player.invulnerableUntil || 0), session.tick + TOPDOWN_BALANCE.invincibleDuration);
                session.skill.readyAt = session.tick + TOPDOWN_BALANCE.skillCooldown;
                setStatus("已进入 10 秒无敌状态。", false);
                return true;
            }
            return false;
        }

        function tryBlinkSkill(code) {
            if (!session.skill || session.skill.key !== "blink" || !topdownSkillReady(session) || session.pendingUpgrade || session.pendingPickupChoice || session.status !== "playing") {
                return false;
            }
            const directionMap = {
                KeyW: { x: 0, y: -1 },
                ArrowUp: { x: 0, y: -1 },
                KeyS: { x: 0, y: 1 },
                ArrowDown: { x: 0, y: 1 },
                KeyA: { x: -1, y: 0 },
                ArrowLeft: { x: -1, y: 0 },
                KeyD: { x: 1, y: 0 },
                ArrowRight: { x: 1, y: 0 }
            };
            const direction = directionMap[code];
            if (!direction) {
                return false;
            }
            const previous = Number(lastDirectionTap[code] || 0);
            lastDirectionTap[code] = session.tick;
            if (session.tick - previous > TOPDOWN_BALANCE.blinkTapWindow) {
                return false;
            }
            session.player.dashLeft = TOPDOWN_BALANCE.blinkDuration;
            session.player.dashVx = direction.x * TOPDOWN_BALANCE.blinkDistance / TOPDOWN_BALANCE.blinkDuration;
            session.player.dashVy = direction.y * TOPDOWN_BALANCE.blinkDistance / TOPDOWN_BALANCE.blinkDuration;
            session.player.invulnerableUntil = Math.max(Number(session.player.invulnerableUntil || 0), session.tick + TOPDOWN_BALANCE.blinkDuration);
            session.player.pullLeft = 0;
            session.player.pullEnemyId = 0;
            session.player.controlLock = 0;
            session.skill.readyAt = session.tick + TOPDOWN_BALANCE.skillCooldown;
            setStatus("已触发闪现。", false);
            return true;
        }

        function maybeShoot() {
            if (session.status !== "playing" || session.pendingUpgrade || session.pendingPickupChoice || session.player.fireCooldown > 0) {
                return;
            }
            const angle = topdownCurrentAimAngle(session, pointer);
            const playerStats = getTopdownDerivedStats(session, false);
            spawnTopdownVolley(session, session.player, angle, playerStats, "player");
            session.player.fireCooldown = playerStats.fireInterval;
            getWingmanSlots(session).forEach(function (wingman, index) {
                while (session.player.wingmanCooldowns.length <= index) {
                    session.player.wingmanCooldowns.push(0);
                }
                if (session.player.wingmanCooldowns[index] > 0) {
                    return;
                }
                const wingStats = getTopdownDerivedStats(session, true);
                spawnTopdownVolley(session, wingman, angle, wingStats, "wingman");
                session.player.wingmanCooldowns[index] = wingStats.fireInterval;
            });
        }

        function finalizeScoreIfNeeded() {
            syncTopdownClock(session);
            if (session.submittedScore || session.score <= 0) {
                return Promise.resolve();
            }
            finalizeRunRewardIfNeeded();
            session.submittedScore = true;
            return submitScore("topdown-shooter", session.score, "standard", session.sessionKey, {
                mode_key: "topdown-shooter-standard",
                elapsed_seconds: session.elapsedSeconds,
                kills: session.kills,
                wave: session.wave,
                build: topdownBuildSummary(session),
                best_combo: session.bestCombo
            }).catch(function (error) {
                session.submittedScore = false;
                setStatus(error.message || "俯视射击成绩提交失败", true);
            });
        }

        function updateSession(dt) {
            session.tick += dt;
            syncTopdownClock(session);
            const shieldStats = syncTopdownShieldCapacity(session);
            session.player.radius = topdownCurrentPlayerRadius(session);
            session.enemies = (session.enemies || []).filter(function (enemy) { return enemy && enemy.hp > 0; });
            session.bullets = trimTopdownArray(session.bullets || [], TOPDOWN_BALANCE.maxPlayerBullets);
            session.enemyBullets = trimTopdownArray(session.enemyBullets || [], TOPDOWN_BALANCE.maxEnemyBullets);
            session.beams = trimTopdownArray(session.beams || [], TOPDOWN_BALANCE.maxFriendlyBeams);
            session.enemyBeams = trimTopdownArray(session.enemyBeams || [], TOPDOWN_BALANCE.maxEnemyBeams);
            session.aoeBursts = trimTopdownArray(session.aoeBursts || [], TOPDOWN_BALANCE.maxAoeBursts);
            session.skillProjectiles = trimTopdownArray(session.skillProjectiles || [], TOPDOWN_BALANCE.maxSkillProjectiles);
            session.pickups = trimTopdownArray(session.pickups || [], TOPDOWN_BALANCE.maxPickups);
            if (session.combo > 0 && session.status === "playing" && !session.pendingUpgrade && !session.pendingPickupChoice) {
                session.comboTimer = Math.max(0, session.comboTimer - dt);
                if (session.comboTimer <= 0) {
                    resetTopdownCombo(session);
                }
            }
            session.player.fireCooldown = Math.max(0, session.player.fireCooldown - dt);
            session.player.hitCooldown = Math.max(0, session.player.hitCooldown - dt);
            session.player.damageFlash = Math.max(0, Number(session.player.damageFlash || 0) - dt);
            session.player.controlLock = Math.max(0, Number(session.player.controlLock || 0) - dt);
            session.player.pullLeft = Math.max(0, Number(session.player.pullLeft || 0) - dt);
            session.player.dashLeft = Math.max(0, Number(session.player.dashLeft || 0) - dt);
            session.player.wingmanCooldowns = session.player.wingmanCooldowns.map(function (value) { return Math.max(0, value - dt); }).slice(0, session.build.wingmanLevel);
            session.beams = session.beams.filter(function (beam) { beam.life -= dt; return beam.life > 0; });
            session.enemyBeams = session.enemyBeams.filter(function (beam) { beam.life -= dt; return beam.life > 0 && !beam.hitApplied; });
            session.aoeBursts = session.aoeBursts.filter(function (burst) { burst.life -= dt; return burst.life > 0; });
            session.skillProjectiles = session.skillProjectiles.filter(function (projectile) {
                projectile.life -= dt;
                return projectile.life > 0;
            });
            session.aoeBursts.forEach(function (burst) {
                if (burst.type === "radiation") {
                    burst.tickLeft -= dt;
                    while (burst.tickLeft <= 0) {
                        burst.tickLeft += burst.tickInterval;
                        session.enemies.forEach(function (enemy) {
                            if (distanceBetween(enemy, burst) <= burst.radius + enemy.radius) {
                                damageTopdownEnemy(session, enemy, burst.damage);
                            }
                        });
                    }
                }
            });

            if (session.status !== "playing") {
                return;
            }

            if (session.shield.cooldownLeft > 0) {
                session.shield.cooldownLeft = Math.max(0, session.shield.cooldownLeft - dt);
                session.shield.rechargeProgress = 0;
            } else if (session.shield.current < shieldStats.max) {
                session.shield.rechargeProgress = Math.min(1, session.shield.rechargeProgress + dt / shieldStats.rechargeDuration);
                if (session.shield.rechargeProgress >= 1) {
                    session.shield.current += 1;
                    session.shield.rechargeProgress = 0;
                }
            }

            if (session.pendingUpgrade || session.pendingPickupChoice) {
                return;
            }

            const playerStats = getTopdownDerivedStats(session, false);
            let moveX = 0;
            let moveY = 0;
            if (session.moveControl !== "mouse") {
                if (pressed.KeyW || pressed.ArrowUp) { moveY -= 1; }
                if (pressed.KeyS || pressed.ArrowDown) { moveY += 1; }
                if (pressed.KeyA || pressed.ArrowLeft) { moveX -= 1; }
                if (pressed.KeyD || pressed.ArrowRight) { moveX += 1; }
            }
            const moveLen = Math.sqrt(moveX * moveX + moveY * moveY) || 1;
            if (session.player.pullLeft > 0) {
                const pullEnemy = topdownFindEnemyById(session, session.player.pullEnemyId);
                if (pullEnemy) {
                    const pullDx = pullEnemy.x - session.player.x;
                    const pullDy = pullEnemy.y - session.player.y;
                    const pullLen = Math.max(1, Math.sqrt(pullDx * pullDx + pullDy * pullDy));
                    session.player.x = clamp(session.player.x + pullDx / pullLen * session.player.pullSpeed * dt, arenaPlayerMargin, arenaWidth - arenaPlayerMargin);
                    session.player.y = clamp(session.player.y + pullDy / pullLen * session.player.pullSpeed * dt, arenaPlayerMargin, arenaHeight - arenaPlayerMargin);
                } else {
                    session.player.pullLeft = 0;
                    session.player.pullEnemyId = 0;
                }
            } else if (session.player.dashLeft > 0) {
                session.player.x = clamp(session.player.x + Number(session.player.dashVx || 0) * dt, arenaPlayerMargin, arenaWidth - arenaPlayerMargin);
                session.player.y = clamp(session.player.y + Number(session.player.dashVy || 0) * dt, arenaPlayerMargin, arenaHeight - arenaPlayerMargin);
                if (session.player.dashLeft <= 0.001) {
                    session.player.dashVx = 0;
                    session.player.dashVy = 0;
                }
            } else if (session.player.controlLock > 0) {
                session.player.x = clamp(session.player.x + Number(session.player.knockbackVx || 0) * dt, arenaPlayerMargin, arenaWidth - arenaPlayerMargin);
                session.player.y = clamp(session.player.y + Number(session.player.knockbackVy || 0) * dt, arenaPlayerMargin, arenaHeight - arenaPlayerMargin);
                if (session.player.controlLock <= 0.001) {
                    session.player.knockbackVx = 0;
                    session.player.knockbackVy = 0;
                }
            } else {
                session.player.knockbackVx = 0;
                session.player.knockbackVy = 0;
                if (session.moveControl === "mouse") {
                    const autoDx = pointer.x - session.player.x;
                    const autoDy = pointer.y - session.player.y;
                    const autoLen = Math.sqrt(autoDx * autoDx + autoDy * autoDy) || 0;
                    if (autoLen > 6) {
                        const travel = Math.min(autoLen, playerStats.moveSpeed * dt);
                        session.player.x = clamp(session.player.x + autoDx / autoLen * travel, arenaPlayerMargin, arenaWidth - arenaPlayerMargin);
                        session.player.y = clamp(session.player.y + autoDy / autoLen * travel, arenaPlayerMargin, arenaHeight - arenaPlayerMargin);
                    }
                } else {
                    session.player.x = clamp(session.player.x + (moveX / moveLen) * playerStats.moveSpeed * dt, arenaPlayerMargin, arenaWidth - arenaPlayerMargin);
                    session.player.y = clamp(session.player.y + (moveY / moveLen) * playerStats.moveSpeed * dt, arenaPlayerMargin, arenaHeight - arenaPlayerMargin);
                }
            }
            if ((session.fireControl === "auto" && topdownNearestEnemy(session)) || ((session.fireControl !== "auto") && (pointer.down || pressed.KeyJ))) {
                maybeShoot();
            }

            session.enemies.forEach(function (enemy) {
                enemy.magneticTrapCooldown = Math.max(0, Number(enemy.magneticTrapCooldown || 0) - dt);
            });
            topdownMagneticTrapOrbs(session).forEach(function (orb) {
                session.enemies.forEach(function (enemy) {
                    if (!enemy || enemy.hp <= 0 || Number(enemy.magneticTrapCooldown || 0) > 0) {
                        return;
                    }
                    if (distanceBetween(enemy, orb) <= enemy.radius + orb.radius) {
                        damageTopdownEnemy(session, enemy, playerStats.damage * TOPDOWN_BALANCE.magneticTrapDamageFactor);
                        enemy.magneticTrapCooldown = Math.max(0.08, playerStats.fireInterval * TOPDOWN_BALANCE.magneticTrapHitIntervalFactor);
                    }
                });
            });

            session.bullets.forEach(function (bullet) {
                bullet.prevX = bullet.x;
                bullet.prevY = bullet.y;
                bullet.x += bullet.vx * dt;
                bullet.y += bullet.vy * dt;
                bullet.life -= dt;
            });
            session.enemyBullets.forEach(function (bullet) {
                bullet.x += bullet.vx * dt;
                bullet.y += bullet.vy * dt;
            });
            session.pickups.forEach(function (pickup) {
                pickup.ttl -= dt;
            });

            session.bullets = session.bullets.filter(function (bullet) { return bullet.life > 0 && bullet.x >= -arenaPadding && bullet.x <= arenaWidth + arenaPadding && bullet.y >= -arenaPadding && bullet.y <= arenaHeight + arenaPadding; });
            session.enemyBullets = session.enemyBullets.filter(function (bullet) { return bullet.x >= -arenaPadding && bullet.x <= arenaWidth + arenaPadding && bullet.y >= -arenaPadding && bullet.y <= arenaHeight + arenaPadding; });
            session.pickups = session.pickups.filter(function (pickup) { return pickup.ttl > 0; });

            session.spawnClock += dt;
            const targetEnemies = topdownTargetEnemyCount(session);
            const spawnInterval = topdownSpawnInterval(session);
            if (session.enemies.length < targetEnemies && session.spawnClock >= spawnInterval) {
                spawnTopdownEnemy(session);
                session.spawnClock = 0;
            }

            session.enemies.forEach(function (enemy) {
                if (!enemy || enemy.hp <= 0) {
                    return;
                }
                enemy.fireCooldown -= dt;
                enemy.specialAttackCooldown = Math.max(0, Number(enemy.specialAttackCooldown || 0) - dt);
                enemy.hookCooldown = Math.max(0, Number(enemy.hookCooldown || 0) - dt);
                enemy.touchCooldown = Math.max(0, Number(enemy.touchCooldown || 0) - dt);
                enemy.consumeCooldown = Math.max(0, Number(enemy.consumeCooldown || 0) - dt);
                if (enemy.remnantActive) {
                    enemy.explodeDelay = Math.max(0, Number(enemy.explodeDelay || 0) - dt);
                    const targetDx = enemy.suicideTargetX - enemy.x;
                    const targetDy = enemy.suicideTargetY - enemy.y;
                    const targetLen = Math.max(1, Math.sqrt(targetDx * targetDx + targetDy * targetDy));
                    enemy.x += targetDx / targetLen * enemy.speed * dt;
                    enemy.y += targetDy / targetLen * enemy.speed * dt;
                    if (enemy.explodeDelay <= 0 || targetLen <= 14) {
                        spawnTopdownEnemyExplosion(session, enemy.x, enemy.y, TOPDOWN_BALANCE.selfDestructRadius);
                        enemy.hp = 0;
                    }
                    return;
                }
                if (enemy.burnTime > 0) {
                    enemy.burnTime = Math.max(0, enemy.burnTime - dt);
                    enemy.burnTick += dt;
                    while (enemy.burnTick >= TOPDOWN_BALANCE.burnTickInterval) {
                        enemy.burnTick -= TOPDOWN_BALANCE.burnTickInterval;
                        damageTopdownEnemy(session, enemy, enemy.burnDamage);
                    }
                } else {
                    enemy.burnStacks = 0;
                    enemy.burnDamage = 0;
                    enemy.burnTick = 0;
                }
                if (enemy.frozenTime > 0) {
                    enemy.frozenTime = Math.max(0, enemy.frozenTime - dt);
                }
                if (enemy.isElite && enemy.eliteType === "buffer") {
                    enemy.auraTimer = Math.max(0, Number(enemy.auraTimer || 0) - dt);
                    if (enemy.auraTimer <= 0) {
                        enemy.auraActive = !enemy.auraActive;
                        enemy.auraTimer = enemy.auraActive ? TOPDOWN_BALANCE.bufferAuraOnDuration : TOPDOWN_BALANCE.bufferAuraOffDuration;
                    }
                }
                if (enemy.isElite && enemy.eliteType === "repulsor") {
                    enemy.repulseCooldown = Math.max(0, Number(enemy.repulseCooldown || 0) - dt);
                    if (enemy.repulseCooldown <= 0 && distanceBetween(enemy, session.player) <= TOPDOWN_BALANCE.repulsorRange + session.player.radius) {
                        applyTopdownPlayerKnockback(session, enemy.x, enemy.y, TOPDOWN_BALANCE.repulsorKnockDistance, TOPDOWN_BALANCE.repulsorKnockSpeed);
                        enemy.repulseCooldown = TOPDOWN_BALANCE.repulsorCooldown;
                    }
                }
                const startX = enemy.x;
                const startY = enemy.y;
                const dx = session.player.x - enemy.x;
                const dy = session.player.y - enemy.y;
                const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                const slowFactor = enemy.frozenTime > 0 ? 0 : Math.max(0.22, 1 - Math.min(TOPDOWN_BALANCE.iceMaxSlow, enemy.iceStacks * TOPDOWN_BALANCE.iceSlowPerStack));
                const auraBoost = topdownEnemyAuraBoost(session, enemy);
                let desiredSpeed = enemy.speed * slowFactor * auraBoost.speedMultiplier;
                let fireRange = TOPDOWN_BALANCE.enemyFireRange;
                let bulletSpeed = TOPDOWN_BALANCE.enemyBulletSpeed;
                if (enemy.isElite && enemy.eliteType === "dash") {
                    enemy.dashCooldown = Math.max(0, enemy.dashCooldown - dt);
                    if (enemy.dashTime > 0) {
                        enemy.dashTime = Math.max(0, enemy.dashTime - dt);
                        enemy.x += enemy.dashVx * dt;
                        enemy.y += enemy.dashVy * dt;
                    } else {
                        if (enemy.dashCooldown <= 0 && len < 260) {
                            enemy.dashTime = TOPDOWN_BALANCE.eliteDashDuration;
                            enemy.dashCooldown = TOPDOWN_BALANCE.eliteDashCooldown;
                            enemy.dashVx = dx / len * TOPDOWN_BALANCE.eliteDashSpeed;
                            enemy.dashVy = dy / len * TOPDOWN_BALANCE.eliteDashSpeed;
                        }
                        enemy.x += dx / len * desiredSpeed * 1.18 * dt;
                        enemy.y += dy / len * desiredSpeed * 1.18 * dt;
                    }
                } else {
                    if (enemy.isElite && enemy.eliteType === "sniper") {
                        fireRange = TOPDOWN_BALANCE.eliteSniperRange;
                        bulletSpeed = TOPDOWN_BALANCE.eliteSniperBulletSpeed;
                        desiredSpeed *= len < 220 ? 0.55 : 0.88;
                    } else if (enemy.isElite && enemy.eliteType === "buffer") {
                        desiredSpeed *= enemy.auraActive ? (len < 180 ? 0.28 : 0.62) : 0.9;
                    } else if (enemy.isElite && enemy.eliteType === "splitter") {
                        desiredSpeed *= 1.06;
                    } else if (enemy.isElite && enemy.eliteType === "self-destruct") {
                        desiredSpeed *= 0.94;
                    } else if (enemy.isElite && enemy.eliteType === "blackhand") {
                        desiredSpeed *= len < 160 ? 0.72 : 0.94;
                    } else if (enemy.isElite && enemy.eliteType === "nightmare") {
                        desiredSpeed *= 1.18;
                    } else if (enemy.isElite && enemy.eliteType === "liangzi") {
                        desiredSpeed *= len < 150 ? 0.86 : 1.02;
                    }
                    enemy.x += dx / len * desiredSpeed * dt;
                    enemy.y += dy / len * desiredSpeed * dt;
                }
                if (enemy.isElite && enemy.eliteType === "liangzi" && enemy.consumeCooldown <= 0) {
                    for (let eatIndex = 0; eatIndex < session.enemies.length; eatIndex += 1) {
                        const prey = session.enemies[eatIndex];
                        if (!prey || prey.id === enemy.id || prey.hp <= 0 || prey.isBoss || prey.isElite || prey.remnantActive) {
                            continue;
                        }
                        const eatDistance = Math.pow(enemy.radius + prey.radius + 8, 2);
                        if (distanceToSegmentSquared(prey.x, prey.y, startX, startY, enemy.x, enemy.y) <= eatDistance) {
                            const hpGain = Math.max(1, Number(prey.hp || 0) * TOPDOWN_BALANCE.liangziConsumeHpFactor);
                            prey.hp = 0;
                            enemy.hp += hpGain;
                            enemy.maxHp += hpGain;
                            enemy.consumeCooldown = TOPDOWN_BALANCE.liangziConsumeCooldown;
                            break;
                        }
                    }
                }
                if (enemy.isElite && enemy.eliteType === "summoner") {
                    enemy.summonCooldown = Math.max(0, enemy.summonCooldown - dt);
                    if (enemy.summonCooldown <= 0 && session.enemies.length < TOPDOWN_BALANCE.targetEnemyCap) {
                        for (let summonIndex = 0; summonIndex < TOPDOWN_BALANCE.eliteSummonCount; summonIndex += 1) {
                            const spawnAngle = randomBetween(0, Math.PI * 2);
                            const minionHp = Math.max(3, topdownEnemyHp(session) * 0.5);
                            session.enemies.push({
                                id: session.nextId,
                                x: enemy.x + Math.cos(spawnAngle) * 34,
                                y: enemy.y + Math.sin(spawnAngle) * 34,
                                radius: 11,
                                speed: TOPDOWN_BALANCE.enemyBaseSpeed + session.wave * 4,
                                fireCooldown: randomBetween(TOPDOWN_BALANCE.enemyFireMin, TOPDOWN_BALANCE.enemyFireMax),
                                hp: minionHp,
                                maxHp: minionHp,
                                bossShield: 0,
                                bossShieldMax: 0,
                                burnTime: 0,
                                burnStacks: 0,
                                burnDamage: 0,
                                burnTick: 0,
                                iceStacks: 0,
                                frozenTime: 0,
                                shocked: false,
                                isElite: false,
                                isBoss: false,
                                bulletCount: 1,
                                fireRateMultiplier: 1,
                                bulletSpeedMultiplier: 1,
                                eliteType: "",
                                dashCooldown: 0,
                                dashTime: 0,
                                dashVx: 0,
                                dashVy: 0,
                                summonCooldown: 0,
                                auraActive: false,
                                auraTimer: 0,
                                auraRadius: 0,
                                hasSplit: false,
                                remnantActive: false,
                                explodeDelay: 0,
                                suicideTargetX: 0,
                                suicideTargetY: 0,
                                specialAttackCooldown: randomBetween(TOPDOWN_BALANCE.enemySpecialCooldownMin, TOPDOWN_BALANCE.enemySpecialCooldownMax),
                                repulseCooldown: 0,
                                hookCooldown: 0,
                                touchCooldown: 0,
                                consumeCooldown: 0
                            });
                            session.nextId += 1;
                        }
                        enemy.summonCooldown = TOPDOWN_BALANCE.eliteSummonCooldown;
                    }
                }
                if (topdownBuffRemaining(session, "enemySilenceUntil") <= 0 && enemy.fireCooldown <= 0 && len < fireRange) {
                    const aimAngle = Math.atan2(dy, dx);
                    const effectiveBulletSpeed = bulletSpeed
                        * Math.max(1, Number(enemy.bulletSpeedMultiplier || 1))
                        * topdownRelicEnemyBulletSpeedMultiplier(session);
                    topdownFireEnemyAttack(session, enemy, aimAngle, effectiveBulletSpeed, auraBoost);
                }
            });

            session.skillProjectiles = session.skillProjectiles.filter(function (projectile) {
                const target = topdownFindEnemyById(session, projectile.targetId) || topdownSkillTargetFrom(projectile.x, projectile.y);
                if (!target) {
                    return false;
                }
                projectile.targetId = target.id;
                const dx = target.x - projectile.x;
                const dy = target.y - projectile.y;
                const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                const desiredVx = dx / len * TOPDOWN_BALANCE.missileSpeed;
                const desiredVy = dy / len * TOPDOWN_BALANCE.missileSpeed;
                const steer = Math.min(1, dt * TOPDOWN_BALANCE.missileTurnRate);
                projectile.vx = Number(projectile.vx || 0) + (desiredVx - Number(projectile.vx || 0)) * steer;
                projectile.vy = Number(projectile.vy || 0) + (desiredVy - Number(projectile.vy || 0)) * steer;
                projectile.x += projectile.vx * dt;
                projectile.y += projectile.vy * dt;
                if (distanceBetween(projectile, target) <= projectile.radius + target.radius + 2) {
                    damageTopdownEnemy(session, target, projectile.damage);
                    return false;
                }
                return true;
            });

            const removedEnemyIds = [];
            const aliveBullets = [];
            session.bullets.forEach(function (bullet) {
                let hit = false;
                for (let index = 0; index < session.enemies.length; index += 1) {
                    const enemy = session.enemies[index];
                    if (removedEnemyIds.indexOf(enemy.id) !== -1) {
                        continue;
                    }
                    if (distanceBetween(bullet, enemy) <= bullet.radius + enemy.radius) {
                        hit = true;
                        if (bullet.element === "electric") {
                            session.beams.push({
                                fromX: bullet.prevX,
                                fromY: bullet.prevY,
                                toX: enemy.x,
                                toY: enemy.y,
                                color: "#fde047",
                                life: TOPDOWN_BALANCE.electricBeamLife,
                                width: 2.4 + bullet.elementLevel * 0.35
                            });
                        }
                        if (damageTopdownEnemy(session, enemy, bullet.damage)) {
                            removedEnemyIds.push(enemy.id);
                        }
                        applyTopdownElement(session, bullet, enemy, removedEnemyIds);
                        break;
                    }
                }
                if (!hit) {
                    aliveBullets.push(bullet);
                }
            });
            session.bullets = aliveBullets;
            session.enemies = session.enemies.filter(function (enemy) { return removedEnemyIds.indexOf(enemy.id) === -1 && enemy.hp > 0; });

            session.pickups = session.pickups.filter(function (pickup) {
                if (distanceBetween(pickup, session.player) <= pickup.radius + session.player.radius + 4) {
                    if (pickup.kind === "item") {
                        applyTopdownItemEffect(session, pickup.itemKey);
                    } else {
                        const choices = buildTopdownUpgradeChoices(session);
                        if (choices.length) {
                            session.pendingUpgrade = { choices: choices, rerolled: false };
                        } else {
                            awardTopdownScore(session, TOPDOWN_BALANCE.killScore);
                        }
                    }
                    return false;
                }
                return true;
            });

            if (session.player.hitCooldown <= 0 || session.player.pullLeft > 0) {
                let gotHit = false;
                const ignoreInvulnerability = session.player.pullLeft > 0;
                session.enemyBullets = session.enemyBullets.filter(function (bullet) {
                    if (!gotHit && distanceBetween(bullet, session.player) <= bullet.radius + session.player.radius) {
                        if (bullet.kind === "hook") {
                            const hookEnemy = topdownFindEnemyById(session, bullet.sourceEnemyId);
                            gotHit = damageTopdownPlayer(session, Number(bullet.damage || 1), {
                                ignoreInvulnerability: ignoreInvulnerability,
                                hitCooldown: 0
                            });
                            if (hookEnemy) {
                                applyTopdownPlayerPull(session, hookEnemy);
                            }
                            return false;
                        }
                        gotHit = damageTopdownPlayer(session, Number(bullet.damage || 1), {
                            ignoreInvulnerability: ignoreInvulnerability,
                            hitCooldown: ignoreInvulnerability ? 0 : 0.9
                        });
                        return gotHit ? false : true;
                    }
                    return true;
                });
                if (!gotHit) {
                    session.enemyBeams = session.enemyBeams.filter(function (beam) {
                        if (!gotHit && distanceToSegmentSquared(session.player.x, session.player.y, beam.fromX, beam.fromY, beam.toX, beam.toY) <= Math.pow(session.player.radius + beam.width * 0.5, 2)) {
                            gotHit = damageTopdownPlayer(session, Number(beam.damage || 1), {
                                ignoreInvulnerability: ignoreInvulnerability,
                                hitCooldown: ignoreInvulnerability ? 0 : 0.9
                            });
                            return !gotHit;
                        }
                        return true;
                    });
                }
                if (!gotHit) {
                    session.aoeBursts.forEach(function (burst) {
                        if (!gotHit && burst.hostile && !burst.hitApplied && distanceBetween(burst, session.player) <= burst.radius + session.player.radius) {
                            burst.hitApplied = true;
                            gotHit = damageTopdownPlayer(session, Number(burst.damage || 1), {
                                ignoreInvulnerability: ignoreInvulnerability,
                                hitCooldown: ignoreInvulnerability ? 0 : 0.9
                            });
                        }
                    });
                }
                if (!gotHit) {
                    session.enemies.forEach(function (enemy) {
                        if (gotHit || !enemy || enemy.hp <= 0 || enemy.remnantActive) {
                            return;
                        }
                        if (distanceBetween(enemy, session.player) > enemy.radius + session.player.radius + 2) {
                            return;
                        }
                        if (enemy.isElite && enemy.eliteType === "nightmare" && Number(enemy.touchCooldown || 0) <= 0) {
                            applyTopdownPlayerBlind(session, TOPDOWN_BALANCE.nightmareBlindDuration);
                            enemy.touchCooldown = TOPDOWN_BALANCE.nightmareTouchCooldown;
                            setStatus("噩梦缠绕命中：视野受限 5 秒。", true);
                            return;
                        }
                        gotHit = damageTopdownPlayer(session, TOPDOWN_BALANCE.enemyContactDamage, {
                            ignoreInvulnerability: ignoreInvulnerability,
                            hitCooldown: ignoreInvulnerability ? 0 : 0.9
                        });
                    });
                }
                if (session.status === "over") {
                    finalizeScoreIfNeeded();
                    persist();
                }
            }
        }

        function renderUpgradeOverlay() {
            upgradeRects = [];
            if (!session.pendingUpgrade || !session.pendingUpgrade.choices.length) {
                return;
            }
            ctx.fillStyle = "rgba(2, 6, 23, 0.78)";
            ctx.fillRect(0, 0, arenaWidth, arenaHeight);
            ctx.textAlign = "center";
            ctx.fillStyle = "#f8fafc";
            ctx.font = "700 28px Segoe UI";
            ctx.fillText("选择强化", arenaWidth / 2, 116);
            ctx.font = "500 16px Segoe UI";
            ctx.fillStyle = "#cbd5e1";
            ctx.fillText("按 1 / 2 / 3 或直接点击卡片", arenaWidth / 2, 146);
            ctx.fillText("当前剩余刷新 " + session.rerollsRemaining + " 次，本轮" + (session.pendingUpgrade.rerolled ? "已使用刷新" : "可按 R 刷新一次"), arenaWidth / 2, 172);
            session.pendingUpgrade.choices.forEach(function (choice, index) {
                const box = { x: 90 + index * 260, y: 196, w: 240, h: 176 };
                upgradeRects.push(box);
                ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
                ctx.strokeStyle = "#38bdf8";
                ctx.lineWidth = 2;
                ctx.fillRect(box.x, box.y, box.w, box.h);
                ctx.strokeRect(box.x, box.y, box.w, box.h);
                ctx.fillStyle = "#38bdf8";
                ctx.font = "700 18px Segoe UI";
                ctx.fillText(String(index + 1), box.x + 26, box.y + 28);
                ctx.fillStyle = "#f8fafc";
                ctx.textAlign = "left";
                ctx.font = "700 20px Segoe UI";
                ctx.fillText(choice.label, box.x + 18, box.y + 54);
                ctx.fillStyle = "#cbd5e1";
                ctx.font = "500 15px Segoe UI";
                const chars = choice.description.split("");
                let line = "";
                let lineIndex = 0;
                chars.forEach(function (char, charIndex) {
                    const attempt = line + char;
                    if (ctx.measureText(attempt).width > box.w - 36 || charIndex === chars.length - 1) {
                        const text = charIndex === chars.length - 1 ? attempt : line;
                        ctx.fillText(text, box.x + 18, box.y + 92 + lineIndex * 24);
                        lineIndex += 1;
                        line = charIndex === chars.length - 1 ? "" : char;
                    } else {
                        line = attempt;
                    }
                });
                ctx.textAlign = "center";
            });
            if (!session.pendingUpgrade.rerolled && session.rerollsRemaining > 0) {
                const rerollBox = { x: arenaWidth / 2 - 110, y: arenaHeight - 84, w: 220, h: 44, action: "reroll" };
                upgradeRects.push(rerollBox);
                ctx.fillStyle = "rgba(15, 23, 42, 0.92)";
                ctx.strokeStyle = "#facc15";
                ctx.lineWidth = 2;
                ctx.fillRect(rerollBox.x, rerollBox.y, rerollBox.w, rerollBox.h);
                ctx.strokeRect(rerollBox.x, rerollBox.y, rerollBox.w, rerollBox.h);
                ctx.fillStyle = "#facc15";
                ctx.font = "700 18px Segoe UI";
                ctx.fillText("R 刷新本轮强化", rerollBox.x + rerollBox.w / 2, rerollBox.y + 28);
            }
        }

        function renderPickupChoiceOverlay() {
            pickupChoiceRects = [];
            if (!session.pendingPickupChoice || !session.pendingPickupChoice.choices.length) {
                return;
            }
            const detailLines = Array.isArray(session.pendingPickupChoice.detailLines) ? session.pendingPickupChoice.detailLines : [];
            const detailBlockHeight = detailLines.length ? (detailLines.length * 20 + 16) : 0;
            const centerX = arenaWidth / 2;
            ctx.fillStyle = "rgba(2, 6, 23, 0.82)";
            ctx.fillRect(0, 0, arenaWidth, arenaHeight);
            ctx.textAlign = "center";
            ctx.fillStyle = "#f8fafc";
            ctx.font = "700 28px Segoe UI";
            ctx.fillText(session.pendingPickupChoice.title || "选择道具", centerX, 104);
            ctx.font = "500 16px Segoe UI";
            ctx.fillStyle = "#cbd5e1";
            ctx.fillText(session.pendingPickupChoice.subtitle || "选择后继续战斗", centerX, 134);
            if (detailLines.length) {
                ctx.textAlign = "left";
                ctx.fillStyle = "#e2e8f0";
                ctx.font = "500 14px Segoe UI";
                detailLines.forEach(function (line, index) {
                    ctx.fillText(line, 128, 162 + index * 20);
                });
                ctx.textAlign = "center";
            }
            session.pendingPickupChoice.choices.forEach(function (choice, index) {
                let box = null;
                if (session.pendingPickupChoice.choices.length === 4) {
                    box = {
                        x: 108 + (index % 2) * 374,
                        y: 184 + detailBlockHeight + Math.floor(index / 2) * 176,
                        w: 340,
                        h: 152
                    };
                } else {
                    box = { x: 110 + index * 250, y: 186 + detailBlockHeight, w: 220, h: 176 };
                }
                pickupChoiceRects.push(box);
                ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
                ctx.strokeStyle = "#f472b6";
                ctx.lineWidth = 2;
                ctx.fillRect(box.x, box.y, box.w, box.h);
                ctx.strokeRect(box.x, box.y, box.w, box.h);
                ctx.fillStyle = "#f472b6";
                ctx.font = "700 18px Segoe UI";
                ctx.fillText(String(index + 1), box.x + 26, box.y + 28);
                ctx.textAlign = "left";
                ctx.fillStyle = "#f8fafc";
                ctx.font = "700 22px Segoe UI";
                ctx.fillText(choice.label, box.x + 18, box.y + 56);
                ctx.fillStyle = "#cbd5e1";
                ctx.font = "500 15px Segoe UI";
                const chars = choice.description.split("");
                let line = "";
                let lineIndex = 0;
                chars.forEach(function (char, charIndex) {
                    const attempt = line + char;
                    if (ctx.measureText(attempt).width > box.w - 36 || charIndex === chars.length - 1) {
                        const text = charIndex === chars.length - 1 ? attempt : line;
                        ctx.fillText(text, box.x + 18, box.y + 96 + lineIndex * 24);
                        lineIndex += 1;
                        line = charIndex === chars.length - 1 ? "" : char;
                    } else {
                        line = attempt;
                    }
                });
                ctx.textAlign = "center";
            });
            if (session.pendingPickupChoice.allowDecline !== false) {
                const declineBox = { x: centerX - 150, y: arenaHeight - 84, w: 300, h: 46, action: "decline" };
                pickupChoiceRects.push(declineBox);
                ctx.fillStyle = "rgba(15, 23, 42, 0.94)";
                ctx.strokeStyle = "#94a3b8";
                ctx.lineWidth = 2;
                ctx.fillRect(declineBox.x, declineBox.y, declineBox.w, declineBox.h);
                ctx.strokeRect(declineBox.x, declineBox.y, declineBox.w, declineBox.h);
                ctx.fillStyle = "#e2e8f0";
                ctx.font = "700 18px Segoe UI";
                ctx.fillText("0 放弃并改为随机增强", declineBox.x + declineBox.w / 2, declineBox.y + 29);
            }
        }

        function renderSession() {
            const equippedSkin = topdownEquippedSkin(metaState);
            drawStarfield(ctx, arenaWidth, arenaHeight, session.tick);
            ctx.strokeStyle = "rgba(148,163,184,0.08)";
            for (let x = 0; x < arenaWidth; x += 64) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, arenaHeight);
                ctx.stroke();
            }
            for (let y = 0; y < arenaHeight; y += 64) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(arenaWidth, y);
                ctx.stroke();
            }

            getWingmanSlots(session).forEach(function (wingman) {
                ctx.fillStyle = "#67e8f9";
                ctx.beginPath();
                ctx.arc(wingman.x, wingman.y, 8, 0, Math.PI * 2);
                ctx.fill();
            });

            topdownMagneticTrapOrbs(session).forEach(function (orb) {
                ctx.save();
                ctx.fillStyle = "#a3e635";
                ctx.shadowColor = "#84cc16";
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(orb.x, orb.y, orb.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });

            ctx.save();
            ctx.translate(session.player.x, session.player.y);
            ctx.rotate(topdownCurrentAimAngle(session, pointer));
            const playerScale = session.player.radius / TOPDOWN_BALANCE.playerRadius;
            ctx.fillStyle = session.player.damageFlash > 0 ? "#fb7185" : equippedSkin.fill;
            ctx.beginPath();
            ctx.moveTo(18 * playerScale, 0);
            ctx.lineTo(-12 * playerScale, -12 * playerScale);
            ctx.lineTo(-6 * playerScale, 0);
            ctx.lineTo(-12 * playerScale, 12 * playerScale);
            ctx.closePath();
            ctx.fill();
            ctx.strokeStyle = equippedSkin.stroke;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = equippedSkin.accent;
            ctx.beginPath();
            ctx.arc(-2 * playerScale, 0, 3.2 * playerScale, 0, Math.PI * 2);
            ctx.fill();
            {
                const shieldStats = syncTopdownShieldCapacity(session);
                for (let shieldIndex = 0; shieldIndex < shieldStats.max; shieldIndex += 1) {
                    const ringRadius = (22 + shieldIndex * 6) * (0.92 + playerScale * 0.08);
                    ctx.lineWidth = 2.2;
                    ctx.strokeStyle = "rgba(71, 85, 105, 0.48)";
                    ctx.beginPath();
                    ctx.arc(0, 0, ringRadius, -Math.PI / 2, Math.PI * 1.5);
                    ctx.stroke();
                    if (shieldIndex < session.shield.current) {
                        ctx.strokeStyle = "#67e8f9";
                        ctx.beginPath();
                        ctx.arc(0, 0, ringRadius, -Math.PI / 2, Math.PI * 1.5);
                        ctx.stroke();
                    } else if (shieldIndex === session.shield.current && session.shield.current < shieldStats.max && session.shield.cooldownLeft <= 0 && session.shield.rechargeProgress > 0) {
                        ctx.strokeStyle = "#34d399";
                        ctx.beginPath();
                        ctx.arc(0, 0, ringRadius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * session.shield.rechargeProgress);
                        ctx.stroke();
                    }
                }
            }
            ctx.restore();

            session.bullets.forEach(function (bullet) {
                if (bullet.element === "electric") {
                    ctx.save();
                    ctx.strokeStyle = "#facc15";
                    ctx.lineWidth = 2.5;
                    ctx.shadowColor = "#fde047";
                    ctx.shadowBlur = 8;
                    ctx.beginPath();
                    ctx.moveTo(bullet.prevX, bullet.prevY);
                    ctx.lineTo(bullet.x, bullet.y);
                    ctx.stroke();
                    ctx.restore();
                    return;
                }
                ctx.fillStyle = bullet.element === "fire" ? "#fb923c" : (bullet.element === "ice" ? "#93c5fd" : (bullet.element === "nuclear" ? "#4ade80" : "#f8fafc"));
                ctx.beginPath();
                ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
                ctx.fill();
            });

            session.skillProjectiles.forEach(function (projectile) {
                ctx.save();
                ctx.fillStyle = "#fbbf24";
                ctx.shadowColor = "#fde68a";
                ctx.shadowBlur = 10;
                ctx.beginPath();
                ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            });

            session.enemyBullets.forEach(function (bullet) {
                if (bullet.kind === "hook") {
                    const sourceEnemy = topdownFindEnemyById(session, bullet.sourceEnemyId);
                    if (sourceEnemy) {
                        ctx.save();
                        ctx.strokeStyle = "rgba(244, 114, 182, 0.72)";
                        ctx.lineWidth = 2.2;
                        ctx.beginPath();
                        ctx.moveTo(sourceEnemy.x, sourceEnemy.y);
                        ctx.lineTo(bullet.x, bullet.y);
                        ctx.stroke();
                        ctx.restore();
                    }
                }
                ctx.fillStyle = bullet.color || (bullet.kind === "sniper" ? "#fca5a5" : (bullet.kind === "ring" ? "#fb7185" : "#f87171"));
                ctx.beginPath();
                ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
                ctx.fill();
            });

            session.enemyBeams.forEach(function (beam) {
                ctx.save();
                ctx.strokeStyle = beam.color || "#fb7185";
                ctx.lineWidth = beam.width || TOPDOWN_BALANCE.enemyBeamWidth;
                ctx.globalAlpha = Math.max(0.25, beam.life / TOPDOWN_BALANCE.enemyBeamLife);
                ctx.beginPath();
                ctx.moveTo(beam.fromX, beam.fromY);
                ctx.lineTo(beam.toX, beam.toY);
                ctx.stroke();
                ctx.restore();
            });

            session.beams.forEach(function (beam) {
                ctx.save();
                ctx.strokeStyle = beam.color || "#facc15";
                ctx.lineWidth = beam.width || 3;
                ctx.globalAlpha = Math.max(0.25, beam.life / TOPDOWN_BALANCE.electricBeamLife);
                ctx.beginPath();
                ctx.moveTo(beam.fromX, beam.fromY);
                ctx.lineTo(beam.toX, beam.toY);
                ctx.stroke();
                ctx.restore();
            });

            session.aoeBursts.forEach(function (burst) {
                ctx.save();
                if (burst.type === "enemy-explosion") {
                    ctx.strokeStyle = "#fb7185";
                    ctx.fillStyle = "rgba(251, 113, 133, 0.16)";
                    ctx.lineWidth = 3.5;
                    ctx.globalAlpha = Math.max(0.24, burst.life / TOPDOWN_BALANCE.selfDestructBurstLife);
                    ctx.beginPath();
                    ctx.arc(burst.x, burst.y, burst.radius * (1 - burst.life / TOPDOWN_BALANCE.selfDestructBurstLife * 0.2), 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                } else {
                    ctx.strokeStyle = "#4ade80";
                    ctx.lineWidth = 3;
                    ctx.globalAlpha = Math.max(0.18, burst.life / TOPDOWN_BALANCE.nuclearBurstLife);
                    ctx.beginPath();
                    ctx.arc(burst.x, burst.y, burst.radius * (1 - burst.life / TOPDOWN_BALANCE.nuclearBurstLife * 0.25), 0, Math.PI * 2);
                    ctx.stroke();
                }
                ctx.restore();
            });

            session.pickups.forEach(function (pickup) {
                const visual = topdownPickupVisual(pickup);
                ctx.save();
                ctx.translate(pickup.x, pickup.y);
                ctx.rotate(session.tick * 1.6);
                ctx.fillStyle = "rgba(2, 6, 23, 0.92)";
                ctx.strokeStyle = visual.color;
                ctx.lineWidth = pickup.kind === "item" ? 2.4 : 2;
                ctx.beginPath();
                ctx.moveTo(0, -12);
                ctx.lineTo(12, 0);
                ctx.lineTo(0, 12);
                ctx.lineTo(-12, 0);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();
                ctx.rotate(-session.tick * 1.6);
                ctx.fillStyle = visual.accent;
                ctx.font = "700 11px Consolas";
                ctx.textAlign = "center";
                ctx.fillText(visual.label, 0, 4);
                ctx.restore();
            });

            session.enemies.forEach(function (enemy) {
                const bossShieldRatio = enemy.isBoss ? Math.max(0, Math.min(1, Number(enemy.bossShield || 0) / Math.max(1, Number(enemy.bossShieldMax || 1)))) : 0;
                const hpRatio = Math.max(0, enemy.hp / Math.max(1, enemy.maxHp));
                const burnRatio = Math.max(0, Math.min(1, Number(enemy.burnStacks || 0) / TOPDOWN_BALANCE.burnStackMax));
                const iceRatio = Math.max(0, Math.min(1, Number(enemy.iceStacks || 0) / TOPDOWN_BALANCE.iceFreezeStacks));
                const baseRed = 248 - Math.round(30 * iceRatio);
                const baseGreen = 113 + Math.round(28 * burnRatio) - Math.round(54 * iceRatio);
                const baseBlue = 113 + Math.round(88 * iceRatio) - Math.round(24 * burnRatio);
                ctx.fillStyle = enemy.remnantActive
                    ? "#fb7185"
                    : "rgb(" + clamp(baseRed, 120, 255) + ", " + clamp(baseGreen, 80, 210) + ", " + clamp(baseBlue, 80, 255) + ")";
                ctx.beginPath();
                ctx.arc(enemy.x, enemy.y, enemy.radius, 0, Math.PI * 2);
                ctx.fill();
                if (enemy.isElite && enemy.eliteType === "buffer" && enemy.auraActive) {
                    ctx.save();
                    ctx.strokeStyle = "rgba(250, 204, 21, 0.7)";
                    ctx.setLineDash([10, 6]);
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, enemy.auraRadius, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                }
                if (enemy.isElite && enemy.eliteType === "repulsor") {
                    ctx.save();
                    ctx.strokeStyle = "rgba(125, 211, 252, 0.42)";
                    ctx.setLineDash([8, 8]);
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, TOPDOWN_BALANCE.repulsorRange, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                }
                if (enemy.isElite && enemy.eliteType === "nightmare") {
                    ctx.save();
                    ctx.strokeStyle = "rgba(30, 41, 59, 0.72)";
                    ctx.lineWidth = 5;
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, enemy.radius + 8 + Math.sin(session.tick * 7) * 2, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                }
                if (enemy.isElite && enemy.eliteType === "liangzi") {
                    ctx.save();
                    ctx.strokeStyle = "rgba(74, 222, 128, 0.7)";
                    ctx.lineWidth = 2.4;
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, enemy.radius + 6, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                }
                if (enemy.remnantActive) {
                    ctx.strokeStyle = "rgba(251, 113, 133, 0.9)";
                    ctx.lineWidth = 2.2;
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, enemy.radius + 8 + Math.sin(session.tick * 12) * 2, 0, Math.PI * 2);
                    ctx.stroke();
                }
                if (enemy.burnStacks > 0) {
                    drawTopdownStatusRing(ctx, enemy, enemy.burnStacks, TOPDOWN_BALANCE.burnStackMax, "#ef4444", -3);
                }
                if (enemy.iceStacks > 0) {
                    drawTopdownStatusRing(ctx, enemy, enemy.iceStacks, TOPDOWN_BALANCE.iceFreezeStacks, "#60a5fa", 5);
                }
                if (enemy.isElite) {
                    ctx.strokeStyle = enemy.isBoss ? "#a78bfa" : "#facc15";
                    ctx.lineWidth = enemy.isBoss ? 4 : 3;
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, enemy.radius + (enemy.isBoss ? 7 : 4), 0, Math.PI * 2);
                    ctx.stroke();
                    if (enemy.isBoss) {
                        ctx.strokeStyle = "#67e8f9";
                        ctx.lineWidth = 2.4;
                        ctx.beginPath();
                        ctx.arc(enemy.x, enemy.y, enemy.radius + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * bossShieldRatio);
                        ctx.stroke();
                    } else {
                        ctx.fillStyle = "#fecaca";
                        ctx.beginPath();
                        ctx.arc(enemy.x, enemy.y, 4, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
                ctx.fillStyle = "rgba(15,23,42,0.92)";
                ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 12, enemy.radius * 2, 5);
                ctx.fillStyle = "#22c55e";
                ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 12, enemy.radius * 2 * hpRatio, 5);
                if (enemy.isBoss) {
                    ctx.fillStyle = "rgba(15,23,42,0.92)";
                    ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 20, enemy.radius * 2, 4);
                    ctx.fillStyle = "#67e8f9";
                    ctx.fillRect(enemy.x - enemy.radius, enemy.y - enemy.radius - 20, enemy.radius * 2 * bossShieldRatio, 4);
                }
                ctx.fillStyle = "#f8fafc";
                ctx.font = "700 12px Consolas";
                ctx.textAlign = "center";
                ctx.fillText(String(Math.max(1, Math.ceil(enemy.hp))), enemy.x, enemy.y + 4);
                if ((enemy.isElite && enemy.eliteType) || enemy.remnantActive) {
                    ctx.fillStyle = enemy.isBoss ? "#c4b5fd" : "#fde68a";
                    ctx.font = "700 " + (enemy.isBoss ? "11" : "10") + "px Segoe UI";
                    ctx.fillText(topdownEliteLabel(enemy), enemy.x, enemy.y + enemy.radius + 14);
                }
            });
            ctx.textAlign = "start";

            ctx.fillStyle = "#f8fafc";
            ctx.textAlign = "left";
            ctx.font = "700 15px Segoe UI";
            ctx.fillText("连杀 " + session.combo + " / 最佳 " + session.bestCombo, 22, 28);
            ctx.font = "500 13px Segoe UI";
            ctx.fillStyle = session.combo > 0 ? "#facc15" : "#94a3b8";
            ctx.fillText(session.combo > 0 ? ("剩余连杀时间 " + session.comboTimer.toFixed(1) + "s / 当前击杀得分 " + (TOPDOWN_BALANCE.killScore + topdownComboBonus(session))) : ("连续击败敌人可叠加连杀得分，当前道具阈值 " + topdownCurrentComboItemEvery(session) + " 连"), 22, 49);
            if (topdownHasLivingBoss(session)) {
                ctx.fillStyle = "#c4b5fd";
                ctx.fillText("首领已进场：先拆护盾，再压血量。", 22, 70);
            }
            if (session.player.blindUntil > session.tick) {
                const blindRemaining = Math.max(0, session.player.blindUntil - session.tick);
                ctx.save();
                ctx.fillStyle = "rgba(2, 6, 23, 0.88)";
                ctx.fillRect(0, 0, arenaWidth, arenaHeight);
                ctx.globalCompositeOperation = "destination-out";
                const blindGradient = ctx.createRadialGradient(
                    session.player.x,
                    session.player.y,
                    26,
                    session.player.x,
                    session.player.y,
                    TOPDOWN_BALANCE.nightmareVisionRadius
                );
                blindGradient.addColorStop(0, "rgba(0,0,0,1)");
                blindGradient.addColorStop(0.72, "rgba(0,0,0,0.82)");
                blindGradient.addColorStop(1, "rgba(0,0,0,0)");
                ctx.fillStyle = blindGradient;
                ctx.beginPath();
                ctx.arc(session.player.x, session.player.y, TOPDOWN_BALANCE.nightmareVisionRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
                ctx.fillStyle = "#e2e8f0";
                ctx.fillText("致盲剩余 " + blindRemaining.toFixed(1) + " 秒", 22, topdownHasLivingBoss(session) ? 92 : 70);
            }
            if (session.player.invulnerableUntil > session.tick) {
                ctx.fillStyle = "#86efac";
                ctx.fillText("无敌剩余 " + (session.player.invulnerableUntil - session.tick).toFixed(1) + " 秒", 22, session.player.blindUntil > session.tick ? 114 : (topdownHasLivingBoss(session) ? 92 : 70));
            }
            ctx.textAlign = "start";

            if (session.pendingUpgrade) {
                renderUpgradeOverlay();
            } else if (session.pendingPickupChoice) {
                renderPickupChoiceOverlay();
            }
            if (session.status === "paused") {
                ctx.fillStyle = "rgba(2,6,23,0.6)";
                ctx.fillRect(0, 0, arenaWidth, arenaHeight);
                ctx.fillStyle = "#f8fafc";
                ctx.textAlign = "center";
                ctx.font = "700 40px Segoe UI";
                ctx.fillText("已暂停", arenaWidth / 2, arenaHeight / 2 - 14);
                ctx.font = "500 18px Segoe UI";
                ctx.fillText("WASD / 方向键移动，鼠标瞄准，左键 / J 射击", arenaWidth / 2, arenaHeight / 2 + 20);
                ctx.fillText("1 / 2 / 3 选择强化或道具，R 刷新本轮强化，P 继续游戏", arenaWidth / 2, arenaHeight / 2 + 50);
            } else if (session.status === "over") {
                ctx.fillStyle = "rgba(2,6,23,0.72)";
                ctx.fillRect(0, 0, arenaWidth, arenaHeight);
                ctx.fillStyle = "#f8fafc";
                ctx.textAlign = "center";
                ctx.font = "700 42px Segoe UI";
                ctx.fillText("本局失败", arenaWidth / 2, arenaHeight / 2 - 38);
                ctx.font = "500 20px Segoe UI";
                ctx.fillText("分数 " + session.score + " / 击败 " + session.kills + " / 波次 " + session.wave, arenaWidth / 2, arenaHeight / 2 + 12);
                ctx.fillText(topdownBuildSummary(session), arenaWidth / 2, arenaHeight / 2 + 44);
                ctx.fillText("本局结算局外积分 +" + topdownMetaRewardAmount(session), arenaWidth / 2, arenaHeight / 2 + 78);
                ctx.fillText("点击“重新开局”立即再来一局", arenaWidth / 2, arenaHeight / 2 + 108);
            }
        }

        function loop(ts) {
            if (!lastFrame) {
                lastFrame = ts;
            }
            const dt = Math.min(0.04, (ts - lastFrame) / 1000);
            lastFrame = ts;
            if (!introActive) {
                updateSession(dt);
            }
            renderSession();
            updateHud();
            if (session.elapsedSeconds !== persistStamp || session.status === "paused") {
                persistStamp = session.elapsedSeconds;
                persist();
            }
            animationId = window.requestAnimationFrame(loop);
        }

        function canvasPoint(event) {
            const rect = arcade.canvas.getBoundingClientRect();
            pointer.x = ((event.clientX - rect.left) / rect.width) * arenaWidth;
            pointer.y = ((event.clientY - rect.top) / rect.height) * arenaHeight;
        }

        function keydown(event) {
            if (introActive) {
                if (blockedKeys[event.code]) {
                    event.preventDefault();
                }
                return;
            }
            if (blockedKeys[event.code]) {
                event.preventDefault();
            }
            pressed[event.code] = true;
            if (tryBlinkSkill(event.code)) {
                persist();
            } else if (session.pendingUpgrade && event.code.indexOf("Digit") === 0) {
                selectUpgrade(Number(event.code.slice(5)) - 1);
            } else if (session.pendingUpgrade && event.code === "KeyR") {
                rerollUpgradeChoices();
            } else if (session.pendingPickupChoice && session.pendingPickupChoice.allowDecline !== false && (event.code === "Digit0" || event.code === "Numpad0")) {
                declinePendingPickupChoice();
            } else if (session.pendingPickupChoice && event.code.indexOf("Digit") === 0) {
                resolvePendingPickupChoice(Number(event.code.slice(5)) - 1);
            } else if (event.code === "KeyQ") {
                if (activateTopdownSkill()) {
                    persist();
                }
            } else if (event.code === "KeyP") {
                togglePause();
            }
        }

        function keyup(event) {
            if (introActive) {
                if (blockedKeys[event.code]) {
                    event.preventDefault();
                }
                return;
            }
            if (blockedKeys[event.code]) {
                event.preventDefault();
            }
            pressed[event.code] = false;
        }

        function pointerMove(event) {
            if (introActive) {
                return;
            }
            canvasPoint(event);
        }

        function pointerDown(event) {
            if (introActive) {
                return;
            }
            canvasPoint(event);
            if (session.pendingUpgrade) {
                const rect = arcade.canvas.getBoundingClientRect();
                const x = ((event.clientX - rect.left) / rect.width) * arenaWidth;
                const y = ((event.clientY - rect.top) / rect.height) * arenaHeight;
                upgradeRects.some(function (box, index) {
                    if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
                        if (box.action === "reroll") {
                            rerollUpgradeChoices();
                            return true;
                        }
                        selectUpgrade(index);
                        return true;
                    }
                    return false;
                });
                return;
            }
            if (session.pendingPickupChoice) {
                const rect = arcade.canvas.getBoundingClientRect();
                const x = ((event.clientX - rect.left) / rect.width) * arenaWidth;
                const y = ((event.clientY - rect.top) / rect.height) * arenaHeight;
                pickupChoiceRects.some(function (box, index) {
                    if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
                        if (box.action === "decline") {
                            declinePendingPickupChoice();
                            return true;
                        }
                        resolvePendingPickupChoice(index);
                        return true;
                    }
                    return false;
                });
                return;
            }
            pointer.down = true;
        }

        function pointerUp() {
            pointer.down = false;
        }

        document.addEventListener("keydown", keydown);
        document.addEventListener("keyup", keyup);
        arcade.canvas.addEventListener("mousemove", pointerMove);
        arcade.canvas.addEventListener("mousedown", pointerDown);
        window.addEventListener("mouseup", pointerUp);

        createGameStartOverlay(arcade.canvasWrap, Object.assign({}, topdownHelpConfig, {
            buttonLabel: session.score > 0 || session.kills > 0 || session.elapsedSeconds > 0 ? "继续出击" : "开始出击",
            useStageActionButton: true,
            onStart: function () {
                introActive = false;
                if (session.status === "paused") {
                    session.startedAt = Date.now();
                    session.status = "playing";
                } else if (session.status !== "over") {
                    session.startedAt += Date.now() - introShownAt;
                }
                updateHud();
                persist();
            }
        }));

        updateHud();
        persist();
        animationId = window.requestAnimationFrame(loop);

        return function cleanup() {
            window.cancelAnimationFrame(animationId);
            document.removeEventListener("keydown", keydown);
            document.removeEventListener("keyup", keyup);
            arcade.canvas.removeEventListener("mousemove", pointerMove);
            arcade.canvas.removeEventListener("mousedown", pointerDown);
            window.removeEventListener("mouseup", pointerUp);
            syncTopdownClock(session);
            persist();
        };
    }

    function createSpaceRocksSession() {
        return {
            sessionKey: "spr-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            startedAt: Date.now(),
            elapsedSeconds: 0,
            nextId: 1,
            ship: { x: 480, y: 300, angle: -Math.PI / 2, vx: 0, vy: 0, fireCooldown: 0, hitCooldown: 0 },
            bullets: [],
            asteroids: [],
            score: 0,
            level: 1,
            lives: 3,
            tick: 0,
            status: "playing",
            submittedScore: false
        };
    }

    function normalizeSpaceRocksSession(raw) {
        const session = !raw || !raw.sessionKey ? createSpaceRocksSession() : {
            sessionKey: String(raw.sessionKey || ("spr-" + Date.now())),
            startedAt: Number(raw.startedAt || Date.now()),
            elapsedSeconds: Number(raw.elapsedSeconds || 0),
            nextId: Number(raw.nextId || 1),
            ship: Object.assign({ x: 480, y: 300, angle: -Math.PI / 2, vx: 0, vy: 0, fireCooldown: 0, hitCooldown: 0 }, raw.ship || {}),
            bullets: Array.isArray(raw.bullets) ? raw.bullets.slice() : [],
            asteroids: Array.isArray(raw.asteroids) ? raw.asteroids.slice() : [],
            score: Number(raw.score || 0),
            level: Math.max(1, Number(raw.level || 1)),
            lives: Math.max(0, Number(raw.lives || 3)),
            tick: Number(raw.tick || 0),
            status: raw.status === "over" ? "over" : "playing",
            submittedScore: Boolean(raw.submittedScore)
        };
        if (!session.asteroids.length && session.status === "playing") {
            spawnSpaceRocksWave(session);
        }
        return session;
    }

    function syncSpaceRocksClock(session) {
        if (session.status !== "over") {
            session.elapsedSeconds = Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
        }
    }

    function serializeSpaceRocksSession(session) {
        syncSpaceRocksClock(session);
        return JSON.parse(JSON.stringify(session));
    }

    function summarizeSpaceRocksSession(session) {
        syncSpaceRocksClock(session);
        return {
            score: session.score,
            level: session.level,
            lives: session.lives,
            elapsed_seconds: session.elapsedSeconds,
            status: session.status
        };
    }

    function spawnAsteroid(session, size, x, y, angle, speed) {
        session.asteroids.push({
            id: session.nextId,
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: size,
            radius: size === 3 ? 42 : (size === 2 ? 26 : 16),
            spin: randomBetween(-1.2, 1.2),
            rotation: randomBetween(0, Math.PI * 2)
        });
        session.nextId += 1;
    }

    function spawnSpaceRocksWave(session) {
        const count = Math.min(3 + session.level, 8);
        for (let i = 0; i < count; i += 1) {
            const angle = randomBetween(0, Math.PI * 2);
            const edge = i % 4;
            const x = edge === 0 ? -30 : (edge === 1 ? 990 : randomBetween(20, 940));
            const y = edge === 2 ? -30 : (edge === 3 ? 630 : randomBetween(20, 580));
            spawnAsteroid(session, 3, x, y, angle, randomBetween(30, 70) + session.level * 6);
        }
    }

    function wrapPoint(entity, width, height, margin) {
        if (entity.x < -margin) { entity.x = width + margin; }
        if (entity.x > width + margin) { entity.x = -margin; }
        if (entity.y < -margin) { entity.y = height + margin; }
        if (entity.y > height + margin) { entity.y = -margin; }
    }

    function mountSpaceRocks(savedPayload) {
        let session = normalizeSpaceRocksSession(savedPayload.state || {});
        const arcade = createArcadeShell(
            "Space Rocks",
            "左/右旋转，向前推进，空格射击。陨石会分裂，关卡和分数自动保存。",
            "积分按陨石击毁、关卡和剩余生存状态累计，结算后自动进入榜单。"
        );
        const ctx = arcade.canvas.getContext("2d");
        const pressed = Object.create(null);
        let animationId = 0;
        let lastFrame = 0;
        let persistStamp = 0;

        addStageButton("重新开始", function () {
            finalizeScoreIfNeeded().finally(function () {
                session = createSpaceRocksSession();
                spawnSpaceRocksWave(session);
                persist();
            });
        }, true);

        function persist() {
            scheduleGameStateSave("space-rocks", serializeSpaceRocksSession(session), summarizeSpaceRocksSession(session));
        }

        function updateHud() {
            syncSpaceRocksClock(session);
            setArcadeStats(arcade.statGrid, [
                { label: "积分", value: String(session.score) },
                { label: "关卡", value: String(session.level) },
                { label: "陨石", value: String(session.asteroids.length) },
                { label: "用时", value: formatSeconds(session.elapsedSeconds) }
            ]);
            setArcadeList(arcade.controls, [
                '<span class="game-arcade-kbd">← / →</span> 旋转飞船',
                '<span class="game-arcade-kbd">↑</span> 推进',
                '<span class="game-arcade-kbd">Space</span> 发射激光'
            ]);
            setArcadeList(arcade.status, [
                "当前状态：" + (session.status === "over" ? "已结束" : "飞行中"),
                "清空当前陨石波次后进入下一关。",
                session.status === "over" ? "本局已尝试提交成绩。" : "支持随时关闭，回来继续。"
            ]);
            syncPresence(session.status === "over" ? "Space Rocks 已结束" : ("Space Rocks Level " + session.level), "");
        }

        function shoot() {
            if (session.status !== "playing" || session.ship.fireCooldown > 0) {
                return;
            }
            session.bullets.push({
                id: session.nextId,
                x: session.ship.x + Math.cos(session.ship.angle) * 18,
                y: session.ship.y + Math.sin(session.ship.angle) * 18,
                vx: Math.cos(session.ship.angle) * 430 + session.ship.vx,
                vy: Math.sin(session.ship.angle) * 430 + session.ship.vy,
                life: 1.2,
                radius: 3
            });
            session.nextId += 1;
            session.ship.fireCooldown = 0.22;
        }

        function finalizeScoreIfNeeded() {
            syncSpaceRocksClock(session);
            if (session.submittedScore || session.score <= 0) {
                return Promise.resolve();
            }
            session.submittedScore = true;
            return submitScore("space-rocks", session.score, "standard", session.sessionKey, {
                mode_key: "space-rocks-standard",
                elapsed_seconds: session.elapsedSeconds,
                level: session.level,
                lives: session.lives
            }).catch(function (error) {
                session.submittedScore = false;
                setStatus(error.message || "Space Rocks 鎴愮哗鎻愪氦澶辫触", true);
            });
        }

        function splitAsteroid(asteroid) {
            if (asteroid.size <= 1) {
                return;
            }
            for (let i = 0; i < 2; i += 1) {
                spawnAsteroid(
                    session,
                    asteroid.size - 1,
                    asteroid.x,
                    asteroid.y,
                    randomBetween(0, Math.PI * 2),
                    randomBetween(60, 120) + (3 - asteroid.size) * 20
                );
            }
        }

        function updateSession(dt) {
            session.tick += dt;
            syncSpaceRocksClock(session);
            if (session.status !== "playing") {
                return;
            }
            session.ship.fireCooldown = Math.max(0, session.ship.fireCooldown - dt);
            session.ship.hitCooldown = Math.max(0, session.ship.hitCooldown - dt);

            if (pressed.ArrowLeft || pressed.KeyA) { session.ship.angle -= 3.2 * dt; }
            if (pressed.ArrowRight || pressed.KeyD) { session.ship.angle += 3.2 * dt; }
            if (pressed.ArrowUp || pressed.KeyW) {
                session.ship.vx += Math.cos(session.ship.angle) * 170 * dt;
                session.ship.vy += Math.sin(session.ship.angle) * 170 * dt;
            }
            if (pressed.Space) {
                shoot();
            }

            session.ship.vx *= 0.993;
            session.ship.vy *= 0.993;
            session.ship.x += session.ship.vx * dt;
            session.ship.y += session.ship.vy * dt;
            wrapPoint(session.ship, 960, 600, 24);

            session.bullets.forEach(function (bullet) {
                bullet.x += bullet.vx * dt;
                bullet.y += bullet.vy * dt;
                bullet.life -= dt;
                wrapPoint(bullet, 960, 600, 8);
            });
            session.bullets = session.bullets.filter(function (bullet) {
                return bullet.life > 0;
            });

            session.asteroids.forEach(function (asteroid) {
                asteroid.x += asteroid.vx * dt;
                asteroid.y += asteroid.vy * dt;
                asteroid.rotation += asteroid.spin * dt;
                wrapPoint(asteroid, 960, 600, asteroid.radius + 10);
            });

            const remainingBullets = [];
            session.bullets.forEach(function (bullet) {
                let hit = false;
                session.asteroids = session.asteroids.filter(function (asteroid) {
                    if (!hit && distanceBetween(bullet, asteroid) <= bullet.radius + asteroid.radius) {
                        hit = true;
                        session.score += asteroid.size === 3 ? 50 : (asteroid.size === 2 ? 90 : 140);
                        splitAsteroid(asteroid);
                        return false;
                    }
                    return true;
                });
                if (!hit) {
                    remainingBullets.push(bullet);
                }
            });
            session.bullets = remainingBullets;

            if (session.ship.hitCooldown <= 0) {
                const collided = session.asteroids.some(function (asteroid) {
                    return distanceBetween(session.ship, asteroid) <= asteroid.radius + 14;
                });
                if (collided) {
                    session.lives -= 1;
                    session.ship.x = 480;
                    session.ship.y = 300;
                    session.ship.vx = 0;
                    session.ship.vy = 0;
                    session.ship.hitCooldown = 2;
                    if (session.lives <= 0) {
                        session.status = "over";
                        session.score += session.level * 120;
                        finalizeScoreIfNeeded();
                        persist();
                    }
                }
            }

            if (!session.asteroids.length && session.status === "playing") {
                session.level += 1;
                session.score += session.level * 70 + session.lives * 20;
                spawnSpaceRocksWave(session);
            }
        }

        function renderSession() {
            drawStarfield(ctx, 960, 600, session.tick * 0.8);
            ctx.strokeStyle = "rgba(96,165,250,0.15)";
            ctx.lineWidth = 1;

            session.asteroids.forEach(function (asteroid) {
                ctx.save();
                ctx.translate(asteroid.x, asteroid.y);
                ctx.rotate(asteroid.rotation);
                ctx.strokeStyle = asteroid.size === 3 ? "#fbbf24" : (asteroid.size === 2 ? "#fb923c" : "#f87171");
                ctx.beginPath();
                for (let i = 0; i < 7; i += 1) {
                    const angle = (Math.PI * 2 / 7) * i;
                    const radius = asteroid.radius * (0.76 + ((i % 2) * 0.22));
                    const px = Math.cos(angle) * radius;
                    const py = Math.sin(angle) * radius;
                    if (i === 0) {
                        ctx.moveTo(px, py);
                    } else {
                        ctx.lineTo(px, py);
                    }
                }
                ctx.closePath();
                ctx.stroke();
                ctx.restore();
            });

            ctx.fillStyle = "#f8fafc";
            session.bullets.forEach(function (bullet) {
                ctx.beginPath();
                ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
                ctx.fill();
            });

            ctx.save();
            ctx.translate(session.ship.x, session.ship.y);
            ctx.rotate(session.ship.angle);
            ctx.strokeStyle = session.ship.hitCooldown > 0 ? "#fca5a5" : "#38bdf8";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(18, 0);
            ctx.lineTo(-14, -10);
            ctx.lineTo(-6, 0);
            ctx.lineTo(-14, 10);
            ctx.closePath();
            ctx.stroke();
            if (pressed.ArrowUp || pressed.KeyW) {
                ctx.beginPath();
                ctx.moveTo(-10, -5);
                ctx.lineTo(-20, 0);
                ctx.lineTo(-10, 5);
                ctx.strokeStyle = "#f97316";
                ctx.stroke();
            }
            ctx.restore();

            if (session.status === "over") {
                ctx.fillStyle = "rgba(2,6,23,0.7)";
                ctx.fillRect(0, 0, 960, 600);
                ctx.fillStyle = "#f8fafc";
                ctx.textAlign = "center";
                ctx.font = "700 42px Segoe UI";
                ctx.fillText("Ship Lost", 480, 270);
                ctx.font = "500 20px Segoe UI";
                ctx.fillText("积分 " + session.score + " / 关卡 " + session.level + " / 用时 " + formatSeconds(session.elapsedSeconds), 480, 320);
                ctx.fillText("鐐瑰嚮鈥滈噸鏂板紑灞€鈥濈户缁", 480, 355);
            }
        }

        function loop(ts) {
            if (!lastFrame) {
                lastFrame = ts;
            }
            const dt = Math.min(0.04, (ts - lastFrame) / 1000);
            lastFrame = ts;
            updateSession(dt);
            renderSession();
            updateHud();
            if (session.elapsedSeconds !== persistStamp) {
                persistStamp = session.elapsedSeconds;
                persist();
            }
            animationId = window.requestAnimationFrame(loop);
        }

        function keydown(event) { pressed[event.code] = true; }
        function keyup(event) { pressed[event.code] = false; }

        document.addEventListener("keydown", keydown);
        document.addEventListener("keyup", keyup);

        updateHud();
        persist();
        if (!session.asteroids.length && session.status === "playing") {
            spawnSpaceRocksWave(session);
        }
        animationId = window.requestAnimationFrame(loop);

        return function cleanup() {
            window.cancelAnimationFrame(animationId);
            document.removeEventListener("keydown", keydown);
            document.removeEventListener("keyup", keyup);
            syncSpaceRocksClock(session);
            persist();
        };
    }

    function mountSpaceRocks(savedPayload) {
        let session = normalizeSpaceRocksSession(savedPayload.state || {});
        const spaceRocksHelpConfig = {
            title: "Space Rocks",
            subtitle: "在惯性与环绕边界中闪避陨石，尽量稳住节奏持续清场。",
            bullets: [
                "操作：左右方向键控制转向，上方向键推进，J 键开火。",
                "大陨石会裂成更小的碎块，清掉整波后进入下一关。",
                "分数和进度会自动保存，中途离开后也能继续。"
            ],
            hint: "不要一直猛推，先活下来比盲目抢分更重要。"
        };
        const arcade = createArcadeShell(
            "Space Rocks",
            "左右方向键旋转，向上推进，J 射击。陨石会裂变，关卡和分数自动保存。",
            "积分按击碎陨石、推进关卡和生存时间累计，结算后自动入榜。"
        );
        const ctx = arcade.canvas.getContext("2d");
        const pressed = Object.create(null);
        const blockedKeys = { Space: true, ArrowUp: true, ArrowDown: true, ArrowLeft: true, ArrowRight: true, KeyW: true, KeyA: true, KeyD: true, KeyJ: true };
        let animationId = 0;
        let lastFrame = 0;
        let persistStamp = 0;
        let introShownAt = Date.now();
        let introActive = true;

        addStageButton("重新开局", function () {
            finalizeScoreIfNeeded().finally(function () {
                session = createSpaceRocksSession();
                spawnSpaceRocksWave(session);
                persist();
            });
        }, true);
        addStageButton("帮助", function () {
            openGameInfoOverlay(arcade.canvasWrap, spaceRocksHelpConfig);
        }, false);

        function persist() {
            scheduleGameStateSave("space-rocks", serializeSpaceRocksSession(session), summarizeSpaceRocksSession(session));
        }

        function updateHud() {
            syncSpaceRocksClock(session);
            setArcadeStats(arcade.statGrid, [
                { label: "分数", value: String(session.score) },
                { label: "关卡", value: String(session.level) },                { label: "陨石", value: String(session.asteroids.length) },
                { label: "用时", value: formatSeconds(session.elapsedSeconds) }
            ]);
            setArcadeList(arcade.status, [
                "当前状态：" + (session.status === "over" ? "已结束" : "飞行中"),
                "清空当前陨石波次后进入下一关。",
                session.status === "over" ? "本局已尝试提交成绩。" : "支持随时关闭，回来继续。"
            ]);
            syncPresence(session.status === "over" ? "Space Rocks 已结束" : ("Space Rocks Level " + session.level), "");
        }

        function shoot() {
            if (session.status !== "playing" || session.ship.fireCooldown > 0) {
                return;
            }
            session.bullets.push({
                id: session.nextId,
                x: session.ship.x + Math.cos(session.ship.angle) * 18,
                y: session.ship.y + Math.sin(session.ship.angle) * 18,
                vx: Math.cos(session.ship.angle) * 430 + session.ship.vx,
                vy: Math.sin(session.ship.angle) * 430 + session.ship.vy,
                life: 1.2,
                radius: 3
            });
            session.nextId += 1;
            session.ship.fireCooldown = 0.22;
        }

        function finalizeScoreIfNeeded() {
            syncSpaceRocksClock(session);
            if (session.submittedScore || session.score <= 0) {
                return Promise.resolve();
            }
            session.submittedScore = true;
            return submitScore("space-rocks", session.score, "standard", session.sessionKey, {
                mode_key: "space-rocks-standard",
                elapsed_seconds: session.elapsedSeconds,
                level: session.level,
                lives: session.lives
            }).catch(function (error) {
                session.submittedScore = false;
                setStatus(error.message || "Space Rocks 成绩提交失败", true);
            });
        }

        function splitAsteroid(asteroid) {
            if (asteroid.size <= 1) {
                return;
            }
            for (let i = 0; i < 2; i += 1) {
                spawnAsteroid(
                    session,
                    asteroid.size - 1,
                    asteroid.x,
                    asteroid.y,
                    randomBetween(0, Math.PI * 2),
                    randomBetween(60, 120) + (3 - asteroid.size) * 20
                );
            }
        }

        function updateSession(dt) {
            session.tick += dt;
            syncSpaceRocksClock(session);
            if (session.status !== "playing") {
                return;
            }
            session.ship.fireCooldown = Math.max(0, session.ship.fireCooldown - dt);
            session.ship.hitCooldown = Math.max(0, session.ship.hitCooldown - dt);

            if (pressed.ArrowLeft || pressed.KeyA) { session.ship.angle -= 3.2 * dt; }
            if (pressed.ArrowRight || pressed.KeyD) { session.ship.angle += 3.2 * dt; }
            if (pressed.ArrowUp || pressed.KeyW) {
                session.ship.vx += Math.cos(session.ship.angle) * 170 * dt;
                session.ship.vy += Math.sin(session.ship.angle) * 170 * dt;
            }
            if (pressed.KeyJ) {
                shoot();
            }

            session.ship.vx *= 0.993;
            session.ship.vy *= 0.993;
            session.ship.x += session.ship.vx * dt;
            session.ship.y += session.ship.vy * dt;
            wrapPoint(session.ship, 960, 600, 24);

            session.bullets.forEach(function (bullet) {
                bullet.x += bullet.vx * dt;
                bullet.y += bullet.vy * dt;
                bullet.life -= dt;
                wrapPoint(bullet, 960, 600, 8);
            });
            session.bullets = session.bullets.filter(function (bullet) {
                return bullet.life > 0;
            });

            session.asteroids.forEach(function (asteroid) {
                asteroid.x += asteroid.vx * dt;
                asteroid.y += asteroid.vy * dt;
                asteroid.rotation += asteroid.spin * dt;
                wrapPoint(asteroid, 960, 600, asteroid.radius + 10);
            });

            const remainingBullets = [];
            session.bullets.forEach(function (bullet) {
                let hit = false;
                session.asteroids = session.asteroids.filter(function (asteroid) {
                    if (!hit && distanceBetween(bullet, asteroid) <= bullet.radius + asteroid.radius) {
                        hit = true;
                        session.score += asteroid.size === 3 ? 50 : (asteroid.size === 2 ? 90 : 140);
                        splitAsteroid(asteroid);
                        return false;
                    }
                    return true;
                });
                if (!hit) {
                    remainingBullets.push(bullet);
                }
            });
            session.bullets = remainingBullets;

            if (session.ship.hitCooldown <= 0) {
                const collided = session.asteroids.some(function (asteroid) {
                    return distanceBetween(session.ship, asteroid) <= asteroid.radius + 14;
                });
                if (collided) {
                    session.lives -= 1;
                    session.ship.x = 480;
                    session.ship.y = 300;
                    session.ship.vx = 0;
                    session.ship.vy = 0;
                    session.ship.hitCooldown = 2;
                    if (session.lives <= 0) {
                        session.status = "over";
                        session.score += session.level * 120;
                        finalizeScoreIfNeeded();
                        persist();
                    }
                }
            }

            if (!session.asteroids.length && session.status === "playing") {
                session.level += 1;
                session.score += session.level * 70 + session.lives * 20;
                spawnSpaceRocksWave(session);
            }
        }

        function renderSession() {
            drawStarfield(ctx, 960, 600, session.tick * 0.8);
            ctx.strokeStyle = "rgba(96,165,250,0.15)";
            ctx.lineWidth = 1;

            session.asteroids.forEach(function (asteroid) {
                ctx.save();
                ctx.translate(asteroid.x, asteroid.y);
                ctx.rotate(asteroid.rotation);
                ctx.strokeStyle = asteroid.size === 3 ? "#fbbf24" : (asteroid.size === 2 ? "#fb923c" : "#f87171");
                ctx.beginPath();
                for (let i = 0; i < 7; i += 1) {
                    const angle = (Math.PI * 2 / 7) * i;
                    const radius = asteroid.radius * (0.76 + ((i % 2) * 0.22));
                    const px = Math.cos(angle) * radius;
                    const py = Math.sin(angle) * radius;
                    if (i === 0) {
                        ctx.moveTo(px, py);
                    } else {
                        ctx.lineTo(px, py);
                    }
                }
                ctx.closePath();
                ctx.stroke();
                ctx.restore();
            });

            ctx.fillStyle = "#f8fafc";
            session.bullets.forEach(function (bullet) {
                ctx.beginPath();
                ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
                ctx.fill();
            });

            ctx.save();
            ctx.translate(session.ship.x, session.ship.y);
            ctx.rotate(session.ship.angle);
            ctx.strokeStyle = session.ship.hitCooldown > 0 ? "#fca5a5" : "#38bdf8";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(18, 0);
            ctx.lineTo(-14, -10);
            ctx.lineTo(-6, 0);
            ctx.lineTo(-14, 10);
            ctx.closePath();
            ctx.stroke();
            if (pressed.ArrowUp || pressed.KeyW) {
                ctx.beginPath();
                ctx.moveTo(-10, -5);
                ctx.lineTo(-20, 0);
                ctx.lineTo(-10, 5);
                ctx.strokeStyle = "#f97316";
                ctx.stroke();
            }
            ctx.restore();

            if (session.status === "over") {
                ctx.fillStyle = "rgba(2,6,23,0.7)";
                ctx.fillRect(0, 0, 960, 600);
                ctx.fillStyle = "#f8fafc";
                ctx.textAlign = "center";
                ctx.font = "700 42px Segoe UI";
                ctx.fillText("Ship Lost", 480, 270);
                ctx.font = "500 20px Segoe UI";
                ctx.fillText("分数 " + session.score + " / 关卡 " + session.level + " / 用时 " + formatSeconds(session.elapsedSeconds), 480, 320);
                ctx.fillText("点击“重新开局”继续飞行", 480, 355);
            }
        }

        function loop(ts) {
            if (!lastFrame) {
                lastFrame = ts;
            }
            const dt = Math.min(0.04, (ts - lastFrame) / 1000);
            lastFrame = ts;
            if (!introActive) {
                updateSession(dt);
            }
            renderSession();
            updateHud();
            if (session.elapsedSeconds !== persistStamp) {
                persistStamp = session.elapsedSeconds;
                persist();
            }
            animationId = window.requestAnimationFrame(loop);
        }

        function keydown(event) {
            if (introActive) {
                if (blockedKeys[event.code]) {
                    event.preventDefault();
                }
                return;
            }
            if (blockedKeys[event.code]) {
                event.preventDefault();
            }
            pressed[event.code] = true;
        }

        function keyup(event) {
            if (introActive) {
                if (blockedKeys[event.code]) {
                    event.preventDefault();
                }
                return;
            }
            if (blockedKeys[event.code]) {
                event.preventDefault();
            }
            pressed[event.code] = false;
        }

        document.addEventListener("keydown", keydown);
        document.addEventListener("keyup", keyup);

        createGameStartOverlay(arcade.canvasWrap, Object.assign({}, spaceRocksHelpConfig, {
            buttonLabel: session.score > 0 || session.level > 1 || session.elapsedSeconds > 0 ? "继续飞行" : "开始飞行",
            useStageActionButton: true,
            onStart: function () {
                introActive = false;
                if (session.status !== "over") {
                    session.startedAt += Date.now() - introShownAt;
                }
                updateHud();
                persist();
            }
        }));

        updateHud();
        persist();
        if (!session.asteroids.length && session.status === "playing") {
            spawnSpaceRocksWave(session);
        }
        animationId = window.requestAnimationFrame(loop);

        return function cleanup() {
            window.cancelAnimationFrame(animationId);
            document.removeEventListener("keydown", keydown);
            document.removeEventListener("keyup", keyup);
            syncSpaceRocksClock(session);
            persist();
        };
    }

    function getDrawphonePlayerId() {
        const key = "gamesHub.drawphone.playerId";
        let value = "";
        try {
            value = window.localStorage.getItem(key) || "";
            if (!value) {
                value = "dp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
                window.localStorage.setItem(key, value);
            }
        } catch (error) {
            value = "dp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
        }
        return value;
    }

    function drawphoneDraftKey(playerId, roomCode, phase) {
        return ["gamesHub", "drawphone", "draft", playerId || "anon", roomCode || "lobby", phase || "unknown"].join(".");
    }

    function loadDrawphoneDraft(playerId, roomCode, phase) {
        try {
            return window.localStorage.getItem(drawphoneDraftKey(playerId, roomCode, phase)) || "";
        } catch (error) {
            return "";
        }
    }

    function saveDrawphoneDraft(playerId, roomCode, phase, value) {
        try {
            if (!value) {
                window.localStorage.removeItem(drawphoneDraftKey(playerId, roomCode, phase));
                return;
            }
            window.localStorage.setItem(drawphoneDraftKey(playerId, roomCode, phase), value);
        } catch (error) {
            void error;
        }
    }

    function clearDrawphoneDrafts(playerId, roomCode) {
        ["prompt", "draw", "caption"].forEach(function (phase) {
            saveDrawphoneDraft(playerId, roomCode, phase, "");
        });
    }

    function getRememberedDrawphoneRoomCode() {
        try {
            return window.localStorage.getItem("gamesHub.drawphone.roomCode") || "";
        } catch (error) {
            return "";
        }
    }

    function rememberDrawphoneRoomCode(roomCode) {
        try {
            if (!roomCode) {
                window.localStorage.removeItem("gamesHub.drawphone.roomCode");
                return;
            }
            window.localStorage.setItem("gamesHub.drawphone.roomCode", roomCode);
        } catch (error) {
            void error;
        }
    }

    function mountDrawphone() {
        if (typeof window.io !== "function") {
            renderEmptyStage("缺少 Socket.IO 客户端，无法启动本地 Drawphone。");
            return function cleanup() {
                return undefined;
            };
        }

        const playerId = getDrawphonePlayerId();
        const socket = window.io(DRAWHONE_NAMESPACE, {
            transports: ["websocket", "polling"]
        });
        let room = null;
        let roomList = [];
        let currentCanvas = null;
        let isDrawing = false;
        let draftSaveTimer = null;
        const drawphoneHelpConfig = {
            title: "你画我猜",
            subtitle: "低实时性的本地房间玩法，适合随时离开再回来继续。",
            bullets: [
                "1. 每个人先各自提交一个提示词，而且每轮只能提交一次。",
                "2. 系统把提示词传给下一位玩家去画图，草稿会自动保存。",
                "3. 再把图转给下一位玩家去猜一句描述。",
                "4. 全部完成后统一查看 提示词 -> 绘图 -> 猜测 的整条结果链。"
            ],
            hint: "更适合短、具体、容易画的题目，例如“会飞的土豆”或“在月球钓鱼的人”。"
        };

        if (!state.drawphoneRoomCode) {
            state.drawphoneRoomCode = getRememberedDrawphoneRoomCode();
        }
        syncPresence(state.drawphoneRoomCode ? ("Drawphone 房间 " + state.drawphoneRoomCode) : "Drawphone 大厅", state.drawphoneRoomCode);
        postPresence();

        const shell = document.createElement("div");
        shell.className = "game-drawphone-shell";
        shell.innerHTML = [
            '<div class="game-drawphone-toolbar">',
            "  <div>",
            '    <div class="games-section-title">本地房间</div>',
            '    <div class="games-stage-meta" id="drawphoneMeta">创建房间后，可让同一局域网内的朋友直接加入。</div>',
            "  </div>",
            '  <div class="game-stat-grid">',
            '    <div class="game-stat-card"><div class="game-stat-label">房间</div><div class="game-stat-value" id="drawphoneRoomValue">----</div></div>',
            '    <div class="game-stat-card"><div class="game-stat-label">阶段</div><div class="game-stat-value" id="drawphoneStageValue">等待中</div></div>',
            "  </div>",
            "</div>",
            '<div class="game-drawphone-card" id="drawphoneControlCard"></div>',
            '<div class="game-drawphone-card" id="drawphoneGuideCard"></div>',
            '<div class="game-drawphone-card" id="drawphoneActionCard"></div>',
            '<div class="game-drawphone-card" id="drawphoneRevealCard"></div>'
        ].join("");
        els.stageBody.appendChild(shell);
        addStageButton("帮助", function () {
            openGameInfoOverlay(shell, drawphoneHelpConfig);
        }, false);

        const localStatGrid = shell.querySelector(".game-stat-grid");
        const roomValueEl = shell.querySelector("#drawphoneRoomValue");
        const stageValueEl = shell.querySelector("#drawphoneStageValue");
        const metaEl = shell.querySelector("#drawphoneMeta");
        const controlCardEl = shell.querySelector("#drawphoneControlCard");
        const guideCardEl = shell.querySelector("#drawphoneGuideCard");
        const actionCardEl = shell.querySelector("#drawphoneActionCard");
        const revealCardEl = shell.querySelector("#drawphoneRevealCard");

        if (localStatGrid) {
            localStatGrid.hidden = true;
        }

        function emitWithIdentity(eventName, payload) {
            socket.emit(eventName, Object.assign({ player_id: playerId }, payload || {}));
        }

        function inviteLink(code) {
            const url = new URL(window.location.href);
            url.searchParams.set("game", "drawphone");
            url.searchParams.set("room", code);
            return url.toString();
        }

        function scheduleDraftSave(roomCode, phase, value) {
            if (draftSaveTimer) {
                window.clearTimeout(draftSaveTimer);
            }
            draftSaveTimer = window.setTimeout(function () {
                saveDrawphoneDraft(playerId, roomCode, phase, value);
            }, 120);
        }

        function playerDisplay(player) {
            const tags = [];
            if (player.player_id === room.host_player_id) {
                tags.push("房主");
            }
            if (player.is_ready) {
                tags.push("已准备");
            }
            if (!player.is_online) {
                tags.push("离线");
            }
            return escapeHtml(player.display_name) + (tags.length ? (" / " + tags.join(" / ")) : "");
        }

        function stageLabel(stage) {
            if (stage === "prompt") {
                return "出题中";
            }
            if (stage === "draw") {
                return "绘画中";
            }
            if (stage === "caption") {
                return "猜图中";
            }
            if (stage === "reveal") {
                return "已完成";
            }
            return "等待中";
        }

        function syncDrawphoneStageStats() {
            if (!room) {
                setStageStats([
                    { label: "房间", value: "大厅" },
                    { label: "阶段", value: "等待中" },
                    { label: "可加入", value: String(roomList.length) }
                ]);
                return;
            }
            const players = Array.isArray(room.players) ? room.players : [];
            const onlineCount = players.filter(function (player) { return player && player.is_online; }).length;
            setStageStats([
                { label: "房间", value: String(room.room_code || "----") },
                { label: "阶段", value: stageLabel(room.stage || "lobby") },
                { label: "玩家", value: String(players.length) },
                { label: "在线", value: String(onlineCount) }
            ]);
        }

        function renderRoomDirectory() {
            if (room) {
                return "";
            }
            if (!roomList.length) {
                return '<div class="games-empty-list">当前还没有可加入的房间。</div>';
            }
            return '<div class="game-drawphone-room-list">' + roomList.map(function (item) {
                const names = (item.players || []).map(function (player) {
                    return escapeHtml(player.display_name) + (player.is_online ? "" : " / 离线");
                }).join(" / ");
                const resumeText = item.can_resume ? " / 可继续" : "";
                return [
                    '<div class="game-drawphone-room-item">',
                    '  <div>',
                    '    <div class="games-ranking-main">房间 ' + escapeHtml(item.room_code) + " / " + stageLabel(item.stage) + resumeText + "</div>",
                    '    <div class="games-online-meta">玩家 ' + escapeHtml(item.player_count) + ' 人，在线 ' + escapeHtml(item.online_count) + ' 人</div>',
                    '    <div class="games-online-meta">' + names + "</div>",
                    "  </div>",
                    '  <button class="games-btn games-btn--primary" type="button" data-join-room="' + escapeHtml(item.room_code) + '">加入</button>',
                    "</div>"
                ].join("");
            }).join("") + "</div>";
        }

        function renderHistoryPanel() {
            revealCardEl.innerHTML = "";
            if (!room) {
                return;
            }
            const history = (room.round_history || []).slice().reverse();
            if (!history.length) {
                revealCardEl.appendChild(emptyNode("还没有回合历史。"));
                return;
            }
            history.forEach(function (round) {
                const block = document.createElement("div");
                block.className = "game-drawphone-result";
                const results = round.results || [];
                block.innerHTML = [
                    '<div class="games-section-title">第 ' + escapeHtml(round.round_index) + ' 轮</div>',
                    '<div class="games-stage-meta">完成时间：' + escapeHtml(round.completed_at || "") + "</div>"
                ].join("");
                results.forEach(function (item) {
                    const line = document.createElement("div");
                    line.className = "game-drawphone-history-item";
                    line.innerHTML = [
                        "<p><strong>提示词：</strong>" + escapeHtml(item.prompt || "") + " / " + escapeHtml(item.prompt_owner_name || "") + "</p>",
                        '<img class="game-drawphone-preview" src="' + escapeHtml(item.drawing || "") + '" alt="">',
                        "<p><strong>最终描述：</strong>" + escapeHtml(item.caption || "") + " / " + escapeHtml(item.caption_player_name || "") + "</p>"
                    ].join("");
                    block.appendChild(line);
                });
                revealCardEl.appendChild(block);
            });
        }

        function renderGuideCard() {
            if (!guideCardEl) {
                return;
            }
            const phaseGuide = room && room.stage === "prompt"
                ? "当前是出题阶段：每个人写一个简短提示词，并且只能提交一次。"
                : room && room.stage === "draw"
                    ? "当前是绘画阶段：你要画的是别人的提示词，草稿会自动保存在本地，本轮可以随时回来继续。"
                    : room && room.stage === "caption"
                        ? "当前是猜图阶段：看别人提交的图，用一句话猜这画的是什么。"
                        : room && room.stage === "reveal"
                            ? "当前是结算阶段：全部完成后，按每条链路展示 提示词 -> 绘图 -> 猜测。"
                            : "大厅阶段：加入一个房间，所有人准备后由房主开始。";
            guideCardEl.innerHTML = [
                '<div class="games-section-title">游戏流程</div>',
                '<div class="games-stage-meta">1. 每个人先各自写一个提示词。</div>',
                '<div class="games-stage-meta">2. 系统把题传给下一位玩家去画。</div>',
                '<div class="games-stage-meta">3. 再把图转给下一位玩家去猜。</div>',
                '<div class="games-stage-meta">4. 全部完成后统一查看所有人的结果链。</div>',
                '<div class="games-stage-meta">5. 进行中的房间支持中途离开，之后可以回来继续。</div>',
                '<div class="games-stage-meta">提示词建议：短、具体、容易画。例如“会飞的土豆”“穿西装的熊猫”“在月球钓鱼的人”。</div>',
                '<div class="games-stage-meta">' + phaseGuide + "</div>"
            ].join("");
        }

        function renderControlCard() {
            controlCardEl.innerHTML = "";
            if (!room) {
                controlCardEl.innerHTML = [
                    '<div class="games-stage-meta">直接加入现有房间更适合当前玩法；你也可以自己新建一局。</div>',
                    '<div class="games-inline-form">',
                    '  <button class="games-btn games-btn--primary" type="button" id="drawphoneCreateBtn">创建房间</button>',
                    "</div>"
                    + renderRoomDirectory()
                ].join("");
                controlCardEl.querySelector("#drawphoneCreateBtn").addEventListener("click", function () {
                    emitWithIdentity("drawphone_join", {});
                });
                controlCardEl.querySelectorAll("[data-join-room]").forEach(function (btn) {
                    btn.addEventListener("click", function () {
                        emitWithIdentity("drawphone_join", { room_code: btn.getAttribute("data-join-room") || "" });
                    });
                });
                return;
            }

            const players = room.players || [];
            const isHost = room.host_player_id === room.self_player_id;
            const selfPlayer = (room.players || []).find(function (item) {
                return item.player_id === room.self_player_id;
            });
            const readyLabel = selfPlayer && selfPlayer.is_ready ? "取消准备" : "准备";
            controlCardEl.innerHTML = [
                '<div class="games-stage-meta">当前房间状态：</div>',
                '<div class="game-drawphone-room-inline">房间号：<strong>' + escapeHtml(room.room_code) + '</strong></div>',
                '<div class="game-drawphone-players">' + players.map(function (player) {
                    const kickButton = isHost && player.player_id !== room.self_player_id
                        ? '<button class="games-btn game-drawphone-chip-btn" type="button" data-kick-player="' + escapeHtml(player.player_id) + '">踢出</button>'
                        : "";
                    return '<span class="game-drawphone-player-chip">' + playerDisplay(player) + kickButton + "</span>";
                }).join("") + "</div>",
                '<div class="game-drawphone-actions">',
                '<button class="games-btn" type="button" id="drawphoneReadyBtn">' + readyLabel + "</button>",
                (isHost ? '<button class="games-btn games-btn--primary" type="button" id="drawphoneStartBtn">开始一轮</button>' : ""),
                '<button class="games-btn" type="button" id="drawphoneLeaveBtn">离开房间</button>',
                "</div>"
            ].join("");

            controlCardEl.querySelector("#drawphoneReadyBtn").addEventListener("click", function () {
                emitWithIdentity("drawphone_toggle_ready", { room_code: room.room_code });
            });
            const startBtn = controlCardEl.querySelector("#drawphoneStartBtn");
            if (startBtn) {
                startBtn.addEventListener("click", function () {
                    emitWithIdentity("drawphone_start", { room_code: room.room_code });
                });
            }
            controlCardEl.querySelector("#drawphoneLeaveBtn").addEventListener("click", function () {
                emitWithIdentity("drawphone_leave", { room_code: room.room_code });
                clearDrawphoneDrafts(playerId, room.room_code);
                room = null;
                state.drawphoneRoomCode = "";
                rememberDrawphoneRoomCode("");
                syncPresence("Drawphone 大厅", "");
                renderAll();
            });
            controlCardEl.querySelectorAll("[data-kick-player]").forEach(function (btn) {
                btn.addEventListener("click", function () {
                    emitWithIdentity("drawphone_kick", {
                        room_code: room.room_code,
                        target_player_id: btn.getAttribute("data-kick-player") || ""
                    });
                });
            });
        }

        function buildCanvas(container, initialImageUrl, onChange) {
            const canvas = document.createElement("canvas");
            canvas.className = "game-drawphone-canvas";
            canvas.width = 640;
            canvas.height = 480;
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.lineWidth = 4;
            ctx.lineCap = "round";
            ctx.strokeStyle = "#111827";
            if (initialImageUrl) {
                const img = new Image();
                img.onload = function () {
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                };
                img.src = initialImageUrl;
            }

            function point(evt) {
                const rect = canvas.getBoundingClientRect();
                const source = evt.touches ? evt.touches[0] : evt;
                return {
                    x: ((source.clientX - rect.left) / rect.width) * canvas.width,
                    y: ((source.clientY - rect.top) / rect.height) * canvas.height
                };
            }

            function start(evt) {
                isDrawing = true;
                const p = point(evt);
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                evt.preventDefault();
            }

            function move(evt) {
                if (!isDrawing) {
                    return;
                }
                const p = point(evt);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
                evt.preventDefault();
            }

            function end() {
                isDrawing = false;
                if (typeof onChange === "function") {
                    onChange(canvas.toDataURL("image/png"));
                }
            }

            canvas.addEventListener("mousedown", start);
            canvas.addEventListener("mousemove", move);
            canvas.addEventListener("mouseup", end);
            canvas.addEventListener("mouseleave", end);
            canvas.addEventListener("touchstart", start, { passive: false });
            canvas.addEventListener("touchmove", move, { passive: false });
            canvas.addEventListener("touchend", end);
            container.appendChild(canvas);
            return canvas;
        }

        function renderActionCard() {
            actionCardEl.innerHTML = "";
            if (!room) {
                actionCardEl.appendChild(emptyNode("还未进入房间。"));
                renderHistoryPanel();
                return;
            }

            roomValueEl.textContent = room.room_code;
            stageValueEl.textContent = stageLabel(room.stage || "lobby");
            metaEl.textContent =
                "第 " + String(room.round_index || 0) + " 轮 / " +
                (room.stage === "lobby" ? "等待所有玩家准备后开始。" :
                    room.stage === "prompt" ? "每个人只能提交一次提示词，随后交给别人来画。" :
                    room.stage === "draw" ? "画别人的提示词；提交前草稿会自动保存在本地。" :
                    room.stage === "caption" ? "根据别人提交的图写一句最终描述。" :
                    "本轮结果已锁定，可以查看历史并准备下一轮。");
            const selfTurn = room.self_turn || {};
            syncPresence("Drawphone " + String(room.stage || "lobby"), room.room_code);
            postPresence();

            if (room.stage === "lobby") {
                actionCardEl.appendChild(emptyNode("等待房主开始。"));
                renderHistoryPanel();
                return;
            }

            if (room.stage === "prompt") {
                if (selfTurn.submitted_prompt) {
                    actionCardEl.innerHTML = [
                        '<div class="games-stage-meta">你的提示词已提交，等待其他玩家完成。</div>',
                        '<div class="game-drawphone-card"><strong>已提交：</strong>' + escapeHtml(selfTurn.prompt || "") + "</div>"
                    ].join("");
                    renderHistoryPanel();
                    return;
                }
                const draft = loadDrawphoneDraft(playerId, room.room_code, "prompt");
                actionCardEl.innerHTML = [
                    '<div class="games-stage-meta">阶段 1：给下一位玩家出一个简短提示词。</div>',
                    '<textarea class="game-drawphone-textarea" id="drawphonePromptInput" placeholder="例如：会飞的土豆"></textarea>',
                    '<div class="game-drawphone-actions"><button class="games-btn games-btn--primary" type="button" id="drawphonePromptSubmitBtn">提交提示词</button></div>'
                ].join("");
                const input = actionCardEl.querySelector("#drawphonePromptInput");
                input.value = draft;
                input.addEventListener("input", function () {
                    scheduleDraftSave(room.room_code, "prompt", input.value);
                });
                actionCardEl.querySelector("#drawphonePromptSubmitBtn").addEventListener("click", function () {
                    const value = input.value.trim();
                    if (!value) {
                        setStatus("提示词不能为空。", true);
                        return;
                    }
                    saveDrawphoneDraft(playerId, room.room_code, "prompt", "");
                    emitWithIdentity("drawphone_submit_prompt", { room_code: room.room_code, prompt: value });
                });
                renderHistoryPanel();
                return;
            }

            if (room.stage === "draw") {
                if (selfTurn.submitted_drawing) {
                    actionCardEl.innerHTML = [
                        '<div class="games-stage-meta">你的绘图已提交，等待其他玩家完成。</div>',
                        '<img class="game-drawphone-preview" src="' + escapeHtml(selfTurn.drawing || "") + '" alt="">'
                    ].join("");
                    renderHistoryPanel();
                    return;
                }
                const draftDrawing = loadDrawphoneDraft(playerId, room.room_code, "draw");
                actionCardEl.innerHTML = [
                    '<div class="games-stage-meta">阶段 2：根据收到的提示词作画。</div>',
                    '<div class="game-drawphone-card">收到的提示词：<strong>' + escapeHtml(selfTurn.draw_for_prompt || "") + "</strong></div>",
                    '<div class="game-drawphone-canvas-wrap" id="drawphoneCanvasWrap"></div>',
                    '<div class="game-drawphone-actions"><button class="games-btn" type="button" id="drawphoneCanvasClearBtn">清空画布</button><button class="games-btn games-btn--primary" type="button" id="drawphoneDrawingSubmitBtn">提交绘图</button></div>'
                ].join("");
                const wrap = actionCardEl.querySelector("#drawphoneCanvasWrap");
                currentCanvas = buildCanvas(wrap, draftDrawing || selfTurn.drawing || "", function (imageData) {
                    saveDrawphoneDraft(playerId, room.room_code, "draw", imageData);
                });
                actionCardEl.querySelector("#drawphoneCanvasClearBtn").addEventListener("click", function () {
                    const ctx = currentCanvas.getContext("2d");
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, currentCanvas.width, currentCanvas.height);
                    saveDrawphoneDraft(playerId, room.room_code, "draw", currentCanvas.toDataURL("image/png"));
                });
                actionCardEl.querySelector("#drawphoneDrawingSubmitBtn").addEventListener("click", function () {
                    const imageData = currentCanvas.toDataURL("image/png");
                    saveDrawphoneDraft(playerId, room.room_code, "draw", "");
                    emitWithIdentity("drawphone_submit_drawing", { room_code: room.room_code, drawing: imageData });
                });
                renderHistoryPanel();
                return;
            }

            if (room.stage === "caption") {
                if (selfTurn.submitted_caption) {
                    actionCardEl.innerHTML = [
                        '<div class="games-stage-meta">你的描述已提交，等待其他玩家完成。</div>',
                        '<img class="game-drawphone-preview" src="' + escapeHtml(selfTurn.caption_for_drawing || "") + '" alt="">',
                        '<div class="game-drawphone-card"><strong>已提交：</strong>' + escapeHtml(selfTurn.caption || "") + "</div>"
                    ].join("");
                    renderHistoryPanel();
                    return;
                }
                const draftCaption = loadDrawphoneDraft(playerId, room.room_code, "caption");
                actionCardEl.innerHTML = [
                    '<div class="games-stage-meta">阶段 3：看图写一句描述。</div>',
                    '<img class="game-drawphone-preview" src="' + escapeHtml(selfTurn.caption_for_drawing || "") + '" alt="">',
                    '<textarea class="game-drawphone-textarea" id="drawphoneCaptionInput" placeholder="你看到了什么？"></textarea>',
                    '<div class="game-drawphone-actions"><button class="games-btn games-btn--primary" type="button" id="drawphoneCaptionSubmitBtn">提交描述</button></div>'
                ].join("");
                const captionInput = actionCardEl.querySelector("#drawphoneCaptionInput");
                captionInput.value = draftCaption;
                captionInput.addEventListener("input", function () {
                    scheduleDraftSave(room.room_code, "caption", captionInput.value);
                });
                actionCardEl.querySelector("#drawphoneCaptionSubmitBtn").addEventListener("click", function () {
                    const value = captionInput.value.trim();
                    if (!value) {
                        setStatus("描述不能为空。", true);
                        return;
                    }
                    saveDrawphoneDraft(playerId, room.room_code, "caption", "");
                    emitWithIdentity("drawphone_submit_caption", { room_code: room.room_code, caption: value });
                });
                renderHistoryPanel();
                return;
            }

            if (room.stage === "reveal") {
                actionCardEl.appendChild(emptyNode("本轮已完成，结果和历史见下方。"));
                renderHistoryPanel();
            }
        }

        function renderAll() {
            if (!room) {
                roomValueEl.textContent = "----";
                stageValueEl.textContent = "等待中";
                metaEl.textContent = "查看现有房间直接加入，或者自己新建一局。";
            }
            syncDrawphoneStageStats();
            renderControlCard();
            renderGuideCard();
            renderActionCard();
        }

        socket.on("drawphone_room", function (payload) {
            room = payload;
            state.drawphoneRoomCode = payload.room_code || "";
            rememberDrawphoneRoomCode(state.drawphoneRoomCode);
            renderAll();
        });

        socket.on("drawphone_rooms", function (payload) {
            roomList = Array.isArray(payload) ? payload : [];
            if (!room) {
                syncDrawphoneStageStats();
            }
            renderControlCard();
        });

        socket.on("drawphone_kicked", function (payload) {
            if (payload && payload.target_player_id === playerId) {
                room = null;
                state.drawphoneRoomCode = "";
                rememberDrawphoneRoomCode("");
                clearDrawphoneDrafts(playerId, payload.room_code || "");
                renderAll();
                setStatus("你已被房主移出房间。", true);
            }
        });

        socket.on("drawphone_error", function (payload) {
            setStatus((payload && payload.error) || "Drawphone 操作失败", true);
        });

        socket.on("connect", function () {
            setStatus("Drawphone 已连接本地房间服务。", false);
            if (state.drawphoneRoomCode) {
                emitWithIdentity("drawphone_join", { room_code: state.drawphoneRoomCode });
            }
        });

        socket.on("disconnect", function () {
            setStatus("Drawphone 连接已断开。", true);
        });

        renderAll();

        return function cleanup() {
            if (draftSaveTimer) {
                window.clearTimeout(draftSaveTimer);
            }
            socket.disconnect();
        };
    }

    function bindStaticEvents() {
        if (els.profileSaveBtn) {
            els.profileSaveBtn.addEventListener("click", function () {
                saveProfile().catch(function (error) {
                    setStatus(error.message || "资料保存失败", true);
                });
            });
        }
        if (els.avatarUploadBtn) {
            els.avatarUploadBtn.addEventListener("click", function () {
                uploadAvatar().catch(function (error) {
                    setStatus(error.message || "头像上传失败", true);
                });
            });
        }
        if (els.profileEditBtn) {
            els.profileEditBtn.addEventListener("click", openProfileModal);
        }
        if (els.insightsBtn) {
            els.insightsBtn.addEventListener("click", openInsightsModal);
        }
        if (els.bossKeyBtn) {
            els.bossKeyBtn.addEventListener("click", triggerBossKey);
        }
        if (els.bossKeySelect) {
            els.bossKeySelect.addEventListener("change", renderBossKeyHint);
        }
        if (els.bossPathInput) {
            els.bossPathInput.addEventListener("input", renderBossKeyHint);
        }
        document.querySelectorAll("[data-close-profile-modal]").forEach(function (node) {
            node.addEventListener("click", closeProfileModal);
        });
        document.querySelectorAll("[data-close-insights-modal]").forEach(function (node) {
            node.addEventListener("click", closeInsightsModal);
        });
        document.addEventListener("keydown", function (event) {
            if (isBossKeyEvent(event)) {
                event.preventDefault();
                triggerBossKey();
            }
            if (event.key === "Escape") {
                closeProfileModal();
                closeInsightsModal();
            }
        });
    }

    async function init() {
        bindStaticEvents();
        try {
            await Promise.all([loadProfile(), loadManifest(), refreshScorePanels(), loadOnlineVisitors()]);
            state.activeGameId = config.initialGameId || (((state.manifest.games || [])[0] || {}).id) || null;
            renderGameNav();
            startPresenceLoop();
            if (state.activeGameId) {
                await launchGame(state.activeGameId);
            } else {
                renderEmptyStage("资源清单为空，请先挂载游戏资源。");
            }
            setStatus("Games Hub 已就绪", false);
        } catch (error) {
            clearStage();
            renderEmptyStage("Games Hub 初始化失败，请检查接口和静态资源。");
            setStatus(error.message || "加载失败", true);
        }
    }

    init();
})();

