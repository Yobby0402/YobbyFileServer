/**
 * Yobboy File Server - Theme Manager
 * Handles theme persistence and switching (Snow, Dark, Ocean)
 */

(function () {
    const THEME_KEY = 'yobby_theme';
    const DEFAULT_THEME = 'snow';

    // 1. Apply theme immediately to avoid flash of unstyled content
    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem(THEME_KEY, theme);
        updateActiveState(theme);
    }

    function getSavedTheme() {
        return localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
    }

    // Initialize
    const savedTheme = getSavedTheme();
    document.documentElement.setAttribute('data-theme', savedTheme);

    // Update UI active state (if switcher exists on page)
    function updateActiveState(activeTheme) {
        // Find all theme buttons
        const textBtns = document.querySelectorAll('.theme-btn');
        textBtns.forEach(btn => {
            if (btn.dataset.theme === activeTheme) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Also update select inputs if any
        const selector = document.getElementById('themeSelector');
        if (selector) {
            selector.value = activeTheme;
        }
    }

    // Expose global API
    window.YobbyTheme = {
        setTheme: applyTheme,
        getTheme: getSavedTheme,
        init: () => {
             // Re-apply in case DOM wasn't ready during first run (though we ran it immediately above for <html>)
             updateActiveState(getSavedTheme());
        }
    };

    // Auto-init when DOM is clear
    document.addEventListener('DOMContentLoaded', () => {
        window.YobbyTheme.init();

        // Bind click events for any static theme toggles
        document.querySelectorAll('[data-toggle="theme"]').forEach(el => {
            el.addEventListener('click', (e) => {
                const theme = e.currentTarget.dataset.value;
                applyTheme(theme);
            });
        });
    });

})();
