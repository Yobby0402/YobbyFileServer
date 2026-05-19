(function () {
    "use strict";

    // 这个文件只负责“分数怎么算”和“分数怎么提交”。
    // 如果以后要调数值，优先改这里，不要分散到各个游戏文件里分别手调。
    //
    // 推荐调分步骤：
    // 1. 先实测一局，记录该局总分和总用时。
    // 2. 用 `estimateScorePerMinute(totalScore, elapsedSeconds)` 算出当前分钟产出。
    // 3. 用 `scorePerMinuteMultiplier(currentPerMinute)` 算出应该放大的倍率。
    // 4. 用 `tuneValueForExpectedScorePerMinute(baseValue, currentPerMinute)` 回推新的常量。
    //
    // 例子：
    // - 当前 Topdown 一局 60 秒大约 20000 分，目标是 50000 分/分钟
    // - 倍率 = 50000 / 20000 = 2.5
    // - 原 killScore = 200，则新 killScore 可先改成 500
    // - 再实测一轮，做第二次微调

    const DEFAULT_EXPECTED_SCORE_PER_MINUTE = 50000;
    const SCORE_2048_TILE_POINT = 12;
    const SUDOKU_SCORE_MULTIPLIER = 120;
    const SUDOKU_SCORE_TABLE = {
        "classic-easy": { base: 2200, difficultyBonus: 900, targetSeconds: 1800, timeRate: 1.1 },
        "classic-medium": { base: 3000, difficultyBonus: 1700, targetSeconds: 2400, timeRate: 1.35 },
        "classic-hard": { base: 4200, difficultyBonus: 3000, targetSeconds: 3000, timeRate: 1.8 },
        "hex-16": { base: 8800, difficultyBonus: 7600, targetSeconds: 5400, timeRate: 3.0 }
    };
    const TOPDOWN_RULES = Object.freeze({
        // Topdown 的 4 个主要产分入口。
        // 如果要整体抬高/压低 Topdown 分数，优先一起按比例调整这几个值。
        killScore: 1000,
        settlementTimeScorePerSecond: 1800,
        waveBonusScore: 4500,
        bossBonusScore: 30000
    });
    // Topdown 的目标 TTK 统一入口。
    // 程序会根据玩家当前有效 DPS，自动把新刷出的怪物血量推到这个区间附近。
    // 想整体调节怪物耐打程度时，优先只改这里。
    const TOPDOWN_TTK_RULES = Object.freeze({
        minSeconds: 2,
        maxSeconds: 5,
        growthEndWave: 18,
        dpsSoftCap: 100,
        dpsOverflowFactor: 0.6,
        enemyHpMultiplierMin: 0.75,
        enemyHpMultiplierMax: 8
    });

    function normalizeNonNegativeNumber(value) {
        return Math.max(0, Number(value || 0));
    }

    function normalizePositiveNumber(value, fallbackValue) {
        const normalized = Number(value);
        if (!Number.isFinite(normalized) || normalized <= 0) {
            return Math.max(1, Number(fallbackValue || 1));
        }
        return normalized;
    }

    function clampNumber(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function applySoftCap(value, cap, overflowFactor) {
        const normalizedValue = normalizeNonNegativeNumber(value);
        const normalizedCap = normalizePositiveNumber(cap, normalizedValue || 1);
        const normalizedOverflowFactor = clampNumber(Number(overflowFactor == null ? 1 : overflowFactor), 0, 1);
        if (normalizedValue <= normalizedCap) {
            return normalizedValue;
        }
        return normalizedCap + (normalizedValue - normalizedCap) * normalizedOverflowFactor;
    }

    // 把“这局得了多少分 / 打了多少秒”换算成分钟产出，便于横向比较不同游戏。
    function estimateScorePerMinute(totalScore, elapsedSeconds) {
        const normalizedSeconds = normalizeNonNegativeNumber(elapsedSeconds);
        if (normalizedSeconds <= 0) {
            return 0;
        }
        return Math.round(normalizeNonNegativeNumber(totalScore) * 60 / normalizedSeconds);
    }

    // 根据“当前分钟产出”和“目标分钟产出”计算建议倍率。
    function scorePerMinuteMultiplier(currentScorePerMinute, targetScorePerMinute) {
        const current = normalizePositiveNumber(currentScorePerMinute, 1);
        const target = normalizePositiveNumber(targetScorePerMinute, DEFAULT_EXPECTED_SCORE_PER_MINUTE);
        return target / current;
    }

    // 已知一个旧常量和当前分钟产出，直接回推一个更接近目标的新常量。
    function tuneValueForExpectedScorePerMinute(baseValue, currentScorePerMinute, targetScorePerMinute) {
        const base = normalizeNonNegativeNumber(baseValue);
        const multiplier = scorePerMinuteMultiplier(currentScorePerMinute, targetScorePerMinute);
        return Math.max(0, Math.round(base * multiplier));
    }

    function scale2048ScoreDelta(scoreDelta) {
        return Math.round(normalizeNonNegativeNumber(scoreDelta) * SCORE_2048_TILE_POINT);
    }

    // 数独是“底薪 + 难度 + 时间奖励”的结构。
    // 想整体调高/调低时，优先改 SUDOKU_SCORE_MULTIPLIER。
    // 想单独调整某种模式时，改 SUDOKU_SCORE_TABLE 里的 base / difficultyBonus / targetSeconds / timeRate。
    function getSudokuScoreSpec(modeKey) {
        return SUDOKU_SCORE_TABLE[modeKey] || SUDOKU_SCORE_TABLE["classic-medium"];
    }

    function computeSudokuScore(modeKey, elapsedSeconds) {
        const spec = getSudokuScoreSpec(modeKey);
        const normalizedElapsedSeconds = normalizeNonNegativeNumber(elapsedSeconds);
        const timeBonus = Math.max(
            0,
            Math.round((spec.targetSeconds - normalizedElapsedSeconds) * spec.timeRate)
        ) * SUDOKU_SCORE_MULTIPLIER;
        return {
            baseSalary: spec.base * SUDOKU_SCORE_MULTIPLIER,
            difficultyBonus: spec.difficultyBonus * SUDOKU_SCORE_MULTIPLIER,
            timeBonus: timeBonus,
            total: spec.base * SUDOKU_SCORE_MULTIPLIER + spec.difficultyBonus * SUDOKU_SCORE_MULTIPLIER + timeBonus
        };
    }

    function computeFrontlineScore(session, summary) {
        const safeSession = session || {};
        const safeSummary = summary || {};
        // 前线是“大头奖励 + 场面奖励”的结构。
        // 想整体拉升时，优先改 victoryBonus、mapControlBonus、unitBonus、timeBonus 的系数。
        const difficultyMultiplier = safeSession.difficulty === "hard" ? 1.75 : (safeSession.difficulty === "easy" ? 1 : 1.35);
        const survivedUnits = normalizeNonNegativeNumber(safeSummary.player_units);
        const playerTowers = normalizeNonNegativeNumber(safeSummary.player_towers);
        const victoryBonus = safeSession.status === "victory" ? Math.round(60000 * difficultyMultiplier) : 0;
        const mapControlBonus = Math.round(playerTowers * 1400 * difficultyMultiplier);
        const unitBonus = Math.round(survivedUnits * 120 * difficultyMultiplier);
        const timeBonus = safeSession.status === "victory"
            ? Math.max(0, 7200 - normalizeNonNegativeNumber(safeSession.elapsedSeconds)) * Math.round(4 * difficultyMultiplier)
            : 0;
        return {
            victoryBonus: victoryBonus,
            mapControlBonus: mapControlBonus,
            unitBonus: unitBonus,
            timeBonus: timeBonus,
            total: Math.max(0, Math.round(victoryBonus + mapControlBonus + unitBonus + timeBonus))
        };
    }

    function applyTopdownBalance(balance) {
        if (!balance || typeof balance !== "object") {
            return balance;
        }
        balance.killScore = TOPDOWN_RULES.killScore;
        balance.settlementTimeScorePerSecond = TOPDOWN_RULES.settlementTimeScorePerSecond;
        balance.waveBonusScore = TOPDOWN_RULES.waveBonusScore;
        balance.bossBonusScore = TOPDOWN_RULES.bossBonusScore;
        balance.ttkMinSeconds = TOPDOWN_TTK_RULES.minSeconds;
        balance.ttkMaxSeconds = TOPDOWN_TTK_RULES.maxSeconds;
        balance.ttkGrowthEndWave = TOPDOWN_TTK_RULES.growthEndWave;
        balance.ttkDpsSoftCap = TOPDOWN_TTK_RULES.dpsSoftCap;
        balance.ttkDpsOverflowFactor = TOPDOWN_TTK_RULES.dpsOverflowFactor;
        balance.ttkEnemyHpMultiplierMin = TOPDOWN_TTK_RULES.enemyHpMultiplierMin;
        balance.ttkEnemyHpMultiplierMax = TOPDOWN_TTK_RULES.enemyHpMultiplierMax;
        return balance;
    }

    function awardTopdownScore(session, amount, multiplier) {
        const safeSession = session || {};
        const scoreMultiplier = Math.max(0, Number(multiplier == null ? 1 : multiplier));
        const finalAmount = Math.max(0, Math.round(Number(amount || 0) * scoreMultiplier));
        safeSession.score = normalizeNonNegativeNumber(safeSession.score) + finalAmount;
        return finalAmount;
    }

    function topdownTimeSettlementBonus(session, balance) {
        const activeBalance = balance || TOPDOWN_RULES;
        return Math.max(
            0,
            Math.floor(
                normalizeNonNegativeNumber(session && session.elapsedSeconds)
                * normalizeNonNegativeNumber(activeBalance.settlementTimeScorePerSecond)
            )
        );
    }

    function topdownKillBaseScore(session, balance) {
        void session;
        const activeBalance = balance || TOPDOWN_RULES;
        return normalizeNonNegativeNumber(activeBalance.killScore);
    }

    function topdownComboBonus(session, comboScoreStep) {
        return Math.floor(
            normalizeNonNegativeNumber(session && session.combo)
            / Math.max(1, Number(comboScoreStep || 10))
        );
    }

    function topdownTtkRules(balance) {
        const activeBalance = balance || {};
        return {
            minSeconds: normalizePositiveNumber(activeBalance.ttkMinSeconds, TOPDOWN_TTK_RULES.minSeconds),
            maxSeconds: normalizePositiveNumber(activeBalance.ttkMaxSeconds, TOPDOWN_TTK_RULES.maxSeconds),
            growthEndWave: normalizePositiveNumber(activeBalance.ttkGrowthEndWave, TOPDOWN_TTK_RULES.growthEndWave),
            dpsSoftCap: normalizePositiveNumber(activeBalance.ttkDpsSoftCap, TOPDOWN_TTK_RULES.dpsSoftCap),
            dpsOverflowFactor: clampNumber(activeBalance.ttkDpsOverflowFactor, 0, 1),
            enemyHpMultiplierMin: normalizePositiveNumber(activeBalance.ttkEnemyHpMultiplierMin, TOPDOWN_TTK_RULES.enemyHpMultiplierMin),
            enemyHpMultiplierMax: normalizePositiveNumber(activeBalance.ttkEnemyHpMultiplierMax, TOPDOWN_TTK_RULES.enemyHpMultiplierMax)
        };
    }

    function topdownTargetTtkSeconds(wave, balance) {
        const rules = topdownTtkRules(balance);
        const growthEndWave = Math.max(1, rules.growthEndWave);
        const waveProgress = clampNumber((Math.max(1, normalizeNonNegativeNumber(wave)) - 1) / Math.max(1, growthEndWave - 1), 0, 1);
        return rules.minSeconds + (rules.maxSeconds - rules.minSeconds) * waveProgress;
    }

    function topdownTtkScaledDps(effectiveDps, balance) {
        const rules = topdownTtkRules(balance);
        return applySoftCap(effectiveDps, rules.dpsSoftCap, rules.dpsOverflowFactor);
    }

    function topdownTtkEnemyHpMultiplier(baseHp, effectiveDps, wave, balance) {
        const hp = normalizeNonNegativeNumber(baseHp);
        if (hp <= 0.0001) {
            return 1;
        }
        const scaledDps = topdownTtkScaledDps(effectiveDps, balance);
        if (scaledDps <= 0.001) {
            return 1;
        }
        const rules = topdownTtkRules(balance);
        const currentTtk = hp / scaledDps;
        const desiredTtk = topdownTargetTtkSeconds(wave, balance);
        const multiplier = desiredTtk / Math.max(0.001, currentTtk);
        return clampNumber(multiplier, rules.enemyHpMultiplierMin, rules.enemyHpMultiplierMax);
    }

    function createInterface(deps) {
        const safeDeps = deps || {};
        return {
            submitGameScore: async function (gameId, score, mode, sessionKey, meta) {
                if (typeof safeDeps.requestJson !== "function" || !safeDeps.scoreUrl) {
                    throw new Error("GamesHubScore submitGameScore 缺少 requestJson 或 scoreUrl");
                }
                const payload = await safeDeps.requestJson(safeDeps.scoreUrl, {
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
                if (typeof safeDeps.afterSubmit === "function") {
                    await safeDeps.afterSubmit(payload);
                }
                return payload;
            },
            DEFAULT_EXPECTED_SCORE_PER_MINUTE: DEFAULT_EXPECTED_SCORE_PER_MINUTE,
            estimateScorePerMinute: estimateScorePerMinute,
            scorePerMinuteMultiplier: scorePerMinuteMultiplier,
            tuneValueForExpectedScorePerMinute: tuneValueForExpectedScorePerMinute,
            scale2048ScoreDelta: scale2048ScoreDelta,
            getSudokuScoreSpec: getSudokuScoreSpec,
            computeSudokuScore: computeSudokuScore,
            computeFrontlineScore: computeFrontlineScore,
            TOPDOWN_RULES: TOPDOWN_RULES,
            TOPDOWN_TTK_RULES: TOPDOWN_TTK_RULES,
            applyTopdownBalance: applyTopdownBalance,
            awardTopdownScore: awardTopdownScore,
            topdownTimeSettlementBonus: topdownTimeSettlementBonus,
            topdownKillBaseScore: topdownKillBaseScore,
            topdownComboBonus: topdownComboBonus,
            topdownTargetTtkSeconds: topdownTargetTtkSeconds,
            topdownTtkScaledDps: topdownTtkScaledDps,
            topdownTtkEnemyHpMultiplier: topdownTtkEnemyHpMultiplier
        };
    }

    window.GamesHubScore = Object.assign({}, window.GamesHubScore || {}, {
        createInterface: createInterface,
        DEFAULT_EXPECTED_SCORE_PER_MINUTE: DEFAULT_EXPECTED_SCORE_PER_MINUTE,
        estimateScorePerMinute: estimateScorePerMinute,
        scorePerMinuteMultiplier: scorePerMinuteMultiplier,
        tuneValueForExpectedScorePerMinute: tuneValueForExpectedScorePerMinute,
        scale2048ScoreDelta: scale2048ScoreDelta,
        getSudokuScoreSpec: getSudokuScoreSpec,
        computeSudokuScore: computeSudokuScore,
        computeFrontlineScore: computeFrontlineScore,
        TOPDOWN_RULES: TOPDOWN_RULES,
        TOPDOWN_TTK_RULES: TOPDOWN_TTK_RULES,
        applyTopdownBalance: applyTopdownBalance,
        awardTopdownScore: awardTopdownScore,
        topdownTimeSettlementBonus: topdownTimeSettlementBonus,
        topdownKillBaseScore: topdownKillBaseScore,
        topdownComboBonus: topdownComboBonus,
        topdownTargetTtkSeconds: topdownTargetTtkSeconds,
        topdownTtkScaledDps: topdownTtkScaledDps,
        topdownTtkEnemyHpMultiplier: topdownTtkEnemyHpMultiplier
    });
})();
