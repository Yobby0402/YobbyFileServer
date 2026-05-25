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

    const DEFAULT_EXPECTED_SCORE_PER_MINUTE = 100000;
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
        killScore: 2500,
        settlementTimeScorePerSecond: 1800,
        waveBonusScore: 4500,
        bossBonusScore: 30000
    });
    // Topdown 的目标 TTK 统一入口。
    // 程序会根据玩家当前有效 DPS，自动把新刷出的怪物血量推到这个区间附近。
    // 想整体调节怪物耐打程度时，优先只改这里。
    const TOPDOWN_TTK_RULES = Object.freeze({
        minSeconds: 1,
        maxSeconds: 4,
        growthEndWave: 18,
        dpsSoftCap: 1000,
        dpsOverflowFactor: 0.6,
        enemyHpMultiplierMin: 0.75,
        enemyHpMultiplierMax: 8
    });
    /*
    硬件达人策划总表

    1. 器件价格与作用
       - 电容: 纯爆发伤害。命中被减速/展宽过的波形时会吃到额外爆发补正。
       - 电阻: 低伤害，提供减速。slow 表示减速比例，slowDuration 表示持续秒数。
       - 电感: 中等伤害，提供展宽。spread 表示额外拉宽像素，hitBonus 会直接抬高命中判定厚度。

    2. 敌人血量上下限
       - 当前血量模型: 实际血量 = round(baseHp * (1 + min(1.2, (wave - 1) * 0.08))))
       - 因为血量成长封顶 1.2，所以理论上限固定为 baseHp * 2.2。
       - 例如:
         正弦波 220 -> 220 ~ 484
         方波   320 -> 320 ~ 704
         三角波 210 -> 210 ~ 462
         锯齿波 280 -> 280 ~ 616
         噪声包 300 -> 300 ~ 660
         脉冲波 360 -> 360 ~ 792
         阶梯波 420 -> 420 ~ 924
         突发包 520 -> 520 ~ 1144

    3. 得分与血量关系
       - 击杀得分当前直接等于回收入账积分。
       - 单次击杀公式:
         finalGain = round(enemy.reward * comboScale * waveBonus)
       - comboScale = 1 + min(1.6, combo * 0.09)
       - waveBonus = 1 + min(1.2, (wave - 1) * 0.04)
       - 当前不是“按血量直接换分”，而是“按波形类型 reward 给分，再受连击和波次加成影响”。
       - 如果后续想改成“血越厚分越高”，优先调整 waveLibrary 里的 reward，或把 reward 改为基于 hp 的派生值。
    */
    const HARDWARE_DAREN_RULES = Object.freeze({
        // 发射节奏控制。
        // defaultIndex: 默认使用 options 中的第几档。
        // reloadSeconds: 两次发射之间至少间隔多少秒，越小代表射速越快，也意味着单位时间烧分越快。
        // label: 只影响 HUD 上的档位显示文案。
        fireControl: {
            defaultIndex: 2,
            options: [
                { label: "SLOW", reloadSeconds: 0.28 },
                { label: "STEADY", reloadSeconds: 0.22 },
                { label: "FAST", reloadSeconds: 0.18 },
                { label: "RAPID", reloadSeconds: 0.14 },
                { label: "MAX", reloadSeconds: 0.11 }
            ]
        },
        // 器件表是玩家的“炮台弹种”配置。
        // 每个 specs 条目的公共字段含义：
        // cost: 每发扣掉多少局内积分，直接决定烧分速度。
        // damage: 命中时造成的基础伤害。
        // shotSpeed: 子弹飞行速度，只影响子弹飞过去有多快，不影响连发节奏。
        // radius: 命中判定半径，越大越容易擦中波形。
        // resistor 额外字段：
        // slow: 减慢波形形态变化的比例。
        // slowDuration: 减慢持续多久。
        // inductor 额外字段：
        // spread: 将波形拉宽多少像素。
        // hitBonus: 额外增加多少命中容错。
        // spreadDuration: 拉宽效果持续多久。
        componentFamilies: {
            capacitor: {
                key: "capacitor",
                label: "电容",
                color: "#f59e0b",
                role: "爆发",
                specs: [
                    { label: "22pF", cost: 7200, damage: 10, shotSpeed: 760, radius: 6.8 },
                    { label: "100pF", cost: 10800, damage: 16, shotSpeed: 752, radius: 7.0 },
                    { label: "1nF", cost: 16400, damage: 24, shotSpeed: 744, radius: 7.2 },
                    { label: "10nF", cost: 25200, damage: 36, shotSpeed: 736, radius: 7.6 },
                    { label: "100nF", cost: 37600, damage: 52, shotSpeed: 724, radius: 8.1 },
                    { label: "1uF", cost: 55200, damage: 76, shotSpeed: 716, radius: 8.6 },
                    { label: "10uF", cost: 39800, damage: 108, shotSpeed: 704, radius: 9.0 },
                    { label: "220uF", cost: 568000, damage: 190, shotSpeed: 690, radius: 12.0 },
                    {label: "470uF", cost: 820000, damage: 400, shotSpeed: 680, radius: 18.0 }
                ]
            },
            resistor: {
                key: "resistor",
                label: "电阻",
                color: "#38bdf8",
                role: "减速",
                specs: [
                    { label: "22Ω", cost: 8400, damage: 8, slow: 0.12, slowDuration: 1.2, shotSpeed: 728, radius: 6.8 },
                    { label: "100Ω", cost: 12400, damage: 11, slow: 0.18, slowDuration: 1.5, shotSpeed: 720, radius: 7.0 },
                    { label: "330Ω", cost: 18400, damage: 15, slow: 0.24, slowDuration: 1.8, shotSpeed: 714, radius: 7.2 },
                    { label: "1kΩ", cost: 27200, damage: 20, slow: 0.30, slowDuration: 2.1, shotSpeed: 706, radius: 7.4 },
                    { label: "4.7kΩ", cost: 38800, damage: 26, slow: 0.38, slowDuration: 2.5, shotSpeed: 700, radius: 7.8 },
                    { label: "10kΩ", cost: 53600, damage: 32, slow: 0.46, slowDuration: 2.9, shotSpeed: 694, radius: 8.2 },
                    { label: "100kΩ", cost: 35600, damage: 42, slow: 0.54, slowDuration: 3.3, shotSpeed: 688, radius: 8.6 }
                ]
            },
            inductor: {
                key: "inductor",
                label: "电感",
                color: "#fbbf24",
                role: "展宽",
                specs: [
                    { label: "1uH", cost: 8800, damage: 9, spread: 18, hitBonus: 3, spreadDuration: 2.0, shotSpeed: 724, radius: 6.8 },
                    { label: "4.7uH", cost: 13200, damage: 13, spread: 28, hitBonus: 5, spreadDuration: 2.4, shotSpeed: 716, radius: 7.0 },
                    { label: "10uH", cost: 19600, damage: 18, spread: 38, hitBonus: 7, spreadDuration: 2.8, shotSpeed: 710, radius: 7.2 },
                    { label: "47uH", cost: 29200, damage: 24, spread: 50, hitBonus: 9, spreadDuration: 3.2, shotSpeed: 702, radius: 7.6 },
                    { label: "100uH", cost: 42400, damage: 31, spread: 66, hitBonus: 11, spreadDuration: 3.6, shotSpeed: 696, radius: 8.0 },
                    { label: "220uH", cost: 60800, damage: 40, spread: 84, hitBonus: 14, spreadDuration: 4.0, shotSpeed: 690, radius: 8.4 },
                    { label: "1mH", cost: 85600, damage: 52, spread: 108, hitBonus: 18, spreadDuration: 4.6, shotSpeed: 684, radius: 8.9 }
                ]
            }
        },
        // 敌人表是“鱼种/波形种类”配置。
        // hp: 第一波的基础血量下限。
        // 实际血量 = round(hp * (1 + min(hpWaveStepCap, (wave - 1) * hpWaveStep)))。
        // 所以当前版本的理论血量上限 = round(hp * (1 + hpWaveStepCap))。
        // reward: 该波形被击杀时的基础回收积分，最终得分会再叠加连击和波次倍率。
        // amplitude / frequency / width: 主要决定波形外观、占屏宽度和命中手感。
        // speed: 当前版本仅作为策划参考保留，真正的水平推进速度统一由 spawnBalance.speedWaveStep / speedWaveCap 控制，
        // 这样同一条线上的所有波形都会保持同速，不会互相超车。
        waveLibrary: {
            sine: { key: "sine", label: "正弦波", color: "#34d399", hp: 220, amplitude: 30, frequency: 1.15, width: 122, speed: 124, reward: 420000 },
            square: { key: "square", label: "方波", color: "#f97316", hp: 320, amplitude: 38, frequency: 0.92, width: 132, speed: 98, reward: 620000 },
            triangle: { key: "triangle", label: "三角波", color: "#67e8f9", hp: 210, amplitude: 28, frequency: 1.42, width: 114, speed: 146, reward: 400000 },
            saw: { key: "saw", label: "锯齿波", color: "#f472b6", hp: 280, amplitude: 32, frequency: 1.34, width: 118, speed: 160, reward: 560000 },
            noise: { key: "noise", label: "噪声包", color: "#c084fc", hp: 300, amplitude: 24, frequency: 1.86, width: 108, speed: 170, reward: 610000 },
            pulse: { key: "pulse", label: "脉冲波", color: "#facc15", hp: 360, amplitude: 34, frequency: 1.06, width: 138, speed: 112, reward: 760000 },
            stair: { key: "stair", label: "阶梯波", color: "#22d3ee", hp: 420, amplitude: 36, frequency: 0.88, width: 146, speed: 104, reward: 920000 },
            burst: { key: "burst", label: "突发包", color: "#fb7185", hp: 520, amplitude: 42, frequency: 1.28, width: 158, speed: 118, reward: 1280000 }
        },
        // 波次成长控制。
        // hpWaveStep / hpWaveStepCap: 控制敌人血量随波次增长的斜率和封顶。
        // amplitudeWaveStep / widthWaveStep / frequencyWaveStep: 控制后期波形更高、更宽、更密。
        // speedWaveStep / speedWaveCap: 控制全场统一推进速度，数值越大整局节奏越紧。
        // rewardWaveStep: 后期波形基础回收积分的提升速度。
        // blockedRespawnDelay: 出生位被堵住时，多久后再尝试刷怪。
        // respawnIntervalMin / respawnIntervalBase / respawnIntervalWaveStep: 刷怪间隔，波次越高会越密。
        spawnBalance: {
            hpWaveStep: 0.08,
            hpWaveStepCap: 1.2,
            amplitudeWaveStep: 0.9,
            amplitudeWaveCap: 14,
            widthWaveStep: 1.4,
            widthWaveCap: 24,
            frequencyWaveStep: 0.025,
            frequencyWaveCap: 0.35,
            speedWaveStep: 2.4,
            speedWaveCap: 84,
            rewardWaveStep: 0.1,
            blockedRespawnDelay: 0.24,
            respawnIntervalMin: 0.42,
            respawnIntervalBase: 1.26,
            respawnIntervalWaveStep: 0.035
        },
        // 得分与回本公式。
        // 当前版本 score 与 credits 同步增长，击杀回收多少，得分就加多少。
        // 单次击杀公式：
        // finalGain = round(enemy.reward * comboScale * waveBonus)
        // comboScale = 1 + min(comboScaleCap, combo * comboScaleStep)
        // waveBonus = 1 + min(waveBonusCap, (wave - 1) * waveBonusStep)
        // targetScorePerMinuteCap:
        // 自动模式结算时允许兑现的最高净盈利速度，默认与全局系统一致为 100000 分/分钟。
        // manualNetProfitMultiplier:
        // 纯手动模式的正净收益倍率，默认 2 倍；只放大盈利，不放大本金返还。
        // normalRewardMultiplierMin / Max:
        // 普通怪的随机奖励倍率区间，当前是 1~3 倍。
        // bountySpawnChance:
        // 奖励怪出现概率。
        // bountyRewardMultiplierMin / Max:
        // 奖励怪奖励倍率区间，当前是 5~10 倍。
        // bountyHpMultiplierMin / Max:
        // 奖励怪生命倍率区间，当前是 2~3 倍。
        // capacitorStatusBonusSpreadFactor / capacitorStatusBonusSlowFlat:
        // 当目标先被电感拉宽、或先被电阻减慢后，再用电容补刀时给额外爆发伤害。
        scoring: {
            waveAdvanceEveryDefeats: 7,
            scoreEqualsCredits: true,
            targetScorePerMinuteCap: DEFAULT_EXPECTED_SCORE_PER_MINUTE,
            manualNetProfitMultiplier: 2,
            normalRewardMultiplierMin: 1,
            normalRewardMultiplierMax: 3,
            bountySpawnChance: 0.14,
            bountyRewardMultiplierMin: 5,
            bountyRewardMultiplierMax: 10,
            bountyHpMultiplierMin: 2,
            bountyHpMultiplierMax: 3,
            comboScaleStep: 0.09,
            comboScaleCap: 1.6,
            waveBonusStep: 0.04,
            waveBonusCap: 1.2,
            capacitorStatusBonusSpreadFactor: 0.04,
            capacitorStatusBonusSlowFlat: 8
        }
    });

    function getHardwareDarenRules() {
        return JSON.parse(JSON.stringify(HARDWARE_DAREN_RULES));
    }

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
            HARDWARE_DAREN_RULES: HARDWARE_DAREN_RULES,
            getHardwareDarenRules: getHardwareDarenRules,
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
        HARDWARE_DAREN_RULES: HARDWARE_DAREN_RULES,
        getHardwareDarenRules: getHardwareDarenRules,
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
