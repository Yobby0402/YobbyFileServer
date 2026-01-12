
(function () {
    // 1. Theme Manager Logic (Shared)
    window.setTheme = function (themeName) {
        document.body.setAttribute('data-theme', themeName);
        localStorage.setItem('site_theme', themeName);
    };

    function initTheme() {
        const savedTheme = localStorage.getItem('site_theme') || 'jasmine';
        document.body.setAttribute('data-theme', savedTheme);
        return savedTheme;
    }

    initTheme();

    // 2. Check conditions to skip adding floater
    // If we are on choice page (identified by class or structure), skip
    if (document.querySelector('.choice-section') || document.querySelector('.top-right-bar')) {
        return;
    }

    // Check if duplicate
    if (document.getElementById('theme-floater')) return;

    // 3. Inject Floating Button
    const floaterHTML = `
    <div id="theme-floater" class="theme-floater">
        <div class="theme-menu" id="theme-floater-menu">
            <div class="theme-option" onclick="setTheme('jasmine')">🍃 茉莉奶白</div>
            <div class="theme-option" onclick="setTheme('mist-forest')">🌲 迷雾森林</div>
            <div class="theme-option" onclick="setTheme('sunset')">🌅 日落黄昏</div>
            <div class="theme-option" onclick="setTheme('golden-beach')">🏖️ 黄金沙滩</div>
            <div class="theme-option" onclick="setTheme('cyberpunk')">🌃 赛博朋克</div>
            <div class="theme-option" onclick="setTheme('aurora')">🌌 极光星空</div>
        </div>
        <button class="theme-btn" id="theme-floater-btn" title="切换主题">
            <i class="fa fa-paint-brush"></i>
        </button>
    </div>
    <style>
        .theme-floater {
            position: fixed;
            top: 20px;
            right: 80px; /* Adjusted to be left of logout/user area if any */
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
            background: linear-gradient(135deg, var(--t-primary), var(--t-primary-light));
            color: #fff;
            border: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            cursor: pointer;
            font-size: 20px;
            transition: all 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .theme-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 16px rgba(0,0,0,0.3);
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
            min-width: 140px;
            /* Ensure text is readable */
            color: var(--t-text-main);
            text-align: left;
        }
        .theme-menu.active {
            opacity: 1;
            visibility: visible;
            transform: translateY(0);
        }
        .theme-option {
            padding: 8px 16px;
            cursor: pointer;
            font-size: 14px;
            color: var(--t-text-main);
            transition: background 0.2s;
            white-space: nowrap;
        }
        .theme-option:hover {
            background: var(--t-border-light);
            color: var(--t-primary);
        }
    </style>
    `;

    const div = document.createElement('div');
    div.innerHTML = floaterHTML;
    document.body.appendChild(div);

    const btn = document.getElementById('theme-floater-btn');
    const menu = document.getElementById('theme-floater-menu');

    // Toggle menu
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.classList.toggle('active');
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
            menu.classList.remove('active');
        }
    });

    // Special handling for index.html floating toolbar
    // If index.html has its own floater, we might want to integrate?
    // User requested "add floating button", so adding a separate one is fine, 
    // but placing it at right: 30px might overlap if multiple toolbars exist.
    // Index.html has .floating-toolbar at right: 20px. 
    // Let's shift ours up or left if that exists? 
    // Actually, stacking them via z-index is one way, but they occupy the same space.
    // Ideally we should append to .floating-toolbar if it exists?

    const existingToolbar = document.querySelector('.floating-toolbar');
    if (existingToolbar) {
        // 移除独立的主题浮动按钮
        div.remove();
        
        // 创建主题切换按钮并添加到浮动工具栏的第一个位置
        const themeBtn = document.createElement('button');
        themeBtn.className = 'toolbar-btn';
        themeBtn.style.background = 'linear-gradient(135deg, #FF9800, #F44336)';
        themeBtn.innerHTML = '<i class="fa fa-paint-brush"></i>';
        themeBtn.title = '切换主题';
        themeBtn.onclick = (e) => {
            e.stopPropagation();
            // 创建主题菜单
            let themeMenu = document.getElementById('theme-menu-integrated');
            if (!themeMenu) {
                themeMenu = document.createElement('div');
                themeMenu.id = 'theme-menu-integrated';
                themeMenu.className = 'theme-menu-integrated';
                themeMenu.innerHTML = `
                    <div class="theme-option" onclick="setTheme('jasmine')">🍃 茉莉奶白</div>
                    <div class="theme-option" onclick="setTheme('mist-forest')">🌲 迷雾森林</div>
                    <div class="theme-option" onclick="setTheme('sunset')">🌅 日落黄昏</div>
                    <div class="theme-option" onclick="setTheme('golden-beach')">🏖️ 黄金沙滩</div>
                    <div class="theme-option" onclick="setTheme('cyberpunk')">🌃 赛博朋克</div>
                    <div class="theme-option" onclick="setTheme('aurora')">🌌 极光星空</div>
                `;
                document.body.appendChild(themeMenu);
                
                // 添加样式
                if (!document.getElementById('theme-menu-integrated-style')) {
                    const style = document.createElement('style');
                    style.id = 'theme-menu-integrated-style';
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
                            min-width: 140px;
                            z-index: 10001;
                            color: var(--t-text-main);
                            text-align: left;
                        }
                        .theme-menu-integrated.active {
                            opacity: 1;
                            visibility: visible;
                            transform: translateY(0);
                        }
                        .theme-menu-integrated .theme-option {
                            padding: 8px 16px;
                            cursor: pointer;
                            font-size: 14px;
                            color: var(--t-text-main);
                            transition: background 0.2s;
                            white-space: nowrap;
                        }
                        .theme-menu-integrated .theme-option:hover {
                            background: var(--t-border-light);
                            color: var(--t-primary);
                        }
                    `;
                    document.head.appendChild(style);
                }
                
                // 点击外部关闭菜单
                document.addEventListener('click', (e) => {
                    if (themeMenu && themeBtn && !themeMenu.contains(e.target) && !themeBtn.contains(e.target)) {
                        themeMenu.classList.remove('active');
                    }
                });
            }
            themeMenu.classList.toggle('active');
        };
        
        // 插入到浮动工具栏的第一个位置
        existingToolbar.insertBefore(themeBtn, existingToolbar.firstChild);
    }
})();
