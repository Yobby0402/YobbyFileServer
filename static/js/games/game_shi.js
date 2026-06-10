// 《士》单机原型：当前版本把平衡数据集中写在同一文件顶部，便于后续直接调数值。
(function () {
    "use strict";

    const modules = window.GamesHubModules;
    if (!modules || typeof modules.register !== "function") {
        return;
    }

    const STYLE_ID = "game-shi-inline-style";

    /*
     * 《士》原型集中数据区
     * 说明：
     * 1. 所有战斗平衡先集中在这里，不拆分文件，方便快速调参。
     * 2. 中文注释优先描述“为什么这样配”，方便后期平衡时直接改数值。
     * 3. 逻辑层尽量只读取这里的配置，不把魔法数字散落到下面。
     */
    const SHI_DATA = {
        // 场景基础尺寸：当前版本固定为单线中轴，策略来自左右判断与双攻击模式切换
        scene: {
            width: 1180,
            height: 500,
            playerX: 590,
            laneY: [250],
            laneLeftX: 42,
            laneRightX: 1138,
            rewardPoolSize: 3
        },

        // 全局节奏数据：这里统一控制原型快慢
        timings: {
            tickMs: 16,
            stepShiftCooldownMs: 140,
            stepDistanceUnit: 64,
            enemyPressureApproachMs: 380,
            enemyPressureSettleMs: 240,
            enemyLaneFollowMs: 1350,
            blockStartupMs: 90,
            blockDurationMs: 260,
            blockRecoveryMs: 180,
            defaultPerfectWindowMs: 210,
            perfectLockDurationMs: 320,
            enemyMinAttackGapMs: 760,
            enemyMinAttackGapWaveReduceMs: 10,
            enemyMinAttackGapFloorMs: 460,
            attackPoseDurationMs: 130,
            hitFlashDurationMs: 420,
            meleeEffectDurationMs: 160,
            hitEffectDurationMs: 200,
            telegraphDurationMs: 220,
            enemyApproachDurationMs: 620,
            projectileChargeMs: 90,
            hitStopMs: 55,
            hurtFlashDurationMs: 120,
            edgeFlashDurationMs: 160,
            screenShakeDurationMs: 90,
            scoreSubmitDelayMs: 0,
            perfectOpeningMs: 820,
            modeComboWindowMs: 980
        },

        // 玩家初始面板
        player: {
            baseHp: 18,
            baseShield: 1
        },

        // 远程统一代价：远程不能变成“站中间无伤刷屏”。
        // 这里把攻速税、敌人血量补偿和敌人压迫补偿集中写死，方便后续只在这里调数值。
        balance: {
            rangedRisk: {
                cooldownScale: 1.18,
                enemyHpScale: 1.18,
                enemyAttackGapReduceMs: 60,
                minAttackCooldownMs: 150,
                extraCooldownByWeapon: {
                    crossbow: 18,
                    minigun: 24,
                    thunderbook: 28,
                    fireorb: 22
                }
            }
        },

        // 持续战斗配置：取消清波停顿后，改为双侧持续补怪和击杀随机掉落。
        continuous: {
            sideReserve: 3,
            initialSpawnPerSide: 2,
            spawnDelayMs: [900, 1500],
            dropChance: 0.2,
            difficultyIntervalSeconds: 35
        },

        // 武器数据：初版只做 3 把，先把攻击手感打出来
        weapons: {
            dagger: {
                key: "dagger",
                name: "匕首",
                kind: "melee",
                color: "#fb7185",
                damage: 2,
                cooldownMs: 250,
                range: 154,
                hits: 1,
                meleeWidth: 1,
                meleeShape: "stab",
                slashReach: 110,
                slashArc: 0.88,
                slashThickness: 14,
                effectDurationMs: 120,
                skillCooldownMs: 9000,
                skillLabel: "利刃风暴",
                skillDescription: "双侧爆发多段切割，适合近身清场。"
            },
            spear: {
                key: "spear",
                name: "长枪",
                kind: "melee",
                color: "#38bdf8",
                damage: 3,
                cooldownMs: 390,
                range: 220,
                hits: 3,
                meleeWidth: 3,
                meleeShape: "line",
                slashReach: 176,
                slashArc: 0.42,
                slashThickness: 18,
                effectDurationMs: 160,
                skillCooldownMs: 10800,
                skillLabel: "拒马阵",
                skillDescription: "长距离清扫并打断当前方向的整列敌人。",
                // 长枪三段：第一下远刺，第二下横扫，第三下上挑，先把手感差异做出来
                combo: [
                    { text: "戳", range: 208, damage: 3, hits: 3, shape: "line", reach: 188, thickness: 16, effectDurationMs: 120, poseDistance: 16, hitStopMs: 46 },
                    { text: "扫", range: 196, damage: 3, hits: 4, shape: "arc", reach: 162, arc: 0.52, thickness: 20, effectDurationMs: 145, poseDistance: 10, hitStopMs: 56 },
                    { text: "挑", range: 172, damage: 4, hits: 2, shape: "arc", reach: 148, arc: 0.3, thickness: 17, effectDurationMs: 135, poseDistance: 12, hitStopMs: 64 }
                ]
            },
            katana: {
                key: "katana",
                name: "武士刀",
                kind: "melee",
                color: "#f59e0b",
                damage: 4,
                cooldownMs: 460,
                range: 190,
                hits: 2,
                meleeWidth: 2,
                meleeShape: "arc",
                slashReach: 150,
                slashArc: 0.62,
                slashThickness: 20,
                effectDurationMs: 170,
                skillCooldownMs: 9800,
                skillLabel: "无尽断空",
                skillDescription: "朝指定方向打出更宽的剑弧，适合中距离斩杀。"
            },
            hammer: {
                key: "hammer",
                name: "重战锤",
                kind: "melee",
                color: "#c084fc",
                damage: 6,
                cooldownMs: 620,
                range: 172,
                hits: 2,
                meleeWidth: 2,
                meleeShape: "arc",
                slashReach: 138,
                slashArc: 0.72,
                slashThickness: 24,
                effectDurationMs: 180,
                skillCooldownMs: 11200,
                skillLabel: "破阵重踏",
                skillDescription: "重击当前方向并震开附近敌人，适合高爆发硬解近身压力。"
            },
            pistol: {
                key: "pistol",
                name: "手枪",
                kind: "ranged",
                color: "#facc15",
                damage: 2,
                cooldownMs: 320,
                range: 9999,
                hits: 1,
                projectileSpeed: 0.78,
                projectileRadius: 5,
                projectileTrail: "#fde68a",
                projectileGlow: "#facc15",
                skillCooldownMs: 8200,
                skillLabel: "莫桑比克",
                skillDescription: "左右两侧补枪，适合远程收割。"
            },
            shotgun: {
                key: "shotgun",
                name: "霰弹枪",
                kind: "ranged",
                color: "#fb923c",
                damage: 2,
                cooldownMs: 540,
                range: 9999,
                hits: 1,
                projectileSpeed: 0.66,
                projectileRadius: 6,
                projectileTrail: "#fdba74",
                projectileGlow: "#f97316",
                pelletCount: 4,
                skillCooldownMs: 9600,
                skillLabel: "清巷轰击",
                skillDescription: "单次喷发多枚重弹，近距离瞬间压血。"
            },
            crossbow: {
                key: "crossbow",
                name: "连弩",
                kind: "ranged",
                color: "#34d399",
                damage: 3,
                cooldownMs: 280,
                range: 9999,
                hits: 1,
                projectileSpeed: 0.72,
                projectileRadius: 4,
                projectileTrail: "#86efac",
                projectileGlow: "#10b981",
                burstCount: 2,
                skillCooldownMs: 8800,
                skillLabel: "雨落",
                skillDescription: "朝指定方向快速连射重弩，适合稳定压制远程敌人。"
            },
            sniper: {
                key: "sniper",
                name: "狙击枪",
                kind: "ranged",
                color: "#93c5fd",
                damage: 6,
                cooldownMs: 860,
                range: 9999,
                hits: 1,
                projectileSpeed: 1.08,
                projectileRadius: 4,
                projectileTrail: "#bfdbfe",
                projectileGlow: "#60a5fa",
                projectilePierce: 3,
                skillCooldownMs: 11800,
                skillLabel: "禁止接触",
                skillDescription: "高伤穿透狙击，适合远距离稳定点杀前排。"
            },
            boomerang: {
                key: "boomerang",
                name: "回旋镖",
                kind: "ranged",
                color: "#2dd4bf",
                damage: 2,
                cooldownMs: 440,
                range: 9999,
                hits: 1,
                projectileSpeed: 0.74,
                projectileRadius: 5,
                projectileTrail: "#99f6e4",
                projectileGlow: "#14b8a6",
                projectilePierce: 3,
                boomerangTravelMs: 320,
                skillCooldownMs: 9200,
                skillLabel: "双返",
                skillDescription: "飞出后回返再打一遍，适合清理同侧排队敌人。"
            },
            axe: {
                key: "axe",
                name: "战斧",
                kind: "melee",
                color: "#f87171",
                damage: 5,
                cooldownMs: 500,
                range: 184,
                hits: 3,
                meleeWidth: 3,
                meleeShape: "arc",
                slashReach: 156,
                slashArc: 0.78,
                slashThickness: 18,
                effectDurationMs: 160,
                skillCooldownMs: 9800,
                skillLabel: "裂甲旋斩",
                skillDescription: "宽幅横斩多目标，适合处理中距离排队敌人。"
            },
            lance: {
                key: "lance",
                name: "骑枪",
                kind: "melee",
                color: "#a78bfa",
                damage: 4,
                cooldownMs: 360,
                range: 236,
                hits: 2,
                meleeWidth: 2,
                meleeShape: "line",
                slashReach: 210,
                slashArc: 0.28,
                slashThickness: 14,
                effectDurationMs: 145,
                skillCooldownMs: 9400,
                skillLabel: "贯心突阵",
                skillDescription: "更极端的远刺武器，适合中距离点杀关键目标。"
            },
            chainblade: {
                key: "chainblade",
                name: "链刃",
                kind: "melee",
                color: "#818cf8",
                damage: 4,
                cooldownMs: 340,
                range: 206,
                hits: 2,
                meleeWidth: 2,
                meleeShape: "line",
                slashReach: 168,
                slashArc: 0.4,
                slashThickness: 15,
                effectDurationMs: 145,
                skillCooldownMs: 9800,
                skillLabel: "绞索圆舞",
                skillDescription: "中距离横扫并击落飞行物，适合打乱敌人的进攻顺序。"
            },
            dualblade: {
                key: "dualblade",
                name: "双刀",
                kind: "melee",
                color: "#22d3ee",
                damage: 3,
                cooldownMs: 230,
                range: 166,
                hits: 2,
                meleeWidth: 2,
                meleeShape: "arc",
                slashReach: 124,
                slashArc: 0.96,
                slashThickness: 14,
                effectDurationMs: 110,
                skillCooldownMs: 8600,
                skillLabel: "双月回环",
                skillDescription: "快节奏双刀连斩，适合贴身连续追击。"
            },
            cannon: {
                key: "cannon",
                name: "重炮",
                kind: "ranged",
                color: "#f43f5e",
                damage: 5,
                cooldownMs: 680,
                range: 9999,
                hits: 1,
                projectileSpeed: 0.84,
                projectileRadius: 7,
                projectileTrail: "#fda4af",
                projectileGlow: "#fb7185",
                splash: true,
                skillCooldownMs: 10400,
                skillLabel: "火力覆盖",
                skillDescription: "重炮慢射高伤，适合处理中排和残血单位。"
            },
            grenade: {
                key: "grenade",
                name: "榴弹炮",
                kind: "ranged",
                color: "#fb7185",
                damage: 4,
                cooldownMs: 700,
                range: 9999,
                hits: 1,
                projectileSpeed: 0.62,
                projectileRadius: 6,
                projectileTrail: "#fecaca",
                projectileGlow: "#ef4444",
                splash: true,
                splashRadius: 108,
                skillCooldownMs: 10600,
                skillLabel: "天罚",
                skillDescription: "单发榴弹命中后爆炸，适合范围清场与击杀滚雪球。"
            },
            minigun: {
                key: "minigun",
                name: "重机枪",
                kind: "ranged",
                color: "#cbd5e1",
                damage: 1,
                cooldownMs: 120,
                range: 9999,
                hits: 1,
                projectileSpeed: 0.92,
                projectileRadius: 3,
                projectileTrail: "#e2e8f0",
                projectileGlow: "#94a3b8",
                burstCount: 5,
                skillCooldownMs: 11600,
                skillLabel: "碉堡",
                skillDescription: "高射速压制火力，适合站桩推进与连续压血。"
            },
            thunderbook: {
                key: "thunderbook",
                name: "雷书",
                kind: "ranged",
                color: "#a78bfa",
                damage: 3,
                cooldownMs: 260,
                range: 9999,
                hits: 1,
                projectileSpeed: 0.84,
                projectileRadius: 5,
                projectileTrail: "#ddd6fe",
                projectileGlow: "#8b5cf6",
                chainCount: 3,
                skillCooldownMs: 10000,
                skillLabel: "雷暴",
                skillDescription: "连锁闪电武器，对反弹命中的敌人有更高收益。"
            },
            icewandweapon: {
                key: "icewandweapon",
                name: "冰杖",
                kind: "ranged",
                color: "#67e8f9",
                damage: 2,
                cooldownMs: 300,
                range: 9999,
                hits: 1,
                projectileSpeed: 0.82,
                projectileRadius: 5,
                projectileTrail: "#cffafe",
                projectileGlow: "#22d3ee",
                freezeMs: 500,
                skillCooldownMs: 9800,
                skillLabel: "极寒壁",
                skillDescription: "冰锥命中会减速，适合拖慢敌人的攻击节奏。"
            },
            fireorb: {
                key: "fireorb",
                name: "火印法球",
                kind: "ranged",
                color: "#f97316",
                damage: 3,
                cooldownMs: 290,
                range: 9999,
                hits: 1,
                projectileSpeed: 0.76,
                projectileRadius: 5,
                projectileTrail: "#fed7aa",
                projectileGlow: "#fb923c",
                splash: true,
                splashRadius: 84,
                skillCooldownMs: 10200,
                skillLabel: "灼城",
                skillDescription: "爆裂火球命中后爆炸，适合持续灼烧与范围收割。"
            },
            trinity: {
                key: "trinity",
                name: "三节棍",
                kind: "melee",
                color: "#eab308",
                damage: 4,
                cooldownMs: 310,
                range: 188,
                hits: 2,
                meleeWidth: 2,
                meleeShape: "arc",
                slashReach: 146,
                slashArc: 0.68,
                slashThickness: 17,
                effectDurationMs: 130,
                skillCooldownMs: 9200,
                skillLabel: "三相连断",
                skillDescription: "左右各打一段，再补一次正手追击，适合节奏均衡的压制流。"
            }
        },

        // 武器双模式：W 触发攻势模式，S 触发应势模式。
        // 这里先把所有武器的模式命名和作用描述集中写在一起，方便后续继续调手感。
        weaponModes: {
            dagger: {
                advance: { name: "贴身连刺", desc: "短前踏快刺，专门抢近身回合与补残血。" },
                response: { name: "反手抹切", desc: "原地反切，范围更宽，适合格挡后立刻接刀。" }
            },
            spear: {
                advance: { name: "贯线三连", desc: "保持长枪推进感，连续贯穿前排排队线。" },
                response: { name: "拦腰扫拦", desc: "舍弃纯突进，换成更稳的拦截横扫与打断。" }
            },
            katana: {
                advance: { name: "居合进斩", desc: "更深更窄的一刀，擅长抓后摇处决单体。" },
                response: { name: "返身圆斩", desc: "回身大圆斩，覆盖更宽，也更适合应对逼近压力。" }
            },
            hammer: {
                advance: { name: "坠锤", desc: "重压砸落，爆发更高，专门破重压敌和硬目标。" },
                response: { name: "撞柄推锤", desc: "出手更快，强推前排，重点是解围和重整节奏。" }
            },
            pistol: {
                advance: { name: "准星点射", desc: "单发精确快枪，适合收残血和点掉射手。" },
                response: { name: "双连压射", desc: "两发连续压制，伤害更分散，但更容易阻止逼近。" }
            },
            shotgun: {
                advance: { name: "收束独头喷", desc: "散布更紧，伤害更集中，适合中近距离斩杀。" },
                response: { name: "扇面轰退", desc: "扇面更宽，重在打退近身敌和守住自己脚边。" }
            },
            crossbow: {
                advance: { name: "重弩贯穿", desc: "单支重弩更适合点穿前排，打集中爆发。" },
                response: { name: "双弩压制", desc: "双支轻弩更适合控逼近、拖慢敌人节奏。" }
            },
            sniper: {
                advance: { name: "穿线狙击", desc: "高伤穿透直线点杀，专门处理后排关键目标。" },
                response: { name: "止步制退", desc: "降低爆发换更强制停效果，专门保自己脚下安全。" }
            },
            boomerang: {
                advance: { name: "远抛回斩", desc: "飞得更远，往返清整条线路，适合主动压线。" },
                response: { name: "近环护身", desc: "更早回返，优先处理身边压力和近身敌。" }
            },
            axe: {
                advance: { name: "裂甲劈", desc: "更深更狠的正手劈砍，专门压单侧前排。" },
                response: { name: "环身横扫", desc: "更宽的横扫，适合清理贴脸单位并稳住自己脚下。" }
            },
            lance: {
                advance: { name: "骑枪突阵", desc: "极端远刺，专门更快把远处敌人点穿。" },
                response: { name: "架枪截刺", desc: "缩短枪路换更快截刺，专门打断贴近的前排。" }
            },
            chainblade: {
                advance: { name: "甩钩拉拽", desc: "主动打乱敌阵，把最前方目标钩乱位置。" },
                response: { name: "横锁抽", desc: "更宽的横扫链抽，重点是控场和拆飞行物。" }
            },
            dualblade: {
                advance: { name: "交错追斩", desc: "双刀快速交错压入，适合追杀和持续贴身。" },
                response: { name: "双月反切", desc: "双向弧线更圆，更适合边挡边反打。" }
            },
            cannon: {
                advance: { name: "爆芯炮击", desc: "单发重炮追求正面穿爆，适合点掉关键敌。" },
                response: { name: "震退霰炮", desc: "爆散震退更强，适合顶住前排压力和近身乱流。" }
            },
            grenade: {
                advance: { name: "延时榴爆", desc: "更重的延时爆炸，适合处理扎堆队列。" },
                response: { name: "近距空炸", desc: "更快更近的空炸，专门清脚边和逼退贴身单位。" }
            },
            minigun: {
                advance: { name: "压枪连射", desc: "弹道更集中，专门朝一个方向稳定压血。" },
                response: { name: "抑制扇扫", desc: "扇形抑制更强，适合在混乱时逼退冲脸敌人。" }
            },
            thunderbook: {
                advance: { name: "贯序雷链", desc: "单侧更深的连锁雷，专门顺着一条线灌伤害。" },
                response: { name: "分叉雷弧", desc: "把雷弧拆散，优先控近身和补另一侧压力。" }
            },
            icewandweapon: {
                advance: { name: "穿刺冰锥", desc: "更快更直的冰锥，专门先手压远处敌人。" },
                response: { name: "霜环钉刺", desc: "更慢但冻结更重，适合守脚下和接完美格挡后反打。" }
            },
            fireorb: {
                advance: { name: "聚爆火球", desc: "单发更聚焦，爆炸更狠，适合压单侧线。" },
                response: { name: "裂焰双星", desc: "拆成双火球，适合一边拉扯一边铺开范围灼烧。" }
            },
            trinity: {
                advance: { name: "正架连断", desc: "正手连断更集中，专门压当前方向前排。" },
                response: { name: "回身双节", desc: "回身带一记反抽，适合同时照顾前后节奏。" }
            }
        },

        // 装备数据：先保留一批可直接感知手感的效果
        equipments: {
            bloodthirster: {
                key: "bloodthirster",
                name: "饮血剑",
                desc: "每次命中恢复 1 点生命值。",
                apply: function (d) { d.lifeOnHit += 1; }
            },
            heartsteel: {
                key: "heartsteel",
                name: "心之钢",
                desc: "每次击杀提高 1 点最大生命值。",
                apply: function (d) { d.heartsteel = true; }
            },
            guinsoo: {
                key: "guinsoo",
                name: "鬼索的狂暴之刃",
                desc: "连续攻击会叠攻速。",
                apply: function (d) { d.hasGuinsoo = true; }
            },
            runaans: {
                key: "runaans",
                name: "卢安娜的飓风",
                desc: "攻击时额外命中同方向另一名敌人。",
                apply: function (d) { d.extraTargets += 1; }
            },
            hurricane: {
                key: "hurricane",
                name: "飓风",
                desc: "卢安娜的飓风简化版，强调双向清线。",
                apply: function (d) { d.extraTargets += 1; }
            },
            collector: {
                key: "collector",
                name: "收集者",
                desc: "处决低于 25% 生命值的敌人。",
                apply: function (d) { d.executeThreshold = 0.25; }
            },
            shojin: {
                key: "shojin",
                name: "朔极之矛",
                desc: "攻击命中会减少技能冷却。",
                apply: function (d) { d.skillRefundOnHitMs += 320; }
            },
            edge: {
                key: "edge",
                name: "夜之锋刃",
                desc: "每波开始时获得一次护盾。",
                apply: function (d) { d.shieldPerWave += 1; }
            },
            randuin: {
                key: "randuin",
                name: "兰顿之兆",
                desc: "普通格挡减伤更高。",
                apply: function (d) { d.blockReduction = 0.8; }
            },
            infinity: {
                key: "infinity",
                name: "无尽之刃",
                desc: "攻击伤害额外 +2。",
                apply: function (d) { d.attackDamage += 2; }
            },
            rapidfire: {
                key: "rapidfire",
                name: "疾射火炮",
                desc: "远程武器攻击间隔更短。",
                apply: function (d) { d.attackCooldownMs = Math.max(140, Math.round(d.attackCooldownMs * 0.85)); }
            },
            sterak: {
                key: "sterak",
                name: "斯特拉克的挑战护手",
                desc: "生命越低，格挡期间越不容易被秒。",
                apply: function (d) { d.blockReduction = Math.max(d.blockReduction, 0.86); }
            },
            bloodhand: {
                key: "bloodhand",
                name: "血手",
                desc: "血量压力上来时更稳，属于血手的口语化版本。",
                apply: function (d) { d.blockReduction = Math.max(d.blockReduction, 0.86); }
            },
            bork: {
                key: "bork",
                name: "破败王者之刃",
                desc: "攻击间隔更短，适合连击武器。",
                apply: function (d) { d.attackCooldownMs = Math.max(120, Math.round(d.attackCooldownMs * 0.88)); }
            },
            titanic: {
                key: "titanic",
                name: "泰坦九头蛇",
                desc: "攻击额外命中 1 个目标，并略微提高普攻收益。",
                apply: function (d) {
                    d.extraTargets += 1;
                    d.attackDamage += 1;
                }
            },
            mortal: {
                key: "mortal",
                name: "凡性的提醒",
                desc: "攻击伤害 +1，适合持续压血。",
                apply: function (d) { d.attackDamage += 1; }
            },
            navori: {
                key: "navori",
                name: "纳沃利迅刃",
                desc: "命中后额外减少技能冷却。",
                apply: function (d) { d.skillRefundOnHitMs += 220; }
            },
            phantom: {
                key: "phantom",
                name: "幻影之舞",
                desc: "攻击间隔缩短，普通格挡也更稳。",
                apply: function (d) {
                    d.attackCooldownMs = Math.max(110, Math.round(d.attackCooldownMs * 0.9));
                    d.blockReduction = Math.max(d.blockReduction, 0.72);
                }
            },
            iceborn: {
                key: "iceborn",
                name: "冰拳",
                desc: "普通格挡减伤更高，适合防反流。",
                apply: function (d) { d.blockReduction = Math.max(d.blockReduction, 0.78); }
            },
            revitalize: {
                key: "revitalize",
                name: "振奋盔甲",
                desc: "提升治疗与护盾收益，适合续航构筑。",
                apply: function (d) {
                    d.healAmp = Math.max(d.healAmp, 1.4);
                    d.shieldAmp = Math.max(d.shieldAmp, 1.4);
                }
            },
            deathsdance: {
                key: "deathsdance",
                name: "死亡之舞",
                desc: "减轻正面压力，击杀后额外回复生命值。",
                apply: function (d) {
                    d.blockReduction = Math.max(d.blockReduction, 0.76);
                    d.killHeal += 2;
                }
            },
            lichbane: {
                key: "lichbane",
                name: "巫妖之祸",
                desc: "释放技能后，接下来的 3 次攻击附加额外伤害。",
                apply: function (d) {
                    d.skillEmpowerHits = Math.max(d.skillEmpowerHits, 3);
                    d.skillEmpowerDamage = Math.max(d.skillEmpowerDamage, 2);
                }
            },
            statikk: {
                key: "statikk",
                name: "斯塔缇克电刃",
                desc: "提高攻击频率，并周期性触发连锁电击。",
                apply: function (d) {
                    d.attackCooldownMs = Math.max(110, Math.round(d.attackCooldownMs * 0.92));
                    d.chainEvery = Math.max(d.chainEvery, 4);
                    d.chainDamage = Math.max(d.chainDamage, 2);
                    d.chainRange = Math.max(d.chainRange, 190);
                }
            },
            sunfire: {
                key: "sunfire",
                name: "日炎圣盾",
                desc: "对附近敌人周期性造成灼烧伤害。",
                apply: function (d) {
                    d.auraDamage = Math.max(d.auraDamage, 1);
                    d.auraTickMs = Math.max(d.auraTickMs, 850);
                }
            },
            opportunist: {
                key: "opportunist",
                name: "投机者之刃",
                desc: "击杀敌人时额外获得更多积分。",
                apply: function (d) { d.bonusScoreOnKill += 10; }
            },
            thornmail: {
                key: "thornmail",
                name: "荆棘之甲",
                desc: "普通格挡成功后反伤攻击者。",
                apply: function (d) {
                    d.thornsDamage = Math.max(d.thornsDamage, 2);
                    d.blockReduction = Math.max(d.blockReduction, 0.72);
                }
            },
            banshee: {
                key: "banshee",
                name: "女妖面纱",
                desc: "长时间未受击时自动获得一次护盾。",
                apply: function (d) {
                    d.periodicShieldMs = Math.max(d.periodicShieldMs, 9000);
                    d.periodicShieldAmount = Math.max(d.periodicShieldAmount, 1);
                }
            },
            adaptivehelm: {
                key: "adaptivehelm",
                name: "适应性头盔",
                desc: "降低远程伤害，适合应对飞行物压力。",
                apply: function (d) { d.remoteDamageReduction = Math.max(d.remoteDamageReduction, 0.35); }
            },
            frozenheart: {
                key: "frozenheart",
                name: "冰霜之心",
                desc: "格挡成功后，明显拉长敌人的下次出手间隔。",
                apply: function (d) {
                    d.blockEnemySlowMs = Math.max(d.blockEnemySlowMs, 900);
                    d.remoteDamageReduction = Math.max(d.remoteDamageReduction, 0.2);
                }
            },
            maw: {
                key: "maw",
                name: "海克斯饮魔刀",
                desc: "获得额外护盾与更稳的生存能力。",
                apply: function (d) {
                    d.shieldPerWave += 1;
                    d.blockReduction = Math.max(d.blockReduction, 0.78);
                    d.attackDamage += 1;
                }
            },
            nashors: {
                key: "nashors",
                name: "纳什之牙",
                desc: "提高攻击速度，并让普攻附带额外魔法伤害。",
                apply: function (d) {
                    d.attackCooldownMs = Math.max(105, Math.round(d.attackCooldownMs * 0.86));
                    d.magicOnHitDamage += 1;
                }
            },
            kraken: {
                key: "kraken",
                name: "海妖杀手",
                desc: "连续命中时，每第 3 次打出一次更高爆发。",
                apply: function (d) {
                    d.krakenEvery = Math.max(d.krakenEvery, 3);
                    d.krakenDamage = Math.max(d.krakenDamage, 3);
                }
            },
            ludens: {
                key: "ludens",
                name: "卢登的回声",
                desc: "技能更疼，并周期性带出弹射爆发。",
                apply: function (d) {
                    d.skillDamageBonus += 1;
                    d.chainEvery = Math.max(d.chainEvery, 4);
                    d.chainDamage = Math.max(d.chainDamage, 1);
                    d.chainRange = Math.max(d.chainRange, 160);
                }
            },
            tiamat: {
                key: "tiamat",
                name: "提亚马特",
                desc: "近战攻击更容易带到周围目标。",
                apply: function (d) {
                    d.extraTargets += 1;
                    d.attackDamage += 1;
                }
            },
            hydra: {
                key: "hydra",
                name: "九头蛇",
                desc: "进一步放大清线能力与续战能力。",
                apply: function (d) {
                    d.extraTargets += 2;
                    d.attackDamage += 1;
                    d.lifeOnHit += 1;
                }
            },
            abyssal: {
                key: "abyssal",
                name: "深渊面具",
                desc: "强化技能与法术型输出。",
                apply: function (d) {
                    d.skillDamageBonus += 2;
                    d.remoteDamageReduction = Math.max(d.remoteDamageReduction, 0.15);
                }
            },
            ludenscompanion: {
                key: "ludenscompanion",
                name: "卢登的激荡",
                desc: "更强的技能爆发与更频繁的弹射补伤。",
                apply: function (d) {
                    d.skillDamageBonus += 2;
                    d.chainEvery = Math.max(d.chainEvery, 3);
                    d.chainDamage = Math.max(d.chainDamage, 2);
                    d.chainRange = Math.max(d.chainRange, 200);
                }
            },
            zhonyas: {
                key: "zhonyas",
                name: "中娅沙漏",
                desc: "致命伤害来临时触发一次短暂无敌。",
                apply: function (d) { d.stasisOnce = true; }
            },
            demonic: {
                key: "demonic",
                name: "恶魔之拥",
                desc: "持续强化技能伤害，并附带少量灼烧压力。",
                apply: function (d) {
                    d.skillDamageBonus += 1;
                    d.auraDamage = Math.max(d.auraDamage, 1);
                    d.auraTickMs = Math.max(d.auraTickMs, 1000);
                }
            },
            archangel: {
                key: "archangel",
                name: "大天使之杖",
                desc: "强化技能循环，并提供额外护盾。",
                apply: function (d) {
                    d.skillRefundOnHitMs += 180;
                    d.shieldPerWave += 1;
                }
            },
            warmog: {
                key: "warmog",
                name: "狂徒铠甲",
                desc: "长时间不受击时补一层护盾，偏向拖线与稳血。",
                apply: function (d) {
                    d.periodicShieldMs = Math.max(d.periodicShieldMs, 6200);
                    d.periodicShieldAmount = Math.max(d.periodicShieldAmount, 1);
                    d.shieldAmp = Math.max(d.shieldAmp, 1.2);
                }
            },
            guardianangel: {
                key: "guardianangel",
                name: "守护天使（复活甲）",
                desc: "受到致命伤害时复活一次，也就是常说的复活甲。",
                apply: function (d) { d.reviveOnce = true; }
            },
            mejais: {
                key: "mejais",
                name: "梅贾的窃魂卷（杀人书）",
                desc: "每次击杀叠 1 层攻击力，受击时失去当前一半层数。",
                apply: function (d) { d.hasMejais = true; }
            },
            deathcap: {
                key: "deathcap",
                name: "灭世者的死亡之帽",
                desc: "大幅强化技能爆发，并补一点法球伤害。",
                apply: function (d) {
                    d.skillDamageBonus += 3;
                    d.magicOnHitDamage += 1;
                }
            },
            trinityforce: {
                key: "trinityforce",
                name: "三相之力",
                desc: "均衡强化攻击、攻速与技能衔接，适合大多数武器。",
                apply: function (d) {
                    d.attackDamage += 1;
                    d.attackCooldownMs = Math.max(112, Math.round(d.attackCooldownMs * 0.92));
                    d.skillRefundOnHitMs += 120;
                }
            },
            rylais: {
                key: "rylais",
                name: "瑞莱的冰晶节杖",
                desc: "命中后拖慢敌人节奏，便于控场。",
                apply: function (d) {
                    d.onHitSlowMs = Math.max(d.onHitSlowMs, 500);
                    d.skillDamageBonus += 1;
                }
            },
            icewand: {
                key: "icewand",
                name: "瑞莱的冰晶节杖",
                desc: "瑞莱的冰晶节杖，提供减速控场。",
                apply: function (d) {
                    d.onHitSlowMs = Math.max(d.onHitSlowMs, 500);
                    d.skillDamageBonus += 1;
                }
            },
            morello: {
                key: "morello",
                name: "鬼书",
                desc: "单纯强化技能伤害，适合技能流。",
                apply: function (d) { d.skillDamageBonus += 2; }
            },
            chempunk: {
                key: "chempunk",
                name: "炼金科技腐蚀链锯剑",
                desc: "稳定补充普攻伤害与持续压制能力。",
                apply: function (d) {
                    d.attackDamage += 1;
                    d.magicOnHitDamage += 1;
                }
            },
            serylda: {
                key: "serylda",
                name: "赛瑞尔达的怨恨",
                desc: "强化远程伤害，并显著拖慢被命中的敌人。",
                apply: function (d) {
                    d.projectileDamageBonus += 2;
                    d.onHitSlowMs = Math.max(d.onHitSlowMs, 700);
                }
            }
        },

        // 基础强化：只做最容易验证效果的几项
        statRewards: {
            power: {
                key: "power",
                name: "锋刃淬火",
                desc: "攻击力 +1。",
                apply: function (session) { session.bonusDamage += 1; }
            },
            vigor: {
                key: "vigor",
                name: "血脉抬升",
                desc: "最大生命值 +2，并回复 2 点。",
                apply: function (session) {
                    session.maxHp += 2;
                    session.hp = Math.min(session.maxHp, session.hp + 2);
                }
            },
            guard: {
                key: "guard",
                name: "格挡整备",
                desc: "完美格挡窗口 +30ms。",
                apply: function (session) { session.perfectWindowMs += 30; }
            },
            focus: {
                key: "focus",
                name: "战意灌注",
                desc: "技能冷却缩短 10%。",
                apply: function (session) { session.skillCooldownFactor *= 0.9; }
            }
        },

        // 敌人模板：当前开始细分为快刺、重压、假动作与射击，先把读招差异做出来
        enemies: {
            melee: {
                type: "melee",
                attackRole: "melee",
                attackStyle: "normal",
                badge: "斩",
                color: "#94a3b8",
                telegraphColor: "#f87171",
                hpBase: 3,
                hpPerWave: 1,
                readyDelayMs: [1500, 2200],
                approachMs: 620,
                telegraphMs: 220,
                recoverMs: 500,
                attackDamage: 2,
                visualDistance: 320,
                pressureDistance: 196,
                readyDistance: 132,
                strikeDistance: 118
            },
            quickstab: {
                type: "quickstab",
                attackRole: "melee",
                attackStyle: "stab",
                badge: "刺",
                color: "#cbd5e1",
                telegraphColor: "#fb7185",
                hpBase: 2,
                hpPerWave: 1,
                readyDelayMs: [1200, 1900],
                approachMs: 520,
                telegraphMs: 170,
                recoverMs: 360,
                attackDamage: 1,
                visualDistance: 314,
                pressureDistance: 184,
                readyDistance: 126,
                strikeDistance: 112
            },
            heavy: {
                type: "heavy",
                attackRole: "melee",
                attackStyle: "heavy",
                badge: "重",
                color: "#f59e0b",
                telegraphColor: "#f59e0b",
                hpBase: 5,
                hpPerWave: 2,
                readyDelayMs: [1900, 2600],
                approachMs: 760,
                telegraphMs: 320,
                recoverMs: 680,
                attackDamage: 4,
                blockChipDamage: 2,
                visualDistance: 336,
                pressureDistance: 208,
                readyDistance: 144,
                strikeDistance: 126
            },
            feint: {
                type: "feint",
                attackRole: "melee",
                attackStyle: "feint",
                badge: "诈",
                color: "#a78bfa",
                telegraphColor: "#a78bfa",
                hpBase: 3,
                hpPerWave: 1,
                readyDelayMs: [1600, 2300],
                approachMs: 600,
                telegraphMs: 210,
                feintGapMs: 110,
                recoverMs: 460,
                attackDamage: 2,
                visualDistance: 326,
                pressureDistance: 192,
                readyDistance: 132,
                strikeDistance: 116
            },
            ranged: {
                type: "ranged",
                attackRole: "ranged",
                attackStyle: "shot",
                badge: "射",
                color: "#fbbf24",
                telegraphColor: "#fde68a",
                hpBase: 2,
                hpPerWave: 1,
                readyDelayMs: [1700, 2400],
                approachMs: 620,
                telegraphMs: 220,
                recoverMs: 420,
                attackDamage: 1,
                visualDistance: 360,
                pressureDistance: 248,
                readyDistance: 136,
                strikeDistance: 128,
                projectileSpeed: 0.56,
                projectileRadius: 5,
                burstCount: 1,
                burstIntervalMs: 90,
                projectileColor: "#fde68a",
                projectileGlow: "#f59e0b"
            }
        },

        // 视觉常量：统一放这里，后续改风格时只用看这一块
        visuals: {
            playerBodyRadius: 22,
            playerIconRadius: 10,
            blockArcRadius: 34,
            bulletTrailAlpha: 0.45,
            hitRingMaxRadius: 22,
            telegraphPulseRadius: 28,
            edgeWarningWidth: 26,
            backgroundTop: "#07111d",
            backgroundMid: "#0f1a2c",
            laneActive: "rgba(56,189,248,.56)",
            laneIdle: "rgba(71,85,105,.52)"
        }
    };

    function ensureShiStyles() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = [
            ".game-shi-shell{position:relative;width:100%;height:100%;}",
            ".game-shi-shell .game-arcade-guide,.game-shi-shell .game-arcade-accent,.game-shi-shell .game-arcade-controls-card{display:none !important;}",
            ".game-shi-shell .game-arcade-toolbar{padding-bottom:0;}",
            ".game-shi-shell .game-arcade-stage{grid-template-columns:minmax(0,1fr) 332px;align-items:start;gap:14px;}",
            ".game-shi-shell .game-arcade-canvas-wrap{padding:14px 12px 14px 16px;min-width:0;}",
            ".game-shi-shell .game-arcade-canvas{aspect-ratio:1180 / 500;}",
            ".game-shi-shell .game-arcade-sidecard{order:0;max-height:none;overflow:hidden;padding:14px 14px 12px;display:grid;grid-template-rows:auto minmax(0,1fr);gap:10px;align-self:stretch;}",
            ".game-shi-shell .game-arcade-sidecard > .games-section-title{margin-bottom:0;}",
            ".game-shi-shell .game-arcade-canvas{border-radius:24px;background:linear-gradient(180deg,#08111f 0%,#0f1a2c 55%,#08111f 100%);box-shadow:0 30px 80px rgba(2,6,23,.42);}",
            ".game-shi-overlay{position:absolute;inset:22px;display:flex;align-items:center;justify-content:center;pointer-events:none;}",
            ".game-shi-panel{pointer-events:auto;max-width:700px;width:min(100%,700px);padding:22px 24px;border-radius:24px;background:rgba(8,15,27,.9);border:1px solid rgba(148,163,184,.22);backdrop-filter:blur(14px);box-shadow:0 20px 70px rgba(0,0,0,.4);}",
            ".game-shi-panel h3{margin:0 0 8px;font-size:22px;color:#f8fafc;}",
            ".game-shi-panel p{margin:0 0 16px;color:#cbd5e1;line-height:1.6;}",
            ".game-shi-reward-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;}",
            ".game-shi-reward-btn{width:100%;text-align:left;border:1px solid rgba(125,211,252,.2);background:linear-gradient(180deg,rgba(15,23,42,.96),rgba(15,23,42,.78));color:#e2e8f0;border-radius:18px;padding:16px;cursor:pointer;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease;}",
            ".game-shi-reward-btn:hover{transform:translateY(-2px);border-color:rgba(125,211,252,.55);box-shadow:0 16px 40px rgba(14,165,233,.15);}",
            ".game-shi-reward-btn strong{display:block;font-size:16px;margin-bottom:6px;color:#f8fafc;}",
            ".game-shi-mini{font-size:12px;color:#94a3b8;text-transform:uppercase;letter-spacing:.12em;}",
            ".game-shi-reward-btn.weapon{border-color:rgba(251,146,60,.34);background:linear-gradient(180deg,rgba(67,24,6,.96),rgba(41,17,8,.82));}",
            ".game-shi-reward-btn.weapon:hover{border-color:rgba(251,146,60,.72);box-shadow:0 16px 40px rgba(249,115,22,.18);}",
            ".game-shi-reward-btn.weapon .game-shi-mini{color:#fdba74;}",
            ".game-shi-reward-btn.equipment{border-color:rgba(56,189,248,.34);background:linear-gradient(180deg,rgba(8,47,73,.96),rgba(12,30,50,.82));}",
            ".game-shi-reward-btn.equipment:hover{border-color:rgba(56,189,248,.72);box-shadow:0 16px 40px rgba(14,165,233,.18);}",
            ".game-shi-reward-btn.equipment .game-shi-mini{color:#7dd3fc;}",
            ".game-shi-reward-btn.stat{border-color:rgba(74,222,128,.34);background:linear-gradient(180deg,rgba(20,83,45,.96),rgba(20,45,29,.82));}",
            ".game-shi-reward-btn.stat:hover{border-color:rgba(74,222,128,.72);box-shadow:0 16px 40px rgba(34,197,94,.18);}",
            ".game-shi-reward-btn.stat .game-shi-mini{color:#86efac;}",
            ".game-shi-keyline{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}",
            ".game-shi-keychip{padding:6px 10px;border-radius:999px;background:rgba(30,41,59,.88);color:#bfdbfe;font-size:12px;}",
            ".game-shi-convert-btn{margin-top:14px;border:1px dashed rgba(248,250,252,.22);background:rgba(15,23,42,.72);color:#e2e8f0;border-radius:16px;padding:14px 16px;cursor:pointer;}",
            ".game-shi-convert-btn:hover{border-color:rgba(250,204,21,.55);background:rgba(51,65,85,.8);}",
            ".game-shi-tag{display:inline-flex;align-items:center;padding:4px 8px;border-radius:999px;background:rgba(59,130,246,.16);color:#bfdbfe;font-size:12px;margin-right:6px;margin-bottom:6px;}",
            ".game-shi-rail-shell{padding:0 !important;background:transparent !important;border:0 !important;box-shadow:none !important;}",
            ".game-shi-rail{display:grid;gap:12px;max-height:calc(100vh - 240px);overflow:auto;padding-right:4px;min-width:0;}",
            ".game-shi-rail-section{display:grid;gap:10px;padding:12px;border-radius:16px;background:rgba(15,23,42,.74);border:1px solid rgba(125,211,252,.14);min-width:0;}",
            ".game-shi-rail-title{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#94a3b8;}",
            ".game-shi-player-grid,.game-shi-weapon-grid{display:grid;grid-template-columns:1fr;gap:8px;}",
            ".game-shi-kv{padding:8px 10px;border-radius:12px;background:rgba(30,41,59,.78);border:1px solid rgba(148,163,184,.16);}",
            ".game-shi-kv-label{display:block;color:#94a3b8;font-size:11px;margin-bottom:4px;}",
            ".game-shi-kv-value{display:block;color:#f8fafc;font-size:13px;line-height:1.35;word-break:break-word;overflow-wrap:anywhere;}",
            ".game-shi-equipment-list{display:grid;grid-template-columns:1fr;gap:8px;}",
            ".game-shi-equipment-item{padding:8px 10px;border-radius:12px;background:rgba(30,41,59,.78);border:1px solid rgba(125,211,252,.18);color:#e2e8f0;font-size:13px;line-height:1.35;}",
            ".game-shi-equipment-empty{color:#94a3b8;}",
            ".game-shi-mode-card{padding:10px 12px;border-radius:14px;background:rgba(2,6,23,.36);border:1px solid rgba(148,163,184,.14);}",
            ".game-shi-mode-card.active{border-color:rgba(250,204,21,.34);background:linear-gradient(180deg,rgba(59,33,7,.58),rgba(17,24,39,.72));}",
            ".game-shi-mode-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;color:#f8fafc;font-size:14px;}",
            ".game-shi-mode-trigger{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:rgba(59,130,246,.16);color:#bfdbfe;font-size:11px;}",
            ".game-shi-mode-desc{color:#cbd5e1;font-size:12px;line-height:1.55;}",
            ".game-shi-replace-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:14px;}",
            ".game-shi-replace-btn{width:100%;text-align:left;border:1px solid rgba(251,191,36,.28);background:linear-gradient(180deg,rgba(39,26,5,.96),rgba(30,20,8,.82));color:#f8fafc;border-radius:14px;padding:12px 14px;cursor:pointer;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease;}",
            ".game-shi-replace-btn:hover{transform:translateY(-2px);border-color:rgba(250,204,21,.72);box-shadow:0 14px 34px rgba(234,179,8,.18);}",
            ".game-shi-replace-btn span{display:block;color:#fcd34d;font-size:12px;margin-top:4px;}",
            ".game-shi-dead{color:#fda4af;}",
            ".game-shi-win{color:#86efac;}",
            "@media (max-width: 1180px){.game-shi-shell .game-arcade-stage{grid-template-columns:1fr;}.game-shi-shell .game-arcade-canvas-wrap{padding-right:16px;}.game-shi-rail{max-height:none;overflow:visible;}.game-shi-player-grid,.game-shi-weapon-grid,.game-shi-replace-list{grid-template-columns:1fr;}}"
        ].join("");
        document.head.appendChild(style);
    }

    function randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function pickRandom(items) {
        return items[Math.floor(Math.random() * items.length)];
    }

    function normalizedModeLevel(level) {
        return Number(level || 0) >= 1 ? 1 : 0;
    }

    function stepProfileByLevel(level) {
        if (normalizedModeLevel(level) >= 1) {
            return {
                level: 1,
                label: "攻势模式",
                shortLabel: "攻势",
                meleeRangeBonus: 0,
                perfectWindowDeltaMs: 0,
                perfectCounterDamageBonus: 0,
                perfectSkillRefundMs: 0,
                blockRecoveryMs: SHI_DATA.timings.blockRecoveryMs,
                enemyGapBonusMs: 0,
                remoteReductionBonus: 0,
                hint: "W 攻势：切到更主动的攻击方式。不同武器会用更集中、更偏进攻的出手。"
            };
        }
        return {
            level: 0,
            label: "应势模式",
            shortLabel: "应势",
            meleeRangeBonus: 0,
            perfectWindowDeltaMs: 0,
            perfectCounterDamageBonus: 0,
            perfectSkillRefundMs: 0,
            blockRecoveryMs: SHI_DATA.timings.blockRecoveryMs,
            enemyGapBonusMs: 0,
            remoteReductionBonus: 0,
            hint: "S 应势：切到更稳的攻击方式。不同武器会用更宽或更偏防反的出手。"
        };
    }

    function stepLabel(level) {
        return stepProfileByLevel(level).label;
    }

    function stepHint(session) {
        return stepProfileByLevel(session && session.stepLevel ? session.stepLevel : 0).hint;
    }

    function currentWeaponModeKey(session) {
        return normalizedModeLevel(session && session.stepLevel ? session.stepLevel : 0) >= 1 ? "advance" : "response";
    }

    function currentWeaponMode(session, weapon) {
        const current = weapon || currentWeapon(session);
        const modes = SHI_DATA.weaponModes[current.key] || {};
        return modes[currentWeaponModeKey(session)] || {
            name: current.name,
            desc: current.skillDescription || ""
        };
    }

    function alternateWeaponMode(session, weapon) {
        const current = weapon || currentWeapon(session);
        const modes = SHI_DATA.weaponModes[current.key] || {};
        const currentKey = currentWeaponModeKey(session);
        const otherKey = currentKey === "advance" ? "response" : "advance";
        return modes[otherKey] || currentWeaponMode(session, current);
    }

    function currentWeaponModeTrigger(session) {
        return currentWeaponModeKey(session) === "advance" ? "W 攻势" : "S 应势";
    }

    function playerDistanceBias(session, scale) {
        return 0;
    }

    function effectivePerfectWindowForLevel(session, level) {
        return Math.max(90, session.perfectWindowMs);
    }

    function effectivePerfectWindowMs(session) {
        return effectivePerfectWindowForLevel(session, session && session.stepLevel ? session.stepLevel : 0);
    }

    function effectiveMeleeRange(session, weapon, baseRange) {
        const rawRange = Math.max(0, Number(baseRange != null ? baseRange : (weapon && weapon.range ? weapon.range : 0)));
        if (!weapon || weapon.kind !== "melee") {
            return rawRange;
        }
        return Math.max(96, rawRange);
    }

    function ctxEscape(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function currentWeapon(session) {
        return SHI_DATA.weapons[session.currentWeaponKey] || SHI_DATA.weapons.dagger;
    }

    // 会话数据也尽量写全字段，后期改平衡时能清楚看到有哪些状态在流动
    function createShiSession() {
        const session = {
            sessionKey: "shi-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            status: "playing",
            startedAt: Date.now(),
            elapsedSeconds: 0,
            submittedScore: false,
            paused: false,

            // 玩家基础状态
            lane: 0,
            stepLevel: 0,
            hp: SHI_DATA.player.baseHp,
            maxHp: SHI_DATA.player.baseHp,
            shield: SHI_DATA.player.baseShield,
            // wave 现在只作为内部压强档位保留，前台不再显示“第几波”。
            wave: 1,
            score: 0,
            kills: 0,

            // 构筑状态
            currentWeaponKey: "dagger",
            weaponKeys: ["dagger"],
            equipmentKeys: [],
            bonusDamage: 0,
            perfectWindowMs: SHI_DATA.timings.defaultPerfectWindowMs,
            skillCooldownFactor: 1,

            // 操作冷却
            attackReadyAt: 0,
            stepReadyAt: 0,
            laneSwitchReadyAt: 0,
            skillReadyAt: 0,
            blockReadyAt: 0,
            block: { side: 0, startAt: 0, activeAt: 0, until: 0, perfectUntil: 0 },
            perfectLockSide: 0,
            perfectLockUntil: 0,
            perfectGuardUntil: 0,
            playerState: "待战",
            skillEmpowerHitsLeft: 0,
            attackProcCounter: 0,
            lastDamageAt: Date.now(),
            lastAuraTickAt: 0,
            bunkerUntil: 0,
            guardianUsed: false,
            zhonyaUsed: false,
            lastAttackSide: 0,
            mejaisStacks: 0,

            // 装备临时层数
            guinsooStacks: 0,
            guinsooUntil: 0,
            spearComboIndex: 0,
            spearComboUntil: 0,
            modeComboKey: "",
            modeComboStep: 0,
            modeComboStreak: 0,
            modeComboUntil: 0,

            // 视觉与提示
            flashText: "",
            flashUntil: 0,
            message: "战斗开始：W 切攻势模式，S 切应势模式，按左右方向进攻并准备格挡。",
            pendingRewardOptions: [],
            pendingRewardScore: 0,
            pendingReplaceEquipmentKey: "",
            attackPose: { side: 0, startAt: 0, until: 0, weaponKey: "dagger", distance: 10 },
            attackHitStopMs: SHI_DATA.timings.hitStopMs,
            incomingFlashUntil: 0,
            hurtFlashUntil: 0,
            screenShakeUntil: 0,
            screenShakePower: 0,
            hitStopUntil: 0,
            enemyAttackReadyAt: 0,
            leftSpawnReadyAt: 0,
            rightSpawnReadyAt: 0,

            // 实体系统
            nextEnemyId: 1,
            nextProjectileId: 1,
            nextEffectId: 1,
            enemies: [],
            playerProjectiles: [],
            enemyProjectiles: [],
            meleeEffects: [],
            hitEffects: []
        };
        seedContinuousBattle(session, true);
        return session;
    }

    function normalizeProjectile(raw, owner) {
        if (!raw || typeof raw !== "object") {
            return null;
        }
        return {
            id: Number(raw.id || 0),
            owner: owner,
            lane: 0,
            side: raw.side === -1 ? -1 : 1,
            x: Number(raw.x || 0),
            y: Number(raw.y || 0),
            vx: Number(raw.vx || 0),
            radius: Math.max(2, Number(raw.radius || 4)),
            damage: Math.max(1, Number(raw.damage || 1)),
            color: String(raw.color || "#ffffff"),
            glow: String(raw.glow || raw.color || "#ffffff"),
            createdAt: Number(raw.createdAt || 0),
            reflected: Boolean(raw.reflected),
            activeAt: Number(raw.activeAt || raw.createdAt || 0),
            sourceX: Number(raw.sourceX || raw.x || 0),
            sourceY: Number(raw.sourceY || raw.y || 0),
            sourceEnemyId: Math.max(0, Number(raw.sourceEnemyId || 0)),
            remainingHits: Math.max(1, Number(raw.remainingHits || 1)),
            returnAt: Number(raw.returnAt || 0),
            maxTravelX: Number(raw.maxTravelX || 0),
            returning: Boolean(raw.returning),
            splash: Boolean(raw.splash),
            splashRadius: Math.max(0, Number(raw.splashRadius || 0)),
            splashDamage: Math.max(0, Number(raw.splashDamage || 0)),
            freezeMs: Math.max(0, Number(raw.freezeMs || 0)),
            controlMs: Math.max(0, Number(raw.controlMs || 0))
        };
    }

    function normalizeEffect(raw, defaults) {
        if (!raw || typeof raw !== "object") {
            return null;
        }
        return {
            id: Number(raw.id || 0),
            type: String(raw.type || defaults.type || "effect"),
            side: raw.side === -1 ? -1 : 1,
            lane: 0,
            x: Number(raw.x || 0),
            y: Number(raw.y || 0),
            color: String(raw.color || defaults.color || "#ffffff"),
            reach: Number(raw.reach || defaults.reach || 100),
            arc: Number(raw.arc || defaults.arc || 0.8),
            thickness: Number(raw.thickness || defaults.thickness || 10),
            startAt: Number(raw.startAt || 0),
            until: Number(raw.until || 0),
            radius: Number(raw.radius || defaults.radius || 12),
            text: String(raw.text || ""),
            shape: String(raw.shape || defaults.shape || ""),
            variant: String(raw.variant || defaults.variant || "")
        };
    }

    function normalizeShiSession(raw) {
        if (!raw || !Array.isArray(raw.enemies)) {
            return createShiSession();
        }
        const session = {
            sessionKey: String(raw.sessionKey || ("shi-" + Date.now())),
            status: raw.status === "over" ? "over" : "playing",
            startedAt: Number(raw.startedAt || Date.now()),
            elapsedSeconds: Math.max(0, Number(raw.elapsedSeconds || 0)),
            submittedScore: Boolean(raw.submittedScore),
            paused: Boolean(raw.paused),
            lane: 0,
            stepLevel: normalizedModeLevel(raw.stepLevel || 0),
            hp: Math.max(0, Number(raw.hp || SHI_DATA.player.baseHp)),
            maxHp: Math.max(6, Number(raw.maxHp || SHI_DATA.player.baseHp)),
            shield: Math.max(0, Number(raw.shield || 0)),
            wave: Math.max(1, Number(raw.wave || 1)),
            score: Math.max(0, Number(raw.score || 0)),
            kills: Math.max(0, Number(raw.kills || 0)),
            currentWeaponKey: SHI_DATA.weapons[raw.currentWeaponKey] ? raw.currentWeaponKey : "dagger",
            weaponKeys: Array.isArray(raw.weaponKeys) ? raw.weaponKeys.filter(function (key) { return SHI_DATA.weapons[key]; }) : ["dagger"],
            equipmentKeys: Array.isArray(raw.equipmentKeys) ? raw.equipmentKeys.filter(function (key) { return SHI_DATA.equipments[key]; }).slice(0, 6) : [],
            bonusDamage: Math.max(0, Number(raw.bonusDamage || 0)),
            perfectWindowMs: Math.max(60, Number(raw.perfectWindowMs || SHI_DATA.timings.defaultPerfectWindowMs)),
            skillCooldownFactor: Math.max(0.55, Number(raw.skillCooldownFactor || 1)),
            attackReadyAt: Number(raw.attackReadyAt || 0),
            stepReadyAt: Number(raw.stepReadyAt || raw.laneSwitchReadyAt || 0),
            laneSwitchReadyAt: 0,
            skillReadyAt: Number(raw.skillReadyAt || 0),
            blockReadyAt: Number(raw.blockReadyAt || 0),
            block: raw.block && typeof raw.block === "object" ? {
                side: Number(raw.block.side || 0),
                startAt: Number(raw.block.startAt || 0),
                activeAt: Number(raw.block.activeAt || raw.block.startAt || 0),
                until: Number(raw.block.until || 0),
                perfectUntil: Number(raw.block.perfectUntil || 0)
            } : { side: 0, startAt: 0, activeAt: 0, until: 0, perfectUntil: 0 },
            perfectLockSide: raw.perfectLockSide === -1 ? -1 : (raw.perfectLockSide === 1 ? 1 : 0),
            perfectLockUntil: Number(raw.perfectLockUntil || 0),
            perfectGuardUntil: Number(raw.perfectGuardUntil || 0),
            playerState: String(raw.playerState || "待战"),
            skillEmpowerHitsLeft: Math.max(0, Number(raw.skillEmpowerHitsLeft || 0)),
            attackProcCounter: Math.max(0, Number(raw.attackProcCounter || 0)),
            lastDamageAt: Number(raw.lastDamageAt || Date.now()),
            lastAuraTickAt: Number(raw.lastAuraTickAt || 0),
            bunkerUntil: Number(raw.bunkerUntil || 0),
            guardianUsed: Boolean(raw.guardianUsed),
            zhonyaUsed: Boolean(raw.zhonyaUsed),
            lastAttackSide: raw.lastAttackSide === -1 ? -1 : (raw.lastAttackSide === 1 ? 1 : 0),
            mejaisStacks: Math.max(0, Number(raw.mejaisStacks || 0)),
            guinsooStacks: Math.max(0, Number(raw.guinsooStacks || 0)),
            guinsooUntil: Number(raw.guinsooUntil || 0),
            spearComboIndex: Math.max(0, Number(raw.spearComboIndex || 0)) % 3,
            spearComboUntil: Number(raw.spearComboUntil || 0),
            modeComboKey: raw.modeComboKey === "advance" || raw.modeComboKey === "response" ? raw.modeComboKey : "",
            modeComboStep: Math.max(0, Number(raw.modeComboStep || 0)),
            modeComboStreak: Math.max(0, Number(raw.modeComboStreak || 0)),
            modeComboUntil: Number(raw.modeComboUntil || 0),
            flashText: String(raw.flashText || ""),
            flashUntil: Number(raw.flashUntil || 0),
            message: String(raw.message || ""),
            pendingRewardOptions: Array.isArray(raw.pendingRewardOptions) ? raw.pendingRewardOptions.slice(0, SHI_DATA.scene.rewardPoolSize) : [],
            pendingRewardScore: Math.max(0, Number(raw.pendingRewardScore || 0)),
            pendingReplaceEquipmentKey: SHI_DATA.equipments[raw.pendingReplaceEquipmentKey] ? String(raw.pendingReplaceEquipmentKey) : "",
            attackPose: raw.attackPose && typeof raw.attackPose === "object" ? {
                side: Number(raw.attackPose.side || 0),
                startAt: Number(raw.attackPose.startAt || 0),
                until: Number(raw.attackPose.until || 0),
                weaponKey: SHI_DATA.weapons[raw.attackPose.weaponKey] ? raw.attackPose.weaponKey : "dagger",
                distance: Number(raw.attackPose.distance || 10)
            } : { side: 0, startAt: 0, until: 0, weaponKey: "dagger", distance: 10 },
            attackHitStopMs: Math.max(20, Number(raw.attackHitStopMs || SHI_DATA.timings.hitStopMs)),
            incomingFlashUntil: Number(raw.incomingFlashUntil || 0),
            hurtFlashUntil: Number(raw.hurtFlashUntil || 0),
            screenShakeUntil: Number(raw.screenShakeUntil || 0),
            screenShakePower: Math.max(0, Number(raw.screenShakePower || 0)),
            hitStopUntil: Number(raw.hitStopUntil || 0),
            enemyAttackReadyAt: Number(raw.enemyAttackReadyAt || 0),
            leftSpawnReadyAt: Number(raw.leftSpawnReadyAt || 0),
            rightSpawnReadyAt: Number(raw.rightSpawnReadyAt || 0),
            nextEnemyId: Math.max(1, Number(raw.nextEnemyId || 1)),
            nextProjectileId: Math.max(1, Number(raw.nextProjectileId || 1)),
            nextEffectId: Math.max(1, Number(raw.nextEffectId || 1)),
            enemies: raw.enemies.map(function (enemy) {
                const knownType = SHI_DATA.enemies[enemy.type] ? String(enemy.type) : "quickstab";
                return {
                    id: Number(enemy.id || 0),
                    side: enemy.side === -1 ? -1 : 1,
                    lane: 0,
                    type: knownType,
                    hp: Math.max(0, Number(enemy.hp || 0)),
                    maxHp: Math.max(1, Number(enemy.maxHp || 1)),
                    readyAt: Number(enemy.readyAt || 0),
                    state: String(enemy.state || "idle"),
                    approachStartAt: Number(enemy.approachStartAt || 0),
                    approachEndAt: Number(enemy.approachEndAt || 0),
                    telegraphStartAt: Number(enemy.telegraphStartAt || 0),
                    strikeAt: Number(enemy.strikeAt || 0),
                    recoverAt: Number(enemy.recoverAt || 0),
                    attackStartedAt: Number(enemy.attackStartedAt || 0),
                    feintUsed: Boolean(enemy.feintUsed),
                    openingUntil: Number(enemy.openingUntil || 0),
                    openingHitsLeft: Math.max(0, Number(enemy.openingHitsLeft || 0)),
                    targetLane: 0,
                    followLaneAt: Number(enemy.followLaneAt || 0)
                };
            }).filter(function (enemy) { return enemy.hp > 0; }),
            playerProjectiles: Array.isArray(raw.playerProjectiles) ? raw.playerProjectiles.map(function (one) {
                return normalizeProjectile(one, "player");
            }).filter(Boolean) : [],
            enemyProjectiles: Array.isArray(raw.enemyProjectiles) ? raw.enemyProjectiles.map(function (one) {
                return normalizeProjectile(one, "enemy");
            }).filter(Boolean) : [],
            meleeEffects: Array.isArray(raw.meleeEffects) ? raw.meleeEffects.map(function (one) {
                return normalizeEffect(one, { type: "melee" });
            }).filter(Boolean) : [],
            hitEffects: Array.isArray(raw.hitEffects) ? raw.hitEffects.map(function (one) {
                return normalizeEffect(one, { type: "hit" });
            }).filter(Boolean) : []
        };
        if (!session.weaponKeys.length) {
            session.weaponKeys = ["dagger"];
        }
        if (session.weaponKeys.indexOf(session.currentWeaponKey) === -1) {
            session.currentWeaponKey = session.weaponKeys[0];
        }
        if (!session.enemies.length && !session.pendingRewardOptions.length && session.status === "playing") {
            seedContinuousBattle(session, true);
        }
        return session;
    }

    function syncClock(session) {
        if (session.status === "playing" && !session.paused) {
            session.elapsedSeconds = Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
        }
    }

    function serializeShiSession(session) {
        syncClock(session);
        return {
            sessionKey: session.sessionKey,
            status: session.status,
            startedAt: session.startedAt,
            elapsedSeconds: session.elapsedSeconds,
            submittedScore: session.submittedScore,
            paused: session.paused,
            lane: 0,
            stepLevel: session.stepLevel,
            hp: session.hp,
            maxHp: session.maxHp,
            shield: session.shield,
            wave: session.wave,
            score: session.score,
            kills: session.kills,
            currentWeaponKey: session.currentWeaponKey,
            weaponKeys: session.weaponKeys.slice(),
            equipmentKeys: session.equipmentKeys.slice(),
            bonusDamage: session.bonusDamage,
            perfectWindowMs: session.perfectWindowMs,
            skillCooldownFactor: session.skillCooldownFactor,
            attackReadyAt: session.attackReadyAt,
            stepReadyAt: session.stepReadyAt,
            laneSwitchReadyAt: session.stepReadyAt,
            skillReadyAt: session.skillReadyAt,
            blockReadyAt: session.blockReadyAt,
            block: session.block,
            perfectLockSide: session.perfectLockSide,
            perfectLockUntil: session.perfectLockUntil,
            perfectGuardUntil: session.perfectGuardUntil,
            playerState: session.playerState,
            skillEmpowerHitsLeft: session.skillEmpowerHitsLeft,
            attackProcCounter: session.attackProcCounter,
            lastDamageAt: session.lastDamageAt,
            lastAuraTickAt: session.lastAuraTickAt,
            bunkerUntil: session.bunkerUntil,
            guardianUsed: session.guardianUsed,
            zhonyaUsed: session.zhonyaUsed,
            lastAttackSide: session.lastAttackSide,
            mejaisStacks: session.mejaisStacks,
            guinsooStacks: session.guinsooStacks,
            guinsooUntil: session.guinsooUntil,
            spearComboIndex: session.spearComboIndex,
            spearComboUntil: session.spearComboUntil,
            modeComboKey: session.modeComboKey,
            modeComboStep: session.modeComboStep,
            modeComboStreak: session.modeComboStreak,
            modeComboUntil: session.modeComboUntil,
            flashText: session.flashText,
            flashUntil: session.flashUntil,
            message: session.message,
            pendingRewardOptions: session.pendingRewardOptions.slice(),
            pendingRewardScore: session.pendingRewardScore,
            pendingReplaceEquipmentKey: session.pendingReplaceEquipmentKey,
            attackPose: session.attackPose,
            attackHitStopMs: session.attackHitStopMs,
            incomingFlashUntil: session.incomingFlashUntil,
            hurtFlashUntil: session.hurtFlashUntil,
            screenShakeUntil: session.screenShakeUntil,
            screenShakePower: session.screenShakePower,
            hitStopUntil: session.hitStopUntil,
            enemyAttackReadyAt: session.enemyAttackReadyAt,
            leftSpawnReadyAt: session.leftSpawnReadyAt,
            rightSpawnReadyAt: session.rightSpawnReadyAt,
            nextEnemyId: session.nextEnemyId,
            nextProjectileId: session.nextProjectileId,
            nextEffectId: session.nextEffectId,
            enemies: session.enemies.map(function (enemy) {
                return {
                    id: enemy.id,
                    side: enemy.side,
                    lane: enemy.lane,
                    type: enemy.type,
                    hp: enemy.hp,
                    maxHp: enemy.maxHp,
                    readyAt: enemy.readyAt,
                    state: enemy.state,
                    approachStartAt: enemy.approachStartAt,
                    approachEndAt: enemy.approachEndAt,
                    telegraphStartAt: enemy.telegraphStartAt,
                    strikeAt: enemy.strikeAt,
                    recoverAt: enemy.recoverAt,
                    attackStartedAt: enemy.attackStartedAt,
                    feintUsed: enemy.feintUsed,
                    openingUntil: enemy.openingUntil,
                    openingHitsLeft: enemy.openingHitsLeft,
                    targetLane: enemy.targetLane,
                    followLaneAt: enemy.followLaneAt
                };
            }),
            playerProjectiles: session.playerProjectiles.map(function (one) {
                return {
                    id: one.id,
                    lane: one.lane,
                    side: one.side,
                    x: one.x,
                    y: one.y,
                    vx: one.vx,
                    radius: one.radius,
                    damage: one.damage,
                    color: one.color,
                    glow: one.glow,
                    createdAt: one.createdAt,
                    reflected: one.reflected,
                    activeAt: one.activeAt,
                    sourceX: one.sourceX,
                    sourceY: one.sourceY,
                    remainingHits: one.remainingHits,
                    returnAt: one.returnAt,
                    maxTravelX: one.maxTravelX,
                    returning: one.returning,
                    splash: one.splash,
                    splashRadius: one.splashRadius,
                    splashDamage: one.splashDamage,
                    freezeMs: one.freezeMs
                };
            }),
            enemyProjectiles: session.enemyProjectiles.map(function (one) {
                return {
                    id: one.id,
                    lane: one.lane,
                    side: one.side,
                    x: one.x,
                    y: one.y,
                    vx: one.vx,
                    radius: one.radius,
                    damage: one.damage,
                    color: one.color,
                    glow: one.glow,
                    createdAt: one.createdAt,
                    reflected: one.reflected,
                    activeAt: one.activeAt,
                    sourceX: one.sourceX,
                    sourceY: one.sourceY,
                    remainingHits: one.remainingHits,
                    returnAt: one.returnAt,
                    maxTravelX: one.maxTravelX,
                    returning: one.returning,
                    splash: one.splash,
                    splashRadius: one.splashRadius,
                    splashDamage: one.splashDamage,
                    freezeMs: one.freezeMs
                };
            }),
            meleeEffects: session.meleeEffects.map(function (one) {
                return {
                    id: one.id,
                    type: one.type,
                    side: one.side,
                    lane: one.lane,
                    x: one.x,
                    y: one.y,
                    color: one.color,
                    reach: one.reach,
                    arc: one.arc,
                    thickness: one.thickness,
                    startAt: one.startAt,
                    until: one.until,
                    radius: one.radius,
                    text: one.text,
                    shape: one.shape,
                    variant: one.variant
                };
            }),
            hitEffects: session.hitEffects.map(function (one) {
                return {
                    id: one.id,
                    type: one.type,
                    side: one.side,
                    lane: one.lane,
                    x: one.x,
                    y: one.y,
                    color: one.color,
                    reach: one.reach,
                    arc: one.arc,
                    thickness: one.thickness,
                    startAt: one.startAt,
                    until: one.until,
                    radius: one.radius,
                    text: one.text,
                    shape: one.shape,
                    variant: one.variant
                };
            })
        };
    }

    function summarizeShiSession(session) {
        syncClock(session);
        return {
            wave: session.wave,
            score: session.score,
            kills: session.kills,
            hp: session.hp,
            max_hp: session.maxHp,
            weapon: session.currentWeaponKey,
            equipment_count: session.equipmentKeys.length,
            player_projectiles: session.playerProjectiles.length,
            enemy_projectiles: session.enemyProjectiles.length,
            status: session.status,
            elapsed_seconds: session.elapsedSeconds
        };
    }

    function derivedStats(session, nowMs) {
        const weapon = currentWeapon(session);
        const derived = {
            attackDamage: weapon.damage + session.bonusDamage,
            attackCooldownMs: weapon.cooldownMs,
            blockReduction: 0.65,
            lifeOnHit: 0,
            healAmp: 1,
            shieldAmp: 1,
            extraTargets: 0,
            executeThreshold: 0,
            skillRefundOnHitMs: 0,
            skillDamageBonus: 0,
            skillEmpowerHits: 0,
            skillEmpowerDamage: 0,
            magicOnHitDamage: 0,
            projectileDamageBonus: 0,
            remoteDamageReduction: 0,
            bonusScoreOnKill: 0,
            killHeal: 0,
            auraDamage: 0,
            auraTickMs: 0,
            periodicShieldMs: 0,
            periodicShieldAmount: 0,
            thornsDamage: 0,
            blockEnemySlowMs: 0,
            onHitSlowMs: 0,
            chainEvery: 0,
            chainDamage: 0,
            chainRange: 0,
            krakenEvery: 0,
            krakenDamage: 0,
            reviveOnce: false,
            stasisOnce: false,
            heartsteel: false,
            hasMejais: false,
            shieldPerWave: 0,
            enemyHpScale: 1,
            enemyAttackGapReduceMs: 0,
            hasGuinsoo: false,
            blockRecoveryMs: SHI_DATA.timings.blockRecoveryMs,
            perfectCounterDamageBonus: 0,
            perfectSkillRefundMs: 0,
            combatPower: 100,
            combatEnemyHpScale: 1
        };
        session.equipmentKeys.forEach(function (key) {
            const entry = SHI_DATA.equipments[key];
            if (entry && typeof entry.apply === "function") {
                entry.apply(derived);
            }
        });
        // 杀人书层数归属于装备本身，离手后就不再保留。
        if (!derived.hasMejais && session.mejaisStacks > 0) {
            session.mejaisStacks = 0;
        } else if (derived.hasMejais && session.mejaisStacks > 0) {
            derived.attackDamage += session.mejaisStacks;
        }
        if (derived.hasGuinsoo) {
            if (session.guinsooUntil > nowMs) {
                derived.attackCooldownMs = Math.max(
                    110,
                    Math.round(derived.attackCooldownMs * (1 - Math.min(0.44, session.guinsooStacks * 0.1)))
                );
            } else {
                session.guinsooStacks = 0;
            }
        }
        if (weapon.kind === "ranged") {
            const rangedRisk = SHI_DATA.balance.rangedRisk;
            derived.attackCooldownMs = Math.max(
                rangedRisk.minAttackCooldownMs,
                Math.round(derived.attackCooldownMs * rangedRisk.cooldownScale) + Number(rangedRisk.extraCooldownByWeapon[weapon.key] || 0)
            );
            derived.enemyHpScale = Math.max(derived.enemyHpScale, rangedRisk.enemyHpScale);
            derived.enemyAttackGapReduceMs = Math.max(derived.enemyAttackGapReduceMs, rangedRisk.enemyAttackGapReduceMs);
        }
        const combatInfo = combatPowerSnapshot(session, nowMs, derived);
        derived.combatPower = combatInfo.power;
        derived.combatEnemyHpScale = combatInfo.enemyHpScale;
        derived.enemyHpScale = Math.max(derived.enemyHpScale, combatInfo.enemyHpScale);
        derived.blockRecoveryMs = Math.max(90, SHI_DATA.timings.blockRecoveryMs);
        return derived;
    }

    function combatPowerSnapshot(session, nowMs, derivedOverride) {
        const weapon = currentWeapon(session);
        const d = derivedOverride || derivedStats(session, nowMs || Date.now());
        const attackGain = Math.max(0, d.attackDamage - weapon.damage);
        const attackSpeedGain = Math.max(0, (weapon.cooldownMs / Math.max(1, d.attackCooldownMs)) - 1);
        const hpGain = Math.max(0, session.maxHp - SHI_DATA.player.baseHp);
        const mejaisScore = Math.sqrt(Math.max(0, session.mejaisStacks || 0)) * 1.75;
        const sustainScore = (
            Math.max(0, d.lifeOnHit) * 0.9
            + Math.max(0, d.killHeal) * 0.45
            + Math.max(0, d.shieldPerWave) * 0.8
            + Math.max(0, d.periodicShieldAmount) * 0.75
        );
        const utilityScore = (
            Math.max(0, d.skillDamageBonus) * 0.85
            + Math.max(0, d.magicOnHitDamage) * 0.7
            + Math.max(0, d.projectileDamageBonus) * 0.65
            + Math.max(0, d.extraTargets) * 0.9
            + Math.max(0, d.chainDamage) * 0.65
            + Math.max(0, d.krakenDamage) * 0.7
        );
        // 战力影响敌人血量，但用软缩放，避免成长装备导致敌方数值直接失控。
        const score = (
            attackGain * 1.45
            + attackSpeedGain * 4.8
            + hpGain * 0.18
            + sustainScore
            + utilityScore
            + session.equipmentKeys.length * 0.78
            + mejaisScore
        );
        return {
            power: 100 + Math.round(score * 11),
            enemyHpScale: Number((1 + Math.min(1.85, score * 0.055)).toFixed(2))
        };
    }

    function enemyConfig(enemyType) {
        return SHI_DATA.enemies[enemyType] || SHI_DATA.enemies.quickstab || SHI_DATA.enemies.melee;
    }

    function enemyRole(enemy) {
        return enemyConfig(enemy.type).attackRole || (enemy.type === "ranged" ? "ranged" : "melee");
    }

    function enemyStyle(enemy) {
        return enemyConfig(enemy.type).attackStyle || enemyRole(enemy);
    }

    function enemyBadge(enemy) {
        return enemyConfig(enemy.type).badge || (enemyRole(enemy) === "ranged" ? "射" : "斩");
    }

    function threatTierAt(session, nowMs) {
        const currentMs = nowMs || Date.now();
        const elapsedSeconds = session.status === "playing" && !session.paused
            ? Math.max(0, Math.floor((currentMs - session.startedAt) / 1000))
            : Math.max(0, Number(session.elapsedSeconds || 0));
        return Math.max(1, 1 + Math.floor(elapsedSeconds / SHI_DATA.continuous.difficultyIntervalSeconds));
    }

    function syncThreatTier(session, nowMs) {
        const nextTier = threatTierAt(session, nowMs);
        if (nextTier <= session.wave) {
            return;
        }
        const d = derivedStats(session, nowMs || Date.now());
        while (session.wave < nextTier) {
            session.wave += 1;
            if (d.shieldPerWave > 0) {
                session.shield = Math.max(session.shield, Math.round(d.shieldPerWave * d.shieldAmp));
            }
        }
        session.flashText = "压强提升";
        session.flashUntil = (nowMs || Date.now()) + SHI_DATA.timings.hitFlashDurationMs;
        session.message = "战场压强提升，敌人会更快更硬。";
    }

    function pickEnemyTemplateKey(session, nowMs) {
        const threatTier = Math.max(1, threatTierAt(session, nowMs));
        const pool = threatTier <= 2
            ? [
                { key: "quickstab", weight: 38 },
                { key: "melee", weight: 18 },
                { key: "ranged", weight: 24 },
                { key: "heavy", weight: 10 },
                { key: "feint", weight: 10 }
            ]
            : [
                { key: "quickstab", weight: 26 },
                { key: "melee", weight: 16 },
                { key: "ranged", weight: 22 },
                { key: "heavy", weight: 18 },
                { key: "feint", weight: 18 }
            ];
        const total = pool.reduce(function (sum, one) { return sum + one.weight; }, 0);
        let roll = Math.random() * total;
        for (let index = 0; index < pool.length; index += 1) {
            roll -= pool[index].weight;
            if (roll <= 0) {
                return pool[index].key;
            }
        }
        return pool[0].key;
    }

    function spawnEnemyUnit(session, side, nowMs, readyAtOverride) {
        const type = pickEnemyTemplateKey(session, nowMs);
        const config = enemyConfig(type);
        const d = derivedStats(session, nowMs);
        const threatTier = Math.max(1, session.wave || 1);
        const hp = Math.max(1, Math.round((config.hpBase + config.hpPerWave * threatTier) * (d.enemyHpScale || 1)));
        session.enemies.push({
            id: session.nextEnemyId++,
            side: side,
            lane: session.lane,
            type: type,
            hp: hp,
            maxHp: hp,
            readyAt: readyAtOverride != null ? readyAtOverride : (nowMs + randomInt(config.readyDelayMs[0], config.readyDelayMs[1])),
            state: "idle",
            approachStartAt: 0,
            approachEndAt: 0,
            telegraphStartAt: 0,
            strikeAt: 0,
            recoverAt: 0,
            attackStartedAt: 0,
            feintUsed: false,
            openingUntil: 0,
            openingHitsLeft: 0,
            targetLane: session.lane,
            followLaneAt: 0
        });
    }

    function scheduleSideSpawn(session, side, nowMs, immediate) {
        const key = side < 0 ? "leftSpawnReadyAt" : "rightSpawnReadyAt";
        session[key] = immediate
            ? nowMs
            : (nowMs + randomInt(SHI_DATA.continuous.spawnDelayMs[0], SHI_DATA.continuous.spawnDelayMs[1]));
    }

    function seedContinuousBattle(session, immediate) {
        const nowMs = Date.now();
        const d = derivedStats(session, nowMs);
        session.enemies = [];
        session.playerProjectiles = [];
        session.enemyProjectiles = [];
        session.meleeEffects = [];
        session.hitEffects = [];
        session.pendingRewardScore = 0;
        session.enemyAttackReadyAt = 0;
        session.perfectLockSide = 0;
        session.perfectLockUntil = 0;
        session.perfectGuardUntil = 0;
        session.skillEmpowerHitsLeft = 0;
        session.attackProcCounter = 0;
        session.lastAttackSide = 0;
        session.leftSpawnReadyAt = 0;
        session.rightSpawnReadyAt = 0;
        session.wave = Math.max(1, threatTierAt(session, nowMs));
        clearBlockRecovery(session, nowMs);
        [-1, 1].forEach(function (side) {
            for (let index = 0; index < SHI_DATA.continuous.initialSpawnPerSide; index += 1) {
                spawnEnemyUnit(
                    session,
                    side,
                    nowMs,
                    nowMs + (immediate ? (640 + index * 420) : (940 + index * 420))
                );
            }
            scheduleSideSpawn(session, side, nowMs + (immediate ? 600 : 900), false);
        });
        if (d.shieldPerWave > 0) {
            session.shield = Math.max(session.shield, Math.round(d.shieldPerWave * d.shieldAmp));
        }
        session.message = "战斗开始：左右两侧会持续补怪，击杀后有概率直接掉落。";
    }

    function maintainEnemyRoster(session, nowMs) {
        syncThreatTier(session, nowMs);
        [-1, 1].forEach(function (side) {
            const sideCount = session.enemies.filter(function (enemy) {
                return enemy.side === side && enemy.lane === session.lane;
            }).length;
            if (sideCount >= SHI_DATA.continuous.sideReserve) {
                return;
            }
            const readyKey = side < 0 ? "leftSpawnReadyAt" : "rightSpawnReadyAt";
            if ((session[readyKey] || 0) > nowMs) {
                return;
            }
            spawnEnemyUnit(session, side, nowMs);
            scheduleSideSpawn(session, side, nowMs, false);
        });
    }

    function visualDistance(enemy, session) {
        const config = enemyConfig(enemy.type);
        const bias = playerDistanceBias(session, 1);
        function clampDistance(value) {
            return Math.max(76, Math.round(value + bias));
        }
        if (enemy.state === "relocate" && enemy.followLaneAt > 0) {
            const nowMs = Date.now();
            const progress = Math.max(0, Math.min(1, 1 - ((enemy.followLaneAt - nowMs) / Math.max(1, SHI_DATA.timings.enemyLaneFollowMs))));
            return clampDistance(config.visualDistance + 36 * progress);
        }
        if (enemy.state === "approach" && enemy.approachStartAt > 0 && enemy.approachEndAt > enemy.approachStartAt) {
            const nowMs = Date.now();
            const progress = Math.max(0, Math.min(1, (nowMs - enemy.approachStartAt) / Math.max(1, enemy.approachEndAt - enemy.approachStartAt)));
            return clampDistance(config.visualDistance + (config.readyDistance - config.visualDistance) * progress);
        }
        if (enemy.state === "pressure") {
            return clampDistance(config.pressureDistance || ((config.visualDistance + config.readyDistance) / 2));
        }
        if (enemy.state === "telegraph") {
            return clampDistance(config.readyDistance);
        }
        if (enemy.recoverAt > 0) {
            return clampDistance(config.strikeDistance);
        }
        return clampDistance(config.visualDistance);
    }

    function enemyDistanceBand(distance) {
        if (distance <= 120) {
            return "贴";
        }
        if (distance <= 180) {
            return "近";
        }
        if (distance <= 260) {
            return "中";
        }
        return "远";
    }

    function sidePressureSummary(session, side, nowMs) {
        const frontEnemy = session.enemies
            .filter(function (enemy) {
                return enemy.side === side && enemy.lane === session.lane;
            })
            .sort(function (left, right) {
                return visualDistance(left, session) - visualDistance(right, session);
            })[0];
        if (!frontEnemy) {
            return "空";
        }
        const badge = enemyBadge(frontEnemy);
        const stateText = frontEnemy.state === "telegraph"
            ? "出手"
            : (frontEnemy.state === "approach"
                ? "逼近"
                : (frontEnemy.state === "pressure" ? "压迫" : "待机"));
        return badge + enemyDistanceBand(visualDistance(frontEnemy, session)) + " · " + stateText;
    }

    function enemyBusy(enemy, nowMs) {
        return enemy.state === "approach"
            || enemy.state === "telegraph"
            || (enemy.recoverAt || 0) > nowMs;
    }

    function enemyPressureEligible(enemy, nowMs) {
        return enemy.readyAt <= nowMs
            && (enemy.state === "idle" || enemy.state === "pressure")
            && !enemyBusy(enemy, nowMs);
    }

    function setEnemyPressure(enemy, nowMs) {
        if (enemy.state === "pressure") {
            return;
        }
        enemy.state = "pressure";
        enemy.approachStartAt = nowMs;
        enemy.approachEndAt = nowMs + SHI_DATA.timings.enemyPressureApproachMs;
        enemy.telegraphStartAt = 0;
        enemy.strikeAt = 0;
        enemy.recoverAt = 0;
        enemy.attackStartedAt = 0;
    }

    function startEnemyApproach(enemy, nowMs) {
        const fromPressure = enemy.state === "pressure";
        const config = enemyConfig(enemy.type);
        enemy.state = "approach";
        enemy.approachStartAt = nowMs;
        enemy.approachEndAt = nowMs + (fromPressure ? SHI_DATA.timings.enemyPressureSettleMs : Math.max(280, Number(config.approachMs || SHI_DATA.timings.enemyApproachDurationMs)));
        enemy.telegraphStartAt = 0;
        enemy.strikeAt = 0;
        enemy.recoverAt = 0;
        enemy.attackStartedAt = 0;
    }

    function chooseReadyEnemyForAttack(session, nowMs) {
        const preferredSide = session.lastAttackSide === 0 ? 0 : -session.lastAttackSide;
        return session.enemies
            .filter(function (enemy) {
                return enemy.lane === session.lane
                    && enemyPressureEligible(enemy, nowMs);
            })
            .sort(function (left, right) {
                const leftPressure = left.state === "pressure" ? 0 : 1;
                const rightPressure = right.state === "pressure" ? 0 : 1;
                if (leftPressure !== rightPressure) {
                    return leftPressure - rightPressure;
                }
                const leftPreferred = left.side === preferredSide ? 0 : 1;
                const rightPreferred = right.side === preferredSide ? 0 : 1;
                if (leftPreferred !== rightPreferred) {
                    return leftPreferred - rightPreferred;
                }
                return left.readyAt - right.readyAt;
            })[0] || null;
    }

    function maintainPressureEnemy(session, nowMs, committedSide) {
        if (!committedSide) {
            return;
        }
        const oppositeSide = -committedSide;
        const existingPressure = session.enemies.some(function (enemy) {
            return enemy.side === oppositeSide && enemy.state === "pressure";
        });
        if (existingPressure) {
            return;
        }
        const pressureEnemy = session.enemies
            .filter(function (enemy) {
                return enemy.side === oppositeSide
                    && enemy.lane === session.lane
                    && enemyPressureEligible(enemy, nowMs);
            })
            .sort(function (left, right) {
                return left.readyAt - right.readyAt;
            })[0];
        if (pressureEnemy) {
            setEnemyPressure(pressureEnemy, nowMs);
        }
    }

    function buildSingleReward(session) {
        const rewardPool = [];
        const missingWeapons = Object.keys(SHI_DATA.weapons).filter(function (key) {
            return session.weaponKeys.indexOf(key) === -1;
        });
        const availableEquipment = Object.keys(SHI_DATA.equipments).filter(function (key) {
            return session.equipmentKeys.indexOf(key) === -1;
        });
        if (missingWeapons.length) {
            rewardPool.push({
                weight: 14,
                value: {
                    category: "weapon",
                    key: pickRandom(missingWeapons),
                    name: "",
                    desc: "替换当前武器并获得对应技能。"
                }
            });
        }
        if (availableEquipment.length) {
            rewardPool.push({
                weight: 54,
                value: {
                    category: "equipment",
                    key: pickRandom(availableEquipment),
                    name: "",
                    desc: ""
                }
            });
        }
        const statKey = pickRandom(Object.keys(SHI_DATA.statRewards));
        rewardPool.push({
            weight: 32,
            value: {
                category: "stat",
                key: statKey,
                name: SHI_DATA.statRewards[statKey].name,
                desc: SHI_DATA.statRewards[statKey].desc
            }
        });
        const totalWeight = rewardPool.reduce(function (sum, item) {
            return sum + item.weight;
        }, 0);
        let roll = Math.random() * totalWeight;
        let selected = rewardPool[0].value;
        rewardPool.some(function (item) {
            roll -= item.weight;
            if (roll <= 0) {
                selected = item.value;
                return true;
            }
            return false;
        });
        if (selected.category === "weapon") {
            selected.name = SHI_DATA.weapons[selected.key].name;
        } else if (selected.category === "equipment") {
            selected.name = SHI_DATA.equipments[selected.key].name;
            selected.desc = SHI_DATA.equipments[selected.key].desc;
        }
        return selected;
    }

    function equipmentReplaceScore(session) {
        return Math.max(12, 8 + Math.max(1, session.wave || 1) * 3);
    }

    function applyReward(session, reward) {
        if (!reward) {
            return;
        }
        if (reward.category === "weapon" && SHI_DATA.weapons[reward.key]) {
            if (session.weaponKeys.indexOf(reward.key) === -1) {
                session.weaponKeys.push(reward.key);
            }
            session.currentWeaponKey = reward.key;
            session.message = "更换武器：" + SHI_DATA.weapons[reward.key].name;
        } else if (reward.category === "equipment" && SHI_DATA.equipments[reward.key]) {
            if (session.equipmentKeys.indexOf(reward.key) !== -1) {
                session.message = "你已经持有这件装备。";
                return;
            }
            if (session.equipmentKeys.length < 6) {
                session.equipmentKeys.push(reward.key);
                session.message = "获得装备：" + SHI_DATA.equipments[reward.key].name;
            } else {
                session.pendingReplaceEquipmentKey = reward.key;
                session.message = "装备已满，选择一件旧装备替换，并额外获得积分。";
                return;
            }
        } else if (reward.category === "stat" && SHI_DATA.statRewards[reward.key]) {
            SHI_DATA.statRewards[reward.key].apply(session);
            session.message = "强化生效：" + SHI_DATA.statRewards[reward.key].name;
        }
        session.pendingRewardOptions = [];
        session.pendingRewardScore = 0;
        session.pendingReplaceEquipmentKey = "";
    }

    function replaceEquipmentReward(session, index) {
        if (!session.pendingReplaceEquipmentKey || !SHI_DATA.equipments[session.pendingReplaceEquipmentKey]) {
            return;
        }
        if (index < 0 || index >= session.equipmentKeys.length) {
            return;
        }
        const oldKey = session.equipmentKeys[index];
        const nextKey = session.pendingReplaceEquipmentKey;
        const gain = equipmentReplaceScore(session);
        session.equipmentKeys[index] = nextKey;
        session.score += gain;
        session.flashText = "+" + gain;
        session.flashUntil = Date.now() + SHI_DATA.timings.hitFlashDurationMs;
        session.message = "替换装备：" + SHI_DATA.equipments[oldKey].name + " -> " + SHI_DATA.equipments[nextKey].name + "，并获得 " + gain + " 积分。";
        session.pendingRewardOptions = [];
        session.pendingRewardScore = 0;
        session.pendingReplaceEquipmentKey = "";
    }

    function convertRewardToScore(session) {
        if (!session.pendingRewardOptions.length) {
            return;
        }
        const gain = Math.max(10, session.pendingRewardScore || (12 + Math.max(1, session.wave || 1) * 4));
        session.score += gain;
        session.pendingRewardOptions = [];
        session.pendingRewardScore = 0;
        session.pendingReplaceEquipmentKey = "";
        session.message = "放弃这次掉落，转换为 " + gain + " 积分。";
        session.flashText = "+" + gain;
        session.flashUntil = Date.now() + SHI_DATA.timings.hitFlashDurationMs;
    }

    function healPlayer(session, amount, nowMs) {
        if (amount <= 0) {
            return;
        }
        const d = derivedStats(session, nowMs || Date.now());
        session.hp = Math.min(session.maxHp, session.hp + Math.max(1, Math.round(amount * (d.healAmp || 1))));
    }

    function dropMejaisStacksOnHit(session) {
        if (session.equipmentKeys.indexOf("mejais") === -1 || session.mejaisStacks <= 0) {
            return 0;
        }
        const before = Math.max(0, Number(session.mejaisStacks || 0));
        const after = Math.floor(before / 2);
        session.mejaisStacks = after;
        return before - after;
    }

    function spawnHitEffect(session, x, lane, color, text) {
        session.hitEffects.push({
            id: session.nextEffectId++,
            type: "hit",
            side: 1,
            lane: lane,
            x: x,
            y: SHI_DATA.scene.laneY[lane],
            color: color,
            radius: 8,
            startAt: Date.now(),
            until: Date.now() + SHI_DATA.timings.hitEffectDurationMs,
            reach: 0,
            arc: 0,
            thickness: 0,
            text: text || "",
            shape: "ring",
            variant: "hit"
        });
    }

    function spawnBlockEffect(session, side, lane, kind, text) {
        const nowMs = Date.now();
        session.hitEffects.push({
            id: session.nextEffectId++,
            type: "hit",
            side: side,
            lane: lane,
            x: SHI_DATA.scene.playerX + side * 26,
            y: SHI_DATA.scene.laneY[lane],
            color: kind === "perfect" ? "#facc15" : "#67e8f9",
            radius: kind === "perfect" ? 22 : 16,
            startAt: nowMs,
            until: nowMs + (kind === "perfect" ? 260 : 180),
            reach: kind === "perfect" ? 48 : 36,
            arc: 0,
            thickness: kind === "perfect" ? 10 : 7,
            text: text || "",
            shape: kind === "perfect" ? "burst" : "shield",
            variant: kind
        });
    }

    function spawnMeleeEffect(session, side, weapon, lane, text, options) {
        const extra = options || {};
        session.meleeEffects.push({
            id: session.nextEffectId++,
            type: "melee",
            side: side,
            lane: lane,
            x: SHI_DATA.scene.playerX,
            y: SHI_DATA.scene.laneY[lane],
            color: weapon.color,
            reach: extra.reach != null ? extra.reach : weapon.slashReach,
            arc: extra.arc != null ? extra.arc : weapon.slashArc,
            thickness: extra.thickness != null ? extra.thickness : weapon.slashThickness,
            startAt: Date.now(),
            until: Date.now() + (extra.effectDurationMs || weapon.effectDurationMs),
            radius: 0,
            text: text || "",
            shape: extra.shape || weapon.meleeShape || "arc",
            variant: weapon.key
        });
    }

    function triggerHitStop(session, nowMs, durationMs) {
        session.hitStopUntil = Math.max(session.hitStopUntil || 0, nowMs + durationMs);
    }

    function triggerScreenShake(session, nowMs, power) {
        session.screenShakeUntil = Math.max(session.screenShakeUntil || 0, nowMs + SHI_DATA.timings.screenShakeDurationMs);
        session.screenShakePower = Math.max(session.screenShakePower || 0, Math.min(2.6, power));
    }

    function computePerfectLockUntil(session, side, lane, nowMs) {
        let perfectUntil = nowMs + SHI_DATA.timings.perfectLockDurationMs;
        session.enemies.forEach(function (enemy) {
            if (enemy.lane !== lane || enemy.side !== side || enemy.state !== "telegraph") {
                return;
            }
            const config = enemyConfig(enemy.type);
            const role = enemyRole(enemy);
            if (role === "ranged") {
                const burstCount = Math.max(1, Number(config.burstCount || 1));
                const burstIntervalMs = Math.max(40, Number(config.burstIntervalMs || 90));
                const travelMs = Math.ceil(visualDistance(enemy, session) / Math.max(0.2, config.projectileSpeed || 0.56));
                perfectUntil = Math.max(
                    perfectUntil,
                    enemy.strikeAt + SHI_DATA.timings.projectileChargeMs + (burstCount - 1) * burstIntervalMs + travelMs + 120
                );
            } else if (enemyStyle(enemy) === "feint" && !enemy.feintUsed) {
                perfectUntil = Math.max(
                    perfectUntil,
                    enemy.strikeAt + Number(config.feintGapMs || 100) + Number(config.telegraphMs || SHI_DATA.timings.telegraphDurationMs) + 120
                );
            } else {
                perfectUntil = Math.max(perfectUntil, enemy.strikeAt + Number(config.telegraphMs || 220) + 60);
            }
        });
        session.enemyProjectiles.forEach(function (one) {
            if (one.lane !== lane || incomingProjectileSide(one) !== side || one.activeAt <= nowMs) {
                return;
            }
            const travelMs = Math.ceil(Math.abs(one.x - SHI_DATA.scene.playerX) / Math.max(0.2, Math.abs(one.vx || 0.56)));
            perfectUntil = Math.max(perfectUntil, one.activeAt + travelMs + 120);
        });
        return perfectUntil;
    }

    function setBlockState(session, nowMs, readyAt) {
        session.blockReadyAt = readyAt;
        session.block.side = 0;
        session.block.startAt = nowMs;
        session.block.activeAt = nowMs;
        session.block.until = nowMs;
        session.block.perfectUntil = 0;
    }

    function clearBlockRecovery(session, nowMs) {
        setBlockState(session, nowMs, nowMs);
    }

    function cancelBlockStance(session, nowMs) {
        // 主动出手或切模式都会取消当前举盾姿态。
        // 但如果已经在预警阶段锁定了完美格挡，就保留这次锁定，避免“看起来触发了完美格挡却仍掉血”。
        setBlockState(session, nowMs, Math.max(session.blockReadyAt || 0, nowMs));
        if (session.perfectGuardUntil > nowMs) {
            session.perfectGuardUntil = nowMs;
        }
    }

    function setPerfectLock(session, side, untilMs) {
        session.perfectLockSide = side;
        session.perfectLockUntil = untilMs;
    }

    function clearPerfectLock(session) {
        session.perfectLockSide = 0;
        session.perfectLockUntil = 0;
    }

    function hasPerfectLock(session, side, nowMs) {
        return session.perfectLockSide === side && session.perfectLockUntil >= nowMs;
    }

    function keepPerfectBlock(session, side, nowMs, lockUntil) {
        session.blockReadyAt = nowMs;
        session.block.side = side;
        session.block.startAt = nowMs;
        session.block.activeAt = nowMs;
        session.block.perfectUntil = lockUntil;
        session.block.until = lockUntil;
        clearPerfectLock(session);
    }

    function applyPerfectGuard(session, untilMs) {
        session.perfectGuardUntil = Math.max(session.perfectGuardUntil || 0, untilMs);
    }

    function applyNormalBlockRecovery(session, readyAt) {
        session.blockReadyAt = Math.max(session.blockReadyAt || 0, readyAt);
    }

    function interruptPlayerCombat(session, nowMs) {
        cancelBlockStance(session, nowMs);
        session.attackPose.side = 0;
        session.attackPose.until = nowMs;
        session.playerState = "调整模式";
    }

    function shiftStep(session, direction, nowMs) {
        if (session.status !== "playing" || session.paused || session.pendingRewardOptions.length) {
            return;
        }
        if (nowMs < session.stepReadyAt) {
            session.message = "攻击模式还在切换。";
            return;
        }
        const nextLevel = direction > 0 ? 1 : 0;
        if (nextLevel === normalizedModeLevel(session.stepLevel || 0)) {
            session.message = nextLevel >= 1 ? "已经是攻势模式。" : "已经是应势模式。";
            return;
        }
        session.stepLevel = nextLevel;
        session.stepReadyAt = nowMs + SHI_DATA.timings.stepShiftCooldownMs;
        session.laneSwitchReadyAt = session.stepReadyAt;
        session.modeComboKey = "";
        session.modeComboStep = 0;
        session.modeComboStreak = 0;
        session.modeComboUntil = 0;
        session.flashText = stepProfileByLevel(nextLevel).shortLabel;
        session.flashUntil = nowMs + SHI_DATA.timings.hitFlashDurationMs;
        session.playerState = nextLevel > 0 ? "攻势待发" : "应势待发";
        session.message = "攻击模式切换至" + stepLabel(nextLevel) + "。 " + stepHint(session);
    }

    function interruptEnemyForLaneShift(enemy, nextLane, nowMs) {
        enemy.state = "relocate";
        enemy.targetLane = nextLane;
        enemy.followLaneAt = nowMs + SHI_DATA.timings.enemyLaneFollowMs;
        enemy.readyAt = enemy.followLaneAt + 180;
        enemy.approachStartAt = 0;
        enemy.approachEndAt = 0;
        enemy.telegraphStartAt = 0;
        enemy.strikeAt = 0;
        enemy.recoverAt = 0;
        enemy.attackStartedAt = 0;
    }

    function enemyAttackGapMs(session) {
        // 这里用持续战斗中的压强档位近似难度：拖得越久，敌人允许的下一次攻击间隔越短，但保留底线避免手感失控。
        const d = derivedStats(session, Date.now());
        return Math.max(
            SHI_DATA.timings.enemyMinAttackGapFloorMs,
            SHI_DATA.timings.enemyMinAttackGapMs
            - Math.max(0, session.wave - 1) * SHI_DATA.timings.enemyMinAttackGapWaveReduceMs
            - Math.max(0, d.enemyAttackGapReduceMs || 0)
        );
    }

    function sessionHasEquipment(session, key) {
        return session.equipmentKeys.indexOf(key) !== -1;
    }

    function incomingProjectileSide(projectile) {
        // 敌方子弹的 side 记录的是飞行方向，不是“从哪一侧打来”。
        // 格挡判定必须用来向侧，否则左侧来弹会被当成右侧来弹，导致完美格挡后仍掉血。
        return projectile.vx > 0 ? -1 : 1;
    }

    function spawnProjectile(session, owner, lane, side, x, speed, damage, radius, color, glow, reflected, options) {
        const extra = options || {};
        const list = owner === "player" ? session.playerProjectiles : session.enemyProjectiles;
        list.push({
            id: session.nextProjectileId++,
            owner: owner,
            lane: lane,
            side: side,
            x: x,
            y: SHI_DATA.scene.laneY[lane],
            vx: side * speed,
            radius: radius,
            damage: damage,
            color: color,
            glow: glow,
            createdAt: Date.now(),
            reflected: Boolean(reflected),
            activeAt: Number(extra.activeAt || Date.now()),
            sourceX: Number(extra.sourceX != null ? extra.sourceX : x),
            sourceY: Number(extra.sourceY != null ? extra.sourceY : SHI_DATA.scene.laneY[lane]),
            sourceEnemyId: Math.max(0, Number(extra.sourceEnemyId || 0)),
            remainingHits: Math.max(1, Number(extra.remainingHits || 1)),
            returnAt: Number(extra.returnAt || 0),
            maxTravelX: Number(extra.maxTravelX || 0),
            returning: Boolean(extra.returning),
            splash: Boolean(extra.splash),
            splashRadius: Math.max(0, Number(extra.splashRadius || 0)),
            splashDamage: Math.max(0, Number(extra.splashDamage || 0)),
            freezeMs: Math.max(0, Number(extra.freezeMs || 0)),
            controlMs: Math.max(0, Number(extra.controlMs || 0))
        });
    }

    function nearestDirectionalEnemies(session, side, range) {
        return session.enemies
            .filter(function (enemy) {
                return enemy.side === side && enemy.lane === session.lane;
            })
            .sort(function (left, right) {
                return visualDistance(left, session) - visualDistance(right, session);
            })
            .filter(function (enemy) {
                return visualDistance(enemy, session) <= range;
            });
    }

    function tacticalStepAdvice(session, nowMs) {
        const weapon = currentWeapon(session);
        const telegraphEnemy = session.enemies
            .filter(function (enemy) {
                return enemy.lane === session.lane && enemy.state === "telegraph";
            })
            .sort(function (left, right) {
                return left.strikeAt - right.strikeAt;
            })[0] || null;
        const incomingProjectile = session.enemyProjectiles
            .filter(function (one) {
                return one.lane === session.lane && one.activeAt > nowMs;
            })
            .sort(function (left, right) {
                return left.activeAt - right.activeAt;
            })[0] || null;
        const nearestEnemy = session.enemies
            .filter(function (enemy) {
                return enemy.lane === session.lane;
            })
            .sort(function (left, right) {
                return visualDistance(left, session) - visualDistance(right, session);
            })[0] || null;

        if (incomingProjectile) {
            return {
                level: 0,
                label: stepLabel(0),
                reason: "场上已有飞行物，应势模式更适合用更稳的出手接住节奏。"
            };
        }
        if (telegraphEnemy) {
            const role = enemyRole(telegraphEnemy);
            if (role === "ranged") {
                return {
                    level: 0,
                    label: stepLabel(0),
                    reason: "当前是射击前摇，应势模式更适合留节奏，准备格挡后反打。"
                };
            }
            if (enemyStyle(telegraphEnemy) === "heavy" || enemyStyle(telegraphEnemy) === "stab" || enemyStyle(telegraphEnemy) === "feint") {
                return {
                    level: 0,
                    label: stepLabel(0),
                    reason: "当前招式读招压力更高，应势模式更稳，适合等格挡落点后反打。"
                };
            }
            return {
                level: 1,
                label: stepLabel(1),
                reason: "对方已经亮招，如果你准备主动打断，攻势模式更适合直接压上去。"
            };
        }
        if (!nearestEnemy) {
            return {
                level: 1,
                label: stepLabel(1),
                reason: "当前没有贴身压力，攻势模式更适合先手开节奏。"
            };
        }
        const nearestDistance = visualDistance(nearestEnemy, session);
        if (weapon.kind === "melee") {
            const currentRange = effectiveMeleeRange(session, weapon, weapon.range);
            if (nearestDistance <= currentRange + 18) {
                return {
                    level: 1,
                    label: stepLabel(1),
                    reason: "敌人已经进入近战处理区，攻势模式更适合抢这一轮近身出手。"
                };
            }
            return {
                level: 0,
                label: stepLabel(0),
                reason: "敌人还没进安全斩区，应势模式更适合等它自己送进来。"
            };
        }
        if (nearestDistance <= 170 || nearestEnemy.state === "approach") {
            return {
                level: 0,
                label: stepLabel(0),
                reason: "敌人正在贴近，应势模式更适合守住脚下和接后手。"
            };
        }
        return {
            level: 1,
            label: stepLabel(1),
            reason: "当前距离安全，攻势模式更适合先点掉正在排队的一侧。"
        };
    }

    function damageEnemiesNearPoint(session, lane, centerX, radius, damage, nowMs, reason, excludeEnemyId) {
        session.enemies
            .filter(function (enemy) {
                return enemy.lane === lane && enemy.id !== excludeEnemyId;
            })
            .forEach(function (enemy) {
                const enemyX = SHI_DATA.scene.playerX + enemy.side * visualDistance(enemy, session);
                if (Math.abs(enemyX - centerX) <= radius) {
                    damageEnemy(session, enemy, damage, nowMs, reason, enemyX);
                }
            });
    }

    function clearEnemyProjectiles(session, lane, side) {
        let cleared = 0;
        const nowMs = Date.now();
        session.enemyProjectiles = session.enemyProjectiles.filter(function (one) {
            if (one.lane !== lane) {
                return true;
            }
            if (side && incomingProjectileSide(one) !== side) {
                return true;
            }
            cleared += 1;
            spawnHitEffect(
                session,
                one.activeAt > nowMs ? one.sourceX : one.x,
                one.lane,
                "#bfdbfe",
                ""
            );
            return false;
        });
        return cleared;
    }

    function applyEnemyControl(enemy, nowMs, delayMs) {
        enemy.readyAt = Math.max(enemy.readyAt || 0, nowMs + delayMs);
        if (enemy.state === "approach" || enemy.state === "telegraph") {
            enemy.state = "idle";
            enemy.approachStartAt = 0;
            enemy.approachEndAt = 0;
            enemy.telegraphStartAt = 0;
            enemy.strikeAt = 0;
            enemy.recoverAt = 0;
            enemy.attackStartedAt = 0;
        } else if (enemy.recoverAt > 0) {
            enemy.recoverAt = Math.max(enemy.recoverAt, nowMs + delayMs);
        }
    }

    function chainDamageEnemies(session, side, range, baseDamage, chainCount, nowMs, reason) {
        nearestDirectionalEnemies(session, side, range)
            .slice(0, Math.max(1, chainCount))
            .forEach(function (enemy, index) {
                damageEnemy(
                    session,
                    enemy,
                    Math.max(1, baseDamage - index),
                    nowMs,
                    reason,
                    SHI_DATA.scene.playerX + enemy.side * visualDistance(enemy, session)
                );
                if (index > 0) {
                    spawnHitEffect(
                        session,
                        SHI_DATA.scene.playerX + enemy.side * visualDistance(enemy, session),
                        enemy.lane,
                        "#c4b5fd",
                        ""
                    );
                }
            });
    }

    function isOffensiveDamageReason(reason) {
        return reason === "attack" || reason === "projectile" || reason === "skill" || reason === "proc";
    }

    function isOnHitDamageReason(reason) {
        return reason === "attack" || reason === "projectile";
    }

    function maybeOfferRandomDrop(session) {
        if (session.pendingRewardOptions.length || session.status !== "playing") {
            return;
        }
        if (Math.random() > SHI_DATA.continuous.dropChance) {
            return;
        }
        const reward = buildSingleReward(session);
        if (!reward) {
            return;
        }
        session.pendingRewardOptions = [reward];
        session.pendingRewardScore = Math.max(10, 12 + Math.max(1, session.wave || 1) * 4);
        session.message = "敌人掉落了一件战利品。";
    }

    function killEnemy(session, enemy, reason) {
        session.score += 12 + Math.max(1, session.wave || 1) * 4;
        session.kills += 1;
        const d = derivedStats(session, Date.now());
        const offensiveKill = isOffensiveDamageReason(reason);
        if (d.heartsteel) {
            session.maxHp += 1;
            if (offensiveKill) {
                session.hp = Math.min(session.maxHp, session.hp + 1);
            }
        }
        if (d.bonusScoreOnKill > 0) {
            session.score += d.bonusScoreOnKill;
        }
        if (offensiveKill && d.killHeal > 0) {
            healPlayer(session, d.killHeal, Date.now());
        }
        if (reason === "perfect" || reason === "reflect") {
            session.score += 8;
        }
        if (session.equipmentKeys.indexOf("mejais") >= 0) {
            session.mejaisStacks += 1;
            session.flashText = "书+" + session.mejaisStacks;
            session.flashUntil = Date.now() + SHI_DATA.timings.hitFlashDurationMs;
        }
        session.enemies = session.enemies.filter(function (item) {
            return item.id !== enemy.id;
        });
        maybeOfferRandomDrop(session);
        if (session.equipmentKeys.indexOf("mejais") >= 0 && !session.pendingRewardOptions.length) {
            session.message = "杀人书叠到 " + session.mejaisStacks + " 层。";
        }
    }

    function damageEnemy(session, enemy, amount, nowMs, reason, hitX) {
        const d = derivedStats(session, nowMs);
        const offensiveHit = isOffensiveDamageReason(reason);
        const onHitDamage = isOnHitDamageReason(reason);
        const openingStrike = enemyOpeningActive(enemy, nowMs) && (reason === "attack" || reason === "projectile");
        let finalAmount = amount;
        if (reason === "skill") {
            finalAmount += d.skillDamageBonus;
        }
        if (openingStrike) {
            finalAmount += 1;
        }
        if (onHitDamage && d.magicOnHitDamage > 0) {
            finalAmount += d.magicOnHitDamage;
        }
        if (reason === "projectile" && d.projectileDamageBonus > 0) {
            finalAmount += d.projectileDamageBonus;
        }
        if (session.skillEmpowerHitsLeft > 0 && onHitDamage) {
            finalAmount += d.skillEmpowerDamage;
            session.skillEmpowerHitsLeft -= 1;
        }
        if (onHitDamage) {
            session.attackProcCounter += 1;
            if (d.krakenEvery > 0 && session.attackProcCounter % d.krakenEvery === 0) {
                finalAmount += d.krakenDamage;
            }
        }
        if (d.executeThreshold > 0 && enemy.hp / enemy.maxHp <= d.executeThreshold) {
            enemy.hp = 0;
        } else {
            enemy.hp -= finalAmount;
        }
        if (onHitDamage && d.lifeOnHit > 0) {
            healPlayer(session, d.lifeOnHit, nowMs);
        }
        if (onHitDamage && d.skillRefundOnHitMs > 0) {
            session.skillReadyAt = Math.max(nowMs, session.skillReadyAt - d.skillRefundOnHitMs);
        }
        if (onHitDamage && d.hasGuinsoo) {
            session.guinsooStacks = Math.min(4, session.guinsooStacks + 1);
            session.guinsooUntil = nowMs + 3000;
        }
        if (onHitDamage && d.chainEvery > 0 && d.chainDamage > 0 && session.attackProcCounter % d.chainEvery === 0) {
            nearestDirectionalEnemies(session, enemy.side, d.chainRange || 180)
                .filter(function (target) { return target.id !== enemy.id; })
                .slice(0, 2)
                .forEach(function (target) {
                    damageEnemy(
                        session,
                        target,
                        d.chainDamage,
                        nowMs,
                        "proc",
                        SHI_DATA.scene.playerX + target.side * visualDistance(target, session)
                    );
                });
        }
        if (offensiveHit && d.onHitSlowMs > 0) {
            enemy.readyAt += d.onHitSlowMs;
            enemy.recoverAt = enemy.recoverAt > 0 ? (enemy.recoverAt + Math.round(d.onHitSlowMs * 0.45)) : enemy.recoverAt;
        }
        if (openingStrike) {
            consumeEnemyOpening(enemy);
            applyEnemyControl(enemy, nowMs, 420);
            session.flashText = "破绽追击";
            session.flashUntil = nowMs + SHI_DATA.timings.hitFlashDurationMs;
            session.message = "抓住了完美格挡后的破绽。";
        }
        spawnHitEffect(
            session,
            hitX != null ? hitX : (SHI_DATA.scene.playerX + enemy.side * visualDistance(enemy, session)),
            enemy.lane,
            openingStrike ? "#fbbf24" : (reason === "reflect" ? "#93c5fd" : "#f8fafc"),
            enemy.hp <= 0 ? "击杀" : ""
        );
        if (reason === "attack" || reason === "skill" || reason === "perfect") {
            triggerHitStop(session, nowMs, reason === "attack" ? session.attackHitStopMs : SHI_DATA.timings.hitStopMs);
            triggerScreenShake(session, nowMs, enemy.hp <= 0 ? 4 : 2.4);
        }
        if (enemy.hp <= 0) {
            killEnemy(session, enemy, reason);
        }
    }

    function hitDirectionalEnemies(session, side, range, baseDamage, hitCount, nowMs, reason, options) {
        const d = derivedStats(session, nowMs);
        const extra = options || {};
        const openingReachBonus = Math.max(0, Number(extra.openingReachBonus || 0));
        const totalHits = Math.max(1, hitCount + d.extraTargets + Math.max(0, Number(extra.extraHits || 0)));
        session.enemies
            .filter(function (enemy) {
                if (enemy.side !== side || enemy.lane !== session.lane) {
                    return false;
                }
                const distance = visualDistance(enemy, session);
                if (distance <= range) {
                    return true;
                }
                return openingReachBonus > 0
                    && enemyOpeningActive(enemy, nowMs)
                    && distance <= range + openingReachBonus;
            })
            .sort(function (left, right) {
                return visualDistance(left, session) - visualDistance(right, session);
            })
            .slice(0, totalHits)
            .forEach(function (enemy) {
                damageEnemy(
                    session,
                    enemy,
                    baseDamage,
                    nowMs,
                    reason,
                    SHI_DATA.scene.playerX + enemy.side * visualDistance(enemy, session)
                );
            });
    }

    function damageEnemiesInBurst(session, nowMs, range, damage, reason) {
        [-1, 1].forEach(function (side) {
            nearestDirectionalEnemies(session, side, range).forEach(function (enemy) {
                damageEnemy(
                    session,
                    enemy,
                    damage,
                    nowMs,
                    reason,
                    SHI_DATA.scene.playerX + enemy.side * visualDistance(enemy, session)
                );
            });
        });
    }

    function setAttackPose(session, side, nowMs, weaponKey, distance) {
        session.attackPose = {
            side: side,
            startAt: nowMs,
            until: nowMs + SHI_DATA.timings.attackPoseDurationMs,
            weaponKey: weaponKey,
            distance: distance != null ? distance : 10
        };
    }

    function currentSpearCombo(session, nowMs) {
        const combo = (SHI_DATA.weapons.spear && SHI_DATA.weapons.spear.combo) || [];
        const index = session.spearComboUntil >= nowMs ? session.spearComboIndex % Math.max(1, combo.length) : 0;
        return {
            index: index,
            step: combo[index] || null
        };
    }

    function grantEnemyOpening(enemy, nowMs, durationMs) {
        enemy.openingUntil = Math.max(Number(enemy.openingUntil || 0), nowMs + durationMs);
        enemy.openingHitsLeft = Math.max(Number(enemy.openingHitsLeft || 0), 1);
    }

    function enemyOpeningActive(enemy, nowMs) {
        return Number(enemy.openingUntil || 0) > nowMs && Number(enemy.openingHitsLeft || 0) > 0;
    }

    function consumeEnemyOpening(enemy) {
        if (!enemy.openingHitsLeft) {
            return;
        }
        enemy.openingHitsLeft = Math.max(0, Number(enemy.openingHitsLeft || 0) - 1);
        if (enemy.openingHitsLeft <= 0) {
            enemy.openingUntil = 0;
        }
    }

    function previewModeCombo(session, modeKey, nowMs) {
        const sameMode = session.modeComboKey === modeKey && session.modeComboUntil >= nowMs;
        const nextStep = sameMode ? (session.modeComboStep >= 2 ? 1 : (session.modeComboStep + 1)) : 1;
        const streak = sameMode ? (session.modeComboStreak + 1) : 1;
        const fatigueStacks = Math.max(0, streak - 2);
        if (modeKey === "advance") {
            return {
                key: modeKey,
                step: nextStep,
                stepLabel: nextStep === 1 ? "起手" : "追击",
                streak: streak,
                fatigueStacks: fatigueStacks,
                damageBonus: nextStep === 2 ? 1 : 0,
                rangeBonus: nextStep === 2 ? 22 : 0,
                extraHits: 0,
                controlMs: nextStep === 2 ? 180 : 0,
                projectileControlMs: 0,
                cooldownScale: 1 + Math.min(0.24, fatigueStacks * 0.08),
                damagePenalty: Math.min(2, fatigueStacks),
                hudText: "攻" + nextStep + " · " + (fatigueStacks > 0 ? ("疲" + fatigueStacks) : "稳")
            };
        }
        return {
            key: modeKey,
            step: nextStep,
            stepLabel: nextStep === 1 ? "拦截" : "反咬",
            streak: streak,
            fatigueStacks: fatigueStacks,
            damageBonus: 0,
            rangeBonus: nextStep === 2 ? 10 : 0,
            extraHits: nextStep === 2 ? 1 : 0,
            controlMs: nextStep === 2 ? 260 : 100,
            projectileControlMs: nextStep === 2 ? 180 : 80,
            cooldownScale: 1 + Math.min(0.24, fatigueStacks * 0.08),
            damagePenalty: Math.min(2, fatigueStacks),
            hudText: "应" + nextStep + " · " + (fatigueStacks > 0 ? ("疲" + fatigueStacks) : "稳")
        };
    }

    function commitModeCombo(session, comboPreview, nowMs) {
        session.modeComboKey = comboPreview.key;
        session.modeComboStep = comboPreview.step;
        session.modeComboStreak = comboPreview.streak;
        session.modeComboUntil = nowMs + SHI_DATA.timings.modeComboWindowMs;
    }

    function currentModeComboHud(session, nowMs) {
        if (session.modeComboUntil < nowMs || !session.modeComboKey) {
            return "未连段";
        }
        const prefix = session.modeComboKey === "advance" ? "攻" : "应";
        const fatigue = Math.max(0, Number(session.modeComboStreak || 0) - 2);
        return prefix + session.modeComboStep + " · " + (fatigue > 0 ? ("疲" + fatigue) : "稳");
    }

    function useAttack(session, side, nowMs) {
        if (session.status !== "playing" || session.paused || session.pendingRewardOptions.length) {
            return;
        }
        const weapon = currentWeapon(session);
        const d = derivedStats(session, nowMs);
        const modeKey = currentWeaponModeKey(session);
        const mode = currentWeaponMode(session, weapon);
        const modeCombo = previewModeCombo(session, modeKey, nowMs);
        const flashLabel = weapon.name + " · " + mode.name + " · " + modeCombo.stepLabel;
        const attackDamage = Math.max(1, d.attackDamage + modeCombo.damageBonus - modeCombo.damagePenalty);
        const openingReachBonus = modeCombo.rangeBonus;
        const comboExtraHits = modeCombo.extraHits;
        const comboControlMs = modeCombo.controlMs;
        const projectileControlMs = modeCombo.projectileControlMs;
        if (nowMs < session.attackReadyAt) {
            return;
        }
        if (session.block.until > nowMs || session.perfectGuardUntil > nowMs) {
            cancelBlockStance(session, nowMs);
        }
        session.attackReadyAt = nowMs + Math.round(d.attackCooldownMs * modeCombo.cooldownScale);

        if (weapon.kind === "melee") {
            session.playerState = (modeKey === "advance" ? "攻势近战" : "应势近战") + " · " + modeCombo.stepLabel;
            if (weapon.key === "spear") {
                if (modeKey === "advance" && Array.isArray(weapon.combo) && weapon.combo.length) {
                    const comboState = currentSpearCombo(session, nowMs);
                    const comboStep = comboState.step;
                    const comboRange = effectiveMeleeRange(session, weapon, comboStep.range + 8 + openingReachBonus);
                    session.attackHitStopMs = comboStep.hitStopMs || SHI_DATA.timings.hitStopMs;
                    setAttackPose(session, side, nowMs, weapon.key, comboStep.poseDistance + 2);
                    spawnMeleeEffect(session, side, weapon, session.lane, comboStep.text, {
                        shape: comboStep.shape,
                        reach: (comboStep.reach || weapon.slashReach) + 8 + openingReachBonus,
                        arc: comboStep.arc,
                        thickness: comboStep.thickness,
                        effectDurationMs: comboStep.effectDurationMs
                    });
                    hitDirectionalEnemies(session, side, comboRange, comboStep.damage + session.bonusDamage + modeCombo.damageBonus - modeCombo.damagePenalty, comboStep.hits, nowMs, "attack", {
                        openingReachBonus: openingReachBonus,
                        extraHits: comboExtraHits
                    });
                    session.spearComboIndex = (comboState.index + 1) % weapon.combo.length;
                    session.spearComboUntil = nowMs + 720;
                } else {
                    const meleeRange = effectiveMeleeRange(session, weapon, 198 + openingReachBonus);
                    session.attackHitStopMs = 54;
                    session.spearComboUntil = 0;
                    setAttackPose(session, side, nowMs, weapon.key, 10);
                    spawnMeleeEffect(session, side, weapon, session.lane, "拦", {
                        shape: "arc",
                        reach: 170 + openingReachBonus,
                        arc: 0.64,
                        thickness: 22,
                        effectDurationMs: 150
                    });
                    hitDirectionalEnemies(session, side, meleeRange, attackDamage, 4, nowMs, "attack", {
                        openingReachBonus: openingReachBonus,
                        extraHits: comboExtraHits
                    });
                    nearestDirectionalEnemies(session, side, meleeRange + openingReachBonus).slice(0, 2).forEach(function (enemy) {
                        applyEnemyControl(enemy, nowMs, 260 + comboControlMs);
                    });
                }
            } else if (weapon.key === "hammer") {
                const meleeRange = effectiveMeleeRange(session, weapon, (modeKey === "advance" ? 182 : 160) + openingReachBonus);
                session.attackHitStopMs = modeKey === "advance" ? 78 : 52;
                setAttackPose(session, side, nowMs, weapon.key, modeKey === "advance" ? 16 : 10);
                spawnMeleeEffect(session, side, weapon, session.lane, modeKey === "advance" ? "坠" : "推", {
                    shape: "arc",
                    reach: (modeKey === "advance" ? 150 : 126) + openingReachBonus,
                    arc: modeKey === "advance" ? 0.88 : 1.02,
                    thickness: modeKey === "advance" ? 26 : 20,
                    effectDurationMs: modeKey === "advance" ? 196 : 152
                });
                hitDirectionalEnemies(session, side, meleeRange, attackDamage + (modeKey === "advance" ? 1 : 0), modeKey === "advance" ? 2 : 3, nowMs, "attack", {
                    openingReachBonus: openingReachBonus,
                    extraHits: comboExtraHits
                });
                if (modeKey !== "advance") {
                    nearestDirectionalEnemies(session, side, meleeRange).slice(0, 1).forEach(function (enemy) {
                        applyEnemyControl(enemy, nowMs, 420 + comboControlMs);
                    });
                }
            } else if (weapon.key === "axe") {
                const meleeRange = effectiveMeleeRange(session, weapon, (modeKey === "advance" ? 202 : 178) + openingReachBonus);
                session.attackHitStopMs = modeKey === "advance" ? 64 : 50;
                setAttackPose(session, side, nowMs, weapon.key, modeKey === "advance" ? 14 : 10);
                spawnMeleeEffect(session, side, weapon, session.lane, modeKey === "advance" ? "劈" : "扫", {
                    shape: "arc",
                    reach: (modeKey === "advance" ? 166 : 150) + openingReachBonus,
                    arc: modeKey === "advance" ? 0.62 : 1.12,
                    thickness: 20,
                    effectDurationMs: modeKey === "advance" ? 165 : 150
                });
                hitDirectionalEnemies(session, side, meleeRange, attackDamage + (modeKey === "advance" ? 1 : 0), modeKey === "advance" ? 2 : 4, nowMs, "attack", {
                    openingReachBonus: openingReachBonus,
                    extraHits: comboExtraHits
                });
            } else if (weapon.key === "lance") {
                const meleeRange = effectiveMeleeRange(session, weapon, (modeKey === "advance" ? 258 : 190) + openingReachBonus);
                session.attackHitStopMs = modeKey === "advance" ? 50 : 38;
                setAttackPose(session, side, nowMs, weapon.key, modeKey === "advance" ? 20 : 12);
                spawnMeleeEffect(session, side, weapon, session.lane, modeKey === "advance" ? "阵" : "截", {
                    shape: "line",
                    reach: (modeKey === "advance" ? 232 : 178) + openingReachBonus,
                    thickness: modeKey === "advance" ? 13 : 16,
                    effectDurationMs: modeKey === "advance" ? 146 : 132
                });
                hitDirectionalEnemies(session, side, meleeRange, attackDamage + (modeKey === "advance" ? 1 : 0), modeKey === "advance" ? 2 : 3, nowMs, "attack", {
                    openingReachBonus: openingReachBonus,
                    extraHits: comboExtraHits
                });
                if (modeKey !== "advance") {
                    nearestDirectionalEnemies(session, side, meleeRange).slice(0, 1).forEach(function (enemy) {
                        applyEnemyControl(enemy, nowMs, 280 + comboControlMs);
                    });
                }
            } else if (weapon.key === "chainblade") {
                const meleeRange = effectiveMeleeRange(session, weapon, (modeKey === "advance" ? 214 : 192) + openingReachBonus);
                session.attackHitStopMs = modeKey === "advance" ? 48 : 42;
                setAttackPose(session, side, nowMs, weapon.key, modeKey === "advance" ? 17 : 12);
                spawnMeleeEffect(session, side, weapon, session.lane, modeKey === "advance" ? "钩" : "锁", {
                    shape: modeKey === "advance" ? "line" : "arc",
                    reach: (modeKey === "advance" ? 186 : 170) + openingReachBonus,
                    arc: modeKey === "advance" ? 0.42 : 0.92,
                    thickness: modeKey === "advance" ? 16 : 18,
                    effectDurationMs: 150
                });
                hitDirectionalEnemies(session, side, meleeRange, attackDamage, modeKey === "advance" ? 2 : 3, nowMs, "attack", {
                    openingReachBonus: openingReachBonus,
                    extraHits: comboExtraHits
                });
                if (modeKey === "advance") {
                    const pulled = nearestDirectionalEnemies(session, side, meleeRange)[0];
                    if (pulled) {
                        applyEnemyControl(pulled, nowMs, 360 + comboControlMs);
                    }
                } else {
                    clearEnemyProjectiles(session, session.lane, side);
                    nearestDirectionalEnemies(session, side, meleeRange).slice(0, 1).forEach(function (enemy) {
                        applyEnemyControl(enemy, nowMs, 220 + comboControlMs);
                    });
                }
            } else if (weapon.key === "dualblade") {
                const meleeRange = effectiveMeleeRange(session, weapon, (modeKey === "advance" ? 180 : 170) + openingReachBonus);
                session.attackHitStopMs = modeKey === "advance" ? 28 : 36;
                setAttackPose(session, side, nowMs, weapon.key, modeKey === "advance" ? 15 : 10);
                spawnMeleeEffect(session, side, weapon, session.lane, modeKey === "advance" ? "追" : "月", {
                    shape: "arc",
                    reach: (modeKey === "advance" ? 132 : 136) + openingReachBonus,
                    arc: modeKey === "advance" ? 0.74 : 1.18,
                    thickness: 15,
                    effectDurationMs: modeKey === "advance" ? 112 : 124
                });
                hitDirectionalEnemies(session, side, meleeRange, attackDamage, modeKey === "advance" ? 2 : 3, nowMs, "attack", {
                    openingReachBonus: openingReachBonus,
                    extraHits: comboExtraHits
                });
            } else if (weapon.key === "trinity") {
                const meleeRange = effectiveMeleeRange(session, weapon, weapon.range + openingReachBonus);
                session.attackHitStopMs = modeKey === "advance" ? 46 : 40;
                setAttackPose(session, side, nowMs, weapon.key, modeKey === "advance" ? 14 : 11);
                spawnMeleeEffect(session, side, weapon, session.lane, modeKey === "advance" ? "断" : "节", {
                    shape: "arc",
                    reach: (modeKey === "advance" ? 156 : 148) + openingReachBonus,
                    arc: modeKey === "advance" ? 0.56 : 1.04,
                    thickness: 17,
                    effectDurationMs: 130
                });
                hitDirectionalEnemies(session, side, meleeRange, attackDamage + (modeKey === "advance" ? 1 : 0), 2, nowMs, "attack", {
                    openingReachBonus: openingReachBonus,
                    extraHits: comboExtraHits
                });
                if (modeKey !== "advance") {
                    hitDirectionalEnemies(session, side * -1, 128, Math.max(1, attackDamage - 1), 1, nowMs, "attack", {
                        openingReachBonus: openingReachBonus,
                        extraHits: comboExtraHits > 0 ? 1 : 0
                    });
                }
            } else if (weapon.key === "dagger") {
                const meleeRange = effectiveMeleeRange(session, weapon, (modeKey === "advance" ? 176 : 146) + openingReachBonus);
                session.attackHitStopMs = modeKey === "advance" ? 38 : 30;
                setAttackPose(session, side, nowMs, weapon.key, modeKey === "advance" ? 16 : 8);
                spawnMeleeEffect(session, side, weapon, session.lane, modeKey === "advance" ? "刺" : "切", {
                    shape: modeKey === "advance" ? "stab" : "arc",
                    reach: (modeKey === "advance" ? 126 : 118) + openingReachBonus,
                    arc: modeKey === "advance" ? 0.88 : 1.06,
                    thickness: 12,
                    effectDurationMs: modeKey === "advance" ? 116 : 124
                });
                hitDirectionalEnemies(session, side, meleeRange, attackDamage + (modeKey === "advance" ? 1 : 0), modeKey === "advance" ? 1 : 2, nowMs, "attack", {
                    openingReachBonus: openingReachBonus,
                    extraHits: comboExtraHits
                });
            } else if (weapon.key === "katana") {
                const meleeRange = effectiveMeleeRange(session, weapon, (modeKey === "advance" ? 206 : 182) + openingReachBonus);
                session.attackHitStopMs = modeKey === "advance" ? 62 : 44;
                setAttackPose(session, side, nowMs, weapon.key, modeKey === "advance" ? 15 : 11);
                spawnMeleeEffect(session, side, weapon, session.lane, modeKey === "advance" ? "居" : "返", {
                    shape: "arc",
                    reach: (modeKey === "advance" ? 164 : 146) + openingReachBonus,
                    arc: modeKey === "advance" ? 0.48 : 1.08,
                    thickness: 20,
                    effectDurationMs: modeKey === "advance" ? 170 : 150
                });
                hitDirectionalEnemies(session, side, meleeRange, attackDamage + (modeKey === "advance" ? 1 : 0), modeKey === "advance" ? 2 : 3, nowMs, "attack", {
                    openingReachBonus: openingReachBonus,
                    extraHits: comboExtraHits
                });
            } else {
                const meleeRange = effectiveMeleeRange(session, weapon, (modeKey === "advance" ? weapon.range + 12 : weapon.range) + openingReachBonus);
                session.attackHitStopMs = modeKey === "advance" ? SHI_DATA.timings.hitStopMs + 6 : SHI_DATA.timings.hitStopMs;
                setAttackPose(session, side, nowMs, weapon.key, modeKey === "advance" ? 14 : 10);
                spawnMeleeEffect(session, side, weapon, session.lane, modeKey === "advance" ? "压" : "守", {
                    shape: modeKey === "advance" ? (weapon.meleeShape || "line") : "arc",
                    reach: (modeKey === "advance" ? weapon.slashReach + 8 : weapon.slashReach) + openingReachBonus,
                    arc: modeKey === "advance" ? weapon.slashArc : Math.max(0.92, weapon.slashArc || 0.72),
                    thickness: weapon.slashThickness,
                    effectDurationMs: weapon.effectDurationMs
                });
                hitDirectionalEnemies(session, side, meleeRange, attackDamage + (modeKey === "advance" ? 1 : 0), modeKey === "advance" ? weapon.hits : (weapon.hits + 1), nowMs, "attack", {
                    openingReachBonus: openingReachBonus,
                    extraHits: comboExtraHits
                });
            }
            session.flashText = flashLabel;
            session.flashUntil = nowMs + 90;
        } else {
            session.playerState = (modeKey === "advance" ? "攻势射击" : "应势射击") + " · " + modeCombo.stepLabel;
            session.attackHitStopMs = SHI_DATA.timings.hitStopMs;
            setAttackPose(session, side, nowMs, weapon.key, modeKey === "advance" ? 12 : 8);
            const muzzleX = SHI_DATA.scene.playerX + side * 34;
            if (weapon.key === "thunderbook") {
                session.attackHitStopMs = modeKey === "advance" ? 40 : 34;
                if (modeKey === "advance") {
                    chainDamageEnemies(session, side, 320, attackDamage + 1, (weapon.chainCount || 3) + 1 + comboExtraHits, nowMs, "attack");
                } else {
                    chainDamageEnemies(session, side, 220, attackDamage, Math.max(2, weapon.chainCount || 3) + comboExtraHits, nowMs, "attack");
                    chainDamageEnemies(session, side * -1, 180, Math.max(1, attackDamage - 1), 1, nowMs, "attack");
                }
            } else if (weapon.key === "shotgun") {
                const pelletCount = modeKey === "advance" ? 3 : 5;
                for (let pellet = 0; pellet < pelletCount; pellet += 1) {
                    spawnProjectile(
                        session,
                        "player",
                        session.lane,
                        side,
                        muzzleX + (pellet - Math.floor(pelletCount / 2)) * side * (modeKey === "advance" ? 2 : 5),
                        weapon.projectileSpeed * (modeKey === "advance" ? 1.06 : 0.92) * (1 + pellet * 0.03),
                        attackDamage + (modeKey === "advance" ? 1 : 0),
                        weapon.projectileRadius + (modeKey === "advance" ? 1 : 0),
                        weapon.projectileTrail,
                        weapon.projectileGlow,
                        false,
                        { remainingHits: 1, controlMs: projectileControlMs }
                    );
                }
                if (modeKey !== "advance") {
                    nearestDirectionalEnemies(session, side, 210).slice(0, 2).forEach(function (enemy) {
                        applyEnemyControl(enemy, nowMs, 220 + comboControlMs);
                    });
                }
            } else if (weapon.key === "crossbow") {
                const burstCount = modeKey === "advance" ? 1 : Math.max(2, Number(weapon.burstCount || 2));
                for (let bolt = 0; bolt < burstCount; bolt += 1) {
                    spawnProjectile(
                        session,
                        "player",
                        session.lane,
                        side,
                        muzzleX + bolt * side * 6,
                        weapon.projectileSpeed * (modeKey === "advance" ? 1.05 : 0.96),
                        attackDamage + (modeKey === "advance" ? 1 : 0),
                        weapon.projectileRadius + (modeKey === "advance" ? 1 : 0),
                        weapon.projectileTrail,
                        weapon.projectileGlow,
                        false,
                        { remainingHits: modeKey === "advance" ? 2 : 1, freezeMs: modeKey === "advance" ? 0 : 160, controlMs: projectileControlMs }
                    );
                }
            } else if (weapon.key === "sniper") {
                spawnProjectile(
                    session,
                    "player",
                    session.lane,
                    side,
                    muzzleX,
                    weapon.projectileSpeed * (modeKey === "advance" ? 1.12 : 1),
                    attackDamage + (modeKey === "advance" ? 1 : 0),
                    weapon.projectileRadius + (modeKey === "advance" ? 0 : 1),
                    weapon.projectileTrail,
                    weapon.projectileGlow,
                    false,
                    { remainingHits: modeKey === "advance" ? ((weapon.projectilePierce || 3) + 1) : 1, freezeMs: modeKey === "advance" ? 0 : 420, controlMs: projectileControlMs }
                );
            } else if (weapon.key === "boomerang") {
                spawnProjectile(
                    session,
                    "player",
                    session.lane,
                    side,
                    muzzleX,
                    weapon.projectileSpeed * (modeKey === "advance" ? 0.98 : 1.05),
                    attackDamage + (modeKey === "advance" ? 1 : 0),
                    weapon.projectileRadius,
                    weapon.projectileTrail,
                    weapon.projectileGlow,
                    false,
                    {
                        remainingHits: modeKey === "advance" ? ((weapon.projectilePierce || 3) + 1) : 2,
                        returnAt: nowMs + (weapon.boomerangTravelMs || 320) + (modeKey === "advance" ? 40 : -90),
                        maxTravelX: muzzleX + side * (modeKey === "advance" ? 260 : 168),
                        controlMs: projectileControlMs
                    }
                );
            } else if (weapon.key === "grenade") {
                spawnProjectile(
                    session,
                    "player",
                    session.lane,
                    side,
                    muzzleX,
                    weapon.projectileSpeed * (modeKey === "advance" ? 0.9 : 1.08),
                    attackDamage + (modeKey === "advance" ? 1 : 0),
                    weapon.projectileRadius,
                    weapon.projectileTrail,
                    weapon.projectileGlow,
                    false,
                    {
                        remainingHits: 1,
                        splash: true,
                        splashRadius: modeKey === "advance" ? Math.max(118, weapon.splashRadius || 108) : Math.max(92, (weapon.splashRadius || 108) - 12),
                        splashDamage: modeKey === "advance" ? Math.max(2, attackDamage) : Math.max(1, attackDamage - 1),
                        controlMs: projectileControlMs
                    }
                );
                if (modeKey !== "advance") {
                    nearestDirectionalEnemies(session, side, 220).slice(0, 1).forEach(function (enemy) {
                        applyEnemyControl(enemy, nowMs, 240 + comboControlMs);
                    });
                }
            } else if (weapon.key === "minigun") {
                const burstCount = modeKey === "advance" ? 4 : Math.max(6, weapon.burstCount || 5);
                for (let shot = 0; shot < burstCount; shot += 1) {
                    spawnProjectile(
                        session,
                        "player",
                        session.lane,
                        side,
                        muzzleX + shot * side * (modeKey === "advance" ? 2 : 4),
                        weapon.projectileSpeed * (modeKey === "advance" ? 1.08 : 0.96) * (1 + shot * 0.03),
                        attackDamage + (modeKey === "advance" && shot < 2 ? 1 : 0),
                        weapon.projectileRadius,
                        weapon.projectileTrail,
                        weapon.projectileGlow,
                        false,
                        { remainingHits: 1, freezeMs: modeKey === "advance" ? 0 : (shot % 2 === 0 ? 120 : 0), controlMs: projectileControlMs }
                    );
                }
            } else if (weapon.key === "icewandweapon") {
                spawnProjectile(
                    session,
                    "player",
                    session.lane,
                    side,
                    muzzleX,
                    weapon.projectileSpeed * (modeKey === "advance" ? 1.08 : 0.92),
                    attackDamage + (modeKey === "advance" ? 1 : 0),
                    weapon.projectileRadius + (modeKey === "advance" ? 0 : 1),
                    weapon.projectileTrail,
                    weapon.projectileGlow,
                    false,
                    { remainingHits: modeKey === "advance" ? 2 : 1, freezeMs: modeKey === "advance" ? 260 : Math.max(760, weapon.freezeMs || 500), controlMs: projectileControlMs }
                );
            } else if (weapon.key === "fireorb") {
                const orbCount = modeKey === "advance" ? 1 : 2;
                for (let orb = 0; orb < orbCount; orb += 1) {
                    spawnProjectile(
                        session,
                        "player",
                        session.lane,
                        side,
                        muzzleX + (orb * side * 8),
                        weapon.projectileSpeed * (modeKey === "advance" ? 1.04 : 0.92),
                        attackDamage + (modeKey === "advance" ? 1 : 0),
                        weapon.projectileRadius,
                        weapon.projectileTrail,
                        weapon.projectileGlow,
                        false,
                        {
                            remainingHits: 1,
                            splash: true,
                            splashRadius: modeKey === "advance" ? Math.max(88, weapon.splashRadius || 84) : 70,
                            splashDamage: modeKey === "advance" ? Math.max(2, attackDamage) : Math.max(1, attackDamage - 1),
                            controlMs: projectileControlMs
                        }
                    );
                }
            } else if (weapon.key === "cannon") {
                const cannonShots = modeKey === "advance" ? 1 : 2;
                for (let shell = 0; shell < cannonShots; shell += 1) {
                    spawnProjectile(
                        session,
                        "player",
                        session.lane,
                        side,
                        muzzleX + shell * side * 10,
                        weapon.projectileSpeed * (modeKey === "advance" ? 1.04 : 0.88),
                        attackDamage + (modeKey === "advance" ? 1 : 0),
                        weapon.projectileRadius + 1,
                        weapon.projectileTrail,
                        weapon.projectileGlow,
                        false,
                        {
                            remainingHits: modeKey === "advance" ? 3 : 1,
                            splash: true,
                            splashRadius: modeKey === "advance" ? 90 : 116,
                            splashDamage: modeKey === "advance" ? Math.max(2, attackDamage - 1) : Math.max(1, attackDamage - 2),
                            controlMs: projectileControlMs
                        }
                    );
                }
            } else if (weapon.key === "pistol") {
                const shotCount = modeKey === "advance" ? 1 : 2;
                for (let shot = 0; shot < shotCount; shot += 1) {
                    spawnProjectile(
                        session,
                        "player",
                        session.lane,
                        side,
                        muzzleX + shot * side * 8,
                        weapon.projectileSpeed * (modeKey === "advance" ? 1.12 : 0.98),
                        attackDamage + (modeKey === "advance" ? 1 : 0),
                        weapon.projectileRadius,
                        weapon.projectileTrail,
                        weapon.projectileGlow,
                        false,
                        { remainingHits: 1, controlMs: projectileControlMs }
                    );
                }
            } else {
                spawnProjectile(
                    session,
                    "player",
                    session.lane,
                    side,
                    muzzleX,
                    weapon.projectileSpeed,
                    attackDamage,
                    weapon.projectileRadius,
                    weapon.projectileTrail,
                    weapon.projectileGlow,
                    false,
                    { remainingHits: 1, controlMs: projectileControlMs }
                );
            }
            session.flashText = flashLabel;
            session.flashUntil = nowMs + 120;
        }
        commitModeCombo(session, modeCombo, nowMs);
        if (modeCombo.fatigueStacks > 0) {
            session.message = "同一模式连续出手会疲劳，切到另一模式可重置手感。";
        }
    }

    function useSkill(session, nowMs) {
        const weapon = currentWeapon(session);
        const d = derivedStats(session, nowMs);
        if (session.status !== "playing" || session.paused || session.pendingRewardOptions.length || nowMs < session.skillReadyAt) {
            return;
        }
        if (session.block.until > nowMs || session.perfectGuardUntil > nowMs) {
            cancelBlockStance(session, nowMs);
        }
        session.playerState = "释放技能";
        session.skillReadyAt = nowMs + Math.round(weapon.skillCooldownMs * session.skillCooldownFactor);
        if (d.skillEmpowerHits > 0) {
            session.skillEmpowerHitsLeft = Math.max(session.skillEmpowerHitsLeft, d.skillEmpowerHits);
        }
        if (weapon.key === "dagger") {
            setAttackPose(session, -1, nowMs, weapon.key);
            spawnMeleeEffect(session, -1, weapon, session.lane, "风");
            spawnMeleeEffect(session, 1, weapon, session.lane, "风");
            damageEnemiesInBurst(session, nowMs, 180, 4 + session.bonusDamage, "skill");
            session.flashText = "利刃风暴";
        } else if (weapon.key === "spear") {
            setAttackPose(session, 1, nowMs, weapon.key);
            spawnMeleeEffect(session, 1, weapon, session.lane, "扫");
            hitDirectionalEnemies(session, 1, 9999, 5 + session.bonusDamage, 999, nowMs, "skill");
            session.flashText = "拒马阵";
        } else if (weapon.key === "katana") {
            setAttackPose(session, 1, nowMs, weapon.key);
            spawnMeleeEffect(session, -1, weapon, session.lane, "断");
            spawnMeleeEffect(session, 1, weapon, session.lane, "空");
            damageEnemiesInBurst(session, nowMs, 170, 5 + session.bonusDamage, "skill");
            session.flashText = "无尽断空";
        } else if (weapon.key === "hammer") {
            setAttackPose(session, 1, nowMs, weapon.key, 16);
            spawnMeleeEffect(session, -1, weapon, session.lane, "震", {
                shape: "arc",
                reach: 138,
                arc: 0.7,
                thickness: 22,
                effectDurationMs: 170
            });
            spawnMeleeEffect(session, 1, weapon, session.lane, "踏", {
                shape: "arc",
                reach: 138,
                arc: 0.7,
                thickness: 22,
                effectDurationMs: 170
            });
            damageEnemiesInBurst(session, nowMs, 160, 6 + session.bonusDamage, "skill");
            session.flashText = "破阵重踏";
        } else if (weapon.key === "axe") {
            setAttackPose(session, 1, nowMs, weapon.key, 14);
            spawnMeleeEffect(session, -1, weapon, session.lane, "旋");
            spawnMeleeEffect(session, 1, weapon, session.lane, "斩");
            damageEnemiesInBurst(session, nowMs, 180, 5 + session.bonusDamage, "skill");
            session.flashText = "裂甲旋斩";
        } else if (weapon.key === "lance") {
            setAttackPose(session, 1, nowMs, weapon.key, 18);
            hitDirectionalEnemies(session, 1, 9999, 6 + session.bonusDamage, 999, nowMs, "skill");
            spawnMeleeEffect(session, 1, weapon, session.lane, "阵", {
                shape: "line",
                reach: 220,
                thickness: 16,
                effectDurationMs: 150
            });
            session.flashText = "贯心突阵";
        } else if (weapon.key === "dualblade") {
            setAttackPose(session, 1, nowMs, weapon.key, 12);
            spawnMeleeEffect(session, -1, weapon, session.lane, "双", {
                shape: "arc",
                reach: 132,
                arc: 1.05,
                thickness: 15,
                effectDurationMs: 120
            });
            spawnMeleeEffect(session, 1, weapon, session.lane, "月", {
                shape: "arc",
                reach: 132,
                arc: 1.05,
                thickness: 15,
                effectDurationMs: 120
            });
            damageEnemiesInBurst(session, nowMs, 170, 4 + session.bonusDamage, "skill");
            session.flashText = "双月回环";
        } else if (weapon.key === "trinity") {
            setAttackPose(session, 1, nowMs, weapon.key, 15);
            spawnMeleeEffect(session, -1, weapon, session.lane, "三", {
                shape: "arc",
                reach: 150,
                arc: 0.64,
                thickness: 16,
                effectDurationMs: 130
            });
            spawnMeleeEffect(session, 1, weapon, session.lane, "相", {
                shape: "arc",
                reach: 150,
                arc: 0.64,
                thickness: 16,
                effectDurationMs: 130
            });
            hitDirectionalEnemies(session, 1, 220, 6 + session.bonusDamage, 3, nowMs, "skill");
            hitDirectionalEnemies(session, -1, 220, 5 + session.bonusDamage, 2, nowMs, "skill");
            session.flashText = "三相连断";
        } else if (weapon.key === "chainblade") {
            setAttackPose(session, 1, nowMs, weapon.key, 16);
            spawnMeleeEffect(session, -1, weapon, session.lane, "绞", {
                shape: "arc",
                reach: 172,
                arc: 0.84,
                thickness: 16,
                effectDurationMs: 150
            });
            spawnMeleeEffect(session, 1, weapon, session.lane, "舞", {
                shape: "arc",
                reach: 172,
                arc: 0.84,
                thickness: 16,
                effectDurationMs: 150
            });
            clearEnemyProjectiles(session, session.lane, 0);
            damageEnemiesInBurst(session, nowMs, 220, 5 + session.bonusDamage, "skill");
            session.flashText = "绞索圆舞";
        } else if (weapon.key === "pistol") {
            spawnProjectile(session, "player", session.lane, -1, SHI_DATA.scene.playerX - 34, weapon.projectileSpeed * 1.1, 3 + session.bonusDamage, weapon.projectileRadius, weapon.projectileTrail, weapon.projectileGlow, false);
            spawnProjectile(session, "player", session.lane, 1, SHI_DATA.scene.playerX + 34, weapon.projectileSpeed * 1.1, 3 + session.bonusDamage, weapon.projectileRadius, weapon.projectileTrail, weapon.projectileGlow, false);
            session.flashText = "莫桑比克";
        } else if (weapon.key === "shotgun") {
            for (let pellet = 0; pellet < 6; pellet += 1) {
                spawnProjectile(session, "player", session.lane, -1, SHI_DATA.scene.playerX - 34 + pellet * -3, weapon.projectileSpeed * 1.05, 3 + session.bonusDamage, weapon.projectileRadius, weapon.projectileTrail, weapon.projectileGlow, false);
                spawnProjectile(session, "player", session.lane, 1, SHI_DATA.scene.playerX + 34 + pellet * 3, weapon.projectileSpeed * 1.05, 3 + session.bonusDamage, weapon.projectileRadius, weapon.projectileTrail, weapon.projectileGlow, false);
            }
            session.flashText = "清巷轰击";
        } else if (weapon.key === "crossbow") {
            for (let bolt = 0; bolt < 4; bolt += 1) {
                spawnProjectile(session, "player", session.lane, 1, SHI_DATA.scene.playerX + 34 + bolt * 4, weapon.projectileSpeed * 1.08, 4 + session.bonusDamage, weapon.projectileRadius, weapon.projectileTrail, weapon.projectileGlow, false);
            }
            session.flashText = "雨落";
        } else if (weapon.key === "sniper") {
            spawnProjectile(session, "player", session.lane, -1, SHI_DATA.scene.playerX - 34, weapon.projectileSpeed * 1.18, 7 + session.bonusDamage, weapon.projectileRadius, weapon.projectileTrail, weapon.projectileGlow, false, { remainingHits: 5 });
            spawnProjectile(session, "player", session.lane, 1, SHI_DATA.scene.playerX + 34, weapon.projectileSpeed * 1.18, 7 + session.bonusDamage, weapon.projectileRadius, weapon.projectileTrail, weapon.projectileGlow, false, { remainingHits: 5 });
            session.flashText = "禁止接触";
        } else if (weapon.key === "boomerang") {
            spawnProjectile(session, "player", session.lane, -1, SHI_DATA.scene.playerX - 34, weapon.projectileSpeed, 4 + session.bonusDamage, weapon.projectileRadius, weapon.projectileTrail, weapon.projectileGlow, false, { remainingHits: 4, returnAt: nowMs + 360, maxTravelX: SHI_DATA.scene.playerX - 260 });
            spawnProjectile(session, "player", session.lane, 1, SHI_DATA.scene.playerX + 34, weapon.projectileSpeed, 4 + session.bonusDamage, weapon.projectileRadius, weapon.projectileTrail, weapon.projectileGlow, false, { remainingHits: 4, returnAt: nowMs + 360, maxTravelX: SHI_DATA.scene.playerX + 260 });
            session.flashText = "双返";
        } else if (weapon.key === "cannon") {
            spawnProjectile(session, "player", session.lane, -1, SHI_DATA.scene.playerX - 36, weapon.projectileSpeed * 1.06, 6 + session.bonusDamage, weapon.projectileRadius + 1, weapon.projectileTrail, weapon.projectileGlow, false, { remainingHits: 3 });
            spawnProjectile(session, "player", session.lane, 1, SHI_DATA.scene.playerX + 36, weapon.projectileSpeed * 1.06, 6 + session.bonusDamage, weapon.projectileRadius + 1, weapon.projectileTrail, weapon.projectileGlow, false, { remainingHits: 3 });
            session.flashText = "火力覆盖";
        } else if (weapon.key === "grenade") {
            [-1, 1].forEach(function (side) {
                for (let shell = 0; shell < 2; shell += 1) {
                    spawnProjectile(session, "player", session.lane, side, SHI_DATA.scene.playerX + side * (34 + shell * 10), weapon.projectileSpeed * (1 + shell * 0.12), 5 + session.bonusDamage, weapon.projectileRadius + 1, weapon.projectileTrail, weapon.projectileGlow, false, {
                        remainingHits: 1,
                        splash: true,
                        splashRadius: Math.max(96, weapon.splashRadius || 108),
                        splashDamage: 3 + session.bonusDamage
                    });
                }
            });
            session.flashText = "天罚";
        } else if (weapon.key === "minigun") {
            session.bunkerUntil = Math.max(session.bunkerUntil || 0, nowMs + 1800);
            session.stepReadyAt = Math.max(session.stepReadyAt || 0, nowMs + 1600);
            session.laneSwitchReadyAt = session.stepReadyAt;
            [-1, 1].forEach(function (side) {
                for (let shot = 0; shot < 7; shot += 1) {
                    spawnProjectile(session, "player", session.lane, side, SHI_DATA.scene.playerX + side * (30 + shot * 4), weapon.projectileSpeed * (1 + shot * 0.04), 2 + session.bonusDamage, weapon.projectileRadius, weapon.projectileTrail, weapon.projectileGlow, false, { remainingHits: 1 });
                }
            });
            session.flashText = "碉堡";
            session.message = "重机枪展开掩体，短时间内无视远程攻击。";
        } else if (weapon.key === "thunderbook") {
            chainDamageEnemies(session, -1, 320, 5 + session.bonusDamage, 4, nowMs, "skill");
            chainDamageEnemies(session, 1, 320, 5 + session.bonusDamage, 4, nowMs, "skill");
            session.flashText = "雷暴";
        } else if (weapon.key === "icewandweapon") {
            setAttackPose(session, 1, nowMs, weapon.key, 10);
            clearEnemyProjectiles(session, session.lane, 0);
            session.enemies.forEach(function (enemy) {
                if (enemy.lane === session.lane) {
                    applyEnemyControl(enemy, nowMs, 900);
                    spawnHitEffect(session, SHI_DATA.scene.playerX + enemy.side * visualDistance(enemy, session), enemy.lane, "#67e8f9", "冻");
                }
            });
            session.flashText = "极寒壁";
            session.message = "冰墙击碎了中轴飞行物，并冻结敌人的节奏。";
        } else if (weapon.key === "fireorb") {
            [-1, 1].forEach(function (side) {
                spawnProjectile(session, "player", session.lane, side, SHI_DATA.scene.playerX + side * 34, weapon.projectileSpeed * 1.08, 4 + session.bonusDamage, weapon.projectileRadius + 1, weapon.projectileTrail, weapon.projectileGlow, false, {
                    remainingHits: 1,
                    splash: true,
                    splashRadius: Math.max(92, weapon.splashRadius || 84),
                    splashDamage: 3 + session.bonusDamage
                });
                spawnProjectile(session, "player", session.lane, side, SHI_DATA.scene.playerX + side * 48, weapon.projectileSpeed * 0.96, 4 + session.bonusDamage, weapon.projectileRadius, weapon.projectileTrail, weapon.projectileGlow, false, {
                    remainingHits: 1,
                    splash: true,
                    splashRadius: Math.max(92, weapon.splashRadius || 84),
                    splashDamage: 2 + session.bonusDamage
                });
            });
            session.flashText = "灼城";
        }
        session.flashUntil = nowMs + SHI_DATA.timings.hitFlashDurationMs;
    }

    function useBlock(session, side, nowMs) {
        if (session.status !== "playing" || session.paused || session.pendingRewardOptions.length) {
            return;
        }
        if (nowMs < session.blockReadyAt) {
            session.message = "格挡还在回气。";
            return;
        }
        const telegraphedMelee = session.enemies.some(function (enemy) {
            return enemy.lane === session.lane
                && enemy.side === side
                && enemy.state === "telegraph";
        });
        const telegraphedProjectile = session.enemyProjectiles.some(function (one) {
            return one.lane === session.lane
                && incomingProjectileSide(one) === side
                && one.activeAt > nowMs;
        });
        const instantPerfect = telegraphedMelee || telegraphedProjectile;
        const perfectLockUntil = instantPerfect
            ? computePerfectLockUntil(session, side, session.lane, nowMs)
            : 0;
        session.block = {
            side: side,
            startAt: nowMs,
            activeAt: instantPerfect ? nowMs : (nowMs + SHI_DATA.timings.blockStartupMs),
            until: instantPerfect
                ? perfectLockUntil
                : (nowMs + SHI_DATA.timings.blockStartupMs + SHI_DATA.timings.blockDurationMs),
            perfectUntil: 0
        };
        if (instantPerfect) {
            setPerfectLock(session, side, perfectLockUntil);
        } else {
            clearPerfectLock(session);
        }
        session.blockReadyAt = instantPerfect
            ? nowMs
            : (session.block.until + SHI_DATA.timings.blockRecoveryMs);
        session.playerState = instantPerfect ? "完美格挡架势" : "格挡架势";
        if (instantPerfect) {
            spawnBlockEffect(session, side, session.lane, "perfect", "锁定");
            session.flashText = "锁定";
            session.flashUntil = nowMs + SHI_DATA.timings.hitFlashDurationMs;
            session.message = "预警期间格挡，已锁定完美格挡。";
        }
    }

    function applyPlayerDamage(session, amount, message, nowMs, damageKind) {
        const atMs = nowMs || Date.now();
        if (session.perfectGuardUntil > atMs) {
            session.message = "完美格挡保护中，未受到伤害。";
            return;
        }
        const d = derivedStats(session, atMs);
        let finalDamage = Math.max(0, amount);
        if (damageKind === "projectile" && d.remoteDamageReduction > 0) {
            finalDamage = Math.max(1, Math.ceil(finalDamage * (1 - d.remoteDamageReduction)));
        }
        if (session.bunkerUntil > atMs && damageKind === "projectile") {
            session.message = "碉堡挡下了这次远程攻击。";
            return;
        }
        if (d.stasisOnce && !session.zhonyaUsed && finalDamage >= session.hp) {
            session.zhonyaUsed = true;
            applyPerfectGuard(session, atMs + 1200);
            session.flashText = "金身";
            session.flashUntil = atMs + SHI_DATA.timings.hitFlashDurationMs;
            session.message = "中娅沙漏触发，暂时免疫本次伤害。";
            return;
        }
        if (d.reviveOnce && !session.guardianUsed && finalDamage >= session.hp) {
            session.guardianUsed = true;
            session.hp = Math.max(1, Math.round(session.maxHp * 0.45));
            applyPerfectGuard(session, atMs + 1000);
            session.flashText = "复活";
            session.flashUntil = atMs + SHI_DATA.timings.hitFlashDurationMs;
            session.message = "复活甲触发，你重新站了起来。";
            return;
        }
        session.playerState = "受击";
        session.lastDamageAt = atMs;
        if (session.shield > 0) {
            session.shield -= 1;
            session.message = "护盾抵消了这次攻击。";
            session.flashText = "护盾";
            session.flashUntil = atMs + SHI_DATA.timings.hitFlashDurationMs;
            triggerScreenShake(session, atMs, 1.1);
            return;
        }
        session.hp = Math.max(0, session.hp - finalDamage);
        session.message = message;
        const lostMejais = dropMejaisStacksOnHit(session);
        if (lostMejais > 0 && session.hp > 0) {
            session.message += " 杀人书掉了 " + lostMejais + " 层。";
            session.flashText = "书-" + lostMejais;
            session.flashUntil = atMs + SHI_DATA.timings.hitFlashDurationMs;
        }
        session.hurtFlashUntil = atMs + SHI_DATA.timings.hurtFlashDurationMs;
        session.incomingFlashUntil = atMs + SHI_DATA.timings.edgeFlashDurationMs;
        triggerScreenShake(session, atMs, 1 + finalDamage * 0.35);
        if (session.hp <= 0) {
            session.status = "over";
            session.message = "你倒下了，本局结束。";
        }
    }

    function resolveEnemyMeleeAttack(session, enemy, nowMs) {
        const d = derivedStats(session, nowMs);
        const config = enemyConfig(enemy.type);
        const style = enemyStyle(enemy);
        const sameSideBlock = session.block.side === enemy.side && session.block.activeAt <= nowMs && session.block.until >= nowMs;
        const lockedPerfect = hasPerfectLock(session, enemy.side, nowMs);
        const chainedPerfect = session.block.side === enemy.side && session.block.perfectUntil >= nowMs;
        const perfectWindowMs = effectivePerfectWindowMs(session);
        const perfect = lockedPerfect || chainedPerfect || (
            sameSideBlock
            && session.block.startAt >= Math.max(0, enemy.telegraphStartAt - Math.round(perfectWindowMs * 0.45))
            && session.block.startAt <= enemy.strikeAt + Math.round(perfectWindowMs * 0.4)
        );
        if (perfect) {
            const perfectLockUntil = Math.max(
                nowMs + (style === "heavy" ? 320 : 260),
                Number(session.block.perfectUntil || 0),
                Number(session.perfectLockUntil || 0)
            );
            keepPerfectBlock(session, enemy.side, nowMs, perfectLockUntil);
            applyPerfectGuard(session, perfectLockUntil);
            grantEnemyOpening(enemy, nowMs, SHI_DATA.timings.perfectOpeningMs);
            if (d.perfectSkillRefundMs > 0) {
                session.skillReadyAt = Math.max(nowMs, session.skillReadyAt - d.perfectSkillRefundMs);
            }
            damageEnemy(session, enemy, 3 + session.bonusDamage + d.perfectCounterDamageBonus + (style === "heavy" ? 1 : 0), nowMs, "perfect");
            session.score += 6;
            spawnBlockEffect(session, enemy.side, session.lane, "perfect", "Perfect");
            session.flashText = "完美格挡";
            session.flashUntil = nowMs + SHI_DATA.timings.hitFlashDurationMs;
            session.message = style === "heavy" ? "完美化解了重压攻击。" : "完美格挡成功。";
            return;
        }
        let damage = config.attackDamage;
        if (sameSideBlock) {
            damage = Math.max(1, Math.ceil(damage * (1 - d.blockReduction)));
            if (style === "heavy") {
                damage = Math.max(damage, Number(config.blockChipDamage || 2));
            }
            applyNormalBlockRecovery(session, nowMs + d.blockRecoveryMs);
            if (d.blockEnemySlowMs > 0) {
                session.enemyAttackReadyAt = Math.max(session.enemyAttackReadyAt, nowMs + d.blockEnemySlowMs);
            }
            if (d.thornsDamage > 0) {
                damageEnemy(session, enemy, d.thornsDamage, nowMs, "proc");
            }
            spawnBlockEffect(session, enemy.side, session.lane, "block", "格挡");
            applyPlayerDamage(session, damage, style === "heavy" ? "重压攻击仍然穿过了部分格挡。" : "普通格挡减免了伤害。", nowMs, "melee");
            return;
        }
        applyPlayerDamage(session, damage, style === "heavy" ? "被重压攻击命中。" : "被近战攻击命中。", nowMs, "melee");
    }

    function spawnEnemyProjectile(session, enemy, nowMs) {
        const config = enemyConfig(enemy.type);
        const sourceX = SHI_DATA.scene.playerX + enemy.side * visualDistance(enemy, session);
        const burstCount = Math.max(1, Number(config.burstCount || 1));
        const burstIntervalMs = Math.max(40, Number(config.burstIntervalMs || 90));
        for (let index = 0; index < burstCount; index += 1) {
            const activeAt = nowMs + SHI_DATA.timings.projectileChargeMs + index * burstIntervalMs;
            spawnProjectile(
                session,
                "enemy",
                enemy.lane,
                -enemy.side,
                sourceX,
                config.projectileSpeed,
                config.attackDamage,
                config.projectileRadius,
                config.projectileColor,
                config.projectileGlow,
                false,
                {
                    activeAt: activeAt,
                    sourceX: sourceX,
                    sourceY: SHI_DATA.scene.laneY[enemy.lane],
                    sourceEnemyId: enemy.id
                }
            );
        }
        session.message = "敌人锁定后即将射击。";
        session.flashText = "闪光";
        session.flashUntil = nowMs + SHI_DATA.timings.hitFlashDurationMs;
    }

    function updateEnemies(session, nowMs) {
        let engaged = false;
        session.enemies.forEach(function (enemy) {
            if (enemy.state === "relocate") {
                engaged = true;
                if (nowMs >= enemy.followLaneAt) {
                    enemy.lane = enemy.targetLane;
                    enemy.state = "idle";
                    enemy.followLaneAt = 0;
                }
            } else if (enemy.lane !== session.lane) {
                return;
            } else if (enemy.state === "pressure") {
                if (enemy.approachEndAt && nowMs >= enemy.approachEndAt) {
                    enemy.approachStartAt = 0;
                    enemy.approachEndAt = 0;
                }
            } else if (enemy.state === "approach") {
                engaged = true;
                if (nowMs >= enemy.approachEndAt) {
                    const config = enemyConfig(enemy.type);
                    enemy.state = "telegraph";
                    enemy.telegraphStartAt = nowMs;
                    enemy.strikeAt = nowMs + Math.max(120, Number(config.telegraphMs || SHI_DATA.timings.telegraphDurationMs));
                    session.incomingFlashUntil = nowMs + Math.max(120, Number(config.telegraphMs || SHI_DATA.timings.telegraphDurationMs));
                }
            } else if (enemy.state === "telegraph") {
                engaged = true;
                if (nowMs >= enemy.strikeAt && enemy.recoverAt === 0) {
                    session.enemyAttackReadyAt = nowMs + enemyAttackGapMs(session);
                    session.lastAttackSide = enemy.side;
                    const config = enemyConfig(enemy.type);
                    const role = enemyRole(enemy);
                    const style = enemyStyle(enemy);
                    let triggeredFeint = false;
                    if (style === "feint" && !enemy.feintUsed) {
                        triggeredFeint = true;
                        enemy.feintUsed = true;
                        enemy.telegraphStartAt = nowMs + Number(config.feintGapMs || 100);
                        enemy.strikeAt = enemy.telegraphStartAt + Number(config.telegraphMs || SHI_DATA.timings.telegraphDurationMs);
                        session.incomingFlashUntil = enemy.telegraphStartAt + Number(config.telegraphMs || SHI_DATA.timings.telegraphDurationMs);
                        session.message = "敌人虚晃一招，真正攻击还在后面。";
                    } else if (role === "ranged") {
                        spawnEnemyProjectile(session, enemy, nowMs);
                    } else {
                        resolveEnemyMeleeAttack(session, enemy, nowMs);
                    }
                    if (!triggeredFeint) {
                        enemy.attackStartedAt = nowMs;
                        enemy.recoverAt = nowMs + config.recoverMs;
                    }
                } else if (enemy.recoverAt && nowMs >= enemy.recoverAt) {
                    enemy.state = "idle";
                    enemy.readyAt = nowMs + randomInt(
                        enemyConfig(enemy.type).readyDelayMs[0],
                        enemyConfig(enemy.type).readyDelayMs[1]
                    );
                    enemy.approachStartAt = 0;
                    enemy.approachEndAt = 0;
                    enemy.telegraphStartAt = 0;
                    enemy.strikeAt = 0;
                    enemy.recoverAt = 0;
                    enemy.attackStartedAt = 0;
                    enemy.feintUsed = false;
                }
            } else if (enemy.recoverAt > nowMs) {
                engaged = true;
            }
        });
        if (session.status !== "playing" || session.paused || session.pendingRewardOptions.length) {
            return;
        }
        const committedEnemy = session.enemies.find(function (enemy) {
            return enemy.lane === session.lane && enemyBusy(enemy, nowMs);
        });
        const committedSide = committedEnemy ? committedEnemy.side : 0;
        if (committedSide) {
            maintainPressureEnemy(session, nowMs, committedSide);
        }
        if (engaged || committedSide) {
            return;
        }
        if (nowMs < session.enemyAttackReadyAt) {
            return;
        }
        const readyEnemy = chooseReadyEnemyForAttack(session, nowMs);
        if (readyEnemy) {
            startEnemyApproach(readyEnemy, nowMs);
            maintainPressureEnemy(session, nowMs, readyEnemy.side);
        }
    }

    function updateProjectiles(session, nowMs, deltaMs) {
        session.playerProjectiles = session.playerProjectiles.filter(function (one) {
            if (one.returnAt && !one.returning && (nowMs >= one.returnAt || (one.maxTravelX && ((one.vx > 0 && one.x >= one.maxTravelX) || (one.vx < 0 && one.x <= one.maxTravelX))))) {
                one.returning = true;
                one.vx = -one.vx;
            }
            one.x += one.vx * deltaMs;
            if (one.x < SHI_DATA.scene.laneLeftX - 50 || one.x > SHI_DATA.scene.laneRightX + 50) {
                return false;
            }
            const hitEnemy = session.enemies
                .filter(function (enemy) { return enemy.lane === one.lane && enemy.side === one.side; })
                .sort(function (a, b) {
                    return Math.abs(one.x - (SHI_DATA.scene.playerX + a.side * visualDistance(a, session))) - Math.abs(one.x - (SHI_DATA.scene.playerX + b.side * visualDistance(b, session)));
                })[0];
            if (!hitEnemy) {
                return true;
            }
            const enemyX = SHI_DATA.scene.playerX + hitEnemy.side * visualDistance(hitEnemy, session);
            if (Math.abs(one.x - enemyX) <= one.radius + 14) {
                damageEnemy(session, hitEnemy, one.damage, nowMs, one.reflected ? "reflect" : "projectile", enemyX);
                if (one.freezeMs > 0) {
                    applyEnemyControl(hitEnemy, nowMs, one.freezeMs);
                }
                if (one.controlMs > 0) {
                    applyEnemyControl(hitEnemy, nowMs, one.controlMs);
                }
                if (one.splash) {
                    damageEnemiesNearPoint(
                        session,
                        one.lane,
                        enemyX,
                        Math.max(24, one.splashRadius || 72),
                        Math.max(1, one.splashDamage || Math.max(1, one.damage - 1)),
                        nowMs,
                        one.reflected ? "reflect" : "projectile",
                        hitEnemy.id
                    );
                }
                one.remainingHits -= 1;
                if (one.remainingHits <= 0) {
                    return false;
                }
                one.x += one.vx * 18;
                return true;
            }
            return true;
        });

        session.enemyProjectiles = session.enemyProjectiles.filter(function (one) {
            if (one.activeAt > nowMs) {
                return true;
            }
            one.x += one.vx * deltaMs;
            if (one.x < SHI_DATA.scene.laneLeftX - 50 || one.x > SHI_DATA.scene.laneRightX + 50) {
                return false;
            }
            if (one.lane !== session.lane) {
                return true;
            }
            const blockSide = incomingProjectileSide(one);
            const sameSideBlock = session.block.side === blockSide && session.block.activeAt <= nowMs && session.block.until >= nowMs;
            const lockedPerfect = hasPerfectLock(session, blockSide, nowMs);
            const chainedPerfect = session.block.side === blockSide && session.block.perfectUntil >= nowMs;
            const touchingPlayer = Math.abs(one.x - SHI_DATA.scene.playerX) <= one.radius + SHI_DATA.visuals.playerBodyRadius;
            if (!touchingPlayer) {
                return true;
            }
            if (sameSideBlock || lockedPerfect || chainedPerfect) {
                const d = derivedStats(session, nowMs);
                const perfectWindowMs = effectivePerfectWindowMs(session);
                const perfect = lockedPerfect || chainedPerfect || (
                    session.block.startAt >= Math.max(0, one.createdAt - Math.round(perfectWindowMs * 0.45))
                    && session.block.startAt <= one.activeAt + Math.round(perfectWindowMs * 0.4)
                );
                if (perfect) {
                    const perfectLockUntil = computePerfectLockUntil(session, blockSide, session.lane, nowMs);
                    keepPerfectBlock(session, blockSide, nowMs, perfectLockUntil);
                    applyPerfectGuard(session, perfectLockUntil);
                    if (one.sourceEnemyId) {
                        const sourceEnemy = session.enemies.find(function (enemy) {
                            return enemy.id === one.sourceEnemyId;
                        });
                        if (sourceEnemy) {
                            grantEnemyOpening(sourceEnemy, nowMs, SHI_DATA.timings.perfectOpeningMs);
                        }
                    }
                    if (d.perfectSkillRefundMs > 0) {
                        session.skillReadyAt = Math.max(nowMs, session.skillReadyAt - d.perfectSkillRefundMs);
                    }
                    spawnBlockEffect(session, blockSide, session.lane, "perfect", "Reflect");
                    spawnProjectile(
                        session,
                        "player",
                        one.lane,
                        -one.side,
                        SHI_DATA.scene.playerX + (-one.side) * 30,
                        Math.abs(one.vx) * 1.35,
                        one.damage + 1,
                        one.radius + 1,
                        "#bfdbfe",
                        "#60a5fa",
                        true,
                        { remainingHits: 2 }
                    );
                    session.flashText = "反弹";
                    session.flashUntil = nowMs + SHI_DATA.timings.hitFlashDurationMs;
                    session.message = "完美格挡反弹了子弹。";
                    return false;
                }
                applyNormalBlockRecovery(session, nowMs + d.blockRecoveryMs);
                if (d.blockEnemySlowMs > 0) {
                    session.enemyAttackReadyAt = Math.max(session.enemyAttackReadyAt, nowMs + d.blockEnemySlowMs);
                }
                spawnBlockEffect(session, blockSide, session.lane, "block", "挡下");
                applyPlayerDamage(session, Math.max(1, Math.ceil(one.damage * (1 - d.blockReduction))), "普通格挡挡下了部分远程伤害。", nowMs, "projectile");
                return false;
            }
            if (session.perfectGuardUntil > nowMs) {
                return false;
            }
            applyPlayerDamage(session, one.damage, "被远程攻击命中。", nowMs, "projectile");
            return false;
        });
    }

    function updateEffects(session, nowMs) {
        const d = derivedStats(session, nowMs);
        session.meleeEffects = session.meleeEffects.filter(function (one) {
            return one.until > nowMs;
        });
        session.hitEffects = session.hitEffects.filter(function (one) {
            return one.until > nowMs;
        });
        if (d.auraDamage > 0 && (!session.lastAuraTickAt || nowMs - session.lastAuraTickAt >= Math.max(600, d.auraTickMs || 900))) {
            session.lastAuraTickAt = nowMs;
            damageEnemiesInBurst(session, nowMs, 150, d.auraDamage, "proc");
        }
        if (d.periodicShieldMs > 0 && session.shield <= 0 && nowMs - session.lastDamageAt >= d.periodicShieldMs) {
            session.shield = Math.max(session.shield, Math.round(d.periodicShieldAmount * d.shieldAmp));
        }
        if (session.attackPose && session.attackPose.until <= nowMs) {
            session.attackPose.side = 0;
        }
        if (session.spearComboUntil <= nowMs) {
            session.spearComboIndex = 0;
        }
        if (session.perfectLockUntil <= nowMs) {
            clearPerfectLock(session);
        }
        if (session.screenShakeUntil <= nowMs) {
            session.screenShakePower = 0;
        }
        if (session.flashUntil <= nowMs) {
            session.flashText = "";
        }
        if (session.status === "playing" && session.block.until <= nowMs && session.attackPose.until <= nowMs && session.flashUntil <= nowMs) {
            session.playerState = "待战";
        }
    }

    function renderRewardOverlay(overlay, session) {
        if (!session.pendingRewardOptions.length) {
            overlay.innerHTML = "";
            overlay.style.display = "none";
            overlay.setAttribute("data-render-key", "");
            return;
        }
        const renderKey = JSON.stringify({
            rewards: session.pendingRewardOptions,
            score: session.pendingRewardScore,
            replace: session.pendingReplaceEquipmentKey,
            equipped: session.equipmentKeys
        });
        overlay.style.display = "flex";
        if (overlay.getAttribute("data-render-key") === renderKey) {
            return;
        }
        overlay.setAttribute("data-render-key", renderKey);
        if (session.pendingReplaceEquipmentKey && SHI_DATA.equipments[session.pendingReplaceEquipmentKey]) {
            const replaceGain = equipmentReplaceScore(session);
            overlay.innerHTML = [
                '<div class="game-shi-panel">',
                "  <h3>替换装备</h3>",
                "  <p>装备栏已满。选择一件现有装备替换为 <strong>" + ctxEscape(SHI_DATA.equipments[session.pendingReplaceEquipmentKey].name) + "</strong>，并额外获得 " + replaceGain + " 积分。</p>",
                '  <div class="game-shi-replace-list">',
                session.equipmentKeys.map(function (key, index) {
                    return [
                        '<button type="button" class="game-shi-replace-btn" data-replace-index="' + index + '">',
                        "  " + ctxEscape(SHI_DATA.equipments[key].name),
                        '  <span>点击替换并获得 +' + replaceGain + " 积分</span>",
                        "</button>"
                    ].join("");
                }).join(""),
                "  </div>",
                "</div>"
            ].join("");
            return;
        }
        overlay.innerHTML = [
            '<div class="game-shi-panel">',
            "  <h3>随机掉落</h3>",
            "  <p>敌人随机掉落了一件战利品。你可以立刻拿走，也可以直接把它换成积分继续战斗。</p>",
            '  <div class="game-shi-reward-list">',
            session.pendingRewardOptions.map(function (item, index) {
                return [
                    '<button type="button" class="game-shi-reward-btn ' + ctxEscape(item.category) + '" data-reward-index="' + index + '">',
                    '  <span class="game-shi-mini">' + (item.category === "weapon" ? "武器" : (item.category === "equipment" ? "装备" : "强化")) + "</span>",
                    "  <strong>" + ctxEscape(item.name) + "</strong>",
                    "  <span>" + ctxEscape(item.desc) + "</span>",
                    "</button>"
                ].join("");
            }).join(""),
            "  </div>",
            '  <div class="game-shi-keyline"><span class="game-shi-keychip">点击卡片选择</span><span class="game-shi-keychip">最多携带 6 件装备</span></div>',
            '  <button type="button" class="game-shi-convert-btn" data-reward-convert="1"><strong>不要，换积分</strong><br><span>立刻获得 ' + session.pendingRewardScore + ' 积分，然后继续当前战斗。</span></button>',
            "</div>"
        ].join("");
    }

    function mountShi(savedPayload, ctx) {
        ensureShiStyles();

        const WIDTH = SHI_DATA.scene.width;
        const HEIGHT = SHI_DATA.scene.height;
        const PLAYER_X = SHI_DATA.scene.playerX;
        const LANE_Y = SHI_DATA.scene.laneY;

        const arcade = ctx.createArcadeShell(
            "士",
            "W / S 切换攻势或应势，A / D 朝左右攻击，Q / E 朝左右格挡，Shift 释放当前武器技能。",
            "这一版把上下路收束为单线中轴，重点验证左右攻防、双攻击模式和完美格挡反打是否成立。"
        );
        arcade.shell.classList.add("game-shi-shell");
        arcade.canvas.width = WIDTH;
        arcade.canvas.height = HEIGHT;
        const canvas = arcade.canvas;
        const draw = canvas.getContext("2d");
        const overlay = document.createElement("div");
        overlay.className = "game-shi-overlay";
        overlay.style.display = "none";
        arcade.canvasWrap.appendChild(overlay);

        let session = normalizeShiSession(savedPayload && savedPayload.state);
        let lastFrameMs = Date.now();
        let frameHandle = 0;
        let lastPersistAt = 0;

        ctx.setArcadeList(arcade.controls, [
            "单线中轴：你固定守在中间，所有敌人从左右两侧逼近，策略改成左右判断与距离控制。",
            "模式：W 切攻势，S 切应势。它们只影响当前武器采用哪种攻击方式，不再改变玩家位置。",
            "敌人节奏：同一时刻只有一侧真正进入出手主回合，另一侧最多先到压迫位逼近，等待接班。",
            "攻击：A 向左，D 向右。手枪会生成真实飞行子弹，近战武器会生成可见挥砍光效。",
            "格挡：Q 挡左、E 挡右。远程敌人会先靠近、闪光，再打出单发远程；圆圈或闪光出现时按一次就能锁定完美格挡。",
            "构筑：敌人会随机掉落武器、LOL 装备或基础强化，也可以直接把掉落换成积分。装备上限 6 件。"
        ]);

        function persist(force) {
            ctx.scheduleGameStateSave("shi", serializeShiSession(session), summarizeShiSession(session), { force: force });
        }

        function finalizeScore() {
            if (session.submittedScore) {
                return Promise.resolve();
            }
            session.submittedScore = true;
            return ctx.submitScore("shi", session.score, "solo", session.sessionKey, {
                wave: session.wave,
                kills: session.kills,
                weapon: session.currentWeaponKey,
                equipment_keys: session.equipmentKeys.slice(),
                elapsed_seconds: session.elapsedSeconds
            }).catch(function (error) {
                session.submittedScore = false;
                ctx.setStatus(error.message || "《士》积分提交失败。", true);
            });
        }

        function restartSession() {
            session = createShiSession();
            lastFrameMs = Date.now();
            lastPersistAt = 0;
            render();
            persist(true);
        }

        function drawProjectile(projectile, nowMs) {
            if (projectile.owner === "enemy" && projectile.activeAt > nowMs) {
                const chargeProgress = 1 - ((projectile.activeAt - nowMs) / Math.max(1, SHI_DATA.timings.projectileChargeMs));
                draw.strokeStyle = "rgba(253,224,71," + (0.12 + chargeProgress * 0.28).toFixed(2) + ")";
                draw.lineWidth = 2 + chargeProgress;
                draw.beginPath();
                draw.moveTo(projectile.sourceX, projectile.sourceY);
                draw.lineTo(PLAYER_X, projectile.sourceY);
                draw.stroke();
                draw.fillStyle = "#fef08a";
                draw.shadowBlur = 10;
                draw.shadowColor = "#facc15";
                draw.beginPath();
                draw.arc(projectile.sourceX, projectile.sourceY, 4 + chargeProgress * 2, 0, Math.PI * 2);
                draw.fill();
                draw.shadowBlur = 0;
                return;
            }
            const trailLength = projectile.owner === "player" ? 18 : 14;
            const trailX = projectile.x - Math.sign(projectile.vx || 1) * trailLength;
            const gradient = draw.createLinearGradient(projectile.x, projectile.y, trailX, projectile.y);
            gradient.addColorStop(0, projectile.glow);
            gradient.addColorStop(1, "rgba(255,255,255,0)");
            draw.strokeStyle = gradient;
            draw.lineWidth = projectile.radius * 1.6;
            draw.beginPath();
            draw.moveTo(projectile.x, projectile.y);
            draw.lineTo(trailX, projectile.y);
            draw.stroke();

            draw.shadowBlur = 14;
            draw.shadowColor = projectile.glow;
            draw.fillStyle = projectile.color;
            draw.beginPath();
            draw.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
            draw.fill();
            draw.shadowBlur = 0;
        }

        function drawMeleeEffect(effect, nowMs) {
            const total = Math.max(1, effect.until - effect.startAt);
            const progress = ctx.clamp((nowMs - effect.startAt) / total, 0, 1);
            const alpha = 1 - progress;
            draw.save();
            draw.strokeStyle = effect.color;
            draw.globalAlpha = alpha;
            draw.lineCap = "round";
            if (effect.shape === "stab" || effect.shape === "line") {
                const startX = effect.x + effect.side * 30;
                const endX = effect.x + effect.side * effect.reach * (0.68 + progress * 0.32);
                const spread = effect.shape === "line" ? 12 : 4;
                draw.lineWidth = effect.thickness * (0.9 + alpha * 0.25);
                draw.beginPath();
                draw.moveTo(startX, effect.y - spread);
                draw.lineTo(endX, effect.y);
                draw.lineTo(startX, effect.y + spread);
                draw.stroke();
                draw.strokeStyle = "#f8fafc";
                draw.lineWidth = Math.max(2, effect.thickness * 0.2);
                draw.beginPath();
                draw.moveTo(startX + effect.side * 8, effect.y);
                draw.lineTo(endX, effect.y);
                draw.stroke();
            } else {
                const startAngle = effect.side < 0 ? Math.PI * (0.62 - effect.arc) : Math.PI * (-0.12);
                const endAngle = effect.side < 0 ? Math.PI * 1.38 : Math.PI * (0.38 + effect.arc);
                draw.lineWidth = effect.thickness * alpha;
                draw.beginPath();
                draw.arc(effect.x, effect.y, effect.reach * (0.82 + progress * 0.18), startAngle, endAngle);
                draw.stroke();
                draw.strokeStyle = "#f8fafc";
                draw.lineWidth = Math.max(2, effect.thickness * 0.18 * alpha);
                draw.beginPath();
                draw.arc(effect.x, effect.y, effect.reach * (0.78 + progress * 0.18), startAngle, endAngle);
                draw.stroke();
            }
            draw.restore();
        }

        function drawHitEffect(effect, nowMs) {
            const total = Math.max(1, effect.until - effect.startAt);
            const progress = ctx.clamp((nowMs - effect.startAt) / total, 0, 1);
            const radius = 8 + progress * SHI_DATA.visuals.hitRingMaxRadius;
            const alpha = 1 - progress;
            draw.save();
            draw.globalAlpha = alpha;
            if (effect.shape === "shield") {
                draw.strokeStyle = effect.color;
                draw.lineWidth = effect.thickness || 6;
                draw.beginPath();
                draw.arc(
                    effect.x - effect.side * 6,
                    effect.y,
                    (effect.reach || 32) * (0.82 + progress * 0.22),
                    effect.side < 0 ? Math.PI * 0.68 : -Math.PI * 0.18,
                    effect.side < 0 ? Math.PI * 1.32 : Math.PI * 0.32
                );
                draw.stroke();
            } else if (effect.shape === "burst") {
                draw.strokeStyle = effect.color;
                draw.lineWidth = effect.thickness || 8;
                for (let ray = 0; ray < 5; ray += 1) {
                    const angle = (effect.side < 0 ? Math.PI : 0) + (-0.44 + ray * 0.22);
                    const inner = 12 + progress * 6;
                    const outer = (effect.reach || 44) * (0.6 + progress * 0.4);
                    draw.beginPath();
                    draw.moveTo(effect.x + Math.cos(angle) * inner, effect.y + Math.sin(angle) * inner);
                    draw.lineTo(effect.x + Math.cos(angle) * outer, effect.y + Math.sin(angle) * outer);
                    draw.stroke();
                }
            } else {
                draw.strokeStyle = "rgba(248,250,252," + alpha.toFixed(2) + ")";
                draw.lineWidth = 3;
                draw.beginPath();
                draw.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
                draw.stroke();
            }
            if (effect.text) {
                draw.fillStyle = effect.variant === "perfect" ? "#fde68a" : "rgba(248,250,252," + alpha.toFixed(2) + ")";
                draw.font = "12px 'Segoe UI', sans-serif";
                draw.textAlign = "center";
                draw.fillText(effect.text, effect.x, effect.y - 18 - progress * 8);
                draw.textAlign = "left";
            }
            draw.restore();
        }

        function shortHudText(text, limit) {
            const raw = String(text || "");
            if (raw.length <= limit) {
                return raw;
            }
            return raw.slice(0, Math.max(0, limit - 1)) + "…";
        }

        function wrapHudText(text, maxWidth, font) {
            const lines = [];
            const raw = String(text || "").replace(/\s+/g, " ").trim();
            if (!raw) {
                return [""];
            }
            draw.save();
            if (font) {
                draw.font = font;
            }
            let current = "";
            for (let index = 0; index < raw.length; index += 1) {
                const char = raw.charAt(index);
                const next = current + char;
                if (current && draw.measureText(next).width > maxWidth) {
                    lines.push(current);
                    current = char;
                } else {
                    current = next;
                }
            }
            if (current) {
                lines.push(current);
            }
            draw.restore();
            return lines;
        }

        function drawWrappedHudText(lines, x, y, lineHeight, font, color) {
            draw.fillStyle = color || "#e2e8f0";
            draw.font = font;
            lines.forEach(function (line, index) {
                draw.fillText(line, x, y + index * lineHeight);
            });
        }

        function drawHudCard(x, y, width, height, title, accent, drawBody) {
            draw.save();
            draw.fillStyle = "rgba(8,15,27,0.84)";
            draw.strokeStyle = "rgba(148,163,184,0.18)";
            draw.lineWidth = 1;
            draw.beginPath();
            draw.roundRect(x, y, width, height, 16);
            draw.fill();
            draw.stroke();
            draw.fillStyle = accent;
            draw.fillRect(x + 12, y + 12, 42, 3);
            draw.fillStyle = "#e2e8f0";
            draw.font = "bold 12px 'Segoe UI', sans-serif";
            draw.fillText(title, x + 12, y + 32);
            draw.strokeStyle = "rgba(148,163,184,0.14)";
            draw.beginPath();
            draw.moveTo(x + 12, y + 42);
            draw.lineTo(x + width - 12, y + 42);
            draw.stroke();
            drawBody(x + 12, y + 54, width - 24);
            draw.restore();
        }

        function drawHudLine(x, y, label, value, valueColor) {
            draw.fillStyle = "rgba(148,163,184,0.88)";
            draw.font = "11px Consolas, monospace";
            draw.fillText(label, x, y);
            draw.fillStyle = valueColor || "#f8fafc";
            draw.font = "12px 'Segoe UI', sans-serif";
            draw.fillText(value, x + 52, y);
        }

        function drawHudGauge(x, y, width, label, ratio, text, color) {
            draw.fillStyle = "rgba(148,163,184,0.78)";
            draw.font = "11px Consolas, monospace";
            draw.fillText(label, x, y + 9);
            draw.fillStyle = "rgba(15,23,42,0.92)";
            draw.fillRect(x + 38, y, width, 10);
            draw.fillStyle = color;
            draw.fillRect(x + 38, y, width * ctx.clamp(ratio, 0, 1), 10);
            draw.strokeStyle = "rgba(248,250,252,0.12)";
            draw.strokeRect(x + 38, y, width, 10);
            draw.fillStyle = "#e2e8f0";
            draw.font = "11px 'Segoe UI', sans-serif";
            draw.fillText(text, x + 46 + width, y + 9);
        }

        function drawBattleHud(nowMs, weapon, stepAdvice) {
            const activeMode = currentWeaponMode(session, weapon);
            const leftPressure = sidePressureSummary(session, -1, nowMs);
            const rightPressure = sidePressureSummary(session, 1, nowMs);
            const attackCooldownTotal = Math.max(1, derivedStats(session, nowMs).attackCooldownMs);
            const attackCooldownLeft = Math.max(0, session.attackReadyAt - nowMs);
            const blockActiveLeft = session.block.until > nowMs ? (session.block.until - nowMs) : 0;
            const blockRecoveryLeft = session.blockReadyAt > nowMs && blockActiveLeft <= 0 ? (session.blockReadyAt - nowMs) : 0;
            const blockRatio = blockActiveLeft > 0
                ? 1 - (blockActiveLeft / Math.max(1, SHI_DATA.timings.blockStartupMs + SHI_DATA.timings.blockDurationMs))
                : (blockRecoveryLeft > 0 ? 1 - (blockRecoveryLeft / Math.max(1, SHI_DATA.timings.blockRecoveryMs)) : 1);
            const skillCooldownTotal = Math.max(1, currentWeapon(session).skillCooldownMs);
            const skillCooldownLeft = Math.max(0, session.skillReadyAt - nowMs);
            const stepCooldownTotal = Math.max(1, SHI_DATA.timings.stepShiftCooldownMs);
            const stepCooldownLeft = Math.max(0, session.stepReadyAt - nowMs);
            const hudMargin = 18;
            const hudGap = 22;
            const cardWidth = Math.max(290, Math.min(360, Math.round((WIDTH - hudMargin * 2 - hudGap) / 2)));
            const leftX = hudMargin;
            const rightX = WIDTH - hudMargin - cardWidth;
            const topY = 18;
            const activeDescLines = wrapHudText(activeMode.desc, cardWidth - 24, "12px 'Segoe UI', sans-serif");
            const adviceLines = wrapHudText(stepAdvice.reason, cardWidth - 24, "12px 'Segoe UI', sans-serif");
            const openingEnemies = session.enemies.filter(function (enemy) {
                return enemyOpeningActive(enemy, nowMs);
            }).length;
            const topHeight = Math.max(140, 136 + (Math.max(activeDescLines.length, adviceLines.length) - 1) * 16);
            const hudMessageLines = wrapHudText(session.message || stepAdvice.reason, cardWidth - 24, "13px 'Segoe UI', sans-serif");
            const infoHeight = 150 + hudMessageLines.length * 18;
            const bottomHeight = Math.max(154, infoHeight);
            const bottomY = HEIGHT - hudMargin - bottomHeight;
            drawHudCard(leftX, topY, cardWidth, topHeight, "武器 / 模式", weapon.color, function (contentX, contentY, contentWidth) {
                draw.fillStyle = "#f8fafc";
                draw.font = "bold 15px 'Segoe UI', sans-serif";
                draw.fillText(weapon.name + " · " + activeMode.name, contentX, contentY + 2);
                drawHudLine(contentX, contentY + 24, "触发", currentWeaponModeTrigger(session), "#bfdbfe");
                drawHudLine(contentX, contentY + 44, "技能", weapon.skillLabel, "#fde68a");
                drawWrappedHudText(activeDescLines, contentX, contentY + 66, 16, "12px 'Segoe UI', sans-serif", "rgba(203,213,225,0.94)");
            });
            drawHudCard(rightX, topY, cardWidth, topHeight, "左右压力", "#38bdf8", function (contentX, contentY) {
                drawHudLine(contentX, contentY + 2, "左侧", shortHudText(leftPressure, 20), "#f8fafc");
                drawHudLine(contentX, contentY + 24, "右侧", shortHudText(rightPressure, 20), "#f8fafc");
                drawHudLine(contentX, contentY + 46, "建议", stepAdvice.label, "#86efac");
                drawWrappedHudText(adviceLines, contentX, contentY + 68, 16, "12px 'Segoe UI', sans-serif", "rgba(203,213,225,0.92)");
            });
            drawHudCard(leftX, bottomY, cardWidth, bottomHeight, "冷却 / 状态", "#f59e0b", function (contentX, contentY) {
                drawHudGauge(contentX, contentY, 116, "ATK", attackCooldownLeft > 0 ? 1 - (attackCooldownLeft / attackCooldownTotal) : 1, attackCooldownLeft > 0 ? (Math.ceil(attackCooldownLeft / 100) / 10).toFixed(1) + "s" : "ready", attackCooldownLeft > 0 ? "#f59e0b" : "#22c55e");
                drawHudGauge(contentX, contentY + 18, 116, "BLK", blockRatio, blockActiveLeft > 0 ? "guard" : (blockRecoveryLeft > 0 ? (Math.ceil(blockRecoveryLeft / 100) / 10).toFixed(1) + "s" : "ready"), blockActiveLeft > 0 ? ((session.block.perfectUntil > nowMs || session.perfectLockUntil > nowMs) ? "#facc15" : "#38bdf8") : (blockRecoveryLeft > 0 ? "#f97316" : "#22c55e"));
                drawHudGauge(contentX, contentY + 36, 116, "SKL", skillCooldownLeft > 0 ? 1 - (skillCooldownLeft / skillCooldownTotal) : 1, skillCooldownLeft > 0 ? Math.ceil(skillCooldownLeft / 1000) + "s" : "ready", skillCooldownLeft > 0 ? "#a78bfa" : "#22c55e");
                drawHudGauge(contentX, contentY + 54, 116, "MOD", stepCooldownLeft > 0 ? 1 - (stepCooldownLeft / stepCooldownTotal) : 1, stepCooldownLeft > 0 ? (Math.ceil(stepCooldownLeft / 100) / 10).toFixed(1) + "s" : "ready", stepCooldownLeft > 0 ? "#22d3ee" : "#22c55e");
                draw.fillStyle = "rgba(226,232,240,0.94)";
                draw.font = "12px 'Segoe UI', sans-serif";
                draw.fillText("状态：" + shortHudText(session.playerState || "待战", 16), contentX, contentY + 82);
                draw.fillText("连段：" + currentModeComboHud(session, nowMs), contentX, contentY + 100);
            });
            drawHudCard(rightX, bottomY, cardWidth, bottomHeight, "战场提示", "#22c55e", function (contentX, contentY) {
                drawWrappedHudText(hudMessageLines, contentX, contentY + 2, 18, "13px 'Segoe UI', sans-serif", "#f8fafc");
                const metricsY = contentY + 22 + hudMessageLines.length * 18;
                drawHudLine(contentX, metricsY, "模式", stepLabel(session.stepLevel), "#67e8f9");
                drawHudLine(contentX, metricsY + 20, "窗口", effectivePerfectWindowMs(session) + "ms", "#fde68a");
                drawHudLine(contentX, metricsY + 40, "破绽", String(openingEnemies), "#fde68a");
                drawHudLine(contentX, metricsY + 60, "实体", session.playerProjectiles.length + " / " + session.enemyProjectiles.length + " / " + session.meleeEffects.length, "#cbd5e1");
            });
        }

        function drawEnemy(enemy, nowMs, sideRanks) {
            const config = enemyConfig(enemy.type);
            const role = enemyRole(enemy);
            const style = enemyStyle(enemy);
            const rankKey = String(enemy.side);
            const queueRank = sideRanks[rankKey]++;
            const stepBias = playerDistanceBias(session, 1);
            let distance = Math.max(76, config.visualDistance + queueRank * 72 + stepBias);
            let x = PLAYER_X + enemy.side * distance;
            if (enemy.state === "approach" && enemy.approachStartAt > 0 && enemy.approachEndAt > enemy.approachStartAt) {
                const progress = ctx.clamp((nowMs - enemy.approachStartAt) / Math.max(1, enemy.approachEndAt - enemy.approachStartAt), 0, 1);
                distance = Math.max(76, config.visualDistance + (config.readyDistance - config.visualDistance) * progress + stepBias);
                x = PLAYER_X + enemy.side * distance;
            } else if (enemy.state === "pressure") {
                distance = Math.max(76, (config.pressureDistance || 204) + queueRank * 44 + stepBias);
                x = PLAYER_X + enemy.side * distance;
            } else if (enemy.state === "telegraph" && enemy.recoverAt === 0) {
                distance = Math.max(76, config.readyDistance + stepBias);
                x = PLAYER_X + enemy.side * distance;
            } else if (enemy.recoverAt > nowMs) {
                const recoverTotal = Math.max(1, enemyConfig(enemy.type).recoverMs);
                const attackProgress = ctx.clamp((nowMs - (enemy.attackStartedAt || nowMs)) / recoverTotal, 0, 1);
                const strikeBase = Math.max(76, config.strikeDistance + stepBias);
                const lungeOffset = attackProgress < 0.34
                    ? (strikeBase - ((strikeBase + 10) * (attackProgress / 0.34)))
                    : (-10 + ((strikeBase + 26) * ((attackProgress - 0.34) / 0.66)));
                x = PLAYER_X + enemy.side * lungeOffset;
                distance = Math.abs(lungeOffset);
            } else {
                x = PLAYER_X + enemy.side * distance;
            }
            const y = LANE_Y[0];
            const bandText = enemyDistanceBand(distance);
            if (enemy.state === "approach") {
                draw.strokeStyle = "rgba(148,163,184,0.1)";
                draw.lineWidth = 1.5;
                draw.setLineDash([8, 8]);
                draw.beginPath();
                draw.moveTo(enemy.side < 0 ? SHI_DATA.scene.laneLeftX : SHI_DATA.scene.laneRightX, y + 44);
                draw.lineTo(x, y + 44);
                draw.stroke();
                draw.setLineDash([]);
            } else if (enemy.state === "pressure") {
                draw.strokeStyle = "rgba(96,165,250,0.22)";
                draw.lineWidth = 2;
                draw.setLineDash([6, 8]);
                draw.beginPath();
                draw.moveTo(enemy.side < 0 ? SHI_DATA.scene.laneLeftX : SHI_DATA.scene.laneRightX, y + 44);
                draw.lineTo(x, y + 44);
                draw.stroke();
                draw.setLineDash([]);
                draw.strokeStyle = "rgba(96,165,250,0.6)";
                draw.lineWidth = 3;
                draw.beginPath();
                draw.arc(x, y, 20, 0, Math.PI * 2);
                draw.stroke();
            }
            if (enemy.state === "telegraph" && enemy.recoverAt === 0) {
                const total = Math.max(1, enemy.strikeAt - enemy.telegraphStartAt);
                const progress = ctx.clamp((nowMs - enemy.telegraphStartAt) / total, 0, 1);
                if (role === "ranged") {
                    draw.strokeStyle = "rgba(250,204,21," + (0.22 + progress * 0.2).toFixed(2) + ")";
                    draw.lineWidth = 2 + progress * 1.2;
                    draw.beginPath();
                    draw.moveTo(x, y);
                    draw.lineTo(PLAYER_X, y);
                    draw.stroke();
                    draw.fillStyle = "#fde68a";
                    draw.beginPath();
                    draw.arc(x, y, 8 + progress * 4, 0, Math.PI * 2);
                    draw.fill();
                } else {
                    const pulse = 0.55 + 0.45 * Math.sin(nowMs * 0.02);
                    if (style === "heavy") {
                        draw.strokeStyle = "rgba(245,158,11," + (0.28 + progress * 0.18).toFixed(2) + ")";
                        draw.lineWidth = 5 + progress * 1.8;
                        draw.beginPath();
                        draw.arc(x, y, SHI_DATA.visuals.telegraphPulseRadius + pulse * 12, 0, Math.PI * 2);
                        draw.stroke();
                    } else if (style === "feint" && !enemy.feintUsed) {
                        draw.strokeStyle = "rgba(167,139,250," + (0.26 + progress * 0.18).toFixed(2) + ")";
                        draw.lineWidth = 4;
                        draw.setLineDash([6, 6]);
                        draw.beginPath();
                        draw.arc(x, y, SHI_DATA.visuals.telegraphPulseRadius + pulse * 8, 0, Math.PI * 2);
                        draw.stroke();
                        draw.setLineDash([]);
                    } else {
                        draw.strokeStyle = "rgba(248,113,113," + (0.24 + progress * 0.18).toFixed(2) + ")";
                        draw.lineWidth = 4 + progress * 1.4;
                        draw.beginPath();
                        draw.arc(x, y, SHI_DATA.visuals.telegraphPulseRadius + pulse * 10, 0, Math.PI * 2);
                        draw.stroke();
                    }
                }
            }
            if (enemyOpeningActive(enemy, nowMs)) {
                draw.strokeStyle = "rgba(250,204,21," + (0.32 + 0.22 * Math.sin(nowMs * 0.03)).toFixed(2) + ")";
                draw.lineWidth = 4;
                draw.beginPath();
                draw.arc(x, y, SHI_DATA.visuals.telegraphPulseRadius + 14, 0, Math.PI * 2);
                draw.stroke();
            }
            draw.fillStyle = enemy.state === "telegraph" ? (config.telegraphColor || "#f87171") : config.color;
            draw.beginPath();
            draw.arc(x, y - 18, 11, 0, Math.PI * 2);
            draw.fill();
            draw.beginPath();
            draw.moveTo(x, y + 26);
            draw.lineTo(x - 16, y + 2);
            draw.lineTo(x + 16, y + 2);
            draw.closePath();
            draw.fill();
            draw.fillStyle = "#e2e8f0";
            draw.fillRect(x - 20, y + 34, 40, 4);
            draw.fillStyle = role === "ranged" ? "#fde68a" : config.color;
            draw.fillRect(x - 20, y + 34, 40 * (enemy.hp / enemy.maxHp), 4);
            draw.fillStyle = "rgba(248,250,252,0.92)";
            draw.font = "11px Consolas, monospace";
            draw.textAlign = "center";
            draw.fillText(String(enemy.hp) + " · " + enemyBadge(enemy) + (enemy.state === "pressure" ? (bandText + "压") : bandText), x, y + 30);
            if (enemyOpeningActive(enemy, nowMs)) {
                draw.fillStyle = "#fde68a";
                draw.font = "bold 10px Consolas, monospace";
                draw.fillText("破绽", x, y - 40);
            }
            draw.textAlign = "left";
        }

        function drawScene(nowMs) {
            draw.clearRect(0, 0, WIDTH, HEIGHT);
            const shakePower = session.screenShakeUntil > nowMs ? session.screenShakePower * (1 - ctx.clamp((session.screenShakeUntil - nowMs) / SHI_DATA.timings.screenShakeDurationMs, 0, 1)) : 0;
            const shakeX = shakePower ? Math.sin(nowMs * 0.045) * shakePower * 0.9 : 0;
            const shakeY = shakePower ? Math.cos(nowMs * 0.052) * shakePower * 0.6 : 0;
            draw.save();
            draw.translate(shakeX, shakeY);
            draw.fillStyle = SHI_DATA.visuals.backgroundTop;
            draw.fillRect(-12, -12, WIDTH + 24, HEIGHT + 24);
            const weapon = currentWeapon(session);
            const stepAdvice = tacticalStepAdvice(session, nowMs);

            for (let star = 0; star < 42; star += 1) {
                draw.fillStyle = "rgba(191,219,254," + (0.08 + (star % 6) * 0.03) + ")";
                draw.fillRect((star * 97 + nowMs * 0.015) % WIDTH, 40 + (star * 47) % HEIGHT, 2, 2);
            }

            const fightY = LANE_Y[0];
            draw.strokeStyle = SHI_DATA.visuals.laneActive;
            draw.lineWidth = 7;
            draw.beginPath();
            draw.moveTo(SHI_DATA.scene.laneLeftX, fightY);
            draw.lineTo(SHI_DATA.scene.laneRightX, fightY);
            draw.stroke();
            draw.strokeStyle = "rgba(71,85,105,.4)";
            draw.lineWidth = 1;
            draw.setLineDash([10, 10]);
            draw.beginPath();
            draw.moveTo(PLAYER_X, 66);
            draw.lineTo(PLAYER_X, HEIGHT - 56);
            draw.stroke();
            draw.setLineDash([]);
            [
                { level: 1, key: "W", label: "攻势", x: PLAYER_X - 58 },
                { level: 0, key: "S", label: "应势", x: PLAYER_X + 58 }
            ].forEach(function (mode) {
                const markerX = mode.x;
                const isRecommended = stepAdvice.level === mode.level;
                if (isRecommended) {
                    draw.strokeStyle = normalizedModeLevel(session.stepLevel || 0) === mode.level ? "rgba(74,222,128,.9)" : "rgba(250,204,21,.86)";
                    draw.lineWidth = 2;
                    draw.beginPath();
                    draw.arc(markerX, fightY + 94, normalizedModeLevel(session.stepLevel || 0) === mode.level ? 13 : 11, 0, Math.PI * 2);
                    draw.stroke();
                    draw.fillStyle = normalizedModeLevel(session.stepLevel || 0) === mode.level ? "#86efac" : "#fde68a";
                    draw.font = "bold 10px Consolas, monospace";
                    draw.textAlign = "center";
                    draw.fillText("荐", markerX, fightY + 81);
                }
                draw.fillStyle = normalizedModeLevel(session.stepLevel || 0) === mode.level ? "#67e8f9" : "rgba(148,163,184,.45)";
                draw.beginPath();
                draw.arc(markerX, fightY + 94, normalizedModeLevel(session.stepLevel || 0) === mode.level ? 8 : 6, 0, Math.PI * 2);
                draw.fill();
                draw.fillStyle = normalizedModeLevel(session.stepLevel || 0) === mode.level ? "#e0f2fe" : "rgba(148,163,184,.9)";
                draw.font = "12px Consolas, monospace";
                draw.textAlign = "center";
                draw.fillText(mode.key + " " + mode.label, markerX, fightY + 116);
            });
            draw.fillStyle = "rgba(148,163,184,.86)";
            draw.font = "12px Consolas, monospace";
            draw.fillText("中轴", 36, fightY + 4);
            draw.fillText("模式", PLAYER_X - 18, fightY + 72);

            const leftIncoming = session.enemies.some(function (enemy) {
                return enemy.side === -1 && enemy.state === "approach";
            });
            const rightIncoming = session.enemies.some(function (enemy) {
                return enemy.side === 1 && enemy.state === "approach";
            });
            if (leftIncoming) {
                draw.fillStyle = "rgba(248,250,252,0.28)";
                draw.font = "bold 26px 'Segoe UI', sans-serif";
                draw.fillText("<<<", 10, HEIGHT / 2);
            }
            if (rightIncoming) {
                draw.fillStyle = "rgba(248,250,252,0.28)";
                draw.font = "bold 26px 'Segoe UI', sans-serif";
                draw.fillText(">>>", WIDTH - 58, HEIGHT / 2);
            }

            if (weapon.kind === "melee") {
                const comboPreview = weapon.key === "spear" ? currentSpearCombo(session, nowMs).step : null;
                const previewRange = effectiveMeleeRange(session, weapon, comboPreview ? comboPreview.range : weapon.range);
                [-1, 1].forEach(function (side) {
                    const reachX = PLAYER_X + side * previewRange;
                    const nearest = nearestDirectionalEnemies(session, side, 9999)[0];
                    const inReach = Boolean(nearest && visualDistance(nearest, session) <= previewRange);
                    draw.strokeStyle = inReach ? "rgba(74,222,128,.42)" : "rgba(148,163,184,.22)";
                    draw.lineWidth = inReach ? 4 : 2;
                    draw.setLineDash([10, 8]);
                    draw.beginPath();
                    draw.moveTo(PLAYER_X, fightY + 24);
                    draw.lineTo(reachX, fightY + 24);
                    draw.stroke();
                    draw.setLineDash([]);
                    draw.fillStyle = inReach ? "rgba(134,239,172,.95)" : "rgba(148,163,184,.75)";
                    draw.beginPath();
                    draw.arc(reachX, fightY + 24, inReach ? 4 : 3, 0, Math.PI * 2);
                    draw.fill();
                });
            }

            session.meleeEffects.forEach(function (effect) {
                drawMeleeEffect(effect, nowMs);
            });

            session.playerProjectiles.forEach(function (projectile) {
                drawProjectile(projectile, nowMs);
            });
            session.enemyProjectiles.forEach(function (projectile) {
                drawProjectile(projectile, nowMs);
            });

            const sideRanks = { "-1": 0, "1": 0 };
            session.enemies.forEach(function (enemy) {
                drawEnemy(enemy, nowMs, sideRanks);
            });

            session.hitEffects.forEach(function (effect) {
                drawHitEffect(effect, nowMs);
            });

            const pose = session.attackPose && session.attackPose.until > nowMs ? session.attackPose : null;
            const poseProgress = pose ? 1 - ctx.clamp((pose.until - nowMs) / Math.max(1, pose.until - pose.startAt), 0, 1) : 0;
            const playerY = LANE_Y[0];
            const playerX = PLAYER_X + (pose ? pose.side * Math.sin(poseProgress * Math.PI) * (pose.distance || 10) : 0);
            const weaponLengthMap = {
                dagger: 24,
                spear: 44,
                katana: 36,
                hammer: 30,
                pistol: 34,
                shotgun: 42,
                crossbow: 38,
                sniper: 46,
                boomerang: 28,
                axe: 36,
                lance: 46,
                chainblade: 40,
                dualblade: 28,
                cannon: 48,
                grenade: 44,
                minigun: 52,
                thunderbook: 30,
                icewandweapon: 36,
                fireorb: 34,
                trinity: 34
            };
            const weaponThicknessMap = {
                dagger: 8,
                spear: 5,
                katana: 8,
                hammer: 12,
                pistol: 6,
                shotgun: 9,
                crossbow: 5,
                sniper: 4,
                boomerang: 10,
                axe: 8,
                lance: 4,
                chainblade: 7,
                dualblade: 6,
                cannon: 12,
                grenade: 11,
                minigun: 7,
                thunderbook: 12,
                icewandweapon: 6,
                fireorb: 8,
                trinity: 9
            };
            const weaponLength = weaponLengthMap[weapon.key] || 34;
            const weaponThickness = weaponThicknessMap[weapon.key] || 6;
            const weaponSide = pose && pose.side !== 0 ? pose.side : 1;
            draw.beginPath();
            draw.fillStyle = session.shield > 0 ? "#93c5fd" : "#f8fafc";
            draw.arc(playerX, playerY, SHI_DATA.visuals.playerBodyRadius, 0, Math.PI * 2);
            draw.fill();
            draw.strokeStyle = normalizedModeLevel(session.stepLevel || 0) >= 1 ? "rgba(251,146,60,.7)" : "rgba(103,232,249,.72)";
            draw.lineWidth = 3;
            draw.beginPath();
            draw.arc(playerX, playerY, 30, 0, Math.PI * 2);
            draw.stroke();
            draw.save();
            draw.translate(playerX, playerY);
            if (pose) {
                draw.rotate(weaponSide * (weapon.kind === "ranged" ? 0.12 : 0.22) * Math.sin(poseProgress * Math.PI));
            }
            draw.fillStyle = weapon.color;
            draw.fillRect(weaponSide * 16, -weaponThickness / 2, weaponSide * weaponLength, weaponThickness);
            if (weapon.kind === "melee") {
                draw.fillRect(weaponSide * (12 + weaponLength), -2, weaponSide * 8, 4);
            }
            draw.restore();
            draw.fillStyle = "#0f172a";
            draw.beginPath();
            draw.arc(playerX, playerY - 28, SHI_DATA.visuals.playerIconRadius, 0, Math.PI * 2);
            draw.fill();

            if (session.block.until > nowMs && session.block.side !== 0) {
                const blockReady = session.block.activeAt <= nowMs;
                draw.strokeStyle = blockReady
                    ? (session.block.side < 0 ? "#a5b4fc" : "#67e8f9")
                    : "rgba(148,163,184,0.7)";
                draw.lineWidth = 7;
                draw.beginPath();
                draw.arc(
                    playerX,
                    playerY,
                    SHI_DATA.visuals.blockArcRadius,
                    session.block.side < 0 ? Math.PI * 0.65 : -Math.PI * 0.15,
                    session.block.side < 0 ? Math.PI * 1.35 : Math.PI * 0.35
                );
                draw.stroke();
            }

            const attackCooldownTotal = Math.max(1, derivedStats(session, nowMs).attackCooldownMs);
            const attackCooldownLeft = Math.max(0, session.attackReadyAt - nowMs);
            const attackCooldownRatio = attackCooldownLeft > 0 ? 1 - (attackCooldownLeft / attackCooldownTotal) : 1;
            const blockActiveTotal = Math.max(1, SHI_DATA.timings.blockStartupMs + SHI_DATA.timings.blockDurationMs);
            const blockRecoveryTotal = Math.max(1, SHI_DATA.timings.blockRecoveryMs);
            const blockActiveLeft = session.block.until > nowMs ? (session.block.until - nowMs) : 0;
            const blockRecoveryLeft = session.blockReadyAt > nowMs && blockActiveLeft <= 0 ? (session.blockReadyAt - nowMs) : 0;
            const blockRatio = blockActiveLeft > 0
                ? (1 - (blockActiveLeft / blockActiveTotal))
                : (blockRecoveryLeft > 0 ? 1 - (blockRecoveryLeft / blockRecoveryTotal) : 1);
            const barX = playerX - 28;
            const attackBarY = playerY - 56;
            const blockBarY = playerY - 46;
            draw.fillStyle = "rgba(15,23,42,0.82)";
            draw.fillRect(barX, attackBarY, 56, 5);
            draw.fillRect(barX, blockBarY, 56, 5);
            draw.fillStyle = attackCooldownLeft > 0 ? "#f59e0b" : "#22c55e";
            draw.fillRect(barX, attackBarY, 56 * attackCooldownRatio, 5);
                draw.fillStyle = blockActiveLeft > 0
                ? (session.block.activeAt > nowMs ? "#94a3b8" : ((session.block.perfectUntil > nowMs || session.perfectLockUntil > nowMs) ? "#facc15" : "#38bdf8"))
                : (blockRecoveryLeft > 0 ? "#f97316" : "#22c55e");
            draw.fillRect(barX, blockBarY, 56 * blockRatio, 5);
            draw.strokeStyle = "rgba(248,250,252,0.18)";
            draw.lineWidth = 1;
            draw.strokeRect(barX, attackBarY, 56, 5);
            draw.strokeRect(barX, blockBarY, 56, 5);
            draw.fillStyle = "rgba(226,232,240,0.85)";
            draw.font = "10px Consolas, monospace";
            draw.fillText("ATK", barX - 22, attackBarY + 4);
            draw.fillText("BLK", barX - 22, blockBarY + 4);

            if (session.hurtFlashUntil > nowMs) {
                draw.fillStyle = "rgba(248,113,113," + (0.04 + (session.hurtFlashUntil - nowMs) / SHI_DATA.timings.hurtFlashDurationMs * 0.08).toFixed(2) + ")";
                draw.fillRect(-12, -12, WIDTH + 24, HEIGHT + 24);
            }

            if (session.incomingFlashUntil > nowMs) {
                const edgeAlpha = 0.05 + 0.08 * ctx.clamp((session.incomingFlashUntil - nowMs) / SHI_DATA.timings.edgeFlashDurationMs, 0, 1);
                const edgeWidth = SHI_DATA.visuals.edgeWarningWidth;
                draw.fillStyle = "rgba(239,68,68," + edgeAlpha.toFixed(2) + ")";
                draw.fillRect(0, 0, WIDTH, edgeWidth);
                draw.fillRect(0, HEIGHT - edgeWidth, WIDTH, edgeWidth);
                draw.fillRect(0, 0, edgeWidth, HEIGHT);
                draw.fillRect(WIDTH - edgeWidth, 0, edgeWidth, HEIGHT);
            }

            if (session.flashUntil > nowMs && session.flashText) {
                draw.fillStyle = "#f8fafc";
                draw.font = "bold 24px 'Segoe UI', sans-serif";
                draw.textAlign = "center";
                draw.fillText(session.flashText, PLAYER_X, 78);
                draw.textAlign = "left";
            }
            draw.restore();
            drawBattleHud(nowMs, weapon, stepAdvice);
        }

        function render() {
            const nowMs = Date.now();
            syncClock(session);
            drawScene(nowMs);
            ctx.setArcadeStats(arcade.statGrid, [
                { label: "压强", value: String(Math.max(1, session.wave || 1)) },
                { label: "生命", value: session.hp + " / " + session.maxHp },
                { label: "积分", value: String(session.score) },
                { label: "武器", value: currentWeapon(session).name },
                { label: "击杀", value: String(session.kills) },
                { label: "用时", value: ctx.formatSeconds(session.elapsedSeconds) }
            ]);
            const nowDerived = derivedStats(session, nowMs);
            const current = currentWeapon(session);
            const activeMode = currentWeaponMode(session, current);
            const standbyMode = alternateWeaponMode(session, current);
            const modeTrigger = currentWeaponModeTrigger(session);
            const standbyTrigger = currentWeaponModeKey(session) === "advance" ? "S 应势" : "W 攻势";
            const stepLeft = Math.max(0, Math.ceil((session.stepReadyAt - nowMs) / 100) / 10);
            const skillLeft = Math.max(0, Math.ceil((session.skillReadyAt - nowMs) / 1000));
            const attackLeft = Math.max(0, Math.ceil((session.attackReadyAt - nowMs) / 100) / 10);
            const blockLeft = Math.max(0, Math.ceil((session.blockReadyAt - nowMs) / 100) / 10);
            const perfectWindowNow = effectivePerfectWindowMs(session);
            const leftPressure = sidePressureSummary(session, -1, nowMs);
            const rightPressure = sidePressureSummary(session, 1, nowMs);
            const stepAdvice = tacticalStepAdvice(session, nowMs);
            const openingEnemies = session.enemies.filter(function (enemy) {
                return enemyOpeningActive(enemy, nowMs);
            }).length;
            const comboHud = currentModeComboHud(session, nowMs);
            const comboFatigue = comboHud === "未连段" ? 0 : Math.max(0, Number(session.modeComboStreak || 0) - 2);
            const comboWindowLeft = session.modeComboUntil > nowMs ? (Math.ceil((session.modeComboUntil - nowMs) / 100) / 10).toFixed(1) + "s" : "0.0s";
            const comboTempo = comboHud === "未连段" ? "待连段" : (comboFatigue > 0 ? ("疲劳 +" + comboFatigue) : "稳定");
            const mejaisOwned = session.equipmentKeys.indexOf("mejais") >= 0;
            const railHtml = [
                '<div class="game-shi-rail">',
                '  <section class="game-shi-rail-section">',
                '    <div class="game-shi-rail-title">武器</div>',
                '    <div class="game-shi-weapon-grid">',
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">名称</span><span class="game-shi-kv-value">' + ctxEscape(current.name) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">类型</span><span class="game-shi-kv-value">' + (current.kind === "melee" ? "近战" : "远程") + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">当前模式</span><span class="game-shi-kv-value">' + ctxEscape(activeMode.name) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">当前连段</span><span class="game-shi-kv-value">' + ctxEscape(comboHud) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">切换方式</span><span class="game-shi-kv-value">' + ctxEscape(modeTrigger) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">节奏状态</span><span class="game-shi-kv-value">' + ctxEscape(comboTempo) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">技能</span><span class="game-shi-kv-value">' + ctxEscape(current.skillLabel) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">技能冷却</span><span class="game-shi-kv-value">' + skillLeft + "s</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">连段窗口</span><span class="game-shi-kv-value">' + comboWindowLeft + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">伤害 / 攻速</span><span class="game-shi-kv-value">' + nowDerived.attackDamage + " / " + (1000 / nowDerived.attackCooldownMs).toFixed(2) + "/s</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">场上实体</span><span class="game-shi-kv-value">' + session.playerProjectiles.length + " / " + session.enemyProjectiles.length + " / " + session.meleeEffects.length + "</span></div>",
                "    </div>",
                '    <div class="game-shi-mode-card active">',
                '      <div class="game-shi-mode-title"><span>' + ctxEscape(activeMode.name) + '</span><span class="game-shi-mode-trigger">' + ctxEscape(modeTrigger) + "</span></div>",
                '      <div class="game-shi-mode-desc">' + ctxEscape(activeMode.desc) + "</div>",
                "    </div>",
                '    <div class="game-shi-mode-card">',
                '      <div class="game-shi-mode-title"><span>' + ctxEscape(standbyMode.name) + '</span><span class="game-shi-mode-trigger">' + ctxEscape(standbyTrigger) + "</span></div>",
                '      <div class="game-shi-mode-desc">' + ctxEscape(standbyMode.desc) + "</div>",
                "    </div>",
                '    <div class="game-shi-kv"><span class="game-shi-kv-label">技能说明</span><span class="game-shi-kv-value">' + ctxEscape(current.skillDescription) + "</span></div>",
                "  </section>",
                '  <section class="game-shi-rail-section">',
                '    <div class="game-shi-rail-title">玩家</div>',
                '    <div class="game-shi-player-grid">',
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">生命 / 护盾</span><span class="game-shi-kv-value">' + session.hp + " / " + session.maxHp + ' · 盾 ' + session.shield + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">压强 / 积分</span><span class="game-shi-kv-value">' + Math.max(1, session.wave || 1) + " / " + session.score + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">战力 / 敌血</span><span class="game-shi-kv-value">' + nowDerived.combatPower + " / x" + nowDerived.combatEnemyHpScale.toFixed(2) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">当前模式</span><span class="game-shi-kv-value">' + ctxEscape(stepLabel(session.stepLevel)) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">当前状态</span><span class="game-shi-kv-value">' + ctxEscape(session.playerState || "待战") + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">击杀 / 用时</span><span class="game-shi-kv-value">' + session.kills + " / " + ctxEscape(ctx.formatSeconds(session.elapsedSeconds)) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">攻击 / 格挡</span><span class="game-shi-kv-value">' + attackLeft.toFixed(1) + "s / " + blockLeft.toFixed(1) + "s</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">技能 / 切换</span><span class="game-shi-kv-value">' + skillLeft + "s / " + stepLeft.toFixed(1) + "s</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">左侧压力</span><span class="game-shi-kv-value">' + ctxEscape(leftPressure) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">右侧压力</span><span class="game-shi-kv-value">' + ctxEscape(rightPressure) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">建议模式</span><span class="game-shi-kv-value">' + ctxEscape(stepAdvice.label) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">完美窗口</span><span class="game-shi-kv-value">' + perfectWindowNow + "ms</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">破绽目标</span><span class="game-shi-kv-value">' + openingEnemies + " 个</span></div>",
                mejaisOwned
                    ? ('      <div class="game-shi-kv"><span class="game-shi-kv-label">杀人书层数</span><span class="game-shi-kv-value">' + session.mejaisStacks + " 层</span></div>")
                    : "",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">模式说明</span><span class="game-shi-kv-value">' + ctxEscape(stepHint(session)) + "</span></div>",
                '      <div class="game-shi-kv"><span class="game-shi-kv-label">当前提示</span><span class="game-shi-kv-value">' + ctxEscape(session.message || "战斗进行中。") + "</span></div>",
                "    </div>",
                "  </section>",
                '  <section class="game-shi-rail-section">',
                '    <div class="game-shi-rail-title">装备</div>',
                session.equipmentKeys.length
                    ? ('<div class="game-shi-equipment-list">' + session.equipmentKeys.map(function (key) {
                        const suffix = key === "mejais" ? (" · " + session.mejaisStacks + " 层") : "";
                        return '<div class="game-shi-equipment-item">' + ctxEscape(SHI_DATA.equipments[key].name + suffix) + "</div>";
                    }).join("") + "</div>")
                    : '<div class="game-shi-equipment-empty">暂无装备</div>',
                "  </section>",
                "</div>"
            ].join("");
            ctx.setArcadeList(arcade.status, [railHtml], "game-shi-rail-shell");
            renderRewardOverlay(overlay, session);
            ctx.syncPresence(session.status === "over" ? "《士》已结算" : ("《士》战斗中 · 压强 " + Math.max(1, session.wave || 1)), "");
        }

        function tick() {
            const nowMs = Date.now();
            const deltaMs = Math.min(140, Math.max(16, nowMs - lastFrameMs));
            lastFrameMs = nowMs;
            if (session.status === "playing" && !session.paused && !session.pendingRewardOptions.length) {
                maintainEnemyRoster(session, nowMs);
                updateEnemies(session, nowMs);
                if (session.hitStopUntil <= nowMs) {
                    updateProjectiles(session, nowMs, deltaMs);
                }
                updateEffects(session, nowMs);
                if (nowMs - lastPersistAt >= 350) {
                    persist(false);
                    lastPersistAt = nowMs;
                }
            } else if (session.status === "over") {
                updateEffects(session, nowMs);
                finalizeScore();
            }
            render();
            frameHandle = window.requestAnimationFrame(tick);
        }

        function handleRewardClick(event) {
            const convertTarget = event.target.closest("[data-reward-convert]");
            if (convertTarget) {
                convertRewardToScore(session);
                persist(true);
                render();
                return;
            }
            const replaceTarget = event.target.closest("[data-replace-index]");
            if (replaceTarget) {
                replaceEquipmentReward(session, Number(replaceTarget.getAttribute("data-replace-index")));
                persist(true);
                render();
                return;
            }
            const target = event.target.closest("[data-reward-index]");
            if (!target) {
                return;
            }
            const index = Number(target.getAttribute("data-reward-index"));
            applyReward(session, session.pendingRewardOptions[index]);
            persist(true);
            render();
        }

        function handleKeydown(event) {
            if (event.repeat || session.pendingRewardOptions.length) {
                return;
            }
            const nowMs = Date.now();
            if (event.code === "KeyW") {
                event.preventDefault();
                shiftStep(session, 1, nowMs);
            } else if (event.code === "KeyS") {
                event.preventDefault();
                shiftStep(session, -1, nowMs);
            } else if (event.code === "KeyA") {
                event.preventDefault();
                useAttack(session, -1, nowMs);
            } else if (event.code === "KeyD") {
                event.preventDefault();
                useAttack(session, 1, nowMs);
            } else if (event.code === "KeyQ") {
                event.preventDefault();
                useBlock(session, -1, nowMs);
            } else if (event.code === "KeyE") {
                event.preventDefault();
                useBlock(session, 1, nowMs);
            } else if (event.code === "ShiftLeft" || event.code === "ShiftRight") {
                event.preventDefault();
                useSkill(session, nowMs);
            }
            render();
        }

        overlay.addEventListener("click", handleRewardClick);
        window.addEventListener("keydown", handleKeydown);

        ctx.addStageButton("重新开始", function () {
            restartSession();
        }, true);
        ctx.addStageButton("暂停 / 继续", function () {
            session.paused = !session.paused;
            session.message = session.paused ? "已暂停。" : "战斗继续。";
            if (!session.paused) {
                session.startedAt = Date.now() - session.elapsedSeconds * 1000;
            }
            persist(true);
            render();
        }, false);
        ctx.addStageButton("帮助", function () {
            ctx.openGameInfoOverlay(arcade.canvasWrap, {
                title: "《士》当前原型说明",
                subtitle: "这是当前的单线中轴版本，重点验证左右攻防、双攻击模式和完美格挡反打是否成立。",
                bullets: [
                    "当前已实现：单线中轴、左右攻击、W / S 双攻击模式切换、方向格挡、完美格挡、5 类敌人模板、20 把武器、50 件 LOL 风格装备、持续补怪、随机掉落、自动存档和积分结算。",
                    "本轮重点：去掉位置步法，改成纯攻击模式切换。W 更主动，S 更稳，但它们只改变武器出手。",
                    "当前敌人模板：基础近战、快刺、重压、假动作、射击。真正出手的一侧会先接管主回合，另一侧只推进到压迫位制造压力。",
                    "新增成长规则：敌人出生时会参考你当前战力提高生命值，像杀人书这类滚雪球装备也会被一起纳入缩放。",
                    "当前未实现：敌人专属音效、更细分的射击子类、装备专属特效、房间联机。"
                ],
                hint: "这一版先把核心战斗改到更聚焦的结构上，再围绕单线中轴继续调敌人、武器和装备数值。"
            });
        }, false);

        render();
        frameHandle = window.requestAnimationFrame(tick);

        return function cleanup() {
            if (frameHandle) {
                window.cancelAnimationFrame(frameHandle);
            }
            overlay.removeEventListener("click", handleRewardClick);
            window.removeEventListener("keydown", handleKeydown);
            persist(true);
            if (session.status === "over") {
                finalizeScore();
            }
        };
    }

    modules.register("shi", mountShi);
})();
