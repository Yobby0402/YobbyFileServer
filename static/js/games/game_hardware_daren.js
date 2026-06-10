(function () {
    "use strict";

    const modules = window.GamesHubModules;
    if (!modules || typeof modules.register !== "function") {
        return;
    }

    const STYLE_ID = "game-hardware-daren-style";
    const GAME_ID = "hardware-daren";
    const scoreApi = window.GamesHubScore || null;
    if (!scoreApi || typeof scoreApi.getHardwareDarenRules !== "function") {
        return;
    }
    const HARDWARE_RULES = scoreApi.getHardwareDarenRules();
    const SCOPE_WIDTH = 1120;
    const SCOPE_HEIGHT = 560;
    const TRACE_Y = [120, 236, 344];
    const TRACE_LABELS = ["CH-A", "CH-B", "CH-C"];
    const TRACE_COLORS = ["#38bdf8", "#fb923c", "#34d399"];
    const CANNON_X = SCOPE_WIDTH / 2;
    const CANNON_Y = SCOPE_HEIGHT - 118;
    const FEED_SLOT_SPACING = 62;
    const MAX_PERSISTED_ENEMIES = 16;
    const MAX_PERSISTED_BULLETS = 24;
    const REDUCE_MOTION = Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const VENDOR_LOGO_URL = "/static/svgs/241120s-logo.svg";
    const COMPONENT_FAMILIES = HARDWARE_RULES.componentFamilies;
    const FAMILY_KEYS = Object.keys(COMPONENT_FAMILIES);
    const WAVE_LIBRARY = HARDWARE_RULES.waveLibrary;
    const SPAWN_BALANCE = HARDWARE_RULES.spawnBalance;
    const SCORING_RULES = HARDWARE_RULES.scoring;
    const WAVE_KEYS = Object.keys(WAVE_LIBRARY);
    const FIRE_CONTROL = HARDWARE_RULES.fireControl || {};
    const DEFAULT_FIRE_CONTROL_OPTIONS = Object.freeze([
        { label: "SLOW", reloadSeconds: 0.28 },
        { label: "STEADY", reloadSeconds: 0.22 },
        { label: "FAST", reloadSeconds: 0.18 },
        { label: "RAPID", reloadSeconds: 0.14 },
        { label: "MAX", reloadSeconds: 0.11 }
    ]);

    const SPEC_VISUALS = {
        capacitor: {
            chipColor: "#fde68a",
            textColor: "#422006",
            codes: { "22pF": "220", "100pF": "101", "1nF": "102", "10nF": "103", "100nF": "104", "1uF": "105", "10uF": "106", "220uF": "227", "470uF": "477" }
        },
        resistor: {
            chipColor: "#93c5fd",
            textColor: "#0f172a",
            codes: { "22Ω": "220", "100Ω": "101", "330Ω": "331", "1kΩ": "102", "4.7kΩ": "472", "10kΩ": "103", "100kΩ": "104" }
        },
        inductor: {
            chipColor: "#fcd34d",
            textColor: "#431407",
            codes: { "1uH": "1R0", "4.7uH": "4R7", "10uH": "100", "47uH": "470", "100uH": "101", "220uH": "221", "1mH": "102" }
        }
    };

    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) {
            return;
        }
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = [
            ".hardware-daren{--hd-bg:#08111f;--hd-panel:#0d1829;--hd-panel-2:rgba(10,18,33,.84);--hd-border:rgba(245,158,11,.22);--hd-gold:#f59e0b;--hd-gold-soft:#fbbf24;--hd-cyan:#38bdf8;--hd-green:#34d399;--hd-text:#f8fafc;--hd-muted:#94a3b8;position:relative;color:var(--hd-text);font-family:\"Orbitron\",\"Rajdhani\",\"Fira Code\",\"Cascadia Mono\",\"Consolas\",monospace;background:radial-gradient(circle at top,rgba(15,23,42,.96) 0%,rgba(8,17,31,.98) 38%,#040812 100%);border:1px solid var(--hd-border);border-radius:24px;padding:14px;box-shadow:0 22px 60px rgba(2,6,23,.52),inset 0 0 0 1px rgba(251,191,36,.06);overflow:hidden;}",
            ".hardware-daren::before{content:\"\";position:absolute;inset:0;background:linear-gradient(180deg,rgba(255,255,255,.04),transparent 18%,transparent 82%,rgba(255,255,255,.02));pointer-events:none;}",
            ".hardware-daren__shell{position:relative;z-index:1;display:grid;gap:0;}",
            ".hardware-daren__topbar{display:none;}",
            ".hardware-daren__brand{min-width:0;}",
            ".hardware-daren__kicker{display:block;font-size:10px;letter-spacing:.24em;text-transform:uppercase;color:var(--hd-gold-soft);margin-bottom:6px;}",
            ".hardware-daren__brand h2{margin:0;font-size:24px;letter-spacing:.08em;line-height:1;}",
            ".hardware-daren__brand p{margin:6px 0 0;font-size:12px;line-height:1.45;color:var(--hd-muted);max-width:620px;}",
            ".hardware-daren__signal{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:rgba(15,23,42,.88);border:1px solid rgba(245,158,11,.24);box-shadow:0 0 18px rgba(245,158,11,.08);white-space:nowrap;font-size:10px;letter-spacing:.18em;text-transform:uppercase;}",
            ".hardware-daren__playfield{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;align-items:start;height:auto;}",
            ".hardware-daren__scope-column{display:grid;grid-template-rows:auto auto auto;gap:8px;min-width:0;}",
            ".hardware-daren__scope-head{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:0 2px;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:rgba(248,250,252,.72);}",
            ".hardware-daren__scope{position:relative;min-height:0;height:clamp(430px,56vh,620px);border-radius:22px;border:1px solid rgba(148,163,184,.14);background:linear-gradient(180deg,rgba(5,10,19,.96),rgba(3,8,16,.98));overflow:hidden;box-shadow:inset 0 0 0 1px rgba(245,158,11,.06),inset 0 0 48px rgba(56,189,248,.05);}",
            ".hardware-daren__scope::after{content:\"\";position:absolute;inset:0;background:radial-gradient(circle at center,rgba(56,189,248,.06),transparent 58%),repeating-linear-gradient(180deg,rgba(255,255,255,.025) 0 1px,transparent 1px 4px);pointer-events:none;}",
            ".hardware-daren__canvas{display:block;width:100%;height:100%;}",
            ".hardware-daren__scanline{position:absolute;top:0;bottom:0;width:12%;background:linear-gradient(90deg,rgba(56,189,248,0),rgba(56,189,248,.1),rgba(251,191,36,.12),rgba(56,189,248,.1),rgba(56,189,248,0));filter:blur(12px);pointer-events:none;mix-blend-mode:screen;opacity:.9;}",
            ".hardware-daren__scope-status{position:absolute;top:12px;left:12px;display:flex;gap:8px;align-items:flex-start;pointer-events:none;z-index:2;}",
            ".hardware-daren__scope-pill{display:inline-flex;align-items:center;min-height:30px;padding:7px 10px;border-radius:999px;background:rgba(4,10,21,.78);border:1px solid rgba(148,163,184,.14);font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:#e2e8f0;backdrop-filter:blur(8px);}",
            ".hardware-daren__scope-loadout{position:absolute;top:10px;right:10px;display:grid;grid-template-columns:auto 1fr;gap:10px;align-items:center;min-width:0;max-width:min(46%,356px);padding:9px 11px;border-radius:18px;background:rgba(4,10,21,.76);border:1px solid rgba(245,158,11,.22);backdrop-filter:blur(10px);z-index:2;}",
            ".hardware-daren__scope-copy{min-width:0;display:grid;gap:2px;}",
            ".hardware-daren__scope-copy strong{font-size:14px;line-height:1;color:var(--hd-text);}",
            ".hardware-daren__scope-copy span{font-size:10px;line-height:1.3;color:rgba(248,250,252,.8);}",
            ".hardware-daren__scope-copy small{font-size:10px;line-height:1.35;color:var(--hd-muted);}",
            ".hardware-daren__scope-actions{display:flex;gap:6px;align-items:center;pointer-events:auto;margin-top:4px;}",
            ".hardware-daren__scope-action{min-width:0;height:26px;padding:0 10px;border-radius:999px;border:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.9);color:#dbeafe;font:inherit;font-size:10px;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:background-color .2s ease,border-color .2s ease,color .2s ease,transform .2s ease;}",
            ".hardware-daren__scope-action:hover,.hardware-daren__scope-action:focus-visible{background:rgba(30,41,59,.98);border-color:rgba(245,158,11,.5);outline:none;transform:translateY(-1px);}",
            ".hardware-daren__scope-action.is-active{background:linear-gradient(180deg,rgba(56,189,248,.95),rgba(2,132,199,.88));border-color:rgba(125,211,252,.72);color:#02131d;}",
            ".hardware-daren__vendor{position:absolute;right:18px;bottom:34px;display:block;width:132px;height:auto;max-width:22%;object-fit:contain;opacity:.98;filter:drop-shadow(0 0 10px rgba(15,147,230,.18));z-index:4;pointer-events:none;mix-blend-mode:screen;}",
            ".hardware-daren__trace-strip{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;pointer-events:none;}",
            ".hardware-daren__trace-chip{padding:7px 8px;border-radius:13px;background:rgba(8,15,28,.82);border:1px solid rgba(148,163,184,.14);font-size:10px;line-height:1.3;backdrop-filter:blur(8px);min-width:0;}",
            ".hardware-daren__trace-chip strong{display:block;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:rgba(248,250,252,.58);margin-bottom:3px;}",
            ".hardware-daren__trace-chip[data-trace=\"0\"]{border-color:rgba(56,189,248,.26);}",
            ".hardware-daren__trace-chip[data-trace=\"1\"]{border-color:rgba(251,146,60,.28);}",
            ".hardware-daren__trace-chip[data-trace=\"2\"]{border-color:rgba(52,211,153,.24);}",
            ".hardware-daren__trace-chip[data-trace=\"0\"] strong,.hardware-daren__trace-chip[data-trace=\"0\"] span{color:#7dd3fc;}",
            ".hardware-daren__trace-chip[data-trace=\"1\"] strong,.hardware-daren__trace-chip[data-trace=\"1\"] span{color:#fdba74;}",
            ".hardware-daren__trace-chip[data-trace=\"2\"] strong,.hardware-daren__trace-chip[data-trace=\"2\"] span{color:#86efac;}",
            ".hardware-daren__rail{display:none;}",
            ".hardware-daren__panel{padding:10px;border-radius:16px;background:linear-gradient(180deg,rgba(13,24,41,.92),rgba(9,16,28,.9));border:1px solid rgba(148,163,184,.14);box-shadow:inset 0 0 0 1px rgba(255,255,255,.02);min-width:0;}",
            ".hardware-daren__panel h3{margin:0 0 8px;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--hd-gold-soft);}",
            ".hardware-daren__metric-stack{display:grid;gap:6px;}",
            ".hardware-daren__metric-row{display:flex;justify-content:space-between;gap:8px;align-items:baseline;padding:7px 8px;border-radius:12px;background:rgba(6,11,22,.82);border:1px solid rgba(148,163,184,.12);}",
            ".hardware-daren__metric-row small{font-size:8px;letter-spacing:.18em;text-transform:uppercase;color:var(--hd-muted);}",
            ".hardware-daren__metric-row strong{font-size:14px;line-height:1;color:var(--hd-text);text-align:right;}",
            ".hardware-daren__metric-row--bank strong,.hardware-daren__metric-row--net strong{color:#fde68a;}",
            ".hardware-daren__loadout{display:grid;gap:8px;}",
            ".hardware-daren__switches{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;}",
            ".hardware-daren__switch{min-width:0;height:38px;border-radius:12px;border:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.82);color:var(--hd-text);font:inherit;font-size:10px;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;transition:background-color .2s ease,border-color .2s ease,transform .2s ease;}",
            ".hardware-daren__switch:hover,.hardware-daren__switch:focus-visible{background:rgba(30,41,59,.96);border-color:rgba(245,158,11,.42);outline:none;transform:translateY(-1px);}",
            ".hardware-daren__loadout-controls{display:grid;grid-template-columns:1fr;gap:6px;}",
            ".hardware-daren__current{min-width:0;padding:12px 10px;border-radius:16px;background:rgba(6,11,22,.88);border:1px solid rgba(245,158,11,.14);display:grid;justify-items:center;gap:10px;text-align:center;}",
            ".hardware-daren__chip{width:56px;height:56px;border-radius:16px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;letter-spacing:.08em;box-shadow:inset 0 -8px 14px rgba(0,0,0,.18),0 0 18px rgba(255,255,255,.04);flex:0 0 auto;transition:width .18s ease,height .18s ease,transform .18s ease;}",
            ".hardware-daren__chip.is-capacitor{border-radius:999px;}",
            ".hardware-daren__chip.is-resistor{border-radius:10px;}",
            ".hardware-daren__chip.is-inductor{border-radius:10px;clip-path:polygon(12% 0,88% 0,88% 18%,66% 18%,66% 82%,88% 82%,88% 100%,12% 100%,12% 82%,34% 82%,34% 18%,12% 18%);}",
            ".hardware-daren__current-copy{min-width:0;display:grid;justify-items:center;gap:2px;}",
            ".hardware-daren__current-copy strong{font-size:15px;line-height:1;color:var(--hd-text);}",
            ".hardware-daren__current-copy span{font-size:10px;color:rgba(248,250,252,.78);line-height:1.3;}",
            ".hardware-daren__current-copy small{font-size:10px;color:var(--hd-muted);line-height:1.35;}",
            ".hardware-daren__runtime-list{display:grid;gap:6px;}",
            ".hardware-daren__runtime-item{padding:8px 9px;border-radius:12px;background:rgba(6,11,22,.82);border:1px solid rgba(148,163,184,.12);}",
            ".hardware-daren__runtime-item strong{display:block;font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:rgba(248,250,252,.58);margin-bottom:3px;}",
            ".hardware-daren__runtime-item span{display:block;font-size:14px;color:var(--hd-text);}",
            ".hardware-daren__runtime-item small{display:block;margin-top:3px;font-size:9px;line-height:1.35;color:var(--hd-muted);}",
            ".hardware-daren__hint-list{display:grid;gap:6px;padding-top:2px;}",
            ".hardware-daren__hint-list p{margin:0;font-size:10px;line-height:1.45;color:rgba(226,232,240,.82);}",
            ".hardware-daren__hint-list code{font-family:inherit;padding:1px 5px;border-radius:999px;background:rgba(15,23,42,.92);border:1px solid rgba(148,163,184,.14);color:#e2e8f0;}",
            ".hardware-daren__entry{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(2,6,23,.68);backdrop-filter:blur(10px);z-index:3;}",
            ".hardware-daren__entry[hidden]{display:none;}",
            ".hardware-daren__entry-card{width:min(100%,440px);padding:18px;border-radius:24px;background:linear-gradient(180deg,rgba(10,18,33,.98),rgba(5,10,20,.98));border:1px solid rgba(245,158,11,.28);box-shadow:0 24px 56px rgba(2,6,23,.56),inset 0 0 0 1px rgba(251,191,36,.06);}",
            ".hardware-daren__entry-card h3{margin:0;font-size:22px;letter-spacing:.06em;}",
            ".hardware-daren__entry-card p{margin:8px 0 0;font-size:12px;line-height:1.55;color:var(--hd-muted);}",
            ".hardware-daren__entry-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:14px;}",
            ".hardware-daren__entry-stat{padding:10px 12px;border-radius:14px;background:rgba(6,11,22,.9);border:1px solid rgba(148,163,184,.14);}",
            ".hardware-daren__entry-stat strong{display:block;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:rgba(248,250,252,.58);margin-bottom:6px;}",
            ".hardware-daren__entry-stat span{display:block;font-size:17px;color:var(--hd-text);}",
            ".hardware-daren__entry-fields{display:grid;gap:10px;margin-top:14px;}",
            ".hardware-daren__entry-field{display:grid;gap:6px;}",
            ".hardware-daren__entry-field label{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:rgba(248,250,252,.58);}",
            ".hardware-daren__entry-field input{width:100%;padding:12px 14px;border-radius:14px;border:1px solid rgba(148,163,184,.22);background:rgba(15,23,42,.92);color:var(--hd-text);font:inherit;font-size:15px;}",
            ".hardware-daren__entry-field input:focus{outline:none;border-color:rgba(245,158,11,.5);box-shadow:0 0 0 3px rgba(245,158,11,.12);}",
            ".hardware-daren__entry-actions{display:flex;gap:8px;margin-top:14px;}",
            ".hardware-daren__entry-btn{flex:1 1 auto;padding:12px 14px;border-radius:14px;border:1px solid rgba(148,163,184,.2);background:rgba(15,23,42,.9);color:var(--hd-text);font:inherit;font-size:12px;letter-spacing:.16em;text-transform:uppercase;cursor:pointer;transition:transform .2s ease,background-color .2s ease,border-color .2s ease;}",
            ".hardware-daren__entry-btn:hover,.hardware-daren__entry-btn:focus-visible{transform:translateY(-1px);background:rgba(30,41,59,.96);border-color:rgba(245,158,11,.34);outline:none;}",
            ".hardware-daren__entry-btn--primary{background:linear-gradient(180deg,rgba(245,158,11,.95),rgba(217,119,6,.92));color:#1f1305;border-color:rgba(251,191,36,.6);box-shadow:0 14px 24px rgba(245,158,11,.18);}",
            ".hardware-daren__entry-btn[disabled]{opacity:.55;cursor:wait;transform:none;}",
            ".hardware-daren__entry-msg{min-height:18px;margin-top:10px;font-size:11px;line-height:1.45;color:#e2e8f0;}",
            ".hardware-daren__entry-msg.is-error{color:#fca5a5;}",
            ".hardware-daren__entry-result{margin-top:12px;padding:10px 12px;border-radius:14px;background:rgba(6,11,22,.82);border:1px solid rgba(148,163,184,.12);font-size:11px;line-height:1.55;color:rgba(226,232,240,.82);}",
            ".hardware-daren__entry-result strong{color:#fde68a;}",
            "@media (max-width:1180px){.hardware-daren__scope{height:clamp(400px,54vh,580px);}.hardware-daren__vendor{width:118px;max-width:21%;bottom:28px;}.hardware-daren__scope-loadout{max-width:min(50%,300px);}.hardware-daren__brand p{max-width:none;}}",
            "@media (max-width:980px){.hardware-daren__playfield{grid-template-columns:1fr;height:auto;}.hardware-daren__scope{height:clamp(370px,50vh,520px);}.hardware-daren__trace-strip{grid-template-columns:1fr;}.hardware-daren__entry-grid{grid-template-columns:1fr;}}",
            "@media (max-width:760px){.hardware-daren{padding:10px;border-radius:18px;}.hardware-daren__scope-column{grid-template-rows:auto auto auto;}.hardware-daren__scope{height:clamp(330px,46vh,460px);}.hardware-daren__scope-head{flex-direction:column;align-items:flex-start;}.hardware-daren__scope-status{top:10px;left:10px;right:10px;flex-wrap:wrap;}.hardware-daren__scope-loadout{top:auto;left:10px;right:10px;bottom:118px;max-width:none;grid-template-columns:auto 1fr;}.hardware-daren__vendor{width:88px;max-width:24%;right:10px;bottom:26px;}.hardware-daren__entry-actions{flex-direction:column;}}",
            "@media (max-height:900px){.hardware-daren__scope{height:clamp(380px,50vh,540px);}.hardware-daren__vendor{bottom:28px;}.hardware-daren__scope-loadout{padding:8px 10px;}}",
            "@media (prefers-reduced-motion: reduce){.hardware-daren__switch,.hardware-daren__entry-btn{transition:none;}.hardware-daren__scanline{display:none;}}"
        ].join("");
        document.head.appendChild(style);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function toInt(value, fallbackValue) {
        const next = Number(value);
        if (!Number.isFinite(next)) {
            return fallbackValue;
        }
        return Math.round(next);
    }

    function formatSigned(value) {
        const rounded = Math.round(Number(value || 0));
        return rounded > 0 ? ("+" + rounded) : String(rounded);
    }

    function getFireRateOptions() {
        return Array.isArray(FIRE_CONTROL.options) && FIRE_CONTROL.options.length
            ? FIRE_CONTROL.options
            : DEFAULT_FIRE_CONTROL_OPTIONS;
    }

    function getDefaultFireRateIndex() {
        return clamp(toInt(FIRE_CONTROL.defaultIndex, 2), 0, getFireRateOptions().length - 1);
    }

    function getFireRatePreset(session) {
        const options = getFireRateOptions();
        const index = clamp(toInt(session && session.fireRateIndex, getDefaultFireRateIndex()), 0, options.length - 1);
        const preset = options[index] || DEFAULT_FIRE_CONTROL_OPTIONS[2];
        return {
            index: index,
            label: String(preset.label || "FAST"),
            reloadSeconds: Math.max(0.05, Number(preset.reloadSeconds) || 0.18)
        };
    }

    function getReloadDuration(session) {
        return getFireRatePreset(session).reloadSeconds;
    }

    function getFireRateSummary(session) {
        const preset = getFireRatePreset(session);
        return preset.label + " " + (1 / preset.reloadSeconds).toFixed(1) + "/s";
    }

    function getProfitPerMinuteCap() {
        const configured = Number(SCORING_RULES.targetScorePerMinuteCap);
        if (!Number.isFinite(configured) || configured <= 0) {
            return 100000;
        }
        return configured;
    }

    function getNetProfitCap(elapsedSeconds) {
        const safeElapsedSeconds = Math.max(0, Number(elapsedSeconds) || 0);
        return Math.floor(getProfitPerMinuteCap() * safeElapsedSeconds / 60);
    }

    function getManualNetProfitMultiplier() {
        const configured = Number(SCORING_RULES.manualNetProfitMultiplier);
        if (!Number.isFinite(configured) || configured < 1) {
            return 2;
        }
        return configured;
    }

    function getScoringInt(name, fallbackValue, minValue) {
        const configured = Math.round(Number(SCORING_RULES[name]));
        if (!Number.isFinite(configured)) {
            return fallbackValue;
        }
        return Math.max(minValue == null ? configured : minValue, configured);
    }

    function getScoringFloat(name, fallbackValue, minValue) {
        const configured = Number(SCORING_RULES[name]);
        if (!Number.isFinite(configured)) {
            return fallbackValue;
        }
        return Math.max(minValue == null ? configured : minValue, configured);
    }

    function randomIntInclusive(minValue, maxValue) {
        const low = Math.min(minValue, maxValue);
        const high = Math.max(minValue, maxValue);
        return low + Math.floor(Math.random() * (high - low + 1));
    }

    function randomRange(minValue, maxValue) {
        const low = Math.min(minValue, maxValue);
        const high = Math.max(minValue, maxValue);
        return low + Math.random() * (high - low);
    }

    function getRewardProfile() {
        return {
            normalMin: getScoringInt("normalRewardMultiplierMin", 1, 1),
            normalMax: getScoringInt("normalRewardMultiplierMax", 3, 1),
            bountyChance: clamp(Number(SCORING_RULES.bountySpawnChance == null ? 0.14 : SCORING_RULES.bountySpawnChance), 0, 1),
            bountyRewardMin: getScoringInt("bountyRewardMultiplierMin", 5, 1),
            bountyRewardMax: getScoringInt("bountyRewardMultiplierMax", 10, 1),
            bountyHpMin: getScoringFloat("bountyHpMultiplierMin", 2, 1),
            bountyHpMax: getScoringFloat("bountyHpMultiplierMax", 3, 1)
        };
    }

    function formatRewardScore(value) {
        return "+" + Math.max(0, Math.round(Number(value) || 0)).toLocaleString("en-US");
    }

    function getSessionBuyInTotal(session) {
        return Math.max(0, toInt(session && session.stakeAmount, 0) + toInt(session && session.loanAmount, 0));
    }

    function buildCashoutSettlement(session) {
        const buyInTotal = getSessionBuyInTotal(session);
        const rawPayout = Math.max(0, Math.round(session.credits));
        const rawNet = rawPayout - buyInTotal;
        const isAutoSettlement = Boolean(session.autoAssistUsed);
        const creditedNet = isAutoSettlement
            ? Math.min(rawNet, getNetProfitCap(session.elapsedSeconds))
            : (rawNet > 0 ? Math.round(rawNet * getManualNetProfitMultiplier()) : rawNet);
        const creditedPayout = Math.max(0, buyInTotal + creditedNet);
        return {
            buyInTotal: buyInTotal,
            rawPayout: rawPayout,
            creditedPayout: creditedPayout,
            rawNet: rawNet,
            creditedNet: creditedNet,
            netProfitCap: isAutoSettlement ? getNetProfitCap(session.elapsedSeconds) : 0,
            rateLimited: isAutoSettlement && creditedPayout < rawPayout,
            settlementMode: isAutoSettlement ? "auto" : "manual",
            manualBonusApplied: !isAutoSettlement && rawNet > 0 && creditedPayout > rawPayout
        };
    }

    function getFamilyPreset(key) {
        return COMPONENT_FAMILIES[String(key) || "capacitor"] || COMPONENT_FAMILIES.capacitor;
    }

    function getWavePreset(key) {
        return WAVE_LIBRARY[String(key) || "sine"] || WAVE_LIBRARY.sine;
    }

    function getSpecVisual(familyKey, specLabel) {
        const familyVisual = SPEC_VISUALS[familyKey] || {};
        const fallbackCode = String(specLabel || "").replace(/[^0-9A-Za-z]/g, "").slice(0, 3).toUpperCase() || "RLC";
        return {
            code: (familyVisual.codes && familyVisual.codes[specLabel]) || fallbackCode,
            chipColor: familyVisual.chipColor || getFamilyPreset(familyKey).color,
            textColor: familyVisual.textColor || "#0f172a"
        };
    }

    function getSpecScale(familyKey, specIndex) {
        const family = getFamilyPreset(familyKey);
        const maxIndex = Math.max(1, family.specs.length - 1);
        return 0.7 + (clamp(specIndex, 0, maxIndex) / maxIndex) * 1.02;
    }

    function getFamilyShapeClass(familyKey) {
        if (familyKey === "inductor") {
            return "is-inductor";
        }
        if (familyKey === "resistor") {
            return "is-resistor";
        }
        return "is-capacitor";
    }

    function getShapeDimensions(familyKey, scale, baseSize) {
        const base = (baseSize || 28) * scale;
        if (familyKey === "resistor") {
            return { width: base * 1.08, height: base * 1.08 };
        }
        if (familyKey === "inductor") {
            return { width: base * 1.52, height: base * 0.92 };
        }
        return { width: base * 0.94, height: base * 0.94 };
    }

    function applyChipPresentation(node, familyKey, specLabel, specIndex) {
        const visual = getSpecVisual(familyKey, specLabel);
        const scale = getSpecScale(familyKey, specIndex);
        const dimensions = getShapeDimensions(familyKey, scale, 48);
        node.classList.remove("is-capacitor", "is-resistor", "is-inductor");
        node.classList.add(getFamilyShapeClass(familyKey));
        node.textContent = visual.code;
        node.style.background = "radial-gradient(circle at 30% 28%,rgba(255,255,255,.35),transparent 36%)," + visual.chipColor;
        node.style.color = visual.textColor;
        node.style.width = Math.round(dimensions.width) + "px";
        node.style.height = Math.round(dimensions.height) + "px";
        node.style.flexBasis = Math.round(dimensions.width) + "px";
    }

    function smallestShotCost() {
        return FAMILY_KEYS.reduce(function (lowest, key) {
            const family = getFamilyPreset(key);
            const familyLowest = family.specs.reduce(function (innerLowest, spec) {
                return Math.min(innerLowest, spec.cost);
            }, family.specs[0].cost);
            return Math.min(lowest, familyLowest);
        }, getFamilyPreset(FAMILY_KEYS[0]).specs[0].cost);
    }

    function createSession(lastResult) {
        return {
            sessionKey: "hardware-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
            status: "entry",
            entryOpen: true,
            entryBusy: false,
            entryMessage: "",
            entryError: false,
            openingSubmitted: false,
            cashoutSubmitted: false,
            stakeAmount: 0,
            loanAmount: 0,
            startingCredits: 0,
            credits: 0,
            score: 0,
            combo: 0,
            bestCombo: 0,
            defeated: 0,
            escaped: 0,
            wave: 1,
            elapsedSeconds: 0,
            startedAt: Date.now(),
            lastFrameAt: 0,
            spawnTimer: 1.1,
            reloadTimer: 0,
            fireRateIndex: getDefaultFireRateIndex(),
            nextEnemyId: 1,
            nextBulletId: 1,
            selectedFamily: "capacitor",
            selectedSpecIndex: { capacitor: 3, resistor: 3, inductor: 3 },
            aimAngle: -Math.PI / 2,
            autoFire: false,
            autoAssistUsed: false,
            pointerTriggerHeld: false,
            infoText: "等待投入开局",
            scanlineX: 0,
            feedOffset: 0,
            feedAdvance: 0,
            enemies: [],
            bullets: [],
            lastResult: lastResult || null
        };
    }

    function normalizeEnemy(raw, fallbackId) {
        const preset = getWavePreset(raw && raw.type);
        return {
            id: toInt(raw && raw.id, fallbackId),
            type: preset.key,
            lineIndex: clamp(toInt(raw && raw.lineIndex, 0), 0, TRACE_Y.length - 1),
            x: Number(raw && raw.x) || (-preset.width * 0.5),
            hp: Math.max(1, toInt(raw && raw.hp, preset.hp)),
            maxHp: Math.max(1, toInt(raw && raw.maxHp, preset.hp)),
            baseAmplitude: Math.max(16, Number(raw && raw.baseAmplitude) || preset.amplitude),
            segmentWidth: Math.max(90, Number(raw && raw.segmentWidth) || preset.width),
            frequency: Math.max(0.72, Number(raw && raw.frequency) || preset.frequency),
            speed: Math.max(52, Number(raw && raw.speed) || preset.speed),
            reward: Math.max(24, toInt(raw && raw.reward, preset.reward)),
            rewardMultiplier: Math.max(1, Number(raw && raw.rewardMultiplier) || 1),
            isBounty: Boolean(raw && raw.isBounty),
            slowTimer: Math.max(0, Number(raw && raw.slowTimer) || 0),
            slowFactor: clamp(Number(raw && raw.slowFactor) || 0, 0, 0.72),
            spreadTimer: Math.max(0, Number(raw && raw.spreadTimer) || 0),
            spreadPixels: Math.max(0, Number(raw && raw.spreadPixels) || 0),
            hitBonus: Math.max(0, Number(raw && raw.hitBonus) || 0),
            hitFlash: Math.max(0, Number(raw && raw.hitFlash) || 0),
            phase: Number(raw && raw.phase) || Math.random() * Math.PI * 2
        };
    }

    function normalizeBullet(raw, fallbackId) {
        const family = getFamilyPreset(raw && raw.family);
        const specIndex = clamp(toInt(raw && raw.specIndex, 0), 0, family.specs.length - 1);
        const spec = family.specs[specIndex];
        return {
            id: toInt(raw && raw.id, fallbackId),
            family: family.key,
            specIndex: specIndex,
            label: spec.label,
            x: Number(raw && raw.x) || CANNON_X,
            y: Number(raw && raw.y) || CANNON_Y,
            vx: Number(raw && raw.vx) || 0,
            vy: Number(raw && raw.vy) || -spec.shotSpeed,
            radius: Math.max(5, Number(raw && raw.radius) || spec.radius)
        };
    }

    function normalizeSession(raw) {
        if (!raw || typeof raw !== "object") {
            return createSession();
        }
        const session = createSession(raw.lastResult || null);
        session.sessionKey = String(raw.sessionKey || session.sessionKey);
        session.status = ["entry", "playing", "paused", "gameover"].includes(String(raw.status)) ? String(raw.status) : "entry";
        session.entryOpen = Boolean(raw.entryOpen != null ? raw.entryOpen : session.status === "entry");
        session.entryBusy = false;
        session.entryMessage = String(raw.entryMessage || "");
        session.entryError = Boolean(raw.entryError);
        session.openingSubmitted = Boolean(raw.openingSubmitted);
        session.cashoutSubmitted = Boolean(raw.cashoutSubmitted);
        session.stakeAmount = Math.max(0, toInt(raw.stakeAmount, 0));
        session.loanAmount = Math.max(0, toInt(raw.loanAmount, 0));
        session.startingCredits = Math.max(0, toInt(raw.startingCredits, 0));
        session.credits = Math.max(0, toInt(raw.credits, 0));
        session.score = Math.max(0, toInt(raw.score, 0));
        session.combo = Math.max(0, toInt(raw.combo, 0));
        session.bestCombo = Math.max(0, toInt(raw.bestCombo, 0));
        session.defeated = Math.max(0, toInt(raw.defeated, 0));
        session.escaped = Math.max(0, toInt(raw.escaped, 0));
        session.wave = Math.max(1, toInt(raw.wave, 1));
        session.elapsedSeconds = Math.max(0, toInt(raw.elapsedSeconds, 0));
        session.startedAt = Date.now() - session.elapsedSeconds * 1000;
        session.lastFrameAt = 0;
        session.spawnTimer = Math.max(0.18, Number(raw.spawnTimer) || 1.1);
        session.reloadTimer = Math.max(0, Number(raw.reloadTimer) || 0);
        session.fireRateIndex = clamp(toInt(raw.fireRateIndex, getDefaultFireRateIndex()), 0, getFireRateOptions().length - 1);
        session.nextEnemyId = Math.max(1, toInt(raw.nextEnemyId, 1));
        session.nextBulletId = Math.max(1, toInt(raw.nextBulletId, 1));
        session.selectedFamily = COMPONENT_FAMILIES[String(raw.selectedFamily)] ? String(raw.selectedFamily) : "capacitor";
        session.selectedSpecIndex = Object.assign({}, session.selectedSpecIndex, raw.selectedSpecIndex || {});
        session.aimAngle = Number(raw.aimAngle);
        if (!Number.isFinite(session.aimAngle)) {
            session.aimAngle = -Math.PI / 2;
        }
        session.autoFire = Boolean(raw.autoFire);
        session.autoAssistUsed = Boolean(raw.autoAssistUsed);
        session.pointerTriggerHeld = false;
        session.infoText = String(raw.infoText || session.infoText);
        session.scanlineX = Math.max(0, Number(raw.scanlineX) || 0);
        session.feedOffset = 0;
        session.feedAdvance = 0;
        session.enemies = Array.isArray(raw.enemies) ? raw.enemies.slice(0, MAX_PERSISTED_ENEMIES).map(function (enemy, index) {
            return normalizeEnemy(enemy, index + 1);
        }) : [];
        session.bullets = Array.isArray(raw.bullets) ? raw.bullets.slice(0, MAX_PERSISTED_BULLETS).map(function (bullet, index) {
            return normalizeBullet(bullet, index + 1);
        }) : [];
        if (!session.openingSubmitted || session.cashoutSubmitted) {
            session.status = "entry";
            session.entryOpen = true;
            session.credits = 0;
            session.enemies = [];
            session.bullets = [];
        } else if (session.status === "playing") {
            session.status = "paused";
            session.entryOpen = false;
            session.infoText = "已为你暂停，点击继续回到示波器。";
        }
        return session;
    }

    function syncClock(session) {
        if (session.status === "playing") {
            session.elapsedSeconds = Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
        }
    }

    function serializeSession(session) {
        syncClock(session);
        return {
            sessionKey: session.sessionKey,
            status: session.status,
            entryOpen: session.entryOpen,
            entryMessage: session.entryMessage,
            entryError: session.entryError,
            openingSubmitted: session.openingSubmitted,
            cashoutSubmitted: session.cashoutSubmitted,
            stakeAmount: session.stakeAmount,
            loanAmount: session.loanAmount,
            startingCredits: session.startingCredits,
            credits: session.credits,
            score: session.score,
            combo: session.combo,
            bestCombo: session.bestCombo,
            defeated: session.defeated,
            escaped: session.escaped,
            wave: session.wave,
            elapsedSeconds: session.elapsedSeconds,
            spawnTimer: session.spawnTimer,
            reloadTimer: session.reloadTimer,
            fireRateIndex: session.fireRateIndex,
            nextEnemyId: session.nextEnemyId,
            nextBulletId: session.nextBulletId,
            selectedFamily: session.selectedFamily,
            selectedSpecIndex: session.selectedSpecIndex,
            aimAngle: session.aimAngle,
            autoFire: session.autoFire,
            autoAssistUsed: session.autoAssistUsed,
            infoText: session.infoText,
            scanlineX: session.scanlineX,
            enemies: session.enemies.slice(0, MAX_PERSISTED_ENEMIES).map(function (enemy) {
                return {
                    id: enemy.id,
                    type: enemy.type,
                    lineIndex: enemy.lineIndex,
                    x: enemy.x,
                    hp: enemy.hp,
                    maxHp: enemy.maxHp,
                    baseAmplitude: enemy.baseAmplitude,
                    segmentWidth: enemy.segmentWidth,
                    frequency: enemy.frequency,
                    speed: enemy.speed,
                    reward: enemy.reward,
                    rewardMultiplier: enemy.rewardMultiplier,
                    isBounty: enemy.isBounty,
                    slowTimer: enemy.slowTimer,
                    slowFactor: enemy.slowFactor,
                    spreadTimer: enemy.spreadTimer,
                    spreadPixels: enemy.spreadPixels,
                    hitBonus: enemy.hitBonus,
                    hitFlash: enemy.hitFlash,
                    phase: enemy.phase
                };
            }),
            bullets: session.bullets.slice(0, MAX_PERSISTED_BULLETS).map(function (bullet) {
                return {
                    id: bullet.id,
                    family: bullet.family,
                    specIndex: bullet.specIndex,
                    label: bullet.label,
                    x: bullet.x,
                    y: bullet.y,
                    vx: bullet.vx,
                    vy: bullet.vy,
                    radius: bullet.radius
                };
            }),
            lastResult: session.lastResult
        };
    }

    function summarizeSession(session) {
        syncClock(session);
        const selected = getSelectedSpec(session);
        return {
            credits: session.credits,
            score: session.score,
            wave: session.wave,
            combo: session.combo,
            defeated: session.defeated,
            escaped: session.escaped,
            family: selected.family.key,
            spec: selected.spec.label,
            elapsed_seconds: session.elapsedSeconds,
            fire_rate: getFireRatePreset(session).label,
            status: session.status,
            stake: session.stakeAmount,
            loan: session.loanAmount
        };
    }

    function getSelectedSpec(session) {
        const family = getFamilyPreset(session.selectedFamily);
        const index = clamp(toInt(session.selectedSpecIndex[family.key], 0), 0, family.specs.length - 1);
        return {
            family: family,
            index: index,
            spec: family.specs[index]
        };
    }

    function clampAimAngle(angle) {
        const min = -Math.PI + 0.2;
        const max = -0.16;
        if (!Number.isFinite(angle)) {
            return -Math.PI / 2;
        }
        return clamp(angle, min, max);
    }

    function clamp01(value) {
        return clamp(value, 0, 1);
    }

    function smoothstep(start, end, value) {
        if (start === end) {
            return value >= end ? 1 : 0;
        }
        const normalized = clamp01((value - start) / (end - start));
        return normalized * normalized * (3 - 2 * normalized);
    }

    function waveSample(type, normalizedX, phaseSeed) {
        const phase = normalizedX * Math.PI * 2 + phaseSeed;
        if (type === "square") {
            return Math.sin(phase) >= 0 ? 1 : -1;
        }
        if (type === "triangle") {
            return 2 * Math.abs(2 * (normalizedX - Math.floor(normalizedX + 0.5))) - 1;
        }
        if (type === "saw") {
            return 2 * (normalizedX - Math.floor(0.5 + normalizedX));
        }
        if (type === "pulse") {
            const pulse = Math.sin(phase);
            return clamp(Math.pow(Math.max(0, pulse), 0.38) * 1.2 - 0.22, -1, 1);
        }
        if (type === "stair") {
            const raw = Math.sin(phase) * 0.98;
            return Math.round(raw * 4) / 4;
        }
        if (type === "burst") {
            const packet = Math.sin(phase * 0.46 + phaseSeed * 0.7) * 0.5 + 0.5;
            const carrier = Math.sin(phase * 3.1) * 0.86 + Math.cos(phase * 1.55) * 0.14;
            return clamp(carrier * Math.pow(packet, 1.7), -1, 1);
        }
        if (type === "noise") {
            const rough = Math.sin(phase * 2.1 + phaseSeed) * 0.5 + Math.sin(phase * 6.4) * 0.28 + Math.cos(phase * 10.8) * 0.2;
            return clamp(rough, -1, 1);
        }
        return Math.sin(phase);
    }

    function getEnemyWidth(enemy) {
        return Math.max(88, enemy.segmentWidth + enemy.spreadPixels);
    }

    function getEnemyVisualHealth(enemy) {
        return 0.42 + 0.58 * clamp01(enemy.hp / enemy.maxHp);
    }

    function getEnemyAmplitude(enemy) {
        return Math.max(12, enemy.baseAmplitude * getEnemyVisualHealth(enemy));
    }

    function getTraceTravelSpeed(session) {
        return 124 + Math.min(SPAWN_BALANCE.speedWaveCap, session.wave * SPAWN_BALANCE.speedWaveStep);
    }

    function getEnemyContribution(enemy, x) {
        const width = getEnemyWidth(enemy);
        const left = enemy.x - width * 0.5;
        const right = enemy.x + width * 0.5;
        if (x < left || x > right) {
            return null;
        }
        const normalized = (x - left) / Math.max(1, width);
        const envelopeIn = smoothstep(0.04, 0.2, normalized);
        const envelopeOut = 1 - smoothstep(0.8, 0.96, normalized);
        const envelope = envelopeIn * envelopeOut;
        const shapeFrequency = enemy.slowTimer > 0
            ? enemy.frequency * Math.max(0.45, 1 - enemy.slowFactor * 0.55)
            : enemy.frequency;
        const displacement = waveSample(enemy.type, normalized * shapeFrequency, enemy.phase) * getEnemyAmplitude(enemy) * envelope;
        return {
            enemy: enemy,
            lineIndex: enemy.lineIndex,
            x: x,
            y: TRACE_Y[enemy.lineIndex] + displacement,
            displacement: displacement,
            abs: Math.abs(displacement),
            envelope: envelope,
            thickness: 11 + enemy.hitBonus + enemy.spreadPixels * 0.06
        };
    }

    function getCompositeTraceAtX(session, lineIndex, x) {
        const baseY = TRACE_Y[lineIndex];
        const contributors = [];
        let displacement = 0;
        let thickness = 0;
        session.enemies.forEach(function (enemy) {
            if (enemy.lineIndex !== lineIndex) {
                return;
            }
            const contribution = getEnemyContribution(enemy, x);
            if (!contribution || contribution.envelope < 0.04) {
                return;
            }
            contributors.push(contribution);
            displacement += contribution.displacement;
            thickness = Math.max(thickness, contribution.thickness);
        });
        contributors.sort(function (left, right) {
            return right.abs - left.abs;
        });
        return {
            lineIndex: lineIndex,
            baseY: baseY,
            y: baseY + displacement,
            displacement: displacement,
            thickness: thickness,
            contributors: contributors
        };
    }

    function canSpawnOnTrace(session, lineIndex) {
        return !session.enemies.some(function (enemy) {
            return enemy.lineIndex === lineIndex && enemy.x < 180;
        });
    }

    function spawnEnemy(session) {
        const availableTraces = TRACE_Y.map(function (_, index) { return index; }).filter(function (lineIndex) {
            return canSpawnOnTrace(session, lineIndex);
        });
        if (!availableTraces.length) {
            session.spawnTimer = SPAWN_BALANCE.blockedRespawnDelay;
            return;
        }
        const typeKey = WAVE_KEYS[Math.floor(Math.random() * WAVE_KEYS.length)];
        const preset = getWavePreset(typeKey);
        const lineIndex = availableTraces[Math.floor(Math.random() * availableTraces.length)];
        const waveScale = 1 + Math.min(SPAWN_BALANCE.hpWaveStepCap, (session.wave - 1) * SPAWN_BALANCE.hpWaveStep);
        const rewardProfile = getRewardProfile();
        const isBounty = Math.random() < rewardProfile.bountyChance;
        const rewardMultiplier = isBounty
            ? randomIntInclusive(rewardProfile.bountyRewardMin, rewardProfile.bountyRewardMax)
            : randomIntInclusive(rewardProfile.normalMin, rewardProfile.normalMax);
        const hpMultiplier = isBounty ? randomRange(rewardProfile.bountyHpMin, rewardProfile.bountyHpMax) : 1;
        const baseHp = Math.round(preset.hp * waveScale);
        session.enemies.push({
            id: session.nextEnemyId++,
            type: preset.key,
            lineIndex: lineIndex,
            x: -preset.width * 0.5,
            hp: Math.max(1, Math.round(baseHp * hpMultiplier)),
            maxHp: Math.max(1, Math.round(baseHp * hpMultiplier)),
            baseAmplitude: preset.amplitude + Math.min(SPAWN_BALANCE.amplitudeWaveCap, session.wave * SPAWN_BALANCE.amplitudeWaveStep),
            segmentWidth: preset.width + Math.min(SPAWN_BALANCE.widthWaveCap, session.wave * SPAWN_BALANCE.widthWaveStep),
            frequency: preset.frequency + Math.min(SPAWN_BALANCE.frequencyWaveCap, session.wave * SPAWN_BALANCE.frequencyWaveStep),
            speed: getTraceTravelSpeed(session),
            reward: Math.round(preset.reward * (1 + (session.wave - 1) * SPAWN_BALANCE.rewardWaveStep) * rewardMultiplier),
            rewardMultiplier: rewardMultiplier,
            isBounty: isBounty,
            slowTimer: 0,
            slowFactor: 0,
            spreadTimer: 0,
            spreadPixels: 0,
            hitBonus: 0,
            hitFlash: 0,
            phase: Math.random() * Math.PI * 2
        });
        session.infoText = TRACE_LABELS[lineIndex] + (isBounty ? " 奖励怪 " : " 捕获到 ") + preset.label;
    }

    function createBullet(session) {
        const selected = getSelectedSpec(session);
        const angle = clampAimAngle(session.aimAngle);
        return {
            id: session.nextBulletId++,
            family: selected.family.key,
            specIndex: selected.index,
            label: selected.spec.label,
            x: CANNON_X + Math.cos(angle) * 24,
            y: CANNON_Y + Math.sin(angle) * 24,
            vx: Math.cos(angle) * selected.spec.shotSpeed,
            vy: Math.sin(angle) * selected.spec.shotSpeed,
            radius: selected.spec.radius
        };
    }

    function describeSpecEffect(familyKey, spec) {
        if (familyKey === "capacitor") {
            return "爆发 " + spec.damage;
        }
        if (familyKey === "resistor") {
            return "减速 " + Math.round(spec.slow * 100) + "% / " + spec.slowDuration.toFixed(1) + "s";
        }
        return "展宽 +" + spec.spread + " / 命中 +" + spec.hitBonus;
    }

    function awardKill(session, enemy) {
        const comboScale = 1 + Math.min(SCORING_RULES.comboScaleCap, session.combo * SCORING_RULES.comboScaleStep);
        const waveBonus = 1 + Math.min(SCORING_RULES.waveBonusCap, (session.wave - 1) * SCORING_RULES.waveBonusStep);
        const gain = Math.round(enemy.reward * comboScale * waveBonus);
        session.credits += gain;
        session.score += gain;
        session.defeated += 1;
        session.combo += 1;
        session.bestCombo = Math.max(session.bestCombo, session.combo);
        session.wave = 1 + Math.floor(session.defeated / SCORING_RULES.waveAdvanceEveryDefeats);
        session.infoText = "回收 +" + gain;
    }

    function applyBulletHit(session, bullet, enemy) {
        const family = getFamilyPreset(bullet.family);
        const spec = family.specs[bullet.specIndex];
        let damage = spec.damage;
        if (family.key === "resistor") {
            enemy.slowTimer = Math.max(enemy.slowTimer, spec.slowDuration || 0);
            enemy.slowFactor = Math.max(enemy.slowFactor, spec.slow || 0);
        } else if (family.key === "inductor") {
            enemy.spreadTimer = Math.max(enemy.spreadTimer, spec.spreadDuration || 0);
            enemy.spreadPixels = Math.min(enemy.segmentWidth * 0.95, enemy.spreadPixels + (spec.spread || 0));
            enemy.hitBonus = Math.min(28, enemy.hitBonus + (spec.hitBonus || 0));
        } else if (enemy.spreadPixels > 0 || enemy.slowTimer > 0) {
            damage += Math.round(enemy.spreadPixels * SCORING_RULES.capacitorStatusBonusSpreadFactor)
                + (enemy.slowTimer > 0 ? SCORING_RULES.capacitorStatusBonusSlowFlat : 0);
        }
        enemy.hp = Math.max(0, enemy.hp - damage);
        enemy.hitFlash = REDUCE_MOTION ? 0.08 : 0.18;
        if (enemy.hp <= 0) {
            awardKill(session, enemy);
            return true;
        }
        session.infoText = family.label + " " + spec.label + " 命中";
        return false;
    }

    function findHitTarget(session, bullet) {
        let best = null;
        TRACE_Y.forEach(function (_, lineIndex) {
            const composite = getCompositeTraceAtX(session, lineIndex, bullet.x);
            if (!composite.contributors.length) {
                return;
            }
            const lineDistance = Math.abs(bullet.y - composite.y);
            if (lineDistance > bullet.radius + 16 + composite.thickness * 0.4) {
                return;
            }
            composite.contributors.forEach(function (contribution) {
                const distance = Math.abs(bullet.y - contribution.y);
                const tolerance = bullet.radius + 10 + contribution.thickness;
                if (distance > tolerance) {
                    return;
                }
                const score = distance - contribution.abs * 0.16;
                if (!best || score < best.score) {
                    best = {
                        enemy: contribution.enemy,
                        score: score
                    };
                }
            });
        });
        return best ? best.enemy : null;
    }

    function findAutoAimPoint(session) {
        let best = null;
        session.enemies.forEach(function (enemy) {
            const width = getEnemyWidth(enemy);
            const left = enemy.x - width * 0.5;
            for (let step = 3; step <= 24; step += 1) {
                const x = left + width * (step / 27);
                const composite = getCompositeTraceAtX(session, enemy.lineIndex, x);
                if (!composite.contributors.length) {
                    continue;
                }
                const contribution = composite.contributors.find(function (item) {
                    return item.enemy.id === enemy.id;
                });
                if (!contribution || contribution.abs < 3) {
                    continue;
                }
                const dx = x - CANNON_X;
                const dy = composite.y - CANNON_Y;
                const angle = clampAimAngle(Math.atan2(dy, dx));
                const distance = Math.hypot(dx, dy);
                const urgency = enemy.x / SCOPE_WIDTH;
                const score = distance - contribution.abs * 1.6 - urgency * 150 - enemy.spreadPixels * 0.3;
                if (!best || score < best.score) {
                    best = { angle: angle, score: score };
                }
            }
        });
        return best;
    }

    function updateSession(session, deltaSeconds) {
        if (session.status !== "playing") {
            return;
        }

        session.reloadTimer = Math.max(0, session.reloadTimer - deltaSeconds);
        session.spawnTimer -= deltaSeconds;
        if (!REDUCE_MOTION) {
            session.scanlineX = (session.scanlineX + deltaSeconds * 240) % (SCOPE_WIDTH + 180);
        }
        if (session.feedAdvance > 0) {
            const travel = Math.min(session.feedAdvance, deltaSeconds * 340);
            session.feedOffset = (session.feedOffset + travel) % FEED_SLOT_SPACING;
            session.feedAdvance = Math.max(0, session.feedAdvance - travel);
        } else if (session.feedOffset !== 0) {
            session.feedOffset = 0;
        }

        if (session.spawnTimer <= 0) {
            spawnEnemy(session);
            session.spawnTimer = Math.max(
                SPAWN_BALANCE.respawnIntervalMin,
                SPAWN_BALANCE.respawnIntervalBase - session.wave * SPAWN_BALANCE.respawnIntervalWaveStep
            );
        }

        session.bullets.forEach(function (bullet) {
            bullet.x += bullet.vx * deltaSeconds;
            bullet.y += bullet.vy * deltaSeconds;
        });
        session.bullets = session.bullets.filter(function (bullet) {
            return bullet.x > -60 && bullet.x < SCOPE_WIDTH + 60 && bullet.y > -60 && bullet.y < SCOPE_HEIGHT + 60;
        });

        session.enemies.forEach(function (enemy) {
            enemy.x += getTraceTravelSpeed(session) * deltaSeconds;
            enemy.slowTimer = Math.max(0, enemy.slowTimer - deltaSeconds);
            if (enemy.slowTimer <= 0) {
                enemy.slowFactor = 0;
            }
            enemy.spreadTimer = Math.max(0, enemy.spreadTimer - deltaSeconds);
            if (enemy.spreadTimer <= 0) {
                enemy.spreadPixels = Math.max(0, enemy.spreadPixels - deltaSeconds * 22);
                enemy.hitBonus = Math.max(0, enemy.hitBonus - deltaSeconds * 3.6);
            }
            enemy.hitFlash = Math.max(0, enemy.hitFlash - deltaSeconds);
        });

        const removedEnemyIds = new Set();
        session.bullets = session.bullets.filter(function (bullet) {
            const target = findHitTarget(session, bullet);
            if (!target || removedEnemyIds.has(target.id)) {
                return true;
            }
            if (applyBulletHit(session, bullet, target)) {
                removedEnemyIds.add(target.id);
            }
            return false;
        });

        if (removedEnemyIds.size) {
            session.enemies = session.enemies.filter(function (enemy) {
                return !removedEnemyIds.has(enemy.id);
            });
        }

        const survivors = [];
        session.enemies.forEach(function (enemy) {
            if (enemy.x - getEnemyWidth(enemy) * 0.5 > SCOPE_WIDTH + 20) {
                session.escaped += 1;
                session.combo = 0;
                session.infoText = "有波形溜走了";
                return;
            }
            survivors.push(enemy);
        });
        session.enemies = survivors;

        if (!session.enemies.length && session.infoText !== "有波形溜走了") {
            session.infoText = "通道干净，继续搜波。";
        }

        if (session.credits <= 0 && session.bullets.length <= 0) {
            session.credits = 0;
            session.status = "gameover";
            session.entryOpen = true;
            session.entryMessage = "积分耗尽，本局回收为 0。";
            session.entryError = true;
            session.lastResult = {
                reason: "bankrupt",
                payout: 0,
                net: -session.startingCredits,
                stake: session.stakeAmount,
                loan: session.loanAmount,
                defeated: session.defeated,
                escaped: session.escaped,
                elapsedSeconds: session.elapsedSeconds
            };
            session.infoText = "BANKRUPT";
        }

        syncClock(session);
    }

    function drawGrid(ctx2d) {
        ctx2d.save();
        ctx2d.fillStyle = "#040812";
        ctx2d.fillRect(0, 0, SCOPE_WIDTH, SCOPE_HEIGHT);
        ctx2d.strokeStyle = "rgba(56,189,248,0.08)";
        ctx2d.lineWidth = 1;
        for (let x = 0; x <= SCOPE_WIDTH; x += 56) {
            ctx2d.beginPath();
            ctx2d.moveTo(x + 0.5, 0);
            ctx2d.lineTo(x + 0.5, SCOPE_HEIGHT);
            ctx2d.stroke();
        }
        for (let y = 0; y <= SCOPE_HEIGHT; y += 44) {
            ctx2d.beginPath();
            ctx2d.moveTo(0, y + 0.5);
            ctx2d.lineTo(SCOPE_WIDTH, y + 0.5);
            ctx2d.stroke();
        }
        TRACE_Y.forEach(function (lineY, index) {
            const lineColor = TRACE_COLORS[index];
            ctx2d.strokeStyle = lineColor + "22";
            ctx2d.lineWidth = 1.2;
            ctx2d.beginPath();
            ctx2d.moveTo(0, lineY + 0.5);
            ctx2d.lineTo(SCOPE_WIDTH, lineY + 0.5);
            ctx2d.stroke();
            ctx2d.fillStyle = lineColor;
            ctx2d.font = "11px Fira Code, Cascadia Mono, Consolas, monospace";
            ctx2d.fillText(TRACE_LABELS[index], 16, lineY - 10);
        });
        ctx2d.restore();
    }

    function drawCompositeTrace(ctx2d, session, lineIndex) {
        const traceColor = TRACE_COLORS[lineIndex];
        ctx2d.save();
        ctx2d.lineCap = "round";
        ctx2d.lineJoin = "round";
        ctx2d.strokeStyle = traceColor;
        ctx2d.shadowColor = traceColor + "66";
        ctx2d.shadowBlur = REDUCE_MOTION ? 6 : 14;
        ctx2d.lineWidth = 2;
        ctx2d.beginPath();
        ctx2d.moveTo(0, getCompositeTraceAtX(session, lineIndex, 0).y);
        for (let x = 4; x <= SCOPE_WIDTH; x += 4) {
            ctx2d.lineTo(x, getCompositeTraceAtX(session, lineIndex, x).y);
        }
        ctx2d.stroke();
        ctx2d.restore();
    }

    function drawEnemySignature(ctx2d, enemy) {
        const width = getEnemyWidth(enemy);
        const amplitude = getEnemyAmplitude(enemy);
        const centerX = enemy.x;
        const baseY = TRACE_Y[enemy.lineIndex];
        const preset = getWavePreset(enemy.type);
        const lineColor = TRACE_COLORS[enemy.lineIndex];
        const rewardText = formatRewardScore(enemy.reward);
        const labelY = baseY - amplitude - 10;
        ctx2d.save();
        ctx2d.strokeStyle = lineColor;
        ctx2d.shadowColor = lineColor;
        ctx2d.shadowBlur = REDUCE_MOTION ? 8 : 18;
        ctx2d.lineWidth = 2 + enemy.hitFlash * 4 + enemy.hitBonus * 0.05;
        ctx2d.beginPath();
        const left = centerX - width * 0.5;
        const points = 56;
        for (let step = 0; step <= points; step += 1) {
            const x = left + width * (step / points);
            const contribution = getEnemyContribution(enemy, x);
            if (!contribution) {
                continue;
            }
            if (step === 0) {
                ctx2d.moveTo(contribution.x, contribution.y);
            } else {
                ctx2d.lineTo(contribution.x, contribution.y);
            }
        }
        ctx2d.stroke();
        ctx2d.shadowBlur = 0;
        ctx2d.fillStyle = lineColor;
        ctx2d.font = "11px Fira Code, Cascadia Mono, Consolas, monospace";
        ctx2d.fillText(preset.label + " " + rewardText, left, labelY);
        if (enemy.isBounty) {
            ctx2d.strokeStyle = "rgba(250,204,21,0.96)";
            ctx2d.lineWidth = 2;
            ctx2d.beginPath();
            ctx2d.arc(left - 14, labelY - 4, 8, 0, Math.PI * 2);
            ctx2d.stroke();
            ctx2d.beginPath();
            ctx2d.arc(centerX, baseY, Math.max(24, Math.min(width * 0.22, 40)), 0, Math.PI * 2);
            ctx2d.stroke();
        }
        if (enemy.spreadPixels > 6) {
            ctx2d.strokeStyle = "rgba(251,191,36,0.34)";
            ctx2d.setLineDash([7, 6]);
            ctx2d.beginPath();
            ctx2d.roundRect(left - 4, baseY - amplitude - 18, width + 8, amplitude * 2 + 36, 18);
            ctx2d.stroke();
        }
        ctx2d.restore();
    }

    function drawFamilyShape(ctx2d, familyKey, width, height) {
        const halfW = width * 0.5;
        const halfH = height * 0.5;
        ctx2d.beginPath();
        if (familyKey === "capacitor") {
            ctx2d.arc(0, 0, Math.min(halfW, halfH), 0, Math.PI * 2);
            return;
        }
        if (familyKey === "resistor") {
            ctx2d.roundRect(-halfW, -halfH, width, height, Math.max(4, Math.min(halfW, halfH) * 0.18));
            return;
        }
        ctx2d.moveTo(-halfW * 0.88, -halfH);
        ctx2d.lineTo(halfW * 0.88, -halfH);
        ctx2d.lineTo(halfW * 0.88, -halfH * 0.58);
        ctx2d.lineTo(halfW * 0.3, -halfH * 0.58);
        ctx2d.lineTo(halfW * 0.3, halfH * 0.58);
        ctx2d.lineTo(halfW * 0.88, halfH * 0.58);
        ctx2d.lineTo(halfW * 0.88, halfH);
        ctx2d.lineTo(-halfW * 0.88, halfH);
        ctx2d.lineTo(-halfW * 0.88, halfH * 0.58);
        ctx2d.lineTo(-halfW * 0.3, halfH * 0.58);
        ctx2d.lineTo(-halfW * 0.3, -halfH * 0.58);
        ctx2d.lineTo(-halfW * 0.88, -halfH * 0.58);
        ctx2d.closePath();
    }

    function drawBullets(ctx2d, bullets) {
        bullets.forEach(function (bullet) {
            const family = getFamilyPreset(bullet.family);
            const visual = getSpecVisual(bullet.family, bullet.label);
            const scale = getSpecScale(bullet.family, bullet.specIndex);
            const drawRadius = Math.max(9, bullet.radius + 4) * scale;
            const dimensions = getShapeDimensions(bullet.family, scale, drawRadius * 2);
            ctx2d.save();
            ctx2d.translate(bullet.x, bullet.y);
            ctx2d.fillStyle = visual.chipColor;
            ctx2d.strokeStyle = family.color;
            ctx2d.lineWidth = 1.5;
            ctx2d.shadowColor = family.color;
            ctx2d.shadowBlur = REDUCE_MOTION ? 6 : 14;
            drawFamilyShape(ctx2d, bullet.family, dimensions.width, dimensions.height);
            ctx2d.fill();
            ctx2d.stroke();
            ctx2d.fillStyle = visual.textColor;
            ctx2d.font = "700 " + Math.max(7, Math.round(7.5 + scale * 2.5)) + "px Fira Code, Cascadia Mono, Consolas, monospace";
            ctx2d.textAlign = "center";
            ctx2d.textBaseline = "middle";
            ctx2d.fillText(visual.code, 0, 0.5);
            ctx2d.restore();
        });
    }

    function drawAimGuide(ctx2d, angle) {
        const guideX = CANNON_X + Math.cos(angle) * 200;
        const guideY = CANNON_Y + Math.sin(angle) * 200;
        ctx2d.save();
        ctx2d.strokeStyle = "rgba(248,250,252,0.18)";
        ctx2d.setLineDash([6, 10]);
        ctx2d.beginPath();
        ctx2d.moveTo(CANNON_X, CANNON_Y);
        ctx2d.lineTo(guideX, guideY);
        ctx2d.stroke();
        ctx2d.restore();
    }

    function drawHeartNose(ctx2d, size) {
        ctx2d.beginPath();
        ctx2d.moveTo(size * 0.72, 0);
        ctx2d.quadraticCurveTo(size * 0.16, size * 0.62, -size * 0.2, size * 0.28);
        ctx2d.quadraticCurveTo(-size * 0.56, 0, -size * 0.2, -size * 0.28);
        ctx2d.quadraticCurveTo(size * 0.16, -size * 0.62, size * 0.72, 0);
        ctx2d.closePath();
    }

    function drawCannon(ctx2d, session) {
        const selected = getSelectedSpec(session);
        const visual = getSpecVisual(selected.family.key, selected.spec.label);
        const scale = getSpecScale(selected.family.key, selected.index);
        const dimensions = getShapeDimensions(selected.family.key, scale, 32);
        ctx2d.save();
        ctx2d.translate(CANNON_X, CANNON_Y + 26);
        ctx2d.fillStyle = visual.chipColor;
        drawFamilyShape(ctx2d, selected.family.key, dimensions.width, dimensions.height);
        ctx2d.fill();
        ctx2d.strokeStyle = selected.family.color;
        ctx2d.lineWidth = 1.5;
        ctx2d.stroke();
        ctx2d.fillStyle = visual.textColor;
        ctx2d.font = "700 10px Fira Code, Cascadia Mono, Consolas, monospace";
        ctx2d.textAlign = "center";
        ctx2d.textBaseline = "middle";
        ctx2d.fillText(visual.code, 0, 0.5);
        ctx2d.restore();

        ctx2d.save();
        ctx2d.translate(CANNON_X, CANNON_Y);
        ctx2d.strokeStyle = selected.family.color;
        ctx2d.fillStyle = "rgba(8,15,28,0.96)";
        ctx2d.shadowColor = selected.family.color;
        ctx2d.shadowBlur = REDUCE_MOTION ? 8 : 18;
        ctx2d.beginPath();
        ctx2d.arc(0, 0, 26, 0, Math.PI * 2);
        ctx2d.fill();
        ctx2d.stroke();
        ctx2d.shadowBlur = 0;
        ctx2d.fillStyle = "rgba(15,23,42,0.94)";
        ctx2d.strokeStyle = "rgba(248,250,252,0.18)";
        ctx2d.beginPath();
        ctx2d.roundRect(-18, 22, 36, 16, 7);
        ctx2d.fill();
        ctx2d.stroke();
        ctx2d.rotate(session.aimAngle);
        ctx2d.fillStyle = "rgba(248,250,252,0.9)";
        ctx2d.strokeStyle = "rgba(248,250,252,0.45)";
        ctx2d.lineWidth = 1.4;
        ctx2d.beginPath();
        ctx2d.roundRect(8, -8, 46, 16, 8);
        ctx2d.fill();
        ctx2d.stroke();
        ctx2d.translate(62, 0);
        ctx2d.fillStyle = selected.family.color;
        ctx2d.strokeStyle = "rgba(248,250,252,0.32)";
        drawHeartNose(ctx2d, 24);
        ctx2d.fill();
        ctx2d.stroke();
        ctx2d.restore();
    }

    function drawFeedTape(ctx2d, session) {
        const selected = getSelectedSpec(session);
        const family = getFamilyPreset(selected.family.key);
        const visual = getSpecVisual(selected.family.key, selected.spec.label);
        const tapeTop = SCOPE_HEIGHT - 84;
        const tapeHeight = 34;
        const slotSpacing = FEED_SLOT_SPACING;
        const slotWidth = 42;
        const slotHeight = 26;
        const holeRadius = 6;
        const itemScale = Math.max(0.42, getSpecScale(selected.family.key, selected.index) * 0.38);
        const itemDimensions = getShapeDimensions(selected.family.key, itemScale, 22);
        const offset = session.feedOffset % slotSpacing;

        ctx2d.save();
        ctx2d.shadowColor = "rgba(15,23,42,0.24)";
        ctx2d.shadowBlur = 12;
        ctx2d.fillStyle = "rgba(248,250,252,0.96)";
        ctx2d.fillRect(0, tapeTop, SCOPE_WIDTH, tapeHeight);
        ctx2d.restore();

        for (let index = -1; index <= Math.ceil(SCOPE_WIDTH / slotSpacing) + 1; index += 1) {
            const centerX = index * slotSpacing + slotSpacing * 0.5 - offset;
            if (centerX < -slotSpacing || centerX > SCOPE_WIDTH + slotSpacing) {
                continue;
            }

            ctx2d.save();
            ctx2d.fillStyle = "#e5edf7";
            ctx2d.strokeStyle = "rgba(15,23,42,0.12)";
            ctx2d.lineWidth = 1;
            ctx2d.beginPath();
            ctx2d.roundRect(centerX - slotWidth * 0.5, tapeTop + 6, slotWidth, slotHeight, 8);
            ctx2d.fill();
            ctx2d.stroke();

            ctx2d.fillStyle = "#dbe5f1";
            ctx2d.beginPath();
            ctx2d.arc(centerX, tapeTop - 2, holeRadius, 0, Math.PI * 2);
            ctx2d.fill();

            if (centerX > CANNON_X + 44) {
                ctx2d.translate(centerX, tapeTop + 19);
                ctx2d.fillStyle = visual.chipColor;
                ctx2d.strokeStyle = family.color;
                ctx2d.lineWidth = 1;
                drawFamilyShape(ctx2d, selected.family.key, itemDimensions.width, itemDimensions.height);
                ctx2d.fill();
                ctx2d.stroke();
            }
            ctx2d.restore();
        }
    }

    function renderCanvas(ctx2d, session) {
        drawGrid(ctx2d);
        TRACE_Y.forEach(function (_, lineIndex) {
            drawCompositeTrace(ctx2d, session, lineIndex);
        });
        drawAimGuide(ctx2d, session.aimAngle);
        session.enemies.forEach(function (enemy) {
            drawEnemySignature(ctx2d, enemy);
        });
        drawBullets(ctx2d, session.bullets);
        drawFeedTape(ctx2d, session);
        drawCannon(ctx2d, session);

        ctx2d.save();
        ctx2d.fillStyle = "rgba(248,250,252,0.72)";
        ctx2d.font = "11px Fira Code, Cascadia Mono, Consolas, monospace";
        ctx2d.fillText("SCOPE HUNT / HARDWARE DAREN", 16, 20);
        ctx2d.restore();
    }

    function mountHardwareDaren(savedPayload, ctx) {
        ensureStyle();
        let session = normalizeSession(savedPayload && savedPayload.state);
        let animationId = 0;
        let persistTimerId = 0;

        const root = document.createElement("section");
        root.className = "hardware-daren";
        root.innerHTML = [
            '<div class="hardware-daren__shell">',
            '  <div class="hardware-daren__playfield">',
            '    <div class="hardware-daren__scope-column">',
            '      <div class="hardware-daren__scope-head">',
            '        <span>2.00us/div · 5V · Composite Trace</span>',
            '        <span>Q/E 切家族 · A/D 切规格 · F 自动 · C 结算</span>',
            '      </div>',
            '      <div class="hardware-daren__scope">',
            '        <canvas class="hardware-daren__canvas" width="' + SCOPE_WIDTH + '" height="' + SCOPE_HEIGHT + '"></canvas>',
            '        <div class="hardware-daren__scanline" id="hardwareDarenScanline"></div>',
            '        <div class="hardware-daren__scope-status">',
            '          <span class="hardware-daren__scope-pill" id="hardwareDarenSignal">等待投入开局</span>',
            '          <span class="hardware-daren__scope-pill" id="hardwareDarenScopeMeta">80% 波形视图</span>',
            '        </div>',
            '        <div class="hardware-daren__scope-loadout">',
            '          <div class="hardware-daren__chip" id="hardwareDarenChip">104</div>',
            '          <div class="hardware-daren__scope-copy">',
            '            <strong id="hardwareDarenCurrentLabel">100nF</strong>',
            '            <span id="hardwareDarenCurrentRole">电容 / 爆发</span>',
            '            <small id="hardwareDarenCurrentHint">爆发 52</small>',
            '            <small id="hardwareDarenRuntimeHint">AUTO OFF · CLEAR 0 · 00:00</small>',
            '          </div>',
            '        </div>',
            '        <img class="hardware-daren__vendor" src="' + VENDOR_LOGO_URL + '" alt="241120S 供应商标识">',
            '      </div>',
            '      <div class="hardware-daren__trace-strip">',
            '        <div class="hardware-daren__trace-chip"><strong>CH-A</strong><span id="hardwareDarenTrace0">待机</span></div>',
            '        <div class="hardware-daren__trace-chip"><strong>CH-B</strong><span id="hardwareDarenTrace1">待机</span></div>',
            '        <div class="hardware-daren__trace-chip"><strong>CH-C</strong><span id="hardwareDarenTrace2">待机</span></div>',
            '      </div>',
            '    </div>',
            '  </div>',
            '    <div class="hardware-daren__entry" id="hardwareDarenEntry">',
            '      <div class="hardware-daren__entry-card">',
            '        <h3 id="hardwareDarenEntryTitle">投入开局</h3>',
            '        <p id="hardwareDarenEntryCopy">先决定这局带多少分上机。若总积分已经为 0 或负数，可以追加贷款直接开局。</p>',
            '        <div class="hardware-daren__entry-grid">',
            '          <div class="hardware-daren__entry-stat"><strong>账户总积分</strong><span id="hardwareDarenEntryWallet">0</span></div>',
            '          <div class="hardware-daren__entry-stat"><strong>建议上机</strong><span id="hardwareDarenEntrySuggested">0</span></div>',
            '          <div class="hardware-daren__entry-stat"><strong>最小射击</strong><span id="hardwareDarenEntryMinimum">0</span></div>',
            '        </div>',
            '        <div class="hardware-daren__entry-fields">',
            '          <div class="hardware-daren__entry-field">',
            '            <label for="hardwareDarenStakeInput">投入积分</label>',
            '            <input id="hardwareDarenStakeInput" type="number" inputmode="numeric" min="0" step="1" value="0">',
            '          </div>',
            '          <div class="hardware-daren__entry-field" id="hardwareDarenLoanField" hidden>',
            '            <label for="hardwareDarenLoanInput">贷款积分</label>',
            '            <input id="hardwareDarenLoanInput" type="number" inputmode="numeric" min="0" step="1" value="0">',
            '          </div>',
            '        </div>',
            '        <div class="hardware-daren__entry-msg" id="hardwareDarenEntryMsg"></div>',
            '        <div class="hardware-daren__entry-result" id="hardwareDarenEntryResult" hidden></div>',
            '        <div class="hardware-daren__entry-actions">',
            '          <button type="button" class="hardware-daren__entry-btn hardware-daren__entry-btn--primary" id="hardwareDarenEntryStart">确认开局</button>',
            '          <button type="button" class="hardware-daren__entry-btn" id="hardwareDarenEntryClose">继续观察</button>',
            '        </div>',
            '      </div>',
            '    </div>',
            '  </div>',
            '</div>'
        ].join("");
        ctx.els.stageBody.appendChild(root);
        if (ctx.els.stageMeta) {
            ctx.els.stageMeta.textContent = "示波器波形狩猎。电容负责爆发，电阻负责减速，电感负责展宽与抬高命中率。";
        }

        const scopeLoadoutEl = root.querySelector(".hardware-daren__scope-loadout");
        const scopeCopyEl = root.querySelector(".hardware-daren__scope-copy");
        if (scopeCopyEl && !scopeCopyEl.querySelector("#hardwareDarenAutoBtn")) {
            const actionsEl = document.createElement("div");
            actionsEl.className = "hardware-daren__scope-actions";
            actionsEl.innerHTML = '<button type="button" class="hardware-daren__scope-action" id="hardwareDarenAutoBtn" data-action="auto-toggle">AUTO</button>';
            scopeCopyEl.appendChild(actionsEl);
        }
        let vendorEl = root.querySelector(".hardware-daren__vendor");
        if (!vendorEl && scopeLoadoutEl && scopeLoadoutEl.parentNode) {
            vendorEl = document.createElement("img");
            vendorEl.className = "hardware-daren__vendor";
            scopeLoadoutEl.parentNode.appendChild(vendorEl);
        }
        if (vendorEl) {
            vendorEl.setAttribute("src", VENDOR_LOGO_URL);
            vendorEl.setAttribute("alt", "241120S 供应商标识");
        }

        if (ctx.els.stageMeta) {
            ctx.els.stageMeta.textContent = "示波器波形猎捕。电容负责爆发，电阻负责减慢，电感负责拉宽并提高命中率。";
        }

        const scopeHeadEl = root.querySelector(".hardware-daren__scope-head");
        if (scopeHeadEl) {
            scopeHeadEl.innerHTML = [
                "<span>2.00us/div · 5V/div · Composite Trace</span>",
                "<span>Q/E 切器件 · A/D 切规格 · F 自动 · C 结算</span>"
            ].join("");
        }

        const scopeStatusEl = root.querySelector(".hardware-daren__scope-status");
        if (scopeStatusEl) {
            scopeStatusEl.innerHTML = [
                '<span class="hardware-daren__scope-pill" id="hardwareDarenSignal">等待投入开局</span>',
                '<span class="hardware-daren__scope-pill" id="hardwareDarenScopeMeta">80% 波形视图</span>'
            ].join("");
        }

        const repairedScopeLoadoutEl = root.querySelector(".hardware-daren__scope-loadout");
        if (repairedScopeLoadoutEl) {
            repairedScopeLoadoutEl.innerHTML = [
                '<div class="hardware-daren__chip" id="hardwareDarenChip">104</div>',
                '<div class="hardware-daren__scope-copy">',
                '  <strong id="hardwareDarenCurrentLabel">100nF</strong>',
                '  <span id="hardwareDarenCurrentRole">电容 / 爆发</span>',
                '  <small id="hardwareDarenCurrentHint">爆发 52</small>',
                '  <small id="hardwareDarenRuntimeHint">AUTO OFF · CLEAR 0 · 00:00</small>',
                '  <div class="hardware-daren__scope-actions">',
                '    <button type="button" class="hardware-daren__scope-action" id="hardwareDarenAutoBtn" data-action="auto-toggle">AUTO</button>',
                "  </div>",
                "</div>"
            ].join("");
        }

        const traceStripEl = root.querySelector(".hardware-daren__trace-strip");
        if (traceStripEl) {
            traceStripEl.innerHTML = [
                '<div class="hardware-daren__trace-chip" data-trace="0"><strong>CH-A</strong><span id="hardwareDarenTrace0">待机</span></div>',
                '<div class="hardware-daren__trace-chip" data-trace="1"><strong>CH-B</strong><span id="hardwareDarenTrace1">待机</span></div>',
                '<div class="hardware-daren__trace-chip" data-trace="2"><strong>CH-C</strong><span id="hardwareDarenTrace2">待机</span></div>'
            ].join("");
        }

        const entryTitleSeedEl = root.querySelector("#hardwareDarenEntryTitle");
        if (entryTitleSeedEl) {
            entryTitleSeedEl.textContent = "投入开局";
        }
        const entryCopySeedEl = root.querySelector("#hardwareDarenEntryCopy");
        if (entryCopySeedEl) {
            entryCopySeedEl.textContent = "先决定这局投入多少积分。如果总积分已经为 0 或负数，可以追加贷款直接开局。";
        }
        const entryWalletSeedEl = root.querySelector("#hardwareDarenEntryWallet");
        if (entryWalletSeedEl && entryWalletSeedEl.parentElement) {
            entryWalletSeedEl.parentElement.querySelector("strong").textContent = "账户总积分";
        }
        const entrySuggestedSeedEl = root.querySelector("#hardwareDarenEntrySuggested");
        if (entrySuggestedSeedEl && entrySuggestedSeedEl.parentElement) {
            entrySuggestedSeedEl.parentElement.querySelector("strong").textContent = "建议上机";
        }
        const entryMinimumSeedEl = root.querySelector("#hardwareDarenEntryMinimum");
        if (entryMinimumSeedEl && entryMinimumSeedEl.parentElement) {
            entryMinimumSeedEl.parentElement.querySelector("strong").textContent = "最低发射";
        }
        const stakeInputSeedEl = root.querySelector("#hardwareDarenStakeInput");
        if (stakeInputSeedEl && stakeInputSeedEl.previousElementSibling) {
            stakeInputSeedEl.previousElementSibling.textContent = "投入积分";
        }
        const loanInputSeedEl = root.querySelector("#hardwareDarenLoanInput");
        if (loanInputSeedEl && loanInputSeedEl.previousElementSibling) {
            loanInputSeedEl.previousElementSibling.textContent = "贷款积分";
        }
        const entryStartSeedEl = root.querySelector("#hardwareDarenEntryStart");
        if (entryStartSeedEl) {
            entryStartSeedEl.textContent = "确认开局";
        }
        const entryCloseSeedEl = root.querySelector("#hardwareDarenEntryClose");
        if (entryCloseSeedEl) {
            entryCloseSeedEl.textContent = "继续观察";
        }

        Array.prototype.slice.call(root.querySelectorAll(".hardware-daren__vendor")).forEach(function (node) {
            node.remove();
        });
        if (repairedScopeLoadoutEl && repairedScopeLoadoutEl.parentNode) {
            const repairedVendorEl = document.createElement("img");
            repairedVendorEl.className = "hardware-daren__vendor";
            repairedVendorEl.setAttribute("src", VENDOR_LOGO_URL);
            repairedVendorEl.setAttribute("alt", "241120S 供应商标识");
            repairedScopeLoadoutEl.parentNode.appendChild(repairedVendorEl);
        }

        const canvas = root.querySelector("canvas");
        const canvasCtx = canvas.getContext("2d");
        const signalEl = root.querySelector("#hardwareDarenSignal");
        const scopeMetaEl = root.querySelector("#hardwareDarenScopeMeta");
        const scanlineEl = root.querySelector("#hardwareDarenScanline");
        const scopeHeadHintEl = root.querySelector(".hardware-daren__scope-head span:last-child");
        const chipEl = root.querySelector("#hardwareDarenChip");
        const currentLabelEl = root.querySelector("#hardwareDarenCurrentLabel");
        const currentRoleEl = root.querySelector("#hardwareDarenCurrentRole");
        const currentHintEl = root.querySelector("#hardwareDarenCurrentHint");
        const runtimeHintEl = root.querySelector("#hardwareDarenRuntimeHint");
        const autoBtnEl = root.querySelector("#hardwareDarenAutoBtn");
        const traceEls = [
            root.querySelector("#hardwareDarenTrace0"),
            root.querySelector("#hardwareDarenTrace1"),
            root.querySelector("#hardwareDarenTrace2")
        ];
        const entryEl = root.querySelector("#hardwareDarenEntry");
        const entryTitleEl = root.querySelector("#hardwareDarenEntryTitle");
        const entryCopyEl = root.querySelector("#hardwareDarenEntryCopy");
        const entryWalletEl = root.querySelector("#hardwareDarenEntryWallet");
        const entrySuggestedEl = root.querySelector("#hardwareDarenEntrySuggested");
        const entryMinimumEl = root.querySelector("#hardwareDarenEntryMinimum");
        const stakeInputEl = root.querySelector("#hardwareDarenStakeInput");
        const loanFieldEl = root.querySelector("#hardwareDarenLoanField");
        const loanInputEl = root.querySelector("#hardwareDarenLoanInput");
        const entryMsgEl = root.querySelector("#hardwareDarenEntryMsg");
        const entryResultEl = root.querySelector("#hardwareDarenEntryResult");
        const entryStartEl = root.querySelector("#hardwareDarenEntryStart");
        const entryCloseEl = root.querySelector("#hardwareDarenEntryClose");

        function profileTotalScore() {
            return Math.floor(Number((ctx.state && ctx.state.profile && ctx.state.profile.total_score) || 0));
        }

        function sessionBuyInTotal() {
            return getSessionBuyInTotal(session);
        }

        function sessionNet() {
            return Math.round(session.credits - sessionBuyInTotal());
        }

        function persist() {
            ctx.scheduleGameStateSave(GAME_ID, serializeSession(session), summarizeSession(session));
        }

        function openEntryOverlay(message, isError) {
            session.entryOpen = true;
            if (typeof message === "string") {
                session.entryMessage = message;
                session.entryError = Boolean(isError);
            }
            renderEntry();
            persist();
        }

        function closeEntryOverlay() {
            session.entryOpen = false;
            session.entryMessage = "";
            session.entryError = false;
            renderEntry();
            persist();
        }

        function createResultHtml(result) {
            if (!result) {
                return "";
            }
            return [
                '<strong>' + (result.reason === "cashout" ? "本局已结算" : "本局结束") + "</strong>",
                "买入 " + Math.round((result.stake || 0) + (result.loan || 0)) + "，回收 " + Math.round(result.payout || 0) + "，净收益 " + formatSigned(result.net || 0) + "。",
                "清除 " + Math.round(result.defeated || 0) + "，漏失 " + Math.round(result.escaped || 0) + "，时长 " + ctx.formatSeconds(result.elapsedSeconds || 0) + "。"
            ].join("<br>");
        }

        function renderEntry() {
            entryEl.hidden = !session.entryOpen;
            const available = profileTotalScore();
            if (scopeHeadHintEl) {
                scopeHeadHintEl.textContent = "Q/E 切器件 · A/D 切规格 · Z/C 射速 · F AUTO · X 结算";
            }
            const minimum = smallestShotCost();
            const useLoan = available <= 0;
            const suggested = useLoan ? 1200 : clamp(Math.max(minimum * 6, Math.floor(available * 0.18)), minimum * 2, Math.max(minimum * 6, available));
            entryTitleEl.textContent = session.status === "gameover" ? "余额清零" : (session.openingSubmitted ? "局内暂停" : "投入开局");
            entryCopyEl.textContent = session.openingSubmitted
                ? "这局已经记过账了，可以继续打，也可以马上结算回收当前局内积分。"
                : (useLoan
                    ? "你的总积分已经为 0 或负数，本局可以直接追加贷款上机。贷款会立即计入总账。"
                    : "先从账户里划一笔投入作为本局底金，击中波形回收积分，随时都能结算。");
            entryWalletEl.textContent = String(available);
            entrySuggestedEl.textContent = String(suggested);
            entryMinimumEl.textContent = String(minimum);
            loanFieldEl.hidden = !useLoan;
            if (!session.openingSubmitted && !stakeInputEl.dataset.seeded) {
                stakeInputEl.value = useLoan ? "0" : String(suggested);
                loanInputEl.value = useLoan ? String(suggested) : "0";
                stakeInputEl.dataset.seeded = "1";
            }
            entryMsgEl.textContent = session.entryMessage || "";
            entryMsgEl.classList.toggle("is-error", Boolean(session.entryError));
            entryResultEl.hidden = !session.lastResult;
            entryResultEl.innerHTML = session.lastResult ? createResultHtml(session.lastResult) : "";
            entryStartEl.disabled = session.entryBusy;
            entryCloseEl.disabled = session.entryBusy;
            entryStartEl.textContent = session.openingSubmitted ? "继续本局" : "确认开局";
            entryCloseEl.textContent = session.openingSubmitted ? "关闭面板" : "继续观察";
        }

        function renderStatus() {
            const selected = getSelectedSpec(session);
            const available = profileTotalScore();
            applyChipPresentation(chipEl, selected.family.key, selected.spec.label, selected.index);
            currentLabelEl.textContent = selected.spec.label;
            currentRoleEl.textContent = selected.family.label + " / " + selected.family.role;
            currentHintEl.textContent = describeSpecEffect(selected.family.key, selected.spec) + " · 发射 -" + selected.spec.cost;
            runtimeHintEl.textContent = (session.autoFire ? "AUTO ON" : "AUTO OFF")
                + " · 清除 " + session.defeated
                + " · 漏失 " + session.escaped
                + " · " + ctx.formatSeconds(session.elapsedSeconds);
            currentHintEl.textContent = describeSpecEffect(selected.family.key, selected.spec)
                + " · 发射 -" + selected.spec.cost
                + " · ROF " + getFireRateSummary(session);
            runtimeHintEl.textContent = (session.autoFire ? "AUTO ON" : "AUTO OFF")
                + " · ROF " + getFireRateSummary(session)
                + " · 清除 " + session.defeated
                + " · 漏失 " + session.escaped
                + " · " + ctx.formatSeconds(session.elapsedSeconds);
            if (autoBtnEl) {
                autoBtnEl.classList.toggle("is-active", session.autoFire);
                autoBtnEl.textContent = session.autoFire ? "AUTO ON" : "AUTO";
                autoBtnEl.setAttribute("aria-pressed", session.autoFire ? "true" : "false");
            }
            signalEl.textContent = session.infoText;
            scopeMetaEl.textContent = session.enemies.length
                ? ("活跃 " + session.enemies.length + " · 波次 " + session.wave + " · 连击 x" + session.combo)
                : "80% 波形视图";
            signalEl.style.borderColor = session.status === "gameover" ? "rgba(248,113,113,.35)" : "rgba(245,158,11,.24)";
            signalEl.style.color = session.status === "gameover" ? "#fca5a5" : "#f8fafc";
            scanlineEl.style.transform = "translateX(" + (session.scanlineX - 120) + "px)";
            ctx.setStageStats([
                { label: "账户", value: String(available) },
                { label: "局内", value: String(Math.max(0, Math.round(session.credits))) },
                { label: "净收益", value: formatSigned(sessionNet()) },
                { label: "得分", value: String(session.score) }
            ]);

            TRACE_Y.forEach(function (_, index) {
                const traceEnemies = session.enemies.filter(function (enemy) {
                    return enemy.lineIndex === index;
                });
                if (!traceEnemies.length) {
                    traceEls[index].textContent = "稳定基线";
                    return;
                }
                const primary = traceEnemies.slice().sort(function (left, right) {
                    return right.x - left.x;
                })[0];
                const preset = getWavePreset(primary.type);
                const spreadTag = primary.spreadPixels > 8 ? " · 展宽" : "";
                const slowTag = primary.slowTimer > 0 ? " · 降速" : "";
                traceEls[index].textContent = preset.label + " · 幅度 " + Math.round(getEnemyAmplitude(primary)) + spreadTag + slowTag;
            });
        }

        function renderHud() {
            syncClock(session);
            renderStatus();
            renderEntry();
        }

        function resetToEntry(result, message, isError) {
            const fireRateIndex = session.fireRateIndex;
            session = createSession(result || null);
            session.fireRateIndex = clamp(toInt(fireRateIndex, getDefaultFireRateIndex()), 0, getFireRateOptions().length - 1);
            session.entryMessage = message || "";
            session.entryError = Boolean(isError);
            renderHud();
            renderCanvas(canvasCtx, session);
            persist();
        }

        function changeFamily(step) {
            const currentIndex = FAMILY_KEYS.indexOf(session.selectedFamily);
            session.selectedFamily = FAMILY_KEYS[(currentIndex + step + FAMILY_KEYS.length) % FAMILY_KEYS.length];
            const selected = getSelectedSpec(session);
            session.infoText = selected.family.label + " " + selected.spec.label;
            renderHud();
            persist();
        }

        function cycleSpec(step) {
            const family = getFamilyPreset(session.selectedFamily);
            const currentIndex = clamp(toInt(session.selectedSpecIndex[family.key], 0), 0, family.specs.length - 1);
            session.selectedSpecIndex[family.key] = (currentIndex + step + family.specs.length) % family.specs.length;
            const selected = getSelectedSpec(session);
            session.infoText = selected.family.label + " " + selected.spec.label;
            renderHud();
            persist();
        }

        function changeFireRate(step) {
            const options = getFireRateOptions();
            const nextIndex = clamp(session.fireRateIndex + step, 0, options.length - 1);
            if (nextIndex === session.fireRateIndex) {
                return;
            }
            session.fireRateIndex = nextIndex;
            session.infoText = "射速 " + getFireRateSummary(session);
            renderHud();
            persist();
        }

        function startActiveRun(stakeAmount, loanAmount) {
            session.openingSubmitted = true;
            session.cashoutSubmitted = false;
            session.stakeAmount = stakeAmount;
            session.loanAmount = loanAmount;
            session.startingCredits = stakeAmount + loanAmount;
            session.credits = stakeAmount + loanAmount;
            session.score = 0;
            session.combo = 0;
            session.bestCombo = 0;
            session.defeated = 0;
            session.escaped = 0;
            session.wave = 1;
            session.elapsedSeconds = 0;
            session.startedAt = Date.now();
            session.lastFrameAt = 0;
            session.spawnTimer = 1.05;
            session.reloadTimer = 0;
            session.autoAssistUsed = session.autoFire;
            session.pointerTriggerHeld = false;
            session.feedOffset = 0;
            session.feedAdvance = 0;
            session.enemies = [];
            session.bullets = [];
            session.nextEnemyId = 1;
            session.nextBulletId = 1;
            session.status = "playing";
            session.entryOpen = false;
            session.entryBusy = false;
            session.entryMessage = "";
            session.entryError = false;
            session.lastResult = null;
            session.infoText = "买入完成，开始搜波。";
            ctx.syncPresence("投入中", "");
            renderHud();
            persist();
        }

        async function bookOpeningLedger() {
            if (session.openingSubmitted) {
                session.status = "playing";
                session.startedAt = Date.now() - session.elapsedSeconds * 1000;
                closeEntryOverlay();
                ctx.syncPresence("继续搜波", "");
                renderHud();
                persist();
                return;
            }
            const available = profileTotalScore();
            const minimum = smallestShotCost();
            const useLoan = available <= 0;
            const stakeAmount = Math.max(0, toInt(stakeInputEl.value, 0));
            const loanAmount = useLoan ? Math.max(0, toInt(loanInputEl.value, 0)) : 0;
            const opening = stakeAmount + loanAmount;

            if (!useLoan) {
                if (stakeAmount <= 0) {
                    openEntryOverlay("投入积分必须大于 0。", true);
                    return;
                }
                if (stakeAmount > available) {
                    openEntryOverlay("投入不能超过当前总积分 " + available + "。", true);
                    return;
                }
            } else if (loanAmount <= 0) {
                openEntryOverlay("当前积分不足，请输入贷款额度后再开局。", true);
                return;
            }

            if (opening < minimum) {
                openEntryOverlay("总投入至少要覆盖一次最低发射成本 " + minimum + "。", true);
                return;
            }

            session.entryBusy = true;
            session.entryMessage = "正在记账并点亮示波器...";
            session.entryError = false;
            renderEntry();

            try {
                await ctx.submitScore(GAME_ID, -opening, "trace-buyin", session.sessionKey, {
                    ledger_type: "buy_in",
                    stake_amount: stakeAmount,
                    loan_amount: loanAmount,
                    wallet_before: available,
                    opening_total: opening
                });
                startActiveRun(stakeAmount, loanAmount);
            } catch (error) {
                session.entryBusy = false;
                openEntryOverlay(error.message || "买入记账失败，请稍后重试。", true);
            }
        }

        async function cashOut(reason) {
            if (!session.openingSubmitted || session.cashoutSubmitted || session.entryBusy) {
                return;
            }
            session.entryBusy = true;
            session.entryMessage = "正在结算当前回收...";
            session.entryError = false;
            session.status = "paused";
            session.entryOpen = true;
            syncClock(session);
            renderHud();
            persist();

            const settlement = buildCashoutSettlement(session);
            const payout = settlement.creditedPayout;
            const result = {
                reason: reason || "cashout",
                payout: payout,
                net: settlement.creditedNet,
                stake: session.stakeAmount,
                loan: session.loanAmount,
                defeated: session.defeated,
                escaped: session.escaped,
                elapsedSeconds: session.elapsedSeconds,
                rawPayout: settlement.rawPayout,
                rawNet: settlement.rawNet,
                netProfitCap: settlement.netProfitCap,
                rateLimited: settlement.rateLimited
            };

            try {
                if (payout > 0) {
                    await ctx.submitScore(GAME_ID, payout, "trace-cashout", session.sessionKey, {
                        ledger_type: "cash_out",
                        payout: payout,
                        raw_payout: settlement.rawPayout,
                        net_profit: result.net,
                        raw_net_profit: settlement.rawNet,
                        net_profit_cap: settlement.netProfitCap,
                        rate_limited: settlement.rateLimited,
                        settlement_mode: settlement.settlementMode,
                        manual_bonus_applied: settlement.manualBonusApplied,
                        buy_in_total: settlement.buyInTotal,
                        stake_amount: session.stakeAmount,
                        loan_amount: session.loanAmount,
                        defeated: session.defeated,
                        escaped: session.escaped,
                        best_combo: session.bestCombo,
                        elapsed_seconds: session.elapsedSeconds,
                        reason: reason || "cashout"
                    });
                }
                resetToEntry(result, payout > 0 ? ("已回收 " + payout + "，净收益 " + formatSigned(result.net) + "。") : "这局没有可回收余额。", result.net < 0);
            } catch (error) {
                session.entryBusy = false;
                openEntryOverlay(error.message || "结算失败，请稍后重试。", true);
            }
        }

        function pauseSession() {
            if (session.status !== "playing") {
                return;
            }
            syncClock(session);
            session.status = "paused";
            session.infoText = "已暂停，可继续或结算。";
            ctx.syncPresence("暂停监控", "");
            renderHud();
            persist();
        }

        function resumeSession() {
            if (session.status !== "paused") {
                return;
            }
            closeEntryOverlay();
            session.status = "playing";
            session.startedAt = Date.now() - session.elapsedSeconds * 1000;
            session.infoText = "重新锁定通道。";
            ctx.syncPresence("继续搜波", "");
            renderHud();
            persist();
        }

        function toggleAutoFire() {
            if (!session.openingSubmitted) {
                openEntryOverlay("先投入开局后再切自动模式。", true);
                return;
            }
            session.autoFire = !session.autoFire;
            if (session.autoFire) {
                session.autoAssistUsed = true;
            }
            session.infoText = session.autoFire ? "自动瞄准接管。" : "手动瞄准恢复。";
            renderHud();
            persist();
        }

        function fire() {
            const selected = getSelectedSpec(session);
            if (session.status !== "playing" || session.entryOpen || session.reloadTimer > 0) {
                return;
            }
            if (session.credits < selected.spec.cost) {
                session.infoText = "余额不足，请切低成本规格或结算。";
                renderHud();
                return;
            }
            session.credits -= selected.spec.cost;
            session.bullets.push(createBullet(session));
            session.reloadTimer = getReloadDuration(session);
            session.feedAdvance += FEED_SLOT_SPACING;
            session.infoText = selected.family.label + " " + selected.spec.label + " 发射";
            renderHud();
        }

        function maybeAutoFire() {
            if (!session.autoFire || session.status !== "playing" || session.entryOpen || session.reloadTimer > 0) {
                return;
            }
            const selected = getSelectedSpec(session);
            if (session.credits < selected.spec.cost) {
                return;
            }
            const target = findAutoAimPoint(session);
            if (!target) {
                return;
            }
            session.autoAssistUsed = true;
            session.aimAngle = target.angle;
            fire();
        }

        function maybeHeldManualFire() {
            if (session.autoFire || !session.pointerTriggerHeld || session.status !== "playing" || session.entryOpen || session.reloadTimer > 0) {
                return;
            }
            fire();
        }

        function pointerToAngle(event) {
            const rect = canvas.getBoundingClientRect();
            const scaleX = SCOPE_WIDTH / Math.max(1, rect.width);
            const scaleY = SCOPE_HEIGHT / Math.max(1, rect.height);
            const x = (event.clientX - rect.left) * scaleX;
            const y = (event.clientY - rect.top) * scaleY;
            return clampAimAngle(Math.atan2(y - CANNON_Y, x - CANNON_X));
        }

        function handlePointerMove(event) {
            session.aimAngle = pointerToAngle(event);
        }

        function handlePointerDown(event) {
            event.preventDefault();
            if (event.button !== 0) {
                return;
            }
            if (session.entryOpen || session.status === "entry") {
                openEntryOverlay(session.entryMessage || "先完成投入再开火。", true);
                return;
            }
            session.pointerTriggerHeld = true;
            session.aimAngle = pointerToAngle(event);
            if (session.status === "paused") {
                resumeSession();
            }
            fire();
        }

        function handlePointerUp(event) {
            if (event && event.button != null && event.button !== 0) {
                return;
            }
            session.pointerTriggerHeld = false;
        }

        function handleRootClick(event) {
            const actionButton = event.target.closest("[data-action]");
            if (!actionButton) {
                return;
            }
            const action = String(actionButton.getAttribute("data-action") || "");
            if (action === "family-prev") {
                changeFamily(-1);
                return;
            }
            if (action === "family-next") {
                changeFamily(1);
                return;
            }
            if (action === "spec-prev") {
                cycleSpec(-1);
                return;
            }
            if (action === "spec-next") {
                cycleSpec(1);
                return;
            }
            if (action === "auto-toggle") {
                if (!session.openingSubmitted) {
                    session.autoFire = !session.autoFire;
                    session.infoText = session.autoFire ? "AUTO PRESET ON" : "AUTO PRESET OFF";
                    renderHud();
                    persist();
                    return;
                }
                toggleAutoFire();
            }
        }

        function handleKeyDown(event) {
            if (ctx.state.activeGameId !== GAME_ID) {
                return;
            }
            if (event.key === "q" || event.key === "Q") {
                changeFamily(-1);
                return;
            }
            if (event.key === "e" || event.key === "E") {
                changeFamily(1);
                return;
            }
            if (event.key === "a" || event.key === "A") {
                cycleSpec(-1);
                return;
            }
            if (event.key === "d" || event.key === "D") {
                cycleSpec(1);
                return;
            }
            if (event.key === "z" || event.key === "Z") {
                changeFireRate(-1);
                return;
            }
            if (event.key === "c" || event.key === "C") {
                changeFireRate(1);
                return;
            }
            if (event.key === "f" || event.key === "F") {
                toggleAutoFire();
                return;
            }
            if (event.key === "p" || event.key === "P") {
                if (session.status === "playing") {
                    pauseSession();
                } else if (session.status === "paused") {
                    resumeSession();
                }
                return;
            }
            if (event.key === "x" || event.key === "X") {
                cashOut("manual_cashout");
                return;
            }
            if (event.key === "r" || event.key === "R") {
                openEntryOverlay("重新投入会开启新一局。", false);
                return;
            }
            if (event.key === "Enter" && session.entryOpen) {
                bookOpeningLedger();
            }
        }

        function openHelp() {
            ctx.openGameInfoOverlay(root, {
                title: "硬件达人说明",
                subtitle: "这版改成了更接近捕鱼达人的记账循环，局内余额就是你的炮台资金。",
                bullets: [
                    "先投入开局，若总积分已经为零或负数，可以追加贷款直接上机。",
                    "电容走爆发，电阻负责减速，电感负责拉宽波形并提升命中率。",
                    "同轨波形被电感拉宽后会叠在一起，示波器会按叠加后的新波形来画和判定。",
                    "逃掉的波形不会直接判负，只有局内余额归零才算本局失败。",
                    "按 C 或点结算可以随时回收当前局内积分。"
                ],
                buttonLabel: "关闭说明"
            });
        }

        function frame(time) {
            if (!session.lastFrameAt) {
                session.lastFrameAt = time;
            }
            const deltaSeconds = Math.min(0.033, Math.max(0.001, (time - session.lastFrameAt) / 1000));
            session.lastFrameAt = time;
            try {
                updateSession(session, deltaSeconds);
                maybeAutoFire();
                maybeHeldManualFire();
                renderCanvas(canvasCtx, session);
                renderHud();
                if (session.status === "gameover") {
                    ctx.syncPresence("本局爆仓", "");
                }
            } catch (error) {
                session.status = "paused";
                session.entryOpen = true;
                session.entryMessage = (error && error.message) ? ("运行错误: " + error.message) : "运行错误";
                session.entryError = true;
                session.infoText = "RUNTIME FAULT";
                ctx.setStatus((error && error.message) ? ("硬件达人运行错误: " + error.message) : "硬件达人运行错误", true);
            }
            animationId = window.requestAnimationFrame(frame);
        }

        ctx.addStageButton("投入开局", function () {
            openEntryOverlay(session.entryMessage || "设置买入后即可开局。", false);
        }, true);
        ctx.addStageButton("暂停/继续", function () {
            if (session.status === "playing") {
                pauseSession();
            } else if (session.status === "paused") {
                resumeSession();
            } else {
                openEntryOverlay("先买入开局。", false);
            }
        }, false);
        ctx.addStageButton("结算退出", function () {
            cashOut("manual_cashout");
        }, false);
        ctx.addStageButton("帮助", function () {
            openHelp();
        }, false);

        canvas.addEventListener("mousemove", handlePointerMove);
        canvas.addEventListener("mousedown", handlePointerDown);
        canvas.addEventListener("mouseleave", handlePointerUp);
        window.addEventListener("mouseup", handlePointerUp);
        root.addEventListener("click", handleRootClick);
        document.addEventListener("keydown", handleKeyDown);
        entryStartEl.addEventListener("click", function () {
            if (session.openingSubmitted) {
                resumeSession();
                return;
            }
            bookOpeningLedger();
        });
        entryCloseEl.addEventListener("click", function () {
            if (session.openingSubmitted) {
                closeEntryOverlay();
                return;
            }
            closeEntryOverlay();
        });

        persistTimerId = window.setInterval(function () {
            persist();
        }, 1800);

        renderHud();
        renderCanvas(canvasCtx, session);
        animationId = window.requestAnimationFrame(frame);
        persist();

        return function cleanup() {
            canvas.removeEventListener("mousemove", handlePointerMove);
            canvas.removeEventListener("mousedown", handlePointerDown);
            canvas.removeEventListener("mouseleave", handlePointerUp);
            window.removeEventListener("mouseup", handlePointerUp);
            root.removeEventListener("click", handleRootClick);
            document.removeEventListener("keydown", handleKeyDown);
            if (animationId) {
                window.cancelAnimationFrame(animationId);
            }
            if (persistTimerId) {
                window.clearInterval(persistTimerId);
            }
            syncClock(session);
            persist();
        };
    }

    modules.register(GAME_ID, mountHardwareDaren);
})();
