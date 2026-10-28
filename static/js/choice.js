(function () {
    "use strict";

    const themeButton = document.getElementById("themeButton");
    const themeMenu = document.getElementById("themeMenu");
    const brand = document.querySelector(".brand");
    const gameEntry = document.getElementById("hiddenGameEntry");

    function applyTheme(themeColor, morph) {
        document.documentElement.dataset.themeColor = themeColor;
        document.documentElement.dataset.theme = themeColor;
        document.documentElement.dataset.morph = morph;
        document.body.dataset.themeColor = themeColor;
        document.body.dataset.theme = themeColor;
        document.body.dataset.morph = morph;
        localStorage.setItem("site_theme_color", themeColor);
        localStorage.setItem("site_theme", themeColor);
        localStorage.setItem("site_morph", morph);
        refreshThemeMenu(themeColor, morph);
    }

    function refreshThemeMenu(themeColor, morph) {
        themeMenu.querySelectorAll("[data-theme-color]").forEach((item) => {
            item.classList.toggle("is-active", item.dataset.themeColor === themeColor);
        });
        themeMenu.querySelectorAll("[data-morph]").forEach((item) => {
            item.classList.toggle("is-active", item.dataset.morph === morph);
        });
    }

    function closeThemeMenu() {
        themeMenu.hidden = true;
        themeButton.setAttribute("aria-expanded", "false");
    }

    if (themeButton && themeMenu) {
        themeButton.addEventListener("click", (event) => {
            event.stopPropagation();
            themeMenu.hidden = !themeMenu.hidden;
            themeButton.setAttribute("aria-expanded", String(!themeMenu.hidden));
        });

        themeMenu.addEventListener("click", (event) => {
            const item = event.target.closest("button");
            if (!item) return;

            const currentColor = document.documentElement.dataset.themeColor || "jasmine";
            const currentMorph = document.documentElement.dataset.morph || "flat";
            applyTheme(item.dataset.themeColor || currentColor, item.dataset.morph || currentMorph);
            closeThemeMenu();
        });

        document.addEventListener("click", (event) => {
            if (!themeMenu.contains(event.target) && !themeButton.contains(event.target)) {
                closeThemeMenu();
            }
        });

        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") closeThemeMenu();
        });

        refreshThemeMenu(
            document.documentElement.dataset.themeColor || "jasmine",
            document.documentElement.dataset.morph || "flat"
        );
    }

    if (brand && gameEntry) {
        let clickCount = 0;
        let clickTimer = null;

        brand.addEventListener("click", (event) => {
            clickCount += 1;
            window.clearTimeout(clickTimer);

            if (clickCount >= 5) {
                window.location.href = "/games";
                return;
            }

            clickTimer = window.setTimeout(() => {
                clickCount = 0;
            }, 1600);
        });
    }
})();
