(function () {
    "use strict";

    const modules = window.GamesHubModules;
    if (!modules || typeof modules.register !== "function") {
        return;
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
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
            core: { key: "core", label: "核心", shortLabel: "CORE", intervalMultiplier: 1, amountMultiplier: 1, capMultiplier: 1.05, defenseMultiplier: 1.05, priorityScore: 12, travelMultiplier: 1, dispatchMultiplier: 1 },
            normal: { key: "normal", label: "前哨", shortLabel: "OUT", intervalMultiplier: 1, amountMultiplier: 1, capMultiplier: 1, defenseMultiplier: 1, priorityScore: 0, travelMultiplier: 1, dispatchMultiplier: 1 },
            foundry: { key: "foundry", label: "工坊", shortLabel: "FND", intervalMultiplier: 0.8, amountMultiplier: 1, capMultiplier: 0.95, defenseMultiplier: 0.95, priorityScore: 34, travelMultiplier: 1, dispatchMultiplier: 1 },
            bastion: { key: "bastion", label: "堡垒", shortLabel: "BST", intervalMultiplier: 1.08, amountMultiplier: 1, capMultiplier: 1.28, defenseMultiplier: 1.35, priorityScore: 28, travelMultiplier: 1, dispatchMultiplier: 1 },
            surge: { key: "surge", label: "脉冲塔", shortLabel: "SRG", intervalMultiplier: 1.18, amountMultiplier: 1.55, capMultiplier: 1.08, defenseMultiplier: 1, priorityScore: 22, travelMultiplier: 1, dispatchMultiplier: 1 },
            relay: { key: "relay", label: "中继塔", shortLabel: "RLY", intervalMultiplier: 0.94, amountMultiplier: 0.92, capMultiplier: 0.92, defenseMultiplier: 0.96, priorityScore: 26, travelMultiplier: 0.72, dispatchMultiplier: 1 },
            arsenal: { key: "arsenal", label: "军械塔", shortLabel: "ARS", intervalMultiplier: 1.12, amountMultiplier: 0.96, capMultiplier: 0.9, defenseMultiplier: 0.92, priorityScore: 31, travelMultiplier: 0.96, dispatchMultiplier: 1.18 },
            vault: { key: "vault", label: "储备塔", shortLabel: "VLT", intervalMultiplier: 1.1, amountMultiplier: 1.08, capMultiplier: 1.42, defenseMultiplier: 1.18, priorityScore: 24, travelMultiplier: 1.08, dispatchMultiplier: 1 }
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
        if (meta.key === "relay") {
            return "中继塔：行军更快，适合抢点接力。";
        }
        if (meta.key === "arsenal") {
            return "军械塔：出兵会有额外增幅，擅长正面压制。";
        }
        if (meta.key === "vault") {
            return "储备塔：容量更夸张，适合囤兵后再反扑。";
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

    function frontlineClampNodePosition(node, width, height, padding) {
        node.x = clamp(Math.round(Number(node.x || 0)), padding, width - padding);
        node.y = clamp(Math.round(Number(node.y || 0)), padding, height - padding);
    }

    function frontlineSeparateNodes(nodes, width, height, fixedIds) {
        const padding = 76;
        const minDistance = 116;
        const locked = fixedIds || {};
        for (let iteration = 0; iteration < 28; iteration += 1) {
            let moved = false;
            for (let index = 0; index < nodes.length; index += 1) {
                const node = nodes[index];
                for (let otherIndex = index + 1; otherIndex < nodes.length; otherIndex += 1) {
                    const other = nodes[otherIndex];
                    const dx = Number(other.x || 0) - Number(node.x || 0);
                    const dy = Number(other.y || 0) - Number(node.y || 0);
                    const distance = Math.sqrt(dx * dx + dy * dy) || 0.0001;
                    if (distance >= minDistance) {
                        continue;
                    }
                    const overlap = (minDistance - distance) / 2;
                    const normalX = dx / distance;
                    const normalY = dy / distance;
                    const nodeLocked = Boolean(locked[node.id]);
                    const otherLocked = Boolean(locked[other.id]);
                    if (nodeLocked && otherLocked) {
                        continue;
                    }
                    if (nodeLocked) {
                        other.x += normalX * overlap * 2;
                        other.y += normalY * overlap * 2;
                    } else if (otherLocked) {
                        node.x -= normalX * overlap * 2;
                        node.y -= normalY * overlap * 2;
                    } else {
                        node.x -= normalX * overlap;
                        node.y -= normalY * overlap;
                        other.x += normalX * overlap;
                        other.y += normalY * overlap;
                    }
                    frontlineClampNodePosition(node, width, height, padding);
                    frontlineClampNodePosition(other, width, height, padding);
                    moved = true;
                }
            }
            if (!moved) {
                break;
            }
        }
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
        const availableTypes = frontlineShuffle(["foundry", "bastion", "surge", "relay", "arsenal", "vault"]);
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
            } else if (node.towerType === "vault") {
                guard += 5;
            } else if (node.towerType === "arsenal") {
                guard += 3;
            } else if (node.towerType === "relay") {
                guard += 1;
            }
            node.unitCount = Math.max(6, guard);
        });

        frontlineSeparateNodes(nodes, width, height, {
            [mainNodes[0] ? mainNodes[0].id : ""]: true,
            [mainNodes[mainNodes.length - 1] ? mainNodes[mainNodes.length - 1].id : ""]: true
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
            travelMultiplier: meta.travelMultiplier,
            dispatchMultiplier: meta.dispatchMultiplier,
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
        const normalizedStatus = raw.status === "victory" || raw.status === "defeat" ? raw.status : "playing";
        const normalizedElapsed = Number(raw.elapsedSeconds || 0);
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
            status: normalizedStatus,
            startedAt: normalizedStatus === "playing"
                ? (Date.now() - normalizedElapsed * 1000)
                : Number(raw.startedAt || Date.now()),
            elapsedSeconds: normalizedElapsed,
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
                    unitCount: Math.max(0, Math.round(Number(source.unitCount != null ? source.unitCount : node.unitCount))),
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
                    count: Math.max(0, Math.round(Number(squad.count || 0))),
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
                    unitCount: Math.round(tower.unitCount),
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

    function mountFrontline(savedPayload, ctx) {
        const addStageButton = ctx.addStageButton;
        const scheduleGameStateSave = ctx.scheduleGameStateSave;
        const submitScore = ctx.submitScore;
        const syncPresence = ctx.syncPresence;
        const setStageStats = ctx.setStageStats;
        const formatSeconds = ctx.formatSeconds;
        const setStatus = ctx.setStatus;
        const openGameInfoOverlay = ctx.openGameInfoOverlay;
        const createGameStartOverlay = ctx.createGameStartOverlay;
        const escapeHtml = ctx.escapeHtml;
        const state = ctx.state;
        const els = ctx.els;
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
            subtitle: "随机地图单机版，包含难度分档、六种功能塔、拖拽派兵和基础 AI。",
            bullets: [
                "从塔的四宫格区域按下并拖到相邻塔，可以按 25/50/75/100% 派兵。",
                "不同难度会改变主路径长度、分支数量、中立守军和特殊塔数量。",
                "工坊、堡垒、脉冲、中继、军械、储备塔各有专长；胜利后会播放结算动画并展示加分。"
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
            const sourceSpec = getTowerSpecForTower(source);
            source.unitCount = Math.max(0, source.unitCount - sendCount);
            session.squads.push({
                id: session.nextSquadId,
                owner: owner,
                fromId: fromId,
                toId: toId,
                count: Math.max(1, Math.round(sendCount * Math.max(1, Number(sourceSpec.dispatchMultiplier || 1)))),
                progress: 0,
                travelMs: Math.max(800, Math.round(edge.travelMs * Math.max(0.6, Number(sourceSpec.travelMultiplier || 1))))
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
            let sendCount = ratio >= 1 ? available : Math.floor(available * ratio);
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
            const defenseMultiplier = Math.max(1, Number(spec.defenseMultiplier || 1));
            const effectiveGuard = Math.max(0, Math.round(tower.unitCount * defenseMultiplier));
            if (squad.count > effectiveGuard) {
                const remainder = squad.count - effectiveGuard;
                const previousOwner = tower.owner;
                tower.owner = squad.owner;
                tower.unitCount = Math.max(1, Math.round(remainder));
                tower.prodProgressMs = 0;
                if (previousOwner === "player" || previousOwner === "ai") {
                    tower.level = Math.max(1, tower.level - 1);
                }
                return;
            }
            tower.unitCount = Math.max(0, Math.ceil((effectiveGuard - squad.count) / defenseMultiplier));
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
                    } else if (towerNode && towerNode.towerType === "relay") {
                        score += 10;
                    } else if (towerNode && towerNode.towerType === "arsenal") {
                        score += 14;
                    } else if (towerNode && towerNode.towerType === "vault") {
                        score += 4;
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
                '  <div class="game-frontline-note">行军速度：' + escapeHtml(Math.round((1 / Math.max(0.6, spec.travelMultiplier)) * 100)) + '% / 出兵兵力：' + escapeHtml(Math.round(spec.dispatchMultiplier * 100)) + '%</div>',
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

    modules.register("frontline", mountFrontline);
})();
