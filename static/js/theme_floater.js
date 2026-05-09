(function () {
    const COLOR_THEMES = [
        { id: "jasmine", label: "茉莉奶白" },
        { id: "ocean", label: "海洋蓝" },
        { id: "forest", label: "雾林灰绿" },
        { id: "sunset", label: "暖砂橙" },
        { id: "lavender", label: "雾紫灰" },
        { id: "graphite", label: "石墨银灰" }
    ];

    const MORPH_STYLES = [
        { id: "flat", label: "纯色模式（无拟态）" },
        { id: "glassmorphism", label: "玻璃拟态" },
        { id: "claymorphism", label: "粘土拟态" }
    ];

    const LEGACY_THEME_TO_COLOR = {
        jasmine: "jasmine",
        "mint-fresh": "jasmine",
        "mist-forest": "forest",
        "bamboo-grove": "forest",
        "tea-garden": "forest",
        sunset: "sunset",
        "golden-beach": "sunset",
        "orange-warmth": "sunset",
        "rose-whisper": "sunset",
        "cherry-blossom": "sunset",
        "sky-azure": "ocean",
        "ocean-shallow": "ocean",
        "tech-blue": "ocean",
        "cloud-light": "ocean",
        "lake-reflection": "ocean",
        aurora: "ocean",
        "lavender-field": "lavender",
        "purple-dream": "lavender",
        cyberpunk: "graphite",
        "morning-mist": "graphite"
    };

    function normalizeColorTheme(themeName) {
        return LEGACY_THEME_TO_COLOR[themeName] || themeName || "jasmine";
    }

    function applyThemeAttributes(target, themeColor, morph) {
        if (!target) return;
        target.setAttribute("data-theme-color", themeColor);
        target.setAttribute("data-theme", themeColor); // legacy compatibility
        target.setAttribute("data-morph", morph);
    }

    function getAppliedThemeAttribute(attributeName, fallbackValue) {
        return document.documentElement.getAttribute(attributeName)
            || (document.body && document.body.getAttribute(attributeName))
            || fallbackValue;
    }

    function applyThemeState(themeColor, morph) {
        const safeColor = normalizeColorTheme(themeColor);
        const safeMorph = morph || "flat";
        applyThemeAttributes(document.documentElement, safeColor, safeMorph);
        applyThemeAttributes(document.body, safeColor, safeMorph);
        refreshThemeSelection(safeColor, safeMorph);
    }

    function refreshThemeSelection(themeColor, morph) {
        document.querySelectorAll(".theme-option[data-theme-color], .theme-option[data-morph]").forEach((el) => {
            el.classList.remove("is-active");
        });
        const colorEl = document.querySelector(`.theme-option[data-theme-color="${themeColor}"]`);
        const morphEl = document.querySelector(`.theme-option[data-morph="${morph}"]`);
        if (colorEl) colorEl.classList.add("is-active");
        if (morphEl) morphEl.classList.add("is-active");
    }

    function initTheme() {
        const legacyTheme = localStorage.getItem("site_theme") || "jasmine";
        const savedColor = normalizeColorTheme(localStorage.getItem("site_theme_color") || legacyTheme);
        const savedMorph = localStorage.getItem("site_morph") || (
            legacyTheme === "glassmorphism" || legacyTheme === "neumorphism" || legacyTheme === "claymorphism"
                ? (legacyTheme === "neumorphism" ? "glassmorphism" : legacyTheme)
                : "flat"
        );
        applyThemeState(savedColor, savedMorph);
        localStorage.setItem("site_theme_color", savedColor);
        localStorage.setItem("site_theme", savedColor);
        localStorage.setItem("site_morph", savedMorph);
    }

    window.setThemeColor = function (themeColor) {
        const currentMorph = localStorage.getItem("site_morph") || "flat";
        const safeColor = normalizeColorTheme(themeColor);
        localStorage.setItem("site_theme_color", safeColor);
        localStorage.setItem("site_theme", safeColor);
        applyThemeState(safeColor, currentMorph);
        window.dispatchEvent(new CustomEvent("themechanged", { detail: { themeColor: safeColor, morph: currentMorph } }));
    };

    window.setMorph = function (morphName) {
        const currentColor = normalizeColorTheme(localStorage.getItem("site_theme_color") || localStorage.getItem("site_theme") || "jasmine");
        const safeMorph = morphName || "flat";
        localStorage.setItem("site_morph", safeMorph);
        applyThemeState(currentColor, safeMorph);
        window.dispatchEvent(new CustomEvent("themechanged", { detail: { themeColor: currentColor, morph: safeMorph } }));
    };

    // Legacy API compatibility
    window.setTheme = function (themeName) {
        if (themeName === "glassmorphism" || themeName === "neumorphism" || themeName === "claymorphism") {
            window.setMorph(themeName === "neumorphism" ? "glassmorphism" : themeName);
            return;
        }
        window.setThemeColor(themeName);
    };

    initTheme();

    // Skip choice page, which has its own menu
    if (document.querySelector(".choice-section") || document.querySelector(".top-right-bar")) {
        return;
    }

    if (document.getElementById("theme-floater")) return;

    function buildMenuHTML() {
        const colorItems = COLOR_THEMES
            .map((t) => `<div class="theme-option" data-theme-color="${t.id}" onclick="setThemeColor('${t.id}')">${t.label}</div>`)
            .join("");
        const morphItems = MORPH_STYLES
            .map((t) => `<div class="theme-option" data-morph="${t.id}" onclick="setMorph('${t.id}')">${t.label}</div>`)
            .join("");

        return `
            <div class="theme-group-title">颜色主题</div>
            ${colorItems}
            <hr class="theme-divider">
            <div class="theme-group-title">拟态效果</div>
            ${morphItems}
        `;
    }

    const floaterHTML = `
    <div id="theme-floater" class="theme-floater">
        <div class="theme-menu" id="theme-floater-menu">
            ${buildMenuHTML()}
        </div>
        <button class="theme-btn" id="theme-floater-btn" title="切换主题">
            <i class="fa fa-paint-brush"></i>
        </button>
    </div>
    <style>
        .theme-floater {
            position: fixed;
            top: 20px;
            right: 80px;
            z-index: 10001;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 10px;
        }
        .theme-btn {
            width: 50px;
            height: 50px;
            border-radius: 50%;
            background: color-mix(in srgb, var(--t-bg-panel-opaque) 88%, white);
            color: var(--t-text-main);
            border: 1px solid var(--t-border);
            box-shadow: 0 10px 24px rgba(75, 75, 69, 0.08);
            cursor: pointer;
            font-size: 18px;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(10px);
            -webkit-backdrop-filter: blur(10px);
        }
        .theme-btn:hover {
            transform: translateY(-1px);
            background: color-mix(in srgb, var(--t-primary-faint) 76%, white);
            box-shadow: 0 14px 28px rgba(75, 75, 69, 0.1);
        }
        .theme-menu {
            background: var(--t-bg-panel-opaque);
            border: 1px solid var(--t-border-light);
            padding: 8px 0;
            border-radius: 12px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.15);
            margin-bottom: 5px;
            opacity: 0;
            visibility: hidden;
            transform: translateY(10px);
            transition: all 0.2s ease;
            min-width: 180px;
            color: var(--t-text-main);
            text-align: left;
            max-height: 65vh;
            overflow-y: auto;
        }
        .theme-menu.active {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
        .theme-group-title {
            padding: 8px 16px 4px;
            font-size: 12px;
            color: var(--t-text-muted);
            font-weight: 700;
            letter-spacing: 0.02em;
            text-transform: uppercase;
            cursor: default;
        }
        .theme-divider {
            margin: 6px 12px;
            border: none;
            border-top: 1px solid var(--t-border-light);
        }
        .theme-option {
            padding: 8px 16px;
            cursor: pointer;
            font-size: 14px;
            color: var(--t-text-main);
            transition: background 0.2s;
            white-space: nowrap;
        }
        .theme-option::before {
            content: "\\2713";
            display: inline-block;
            width: 16px;
            margin-right: 8px;
            opacity: 0;
            color: var(--t-primary-hover);
            font-weight: 700;
        }
        .theme-option.is-active::before {
            opacity: 1;
        }
        .theme-option:hover {
            background: var(--t-border-light);
            color: var(--t-primary);
        }
    </style>
    `;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = floaterHTML;
    document.body.appendChild(wrapper);
    refreshThemeSelection(
        getAppliedThemeAttribute("data-theme-color", "jasmine"),
        getAppliedThemeAttribute("data-morph", "flat")
    );

    const btn = document.getElementById("theme-floater-btn");
    const menu = document.getElementById("theme-floater-menu");

    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        menu.classList.toggle("active");
    });

    document.addEventListener("click", (e) => {
        if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.remove("active");
        }
    });

    const existingToolbar = document.querySelector(".floating-toolbar");
    if (!existingToolbar) return;

    wrapper.remove();

    const themeBtn = document.createElement("button");
    themeBtn.className = "toolbar-btn";
    themeBtn.style.background = "color-mix(in srgb, var(--t-bg-panel-opaque) 88%, white)";
    themeBtn.style.color = "var(--t-text-main)";
    themeBtn.style.border = "1px solid var(--t-border)";
    themeBtn.style.boxShadow = "0 10px 24px rgba(75, 75, 69, 0.08)";
    themeBtn.innerHTML = '<i class="fa fa-paint-brush" aria-hidden="true"></i>';
    themeBtn.title = "切换主题";
    themeBtn.onclick = (e) => {
        e.stopPropagation();
        let themeMenu = document.getElementById("theme-menu-integrated");
        if (!themeMenu) {
            themeMenu = document.createElement("div");
            themeMenu.id = "theme-menu-integrated";
            themeMenu.className = "theme-menu-integrated";
            themeMenu.innerHTML = buildMenuHTML();
            document.body.appendChild(themeMenu);
            refreshThemeSelection(
                getAppliedThemeAttribute("data-theme-color", "jasmine"),
                getAppliedThemeAttribute("data-morph", "flat")
            );

            if (!document.getElementById("theme-menu-integrated-style")) {
                const style = document.createElement("style");
                style.id = "theme-menu-integrated-style";
                style.textContent = `
                    .theme-menu-integrated {
                        position: fixed;
                        bottom: 90px;
                        right: 20px;
                        background: var(--t-bg-panel-opaque);
                        border: 1px solid var(--t-border-light);
                        padding: 8px 0;
                        border-radius: 12px;
                        box-shadow: 0 4px 16px rgba(0,0,0,0.15);
                        opacity: 0;
                        visibility: hidden;
                        transform: translateY(10px);
                        transition: all 0.2s ease;
                        min-width: 180px;
                        z-index: 10001;
                        color: var(--t-text-main);
                        text-align: left;
                        max-height: 60vh;
                        overflow-y: auto;
                    }
                    .theme-menu-integrated.active {
                        opacity: 1;
                        visibility: visible;
                        transform: translateY(0);
                    }
                    .theme-menu-integrated .theme-group-title {
                        padding: 8px 16px 4px;
                        font-size: 12px;
                        color: var(--t-text-muted);
                        font-weight: 700;
                        letter-spacing: 0.02em;
                        text-transform: uppercase;
                        cursor: default;
                    }
                    .theme-menu-integrated .theme-divider {
                        margin: 6px 12px;
                        border: none;
                        border-top: 1px solid var(--t-border-light);
                    }
                    .theme-menu-integrated .theme-option {
                        padding: 8px 16px;
                        cursor: pointer;
                        font-size: 14px;
                        color: var(--t-text-main);
                        transition: background 0.2s;
                        white-space: nowrap;
                    }
                    .theme-menu-integrated .theme-option::before {
                        content: "\\2713";
                        display: inline-block;
                        width: 16px;
                        margin-right: 8px;
                        opacity: 0;
                        color: var(--t-primary-hover);
                        font-weight: 700;
                    }
                    .theme-menu-integrated .theme-option.is-active::before {
                        opacity: 1;
                    }
                    .theme-menu-integrated .theme-option:hover {
                        background: var(--t-border-light);
                        color: var(--t-primary);
                    }
                `;
                document.head.appendChild(style);
            }

            document.addEventListener("click", (ev) => {
                if (themeMenu && themeBtn && !themeMenu.contains(ev.target) && !themeBtn.contains(ev.target)) {
                    themeMenu.classList.remove("active");
                }
            });
        }
        themeMenu.classList.toggle("active");
    };

    existingToolbar.insertBefore(themeBtn, existingToolbar.firstChild);
})();

