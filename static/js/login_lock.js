(function () {
    const config = window.loginUiConfig || {};
    const requiredLength = Number(config.passwordLength) || 6;
    const displayWord = "Yobboy".slice(0, requiredLength);
    const randomPool = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*+-=?<>[]{}\\/|~";
    const tetrisFlagKey = config.tetrisFlagKey || "yobboy_tetris_login_mode";

    function byId(id) {
        return document.getElementById(id);
    }

    function randomChar() {
        return randomPool.charAt(Math.floor(Math.random() * randomPool.length));
    }

    function safeStorageSet(key, value) {
        try {
            window.localStorage.setItem(key, value);
        } catch (error) {
            void error;
        }
    }

    function safeStorageRemove(key) {
        try {
            window.localStorage.removeItem(key);
        } catch (error) {
            void error;
        }
    }

    function setMode(mode) {
        const body = document.body;
        const lockMode = byId("lockMode");
        const tetrisMode = byId("tetrisMode");
        if (!body || !lockMode || !tetrisMode) {
            return;
        }
        body.dataset.loginMode = mode;
        lockMode.classList.toggle("is-active", mode === "lock");
        tetrisMode.classList.toggle("is-active", mode === "tetris");
        tetrisMode.setAttribute("aria-hidden", mode === "tetris" ? "false" : "true");
        window.dispatchEvent(new Event("resize"));
    }

    document.addEventListener("DOMContentLoaded", function () {
        const stage = byId("lockStage");
        const grid = byId("lockGrid");
        const input = byId("lockPassword");
        const hint = byId("lockHint");
        const errorEl = byId("lockError");
        const errorTextEl = byId("lockErrorText");
        const switchToTetris = byId("lockSwitchToTetris");
        const switchToLock = byId("switchToLock");

        if (!stage || !grid || !input || !hint || !errorEl || !errorTextEl) {
            return;
        }

        const columns = [];
        let submitted = false;
        let success = false;
        let failureTimer = null;
        let lastShuffleAt = 0;
        const totalRows = 8;
        const wordRowIndex = 1;
        const inputRowIndex = 2;

        function buildColumns() {
            for (let index = 0; index < requiredLength; index += 1) {
                const column = document.createElement("div");
                const cells = [];

                column.className = "lock-column";

                for (let rowIndex = 0; rowIndex < totalRows; rowIndex += 1) {
                    const cell = document.createElement("span");
                    cell.className = "lock-cell";
                    if (rowIndex === wordRowIndex) {
                        cell.classList.add("lock-cell--word");
                        cell.textContent = displayWord.charAt(index) || "";
                    } else if (rowIndex === inputRowIndex) {
                        cell.classList.add("lock-cell--input");
                        cell.textContent = "";
                    } else {
                        cell.classList.add("lock-cell--random");
                        cell.textContent = randomChar();
                    }
                    cells.push(cell);
                    column.appendChild(cell);
                }
                grid.appendChild(column);

                columns.push({
                    root: column,
                    cells: cells,
                    randomCells: cells.filter(function (_, rowIndex) {
                        return rowIndex !== wordRowIndex && rowIndex !== inputRowIndex;
                    }),
                    inputCell: cells[inputRowIndex],
                    wordCell: cells[wordRowIndex],
                    direction: Math.random() > 0.5 ? 1 : -1,
                    nextDirectionFlipAt: 500 + Math.random() * 1400
                });
            }
        }

        function showError(message) {
            errorTextEl.textContent = message;
            errorEl.classList.remove("d-none");
        }

        function clearError() {
            errorTextEl.textContent = "";
            errorEl.classList.add("d-none");
        }

        function updateHint(length) {
            if (success) {
                hint.textContent = "ACCESS GRANTED";
                return;
            }
            if (submitted) {
                hint.textContent = "VERIFYING";
                return;
            }
            if (length >= requiredLength) {
                hint.textContent = "READY TO VERIFY";
                return;
            }
            hint.textContent = "INPUT SLOT " + String(length + 1).padStart(2, "0");
        }

        function renderColumns(rawValue, state) {
            const length = rawValue.length;
            columns.forEach(function (column, index) {
                const locked = state === "success" || (state !== "error" && index < length);
                const active = state !== "error" && state !== "success" && index === length && length < requiredLength;
                const isError = state === "error";
                const isSuccess = state === "success";

                column.root.classList.toggle("is-active", active);
                column.root.classList.toggle("is-locked", locked && !isSuccess);
                column.root.classList.toggle("is-success", isSuccess);
                column.root.classList.toggle("is-error", isError);
                column.wordCell.textContent = index < length || isSuccess ? (displayWord.charAt(index) || "") : "";
                column.inputCell.textContent = index < length ? "*" : "";
            });
            updateHint(length);
        }

        function animate(now) {
            if (now - lastShuffleAt > 60) {
                columns.forEach(function (column) {
                    if (now >= column.nextDirectionFlipAt) {
                        if (Math.random() > 0.38) {
                            column.direction *= -1;
                        }
                        column.nextDirectionFlipAt = now + 480 + Math.random() * 1600;
                    }

                    if (column.direction > 0) {
                        for (let index = column.randomCells.length - 1; index > 0; index -= 1) {
                            column.randomCells[index].textContent = column.randomCells[index - 1].textContent;
                        }
                        column.randomCells[0].textContent = randomChar();
                    } else {
                        for (let index = 0; index < column.randomCells.length - 1; index += 1) {
                            column.randomCells[index].textContent = column.randomCells[index + 1].textContent;
                        }
                        column.randomCells[column.randomCells.length - 1].textContent = randomChar();
                    }
                });
                lastShuffleAt = now;
            }
            window.requestAnimationFrame(animate);
        }

        function focusInput() {
            if (document.body.dataset.loginMode === "lock" && !success) {
                input.focus();
            }
        }

        function resetAfterFailure() {
            submitted = false;
            input.disabled = false;
            input.value = "";
            renderColumns("", "idle");
            focusInput();
        }

        function submitPassword(password) {
            submitted = true;
            clearError();
            input.disabled = true;
            renderColumns(password, "submitting");

            const body = new URLSearchParams();
            body.set("password", password);

            fetch(config.loginUrl || "/login", {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Accept": "application/json",
                    "X-Requested-With": "XMLHttpRequest"
                },
                body: body.toString(),
                credentials: "same-origin"
            })
                .then(function (response) {
                    return response.json().catch(function () {
                        return { ok: false, error: "登录响应解析失败" };
                    });
                })
                .then(function (data) {
                    if (data && data.ok) {
                        success = true;
                        renderColumns(password, "success");
                        window.setTimeout(function () {
                            window.location.href = data.redirect || config.redirectUrl || "/";
                        }, 900);
                        return;
                    }

                    submitted = false;
                    showError((data && data.error) || "密码错误");
                    renderColumns(password, "error");
                    failureTimer = window.setTimeout(resetAfterFailure, 720);
                })
                .catch(function () {
                    submitted = false;
                    input.disabled = false;
                    showError("登录请求失败，请稍后重试");
                    renderColumns(input.value, "idle");
                    focusInput();
                });
        }

        function sanitizeValue(value) {
            return Array.from(String(value || "")).slice(0, requiredLength).join("");
        }

        buildColumns();
        renderColumns(input.value, "idle");
        window.requestAnimationFrame(animate);

        stage.addEventListener("click", focusInput);
        stage.addEventListener("keydown", function (event) {
            if (event.key === "Tab") {
                return;
            }
            focusInput();
        });

        input.addEventListener("input", function () {
            const sanitized = sanitizeValue(input.value);
            if (sanitized !== input.value) {
                input.value = sanitized;
            }
            if (failureTimer) {
                window.clearTimeout(failureTimer);
                failureTimer = null;
            }
            clearError();
            renderColumns(sanitized, "idle");
            if (!submitted && sanitized.length === requiredLength) {
                submitPassword(sanitized);
            }
        });

        input.addEventListener("blur", function () {
            window.setTimeout(focusInput, 20);
        });

        if (switchToTetris) {
            switchToTetris.addEventListener("click", function () {
                safeStorageSet(tetrisFlagKey, "1");
                setMode("tetris");
                const tetrisInput = byId("password");
                if (tetrisInput) {
                    window.setTimeout(function () {
                        tetrisInput.focus();
                        window.dispatchEvent(new Event("resize"));
                    }, 40);
                }
            });
        }

        if (switchToLock) {
            switchToLock.addEventListener("click", function () {
                safeStorageRemove(tetrisFlagKey);
                setMode("lock");
                focusInput();
            });
        }

        focusInput();
    });
})();
