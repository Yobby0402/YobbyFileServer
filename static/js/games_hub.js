(function () {
    "use strict";

    const config = window.gamesHubConfig || {};
    const GAMES_THEME_SCHEME_KEY = "games_theme_scheme";
    const GAMES_RUNTIME_STATE_PREFIX = "games_runtime_state:";
    const TOPDOWN_SCORE_SOFT_CAP = Math.max(0, Number(config.topdownScoreSoftCap || 100000));
    const GOMOKU_NAMESPACE = "/games-gomoku";
    const ZHAJINHUA_NAMESPACE = "/games-zhajinhua";
    const GAMES_CHAT_NAMESPACE = "/games-chat";
    const GAMES_SCRIPT_BASE_URL = (document.currentScript && document.currentScript.src)
        ? new URL(".", document.currentScript.src).href
        : "/static/js/";
    const GAME_MODULE_SCRIPTS = {
        "2048": "games/game_2048.js",
        sudoku: "games/game_sudoku.js",
        frontline: "games/game_frontline.js",
        gomoku: "games/game_gomoku.js",
        zhajinhua: "games/game_zhajinhua.js",
        "topdown-shooter": "games/game_topdown.js"
    };

    const state = {
        manifest: { games: [] },
        profile: null,
        history: [],
        leaderboards: null,
        onlineVisitors: [],
        onlineSelfIdentity: "",
        onlineLoadToken: 0,
        activeGameId: null,
        activeCleanup: null,
        saveTimers: Object.create(null),
        savedFingerprints: Object.create(null),
        presenceTimer: null,
        onlineTimer: null,
        presenceHooksReady: false,
        topdownMetaState: null,
        topdownMetaRefresh: null,
        topdownMetaBeforeOpen: null,
        currentPresence: {
            current_game: "",
            play_status: "空闲中",
            room_code: ""
        },
        launchToken: 0,
        gamesChat: {
            socket: null,
            messages: [],
            draft: "",
            isOpen: false,
            unreadCount: 0,
            initialized: false,
            transportLabel: "WEBSOCKET",
            nextLocalSequence: 0
        }
    };
    const gameModules = Object.create(null);
    const gameModuleLoadPromises = Object.create(null);

    function fnv1aHash(input) {
        let hash = 0x811c9dc5;
        const value = String(input || "");
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
    }

    function computeFingerprintDeviceId() {
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

    function createRandomDeviceId(prefix) {
        const lead = String(prefix || "hw-");
        try {
            if (window.crypto && crypto.getRandomValues) {
                const bytes = new Uint8Array(12);
                crypto.getRandomValues(bytes);
                const token = Array.from(bytes).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
                return lead + token;
            }
        } catch (error) {
            void error;
        }
        return lead + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
    }

    function getGamesDeviceId() {
        if (window.__gamesDeviceId) {
            return String(window.__gamesDeviceId);
        }
        if (window.__nativeMachineId) {
            window.__gamesDeviceId = String(window.__nativeMachineId);
            return String(window.__gamesDeviceId);
        }

        try {
            if (window.localStorage) {
                const stored = String(localStorage.getItem("games-device-id") || "").trim();
                if (stored) {
                    window.__gamesDeviceId = stored;
                    return stored;
                }
            }
        } catch (error) {
            void error;
        }

        const legacy = computeFingerprintDeviceId();
        const next = createRandomDeviceId("hw-");
        try {
            if (window.localStorage) {
                localStorage.setItem("games-device-id", next);
            }
            if (window.sessionStorage) {
                const legacyStored = String(sessionStorage.getItem("games-legacy-device-id") || "").trim();
                if (!legacyStored) {
                    sessionStorage.setItem("games-legacy-device-id", legacy);
                }
            }
        } catch (error) {
            void error;
        }
        window.__gamesDeviceId = next;
        return next;
    }

    const els = {
        navList: document.getElementById("gamesNavList"),
        manifestList: document.getElementById("gamesManifestList"),
        stage: document.querySelector(".games-stage"),
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
        metaEntryBtn: null,
        historyList: document.getElementById("gamesHistoryList"),
        weeklyTotalList: document.getElementById("gamesWeeklyTotalList"),
        weeklyGameList: document.getElementById("gamesWeeklyGameList"),
        weeklyGameTitle: document.getElementById("gamesWeeklyGameTitle"),
        weekKey: document.getElementById("gamesWeekKey"),
        themeToggleBtn: document.getElementById("gamesThemeToggleBtn")
    };

    function normalizeGamesThemeScheme(value) {
        return String(value || "").trim().toLowerCase() === "light" ? "light" : "dark";
    }

    function applyGamesThemeScheme(scheme) {
        const nextScheme = normalizeGamesThemeScheme(scheme);
        if (document.body) {
            document.body.setAttribute("data-games-scheme", nextScheme);
        }
        if (els.themeToggleBtn) {
            els.themeToggleBtn.textContent = "主题: " + (nextScheme === "light" ? "亮色" : "暗色");
        }
        return nextScheme;
    }

    function initGamesThemeScheme() {
        let scheme = "dark";
        try {
            scheme = normalizeGamesThemeScheme(window.localStorage.getItem(GAMES_THEME_SCHEME_KEY) || "dark");
        } catch (error) {
            scheme = "dark";
        }
        applyGamesThemeScheme(scheme);
        if (els.themeToggleBtn) {
            els.themeToggleBtn.addEventListener("click", function () {
                const current = normalizeGamesThemeScheme(document.body && document.body.getAttribute("data-games-scheme"));
                const next = current === "light" ? "dark" : "light";
                applyGamesThemeScheme(next);
                try {
                    window.localStorage.setItem(GAMES_THEME_SCHEME_KEY, next);
                } catch (error) {
                    // Ignore persistence failures and keep the runtime switch.
                }
            });
        }
    }

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

    function getRuntimeStateCacheKey(gameId) {
        return GAMES_RUNTIME_STATE_PREFIX + String(gameId || "");
    }

    function cacheRuntimeGameState(gameId, gameState, summary) {
        try {
            window.sessionStorage.setItem(getRuntimeStateCacheKey(gameId), JSON.stringify({
                state: gameState || {},
                summary: summary || {},
                savedAt: Date.now()
            }));
        } catch (error) {
            void error;
        }
    }

    function loadCachedRuntimeGameState(gameId) {
        try {
            const raw = window.sessionStorage.getItem(getRuntimeStateCacheKey(gameId));
            if (!raw) {
                return null;
            }
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return null;
            }
            return {
                state: parsed.state || {},
                summary: parsed.summary || {}
            };
        } catch (error) {
            return null;
        }
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
        if (host && host.__gameStartOverlayController && typeof host.__gameStartOverlayController.dismiss === "function") {
            host.__gameStartOverlayController.dismiss();
        }
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

        function closeOverlay(triggerStart) {
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
                if (host && host.__gameStartOverlayController === controller) {
                    host.__gameStartOverlayController = null;
                }
            }, 220);
            if (triggerStart && typeof config.onStart === "function") {
                config.onStart();
            }
        }

        function startNow() {
            closeOverlay(true);
        }

        if (config.useStageActionButton) {
            stageButton = addStageButton(config.buttonLabel, startNow, true);
            stageButton.classList.add("game-start-stage-action");
        } else if (button) {
            button.addEventListener("click", startNow);
        }
        const controller = {
            isActive: function () {
                return active;
            },
            dismiss: function () {
                closeOverlay(false);
            }
        };
        if (host) {
            host.__gameStartOverlayController = controller;
        }
        return controller;
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

    function renderAchievementBadgeInline(badge) {
        const safeBadge = badge && typeof badge === "object" ? badge : {};
        const id = String(safeBadge.id || "").trim();
        const glyph = String(safeBadge.glyph || "").trim();
        if (!id || !glyph) {
            return "";
        }
        const tier = topdownAchievementTierTheme(safeBadge.tier).key;
        const label = escapeHtml(String(safeBadge.name || "成就徽章"));
        return '<span class="games-achievement-badge games-achievement-badge--' + tier + '" title="' + label + '">' + escapeHtml(glyph) + "</span>";
    }

    function renderRankedName(entry) {
        const rank = entry && entry.rank ? entry.rank : { key: "blackiron", name: "黑铁" };
        const displayName = escapeHtml(entry.display_name || "");
        const totalScore = Number(entry.lifetime_score != null ? entry.lifetime_score : (entry.total_score != null ? entry.total_score : 0));
        const achievementBadge = renderAchievementBadgeInline(entry && (entry.achievement_badge || entry.selected_achievement_badge));
        return [
            '<span class="games-rank-badge ' + getRankTierClass(rank) + '">' + escapeHtml(rank.name || "黑铁") + "</span>",
            '<span class="games-ranked-name ' + getRankTierClass(rank) + '">' + displayName + "</span>",
            achievementBadge,
            '<span class="games-ranked-total">总积分 ' + escapeHtml(totalScore) + "</span>"
        ].filter(Boolean).join(" ");
    }

    function renderProfile(profile) {
        state.profile = profile;
        state.onlineSelfIdentity = String((profile && (profile.identity || profile.ip)) || state.onlineSelfIdentity || "");
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
        renderGamesChatWidget();
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

    function ensureProfileMetaEntryButton() {
        if (els.metaEntryBtn) {
            return els.metaEntryBtn;
        }
        const anchor = document.querySelector(".games-profile-inline");
        if (!anchor || !anchor.parentNode) {
            return null;
        }
        const button = document.createElement("button");
        button.type = "button";
        button.id = "gamesMetaEntryBtn";
        button.className = "games-meta-entry-btn";
        button.innerHTML = [
            '<span class="games-meta-entry-mark">★</span>',
            '<span class="games-meta-entry-copy">',
            '  <strong>局外养成</strong>',
            '  <small>抽奖 / 装备 / 全游戏外观</small>',
            '</span>'
        ].join("");
        button.addEventListener("click", function () {
            openTopdownMetaModal().catch(function (error) {
                setStatus(error.message || "局外养成打开失败", true);
            });
        });
        anchor.insertAdjacentElement("afterend", button);
        els.metaEntryBtn = button;
        return button;
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

    function gameNavIconLabel(game) {
        const id = String((game && game.id) || "").toLowerCase();
        const iconMap = {
            "2048": "2048",
            sudoku: "数",
            gomoku: "五",
            zhajinhua: "炸",
            frontline: "攻",
            "topdown-shooter": "射"
        };
        if (iconMap[id]) {
            return iconMap[id];
        }
        const title = String((game && (game.title || game.id)) || "?").trim();
        return title.slice(0, 2).toUpperCase();
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
            const title = game.title || game.id || "游戏";
            const summary = game.summary || "暂无说明";
            const tooltip = title + " · " + summary;
            button.title = tooltip;
            button.setAttribute("aria-label", tooltip);
            button.setAttribute("data-tooltip", tooltip);
            button.innerHTML = [
                '<span class="games-nav-icon" aria-hidden="true">' + escapeHtml(gameNavIconLabel(game)) + "</span>",
                '<span class="games-nav-title">' + escapeHtml(title) + "</span>"
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
        const selfIdentities = getSelfIdentitySet();
        const others = state.onlineVisitors.filter(function (visitor) {
            const visitorIdentity = getVisitorIdentity(visitor);
            return visitorIdentity && !selfIdentities.has(visitorIdentity);
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

    function getVisitorIdentity(visitor) {
        return String((visitor && (visitor.identity || visitor.ip)) || "").trim();
    }

    function getSelfIdentitySet() {
        const values = [
            state.onlineSelfIdentity,
            state.profile && state.profile.identity,
            state.profile && state.profile.ip,
            getGamesDeviceId()
        ];
        const identities = new Set();
        values.forEach(function (value) {
            const normalized = String(value || "").trim();
            if (normalized) {
                identities.add(normalized);
            }
        });
        return identities;
    }

    function normalizeOnlineVisitorsPayload(payload) {
        if (Array.isArray(payload)) {
            return {
                selfIdentity: state.onlineSelfIdentity || String((state.profile && (state.profile.identity || state.profile.ip)) || getGamesDeviceId()),
                visitors: payload
            };
        }
        return {
            selfIdentity: String((payload && payload.self_identity) || state.onlineSelfIdentity || (state.profile && (state.profile.identity || state.profile.ip)) || getGamesDeviceId()),
            visitors: Array.isArray(payload && payload.visitors) ? payload.visitors : []
        };
    }

    function normalizeOnlineVisitorsList(list) {
        const latestByIdentity = new Map();
        (Array.isArray(list) ? list : []).forEach(function (visitor) {
            const identity = getVisitorIdentity(visitor);
            if (!identity) {
                return;
            }
            const normalized = Object.assign({}, visitor, { identity: identity, ip: String(visitor.ip || identity) });
            const previous = latestByIdentity.get(identity);
            if (!previous) {
                latestByIdentity.set(identity, normalized);
                return;
            }
            const previousAge = Number(previous.age_seconds);
            const nextAge = Number(normalized.age_seconds);
            const previousTime = Date.parse(previous.last_seen || "") || 0;
            const nextTime = Date.parse(normalized.last_seen || "") || 0;
            if ((Number.isFinite(nextAge) && Number.isFinite(previousAge) && nextAge < previousAge) || nextTime > previousTime) {
                latestByIdentity.set(identity, normalized);
            }
        });
        return Array.from(latestByIdentity.values()).sort(function (left, right) {
            const ageDiff = Number(left.age_seconds || 0) - Number(right.age_seconds || 0);
            if (ageDiff !== 0) {
                return ageDiff;
            }
            return String(left.display_name || "").localeCompare(String(right.display_name || ""), "zh-CN");
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

    function currentGameTitle() {
        const game = (state.manifest.games || []).find(function (item) {
            return item && item.id === state.activeGameId;
        });
        return game ? String(game.title || game.id || "") : "";
    }

    function normalizeGamesChatMessage(entry) {
        if (!entry || typeof entry !== "object") {
            return null;
        }
        const content = String(entry.content || "").trim();
        if (!content) {
            return null;
        }
        return {
            message_id: String(entry.message_id || "").trim(),
            client_message_id: String(entry.client_message_id || "").trim(),
            player_id: String(entry.player_id || "").trim(),
            display_name: String(entry.display_name || "玩家").trim() || "玩家",
            avatar_url: String(entry.avatar_url || "").trim(),
            content: content,
            created_at: String(entry.created_at || "").trim(),
            current_game: String(entry.current_game || "").trim(),
            current_game_label: String(entry.current_game_label || "").trim(),
            is_local_pending: Boolean(entry.is_local_pending)
        };
    }

    function isSameGamesChatMessage(left, right) {
        if (!left || !right) {
            return false;
        }
        if (left.message_id && right.message_id && left.message_id === right.message_id) {
            return true;
        }
        return Boolean(
            left.client_message_id
            && right.client_message_id
            && left.client_message_id === right.client_message_id
            && left.player_id === right.player_id
        );
    }

    function formatGamesChatTime(value) {
        const parsed = Date.parse(String(value || ""));
        if (!Number.isFinite(parsed)) {
            return "";
        }
        const date = new Date(parsed);
        return String(date.getHours()).padStart(2, "0") + ":" + String(date.getMinutes()).padStart(2, "0");
    }

    function ensureGamesChatWidget() {
        if (!els.stage) {
            return null;
        }
        let widget = els.stage.querySelector("#gamesHubChatWidget");
        if (!widget) {
            widget = document.createElement("div");
            widget.id = "gamesHubChatWidget";
            widget.className = "games-hub-chat-float";
            els.stage.appendChild(widget);
        }
        return widget;
    }

    function scrollGamesChatToBottom() {
        const list = document.getElementById("gamesHubChatList");
        if (!list) {
            return;
        }
        window.requestAnimationFrame(function () {
            list.scrollTop = list.scrollHeight;
        });
    }

    function renderGamesChatWidget() {
        const widget = ensureGamesChatWidget();
        if (!widget) {
            return;
        }
        const chatState = state.gamesChat;
        const playerId = getGamesDeviceId();
        const unreadLabel = chatState.unreadCount > 99 ? "99+" : String(chatState.unreadCount || "");
        const messagesHtml = chatState.messages.length
            ? chatState.messages.map(function (entry) {
                const isSelf = entry.player_id === playerId;
                const avatar = entry.avatar_url
                    ? '<img class="games-hub-chat-avatar-image" src="' + escapeHtml(entry.avatar_url) + '" alt="">'
                    : '<span class="games-hub-chat-avatar-fallback">' + escapeHtml(String(entry.display_name || "玩").slice(0, 1).toUpperCase()) + '</span>';
                const metaBits = [formatGamesChatTime(entry.created_at)];
                if (entry.current_game_label) {
                    metaBits.push(entry.current_game_label);
                }
                if (entry.is_local_pending) {
                    metaBits.push("发送中");
                }
                return [
                    '<div class="games-hub-chat-message' + (isSelf ? ' is-self' : '') + (entry.is_local_pending ? ' is-pending' : '') + '">',
                    '  <div class="games-hub-chat-avatar">' + avatar + '</div>',
                    '  <div class="games-hub-chat-bubble">',
                    '    <div class="games-hub-chat-author">' + escapeHtml(entry.display_name || "玩家") + '</div>',
                    '    <div class="games-hub-chat-text">' + escapeHtml(entry.content || "") + '</div>',
                    '    <div class="games-hub-chat-meta">' + escapeHtml(metaBits.filter(Boolean).join(" · ")) + '</div>',
                    "  </div>",
                    "</div>"
                ].join("");
            }).join("")
            : '<div class="games-hub-chat-empty">现在还没有消息，先打个招呼吧。</div>';
        const panelHtml = chatState.isOpen ? [
            '<section class="games-hub-chat-panel" aria-label="全局聊天窗口">',
            '  <div class="games-hub-chat-head">',
            '    <div>',
            '      <div class="games-hub-chat-title">全局聊天</div>',
            '      <div class="games-hub-chat-subtitle">当前游戏页内所有在线用户都能看到</div>',
            "    </div>",
            '    <button type="button" class="games-hub-chat-close" id="gamesHubChatCloseBtn" aria-label="关闭聊天窗口">&times;</button>',
            "  </div>",
            '  <div class="games-hub-chat-list" id="gamesHubChatList">' + messagesHtml + "</div>",
            '  <form class="games-hub-chat-compose" id="gamesHubChatForm">',
            '    <input type="text" class="games-text-input games-hub-chat-input" id="gamesHubChatInput" maxlength="160" placeholder="给游戏页里的大家发句话" value="' + escapeHtml(chatState.draft || "") + '">',
            '    <button type="submit" class="games-btn games-btn--primary"' + (chatState.socket && chatState.socket.connected ? "" : " disabled") + '>发送</button>',
            "  </form>",
            '  <div class="games-hub-chat-status">' + escapeHtml((chatState.socket && chatState.socket.connected) ? ("已通过 " + chatState.transportLabel + " 连接") : "聊天连接中断，暂时无法发送") + "</div>",
            "</section>"
        ].join("") : "";
        widget.innerHTML = [
            panelHtml,
            '<button type="button" class="games-hub-chat-toggle" id="gamesHubChatToggle" aria-expanded="' + (chatState.isOpen ? "true" : "false") + '" aria-label="打开全局聊天">',
            '  <i class="fa fa-comments" aria-hidden="true"></i>',
            (chatState.unreadCount > 0 ? '<span class="games-hub-chat-badge">' + escapeHtml(unreadLabel) + '</span>' : ""),
            "</button>"
        ].join("");
        const toggleBtn = widget.querySelector("#gamesHubChatToggle");
        if (toggleBtn) {
            toggleBtn.addEventListener("click", function () {
                state.gamesChat.isOpen = !state.gamesChat.isOpen;
                if (state.gamesChat.isOpen) {
                    state.gamesChat.unreadCount = 0;
                }
                renderGamesChatWidget();
                if (state.gamesChat.isOpen) {
                    scrollGamesChatToBottom();
                    const input = document.getElementById("gamesHubChatInput");
                    if (input) {
                        input.focus();
                    }
                }
            });
        }
        const closeBtn = widget.querySelector("#gamesHubChatCloseBtn");
        if (closeBtn) {
            closeBtn.addEventListener("click", function () {
                state.gamesChat.isOpen = false;
                renderGamesChatWidget();
            });
        }
        const input = widget.querySelector("#gamesHubChatInput");
        if (input) {
            input.addEventListener("input", function () {
                state.gamesChat.draft = input.value || "";
            });
        }
        const form = widget.querySelector("#gamesHubChatForm");
        if (form) {
            form.addEventListener("submit", function (event) {
                event.preventDefault();
                sendGamesChatMessage();
            });
        }
        if (chatState.isOpen) {
            scrollGamesChatToBottom();
        }
    }

    function applyGamesChatMessages(messages, replaceAll) {
        const normalized = (Array.isArray(messages) ? messages : []).map(normalizeGamesChatMessage).filter(Boolean);
        if (replaceAll) {
            const pendingLocals = state.gamesChat.messages.filter(function (entry) {
                return entry && entry.is_local_pending;
            });
            const nextMessages = normalized.slice();
            pendingLocals.forEach(function (entry) {
                if (!nextMessages.some(function (candidate) { return isSameGamesChatMessage(candidate, entry); })) {
                    nextMessages.push(entry);
                }
            });
            state.gamesChat.messages = nextMessages.slice(-50);
            renderGamesChatWidget();
            return;
        }
        normalized.forEach(function (incoming) {
            const index = state.gamesChat.messages.findIndex(function (entry) {
                return isSameGamesChatMessage(entry, incoming);
            });
            if (index >= 0) {
                state.gamesChat.messages.splice(index, 1, incoming);
            } else {
                state.gamesChat.messages.push(incoming);
            }
            if (
                state.gamesChat.initialized
                && !state.gamesChat.isOpen
                && incoming.player_id
                && incoming.player_id !== getGamesDeviceId()
            ) {
                state.gamesChat.unreadCount = Math.min(99, Number(state.gamesChat.unreadCount || 0) + 1);
            }
        });
        state.gamesChat.messages = state.gamesChat.messages.slice(-50);
        renderGamesChatWidget();
    }

    function sendGamesChatMessage() {
        const chatState = state.gamesChat;
        const socket = chatState.socket;
        const content = String(chatState.draft || "").trim();
        if (!content) {
            return;
        }
        if (!socket || !socket.connected) {
            setStatus("全局聊天暂未连上，消息没有发出。", true);
            return;
        }
        const clientMessageId = getGamesDeviceId() + "-" + String(Date.now()) + "-" + String(chatState.nextLocalSequence++);
        chatState.messages.push({
            message_id: "local-" + clientMessageId,
            client_message_id: clientMessageId,
            player_id: getGamesDeviceId(),
            display_name: String((state.profile && state.profile.display_name) || (state.profile && state.profile.nickname) || "你"),
            avatar_url: String((state.profile && state.profile.avatar_url) || ""),
            content: content,
            created_at: new Date().toISOString(),
            current_game: state.activeGameId || "",
            current_game_label: currentGameTitle(),
            is_local_pending: true
        });
        chatState.messages = chatState.messages.slice(-50);
        chatState.draft = "";
        renderGamesChatWidget();
        socket.emit("games_chat_send", {
            client_message_id: clientMessageId,
            content: content,
            current_game: state.activeGameId || "",
            current_game_label: currentGameTitle()
        });
    }

    function refreshGamesChatTransportLabel() {
        try {
            const engine = state.gamesChat.socket && state.gamesChat.socket.io && state.gamesChat.socket.io.engine
                ? state.gamesChat.socket.io.engine
                : null;
            state.gamesChat.transportLabel = String((engine && engine.transport && engine.transport.name) || "websocket").toUpperCase();
        } catch (error) {
            state.gamesChat.transportLabel = "WEBSOCKET";
        }
    }

        function initGamesChat() {
            renderGamesChatWidget();
            if (state.gamesChat.socket || !window.io) {
                return;
            }
            const socket = window.io(GAMES_CHAT_NAMESPACE, {
                transports: ["polling", "websocket"],
                upgrade: true,
                rememberUpgrade: true,
                timeout: 8000
            });
            state.gamesChat.socket = socket;
            socket.on("connect", function () {
                refreshGamesChatTransportLabel();
                socket.emit("games_chat_join");
            renderGamesChatWidget();
        });
        socket.on("games_chat_snapshot", function (payload) {
            applyGamesChatMessages(payload && payload.messages, true);
            state.gamesChat.initialized = true;
        });
        socket.on("games_chat_message", function (payload) {
            applyGamesChatMessages([payload], false);
        });
        socket.on("games_chat_error", function (payload) {
            setStatus((payload && payload.error) || "全局聊天发送失败", true);
        });
        socket.on("connect_error", function () {
            renderGamesChatWidget();
        });
        socket.on("disconnect", function () {
            renderGamesChatWidget();
        });
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
        const token = ++state.onlineLoadToken;
        const payload = await requestJson(config.onlineUrl, { method: "GET" });
        if (token !== state.onlineLoadToken) {
            return;
        }
        const normalized = normalizeOnlineVisitorsPayload(payload);
        state.onlineSelfIdentity = normalized.selfIdentity;
        state.onlineVisitors = normalizeOnlineVisitorsList(normalized.visitors);
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

    function scheduleGameStateSave(gameId, gameState, summary, options) {
        const saveOptions = options && typeof options === "object" ? options : {};
        cacheRuntimeGameState(gameId, gameState, summary);
        if (saveOptions.localOnly) {
            return;
        }
        const fingerprint = JSON.stringify({
            state: gameState || {},
            summary: summary || {}
        });
        if (!saveOptions.force && state.savedFingerprints[gameId] === fingerprint) {
            return;
        }
        if (state.saveTimers[gameId]) {
            window.clearTimeout(state.saveTimers[gameId]);
        }
        state.saveTimers[gameId] = window.setTimeout(function () {
            requestJson(getStateUrl(gameId), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ state: gameState || {}, summary: summary || {} })
            }).then(function () {
                state.savedFingerprints[gameId] = fingerprint;
            }).catch(function (error) {
                setStatus(error.message || "进度保存失败", true);
            });
        }, 280);
    }

    async function loadGameState(gameId, options) {
        const loadOptions = options && typeof options === "object" ? options : {};
        if (!loadOptions.preferRemote) {
            const cached = loadCachedRuntimeGameState(gameId);
            if (cached) {
                return cached;
            }
        }
        const payload = await requestJson(getStateUrl(gameId), { method: "GET" });
        cacheRuntimeGameState(gameId, payload && payload.state, payload && payload.summary);
        return payload;
    }

    function createGameModuleContext() {
        return {
            config: config,
            state: state,
            els: els,
            escapeHtml: escapeHtml,
            formatSeconds: formatSeconds,
            addStageButton: addStageButton,
            addStageTagButton: addStageTagButton,
            setStageStats: setStageStats,
            scheduleGameStateSave: scheduleGameStateSave,
            submitScore: submitScore,
            syncPresence: syncPresence,
            setStatus: setStatus,
            requestJson: requestJson,
            loadProfile: loadProfile,
            refreshScorePanels: refreshScorePanels,
            openGameInfoOverlay: openGameInfoOverlay,
            createGameStartOverlay: createGameStartOverlay,
            createArcadeShell: createArcadeShell,
            setArcadeStats: setArcadeStats,
            setArcadeList: setArcadeList,
            randomBetween: randomBetween,
            clamp: clamp,
            distanceBetween: distanceBetween,
            getGamesDeviceId: getGamesDeviceId,
            GOMOKU_NAMESPACE: GOMOKU_NAMESPACE,
            ZHAJINHUA_NAMESPACE: ZHAJINHUA_NAMESPACE,
            setTopdownSharedMetaState: setTopdownSharedMetaState,
            getTopdownSharedMetaState: getTopdownSharedMetaState,
            normalizeTopdownMetaState: normalizeTopdownMetaState,
            serializeTopdownMetaState: serializeTopdownMetaState,
            summarizeTopdownMetaState: summarizeTopdownMetaState,
            frontlineBuildMetaBonuses: frontlineBuildMetaBonuses,
            topdownEquippedAppearance: topdownEquippedAppearance,
            topdownColorCatalog: topdownColorCatalog,
            topdownIconCatalog: topdownIconCatalog,
            topdownBackgroundCatalog: topdownBackgroundCatalog,
            topdownAppearanceColorStops: topdownAppearanceColorStops,
            topdownIconPreviewGlyph: topdownIconPreviewGlyph,
            topdownMetaTierLabel: topdownMetaTierLabel,
            topdownBackgroundPreviewStyle: topdownBackgroundPreviewStyle,
            applyElectricDamageModifier: applyElectricDamageModifier,
            topdownResolveBurnTickDamage: topdownResolveBurnTickDamage,
            topdownResolveBurnTickInterval: topdownResolveBurnTickInterval,
            topdownResolveNuclearHuskBonusDamage: topdownResolveNuclearHuskBonusDamage,
            topdownTimeSettlementBonus: topdownTimeSettlementBonus,
            topdownTryCreateNuclearHusk: topdownTryCreateNuclearHusk,
            topdownAchievementCatalog: topdownAchievementCatalog,
            topdownResolveAchievements: topdownResolveAchievements,
            topdownAchievementSummary: topdownAchievementSummary,
            topdownSelectedAchievementBadge: topdownSelectedAchievementBadge,
            topdownAchievementTierTheme: topdownAchievementTierTheme,
            topdownApplyAchievementProgress: topdownApplyAchievementProgress,
            topdownRememberAchievementEvent: topdownRememberAchievementEvent,
            topdownSetSelectedAchievementBadge: topdownSetSelectedAchievementBadge,
            topdown: {
                TOPDOWN_BALANCE: TOPDOWN_BALANCE,
                TOPDOWN_SCORE_SOFT_CAP: TOPDOWN_SCORE_SOFT_CAP,
                topdownActiveBuffSummary: topdownActiveBuffSummary,
                topdownAllCommonColorsOwned: topdownAllCommonColorsOwned,
                topdownAllRareColorsOwned: topdownAllRareColorsOwned,
                applyTopdownBossRelic: applyTopdownBossRelic,
                applyTopdownElement: applyTopdownElement,
                applyTopdownElementSwap: applyTopdownElementSwap,
                topdownApplyFillStyle: topdownApplyFillStyle,
                applyTopdownItemEffect: applyTopdownItemEffect,
                applyTopdownPlayerBlind: applyTopdownPlayerBlind,
                applyTopdownPlayerKnockback: applyTopdownPlayerKnockback,
                applyTopdownPlayerPull: applyTopdownPlayerPull,
                applyTopdownRandomUpgrade: applyTopdownRandomUpgrade,
                applyTopdownUpgrade: applyTopdownUpgrade,
                applyTopdownWingmanElementChoice: applyTopdownWingmanElementChoice,
                topdownBackgroundCatalog: topdownBackgroundCatalog,
                topdownBackgroundDrawWeight: topdownBackgroundDrawWeight,
                topdownBackgroundPreviewStyle: topdownBackgroundPreviewStyle,
                topdownBossRelicSummary: topdownBossRelicSummary,
                topdownBuffRemaining: topdownBuffRemaining,
                topdownBuildSummary: topdownBuildSummary,
                topdownBuildRunCosmeticBonuses: topdownBuildRunCosmeticBonuses,
                frontlineBuildMetaBonuses: frontlineBuildMetaBonuses,
                applyElectricDamageModifier: applyElectricDamageModifier,
                topdownBulletBlockedByWardenField: topdownBulletBlockedByWardenField,
                topdownCanonicalEliteType: topdownCanonicalEliteType,
                topdownCatalogForKind: topdownCatalogForKind,
                topdownColorCatalog: topdownColorCatalog,
                topdownComboBonus: topdownComboBonus,
                topdownCommonColorKeys: topdownCommonColorKeys,
                topdownCurrentAimAngle: topdownCurrentAimAngle,
                topdownCurrentComboItemEvery: topdownCurrentComboItemEvery,
                topdownCurrentPlayerRadius: topdownCurrentPlayerRadius,
                topdownDisplayRollKey: topdownDisplayRollKey,
                topdownEliteLabel: topdownEliteLabel,
                topdownEnemyAuraBoost: topdownEnemyAuraBoost,
                topdownEnemyHp: topdownEnemyHp,
                topdownEnemyWardenSlowFactor: topdownEnemyWardenSlowFactor,
                drawTopdownAoeBurstVisual: drawTopdownAoeBurstVisual,
                drawTopdownCosmeticBackground: drawTopdownCosmeticBackground,
                drawTopdownElementBeam: drawTopdownElementBeam,
                drawTopdownElementBullet: drawTopdownElementBullet,
                awardTopdownScore: awardTopdownScore,
                buildTopdownUpgradeChoices: buildTopdownUpgradeChoices,
                damageTopdownEnemy: damageTopdownEnemy,
                damageTopdownPlayer: damageTopdownPlayer,
                distanceToSegmentSquared: distanceToSegmentSquared,
                parseTopdownMetaNumber: parseTopdownMetaNumber,
                resetTopdownCombo: resetTopdownCombo,
                topdownEquippedAppearance: topdownEquippedAppearance,
                topdownFormatHpValue: topdownFormatHpValue,
                topdownFindEnemyById: topdownFindEnemyById,
                topdownFireEnemyAttack: topdownFireEnemyAttack,
                getTopdownDerivedStats: getTopdownDerivedStats,
                topdownGetIconImage: topdownGetIconImage,
                topdownHasPickupMagnet: topdownHasPickupMagnet,
                topdownHasLivingBoss: topdownHasLivingBoss,
                drawTopdownStatusRing: drawTopdownStatusRing,
                getWingmanSlots: getWingmanSlots,
                renderTopdownAttributeCards: renderTopdownAttributeCards,
                topdownResolveBurnTickDamage: topdownResolveBurnTickDamage,
                topdownResolveBurnTickInterval: topdownResolveBurnTickInterval,
                topdownResolveNuclearHuskBonusDamage: topdownResolveNuclearHuskBonusDamage,
                topdownTimeSettlementBonus: topdownTimeSettlementBonus,
                topdownTryCreateNuclearHusk: topdownTryCreateNuclearHusk,
                topdownIconCatalog: topdownIconCatalog,
                topdownIconDrawWeight: topdownIconDrawWeight,
                topdownIconPreviewGlyph: topdownIconPreviewGlyph,
                topdownIsUltimateProjectile: topdownIsUltimateProjectile,
                topdownKillBaseScore: topdownKillBaseScore,
                topdownMagneticTrapOrbs: topdownMagneticTrapOrbs,
                topdownMetaRewardAmount: topdownMetaRewardAmount,
                topdownMetaTierClass: topdownMetaTierClass,
                topdownMetaTierLabel: topdownMetaTierLabel,
                topdownAchievementCatalog: topdownAchievementCatalog,
                topdownResolveAchievements: topdownResolveAchievements,
                topdownAchievementSummary: topdownAchievementSummary,
                topdownSelectedAchievementBadge: topdownSelectedAchievementBadge,
                topdownAchievementTierTheme: topdownAchievementTierTheme,
                topdownApplyAchievementProgress: topdownApplyAchievementProgress,
                topdownRememberAchievementEvent: topdownRememberAchievementEvent,
                topdownSetSelectedAchievementBadge: topdownSetSelectedAchievementBadge,
                topdownNearestEnemy: topdownNearestEnemy,
                topdownPickupVisual: topdownPickupVisual,
                topdownPlayerMoveSpeedFactor: topdownPlayerMoveSpeedFactor,
                topdownRareColorKeys: topdownRareColorKeys,
                topdownRelicEnemyBulletSpeedMultiplier: topdownRelicEnemyBulletSpeedMultiplier,
                topdownRelicStacks: topdownRelicStacks,
                topdownRollRowBaseKeys: topdownRollRowBaseKeys,
                topdownRollSequence: topdownRollSequence,
                topdownSkillCatalog: topdownSkillCatalog,
                topdownSkillCooldownValue: topdownSkillCooldownValue,
                topdownSkillCooldownRemaining: topdownSkillCooldownRemaining,
                topdownSkillBlinkDistance: topdownSkillBlinkDistance,
                topdownSkillZeusDuration: topdownSkillZeusDuration,
                topdownSkillInvincibleDuration: topdownSkillInvincibleDuration,
                topdownSkillMissileLifetime: topdownSkillMissileLifetime,
                topdownSkillReady: topdownSkillReady,
                topdownSkillSummary: topdownSkillSummary,
                topdownSkillTriggerKeyLabel: topdownSkillTriggerKeyLabel,
                topdownSkillTriggerKeyOptions: topdownSkillTriggerKeyOptions,
                topdownSortCatalogKeysByTier: topdownSortCatalogKeysByTier,
                topdownSpawnInterval: topdownSpawnInterval,
                topdownSuperRareColorKeys: topdownSuperRareColorKeys,
                topdownTargetEnemyCount: topdownTargetEnemyCount,
                trimTopdownArray: trimTopdownArray,
                topdownWeightedPick: topdownWeightedPick,
                topdownWingmanDetailLines: topdownWingmanDetailLines,
                createTopdownShooterSession: createTopdownShooterSession,
                getTopdownSharedMetaState: getTopdownSharedMetaState,
                normalizeTopdownShooterSession: normalizeTopdownShooterSession,
                serializeTopdownMetaState: serializeTopdownMetaState,
                serializeTopdownShooterSession: serializeTopdownShooterSession,
                setTopdownSharedMetaState: setTopdownSharedMetaState,
                spawnTopdownEnemy: spawnTopdownEnemy,
                spawnTopdownEnemyExplosion: spawnTopdownEnemyExplosion,
                spawnTopdownLuseBurst: spawnTopdownLuseBurst,
                spawnTopdownPlayerFrenzyVolley: spawnTopdownPlayerFrenzyVolley,
                spawnTopdownVolley: spawnTopdownVolley,
                summarizeTopdownMetaState: summarizeTopdownMetaState,
                summarizeTopdownShooterSession: summarizeTopdownShooterSession,
                syncTopdownClock: syncTopdownClock,
                syncTopdownShieldCapacity: syncTopdownShieldCapacity
            },
            /*
            },
            "pickup-magnet": {
                label: "鍚稿惎瑁呯疆",
                shortLabel: "鍚稿惎",
                description: "鎵€鏈夊彲鎷惧彇鐗╀細鑷姩鍚稿悜鐜╁銆傚彧鑳芥嫢鏈?1 灞傘€?,
                maxStacks: 1
            }
            */
        };
    }

    function registerGameModule(gameId, factory) {
        if (!gameId || typeof factory !== "function") {
            return;
        }
        gameModules[String(gameId)] = factory;
    }

    function loadScriptOnce(src) {
        if (gameModuleLoadPromises[src]) {
            return gameModuleLoadPromises[src];
        }
        gameModuleLoadPromises[src] = new Promise(function (resolve, reject) {
            const script = document.createElement("script");
            script.src = src;
            script.async = true;
            script.onload = function () { resolve(); };
            script.onerror = function () { reject(new Error("游戏模块加载失败：" + src)); };
            document.head.appendChild(script);
        });
        return gameModuleLoadPromises[src];
    }

    async function ensureGameModule(gameId) {
        if (gameModules[gameId]) {
            return gameModules[gameId];
        }
        const scriptName = GAME_MODULE_SCRIPTS[gameId];
        if (!scriptName) {
            return null;
        }
        await loadScriptOnce(new URL(scriptName, GAMES_SCRIPT_BASE_URL).href);
        return gameModules[gameId] || null;
    }

    window.GamesHubModules = Object.assign({}, window.GamesHubModules || {}, {
        register: registerGameModule
    });

    async function submitScore(gameId, score, mode, sessionKey, meta) {
        const payload = await requestJson(config.scoreUrl, {
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
        await loadProfile();
        await refreshScorePanels();
        return payload;
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

    async function postPresence(options) {
        const opts = options && typeof options === "object" ? options : {};
        try {
            await requestJson(config.onlineUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(state.currentPresence)
            });
            if (opts.refreshOnline) {
                await loadOnlineVisitors();
            }
        } catch (error) {
            void error;
        }
    }

    function startPresenceLoop() {
        if (state.presenceTimer) {
            window.clearInterval(state.presenceTimer);
        }
        if (state.onlineTimer) {
            window.clearInterval(state.onlineTimer);
        }

        postPresence({ refreshOnline: true });

        state.presenceTimer = window.setInterval(function () {
            postPresence({ refreshOnline: false });
        }, 45000);

        state.onlineTimer = window.setInterval(function () {
            loadOnlineVisitors().catch(function () {
                return null;
            });
        }, 20000);

        if (!state.presenceHooksReady) {
            state.presenceHooksReady = true;
            document.addEventListener("visibilitychange", function () {
                if (!document.hidden) {
                    postPresence({ refreshOnline: true });
                }
            });

            window.addEventListener("beforeunload", function () {
                try {
                    const payload = JSON.stringify(state.currentPresence || {});
                    if (navigator.sendBeacon) {
                        const blob = new Blob([payload], { type: "application/json" });
                        navigator.sendBeacon(config.onlineUrl, blob);
                    } else {
                        fetch(config.onlineUrl, {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: payload,
                            keepalive: true
                        });
                    }
                } catch (error) {
                    void error;
                }
            });
        }
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
        renderGamesChatWidget();
        applyActiveGameMetaAppearance();
        addGlobalStageButtons();
        renderStageLoadingState(game, "正在读取本地存档、恢复上次进度，并挂载游戏界面。");
        syncPresence(gameId === "gomoku" || gameId === "zhajinhua" ? "等待对局" : "游玩中", "");
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

        const needsSharedMeta = gameId === "topdown-shooter" || gameId === "gomoku" || gameId === "zhajinhua";
        if (needsSharedMeta || !state.topdownMetaState) {
            const sharedMetaPayload = await loadGameState("topdown-shooter-meta", { preferRemote: true }).catch(function () {
                return loadGameState("topdown-shooter-meta").catch(function () { return { state: {} }; });
            });
            if (launchToken !== state.launchToken) {
                return;
            }
            setTopdownSharedMetaState((sharedMetaPayload && sharedMetaPayload.state) || {});
        }

        if (gameId === "2048") {
            const payload2048 = await loadGameState("2048").catch(function () { return { state: {} }; });
            const mount2048Module = await ensureGameModule("2048");
            await mountIfCurrent(function () {
                if (mount2048Module) {
                    return mount2048Module(payload2048, createGameModuleContext());
                }
                renderEmptyStage("2048 模块加载失败，请刷新页面重试。");
                return null;
            });
            return;
        }
        if (gameId === "sudoku") {
            const payloadSudoku = await loadGameState("sudoku").catch(function () { return { state: {} }; });
            const mountSudokuModule = await ensureGameModule("sudoku");
            await mountIfCurrent(function () {
                if (mountSudokuModule) {
                    return mountSudokuModule(payloadSudoku, createGameModuleContext());
                }
                renderEmptyStage("数独模块加载失败，请刷新页面重试。");
                return null;
            });
            return;
        }
        if (gameId === "gomoku") {
            const payloadGomokuMeta = await loadGameState("topdown-shooter-meta", { preferRemote: true }).catch(function () {
                return { state: getTopdownSharedMetaState() || {} };
            });
            setTopdownSharedMetaState((payloadGomokuMeta && payloadGomokuMeta.state) || {});
            const mountGomokuModule = await ensureGameModule("gomoku");
            await mountIfCurrent(function () {
                if (mountGomokuModule) {
                    return mountGomokuModule(payloadGomokuMeta, createGameModuleContext());
                }
                renderEmptyStage("五子棋模块加载失败，请刷新页面重试。");
                return null;
            });
            return;
        }
        if (gameId === "zhajinhua") {
            const payloadZhajinhuaMeta = await loadGameState("topdown-shooter-meta", { preferRemote: true }).catch(function () {
                return { state: getTopdownSharedMetaState() || {} };
            });
            setTopdownSharedMetaState((payloadZhajinhuaMeta && payloadZhajinhuaMeta.state) || {});
            const mountZhajinhuaModule = await ensureGameModule("zhajinhua");
            await mountIfCurrent(function () {
                if (mountZhajinhuaModule) {
                    return mountZhajinhuaModule(payloadZhajinhuaMeta, createGameModuleContext());
                }
                renderEmptyStage("炸金花模块加载失败，请刷新页面重试。");
                return null;
            });
            return;
        }
        if (gameId === "frontline") {
            const payloadFrontline = await loadGameState("frontline").catch(function () { return { state: {} }; });
            const mountFrontlineModule = await ensureGameModule("frontline");
            await mountIfCurrent(function () {
                if (mountFrontlineModule) {
                    return mountFrontlineModule(payloadFrontline, createGameModuleContext());
                }
                renderEmptyStage("前线模块加载失败，请刷新页面重试。");
                return null;
            });
            return;
        }
        if (gameId === "topdown-shooter") {
            const topdownPayloads = await Promise.all([
                loadGameState("topdown-shooter").catch(function () { return { state: {} }; }),
                loadGameState("topdown-shooter-meta", { preferRemote: true }).catch(function () { return { state: {} }; })
            ]);
            setTopdownSharedMetaState((topdownPayloads[1] && topdownPayloads[1].state) || {});
            const mountTopdownModule = await ensureGameModule("topdown-shooter");
            await mountIfCurrent(function () {
                if (mountTopdownModule) {
                    return mountTopdownModule({
                        state: topdownPayloads[0].state || {},
                        metaState: state.topdownMetaState || (topdownPayloads[1] && topdownPayloads[1].state) || {}
                    }, createGameModuleContext());
                }
                renderEmptyStage("俯视射击模块加载失败，请刷新页面重试。");
                return null;
            });
            return;
        }
        if (launchToken === state.launchToken) {
            renderEmptyStage("当前入口暂时还没有接入内容。");
        }
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
            const extraClass = String(item || "").indexOf("game-arcade-attr-grid") !== -1 ? " game-arcade-status-card--attrs" : "";
            return '<div class="' + (className || "games-stage-meta") + extraClass + '">' + item + "</div>";
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
        // 分数与战局节奏：决定每次击杀、波次推进、连杀奖励和临时道具的出场频率。
        killScore: 30, // 普通击杀的基础分数，所有连杀和额外倍率都从这个基础值往上叠。
        settlementTimeScorePerSecond: 15, // 结算时按当前存活秒数追加分数，默认每秒 1 分。
        waveStepKills: 10, // 每累计击杀多少个敌人，常规波次向前推进 1 步。
        waveBonusScore: 18, // 波次提升时额外赠送的分数，用来鼓励持续推进而不是只刷单体。
        comboResetWindow: 8, // 初始连杀计时窗口，超过这个秒数没续上击杀就会断连。
        comboResetWindowPerLevel: 0.8, // 连杀窗口强化每级额外增加的秒数。
        comboResetWindowMin: 5, // 连杀系统允许的最小窗口下限，避免被异常配置压得太短。
        comboScoreStep: 10, // 连杀带来的额外得分步长，连杀越高每次击杀加成越明显。
        comboItemEvery: 60, // 默认累计连杀贡献达到多少时掉 1 次幸运补给。
        comboItemEveryStep: 5, // 强化“连杀阈值”后，每级减少多少掉落阈值。
        comboItemEveryMin: 25, // 连杀掉补给的最小阈值下限，防止后期补给过于泛滥。
        itemBuffDuration: 30, // 临时道具类增益的持续时间，单位秒。
        bonusRerollsAmount: 5, // “刷新补给”道具一次性提供的强化刷新次数。

        // 基础生存：玩家护盾、复活、受击反馈都在这一组统一调。
        playerLives: 1, // 预留的生命数配置，目前主逻辑仍以“破盾后再吃伤害即死亡”为准。
        reviveDailyLimit: 10, // 每个账号每天最多可复活多少次，跨局共享。
        reviveInvulnerableDuration: 2.4, // 复活后附带的无敌保护时长，避免原地立刻再死。
        reviveQrAsset: "/static/games/topdown/revive-payment-qr.png", // 兼容旧逻辑保留的默认付款码静态资源路径。
        reviveQrAssets: [ // 复活确认页展示的大图付款码列表，按顺序绘制。
            "/static/games/topdown/revive-payment-qr.png",
            "/static/games/topdown/revive-payment-alipay.jpg"
        ],
        reviveQrLabels: ["微信收款码", "支付宝收款码"], // 付款码标题文案，和 reviveQrAssets 一一对应。
        baseShieldLayers: 2, // 玩家开局自带的基础护盾层数。
        shieldLayerPerLevel: 1, // “护盾层数”强化每升 1 级额外增加的护盾层数。
        shieldCapacityCap: 6, // 护盾层数强化本身的等级上限，不是最终层数上限。
        shieldRechargeDelay: 5.4, // 最后一层护盾受损后，开始自动回盾前的等待时间。
        shieldRechargeDelayStep: 0.7, // 每级“护盾冷却”强化可缩短的等待秒数。
        shieldRechargeDelayMin: 1.8, // 护盾开始回充的最短等待时间下限。
        shieldRechargeDuration: 4.6, // 单层护盾从开始回充到补满所需时间。
        shieldRechargeDurationStep: 0.55, // 每级“护盾恢复”强化可缩短的单层恢复时长。
        shieldRechargeDurationMin: 1.5, // 单层护盾恢复时间的下限，防止回盾过快。

        // 玩家基础数值：移动、射速、伤害、体积、弹道尺寸和场地尺寸都从这里出。
        baseMoveSpeed: 236, // 玩家基础移动速度，单位是逻辑像素每秒。
        moveSpeedPerLevel: 18, // “移速”强化每级稳定增加的基础移速。
        moveSpeedRollMin: 24, // 随机移速强化条目最小可给的数值。
        moveSpeedRollMax: 42, // 随机移速强化条目最大可给的数值。
        baseFireInterval: 0.22, // 主武器基础射击间隔，数值越小射速越高。
        fireRateStep: 0.1, // 每级射速强化带来的间隔缩减比例基数。
        fireRateRollMin: 0.035, // 随机射速强化最小能减少多少射击间隔。
        fireRateRollMax: 0.2, // 随机射速强化最大能减少多少射击间隔。
        minFireInterval: 0.05, // 射击间隔硬下限，防止极端情况下射速无限接近 0。
        baseBulletDamage: 3.2, // 玩家子弹的基础伤害。
        attackPerLevel: 0.75, // “攻击力”强化每级稳定增加的伤害值。
        attackRollMin: 0.85, // 随机攻击强化最小额外伤害。
        attackRollMax: 1.65, // 随机攻击强化最大额外伤害。
        damageSoftCap: 18.5, // 玩家伤害开始进入软上限衰减的阈值。
        damageOverflowFactor: 0.55, // 伤害超过软上限后，溢出部分保留的效率比例。
        damagePrecision: 1000, // 伤害固定小数精度倍率，用于避免浮点叠算丢伤。
        hpPrecision: 1000, // 血量和护盾的固定小数精度倍率，保证整数显示但内部可精确累计。
        damageEpsilon: 0.0001, // 小于这个值的伤害视为 0，避免浮点误差造成异常掉血。
        killEpsilon: 0.001, // 剩余生命低于这个阈值时视为已击杀。
        bulletSpeed: 480, // 玩家普通子弹飞行速度。
        bulletRadius: 4, // 玩家普通子弹碰撞半径。
        bulletLife: 1.4, // 玩家普通子弹最大存在时长，防止飞出太远常驻场上。
        projectileCap: 6, // “弹道规模”强化的等级上限。
        projectileRadiusPerLevel: 0.45, // 弹道强化每级增加的子弹体积系数。
        projectileLifePerLevel: 0.14, // 弹道强化每级增加的子弹持续时间。
        moveSpeedSoftCap: 360, // 移速进入软上限衰减的阈值。
        moveSpeedOverflowFactor: 0.45, // 移速超过软上限后，溢出部分保留的效率。
        fireRateSoftCapPerSecond: 10, // 实际射速每秒超过该值后开始衰减收益。
        fireRateHardCapPerSecond: 15, // 实际射速的硬上限，防止超高频触发卡死。
        fireRateOverflowFactor: 0.45, // 射速超过软上限后，额外收益保留的效率。
        playerRadius: 14, // 玩家本体碰撞半径，也是默认绘制尺寸基准。
        damageFlashDuration: 0.9, // 受击闪烁总时长。
        damageFlashBlinkPairs: 3, // 受击闪烁会闪多少组明暗切换。
        enemyHpTextDecimalThreshold: 10, // 敌人血量低于该阈值时显示小数，方便观察 DOT 磨血。
        enemyHpTextDecimals: 1, // 低血量时展示的小数位数。
        arenaWidth: 960, // 逻辑战场宽度，所有坐标都基于这个固定尺寸计算。
        arenaHeight: 720, // 逻辑战场高度，用于适配不同屏幕时统一缩放。
        arenaPadding: 20, // 敌人、子弹等与边界保持的基础安全内边距。
        arenaPlayerMargin: 18, // 玩家移动时与地图边缘预留的额外缓冲距离。
        multishotSpread: 0.18, // 多重射击每发之间的角度散布。
        wingmanMax: 4, // 僚机数量上限。
        wingmanOrbitRadius: 42, // 僚机围绕玩家旋转的默认半径。
        wingmanDamageFactor: 0.5, // 僚机伤害相对于主武器伤害的倍率。
        wingmanFireRateFactor: 1.35, // 僚机射击间隔相对主武器的倍率，越大代表僚机越慢。
        pickupRadius: 13, // 掉落物碰撞半径。
        pickupLifetime: 20, // 掉落物在地图上的最大停留时间。

        // 敌人刷新与成长：控制敌群数量、刷新频率和随时间增长的压力。
        targetEnemyBase: 4, // 第一波期望同时存活的敌人基数。
        targetEnemyPerWave: 1.15, // 每提升 1 波额外增加多少目标存活敌人数。
        targetEnemyCap: 20, // 常规刷新逻辑允许追求的最大在场敌人数。
        spawnBaseInterval: 1.18, // 基础刷怪尝试间隔。
        spawnIntervalWaveStep: 0.16, // 每提升一波对刷怪间隔的缩减幅度。
        spawnIntervalMin: 0.5, // 刷怪间隔的最小值，保证节奏不会失控。
        enemyBaseRadius: 16, // 普通敌人的基础体积半径。
        enemyRadiusVariance: 8, // 普通敌人体积随机波动范围。
        enemyBaseSpeed: 28, // 敌人的基础移速。
        enemySpeedPerWave: 0.5, // 每波常规增加的敌人速度。
        enemySpeedVariance: 14, // 敌人初始速度的随机浮动范围。
        enemyBaseHp: 6, // 普通敌人基础生命值。
        enemyHpPerWave: 1.35, // 每波稳定增加的生命成长。
        enemyHpPerKill: 0.1, // 玩家击杀数带来的额外生命成长，用于动态追赶玩家强度。
        enemyHpPerBoss: 5, // 每击败一个 Boss 后，后续小怪额外增加的生命量。
        latePressureStartWave: 9, // 从第几波开始启用后期额外压强曲线。
        lateEnemyHpPerWave: 0.95, // 后期阶段每波额外追加的生命成长。
        lateEnemyHpExponent: 1.4, // 后期生命曲线指数，避免高波次血量按平方爆炸。
        lateEnemySpeedPerWave: 1.05, // 后期阶段每波额外追加的速度成长。
        enemyFireMin: 1.2, // 敌人普通射击冷却的最小随机值。
        enemyFireMax: 2.9, // 敌人普通射击冷却的最大随机值。
        enemyFireRange: 340, // 敌人进入射击状态所需的默认距离。
        enemyBulletSpeed: 182, // 敌方基础子弹速度。
        enemyPowerPressureSoftCap: 2.7, // 根据玩家强度推算敌人增幅时，压强曲线的软上限参数。
        enemyPowerHpStep: 1.15, // 玩家战力每提升一个单位时，敌人血量额外增加的步长。
        enemyPowerHpCurve: 0.34, // 玩家战力转敌方生命的曲线弯曲系数。
        enemyPowerHpExponent: 1.35, // 玩家战力映射血量的指数，避免后期额外血量涨得过快。
        enemyPowerSpeedStep: 0.05, // 玩家战力额外映射到敌方移速的比例。
        enemyPowerBulletSpeedStep: 0.03, // 玩家战力额外映射到敌弹速度的比例。
        enemyPowerFireRateStep: 0.02, // 玩家战力额外映射到敌方射速的比例。
        rareIconStartChoices: 2, // 稀有图标提供的开局额外强化选择次数。
        superRareIconStartChoices: 3, // 超级稀有图标当前同样提供 2 次开局强化选择。

        // 精英与 Boss：控制精英刷新频率、Boss 周期和基础系数。
        eliteEveryKills: 9, // 每累计多少击杀生成一个精英怪。
        eliteHpMultiplier: 1.55, // 精英怪生命相对普通敌人的倍率。
        eliteFireRateMultiplier: 0.78, // 精英怪射击间隔倍率，小于 1 代表射得更快。
        eliteBulletSpread: 0.16, // 精英多发弹幕的每发散射角度。
        eliteBulletCount: 1, // 默认精英的额外弹数基准。
        eliteSpeedMultiplier: 1.16, // 精英怪移速倍率。
        eliteBulletSpeedPerWave: 5, // 精英子弹每波额外增加的速度。
        bossWaveEvery: 4, // 每隔多少波出现 1 次 Boss 波。
        bossHpMultiplier: 5.2, // Boss 基础生命倍率。
        bossShieldBase: 24, // Boss 初始护盾值。
        bossShieldPerWave: 4, // 每波给 Boss 护盾追加的数值。
        bossShieldPerBoss: 6, // 每击败一个 Boss，后续 Boss 再额外增加的护盾。
        bossRadius: 30, // Boss 碰撞半径与绘制基础尺寸。
        bossFireRateMultiplier: 0.68, // Boss 射击间隔倍率。
        bossBulletCount: 5, // Boss 常规弹幕发射数。
        bossBulletSpeedMultiplier: 1.45, // Boss 子弹速度倍率。
        bossSpeedMultiplier: 0.78, // Boss 移速倍率，通常比杂兵慢但更压场。
        bossBonusScore: 180, // 击败 Boss 额外奖励分数。
        bossRelicChoiceCount: 2, // 击败首领后供玩家选择的局内遗物数量。

        // 强化上限：各类成长条目的最大等级限制。
        elementCap: 7, // 元素主武器等级上限，达到后解锁满级终极效果判定。
        statCap: 20, // 通用属性强化等级上限。
        multishotCap: 8, // 多重射击等级上限。
        comboWindowCap: 5, // 连杀时间窗强化等级上限。
        comboThresholdCap: 7, // 连杀补给阈值强化等级上限。

        // 元素效果：火、电、冰、核四系的 DoT、AOE、控制和特殊判定都在这里。
        burnDuration: 2.2, // 燃烧效果持续时长。
        burnTickInterval: 0.1, // 燃烧伤害跳字间隔。
        burnStackMax: 6, // 燃烧最多可叠加的层数。
        burnDamageBase: 3, // 燃烧基础伤害。
        burnDamagePerLevel: 2, // 每级火元素为燃烧额外带来的伤害。
        burnDamagePerStack: 2, // 每层燃烧叠层额外增加的伤害。
        burnOverheatTickInterval: 1, // 火焰满层后的质变跳伤间隔。
        burnOverheatMaxHpFactor: 0.05, // 火焰满层后的质变伤害：每次跳伤附带目标最大生命值的百分比。
        fireMaxSpreadRadius: 138, // 满层火焰再次命中时，向周围扩散满层火焰的半径。
        fireSpreadOverlapPadding: 5, // 火系范围弹之间允许的额外重叠缓冲。
        elementAoeBaseInterval: 6, // 元素范围脉冲的默认触发间隔。
        elementAoeIntervalStep: 1, // 元素范围相关强化每级减少的间隔秒数。
        elementAoeMinInterval: 3, // 元素范围脉冲允许的最短触发间隔。
        fireAoeBaseRadius: 46, // 火系范围爆燃的基础半径。
        fireAoeRadiusPerLevel: 7, // 每级火系范围扩散增加的半径。
        iceAoeBaseRadius: 50, // 冰系范围扩散的基础半径。
        iceAoeRadiusPerLevel: 8, // 冰系范围强化每级增加的半径。
        electricBaseChains: 1, // 电系基础连锁次数。
        electricRadius: 150, // 电系连锁搜索目标的半径。
        electricDirectDamageFactor: 0.8, // 电系直击伤害倍率，突出“尖端放电”本体较低但能挂感电。
        electricChainDamageFactor: 1.2, // 电系连锁伤害倍率：弹射目标更痛（非满级也保留“尖端放电”的直击/弹射差异）。
        electricBeamLife: 0.1, // 电击光束视觉停留时长。
        electricChainVisualCap: 3, // 电系弹射连线的最大可视数量（高弹道时避免画面太乱）。
        electricMaxRange: 420, // 电击射线的最大搜索/绘制距离。
        electricShockChance: 0.58, // 满足条件时触发感电增伤的概率。
        electricShockBonus: 2, // 感电增伤倍率。
        electricUltimateDirectShockChance: 1, // 满级电系直击命中后附加感电的概率。
        electricUltimateChainShockChance: 0.58, // 满级电系连锁命中后附加感电的概率。
        electricMagnetDuration: 0.7, // 电生磁：被电击命中/弹射的敌人被拉向直击目标的持续时间。
        electricMagnetStrength: 520, // 电生磁：拉扯强度（单位/秒）。
        electricContinuousBeamHold: 1, // 自动射击丢失目标后，持续电流束保留时长（秒）。

        // TTK 控制：让玩家属性持续提升，但常规小怪的击杀时间保持在一个稳定区间。
        ttkMinSeconds: 3,
        ttkMaxSeconds: 5,
        ttkGrowthEndWave: 18,
        ttkDpsSoftCap: 80, // 用于“敌人血量追赶”计算的软上限，避免玩家极端爆发导致血量指数级拉升。
        ttkDpsOverflowFactor: 0.6,
        ttkEnemyHpMultiplierMin: 0.75,
        ttkEnemyHpMultiplierMax: 8,
        iceSlowPerStack: 0.11, // 每层冰缓叠加的减速比例。
        iceMaxSlow: 0.78, // 冰缓允许达到的最大减速比例。
        iceFreezeStacks: 6, // 叠到多少层冰缓会进入完全冻结。
        iceFreezeDuration: 5.35, // 完全冻结持续时间。
        iceShatterChance: 0.5, // 目标已完全冻结且被满级冰弹命中时的碎裂秒杀概率。
        nuclearBaseRadius: 52, // 核系爆炸基础半径。
        nuclearRadiusPerLevel: 20, // 每级核系增加的爆炸半径。
        nuclearDamageFactor: 0.8, // 核爆对范围内单位造成的伤害倍率。
        nuclearBurstLife: 0.24, // 核爆瞬时视觉持续时间。
        nuclearRadiationChance: 0, // 旧版持续辐射区逻辑已关闭，满级核系改走“干尸占位”路线。
        nuclearRadiationDuration: 3, // 辐射区域持续时间。
        nuclearRadiationAlpha: 0.22, // 辐射区域绘制透明度。
        nuclearHuskChance: 0.6, // 满级核系击杀普通敌人后，稳定转成干尸占位符，避免体感上“完全不出”。
        nuclearHuskDuration: 10, // 干尸占位持续时间。
        nuclearHuskCapRatio: 0.5, // 干尸最多占用目标刷怪上限的比例，0.5 代表最多占一半。
        enemySpecialAttackWave: 6, // 从第几波开始允许敌人使用特殊攻击。
        eliteSpecialAttackChance: 0.28, // 精英怪在满足条件时使用特殊攻击的概率。
        bossSpecialAttackChance: 0.46, // Boss 使用特殊攻击的概率。
        enemySpecialCooldownMin: 3.2, // 敌方特殊攻击最短冷却。
        enemySpecialCooldownMax: 5.8, // 敌方特殊攻击最长冷却。
        enemyBeamLife: 0.18, // 敌方激光束在画面上的停留时长。
        enemyBeamRange: 760, // 敌方激光最大射程。
        enemyBeamWidth: 9, // 敌方激光宽度。
        enemyRingBulletCount: 6, // 普通敌人的环形弹幕弹数。
        bossRingBulletCount: 6, // Boss 环形弹幕弹数。
        enemyRingSpeedFactor: 0.76, // 环形弹幕子弹速度相对普通子弹的倍率。
        enemyBarrageBulletCount: 6, // 普通散射弹幕发射的弹数。
        enemyBarrageSpread: 0.34, // 普通散射弹幕的总散布角。
        enemyContactDamage: 1, // 玩家直接撞到敌人时承受的伤害层数。
        enemyDefaultBulletDamage: 1, // 敌方普通子弹命中时的默认伤害层数。
        maxPlayerBullets: 320, // 玩家子弹最大缓存数量，防止极限射速把数组撑爆。
        maxEnemyBullets: 200, // 敌方子弹最大缓存数量。
        maxFriendlyBeams: 140, // 友方电击/光束效果最大数量。
        maxEnemyBeams: 64, // 敌方光束最大数量。
        maxAoeBursts: 80, // 范围爆炸效果最大数量。
        maxPickups: 28, // 地图上可同时存在的掉落物上限。
        maxEnemiesHard: 40, // 敌人数组的硬上限，超出后不再继续生成。

        // 道具与精英特性：各种精英怪机制、掉落和狂暴参数。
        totalRerolls: 5, // 每局开始时给玩家的强化刷新次数。
        eliteTypes: ["dash", "sniper", "summoner", "self-destruct", "buffer", "splitter", "repulsor", "warden", "blackhand", "nightmare", "liangzi", "luse", "succubus"], // 当前精英怪池，刷出时会从这里抽取类型。
        eliteDashCooldown: 3.2, // 冲刺型精英两次冲刺之间的冷却。
        eliteDashSpeed: 270, // 冲刺型精英冲刺时的速度。
        eliteDashDuration: 0.5, // 冲刺持续时间。
        eliteSniperRange: 520, // 狙击精英开始远程锁定的射程。
        eliteSniperBulletSpeed: 286, // 狙击精英子弹速度。
        eliteSniperDamage: 2, // 狙击精英命中时造成的伤害。
        eliteSummonCooldown: 5.2, // 召唤精英召唤小怪的冷却。
        eliteSummonCount: 1, // 召唤精英每次召出的单位数量。
        bufferAuraRadius: 136, // 增幅型精英光环半径。
        bufferAuraOnDuration: 2.6, // 增幅光环开启持续时间。
        bufferAuraOffDuration: 1.65, // 增幅光环关闭持续时间。
        bufferEnemySpeedMultiplier: 1.12, // 受增幅影响的敌人移速倍率。
        bufferEnemyFireRateMultiplier: 0.84, // 受增幅影响的敌人射击间隔倍率，小于 1 代表射得更快。
        bufferHpFactor: 0.62, // 增幅型精英自身血量系数，避免过于难处理。
        selfDestructRushSpeed: 228, // 自爆怪冲向玩家时的移动速度。
        selfDestructDelay: 1.15, // 自爆怪进入引爆状态到爆炸的延迟。
        selfDestructRadius: 76, // 自爆范围半径。
        selfDestructBurstLife: 0.42, // 自爆视觉效果持续时长。
        repulsorRange: 168, // 斥力怪触发击飞判定的作用半径。
        repulsorKnockDistance: 128, // 斥力怪一次击飞把玩家推出的目标距离。
        repulsorKnockSpeed: 360, // 斥力击飞过程的移动速度。
        repulsorCooldown: 3.1, // 斥力怪两次击飞之间的冷却。
        wardenFieldRange: 168, // 典狱长结界半径，子弹不能飞入并会减慢敌人。
        wardenFieldOnDuration: 2.8, // 典狱长结界开启持续时间。
        wardenFieldOffDuration: 1.7, // 典狱长结界关闭持续时间。
        wardenEnemySlowMultiplier: 0.3, // 进入典狱长结界的敌人移速倍率。
        blackhandHookRange: 530, // 黑手可出钩的最大距离。
        blackhandHookSpeed: 280, // 黑手钩子的飞行速度。
        blackhandPullSpeed: 450, // 黑手把玩家拖拽回去的速度。
        blackhandHookCooldown:3, // 黑手技能冷却。
        nightmareBlindDuration: 5, // 噩梦怪致盲持续时间。
        nightmareVisionRadius: 108, // 致盲时玩家保留的可视半径。
        nightmareTouchCooldown: 1.1, // 噩梦怪接触致盲的内部冷却。
        nightmareAuraRange: 126, // 噩梦怪的压制光环范围。
        liangziConsumeCooldown: 1, // 良子吞怪回血技能冷却。
        liangziConsumeHpFactor: 1.5, // 良子吞掉猎物后转化的回血倍率。
        luseTriggerRange: 330, // 卢瑟开始爆发弹幕的触发距离。
        luseBarrageCount: 150, // 卢瑟单轮爆发发出的总弹数。
        luseBurstInterval: 0.045, // 卢瑟爆发状态下，两次小簇喷射之间的间隔。
        luseBurstShotsPerTick: 10, // 卢瑟每次小簇喷射实际吐出的散弹数量。
        luseSpreadRadians: 0.0820304748, // 卢瑟爆发弹幕的单发角度步进。
        luseDecayPerSecond: 20, // 卢瑟持续爆发状态下每秒自损的数值。
        succubusAuraRange: 178, // 魅魔吸附与狂暴影响范围。
        succubusPullStrength: 156, // 魅魔把目标往中心拖的力度。
        succubusEnrageDuration: 5, // 魅魔击败后玩家进入狂暴状态的持续时长。
        frenzyBurstDuration: 3, // 玩家狂暴爆发主阶段持续时间。
        frenzyExhaustDuration: 5, // 爆发结束后的疲软持续时间。
        frenzyMoveMultiplier: 0.5, // 疲软期玩家移动倍率。
        frenzyVolleyInterval: 0.12, // 狂暴期间自动倾泻弹幕的间隔。
        frenzyBulletCount: 251, // 玩家狂暴一次爆发的子弹总数。
        frenzyShotsPerVolley: 10, // 玩家狂暴每个节拍喷出的子弹数，避免一帧内把整轮弹幕全部打成一条线。
        frenzySpreadRadians: 0.0820304748, // 玩家狂暴弹幕的散射步进角。

        // 普通杂兵幸运掉落：低概率提供额外奖励，缓解长局疲劳。
        luckyDropChance: 0.005, // 普通小怪掉落幸运奖励的概率。
        luckyDropItemWeight: 0.6, // 幸运掉落中“道具类”相对“升级类”的权重。

        // 首领遗物：控制首领掉落局内装备的叠层收益和上限。
        bossRelicMaxStacks: 16, // 大部分首领遗物默认最大叠层数。
        bossRelicEnemySpeedStep: 0.08, // 每层“流体动力”降低敌方移速的比例。
        bossRelicEnemyBulletSpeedStep: 0.08, // 每层“场阻尼器”降低敌弹速度的比例。
        bossRelicEnemyFireRateStep: 0.08, // 每层“射速扰频器”降低敌方射击频率的比例。
        bossRelicEnemyMinMultiplier: 0.2, // 敌人速度/弹速被减益后的最低倍率下限。
        bossRelicEnemyFireCooldownMaxMultiplier: 2.28, // 敌方射击冷却被拉长后的最大倍率上限。
        shrinkEngineScaleStep: 0.03, // 每层缩机遗物让玩家体积缩小的比例。
        shrinkEngineMaxStacks: 20, // 缩机遗物最多可叠层数。
        magneticTrapMaxStacks: 12, // 吸附环绕遗物的最大叠层数。
        magneticTrapOrbitRadius: 68, // 环绕球围绕玩家运动的轨道半径。
        magneticTrapBulletRadius: 6, // 环绕球碰撞半径。
        magneticTrapDamageFactor: 1.5, // 环绕球碰撞造成的伤害倍率。
        magneticTrapSpinFactor: 3.1, // 环绕球旋转速度系数。
        magneticTrapHitIntervalFactor: 0.72, // 同一目标被环绕球连续命中时的最短间隔系数。
        pickupMagnetSpeed: 420, // 吸附掉落效果触发后，掉落物朝玩家飞行的基础速度。
        pickupMagnetCatchupFactor: 0.42, // 掉落物距离越远时额外叠加的追赶速度比例。
        splitterChildCount: 5, // 分裂精英死亡后生成的子体数量。
        splitterChildHpFactor: 0.3, // 分裂子体继承母体生命的比例。
        splitterChildSpeedFactor: 1.18, // 分裂子体相对母体的速度倍率。
        splitterChildRadiusFactor: 0.56, // 分裂子体相对母体的体积倍率。

        // 技能：主动技能冷却、持续时间、宙斯权杖、导弹表现都集中在这里。
        skillCooldown: 45, // 主动技能基础冷却，默认所有技能共享这个基准值。
        skillUpgradeStep: 0.05, // 技能强化每级带来的 5% 收益，用于冷却或持续/距离。
        skillUpgradeCap: 6, // 技能相关强化等级上限。
        blinkTapWindow: 0.24, // 闪现输入缓冲窗口，防止快速按键被漏判。
        blinkDistance: 138, // 闪现基础距离。
        blinkDuration: 0.14, // 闪现位移过程持续时间。
        zeusBeamDuration: 5, // 宙斯权杖初始持续时间。
        zeusBeamSpeed: 620, // 宙斯权杖光束核心的飞行速度。
        zeusBeamLength: 118, // 宙斯权杖单道光束的可见长度，同时也是处决判定长度基准。
        zeusBeamWidth: 18, // 宙斯权杖光束的判定宽度。
        zeusBeamRadius: 10, // 宙斯权杖光束核心的头部半径。
        missileSpeed: 540, // 导弹技能的飞行速度。
        missileTurnRate: 8.8, // 导弹追踪转向速度。
        missileRadius: 6, // 导弹碰撞半径。
        missileLifetime: 6, // 导弹最长存在时间。
        missileDamageFactor: 1.85, // 导弹相对当前攻击力的伤害倍率。
        invincibleDuration: 10, // 绝对无敌技能的持续时间。
        maxSkillProjectiles: 180, // 技能投射物的最大缓存数量。

        // 局外养成：抽奖成本、保底、每日赠送和结算奖励都走这里。
        metaColorDrawCost: Math.max(0, Number(config.topdownMetaColorDrawCost == null ? 4800 : config.topdownMetaColorDrawCost)), // 单抽颜色消耗的局外总积分，支持从配置覆盖。
        metaIconDrawCost: Math.max(0, Number(config.topdownMetaIconDrawCost == null ? 3200 : config.topdownMetaIconDrawCost)), // 单抽图标消耗的局外总积分，支持从配置覆盖。
        metaBackgroundDrawCost: Math.max(0, Number(config.topdownMetaBackgroundDrawCost == null ? 4000 : config.topdownMetaBackgroundDrawCost)), // 单抽背景消耗的局外总积分，支持从配置覆盖。
        metaLoginGiftPulls: 100, // 每次赠送重置时，每个奖池送多少抽。
        metaDailyFreeTenCount: 10, // 每日免费十连固定按多少抽结算。
        metaRareColorChance: 0.035, // 解锁稀有颜色池后，抽到稀有色的基础概率。
        metaSuperRareColorChance: 0.012, // 解锁超稀有颜色池后，抽到超稀有色的基础概率。
        metaPointsBaseReward: 120, // 每局无论表现如何都能拿到的局外基础积分。
        metaPointsScoreRate: 1.1, // 局内分数转换为局外积分的比例。
        metaPointsBossBonus: 180, // 每击败一个 Boss 额外奖励的局外积分。
        metaPointsComboBonus: 4 // 连杀达到奖励节点时，额外换算出的局外积分。
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

    function topdownSkillTriggerKeyOptions() {
        return ["KeyQ", "KeyE", "Space"];
    }

    function topdownSkillTriggerKeyLabel(code) {
        const map = {
            KeyQ: "Q",
            KeyE: "E",
            Space: "空格"
        };
        return map[code] || "Q";
    }

    function topdownCanonicalEliteType(type) {
        const value = String(type || "");
        const aliasMap = {
            "冷锋": "sniper",
            "杀马特团长": "summoner",
            dash: "dash",
            sniper: "sniper",
            summoner: "summoner",
            "self-destruct": "self-destruct",
            buffer: "buffer",
            splitter: "splitter",
            repulsor: "repulsor",
            warden: "warden",
            "典狱长": "warden",
            blackhand: "blackhand",
            nightmare: "nightmare",
            liangzi: "liangzi",
            luse: "luse",
            succubus: "succubus",
            boss: "boss"
        };
        return aliasMap[value] || value;
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
            },
            "pickup-magnet": {
                label: "Pickup Magnet",
                shortLabel: "Magnet",
                description: "Pickups automatically fly toward the player. Max 1 stack.",
                maxStacks: 1
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

    function topdownHasPickupMagnet(session) {
        return topdownRelicStacks(session, "pickup-magnet") > 0;
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
        const powerPressure = topdownPlayerPowerPressure(session);
        return 1
            + Math.pow(Math.max(0, wave - 1), 1.16) * 0.09
            + Number(session.bossesDefeated || 0) * 0.28
            + latePressure * 0.18
            + latePressure * latePressure * 0.015
            + powerPressure * 0.2
            + powerPressure * powerPressure * 0.02;
    }

    function topdownTargetEnemyCount(session) {
        const wavePressure = Math.floor(Math.pow(Math.max(1, Number(session.wave || 1)), 1.08) * TOPDOWN_BALANCE.targetEnemyPerWave);
        const powerPressure = topdownPlayerPowerPressure(session);
        return Math.min(
            TOPDOWN_BALANCE.targetEnemyCap,
            TOPDOWN_BALANCE.targetEnemyBase + wavePressure + Math.floor(Number(session.bossesDefeated || 0) * 0.8) + Math.floor(topdownLatePressure(session) * 0.45) + Math.floor(powerPressure * 0.6)
        );
    }

    function topdownSpawnInterval(session) {
        const powerPressure = topdownPlayerPowerPressure(session);
        return Math.max(
            TOPDOWN_BALANCE.spawnIntervalMin,
            TOPDOWN_BALANCE.spawnBaseInterval
                - Math.min(0.72, Math.log1p(Math.max(0, Number(session.wave || 1) - 1)) * TOPDOWN_BALANCE.spawnIntervalWaveStep)
                - Math.min(0.16, topdownLatePressure(session) * 0.012)
                - Math.min(0.12, powerPressure * 0.02)
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

    let topdownColorCatalogCache = null;
    let topdownBackgroundCatalogCache = null;

    function topdownClampByte(value) {
        return Math.max(0, Math.min(255, Math.round(Number(value || 0))));
    }

    function topdownHslToHex(hue, saturation, lightness) {
        const h = ((Number(hue || 0) % 360) + 360) % 360;
        const s = Math.max(0, Math.min(100, Number(saturation || 0))) / 100;
        const l = Math.max(0, Math.min(100, Number(lightness || 0))) / 100;
        const chroma = (1 - Math.abs(2 * l - 1)) * s;
        const segment = h / 60;
        const second = chroma * (1 - Math.abs(segment % 2 - 1));
        let red = 0;
        let green = 0;
        let blue = 0;
        if (segment >= 0 && segment < 1) {
            red = chroma;
            green = second;
        } else if (segment < 2) {
            red = second;
            green = chroma;
        } else if (segment < 3) {
            green = chroma;
            blue = second;
        } else if (segment < 4) {
            green = second;
            blue = chroma;
        } else if (segment < 5) {
            red = second;
            blue = chroma;
        } else {
            red = chroma;
            blue = second;
        }
        const match = l - chroma / 2;
        const toHex = function (channel) {
            return topdownClampByte((channel + match) * 255).toString(16).padStart(2, "0");
        };
        return "#" + toHex(red) + toHex(green) + toHex(blue);
    }

    function topdownGeneratedColorLabel(index) {
        const prefixes = ["晨星", "暮岚", "霜潮", "曜芒", "绯羽", "海雾", "森语", "月砂", "流焰", "极光", "云锦", "夜虹", "深空", "琉金", "薄荷", "电辉", "潮汐", "星烬", "晶雾", "霞辉"];
        const suffixes = ["流彩", "微光", "脉冲", "余晖", "秘调", "幻层", "光谱", "星涌", "折光", "涂层", "辉斑", "雾面"];
        return prefixes[index % prefixes.length] + suffixes[Math.floor(index / prefixes.length) % suffixes.length];
    }

    function topdownGeneratedBackgroundLabel(index, pattern) {
        const scenes = ["木纹", "星海", "云岚", "雨幕", "裂晶", "墨潮", "极昼", "夜幕", "沙丘", "霜庭", "莲境", "霞谷", "雾森", "霓场", "银河", "古卷"];
        const suffixes = {
            wood: "地台",
            paper: "纸境",
            stone: "石庭",
            grid: "棋域",
            rain: "雨界",
            wave: "潮庭",
            crack: "裂盘",
            prism: "棱幕",
            eclipse: "蚀环",
            lotus: "莲台",
            stars: "星穹",
            galaxy: "星湾",
            aurora: "极幕",
            ink: "墨台",
            petals: "花庭",
            neon: "虹场"
        };
        return scenes[index % scenes.length] + (suffixes[pattern] || "舞台");
    }

    function topdownAppendGeneratedColors(catalog, targetTotal) {
        let created = Object.keys(catalog).length;
        let index = 0;
        while (created < targetTotal && index < 1024) {
            const key = "palette_" + String(index + 1).padStart(3, "0");
            if (Object.prototype.hasOwnProperty.call(catalog, key)) {
                index += 1;
                continue;
            }
            const tier = index % 29 === 0 ? "superrare" : (index % 5 === 0 ? "rare" : "common");
            const hue = (index * 37 + 11) % 360;
            const label = topdownGeneratedColorLabel(index);
            if (tier === "common") {
                catalog[key] = {
                    key: key,
                    label: label,
                    tier: "common",
                    fill: topdownHslToHex(hue, 78, 56),
                    stroke: topdownHslToHex(hue, 92, 88),
                    accent: topdownHslToHex((hue + 28) % 360, 88, 72)
                };
            } else if (tier === "rare") {
                catalog[key] = {
                    key: key,
                    label: label,
                    tier: "rare",
                    stroke: topdownHslToHex((hue + 10) % 360, 88, 90),
                    accent: topdownHslToHex((hue + 60) % 360, 90, 72),
                    gradient: [
                        topdownHslToHex(hue, 74, 28),
                        topdownHslToHex((hue + 34) % 360, 84, 52),
                        topdownHslToHex((hue + 78) % 360, 92, 70)
                    ]
                };
            } else {
                catalog[key] = {
                    key: key,
                    label: label,
                    tier: "superrare",
                    stroke: "#ffffff",
                    accent: topdownHslToHex((hue + 72) % 360, 96, 82),
                    effect: index % 2 === 0 ? "rainbow-breathe" : "",
                    gradient: [
                        topdownHslToHex(hue, 82, 24),
                        topdownHslToHex((hue + 24) % 360, 86, 44),
                        topdownHslToHex((hue + 48) % 360, 92, 60),
                        topdownHslToHex((hue + 96) % 360, 94, 72),
                        topdownHslToHex((hue + 156) % 360, 90, 80)
                    ]
                };
            }
            created += 1;
            index += 1;
        }
    }

    function topdownAppendGeneratedBackgrounds(catalog, targetTotal) {
        const patterns = ["wood", "paper", "stone", "grid", "rain", "wave", "crack", "prism", "eclipse", "lotus", "stars", "galaxy", "aurora", "ink", "petals", "neon"];
        let created = Object.keys(catalog).length;
        let index = 0;
        while (created < targetTotal && index < 1024) {
            const key = "backdrop_" + String(index + 1).padStart(3, "0");
            if (Object.prototype.hasOwnProperty.call(catalog, key)) {
                index += 1;
                continue;
            }
            const pattern = patterns[index % patterns.length];
            const tier = index % 31 === 0 ? "superrare" : (index % 4 === 0 ? "rare" : "common");
            const hue = (index * 29 + 17) % 360;
            const darkPattern = pattern === "stars" || pattern === "galaxy" || pattern === "neon" || pattern === "eclipse" || pattern === "aurora" || pattern === "prism";
            const baseLight = darkPattern ? 12 : 42;
            const accentLight = darkPattern ? 74 : 70;
            const gradient = tier === "common"
                ? [topdownHslToHex(hue, 42, baseLight), topdownHslToHex((hue + 28) % 360, 58, accentLight)]
                : (tier === "rare"
                    ? [
                        topdownHslToHex(hue, 56, darkPattern ? 14 : 26),
                        topdownHslToHex((hue + 26) % 360, 70, darkPattern ? 34 : 44),
                        topdownHslToHex((hue + 64) % 360, 82, 66)
                    ]
                    : [
                        topdownHslToHex(hue, 62, 10),
                        topdownHslToHex((hue + 24) % 360, 72, 24),
                        topdownHslToHex((hue + 56) % 360, 82, 44),
                        topdownHslToHex((hue + 96) % 360, 92, 62),
                        topdownHslToHex((hue + 148) % 360, 96, 78)
                    ]);
            catalog[key] = {
                key: key,
                label: topdownGeneratedBackgroundLabel(index, pattern),
                tier: tier,
                base: gradient[0],
                line: topdownHslToHex((hue + 92) % 360, 88, darkPattern ? 86 : 28),
                accent: topdownHslToHex((hue + 38) % 360, 92, accentLight),
                pattern: pattern,
                gradient: gradient,
                effect: tier === "superrare" ? "shimmer" : ""
            };
            created += 1;
            index += 1;
        }
    }

    function topdownColorCatalog() {
        if (topdownColorCatalogCache) {
            return topdownColorCatalogCache;
        }
        const catalog = {
            classic: { key: "classic", label: "经典蓝", tier: "common", fill: "#38bdf8", stroke: "#bae6fd", accent: "#67e8f9" },
            ember: { key: "ember", label: "余烬红", tier: "common", fill: "#f97316", stroke: "#fdba74", accent: "#fb7185" },
            frost: { key: "frost", label: "冰棱白", tier: "common", fill: "#93c5fd", stroke: "#dbeafe", accent: "#e0f2fe" },
            volt: { key: "volt", label: "电弧黄", tier: "common", fill: "#facc15", stroke: "#fde68a", accent: "#fef08a" },
            nuclear: { key: "nuclear", label: "核域绿", tier: "common", fill: "#4ade80", stroke: "#bbf7d0", accent: "#86efac" },
            void: { key: "void", label: "虚空紫", tier: "common", fill: "#8b5cf6", stroke: "#c4b5fd", accent: "#a78bfa" },
            sakura: { key: "sakura", label: "樱雾粉", tier: "common", fill: "#f472b6", stroke: "#fbcfe8", accent: "#f9a8d4" },
            ghost: { key: "ghost", label: "幽灵银", tier: "common", fill: "#94a3b8", stroke: "#e2e8f0", accent: "#cbd5e1" },
            emerald: { key: "emerald", label: "翡翠潮", tier: "common", fill: "#10b981", stroke: "#a7f3d0", accent: "#6ee7b7" },
            coral: { key: "coral", label: "珊瑚橙", tier: "common", fill: "#fb7185", stroke: "#fecdd3", accent: "#fdba74" },
            cobalt: { key: "cobalt", label: "钴蓝", tier: "common", fill: "#2563eb", stroke: "#bfdbfe", accent: "#60a5fa" },
            amethyst: { key: "amethyst", label: "紫晶", tier: "common", fill: "#a855f7", stroke: "#e9d5ff", accent: "#c084fc" },
            limeflare: { key: "limeflare", label: "青柠闪", tier: "common", fill: "#a3e635", stroke: "#ecfccb", accent: "#bef264" },
            rosequartz: { key: "rosequartz", label: "玫瑰石英", tier: "common", fill: "#fb7185", stroke: "#ffe4e6", accent: "#fda4af" },
            deepsea: { key: "deepsea", label: "深海青", tier: "common", fill: "#0891b2", stroke: "#cffafe", accent: "#22d3ee" },
            amberforge: { key: "amberforge", label: "琥珀炉", tier: "common", fill: "#d97706", stroke: "#fde68a", accent: "#fbbf24" },
            aurora: { key: "aurora", label: "极光流", tier: "rare", stroke: "#d8fbff", accent: "#f9a8d4", gradient: ["#38bdf8", "#34d399", "#f472b6"] },
            magma: { key: "magma", label: "熔火混色", tier: "rare", stroke: "#fed7aa", accent: "#fde68a", gradient: ["#f97316", "#ef4444", "#facc15"] },
            dusk: { key: "dusk", label: "暮空混色", tier: "rare", stroke: "#ddd6fe", accent: "#bfdbfe", gradient: ["#312e81", "#8b5cf6", "#38bdf8"] },
            venom: { key: "venom", label: "毒雾混色", tier: "rare", stroke: "#dcfce7", accent: "#86efac", gradient: ["#84cc16", "#10b981", "#22d3ee"] },
            halo: { key: "halo", label: "圣辉渐层", tier: "rare", stroke: "#fef3c7", accent: "#fff7ed", gradient: ["#fef08a", "#fde68a", "#f59e0b"] },
            nebula: { key: "nebula", label: "星云渐层", tier: "rare", stroke: "#f5d0fe", accent: "#c4b5fd", gradient: ["#7c3aed", "#ec4899", "#22d3ee"] },
            prism: { key: "prism", label: "棱镜混辉", tier: "rare", stroke: "#e0f2fe", accent: "#f5f3ff", gradient: ["#22d3ee", "#a78bfa", "#f472b6"] },
            solarflare: { key: "solarflare", label: "日冕耀斑", tier: "rare", stroke: "#fff7ed", accent: "#fde68a", gradient: ["#fb923c", "#facc15", "#fef3c7"] },
            abyssmint: { key: "abyssmint", label: "深渊薄荷", tier: "rare", stroke: "#ccfbf1", accent: "#5eead4", gradient: ["#0f172a", "#14b8a6", "#a7f3d0"] },
            ionstorm: { key: "ionstorm", label: "离子风暴", tier: "rare", stroke: "#bfdbfe", accent: "#c4b5fd", gradient: ["#1d4ed8", "#7c3aed", "#06b6d4"] },
            bloodmoon: { key: "bloodmoon", label: "血月残辉", tier: "rare", stroke: "#fecaca", accent: "#fda4af", gradient: ["#7f1d1d", "#dc2626", "#f97316"] },
            glacierink: { key: "glacierink", label: "冰川墨蓝", tier: "rare", stroke: "#dbeafe", accent: "#93c5fd", gradient: ["#020617", "#1e3a8a", "#bfdbfe"] },
            lotusdream: { key: "lotusdream", label: "莲梦流光", tier: "rare", stroke: "#fae8ff", accent: "#f0abfc", gradient: ["#f9a8d4", "#c084fc", "#67e8f9"] },
            rainbow: { key: "rainbow", label: "彩虹呼吸", tier: "superrare", stroke: "#ffffff", accent: "#fef9c3", effect: "rainbow-breathe", gradient: ["#ef4444", "#f59e0b", "#facc15", "#22c55e", "#38bdf8", "#8b5cf6"] },
            provinceflare: { key: "provinceflare", label: "省会霓虹", tier: "superrare", stroke: "#ffffff", accent: "#f0abfc", effect: "rainbow-breathe", gradient: ["#0ea5e9", "#22c55e", "#facc15", "#ef4444", "#8b5cf6"] },
            ashveil: { key: "ashveil", label: "混灰渐层", tier: "superrare", stroke: "#f8fafc", accent: "#cbd5e1", gradient: ["#020617", "#64748b", "#f8fafc", "#94a3b8"] },
            quantumgold: { key: "quantumgold", label: "量子鎏金", tier: "superrare", stroke: "#fff7ed", accent: "#fde68a", effect: "rainbow-breathe", gradient: ["#f59e0b", "#fef3c7", "#facc15", "#fb7185"] },
            voidopera: { key: "voidopera", label: "虚空歌剧", tier: "superrare", stroke: "#f5d0fe", accent: "#a78bfa", effect: "rainbow-breathe", gradient: ["#020617", "#4c1d95", "#ec4899", "#22d3ee"] }
        };
        [
            ["pearlmist", "珍珠雾", "#f8fafc", "#e2e8f0", "#bae6fd"], ["sandgold", "沙金", "#f59e0b", "#fde68a", "#fef3c7"],
            ["mintchip", "薄荷芯", "#2dd4bf", "#ccfbf1", "#99f6e4"], ["stormslate", "风暴灰", "#475569", "#cbd5e1", "#94a3b8"],
            ["raspberry", "覆盆莓", "#e11d48", "#fecdd3", "#fb7185"], ["lilac", "丁香紫", "#c084fc", "#f3e8ff", "#d8b4fe"],
            ["seaglass", "海玻璃", "#14b8a6", "#cffafe", "#67e8f9"], ["sunset", "落日橙", "#fb923c", "#fed7aa", "#fdba74"],
            ["inkblue", "墨蓝", "#1e40af", "#dbeafe", "#93c5fd"], ["moss", "苔原绿", "#65a30d", "#d9f99d", "#bef264"],
            ["cream", "奶油白", "#fef3c7", "#ffedd5", "#fde68a"], ["plum", "黑李紫", "#7e22ce", "#e9d5ff", "#c084fc"],
            ["copper", "铜锈", "#b45309", "#fed7aa", "#fb923c"], ["aqua", "水晶青", "#06b6d4", "#cffafe", "#67e8f9"],
            ["ruby", "红宝石", "#dc2626", "#fecaca", "#f87171"], ["olive", "橄榄辉", "#84cc16", "#ecfccb", "#bef264"]
        ].forEach(function (entry) {
            catalog[entry[0]] = { key: entry[0], label: entry[1], tier: "common", fill: entry[2], stroke: entry[3], accent: entry[4] };
        });
        [
            ["starlagoon", "星湖渐层", "#dbeafe", "#93c5fd", ["#0f172a", "#2563eb", "#22d3ee", "#bef264"]],
            ["cherryvolt", "樱电混辉", "#fce7f3", "#f9a8d4", ["#ec4899", "#facc15", "#38bdf8"]],
            ["jadefire", "玉焰流光", "#dcfce7", "#86efac", ["#166534", "#22c55e", "#f97316"]],
            ["moondust", "月尘银蓝", "#e2e8f0", "#cbd5e1", ["#0f172a", "#64748b", "#bfdbfe"]],
            ["violetreef", "紫礁幻彩", "#ede9fe", "#c4b5fd", ["#4c1d95", "#7c3aed", "#14b8a6"]],
            ["emberice", "冰焰裂隙", "#ffedd5", "#fdba74", ["#ef4444", "#fb923c", "#93c5fd"]],
            ["limecosmos", "青柠宇宙", "#ecfccb", "#bef264", ["#020617", "#65a30d", "#a3e635", "#22d3ee"]],
            ["rosemetal", "玫瑰金属", "#ffe4e6", "#fda4af", ["#9f1239", "#fb7185", "#e2e8f0"]],
            ["deepaurora", "深境极光", "#ccfbf1", "#5eead4", ["#111827", "#0f766e", "#a78bfa", "#f472b6"]],
            ["solariris", "太阳虹膜", "#fef3c7", "#fde68a", ["#7c2d12", "#f97316", "#facc15", "#38bdf8"]],
            ["dreamfoam", "梦沫流彩", "#e0f2fe", "#bae6fd", ["#67e8f9", "#f0abfc", "#fef08a"]],
            ["nightorchid", "夜兰混色", "#f5d0fe", "#e879f9", ["#1e1b4b", "#7e22ce", "#ec4899"]]
        ].forEach(function (entry) {
            catalog[entry[0]] = { key: entry[0], label: entry[1], tier: "rare", stroke: entry[2], accent: entry[3], gradient: entry[4] };
        });
        [
            ["hypernova", "超新星脉冲", "#ffffff", "#fef08a", ["#020617", "#facc15", "#ef4444", "#38bdf8", "#a855f7"]],
            ["dragonbreath", "龙息王焰", "#fff7ed", "#fb923c", ["#450a0a", "#dc2626", "#f97316", "#fde68a"]],
            ["celestialmint", "天穹薄荷", "#ecfeff", "#5eead4", ["#022c22", "#14b8a6", "#a7f3d0", "#f0fdfa"]],
            ["royalprism", "王权棱镜", "#ffffff", "#c4b5fd", ["#312e81", "#8b5cf6", "#f472b6", "#fde68a", "#38bdf8"]],
            ["eclipsegold", "日蚀鎏金", "#fff7ed", "#facc15", ["#020617", "#713f12", "#f59e0b", "#fef3c7"]],
            ["neonabyss", "霓虹深渊", "#cffafe", "#22d3ee", ["#020617", "#06b6d4", "#ec4899", "#84cc16"]],
            ["angelcore", "天使核心", "#ffffff", "#fef9c3", ["#f8fafc", "#bae6fd", "#fef08a", "#f0abfc"]],
            ["chaosruby", "混沌红宝", "#fecaca", "#f87171", ["#111827", "#7f1d1d", "#ef4444", "#fbbf24"]]
        ].forEach(function (entry) {
            catalog[entry[0]] = { key: entry[0], label: entry[1], tier: "superrare", stroke: entry[2], accent: entry[3], effect: "rainbow-breathe", gradient: entry[4] };
        });
        topdownAppendGeneratedColors(catalog, 220);
        topdownColorCatalogCache = catalog;
        return topdownColorCatalogCache;
    }

    function topdownCommonColorKeys() {
        return Object.keys(topdownColorCatalog()).filter(function (key) {
            return topdownColorCatalog()[key].tier === "common";
        });
    }

    function topdownRareColorKeys() {
        return Object.keys(topdownColorCatalog()).filter(function (key) {
            return topdownColorCatalog()[key].tier === "rare";
        });
    }

    function topdownSuperRareColorKeys() {
        return Object.keys(topdownColorCatalog()).filter(function (key) {
            return topdownColorCatalog()[key].tier === "superrare";
        });
    }

    function topdownIconCatalog() {
        const rareEmojiKeys = {
            rainbow_emoji: true,
            crown: true,
            gem: true,
            rocket_emoji: true,
            robot: true,
            alien: true,
            ufo: true,
            satellite_emoji: true,
            dragon: true,
            planet: true,
            milkyway: true,
            volcano_emoji: true,
            trophy_emoji: true,
            skull_emoji: true,
            ghost_emoji: true,
            biohazard: true,
            grin_face: true,
            starstruck_face: true,
            sunglasses_face: true,
            monocle_face: true,
            mindblown_face: true,
            smirk_face: true,
            devil_face: true,
            angel_face: true,
            melting_face: true,
            salute_face: true
        };
        const superRareEmojiKeys = {
            galaxy_face: true,
            fire_eyes_face: true,
            crystal_ball: true,
            comet_crown: true,
            blackhole: true,
            phoenix: true
        };
        const namedEmojiIcons = [
            ["grin_face", "咧嘴黄脸", "😁"],
            ["starstruck_face", "星星眼", "🤩"],
            ["sunglasses_face", "墨镜黄脸", "😎"],
            ["monocle_face", "单片镜", "🧐"],
            ["mindblown_face", "脑洞爆炸", "🤯"],
            ["smirk_face", "坏笑黄脸", "😏"],
            ["devil_face", "恶魔黄脸", "😈"],
            ["angel_face", "天使黄脸", "😇"],
            ["melting_face", "融化黄脸", "🫠"],
            ["salute_face", "敬礼黄脸", "🫡"],
            ["galaxy_face", "银河尊颜", "🌌"],
            ["fire_eyes_face", "燃目尊颜", "❤️‍🔥"],
            ["crystal_ball", "水晶预言", "🔮"],
            ["comet_crown", "彗星王冠", "☄️"],
            ["blackhole", "黑洞核心", "🕳️"],
            ["phoenix", "凤凰印记", "🐦‍🔥"]
        ];
        const emojiIcons = [
            ["triangle", "▲"], ["diamond", "◆"], ["spark", "✦"], ["snow", "❄"], ["lightning", "⚡"], ["biohazard", "☢"],
            ["rocket_emoji", "🚀"], ["alien", "👽"], ["robot", "🤖"], ["ghost_emoji", "👻"], ["skull_emoji", "💀"], ["fire", "🔥"],
            ["droplet", "💧"], ["leaf", "🍃"], ["sun", "☀️"], ["moon", "🌙"], ["star_emoji", "⭐"], ["sparkles", "✨"],
            ["comet", "☄️"], ["zap", "🌩️"], ["rainbow_emoji", "🌈"], ["crown", "👑"], ["gem", "💎"], ["heart_emoji", "💖"],
            ["orange_heart", "🧡"], ["yellow_heart", "💛"], ["green_heart", "💚"], ["blue_heart", "💙"], ["purple_heart", "💜"], ["black_heart", "🖤"],
            ["white_heart", "🤍"], ["target", "🎯"], ["soccer", "⚽"], ["basketball", "🏀"], ["baseball", "⚾"], ["tennis", "🎾"],
            ["volleyball", "🏐"], ["8ball", "🎱"], ["bowling", "🎳"], ["trophy_emoji", "🏆"], ["medal", "🏅"], ["gamepad", "🎮"],
            ["joystick", "🕹️"], ["dice", "🎲"], ["slot", "🎰"], ["microphone", "🎤"], ["headphone", "🎧"], ["radio", "📻"],
            ["satellite_emoji", "🛰️"], ["ufo", "🛸"], ["helicopter", "🚁"], ["airplane", "✈️"], ["ship", "🚢"], ["anchor", "⚓"],
            ["car", "🚗"], ["taxi", "🚕"], ["bus", "🚌"], ["train", "🚆"], ["tram", "🚋"], ["bike", "🚲"],
            ["motor", "🏍️"], ["wheel", "🛞"], ["wrench_emoji", "🔧"], ["hammer", "🔨"], ["gear_emoji", "⚙️"], ["nut_bolt", "🔩"],
            ["magnet", "🧲"], ["battery", "🔋"], ["bulb", "💡"], ["flashlight", "🔦"], ["key", "🔑"], ["lock", "🔒"],
            ["unlock", "🔓"], ["shield_emoji", "🛡️"], ["sword", "🗡️"], ["dagger", "🗡"], ["bomb", "💣"], ["gun", "🔫"],
            ["boomerang", "🪃"], ["axe", "🪓"], ["pickaxe", "⛏️"], ["chains", "⛓️"], ["link", "🔗"], ["hook", "🪝"],
            ["beetle", "🪲"], ["bug_emoji", "🐞"], ["spider_emoji", "🕷️"], ["scorpion", "🦂"], ["dragon", "🐉"], ["dino", "🦖"],
            ["octopus", "🐙"], ["fish_emoji", "🐟"], ["whale", "🐋"], ["crab", "🦀"], ["shrimp_emoji", "🦐"], ["frog", "🐸"],
            ["cat", "🐱"], ["dog", "🐶"], ["fox", "🦊"], ["wolf", "🐺"], ["bear", "🐻"], ["panda", "🐼"],
            ["koala", "🐨"], ["tiger", "🐯"], ["lion", "🦁"], ["monkey", "🐵"], ["pig", "🐷"], ["cow", "🐮"],
            ["rabbit", "🐰"], ["mouse", "🐭"], ["chicken", "🐔"], ["penguin", "🐧"], ["bird", "🐦"], ["owl", "🦉"],
            ["eagle", "🦅"], ["crow_emoji", "🐦‍⬛"], ["butterfly", "🦋"], ["flower", "🌸"], ["rose", "🌹"], ["hibiscus", "🌺"],
            ["mushroom", "🍄"], ["tree", "🌳"], ["cactus", "🌵"], ["planet", "🪐"], ["milkyway", "🌌"], ["volcano_emoji", "🌋"],
            ["icecream", "🍦"], ["cookie", "🍪"], ["burger", "🍔"], ["pizza", "🍕"], ["coffee", "☕"], ["boba", "🧋"],
            ["banana", "🍌"], ["apple", "🍎"], ["watermelon", "🍉"], ["grape", "🍇"], ["cherry", "🍒"], ["peach", "🍑"]
        ];
        const svgIcons = [
            ["rocket_svg", "火箭徽记", "/static/svgs/solid/rocket.svg"],
            ["shield_svg", "盾牌徽记", "/static/svgs/solid/shield-halved.svg"],
            ["gear_svg", "齿轮徽记", "/static/svgs/solid/gear.svg"],
            ["bolt_svg", "雷击徽记", "/static/svgs/solid/bolt.svg"],
            ["skull_svg", "骷髅徽记", "/static/svgs/solid/skull.svg"],
            ["ghost_svg", "幽灵徽记", "/static/svgs/solid/ghost.svg"],
            ["heart_svg", "心核徽记", "/static/svgs/solid/heart.svg"],
            ["star_svg", "星芒徽记", "/static/svgs/solid/star.svg"],
            ["bug_svg", "甲壳徽记", "/static/svgs/solid/bug.svg"],
            ["atom_svg", "原子徽记", "/static/svgs/solid/atom.svg"],
            ["meteor_svg", "陨石徽记", "/static/svgs/solid/meteor.svg"],
            ["satellite_svg", "卫星徽记", "/static/svgs/solid/satellite.svg"]
        ];
        const extraEmojiIcons = [
            ["laugh_face", "大笑黄脸", "😂", "rare"], ["joy_face", "乐疯黄脸", "🤣", "rare"], ["wink_face", "眨眼黄脸", "😉", "rare"], ["cool_smile", "自信黄脸", "☺️", "rare"],
            ["blush_face", "脸红黄脸", "😊", "rare"], ["pleading_face", "恳求黄脸", "🥺", "rare"], ["party_face", "派对黄脸", "🥳", "rare"], ["cowboy_face", "牛仔黄脸", "🤠", "rare"],
            ["ninja_face", "忍者黄脸", "🥷", "rare"], ["detective_face", "侦探尊颜", "🕵️", "rare"], ["wizard_face", "法师尊颜", "🧙", "rare"], ["vampire_face", "夜族尊颜", "🧛", "rare"],
            ["troll_face", "巨魔尊颜", "🧌", "superrare"], ["genie_face", "灯神尊颜", "🧞", "superrare"], ["mage_fire", "烈焰法印", "🪄", "superrare"], ["lotus_icon", "莲花徽记", "🪷", "rare"],
            ["dna_icon", "基因螺旋", "🧬", "rare"], ["testtube_icon", "炼金试管", "🧪", "common"], ["compass_icon", "星盘罗盘", "🧭", "common"], ["hourglass_icon", "时砂", "⌛", "common"],
            ["scroll_icon", "古卷", "📜", "common"], ["map_icon", "藏宝图", "🗺️", "common"], ["bell_icon", "灵铃", "🔔", "common"], ["crystal_heart", "晶心", "🫶", "rare"],
            ["mirrorball", "镜球", "🪩", "rare"], ["kite_icon", "风筝", "🪁", "common"], ["yo_yo", "悠悠球", "🪀", "common"], ["magic_disc", "飞盘", "🥏", "common"],
            ["sax_icon", "萨克斯", "🎷", "common"], ["violin_icon", "小提琴", "🎻", "common"], ["drum_icon", "战鼓", "🥁", "common"], ["trumpet_icon", "号角", "🎺", "common"],
            ["ticket_icon", "黄金券", "🎟️", "common"], ["clapper_icon", "星场板", "🎬", "common"], ["palette_icon", "调色盘", "🎨", "rare"], ["thread_icon", "命运线轴", "🧵", "common"],
            ["needle_icon", "银针", "🪡", "common"], ["crystal_seed", "水晶种子", "🫘", "common"], ["teapot_icon", "灵茶壶", "🫖", "common"], ["fortune_cookie", "签语饼", "🥠", "rare"],
            ["ramen_icon", "能量拉面", "🍜", "common"], ["sushi_icon", "寿司标记", "🍣", "common"], ["taco_icon", "塔可星", "🌮", "common"], ["avocado_icon", "牛油果核", "🥑", "common"],
            ["strawberry_icon", "草莓星", "🍓", "common"], ["kiwi_icon", "猕猴桃环", "🥝", "common"], ["pineapple_icon", "菠萝冠", "🍍", "common"], ["coconut_icon", "椰壳", "🥥", "common"],
            ["hotpepper_icon", "辣椒火种", "🌶️", "common"], ["cheese_icon", "奶酪月", "🧀", "common"], ["pretzel_icon", "扭结符", "🥨", "common"], ["cupcake_icon", "纸杯甜心", "🧁", "common"],
            ["donut_icon", "甜甜圈", "🍩", "common"], ["lollipop_icon", "棒棒糖", "🍭", "common"], ["honey_icon", "蜂蜜罐", "🍯", "common"], ["popcorn_icon", "爆米花", "🍿", "common"],
            ["snowman_icon", "雪人", "⛄", "common"], ["cloud_icon", "云团", "☁️", "common"], ["tornado_icon", "龙卷", "🌪️", "rare"], ["fog_icon", "雾域", "🌫️", "common"],
            ["crescent_icon", "弯月", "☾", "common"], ["umbrella_icon", "护伞", "☂️", "common"], ["rain_icon", "雨滴云", "🌧️", "common"], ["snowcloud_icon", "雪云", "🌨️", "common"],
            ["thundercloud_icon", "雷云", "⛈️", "rare"], ["earth_asia_icon", "东方星球", "🌏", "rare"], ["earth_americas_icon", "西境星球", "🌎", "rare"], ["ringed_planet", "环星", "🪐", "rare"],
            ["bat_icon", "夜蝠", "🦇", "common"], ["unicorn_icon", "独角兽", "🦄", "rare"], ["horse_icon", "战马", "🐴", "common"], ["deer_icon", "鹿角", "🦌", "common"],
            ["goat_icon", "山羊", "🐐", "common"], ["camel_icon", "沙舟", "🐪", "common"], ["llama_icon", "羊驼", "🦙", "common"], ["sloth_icon", "树懒", "🦥", "common"],
            ["otter_icon", "水獭", "🦦", "common"], ["seal_icon", "海豹", "🦭", "common"], ["shark_icon", "鲨影", "🦈", "rare"], ["squid_icon", "鱿鱼", "🦑", "common"],
            ["jellyfish_icon", "水母", "🪼", "rare"], ["coral_icon", "珊瑚", "🪸", "rare"], ["parrot_icon", "鹦鹉", "🦜", "common"], ["peacock_icon", "孔雀", "🦚", "rare"],
            ["flamingo_icon", "火烈鸟", "🦩", "common"], ["swan_icon", "天鹅", "🦢", "common"], ["dove_icon", "白鸽", "🕊️", "common"], ["hatching_chick", "破壳星", "🐣", "common"],
            ["honeybee_icon", "蜜蜂", "🐝", "common"], ["ant_icon", "蚁兵", "🐜", "common"], ["mosquito_icon", "蚊影", "🦟", "common"], ["fly_icon", "飞虫", "🪰", "common"],
            ["worm_icon", "蠕虫", "🪱", "common"], ["snail_icon", "蜗牛", "🐌", "common"], ["shell_icon", "贝壳", "🐚", "common"], ["feather_icon", "羽印", "🪶", "rare"],
            ["paw_icon", "爪印", "🐾", "common"], ["bone_icon", "骨符", "🦴", "common"], ["eyes_icon", "洞察之眼", "👀", "rare"], ["brain_icon", "脑核", "🧠", "rare"],
            ["mechanical_arm", "机械臂", "🦾", "rare"], ["mechanical_leg", "机械腿", "🦿", "rare"], ["tooth_icon", "齿印", "🦷", "common"], ["foot_icon", "足迹", "🦶", "common"],
            ["hand_rock", "拳印", "✊", "common"], ["hand_victory", "胜利手势", "✌️", "common"], ["hand_love", "爱心手势", "🫰", "rare"], ["hand_fire", "火手印", "🫴", "rare"],
            ["red_envelope", "红包", "🧧", "rare"], ["coin_icon", "金币", "🪙", "rare"], ["receipt_icon", "契约票据", "🧾", "common"], ["briefcase_icon", "秘匣", "💼", "common"],
            ["toolbox_icon", "工具箱", "🧰", "common"], ["ladder_icon", "阶梯", "🪜", "common"], ["brick_icon", "砖印", "🧱", "common"], ["window_icon", "窗格", "🪟", "common"],
            ["mirror_icon", "镜面", "🪞", "rare"], ["plunger_icon", "吸盘", "🪠", "common"], ["bucket_icon", "桶标", "🪣", "common"], ["soap_icon", "泡泡皂", "🧼", "common"],
            ["toothbrush_icon", "刷柄", "🪥", "common"], ["razor_icon", "剃刀", "🪒", "common"], ["sponge_icon", "海绵", "🧽", "common"], ["pin_icon", "圆头针", "📍", "common"],
            ["paperclip_icon", "回形针", "📎", "common"], ["scissors_icon", "剪影", "✂️", "common"], ["pencil_icon", "铅笔", "✏️", "common"], ["fountain_pen", "钢笔", "🖋️", "common"],
            ["paintbrush_icon", "画笔", "🖌️", "rare"], ["magnifier_icon", "放大镜", "🔎", "common"], ["candle_icon", "烛火", "🕯️", "rare"], ["coffin_icon", "秘棺", "⚰️", "rare"],
            ["urn_icon", "灵瓮", "⚱️", "rare"], ["moai_icon", "石像", "🗿", "rare"], ["ankh_icon", "生命十字", "☥", "superrare"], ["yin_yang_icon", "阴阳核", "☯", "superrare"]
        ];
        const runeGlyphs = Array.from("♠♣♥♦♤♧♡♢♔♕♖♗♘♙♚♛♜♝♞♟☉☽☿♀♁♂♃♄♅♆♇♈♉♊♋♌♍♎♏♐♑♒♓☰☱☲☳☴☵☶☷☀★☆✦✧✩✪✫✬✭✮✯✰✹✺✻✼✽✾✿❀❁❂❃❄❅❆❇❈❉❊❋✚✜✢✣✤✥✱✲✳✴✵✶✷✸◈◇◆◊○◌◎●◐◑◒◓◔◕◖◗◦◯⬡⬢⬣⬟⬠⬤⬥⬦⬧▲△▴▵▶▷▸▹▼▽▾▿◀◁◂◃◉◍◎●");
        const catalog = {
            triangle: { key: "triangle", label: "经典三角", kind: "glyph", glyph: "▲", tier: "common" }
        };
        runeGlyphs.forEach(function (glyph, index) {
            const tier = index % 23 === 0 ? "superrare" : (index % 5 === 0 ? "rare" : "common");
            catalog["rune_" + String(index).padStart(3, "0")] = {
                key: "rune_" + String(index).padStart(3, "0"),
                label: (tier === "superrare" ? "超稀有符文 " : (tier === "rare" ? "稀有符文 " : "符文 ")) + glyph,
                kind: "glyph",
                glyph: glyph,
                tier: tier
            };
        });
        emojiIcons.forEach(function (entry) {
            catalog[entry[0]] = {
                key: entry[0],
                label: "图标 " + entry[1],
                kind: "emoji",
                glyph: entry[1],
                tier: rareEmojiKeys[entry[0]] ? "rare" : "common"
            };
        });
        namedEmojiIcons.forEach(function (entry) {
            catalog[entry[0]] = {
                key: entry[0],
                label: entry[1],
                kind: "emoji",
                glyph: entry[2],
                tier: superRareEmojiKeys[entry[0]] ? "superrare" : "rare"
            };
        });
        extraEmojiIcons.forEach(function (entry) {
            catalog[entry[0]] = {
                key: entry[0],
                label: entry[1],
                kind: "emoji",
                glyph: entry[2],
                tier: entry[3] || "common"
            };
        });
        svgIcons.forEach(function (entry) {
            catalog[entry[0]] = { key: entry[0], label: entry[1], kind: "svg", src: entry[2], glyph: "⬢", tier: "superrare" };
        });
        return catalog;
    }

    function topdownBackgroundCatalog() {
        if (topdownBackgroundCatalogCache) {
            return topdownBackgroundCatalogCache;
        }
        const catalog = {
            dojo: { key: "dojo", label: "竹影道场", tier: "common", base: "#c8924f", line: "#6f4324", accent: "#f7d08a", pattern: "wood" },
            slate: { key: "slate", label: "冷岩棋盘", tier: "common", base: "#334155", line: "#cbd5e1", accent: "#94a3b8", pattern: "grid" },
            parchment: { key: "parchment", label: "古卷纸面", tier: "common", base: "#f5deb3", line: "#8b5e34", accent: "#fef3c7", pattern: "paper" },
            jade: { key: "jade", label: "青玉台", tier: "common", base: "#0f766e", line: "#ccfbf1", accent: "#5eead4", pattern: "stone" },
            midnight: { key: "midnight", label: "午夜蓝图", tier: "common", base: "#0f172a", line: "#60a5fa", accent: "#38bdf8", pattern: "grid" },
            sakura_board: { key: "sakura_board", label: "樱落棋庭", tier: "common", base: "#fbcfe8", line: "#be185d", accent: "#fff1f2", pattern: "petals" },
            bamboo_rain: { key: "bamboo_rain", label: "竹雨庭", tier: "common", base: "#365314", line: "#bef264", accent: "#86efac", pattern: "rain" },
            copper_grid: { key: "copper_grid", label: "铜质网格", tier: "common", base: "#7c2d12", line: "#fed7aa", accent: "#fb923c", pattern: "grid" },
            neon_grid: { key: "neon_grid", label: "霓虹网格", tier: "rare", base: "#020617", line: "#22d3ee", accent: "#f472b6", pattern: "neon", gradient: ["#020617", "#111827", "#0f172a"] },
            starfield: { key: "starfield", label: "星海棋域", tier: "rare", base: "#020617", line: "#93c5fd", accent: "#facc15", pattern: "stars", gradient: ["#020617", "#1e1b4b", "#0f172a"] },
            ink_wash: { key: "ink_wash", label: "水墨云台", tier: "rare", base: "#e2e8f0", line: "#334155", accent: "#64748b", pattern: "ink", gradient: ["#f8fafc", "#cbd5e1", "#94a3b8"] },
            aurora_board: { key: "aurora_board", label: "极光棋盘", tier: "rare", base: "#082f49", line: "#a7f3d0", accent: "#f0abfc", pattern: "aurora", gradient: ["#0f172a", "#0ea5e9", "#22c55e", "#f472b6"] },
            lava_board: { key: "lava_board", label: "熔岩裂盘", tier: "rare", base: "#450a0a", line: "#fdba74", accent: "#ef4444", pattern: "crack", gradient: ["#450a0a", "#7f1d1d", "#f97316"] },
            ocean_board: { key: "ocean_board", label: "深海流域", tier: "rare", base: "#083344", line: "#67e8f9", accent: "#22d3ee", pattern: "wave", gradient: ["#0f172a", "#155e75", "#0891b2"] },
            prism_board: { key: "prism_board", label: "棱镜幻盘", tier: "superrare", base: "#111827", line: "#ffffff", accent: "#facc15", pattern: "prism", effect: "shimmer", gradient: ["#020617", "#7c3aed", "#ec4899", "#22d3ee", "#facc15"] },
            galaxy_board: { key: "galaxy_board", label: "银河王座", tier: "superrare", base: "#020617", line: "#f8fafc", accent: "#a78bfa", pattern: "galaxy", effect: "shimmer", gradient: ["#020617", "#312e81", "#7c3aed", "#06b6d4"] },
            gold_eclipse: { key: "gold_eclipse", label: "日蚀金座", tier: "superrare", base: "#1c1917", line: "#fef3c7", accent: "#f59e0b", pattern: "eclipse", effect: "shimmer", gradient: ["#020617", "#713f12", "#f59e0b", "#fef3c7"] },
            void_lotus: { key: "void_lotus", label: "虚空莲台", tier: "superrare", base: "#1e1b4b", line: "#f5d0fe", accent: "#f472b6", pattern: "lotus", effect: "shimmer", gradient: ["#020617", "#4c1d95", "#ec4899", "#14b8a6"] }
        };
        topdownAppendGeneratedBackgrounds(catalog, 220);
        topdownBackgroundCatalogCache = catalog;
        return topdownBackgroundCatalogCache;
    }

    function topdownLegacySkinCatalog() {
        return {
            classic: { colorKey: "classic", iconKey: "triangle" },
            ember: { colorKey: "ember", iconKey: "diamond" },
            frost: { colorKey: "frost", iconKey: "snow" },
            volt: { colorKey: "volt", iconKey: "lightning" },
            nuclear: { colorKey: "nuclear", iconKey: "biohazard" },
            void: { colorKey: "void", iconKey: "spark" },
            sakura: { colorKey: "sakura", iconKey: "flower" },
            ghost: { colorKey: "ghost", iconKey: "comet" }
        };
    }

    let topdownAchievementCatalogCache = null;

    function createTopdownAchievementStats() {
        return {
            topdownBestScore: 0,
            topdownRunCount: 0,
            topdownKillTotal: 0,
            topdownBossTotal: 0,
            topdownBestWave: 0,
            topdownBestCombo: 0,
            topdownSkillUseTotal: 0,
            sudokuClearTotal: 0,
            sudokuClassicEasyTotal: 0,
            sudokuClassicMediumTotal: 0,
            sudokuClassicHardTotal: 0,
            sudokuHex16Total: 0,
            sudokuSolverlessTotal: 0,
            frontlineRunTotal: 0,
            frontlineVictoryTotal: 0,
            frontlineBestScore: 0,
            game2048RunTotal: 0,
            game2048BestScore: 0,
            game2048MaxTile: 0,
            gomokuMatchTotal: 0,
            gomokuWinTotal: 0
        };
    }

    function topdownNormalizeAchievementStats(raw) {
        const base = Object.assign(createTopdownAchievementStats(), raw && typeof raw === "object" ? raw : {});
        Object.keys(base).forEach(function (key) {
            base[key] = Math.max(0, Math.floor(parseTopdownMetaNumber(base[key])));
        });
        return base;
    }

    function topdownNormalizeAchievementEventKeys(raw) {
        const list = Array.isArray(raw) ? raw : [];
        return list
            .map(function (key) { return String(key || "").trim(); })
            .filter(Boolean)
            .filter(function (key, index, items) { return items.indexOf(key) === index; })
            .slice(-256);
    }

    function topdownNormalizeStoredAchievementBadge(raw) {
        const badge = raw && typeof raw === "object" ? raw : {};
        return {
            id: String(badge.id || ""),
            name: String(badge.name || badge.label || ""),
            shortName: String(badge.shortName || ""),
            tier: String(badge.tier || ""),
            glyph: String(badge.glyph || ""),
            badgeText: String(badge.badgeText || ""),
            group: String(badge.group || "")
        };
    }

function topdownAchievementTierTheme(tier) {
        if (tier === "mythic") {
            return { key: "mythic", label: "神话", color: "#f9a8d4", glow: "rgba(244, 114, 182, 0.6)" };
        }
        if (tier === "diamond") {
            return { key: "diamond", label: "钻石", color: "#7dd3fc", glow: "rgba(125, 211, 252, 0.58)" };
        }
        if (tier === "gold") {
            return { key: "gold", label: "金色", color: "#facc15", glow: "rgba(250, 204, 21, 0.5)" };
        }
        if (tier === "silver") {
            return { key: "silver", label: "银色", color: "#cbd5e1", glow: "rgba(203, 213, 225, 0.44)" };
        }
        return { key: "bronze", label: "铜色", color: "#fb923c", glow: "rgba(251, 146, 60, 0.42)" };
    }

    function topdownAchievementGroups() {
        return {
            topdown: { key: "topdown", label: "俯视射击", glyph: "✦" },
            sudoku: { key: "sudoku", label: "数独", glyph: "⌘" },
            game2048: { key: "game2048", label: "2048", glyph: "▣" },
            frontline: { key: "frontline", label: "前线", glyph: "⚑" },
            gomoku: { key: "gomoku", label: "五子棋", glyph: "◉" },
            gacha: { key: "gacha", label: "抽奖", glyph: "✪" },
            collection: { key: "collection", label: "收藏", glyph: "◈" }
        };
    }

    function topdownRomanNumeral(value) {
        const numerals = [
            ["M", 1000], ["CM", 900], ["D", 500], ["CD", 400],
            ["C", 100], ["XC", 90], ["L", 50], ["XL", 40],
            ["X", 10], ["IX", 9], ["V", 5], ["IV", 4], ["I", 1]
        ];
        let remainder = Math.max(1, Math.floor(Number(value || 1)));
        let result = "";
        numerals.forEach(function (entry) {
            while (remainder >= entry[1]) {
                result += entry[0];
                remainder -= entry[1];
            }
        });
        return result || "I";
    }

    function topdownAchievementTierByProgress(index, total) {
        const ratio = total <= 1 ? 1 : (index / (total - 1));
        if (ratio >= 0.92) {
            return "diamond";
        }
        if (ratio >= 0.68) {
            return "gold";
        }
        if (ratio >= 0.38) {
            return "silver";
        }
        return "bronze";
    }

    function topdownAchievementSeries(config) {
        const values = Array.isArray(config.values) ? config.values : [];
        return values.map(function (threshold, index) {
            const level = index + 1;
            const suffix = topdownRomanNumeral(level);
            return {
                id: config.idPrefix + "-" + level,
                name: config.title + " " + suffix,
                shortName: (config.shortTitle || config.title) + " " + suffix,
                description: config.descriptionPrefix + threshold + (config.descriptionSuffix || ""),
                tier: topdownAchievementTierByProgress(index, values.length),
                glyph: config.glyph || "✦",
                badgeText: suffix,
                group: config.group,
                metric: config.metric,
                threshold: threshold,
                progressSuffix: config.progressSuffix || ""
            };
        });
    }

    function topdownCollectionCountByTier(keys, catalog, tier) {
        return (Array.isArray(keys) ? keys : []).reduce(function (count, key) {
            const item = catalog[key];
            return count + (item && item.tier === tier ? 1 : 0);
        }, 0);
    }

    function topdownAchievementDerivedStats(meta) {
        const resolvedMeta = normalizeTopdownMetaState(meta);
        const stats = Object.assign({}, topdownNormalizeAchievementStats(resolvedMeta.achievementStats));
        const colorCatalog = topdownColorCatalog();
        const iconCatalog = topdownIconCatalog();
        const backgroundCatalog = topdownBackgroundCatalog();
        stats.pullTotal = Math.max(0, Number(resolvedMeta.pulls || 0));
        stats.pointsSpent = Math.max(0, Number(resolvedMeta.totalSpent || 0));
        stats.ownedColorCount = resolvedMeta.ownedColors.length;
        stats.ownedIconCount = resolvedMeta.ownedIcons.length;
        stats.ownedBackgroundCount = resolvedMeta.ownedBackgrounds.length;
        stats.ownedRareColorCount = topdownCollectionCountByTier(resolvedMeta.ownedColors, colorCatalog, "rare");
        stats.ownedSuperRareColorCount = topdownCollectionCountByTier(resolvedMeta.ownedColors, colorCatalog, "superrare");
        stats.ownedRareIconCount = topdownCollectionCountByTier(resolvedMeta.ownedIcons, iconCatalog, "rare");
        stats.ownedSuperRareIconCount = topdownCollectionCountByTier(resolvedMeta.ownedIcons, iconCatalog, "superrare");
        stats.ownedRareBackgroundCount = topdownCollectionCountByTier(resolvedMeta.ownedBackgrounds, backgroundCatalog, "rare");
        stats.ownedSuperRareBackgroundCount = topdownCollectionCountByTier(resolvedMeta.ownedBackgrounds, backgroundCatalog, "superrare");
        stats.allCommonColorsOwned = topdownAllCommonColorsOwned(resolvedMeta) ? 1 : 0;
        stats.allRareColorsOwned = topdownAllRareColorsOwned(resolvedMeta) ? 1 : 0;
        stats.allColorsOwned = resolvedMeta.ownedColors.length >= Object.keys(colorCatalog).length ? 1 : 0;
        stats.allIconsOwned = resolvedMeta.ownedIcons.length >= Object.keys(iconCatalog).length ? 1 : 0;
        stats.allBackgroundsOwned = resolvedMeta.ownedBackgrounds.length >= Object.keys(backgroundCatalog).length ? 1 : 0;
        stats.allCosmeticsOwned = (stats.allColorsOwned && stats.allIconsOwned && stats.allBackgroundsOwned) ? 1 : 0;
        return stats;
    }

    function topdownAchievementCatalog() {
        if (topdownAchievementCatalogCache) {
            return topdownAchievementCatalogCache.slice();
        }
        const groups = topdownAchievementGroups();
        const entries = []
            .concat(topdownAchievementSeries({ idPrefix: "topdown-score", title: "空域试炼", shortTitle: "空域", descriptionPrefix: "俯视射击单局分数达到 ", values: [2000, 5000, 8000, 12000, 18000, 26000, 36000, 48000, 62000, 78000, 95000, 115000, 140000, 170000, 210000, 260000, 320000, 400000], glyph: groups.topdown.glyph, group: "topdown", metric: "topdownBestScore" }))
            .concat(topdownAchievementSeries({ idPrefix: "topdown-run", title: "久经战阵", shortTitle: "战阵", descriptionPrefix: "累计完成俯视射击对局 ", descriptionSuffix: " 局", values: [1, 3, 5, 8, 12, 18, 25, 35, 50, 70, 95, 128], glyph: "✧", group: "topdown", metric: "topdownRunCount" }))
            .concat(topdownAchievementSeries({ idPrefix: "topdown-kills", title: "猎群执照", shortTitle: "猎群", descriptionPrefix: "累计击败敌人 ", descriptionSuffix: " 个", values: [20, 50, 100, 180, 280, 400, 560, 760, 1000, 1300, 1700, 2200, 2800, 3600, 4600, 5800], glyph: "✣", group: "topdown", metric: "topdownKillTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "topdown-boss", title: "首魁断章", shortTitle: "首魁", descriptionPrefix: "累计击败首领 ", descriptionSuffix: " 次", values: [1, 2, 3, 5, 8, 12, 18, 25, 35, 48], glyph: "✦", group: "topdown", metric: "topdownBossTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "topdown-wave", title: "浪潮之眼", shortTitle: "浪潮", descriptionPrefix: "俯视射击单局波次达到 ", values: [2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 18, 20, 24], glyph: "✺", group: "topdown", metric: "topdownBestWave" }))
            .concat(topdownAchievementSeries({ idPrefix: "topdown-combo", title: "追猎连锁", shortTitle: "连锁", descriptionPrefix: "俯视射击单局最佳连杀达到 ", values: [5, 10, 15, 20, 25, 30, 40, 50, 65, 80, 100, 128], glyph: "✹", group: "topdown", metric: "topdownBestCombo" }))
            .concat(topdownAchievementSeries({ idPrefix: "topdown-skill", title: "技相操演", shortTitle: "技相", descriptionPrefix: "累计施放主动技能 ", descriptionSuffix: " 次", values: [1, 3, 5, 8, 12, 18, 28, 42, 64, 96], glyph: "✷", group: "topdown", metric: "topdownSkillUseTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "sudoku-clear", title: "解阵者", shortTitle: "解阵", descriptionPrefix: "累计完成数独 ", descriptionSuffix: " 局", values: [1, 2, 4, 6, 10, 16, 24, 36, 54, 80, 120, 180, 260, 360], glyph: groups.sudoku.glyph, group: "sudoku", metric: "sudokuClearTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "sudoku-easy", title: "入门清道夫", shortTitle: "简阵", descriptionPrefix: "累计完成经典简单数独 ", descriptionSuffix: " 局", values: [1, 3, 6, 10, 16, 24, 36, 54], glyph: "⌑", group: "sudoku", metric: "sudokuClassicEasyTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "sudoku-medium", title: "中盘解构师", shortTitle: "中阵", descriptionPrefix: "累计完成经典中等数独 ", descriptionSuffix: " 局", values: [1, 3, 6, 10, 16, 24, 36, 54], glyph: "⌖", group: "sudoku", metric: "sudokuClassicMediumTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "sudoku-hard", title: "高阶破局人", shortTitle: "破局", descriptionPrefix: "累计完成经典困难数独 ", descriptionSuffix: " 局", values: [1, 2, 4, 6, 10, 16, 24, 36], glyph: "⌬", group: "sudoku", metric: "sudokuClassicHardTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "sudoku-hex16", title: "十六曜解构", shortTitle: "十六曜", descriptionPrefix: "累计完成 HEX-16 数独 ", descriptionSuffix: " 局", values: [1, 2, 3, 5, 8, 12, 18, 26, 38, 56], glyph: "⬢", group: "sudoku", metric: "sudokuHex16Total" }))
            .concat(topdownAchievementSeries({ idPrefix: "sudoku-fair", title: "纯解宣言", shortTitle: "纯解", descriptionPrefix: "累计无自动解题完成数独 ", descriptionSuffix: " 局", values: [1, 3, 6, 10, 16, 24, 36, 54, 80, 120], glyph: "⌗", group: "sudoku", metric: "sudokuSolverlessTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "frontline-run", title: "前线报到", shortTitle: "前线", descriptionPrefix: "累计完成前线对局 ", descriptionSuffix: " 局", values: [1, 3, 5, 8, 12, 18, 28, 42], glyph: groups.frontline.glyph, group: "frontline", metric: "frontlineRunTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "frontline-win", title: "塔群统帅", shortTitle: "统帅", descriptionPrefix: "累计赢下前线胜利 ", descriptionSuffix: " 场", values: [1, 2, 3, 5, 8, 12, 18, 26, 38, 56], glyph: "⚔", group: "frontline", metric: "frontlineVictoryTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "frontline-score", title: "推进脉冲", shortTitle: "推进", descriptionPrefix: "前线单局分数达到 ", values: [800, 1200, 1800, 2500, 3400, 4500, 5800, 7200, 9000, 11000], glyph: "⚑", group: "frontline", metric: "frontlineBestScore" }))
            .concat(topdownAchievementSeries({ idPrefix: "2048-run", title: "拼格热身", shortTitle: "拼格", descriptionPrefix: "累计完成 2048 对局 ", descriptionSuffix: " 局", values: [1, 3, 5, 8, 12, 18, 28, 42], glyph: groups.game2048.glyph, group: "game2048", metric: "game2048RunTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "2048-score", title: "倍增引擎", shortTitle: "倍增", descriptionPrefix: "2048 单局分数达到 ", values: [500, 1000, 1800, 2800, 4200, 6000, 8500, 12000, 16000, 22000], glyph: "▥", group: "game2048", metric: "game2048BestScore" }))
            .concat(topdownAchievementSeries({ idPrefix: "2048-tile", title: "奇点瓷砖", shortTitle: "奇点", descriptionPrefix: "2048 最大数字达到 ", values: [128, 256, 512, 1024, 2048, 4096, 8192], glyph: "▣", group: "game2048", metric: "game2048MaxTile" }))
            .concat(topdownAchievementSeries({ idPrefix: "gomoku-match", title: "手谈约定", shortTitle: "手谈", descriptionPrefix: "累计完成五子棋对局 ", descriptionSuffix: " 局", values: [1, 3, 5, 8, 12, 18, 26, 38, 56, 80], glyph: groups.gomoku.glyph, group: "gomoku", metric: "gomokuMatchTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "gomoku-win", title: "落子名局", shortTitle: "名局", descriptionPrefix: "累计赢下五子棋 ", descriptionSuffix: " 局", values: [1, 2, 3, 5, 8, 12, 18, 26, 38, 56], glyph: "◍", group: "gomoku", metric: "gomokuWinTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "gacha-pulls", title: "星柜开封", shortTitle: "开封", descriptionPrefix: "累计抽奖 ", descriptionSuffix: " 次", values: [1, 5, 10, 20, 35, 55, 80, 120, 180, 260, 360, 500], glyph: groups.gacha.glyph, group: "gacha", metric: "pullTotal" }))
            .concat(topdownAchievementSeries({ idPrefix: "gacha-spend", title: "豪掷流辉", shortTitle: "流辉", descriptionPrefix: "累计消耗局外积分 ", values: [2000, 8000, 16000, 30000, 50000, 80000, 120000, 180000, 260000, 360000], glyph: "✶", group: "gacha", metric: "pointsSpent" }))
            .concat(topdownAchievementSeries({ idPrefix: "collection-colors", title: "色谱采集", shortTitle: "色谱", descriptionPrefix: "拥有颜色外观 ", descriptionSuffix: " 个", values: [5, 10, 20, 30, 45, 60, 80, 100, 125, 150, 180, 220], glyph: groups.collection.glyph, group: "collection", metric: "ownedColorCount" }))
            .concat(topdownAchievementSeries({ idPrefix: "collection-icons", title: "图腾陈列", shortTitle: "图腾", descriptionPrefix: "拥有图标外观 ", descriptionSuffix: " 个", values: [2, 4, 6, 8, 10, 12, 14, 18, 22, 28, 34, 40], glyph: "◌", group: "collection", metric: "ownedIconCount" }))
            .concat(topdownAchievementSeries({ idPrefix: "collection-backgrounds", title: "天幕藏馆", shortTitle: "天幕", descriptionPrefix: "拥有背景外观 ", descriptionSuffix: " 个", values: [5, 10, 20, 30, 45, 60, 80, 100, 125, 150, 180, 220], glyph: "▤", group: "collection", metric: "ownedBackgroundCount" }))
            .concat([
                { id: "collection-common-colors", name: "色谱铺陈", shortName: "色谱铺陈", description: "集齐全部普通颜色", tier: "silver", glyph: "◈", badgeText: "C", group: "collection", metric: "allCommonColorsOwned", threshold: 1 },
                { id: "collection-rare-colors", name: "混色继承", shortName: "混色继承", description: "集齐全部稀有颜色", tier: "gold", glyph: "◈", badgeText: "R", group: "collection", metric: "allRareColorsOwned", threshold: 1 },
                { id: "collection-all-colors", name: "色域王座", shortName: "色域王座", description: "集齐全部颜色外观", tier: "gold", glyph: "⬡", badgeText: "ALL", group: "collection", metric: "allColorsOwned", threshold: 1 },
                { id: "collection-all-backgrounds", name: "银幕馆主", shortName: "银幕馆主", description: "集齐全部背景外观", tier: "silver", glyph: "▦", badgeText: "ALL", group: "collection", metric: "allBackgroundsOwned", threshold: 1 },
                { id: "collection-all-icons", name: "图腾钻藏", shortName: "图腾钻藏", description: "集齐全部图标外观", tier: "diamond", glyph: "◆", badgeText: "ALL", group: "collection", metric: "allIconsOwned", threshold: 1 },
                { id: "collection-complete", name: "通关！", shortName: "通关！", description: "集齐全部颜色、图标与背景外观", tier: "mythic", glyph: "✦", badgeText: "通关", group: "collection", metric: "allCosmeticsOwned", threshold: 1 },
                { id: "collection-rare-icons", name: "稀印收藏", shortName: "稀印收藏", description: "拥有 10 个稀有图标", tier: "gold", glyph: "◇", badgeText: "10", group: "collection", metric: "ownedRareIconCount", threshold: 10 },
                { id: "collection-rare-backgrounds", name: "珍景展廊", shortName: "珍景展廊", description: "拥有 24 个稀有背景", tier: "gold", glyph: "▧", badgeText: "24", group: "collection", metric: "ownedRareBackgroundCount", threshold: 24 },
                { id: "collection-superrare-triad", name: "传说三冠", shortName: "传说三冠", description: "同时拥有至少 1 个超稀有颜色、图标和背景", tier: "diamond", glyph: "✹", badgeText: "III", group: "collection", metric: "ownedSuperRareColorCount", threshold: 1, extraMetrics: [{ metric: "ownedSuperRareIconCount", threshold: 1 }, { metric: "ownedSuperRareBackgroundCount", threshold: 1 }] }
            ]);
        topdownAchievementCatalogCache = entries.map(function (entry, index) {
            return Object.assign({ order: index }, entry);
        });
        return topdownAchievementCatalogCache.slice();
    }

    function topdownAchievementUnlocked(entry, stats) {
        if (!entry) {
            return false;
        }
        const value = Number(stats[entry.metric] || 0);
        if (value < Number(entry.threshold || 0)) {
            return false;
        }
        const extras = Array.isArray(entry.extraMetrics) ? entry.extraMetrics : [];
        return extras.every(function (item) {
            return Number(stats[item.metric] || 0) >= Number(item.threshold || 0);
        });
    }

    function topdownAchievementProgressText(entry, stats) {
        if (!entry) {
            return "";
        }
        const value = Math.max(0, Number(stats[entry.metric] || 0));
        const threshold = Math.max(0, Number(entry.threshold || 0));
        if (threshold <= 1 && String(entry.metric || "").indexOf("all") === 0) {
            return value >= threshold ? "已达成" : "未达成";
        }
        return String(Math.min(value, threshold)) + " / " + String(threshold) + (entry.progressSuffix || "");
    }

    function topdownResolveAchievements(meta) {
        const stats = topdownAchievementDerivedStats(meta);
        return topdownAchievementCatalog().map(function (entry) {
            return Object.assign({}, entry, {
                unlocked: topdownAchievementUnlocked(entry, stats),
                progressText: topdownAchievementProgressText(entry, stats)
            });
        });
    }

    function topdownAchievementSummary(meta) {
        const resolved = topdownResolveAchievements(meta);
        const summary = {
            total: resolved.length,
            unlocked: 0,
            bronze: 0,
            silver: 0,
            gold: 0,
            diamond: 0,
            mythic: 0,
            unlockedByTier: { bronze: 0, silver: 0, gold: 0, diamond: 0, mythic: 0 }
        };
        resolved.forEach(function (entry) {
            const tier = topdownAchievementTierTheme(entry.tier).key;
            summary[tier] += 1;
            if (entry.unlocked) {
                summary.unlocked += 1;
                summary.unlockedByTier[tier] += 1;
            }
        });
        return summary;
    }

    function topdownSelectedAchievementBadge(meta) {
        const resolvedMeta = normalizeTopdownMetaState(meta);
        const selectedId = String(resolvedMeta.selectedAchievementBadge || "");
        if (!selectedId) {
            return null;
        }
        const entry = topdownResolveAchievements(resolvedMeta).find(function (item) {
            return item.id === selectedId && item.unlocked;
        });
        if (!entry) {
            return null;
        }
        return {
            id: entry.id,
            name: entry.name,
            shortName: entry.shortName,
            tier: entry.tier,
            glyph: entry.glyph,
            badgeText: entry.badgeText,
            group: entry.group
        };
    }

    function topdownApplyAchievementProgress(meta, updates) {
        const resolvedMeta = normalizeTopdownMetaState(meta);
        const stats = topdownNormalizeAchievementStats(resolvedMeta.achievementStats);
        const safeUpdates = updates && typeof updates === "object" ? updates : {};
        const add = safeUpdates.add && typeof safeUpdates.add === "object" ? safeUpdates.add : {};
        const setMax = safeUpdates.setMax && typeof safeUpdates.setMax === "object" ? safeUpdates.setMax : {};
        const set = safeUpdates.set && typeof safeUpdates.set === "object" ? safeUpdates.set : {};
        Object.keys(add).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(stats, key)) {
                return;
            }
            stats[key] = Math.max(0, Math.floor(Number(stats[key] || 0) + Number(add[key] || 0)));
        });
        Object.keys(setMax).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(stats, key)) {
                return;
            }
            stats[key] = Math.max(stats[key], Math.max(0, Math.floor(Number(setMax[key] || 0))));
        });
        Object.keys(set).forEach(function (key) {
            if (!Object.prototype.hasOwnProperty.call(stats, key)) {
                return;
            }
            stats[key] = Math.max(0, Math.floor(Number(set[key] || 0)));
        });
        resolvedMeta.achievementStats = stats;
        const selected = topdownSelectedAchievementBadge(resolvedMeta);
        resolvedMeta.selectedAchievementBadgeMeta = selected ? topdownNormalizeStoredAchievementBadge(selected) : topdownNormalizeStoredAchievementBadge({});
        if (!selected) {
            resolvedMeta.selectedAchievementBadge = "";
        }
        return resolvedMeta;
    }

    function topdownRememberAchievementEvent(meta, eventKey) {
        const resolvedMeta = normalizeTopdownMetaState(meta);
        const key = String(eventKey || "").trim();
        if (!key) {
            return false;
        }
        const keys = topdownNormalizeAchievementEventKeys(resolvedMeta.achievementEventKeys);
        if (keys.indexOf(key) !== -1) {
            resolvedMeta.achievementEventKeys = keys;
            return false;
        }
        keys.push(key);
        resolvedMeta.achievementEventKeys = topdownNormalizeAchievementEventKeys(keys);
        return true;
    }

    function topdownSetSelectedAchievementBadge(meta, achievementId) {
        const resolvedMeta = normalizeTopdownMetaState(meta);
        const nextId = String(achievementId || "").trim();
        if (!nextId) {
            resolvedMeta.selectedAchievementBadge = "";
            resolvedMeta.selectedAchievementBadgeMeta = topdownNormalizeStoredAchievementBadge({});
            return resolvedMeta;
        }
        const entry = topdownResolveAchievements(resolvedMeta).find(function (item) {
            return item.id === nextId && item.unlocked;
        });
        if (!entry) {
            return resolvedMeta;
        }
        resolvedMeta.selectedAchievementBadge = entry.id;
        resolvedMeta.selectedAchievementBadgeMeta = topdownNormalizeStoredAchievementBadge({
            id: entry.id,
            name: entry.name,
            shortName: entry.shortName,
            tier: entry.tier,
            glyph: entry.glyph,
            badgeText: entry.badgeText,
            group: entry.group
        });
        return resolvedMeta;
    }

    function createTopdownMetaState() {
        return {
            points: 0,
            totalEarned: 0,
            totalSpent: 0,
            pulls: 0,
            colorPulls: 0,
            iconPulls: 0,
            backgroundPulls: 0,
            freeColorPulls: 0,
            freeIconPulls: 0,
            freeBackgroundPulls: 0,
            loginGiftVersion: 0,
            dailyFreeTen: { color: "", icon: "", background: "" },
            dailyRevive: { date: "", used: 0 },
            colorPity: 0,
            iconPity: 0,
            backgroundPity: 0,
            achievementStats: createTopdownAchievementStats(),
            achievementEventKeys: [],
            selectedAchievementBadge: "",
            selectedAchievementBadgeMeta: {},
            ownedColors: ["classic", "ember"],
            ownedIcons: ["triangle"],
            ownedBackgrounds: ["dojo"],
            equippedColor: "classic",
            equippedIcon: "triangle",
            equippedBackground: "dojo"
        };
    }

    function topdownNormalizeOwnedKeys(rawList, catalog, requiredKey) {
        const fallback = requiredKey ? [requiredKey] : [];
        const list = Array.isArray(rawList) ? rawList : fallback;
        const filtered = list.filter(function (key) {
            return Object.prototype.hasOwnProperty.call(catalog, key);
        });
        if (requiredKey && filtered.indexOf(requiredKey) === -1) {
            filtered.unshift(requiredKey);
        }
        return filtered.filter(function (key, index, items) {
            return items.indexOf(key) === index;
        });
    }

    function parseTopdownMetaNumber(value) {
        if (typeof value === "string") {
            const normalized = value.replace(/[^\d.-]/g, "");
            return Number(normalized || 0);
        }
        return Number(value || 0);
    }

    function normalizeTopdownMetaState(raw) {
        const colorCatalog = topdownColorCatalog();
        const iconCatalog = topdownIconCatalog();
        const backgroundCatalog = topdownBackgroundCatalog();
        const legacyCatalog = topdownLegacySkinCatalog();
        const meta = Object.assign(createTopdownMetaState(), raw || {});
        meta.points = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.points)));
        meta.totalEarned = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.totalEarned)));
        meta.totalSpent = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.totalSpent)));
        meta.pulls = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.pulls)));
        meta.colorPulls = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.colorPulls)));
        meta.iconPulls = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.iconPulls)));
        meta.backgroundPulls = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.backgroundPulls)));
        meta.freeColorPulls = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.freeColorPulls)));
        meta.freeIconPulls = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.freeIconPulls)));
        meta.freeBackgroundPulls = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.freeBackgroundPulls)));
        meta.loginGiftVersion = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.loginGiftVersion)));
        meta.dailyFreeTen = Object.assign({ color: "", icon: "", background: "" }, meta.dailyFreeTen && typeof meta.dailyFreeTen === "object" ? meta.dailyFreeTen : {});
        meta.dailyFreeTen.color = String(meta.dailyFreeTen.color || "");
        meta.dailyFreeTen.icon = String(meta.dailyFreeTen.icon || "");
        meta.dailyFreeTen.background = String(meta.dailyFreeTen.background || "");
        meta.dailyRevive = Object.assign({ date: "", used: 0 }, meta.dailyRevive && typeof meta.dailyRevive === "object" ? meta.dailyRevive : {});
        meta.dailyRevive.date = String(meta.dailyRevive.date || "");
        meta.dailyRevive.used = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.dailyRevive.used)));
        meta.colorPity = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.colorPity)));
        meta.iconPity = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.iconPity)));
        meta.backgroundPity = Math.max(0, Math.floor(parseTopdownMetaNumber(meta.backgroundPity)));
        meta.achievementStats = topdownNormalizeAchievementStats(meta.achievementStats);
        meta.achievementEventKeys = topdownNormalizeAchievementEventKeys(meta.achievementEventKeys);
        meta.selectedAchievementBadge = String(meta.selectedAchievementBadge || "");
        meta.selectedAchievementBadgeMeta = topdownNormalizeStoredAchievementBadge(meta.selectedAchievementBadgeMeta);

        const legacyOwned = Array.isArray(meta.ownedSkins) ? meta.ownedSkins : [];
        const migratedColors = (Array.isArray(meta.ownedColors) ? meta.ownedColors : []).slice();
        const migratedIcons = (Array.isArray(meta.ownedIcons) ? meta.ownedIcons : []).slice();
        legacyOwned.forEach(function (legacyKey) {
            const legacy = legacyCatalog[String(legacyKey || "")];
            if (!legacy) {
                return;
            }
            migratedColors.push(legacy.colorKey);
            migratedIcons.push(legacy.iconKey);
        });
        const legacyEquipped = legacyCatalog[String(meta.equippedSkin || "")] || legacyCatalog.classic;
        meta.ownedColors = topdownNormalizeOwnedKeys(migratedColors, colorCatalog, "classic");
        if (meta.ownedColors.indexOf("ember") === -1) {
            meta.ownedColors.push("ember");
        }
        meta.ownedIcons = topdownNormalizeOwnedKeys(migratedIcons, iconCatalog, "triangle");
        meta.ownedBackgrounds = topdownNormalizeOwnedKeys(meta.ownedBackgrounds, backgroundCatalog, "dojo");
        meta.equippedColor = meta.ownedColors.indexOf(String(meta.equippedColor || legacyEquipped.colorKey || "classic")) !== -1
            ? String(meta.equippedColor || legacyEquipped.colorKey || "classic")
            : "classic";
        meta.equippedIcon = meta.ownedIcons.indexOf(String(meta.equippedIcon || legacyEquipped.iconKey || "triangle")) !== -1
            ? String(meta.equippedIcon || legacyEquipped.iconKey || "triangle")
            : "triangle";
        meta.equippedBackground = meta.ownedBackgrounds.indexOf(String(meta.equippedBackground || "dojo")) !== -1
            ? String(meta.equippedBackground || "dojo")
            : "dojo";
        return meta;
    }

    function setTopdownSharedMetaState(raw) {
        state.topdownMetaState = normalizeTopdownMetaState(raw || {});
        applyActiveGameMetaAppearance();
        return state.topdownMetaState;
    }

    function getTopdownSharedMetaState(raw) {
        if (!state.topdownMetaState) {
            return setTopdownSharedMetaState(raw || {});
        }
        return state.topdownMetaState;
    }

    function notifyTopdownMetaRefresh() {
        applyActiveGameMetaAppearance();
        if (typeof state.topdownMetaRefresh === "function") {
            state.topdownMetaRefresh();
        }
    }

    function applyActiveGameMetaAppearance() {
        if (!els.stageBody || !state.topdownMetaState) {
            return;
        }
        const appearance = topdownEquippedAppearance(state.topdownMetaState);
        const background = appearance.background || topdownBackgroundCatalog().dojo;
        const activeGame = String(state.activeGameId || "");
        const enabled = activeGame && activeGame !== "topdown-shooter" && activeGame !== "gomoku";
        els.stageBody.classList.toggle("games-stage-body--cosmetic", Boolean(enabled));
        if (!enabled) {
            els.stageBody.style.removeProperty("--games-cosmetic-bg");
            els.stageBody.style.removeProperty("--games-cosmetic-line");
            return;
        }
        els.stageBody.style.setProperty("--games-cosmetic-bg", topdownBackgroundCss(background));
        els.stageBody.style.setProperty("--games-cosmetic-line", background.line || background.accent || "#ffffff");
    }

    function serializeTopdownMetaState(meta) {
        const state = normalizeTopdownMetaState(meta);
        const selectedBadge = topdownSelectedAchievementBadge(state);
        return {
            points: state.points,
            totalEarned: state.totalEarned,
            totalSpent: state.totalSpent,
            pulls: state.pulls,
            colorPulls: state.colorPulls,
            iconPulls: state.iconPulls,
            backgroundPulls: state.backgroundPulls,
            freeColorPulls: state.freeColorPulls,
            freeIconPulls: state.freeIconPulls,
            freeBackgroundPulls: state.freeBackgroundPulls,
            loginGiftVersion: state.loginGiftVersion,
            dailyFreeTen: {
                color: state.dailyFreeTen.color || "",
                icon: state.dailyFreeTen.icon || "",
                background: state.dailyFreeTen.background || ""
            },
            dailyRevive: {
                date: state.dailyRevive.date || "",
                used: Math.max(0, Math.floor(parseTopdownMetaNumber(state.dailyRevive.used)))
            },
            colorPity: state.colorPity,
            iconPity: state.iconPity,
            backgroundPity: state.backgroundPity,
            achievementStats: topdownNormalizeAchievementStats(state.achievementStats),
            achievementEventKeys: topdownNormalizeAchievementEventKeys(state.achievementEventKeys),
            selectedAchievementBadge: selectedBadge ? selectedBadge.id : "",
            selectedAchievementBadgeMeta: selectedBadge ? topdownNormalizeStoredAchievementBadge(selectedBadge) : topdownNormalizeStoredAchievementBadge({}),
            ownedColors: state.ownedColors.slice(),
            ownedIcons: state.ownedIcons.slice(),
            ownedBackgrounds: state.ownedBackgrounds.slice(),
            equippedColor: state.equippedColor,
            equippedIcon: state.equippedIcon,
            equippedBackground: state.equippedBackground
        };
    }

    function summarizeTopdownMetaState(meta) {
        const state = normalizeTopdownMetaState(meta);
        const selectedBadge = topdownSelectedAchievementBadge(state);
        const achievementSummary = topdownAchievementSummary(state);
        return {
            points: state.points,
            pulls: state.pulls,
            free_color_pulls: state.freeColorPulls,
            free_icon_pulls: state.freeIconPulls,
            free_background_pulls: state.freeBackgroundPulls,
            color_pity: state.colorPity,
            icon_pity: state.iconPity,
            background_pity: state.backgroundPity,
            equipped_color: state.equippedColor,
            equipped_icon: state.equippedIcon,
            equipped_background: state.equippedBackground,
            owned_colors: state.ownedColors.length,
            owned_icons: state.ownedIcons.length,
            owned_backgrounds: state.ownedBackgrounds.length,
            daily_revive_used: Math.max(0, Math.floor(parseTopdownMetaNumber(state.dailyRevive.used))),
            achievement_badge: selectedBadge ? selectedBadge.id : "",
            achievement_badge_tier: selectedBadge ? selectedBadge.tier : "",
            achievements_unlocked: achievementSummary.unlocked,
            achievements_total: achievementSummary.total
        };
    }

    function topdownEquippedAppearance(meta) {
        const colors = topdownColorCatalog();
        const icons = topdownIconCatalog();
        const backgrounds = topdownBackgroundCatalog();
        const state = normalizeTopdownMetaState(meta);
        return {
            color: colors[state.equippedColor] || colors.classic,
            icon: icons[state.equippedIcon] || icons.triangle,
            background: backgrounds[state.equippedBackground] || backgrounds.dojo
        };
    }

    function topdownIconBonusPreset(icon) {
        const presets = [
            {
                key: "arsenal",
                attackMultiplier: 1.1,
                damageFlat: 1.2,
                fireRateMultiplier: 0.94,
                label: "火力起步"
            },
            {
                key: "wingman",
                wingmanMaxBonus: 1,
                moveSpeedMultiplier: 1.06,
                label: "额外僚机位"
            },
            {
                key: "velocity",
                fireRateMultiplier: 0.88,
                moveSpeedMultiplier: 1.08,
                label: "高机动高速射"
            }
        ];
        const iconKey = String(icon && icon.key || "");
        const hash = iconKey.split("").reduce(function (sum, ch) {
            return sum + ch.charCodeAt(0);
        }, 0);
        return presets[hash % presets.length];
    }

    function topdownColorBonusPreset(color) {
        const safeColor = color || {};
        const tier = String(safeColor.tier || "common");
        if (tier !== "rare" && tier !== "superrare") {
            return {
                attackMultiplier: 1,
                damageFlat: 0,
                fireRateMultiplier: 1,
                moveSpeedMultiplier: 1,
                wingmanMaxBonus: 0,
                label: ""
            };
        }
        const rarePresets = [
            {
                key: "impact",
                attackMultiplier: 1.05,
                damageFlat: 0.6,
                label: "锋彩增伤"
            },
            {
                key: "tempo",
                fireRateMultiplier: 0.94,
                label: "脉冲快射"
            },
            {
                key: "glide",
                moveSpeedMultiplier: 1.06,
                label: "流光机动"
            },
            {
                key: "escort",
                wingmanMaxBonus: 1,
                fireRateMultiplier: 0.97,
                label: "共鸣僚位"
            }
        ];
        const superRarePresets = [
            {
                key: "corona",
                attackMultiplier: 1.1,
                damageFlat: 1.2,
                label: "王冠火力"
            },
            {
                key: "overclock",
                fireRateMultiplier: 0.88,
                moveSpeedMultiplier: 1.08,
                label: "虹潮超频"
            },
            {
                key: "formation",
                wingmanMaxBonus: 1,
                moveSpeedMultiplier: 1.1,
                label: "尊耀编队"
            },
            {
                key: "blitz",
                attackMultiplier: 1.08,
                fireRateMultiplier: 0.92,
                label: "裂变速攻"
            }
        ];
        const presets = tier === "superrare" ? superRarePresets : rarePresets;
        const hash = String(safeColor.key || "").split("").reduce(function (sum, ch) {
            return sum + ch.charCodeAt(0);
        }, 0);
        return presets[hash % presets.length];
    }

    function topdownMergeCosmeticBonus(target, bonus) {
        if (!bonus || typeof bonus !== "object") {
            return target;
        }
        target.attackMultiplier *= Number(bonus.attackMultiplier || 1);
        target.damageFlat += Number(bonus.damageFlat || 0);
        target.fireRateMultiplier *= Number(bonus.fireRateMultiplier || 1);
        target.moveSpeedMultiplier *= Number(bonus.moveSpeedMultiplier || 1);
        target.wingmanMaxBonus += Math.max(0, Math.floor(Number(bonus.wingmanMaxBonus || 0)));
        target.startUpgradeChoices += Math.max(0, Math.floor(Number(bonus.startUpgradeChoices || 0)));
        target.enemySpeedMultiplier *= Number(bonus.enemySpeedMultiplier || 1);
        target.enemyBulletSpeedMultiplier *= Number(bonus.enemyBulletSpeedMultiplier || 1);
        target.enemyFireCooldownMultiplier *= Number(bonus.enemyFireCooldownMultiplier || 1);
        return target;
    }

    function topdownBackgroundBonusPreset(background) {
        const safeBackground = background || {};
        const key = String(safeBackground.key || "");
        if (String(safeBackground.tier || "common") === "rare") {
            const rarePresets = [
                {
                    enemySpeedMultiplier: 0.96,
                    label: "地形牵制"
                },
                {
                    enemyBulletSpeedMultiplier: 0.95,
                    label: "扰流缓弹"
                },
                {
                    enemyFireCooldownMultiplier: 1.05,
                    label: "火力压制"
                },
                {
                    enemySpeedMultiplier: 0.97,
                    enemyBulletSpeedMultiplier: 0.97,
                    label: "双缓战场"
                }
            ];
            const rareHash = key.split("").reduce(function (sum, ch) {
                return sum + ch.charCodeAt(0);
            }, 0);
            return rarePresets[rareHash % rarePresets.length];
        }
        if (key === "prism_board") {
            return {
                enemyBulletSpeedMultiplier: 0.88,
                enemyFireCooldownMultiplier: 1.06,
                label: "敌弹折射减速"
            };
        }
        if (key === "galaxy_board") {
            return {
                enemySpeedMultiplier: 0.88,
                enemyBulletSpeedMultiplier: 0.94,
                label: "引力减速场"
            };
        }
        if (key === "gold_eclipse") {
            return {
                enemyFireCooldownMultiplier: 1.12,
                enemySpeedMultiplier: 0.94,
                label: "日蚀压制"
            };
        }
        if (key === "void_lotus") {
            return {
                enemySpeedMultiplier: 0.9,
                enemyBulletSpeedMultiplier: 0.9,
                label: "虚空迟滞"
            };
        }
        return {
            enemySpeedMultiplier: 1,
            enemyBulletSpeedMultiplier: 1,
            enemyFireCooldownMultiplier: 1,
            label: ""
        };
    }

    function topdownBuildRunCosmeticBonuses(meta) {
        const appearance = topdownEquippedAppearance(meta);
        const color = appearance.color || {};
        const icon = appearance.icon || {};
        const background = appearance.background || {};
        const colorBonus = topdownColorBonusPreset(color);
        const iconBonus = topdownIconBonusPreset(icon);
        const backgroundBonus = topdownBackgroundBonusPreset(background);
        const result = {
            colorKey: String(color.key || "classic"),
            colorTier: String(color.tier || "common"),
            iconKey: String(icon.key || "triangle"),
            iconTier: String(icon.tier || "common"),
            backgroundKey: String(background.key || "dojo"),
            backgroundTier: String(background.tier || "common"),
            startUpgradeChoices: 0,
            attackMultiplier: 1,
            damageFlat: 0,
            fireRateMultiplier: 1,
            moveSpeedMultiplier: 1,
            wingmanMaxBonus: 0,
            enemySpeedMultiplier: 1,
            enemyBulletSpeedMultiplier: 1,
            enemyFireCooldownMultiplier: 1,
            colorBonusLabel: "",
            iconBonusLabel: "",
            backgroundBonusLabel: ""
        };
        if (color.tier === "rare" || color.tier === "superrare") {
            topdownMergeCosmeticBonus(result, colorBonus);
            result.colorBonusLabel = colorBonus.label || "";
        }
        if (icon.tier === "rare") {
            result.startUpgradeChoices = TOPDOWN_BALANCE.rareIconStartChoices;
        } else if (icon.tier === "superrare") {
            result.startUpgradeChoices = TOPDOWN_BALANCE.superRareIconStartChoices;
            topdownMergeCosmeticBonus(result, iconBonus);
            result.iconBonusLabel = iconBonus.label || "";
        }
        if (background.tier === "rare" || background.tier === "superrare") {
            topdownMergeCosmeticBonus(result, backgroundBonus);
            result.backgroundBonusLabel = backgroundBonus.label || "";
        }
        return result;
    }

    function frontlineColorBonusPreset(color) {
        const tier = String(color && color.tier || "common");
        if (tier === "rare") {
            return {
                productionIntervalMultiplier: 0.95,
                travelMultiplier: 0.94,
                dispatchMultiplier: 1,
                startingUnitsBonus: 0,
                upgradeCostMultiplier: 1,
                specialCountBonus: 0,
                label: "前线快编"
            };
        }
        if (tier === "superrare") {
            return {
                productionIntervalMultiplier: 0.9,
                travelMultiplier: 0.88,
                dispatchMultiplier: 1.08,
                startingUnitsBonus: 2,
                upgradeCostMultiplier: 1,
                specialCountBonus: 0,
                label: "统帅涂装"
            };
        }
        return {
            productionIntervalMultiplier: 1,
            travelMultiplier: 1,
            dispatchMultiplier: 1,
            startingUnitsBonus: 0,
            upgradeCostMultiplier: 1,
            specialCountBonus: 0,
            label: ""
        };
    }

    function frontlineBackgroundBonusPreset(background) {
        const tier = String(background && background.tier || "common");
        if (tier === "rare") {
            return {
                productionIntervalMultiplier: 1,
                travelMultiplier: 1,
                dispatchMultiplier: 1,
                startingUnitsBonus: 3,
                upgradeCostMultiplier: 0.94,
                specialCountBonus: 1,
                label: "战地补给"
            };
        }
        if (tier === "superrare") {
            return {
                productionIntervalMultiplier: 1,
                travelMultiplier: 1,
                dispatchMultiplier: 1,
                startingUnitsBonus: 5,
                upgradeCostMultiplier: 0.88,
                specialCountBonus: 2,
                label: "总攻部署"
            };
        }
        return {
            productionIntervalMultiplier: 1,
            travelMultiplier: 1,
            dispatchMultiplier: 1,
            startingUnitsBonus: 0,
            upgradeCostMultiplier: 1,
            specialCountBonus: 0,
            label: ""
        };
    }

    function frontlineMetaBonusLines(bonuses) {
        const lines = [];
        if (Number(bonuses.productionIntervalMultiplier || 1) < 0.9999) {
            lines.push("产兵间隔 -" + Math.round((1 - Number(bonuses.productionIntervalMultiplier || 1)) * 100) + "%");
        }
        if (Number(bonuses.travelMultiplier || 1) < 0.9999) {
            lines.push("行军耗时 -" + Math.round((1 - Number(bonuses.travelMultiplier || 1)) * 100) + "%");
        }
        if (Number(bonuses.dispatchMultiplier || 1) > 1.0001) {
            lines.push("出兵兵力 +" + Math.round((Number(bonuses.dispatchMultiplier || 1) - 1) * 100) + "%");
        }
        if (Number(bonuses.startingUnitsBonus || 0) > 0) {
            lines.push("初始驻军 +" + Math.round(Number(bonuses.startingUnitsBonus || 0)));
        }
        if (Number(bonuses.upgradeCostMultiplier || 1) < 0.9999) {
            lines.push("升级消耗 -" + Math.round((1 - Number(bonuses.upgradeCostMultiplier || 1)) * 100) + "%");
        }
        if (Number(bonuses.specialCountBonus || 0) > 0) {
            lines.push("特殊塔 +" + Math.round(Number(bonuses.specialCountBonus || 0)));
        }
        return lines;
    }

    function frontlineMetaBonusesForPreview(kind, key) {
        const bonuses = {
            productionIntervalMultiplier: 1,
            travelMultiplier: 1,
            dispatchMultiplier: 1,
            startingUnitsBonus: 0,
            upgradeCostMultiplier: 1,
            specialCountBonus: 0,
            colorBonusLabel: "",
            backgroundBonusLabel: "",
            summaryLines: []
        };
        if (kind === "color") {
            const item = topdownColorCatalog()[key] || {};
            const colorBonus = frontlineColorBonusPreset(item);
            bonuses.productionIntervalMultiplier = colorBonus.productionIntervalMultiplier;
            bonuses.travelMultiplier = colorBonus.travelMultiplier;
            bonuses.dispatchMultiplier = colorBonus.dispatchMultiplier;
            bonuses.startingUnitsBonus = colorBonus.startingUnitsBonus;
            bonuses.upgradeCostMultiplier = colorBonus.upgradeCostMultiplier;
            bonuses.specialCountBonus = colorBonus.specialCountBonus;
            bonuses.colorBonusLabel = colorBonus.label || "";
        } else if (kind === "background") {
            const item = topdownBackgroundCatalog()[key] || {};
            const backgroundBonus = frontlineBackgroundBonusPreset(item);
            bonuses.productionIntervalMultiplier = backgroundBonus.productionIntervalMultiplier;
            bonuses.travelMultiplier = backgroundBonus.travelMultiplier;
            bonuses.dispatchMultiplier = backgroundBonus.dispatchMultiplier;
            bonuses.startingUnitsBonus = backgroundBonus.startingUnitsBonus;
            bonuses.upgradeCostMultiplier = backgroundBonus.upgradeCostMultiplier;
            bonuses.specialCountBonus = backgroundBonus.specialCountBonus;
            bonuses.backgroundBonusLabel = backgroundBonus.label || "";
        }
        bonuses.summaryLines = frontlineMetaBonusLines(bonuses);
        return bonuses;
    }

    function frontlineBuildMetaBonuses(meta) {
        const appearance = topdownEquippedAppearance(meta);
        const color = appearance.color || {};
        const background = appearance.background || {};
        const colorBonus = frontlineColorBonusPreset(color);
        const backgroundBonus = frontlineBackgroundBonusPreset(background);
        const result = {
            colorKey: String(color.key || "classic"),
            colorTier: String(color.tier || "common"),
            backgroundKey: String(background.key || "dojo"),
            backgroundTier: String(background.tier || "common"),
            productionIntervalMultiplier: Number(colorBonus.productionIntervalMultiplier || 1) * Number(backgroundBonus.productionIntervalMultiplier || 1),
            travelMultiplier: Number(colorBonus.travelMultiplier || 1) * Number(backgroundBonus.travelMultiplier || 1),
            dispatchMultiplier: Number(colorBonus.dispatchMultiplier || 1) * Number(backgroundBonus.dispatchMultiplier || 1),
            startingUnitsBonus: Math.max(0, Math.round(Number(colorBonus.startingUnitsBonus || 0) + Number(backgroundBonus.startingUnitsBonus || 0))),
            upgradeCostMultiplier: Number(colorBonus.upgradeCostMultiplier || 1) * Number(backgroundBonus.upgradeCostMultiplier || 1),
            specialCountBonus: Math.max(0, Math.round(Number(colorBonus.specialCountBonus || 0) + Number(backgroundBonus.specialCountBonus || 0))),
            colorBonusLabel: colorBonus.label || "",
            backgroundBonusLabel: backgroundBonus.label || "",
            summaryLines: []
        };
        result.summaryLines = frontlineMetaBonusLines(result);
        return result;
    }

    function normalizeTopdownRunCosmeticBonuses(raw) {
        const base = topdownBuildRunCosmeticBonuses(getTopdownSharedMetaState());
        return Object.assign(base, raw && typeof raw === "object" ? raw : {}, {
            startUpgradeChoices: Math.max(0, Math.floor(Number(raw && raw.startUpgradeChoices != null ? raw.startUpgradeChoices : base.startUpgradeChoices))),
            attackMultiplier: Math.max(0.75, Number(raw && raw.attackMultiplier != null ? raw.attackMultiplier : base.attackMultiplier) || 1),
            damageFlat: Number(raw && raw.damageFlat != null ? raw.damageFlat : base.damageFlat) || 0,
            fireRateMultiplier: Math.max(0.72, Number(raw && raw.fireRateMultiplier != null ? raw.fireRateMultiplier : base.fireRateMultiplier) || 1),
            moveSpeedMultiplier: Math.max(0.75, Number(raw && raw.moveSpeedMultiplier != null ? raw.moveSpeedMultiplier : base.moveSpeedMultiplier) || 1),
            wingmanMaxBonus: Math.max(0, Math.floor(Number(raw && raw.wingmanMaxBonus != null ? raw.wingmanMaxBonus : base.wingmanMaxBonus))),
            enemySpeedMultiplier: Math.max(0.72, Number(raw && raw.enemySpeedMultiplier != null ? raw.enemySpeedMultiplier : base.enemySpeedMultiplier) || 1),
            enemyBulletSpeedMultiplier: Math.max(0.72, Number(raw && raw.enemyBulletSpeedMultiplier != null ? raw.enemyBulletSpeedMultiplier : base.enemyBulletSpeedMultiplier) || 1),
            enemyFireCooldownMultiplier: Math.max(0.72, Number(raw && raw.enemyFireCooldownMultiplier != null ? raw.enemyFireCooldownMultiplier : base.enemyFireCooldownMultiplier) || 1),
            colorBonusLabel: String(raw && raw.colorBonusLabel != null ? raw.colorBonusLabel : base.colorBonusLabel || ""),
            iconBonusLabel: String(raw && raw.iconBonusLabel != null ? raw.iconBonusLabel : base.iconBonusLabel || ""),
            backgroundBonusLabel: String(raw && raw.backgroundBonusLabel != null ? raw.backgroundBonusLabel : base.backgroundBonusLabel || "")
        });
    }

    function topdownSessionCosmeticBonuses(session) {
        return normalizeTopdownRunCosmeticBonuses(session && session.cosmeticBonuses);
    }

    function topdownAllCommonColorsOwned(meta) {
        const state = normalizeTopdownMetaState(meta);
        const owned = {};
        state.ownedColors.forEach(function (key) {
            owned[key] = true;
        });
        return topdownCommonColorKeys().every(function (key) {
            return Boolean(owned[key]);
        });
    }

    function topdownAllRareColorsOwned(meta) {
        const state = normalizeTopdownMetaState(meta);
        const owned = {};
        state.ownedColors.forEach(function (key) {
            owned[key] = true;
        });
        return topdownRareColorKeys().every(function (key) {
            return Boolean(owned[key]);
        });
    }

    function topdownTierRank(tier) {
        if (tier === "superrare") {
            return 2;
        }
        if (tier === "rare") {
            return 1;
        }
        return 0;
    }

    function topdownSortCatalogKeysByTier(catalog, descending) {
        return Object.keys(catalog).sort(function (left, right) {
            const leftItem = catalog[left] || {};
            const rightItem = catalog[right] || {};
            const tierDelta = topdownTierRank(leftItem.tier) - topdownTierRank(rightItem.tier);
            if (tierDelta !== 0) {
                return descending ? -tierDelta : tierDelta;
            }
            const labelDelta = String(leftItem.label || left).localeCompare(String(rightItem.label || right), "zh-CN");
            return descending ? -labelDelta : labelDelta;
        });
    }

    function topdownMetaTierLabel(tier, type) {
        if (tier === "superrare") {
            return type === "color" ? "传说色" : (type === "background" ? "超级背景" : "超级稀有");
        }
        if (tier === "rare") {
            return type === "color" ? "稀有色" : (type === "background" ? "稀有背景" : "稀有");
        }
        return type === "color" ? "普通色" : (type === "background" ? "普通背景" : "普通");
    }

    function topdownMetaTierClass(tier) {
        if (tier === "superrare") {
            return "is-superrare";
        }
        return tier === "rare" ? "is-rare" : "is-common";
    }

    function topdownIconPreviewGlyph(icon) {
        return icon && icon.glyph ? icon.glyph : "⬢";
    }

    function topdownWeightedPick(items, getWeight) {
        const list = Array.isArray(items) ? items.slice() : [];
        if (!list.length) {
            return "";
        }
        let totalWeight = 0;
        const normalized = list.map(function (item) {
            const weight = Math.max(0.0001, Number(getWeight(item) || 0.0001));
            totalWeight += weight;
            return { item: item, weight: weight };
        });
        let roll = Math.random() * totalWeight;
        for (let index = 0; index < normalized.length; index += 1) {
            roll -= normalized[index].weight;
            if (roll <= 0) {
                return normalized[index].item;
            }
        }
        return normalized[normalized.length - 1].item;
    }

    function topdownIconDrawWeight(icon) {
        if (icon && icon.tier === "superrare") {
            return 0.035;
        }
        return icon && icon.tier === "rare" ? 0.18 : 1;
    }

    function topdownBackgroundDrawWeight(background) {
        if (background && background.tier === "superrare") {
            return 0.05;
        }
        return background && background.tier === "rare" ? 0.22 : 1;
    }

    function topdownCatalogForKind(kind) {
        if (kind === "color") {
            return topdownColorCatalog();
        }
        if (kind === "background") {
            return topdownBackgroundCatalog();
        }
        return topdownIconCatalog();
    }

    function topdownRollRowBaseKeys(kind) {
        const catalog = topdownCatalogForKind(kind);
        return topdownSortCatalogKeysByTier(catalog);
    }

    function topdownRandomCatalogKey(keys) {
        const list = Array.isArray(keys) ? keys.filter(Boolean) : [];
        return list.length ? list[Math.floor(Math.random() * list.length)] : "";
    }

    function topdownDisplayRollKey(kind) {
        if (kind === "color") {
            const commonPool = topdownCommonColorKeys().filter(function (key) { return key !== "classic"; });
            const rarePool = topdownRareColorKeys();
            const superRarePool = topdownSuperRareColorKeys();
            const roll = Math.random();
            if (roll < 0.15 && superRarePool.length) {
                return topdownRandomCatalogKey(superRarePool);
            }
            if (roll < 0.55 && rarePool.length) {
                return topdownRandomCatalogKey(rarePool);
            }
            return topdownRandomCatalogKey(commonPool.length ? commonPool : topdownCommonColorKeys());
        }
        const catalog = topdownCatalogForKind(kind);
        const tierKeys = topdownRollRowBaseKeys(kind).reduce(function (groups, key) {
            const tier = (catalog[key] && catalog[key].tier) || "common";
            groups[tier] = groups[tier] || [];
            groups[tier].push(key);
            return groups;
        }, {});
        const roll = Math.random();
        if (roll < (kind === "background" ? 0.18 : 0.16) && tierKeys.superrare && tierKeys.superrare.length) {
            return topdownRandomCatalogKey(tierKeys.superrare);
        }
        if (roll < (kind === "background" ? 0.56 : 0.48) && tierKeys.rare && tierKeys.rare.length) {
            return topdownRandomCatalogKey(tierKeys.rare);
        }
        return topdownRandomCatalogKey(tierKeys.common || topdownRollRowBaseKeys(kind));
    }

    function topdownRollSequence(kind, winnerKey, count, rareEnabled, superRareEnabled) {
        const catalog = topdownCatalogForKind(kind);
        const keys = topdownRollRowBaseKeys(kind);
        const sequence = [];
        const winnerIndex = Math.max(18, Math.min((count || 40) - 8, Math.floor((count || 40) * 0.72)));
        for (let index = 0; index < (count || 40); index += 1) {
            if (index === winnerIndex) {
                sequence.push(winnerKey);
                continue;
            }
            sequence.push(topdownDisplayRollKey(kind) || topdownWeightedPick(keys, function (key) {
                return kind === "background" ? topdownBackgroundDrawWeight(catalog[key]) : topdownIconDrawWeight(catalog[key]);
            }));
        }
        return {
            keys: sequence,
            winnerIndex: winnerIndex
        };
    }

    function topdownAppearanceColorStops(color, tick) {
        const stops = Array.isArray(color && color.gradient) && color.gradient.length ? color.gradient.slice() : [];
        if (color && color.effect === "rainbow-breathe") {
            const shift = Math.floor(((Number(tick || 0) % 6) + 6) % 6);
            for (let index = 0; index < shift; index += 1) {
                stops.push(stops.shift());
            }
        }
        if (!stops.length) {
            stops.push((color && color.fill) || "#38bdf8", (color && color.accent) || "#67e8f9");
        }
        return stops;
    }

    function topdownApplyFillStyle(ctx, color, x, y, radius, tick) {
        const stops = topdownAppearanceColorStops(color, tick);
        if (stops.length <= 1) {
            ctx.fillStyle = stops[0];
            return;
        }
        const gradient = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
        const divisor = Math.max(1, stops.length - 1);
        stops.forEach(function (stopColor, index) {
            gradient.addColorStop(index / divisor, stopColor);
        });
        ctx.fillStyle = gradient;
    }

    function topdownElementPalette(element) {
        const map = {
            fire: { fill: "#fb923c", accent: "#facc15", deep: "#ef4444", glow: "rgba(251, 146, 60, 0.42)" },
            ice: { fill: "#93c5fd", accent: "#e0f2fe", deep: "#38bdf8", glow: "rgba(147, 197, 253, 0.42)" },
            electric: { fill: "#facc15", accent: "#fef08a", deep: "#f59e0b", glow: "rgba(250, 204, 21, 0.48)" },
            nuclear: { fill: "#4ade80", accent: "#bbf7d0", deep: "#22c55e", glow: "rgba(74, 222, 128, 0.42)" }
        };
        return map[element] || { fill: "#f8fafc", accent: "#cbd5e1", deep: "#94a3b8", glow: "rgba(248, 250, 252, 0.32)" };
    }

    function topdownIsUltimateProjectile(projectile) {
        return Boolean(projectile && projectile.canUltimate && Number(projectile.elementLevel || 0) >= TOPDOWN_BALANCE.elementCap);
    }

    function drawTopdownElementBullet(ctx, bullet, tick) {
        const palette = topdownElementPalette(bullet.element);
        const ultimate = topdownIsUltimateProjectile(bullet);
        const angle = Math.atan2(Number(bullet.vy || 0), Number(bullet.vx || 0));
        const radius = Number(bullet.radius || 4);
        ctx.save();
        ctx.lineCap = "round";
        ctx.shadowColor = palette.fill;
        ctx.shadowBlur = ultimate ? 20 : 9;
        const trailGradient = ctx.createLinearGradient(bullet.prevX, bullet.prevY, bullet.x, bullet.y);
        trailGradient.addColorStop(0, "rgba(255,255,255,0)");
        trailGradient.addColorStop(0.36, palette.glow);
        trailGradient.addColorStop(1, palette.fill);
        ctx.strokeStyle = trailGradient;
        ctx.lineWidth = ultimate ? Math.max(5, radius * 1.08) : Math.max(2.2, radius * 0.58);
        ctx.beginPath();
        ctx.moveTo(bullet.prevX, bullet.prevY);
        ctx.lineTo(bullet.x, bullet.y);
        ctx.stroke();
        ctx.translate(bullet.x, bullet.y);
        ctx.rotate(angle);
        if (ultimate) {
            ctx.save();
            ctx.rotate(tick * 5 + Number(bullet.visualPhase || 0));
            ctx.strokeStyle = palette.accent;
            ctx.globalAlpha = 0.8;
            ctx.lineWidth = 1.7;
            ctx.beginPath();
            ctx.arc(0, 0, radius * 1.78, 0, Math.PI * 2);
            ctx.stroke();
            for (let index = 0; index < 4; index += 1) {
                ctx.rotate(Math.PI / 2);
                ctx.beginPath();
                ctx.moveTo(radius * 1.05, 0);
                ctx.lineTo(radius * 2.26, 0);
                ctx.stroke();
            }
            ctx.restore();
        }
        if (bullet.element === "fire") {
            ctx.strokeStyle = ultimate ? palette.accent : palette.fill;
            ctx.lineWidth = ultimate ? Math.max(3, radius * 0.62) : Math.max(2, radius * 0.48);
            ctx.globalAlpha = ultimate ? 0.92 : 0.72;
            ctx.beginPath();
            ctx.arc(0, 0, radius * (ultimate ? 1.72 : 1.34), 0, Math.PI * 2);
            ctx.stroke();
            if (ultimate) {
                ctx.strokeStyle = palette.deep;
                ctx.globalAlpha = 0.52;
                ctx.lineWidth = 1.4;
                ctx.beginPath();
                ctx.arc(0, 0, radius * 2.08, 0, Math.PI * 2);
                ctx.stroke();
            }
        } else if (bullet.element === "ice") {
            ctx.fillStyle = ultimate ? palette.accent : palette.fill;
            ctx.beginPath();
            ctx.moveTo(radius * 1.55, 0);
            ctx.lineTo(0, -radius);
            ctx.lineTo(-radius * 1.35, 0);
            ctx.lineTo(0, radius);
            ctx.closePath();
            ctx.fill();
        } else if (bullet.element === "nuclear") {
            ctx.fillStyle = ultimate ? palette.accent : palette.fill;
            ctx.beginPath();
            ctx.arc(0, 0, radius * (ultimate ? 1.2 : 1), 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = palette.deep;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, radius * 1.8, -tick * 4, -tick * 4 + Math.PI * 1.3);
            ctx.stroke();
        } else {
            const core = ctx.createRadialGradient(0, 0, 1, 0, 0, radius * (ultimate ? 1.55 : 1.05));
            core.addColorStop(0, "#ffffff");
            core.addColorStop(0.42, palette.accent);
            core.addColorStop(1, palette.fill);
            ctx.fillStyle = core;
            ctx.beginPath();
            ctx.arc(0, 0, radius * (ultimate ? 1.22 : 1), 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    function drawTopdownElementBeam(ctx, beam) {
        const palette = topdownElementPalette(beam.element || "electric");
        const ultimate = topdownIsUltimateProjectile(beam);
        const lifeBase = beam.hostile ? TOPDOWN_BALANCE.enemyBeamLife : TOPDOWN_BALANCE.electricBeamLife;
        const alpha = Math.max(0.22, Number(beam.life || 0) / lifeBase);
        ctx.save();
        ctx.lineCap = "round";
        ctx.globalAlpha = alpha;
        if (ultimate) {
            ctx.shadowColor = palette.accent;
            ctx.shadowBlur = 18;
            ctx.strokeStyle = palette.glow;
            ctx.lineWidth = (beam.width || 3) + 6;
            ctx.beginPath();
            ctx.moveTo(beam.fromX, beam.fromY);
            ctx.lineTo(beam.toX, beam.toY);
            ctx.stroke();
        }
        ctx.shadowColor = beam.color || palette.fill;
        ctx.shadowBlur = ultimate ? 14 : 6;
        ctx.strokeStyle = beam.color || palette.fill;
        ctx.lineWidth = ultimate ? (beam.width || 3) + 1.6 : (beam.width || 3);
        ctx.beginPath();
        ctx.moveTo(beam.fromX, beam.fromY);
        ctx.lineTo(beam.toX, beam.toY);
        ctx.stroke();
        if (ultimate) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 1.2;
            ctx.globalAlpha = alpha * 0.86;
            ctx.beginPath();
            ctx.moveTo(beam.fromX, beam.fromY);
            ctx.lineTo(beam.toX, beam.toY);
            ctx.stroke();
        }
        ctx.restore();
    }

    function drawTopdownAoeBurstVisual(ctx, burst) {
        const isHostile = burst.type === "enemy-explosion";
        const isNuclearBurst = !isHostile && burst.type !== "radiation" && burst.element === "nuclear";
        const palette = isHostile ? { fill: "#fb7185", accent: "#fecdd3", deep: "#e11d48", glow: "rgba(251,113,133,0.26)" } : topdownElementPalette(burst.element || "nuclear");
        const lifeBase = isHostile ? TOPDOWN_BALANCE.selfDestructBurstLife : (burst.type === "radiation" ? TOPDOWN_BALANCE.nuclearRadiationDuration : TOPDOWN_BALANCE.nuclearBurstLife);
        const progress = clamp(1 - Number(burst.life || 0) / Math.max(0.001, lifeBase), 0, 1);
        const radius = Number(burst.radius || 0) * (0.82 + progress * 0.22);
        ctx.save();
        ctx.globalAlpha = isNuclearBurst
            ? Math.max(0.08, Number(burst.life || 0) / Math.max(0.001, lifeBase) * 0.42)
            : Math.max(0.16, Number(burst.life || 0) / Math.max(0.001, lifeBase));
        ctx.fillStyle = burst.type === "radiation" ? "rgba(74, 222, 128, " + TOPDOWN_BALANCE.nuclearRadiationAlpha + ")" : palette.glow;
        ctx.strokeStyle = palette.fill;
        ctx.lineWidth = burst.ultimate ? 4.2 : 3;
        ctx.shadowColor = palette.fill;
        ctx.shadowBlur = burst.ultimate ? 18 : 8;
        ctx.beginPath();
        ctx.arc(burst.x, burst.y, radius, 0, Math.PI * 2);
        if (isNuclearBurst) {
            ctx.stroke();
            ctx.globalAlpha *= 0.38;
            ctx.lineWidth = burst.ultimate ? 2.2 : 1.6;
            ctx.beginPath();
            ctx.arc(burst.x, burst.y, radius * 0.66, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.fill();
            ctx.stroke();
        }
        if (burst.ultimate) {
            ctx.strokeStyle = palette.accent;
            ctx.lineWidth = 1.8;
            ctx.setLineDash([8, 8]);
            ctx.lineDashOffset = -progress * 32;
            ctx.beginPath();
            ctx.arc(burst.x, burst.y, radius * 0.72, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();
    }

    function topdownBackgroundCss(background) {
        const bg = background || topdownBackgroundCatalog().dojo;
        const layers = [];
        if (bg.pattern === "stars" || bg.pattern === "galaxy") {
            layers.push("radial-gradient(circle at 20% 24%, rgba(255,255,255,.9) 0 1px, transparent 2px)");
            layers.push("radial-gradient(circle at 78% 38%, rgba(255,255,255,.7) 0 1px, transparent 2px)");
        } else if (bg.pattern === "grid" || bg.pattern === "neon") {
            layers.push("repeating-linear-gradient(0deg, rgba(255,255,255,.10) 0 1px, transparent 1px 26px)");
            layers.push("repeating-linear-gradient(90deg, rgba(255,255,255,.10) 0 1px, transparent 1px 26px)");
        } else if (bg.pattern === "rain" || bg.pattern === "wave") {
            layers.push("repeating-linear-gradient(135deg, rgba(255,255,255,.14) 0 2px, transparent 2px 24px)");
        } else if (bg.pattern === "wood" || bg.pattern === "paper" || bg.pattern === "stone") {
            layers.push("repeating-linear-gradient(180deg, rgba(255,255,255,.10) 0 2px, rgba(255,255,255,0) 2px 20px, rgba(0,0,0,.05) 20px 22px)");
        } else if (bg.pattern === "prism" || bg.pattern === "crack" || bg.pattern === "eclipse" || bg.pattern === "lotus") {
            layers.push("linear-gradient(35deg, transparent 0 46%, rgba(255,255,255,.14) 46% 48%, transparent 48% 100%)");
            layers.push("linear-gradient(145deg, transparent 0 52%, rgba(255,255,255,.12) 52% 54%, transparent 54% 100%)");
        } else if (bg.pattern === "aurora") {
            layers.push("radial-gradient(circle at 18% 22%, rgba(255,255,255,.20), transparent 34%)");
            layers.push("radial-gradient(circle at 78% 18%, rgba(255,255,255,.18), transparent 28%)");
        } else if (bg.pattern === "ink") {
            layers.push("radial-gradient(circle at 24% 34%, rgba(15,23,42,.16), transparent 18%)");
            layers.push("radial-gradient(circle at 72% 58%, rgba(15,23,42,.12), transparent 20%)");
        } else if (bg.pattern === "petals") {
            layers.push("radial-gradient(circle at 24% 24%, rgba(255,255,255,.20), transparent 8%)");
            layers.push("radial-gradient(circle at 74% 66%, rgba(255,255,255,.16), transparent 8%)");
        }
        if (bg.gradient && bg.gradient.length) {
            layers.push("linear-gradient(135deg," + bg.gradient.join(",") + ")");
        } else {
            layers.push("linear-gradient(135deg," + (bg.base || "#0f172a") + "," + (bg.accent || bg.line || "#38bdf8") + ")");
        }
        return layers.join(",");
    }

    function topdownBackgroundPreviewStyle(background) {
        const bg = background || topdownBackgroundCatalog().dojo;
        return 'background:' + topdownBackgroundCss(bg) + ';border-color:' + escapeHtml(bg.line || bg.accent || "#ffffff") + ';';
    }

    function drawTopdownCosmeticBackground(ctx, width, height, tick, background) {
        const bg = background || topdownBackgroundCatalog().dojo;
        const gradientStops = Array.isArray(bg.gradient) && bg.gradient.length ? bg.gradient : [bg.base || "#020617", bg.accent || "#1e293b"];
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        const divisor = Math.max(1, gradientStops.length - 1);
        gradientStops.forEach(function (stop, index) {
            gradient.addColorStop(index / divisor, stop);
        });
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        if (bg.pattern === "stars" || bg.pattern === "galaxy") {
            for (let i = 0; i < 90; i += 1) {
                const x = (i * 127 + tick * (bg.effect ? 18 : 10)) % width;
                const y = (i * 53 + tick * 7) % height;
                const alpha = 0.22 + ((i * 17) % 10) / 18;
                ctx.fillStyle = "rgba(248,250,252," + alpha.toFixed(2) + ")";
                ctx.fillRect(x, y, i % 7 === 0 ? 3 : 2, i % 7 === 0 ? 3 : 2);
            }
        } else if (bg.pattern === "grid" || bg.pattern === "neon") {
            ctx.strokeStyle = bg.pattern === "neon" ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.12)";
            ctx.lineWidth = bg.pattern === "neon" ? 1.8 : 1;
            for (let x = 0; x <= width; x += 28) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }
            for (let y = 0; y <= height; y += 28) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }
        } else if (bg.pattern === "aurora") {
            for (let band = 0; band < 4; band += 1) {
                const bandGradient = ctx.createLinearGradient(0, band * height * 0.22, width, band * height * 0.22 + height * 0.28);
                bandGradient.addColorStop(0, "rgba(255,255,255,0)");
                bandGradient.addColorStop(0.35, "rgba(94,234,212,0.14)");
                bandGradient.addColorStop(0.7, "rgba(192,132,252,0.16)");
                bandGradient.addColorStop(1, "rgba(255,255,255,0)");
                ctx.fillStyle = bandGradient;
                ctx.fillRect(0, band * height * 0.18 + Math.sin(tick * 0.8 + band) * 8, width, height * 0.22);
            }
        } else if (bg.pattern === "petals") {
            for (let i = 0; i < 26; i += 1) {
                const x = (i * 51 + tick * 18) % width;
                const y = (i * 37 + tick * 11) % height;
                ctx.fillStyle = "rgba(255,255,255,0.18)";
                ctx.beginPath();
                ctx.ellipse(x, y, 8, 4, Math.sin(i + tick) * 1.2, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (bg.pattern === "ink") {
            for (let i = 0; i < 10; i += 1) {
                ctx.fillStyle = "rgba(15,23,42," + (0.06 + i * 0.01).toFixed(2) + ")";
                ctx.beginPath();
                ctx.arc((i * 89) % width, (i * 61) % height, 18 + (i % 3) * 8, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (bg.pattern === "wood" || bg.pattern === "paper" || bg.pattern === "stone") {
            ctx.strokeStyle = bg.pattern === "paper" ? "rgba(120, 84, 44, 0.12)" : "rgba(255,255,255,0.08)";
            ctx.lineWidth = 2;
            for (let y = 20; y < height; y += 38) {
                ctx.beginPath();
                ctx.moveTo(0, y + Math.sin((tick + y) * 0.03) * 4);
                ctx.bezierCurveTo(width * 0.28, y - 10, width * 0.66, y + 14, width, y + Math.cos(y) * 5);
                ctx.stroke();
            }
        } else if (bg.pattern === "rain" || bg.pattern === "wave") {
            ctx.strokeStyle = "rgba(255,255,255,0.13)";
            ctx.lineWidth = 1.5;
            for (let x = -height; x < width; x += 26) {
                ctx.beginPath();
                ctx.moveTo(x + (tick * 22) % 26, 0);
                ctx.lineTo(x + height + (tick * 22) % 26, height);
                ctx.stroke();
            }
        } else if (bg.pattern === "crack" || bg.pattern === "prism" || bg.pattern === "eclipse" || bg.pattern === "lotus") {
            ctx.strokeStyle = bg.line || "rgba(255,255,255,0.35)";
            ctx.globalAlpha = bg.effect ? 0.24 + Math.sin(tick * 2.2) * 0.08 : 0.18;
            ctx.lineWidth = 2;
            for (let i = 0; i < 12; i += 1) {
                const cx = (i * 83) % width;
                const cy = (i * 47) % height;
                ctx.beginPath();
                ctx.moveTo(cx, cy);
                ctx.lineTo((cx + 80 + i * 9) % width, (cy + 140 + i * 13) % height);
                ctx.stroke();
            }
            ctx.globalAlpha = 1;
        }
    }

    function topdownIconImageCache() {
        const store = topdownIconImageCache._store || (topdownIconImageCache._store = {});
        return store;
    }

    function topdownGetIconImage(icon) {
        if (!icon || icon.kind !== "svg" || !icon.src) {
            return null;
        }
        const cache = topdownIconImageCache();
        if (!cache[icon.src]) {
            const image = new Image();
            image.decoding = "async";
            image.src = icon.src;
            cache[icon.src] = image;
        }
        return cache[icon.src];
    }

    function topdownSkillCatalog() {
        return {
            blink: {
                key: "blink",
                label: "宙斯权杖",
                shortLabel: "权杖",
                description: "按技能键发动。从玩家周围射出一道高速反弹光束，初始持续 5 秒，碰到的所有敌人都会被直接处死。技能强化可同时缩短冷却并延长持续时间。"
            },
            missile: {
                key: "missile",
                label: "导弹矩阵",
                shortLabel: "导弹",
                description: "按技能键发动。把场上的子弹重定向成追踪导弹，优先锁定首领和精英。基础冷却 45 秒；技能持续强化会延长导弹存在时间。"
            },
            invincible: {
                key: "invincible",
                label: "绝对无敌",
                shortLabel: "无敌",
                description: "按技能键发动。立刻获得 10 秒无敌时间。基础冷却 45 秒；可通过强化同时提升持续和冷却。"
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

    function topdownSkillCooldownValue(session) {
        const build = (session && session.build) || normalizeTopdownBuild();
        const level = Math.max(0, Math.min(TOPDOWN_BALANCE.skillUpgradeCap, Number(build.skillCooldownLevel || 0)));
        return TOPDOWN_BALANCE.skillCooldown * Math.max(0.2, 1 - level * TOPDOWN_BALANCE.skillUpgradeStep);
    }

    function topdownSkillEffectMultiplier(session) {
        const build = (session && session.build) || normalizeTopdownBuild();
        const level = Math.max(0, Math.min(TOPDOWN_BALANCE.skillUpgradeCap, Number(build.skillDurationLevel || 0)));
        return 1 + level * TOPDOWN_BALANCE.skillUpgradeStep;
    }

    function topdownSkillBlinkDistance(session) {
        return TOPDOWN_BALANCE.blinkDistance * topdownSkillEffectMultiplier(session);
    }

    function topdownSkillZeusDuration(session) {
        return TOPDOWN_BALANCE.zeusBeamDuration * topdownSkillEffectMultiplier(session);
    }

    function topdownSkillMissileLifetime(session) {
        return TOPDOWN_BALANCE.missileLifetime * topdownSkillEffectMultiplier(session);
    }

    function topdownSkillInvincibleDuration(session) {
        return TOPDOWN_BALANCE.invincibleDuration * topdownSkillEffectMultiplier(session);
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

    function topdownTimeSettlementBonus(session) {
        return Math.max(
            0,
            Math.floor(
                Math.max(0, Number(session && session.elapsedSeconds || 0))
                * Math.max(0, Number(TOPDOWN_BALANCE.settlementTimeScorePerSecond || 0))
            )
        );
    }

    function topdownKillBaseScore(session) {
        return Number((session && session.score) || 0) >= TOPDOWN_SCORE_SOFT_CAP ? 1 : TOPDOWN_BALANCE.killScore;
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
            comboThresholdLevel: 0,
            skillCooldownLevel: 0,
            skillDurationLevel: 0
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
        if (build.skillCooldownLevel) { parts.push("技冷 -" + Math.round(build.skillCooldownLevel * TOPDOWN_BALANCE.skillUpgradeStep * 100) + "%"); }
        if (build.skillDurationLevel) { parts.push("技时 +" + Math.round(build.skillDurationLevel * TOPDOWN_BALANCE.skillUpgradeStep * 100) + "%"); }
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

    function topdownNormalizeElementLevel(level) {
        return Math.max(0, Math.floor(Number(level || 0)));
    }

    function topdownQuantizeValue(value, precision) {
        const numeric = Number(value || 0);
        const step = Math.max(1, Math.floor(Number(precision || 1)));
        if (!Number.isFinite(numeric)) {
            return 0;
        }
        return Math.round(numeric * step) / step;
    }

    function topdownQuantizeHp(value) {
        return Math.max(0, topdownQuantizeValue(value, TOPDOWN_BALANCE.hpPrecision));
    }

    function topdownQuantizeDamage(value) {
        const quantized = Math.max(0, topdownQuantizeValue(value, TOPDOWN_BALANCE.damagePrecision));
        return quantized <= TOPDOWN_BALANCE.damageEpsilon ? 0 : quantized;
    }

    function topdownResolveBulletElementLevel(session, owner, element, explicitLevel) {
        if (String(element || "none") === "none") {
            return 0;
        }
        const directLevel = topdownNormalizeElementLevel(explicitLevel);
        if (directLevel > 0) {
            return directLevel;
        }
        const build = session && session.build;
        const isWingman = owner === "wingman";
        const resolved = topdownBuildElementLevel(build, isWingman, element);
        if (resolved > 0) {
            return topdownNormalizeElementLevel(resolved);
        }
        if (isWingman && build) {
            if (element === "fire") {
                return topdownNormalizeElementLevel(build.wingmanFireLevel);
            }
            if (element === "electric") {
                return topdownNormalizeElementLevel(build.wingmanElectricLevel);
            }
            if (element === "ice") {
                return topdownNormalizeElementLevel(build.wingmanIceLevel);
            }
            if (element === "nuclear") {
                return topdownNormalizeElementLevel(build.wingmanNuclearLevel);
            }
            return topdownNormalizeElementLevel(build.wingmanLevel);
        }
        return 0;
    }

    function topdownNormalizeBulletState(session, bullet) {
        if (!bullet) {
            return bullet;
        }
        bullet.element = String(bullet.element || "none");
        bullet.elementLevel = topdownResolveBulletElementLevel(session, bullet.owner, bullet.element, bullet.elementLevel);
        bullet.damage = topdownQuantizeDamage(bullet.damage);
        bullet.canUltimate = bullet.canUltimate !== false;
        bullet.ultimate = bullet.canUltimate && bullet.elementLevel >= TOPDOWN_BALANCE.elementCap;
        return bullet;
    }

    function topdownFormatHpValue(value) {
        const hp = topdownQuantizeHp(value);
        const fractional = Math.abs(hp - Math.round(hp)) > TOPDOWN_BALANCE.killEpsilon;
        if (fractional && hp <= TOPDOWN_BALANCE.enemyHpTextDecimalThreshold) {
            return hp.toFixed(TOPDOWN_BALANCE.enemyHpTextDecimals);
        }
        return String(Math.max(1, Math.ceil(hp - TOPDOWN_BALANCE.killEpsilon)));
    }

    function topdownBuildElementLevel(build, isWingman, element) {
        const key = element || topdownBuildElementKey(build, isWingman);
        if (isWingman) {
            if (key === "none" || key !== String((build && build.wingmanElement) || "none")) {
                return 0;
            }
            if (key === "fire" && Number((build && build.wingmanFireLevel) || 0) > 0) {
                return topdownNormalizeElementLevel(build.wingmanFireLevel);
            }
            if (key === "electric" && Number((build && build.wingmanElectricLevel) || 0) > 0) {
                return topdownNormalizeElementLevel(build.wingmanElectricLevel);
            }
            if (key === "ice" && Number((build && build.wingmanIceLevel) || 0) > 0) {
                return topdownNormalizeElementLevel(build.wingmanIceLevel);
            }
            if (key === "nuclear" && Number((build && build.wingmanNuclearLevel) || 0) > 0) {
                return topdownNormalizeElementLevel(build.wingmanNuclearLevel);
            }
            return topdownNormalizeElementLevel((build && build.wingmanLevel) || 0);
        }
        if (key === "fire") {
            return topdownNormalizeElementLevel(build && build.fireLevel);
        }
        if (key === "electric") {
            return topdownNormalizeElementLevel(build && build.electricLevel);
        }
        if (key === "nuclear") {
            return topdownNormalizeElementLevel(build && build.nuclearLevel);
        }
        if (key === "ice") {
            return topdownNormalizeElementLevel(build && build.iceLevel);
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
            "僚机：" + session.build.wingmanLevel + "/" + topdownMaxWingmanSlots(session),
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

    function topdownMaxWingmanSlots(session) {
        return TOPDOWN_BALANCE.wingmanMax + topdownSessionCosmeticBonuses(session).wingmanMaxBonus;
    }

    function topdownCosmeticBonusSummary(session) {
        const bonuses = topdownSessionCosmeticBonuses(session);
        const parts = [];
        if (bonuses.startUpgradeChoices > 0) {
            parts.push("开局强化 +" + bonuses.startUpgradeChoices);
        }
        if (bonuses.colorBonusLabel) {
            parts.push("颜色加成:" + bonuses.colorBonusLabel);
        }
        if (bonuses.iconBonusLabel) {
            parts.push("图标加成:" + bonuses.iconBonusLabel);
        }
        if (bonuses.backgroundBonusLabel) {
            parts.push("背景加成:" + bonuses.backgroundBonusLabel);
        }
        return parts.join(" / ");
    }

    function topdownPlayerPowerScore(session) {
        const stats = getTopdownDerivedStats(session, false);
        const wingStats = session.build.wingmanLevel > 0 ? getTopdownDerivedStats(session, true) : null;
        const shieldStats = getTopdownShieldStats(session);
        const baseShotsPerSecond = 1 / TOPDOWN_BALANCE.baseFireInterval;
        const currentShotsPerSecond = 1 / Math.max(0.01, Number(stats.fireInterval || TOPDOWN_BALANCE.baseFireInterval));
        let score = 1;
        score += Math.max(0, (Number(stats.damage || TOPDOWN_BALANCE.baseBulletDamage) - TOPDOWN_BALANCE.baseBulletDamage) / 2.8);
        score += Math.max(0, currentShotsPerSecond - baseShotsPerSecond) * 0.38;
        score += Math.max(0, Number(stats.moveSpeed || TOPDOWN_BALANCE.baseMoveSpeed) - TOPDOWN_BALANCE.baseMoveSpeed) / 130;
        score += Math.max(0, Number(stats.multishot || 1) - 1) * 0.55;
        score += Math.max(0, Number(session.build.projectileLevel || 0)) * 0.16;
        score += Math.max(0, Number(session.build.skillCooldownLevel || 0)) * 0.14;
        score += Math.max(0, Number(session.build.skillDurationLevel || 0)) * 0.14;
        score += Math.max(0, Number(session.build.comboWindowLevel || 0)) * 0.08;
        score += Math.max(0, Number(session.build.comboThresholdLevel || 0)) * 0.08;
        score += Math.max(0, Number(shieldStats.max || TOPDOWN_BALANCE.baseShieldLayers) - TOPDOWN_BALANCE.baseShieldLayers) * 0.32;
        score += Math.max(0, Number(session.build.wingmanLevel || 0)) * 0.58;
        if (wingStats) {
            score += Math.max(0, Number(wingStats.damage || 0)) * 0.06;
            score += Math.max(0, (1 / Math.max(0.01, Number(wingStats.fireInterval || TOPDOWN_BALANCE.baseFireInterval))) - baseShotsPerSecond * 0.7) * 0.16;
        }
        score += topdownRelicStacks(session, "field-dampener") * 0.18;
        score += topdownRelicStacks(session, "fluid-dynamics") * 0.18;
        score += topdownRelicStacks(session, "rate-disruptor") * 0.18;
        score += topdownRelicStacks(session, "shrink-engine") * 0.16;
        score += topdownRelicStacks(session, "magnetic-trap") * 0.22;
        score += topdownRelicStacks(session, "pickup-magnet") * 0.08;
        return Math.max(1, score);
    }

    function topdownPlayerPowerPressure(session) {
        return Math.min(
            TOPDOWN_BALANCE.enemyPowerPressureSoftCap,
            Math.max(0, topdownPlayerPowerScore(session) - 1)
        );
    }

    function topdownPlayerEffectiveDps(session) {
        if (!session || !session.build) {
            return 0;
        }
        const playerStats = getTopdownDerivedStats(session, false);
        if (!playerStats) {
            return 0;
        }
        const playerShotsPerSecond = 1 / Math.max(0.01, Number(playerStats.fireInterval || TOPDOWN_BALANCE.baseFireInterval));
        const playerDps = playerShotsPerSecond * Math.max(0, Number(playerStats.damage || 0)) * Math.max(1, Number(playerStats.multishot || 1));

        const wingCount = Math.min(Math.max(0, Number(session.build.wingmanLevel || 0)), topdownMaxWingmanSlots(session));
        if (wingCount <= 0) {
            return Math.max(0, playerDps);
        }
        const wingStats = getTopdownDerivedStats(session, true);
        if (!wingStats) {
            return Math.max(0, playerDps);
        }
        const wingShotsPerSecond = 1 / Math.max(0.01, Number(wingStats.fireInterval || TOPDOWN_BALANCE.baseFireInterval));
        const wingDpsPerWing = wingShotsPerSecond * Math.max(0, Number(wingStats.damage || 0)) * Math.max(1, Number(wingStats.multishot || 1));
        return Math.max(0, playerDps + wingDpsPerWing * wingCount);
    }

    function topdownTtkDpsForScaling(session) {
        const dps = topdownPlayerEffectiveDps(session);
        return topdownApplySoftCap(dps, TOPDOWN_BALANCE.ttkDpsSoftCap, TOPDOWN_BALANCE.ttkDpsOverflowFactor);
    }

    function topdownTtkEnemyHpMultiplier(session, baseHp) {
        const hp = Math.max(0, Number(baseHp || 0));
        if (hp <= TOPDOWN_BALANCE.killEpsilon) {
            return 1;
        }
        const dps = topdownTtkDpsForScaling(session);
        if (dps <= 0.001) {
            return 1;
        }
        const currentTtk = hp / dps;
        const growthEndWave = Math.max(1, Number(TOPDOWN_BALANCE.ttkGrowthEndWave || 18));
        const waveProgress = clamp((Math.max(1, Number(session && session.wave || 1)) - 1) / Math.max(1, growthEndWave - 1), 0, 1);
        const desiredTtk = TOPDOWN_BALANCE.ttkMinSeconds + (TOPDOWN_BALANCE.ttkMaxSeconds - TOPDOWN_BALANCE.ttkMinSeconds) * waveProgress;
        const mult = desiredTtk / Math.max(0.001, currentTtk);
        return clamp(mult, TOPDOWN_BALANCE.ttkEnemyHpMultiplierMin, TOPDOWN_BALANCE.ttkEnemyHpMultiplierMax);
    }

    function topdownPrimeStartingUpgradeChoices(session) {
        const remaining = Math.max(0, Math.floor(Number(session.startUpgradeChoicesRemaining || 0)));
        if (remaining <= 0 || session.pendingUpgrade || session.pendingPickupChoice) {
            return;
        }
        session.pendingUpgrade = {
            choices: buildTopdownUpgradeChoices(session),
            rerolled: false,
            startupRemaining: remaining
        };
    }

    function getTopdownDerivedStats(session, isWingman) {
        const factor = isWingman ? TOPDOWN_BALANCE.wingmanDamageFactor : 1;
        const build = session.build;
        const cosmeticBonuses = topdownSessionCosmeticBonuses(session);
        const rapidFireMultiplier = topdownBuffRemaining(session, "rapidFireUntil") > 0 ? 0.5 : 1;
        const moveSpeedMultiplier = topdownBuffRemaining(session, "moveSpeedUntil") > 0 ? 2 : 1;
        const element = topdownBuildElementKey(build, Boolean(isWingman));
        const elementLevel = topdownBuildElementLevel(build, Boolean(isWingman), element);
        const rawMoveSpeed = (TOPDOWN_BALANCE.baseMoveSpeed + build.moveSpeedLevel * TOPDOWN_BALANCE.moveSpeedPerLevel + Number(build.moveSpeedBonus || 0))
            * moveSpeedMultiplier
            * (isWingman ? 1 : cosmeticBonuses.moveSpeedMultiplier);
        const rawFireInterval = Math.max(
            0.02,
            TOPDOWN_BALANCE.baseFireInterval
                * (1 - build.fireRateLevel * TOPDOWN_BALANCE.fireRateStep - Number(build.fireRateBonus || 0))
                * (isWingman ? TOPDOWN_BALANCE.wingmanFireRateFactor : cosmeticBonuses.fireRateMultiplier)
                * rapidFireMultiplier
        );
        const rawShotsPerSecond = 1 / rawFireInterval;
        const cappedShotsPerSecond = Math.min(
            TOPDOWN_BALANCE.fireRateHardCapPerSecond,
            topdownApplySoftCap(rawShotsPerSecond, TOPDOWN_BALANCE.fireRateSoftCapPerSecond, TOPDOWN_BALANCE.fireRateOverflowFactor)
        );
        const rawDamage = (TOPDOWN_BALANCE.baseBulletDamage + build.attackLevel * TOPDOWN_BALANCE.attackPerLevel + Number(build.attackBonus || 0))
            * (isWingman ? 1 : cosmeticBonuses.attackMultiplier)
            + (isWingman ? 0 : cosmeticBonuses.damageFlat);
        return {
            moveSpeed: topdownApplySoftCap(rawMoveSpeed, TOPDOWN_BALANCE.moveSpeedSoftCap, TOPDOWN_BALANCE.moveSpeedOverflowFactor),
            fireInterval: Math.max(TOPDOWN_BALANCE.minFireInterval, 1 / Math.max(0.01, cappedShotsPerSecond)),
            damage: topdownQuantizeDamage(topdownApplySoftCap(rawDamage, TOPDOWN_BALANCE.damageSoftCap, TOPDOWN_BALANCE.damageOverflowFactor) * factor),
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
        const availablePool = excludeKeys.length
            ? fullPool.filter(function (entry) {
                return excludeKeys.indexOf(String(entry.key)) === -1;
            })
            : fullPool.slice();
        if (availablePool.length <= 3) {
            return availablePool.map(function (entry) {
                return { key: entry.key, label: entry.label, description: entry.description, meta: entry.meta || {} };
            });
        }
        const utilityPool = availablePool.filter(function (entry) {
            return entry.meta && entry.meta.category === "reconfig";
        });
        const growthPool = availablePool.filter(function (entry) {
            return !(entry.meta && entry.meta.category === "reconfig");
        });
        let selected = chooseDistinctEntries(growthPool, Math.min(3, growthPool.length));
        if (utilityPool.length && (selected.length < 3 || Math.random() < 0.4)) {
            selected = selected.slice(0, Math.min(2, selected.length));
            selected = selected.concat(chooseDistinctEntries(utilityPool, 1));
        }
        if (selected.length < 3) {
            const selectedKeys = selected.map(function (entry) { return String(entry.key); });
            const remainderGrowth = growthPool.filter(function (entry) {
                return selectedKeys.indexOf(String(entry.key)) === -1;
            });
            selected = selected.concat(chooseDistinctEntries(remainderGrowth, 3 - selected.length));
        }
        if (selected.length < 3) {
            const selectedKeys = selected.map(function (entry) { return String(entry.key); });
            const hasUtility = selected.some(function (entry) {
                return entry.meta && entry.meta.category === "reconfig";
            });
            if (!hasUtility) {
                const remainderUtility = utilityPool.filter(function (entry) {
                    return selectedKeys.indexOf(String(entry.key)) === -1;
                });
                selected = selected.concat(chooseDistinctEntries(remainderUtility, 1));
            }
        }
        selected = selected.slice(0, 3);
        return selected.map(function (entry) {
            return { key: entry.key, label: entry.label, description: entry.description, meta: entry.meta || {} };
        });
    }

    function applyTopdownUpgrade(session, upgradeChoice) {
        const upgradeKey = typeof upgradeChoice === "string" ? upgradeChoice : upgradeChoice.key;
        const upgradeMeta = typeof upgradeChoice === "string" ? {} : (upgradeChoice.meta || {});
        const startupRemaining = Math.max(0, Number(session.pendingUpgrade && session.pendingUpgrade.startupRemaining || 0));
        const entry = buildTopdownUpgradePool(session).find(function (item) { return item.key === upgradeKey; });
        if (!entry) {
            return false;
        }
        entry.apply(upgradeMeta);
        syncTopdownWingmanLoadout(session);
        session.startUpgradeChoicesRemaining = Math.max(0, startupRemaining - 1);
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
        if (session.startUpgradeChoicesRemaining > 0) {
            topdownPrimeStartingUpgradeChoices(session);
        }
        return true;
    }

    function topdownEnemyHp(session) {
        const latePressure = topdownLatePressure(session);
        const powerPressure = topdownPlayerPowerPressure(session);
        return topdownQuantizeHp(
            TOPDOWN_BALANCE.enemyBaseHp
            + Math.pow(Math.max(1, Number(session.wave || 1)), 1.22) * TOPDOWN_BALANCE.enemyHpPerWave
            + Number(session.kills || 0) * TOPDOWN_BALANCE.enemyHpPerKill
            + Number(session.bossesDefeated || 0) * TOPDOWN_BALANCE.enemyHpPerBoss
            + powerPressure * TOPDOWN_BALANCE.enemyPowerHpStep
            + Math.pow(powerPressure, TOPDOWN_BALANCE.enemyPowerHpExponent) * TOPDOWN_BALANCE.enemyPowerHpCurve
            + Math.pow(latePressure, TOPDOWN_BALANCE.lateEnemyHpExponent) * TOPDOWN_BALANCE.lateEnemyHpPerWave
        );
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
        const powerPressure = topdownPlayerPowerPressure(session);
        const cosmeticBonuses = topdownSessionCosmeticBonuses(session);
        const hpMultiplier = spawnBoss ? TOPDOWN_BALANCE.bossHpMultiplier : (isElite ? TOPDOWN_BALANCE.eliteHpMultiplier : 1);
        const baseHp = topdownEnemyHp(session) + randomBetween(0, Math.max(1, session.wave) * 0.9) + difficultyScale;
        const ttkHpMultiplier = topdownTtkEnemyHpMultiplier(session, baseHp);
        const hp = topdownQuantizeHp(baseHp * ttkHpMultiplier * hpMultiplier);
        const fireRateMultiplier = (spawnBoss ? TOPDOWN_BALANCE.bossFireRateMultiplier : (isElite ? TOPDOWN_BALANCE.eliteFireRateMultiplier : 1))
            * Math.max(0.7, 1 - powerPressure * TOPDOWN_BALANCE.enemyPowerFireRateStep)
            * cosmeticBonuses.enemyFireCooldownMultiplier;
        const bulletCount = spawnBoss ? TOPDOWN_BALANCE.bossBulletCount : (isElite ? TOPDOWN_BALANCE.eliteBulletCount : 1);
        const bulletSpeedMultiplier = (spawnBoss ? TOPDOWN_BALANCE.bossBulletSpeedMultiplier : (1 + Math.max(0, session.wave - 1) * TOPDOWN_BALANCE.eliteBulletSpeedPerWave / 100))
            * (1 + powerPressure * TOPDOWN_BALANCE.enemyPowerBulletSpeedStep)
            * cosmeticBonuses.enemyBulletSpeedMultiplier;
        const speedMultiplier = (spawnBoss ? TOPDOWN_BALANCE.bossSpeedMultiplier : (isElite ? TOPDOWN_BALANCE.eliteSpeedMultiplier : 1))
            * (1 + powerPressure * TOPDOWN_BALANCE.enemyPowerSpeedStep)
            * cosmeticBonuses.enemySpeedMultiplier;
        const bossShield = spawnBoss ? topdownQuantizeHp(topdownBossShieldValue(session)) : 0;
        const eliteType = spawnBoss ? "boss" : (isElite ? topdownCanonicalEliteType(TOPDOWN_BALANCE.eliteTypes[Math.floor(Math.random() * TOPDOWN_BALANCE.eliteTypes.length)]) : "");
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
            corpseActive: false,
            corpseUntil: 0,
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
            wardenFieldActive: eliteType === "warden",
            wardenFieldTimer: eliteType === "warden" ? TOPDOWN_BALANCE.wardenFieldOnDuration : 0,
            hasSplit: false,
            remnantActive: false,
            explodeDelay: 0,
            suicideTargetX: 0,
            suicideTargetY: 0,
            specialAttackCooldown: randomBetween(TOPDOWN_BALANCE.enemySpecialCooldownMin, TOPDOWN_BALANCE.enemySpecialCooldownMax),
            repulseCooldown: TOPDOWN_BALANCE.repulsorCooldown,
            hookCooldown: TOPDOWN_BALANCE.blackhandHookCooldown,
            touchCooldown: 0,
            consumeCooldown: 0,
            luseTriggered: false,
            luseBurstShotsLeft: 0,
            luseBurstCooldown: 0,
            succubusVictimIds: [],
            enrageUntil: 0
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
            enemy.speed *= 1.06;
            enemy.hp *= 1.04;
            enemy.maxHp = enemy.hp;
        } else if (eliteType === "warden") {
            enemy.speed *= 0.78;
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
        } else if (eliteType === "luse") {
            enemy.speed *= 0.84;
            enemy.hp *= 1.08;
            enemy.maxHp = enemy.hp;
        } else if (eliteType === "succubus") {
            enemy.speed *= 0.9;
            enemy.hp *= 1.24;
            enemy.maxHp = enemy.hp;
        }
        enemy.hp = topdownQuantizeHp(enemy.hp);
        enemy.maxHp = topdownQuantizeHp(enemy.maxHp || enemy.hp);
        enemy.bossShield = topdownQuantizeHp(enemy.bossShield);
        enemy.bossShieldMax = topdownQuantizeHp(enemy.bossShieldMax || enemy.bossShield);
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
        const pickup = {
            id: session.nextId,
            x: x,
            y: y,
            radius: TOPDOWN_BALANCE.pickupRadius,
            ttl: TOPDOWN_BALANCE.pickupLifetime,
            kind: kind || "upgrade",
            itemKey: itemKey || "upgrade"
        };
        session.pickups.push(pickup);
        session.nextId += 1;
        if (session.status === "playing") {
            const item = topdownItemCatalog()[pickup.itemKey];
            const label = pickup.kind === "upgrade" ? "升级球" : ((item && item.label) || topdownPickupVisual(pickup).label);
            setStatus("掉落生成：" + label + "。", false);
        }
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

    function spawnTopdownAoeBurst(session, x, y, radius, element, ultimate) {
        session.aoeBursts.push({
            id: session.nextId,
            type: "burst",
            x: x,
            y: y,
            radius: radius,
            life: TOPDOWN_BALANCE.nuclearBurstLife,
            element: element || "nuclear",
            ultimate: Boolean(ultimate)
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
            damage: damage,
            element: "nuclear",
            ultimate: true
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
        const resolvedElement = String(element || "none");
        const resolvedElementLevel = topdownResolveBulletElementLevel(session, owner, resolvedElement, elementLevel);
        const resolvedDamage = topdownQuantizeDamage(damage);
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
            damage: resolvedDamage,
            owner: owner,
            element: resolvedElement,
            elementLevel: resolvedElementLevel,
            canUltimate: bulletExtra.canUltimate !== false,
            ultimate: bulletExtra.canUltimate !== false && resolvedElementLevel >= TOPDOWN_BALANCE.elementCap,
            ignoreWardenField: Boolean(bulletExtra.ignoreWardenField || bulletExtra.ignoreRepulsorField),
            aoeStacks: Number(bulletExtra.aoeStacks || 0),
            aoeRadius: Number(bulletExtra.aoeRadius || 0),
            visualPhase: Math.random() * Math.PI * 2
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
        const count = Math.min(session.build.wingmanLevel, topdownMaxWingmanSlots(session));
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
        const eliteType = topdownCanonicalEliteType(enemy.eliteType);
        if (eliteType === "dash") {
            return "突进";
        }
        if (eliteType === "sniper") {
            return "冷锋";
        }
        if (eliteType === "summoner") {
            return "杀马特团长";
        }
        if (eliteType === "self-destruct") {
            return "自爆";
        }
        if (eliteType === "buffer") {
            return "强化";
        }
        if (eliteType === "splitter") {
            return "分裂";
        }
        if (eliteType === "repulsor") {
            return "斥力";
        }
        if (eliteType === "warden") {
            return "典狱";
        }
        if (eliteType === "blackhand") {
            return "黑手";
        }
        if (eliteType === "nightmare") {
            return "噩梦";
        }
        if (eliteType === "liangzi") {
            return "良子";
        }
        if (eliteType === "luse") {
            return "撸瑟";
        }
        if (eliteType === "succubus") {
            return "魅魔";
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

    function topdownPointInsideWardenField(session, x, y) {
        return (session.enemies || []).some(function (enemy) {
            return enemy
                && enemy.hp > 0
                && enemy.isElite
                && topdownCanonicalEliteType(enemy.eliteType) === "warden"
                && enemy.wardenFieldActive
                && !enemy.remnantActive
                && distanceBetween({ x: x, y: y }, enemy) <= TOPDOWN_BALANCE.wardenFieldRange + Number(enemy.radius || 0);
        });
    }

    function topdownPlayerMoveSpeedFactor(session) {
        let factor = 1;
        if (Number(session.player.frenzyExhaustUntil || 0) > Number(session.tick || 0)) {
            factor *= TOPDOWN_BALANCE.frenzyMoveMultiplier;
        }
        return factor;
    }

    function topdownEnemyWardenSlowFactor(session, enemy) {
        if (!enemy || topdownCanonicalEliteType(enemy.eliteType) === "warden") {
            return 1;
        }
        return topdownPointInsideWardenField(session, enemy.x, enemy.y) ? TOPDOWN_BALANCE.wardenEnemySlowMultiplier : 1;
    }

    function topdownBulletBlockedByWardenField(session, bullet) {
        if (bullet.element === "electric" || bullet.ignoreWardenField || bullet.ignoreRepulsorField) {
            return false;
        }
        for (let index = 0; index < session.enemies.length; index += 1) {
            const enemy = session.enemies[index];
            if (!enemy || enemy.hp <= 0 || enemy.remnantActive || !enemy.isElite || topdownCanonicalEliteType(enemy.eliteType) !== "warden" || !enemy.wardenFieldActive) {
                continue;
            }
            const insideNow = distanceBetween(bullet, enemy) <= TOPDOWN_BALANCE.wardenFieldRange + enemy.radius;
            const insidePrev = distanceBetween({ x: bullet.prevX, y: bullet.prevY }, enemy) <= TOPDOWN_BALANCE.wardenFieldRange + enemy.radius;
            if (insideNow || insidePrev || distanceToSegmentSquared(enemy.x, enemy.y, bullet.prevX, bullet.prevY, bullet.x, bullet.y) <= Math.pow(TOPDOWN_BALANCE.wardenFieldRange + enemy.radius, 2)) {
                return true;
            }
        }
        return false;
    }

    function spawnTopdownSpreadShot(session, origin, angle, count, spreadRadians, bulletFactory) {
        const shots = Math.max(1, Number(count || 1));
        const spread = Math.max(0, Number(spreadRadians || 0));
        for (let shotIndex = 0; shotIndex < shots; shotIndex += 1) {
            const shotAngle = angle + randomBetween(-spread, spread);
            bulletFactory(shotAngle, shotIndex, shots);
        }
    }

    function spawnTopdownLuseBurst(session, enemy, aimAngle, bulletSpeed) {
        const shots = Math.max(1, Math.min(TOPDOWN_BALANCE.luseBarrageCount, Number(enemy && enemy.luseBurstShotsPerTick || TOPDOWN_BALANCE.luseBurstShotsPerTick || 1)));
        spawnTopdownSpreadShot(session, enemy, aimAngle, shots, TOPDOWN_BALANCE.luseSpreadRadians, function (shotAngle) {
            spawnTopdownEnemyBullet(session, enemy.x, enemy.y, shotAngle, bulletSpeed, 5.2, {
                damage: 1,
                kind: "luse-burst",
                color: "#fda4af"
            });
        });
    }

    function spawnTopdownPlayerFrenzyVolley(session, aimAngle) {
        const playerStats = getTopdownDerivedStats(session, false);
        const elementLevel = topdownBuildElementLevel(session.build, false, session.build.element);
        const shots = Math.max(1, Math.min(TOPDOWN_BALANCE.frenzyBulletCount, Number(TOPDOWN_BALANCE.frenzyShotsPerVolley || 1)));
        spawnTopdownSpreadShot(session, session.player, aimAngle, shots, TOPDOWN_BALANCE.frenzySpreadRadians, function (shotAngle) {
            createTopdownBullet(session, session.player, shotAngle, playerStats.damage, "player", session.build.element, elementLevel, {
                canUltimate: true,
                ignoreWardenField: topdownPointInsideWardenField(session, session.player.x, session.player.y)
            });
        });
    }

    function triggerTopdownPlayerFrenzy(session, sourceLabel) {
        session.player.frenzyUntil = Math.max(Number(session.player.frenzyUntil || 0), session.tick + TOPDOWN_BALANCE.frenzyBurstDuration);
        session.player.frenzyNextShotAt = session.tick;
        session.player.frenzyExhaustUntil = 0;
        session.player.frenzyExhaustQueuedUntil = Math.max(Number(session.player.frenzyExhaustQueuedUntil || 0), session.tick + TOPDOWN_BALANCE.frenzyBurstDuration + TOPDOWN_BALANCE.frenzyExhaustDuration);
        setStatus((sourceLabel || "战术失控") + "：进入 3 秒弹幕爆发。", false);
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
            session.player.damageFlash = Math.max(Number(session.player.damageFlash || 0), TOPDOWN_BALANCE.damageFlashDuration);
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
            if (!enemy || enemy.hp <= 0 || enemy.remnantActive || enemy.corpseActive) {
                return;
            }
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
        if (!stats || !stats.continuousBeamOnly) {
            session.beams.push({
                fromX: origin.x,
                fromY: origin.y,
                toX: beamEndX,
                toY: beamEndY,
                color: owner === "wingman" ? "#fde68a" : "#facc15",
                life: TOPDOWN_BALANCE.electricBeamLife,
                width: owner === "wingman" ? 2.2 : 3.2,
                element: "electric",
                elementLevel: stats.elementLevel,
                canUltimate: stats.canUltimate,
                ultimate: stats.canUltimate
            });
        }
        if (!hitEnemy) {
            return;
        }
        const removedEnemyIds = [];
        applyTopdownElement(session, {
            element: "electric",
            elementLevel: stats.elementLevel,
            damage: stats.damage,
            canUltimate: stats.canUltimate,
            owner: owner,
            noBeamVisuals: Boolean(stats && stats.continuousBeamOnly && Number(stats.multishot || 1) > 1)
        }, hitEnemy, removedEnemyIds);
        if (removedEnemyIds.length) {
            session.enemies = session.enemies.filter(function (enemy) {
                return removedEnemyIds.indexOf(enemy.id) === -1 && (enemy.hp > 0 || enemy.corpseActive);
            });
        }
    }

    function spawnTopdownVolley(session, origin, angle, stats, owner) {
        const count = Math.max(1, stats.multishot);
        const offsetBase = -(count - 1) / 2;
        const ignoreWardenField = topdownPointInsideWardenField(session, session.player.x, session.player.y);
        const laneSpacing = Math.max(10, topdownCurrentProjectileRadius(session, owner) * 2.8);
        const normalX = -Math.sin(angle);
        const normalY = Math.cos(angle);
        for (let shot = 0; shot < count; shot += 1) {
            const laneOffset = (offsetBase + shot) * laneSpacing;
            const shotOrigin = {
                x: origin.x + normalX * laneOffset,
                y: origin.y + normalY * laneOffset
            };
            const shotAngle = angle;
            if (stats.element === "electric") {
                resolveTopdownLaserHit(session, shotOrigin, shotAngle, stats, owner);
            } else {
                const emitElementAoe = shouldSpawnElementAoeBullet(session, stats.element, stats.elementLevel, owner);
                createTopdownBullet(
                    session,
                    shotOrigin,
                    shotAngle,
                    stats.damage,
                    owner,
                    stats.element,
                    stats.elementLevel,
                    emitElementAoe ? {
                        canUltimate: stats.canUltimate,
                        ignoreWardenField: ignoreWardenField,
                        aoeStacks: 1,
                        aoeRadius: topdownElementAoeRadius(stats.element, stats.elementLevel)
                    } : { canUltimate: stats.canUltimate, ignoreWardenField: ignoreWardenField }
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
        awardTopdownScore(session, topdownKillBaseScore(session) + topdownComboBonus(session));
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
                        "宙斯权杖：按技能键放出一道会反弹的处决光束，基础持续 5 秒。",
                        "导弹 / 无敌：按 " + topdownSkillTriggerKeyLabel(session.skillTriggerKey) + " 主动施放，基础冷却 45 秒。"
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
        const childHp = topdownQuantizeHp(Math.max(4, enemy.maxHp * TOPDOWN_BALANCE.splitterChildHpFactor));
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
                corpseActive: false,
                corpseUntil: 0,
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
                wardenFieldActive: false,
                wardenFieldTimer: 0,
                hasSplit: true,
                remnantActive: false,
                explodeDelay: 0,
                suicideTargetX: 0,
                suicideTargetY: 0,
                specialAttackCooldown: randomBetween(TOPDOWN_BALANCE.enemySpecialCooldownMin, TOPDOWN_BALANCE.enemySpecialCooldownMax),
                repulseCooldown: 0,
                hookCooldown: 0,
                touchCooldown: 0,
                consumeCooldown: 0,
                luseTriggered: false,
                luseBurstShotsLeft: 0,
                luseBurstCooldown: 0,
                succubusVictimIds: [],
                enrageUntil: 0,
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

    function releaseTopdownSuccubusVictims(session, enemy) {
        const victimIds = Array.isArray(enemy && enemy.succubusVictimIds) ? enemy.succubusVictimIds.slice() : [];
        if (!victimIds.length) {
            return;
        }
        session.enemies.forEach(function (candidate) {
            if (!candidate || victimIds.indexOf(candidate.id) === -1 || candidate.hp <= 0 || candidate.remnantActive) {
                return;
            }
            candidate.enrageUntil = Math.max(Number(candidate.enrageUntil || 0), session.tick + TOPDOWN_BALANCE.succubusEnrageDuration);
        });
        triggerTopdownPlayerFrenzy(session, "魅魔崩解");
        setStatus("魅魔被击败：被吸附单位已狂暴，机体进入 3 秒压制弹幕。", true);
    }

    function topdownResolveBurnTickInterval(enemy) {
        return Number(enemy && enemy.burnStacks || 0) >= TOPDOWN_BALANCE.burnStackMax
            ? TOPDOWN_BALANCE.burnOverheatTickInterval
            : TOPDOWN_BALANCE.burnTickInterval;
    }

    function topdownResolveBurnTickDamage(enemy) {
        const baseDamage = topdownQuantizeDamage(Number(enemy && enemy.burnDamage || 0));
        if (Number(enemy && enemy.burnStacks || 0) < TOPDOWN_BALANCE.burnStackMax) {
            return baseDamage;
        }
        return topdownQuantizeDamage(Math.max(
            baseDamage,
            Number(enemy && enemy.maxHp || 0) * TOPDOWN_BALANCE.burnOverheatMaxHpFactor
        ));
    }

    function topdownApplyBurnState(enemy, elementLevel, stackDelta) {
        if (!enemy) {
            return;
        }
        const nextStacks = Math.min(TOPDOWN_BALANCE.burnStackMax, Number(enemy.burnStacks || 0) + Math.max(1, Math.floor(Number(stackDelta || 1))));
        enemy.burnStacks = nextStacks;
        enemy.burnTime = Math.max(Number(enemy.burnTime || 0), TOPDOWN_BALANCE.burnDuration + Number(elementLevel || 0) * 0.2);
        enemy.burnDamage = Math.max(
            Number(enemy.burnDamage || 0),
            TOPDOWN_BALANCE.burnDamageBase
                + Number(elementLevel || 0) * TOPDOWN_BALANCE.burnDamagePerLevel
                + nextStacks * TOPDOWN_BALANCE.burnDamagePerStack
        );
    }

    function topdownCanBecomeNuclearHusk(enemy, bullet) {
        return Boolean(
            enemy
            && bullet
            && bullet.element === "nuclear"
            && bullet.canUltimate
            && Number(bullet.elementLevel || 0) >= TOPDOWN_BALANCE.elementCap
            && !enemy.isElite
            && !enemy.isBoss
            && !enemy.remnantActive
            && !enemy.corpseActive
        );
    }

    function transformTopdownNuclearHusk(session, enemy) {
        if (!enemy) {
            return;
        }
        enemy.corpseActive = true;
        enemy.corpseUntil = Number(session && session.tick || 0) + TOPDOWN_BALANCE.nuclearHuskDuration;
        enemy.hp = 0;
        enemy.bossShield = 0;
        enemy.bossShieldMax = 0;
        enemy.speed = 0;
        enemy.fireCooldown = 999;
        enemy.specialAttackCooldown = 999;
        enemy.bulletCount = 0;
        enemy.burnTime = 0;
        enemy.burnStacks = 0;
        enemy.burnDamage = 0;
        enemy.burnTick = 0;
        enemy.iceStacks = 0;
        enemy.frozenTime = 0;
        enemy.shocked = false;
        enemy.auraActive = false;
        enemy.wardenFieldActive = false;
        enemy.repulseCooldown = 999;
        enemy.radius = Math.max(10, Number(enemy.radius || 12) * 0.82);
    }

    function topdownNuclearHuskCap(session) {
        const ratio = Math.max(0, Math.min(1, Number(TOPDOWN_BALANCE.nuclearHuskCapRatio || 0)));
        if (ratio <= 0) {
            return 0;
        }
        return Math.max(1, Math.floor(Math.max(1, topdownTargetEnemyCount(session)) * ratio));
    }

    function topdownTryCreateNuclearHusk(session, enemy, bullet) {
        if (!topdownCanBecomeNuclearHusk(enemy, bullet)) {
            return false;
        }
        if (topdownActiveNuclearHuskCount(session) >= topdownNuclearHuskCap(session)) {
            return false;
        }
        if (Math.random() >= TOPDOWN_BALANCE.nuclearHuskChance) {
            return false;
        }
        transformTopdownNuclearHusk(session, enemy);
        return true;
    }

    function topdownActiveNuclearHuskCount(session) {
        if (!session || !Array.isArray(session.enemies)) {
            return 0;
        }
        return session.enemies.reduce(function (count, enemy) {
            return count + (enemy && enemy.corpseActive ? 1 : 0);
        }, 0);
    }

    function topdownResolveNuclearHuskBonusDamage(session, enemy, bullet) {
        if (!enemy || !bullet || bullet.element !== "nuclear" || !bullet.canUltimate || Number(bullet.elementLevel || 0) < TOPDOWN_BALANCE.elementCap) {
            return 0;
        }
        const huskCount = topdownActiveNuclearHuskCount(session);
        if (huskCount <= 0) {
            return 0;
        }
        return topdownQuantizeDamage(Number(enemy.maxHp || 0) * huskCount * 0.01);
    }

    function damageTopdownEnemy(session, enemy, amount) {
        if (!enemy || enemy.remnantActive || enemy.corpseActive || topdownEnemyProtectedByBuffer(session, enemy)) {
            return false;
        }
        let damageLeft = topdownQuantizeDamage(amount);
        if (damageLeft <= TOPDOWN_BALANCE.damageEpsilon) {
            return false;
        }
        if (enemy.isBoss && Number(enemy.bossShield || 0) > 0) {
            const currentShield = topdownQuantizeHp(enemy.bossShield);
            const absorbed = Math.min(currentShield, damageLeft);
            enemy.bossShield = topdownQuantizeHp(currentShield - absorbed);
            damageLeft = topdownQuantizeDamage(damageLeft - absorbed);
            if (damageLeft <= TOPDOWN_BALANCE.damageEpsilon) {
                return false;
            }
        }
        enemy.hp = topdownQuantizeHp(Number(enemy.hp || 0) - damageLeft);
        if (enemy.isElite && enemy.eliteType === "splitter" && !enemy.hasSplit && enemy.hp <= topdownQuantizeHp(enemy.maxHp * 0.5)) {
            enemy.hasSplit = true;
            spawnTopdownSplitterChildren(session, enemy);
            spawnTopdownPickup(session, enemy.x, enemy.y, "upgrade", "upgrade");
            enemy.hp = 0;
            return false;
        }
        if (enemy.hp > TOPDOWN_BALANCE.killEpsilon) {
            return false;
        }
        enemy.hp = 0;
        if (enemy.eliteType === "self-destruct" && !enemy.remnantActive) {
            transformTopdownSelfDestructEnemy(session, enemy);
            return false;
        }
        if (topdownCanonicalEliteType(enemy.eliteType) === "succubus") {
            releaseTopdownSuccubusVictims(session, enemy);
        }
        awardTopdownEnemyKill(session, enemy);
        return true;
    }

    function applyElectricDamageModifier(enemy, amount, isChain) {
        let damage = Number(amount || 0) * (isChain ? TOPDOWN_BALANCE.electricChainDamageFactor : TOPDOWN_BALANCE.electricDirectDamageFactor);
        if (enemy && enemy.shocked) {
            damage *= TOPDOWN_BALANCE.electricShockBonus;
        }
        return topdownQuantizeDamage(damage);
    }

    function applyTopdownElement(session, bullet, enemy, killedIds) {
        if (!enemy || enemy.remnantActive || enemy.corpseActive || topdownEnemyProtectedByBuffer(session, enemy)) {
            return;
        }
        if (bullet.element === "fire" && bullet.elementLevel > 0) {
            const hadMaxBurnStacks = Number(enemy.burnStacks || 0) >= TOPDOWN_BALANCE.burnStackMax;
            const stackDelta = Math.max(1, Math.floor(Number(bullet.elementLevel || 1)));
            topdownApplyBurnState(enemy, bullet.elementLevel, stackDelta);
            if (bullet.aoeStacks > 0 && bullet.aoeRadius > 0) {
                spawnTopdownAoeBurst(session, enemy.x, enemy.y, bullet.aoeRadius, "fire", topdownIsUltimateProjectile(bullet));
                session.enemies.forEach(function (target) {
                    if (target.id === enemy.id || target.remnantActive || target.corpseActive || topdownEnemyProtectedByBuffer(session, target) || distanceBetween(target, enemy) > bullet.aoeRadius + target.radius) {
                        return;
                    }
                    topdownApplyBurnState(target, bullet.elementLevel, stackDelta);
                });
            }
            if (hadMaxBurnStacks) {
                const spreadRadius = Math.max(TOPDOWN_BALANCE.fireMaxSpreadRadius, Number(bullet.aoeRadius || 0));
                spawnTopdownAoeBurst(session, enemy.x, enemy.y, spreadRadius, "fire", topdownIsUltimateProjectile(bullet));
                session.enemies.forEach(function (target) {
                    if (target.id === enemy.id || target.remnantActive || target.corpseActive || topdownEnemyProtectedByBuffer(session, target) || distanceBetween(target, enemy) > spreadRadius + target.radius) {
                        return;
                    }
                    target.burnStacks = 0;
                    target.burnTime = 0;
                    target.burnDamage = 0;
                    target.burnTick = 0;
                    topdownApplyBurnState(target, bullet.elementLevel, TOPDOWN_BALANCE.burnStackMax);
                });
            }
            if (bullet.owner === "player" && Number(enemy.hp || 0) > TOPDOWN_BALANCE.killEpsilon && Number(enemy.burnStacks || 0) >= TOPDOWN_BALANCE.burnStackMax) {
                if (damageTopdownEnemy(session, enemy, Number(enemy.maxHp || 0) * 0.05)) {
                    killedIds.push(enemy.id);
                }
            }
        }
        if (bullet.element === "ice" && bullet.elementLevel > 0) {
            const wasFullyFrozen = Number(enemy.frozenTime || 0) > 0;
            enemy.iceStacks = Number(enemy.iceStacks || 0) + 1;
            if (bullet.aoeStacks > 0 && bullet.aoeRadius > 0) {
                spawnTopdownAoeBurst(session, enemy.x, enemy.y, bullet.aoeRadius, "ice", topdownIsUltimateProjectile(bullet));
                session.enemies.forEach(function (target) {
                    if (target.id === enemy.id || target.remnantActive || target.corpseActive || topdownEnemyProtectedByBuffer(session, target) || distanceBetween(target, enemy) > bullet.aoeRadius + target.radius) {
                        return;
                    }
                    target.iceStacks = Number(target.iceStacks || 0) + 1;
                    if (target.iceStacks >= TOPDOWN_BALANCE.iceFreezeStacks) {
                        target.frozenTime = Math.max(Number(target.frozenTime || 0), TOPDOWN_BALANCE.iceFreezeDuration + bullet.elementLevel * 0.08);
                        target.iceStacks = 0;
                    }
                });
            }
            if (enemy.iceStacks >= TOPDOWN_BALANCE.iceFreezeStacks) {
                enemy.frozenTime = Math.max(enemy.frozenTime, TOPDOWN_BALANCE.iceFreezeDuration + bullet.elementLevel * 0.08);
                enemy.iceStacks = 0;
            }
            if (wasFullyFrozen && topdownIsUltimateProjectile(bullet) && bullet.elementLevel >= TOPDOWN_BALANCE.elementCap && Math.random() < TOPDOWN_BALANCE.iceShatterChance) {
                damageTopdownEnemy(session, enemy, enemy.hp + enemy.maxHp);
                killedIds.push(enemy.id);
            }
        }
        if (bullet.element === "electric" && bullet.elementLevel > 0) {
            const isUltimateElectric = bullet.canUltimate && bullet.elementLevel >= TOPDOWN_BALANCE.elementCap;
            const chains = Math.max(TOPDOWN_BALANCE.electricBaseChains, bullet.elementLevel);
            const chainedTargets = session.enemies
                .filter(function (target) {
                    return target.id !== enemy.id
                        && !target.remnantActive
                        && !target.corpseActive
                        && !topdownEnemyProtectedByBuffer(session, target)
                        && killedIds.indexOf(target.id) === -1;
                })
                .sort(function (a, b) { return distanceBetween(a, enemy) - distanceBetween(b, enemy); })
                .slice(0, chains);
            const anchor = { id: enemy.id, x: enemy.x, y: enemy.y };
            const hpBonusDamage = isUltimateElectric && chainedTargets.length === 0
                ? topdownQuantizeDamage(Number(enemy.hp || 0) / 7)
                : 0;
            const directDamage = topdownQuantizeDamage(applyElectricDamageModifier(enemy, bullet.damage, false) + hpBonusDamage);
            if (damageTopdownEnemy(session, enemy, directDamage)) {
                killedIds.push(enemy.id);
            } else if (enemy.hp > 0 && bullet.canUltimate && Math.random() < TOPDOWN_BALANCE.electricUltimateDirectShockChance) {
                enemy.shocked = true;
            }
            const chainVisualLimit = bullet.noBeamVisuals ? Math.max(1, Math.floor(Number(TOPDOWN_BALANCE.electricChainVisualCap || 3))) : chainedTargets.length;
            chainedTargets.forEach(function (target, chainIndex) {
                if (!bullet.noBeamVisuals || chainIndex < chainVisualLimit) {
                    session.beams.push({
                        fromX: enemy.x,
                        fromY: enemy.y,
                        toX: target.x,
                        toY: target.y,
                        color: bullet.noBeamVisuals ? "rgba(250, 204, 21, 0.62)" : "#facc15",
                        life: TOPDOWN_BALANCE.electricBeamLife,
                        width: bullet.noBeamVisuals ? Math.max(1.2, 1.2 + bullet.elementLevel * 0.18) : (2 + bullet.elementLevel * 0.35),
                        element: "electric",
                        elementLevel: bullet.elementLevel,
                        canUltimate: bullet.canUltimate,
                        ultimate: topdownIsUltimateProjectile(bullet)
                    });
                }
                const chainDamage = topdownQuantizeDamage(applyElectricDamageModifier(target, bullet.damage, true));
                if (damageTopdownEnemy(session, target, chainDamage)) {
                    killedIds.push(target.id);
                } else if (bullet.canUltimate && Math.random() < TOPDOWN_BALANCE.electricUltimateChainShockChance) {
                    target.shocked = true;
                }
            });
            if (TOPDOWN_BALANCE.electricMagnetDuration > 0 && TOPDOWN_BALANCE.electricMagnetStrength > 0) {
                const duration = Number(TOPDOWN_BALANCE.electricMagnetDuration || 0);
                [enemy].concat(chainedTargets).forEach(function (target) {
                    if (!target || target.hp <= 0) {
                        return;
                    }
                    target.magnetPullLeft = Math.max(Number(target.magnetPullLeft || 0), duration);
                    target.magnetPullEnemyId = anchor.id;
                    target.magnetPullX = anchor.x;
                    target.magnetPullY = anchor.y;
                });
            }
        }
        if (bullet.element === "nuclear" && bullet.elementLevel > 0) {
            const radius = TOPDOWN_BALANCE.nuclearBaseRadius + bullet.elementLevel * TOPDOWN_BALANCE.nuclearRadiusPerLevel;
            spawnTopdownAoeBurst(session, enemy.x, enemy.y, radius, "nuclear", topdownIsUltimateProjectile(bullet));
            if (bullet.canUltimate && Math.random() < TOPDOWN_BALANCE.nuclearRadiationChance) {
                spawnTopdownRadiationZone(session, enemy.x, enemy.y, radius, bullet.damage * TOPDOWN_BALANCE.nuclearDamageFactor, getTopdownDerivedStats(session, false).fireInterval);
            }
            session.enemies.forEach(function (target) {
                if (target.id !== enemy.id && !target.remnantActive && !target.corpseActive && !topdownEnemyProtectedByBuffer(session, target) && distanceBetween(target, enemy) <= radius + target.radius) {
                    const nuclearDamage = bullet.damage * TOPDOWN_BALANCE.nuclearDamageFactor + topdownResolveNuclearHuskBonusDamage(session, target, bullet);
                    if (damageTopdownEnemy(session, target, nuclearDamage)) {
                        if (!topdownTryCreateNuclearHusk(session, target, bullet)) {
                            killedIds.push(target.id);
                        }
                    }
                }
            });
        }
    }

    function createTopdownShooterSession(options) {
        const config = Object.assign({
            moveControl: "keyboard",
            fireControl: "manual",
            skillTriggerKey: "KeyQ"
        }, options || {});
        const build = normalizeTopdownBuild();
        const cosmeticBonuses = normalizeTopdownRunCosmeticBonuses(config.cosmeticBonuses || topdownBuildRunCosmeticBonuses(getTopdownSharedMetaState()));
        const session = {
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
                dashVy: 0,
                moveDirX: 0,
                moveDirY: 0,
                frenzyUntil: 0,
                frenzyNextShotAt: 0,
                frenzyExhaustUntil: 0,
                frenzyExhaustQueuedUntil: 0
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
            timeBonusAwarded: false,
            timeBonusScore: 0,
            achievementRecorded: false,
            pendingUpgrade: null,
            pendingPickupChoice: null,
            pendingReviveChoice: null,
            rerollsRemaining: TOPDOWN_BALANCE.totalRerolls,
            nextEliteAt: TOPDOWN_BALANCE.eliteEveryKills,
            elitesSinceBoss: 0,
            nextBossEliteGoal: 5,
            bossesDefeated: 0,
            metaRewardGranted: false,
            reviveUsed: false,
            cosmeticBonuses: cosmeticBonuses,
            startUpgradeChoicesRemaining: Math.max(0, Math.floor(Number(cosmeticBonuses.startUpgradeChoices || 0))),
            moveControl: config.moveControl === "mouse" ? "mouse" : "keyboard",
            fireControl: config.fireControl === "auto" ? "auto" : "manual",
            skillTriggerKey: topdownSkillTriggerKeyOptions().indexOf(config.skillTriggerKey) >= 0 ? config.skillTriggerKey : "KeyQ",
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
                "magnetic-trap": 0,
                "pickup-magnet": 0
            },
            itemBuffs: {
                scoreDoubleUntil: 0,
                rapidFireUntil: 0,
                moveSpeedUntil: 0,
                enemySilenceUntil: 0
            }
        };
        topdownPrimeStartingUpgradeChoices(session);
        return session;
    }

    function normalizeTopdownShooterSession(raw) {
        if (!raw || !raw.sessionKey) {
            return createTopdownShooterSession();
        }
        const build = normalizeTopdownBuild(raw.build);
        const comboItemEvery = topdownCurrentComboItemEvery({ build: build });
        const normalizedStatus = raw.status === "over" ? "over" : (raw.status === "paused" ? "paused" : "playing");
        const normalizedElapsed = Number(raw.elapsedSeconds || 0);
        const normalizedPausedElapsed = normalizedStatus === "playing"
            ? normalizedElapsed
            : Number(raw.pausedElapsed == null ? normalizedElapsed : raw.pausedElapsed);
        const session = {
            sessionKey: String(raw.sessionKey || ("tds-" + Date.now())),
            startedAt: normalizedStatus === "playing" ? Date.now() : Number(raw.startedAt || Date.now()),
            pausedElapsed: normalizedPausedElapsed,
            elapsedSeconds: normalizedElapsed,
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
                dashVy: 0,
                moveDirX: 0,
                moveDirY: 0,
                frenzyUntil: 0,
                frenzyNextShotAt: 0,
                frenzyExhaustUntil: 0,
                frenzyExhaustQueuedUntil: 0
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
            status: normalizedStatus,
            submittedScore: Boolean(raw.submittedScore),
            timeBonusAwarded: Boolean(raw.timeBonusAwarded),
            timeBonusScore: Math.max(0, Number(raw.timeBonusScore || 0)),
            achievementRecorded: Boolean(raw.achievementRecorded),
            pendingUpgrade: raw.pendingUpgrade && Array.isArray(raw.pendingUpgrade.choices) ? raw.pendingUpgrade : null,
            pendingPickupChoice: raw.pendingPickupChoice && Array.isArray(raw.pendingPickupChoice.choices) ? raw.pendingPickupChoice : null,
            pendingReviveChoice: raw.pendingReviveChoice && typeof raw.pendingReviveChoice === "object" ? Object.assign({}, raw.pendingReviveChoice) : null,
            rerollsRemaining: Math.max(0, Number(raw.rerollsRemaining == null ? TOPDOWN_BALANCE.totalRerolls : raw.rerollsRemaining)),
            nextEliteAt: Math.max(TOPDOWN_BALANCE.eliteEveryKills, Number(raw.nextEliteAt || TOPDOWN_BALANCE.eliteEveryKills)),
            elitesSinceBoss: Math.max(0, Number(raw.elitesSinceBoss || 0)),
            nextBossEliteGoal: Math.max(1, Number(raw.nextBossEliteGoal || Math.max(1, 5 - Number(raw.bossesDefeated || 0)))),
            bossesDefeated: Math.max(0, Number(raw.bossesDefeated || 0)),
            metaRewardGranted: Boolean(raw.metaRewardGranted),
            reviveUsed: Boolean(raw.reviveUsed),
            cosmeticBonuses: normalizeTopdownRunCosmeticBonuses(raw.cosmeticBonuses),
            startUpgradeChoicesRemaining: Math.max(0, Math.floor(Number(raw.startUpgradeChoicesRemaining || 0))),
            moveControl: raw.moveControl === "mouse" ? "mouse" : (raw.controlMode === "mouse-auto" ? "mouse" : "keyboard"),
            fireControl: raw.fireControl === "auto" ? "auto" : (raw.controlMode === "mouse-auto" ? "auto" : "manual"),
            skillTriggerKey: topdownSkillTriggerKeyOptions().indexOf(raw.skillTriggerKey) >= 0 ? raw.skillTriggerKey : "KeyQ",
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
                "magnetic-trap": 0,
                "pickup-magnet": 0
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
        if (session.pendingReviveChoice && session.status === "playing") {
            session.status = "paused";
            session.pausedElapsed = session.elapsedSeconds;
        }
        session.bullets = session.bullets.map(function (bullet) {
            return topdownNormalizeBulletState(session, bullet);
        });
        session.enemies.forEach(function (enemy) {
            if (enemy) {
                enemy.eliteType = topdownCanonicalEliteType(enemy.eliteType);
                enemy.hp = topdownQuantizeHp(enemy.hp);
                enemy.maxHp = topdownQuantizeHp(enemy.maxHp || enemy.hp);
                enemy.bossShield = topdownQuantizeHp(enemy.bossShield);
                enemy.bossShieldMax = topdownQuantizeHp(enemy.bossShieldMax || enemy.bossShield);
                enemy.burnDamage = topdownQuantizeDamage(enemy.burnDamage);
                enemy.shocked = enemy.shocked === true;
                enemy.corpseActive = enemy.corpseActive === true;
                enemy.corpseUntil = Math.max(0, Number(enemy.corpseUntil || 0));
                enemy.luseTriggered = enemy.luseTriggered === true;
                enemy.luseBurstShotsLeft = Math.max(0, Math.floor(Number(enemy.luseBurstShotsLeft || 0)));
                enemy.luseBurstCooldown = Math.max(0, Number(enemy.luseBurstCooldown || 0));
                if (enemy.eliteType === "warden") {
                    enemy.wardenFieldActive = enemy.wardenFieldActive !== false;
                    enemy.wardenFieldTimer = Math.max(0, Number(enemy.wardenFieldTimer || TOPDOWN_BALANCE.wardenFieldOnDuration));
                }
                if (enemy.eliteType === "repulsor") {
                    enemy.repulseCooldown = Math.max(0, Number(enemy.repulseCooldown || TOPDOWN_BALANCE.repulsorCooldown));
                }
            }
        });
        syncTopdownShieldCapacity(session);
        session.player.radius = topdownCurrentPlayerRadius(session);
        topdownPrimeStartingUpgradeChoices(session);
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
            { label: "技能键", value: topdownSkillTriggerKeyLabel(session.skillTriggerKey), tone: "buff" },
            { label: "僚机弹种", value: build.wingmanLevel > 0 ? formatTopdownElement(build, true) : "未部署", tone: "wing" },
            { label: "攻击", value: stats.damage.toFixed(1), tone: "attack" },
            { label: "射速", value: (1 / Math.max(0.01, stats.fireInterval)).toFixed(1) + "/s", tone: "rate" },
            { label: "移速", value: stats.moveSpeed.toFixed(0), tone: "move" },
            { label: "机体", value: Math.round(topdownCurrentPlayerRadius(session) / TOPDOWN_BALANCE.playerRadius * 100) + "%", tone: "shield" },
            { label: "护盾", value: session.shield.current + "/" + shieldStats.max, tone: "shield" },
            { label: "冷却", value: session.shield.cooldownLeft > 0 ? session.shield.cooldownLeft.toFixed(1) + "s" : "就绪", tone: "shield-cd" },
            { label: "恢复", value: Math.round(session.shield.rechargeProgress * 100) + "%", tone: "shield-regen" },
            { label: "弹道", value: String(stats.multishot), tone: "multi" },
            { label: "僚机", value: build.wingmanLevel + "/" + topdownMaxWingmanSlots(session), tone: "wing" },
            { label: "弹体", value: "Lv." + build.projectileLevel, tone: "multi" },
            { label: "续连", value: comboResetWindow.toFixed(1) + "s", tone: "combo" },
            { label: "阈值", value: comboItemEvery + " 连", tone: "item" },
            { label: "单杀分", value: String(topdownKillBaseScore(session) + topdownComboBonus(session)), tone: "score" },
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
        if (build.skillCooldownLevel < TOPDOWN_BALANCE.skillUpgradeCap) {
            addUpgrade("skill-cooldown", "技能冷却", "技能冷却速度 +5%，当前冷却 " + topdownSkillCooldownValue(session).toFixed(1) + "s。", function () {
                build.skillCooldownLevel += 1;
            });
        }
        if (build.skillDurationLevel < TOPDOWN_BALANCE.skillUpgradeCap) {
            addUpgrade(
                "skill-duration",
                "技能持续",
                session.skill && session.skill.key === "blink"
                    ? ("权杖持续时间 +5%，当前 " + topdownSkillZeusDuration(session).toFixed(1) + "s。")
                    : ("技能持续时间 +5%，当前倍率 " + topdownSkillEffectMultiplier(session).toFixed(2) + "x。"),
                function () {
                    build.skillDurationLevel += 1;
                }
            );
        }
        if (build.wingmanLevel < topdownMaxWingmanSlots(session)) {
            addUpgrade("wingman", "僚机", "增加一个跟随机。", function () { build.wingmanLevel += 1; session.player.wingmanCooldowns.push(0); });
        }
        if (build.wingmanLevel > 0 && build.wingmanElement !== "fire") {
            addUpgrade("wingman-fire", "僚机改装火系", "将全部僚机改为火弹，共享当前僚机数量对应的弹种等级。", function () {
                build.wingmanElement = "fire";
                session.elementBurstTracker.wingmanFire = 0;
                syncTopdownWingmanLoadout(session);
            }, { category: "reconfig" });
        }
        if (build.wingmanLevel > 0 && build.wingmanElement !== "electric") {
            addUpgrade("wingman-electric", "僚机改装电系", "将全部僚机改为电系激光，仍共享当前僚机数量对应的弹种等级。", function () {
                build.wingmanElement = "electric";
                syncTopdownWingmanLoadout(session);
            }, { category: "reconfig" });
        }
        if (build.wingmanLevel > 0 && build.wingmanElement !== "ice") {
            addUpgrade("wingman-ice", "僚机改装冰系", "将全部僚机改为冰弹，仍共享当前僚机数量对应的弹种等级。", function () {
                build.wingmanElement = "ice";
                session.elementBurstTracker.wingmanIce = 0;
                syncTopdownWingmanLoadout(session);
            }, { category: "reconfig" });
        }
        if (build.wingmanLevel > 0 && build.wingmanElement !== "nuclear") {
            addUpgrade("wingman-nuclear", "僚机改装核系", "将全部僚机改为核弹小爆圈，仍共享当前僚机数量对应的弹种等级。", function () {
                build.wingmanElement = "nuclear";
                syncTopdownWingmanLoadout(session);
            }, { category: "reconfig" });
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

    const topdownMetaUi = {
        modal: null,
        view: "draw",
        showLocked: true,
        sortDescending: false,
        equipGame: "topdown",
        equipCategory: "color",
        flashMessage: "",
        revealTimer: 0,
        paymentBusy: false,
        rollMetrics: {
            itemWidth: 112,
            itemGap: 8,
            sequenceCount: 24,
            durationMs: 3200
        },
        rollState: {
            color: { rolling: false, sequenceKeys: [], winnerKey: "", winnerIndex: 0, frameId: 0, offsetPx: 0 },
            icon: { rolling: false, sequenceKeys: [], winnerKey: "", winnerIndex: 0, frameId: 0, offsetPx: 0 },
            background: { rolling: false, sequenceKeys: [], winnerKey: "", winnerIndex: 0, frameId: 0, offsetPx: 0 }
        }
    };

    function topdownMetaState() {
        return getTopdownSharedMetaState();
    }

    function persistTopdownMetaState() {
        const metaState = topdownMetaState();
        scheduleGameStateSave("topdown-shooter-meta", serializeTopdownMetaState(metaState), summarizeTopdownMetaState(metaState));
        notifyTopdownMetaRefresh();
    }

    function topdownMetaAnyRollActive() {
        return topdownMetaUi.paymentBusy || topdownMetaUi.rollState.color.rolling || topdownMetaUi.rollState.icon.rolling || topdownMetaUi.rollState.background.rolling;
    }

    function topdownMetaAvailablePoints() {
        const profileTotalScore = Math.max(0, Math.floor(parseTopdownMetaNumber((state.profile && state.profile.total_score) || 0)));
        return Math.max(0, Math.floor(profileTotalScore));
    }

    function topdownMetaTodayKey() {
        const now = new Date();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");
        return now.getFullYear() + "-" + month + "-" + day;
    }

    function topdownMetaFreePulls(kind) {
        const metaState = topdownMetaState();
        if (kind === "color") {
            return Math.max(0, Number(metaState.freeColorPulls) || 0);
        }
        if (kind === "background") {
            return Math.max(0, Number(metaState.freeBackgroundPulls) || 0);
        }
        return Math.max(0, Number(metaState.freeIconPulls) || 0);
    }

    function topdownMetaSetFreePulls(kind, value) {
        const metaState = topdownMetaState();
        const nextValue = Math.max(0, Math.floor(Number(value || 0)));
        if (kind === "color") {
            metaState.freeColorPulls = nextValue;
        } else if (kind === "background") {
            metaState.freeBackgroundPulls = nextValue;
        } else {
            metaState.freeIconPulls = nextValue;
        }
    }

    function topdownMetaPityCount(kind) {
        const metaState = topdownMetaState();
        if (kind === "color") {
            return Math.max(0, Number(metaState.colorPity) || 0);
        }
        if (kind === "background") {
            return Math.max(0, Number(metaState.backgroundPity) || 0);
        }
        return Math.max(0, Number(metaState.iconPity) || 0);
    }

    function topdownMetaSetPityCount(kind, value) {
        const metaState = topdownMetaState();
        const nextValue = Math.max(0, Math.floor(Number(value || 0)));
        if (kind === "color") {
            metaState.colorPity = nextValue;
        } else if (kind === "background") {
            metaState.backgroundPity = nextValue;
        } else {
            metaState.iconPity = nextValue;
        }
    }

    function topdownMetaDailyFreeTenAvailable(kind) {
        const metaState = topdownMetaState();
        const daily = metaState.dailyFreeTen || (metaState.dailyFreeTen = { color: "", icon: "", background: "" });
        return String(daily[kind] || "") !== topdownMetaTodayKey();
    }

    function topdownMetaMarkDailyFreeTenUsed(kind) {
        const metaState = topdownMetaState();
        const daily = metaState.dailyFreeTen || (metaState.dailyFreeTen = { color: "", icon: "", background: "" });
        daily[kind] = topdownMetaTodayKey();
    }

    function topdownMetaDrawCost(kind) {
        if (kind === "color") {
            return TOPDOWN_BALANCE.metaColorDrawCost;
        }
        if (kind === "background") {
            return TOPDOWN_BALANCE.metaBackgroundDrawCost;
        }
        return TOPDOWN_BALANCE.metaIconDrawCost;
    }

    function topdownMetaKindLabel(kind) {
        if (kind === "color") {
            return "颜色";
        }
        if (kind === "background") {
            return "背景";
        }
        return "图标";
    }

    function topdownMetaDuplicateRefundRate(tier) {
        if (tier === "superrare") {
            return 0.8;
        }
        if (tier === "rare") {
            return 0.5;
        }
        return 0.2;
    }

    function topdownMetaApplyLoginGiftIfNeeded() {
        const metaState = topdownMetaState();
        const giftVersion = 2;
        if (Number(metaState.loginGiftVersion || 0) >= giftVersion) {
            return;
        }
        metaState.freeColorPulls += TOPDOWN_BALANCE.metaLoginGiftPulls;
        metaState.freeIconPulls += TOPDOWN_BALANCE.metaLoginGiftPulls;
        metaState.loginGiftVersion = giftVersion;
        topdownMetaUi.flashMessage = "赠送机会已重置：颜色抽奖券 +" + TOPDOWN_BALANCE.metaLoginGiftPulls + " 抽，图标抽奖券 +" + TOPDOWN_BALANCE.metaLoginGiftPulls + " 抽。";
        persistTopdownMetaState();
    }

    async function recordTopdownMetaScoreDelta(delta, mode, meta) {
        const amount = Math.trunc(Number(delta || 0));
        if (!amount) {
            return;
        }
        await requestJson(config.scoreUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                game_id: "topdown-meta",
                score: amount,
                mode: mode || "lottery",
                session_key: "topdown-meta-" + Date.now() + "-" + Math.random().toString(36).slice(2),
                meta: meta || {}
            })
        });
        await loadProfile();
        await refreshScorePanels();
    }

    async function prepareTopdownMetaDrawPayment(kind, drawCount, useDailyFreeTen) {
        const metaState = topdownMetaState();
        const count = Math.max(1, Math.floor(Number(drawCount || 1)));
        const unitCost = topdownMetaDrawCost(kind);
        const payment = {
            kind: kind,
            count: count,
            unitCost: unitCost,
            paidCost: 0,
            freePullsUsed: 0,
            dailyFreeTen: false,
            unitCosts: []
        };
        if (useDailyFreeTen && count === TOPDOWN_BALANCE.metaDailyFreeTenCount && topdownMetaDailyFreeTenAvailable(kind)) {
            payment.dailyFreeTen = true;
            payment.unitCosts = new Array(count).fill(0);
            topdownMetaMarkDailyFreeTenUsed(kind);
            persistTopdownMetaState();
            return payment;
        }
        const availableTickets = topdownMetaFreePulls(kind);
        payment.freePullsUsed = Math.min(availableTickets, count);
        for (let index = 0; index < count; index += 1) {
            payment.unitCosts.push(index < payment.freePullsUsed ? 0 : unitCost);
        }
        payment.paidCost = payment.unitCosts.reduce(function (sum, item) {
            return sum + Math.max(0, Number(item || 0));
        }, 0);
        if (topdownMetaAvailablePoints() < payment.paidCost) {
            return null;
        }
        if (payment.paidCost > 0) {
            await recordTopdownMetaScoreDelta(-payment.paidCost, "lottery-spend", {
                pool: kind,
                draw_count: count,
                paid_cost: payment.paidCost,
                free_pulls_used: payment.freePullsUsed
            });
        }
        if (payment.freePullsUsed > 0) {
            topdownMetaSetFreePulls(kind, availableTickets - payment.freePullsUsed);
        }
        metaState.totalSpent += payment.paidCost;
        persistTopdownMetaState();
        return payment;
    }

    function topdownMetaPaymentText(payment) {
        if (!payment) {
            return "";
        }
        if (payment.dailyFreeTen) {
            return "今日免费十连";
        }
        const parts = [];
        if (payment.freePullsUsed > 0) {
            parts.push("赠券 " + payment.freePullsUsed + " 抽");
        }
        if (payment.paidCost > 0) {
            parts.push("扣除总积分 " + payment.paidCost);
        }
        return parts.join("，") || "免费";
    }

    function topdownMetaPreviewStyle(item) {
        if (item && item.pattern) {
            return topdownBackgroundPreviewStyle(item);
        }
        if (item && item.gradient && item.gradient.length) {
            return 'background:linear-gradient(135deg,' + item.gradient.join(",") + ');border-color:' + escapeHtml(item.stroke || "#ffffff") + ';';
        }
        if (item && (item.fill || item.stroke)) {
            return '--skin-fill:' + escapeHtml(item.fill || "#38bdf8") + ';--skin-stroke:' + escapeHtml(item.stroke || "#bae6fd") + ';';
        }
        return "";
    }

    function topdownMetaColorCssVars(color) {
        const safeColor = color || topdownColorCatalog().classic;
        if (safeColor.gradient && safeColor.gradient.length) {
            return '--icon-fill:' + escapeHtml(safeColor.gradient[0] || "#38bdf8") + ';--icon-accent:' + escapeHtml(safeColor.gradient[safeColor.gradient.length - 1] || safeColor.accent || "#67e8f9") + ';--icon-gradient:linear-gradient(135deg,' + safeColor.gradient.join(",") + ');--icon-stroke:' + escapeHtml(safeColor.stroke || "#ffffff") + ';';
        }
        return '--icon-fill:' + escapeHtml(safeColor.fill || "#38bdf8") + ';--icon-accent:' + escapeHtml(safeColor.accent || safeColor.stroke || "#67e8f9") + ';--icon-gradient:linear-gradient(135deg,' + escapeHtml(safeColor.fill || "#38bdf8") + ',' + escapeHtml(safeColor.accent || safeColor.stroke || "#67e8f9") + ');--icon-stroke:' + escapeHtml(safeColor.stroke || "#e2e8f0") + ';';
    }

    function topdownMetaIconPreviewHtml(icon, className, color) {
        const classes = className + (icon && icon.kind === "svg" ? " is-svg-emblem" : "");
        if (icon && icon.kind === "svg" && icon.src) {
            return '<span class="' + classes + '" style="' + topdownMetaColorCssVars(color) + '--icon-url:url(&quot;' + escapeHtml(icon.src) + '&quot;);"></span>';
        }
        return '<span class="' + classes + '">' + escapeHtml(topdownIconPreviewGlyph(icon)) + '</span>';
    }

    function topdownMetaEffectPercent(multiplier, invert) {
        const value = Number(multiplier || 1);
        if (Math.abs(value - 1) < 0.0001) {
            return "";
        }
        const delta = Math.round(Math.abs(1 - value) * 100);
        if (delta <= 0) {
            return "";
        }
        return (invert ? (value < 1 ? "+" : "-") : (value > 1 ? "+" : "-")) + delta + "%";
    }

    function topdownMetaBonusesForPreview(kind, key) {
        const catalog = topdownCatalogForKind(kind);
        const item = catalog[key] || {};
        const bonuses = {
            startUpgradeChoices: 0,
            attackMultiplier: 1,
            damageFlat: 0,
            fireRateMultiplier: 1,
            moveSpeedMultiplier: 1,
            wingmanMaxBonus: 0,
            enemySpeedMultiplier: 1,
            enemyBulletSpeedMultiplier: 1,
            enemyFireCooldownMultiplier: 1,
            colorBonusLabel: "",
            iconBonusLabel: "",
            backgroundBonusLabel: ""
        };
        if (kind === "color" && (item.tier === "rare" || item.tier === "superrare")) {
            topdownMergeCosmeticBonus(bonuses, topdownColorBonusPreset(item));
            bonuses.colorBonusLabel = topdownColorBonusPreset(item).label || "";
            return bonuses;
        }
        if (kind === "icon") {
            if (item.tier === "rare") {
                bonuses.startUpgradeChoices = TOPDOWN_BALANCE.rareIconStartChoices;
            } else if (item.tier === "superrare") {
                bonuses.startUpgradeChoices = TOPDOWN_BALANCE.superRareIconStartChoices;
                topdownMergeCosmeticBonus(bonuses, topdownIconBonusPreset(item));
                bonuses.iconBonusLabel = topdownIconBonusPreset(item).label || "";
            }
            return bonuses;
        }
        if (kind === "background" && (item.tier === "rare" || item.tier === "superrare")) {
            topdownMergeCosmeticBonus(bonuses, topdownBackgroundBonusPreset(item));
            bonuses.backgroundBonusLabel = topdownBackgroundBonusPreset(item).label || "";
        }
        return bonuses;
    }

    function topdownMetaSortLabel() {
        return topdownMetaUi.sortDescending ? "稀有度：高 -> 低" : "稀有度：低 -> 高";
    }

    function topdownMetaEffectLines(kind, key, item) {
        if (topdownMetaUi.equipGame === "frontline") {
            const frontlineBonuses = frontlineMetaBonusesForPreview(kind, key);
            const frontlineLines = [];
            if (kind === "color") {
                if (frontlineBonuses.colorBonusLabel) {
                    frontlineLines.push("前线特性：" + frontlineBonuses.colorBonusLabel);
                }
                if (!frontlineBonuses.summaryLines.length) {
                    frontlineLines.push("改变前线阵营主色，不提供局外加成。");
                }
                return frontlineLines.concat(frontlineBonuses.summaryLines);
            }
            if (kind === "background") {
                if (frontlineBonuses.backgroundBonusLabel) {
                    frontlineLines.push("前线特性：" + frontlineBonuses.backgroundBonusLabel);
                }
                if (!frontlineBonuses.summaryLines.length) {
                    frontlineLines.push("改变前线战场背景，不提供局外加成。");
                }
                return frontlineLines.concat(frontlineBonuses.summaryLines);
            }
            return ["当前装备类型不影响前线局外养成。"];
        }
        const bonuses = topdownMetaBonusesForPreview(kind, key);
        const lines = [];
        if (kind === "color") {
            if (bonuses.colorBonusLabel) {
                lines.push("局内效果：" + bonuses.colorBonusLabel);
            }
            if (Number(bonuses.attackMultiplier || 1) > 1.0001) {
                lines.push("攻击倍率 " + topdownMetaEffectPercent(bonuses.attackMultiplier, false));
            }
            if (Number(bonuses.damageFlat || 0) > 0) {
                lines.push("额外攻击 +" + Number(bonuses.damageFlat).toFixed(1));
            }
            if (Number(bonuses.fireRateMultiplier || 1) < 0.9999) {
                lines.push("射速 " + topdownMetaEffectPercent(bonuses.fireRateMultiplier, true));
            }
            if (Number(bonuses.moveSpeedMultiplier || 1) > 1.0001) {
                lines.push("移速 " + topdownMetaEffectPercent(bonuses.moveSpeedMultiplier, false));
            }
            if (Number(bonuses.wingmanMaxBonus || 0) > 0) {
                lines.push("僚机上限 +" + bonuses.wingmanMaxBonus);
            }
            if (!lines.length) {
                lines.push("改变外观表现，不提供局内数值加成。");
            }
            if (item && item.effect) {
                lines.push("视觉：" + String(item.effect));
            }
            return lines;
        }
        if (kind === "icon") {
            if (bonuses.iconBonusLabel) {
                lines.push("局内效果：" + bonuses.iconBonusLabel);
            }
            if (bonuses.startUpgradeChoices > 0) {
                lines.push("开局强化选择 +" + bonuses.startUpgradeChoices);
            } else {
                lines.push("改变图标外观。");
            }
            if (Number(bonuses.attackMultiplier || 1) > 1.0001) {
                lines.push("攻击倍率 " + topdownMetaEffectPercent(bonuses.attackMultiplier, false));
            }
            if (Number(bonuses.damageFlat || 0) > 0) {
                lines.push("额外攻击 +" + Number(bonuses.damageFlat).toFixed(1));
            }
            if (Number(bonuses.fireRateMultiplier || 1) < 0.9999) {
                lines.push("射速 " + topdownMetaEffectPercent(bonuses.fireRateMultiplier, true));
            }
            if (Number(bonuses.moveSpeedMultiplier || 1) > 1.0001) {
                lines.push("移速 " + topdownMetaEffectPercent(bonuses.moveSpeedMultiplier, false));
            }
            if (Number(bonuses.wingmanMaxBonus || 0) > 0) {
                lines.push("僚机上限 +" + bonuses.wingmanMaxBonus);
            }
            return lines;
        }
        if (bonuses.backgroundBonusLabel) {
            lines.push("局内效果：" + bonuses.backgroundBonusLabel);
        }
        if (Number(bonuses.enemySpeedMultiplier || 1) < 0.9999) {
            lines.push("敌人移速降低 " + topdownMetaEffectPercent(bonuses.enemySpeedMultiplier, true));
        }
        if (Number(bonuses.enemyBulletSpeedMultiplier || 1) < 0.9999) {
            lines.push("敌弹速度降低 " + topdownMetaEffectPercent(bonuses.enemyBulletSpeedMultiplier, true));
        }
        if (Number(bonuses.enemyFireCooldownMultiplier || 1) > 1.0001) {
            lines.push("敌人射速降低 " + topdownMetaEffectPercent(bonuses.enemyFireCooldownMultiplier, false));
        }
        if (!lines.length) {
            lines.push("统一背景外观，可用于 Topdown、五子棋与炸金花。");
        }
        return lines;
    }

    function topdownMetaEffectHtml(kind, key, item) {
        return '<span class="topdown-meta-skin-effect">' + escapeHtml(topdownMetaEffectLines(kind, key, item).join(" / ")) + '</span>';
    }

    function topdownMetaActiveEffectsHtml() {
        const metaState = topdownMetaState();
        const appearance = topdownEquippedAppearance(metaState);
        return [
            '<div class="topdown-meta-effect-grid">',
            '  <div class="topdown-meta-effect-card"><strong>当前颜色效果</strong><span>' + escapeHtml(topdownMetaEffectLines("color", appearance.color.key, appearance.color).join(" / ")) + '</span></div>',
            '  <div class="topdown-meta-effect-card"><strong>当前图标效果</strong><span>' + escapeHtml(topdownMetaEffectLines("icon", appearance.icon.key, appearance.icon).join(" / ")) + '</span></div>',
            '  <div class="topdown-meta-effect-card"><strong>当前背景效果</strong><span>' + escapeHtml(topdownMetaEffectLines("background", appearance.background.key, appearance.background).join(" / ")) + '</span></div>',
            '</div>'
        ].join("");
    }

    function topdownAchievementGroupLabel(groupKey) {
        if (groupKey === "sudoku") {
            return "数独";
        }
        if (groupKey === "game2048") {
            return "2048";
        }
        if (groupKey === "frontline") {
            return "前线";
        }
        if (groupKey === "gomoku") {
            return "五子棋";
        }
        if (groupKey === "gacha") {
            return "抽奖收藏";
        }
        if (groupKey === "collection") {
            return "收藏总览";
        }
        return "俯视射击";
    }

    function topdownAchievementBadgeChipHtml(badge, className) {
        const safeBadge = badge || {};
        const tierKey = topdownAchievementTierTheme(safeBadge.tier).key;
        return [
            '<span class="' + escapeHtml(className || "topdown-achievement-badge-chip") + ' topdown-achievement-badge-chip--' + escapeHtml(tierKey) + '">',
            '  <span class="topdown-achievement-badge-glyph">' + escapeHtml(safeBadge.glyph || "✦") + '</span>',
            '  <span class="topdown-achievement-badge-text">' + escapeHtml(safeBadge.badgeText || "") + '</span>',
            '</span>'
        ].join("");
    }

    function topdownAchievementCardHtml(achievement, selectedId) {
        const tierInfo = topdownAchievementTierTheme(achievement.tier);
        const selected = selectedId === achievement.id;
        return [
            '<div class="topdown-achievement-card is-' + escapeHtml(tierInfo.key) + (achievement.unlocked ? " is-unlocked" : " is-locked") + (selected ? " is-selected" : "") + '">',
            '  <div class="topdown-achievement-card-head">',
            topdownAchievementBadgeChipHtml(achievement, "topdown-achievement-badge-chip"),
            '    <div class="topdown-achievement-head-copy">',
            '      <strong>' + escapeHtml(achievement.name) + '</strong>',
            '      <span>' + escapeHtml(tierInfo.label + " · " + topdownAchievementGroupLabel(achievement.group)) + '</span>',
            '    </div>',
            '  </div>',
            '  <div class="topdown-achievement-card-body">',
            '    <div class="topdown-achievement-desc">' + escapeHtml(achievement.description) + '</div>',
            '    <div class="topdown-achievement-progress">' + escapeHtml(achievement.progressText) + '</div>',
            '  </div>',
            '  <div class="topdown-achievement-card-actions">',
            achievement.unlocked
                ? ('    <button type="button" class="games-btn' + (selected ? " games-btn--primary" : "") + '" data-topdown-achievement-select="' + escapeHtml(achievement.id) + '">' + (selected ? "展示中" : "设为展示") + "</button>")
                : '    <span class="topdown-achievement-locked">未达成</span>',
            '  </div>',
            '</div>'
        ].join("");
    }

    function topdownMetaAchievementViewHtml() {
        const metaState = topdownMetaState();
        const summary = topdownAchievementSummary(metaState);
        const selectedBadge = topdownSelectedAchievementBadge(metaState);
        const selectedId = selectedBadge ? selectedBadge.id : "";
        const achievements = topdownResolveAchievements(metaState);
        const groupOrder = ["topdown", "sudoku", "game2048", "frontline", "gomoku", "gacha", "collection"];
        const groupedHtml = groupOrder.map(function (groupKey) {
            const items = achievements.filter(function (entry) {
                return entry.group === groupKey;
            });
            if (!items.length) {
                return "";
            }
            return [
                '<section class="games-insight-panel topdown-meta-panel topdown-achievement-section">',
                '  <div class="topdown-meta-section-head"><div class="games-section-title">' + escapeHtml(topdownAchievementGroupLabel(groupKey)) + '</div><div class="games-stage-meta">已解锁 ' + escapeHtml(String(items.filter(function (entry) { return entry.unlocked; }).length)) + ' / ' + escapeHtml(String(items.length)) + '</div></div>',
                '  <div class="topdown-achievement-grid">' + items.map(function (entry) { return topdownAchievementCardHtml(entry, selectedId); }).join("") + '</div>',
                '</section>'
            ].join("");
        }).join("");
        return [
            '<div class="topdown-meta-shell">',
            '  <div class="topdown-meta-layout">',
            '    <div class="topdown-meta-overview-section">',
            '      <div class="games-insight-panel topdown-meta-overview">',
            '        <div class="topdown-meta-overview-main">',
            '          <div>',
            '            <div class="games-section-title">成就陈列</div>',
            '            <div class="games-stage-meta">已设计 ' + escapeHtml(String(summary.total)) + ' 个长期目标，解锁后可以任选一个徽章展示在排行榜昵称后。</div>',
            '          </div>',
            '          <div class="topdown-achievement-showcase">',
            selectedBadge
                ? (topdownAchievementBadgeChipHtml(selectedBadge, "topdown-achievement-badge-chip topdown-achievement-badge-chip--large")
                    + '<div class="topdown-achievement-showcase-copy"><strong>' + escapeHtml(selectedBadge.name) + '</strong><span>当前展示徽章</span></div>')
                : '<div class="topdown-achievement-showcase-copy is-empty"><strong>当前未展示徽章</strong><span>解锁后可在这里设为展示</span></div>',
            '          </div>',
            '        </div>',
            '        <div class="topdown-meta-stat-grid">',
            '          <div class="topdown-meta-stat"><span>已解锁成就</span><strong>' + escapeHtml(String(summary.unlocked)) + ' / ' + escapeHtml(String(summary.total)) + '</strong></div>',
            '          <div class="topdown-meta-stat"><span>铜色徽章</span><strong>' + escapeHtml(String(summary.unlockedByTier.bronze)) + ' / ' + escapeHtml(String(summary.bronze)) + '</strong></div>',
            '          <div class="topdown-meta-stat"><span>银色徽章</span><strong>' + escapeHtml(String(summary.unlockedByTier.silver)) + ' / ' + escapeHtml(String(summary.silver)) + '</strong></div>',
            '          <div class="topdown-meta-stat"><span>金色徽章</span><strong>' + escapeHtml(String(summary.unlockedByTier.gold)) + ' / ' + escapeHtml(String(summary.gold)) + '</strong></div>',
            '          <div class="topdown-meta-stat"><span>钻石徽章</span><strong>' + escapeHtml(String(summary.unlockedByTier.diamond)) + ' / ' + escapeHtml(String(summary.diamond)) + '</strong></div>',
            '          <div class="topdown-meta-stat"><span>神话徽章</span><strong>' + escapeHtml(String(summary.unlockedByTier.mythic)) + ' / ' + escapeHtml(String(summary.mythic)) + '</strong></div>',
            '        </div>',
            '        <div class="topdown-achievement-toolbar">',
            '          <button type="button" class="games-btn" data-topdown-achievement-clear="1"' + (selectedBadge ? "" : " disabled") + '>取消展示</button>',
            '        </div>',
            (topdownMetaUi.flashMessage ? ('        <div class="games-stage-meta topdown-meta-flash">' + escapeHtml(topdownMetaUi.flashMessage) + '</div>') : ''),
            '      </div>',
            '    </div>',
            '    <div class="topdown-meta-equip-section">',
            groupedHtml,
            '    </div>',
            '  </div>',
            '</div>'
        ].join("");
    }

    function topdownMetaColorCardHtml(key, color) {
        const metaState = topdownMetaState();
        const owned = metaState.ownedColors.indexOf(key) !== -1;
        const equipped = metaState.equippedColor === key;
        return [
            '<button type="button" class="topdown-meta-skin ' + topdownMetaTierClass(color.tier) + (owned ? " is-owned" : "") + (equipped ? " is-equipped" : "") + '" data-topdown-equip-color="' + escapeHtml(key) + '"' + (owned ? "" : " disabled") + '>',
            '  <span class="topdown-meta-skin-icon" style="' + topdownMetaPreviewStyle(color) + '"></span>',
            '  <span class="topdown-meta-skin-name">' + escapeHtml(color.label) + '</span>',
            '  <span class="topdown-meta-skin-state">' + escapeHtml(topdownMetaTierLabel(color.tier, "color")) + ' / ' + (equipped ? "已装备" : (owned ? "已拥有" : "未拥有")) + '</span>',
            '  ' + topdownMetaEffectHtml("color", key, color),
            "</button>"
        ].join("");
    }

    function topdownMetaIconCardHtml(key, icon) {
        const metaState = topdownMetaState();
        const owned = metaState.ownedIcons.indexOf(key) !== -1;
        const equipped = metaState.equippedIcon === key;
        const appearance = topdownEquippedAppearance(metaState);
        return [
            '<button type="button" class="topdown-meta-skin ' + topdownMetaTierClass(icon.tier) + (owned ? " is-owned" : "") + (equipped ? " is-equipped" : "") + '" data-topdown-equip-icon="' + escapeHtml(key) + '"' + (owned ? "" : " disabled") + '>',
            '  ' + topdownMetaIconPreviewHtml(icon, "topdown-meta-skin-icon", appearance.color),
            '  <span class="topdown-meta-skin-name">' + escapeHtml(icon.label) + '</span>',
            '  <span class="topdown-meta-skin-state">' + escapeHtml(topdownMetaTierLabel(icon.tier, "icon")) + ' / ' + (equipped ? "已装备" : (owned ? "已拥有" : "未拥有")) + '</span>',
            '  ' + topdownMetaEffectHtml("icon", key, icon),
            "</button>"
        ].join("");
    }

    function topdownMetaBackgroundCardHtml(key, background) {
        const metaState = topdownMetaState();
        const owned = metaState.ownedBackgrounds.indexOf(key) !== -1;
        const equipped = metaState.equippedBackground === key;
        return [
            '<button type="button" class="topdown-meta-skin topdown-meta-skin--background ' + topdownMetaTierClass(background.tier) + (owned ? " is-owned" : "") + (equipped ? " is-equipped" : "") + '" data-topdown-equip-background="' + escapeHtml(key) + '"' + (owned ? "" : " disabled") + '>',
            '  <span class="topdown-meta-skin-icon topdown-meta-background-preview" style="' + topdownBackgroundPreviewStyle(background) + '"></span>',
            '  <span class="topdown-meta-skin-name">' + escapeHtml(background.label) + '</span>',
            '  <span class="topdown-meta-skin-state">' + escapeHtml(topdownMetaTierLabel(background.tier, "background")) + ' / ' + (equipped ? "已装备" : (owned ? "已拥有" : "未拥有")) + '</span>',
            '  ' + topdownMetaEffectHtml("background", key, background),
            "</button>"
        ].join("");
    }

    function topdownMetaRollItemHtml(kind, key) {
        const catalog = topdownCatalogForKind(kind);
        const item = catalog[key];
        if (!item) {
            return "";
        }
        const appearance = topdownEquippedAppearance(topdownMetaState());
        return [
            '<div class="topdown-meta-roll-item ' + topdownMetaTierClass(item.tier) + '" data-roll-key="' + escapeHtml(key) + '">',
            kind === "icon"
                ? ('  ' + topdownMetaIconPreviewHtml(item, "topdown-meta-roll-icon", appearance.color))
                : ('  <span class="topdown-meta-roll-icon' + (kind === "background" ? " topdown-meta-background-preview" : "") + '" style="' + topdownMetaPreviewStyle(item) + '"></span>'),
            '  <span class="topdown-meta-roll-name">' + escapeHtml(item.label) + '</span>',
            '  <span class="topdown-meta-roll-tier">' + escapeHtml(topdownMetaTierLabel(item.tier, kind)) + '</span>',
            '</div>'
        ].join("");
    }

    function topdownMetaRevealCardHtml(kind, result) {
        const catalog = topdownCatalogForKind(kind);
        const item = catalog[result && result.key];
        if (!item) {
            return "";
        }
        const appearance = topdownEquippedAppearance(topdownMetaState());
        const stateText = result.duplicate ? ("重复 +" + String(result.refund || 0)) : "新获得";
        return [
            '<div class="topdown-meta-reveal-card ' + topdownMetaTierClass(item.tier) + (result.duplicate ? " is-duplicate" : " is-new") + '">',
            kind === "icon"
                ? ('  ' + topdownMetaIconPreviewHtml(item, "topdown-meta-reveal-icon", appearance.color))
                : ('  <span class="topdown-meta-reveal-icon' + (kind === "background" ? " topdown-meta-background-preview" : "") + '" style="' + topdownMetaPreviewStyle(item) + '"></span>'),
            '  <span class="topdown-meta-reveal-name">' + escapeHtml(item.label) + '</span>',
            '  <span class="topdown-meta-reveal-tier">' + escapeHtml(topdownMetaTierLabel(item.tier, kind)) + ' / ' + escapeHtml(stateText) + '</span>',
            '</div>'
        ].join("");
    }

    function showTopdownRewardReveal(kind, results) {
        const modal = ensureTopdownMetaModal();
        const dialog = modal ? modal.querySelector(".topdown-meta-dialog") : null;
        const list = (Array.isArray(results) ? results : []).filter(Boolean);
        if (!dialog || !list.length) {
            return;
        }
        const oldReveal = dialog.querySelector(".topdown-meta-reveal");
        if (oldReveal) {
            oldReveal.remove();
        }
        if (topdownMetaUi.revealTimer) {
            window.clearTimeout(topdownMetaUi.revealTimer);
            topdownMetaUi.revealTimer = 0;
        }
        const durationMs = list.length > 1 ? 10000 : 5000;
        const reveal = document.createElement("div");
        reveal.className = "topdown-meta-reveal" + (list.length > 1 ? " topdown-meta-reveal--batch" : "");
        reveal.style.setProperty("--reveal-duration", durationMs + "ms");
        reveal.innerHTML = [
            '<div class="topdown-meta-reveal-burst"></div>',
            '<div class="topdown-meta-reveal-title">' + (list.length > 1 ? "十连获得" : "获得奖励") + '</div>',
            '<div class="topdown-meta-reveal-grid">',
            list.map(function (result) { return topdownMetaRevealCardHtml(kind, result); }).join(""),
            '</div>'
        ].join("");
        function closeReveal() {
            const event = arguments[0];
            if (event && typeof event.stopPropagation === "function") {
                event.preventDefault();
                event.stopPropagation();
                if (typeof event.stopImmediatePropagation === "function") {
                    event.stopImmediatePropagation();
                }
            }
            if (topdownMetaUi.revealTimer) {
                window.clearTimeout(topdownMetaUi.revealTimer);
                topdownMetaUi.revealTimer = 0;
            }
            reveal.remove();
            document.removeEventListener("pointerdown", closeReveal, true);
        }
        dialog.appendChild(reveal);
        window.setTimeout(function () {
            document.addEventListener("pointerdown", closeReveal, true);
        }, 0);
        topdownMetaUi.revealTimer = window.setTimeout(closeReveal, durationMs);
    }

    function topdownMetaStaticRollKeys(kind) {
        const sequence = [];
        for (let index = 0; index < 14; index += 1) {
            sequence.push(topdownDisplayRollKey(kind));
        }
        return sequence.concat(sequence);
    }

    function topdownMetaEnsureIdleSequence(kind) {
        const rollState = topdownMetaUi.rollState[kind];
        if (rollState.rolling) {
            return;
        }
        rollState.sequenceKeys = topdownMetaStaticRollKeys(kind);
        rollState.offsetPx = 0;
    }

    function topdownMetaRollRowHtml(kind) {
        const cost = topdownMetaDrawCost(kind);
        const label = topdownMetaKindLabel(kind);
        const dailyFree = topdownMetaDailyFreeTenAvailable(kind);
        const freePulls = topdownMetaFreePulls(kind);
        const pity = topdownMetaPityCount(kind);
        const rowState = topdownMetaUi.rollState[kind];
        const trackItems = (rowState.sequenceKeys && rowState.sequenceKeys.length ? rowState.sequenceKeys : topdownMetaStaticRollKeys(kind))
            .map(function (key) { return topdownMetaRollItemHtml(kind, key); })
            .join("");
        return [
            '<div class="topdown-meta-roll-row" data-topdown-roll-row="' + kind + '">',
            '  <div class="topdown-meta-roll-head">',
            '    <div>',
            '      <div class="games-section-title">' + label + '奖池</div>',
            '      <div class="games-stage-meta">单次消耗 ' + escapeHtml(String(cost)) + ' 总积分；赠券剩余 ' + escapeHtml(String(freePulls)) + ' 抽；保底 ' + escapeHtml(String(Math.min(9, pity))) + '/9；' + (dailyFree ? "今日免费十连可用" : "今日免费十连已使用") + '。</div>',
            '    </div>',
            '    <div class="topdown-meta-roll-actions">',
            '      <button type="button" class="games-btn' + (kind === "color" ? " games-btn--primary" : "") + '" data-topdown-draw-' + kind + '="1"' + (rowState.rolling || topdownMetaUi.paymentBusy ? " disabled" : "") + '>抽' + label + '</button>',
            '      <button type="button" class="games-btn" data-topdown-draw-' + kind + '-ten="1"' + (rowState.rolling || topdownMetaUi.paymentBusy ? " disabled" : "") + '>' + (dailyFree ? "今日免费十连" : "十连抽" + label) + '</button>',
            '    </div>',
            '  </div>',
            '  <div class="topdown-meta-roll-viewport" data-topdown-roll-viewport="' + kind + '">',
            '    <div class="topdown-meta-roll-marker"></div>',
            '    <div class="topdown-meta-roll-track' + (rowState.rolling ? " is-rolling" : " is-auto") + '" data-topdown-roll-track="' + kind + '">' + trackItems + '</div>',
            '  </div>',
            '</div>'
        ].join("");
    }

    function topdownMetaDrawViewHtml() {
        const metaState = topdownMetaState();
        const appearance = topdownEquippedAppearance(metaState);
        const rareUnlocked = topdownAllCommonColorsOwned(metaState);
        const superRareUnlocked = topdownAllRareColorsOwned(metaState);
        const colorCatalog = topdownColorCatalog();
        const iconCatalog = topdownIconCatalog();
        const backgroundCatalog = topdownBackgroundCatalog();
        return [
            '<div class="topdown-meta-shell">',
            '  <div class="topdown-meta-layout">',
            '    <div class="topdown-meta-overview-section">',
            '      <div class="games-insight-panel topdown-meta-overview">',
            '        <div class="topdown-meta-overview-main">',
            '          <div>',
            '            <div class="games-section-title">抽奖总览</div>',
            '            <div class="games-stage-meta">优先消耗免费十连和赠券，付费抽奖会直接扣总积分；重复返还按稀有度最高 80%。</div>',
            '          </div>',
            '          <div class="topdown-meta-active-loadout">',
            '            <span class="topdown-meta-active-color" style="' + topdownMetaPreviewStyle(appearance.color) + '"></span>',
            '            ' + topdownMetaIconPreviewHtml(appearance.icon, "topdown-meta-active-icon", appearance.color),
            '            <div class="topdown-meta-active-text">',
            '              <strong>' + escapeHtml(appearance.color.label) + '</strong>',
            '              <span>' + escapeHtml(appearance.icon.label) + ' / ' + escapeHtml(appearance.background.label) + '</span>',
            '            </div>',
            '          </div>',
            '        </div>',
            '        <div class="topdown-meta-stat-grid">',
            '          <div class="topdown-meta-stat"><span>可用总积分</span><strong>' + escapeHtml(String(topdownMetaAvailablePoints())) + '</strong></div>',
            '          <div class="topdown-meta-stat"><span>已扣总积分</span><strong>' + escapeHtml(String(metaState.totalSpent)) + '</strong></div>',
            '          <div class="topdown-meta-stat"><span>颜色赠券</span><strong>' + escapeHtml(String(topdownMetaFreePulls("color"))) + '</strong></div>',
            '          <div class="topdown-meta-stat"><span>图标赠券</span><strong>' + escapeHtml(String(topdownMetaFreePulls("icon"))) + '</strong></div>',
            '          <div class="topdown-meta-stat"><span>背景赠券</span><strong>' + escapeHtml(String(topdownMetaFreePulls("background"))) + '</strong></div>',
            '          <div class="topdown-meta-stat"><span>颜色保底</span><strong>' + escapeHtml(String(Math.min(9, topdownMetaPityCount("color")))) + ' / 9</strong></div>',
            '          <div class="topdown-meta-stat"><span>图标保底</span><strong>' + escapeHtml(String(Math.min(9, topdownMetaPityCount("icon")))) + ' / 9</strong></div>',
            '          <div class="topdown-meta-stat"><span>背景保底</span><strong>' + escapeHtml(String(Math.min(9, topdownMetaPityCount("background")))) + ' / 9</strong></div>',
            '          <div class="topdown-meta-stat"><span>颜色收藏</span><strong>' + escapeHtml(String(metaState.ownedColors.length)) + ' / ' + escapeHtml(String(Object.keys(colorCatalog).length)) + '</strong></div>',
            '          <div class="topdown-meta-stat"><span>图标收藏</span><strong>' + escapeHtml(String(metaState.ownedIcons.length)) + ' / ' + escapeHtml(String(Object.keys(iconCatalog).length)) + '</strong></div>',
            '          <div class="topdown-meta-stat"><span>背景收藏</span><strong>' + escapeHtml(String(metaState.ownedBackgrounds.length)) + ' / ' + escapeHtml(String(Object.keys(backgroundCatalog).length)) + '</strong></div>',
            '        </div>',
            '        <div class="games-stage-meta topdown-meta-tip">' + (superRareUnlocked ? "稀有色已集齐，颜色池已开放超级稀有小概率掉落。" : (rareUnlocked ? "普通颜色已集齐，颜色池已开放稀有混色；集齐稀有色后开放超级稀有。" : "先收集完全部普通颜色，再开放极低概率的稀有混色。")) + '</div>',
            (topdownMetaUi.flashMessage ? ('        <div class="games-stage-meta topdown-meta-flash">' + escapeHtml(topdownMetaUi.flashMessage) + '</div>') : ''),
            '      </div>',
            '    </div>',
            '    <div class="topdown-meta-roll-section">',
            '      <div class="topdown-meta-roll-grid">',
            topdownMetaRollRowHtml("color"),
            topdownMetaRollRowHtml("icon"),
            topdownMetaRollRowHtml("background"),
            '      </div>',
            '    </div>',
            '  </div>',
            '</div>'
        ].join("");
    }

    function topdownMetaEquipCategoryConfig() {
        const metaState = topdownMetaState();
        const game = topdownMetaEquipGameDefinitions()[topdownMetaUi.equipGame] || topdownMetaEquipGameDefinitions().topdown;
        const hints = {
            color: game.colorHint || "统一颜色外观；支持所有已经接入局外养成的游戏读取。",
            icon: game.iconHint || "统一图标外观；支持角色、棋子或头像型游戏元素复用。",
            background: game.backgroundHint || "统一背景接口；支持棋盘、战场或游戏舞台复用。"
        };
        return {
            color: {
                label: "颜色",
                hint: hints.color,
                owned: metaState.ownedColors.length,
                total: Object.keys(topdownColorCatalog()).length,
                equipped: (topdownColorCatalog()[metaState.equippedColor] || {}).label || "默认"
            },
            icon: {
                label: "图标",
                hint: hints.icon,
                owned: metaState.ownedIcons.length,
                total: Object.keys(topdownIconCatalog()).length,
                equipped: (topdownIconCatalog()[metaState.equippedIcon] || {}).label || "默认"
            },
            background: {
                label: "背景",
                hint: hints.background,
                owned: metaState.ownedBackgrounds.length,
                total: Object.keys(topdownBackgroundCatalog()).length,
                equipped: (topdownBackgroundCatalog()[metaState.equippedBackground] || {}).label || "默认"
            }
        };
    }

    function topdownMetaEquipGameDefinitions() {
        return {
            topdown: {
                label: "Topdown",
                summary: "角色 / 战场 / 子弹视觉",
                categories: ["color", "icon", "background"],
                colorHint: "Topdown 角色颜色，也会影响可染色徽记。",
                iconHint: "Topdown 角色图标，超级稀有徽记会直接吃颜色效果。",
                backgroundHint: "Topdown 战场背景使用统一背景接口。"
            },
            gomoku: {
                label: "五子棋",
                summary: "棋子 / 棋盘",
                categories: ["color", "icon", "background"],
                colorHint: "五子棋棋子颜色双方可见，对局内双方不能使用同一个颜色。",
                iconHint: "五子棋棋子图标双方可见，可复用 Topdown 已抽到的图标。",
                backgroundHint: "五子棋棋盘背景自己可见，使用统一背景接口。"
            },
            zhajinhua: {
                label: "炸金花",
                summary: "扑克 / 牌心徽标 / 牌桌背景",
                categories: ["color", "icon", "background"],
                colorHint: "炸金花会把已装备颜色用于扑克牌主色与玩家气泡底色。",
                iconHint: "炸金花会把已装备图标作为牌心徽标显示在扑克牌中央。",
                backgroundHint: "炸金花会把已装备背景用于房间与牌桌背景展示。"
            },
            sudoku: {
                label: "数独",
                summary: "盘面背景 / 高亮色",
                categories: ["background", "color"],
                colorHint: "数独会优先复用颜色作为盘面高亮和完成特效的主题色。",
                backgroundHint: "数独盘面底纹接入统一背景接口，适合稀有背景展示。"
            },
            "2048": {
                label: "2048",
                summary: "棋盘背景 / 方块主题",
                categories: ["background", "color"],
                colorHint: "2048 可复用颜色作为棋盘边框和高分方块主题。",
                backgroundHint: "2048 外层舞台接入统一背景接口，让收藏背景不只在射击游戏里可见。"
            },
            frontline: {
                label: "前线",
                summary: "战场背景 / 阵营色",
                categories: ["background", "color"],
                colorHint: "前线可复用颜色作为玩家阵营强调色。",
                backgroundHint: "前线地图外层舞台接入统一背景接口。"
            }
        };
    }

    function topdownMetaEquipItemsHtml(category) {
        const metaState = topdownMetaState();
        if (category === "icon") {
            const iconCatalog = topdownIconCatalog();
            const iconKeys = topdownSortCatalogKeysByTier(iconCatalog, topdownMetaUi.sortDescending).filter(function (key) {
                return topdownMetaUi.showLocked || metaState.ownedIcons.indexOf(key) !== -1;
            });
            return '<div class="topdown-meta-skins">' + iconKeys.map(function (key) { return topdownMetaIconCardHtml(key, iconCatalog[key]); }).join("") + '</div>';
        }
        if (category === "background") {
            const backgroundCatalog = topdownBackgroundCatalog();
            const backgroundKeys = topdownSortCatalogKeysByTier(backgroundCatalog, topdownMetaUi.sortDescending).filter(function (key) {
                return topdownMetaUi.showLocked || metaState.ownedBackgrounds.indexOf(key) !== -1;
            });
            return '<div class="topdown-meta-skins topdown-meta-skins--backgrounds">' + backgroundKeys.map(function (key) { return topdownMetaBackgroundCardHtml(key, backgroundCatalog[key]); }).join("") + '</div>';
        }
        const colorCatalog = topdownColorCatalog();
        const colorKeys = topdownSortCatalogKeysByTier(colorCatalog, topdownMetaUi.sortDescending).filter(function (key) {
            return topdownMetaUi.showLocked || metaState.ownedColors.indexOf(key) !== -1;
        });
        return '<div class="topdown-meta-skins">' + colorKeys.map(function (key) { return topdownMetaColorCardHtml(key, colorCatalog[key]); }).join("") + '</div>';
    }

    function topdownMetaEquipViewHtml() {
        const games = topdownMetaEquipGameDefinitions();
        const game = games[topdownMetaUi.equipGame] || games.topdown;
        if (!games[topdownMetaUi.equipGame]) {
            topdownMetaUi.equipGame = "topdown";
        }
        if (game.categories.indexOf(topdownMetaUi.equipCategory) === -1) {
            topdownMetaUi.equipCategory = game.categories[0] || "color";
        }
        const categories = topdownMetaEquipCategoryConfig();
        const category = categories[topdownMetaUi.equipCategory] ? topdownMetaUi.equipCategory : "color";
        const current = categories[category];
        return [
            '<div class="topdown-meta-shell">',
            '  <div class="topdown-meta-equip-layout">',
            '    <aside class="games-insight-panel topdown-meta-equip-sidebar">',
            '      <div class="topdown-meta-list-title">游戏</div>',
            Object.keys(games).map(function (key) {
                const item = games[key];
                return '<button type="button" class="topdown-meta-game-item' + (key === topdownMetaUi.equipGame ? " is-active" : "") + '" data-topdown-equip-game="' + escapeHtml(key) + '"><strong>' + escapeHtml(item.label) + '</strong><span>' + escapeHtml(item.summary) + '</span></button>';
            }).join(""),
            '      <div class="topdown-meta-list-title">装备类型</div>',
            '      <div class="topdown-meta-category-list">',
            game.categories.map(function (key) {
                const item = categories[key];
                return '<button type="button" class="topdown-meta-category-item' + (key === category ? " is-active" : "") + '" data-topdown-equip-category="' + key + '"><strong>' + escapeHtml(item.label) + '</strong><span>' + escapeHtml(String(item.owned)) + ' / ' + escapeHtml(String(item.total)) + '</span></button>';
            }).join(""),
            '      </div>',
            '      <label class="topdown-meta-toggle">',
            '        <input type="checkbox" data-topdown-show-locked="1"' + (topdownMetaUi.showLocked ? " checked" : "") + '>',
            '        <span>显示未拥有</span>',
            '      </label>',
            '      <button type="button" class="topdown-meta-toggle-btn" data-topdown-sort-toggle="1">' + escapeHtml(topdownMetaSortLabel()) + '</button>',
            (topdownMetaUi.flashMessage ? ('      <div class="games-stage-meta topdown-meta-flash">' + escapeHtml(topdownMetaUi.flashMessage) + '</div>') : ''),
            '    </aside>',
            '    <section class="games-insight-panel topdown-meta-equip-content">',
            '      <div class="topdown-meta-section-head">',
            '        <div>',
            '          <div class="games-section-title">' + escapeHtml(current.label) + '装备</div>',
            '          <div class="games-stage-meta">' + escapeHtml(current.hint) + '</div>',
            '        </div>',
            '        <div class="topdown-meta-equipped-pill">已装备：' + escapeHtml(current.equipped) + '</div>',
            '      </div>',
            '      <div class="topdown-meta-stat-grid topdown-meta-stat-grid--compact">',
            '        <div class="topdown-meta-stat"><span>当前游戏</span><strong>' + escapeHtml(game.label) + '</strong></div>',
            '        <div class="topdown-meta-stat"><span>' + escapeHtml(current.label) + '收藏</span><strong>' + escapeHtml(String(current.owned)) + ' / ' + escapeHtml(String(current.total)) + '</strong></div>',
            '      </div>',
            topdownMetaActiveEffectsHtml(),
            topdownMetaEquipItemsHtml(category),
            '    </section>',
            '  </div>',
            '</div>'
        ].join("");
    }

    function topdownMetaPanelHtml() {
        return [
            '<div class="topdown-meta-root topdown-meta-root--' + escapeHtml(topdownMetaUi.view) + '">',
            '  <div class="topdown-meta-tabs">',
            '    <button type="button" class="topdown-meta-tab' + (topdownMetaUi.view === "draw" ? " is-active" : "") + '" data-topdown-meta-view="draw">抽奖</button>',
            '    <button type="button" class="topdown-meta-tab' + (topdownMetaUi.view === "equip" ? " is-active" : "") + '" data-topdown-meta-view="equip">装备</button>',
            '    <button type="button" class="topdown-meta-tab' + (topdownMetaUi.view === "achievement" ? " is-active" : "") + '" data-topdown-meta-view="achievement">成就</button>',
            '  </div>',
            '  <div class="topdown-meta-view">',
            (topdownMetaUi.view === "draw" ? topdownMetaDrawViewHtml() : (topdownMetaUi.view === "achievement" ? topdownMetaAchievementViewHtml() : topdownMetaEquipViewHtml())),
            '  </div>',
            '</div>'
        ].join("");
    }
    function ensureTopdownMetaModal() {
        if (topdownMetaUi.modal) {
            return topdownMetaUi.modal;
        }
        const modal = document.createElement("div");
        topdownMetaUi.modal = modal;
        modal.className = "games-modal";
        modal.hidden = true;
        modal.innerHTML = [
            '<div class="games-modal-backdrop" data-topdown-meta-close="1"></div>',
            '<div class="games-modal-dialog games-modal-dialog--wide topdown-meta-dialog">',
            '  <div class="games-modal-head">',
            '    <div>',
            '      <div class="games-section-title">局外养成</div>',
            '      <div class="games-stage-meta">统一管理抽到的颜色、图标与背景，Topdown、五子棋、炸金花、数独、2048 和前线都会从这里选择外观。</div>',
            "    </div>",
            '    <button type="button" class="games-modal-close" data-topdown-meta-close="1">关闭</button>',
            "  </div>",
            '  <div class="games-modal-body topdown-meta-body" data-topdown-meta-body="1"></div>',
            '  <div class="games-modal-actions">',
            '    <button type="button" class="games-btn" data-topdown-meta-close="1">关闭</button>',
            "  </div>",
            "</div>"
        ].join("");
        document.body.appendChild(modal);
        modal.addEventListener("click", function (event) {
            const target = event.target;
            if (!(target instanceof HTMLElement)) {
                return;
            }
            const actionTarget = target.closest([
                "[data-topdown-meta-close]",
                "[data-topdown-meta-view]",
                "[data-topdown-equip-category]",
                "[data-topdown-equip-game]",
                "[data-topdown-sort-toggle]",
                "[data-topdown-equip-color]",
                "[data-topdown-equip-icon]",
                "[data-topdown-equip-background]",
                "[data-topdown-achievement-select]",
                "[data-topdown-achievement-clear]",
                "[data-topdown-draw-color]",
                "[data-topdown-draw-color-ten]",
                "[data-topdown-draw-icon]",
                "[data-topdown-draw-icon-ten]",
                "[data-topdown-draw-background]",
                "[data-topdown-draw-background-ten]"
            ].join(","));
            if (!(actionTarget instanceof HTMLElement) || !modal.contains(actionTarget)) {
                return;
            }
            if (actionTarget.hasAttribute("data-topdown-meta-close")) {
                closeTopdownMetaModal();
                return;
            }
            const nextView = actionTarget.getAttribute("data-topdown-meta-view");
            if (nextView === "draw" || nextView === "equip" || nextView === "achievement") {
                if (topdownMetaAnyRollActive()) {
                    topdownMetaUi.flashMessage = "当前正在开奖，请等待滚动结束。";
                    renderTopdownMetaModal();
                    return;
                }
                topdownMetaUi.view = nextView;
                renderTopdownMetaModal();
                return;
            }
            const nextCategory = actionTarget.getAttribute("data-topdown-equip-category");
            if (nextCategory === "color" || nextCategory === "icon" || nextCategory === "background") {
                topdownMetaUi.equipCategory = nextCategory;
                renderTopdownMetaModal();
                return;
            }
            const nextGame = actionTarget.getAttribute("data-topdown-equip-game");
            if (nextGame) {
                const games = topdownMetaEquipGameDefinitions();
                topdownMetaUi.equipGame = games[nextGame] ? nextGame : "topdown";
                const game = games[topdownMetaUi.equipGame] || games.topdown;
                if (game.categories.indexOf(topdownMetaUi.equipCategory) === -1) {
                    topdownMetaUi.equipCategory = game.categories[0] || "color";
                }
                renderTopdownMetaModal();
                return;
            }
            if (actionTarget.hasAttribute("data-topdown-sort-toggle")) {
                topdownMetaUi.sortDescending = !topdownMetaUi.sortDescending;
                renderTopdownMetaModal();
                return;
            }
            const achievementId = actionTarget.getAttribute("data-topdown-achievement-select");
            if (achievementId) {
                const nextState = topdownSetSelectedAchievementBadge(topdownMetaState(), achievementId);
                setTopdownSharedMetaState(nextState);
                topdownMetaUi.flashMessage = "已设置展示徽章。";
                persistTopdownMetaState();
                loadProfile().catch(function () {});
                refreshScorePanels().catch(function () {});
                renderTopdownMetaModal();
                return;
            }
            if (actionTarget.hasAttribute("data-topdown-achievement-clear")) {
                const nextState = topdownSetSelectedAchievementBadge(topdownMetaState(), "");
                setTopdownSharedMetaState(nextState);
                topdownMetaUi.flashMessage = "已取消展示徽章。";
                persistTopdownMetaState();
                loadProfile().catch(function () {});
                refreshScorePanels().catch(function () {});
                renderTopdownMetaModal();
                return;
            }
            handleTopdownMetaEquipClick(actionTarget);
            handleTopdownMetaDrawClick(actionTarget);
        });
        modal.addEventListener("change", function (event) {
            const target = event.target;
            if (!(target instanceof HTMLInputElement)) {
                return;
            }
            if (target.hasAttribute("data-topdown-show-locked")) {
                topdownMetaUi.showLocked = target.checked;
                renderTopdownMetaModal();
            }
        });
        return modal;
    }

    function handleTopdownMetaEquipClick(target) {
        const metaState = topdownMetaState();
        const equipColorKey = target.getAttribute("data-topdown-equip-color");
        if (equipColorKey) {
            if (topdownMetaAnyRollActive()) {
                topdownMetaUi.flashMessage = "当前正在开奖，请等待滚动结束后再切换装备。";
            } else if (metaState.ownedColors.indexOf(equipColorKey) !== -1) {
                metaState.equippedColor = equipColorKey;
                topdownMetaUi.flashMessage = "已装备颜色：" + ((topdownColorCatalog()[equipColorKey] || {}).label || "");
                persistTopdownMetaState();
            }
            renderTopdownMetaModal();
            return;
        }
        const equipIconKey = target.getAttribute("data-topdown-equip-icon");
        if (equipIconKey) {
            if (topdownMetaAnyRollActive()) {
                topdownMetaUi.flashMessage = "当前正在开奖，请等待滚动结束后再切换装备。";
            } else if (metaState.ownedIcons.indexOf(equipIconKey) !== -1) {
                metaState.equippedIcon = equipIconKey;
                topdownMetaUi.flashMessage = "已装备图标：" + ((topdownIconCatalog()[equipIconKey] || {}).label || "");
                persistTopdownMetaState();
            }
            renderTopdownMetaModal();
            return;
        }
        const equipBackgroundKey = target.getAttribute("data-topdown-equip-background");
        if (equipBackgroundKey) {
            if (topdownMetaAnyRollActive()) {
                topdownMetaUi.flashMessage = "当前正在开奖，请等待滚动结束后再切换装备。";
            } else if (metaState.ownedBackgrounds.indexOf(equipBackgroundKey) !== -1) {
                metaState.equippedBackground = equipBackgroundKey;
                topdownMetaUi.flashMessage = "已装备背景：" + ((topdownBackgroundCatalog()[equipBackgroundKey] || {}).label || "");
                persistTopdownMetaState();
            }
            renderTopdownMetaModal();
        }
    }

    function handleTopdownMetaDrawClick(target) {
        if (target.hasAttribute("data-topdown-draw-color")) {
            drawTopdownMetaSingle("color");
            return;
        }
        if (target.hasAttribute("data-topdown-draw-color-ten")) {
            drawTopdownMetaBatch("color", 10);
            return;
        }
        if (target.hasAttribute("data-topdown-draw-icon")) {
            drawTopdownMetaSingle("icon");
            return;
        }
        if (target.hasAttribute("data-topdown-draw-icon-ten")) {
            drawTopdownMetaBatch("icon", 10);
            return;
        }
        if (target.hasAttribute("data-topdown-draw-background")) {
            drawTopdownMetaSingle("background");
            return;
        }
        if (target.hasAttribute("data-topdown-draw-background-ten")) {
            drawTopdownMetaBatch("background", 10);
        }
    }

    function syncTopdownMetaRollTracks() {
        const modal = topdownMetaUi.modal;
        if (!modal || topdownMetaUi.view !== "draw") {
            return;
        }
        ["color", "icon", "background"].forEach(function (kind) {
            const rowState = topdownMetaUi.rollState[kind];
            const viewport = modal.querySelector('[data-topdown-roll-viewport="' + kind + '"]');
            const track = modal.querySelector('[data-topdown-roll-track="' + kind + '"]');
            if (!viewport || !track) {
                return;
            }
            if (!rowState.sequenceKeys.length) {
                topdownMetaEnsureIdleSequence(kind);
            }
            if (!track.innerHTML.trim() || track.childElementCount !== rowState.sequenceKeys.length) {
                track.innerHTML = rowState.sequenceKeys.map(function (key) { return topdownMetaRollItemHtml(kind, key); }).join("");
            }
            const cycleItemCount = rowState.rolling ? rowState.sequenceKeys.length : Math.max(1, Math.floor(rowState.sequenceKeys.length / 2));
            const cycleWidth = cycleItemCount * (topdownMetaUi.rollMetrics.itemWidth + topdownMetaUi.rollMetrics.itemGap);
            track.style.setProperty("--roll-cycle-width", cycleWidth + "px");
            track.style.transform = 'translateX(-' + rowState.offsetPx + 'px)';
        });
    }

    function renderTopdownMetaModal() {
        const modal = ensureTopdownMetaModal();
        const body = modal.querySelector("[data-topdown-meta-body='1']");
        if (body) {
            body.innerHTML = topdownMetaPanelHtml();
        }
        syncTopdownMetaRollTracks();
    }

    async function openTopdownMetaModal() {
        if (typeof state.topdownMetaBeforeOpen === "function") {
            state.topdownMetaBeforeOpen();
        }
        const payload = await loadGameState("topdown-shooter-meta", { preferRemote: true }).catch(function () {
            return loadGameState("topdown-shooter-meta").catch(function () { return { state: {} }; });
        });
        setTopdownSharedMetaState((payload && payload.state) || {});
        if (!state.profile) {
            await loadProfile().catch(function () {});
        }
        topdownMetaApplyLoginGiftIfNeeded();
        const modal = ensureTopdownMetaModal();
        renderTopdownMetaModal();
        modal.hidden = false;
    }

    function closeTopdownMetaModal() {
        if (topdownMetaUi.modal) {
            topdownMetaUi.modal.hidden = true;
        }
    }

    function topdownRollOneMetaColorKey() {
        const metaState = topdownMetaState();
        const commonPool = topdownCommonColorKeys().filter(function (key) { return key !== "classic"; });
        const rarePool = topdownRareColorKeys();
        const superRarePool = topdownSuperRareColorKeys();
        const rareUnlocked = topdownAllCommonColorsOwned(metaState);
        const superRareUnlocked = topdownAllRareColorsOwned(metaState);
        const useSuperRare = superRareUnlocked && Math.random() < TOPDOWN_BALANCE.metaSuperRareColorChance;
        const useRare = rareUnlocked && !useSuperRare && Math.random() < TOPDOWN_BALANCE.metaRareColorChance;
        const pool = useSuperRare ? superRarePool : (useRare ? rarePool : commonPool);
        return pool[Math.floor(Math.random() * pool.length)];
    }

    function topdownRollOneMetaRewardKey(kind) {
        if (kind === "color") {
            return topdownRollOneMetaColorKey();
        }
        if (kind === "background") {
            return topdownWeightedPick(topdownRollRowBaseKeys("background").filter(function (key) { return key !== "dojo"; }), function (key) {
                return topdownBackgroundDrawWeight(topdownBackgroundCatalog()[key]);
            });
        }
        return topdownWeightedPick(topdownRollRowBaseKeys("icon").filter(function (key) { return key !== "triangle"; }), function (key) {
            return topdownIconDrawWeight(topdownIconCatalog()[key]);
        });
    }

    function topdownOwnedMetaRewardKeys(kind) {
        const metaState = topdownMetaState();
        if (kind === "color") {
            return metaState.ownedColors;
        }
        if (kind === "background") {
            return metaState.ownedBackgrounds;
        }
        return metaState.ownedIcons;
    }

    function topdownForceNewMetaRewardKey(kind) {
        const catalog = topdownCatalogForKind(kind);
        const owned = topdownOwnedMetaRewardKeys(kind);
        const tiers = ["common", "rare", "superrare"];
        for (let index = 0; index < tiers.length; index += 1) {
            const pool = topdownSortCatalogKeysByTier(catalog).filter(function (key) {
                return catalog[key] && catalog[key].tier === tiers[index] && owned.indexOf(key) === -1;
            });
            if (pool.length) {
                return pool[Math.floor(Math.random() * pool.length)];
            }
        }
        return "";
    }

    function topdownRollNextMetaRewardKey(kind) {
        if (topdownMetaPityCount(kind) >= 9) {
            return topdownForceNewMetaRewardKey(kind) || topdownRollOneMetaRewardKey(kind);
        }
        return topdownRollOneMetaRewardKey(kind);
    }

    function topdownTrackMetaPity(kind, result) {
        if (result && !result.duplicate) {
            topdownMetaSetPityCount(kind, 0);
            return;
        }
        topdownMetaSetPityCount(kind, topdownMetaPityCount(kind) + 1);
    }

    function topdownApplyMetaRollReward(kind, winnerKey, paidUnitCost) {
        const metaState = topdownMetaState();
        const catalog = topdownCatalogForKind(kind);
        const item = catalog[winnerKey];
        const owned = topdownOwnedMetaRewardKeys(kind);
        if (!item) {
            return { key: winnerKey, label: "未知奖励", tier: "common", duplicate: true, refund: 0 };
        }
        if (owned.indexOf(winnerKey) !== -1) {
            const refund = Math.round(Math.max(0, Number(paidUnitCost || 0)) * topdownMetaDuplicateRefundRate(item.tier));
            return { key: winnerKey, label: item.label, tier: item.tier, duplicate: true, refund: refund };
        }
        owned.push(winnerKey);
        if (kind === "color") {
            metaState.equippedColor = winnerKey;
        } else if (kind === "background") {
            metaState.equippedBackground = winnerKey;
        } else {
            metaState.equippedIcon = winnerKey;
        }
        return { key: winnerKey, label: item.label, tier: item.tier, duplicate: false, refund: 0 };
    }

    function topdownSettleMetaRefunds(kind, results) {
        const refundTotal = (Array.isArray(results) ? results : []).reduce(function (sum, item) {
            return sum + Math.max(0, Number((item && item.refund) || 0));
        }, 0);
        if (refundTotal <= 0) {
            return;
        }
        recordTopdownMetaScoreDelta(refundTotal, "lottery-refund", {
            pool: kind,
            refund_total: refundTotal,
            duplicate_count: results.filter(function (item) { return item && item.duplicate; }).length
        }).catch(function (error) {
            setStatus(error.message || "重复奖励返还积分失败", true);
        }).finally(function () {
            renderTopdownMetaModal();
            notifyTopdownMetaRefresh();
        });
    }

    function topdownResolveMetaRollReward(kind, winnerKey, paidUnitCost) {
        const result = topdownApplyMetaRollReward(kind, winnerKey, paidUnitCost);
        const label = topdownMetaKindLabel(kind);
        topdownTrackMetaPity(kind, result);
        topdownMetaUi.flashMessage = result.duplicate
            ? (result.refund > 0 ? ("抽中重复" + label + " " + result.label + "，已返还 " + result.refund + " 总积分。") : ("抽中重复" + label + " " + result.label + "，免费抽取不返还积分。"))
            : ("获得新" + label + "：" + result.label + "。已自动装备。");
        showTopdownRewardReveal(kind, [result]);
        topdownSettleMetaRefunds(kind, [result]);
        return result;
    }

    function topdownStartMetaRoll(kind, payment, winnerKey) {
        const metaState = topdownMetaState();
        const rowState = topdownMetaUi.rollState[kind];
        if (rowState.rolling) {
            return;
        }
        topdownMetaUi.view = "draw";
        topdownMetaUi.flashMessage = "";
        metaState.pulls += 1;
        if (kind === "color") {
            metaState.colorPulls += 1;
        } else if (kind === "background") {
            metaState.backgroundPulls = Math.max(0, Number(metaState.backgroundPulls || 0)) + 1;
        } else {
            metaState.iconPulls += 1;
        }
        const rollSequence = topdownRollSequence(kind, winnerKey, topdownMetaUi.rollMetrics.sequenceCount, topdownAllCommonColorsOwned(metaState), topdownAllRareColorsOwned(metaState));
        rowState.sequenceKeys = rollSequence.keys;
        rowState.winnerKey = winnerKey;
        rowState.winnerIndex = rollSequence.winnerIndex;
        rowState.offsetPx = 0;
        rowState.rolling = true;
        renderTopdownMetaModal();
        const viewport = topdownMetaUi.modal ? topdownMetaUi.modal.querySelector('[data-topdown-roll-viewport="' + kind + '"]') : null;
        const track = topdownMetaUi.modal ? topdownMetaUi.modal.querySelector('[data-topdown-roll-track="' + kind + '"]') : null;
        if (!viewport || !track) {
            rowState.rolling = false;
            topdownResolveMetaRollReward(kind, winnerKey, payment && payment.unitCosts ? payment.unitCosts[0] : 0);
            persistTopdownMetaState();
            renderTopdownMetaModal();
            return;
        }
        const itemSpan = topdownMetaUi.rollMetrics.itemWidth + topdownMetaUi.rollMetrics.itemGap;
        const targetOffset = Math.max(0, rowState.winnerIndex * itemSpan - (viewport.clientWidth / 2 - topdownMetaUi.rollMetrics.itemWidth / 2));
        const startedAt = performance.now();
        function frame(now) {
            const progress = clamp((now - startedAt) / topdownMetaUi.rollMetrics.durationMs, 0, 1);
            const eased = Math.sin(progress * Math.PI * 0.5);
            rowState.offsetPx = targetOffset * eased;
            const liveTrack = topdownMetaUi.modal ? topdownMetaUi.modal.querySelector('[data-topdown-roll-track="' + kind + '"]') : track;
            if (liveTrack) {
                liveTrack.style.transform = 'translateX(-' + rowState.offsetPx + 'px)';
            }
            if (progress < 1) {
                rowState.frameId = window.requestAnimationFrame(frame);
                return;
            }
            rowState.frameId = 0;
            rowState.rolling = false;
            topdownResolveMetaRollReward(kind, winnerKey, payment && payment.unitCosts ? payment.unitCosts[0] : 0);
            persistTopdownMetaState();
            renderTopdownMetaModal();
        }
        rowState.frameId = window.requestAnimationFrame(frame);
    }

    async function drawTopdownMetaSingle(kind) {
        const cost = topdownMetaDrawCost(kind);
        const label = topdownMetaKindLabel(kind);
        if (topdownMetaAnyRollActive()) {
            topdownMetaUi.flashMessage = "当前已有一条奖池正在开奖，请稍候。";
            renderTopdownMetaModal();
            return;
        }
        topdownMetaUi.paymentBusy = true;
        renderTopdownMetaModal();
        try {
            const payment = await prepareTopdownMetaDrawPayment(kind, 1, false);
            if (!payment) {
                topdownMetaUi.flashMessage = "积分不足，当前 " + topdownMetaAvailablePoints() + "，单抽" + label + "需要 " + cost + "。";
                return;
            }
            topdownMetaUi.flashMessage = topdownMetaPaymentText(payment);
            topdownStartMetaRoll(kind, payment, topdownRollNextMetaRewardKey(kind));
        } catch (error) {
            topdownMetaUi.flashMessage = error.message || "扣除抽奖积分失败，请稍后重试。";
        } finally {
            topdownMetaUi.paymentBusy = false;
            if (!topdownMetaAnyRollActive()) {
                renderTopdownMetaModal();
            }
        }
    }

    async function drawTopdownMetaBatch(kind, count) {
        const metaState = topdownMetaState();
        const drawCount = Math.max(1, Number(count || 1));
        const cost = topdownMetaDrawCost(kind);
        const totalCost = cost * drawCount;
        const label = topdownMetaKindLabel(kind);
        if (topdownMetaAnyRollActive()) {
            topdownMetaUi.flashMessage = "当前已有一条奖池正在开奖，请稍候。";
            renderTopdownMetaModal();
            return;
        }
        topdownMetaUi.paymentBusy = true;
        renderTopdownMetaModal();
        let payment = null;
        try {
            payment = await prepareTopdownMetaDrawPayment(kind, drawCount, drawCount === TOPDOWN_BALANCE.metaDailyFreeTenCount);
            if (!payment) {
                topdownMetaUi.flashMessage = "积分不足，当前 " + topdownMetaAvailablePoints() + "，十连抽" + label + "需要 " + totalCost + "。";
                return;
            }
        } catch (error) {
            topdownMetaUi.flashMessage = error.message || "扣除抽奖积分失败，请稍后重试。";
            return;
        } finally {
            topdownMetaUi.paymentBusy = false;
        }
        topdownMetaUi.view = "draw";
        metaState.pulls += drawCount;
        if (kind === "color") {
            metaState.colorPulls += drawCount;
        } else if (kind === "background") {
            metaState.backgroundPulls = Math.max(0, Number(metaState.backgroundPulls || 0)) + drawCount;
        } else {
            metaState.iconPulls += drawCount;
        }
        const results = [];
        let newCount = 0;
        let duplicateCount = 0;
        let refundTotal = 0;
        for (let index = 0; index < drawCount; index += 1) {
            const result = topdownApplyMetaRollReward(kind, topdownRollNextMetaRewardKey(kind), payment.unitCosts[index] || 0);
            topdownTrackMetaPity(kind, result);
            results.push(result);
            if (result.duplicate) {
                duplicateCount += 1;
                refundTotal += result.refund;
            } else {
                newCount += 1;
            }
        }
        const names = results.slice(0, 6).map(function (item) {
            return item.label + (item.duplicate ? "(重复)" : "");
        }).join("、");
        topdownMetaUi.flashMessage = "十连抽" + label + "完成：" + topdownMetaPaymentText(payment) + "；新获得 " + newCount + "，重复 " + duplicateCount + "，返还 " + refundTotal + " 总积分。结果：" + names + (results.length > 6 ? " 等。" : "。");
        persistTopdownMetaState();
        renderTopdownMetaModal();
        showTopdownRewardReveal(kind, results);
        topdownSettleMetaRefunds(kind, results);
    }


    function bindStaticEvents() {
        ensureProfileMetaEntryButton();
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
        initGamesThemeScheme();
        bindStaticEvents();
        try {
            await Promise.all([loadProfile(), loadManifest(), refreshScorePanels(), loadOnlineVisitors()]);
            initGamesChat();
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

