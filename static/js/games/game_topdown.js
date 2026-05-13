(function () {
    "use strict";

    const modules = window.GamesHubModules;
    if (!modules || typeof modules.register !== "function") {
        return;
    }
    function mountTopdownShooter(savedPayload, hubCtx) {
        const config = hubCtx.config;
        const state = hubCtx.state;
        const els = hubCtx.els;
        const escapeHtml = hubCtx.escapeHtml;
        const formatSeconds = hubCtx.formatSeconds;
        const addStageButton = hubCtx.addStageButton;
        const setStageStats = hubCtx.setStageStats;
        const scheduleGameStateSave = hubCtx.scheduleGameStateSave;
        const submitScore = hubCtx.submitScore;
        const syncPresence = hubCtx.syncPresence;
        const setStatus = hubCtx.setStatus;
        const requestJson = hubCtx.requestJson;
        const loadProfile = hubCtx.loadProfile;
        const refreshScorePanels = hubCtx.refreshScorePanels;
        const openGameInfoOverlay = hubCtx.openGameInfoOverlay;
        const createGameStartOverlay = hubCtx.createGameStartOverlay;
        const createArcadeShell = hubCtx.createArcadeShell;
        const setArcadeStats = hubCtx.setArcadeStats;
        const setArcadeList = hubCtx.setArcadeList;
        const randomBetween = hubCtx.randomBetween;
        const clamp = hubCtx.clamp;
        const distanceBetween = hubCtx.distanceBetween;
        const {
            TOPDOWN_BALANCE,
            TOPDOWN_SCORE_SOFT_CAP,
            topdownActiveBuffSummary,
            topdownAllCommonColorsOwned,
            topdownAllRareColorsOwned,
            applyTopdownBossRelic,
            applyTopdownElement,
            applyTopdownElementSwap,
            topdownApplyFillStyle,
            applyTopdownItemEffect,
            applyTopdownPlayerBlind,
            applyTopdownPlayerKnockback,
            applyTopdownPlayerPull,
            applyTopdownRandomUpgrade,
            applyTopdownUpgrade,
            applyTopdownWingmanElementChoice,
            topdownBackgroundCatalog,
            topdownBackgroundDrawWeight,
            topdownBackgroundPreviewStyle,
            topdownBossRelicSummary,
            topdownBuffRemaining,
            topdownBuildSummary,
            topdownBulletBlockedByWardenField,
            topdownCanonicalEliteType,
            topdownCatalogForKind,
            topdownColorCatalog,
            topdownComboBonus,
            topdownCommonColorKeys,
            topdownCurrentAimAngle,
            topdownCurrentComboItemEvery,
            topdownCurrentPlayerRadius,
            topdownDisplayRollKey,
            topdownEliteLabel,
            topdownEnemyAuraBoost,
            topdownEnemyHp,
            topdownEnemyWardenSlowFactor,
            drawTopdownAoeBurstVisual,
            drawTopdownCosmeticBackground,
            drawTopdownElementBeam,
            drawTopdownElementBullet,
            topdownEquippedAppearance,
            topdownFindEnemyById,
            topdownFireEnemyAttack,
            getTopdownDerivedStats,
            topdownGetIconImage,
            topdownHasLivingBoss,
            drawTopdownStatusRing,
            getWingmanSlots,
            renderTopdownAttributeCards,
            topdownIconCatalog,
            topdownIconDrawWeight,
            topdownIconPreviewGlyph,
            topdownIsUltimateProjectile,
            topdownKillBaseScore,
            topdownMagneticTrapOrbs,
            topdownMetaRewardAmount,
            topdownMetaTierClass,
            topdownMetaTierLabel,
            topdownNearestEnemy,
            topdownPickupVisual,
            topdownPlayerMoveSpeedFactor,
            topdownRareColorKeys,
            topdownRelicEnemyBulletSpeedMultiplier,
            topdownRelicStacks,
            topdownRollRowBaseKeys,
            topdownRollSequence,
            topdownSkillCatalog,
            topdownSkillCooldownRemaining,
            topdownSkillReady,
            topdownSkillSummary,
            topdownSkillTriggerKeyLabel,
            topdownSkillTriggerKeyOptions,
            topdownSortCatalogKeysByTier,
            topdownSpawnInterval,
            topdownSuperRareColorKeys,
            topdownTargetEnemyCount,
            topdownWeightedPick,
            topdownWingmanDetailLines,
            createTopdownShooterSession,
            getTopdownSharedMetaState,
            normalizeTopdownShooterSession,
            serializeTopdownMetaState,
            serializeTopdownShooterSession,
            setTopdownSharedMetaState,
            spawnTopdownEnemy,
            spawnTopdownEnemyExplosion,
            spawnTopdownLuseBurst,
            spawnTopdownPlayerFrenzyVolley,
            spawnTopdownVolley,
            summarizeTopdownMetaState,
            summarizeTopdownShooterSession,
            syncTopdownClock,
            syncTopdownShieldCapacity
        } = hubCtx.topdown;
        let session = normalizeTopdownShooterSession(savedPayload.state || {});
        let metaState = setTopdownSharedMetaState(savedPayload.metaState || {});
        const topdownHelpConfig = {
            title: "俯视射击",
            subtitle: "先稳住护盾和走位，再围绕元素方向滚出能成型的一套构筑。",
            bullets: [
                "操作：移动和射击控制现已拆分，可分别切换。WASD / 方向键负责键盘移动；鼠标模式会自动朝指针位置移动。",
                "射击可切成手动或自动：手动时按住鼠标左键或 J 开火；自动时会持续索敌并自动射击最近敌人。",
                "技能键也可切换，当前支持 Q / E / 空格；闪现、导弹矩阵和绝对无敌都会走同一个技能键。",
                "火会灼烧叠层并周期性打出火系范围叠层弹；电是瞬发激光并固定折射最近敌人；冰会减速叠层直到冰冻；核会生成绿色范围爆发圈。",
                "主武器满级后：火可传染燃烧，电可附加感电增伤，冰冻敌人有概率碎裂秒杀，核会概率留下持续辐射区。",
                "僚机会共享当前僚机数量对应的弹种等级，但不触发主武器的满级终极效果。",
                "首个首领必定掉技能。闪现会朝当前移动方向触发；若当前没有移动则无法发动。所有技能冷却均为 60 秒。",
                "普通小怪也有 1% 概率掉落随机补给，可能是升级球，也可能是随机道具。",
                "后期精英和首领会使用单发、散射、环形弹幕或线性光束；斥力会击飞玩家，典狱长会周期展开阻弹结界并压慢周围敌人。",
                "黑手会抓钩，噩梦会致盲，良子会吞怪回血，魅魔会吸附并狂暴附近单位。",
                "护盾被打空后，再吃到一次伤害就会直接结束，本局没有额外命数。"
            ],
            hint: "优先决定元素方向，再补攻击、射速、护盾、僚机和弹道。高连杀会给道具，首领会掉技能或整局装备，局外积分可用于抽取颜色和图标外观。"
        };
        const arcade = createArcadeShell(
            "俯视射击",
            "WASD 或方向键移动，鼠标瞄准，按住鼠标左键或 J 射击，P 暂停。",
            "单屏展示，右侧只保留战局属性。护盾会按冷却与进度自动恢复。"
        );
        document.body.classList.add("games-topdown-active");
        if (els.stageBody) {
            els.stageBody.classList.add("games-stage-body--topdown");
        }
        if (els.stageActions) {
            els.stageActions.classList.add("games-stage-actions--topdown");
        }
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
        const blockedKeys = { Space: true, ArrowUp: true, ArrowDown: true, ArrowLeft: true, ArrowRight: true, KeyW: true, KeyA: true, KeyS: true, KeyD: true, KeyJ: true, KeyQ: true, KeyE: true, KeyR: true, KeyP: true, Digit0: true, Digit1: true, Digit2: true, Digit3: true };
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
                session = createTopdownShooterSession({
                    moveControl: session.moveControl,
                    fireControl: session.fireControl,
                    skillTriggerKey: session.skillTriggerKey
                });
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
        const skillKeyButton = addStageButton("", function () {
            const options = topdownSkillTriggerKeyOptions();
            const currentIndex = options.indexOf(session.skillTriggerKey);
            session.skillTriggerKey = options[(currentIndex + 1 + options.length) % options.length];
            updateControlButtons();
            updateHud();
            persist();
        }, false);
        addStageButton("帮助", function () {
            openGameInfoOverlay(arcade.canvasWrap, topdownHelpConfig);
        }, false);

        function updateControlButtons() {
            if (moveControlButton) {
                moveControlButton.textContent = session.moveControl === "mouse" ? "移动: 鼠标" : "移动: 键盘";
            }
            if (fireControlButton) {
                fireControlButton.textContent = session.fireControl === "auto" ? "射击: 自动" : "射击: 手动";
            }
            if (skillKeyButton) {
                skillKeyButton.textContent = "技能键: " + topdownSkillTriggerKeyLabel(session.skillTriggerKey);
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

        const metaRollMetrics = {
            itemWidth: 112,
            itemGap: 8,
            sequenceCount: 24,
            durationMs: 3200
        };
        let metaView = "draw";
        let metaFlashMessage = "";
        let metaShowLocked = true;
        let metaRevealTimer = 0;
        let metaPaymentBusy = false;
        const metaRollState = {
            color: { rolling: false, sequenceKeys: [], winnerKey: "", winnerIndex: 0, frameId: 0, offsetPx: 0, refund: 0 },
            icon: { rolling: false, sequenceKeys: [], winnerKey: "", winnerIndex: 0, frameId: 0, offsetPx: 0, refund: 0 },
            background: { rolling: false, sequenceKeys: [], winnerKey: "", winnerIndex: 0, frameId: 0, offsetPx: 0, refund: 0 }
        };

        function topdownAnyMetaRollActive() {
            return metaPaymentBusy || metaRollState.color.rolling || metaRollState.icon.rolling || metaRollState.background.rolling;
        }

        function topdownMetaAvailablePoints() {
            const profileTotalScore = Math.max(0, Math.floor(parseTopdownMetaNumber((state.profile && state.profile.total_score) || 0)));
            return Math.max(0, Math.floor(profileTotalScore));
        }

        function topdownTodayKey() {
            const now = new Date();
            const month = String(now.getMonth() + 1).padStart(2, "0");
            const day = String(now.getDate()).padStart(2, "0");
            return now.getFullYear() + "-" + month + "-" + day;
        }

        function topdownFreePulls(kind) {
            if (kind === "color") {
                return Math.max(0, Number(metaState.freeColorPulls) || 0);
            }
            if (kind === "background") {
                return Math.max(0, Number(metaState.freeBackgroundPulls) || 0);
            }
            return Math.max(0, Number(metaState.freeIconPulls) || 0);
        }

        function topdownPityCount(kind) {
            if (kind === "color") {
                return Math.max(0, Number(metaState.colorPity) || 0);
            }
            if (kind === "background") {
                return Math.max(0, Number(metaState.backgroundPity) || 0);
            }
            return Math.max(0, Number(metaState.iconPity) || 0);
        }

        function topdownSetPityCount(kind, value) {
            const nextValue = Math.max(0, Math.floor(Number(value || 0)));
            if (kind === "color") {
                metaState.colorPity = nextValue;
            } else if (kind === "background") {
                metaState.backgroundPity = nextValue;
            } else {
                metaState.iconPity = nextValue;
            }
        }

        function topdownSetFreePulls(kind, value) {
            const nextValue = Math.max(0, Math.floor(Number(value || 0)));
            if (kind === "color") {
                metaState.freeColorPulls = nextValue;
            } else if (kind === "background") {
                metaState.freeBackgroundPulls = nextValue;
            } else {
                metaState.freeIconPulls = nextValue;
            }
        }

        function topdownDailyFreeTenAvailable(kind) {
            const daily = metaState.dailyFreeTen || (metaState.dailyFreeTen = { color: "", icon: "", background: "" });
            return String(daily[kind] || "") !== topdownTodayKey();
        }

        function topdownMarkDailyFreeTenUsed(kind) {
            const daily = metaState.dailyFreeTen || (metaState.dailyFreeTen = { color: "", icon: "", background: "" });
            daily[kind] = topdownTodayKey();
        }

        function topdownApplyLoginGiftIfNeeded() {
            const giftVersion = 2;
            if (Number(metaState.loginGiftVersion || 0) >= giftVersion) {
                return;
            }
            metaState.freeColorPulls += TOPDOWN_BALANCE.metaLoginGiftPulls;
            metaState.freeIconPulls += TOPDOWN_BALANCE.metaLoginGiftPulls;
            metaState.loginGiftVersion = giftVersion;
            metaFlashMessage = "赠送机会已重置：颜色抽奖券 +" + TOPDOWN_BALANCE.metaLoginGiftPulls + " 抽，图标抽奖券 +" + TOPDOWN_BALANCE.metaLoginGiftPulls + " 抽。";
            persistMeta();
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

        function topdownDuplicateRefundRate(tier) {
            if (tier === "superrare") {
                return 0.8;
            }
            if (tier === "rare") {
                return 0.5;
            }
            return 0.2;
        }

        async function topdownPrepareDrawPayment(kind, drawCount, useDailyFreeTen) {
            const count = Math.max(1, Math.floor(Number(drawCount || 1)));
            const unitCost = topdownDrawCost(kind);
            const payment = {
                kind: kind,
                count: count,
                unitCost: unitCost,
                paidCost: 0,
                freePullsUsed: 0,
                dailyFreeTen: false,
                unitCosts: []
            };
            if (useDailyFreeTen && count === TOPDOWN_BALANCE.metaDailyFreeTenCount && topdownDailyFreeTenAvailable(kind)) {
                payment.dailyFreeTen = true;
                payment.unitCosts = new Array(count).fill(0);
                topdownMarkDailyFreeTenUsed(kind);
                persistMeta();
                return payment;
            }
            const availableTickets = topdownFreePulls(kind);
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
                topdownSetFreePulls(kind, availableTickets - payment.freePullsUsed);
            }
            metaState.totalSpent += payment.paidCost;
            persistMeta();
            return payment;
        }

        function topdownPaymentText(payment) {
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

        topdownApplyLoginGiftIfNeeded();

        function topdownMetaPreviewStyle(item) {
            if (item && item.pattern) {
                return topdownBackgroundPreviewStyle(item);
            }
            if (item.gradient && item.gradient.length) {
                return 'background:linear-gradient(135deg,' + item.gradient.join(",") + ');border-color:' + escapeHtml(item.stroke || "#ffffff") + ';';
            }
            if (item.fill || item.stroke) {
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

        function topdownMetaColorCardHtml(key, color) {
            const owned = metaState.ownedColors.indexOf(key) !== -1;
            const equipped = metaState.equippedColor === key;
            return [
                '<button type="button" class="topdown-meta-skin ' + topdownMetaTierClass(color.tier) + (owned ? " is-owned" : "") + (equipped ? " is-equipped" : "") + '" data-topdown-equip-color="' + escapeHtml(key) + '"' + (owned ? "" : " disabled") + '>',
                '  <span class="topdown-meta-skin-icon" style="' + topdownMetaPreviewStyle(color) + '"></span>',
                '  <span class="topdown-meta-skin-name">' + escapeHtml(color.label) + '</span>',
                '  <span class="topdown-meta-skin-state">' + escapeHtml(topdownMetaTierLabel(color.tier, "color")) + ' / ' + (equipped ? "已装备" : (owned ? "已拥有" : "未拥有")) + '</span>',
                "</button>"
            ].join("");
        }

        function topdownMetaIconCardHtml(key, icon) {
            const owned = metaState.ownedIcons.indexOf(key) !== -1;
            const equipped = metaState.equippedIcon === key;
            const appearance = topdownEquippedAppearance(metaState);
            return [
                '<button type="button" class="topdown-meta-skin ' + topdownMetaTierClass(icon.tier) + (owned ? " is-owned" : "") + (equipped ? " is-equipped" : "") + '" data-topdown-equip-icon="' + escapeHtml(key) + '"' + (owned ? "" : " disabled") + '>',
                '  ' + topdownMetaIconPreviewHtml(icon, "topdown-meta-skin-icon", appearance.color),
                '  <span class="topdown-meta-skin-name">' + escapeHtml(icon.label) + '</span>',
                '  <span class="topdown-meta-skin-state">' + escapeHtml(topdownMetaTierLabel(icon.tier, "icon")) + ' / ' + (equipped ? "已装备" : (owned ? "已拥有" : "未拥有")) + '</span>',
                "</button>"
            ].join("");
        }

        function topdownMetaBackgroundCardHtml(key, background) {
            const owned = metaState.ownedBackgrounds.indexOf(key) !== -1;
            const equipped = metaState.equippedBackground === key;
            return [
                '<button type="button" class="topdown-meta-skin topdown-meta-skin--background ' + topdownMetaTierClass(background.tier) + (owned ? " is-owned" : "") + (equipped ? " is-equipped" : "") + '" data-topdown-equip-background="' + escapeHtml(key) + '"' + (owned ? "" : " disabled") + '>',
                '  <span class="topdown-meta-skin-icon topdown-meta-background-preview" style="' + topdownBackgroundPreviewStyle(background) + '"></span>',
                '  <span class="topdown-meta-skin-name">' + escapeHtml(background.label) + '</span>',
                '  <span class="topdown-meta-skin-state">' + escapeHtml(topdownMetaTierLabel(background.tier, "background")) + ' / ' + (equipped ? "已装备" : (owned ? "已拥有" : "未拥有")) + '</span>',
                "</button>"
            ].join("");
        }

        function topdownMetaRollItemHtml(kind, key) {
            const catalog = topdownCatalogForKind(kind);
            const item = catalog[key];
            if (!item) {
                return "";
            }
            const appearance = topdownEquippedAppearance(metaState);
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
            const appearance = topdownEquippedAppearance(metaState);
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
            const modal = ensureMetaModal();
            const dialog = modal ? modal.querySelector(".topdown-meta-dialog") : null;
            if (!dialog) {
                return;
            }
            const list = (Array.isArray(results) ? results : []).filter(Boolean);
            if (!list.length) {
                return;
            }
            const oldReveal = dialog.querySelector(".topdown-meta-reveal");
            if (oldReveal) {
                oldReveal.remove();
            }
            if (metaRevealTimer) {
                window.clearTimeout(metaRevealTimer);
                metaRevealTimer = 0;
            }
            const durationMs = list.length > 1 ? 10000 : 5000;
            const reveal = document.createElement("div");
            reveal.className = "topdown-meta-reveal" + (list.length > 1 ? " topdown-meta-reveal--batch" : "");
            reveal.style.setProperty("--reveal-duration", durationMs + "ms");
            reveal.innerHTML = [
                '<div class="topdown-meta-reveal-burst"></div>',
                '<div class="topdown-meta-reveal-title">' + (list.length > 1 ? "十连获得" : "获得奖励") + '</div>',
                '<div class="topdown-meta-reveal-grid">',
                list.map(function (result) {
                    return topdownMetaRevealCardHtml(kind, result);
                }).join(""),
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
                if (metaRevealTimer) {
                    window.clearTimeout(metaRevealTimer);
                    metaRevealTimer = 0;
                }
                reveal.remove();
                document.removeEventListener("pointerdown", closeReveal, true);
            }
            dialog.appendChild(reveal);
            window.setTimeout(function () {
                document.addEventListener("pointerdown", closeReveal, true);
            }, 0);
            metaRevealTimer = window.setTimeout(closeReveal, durationMs);
        }

        function topdownMetaStaticRollKeys(kind) {
            const sequence = [];
            for (let index = 0; index < 14; index += 1) {
                sequence.push(topdownDisplayRollKey(kind));
            }
            return sequence.concat(sequence);
        }

        function topdownMetaEnsureIdleSequence(kind) {
            const state = metaRollState[kind];
            if (state.rolling) {
                return;
            }
            state.sequenceKeys = topdownMetaStaticRollKeys(kind);
            state.offsetPx = 0;
        }

        function topdownMetaRollRowHtml(kind) {
            const isColor = kind === "color";
            const isBackground = kind === "background";
            const cost = topdownDrawCost(kind);
            const rowTitle = isColor ? "颜色奖池" : (isBackground ? "背景奖池" : "图标奖池");
            const buttonLabel = isColor ? "抽颜色" : (isBackground ? "抽背景" : "抽图标");
            const dailyFree = topdownDailyFreeTenAvailable(kind);
            const freePulls = topdownFreePulls(kind);
            const pity = topdownPityCount(kind);
            const tenButtonLabel = dailyFree ? "今日免费十连" : (isColor ? "十连抽颜色" : (isBackground ? "十连抽背景" : "十连抽图标"));
            const rowState = metaRollState[kind];
            const trackItems = (rowState.sequenceKeys && rowState.sequenceKeys.length ? rowState.sequenceKeys : topdownMetaStaticRollKeys(kind))
                .map(function (key) { return topdownMetaRollItemHtml(kind, key); })
                .join("");
            return [
                '<div class="topdown-meta-roll-row" data-topdown-roll-row="' + kind + '">',
                '  <div class="topdown-meta-roll-head">',
                '    <div>',
                '      <div class="games-section-title">' + rowTitle + '</div>',
                '      <div class="games-stage-meta">单次消耗 ' + escapeHtml(String(cost)) + ' 总积分；赠券剩余 ' + escapeHtml(String(freePulls)) + ' 抽；保底 ' + escapeHtml(String(Math.min(9, pity))) + '/9；' + (dailyFree ? "今日免费十连可用" : "今日免费十连已使用") + '。</div>',
                '    </div>',
                '    <div class="topdown-meta-roll-actions">',
                '      <button type="button" class="games-btn' + (isColor ? " games-btn--primary" : "") + '" data-topdown-draw-' + kind + '="1"' + (rowState.rolling || metaPaymentBusy ? " disabled" : "") + '>' + buttonLabel + '</button>',
                '      <button type="button" class="games-btn" data-topdown-draw-' + kind + '-ten="1"' + (rowState.rolling || metaPaymentBusy ? " disabled" : "") + '>' + tenButtonLabel + '</button>',
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
                '          <div class="topdown-meta-stat"><span>颜色赠券</span><strong>' + escapeHtml(String(topdownFreePulls("color"))) + '</strong></div>',
                '          <div class="topdown-meta-stat"><span>图标赠券</span><strong>' + escapeHtml(String(topdownFreePulls("icon"))) + '</strong></div>',
                '          <div class="topdown-meta-stat"><span>背景赠券</span><strong>' + escapeHtml(String(topdownFreePulls("background"))) + '</strong></div>',
                '          <div class="topdown-meta-stat"><span>颜色保底</span><strong>' + escapeHtml(String(Math.min(9, topdownPityCount("color")))) + ' / 9</strong></div>',
                '          <div class="topdown-meta-stat"><span>图标保底</span><strong>' + escapeHtml(String(Math.min(9, topdownPityCount("icon")))) + ' / 9</strong></div>',
                '          <div class="topdown-meta-stat"><span>背景保底</span><strong>' + escapeHtml(String(Math.min(9, topdownPityCount("background")))) + ' / 9</strong></div>',
                '          <div class="topdown-meta-stat"><span>颜色收藏</span><strong>' + escapeHtml(String(metaState.ownedColors.length)) + ' / ' + escapeHtml(String(Object.keys(colorCatalog).length)) + '</strong></div>',
                '          <div class="topdown-meta-stat"><span>图标收藏</span><strong>' + escapeHtml(String(metaState.ownedIcons.length)) + ' / ' + escapeHtml(String(Object.keys(iconCatalog).length)) + '</strong></div>',
                '          <div class="topdown-meta-stat"><span>背景收藏</span><strong>' + escapeHtml(String(metaState.ownedBackgrounds.length)) + ' / ' + escapeHtml(String(Object.keys(backgroundCatalog).length)) + '</strong></div>',
                '        </div>',
                '        <div class="games-stage-meta topdown-meta-tip">' + (superRareUnlocked ? "稀有色已集齐，颜色池已开放超级稀有小概率掉落。" : (rareUnlocked ? "普通颜色已集齐，颜色池已开放稀有混色；集齐稀有色后开放超级稀有。" : "先收集完全部普通颜色，再开放极低概率的稀有混色。")) + '</div>',
                (metaFlashMessage ? ('        <div class="games-stage-meta topdown-meta-flash">' + escapeHtml(metaFlashMessage) + '</div>') : ''),
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

        function topdownMetaEquipViewHtml() {
            const colorCatalog = topdownColorCatalog();
            const iconCatalog = topdownIconCatalog();
            const backgroundCatalog = topdownBackgroundCatalog();
            const colorKeys = topdownSortCatalogKeysByTier(colorCatalog).filter(function (key) {
                return metaShowLocked || metaState.ownedColors.indexOf(key) !== -1;
            });
            const iconKeys = topdownSortCatalogKeysByTier(iconCatalog).filter(function (key) {
                return metaShowLocked || metaState.ownedIcons.indexOf(key) !== -1;
            });
            const backgroundKeys = topdownSortCatalogKeysByTier(backgroundCatalog).filter(function (key) {
                return metaShowLocked || metaState.ownedBackgrounds.indexOf(key) !== -1;
            });
            return [
                '<div class="topdown-meta-shell">',
                '  <div class="topdown-meta-layout">',
                '    <div class="topdown-meta-overview-section">',
                '      <div class="games-insight-panel topdown-meta-overview">',
                '        <div class="topdown-meta-overview-main">',
                '          <div>',
                '            <div class="games-section-title">装备仓库</div>',
                '            <div class="games-stage-meta">已拥有的可直接点击装备，未拥有的会以灰色锁定展示。</div>',
                '          </div>',
                '        </div>',
                '        <label class="topdown-meta-toggle">',
                '          <input type="checkbox" data-topdown-show-locked="1"' + (metaShowLocked ? " checked" : "") + '>',
                '          <span>显示未拥有</span>',
                '        </label>',
                '        <div class="topdown-meta-stat-grid">',
                '          <div class="topdown-meta-stat"><span>颜色拥有</span><strong>' + escapeHtml(String(metaState.ownedColors.length)) + ' / ' + escapeHtml(String(Object.keys(colorCatalog).length)) + '</strong></div>',
                '          <div class="topdown-meta-stat"><span>图标拥有</span><strong>' + escapeHtml(String(metaState.ownedIcons.length)) + ' / ' + escapeHtml(String(Object.keys(iconCatalog).length)) + '</strong></div>',
                '          <div class="topdown-meta-stat"><span>背景拥有</span><strong>' + escapeHtml(String(metaState.ownedBackgrounds.length)) + ' / ' + escapeHtml(String(Object.keys(backgroundCatalog).length)) + '</strong></div>',
                '          <div class="topdown-meta-stat"><span>已装备颜色</span><strong>' + escapeHtml(((colorCatalog[metaState.equippedColor] || {}).label || "默认")) + '</strong></div>',
                '          <div class="topdown-meta-stat"><span>已装备图标</span><strong>' + escapeHtml(((iconCatalog[metaState.equippedIcon] || {}).label || "默认")) + '</strong></div>',
                '          <div class="topdown-meta-stat"><span>已装备背景</span><strong>' + escapeHtml(((backgroundCatalog[metaState.equippedBackground] || {}).label || "默认")) + '</strong></div>',
                '        </div>',
                (metaFlashMessage ? ('        <div class="games-stage-meta topdown-meta-flash">' + escapeHtml(metaFlashMessage) + '</div>') : ''),
                '      </div>',
                '    </div>',
                '    <div class="topdown-meta-equip-section">',
                '      <div class="topdown-meta-panels">',
                '        <div class="games-insight-panel topdown-meta-panel topdown-meta-panel--wide">',
                '          <div class="topdown-meta-section-head"><div class="games-section-title">颜色装备</div><div class="games-stage-meta">点击已拥有项即可切换</div></div>',
                '          <div class="topdown-meta-skins">' + colorKeys.map(function (key) { return topdownMetaColorCardHtml(key, colorCatalog[key]); }).join("") + '</div>',
                '        </div>',
                '        <div class="games-insight-panel topdown-meta-panel topdown-meta-panel--wide">',
                '          <div class="topdown-meta-section-head"><div class="games-section-title">图标装备</div><div class="games-stage-meta">未拥有项保留展示，方便预览奖池</div></div>',
                '          <div class="topdown-meta-skins">' + iconKeys.map(function (key) { return topdownMetaIconCardHtml(key, iconCatalog[key]); }).join("") + '</div>',
                '        </div>',
                '        <div class="games-insight-panel topdown-meta-panel topdown-meta-panel--wide">',
                '          <div class="topdown-meta-section-head"><div class="games-section-title">背景装备</div><div class="games-stage-meta">五子棋棋盘和 Topdown 战场共用这一套背景皮肤</div></div>',
                '          <div class="topdown-meta-skins topdown-meta-skins--backgrounds">' + backgroundKeys.map(function (key) { return topdownMetaBackgroundCardHtml(key, backgroundCatalog[key]); }).join("") + '</div>',
                '        </div>',
                '      </div>',
                '    </div>',
                '  </div>',
                '</div>'
            ].join("");
        }

        function topdownMetaPanelHtml() {
            return [
                '<div class="topdown-meta-root">',
                '  <div class="topdown-meta-tabs">',
                '    <button type="button" class="topdown-meta-tab' + (metaView === "draw" ? " is-active" : "") + '" data-topdown-meta-view="draw">抽奖</button>',
                '    <button type="button" class="topdown-meta-tab' + (metaView === "equip" ? " is-active" : "") + '" data-topdown-meta-view="equip">装备</button>',
                '  </div>',
                '  <div class="topdown-meta-view">',
                (metaView === "draw" ? topdownMetaDrawViewHtml() : topdownMetaEquipViewHtml()),
                '  </div>',
                '</div>'
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
                '      <div class="games-stage-meta">抽到的颜色、图标与背景可永久保留，并在 Topdown 与五子棋之间复用。</div>',
                "    </div>",
                '    <button type="button" class="games-modal-close" data-topdown-meta-close="1">关闭</button>',
                "  </div>",
                '  <div class="games-modal-body topdown-meta-body" data-topdown-meta-body="1"></div>',
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
                const nextView = target.getAttribute("data-topdown-meta-view");
                if (nextView === "draw" || nextView === "equip") {
                    if (topdownAnyMetaRollActive()) {
                        metaFlashMessage = "当前正在开奖，请等待滚动结束。";
                        renderMetaModal();
                        return;
                    }
                    metaView = nextView;
                    renderMetaModal();
                    return;
                }
                const equipColorKey = target.getAttribute("data-topdown-equip-color");
                if (equipColorKey) {
                    if (topdownAnyMetaRollActive()) {
                        metaFlashMessage = "当前正在开奖，请等待滚动结束后再切换装备。";
                        renderMetaModal();
                        return;
                    }
                    if (metaState.ownedColors.indexOf(equipColorKey) !== -1) {
                        metaState.equippedColor = equipColorKey;
                        persistMeta();
                        metaFlashMessage = "已装备颜色：" + ((topdownColorCatalog()[equipColorKey] || {}).label || "");
                        renderMetaModal();
                    }
                    return;
                }
                const equipIconKey = target.getAttribute("data-topdown-equip-icon");
                if (equipIconKey) {
                    if (topdownAnyMetaRollActive()) {
                        metaFlashMessage = "当前正在开奖，请等待滚动结束后再切换装备。";
                        renderMetaModal();
                        return;
                    }
                    if (metaState.ownedIcons.indexOf(equipIconKey) !== -1) {
                        metaState.equippedIcon = equipIconKey;
                        persistMeta();
                        metaFlashMessage = "已装备图标：" + ((topdownIconCatalog()[equipIconKey] || {}).label || "");
                        renderMetaModal();
                    }
                    return;
                }
                const equipBackgroundKey = target.getAttribute("data-topdown-equip-background");
                if (equipBackgroundKey) {
                    if (topdownAnyMetaRollActive()) {
                        metaFlashMessage = "当前正在开奖，请等待滚动结束后再切换装备。";
                        renderMetaModal();
                        return;
                    }
                    if (metaState.ownedBackgrounds.indexOf(equipBackgroundKey) !== -1) {
                        metaState.equippedBackground = equipBackgroundKey;
                        persistMeta();
                        metaFlashMessage = "已装备背景：" + ((topdownBackgroundCatalog()[equipBackgroundKey] || {}).label || "");
                        renderMetaModal();
                        updateHud();
                    }
                    return;
                }
                if (target.hasAttribute("data-topdown-draw-color")) {
                    drawTopdownColor();
                    return;
                }
                if (target.hasAttribute("data-topdown-draw-color-ten")) {
                    drawTopdownBatch("color", 10);
                    return;
                }
                if (target.hasAttribute("data-topdown-draw-icon")) {
                    drawTopdownIcon();
                    return;
                }
                if (target.hasAttribute("data-topdown-draw-icon-ten")) {
                    drawTopdownBatch("icon", 10);
                    return;
                }
                if (target.hasAttribute("data-topdown-draw-background")) {
                    drawTopdownBackground();
                    return;
                }
                if (target.hasAttribute("data-topdown-draw-background-ten")) {
                    drawTopdownBatch("background", 10);
                }
            });
            metaModal.addEventListener("change", function (event) {
                const target = event.target;
                if (!(target instanceof HTMLInputElement)) {
                    return;
                }
                if (target.hasAttribute("data-topdown-show-locked")) {
                    metaShowLocked = target.checked;
                    renderMetaModal();
                }
            });
            return metaModal;
        }

        function syncMetaRollTracks() {
            if (!metaModal || metaView !== "draw") {
                return;
            }
            ["color", "icon", "background"].forEach(function (kind) {
                const rowState = metaRollState[kind];
                const viewport = metaModal.querySelector('[data-topdown-roll-viewport="' + kind + '"]');
                const track = metaModal.querySelector('[data-topdown-roll-track="' + kind + '"]');
                if (!viewport || !track) {
                    return;
                }
                if (!rowState.sequenceKeys.length) {
                    topdownMetaEnsureIdleSequence(kind);
                }
                if (!track.innerHTML.trim() || track.childElementCount !== rowState.sequenceKeys.length) {
                    track.innerHTML = rowState.sequenceKeys.map(function (key) {
                        return topdownMetaRollItemHtml(kind, key);
                    }).join("");
                }
                const cycleItemCount = rowState.rolling ? rowState.sequenceKeys.length : Math.max(1, Math.floor(rowState.sequenceKeys.length / 2));
                const cycleWidth = cycleItemCount * (metaRollMetrics.itemWidth + metaRollMetrics.itemGap);
                track.style.setProperty("--roll-cycle-width", cycleWidth + "px");
                track.style.transform = 'translateX(-' + rowState.offsetPx + 'px)';
            });
        }

        function renderMetaModal() {
            const modal = ensureMetaModal();
            const body = modal.querySelector("[data-topdown-meta-body='1']");
            if (body) {
                body.innerHTML = topdownMetaPanelHtml();
            }
            syncMetaRollTracks();
        }

        function openMetaModal() {
            if (session.status === "playing" && !session.pendingUpgrade && !session.pendingPickupChoice) {
                togglePause();
            }
            const modal = ensureMetaModal();
            renderMetaModal();
            modal.hidden = false;
        }

        function closeMetaModal() {
            if (metaModal) {
                metaModal.hidden = true;
            }
        }

        function topdownRollOneColorKey() {
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

        function topdownRollOneIconKey() {
            const pool = topdownRollRowBaseKeys("icon").filter(function (key) { return key !== "triangle"; });
            return topdownWeightedPick(pool, function (key) {
                return topdownIconDrawWeight(topdownIconCatalog()[key]);
            });
        }

        function topdownRollOneBackgroundKey() {
            const pool = topdownRollRowBaseKeys("background").filter(function (key) { return key !== "dojo"; });
            return topdownWeightedPick(pool, function (key) {
                return topdownBackgroundDrawWeight(topdownBackgroundCatalog()[key]);
            });
        }

        function topdownRewardCatalog(kind) {
            return topdownCatalogForKind(kind);
        }

        function topdownOwnedRewardKeys(kind) {
            if (kind === "color") {
                return metaState.ownedColors;
            }
            if (kind === "background") {
                return metaState.ownedBackgrounds;
            }
            return metaState.ownedIcons;
        }

        function topdownUnownedKeysByTier(kind, tier) {
            const catalog = topdownRewardCatalog(kind);
            const owned = topdownOwnedRewardKeys(kind);
            return topdownSortCatalogKeysByTier(catalog).filter(function (key) {
                return catalog[key] && catalog[key].tier === tier && owned.indexOf(key) === -1;
            });
        }

        function topdownForceNewRewardKey(kind) {
            const tiers = ["common", "rare", "superrare"];
            for (let index = 0; index < tiers.length; index += 1) {
                const pool = topdownUnownedKeysByTier(kind, tiers[index]);
                if (pool.length) {
                    return pool[Math.floor(Math.random() * pool.length)];
                }
            }
            return "";
        }

        function topdownRollOneRewardKey(kind) {
            if (kind === "color") {
                return topdownRollOneColorKey();
            }
            if (kind === "background") {
                return topdownRollOneBackgroundKey();
            }
            return topdownRollOneIconKey();
        }

        function topdownRollNextRewardKey(kind) {
            if (topdownPityCount(kind) >= 9) {
                return topdownForceNewRewardKey(kind) || topdownRollOneRewardKey(kind);
            }
            return topdownRollOneRewardKey(kind);
        }

        function topdownTrackPity(kind, result) {
            if (result && !result.duplicate) {
                topdownSetPityCount(kind, 0);
                return;
            }
            topdownSetPityCount(kind, topdownPityCount(kind) + 1);
        }

        function topdownDrawCost(kind) {
            if (kind === "color") {
                return TOPDOWN_BALANCE.metaColorDrawCost;
            }
            if (kind === "background") {
                return TOPDOWN_BALANCE.metaBackgroundDrawCost;
            }
            return TOPDOWN_BALANCE.metaIconDrawCost;
        }

        function topdownApplyRollReward(kind, winnerKey, paidUnitCost) {
            if (kind === "color") {
                const color = topdownColorCatalog()[winnerKey];
                if (metaState.ownedColors.indexOf(winnerKey) !== -1) {
                    const refund = Math.round(Math.max(0, Number(paidUnitCost || 0)) * topdownDuplicateRefundRate(color.tier));
                    return { key: winnerKey, label: color.label, tier: color.tier, duplicate: true, refund: refund };
                } else {
                    metaState.ownedColors.push(winnerKey);
                    metaState.equippedColor = winnerKey;
                    return { key: winnerKey, label: color.label, tier: color.tier, duplicate: false, refund: 0 };
                }
            }
            if (kind === "background") {
                const background = topdownBackgroundCatalog()[winnerKey];
                if (metaState.ownedBackgrounds.indexOf(winnerKey) !== -1) {
                    const refund = Math.round(Math.max(0, Number(paidUnitCost || 0)) * topdownDuplicateRefundRate(background.tier));
                    return { key: winnerKey, label: background.label, tier: background.tier, duplicate: true, refund: refund };
                }
                metaState.ownedBackgrounds.push(winnerKey);
                metaState.equippedBackground = winnerKey;
                return { key: winnerKey, label: background.label, tier: background.tier, duplicate: false, refund: 0 };
            }
            const icon = topdownIconCatalog()[winnerKey];
            if (metaState.ownedIcons.indexOf(winnerKey) !== -1) {
                const refund = Math.round(Math.max(0, Number(paidUnitCost || 0)) * topdownDuplicateRefundRate(icon.tier));
                return { key: winnerKey, label: icon.label, tier: icon.tier, duplicate: true, refund: refund };
            }
            metaState.ownedIcons.push(winnerKey);
            metaState.equippedIcon = winnerKey;
            return { key: winnerKey, label: icon.label, tier: icon.tier, duplicate: false, refund: 0 };
        }

        function topdownSettleRefunds(kind, results) {
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
                renderMetaModal();
                updateHud();
            });
        }

        function topdownResolveRollReward(kind, winnerKey, paidUnitCost) {
            const result = topdownApplyRollReward(kind, winnerKey, paidUnitCost);
            topdownTrackPity(kind, result);
            if (kind === "color") {
                if (result.duplicate) {
                    metaFlashMessage = result.refund > 0 ? ("抽中重复颜色 " + result.label + "，已返还 " + result.refund + " 总积分。") : ("抽中重复颜色 " + result.label + "，免费抽取不返还积分。");
                } else {
                    metaFlashMessage = "获得新颜色：" + result.label + "。已自动装备。";
                }
                showTopdownRewardReveal(kind, [result]);
                topdownSettleRefunds(kind, [result]);
                return result;
            }
            if (kind === "background") {
                if (result.duplicate) {
                    metaFlashMessage = result.refund > 0 ? ("抽中重复背景 " + result.label + "，已返还 " + result.refund + " 总积分。") : ("抽中重复背景 " + result.label + "，免费抽取不返还积分。");
                } else {
                    metaFlashMessage = "获得新背景：" + result.label + "。已自动装备。";
                }
                showTopdownRewardReveal(kind, [result]);
                topdownSettleRefunds(kind, [result]);
                return result;
            }
            if (result.duplicate) {
                metaFlashMessage = result.refund > 0 ? ("抽中重复图标 " + result.label + "，已返还 " + result.refund + " 总积分。") : ("抽中重复图标 " + result.label + "，免费抽取不返还积分。");
            } else {
                metaFlashMessage = "获得新图标：" + result.label + "。已自动装备。";
            }
            showTopdownRewardReveal(kind, [result]);
            topdownSettleRefunds(kind, [result]);
            return result;
        }

        function topdownStartRoll(kind, payment, winnerKey) {
            const rowState = metaRollState[kind];
            if (rowState.rolling) {
                return;
            }
            metaView = "draw";
            metaFlashMessage = "";
            metaState.pulls += 1;
            if (kind === "color") {
                metaState.colorPulls += 1;
            } else if (kind === "background") {
                metaState.backgroundPulls = Math.max(0, Number(metaState.backgroundPulls || 0)) + 1;
            } else {
                metaState.iconPulls += 1;
            }
            const rollSequence = topdownRollSequence(
                kind,
                winnerKey,
                metaRollMetrics.sequenceCount,
                topdownAllCommonColorsOwned(metaState),
                topdownAllRareColorsOwned(metaState)
            );
            rowState.sequenceKeys = rollSequence.keys;
            rowState.winnerKey = winnerKey;
            rowState.winnerIndex = rollSequence.winnerIndex;
            rowState.offsetPx = 0;
            rowState.rolling = true;
            renderMetaModal();
            const viewport = metaModal ? metaModal.querySelector('[data-topdown-roll-viewport="' + kind + '"]') : null;
            const track = metaModal ? metaModal.querySelector('[data-topdown-roll-track="' + kind + '"]') : null;
            if (!viewport || !track) {
                rowState.rolling = false;
                topdownResolveRollReward(kind, winnerKey, payment && payment.unitCosts ? payment.unitCosts[0] : 0);
                persistMeta();
                renderMetaModal();
                return;
            }
            const itemSpan = metaRollMetrics.itemWidth + metaRollMetrics.itemGap;
            const targetOffset = Math.max(0, rowState.winnerIndex * itemSpan - (viewport.clientWidth / 2 - metaRollMetrics.itemWidth / 2));
            const startedAt = performance.now();
            function frame(now) {
                const progress = clamp((now - startedAt) / metaRollMetrics.durationMs, 0, 1);
                const eased = Math.sin(progress * Math.PI * 0.5);
                rowState.offsetPx = targetOffset * eased;
                const liveTrack = metaModal ? metaModal.querySelector('[data-topdown-roll-track="' + kind + '"]') : track;
                if (liveTrack) {
                    liveTrack.style.transform = 'translateX(-' + rowState.offsetPx + 'px)';
                }
                if (progress < 1) {
                    rowState.frameId = window.requestAnimationFrame(frame);
                    return;
                }
                rowState.frameId = 0;
                rowState.rolling = false;
                topdownResolveRollReward(kind, winnerKey, payment && payment.unitCosts ? payment.unitCosts[0] : 0);
                persistMeta();
                renderMetaModal();
            }
            rowState.frameId = window.requestAnimationFrame(frame);
        }

        async function drawTopdownColor() {
            if (topdownAnyMetaRollActive()) {
                metaFlashMessage = "当前已有一条奖池正在开奖，请稍候。";
                renderMetaModal();
                return;
            }
            const cost = topdownDrawCost("color");
            metaPaymentBusy = true;
            renderMetaModal();
            try {
                const payment = await topdownPrepareDrawPayment("color", 1, false);
                if (!payment) {
                    metaFlashMessage = "积分不足，当前 " + topdownMetaAvailablePoints() + "，单抽颜色需要 " + cost + "。";
                    return;
                }
                metaFlashMessage = topdownPaymentText(payment);
                topdownStartRoll("color", payment, topdownRollNextRewardKey("color"));
            } catch (error) {
                metaFlashMessage = error.message || "扣除抽奖积分失败，请稍后重试。";
            } finally {
                metaPaymentBusy = false;
                if (!topdownAnyMetaRollActive()) {
                    renderMetaModal();
                }
            }
        }

        async function drawTopdownIcon() {
            if (topdownAnyMetaRollActive()) {
                metaFlashMessage = "当前已有一条奖池正在开奖，请稍候。";
                renderMetaModal();
                return;
            }
            const cost = topdownDrawCost("icon");
            metaPaymentBusy = true;
            renderMetaModal();
            try {
                const payment = await topdownPrepareDrawPayment("icon", 1, false);
                if (!payment) {
                    metaFlashMessage = "积分不足，当前 " + topdownMetaAvailablePoints() + "，单抽图标需要 " + cost + "。";
                    return;
                }
                metaFlashMessage = topdownPaymentText(payment);
                topdownStartRoll("icon", payment, topdownRollNextRewardKey("icon"));
            } catch (error) {
                metaFlashMessage = error.message || "扣除抽奖积分失败，请稍后重试。";
            } finally {
                metaPaymentBusy = false;
                if (!topdownAnyMetaRollActive()) {
                    renderMetaModal();
                }
            }
        }

        async function drawTopdownBackground() {
            if (topdownAnyMetaRollActive()) {
                metaFlashMessage = "当前已有一条奖池正在开奖，请稍候。";
                renderMetaModal();
                return;
            }
            const cost = topdownDrawCost("background");
            metaPaymentBusy = true;
            renderMetaModal();
            try {
                const payment = await topdownPrepareDrawPayment("background", 1, false);
                if (!payment) {
                    metaFlashMessage = "积分不足，当前 " + topdownMetaAvailablePoints() + "，单抽背景需要 " + cost + "。";
                    return;
                }
                metaFlashMessage = topdownPaymentText(payment);
                topdownStartRoll("background", payment, topdownRollNextRewardKey("background"));
            } catch (error) {
                metaFlashMessage = error.message || "扣除抽奖积分失败，请稍后重试。";
            } finally {
                metaPaymentBusy = false;
                if (!topdownAnyMetaRollActive()) {
                    renderMetaModal();
                }
            }
        }

        async function drawTopdownBatch(kind, count) {
            const drawCount = Math.max(1, Number(count || 1));
            const cost = topdownDrawCost(kind);
            const totalCost = cost * drawCount;
            const label = kind === "color" ? "颜色" : (kind === "background" ? "背景" : "图标");
            if (topdownAnyMetaRollActive()) {
                metaFlashMessage = "当前已有一条奖池正在开奖，请稍候。";
                renderMetaModal();
                return;
            }
            metaPaymentBusy = true;
            renderMetaModal();
            let payment = null;
            try {
                payment = await topdownPrepareDrawPayment(kind, drawCount, drawCount === TOPDOWN_BALANCE.metaDailyFreeTenCount);
                if (!payment) {
                    metaFlashMessage = "积分不足，当前 " + topdownMetaAvailablePoints() + "，十连抽" + label + "需要 " + totalCost + "。";
                    return;
                }
            } catch (error) {
                metaFlashMessage = error.message || "扣除抽奖积分失败，请稍后重试。";
                return;
            } finally {
                metaPaymentBusy = false;
            }
            metaView = "draw";
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
                const result = topdownApplyRollReward(kind, topdownRollNextRewardKey(kind), payment.unitCosts[index] || 0);
                topdownTrackPity(kind, result);
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
            metaFlashMessage = "十连抽" + label + "完成：" + topdownPaymentText(payment) + "；新获得 " + newCount + "，重复 " + duplicateCount + "，返还 " + refundTotal + " 总积分。结果：" + names + (results.length > 6 ? " 等。" : "。");
            persistMeta();
            renderMetaModal();
            showTopdownRewardReveal(kind, results);
            topdownSettleRefunds(kind, results);
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
                "技能键：" + topdownSkillTriggerKeyLabel(session.skillTriggerKey),
                "首领装备：" + topdownBossRelicSummary(session),
                renderTopdownAttributeCards(session),
                wingmanLines[0],
                "总积分：" + topdownMetaAvailablePoints() + " / 颜色券：" + topdownFreePulls("color") + " / 图标券：" + topdownFreePulls("icon") + " / 背景券：" + topdownFreePulls("background")
            ];
            if (activeBuffSummary && activeBuffSummary !== "无") {
                sideLines.push("临时增益：" + activeBuffSummary);
            }
            if (session.score >= TOPDOWN_SCORE_SOFT_CAP) {
                sideLines.push("得分软上限已生效：后续击杀基础分降为 1，连杀奖励保留。");
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
            if (session.pendingUpgrade || session.pendingPickupChoice || session.status !== "playing") {
                return false;
            }
            if (session.skill.key === "blink") {
                const moveX = Number(session.player.moveDirX || 0);
                const moveY = Number(session.player.moveDirY || 0);
                const moveLen = Math.sqrt(moveX * moveX + moveY * moveY);
                if (moveLen < 0.01) {
                    setStatus("当前没有移动方向，无法触发闪现。", true);
                    return false;
                }
                session.player.dashLeft = TOPDOWN_BALANCE.blinkDuration;
                session.player.dashVx = moveX / moveLen * TOPDOWN_BALANCE.blinkDistance / TOPDOWN_BALANCE.blinkDuration;
                session.player.dashVy = moveY / moveLen * TOPDOWN_BALANCE.blinkDistance / TOPDOWN_BALANCE.blinkDuration;
                session.player.invulnerableUntil = Math.max(Number(session.player.invulnerableUntil || 0), session.tick + TOPDOWN_BALANCE.blinkDuration);
                session.player.pullLeft = 0;
                session.player.pullEnemyId = 0;
                session.player.controlLock = 0;
                session.skill.readyAt = session.tick + TOPDOWN_BALANCE.skillCooldown;
                setStatus("已触发闪现。", false);
                return true;
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

        function maybeShoot() {
            if (session.status !== "playing" || session.pendingUpgrade || session.pendingPickupChoice || session.player.fireCooldown > 0) {
                return;
            }
            if (Number(session.player.frenzyUntil || 0) > Number(session.tick || 0)) {
                return;
            }
            if (Number(session.player.frenzyExhaustUntil || 0) > Number(session.tick || 0)) {
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
            if (Number(session.player.frenzyUntil || 0) > 0 && session.player.frenzyUntil <= session.tick) {
                session.player.frenzyUntil = 0;
                session.player.frenzyExhaustUntil = Math.max(Number(session.player.frenzyExhaustUntil || 0), Number(session.player.frenzyExhaustQueuedUntil || 0));
                session.player.frenzyExhaustQueuedUntil = 0;
                setStatus("压制弹幕结束，机体进入 5 秒虚弱，无法射击且移速减半。", true);
            }
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

            if (Number(session.player.frenzyUntil || 0) > Number(session.tick || 0) && Number(session.player.frenzyNextShotAt || 0) <= Number(session.tick || 0)) {
                spawnTopdownPlayerFrenzyVolley(session, topdownCurrentAimAngle(session, pointer));
                session.player.frenzyNextShotAt = session.tick + TOPDOWN_BALANCE.frenzyVolleyInterval;
            }

            const playerStats = getTopdownDerivedStats(session, false);
            let moveX = 0;
            let moveY = 0;
            let actualMoveDirX = 0;
            let actualMoveDirY = 0;
            const playerMoveFactor = topdownPlayerMoveSpeedFactor(session);
            if (session.moveControl !== "mouse") {
                if (pressed.KeyW || pressed.ArrowUp) { moveY -= 1; }
                if (pressed.KeyS || pressed.ArrowDown) { moveY += 1; }
                if (pressed.KeyA || pressed.ArrowLeft) { moveX -= 1; }
                if (pressed.KeyD || pressed.ArrowRight) { moveX += 1; }
            }
            const moveMagnitude = Math.sqrt(moveX * moveX + moveY * moveY);
            const moveLen = moveMagnitude || 1;
            if (session.player.pullLeft > 0) {
                const pullEnemy = topdownFindEnemyById(session, session.player.pullEnemyId);
                if (pullEnemy) {
                    const pullDx = pullEnemy.x - session.player.x;
                    const pullDy = pullEnemy.y - session.player.y;
                    const pullLen = Math.max(1, Math.sqrt(pullDx * pullDx + pullDy * pullDy));
                    actualMoveDirX = pullDx / pullLen;
                    actualMoveDirY = pullDy / pullLen;
                    session.player.x = clamp(session.player.x + pullDx / pullLen * session.player.pullSpeed * dt, arenaPlayerMargin, arenaWidth - arenaPlayerMargin);
                    session.player.y = clamp(session.player.y + pullDy / pullLen * session.player.pullSpeed * dt, arenaPlayerMargin, arenaHeight - arenaPlayerMargin);
                } else {
                    session.player.pullLeft = 0;
                    session.player.pullEnemyId = 0;
                }
            } else if (session.player.dashLeft > 0) {
                actualMoveDirX = Number(session.player.dashVx || 0);
                actualMoveDirY = Number(session.player.dashVy || 0);
                session.player.x = clamp(session.player.x + Number(session.player.dashVx || 0) * dt, arenaPlayerMargin, arenaWidth - arenaPlayerMargin);
                session.player.y = clamp(session.player.y + Number(session.player.dashVy || 0) * dt, arenaPlayerMargin, arenaHeight - arenaPlayerMargin);
                if (session.player.dashLeft <= 0.001) {
                    session.player.dashVx = 0;
                    session.player.dashVy = 0;
                }
            } else if (session.player.controlLock > 0) {
                actualMoveDirX = Number(session.player.knockbackVx || 0);
                actualMoveDirY = Number(session.player.knockbackVy || 0);
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
                        actualMoveDirX = autoDx / autoLen;
                        actualMoveDirY = autoDy / autoLen;
                        const travel = Math.min(autoLen, playerStats.moveSpeed * playerMoveFactor * dt);
                        session.player.x = clamp(session.player.x + autoDx / autoLen * travel, arenaPlayerMargin, arenaWidth - arenaPlayerMargin);
                        session.player.y = clamp(session.player.y + autoDy / autoLen * travel, arenaPlayerMargin, arenaHeight - arenaPlayerMargin);
                    }
                } else {
                    if (moveMagnitude > 0) {
                        actualMoveDirX = moveX / moveLen;
                        actualMoveDirY = moveY / moveLen;
                    }
                    session.player.x = clamp(session.player.x + (moveX / moveLen) * playerStats.moveSpeed * playerMoveFactor * dt, arenaPlayerMargin, arenaWidth - arenaPlayerMargin);
                    session.player.y = clamp(session.player.y + (moveY / moveLen) * playerStats.moveSpeed * playerMoveFactor * dt, arenaPlayerMargin, arenaHeight - arenaPlayerMargin);
                }
            }
            session.player.moveDirX = actualMoveDirX;
            session.player.moveDirY = actualMoveDirY;
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
                enemy.eliteType = topdownCanonicalEliteType(enemy.eliteType);
                const eliteType = enemy.eliteType;
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
                if (enemy.isElite && eliteType === "buffer") {
                    enemy.auraTimer = Math.max(0, Number(enemy.auraTimer || 0) - dt);
                    if (enemy.auraTimer <= 0) {
                        enemy.auraActive = !enemy.auraActive;
                        enemy.auraTimer = enemy.auraActive ? TOPDOWN_BALANCE.bufferAuraOnDuration : TOPDOWN_BALANCE.bufferAuraOffDuration;
                    }
                }
                if (enemy.isElite && eliteType === "warden") {
                    enemy.wardenFieldTimer = Math.max(0, Number(enemy.wardenFieldTimer || 0) - dt);
                    if (enemy.wardenFieldTimer <= 0) {
                        enemy.wardenFieldActive = !enemy.wardenFieldActive;
                        enemy.wardenFieldTimer = enemy.wardenFieldActive ? TOPDOWN_BALANCE.wardenFieldOnDuration : TOPDOWN_BALANCE.wardenFieldOffDuration;
                    }
                }
                if (enemy.isElite && eliteType === "repulsor") {
                    enemy.repulseCooldown = Math.max(0, Number(enemy.repulseCooldown || 0) - dt);
                    if (enemy.repulseCooldown <= 0 && distanceBetween(enemy, session.player) <= TOPDOWN_BALANCE.repulsorRange + session.player.radius + enemy.radius) {
                        applyTopdownPlayerKnockback(session, enemy.x, enemy.y, TOPDOWN_BALANCE.repulsorKnockDistance, TOPDOWN_BALANCE.repulsorKnockSpeed);
                        enemy.repulseCooldown = TOPDOWN_BALANCE.repulsorCooldown;
                        setStatus("斥力冲击：你被击飞。", true);
                    }
                }
                if (enemy.isElite && eliteType === "nightmare" && Number(enemy.touchCooldown || 0) <= 0 && distanceBetween(enemy, session.player) <= TOPDOWN_BALANCE.nightmareAuraRange + session.player.radius) {
                    applyTopdownPlayerBlind(session, TOPDOWN_BALANCE.nightmareBlindDuration);
                    enemy.touchCooldown = TOPDOWN_BALANCE.nightmareTouchCooldown;
                    setStatus("噩梦领域触发：视野受限 5 秒。", true);
                }
                const startX = enemy.x;
                const startY = enemy.y;
                const dx = session.player.x - enemy.x;
                const dy = session.player.y - enemy.y;
                const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
                const slowFactor = enemy.frozenTime > 0 ? 0 : Math.max(0.22, 1 - Math.min(TOPDOWN_BALANCE.iceMaxSlow, enemy.iceStacks * TOPDOWN_BALANCE.iceSlowPerStack));
                const auraBoost = topdownEnemyAuraBoost(session, enemy);
                let desiredSpeed = enemy.speed * slowFactor * auraBoost.speedMultiplier * topdownEnemyWardenSlowFactor(session, enemy);
                let fireRange = TOPDOWN_BALANCE.enemyFireRange;
                let bulletSpeed = TOPDOWN_BALANCE.enemyBulletSpeed;
                if (Number(enemy.enrageUntil || 0) > Number(session.tick || 0)) {
                    desiredSpeed *= 1.48;
                    fireRange = 0;
                }
                if (enemy.isElite && eliteType === "dash") {
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
                    if (enemy.isElite && eliteType === "sniper") {
                        fireRange = TOPDOWN_BALANCE.eliteSniperRange;
                        bulletSpeed = TOPDOWN_BALANCE.eliteSniperBulletSpeed;
                        desiredSpeed *= len < 220 ? 0.55 : 0.88;
                    } else if (enemy.isElite && eliteType === "buffer") {
                        desiredSpeed *= enemy.auraActive ? (len < 180 ? 0.28 : 0.62) : 0.9;
                    } else if (enemy.isElite && eliteType === "splitter") {
                        desiredSpeed *= 1.06;
                    } else if (enemy.isElite && eliteType === "self-destruct") {
                        desiredSpeed *= 0.94;
                    } else if (enemy.isElite && eliteType === "blackhand") {
                        desiredSpeed *= len < 160 ? 0.72 : 0.94;
                    } else if (enemy.isElite && eliteType === "nightmare") {
                        desiredSpeed *= 1.18;
                    } else if (enemy.isElite && eliteType === "liangzi") {
                        desiredSpeed *= len < 150 ? 0.86 : 1.02;
                    } else if (enemy.isElite && eliteType === "luse") {
                        fireRange = 0;
                        if (!enemy.luseTriggered && len <= TOPDOWN_BALANCE.luseTriggerRange) {
                            spawnTopdownLuseBurst(session, enemy, Math.atan2(dy, dx), bulletSpeed * topdownRelicEnemyBulletSpeedMultiplier(session));
                            enemy.luseTriggered = true;
                            enemy.fireCooldown = 999;
                            setStatus("撸瑟开火：前方弹幕已铺开。", true);
                        }
                        desiredSpeed = enemy.luseTriggered ? 0 : desiredSpeed * 0.86;
                    } else if (enemy.isElite && eliteType === "succubus") {
                        desiredSpeed *= len < 220 ? 0.72 : 0.92;
                        enemy.succubusVictimIds = [];
                        session.enemies.forEach(function (candidate) {
                            if (!candidate || candidate.id === enemy.id || candidate.hp <= 0 || candidate.remnantActive || candidate.isBoss) {
                                return;
                            }
                            const pullDx = enemy.x - candidate.x;
                            const pullDy = enemy.y - candidate.y;
                            const pullLen = Math.sqrt(pullDx * pullDx + pullDy * pullDy) || 0;
                            if (pullLen <= TOPDOWN_BALANCE.succubusAuraRange + candidate.radius) {
                                enemy.succubusVictimIds.push(candidate.id);
                                if (pullLen > 2) {
                                    const pullStep = Math.min(TOPDOWN_BALANCE.succubusPullStrength * dt, Math.max(0, pullLen - 2));
                                    candidate.x += pullDx / Math.max(1, pullLen) * pullStep;
                                    candidate.y += pullDy / Math.max(1, pullLen) * pullStep;
                                }
                            }
                        });
                    }
                    enemy.x += dx / len * desiredSpeed * dt;
                    enemy.y += dy / len * desiredSpeed * dt;
                }
                if (enemy.isElite && eliteType === "luse" && enemy.luseTriggered) {
                    damageTopdownEnemy(session, enemy, TOPDOWN_BALANCE.luseDecayPerSecond * dt);
                }
                if (enemy.isElite && eliteType === "liangzi" && enemy.consumeCooldown <= 0) {
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
                if (enemy.isElite && eliteType === "summoner") {
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
                                wardenFieldActive: false,
                                wardenFieldTimer: 0,
                                hasSplit: false,
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
                                succubusVictimIds: [],
                                enrageUntil: 0
                            });
                            session.nextId += 1;
                        }
                        enemy.summonCooldown = TOPDOWN_BALANCE.eliteSummonCooldown;
                    }
                }
                if (enemy.hp <= 0) {
                    return;
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
                if (topdownBulletBlockedByWardenField(session, bullet)) {
                    hit = true;
                }
                for (let index = 0; index < session.enemies.length; index += 1) {
                    const enemy = session.enemies[index];
                    if (hit) {
                        break;
                    }
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
                                width: 2.4 + bullet.elementLevel * 0.35,
                                element: "electric",
                                elementLevel: bullet.elementLevel,
                                canUltimate: bullet.canUltimate,
                                ultimate: topdownIsUltimateProjectile(bullet)
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

        function drawTopdownPlayerCore(ctx, appearance, playerScale, damageFlash) {
            const color = appearance.color;
            const baseRadius = 14 * playerScale;
            const iconBoxSize = baseRadius * 1.48;
            const iconFontSize = Math.round(baseRadius * 1.12);
            topdownApplyFillStyle(ctx, color, 0, 0, 18 * playerScale, session.tick);
            if (damageFlash) {
                ctx.fillStyle = "#fb7185";
            }
            if (appearance.icon.kind === "glyph") {
                ctx.beginPath();
                ctx.moveTo(18 * playerScale, 0);
                ctx.lineTo(-12 * playerScale, -12 * playerScale);
                ctx.lineTo(-6 * playerScale, 0);
                ctx.lineTo(-12 * playerScale, 12 * playerScale);
                ctx.closePath();
                ctx.fill();
                ctx.strokeStyle = color.stroke || "#e2e8f0";
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fillStyle = color.accent || "#67e8f9";
                ctx.beginPath();
                ctx.arc(-2 * playerScale, 0, 3.2 * playerScale, 0, Math.PI * 2);
                ctx.fill();
            } else if (appearance.icon.kind !== "svg") {
                ctx.beginPath();
                ctx.arc(0, 0, baseRadius * 1.45, 0, Math.PI * 2);
                ctx.fill();
                ctx.strokeStyle = color.stroke || "#e2e8f0";
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.fillStyle = color.accent || "#67e8f9";
                ctx.beginPath();
                ctx.arc(0, 0, baseRadius * 0.42, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.save();
            const icon = appearance.icon;
            if (icon.kind === "svg") {
                const image = topdownGetIconImage(icon);
                if (image && image.complete && image.naturalWidth > 0) {
                    ctx.save();
                    ctx.shadowColor = color.accent || color.stroke || "#67e8f9";
                    ctx.shadowBlur = 10 * playerScale;
                    ctx.globalAlpha = damageFlash ? 0.88 : 0.98;
                    ctx.drawImage(image, -iconBoxSize / 2, -iconBoxSize / 2, iconBoxSize, iconBoxSize);
                    ctx.globalCompositeOperation = "source-in";
                    topdownApplyFillStyle(ctx, color, -iconBoxSize / 2, -iconBoxSize / 2, iconBoxSize, session.tick);
                    ctx.fillRect(-iconBoxSize / 2, -iconBoxSize / 2, iconBoxSize, iconBoxSize);
                    ctx.restore();
                } else {
                    topdownApplyFillStyle(ctx, color, 0, 0, iconBoxSize, session.tick);
                    ctx.font = "700 " + iconFontSize + "px Segoe UI Symbol";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(topdownIconPreviewGlyph(icon), 0, 0);
                }
            } else {
                ctx.fillStyle = "#f8fafc";
                ctx.font = (icon.kind === "emoji" ? "700 " : "800 ") + iconFontSize + "px Segoe UI Emoji, Segoe UI Symbol, Segoe UI";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.fillText(topdownIconPreviewGlyph(icon), 0, 0);
            }
            ctx.restore();
        }

        function renderSession() {
            const appearance = topdownEquippedAppearance(metaState);
            drawTopdownCosmeticBackground(ctx, arenaWidth, arenaHeight, session.tick, appearance.background);
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
            drawTopdownPlayerCore(ctx, appearance, playerScale, session.player.damageFlash > 0);
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
                drawTopdownElementBullet(ctx, bullet, session.tick);
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
                drawTopdownElementBeam(ctx, beam);
            });

            session.aoeBursts.forEach(function (burst) {
                if (burst.type === "enemy-explosion") {
                    drawTopdownAoeBurstVisual(ctx, burst);
                } else {
                    drawTopdownAoeBurstVisual(ctx, burst);
                }
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
                    ctx.strokeStyle = "rgba(244, 114, 182, 0.5)";
                    ctx.setLineDash([4, 10]);
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, TOPDOWN_BALANCE.repulsorRange, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.fillStyle = "rgba(244, 114, 182, 0.08)";
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, TOPDOWN_BALANCE.repulsorRange * Math.max(0.24, 1 - Number(enemy.repulseCooldown || 0) / TOPDOWN_BALANCE.repulsorCooldown), 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                }
                if (enemy.isElite && enemy.eliteType === "warden") {
                    ctx.save();
                    ctx.strokeStyle = enemy.wardenFieldActive ? "rgba(125, 211, 252, 0.68)" : "rgba(125, 211, 252, 0.24)";
                    ctx.fillStyle = enemy.wardenFieldActive ? "rgba(14, 165, 233, 0.08)" : "rgba(14, 165, 233, 0.025)";
                    ctx.setLineDash(enemy.wardenFieldActive ? [10, 6] : [4, 12]);
                    ctx.lineWidth = enemy.wardenFieldActive ? 2.4 : 1.8;
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, TOPDOWN_BALANCE.wardenFieldRange, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.restore();
                }
                if (enemy.isElite && enemy.eliteType === "nightmare") {
                    ctx.save();
                    ctx.strokeStyle = "rgba(30, 41, 59, 0.72)";
                    ctx.lineWidth = 2.6;
                    ctx.setLineDash([10, 8]);
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, TOPDOWN_BALANCE.nightmareAuraRange, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.setLineDash([]);
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
                if (enemy.isElite && enemy.eliteType === "luse") {
                    ctx.save();
                    ctx.strokeStyle = "rgba(251, 191, 36, 0.76)";
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, TOPDOWN_BALANCE.luseTriggerRange, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                }
                if (enemy.isElite && enemy.eliteType === "succubus") {
                    ctx.save();
                    ctx.strokeStyle = "rgba(244, 114, 182, 0.66)";
                    ctx.lineWidth = 2.6;
                    ctx.setLineDash([12, 6]);
                    ctx.beginPath();
                    ctx.arc(enemy.x, enemy.y, TOPDOWN_BALANCE.succubusAuraRange, 0, Math.PI * 2);
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
            ctx.fillText(session.combo > 0 ? ("剩余连杀时间 " + session.comboTimer.toFixed(1) + "s / 当前击杀得分 " + (topdownKillBaseScore(session) + topdownComboBonus(session))) : ("连续击败敌人可叠加连杀得分，当前道具阈值 " + topdownCurrentComboItemEvery(session) + " 连"), 22, 49);
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
            if (session.pendingUpgrade && event.code.indexOf("Digit") === 0) {
                selectUpgrade(Number(event.code.slice(5)) - 1);
            } else if (session.pendingUpgrade && event.code === "KeyR") {
                rerollUpgradeChoices();
            } else if (session.pendingPickupChoice && session.pendingPickupChoice.allowDecline !== false && (event.code === "Digit0" || event.code === "Numpad0")) {
                declinePendingPickupChoice();
            } else if (session.pendingPickupChoice && event.code.indexOf("Digit") === 0) {
                resolvePendingPickupChoice(Number(event.code.slice(5)) - 1);
            } else if (event.code === session.skillTriggerKey) {
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

        state.topdownMetaRefresh = function () {
            metaState = getTopdownSharedMetaState(metaState);
            updateHud();
        };
        state.topdownMetaBeforeOpen = function () {
            if (session.status === "playing" && !session.pendingUpgrade && !session.pendingPickupChoice) {
                togglePause();
            }
        };

        updateHud();
        persist();
        animationId = window.requestAnimationFrame(loop);

        return function cleanup() {
            document.body.classList.remove("games-topdown-active");
            state.topdownMetaRefresh = null;
            state.topdownMetaBeforeOpen = null;
            if (els.stageBody) {
                els.stageBody.classList.remove("games-stage-body--topdown");
            }
            if (els.stageActions) {
                els.stageActions.classList.remove("games-stage-actions--topdown");
            }
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


    modules.register("topdown-shooter", mountTopdownShooter);
})();
