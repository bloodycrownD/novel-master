/**
 * UI 壳原型 — 单文件脚本，可直接双击 index.html（file://）打开。
 */
(function () {
    'use strict';

    const appState = {
        currentPage: 'chat',
        pageStack: [],
        currentScope: 'project',
        chatConversationPanel: 'chat',
        sessionListPanel: 'sessions',
        chatSubview: 'sessions',
        currentProjectId: 'novel-1',
        currentProjectName: '科幻小说创作',
        currentSessionId: 'session-1',
        currentSessionName: '第一卷创作',
        editingAgentId: null,
        defaultAgentId: 'agent-writer',
        agentEditorDirty: false,
    };

    const pageConfig = {
        chat: { title: '会话', showBack: false, showNav: true },
        agents: { title: 'Agent', showBack: false, showNav: true },
        profile: { title: '我的', showBack: false, showNav: true },
        realPrompt: { title: '真实提示词', showBack: true, showNav: false },
        logs: { title: '工具日志', showBack: true, showNav: false },
        checkpoints: { title: '检查点', showBack: true, showNav: false },
        providers: { title: '服务商管理', showBack: true, showNav: false },
        settings: { title: '扩展设置', showBack: true, showNav: false },
        globalTemplate: { title: '全局模板', showBack: true, showNav: false },
        fileEditor: { title: '编辑文件', showBack: true, showNav: false },
        agentEditor: { title: 'Agent 配置', showBack: true, showNav: false },
    };

    const elements = {
        pageTitle: null,
        backBtn: null,
        drawerBtn: null,
        drawerOverlay: null,
        projectDrawer: null,
        sessionListView: null,
        chatConversationView: null,
        bannerProjectName: null,
        bottomNav: null,
        sheetBackdrop: null,
        bottomSheet: null,
        sheetContent: null,
        toast: null,
    };

    function cacheElements() {
        elements.pageTitle = document.getElementById('pageTitle');
        elements.backBtn = document.getElementById('backBtn');
        elements.drawerBtn = document.getElementById('drawerBtn');
        elements.drawerOverlay = document.getElementById('drawerOverlay');
        elements.projectDrawer = document.getElementById('projectDrawer');
        elements.sessionListView = document.getElementById('sessionListView');
        elements.chatConversationView = document.getElementById('chatConversationView');
        elements.bannerProjectName = document.getElementById('bannerProjectName');
        elements.bottomNav = document.getElementById('bottomNav');
        elements.sheetBackdrop = document.getElementById('sheetBackdrop');
        elements.bottomSheet = document.getElementById('bottomSheet');
        elements.sheetContent = document.getElementById('sheetContent');
        elements.toast = document.getElementById('toast');
    }

    function showToast(message, duration) {
        if (duration === undefined) duration = 2000;
        if (!elements.toast) return;
        elements.toast.textContent = message;
        elements.toast.classList.remove('hidden');
        setTimeout(function () {
            elements.toast.classList.add('show');
        }, 10);
        setTimeout(function () {
            elements.toast.classList.remove('show');
            setTimeout(function () {
                elements.toast.classList.add('hidden');
            }, 300);
        }, duration);
    }

    function hideBottomSheet() {
        if (elements.sheetContent) elements.sheetContent.classList.remove('sheet-content--form');
        if (elements.sheetBackdrop) {
            elements.sheetBackdrop.classList.add('hidden');
            elements.sheetBackdrop.setAttribute('aria-hidden', 'true');
        }
        if (!elements.bottomSheet) return;
        elements.bottomSheet.classList.remove('show');
        setTimeout(function () {
            elements.bottomSheet.classList.add('hidden');
        }, 300);
    }

    function showBottomSheet(items, callback) {
        if (!elements.sheetContent || !elements.bottomSheet) return;
        elements.sheetContent.classList.remove('sheet-content--form');
        elements.sheetContent.innerHTML = '';
        items.forEach(function (item) {
            const div = document.createElement('div');
            div.className = 'sheet-item' + (item.danger ? ' danger' : '');
            div.textContent = item.label;
            div.addEventListener('click', function () {
                const keepOpen = callback(item.action) === false;
                if (!keepOpen) hideBottomSheet();
            });
            elements.sheetContent.appendChild(div);
        });
        if (elements.sheetBackdrop) {
            elements.sheetBackdrop.classList.remove('hidden');
            elements.sheetBackdrop.setAttribute('aria-hidden', 'false');
        }
        elements.bottomSheet.classList.remove('hidden');
        setTimeout(function () {
            elements.bottomSheet.classList.add('show');
        }, 10);
    }

    /** 显式回到会话列表（返回键、切换项目等）；不用于底栏 Tab 切换 */
    function showSessionListView() {
        appState.chatSubview = 'sessions';
        if (elements.sessionListView) elements.sessionListView.classList.add('active');
        if (elements.chatConversationView) elements.chatConversationView.classList.remove('active');
        showSessionListPanel('sessions');
        showChatConversationPanel('chat');
        if (appState.currentPage === 'chat') updateHeader('chat');
    }

    /** 根据 appState 恢复对话 Tab 内的列表/聊天与子 Tab，底栏切回「对话」时调用 */
    function restoreChatSubviewUI() {
        if (appState.chatSubview === 'conversation') {
            if (elements.sessionListView) elements.sessionListView.classList.remove('active');
            if (elements.chatConversationView) elements.chatConversationView.classList.add('active');
            showChatConversationPanel(appState.chatConversationPanel);
        } else {
            if (elements.sessionListView) elements.sessionListView.classList.add('active');
            if (elements.chatConversationView) elements.chatConversationView.classList.remove('active');
            showSessionListPanel(appState.sessionListPanel);
        }
        updateHeader('chat');
    }

    function sessionPanelIdFor(panel) {
        if (panel === 'template') return 'sessionPanelTemplate';
        return 'sessionPanelSessions';
    }

    function showSessionListPanel(panel) {
        appState.sessionListPanel = panel;
        const root = elements.sessionListView;
        if (!root) return;
        root.querySelectorAll('[data-session-panel]').forEach(function (tab) {
            const isActive = tab.dataset.sessionPanel === panel;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        const targetId = sessionPanelIdFor(panel);
        root.querySelectorAll('.session-list-panel').forEach(function (el) {
            el.classList.toggle('active', el.id === targetId);
        });
        if (appState.currentPage === 'chat' && appState.chatSubview === 'sessions') {
            updateHeader('chat');
        }
    }

    function chatPanelIdFor(panel) {
        if (panel === 'workspace') return 'chatPanelWorkspace';
        return 'chatPanelChat';
    }

    function showChatConversationPanel(panel) {
        appState.chatConversationPanel = panel;
        const root = elements.chatConversationView;
        if (!root) return;
        root.querySelectorAll('[data-chat-panel]').forEach(function (tab) {
            const isActive = tab.dataset.chatPanel === panel;
            tab.classList.toggle('active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        const targetId = chatPanelIdFor(panel);
        root.querySelectorAll('.chat-panel').forEach(function (el) {
            el.classList.toggle('active', el.id === targetId);
        });
    }

    function openChatConversation(sessionId, sessionName) {
        appState.chatSubview = 'conversation';
        appState.currentSessionId = sessionId;
        appState.currentSessionName = sessionName;

        document.querySelectorAll('#sessionListView .session-item').forEach(function (el) {
            el.classList.toggle('active', el.dataset.id === sessionId);
            const badge = el.querySelector('.current-badge');
            if (el.dataset.id === sessionId) {
                if (!badge) {
                    const span = document.createElement('span');
                    span.className = 'current-badge';
                    span.textContent = '当前';
                    el.appendChild(span);
                }
            } else if (badge) {
                badge.remove();
            }
        });

        if (elements.sessionListView) elements.sessionListView.classList.remove('active');
        if (elements.chatConversationView) elements.chatConversationView.classList.add('active');
        showChatConversationPanel('chat');
        updateHeader('chat');
    }

    function navigateToPage(pageId, pushToStack) {
        if (pushToStack === undefined) pushToStack = false;

        if (pushToStack) appState.pageStack.push(appState.currentPage);

        const currentPageEl = document.getElementById(appState.currentPage + 'Page');
        if (currentPageEl) currentPageEl.classList.remove('active');

        const newPageEl = document.getElementById(pageId + 'Page');
        if (newPageEl) newPageEl.classList.add('active');

        appState.currentPage = pageId;

        if (pageId === 'chat') restoreChatSubviewUI();

        updateHeader(pageId);
        updateNavBar(pageId);
    }

    function updateHeader(pageId) {
        const config = pageConfig[pageId];
        if (!config || !elements.pageTitle || !elements.backBtn) return;

        if (pageId === 'chat') {
            if (appState.chatSubview === 'conversation') {
                elements.pageTitle.textContent = appState.currentSessionName;
            } else if (appState.sessionListPanel === 'template') {
                elements.pageTitle.textContent = '项目模板';
            } else {
                elements.pageTitle.textContent = '会话';
            }
            elements.backBtn.classList.toggle('hidden', appState.chatSubview !== 'conversation');
            return;
        }

        if (pageId === 'agentEditor' && appState.editingAgentId) {
            const entry = agentCatalog[appState.editingAgentId];
            elements.pageTitle.textContent = entry ? entry.definition.name : config.title;
            elements.backBtn.classList.toggle('hidden', !config.showBack);
            return;
        }

        elements.pageTitle.textContent = config.title;
        elements.backBtn.classList.toggle('hidden', !config.showBack);
    }

    function updateNavBar(pageId) {
        const config = pageConfig[pageId];
        if (!config || !elements.bottomNav) return;

        elements.bottomNav.style.display = config.showNav ? 'flex' : 'none';

        document.querySelectorAll('.nav-item').forEach(function (item) {
            item.classList.toggle('active', item.dataset.page === pageId);
        });
    }

    function openDrawer() {
        if (elements.drawerOverlay) elements.drawerOverlay.classList.remove('hidden');
        if (elements.projectDrawer) elements.projectDrawer.classList.add('open');
        if (elements.drawerOverlay) elements.drawerOverlay.setAttribute('aria-hidden', 'false');
    }

    function closeDrawer() {
        if (elements.drawerOverlay) elements.drawerOverlay.classList.add('hidden');
        if (elements.projectDrawer) elements.projectDrawer.classList.remove('open');
        if (elements.drawerOverlay) elements.drawerOverlay.setAttribute('aria-hidden', 'true');
    }

    function setupNavigation() {
        document.querySelectorAll('.nav-item').forEach(function (item) {
            item.addEventListener('click', function () {
                navigateToPage(item.dataset.page);
            });
        });
    }

    function setupBackButton() {
        if (!elements.backBtn) return;
        elements.backBtn.addEventListener('click', function () {
            if (appState.currentPage === 'chat' && appState.chatSubview === 'conversation') {
                showSessionListView();
                return;
            }
            if (appState.pageStack.length > 0) {
                const previousPage = appState.pageStack.pop();
                navigateToPage(previousPage);
            }
        });
    }

    function setupDrawer() {
        if (elements.drawerBtn) elements.drawerBtn.addEventListener('click', openDrawer);
        if (elements.drawerOverlay) elements.drawerOverlay.addEventListener('click', closeDrawer);
    }

    function setupSessionListTabs() {
        if (!elements.sessionListView) return;
        elements.sessionListView.querySelectorAll('[data-session-panel]').forEach(function (tab) {
            tab.addEventListener('click', function () {
                showSessionListPanel(tab.dataset.sessionPanel);
            });
        });
    }

    function setupChatTopTabs() {
        if (!elements.chatConversationView) return;
        elements.chatConversationView.querySelectorAll('[data-chat-panel]').forEach(function (tab) {
            tab.addEventListener('click', function () {
                showChatConversationPanel(tab.dataset.chatPanel);
            });
        });
    }

    function setupContextChips() {
        document.querySelectorAll('.chip').forEach(function (chip) {
            chip.addEventListener('click', function () {
                const action = chip.dataset.action;
                if (action === 'real-prompt') navigateToPage('realPrompt', true);
                else if (action === 'logs') navigateToPage('logs', true);
                else if (action === 'checkpoints') navigateToPage('checkpoints', true);
            });
        });
    }

    /* ----- VFS 浏览器（对齐 st-virtual-file-system 交互） ----- */
    const VFS_SCOPE_ROOT = {
        session: '/',
        project: '/template',
        global: '/template',
    };

    const vfsNavState = {
        session: '/',
        project: '/template',
        global: '/template',
    };

    const chapterFiles = function (base) {
        return [
            { name: 'chapter-01.md', kind: 'file', inclusion: 'show', display: '全内容' },
            { name: 'chapter-02.md', kind: 'file', inclusion: 'auto', display: '全内容' },
            { name: 'chapter-03.md', kind: 'file', inclusion: 'auto', display: '文件头' },
        ].map(function (f) {
            return Object.assign({}, f, { path: base + '/' + f.name });
        });
    };

    /** @type {Record<string, Record<string, object[]>>} */
    const vfsCatalog = {
        session: {
            '/': [
                { name: 'chapters', kind: 'directory', path: '/chapters', ruleEnabled: true, childCount: 3 },
                { name: 'outline.md', kind: 'file', path: '/outline.md', inclusion: 'show', display: '全内容' },
            ],
            '/chapters': chapterFiles('/chapters'),
        },
        project: {
            '/template': [
                { name: 'chapters', kind: 'directory', path: '/template/chapters', ruleEnabled: true, childCount: 3 },
                { name: 'README.md', kind: 'file', path: '/template/README.md', inclusion: 'show', display: '全内容' },
            ],
            '/template/chapters': chapterFiles('/template/chapters'),
        },
        global: {
            '/template': [
                { name: 'shared', kind: 'directory', path: '/template/shared', ruleEnabled: true, childCount: 1 },
                {
                    name: 'default-workspace.md',
                    kind: 'file',
                    path: '/template/default-workspace.md',
                    inclusion: 'show',
                    display: '全内容',
                },
                {
                    name: 'prompt-snippets.md',
                    kind: 'file',
                    path: '/template/prompt-snippets.md',
                    inclusion: 'auto',
                    display: '全内容',
                },
            ],
            '/template/shared': [
                {
                    name: 'snippets.md',
                    kind: 'file',
                    path: '/template/shared/snippets.md',
                    inclusion: 'auto',
                    display: '文件名',
                },
            ],
        },
    };

    const INCLUSION_CYCLE = ['auto', 'show', 'hide'];
    const INCLUSION_LABEL = { auto: '自动', show: '展示', hide: '隐藏' };

    const DEFAULT_DIRECTORY_RULE = {
        sortField: 'name',
        sortDirection: 'asc',
        headCount: 1000,
        tailCount: 0,
        fill: 'omit',
    };

    const DIRECTORY_RULE_LABELS = {
        sortField: { name: '文件名称', ctime: '创建时间', mtime: '更新时间' },
        sortDirection: { asc: '升序', desc: '降序' },
        fill: { filename: '文件名', frontmatter: '头信息', omit: '不展示' },
    };

    /** @type {Record<string, object>} */
    const vfsDirectoryRules = {};

    function vfsRuleKey(scope, path) {
        return scope + '::' + path;
    }

    function vfsGetDirectoryRule(scope, path) {
        const key = vfsRuleKey(scope, path);
        if (!vfsDirectoryRules[key]) {
            vfsDirectoryRules[key] = Object.assign({}, DEFAULT_DIRECTORY_RULE);
        }
        return vfsDirectoryRules[key];
    }

    function vfsEntries(scope, dirPath) {
        return (vfsCatalog[scope] && vfsCatalog[scope][dirPath]) || [];
    }

    function vfsFindEntry(scope, path) {
        const dir = path.substring(0, path.lastIndexOf('/')) || VFS_SCOPE_ROOT[scope];
        const name = path.substring(path.lastIndexOf('/') + 1);
        return vfsEntries(scope, dir).find(function (e) { return e.name === name && e.path === path; });
    }

    function vfsParentPath(scope, path) {
        if (path === VFS_SCOPE_ROOT[scope]) return null;
        const idx = path.lastIndexOf('/');
        if (idx <= 0) return VFS_SCOPE_ROOT[scope];
        return path.substring(0, idx);
    }

    function vfsEntryStatusText(entry) {
        if (entry.kind === 'directory') {
            const rule = entry.ruleEnabled !== false ? '规则·开' : '规则·关';
            return entry.childCount ? rule + ' | ' + entry.childCount + '个文件' : rule;
        }
        const inc = INCLUSION_LABEL[entry.inclusion] || entry.inclusion;
        return inc + '·' + (entry.display || '全内容');
    }

    function vfsEntryBadge(entry) {
        if (entry.kind === 'directory') return null;
        if (entry.inclusion === 'hide') return { label: '隐藏', tone: 'muted' };
        if (entry.inclusion === 'show') return { label: '展示', tone: 'in' };
        return { label: entry.display || '全内容', tone: 'follow' };
    }

    function vfsCycleInclusion(entry) {
        const i = INCLUSION_CYCLE.indexOf(entry.inclusion);
        entry.inclusion = INCLUSION_CYCLE[(i + 1) % INCLUSION_CYCLE.length];
        if (entry.inclusion === 'show') entry.display = '全内容';
        if (entry.inclusion === 'hide') entry.display = '不展示';
    }

    function renderVfsBrowser(scope) {
        const host = document.querySelector('.vfs-browser[data-vfs-scope="' + scope + '"]');
        if (!host) return;

        const currentPath = vfsNavState[scope];
        const root = VFS_SCOPE_ROOT[scope];
        const entries = vfsEntries(scope, currentPath);
        const canUp = currentPath !== root;

        let html = '<section class="vfs-fm-panel">';
        html += '<header class="vfs-fm-header">';
        html += '<div class="vfs-fm-nav-group">';
        html += '<button type="button" class="vfs-fm-icon-btn" data-vfs-action="up" data-vfs-scope="' + scope + '"';
        html += canUp ? '' : ' disabled';
        html += ' title="返回上级" aria-label="返回上级">↑</button>';
        html += '<span class="vfs-fm-path" title="' + currentPath + '">' + currentPath + '</span>';
        html += '</div>';
        html += '<div class="vfs-fm-actions">';
        html += '<button type="button" class="vfs-fm-tool-btn vfs-fm-more-btn" data-vfs-action="more" data-vfs-scope="' + scope + '" title="更多操作" aria-label="更多操作">⋯</button>';
        html += '</div></header>';
        html += '<ul class="vfs-fm-list">';

        if (entries.length === 0) {
            html += '<li class="vfs-fm-empty">空目录</li>';
        } else {
            entries.forEach(function (entry) {
                const badge = vfsEntryBadge(entry);
                const isDir = entry.kind === 'directory';
                html += '<li class="vfs-fm-row" data-path="' + entry.path + '">';
                html += '<button type="button" class="vfs-fm-item" data-vfs-row="1" data-vfs-scope="' + scope + '" data-path="' + entry.path + '" data-kind="' + entry.kind + '">';
                html += '<span class="vfs-fm-item-main">';
                html += '<span class="vfs-fm-kind">' + (isDir ? '📁' : '📄') + '</span>';
                html += '<span class="vfs-fm-text">';
                html += '<span class="vfs-fm-name">' + entry.name + '</span>';
                html += '<span class="vfs-fm-status">' + vfsEntryStatusText(entry) + '</span>';
                html += '</span></span>';
                if (badge) {
                    html += '<span class="vfs-fm-badge vfs-fm-badge--' + badge.tone + '">' + badge.label + '</span>';
                }
                html += '</button>';
                html += '<span class="vfs-fm-rule-lamp' + (isDir && entry.ruleEnabled !== false ? ' on' : '') + '" title="' + (isDir ? (entry.ruleEnabled !== false ? '规则·开' : '规则·关') : '') + '" aria-hidden="' + (!isDir ? 'true' : 'false') + '">💡</span>';
                html += '<button type="button" class="vfs-fm-menu-btn" data-vfs-action="menu" data-vfs-scope="' + scope + '" data-path="' + entry.path + '" aria-label="操作">⋮</button>';
                html += '</li>';
            });
        }

        html += '</ul></section>';
        host.innerHTML = html;
    }

    function renderAllVfsBrowsers() {
        ['session', 'project', 'global'].forEach(renderVfsBrowser);
    }

    function vfsOpenPath(scope, path) {
        vfsNavState[scope] = path;
        renderVfsBrowser(scope);
    }

    function vfsHandleEntityAction(scope, path, action) {
        const entry = vfsFindEntry(scope, path);
        if (!entry) return;

        if (action === 'open') {
            if (entry.kind === 'directory') vfsOpenPath(scope, path);
            else navigateToPage('fileEditor', true);
            return;
        }
        if (action === 'toggle-status' && entry.kind === 'directory') {
            entry.ruleEnabled = entry.ruleEnabled === false;
            renderVfsBrowser(scope);
            showToast('目录规则已' + (entry.ruleEnabled !== false ? '开启' : '关闭'));
            return;
        }
        if (action === 'toggle-include' && entry.kind === 'file') {
            vfsCycleInclusion(entry);
            renderVfsBrowser(scope);
            showToast('纳入方式：' + INCLUSION_LABEL[entry.inclusion]);
            return;
        }
        if (action === 'open-slideshow') {
            showToast('目录幻灯片（示意）');
            return;
        }
        if (action === 'rename') {
            showToast('重命名 ' + entry.name);
            return;
        }
        if (action === 'delete') {
            showToast('删除 ' + entry.name);
        }
    }

    function vfsShowEntityMenu(scope, path) {
        const entry = vfsFindEntry(scope, path);
        if (!entry) return;
        const isDir = entry.kind === 'directory';
        const items = isDir
            ? [
                  { label: '进入', action: 'open' },
                  { label: '切换规则开关', action: 'toggle-status' },
                  { label: '目录幻灯片', action: 'open-slideshow' },
                  { label: '重命名', action: 'rename' },
                  { label: '删除', action: 'delete', danger: true },
              ]
            : [
                  { label: '打开', action: 'open' },
                  { label: '切换纳入方式', action: 'toggle-include' },
                  { label: '重命名', action: 'rename' },
                  { label: '删除', action: 'delete', danger: true },
              ];
        showBottomSheet(items, function (action) {
            vfsHandleEntityAction(scope, path, action);
        });
    }

    function vfsShowMoreSheet(scope) {
        showBottomSheet(
            [
                { label: '新建目录', action: 'create-directory' },
                { label: '新建文件', action: 'create-file' },
                { label: '目录纳入规则', action: 'directory-rule' },
            ],
            function (action) {
                if (action === 'create-file') {
                    showToast('新建文件（' + scope + '）');
                    return;
                }
                if (action === 'create-directory') {
                    showToast('新建目录（' + scope + '）');
                    return;
                }
                if (action === 'directory-rule') {
                    vfsShowDirectoryRuleSheet(scope);
                    return false;
                }
            },
        );
    }

    function vfsShowDirectoryRuleSheet(scope) {
        if (!elements.sheetContent || !elements.bottomSheet) return;

        const currentPath = vfsNavState[scope];
        const rule = vfsGetDirectoryRule(scope, currentPath);

        let html = '<div class="sheet-form">';
        html += '<h3 class="sheet-form-title">目录纳入规则</h3>';
        html += '<p class="sheet-form-path">' + currentPath + '</p>';
        html += '<label class="sheet-form-field"><span>排序方式</span><select data-rule-field="sortField">';
        html += '<option value="name"' + (rule.sortField === 'name' ? ' selected' : '') + '>文件名称</option>';
        html += '<option value="ctime"' + (rule.sortField === 'ctime' ? ' selected' : '') + '>创建时间</option>';
        html += '<option value="mtime"' + (rule.sortField === 'mtime' ? ' selected' : '') + '>更新时间</option>';
        html += '</select></label>';
        html += '<label class="sheet-form-field"><span>排序方向</span><select data-rule-field="sortDirection">';
        html += '<option value="asc"' + (rule.sortDirection === 'asc' ? ' selected' : '') + '>升序</option>';
        html += '<option value="desc"' + (rule.sortDirection === 'desc' ? ' selected' : '') + '>降序</option>';
        html += '</select></label>';
        html += '<label class="sheet-form-field"><span>头部读取</span><input type="range" min="0" max="1000" step="1" data-rule-field="headCount" value="' + rule.headCount + '">';
        html += '<output data-rule-output="headCount">' + rule.headCount + '</output></label>';
        html += '<label class="sheet-form-field"><span>尾部读取</span><input type="range" min="0" max="1000" step="1" data-rule-field="tailCount" value="' + rule.tailCount + '">';
        html += '<output data-rule-output="tailCount">' + rule.tailCount + '</output></label>';
        html += '<label class="sheet-form-field"><span>填充策略</span><select data-rule-field="fill">';
        html += '<option value="filename"' + (rule.fill === 'filename' ? ' selected' : '') + '>文件名</option>';
        html += '<option value="frontmatter"' + (rule.fill === 'frontmatter' ? ' selected' : '') + '>头信息</option>';
        html += '<option value="omit"' + (rule.fill === 'omit' ? ' selected' : '') + '>不展示</option>';
        html += '</select></label>';
        html += '<button type="button" class="btn-primary sheet-form-save" data-action="save-directory-rule">保存</button>';
        html += '</div>';

        elements.sheetContent.innerHTML = html;
        elements.sheetContent.classList.add('sheet-content--form');
        if (elements.sheetBackdrop) {
            elements.sheetBackdrop.classList.remove('hidden');
            elements.sheetBackdrop.setAttribute('aria-hidden', 'false');
        }
        elements.bottomSheet.classList.remove('hidden');
        setTimeout(function () {
            elements.bottomSheet.classList.add('show');
        }, 10);

        elements.sheetContent.querySelectorAll('input[type="range"]').forEach(function (input) {
            input.addEventListener('input', function () {
                const output = elements.sheetContent.querySelector('[data-rule-output="' + input.dataset.ruleField + '"]');
                if (output) output.textContent = input.value;
            });
        });

        const saveBtn = elements.sheetContent.querySelector('[data-action="save-directory-rule"]');
        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                const nextRule = Object.assign({}, rule);
                elements.sheetContent.querySelectorAll('[data-rule-field]').forEach(function (field) {
                    const key = field.dataset.ruleField;
                    if (field.type === 'range') nextRule[key] = Number(field.value);
                    else nextRule[key] = field.value;
                });
                vfsDirectoryRules[vfsRuleKey(scope, currentPath)] = nextRule;
                elements.sheetContent.classList.remove('sheet-content--form');
                hideBottomSheet();
                renderVfsBrowser(scope);
                const sortLabel = DIRECTORY_RULE_LABELS.sortField[nextRule.sortField] || nextRule.sortField;
                showToast('已保存目录纳入规则（' + sortLabel + ' · head ' + nextRule.headCount + '）');
            });
        }
    }

    function setupVfsBrowsers() {
        renderAllVfsBrowsers();

        document.getElementById('mainContent').addEventListener('click', function (e) {
            const menuBtn = e.target.closest('[data-vfs-action="menu"]');
            if (menuBtn) {
                e.preventDefault();
                e.stopPropagation();
                vfsShowEntityMenu(menuBtn.dataset.vfsScope, menuBtn.dataset.path);
                return;
            }

            const toolBtn = e.target.closest('[data-vfs-action="more"]');
            if (toolBtn) {
                e.preventDefault();
                vfsShowMoreSheet(toolBtn.dataset.vfsScope);
                return;
            }

            const upBtn = e.target.closest('[data-vfs-action="up"]');
            if (upBtn && !upBtn.disabled) {
                e.preventDefault();
                const scope = upBtn.dataset.vfsScope;
                const parent = vfsParentPath(scope, vfsNavState[scope]);
                if (parent) vfsOpenPath(scope, parent);
                return;
            }

            const rowBtn = e.target.closest('[data-vfs-row="1"]');
            if (rowBtn) {
                const scope = rowBtn.dataset.vfsScope;
                const path = rowBtn.dataset.path;
                const kind = rowBtn.dataset.kind;
                if (kind === 'directory') vfsOpenPath(scope, path);
            }
        });

        document.getElementById('mainContent').addEventListener('dblclick', function (e) {
            const rowBtn = e.target.closest('[data-vfs-row="1"]');
            if (!rowBtn || rowBtn.dataset.kind !== 'file') return;
            e.preventDefault();
            navigateToPage('fileEditor', true);
        });
    }

    function setupMenuItems() {
        document.querySelectorAll('.menu-item').forEach(function (item) {
            item.addEventListener('click', function () {
                const action = item.dataset.action;
                if (action === 'providers') navigateToPage('providers', true);
                else if (action === 'global-template') navigateToPage('globalTemplate', true);
                else if (action === 'settings') navigateToPage('settings', true);
                else if (action === 'debug') showToast('开发调试功能');
            });
        });
    }

    function setupCheckpoints() {
        document.querySelectorAll('.rollback-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const checkpointItem = btn.closest('.checkpoint-item');
                const checkpointId = checkpointItem ? checkpointItem.dataset.id : '';
                if (!checkpointId) return;
                if (confirm('确定要回滚到检查点 ' + checkpointId + ' 吗？')) {
                    showToast('正在回滚...');
                    setTimeout(function () {
                        showToast('回滚成功');
                    }, 1500);
                }
            });
        });
        document.querySelectorAll('.checkpoint-link').forEach(function (link) {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                navigateToPage('checkpoints', true);
            });
        });
    }

    function setupBottomSheet() {
        if (elements.sheetBackdrop) {
            elements.sheetBackdrop.addEventListener('click', hideBottomSheet);
        }
    }

    function setupFileEditor() {
        const saveBtn = document.querySelector('[data-action="save"]');
        const previewBtn = document.querySelector('[data-action="preview"]');
        const codeEditor = document.querySelector('.code-editor');
        const unsavedIndicator = document.querySelector('.unsaved-indicator');
        if (!codeEditor) return;

        let isDirty = false;

        codeEditor.addEventListener('input', function () {
            if (!isDirty) {
                isDirty = true;
                if (unsavedIndicator) unsavedIndicator.classList.remove('hidden');
            }
        });

        if (saveBtn) {
            saveBtn.addEventListener('click', function () {
                showToast('保存中...');
                setTimeout(function () {
                    isDirty = false;
                    if (unsavedIndicator) unsavedIndicator.classList.add('hidden');
                    showToast('保存成功');
                }, 500);
            });
        }

        if (previewBtn) {
            previewBtn.addEventListener('click', function () {
                showToast('切换到预览模式');
            });
        }

        if (elements.backBtn) {
            elements.backBtn.addEventListener(
                'click',
                function (e) {
                    if (appState.currentPage === 'fileEditor' && isDirty) {
                        if (!confirm('有未保存的更改，确定要离开吗？')) {
                            e.stopImmediatePropagation();
                        }
                    }
                },
                true,
            );
        }
    }

    function setupProjectsAndSessions() {
        const projectItems = document.querySelectorAll('.drawer-project-list .project-item');
        projectItems.forEach(function (item) {
            item.addEventListener('click', function () {
                const projectId = item.dataset.id;
                const nameEl = item.querySelector('.project-name');
                const projectName = item.dataset.name || (nameEl ? nameEl.textContent : '');

                appState.currentProjectId = projectId;
                appState.currentProjectName = projectName;

                projectItems.forEach(function (el) {
                    el.classList.toggle('active', el.dataset.id === projectId);
                    const badge = el.querySelector('.current-badge');
                    if (el.dataset.id === projectId) {
                        if (!badge) {
                            const span = document.createElement('span');
                            span.className = 'current-badge';
                            span.textContent = '当前';
                            el.appendChild(span);
                        }
                    } else if (badge) {
                        badge.remove();
                    }
                });

                if (elements.bannerProjectName) elements.bannerProjectName.textContent = projectName;
                closeDrawer();
                showSessionListView();
                showToast('已切换到项目：' + projectName);
            });
        });

        document.querySelectorAll('#sessionListView .session-item').forEach(function (item) {
            item.addEventListener('click', function () {
                const sessionId = item.dataset.id;
                const nameEl = item.querySelector('.session-name');
                const sessionName = item.dataset.name || (nameEl ? nameEl.textContent : '');
                openChatConversation(sessionId, sessionName);
            });
        });

        const newProjectBtn = document.querySelector('[data-action="new-project"]');
        if (newProjectBtn) {
            newProjectBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                showToast('新建项目');
            });
        }

        const newSessionBtn = document.querySelector('[data-action="new-session"]');
        if (newSessionBtn) {
            newSessionBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                showToast('新建会话');
            });
        }
    }

    /* ----- Agent 配置（对齐 packages/core AgentDefinition） ----- */
    const MOCK_PROVIDERS = [
        {
            id: 'zhipu',
            name: '智谱 AI',
            protocol: 'openai',
            models: [{ vendorModelId: 'glm-4.6', label: 'GLM-4.6' }],
        },
        {
            id: 'openai',
            name: 'OpenAI',
            protocol: 'openai',
            models: [{ vendorModelId: 'gpt-4o', label: 'GPT-4o' }],
        },
        {
            id: 'anthropic',
            name: 'Anthropic',
            protocol: 'anthropic',
            models: [{ vendorModelId: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' }],
        },
        {
            id: 'google',
            name: 'Google',
            protocol: 'gemini',
            models: [{ vendorModelId: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }],
        },
    ];

    function parseApplicationModelId(applicationModelId) {
        const slash = applicationModelId.indexOf('/');
        if (slash <= 0) return { providerId: '', vendorModelId: applicationModelId };
        return {
            providerId: applicationModelId.substring(0, slash),
            vendorModelId: applicationModelId.substring(slash + 1),
        };
    }

    function buildApplicationModelId(providerId, vendorModelId) {
        return providerId + '/' + vendorModelId;
    }

    function findProvider(providerId) {
        return MOCK_PROVIDERS.find(function (p) { return p.id === providerId; });
    }

    function resolveModelSelection(applicationModelId) {
        const parsed = parseApplicationModelId(applicationModelId);
        let provider = findProvider(parsed.providerId);
        if (!provider && MOCK_PROVIDERS.length) provider = MOCK_PROVIDERS[0];
        let vendorModelId = parsed.vendorModelId;
        let model = provider.models.find(function (m) { return m.vendorModelId === vendorModelId; });
        if (!model && provider.models.length) {
            model = provider.models[0];
            vendorModelId = model.vendorModelId;
        }
        return { providerId: provider.id, vendorModelId: vendorModelId, protocol: provider.protocol };
    }

    function renderModelSelectOptions(providerId, selectedVendorModelId) {
        const provider = findProvider(providerId);
        if (!provider) return '';
        return provider.models
            .map(function (m) {
                return (
                    '<option value="' +
                    m.vendorModelId +
                    '"' +
                    (m.vendorModelId === selectedVendorModelId ? ' selected' : '') +
                    '>' +
                    escapeHtml(m.label) +
                    '</option>'
                );
            })
            .join('');
    }

    function updateAgentModelIdHint(root) {
        if (!root) return;
        const hint = root.querySelector('[data-agent-model-id-hint]');
        const providerSelect = root.querySelector('[data-agent-field="providerId"]');
        const vendorSelect = root.querySelector('[data-agent-field="vendorModelId"]');
        if (!hint || !providerSelect || !vendorSelect) return;
        hint.textContent = buildApplicationModelId(providerSelect.value, vendorSelect.value);
    }

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function createWriterDefinition() {
        return {
            schemaVersion: 1,
            name: 'writer',
            model: {
                applicationModelId: 'zhipu/glm-4.6',
                params: { protocol: 'openai', openai: { temperature: 0.7, top_p: 0.9 } },
            },
            runtime: { maxSteps: 20 },
            compact: {
                trigger: { tokenThreshold: 12000, floorThreshold: 20 },
                action: { keepLastN: 6, abstract: { type: 'agent' } },
            },
            prompts: [
                { name: 'system', type: 'text', role: 'system', content: 'You are a helpful assistant.' },
                {
                    name: 'abstract',
                    type: 'abstract',
                    content: '压缩后的内容如下：\n{{.abstract}}',
                },
                { name: 'history', type: 'chat' },
            ],
        };
    }

    function createCreativeDefinition() {
        return {
            schemaVersion: 1,
            name: 'creative',
            model: {
                applicationModelId: 'anthropic/claude-3-5-sonnet',
                params: { protocol: 'anthropic', anthropic: { temperature: 0.9, max_tokens: 4096 } },
            },
            runtime: { maxSteps: 15 },
            prompts: [
                { name: 'system', type: 'text', role: 'system', content: '你是一位创意写作助手，擅长小说与故事创作。' },
                { name: 'history', type: 'chat' },
            ],
        };
    }

    /** @type {Record<string, { id: string, definition: object }>} */
    const agentCatalog = {
        'agent-writer': { id: 'agent-writer', definition: createWriterDefinition() },
        'agent-creative': { id: 'agent-creative', definition: createCreativeDefinition() },
    };

    function modelProtocolForId(modelId) {
        return resolveModelSelection(modelId).protocol;
    }

    function modelShortLabel(modelId) {
        const sel = resolveModelSelection(modelId);
        const provider = findProvider(sel.providerId);
        const model = provider && provider.models.find(function (m) { return m.vendorModelId === sel.vendorModelId; });
        return model ? model.label : sel.vendorModelId;
    }

    function agentListMeta(def) {
        const sel = resolveModelSelection(def.model.applicationModelId);
        const provider = findProvider(sel.providerId);
        const parts = [(provider ? provider.name : sel.providerId) + ' · ' + sel.vendorModelId];
        if (def.runtime && def.runtime.maxSteps) parts.push('最大 ' + def.runtime.maxSteps + ' 步');
        else parts.push('最大 20 步');
        if (def.compact) {
            const t = def.compact.trigger || {};
            const hints = [];
            if (t.tokenThreshold) hints.push(t.tokenThreshold + ' tokens');
            if (t.floorThreshold) hints.push(t.floorThreshold + ' 条');
            parts.push('压缩' + (hints.length ? ' · ' + hints.join('/') : ''));
        }
        const temp = def.model.params && def.model.params.openai && def.model.params.openai.temperature;
        if (temp != null) parts.push('温度 ' + temp);
        return parts.join(' · ');
    }

    function definitionToYamlPreview(def) {
        const doc = {
            schemaVersion: 1,
            name: def.name,
            model: def.model,
            runtime: def.runtime,
            compact: def.compact,
            prompts: { blocks: def.prompts },
        };
        if (!doc.runtime) delete doc.runtime;
        if (!doc.compact) delete doc.compact;
        return JSON.stringify(doc, null, 2)
            .replace(/"([^"]+)":/g, '$1:')
            .replace(/"/g, "'");
    }

    function renderAgentList() {
        const host = document.getElementById('agentList');
        if (!host) return;
        let html = '';
        Object.keys(agentCatalog).forEach(function (id) {
            const entry = agentCatalog[id];
            const def = entry.definition;
            const isDefault = appState.defaultAgentId === id;
            html += '<div class="agent-item" data-id="' + id + '">';
            html += '<div class="agent-info">';
            html += '<div class="agent-name">' + def.name + '</div>';
            html += '<div class="agent-meta">' + agentListMeta(def) + '</div>';
            html += '</div>';
            if (isDefault) html += '<span class="default-badge">默认</span>';
            html += '<button type="button" class="agent-menu-btn" data-agent-menu="' + id + '" aria-label="更多">⋮</button>';
            html += '</div>';
        });
        host.innerHTML = html;
        updateChatAgentMeta();
    }

    function updateChatAgentMeta() {
        const entry = agentCatalog[appState.defaultAgentId];
        if (!entry) return;
        const def = entry.definition;
        const agentEl = document.querySelector('.chat-meta .agent-name');
        const modelEl = document.querySelector('.chat-meta .model-name');
        if (agentEl) agentEl.textContent = def.name;
        if (modelEl) modelEl.textContent = modelShortLabel(def.model.applicationModelId);
    }

    function openAgentEditor(agentId) {
        appState.editingAgentId = agentId;
        appState.agentEditorDirty = false;
        renderAgentEditor(agentId);
        navigateToPage('agentEditor', true);
    }

    function markAgentEditorDirty() {
        appState.agentEditorDirty = true;
        const indicator = document.querySelector('.agent-unsaved');
        if (indicator) indicator.classList.remove('hidden');
    }

    function clearAgentEditorDirty() {
        appState.agentEditorDirty = false;
        const indicator = document.querySelector('.agent-unsaved');
        if (indicator) indicator.classList.add('hidden');
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function renderSamplingFields(protocol, params) {
        const p = params || {};
        let html = '<div class="agent-sampling-fields" data-protocol="' + protocol + '">';
        if (protocol === 'openai') {
            const o = p.openai || {};
            html += samplingNumberField('temperature', '温度', o.temperature, 0, 2, 0.1);
            html += samplingNumberField('top_p', 'Top P', o.top_p, 0, 1, 0.05);
            html += samplingIntField('max_tokens', 'Max Tokens', o.max_tokens);
        } else if (protocol === 'anthropic') {
            const a = p.anthropic || {};
            html += samplingNumberField('temperature', '温度', a.temperature, 0, 1, 0.05);
            html += samplingNumberField('top_p', 'Top P', a.top_p, 0, 1, 0.05);
            html += samplingIntField('top_k', 'Top K', a.top_k);
            html += samplingIntField('max_tokens', 'Max Tokens', a.max_tokens);
        } else if (protocol === 'gemini') {
            const g = p.gemini || {};
            html += samplingNumberField('temperature', '温度', g.temperature, 0, 2, 0.1);
            html += samplingNumberField('topP', 'Top P', g.topP, 0, 1, 0.05);
            html += samplingIntField('topK', 'Top K', g.topK);
            html += samplingIntField('maxOutputTokens', 'Max Output Tokens', g.maxOutputTokens);
        }
        html += '</div>';
        return html;
    }

    function samplingNumberField(key, label, value, min, max, step) {
        const val = value != null ? value : '';
        return (
            '<label class="agent-field"><span>' +
            label +
            '</span><input type="number" data-sampling-key="' +
            key +
            '" min="' +
            min +
            '" max="' +
            max +
            '" step="' +
            step +
            '" value="' +
            val +
            '" placeholder="可选"></label>'
        );
    }

    function samplingIntField(key, label, value) {
        const val = value != null ? value : '';
        return (
            '<label class="agent-field"><span>' +
            label +
            '</span><input type="number" data-sampling-key="' +
            key +
            '" min="1" step="1" value="' +
            val +
            '" placeholder="可选"></label>'
        );
    }

    function promptBlockTypeLabel(blockType) {
        if (blockType === 'text') return '文本';
        if (blockType === 'abstract') return '摘要';
        return '会话';
    }

    function renderPromptBlockCard(block, index, total) {
        const blockType = block.type;
        let html = '<div class="prompt-block-card" data-block-index="' + index + '" data-block-kind="' + blockType + '">';
        html += '<div class="prompt-block-header">';
        html += '<span class="prompt-block-type">' + promptBlockTypeLabel(blockType) + '</span>';
        html += '<span class="prompt-block-name">' + escapeHtml(block.name) + '</span>';
        html += '<div class="prompt-block-actions">';
        if (index > 0) html += '<button type="button" data-block-action="up" title="上移">↑</button>';
        if (index < total - 1) html += '<button type="button" data-block-action="down" title="下移">↓</button>';
        html += '<button type="button" data-block-action="delete" title="删除">×</button>';
        html += '</div></div>';

        html += '<label class="agent-field"><span>名称</span><input type="text" data-block-field="name" value="' + escapeHtml(block.name) + '"></label>';

        if (blockType === 'text') {
            html += '<label class="agent-field"><span>角色</span><select data-block-field="role">';
            ['system', 'user', 'assistant'].forEach(function (role) {
                html += '<option value="' + role + '"' + (block.role === role ? ' selected' : '') + '>' + role + '</option>';
            });
            html += '</select></label>';
            html += '<p class="agent-field-hint">仅 system 文本块会合并进 LLM system；会话历史请用 chat 块。</p>';
            html += '<label class="agent-field"><span>内容</span><textarea data-block-field="content" rows="4">' + escapeHtml(block.content || '') + '</textarea></label>';
            html += '<p class="agent-field-hint">宏：{{.worktree}} {{$time}} {{$week_cn}}</p>';
        } else if (blockType === 'abstract') {
            html += '<label class="agent-field"><span>内容</span><textarea data-block-field="content" rows="4">' + escapeHtml(block.content || '') + '</textarea></label>';
            html += '<p class="agent-field-hint">无压缩摘要时不拼接；可用 {{.abstract}}、{{.worktree}}、{{$time}}、{{$week_cn}}</p>';
        } else {
            html += '<p class="agent-field-hint">chat 块将会话消息注入模型上下文，通常放在 prompt 列表末尾。</p>';
        }
        html += '</div>';
        return html;
    }

    function renderAgentEditor(agentId) {
        const root = document.getElementById('agentEditorRoot');
        const entry = agentCatalog[agentId];
        if (!root || !entry) return;

        const def = entry.definition;
        const modelSel = resolveModelSelection(def.model.applicationModelId);
        const protocol = (def.model.params && def.model.params.protocol) || modelSel.protocol;
        const compactEnabled = Boolean(def.compact);
        const compact = def.compact || { trigger: {}, action: { keepLastN: 6, abstract: { type: 'agent' } } };
        const abstractType = compact.action.abstract.type || 'agent';

        let html = '';

        html += '<section class="agent-form-section"><h3>基本信息</h3>';
        html += '<label class="agent-field"><span>名称</span><input type="text" data-agent-field="name" value="' + escapeHtml(def.name) + '"></label>';
        html += '</section>';

        html += '<section class="agent-form-section"><h3>模型</h3>';
        html += '<label class="agent-field"><span>服务商</span><select data-agent-field="providerId">';
        MOCK_PROVIDERS.forEach(function (p) {
            html +=
                '<option value="' +
                p.id +
                '" data-protocol="' +
                p.protocol +
                '"' +
                (p.id === modelSel.providerId ? ' selected' : '') +
                '>' +
                escapeHtml(p.name) +
                '</option>';
        });
        html += '</select></label>';
        html += '<label class="agent-field"><span>模型</span><select data-agent-field="vendorModelId">';
        html += renderModelSelectOptions(modelSel.providerId, modelSel.vendorModelId);
        html += '</select></label>';
        html +=
            '<p class="agent-field-hint">applicationModelId: <code data-agent-model-id-hint>' +
            buildApplicationModelId(modelSel.providerId, modelSel.vendorModelId) +
            '</code></p>';
        html += renderSamplingFields(protocol, def.model.params);
        html += '</section>';

        html += '<section class="agent-form-section"><h3>运行时</h3>';
        html += '<label class="agent-field"><span>最大步数 maxSteps</span><input type="number" data-agent-field="maxSteps" min="1" step="1" value="' + (def.runtime && def.runtime.maxSteps != null ? def.runtime.maxSteps : 20) + '"></label>';
        html += '<p class="agent-field-hint">每轮 run 的模型往返上限；省略时 Core 默认 20。</p>';
        html += '</section>';

        html += '<section class="agent-form-section"><h3>压缩策略 compact</h3>';
        html += '<label class="agent-field agent-field--row"><span>启用压缩</span><input type="checkbox" class="toggle" data-agent-field="compactEnabled"' + (compactEnabled ? ' checked' : '') + '></label>';
        html += '<div class="agent-compact-panel' + (compactEnabled ? '' : ' hidden') + '" data-compact-panel>';
        html += '<p class="agent-field-hint">触发条件为 OR：token 估计或消息条数任一满足即压缩。</p>';
        html += '<label class="agent-field"><span>Token 阈值</span><input type="number" data-compact-field="tokenThreshold" min="1" step="1" value="' + (compact.trigger.tokenThreshold || '') + '" placeholder="如 12000"></label>';
        html += '<label class="agent-field"><span>消息条数阈值</span><input type="number" data-compact-field="floorThreshold" min="1" step="1" value="' + (compact.trigger.floorThreshold || '') + '" placeholder="如 20"></label>';
        html += '<label class="agent-field"><span>保留最近 N 条</span><input type="number" data-compact-field="keepLastN" min="1" step="1" value="' + (compact.action.keepLastN || 6) + '"></label>';
        html += '<label class="agent-field"><span>摘要方式</span><select data-compact-field="abstractType">';
        html += '<option value="agent"' + (abstractType === 'agent' ? ' selected' : '') + '>Agent 生成</option>';
        html += '<option value="text"' + (abstractType === 'text' ? ' selected' : '') + '>静态文本</option>';
        html += '</select></label>';
        html += '<label class="agent-field agent-abstract-agent' + (abstractType === 'agent' ? '' : ' hidden') + '"><span>摘要指令 instruction</span><textarea data-compact-field="abstractInstruction" rows="2" placeholder="Summarize the following conversation history concisely:">' + escapeHtml(compact.action.abstract.instruction || '') + '</textarea></label>';
        html += '<label class="agent-field agent-abstract-text' + (abstractType === 'text' ? '' : ' hidden') + '"><span>摘要模板 content</span><textarea data-compact-field="abstractContent" rows="3" placeholder="支持 {{.abstract}} 等宏">' + escapeHtml(compact.action.abstract.content || '') + '</textarea></label>';
        html += '</div></section>';

        html += '<section class="agent-form-section"><div class="agent-section-header"><h3>Prompt 块</h3><button type="button" class="btn-secondary btn-sm" data-action="add-prompt-block">添加</button></div>';
        html += '<div class="prompt-block-list">';
        def.prompts.forEach(function (block, i) {
            html += renderPromptBlockCard(block, i, def.prompts.length);
        });
        html += '</div></section>';

        html += '<section class="agent-form-section agent-form-section--muted"><h3>工具</h3>';
        html += '<p class="agent-field-hint">VFS 工具（read / write / list 等）由运行时全局注册，当前 Agent 配置不可 per-agent 开关。</p>';
        html += '</section>';

        html += '<section class="agent-form-section"><details class="agent-yaml-preview"><summary>配置预览（JSON 结构示意）</summary><pre class="agent-yaml-content">' + escapeHtml(definitionToYamlPreview(def)) + '</pre></details></section>';

        root.innerHTML = html;
        clearAgentEditorDirty();
        updateHeader('agentEditor');
    }

    function collectAgentDefinitionFromForm(options) {
        const strict = !options || options.strict !== false;
        const root = document.getElementById('agentEditorRoot');
        const entry = agentCatalog[appState.editingAgentId];
        if (!root || !entry) return null;

        const nameInput = root.querySelector('[data-agent-field="name"]');
        const providerSelect = root.querySelector('[data-agent-field="providerId"]');
        const vendorSelect = root.querySelector('[data-agent-field="vendorModelId"]');
        const maxStepsInput = root.querySelector('[data-agent-field="maxSteps"]');
        const compactEnabled = root.querySelector('[data-agent-field="compactEnabled"]');

        const providerId = providerSelect ? providerSelect.value : resolveModelSelection(entry.definition.model.applicationModelId).providerId;
        const vendorModelId = vendorSelect ? vendorSelect.value : resolveModelSelection(entry.definition.model.applicationModelId).vendorModelId;

        const def = {
            schemaVersion: 1,
            name: nameInput ? nameInput.value.trim() : entry.definition.name,
            model: { applicationModelId: buildApplicationModelId(providerId, vendorModelId) },
            prompts: [],
        };

        if (maxStepsInput && maxStepsInput.value) {
            def.runtime = { maxSteps: Number(maxStepsInput.value) };
        }

        const protocol =
            (providerSelect && providerSelect.selectedOptions[0] && providerSelect.selectedOptions[0].dataset.protocol) ||
            modelProtocolForId(def.model.applicationModelId);
        const samplingRoot = root.querySelector('.agent-sampling-fields');
        const samplingKeys = samplingRoot ? samplingRoot.querySelectorAll('[data-sampling-key]') : [];
        const samplingValues = {};
        samplingKeys.forEach(function (input) {
            if (input.value === '') return;
            const num = Number(input.value);
            samplingValues[input.dataset.samplingKey] = input.step && input.step.indexOf('.') >= 0 ? num : Math.round(num);
        });
        if (Object.keys(samplingValues).length > 0) {
            def.model.params = { protocol: protocol };
            if (protocol === 'openai') def.model.params.openai = samplingValues;
            else if (protocol === 'anthropic') def.model.params.anthropic = samplingValues;
            else if (protocol === 'gemini') def.model.params.gemini = samplingValues;
        }

        if (compactEnabled && compactEnabled.checked) {
            const tokenEl = root.querySelector('[data-compact-field="tokenThreshold"]');
            const floorEl = root.querySelector('[data-compact-field="floorThreshold"]');
            const keepEl = root.querySelector('[data-compact-field="keepLastN"]');
            const abstractTypeEl = root.querySelector('[data-compact-field="abstractType"]');
            const trigger = {};
            if (tokenEl && tokenEl.value) trigger.tokenThreshold = Number(tokenEl.value);
            if (floorEl && floorEl.value) trigger.floorThreshold = Number(floorEl.value);
            if (!trigger.tokenThreshold && !trigger.floorThreshold) {
                if (strict) {
                    showToast('压缩触发条件至少填一项');
                    return null;
                }
            } else {
                const abstract = { type: abstractTypeEl ? abstractTypeEl.value : 'agent' };
                if (abstract.type === 'text') {
                    const contentEl = root.querySelector('[data-compact-field="abstractContent"]');
                    abstract.content = contentEl ? contentEl.value : '';
                } else {
                    const instrEl = root.querySelector('[data-compact-field="abstractInstruction"]');
                    if (instrEl && instrEl.value.trim()) abstract.instruction = instrEl.value.trim();
                }
                def.compact = {
                    trigger: trigger,
                    action: {
                        keepLastN: keepEl ? Number(keepEl.value) || 6 : 6,
                        abstract: abstract,
                    },
                };
            }
        }

        const cards = root.querySelectorAll('.prompt-block-card');
        cards.forEach(function (card) {
            const blockKind = card.dataset.blockKind || 'text';
            const nameField = card.querySelector('[data-block-field="name"]');
            const blockName = nameField ? nameField.value.trim() || 'block' : 'block';
            if (blockKind === 'chat') {
                def.prompts.push({ name: blockName, type: 'chat' });
                return;
            }
            const contentField = card.querySelector('[data-block-field="content"]');
            if (blockKind === 'abstract') {
                def.prompts.push({
                    name: blockName,
                    type: 'abstract',
                    content: contentField ? contentField.value : '',
                });
                return;
            }
            const roleField = card.querySelector('[data-block-field="role"]');
            def.prompts.push({
                name: blockName,
                type: 'text',
                role: roleField ? roleField.value : 'system',
                content: contentField ? contentField.value : '',
            });
        });

        if (def.prompts.length === 0) {
            showToast('至少保留一个 Prompt 块');
            return null;
        }

        return def;
    }

    function saveAgentEditor() {
        const def = collectAgentDefinitionFromForm();
        if (!def || !appState.editingAgentId) return;
        if (!def.name) {
            showToast('请填写 Agent 名称');
            return;
        }
        agentCatalog[appState.editingAgentId].definition = def;
        clearAgentEditorDirty();
        renderAgentList();
        renderAgentEditor(appState.editingAgentId);
        showToast('已保存 Agent 配置');
    }

    function createNewAgent() {
        const id = 'agent-' + Date.now();
        agentCatalog[id] = {
            id: id,
            definition: {
                schemaVersion: 1,
                name: 'new-agent',
                model: { applicationModelId: 'openai/gpt-4o', params: { protocol: 'openai', openai: { temperature: 0.7 } } },
                runtime: { maxSteps: 20 },
                prompts: [
                    { name: 'system', type: 'text', role: 'system', content: '' },
                    { name: 'history', type: 'chat' },
                ],
            },
        };
        renderAgentList();
        openAgentEditor(id);
    }

    function showAgentItemMenu(agentId) {
        const isDefault = appState.defaultAgentId === agentId;
        showBottomSheet(
            [
                { label: '设为默认', action: 'set-default', disabled: isDefault },
                { label: '复制', action: 'duplicate' },
                { label: '删除', action: 'delete', danger: true },
            ].filter(function (item) { return !item.disabled; }),
            function (action) {
                if (action === 'set-default') {
                    appState.defaultAgentId = agentId;
                    renderAgentList();
                    showToast('已设为默认 Agent');
                    return;
                }
                if (action === 'duplicate') {
                    const copyId = 'agent-' + Date.now();
                    agentCatalog[copyId] = { id: copyId, definition: deepClone(agentCatalog[agentId].definition) };
                    agentCatalog[copyId].definition.name += '-copy';
                    renderAgentList();
                    showToast('已复制 Agent');
                    return;
                }
                if (action === 'delete') {
                    if (Object.keys(agentCatalog).length <= 1) {
                        showToast('至少保留一个 Agent');
                        return;
                    }
                    if (appState.defaultAgentId === agentId) {
                        const remaining = Object.keys(agentCatalog).filter(function (k) { return k !== agentId; });
                        appState.defaultAgentId = remaining[0];
                    }
                    delete agentCatalog[agentId];
                    renderAgentList();
                    showToast('已删除 Agent');
                }
            },
        );
    }

    function setupAgentEditor() {
        const root = document.getElementById('agentEditorRoot');
        if (!root) return;

        root.addEventListener('input', function () {
            if (appState.currentPage === 'agentEditor') markAgentEditorDirty();
        });
        root.addEventListener('change', function (e) {
            if (appState.currentPage !== 'agentEditor') return;
            markAgentEditorDirty();

            if (e.target.matches('[data-agent-field="providerId"]')) {
                const providerId = e.target.value;
                const protocol = e.target.selectedOptions[0].dataset.protocol;
                const provider = findProvider(providerId);
                const vendorModelId = provider && provider.models[0] ? provider.models[0].vendorModelId : '';
                const entry = agentCatalog[appState.editingAgentId];
                if (!entry) return;
                const def = collectAgentDefinitionFromForm({ strict: false });
                if (def) {
                    def.model.applicationModelId = buildApplicationModelId(providerId, vendorModelId);
                    def.model.params = { protocol: protocol };
                    if (protocol === 'openai') def.model.params.openai = {};
                    else if (protocol === 'anthropic') def.model.params.anthropic = {};
                    else if (protocol === 'gemini') def.model.params.gemini = {};
                    entry.definition = def;
                }
                renderAgentEditor(appState.editingAgentId);
                markAgentEditorDirty();
                return;
            }

            if (e.target.matches('[data-agent-field="vendorModelId"]')) {
                updateAgentModelIdHint(root);
                return;
            }

            if (e.target.matches('[data-agent-field="compactEnabled"]')) {
                const panel = root.querySelector('[data-compact-panel]');
                if (panel) panel.classList.toggle('hidden', !e.target.checked);
                return;
            }

            if (e.target.matches('[data-compact-field="abstractType"]')) {
                const isAgent = e.target.value === 'agent';
                root.querySelector('.agent-abstract-agent').classList.toggle('hidden', !isAgent);
                root.querySelector('.agent-abstract-text').classList.toggle('hidden', isAgent);
            }
        });

        root.addEventListener('click', function (e) {
            const addBtn = e.target.closest('[data-action="add-prompt-block"]');
            if (addBtn) {
                e.preventDefault();
                const def = collectAgentDefinitionFromForm({ strict: false });
                if (!def) return;
                showBottomSheet(
                    [
                        { label: '文本块 text', action: 'add-text' },
                        { label: '摘要块 abstract', action: 'add-abstract' },
                        { label: '会话块 chat', action: 'add-chat' },
                    ],
                    function (action) {
                        if (action === 'add-text') {
                            def.prompts.push({ name: 'block-' + (def.prompts.length + 1), type: 'text', role: 'system', content: '' });
                        } else if (action === 'add-abstract') {
                            def.prompts.push({
                                name: 'abstract',
                                type: 'abstract',
                                content: '压缩后的内容如下：\n{{.abstract}}',
                            });
                        } else {
                            def.prompts.push({ name: 'history', type: 'chat' });
                        }
                        agentCatalog[appState.editingAgentId].definition = def;
                        renderAgentEditor(appState.editingAgentId);
                        markAgentEditorDirty();
                    },
                );
                return;
            }

            const blockBtn = e.target.closest('[data-block-action]');
            if (blockBtn) {
                e.preventDefault();
                const card = blockBtn.closest('.prompt-block-card');
                const index = Number(card.dataset.blockIndex);
                const def = collectAgentDefinitionFromForm({ strict: false });
                if (!def) return;
                const action = blockBtn.dataset.blockAction;
                if (action === 'delete') {
                    if (def.prompts.length <= 1) {
                        showToast('至少保留一个 Prompt 块');
                        return;
                    }
                    def.prompts.splice(index, 1);
                } else if (action === 'up' && index > 0) {
                    const tmp = def.prompts[index - 1];
                    def.prompts[index - 1] = def.prompts[index];
                    def.prompts[index] = tmp;
                } else if (action === 'down' && index < def.prompts.length - 1) {
                    const tmp = def.prompts[index + 1];
                    def.prompts[index + 1] = def.prompts[index];
                    def.prompts[index] = tmp;
                }
                agentCatalog[appState.editingAgentId].definition = def;
                renderAgentEditor(appState.editingAgentId);
                markAgentEditorDirty();
            }
        });

        const saveBtn = document.querySelector('[data-action="save-agent"]');
        if (saveBtn) saveBtn.addEventListener('click', saveAgentEditor);

        if (elements.backBtn) {
            elements.backBtn.addEventListener(
                'click',
                function (e) {
                    if (appState.currentPage === 'agentEditor' && appState.agentEditorDirty) {
                        if (!confirm('有未保存的更改，确定要离开吗？')) {
                            e.stopImmediatePropagation();
                        }
                    }
                },
                true,
            );
        }
    }

    function setupAgentsAndProviders() {
        renderAgentList();

        const agentList = document.getElementById('agentList');
        if (agentList) {
            agentList.addEventListener('click', function (e) {
                const menuBtn = e.target.closest('[data-agent-menu]');
                if (menuBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    showAgentItemMenu(menuBtn.dataset.agentMenu);
                    return;
                }
                const item = e.target.closest('.agent-item');
                if (item) openAgentEditor(item.dataset.id);
            });
        }

        document.querySelectorAll('.provider-item').forEach(function (item) {
            item.addEventListener('click', function () {
                showToast('编辑服务商配置');
            });
        });
        const newAgentBtn = document.querySelector('[data-action="new-agent"]');
        if (newAgentBtn) newAgentBtn.addEventListener('click', createNewAgent);
        const newProviderBtn = document.querySelector('[data-action="new-provider"]');
        if (newProviderBtn) newProviderBtn.addEventListener('click', function () { showToast('添加服务商'); });
    }

    function init() {
        setupNavigation();
        setupBackButton();
        setupDrawer();
        setupSessionListTabs();
        setupChatTopTabs();
        setupContextChips();
        setupVfsBrowsers();
        setupMenuItems();
        setupCheckpoints();
        setupBottomSheet();
        setupFileEditor();
        setupAgentEditor();
        setupProjectsAndSessions();
        setupAgentsAndProviders();

        navigateToPage('chat');
        if (elements.bannerProjectName) {
            elements.bannerProjectName.textContent = appState.currentProjectName;
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () {
            cacheElements();
            init();
        });
    } else {
        cacheElements();
        init();
    }
})();
