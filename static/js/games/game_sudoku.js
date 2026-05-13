(function () {
    "use strict";

    const modules = window.GamesHubModules;
    if (!modules || typeof modules.register !== "function") {
        return;
    }

    const HEX_SYMBOLS = "0123456789ABCDEF".split("");
    const CLASSIC_SYMBOLS = "123456789".split("");

    function fnv1aHash(input) {
        let hash = 0x811c9dc5;
        const value = String(input || "");
        for (let index = 0; index < value.length; index += 1) {
            hash ^= value.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
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

    function seededRandom(seed) {
        let value = fnv1aHash(seed || "seed").split("").reduce(function (sum, char) {
            return (sum * 31 + char.charCodeAt(0)) >>> 0;
        }, 2166136261);
        return function () {
            value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
            return value / 4294967296;
        };
    }

    function shuffleWithSeed(items, seed) {
        const result = items.slice();
        const random = seededRandom(seed);
        for (let index = result.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(random() * (index + 1));
            const temp = result[index];
            result[index] = result[swapIndex];
            result[swapIndex] = temp;
        }
        return result;
    }

    function isSudokuBlankChar(puzzle, char) {
        return char === "." || (puzzle.variant !== "hex" && char === "0");
    }

    function sudokuPuzzleToBoard(puzzle) {
        return String(puzzle.puzzle || "").split("").map(function (char) {
            return isSudokuBlankChar(puzzle, char) ? "" : char;
        });
    }

    function normalizeSudokuBoardState(rawBoard, puzzle) {
        const fixedBoard = sudokuPuzzleToBoard(puzzle);
        const symbols = puzzle.symbols || CLASSIC_SYMBOLS;
        const source = Array.isArray(rawBoard) ? rawBoard.slice(0, puzzle.size * puzzle.size) : [];
        return Array.from({ length: puzzle.size * puzzle.size }, function (_, index) {
            if (fixedBoard[index]) {
                return fixedBoard[index];
            }
            const value = String(source[index] || "").toUpperCase().slice(-1);
            return symbols.indexOf(value) !== -1 ? value : "";
        });
    }

    function countSudokuSolutionsForBoard(board, puzzle, limit) {
        const size = Number(puzzle.size || 9);
        const subgrid = Number(puzzle.subgrid || 3);
        const symbols = (puzzle.symbols || CLASSIC_SYMBOLS).slice(0, size);
        const symbolToBit = {};
        const fullMask = (1 << size) - 1;
        const rowMasks = new Array(size).fill(0);
        const colMasks = new Array(size).fill(0);
        const boxMasks = new Array(size).fill(0);
        const cells = new Array(size * size);
        let solutionCount = 0;
        const maxSolutions = Math.max(1, Number(limit || 2));

        symbols.forEach(function (symbol, index) {
            symbolToBit[symbol] = 1 << index;
        });

        function boxIndex(row, col) {
            return Math.floor(row / subgrid) * (size / subgrid) + Math.floor(col / subgrid);
        }

        for (let index = 0; index < size * size; index += 1) {
            const value = board[index] || "";
            cells[index] = value;
            if (!value) {
                continue;
            }
            const bit = symbolToBit[value];
            if (!bit) {
                return 0;
            }
            const row = Math.floor(index / size);
            const col = index % size;
            const box = boxIndex(row, col);
            if ((rowMasks[row] & bit) || (colMasks[col] & bit) || (boxMasks[box] & bit)) {
                return 0;
            }
            rowMasks[row] |= bit;
            colMasks[col] |= bit;
            boxMasks[box] |= bit;
        }

        function bitCount(mask) {
            let count = 0;
            let value = mask >>> 0;
            while (value) {
                value &= value - 1;
                count += 1;
            }
            return count;
        }

        function search() {
            if (solutionCount >= maxSolutions) {
                return;
            }
            let bestIndex = -1;
            let bestMask = 0;
            let bestCount = size + 1;
            for (let index = 0; index < cells.length; index += 1) {
                if (cells[index]) {
                    continue;
                }
                const row = Math.floor(index / size);
                const col = index % size;
                const box = boxIndex(row, col);
                const mask = fullMask & ~(rowMasks[row] | colMasks[col] | boxMasks[box]);
                const count = bitCount(mask);
                if (count === 0) {
                    return;
                }
                if (count < bestCount) {
                    bestCount = count;
                    bestIndex = index;
                    bestMask = mask;
                    if (count === 1) {
                        break;
                    }
                }
            }
            if (bestIndex === -1) {
                solutionCount += 1;
                return;
            }
            const row = Math.floor(bestIndex / size);
            const col = bestIndex % size;
            const box = boxIndex(row, col);
            for (let symbolIndex = 0; symbolIndex < symbols.length; symbolIndex += 1) {
                const bit = 1 << symbolIndex;
                if (!(bestMask & bit)) {
                    continue;
                }
                cells[bestIndex] = symbols[symbolIndex];
                rowMasks[row] |= bit;
                colMasks[col] |= bit;
                boxMasks[box] |= bit;
                search();
                rowMasks[row] &= ~bit;
                colMasks[col] &= ~bit;
                boxMasks[box] &= ~bit;
                cells[bestIndex] = "";
                if (solutionCount >= maxSolutions) {
                    return;
                }
            }
        }

        search();
        return solutionCount;
    }

    function hasUniqueSudokuSolution(puzzle) {
        return countSudokuSolutionsForBoard(sudokuPuzzleToBoard(puzzle), puzzle, 2) === 1;
    }

    function makeUniqueSudokuPuzzle(solution, puzzle, targetClues, seed) {
        const chars = solution.split("");
        const cellOrder = shuffleWithSeed(Array.from({ length: chars.length }, function (_, index) { return index; }), seed);
        const minClues = Math.max(1, Math.min(chars.length, Number(targetClues || chars.length)));
        let clues = chars.length;
        cellOrder.forEach(function (index) {
            if (clues <= minClues) {
                return;
            }
            const previous = chars[index];
            chars[index] = ".";
            const candidate = Object.assign({}, puzzle, { puzzle: chars.join(""), solution: solution });
            if (hasUniqueSudokuSolution(candidate)) {
                clues -= 1;
            } else {
                chars[index] = previous;
            }
        });
        return chars.join("");
    }

    function ensureUniqueSudokuPuzzleDefinition(puzzle) {
        if (hasUniqueSudokuSolution(puzzle)) {
            return puzzle;
        }
        const chars = String(puzzle.puzzle || "").split("");
        const solution = String(puzzle.solution || "");
        const blanks = shuffleWithSeed(chars.map(function (char, index) {
            return isSudokuBlankChar(puzzle, char) ? index : -1;
        }).filter(function (index) { return index >= 0; }), puzzle.id + "-repair");
        for (let index = 0; index < blanks.length; index += 1) {
            chars[blanks[index]] = solution[blanks[index]];
            const repaired = Object.assign({}, puzzle, { puzzle: chars.join("") });
            if (hasUniqueSudokuSolution(repaired)) {
                return repaired;
            }
        }
        return Object.assign({}, puzzle, { puzzle: solution });
    }

    function buildHexPuzzleDefinition(id, name, clueTarget, rowShiftSeed) {
        const size = 16;
        const subgrid = 4;
        const solutionChars = [];
        const bandOrder = shuffleWithSeed([0, 1, 2, 3], (rowShiftSeed || id) + "-bands");
        const rowSequence = [];
        bandOrder.forEach(function (band) {
            shuffleWithSeed([0, 1, 2, 3], (rowShiftSeed || id) + "-rows-" + band).forEach(function (rowInBand) {
                rowSequence.push(band * subgrid + rowInBand);
            });
        });
        const rowOffsets = rowSequence.map(function (baseRow) {
            return (subgrid * (baseRow % subgrid) + Math.floor(baseRow / subgrid)) % size;
        });

        for (let row = 0; row < size; row += 1) {
            for (let col = 0; col < size; col += 1) {
                const index = (rowOffsets[row] + col) % size;
                const symbol = HEX_SYMBOLS[index];
                solutionChars.push(symbol);
            }
        }

        const solution = solutionChars.join("");
        const basePuzzle = {
            id: id,
            name: name,
            variant: "hex",
            difficulty: "super",
            size: 16,
            subgrid: 4,
            symbols: HEX_SYMBOLS,
            puzzle: solution,
            solution: solution
        };

        return {
            id: id,
            name: name,
            variant: "hex",
            difficulty: "super",
            size: 16,
            subgrid: 4,
            symbols: HEX_SYMBOLS,
            puzzle: makeUniqueSudokuPuzzle(solution, basePuzzle, clueTarget, id + "-holes"),
            solution: solution
        };
    }

    const hexPuzzles = [
        buildHexPuzzleDefinition("hex-16-01", "HEX-16 Grid A", 168, "hex-row-order-a"),
        buildHexPuzzleDefinition("hex-16-02", "HEX-16 Grid B", 160, "hex-row-order-b"),
        buildHexPuzzleDefinition("hex-16-03", "HEX-16 Grid C", 152, "hex-row-order-c")
    ];
    const allSudokuPuzzles = classicPuzzles.concat(hexPuzzles).map(ensureUniqueSudokuPuzzleDefinition);

    function getPuzzleById(id) {
        return allSudokuPuzzles.find(function (item) { return item.id === id; }) || classicPuzzles[0];
    }

    function getPuzzlesForMode(modeKey) {
        if (modeKey === "hex-16") {
            return allSudokuPuzzles.filter(function (item) { return item.variant === "hex"; });
        }
        const parts = String(modeKey || "classic-medium").split("-");
        const difficulty = parts[1] || "medium";
        return allSudokuPuzzles.filter(function (item) {
            return item.variant !== "hex" && item.difficulty === difficulty;
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
            board: normalizeSudokuBoardState([], puzzle),
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
            board: normalizeSudokuBoardState(raw.board, puzzle),
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

    function mountSudoku(savedPayload, ctx) {
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

        ctx.addStageButton("提交/校验", function () {
            session.checks += 1;
            validateAndMaybeFinish(true);
            persist();
        }, true);
        ctx.addStageButton("重复提示", function () {
            session.checks += 1;
            const puzzle = getPuzzleById(session.puzzleId);
            const conflicts = findSudokuConflicts(session.board, puzzle);
            validateAndMaybeFinish(false);
            if (!conflicts.size) {
                ctx.setStatus("当前没有重复冲突。", false);
            } else {
                ctx.setStatus("重复提示：" + summarizeSudokuConflictHints(session.board, puzzle, 3).join("；"), true);
            }
            persist();
        }, false);
        ctx.addStageButton("自动解题", function () {
            const puzzle = getPuzzleById(session.puzzleId);
            session.board = puzzle.solution.split("");
            session.usedSolver = true;
            session.completed = true;
            syncSudokuClock(session);
            session.pausedElapsed = session.elapsedSeconds;
            drawBoard();
            persist();
            ctx.setStatus("已自动解题，本局不计分。", false);
        }, false);
        ctx.addStageButton("存档点", function () {
            const snapshot = serializeSudokuSession(session);
            snapshot.pausedElapsed = snapshot.elapsedSeconds;
            snapshot.paused = false;
            manualCheckpoint = snapshot;
            persist();
            ctx.setStatus("已记录 1 个数独存档点。", false);
        }, false);
        ctx.addStageButton("读档", function () {
            if (!manualCheckpoint) {
                ctx.setStatus("当前还没有可读取的存档点。", true);
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
            ctx.setStatus("已恢复到手动存档点。", false);
        }, false);
        ctx.addStageButton("重置当前题", function () {
            const puzzle = getPuzzleById(session.puzzleId);
            session = createSudokuSession(session.modeKey, { puzzleId: puzzle.id });
            drawBoard();
            persist();
        }, false);
        ctx.addStageButton("换一题", function () {
            session = createSudokuSession(session.modeKey, { previousPuzzleId: session.puzzleId });
            drawBoard();
            persist();
        }, false);
        let pauseButton = ctx.addStageButton("暂停", function () {
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
        ctx.addStageButton("帮助", function () {
            ctx.openGameInfoOverlay(playfieldEl, sudokuHelpConfig);
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
        ctx.els.stageBody.appendChild(shell);

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
            const btn = ctx.addStageTagButton(mode.label, function () {
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
            const canvasCtx = victoryCanvas.getContext("2d");
            canvasCtx.clearRect(0, 0, victoryCanvas.width, victoryCanvas.height);
        }

        function resizeSudokuVictoryCanvas() {
            const rect = playfieldEl.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            victoryCanvas.width = Math.max(1, Math.round(rect.width * dpr));
            victoryCanvas.height = Math.max(1, Math.round(rect.height * dpr));
            victoryCanvas.style.width = rect.width + "px";
            victoryCanvas.style.height = rect.height + "px";
            const canvasCtx = victoryCanvas.getContext("2d");
            canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
            return { width: rect.width, height: rect.height };
        }

        function syncSudokuBoardLayout() {
            const puzzle = getPuzzleById(session.puzzleId);
            const rect = playfieldEl.getBoundingClientRect();
            const stageRect = shell.getBoundingClientRect();
            const isSingleColumn = stageRect.width < 1180;
            const maxBoardSize = puzzle.size >= 16 ? 980 : 760;
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
                const angle = Math.PI * 2 * index / burstSize + ctx.randomBetween(-0.08, 0.08);
                const speed = ctx.randomBetween(54, 160 + power);
                victoryParticles.push({
                    x: x,
                    y: y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    life: ctx.randomBetween(0.9, 1.8),
                    maxLife: ctx.randomBetween(0.9, 1.8),
                    radius: ctx.randomBetween(1.6, 3.8),
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
                        ctx.randomBetween(rect.width * 0.14, rect.width * 0.86),
                        ctx.randomBetween(rect.height * 0.12, rect.height * 0.56),
                        24 + burstIndex * 2
                    );
                }, revealOrder.length * revealStep + 220 + Math.floor(burstIndex * (fireworkWindow / Math.max(1, fireworkCount)))));
            }

            (function animateSudokuFireworks() {
                const rect = resizeSudokuVictoryCanvas();
                const canvasCtx = victoryCanvas.getContext("2d");
                canvasCtx.clearRect(0, 0, rect.width, rect.height);
                canvasCtx.globalCompositeOperation = "lighter";
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
                    canvasCtx.fillStyle = particle.color;
                    canvasCtx.globalAlpha = alpha;
                    canvasCtx.beginPath();
                    canvasCtx.arc(particle.x, particle.y, particle.radius * (0.62 + alpha * 0.5), 0, Math.PI * 2);
                    canvasCtx.fill();
                    return true;
                });
                canvasCtx.globalAlpha = 1;
                canvasCtx.globalCompositeOperation = "source-over";
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
            ctx.scheduleGameStateSave("sudoku", payload, summarizeSudokuSession(session));
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
            ctx.setStageStats([
                { label: "模式", value: session.modeKey.toUpperCase() },
                { label: "状态", value: session.completed ? "完成" : (session.paused ? "暂停" : "进行中") },
                { label: "用时", value: ctx.formatSeconds(session.elapsedSeconds) },
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
            ctx.syncPresence(session.paused ? "数独 已暂停" : (session.usedSolver ? "数独自动解题中" : ("正在玩 " + session.modeKey)), "");
            syncSudokuBoardLayout();
            updatePauseState();
        }

        function drawBoard() {
            const puzzle = getPuzzleById(session.puzzleId);
            const fixed = puzzle.puzzle.split("").map(function (char) { return !isSudokuBlankChar(puzzle, char); });
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
            ctx.submitScore("sudoku", scoreData.total, session.modeKey, session.sessionKey, {
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
                ctx.setStatus(error.message || "数独成绩提交失败", true);
            });
        }

        function validateAndMaybeFinish(showMessage) {
            const puzzle = getPuzzleById(session.puzzleId);
            const conflicts = findSudokuConflicts(session.board, puzzle);
            const blankCount = session.board.filter(function (item) { return !item; }).length;
            inputs.forEach(function (item, index) {
                item.wrapper.classList.toggle("is-error", conflicts.has(index));
                item.input.classList.toggle("is-error", conflicts.has(index));
            });
            updateHeader();

            if (showMessage && session.usedSolver && session.completed && !conflicts.size && session.board.every(Boolean) && session.board.join("") === puzzle.solution) {
                playSudokuVictoryAnimation();
                ctx.setStatus("已自动解题，当前为庆祝动画预览，不计分。", false);
                persist();
                return;
            }

            if (showMessage) {
                if (conflicts.size > 0) {
                    ctx.setStatus("当前有冲突格，请先修正。", true);
                    return;
                }
                if (blankCount > 0) {
                    ctx.setStatus("校验通过：当前没有重复冲突，但还有 " + blankCount + " 个空格未填完。", false);
                    return;
                }
            }

            if (!conflicts.size && session.board.every(Boolean) && session.board.join("") === puzzle.solution) {
                session.completed = true;
                syncSudokuClock(session);
                session.pausedElapsed = session.elapsedSeconds;
                if (session.usedSolver) {
                    ctx.setStatus("已完成，但由于使用了自动解题，本局不计分。", false);
                } else {
                    maybeSubmitScore();
                    if (!session.celebrationPlayed) {
                        session.celebrationPlayed = true;
                        playSudokuVictoryAnimation();
                    }
                    ctx.setStatus("数独完成，成绩已记录。", false);
                }
                persist();
            } else if (showMessage && !conflicts.size && !blankCount) {
                ctx.setStatus("盘面已填满，但还不是正确答案，请继续检查。", true);
            }
        }

        timerId = window.setInterval(function () {
            if (ctx.state.activeGameId === "sudoku") {
                updateHeader();
            }
        }, 1000);
        window.addEventListener("resize", syncSudokuBoardLayout);

        ctx.createGameStartOverlay(playfieldEl, Object.assign({}, sudokuHelpConfig, {
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

    modules.register("sudoku", mountSudoku);
})();
