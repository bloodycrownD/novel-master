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
        rollbackInProgress: false,
        globalCompactionPolicy: null,
        /** Workspace current model (mock nm model use); single source for chat + profile. */
        workspaceCurrentModelId: 'zhipu/glm-4.6',
        modelSamplingProfiles: {},
        editingProviderId: null,
        editingModelApplicationModelId: null,
        regexGroups: [],
        regexRules: [],
        workspaceCurrentRegexGroupId: null,
        editingRegexGroupId: null,
        editingRegexRuleId: null,
        regexRuleEditorDirty: false,
    };

    const WORKSPACE_MODEL_STORAGE_KEY = 'nm-mobile-workspace-current-model';
    const MODEL_SAMPLING_STORAGE_KEY = 'nm-mobile-model-sampling-profiles';
    const REGEX_GROUPS_STORAGE_KEY = 'nm-mobile-regex-groups';
    const REGEX_RULES_STORAGE_KEY = 'nm-mobile-regex-rules';
    const WORKSPACE_REGEX_GROUP_STORAGE_KEY = 'nm-mobile-workspace-current-regex-group';
    const THEME_STORAGE_KEY = 'nm-mobile-theme';

    // 主题管理
    function initTheme() {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
        showToast(newTheme === 'dark' ? '已切换到深色模式' : '已切换到浅色模式', 1500);
    }

    function setupThemeToggle() {
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', toggleTheme);
        }
    }

    const pageConfig = {
        chat: { title: '会话', showBack: false, showNav: true },
        agents: { title: 'Agent', showBack: false, showNav: true },
        profile: { title: '我的', showBack: false, showNav: true },
        realPrompt: { title: '真实提示词', showBack: true, showNav: false },
        sessionLog: { title: '会话日志', showBack: true, showNav: false },
        providers: { title: '服务商管理', showBack: true, showNav: false },
        providerDetail: { title: '模型管理', showBack: true, showNav: false },
        modelSampling: { title: '采样配置', showBack: true, showNav: false },
        settings: { title: '扩展设置', showBack: true, showNav: false },
        globalTemplate: { title: '全局模板', showBack: true, showNav: false },
        fileEditor: { title: '编辑文件', showBack: true, showNav: false },
        agentEditor: { title: 'Agent 配置', showBack: true, showNav: false },
        compactionPolicy: { title: '压缩策略', showBack: true, showNav: false },
        regexGroups: { title: '正则配置', showBack: true, showNav: false },
        regexRules: { title: '正则规则', showBack: true, showNav: false },
        regexRuleEditor: { title: '规则详情', showBack: true, showNav: false },
    };

    const elements = {
        pageTitle: null,
        backBtn: null,
        drawerBtn: null,
        drawerOverlay: null,
        projectDrawer: null,
        sessionActionsDrawer: null,
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
        elements.sessionActionsDrawer = document.getElementById('sessionActionsDrawer');
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

        document.querySelectorAll('#sessionList .session-item').forEach(function (el) {
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

        if (pageId !== appState.currentPage) exitBatchMode();

        const currentPageEl = document.getElementById(appState.currentPage + 'Page');
        if (currentPageEl) currentPageEl.classList.remove('active');

        const newPageEl = document.getElementById(pageId + 'Page');
        if (newPageEl) newPageEl.classList.add('active');

        appState.currentPage = pageId;

        if (pageId !== 'chat') closeDrawer();

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
            updateDrawerButton(pageId);
            return;
        }

        if (pageId === 'agentEditor' && appState.editingAgentId) {
            const entry = agentCatalog[appState.editingAgentId];
            elements.pageTitle.textContent = entry ? entry.definition.name : config.title;
            elements.backBtn.classList.toggle('hidden', !config.showBack);
            updateDrawerButton(pageId);
            return;
        }

        if (pageId === 'providerDetail' && appState.editingProviderId) {
            const provider = findProvider(appState.editingProviderId);
            elements.pageTitle.textContent = provider ? provider.name : config.title;
            elements.backBtn.classList.toggle('hidden', !config.showBack);
            updateDrawerButton(pageId);
            return;
        }

        if (pageId === 'modelSampling' && appState.editingModelApplicationModelId) {
            elements.pageTitle.textContent = modelShortLabel(appState.editingModelApplicationModelId);
            elements.backBtn.classList.toggle('hidden', !config.showBack);
            updateDrawerButton(pageId);
            return;
        }

        if (pageId === 'regexRules' && appState.editingRegexGroupId) {
            const group = findRegexGroup(appState.editingRegexGroupId);
            elements.pageTitle.textContent = regexGroupTitle(group);
            elements.backBtn.classList.toggle('hidden', !config.showBack);
            updateDrawerButton(pageId);
            return;
        }

        if (pageId === 'regexRuleEditor') {
            if (appState.editingRegexRuleId) {
                const rule = findRegexRule(appState.editingRegexGroupId, appState.editingRegexRuleId);
                elements.pageTitle.textContent = rule ? rule.name : config.title;
            } else {
                elements.pageTitle.textContent = '新建规则';
            }
            elements.backBtn.classList.toggle('hidden', !config.showBack);
            updateDrawerButton(pageId);
            return;
        }

        elements.pageTitle.textContent = config.title;
        elements.backBtn.classList.toggle('hidden', !config.showBack);
        updateDrawerButton(pageId);
    }

    function updateNavBar(pageId) {
        const config = pageConfig[pageId];
        if (!config || !elements.bottomNav) return;

        elements.bottomNav.style.display = config.showNav ? 'flex' : 'none';

        document.querySelectorAll('.nav-item').forEach(function (item) {
            item.classList.toggle('active', item.dataset.page === pageId);
        });
    }

    function updateDrawerButton(pageId) {
        if (!elements.drawerBtn) return;
        const show = pageId === 'chat';
        elements.drawerBtn.classList.toggle('hidden', !show);
        if (!show) return;
        const inConversation = appState.chatSubview === 'conversation';
        elements.drawerBtn.setAttribute(
            'aria-label',
            inConversation ? '打开会话操作' : '打开项目列表',
        );
    }

    function openProjectDrawer() {
        closeDrawer();
        if (elements.drawerOverlay) {
            elements.drawerOverlay.classList.remove('hidden');
            elements.drawerOverlay.setAttribute('aria-hidden', 'false');
        }
        if (elements.projectDrawer) elements.projectDrawer.classList.add('open');
    }

    function openSessionActionsDrawer() {
        closeDrawer();
        if (elements.drawerOverlay) {
            elements.drawerOverlay.classList.remove('hidden');
            elements.drawerOverlay.setAttribute('aria-hidden', 'false');
        }
        if (elements.sessionActionsDrawer) elements.sessionActionsDrawer.classList.add('open');
        refreshWorkspaceModelDisplays();
    }

    /** 会话列表 → 项目抽屉；聊天中 → 会话操作抽屉（含切换模型、真实提示词、会话日志） */
    function openDrawer() {
        if (appState.currentPage !== 'chat') return;
        if (appState.chatSubview === 'conversation') {
            openSessionActionsDrawer();
        } else {
            openProjectDrawer();
        }
    }

    function closeDrawer() {
        if (batchSelection.activeList === 'projects') exitBatchMode();
        if (elements.drawerOverlay) {
            elements.drawerOverlay.classList.add('hidden');
            elements.drawerOverlay.setAttribute('aria-hidden', 'true');
        }
        if (elements.projectDrawer) elements.projectDrawer.classList.remove('open');
        if (elements.sessionActionsDrawer) elements.sessionActionsDrawer.classList.remove('open');
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

    function setupSessionActionsDrawer() {
        document.querySelectorAll('[data-session-action]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const action = btn.dataset.sessionAction;
                closeDrawer();
                if (action === 'switch-model') openModelPickerModal();
                else if (action === 'real-prompt') navigateToPage('realPrompt', true);
                else if (action === 'session-log') navigateToPage('sessionLog', true);
            });
        });
    }

    function performRollback(checkpointId) {
        if (!checkpointId) return;
        if (appState.rollbackInProgress) {
            showToast('回滚进行中');
            return;
        }
        if (!confirm('确定要回滚到检查点 ' + checkpointId + ' 吗？')) return;
        appState.rollbackInProgress = true;
        showToast('正在回滚...');
        setTimeout(function () {
            appState.rollbackInProgress = false;
            showToast('回滚成功');
        }, 1500);
    }

    function setupSessionLog() {
        const page = document.getElementById('sessionLogPage');
        if (!page) return;

        page.querySelectorAll('.rollback-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                const item = btn.closest('[data-id]');
                const expiredItem = btn.closest('[data-expired="true"]');
                if (expiredItem || btn.disabled) {
                    showToast('检查点已移除');
                    return;
                }
                const checkpointId = item ? item.dataset.id : '';
                performRollback(checkpointId);
            });
        });

        page.querySelectorAll('.checkpoint-link').forEach(function (link) {
            link.addEventListener('click', function (e) {
                e.preventDefault();
                const checkpointId = link.dataset.checkpointId || link.textContent.trim();
                performRollback(checkpointId);
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
                if (action === 'current-model') openModelPickerModal();
                else if (action === 'providers') navigateToPage('providers', true);
                else if (action === 'compaction-policy') {
                    renderCompactionPolicyPage();
                    navigateToPage('compactionPolicy', true);
                } else if (action === 'regex-config') {
                    renderRegexGroupList();
                    navigateToPage('regexGroups', true);
                } else if (action === 'global-template') navigateToPage('globalTemplate', true);
                else if (action === 'settings') navigateToPage('settings', true);
                else if (action === 'debug') showToast('开发调试功能');
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

    function setupListBatchSelection() {
        document.body.addEventListener('click', function (e) {
            if (e.target.closest('.list-batch-check')) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            const manageBtn = e.target.closest('[data-action="batch-manage"]');
            if (manageBtn) {
                enterBatchMode(manageBtn.dataset.batchList);
                return;
            }

            const cancelBtn = e.target.closest('[data-action="batch-cancel"]');
            if (cancelBtn) {
                exitBatchMode();
                return;
            }

            const deleteBtn = e.target.closest('[data-action="batch-delete"]');
            if (deleteBtn && !deleteBtn.disabled) {
                const scope = deleteBtn.dataset.batchList;
                if (scope && scope !== batchSelection.activeList) return;
                executeBatchDelete();
            }
        });

        document.body.addEventListener('change', function (e) {
            const checkbox = e.target.closest('.list-batch-check input[type="checkbox"]');
            if (!checkbox) return;
            const item = checkbox.closest(
                '[data-id], [data-provider-id], [data-vendor-model-id], [data-group-id], [data-rule-id]',
            );
            if (!item || !batchSelection.activeList) return;
            const itemId =
                item.dataset.id ||
                item.dataset.providerId ||
                item.dataset.vendorModelId ||
                item.dataset.groupId ||
                item.dataset.ruleId;
            if (!itemId) return;
            if (checkbox.checked) batchSelection.selectedIds.add(itemId);
            else batchSelection.selectedIds.delete(itemId);
            updateBatchBar();
            batchListConfig[batchSelection.activeList].refresh();
        });
    }

    function handleManagedListItemClick(e, listId, item, normalAction) {
        if (e.target.closest('.list-batch-check')) return true;
        if (isBatchMode(listId)) {
            e.preventDefault();
            const itemId =
                item.dataset.id ||
                item.dataset.providerId ||
                item.dataset.vendorModelId ||
                item.dataset.groupId ||
                item.dataset.ruleId;
            if (!itemId) return true;
            toggleBatchItem(listId, itemId);
            return true;
        }
        if (normalAction) normalAction(item);
        return true;
    }

    function setupProjectsAndSessions() {
        renderProjectList();
        renderSessionList();

        const projectList = document.getElementById('projectList');
        if (projectList) {
            projectList.addEventListener('click', function (e) {
                const item = e.target.closest('.project-item');
                if (!item) return;
                handleManagedListItemClick(e, 'projects', item, function (el) {
                    switchToProject(el.dataset.id, el.dataset.name);
                    closeDrawer();
                    showSessionListView();
                    showToast('已切换到项目：' + el.dataset.name);
                });
            });
        }

        const sessionList = document.getElementById('sessionList');
        if (sessionList) {
            sessionList.addEventListener('click', function (e) {
                const item = e.target.closest('.session-item');
                if (!item) return;
                handleManagedListItemClick(e, 'sessions', item, function (el) {
                    openChatConversation(el.dataset.id, el.dataset.name);
                });
            });
        }

        const newProjectBtn = document.querySelector('[data-action="new-project"]');
        if (newProjectBtn) {
            newProjectBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                openNewProjectModal();
            });
        }

        document.querySelectorAll('[data-action="close-new-project"]').forEach(function (btn) {
            btn.addEventListener('click', closeNewProjectModal);
        });

        const confirmNewProject = document.querySelector('[data-action="confirm-new-project"]');
        if (confirmNewProject) confirmNewProject.addEventListener('click', confirmNewProjectModal);

        const newSessionBtn = document.querySelector('[data-action="new-session"]');
        if (newSessionBtn) {
            newSessionBtn.addEventListener('click', function (e) {
                e.stopPropagation();
                createNewSession();
            });
        }
    }

    /* ----- Agent 配置（对齐 packages/core AgentDefinition） ----- */
    const MOCK_PROVIDERS = [
        {
            id: 'zhipu',
            name: '智谱 AI',
            protocol: 'openai',
            models: [
                { vendorModelId: 'glm-4.6', label: 'GLM-4.6' },
                { vendorModelId: 'glm-4-flash', label: 'GLM-4 Flash' },
                { vendorModelId: 'glm-4-air', label: 'GLM-4 Air' },
            ],
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

    const MOCK_PROJECTS = [
        { id: 'novel-1', name: '科幻小说创作', updatedLabel: '2小时前' },
        { id: 'novel-2', name: '历史小说', updatedLabel: '1天前' },
    ];

    /** @type {Record<string, Array<{ id: string, name: string, meta: string }>>} */
    const MOCK_SESSIONS = {
        'novel-1': [
            { id: 'session-1', name: '第一卷创作', meta: '45条消息 · 活跃中' },
            { id: 'session-2', name: '角色设定讨论', meta: '23条消息 · 2小时前' },
            { id: 'session-3', name: '世界观构建', meta: '67条消息 · 1天前' },
        ],
        'novel-2': [{ id: 'session-4', name: '大纲整理', meta: '12条消息 · 3天前' }],
    };

    const batchSelection = {
        activeList: null,
        selectedIds: new Set(),
    };

    function getProjectSessions(projectId) {
        const pid = projectId || appState.currentProjectId;
        if (!MOCK_SESSIONS[pid]) MOCK_SESSIONS[pid] = [];
        return MOCK_SESSIONS[pid];
    }

    function projectMetaLine(project) {
        const count = getProjectSessions(project.id).length;
        return count + '个会话 · 更新于 ' + project.updatedLabel;
    }

    function projectIconForIndex(index) {
        const icons = ['📚', '📖', '📝', '📂'];
        return icons[index % icons.length];
    }

    function isBatchMode(listId) {
        return batchSelection.activeList === listId;
    }

    function getBatchListCount(listId) {
        if (listId === 'sessions') return getProjectSessions().length;
        if (listId === 'projects') return MOCK_PROJECTS.length;
        if (listId === 'agents') return Object.keys(agentCatalog).length;
        if (listId === 'providers') return MOCK_PROVIDERS.length;
        if (listId === 'providerModels') {
            const provider = findProvider(appState.editingProviderId);
            return provider ? provider.models.length : 0;
        }
        if (listId === 'regexGroups') return appState.regexGroups.length;
        if (listId === 'regexRules') return regexRulesForGroup(appState.editingRegexGroupId).length;
        return 0;
    }

    function renderBatchCheckbox(listId, itemId) {
        if (!isBatchMode(listId)) return '';
        const checked = batchSelection.selectedIds.has(itemId);
        return (
            '<label class="list-batch-check" aria-label="选择">' +
            '<input type="checkbox"' +
            (checked ? ' checked' : '') +
            ' tabindex="-1">' +
            '</label>'
        );
    }

    function listItemSelectedClass(listId, itemId) {
        return isBatchMode(listId) && batchSelection.selectedIds.has(itemId) ? ' list-item--selected' : '';
    }

    function updateBatchBar() {
        const n = batchSelection.selectedIds.size;
        const listId = batchSelection.activeList;

        if (listId) {
            const header = document.querySelector('[data-batch-header="' + listId + '"]');
            if (header) {
                const countEl = header.querySelector('.batch-header-count');
                if (countEl) countEl.textContent = '已选 ' + n + ' 项';
                header.querySelectorAll('[data-action="batch-delete"]').forEach(function (btn) {
                    btn.disabled = n === 0;
                });
            }
        }
    }

    function updateBatchModeUI() {
        const active = batchSelection.activeList;

        document.body.classList.toggle('list-batch-active', !!active);
        if (active) {
            document.body.dataset.batchList = active;
        } else {
            delete document.body.dataset.batchList;
        }

        document.querySelectorAll('[data-batch-header]').forEach(function (wrap) {
            const listId = wrap.dataset.batchHeader;
            const headerConfig = batchListConfig[listId];
            const inlineBatch =
                active === listId &&
                headerConfig &&
                (headerConfig.ui === 'section-header' ||
                    headerConfig.ui === 'drawer-header');
            const normal = wrap.querySelector('.manage-header-normal');
            const batch = wrap.querySelector('.manage-header-batch');
            if (normal) normal.classList.toggle('hidden', inlineBatch);
            if (batch) batch.classList.toggle('hidden', !inlineBatch);
        });

        document.querySelectorAll('[data-batch-hint]').forEach(function (el) {
            el.classList.toggle('hidden', el.dataset.batchHint !== active);
        });

        updateBatchBar();
    }

    function enterBatchMode(listId) {
        if (!batchListConfig[listId]) return;
        if (listId === 'projects') openProjectDrawer();
        batchSelection.activeList = listId;
        batchSelection.selectedIds.clear();
        updateBatchModeUI();
        batchListConfig[listId].refresh();
    }

    function exitBatchMode() {
        const prev = batchSelection.activeList;
        batchSelection.activeList = null;
        batchSelection.selectedIds.clear();
        updateBatchModeUI();
        if (prev && batchListConfig[prev]) batchListConfig[prev].refresh();
    }

    function toggleBatchItem(listId, itemId) {
        if (!isBatchMode(listId)) return;
        if (batchSelection.selectedIds.has(itemId)) {
            batchSelection.selectedIds.delete(itemId);
        } else {
            batchSelection.selectedIds.add(itemId);
        }
        updateBatchBar();
        batchListConfig[listId].refresh();
    }

    function executeBatchDelete() {
        const listId = batchSelection.activeList;
        if (!listId || batchSelection.selectedIds.size === 0) return;
        const config = batchListConfig[listId];
        const ids = Array.from(batchSelection.selectedIds);
        const minKeep = config.minKeep || 0;
        if (getBatchListCount(listId) - ids.length < minKeep) {
            showToast('至少保留 ' + minKeep + ' 项');
            return;
        }
        if (!confirm('确定删除选中的 ' + ids.length + ' 个' + (batchItemLabel[listId] || '项') + '？')) return;
        config.deleteItems(ids);
        exitBatchMode();
        showToast('已删除 ' + ids.length + ' 项');
    }

    function batchDeleteSessions(ids) {
        const idSet = new Set(ids);
        const projectId = appState.currentProjectId;
        MOCK_SESSIONS[projectId] = getProjectSessions(projectId).filter(function (s) {
            return !idSet.has(s.id);
        });
        if (idSet.has(appState.currentSessionId)) {
            const remaining = getProjectSessions(projectId);
            if (remaining.length > 0) {
                openChatConversation(remaining[0].id, remaining[0].name);
            } else {
                appState.currentSessionId = '';
                appState.currentSessionName = '会话';
                showSessionListView();
            }
        }
        renderSessionList();
        renderProjectList();
    }

    function batchDeleteProjects(ids) {
        const idSet = new Set(ids);
        MOCK_PROJECTS.splice(
            0,
            MOCK_PROJECTS.length,
            ...MOCK_PROJECTS.filter(function (p) {
                return !idSet.has(p.id);
            }),
        );
        ids.forEach(function (id) {
            delete MOCK_SESSIONS[id];
        });
        if (idSet.has(appState.currentProjectId)) {
            const next = MOCK_PROJECTS[0];
            if (next) switchToProject(next.id, next.name);
        }
        renderProjectList();
        renderSessionList();
    }

    function batchDeleteAgents(ids) {
        ids.forEach(function (agentId) {
            delete agentCatalog[agentId];
        });
        if (!agentCatalog[appState.defaultAgentId]) {
            appState.defaultAgentId = Object.keys(agentCatalog)[0];
        }
        if (appState.editingAgentId && !agentCatalog[appState.editingAgentId]) {
            appState.editingAgentId = null;
            if (appState.currentPage === 'agentEditor') {
                navigateToPage('agents', false);
            }
        }
        renderAgentList();
    }

    function batchDeleteProviders(ids) {
        const idSet = new Set(ids);
        for (let i = MOCK_PROVIDERS.length - 1; i >= 0; i--) {
            if (!idSet.has(MOCK_PROVIDERS[i].id)) continue;
            MOCK_PROVIDERS[i].models.forEach(function (m) {
                delete appState.modelSamplingProfiles[
                    buildApplicationModelId(MOCK_PROVIDERS[i].id, m.vendorModelId)
                ];
            });
            MOCK_PROVIDERS.splice(i, 1);
        }
        persistModelSamplingProfiles();
        if (appState.editingProviderId && idSet.has(appState.editingProviderId)) {
            appState.editingProviderId = null;
            if (appState.currentPage === 'providerDetail' || appState.currentPage === 'modelSampling') {
                navigateToPage('providers', false);
            }
        }
        renderProviderList();
    }

    function batchDeleteProviderModels(vendorModelIds) {
        const provider = findProvider(appState.editingProviderId);
        if (!provider) return;
        const idSet = new Set(vendorModelIds);
        provider.models = provider.models.filter(function (m) {
            if (idSet.has(m.vendorModelId)) {
                delete appState.modelSamplingProfiles[
                    buildApplicationModelId(provider.id, m.vendorModelId)
                ];
                return false;
            }
            return true;
        });
        persistModelSamplingProfiles();
        if (
            appState.editingModelApplicationModelId &&
            idSet.has(parseApplicationModelId(appState.editingModelApplicationModelId).vendorModelId)
        ) {
            appState.editingModelApplicationModelId = null;
            if (appState.currentPage === 'modelSampling') {
                navigateToPage('providerDetail', false);
            }
        }
        renderProviderDetail();
        renderProviderList();
    }

    const batchItemLabel = {
        sessions: '会话',
        projects: '项目',
        agents: 'Agent',
        providers: '服务商',
        providerModels: '模型',
        regexGroups: '正则组',
        regexRules: '规则',
    };

    const batchListConfig = {
        sessions: {
            ui: 'section-header',
            minKeep: 0,
            refresh: function () {
                renderSessionList();
            },
            deleteItems: batchDeleteSessions,
        },
        projects: {
            ui: 'drawer-header',
            minKeep: 1,
            refresh: function () {
                renderProjectList();
            },
            deleteItems: batchDeleteProjects,
        },
        agents: {
            ui: 'section-header',
            minKeep: 1,
            refresh: function () {
                renderAgentList();
            },
            deleteItems: batchDeleteAgents,
        },
        providers: {
            ui: 'section-header',
            minKeep: 1,
            refresh: function () {
                renderProviderList();
            },
            deleteItems: batchDeleteProviders,
        },
        providerModels: {
            ui: 'section-header',
            minKeep: 0,
            refresh: function () {
                renderProviderDetail();
            },
            deleteItems: batchDeleteProviderModels,
        },
        regexGroups: {
            ui: 'section-header',
            minKeep: 0,
            refresh: function () {
                renderRegexGroupList();
            },
            deleteItems: batchDeleteRegexGroups,
        },
        regexRules: {
            ui: 'section-header',
            minKeep: 0,
            refresh: function () {
                renderRegexRuleList();
            },
            deleteItems: batchDeleteRegexRules,
        },
    };

    function renderProjectList() {
        const host = document.getElementById('projectList');
        if (!host) return;
        let html = '';
        MOCK_PROJECTS.forEach(function (project, index) {
            const isCurrent = appState.currentProjectId === project.id;
            const listId = 'projects';
            html +=
                '<div class="project-item' +
                listItemSelectedClass(listId, project.id) +
                (isCurrent && !isBatchMode(listId) ? ' active' : '') +
                '" data-id="' +
                escapeHtml(project.id) +
                '" data-name="' +
                escapeHtml(project.name) +
                '">';
            html += renderBatchCheckbox(listId, project.id);
            html += '<div class="project-icon">' + projectIconForIndex(index) + '</div>';
            html += '<div class="project-info">';
            html += '<div class="project-name">' + escapeHtml(project.name) + '</div>';
            html += '<div class="project-meta">' + escapeHtml(projectMetaLine(project)) + '</div>';
            html += '</div>';
            if (isCurrent && !isBatchMode(listId)) html += '<span class="current-badge">当前</span>';
            if (!isBatchMode(listId)) html += '<span class="menu-arrow">›</span>';
            html += '</div>';
        });
        host.innerHTML = html;
    }

    function renderSessionList() {
        const host = document.getElementById('sessionList');
        if (!host) return;
        const sessions = getProjectSessions();
        if (sessions.length === 0) {
            host.innerHTML = '<p class="provider-empty-hint">暂无会话，点击「新建会话」开始。</p>';
            return;
        }
        const listId = 'sessions';
        let html = '';
        sessions.forEach(function (session) {
            const isCurrent = appState.currentSessionId === session.id;
            html +=
                '<div class="session-item' +
                listItemSelectedClass(listId, session.id) +
                (isCurrent && !isBatchMode(listId) ? ' active' : '') +
                '" data-id="' +
                escapeHtml(session.id) +
                '" data-name="' +
                escapeHtml(session.name) +
                '">';
            html += renderBatchCheckbox(listId, session.id);
            html += '<div class="session-info">';
            html += '<div class="session-name">' + escapeHtml(session.name) + '</div>';
            html += '<div class="session-meta">' + escapeHtml(session.meta) + '</div>';
            html += '</div>';
            if (isCurrent && !isBatchMode(listId)) html += '<span class="current-badge">当前</span>';
            if (!isBatchMode(listId)) html += '<span class="menu-arrow">›</span>';
            html += '</div>';
        });
        host.innerHTML = html;
    }

    function switchToProject(projectId, projectName) {
        appState.currentProjectId = projectId;
        appState.currentProjectName = projectName;
        renderProjectList();
        renderSessionList();
        if (elements.bannerProjectName) elements.bannerProjectName.textContent = projectName;
    }

    function openNewProjectModal() {
        const modal = document.getElementById('newProjectModal');
        const input = document.getElementById('newProjectName');
        if (!modal) return;
        if (input) input.value = '';
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        if (input) input.focus();
    }

    function closeNewProjectModal() {
        const modal = document.getElementById('newProjectModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
    }

    function confirmNewProjectModal() {
        const input = document.getElementById('newProjectName');
        if (!input) return;
        const name = input.value.trim();
        if (!name) {
            showToast('请填写项目名称');
            return;
        }
        const id = 'novel-' + Date.now();
        MOCK_PROJECTS.push({ id: id, name: name, updatedLabel: '刚刚' });
        MOCK_SESSIONS[id] = [];
        closeNewProjectModal();
        switchToProject(id, name);
        closeDrawer();
        showSessionListView();
        showToast('已创建项目');
    }

    function createNewSession() {
        const sessions = getProjectSessions();
        const id = 'session-' + Date.now();
        const name = '新会话 ' + (sessions.length + 1);
        sessions.push({ id: id, name: name, meta: '0条消息 · 刚刚' });
        renderSessionList();
        renderProjectList();
        openChatConversation(id, name);
        showToast('已创建会话');
    }

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
            runtime: { maxSteps: 20 },
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
            preferredModelId: 'anthropic/claude-3-5-sonnet',
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

    function profileHasSamplingParams(profile) {
        if (!profile || !profile.params) return false;
        const p = profile.params;
        if (p.openai && Object.keys(p.openai).length > 0) return true;
        if (p.anthropic && Object.keys(p.anthropic).length > 0) return true;
        if (p.gemini && Object.keys(p.gemini).length > 0) return true;
        return false;
    }

    function providerModelMetaLine(provider) {
        const n = provider.models.length;
        const samplingN = provider.models.filter(function (m) {
            const id = buildApplicationModelId(provider.id, m.vendorModelId);
            return profileHasSamplingParams(getModelSamplingProfile(id));
        }).length;
        let meta = n + ' 个已保存模型';
        if (samplingN > 0) meta += ' · ' + samplingN + ' 个已配采样';
        return meta;
    }

    function renderProviderList() {
        const host = document.getElementById('providerList');
        if (!host) return;
        const listId = 'providers';
        let html = '';
        MOCK_PROVIDERS.forEach(function (p) {
            html +=
                '<div class="provider-item' +
                listItemSelectedClass(listId, p.id) +
                '" data-provider-id="' +
                p.id +
                '">';
            html += renderBatchCheckbox(listId, p.id);
            html += '<div class="provider-icon">🟢</div>';
            html += '<div class="provider-info">';
            html += '<div class="provider-name">' + escapeHtml(p.name) + '</div>';
            html += '<div class="provider-meta">' + escapeHtml(providerModelMetaLine(p)) + '</div>';
            html += '</div>';
            if (!isBatchMode(listId)) html += '<span class="menu-arrow">›</span>';
            html += '</div>';
        });
        host.innerHTML = html;
    }

    function openProviderDetail(providerId) {
        if (!findProvider(providerId)) return;
        appState.editingProviderId = providerId;
        renderProviderDetail();
        navigateToPage('providerDetail', true);
    }

    function renderProviderDetail() {
        const provider = findProvider(appState.editingProviderId);
        const title = document.getElementById('providerDetailTitle');
        const host = document.getElementById('providerModelList');
        if (!provider || !host) return;
        if (title) title.textContent = provider.name;
        if (provider.models.length === 0) {
            host.innerHTML =
                '<p class="provider-empty-hint">暂无已保存模型，点击「添加模型」登记 vendorModelId。</p>';
            return;
        }
        let html = '';
        const listId = 'providerModels';
        provider.models.forEach(function (m) {
            const applicationModelId = buildApplicationModelId(provider.id, m.vendorModelId);
            const profile = getModelSamplingProfile(applicationModelId);
            html +=
                '<div class="provider-model-item' +
                listItemSelectedClass(listId, m.vendorModelId) +
                '" data-vendor-model-id="' +
                escapeHtml(m.vendorModelId) +
                '">';
            html += renderBatchCheckbox(listId, m.vendorModelId);
            html += '<div class="provider-model-info">';
            html += '<div class="provider-model-name">' + escapeHtml(m.label) + '</div>';
            html += '<div class="provider-model-meta">' + escapeHtml(applicationModelId);
            if (profileHasSamplingParams(profile)) html += ' · 已配采样';
            html += '</div></div>';
            if (!isBatchMode(listId)) {
                html += '<button type="button" class="agent-menu-btn" data-provider-model-menu="' +
                    escapeHtml(m.vendorModelId) +
                    '" aria-label="更多">⋮</button>';
                html += '<span class="menu-arrow">›</span>';
            }
            html += '</div>';
        });
        host.innerHTML = html;
    }

    function openModelSamplingPage(vendorModelId) {
        const provider = findProvider(appState.editingProviderId);
        if (!provider) return;
        appState.editingModelApplicationModelId = buildApplicationModelId(provider.id, vendorModelId);
        renderModelSamplingPage();
        navigateToPage('modelSampling', true);
    }

    function renderModelSamplingPage() {
        const root = document.getElementById('modelSamplingRoot');
        const applicationModelId = appState.editingModelApplicationModelId;
        if (!root || !applicationModelId) return;
        const profile = getModelSamplingProfile(applicationModelId);
        const protocol = modelProtocolForId(applicationModelId);
        let html = '<section class="agent-form-section">';
        html += '<h3>采样参数</h3>';
        html += '<p class="agent-field-hint model-sampling-id">' + escapeHtml(applicationModelId) + '</p>';
        html += renderSamplingFields(protocol, profile.params);
        html += '<p class="agent-field-hint">留空表示使用协议默认参数。</p>';
        html += '</section>';
        root.innerHTML = html;
    }

    function collectSamplingParamsFromRoot(root, protocol) {
        if (!root) return null;
        const samplingValues = {};
        root.querySelectorAll('[data-sampling-key]').forEach(function (input) {
            if (input.value === '') return;
            const num = Number(input.value);
            samplingValues[input.dataset.samplingKey] =
                input.step && input.step.indexOf('.') >= 0 ? num : Math.round(num);
        });
        if (Object.keys(samplingValues).length === 0) return null;
        const params = { protocol: protocol };
        if (protocol === 'openai') params.openai = samplingValues;
        else if (protocol === 'anthropic') params.anthropic = samplingValues;
        else if (protocol === 'gemini') params.gemini = samplingValues;
        return params;
    }

    function saveModelSamplingPage() {
        const applicationModelId = appState.editingModelApplicationModelId;
        const root = document.getElementById('modelSamplingRoot');
        if (!applicationModelId || !root) return;
        const protocol = modelProtocolForId(applicationModelId);
        const params = collectSamplingParamsFromRoot(root, protocol);
        if (params == null) {
            delete appState.modelSamplingProfiles[applicationModelId];
        } else {
            setModelSamplingProfile(applicationModelId, { enabled: true, params: params });
        }
        persistModelSamplingProfiles();
        renderProviderDetail();
        renderProviderList();
        showToast('已保存采样配置');
        if (appState.pageStack.length > 0) {
            const previousPage = appState.pageStack.pop();
            navigateToPage(previousPage, false);
        }
    }

    function showProviderModelMenu(vendorModelId) {
        const provider = findProvider(appState.editingProviderId);
        if (!provider) return;
        const model = provider.models.find(function (m) { return m.vendorModelId === vendorModelId; });
        if (!model) return;
        const applicationModelId = buildApplicationModelId(provider.id, vendorModelId);
        showBottomSheet([{ label: '删除模型', action: 'delete-model', danger: true }], function (action) {
            if (action === 'delete-model') {
                if (!confirm('确定删除已保存模型 ' + applicationModelId + '？')) return;
                provider.models = provider.models.filter(function (m) {
                    return m.vendorModelId !== vendorModelId;
                });
                delete appState.modelSamplingProfiles[applicationModelId];
                persistModelSamplingProfiles();
                renderProviderDetail();
                renderProviderList();
                showToast('已删除模型');
            }
        });
    }

    function openAddModelModal() {
        const modal = document.getElementById('addModelModal');
        const vendorInput = document.getElementById('addModelVendorId');
        const labelInput = document.getElementById('addModelLabel');
        if (vendorInput) vendorInput.value = '';
        if (labelInput) labelInput.value = '';
        if (modal) {
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
        }
    }

    function closeAddModelModal() {
        const modal = document.getElementById('addModelModal');
        if (modal) {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        }
    }

    function confirmAddModelModal() {
        const provider = findProvider(appState.editingProviderId);
        const vendorInput = document.getElementById('addModelVendorId');
        const labelInput = document.getElementById('addModelLabel');
        if (!provider || !vendorInput) return;
        const vendorModelId = vendorInput.value.trim();
        if (!vendorModelId) {
            showToast('请填写厂商模型 ID');
            return;
        }
        if (provider.models.some(function (m) { return m.vendorModelId === vendorModelId; })) {
            showToast('该模型已存在');
            return;
        }
        const label = labelInput && labelInput.value.trim() ? labelInput.value.trim() : vendorModelId;
        provider.models.push({ vendorModelId: vendorModelId, label: label });
        closeAddModelModal();
        renderProviderDetail();
        renderProviderList();
        showToast('已添加模型');
    }

    function loadWorkspaceModel() {
        try {
            const stored = localStorage.getItem(WORKSPACE_MODEL_STORAGE_KEY);
            if (stored) appState.workspaceCurrentModelId = stored;
        } catch (_e) { /* file:// may block storage */ }
        try {
            const raw = localStorage.getItem(MODEL_SAMPLING_STORAGE_KEY);
            if (raw) appState.modelSamplingProfiles = JSON.parse(raw);
        } catch (_e) { /* ignore */ }
    }

    function persistModelSamplingProfiles() {
        try {
            localStorage.setItem(MODEL_SAMPLING_STORAGE_KEY, JSON.stringify(appState.modelSamplingProfiles));
        } catch (_e) { /* ignore */ }
    }

    function setWorkspaceModel(applicationModelId) {
        appState.workspaceCurrentModelId = applicationModelId;
        try {
            localStorage.setItem(WORKSPACE_MODEL_STORAGE_KEY, applicationModelId);
        } catch (_e) { /* ignore */ }
        refreshWorkspaceModelDisplays();
    }

    function refreshWorkspaceModelDisplays() {
        const label = modelShortLabel(appState.workspaceCurrentModelId);
        const sessionDrawerEl = document.getElementById('sessionDrawerCurrentModelLabel');
        if (sessionDrawerEl) sessionDrawerEl.textContent = label;
        const profileEl = document.getElementById('profileCurrentModelLabel');
        if (profileEl) profileEl.textContent = label;
        updateChatAgentMeta();
    }

    function getModelSamplingProfile(applicationModelId) {
        return appState.modelSamplingProfiles[applicationModelId] || { enabled: false, params: null };
    }

    function setModelSamplingProfile(applicationModelId, profile) {
        appState.modelSamplingProfiles[applicationModelId] = profile;
        persistModelSamplingProfiles();
    }

    function populateModelPickerSelects(providerId, vendorModelId) {
        const providerSelect = document.getElementById('modelPickerProviderId');
        const vendorSelect = document.getElementById('modelPickerVendorModelId');
        if (!providerSelect || !vendorSelect) return;

        providerSelect.innerHTML = MOCK_PROVIDERS.map(function (p) {
            return (
                '<option value="' +
                p.id +
                '"' +
                (p.id === providerId ? ' selected' : '') +
                '>' +
                escapeHtml(p.name) +
                '</option>'
            );
        }).join('');

        vendorSelect.innerHTML = renderModelSelectOptions(providerId, vendorModelId);
    }

    function openModelPickerModal() {
        const modal = document.getElementById('modelPickerModal');
        if (!modal) return;
        const current = resolveModelSelection(appState.workspaceCurrentModelId);
        populateModelPickerSelects(current.providerId, current.vendorModelId);
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
    }

    function confirmModelPickerModal() {
        const providerSelect = document.getElementById('modelPickerProviderId');
        const vendorSelect = document.getElementById('modelPickerVendorModelId');
        if (!providerSelect || !vendorSelect) return;
        setWorkspaceModel(buildApplicationModelId(providerSelect.value, vendorSelect.value));
        closeModelPickerModal();
        showToast('已切换工作区模型');
    }

    function closeModelPickerModal() {
        const modal = document.getElementById('modelPickerModal');
        if (!modal) return;
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
    }

    function agentListMeta(def) {
        const parts = [];
        if (def.preferredModelId) parts.push('默认模型 ' + def.preferredModelId);
        if (def.runtime && def.runtime.maxSteps) parts.push('最大 ' + def.runtime.maxSteps + ' 步');
        else parts.push('最大 20 步');
        return parts.join(' · ');
    }

    function definitionToYamlPreview(def) {
        const doc = {
            schemaVersion: 1,
            name: def.name,
            runtime: def.runtime,
            prompts: { blocks: def.prompts },
        };
        if (def.preferredModelId) doc.preferredModelId = def.preferredModelId;
        if (!doc.runtime) delete doc.runtime;
        return JSON.stringify(doc, null, 2)
            .replace(/"([^"]+)":/g, '$1:')
            .replace(/"/g, "'");
    }

    function renderAgentList() {
        const host = document.getElementById('agentList');
        if (!host) return;
        const listId = 'agents';
        let html = '';
        Object.keys(agentCatalog).forEach(function (id) {
            const entry = agentCatalog[id];
            const def = entry.definition;
            const isDefault = appState.defaultAgentId === id;
            html +=
                '<div class="agent-item' +
                listItemSelectedClass(listId, id) +
                '" data-id="' +
                id +
                '">';
            html += renderBatchCheckbox(listId, id);
            html += '<div class="agent-info">';
            html += '<div class="agent-name">' + def.name + '</div>';
            html += '<div class="agent-meta">' + agentListMeta(def) + '</div>';
            html += '</div>';
            if (isDefault && !isBatchMode(listId)) html += '<span class="default-badge">默认</span>';
            if (!isBatchMode(listId)) {
                html += '<button type="button" class="agent-menu-btn" data-agent-menu="' +
                    id +
                    '" aria-label="更多">⋮</button>';
            }
            html += '</div>';
        });
        host.innerHTML = html;
        updateChatAgentMeta();
    }

    function resolveDisplayModelIdForAgent(def) {
        if (def.preferredModelId) return def.preferredModelId;
        return appState.workspaceCurrentModelId;
    }

    function updateChatAgentMeta() {
        const entry = agentCatalog[appState.defaultAgentId];
        if (!entry) return;
        const def = entry.definition;
        const agentEl = document.querySelector('.chat-meta .agent-name');
        const modelEl = document.querySelector('.chat-meta .model-name');
        if (agentEl) agentEl.textContent = def.name;
        if (modelEl) {
            const modelId = resolveDisplayModelIdForAgent(def);
            const suffix = def.preferredModelId ? '' : ' · 工作区';
            modelEl.textContent = modelShortLabel(modelId) + suffix;
        }
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
        let html = '';

        html += '<section class="agent-form-section"><h3>基本信息</h3>';
        html += '<label class="agent-field"><span>名称</span><input type="text" data-agent-field="name" value="' + escapeHtml(def.name) + '"></label>';
        html += '</section>';

        const modelEnabled = !!def.preferredModelId;
        const modelSel = modelEnabled
            ? resolveModelSelection(def.preferredModelId)
            : resolveModelSelection(appState.workspaceCurrentModelId);
        html +=
            '<section class="agent-form-section agent-model-section' +
            (modelEnabled ? ' agent-model-section--enabled' : '') +
            '" data-agent-model-section>';
        html += '<div class="agent-section-header">';
        html += '<h3>模型</h3>';
        html += '<label class="agent-model-switch">';
        html += '<span class="agent-model-switch-label">专属模型</span>';
        html +=
            '<input type="checkbox" class="toggle" data-agent-field="modelEnabled"' +
            (modelEnabled ? ' checked' : '') +
            ' aria-label="启用 Agent 专属模型">';
        html += '</label></div>';
        html +=
            '<p class="agent-field-hint agent-model-hint-off' +
            (modelEnabled ? ' hidden' : '') +
            '">未启用时跟随工作区当前模型（会话操作抽屉 / 我的）。</p>';
        html += '<div class="agent-model-pickers' + (modelEnabled ? '' : ' hidden') + '" data-agent-model-pickers>';
        html += '<label class="agent-field"><span>服务商</span><select data-agent-field="providerId">';
        MOCK_PROVIDERS.forEach(function (p) {
            html +=
                '<option value="' +
                p.id +
                '"' +
                (p.id === modelSel.providerId ? ' selected' : '') +
                '>' +
                escapeHtml(p.name) +
                '</option>';
        });
        html += '</select></label>';
        html += '<label class="agent-field"><span>模型</span><select data-agent-field="vendorModelId" data-agent-vendor-select>';
        html += renderModelSelectOptions(modelSel.providerId, modelSel.vendorModelId);
        html += '</select></label>';
        html +=
            '<p class="agent-field-hint">preferredModelId: <code data-agent-model-id-hint>' +
            escapeHtml(modelEnabled ? def.preferredModelId : '—') +
            '</code></p>';
        html += '<p class="agent-field-hint">温度等采样在服务商-模型配置中设置，此处仅选模型。</p>';
        html += '</div></section>';

        html += '<section class="agent-form-section"><h3>运行时</h3>';
        html += '<label class="agent-field"><span>最大步数 maxSteps</span><input type="number" data-agent-field="maxSteps" min="1" step="1" value="' + (def.runtime && def.runtime.maxSteps != null ? def.runtime.maxSteps : 20) + '"></label>';
        html += '<p class="agent-field-hint">每轮 run 的模型往返上限；省略时 Core 默认 20。</p>';
        html += '</section>';

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
        const maxStepsInput = root.querySelector('[data-agent-field="maxSteps"]');

        const def = {
            schemaVersion: 1,
            name: nameInput ? nameInput.value.trim() : entry.definition.name,
            prompts: [],
        };

        if (maxStepsInput && maxStepsInput.value) {
            def.runtime = { maxSteps: Number(maxStepsInput.value) };
        }

        const modelEnabledInput = root.querySelector('[data-agent-field="modelEnabled"]');
        const pickers = root.querySelector('[data-agent-model-pickers]');
        if (modelEnabledInput && modelEnabledInput.checked) {
            const providerSelect = root.querySelector('[data-agent-field="providerId"]');
            const vendorSelect = root.querySelector('[data-agent-field="vendorModelId"]');
            if (providerSelect && vendorSelect) {
                def.preferredModelId = buildApplicationModelId(
                    providerSelect.value,
                    vendorSelect.value,
                );
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

    function defaultGlobalCompactionPolicy() {
        return {
            schemaVersion: 1,
            enabled: true,
            trigger: { tokenThreshold: 12000, floorThreshold: 20 },
            action: {
                keepLastN: 6,
                abstract: {
                    type: 'agent',
                    agentId: 'agent-writer',
                    instruction: 'Summarize the following conversation history concisely:',
                },
            },
        };
    }

    function renderCompactionAgentOptions(selectedId) {
        return Object.keys(agentCatalog)
            .map(function (id) {
                const def = agentCatalog[id].definition;
                return (
                    '<option value="' +
                    id +
                    '"' +
                    (id === selectedId ? ' selected' : '') +
                    '>' +
                    escapeHtml(def.name + ' (' + id + ')') +
                    '</option>'
                );
            })
            .join('');
    }

    function renderCompactionPolicyPage() {
        const root = document.getElementById('compactionPolicyRoot');
        if (!root) return;
        if (!appState.globalCompactionPolicy) {
            appState.globalCompactionPolicy = defaultGlobalCompactionPolicy();
        }
        const policy = appState.globalCompactionPolicy;
        const trigger = policy.trigger || {};
        const action = policy.action || { keepLastN: 6, abstract: { type: 'agent', agentId: 'agent-writer' } };
        const abstract = action.abstract || { type: 'agent', agentId: 'agent-writer' };
        const abstractType = abstract.type || 'agent';

        let html = '';
        html += '<section class="agent-form-section"><h3>全局压缩策略</h3>';
        html += '<label class="agent-field agent-field--row"><span>启用压缩</span><input type="checkbox" class="toggle" data-policy-field="enabled"' + (policy.enabled ? ' checked' : '') + '></label>';
        html += '<div class="compaction-policy-panel' + (policy.enabled ? '' : ' hidden') + '" data-policy-panel>';
        html += '<p class="agent-field-hint">全应用单条策略；触发条件为 OR（token 估计或消息条数）。</p>';
        html += '<label class="agent-field"><span>Token 阈值</span><input type="number" data-policy-field="tokenThreshold" min="1" step="1" value="' + (trigger.tokenThreshold || '') + '" placeholder="如 12000"></label>';
        html += '<label class="agent-field"><span>消息条数阈值</span><input type="number" data-policy-field="floorThreshold" min="1" step="1" value="' + (trigger.floorThreshold || '') + '" placeholder="如 20"></label>';
        html += '<label class="agent-field"><span>保留最近 N 条</span><input type="number" data-policy-field="keepLastN" min="1" step="1" value="' + (action.keepLastN || 6) + '"></label>';
        html += '<label class="agent-field"><span>摘要方式</span><select data-policy-field="abstractType">';
        html += '<option value="agent"' + (abstractType === 'agent' ? ' selected' : '') + '>Agent 生成</option>';
        html += '<option value="text"' + (abstractType === 'text' ? ' selected' : '') + '>静态文本</option>';
        html += '</select></label>';
        html += '<label class="agent-field agent-abstract-agent' + (abstractType === 'agent' ? '' : ' hidden') + '"><span>摘要 Agent</span><select class="compaction-agent-select" data-policy-field="agentId">';
        html += renderCompactionAgentOptions(abstract.type === 'agent' ? abstract.agentId : 'agent-writer');
        html += '</select></label>';
        html += '<label class="agent-field agent-abstract-agent' + (abstractType === 'agent' ? '' : ' hidden') + '"><span>摘要指令 instruction</span><textarea data-policy-field="abstractInstruction" rows="2" placeholder="Summarize the following conversation history concisely:">' + escapeHtml(abstract.type === 'agent' && abstract.instruction ? abstract.instruction : '') + '</textarea></label>';
        html += '<label class="agent-field agent-abstract-text' + (abstractType === 'text' ? '' : ' hidden') + '"><span>摘要模板 content</span><textarea data-policy-field="abstractContent" rows="3" placeholder="支持宏">' + escapeHtml(abstract.type === 'text' && abstract.content ? abstract.content : '') + '</textarea></label>';
        html += '</div></section>';
        root.innerHTML = html;
    }

    function collectCompactionPolicyFromForm() {
        const root = document.getElementById('compactionPolicyRoot');
        if (!root) return null;
        const enabledEl = root.querySelector('[data-policy-field="enabled"]');
        const enabled = enabledEl ? enabledEl.checked : false;
        const trigger = {};
        const tokenEl = root.querySelector('[data-policy-field="tokenThreshold"]');
        const floorEl = root.querySelector('[data-policy-field="floorThreshold"]');
        if (tokenEl && tokenEl.value) trigger.tokenThreshold = Number(tokenEl.value);
        if (floorEl && floorEl.value) trigger.floorThreshold = Number(floorEl.value);
        if (enabled && !trigger.tokenThreshold && !trigger.floorThreshold) {
            showToast('压缩触发条件至少填一项');
            return null;
        }
        const keepEl = root.querySelector('[data-policy-field="keepLastN"]');
        const abstractTypeEl = root.querySelector('[data-policy-field="abstractType"]');
        const abstractType = abstractTypeEl ? abstractTypeEl.value : 'agent';
        const abstract = { type: abstractType };
        if (abstractType === 'text') {
            const contentEl = root.querySelector('[data-policy-field="abstractContent"]');
            abstract.content = contentEl ? contentEl.value : '';
        } else {
            const agentIdEl = root.querySelector('[data-policy-field="agentId"]');
            abstract.agentId = agentIdEl ? agentIdEl.value : 'agent-writer';
            const instrEl = root.querySelector('[data-policy-field="abstractInstruction"]');
            if (instrEl && instrEl.value.trim()) abstract.instruction = instrEl.value.trim();
        }
        return {
            schemaVersion: 1,
            enabled: enabled,
            trigger: trigger,
            action: {
                keepLastN: keepEl ? Number(keepEl.value) || 6 : 6,
                abstract: abstract,
            },
        };
    }

    function saveCompactionPolicy() {
        const policy = collectCompactionPolicyFromForm();
        if (!policy) return;
        appState.globalCompactionPolicy = policy;
        showToast('已保存全局压缩策略');
    }

    function setupCompactionPolicyPage() {
        const root = document.getElementById('compactionPolicyRoot');
        if (!root) return;
        root.addEventListener('change', function (e) {
            if (e.target.matches('[data-policy-field="enabled"]')) {
                const panel = root.querySelector('[data-policy-panel]');
                if (panel) panel.classList.toggle('hidden', !e.target.checked);
                return;
            }
            if (e.target.matches('[data-policy-field="abstractType"]')) {
                const isAgent = e.target.value === 'agent';
                root.querySelectorAll('.agent-abstract-agent').forEach(function (el) {
                    el.classList.toggle('hidden', !isAgent);
                });
                const textEl = root.querySelector('.agent-abstract-text');
                if (textEl) textEl.classList.toggle('hidden', isAgent);
            }
        });
        const saveBtn = document.querySelector('[data-action="save-compaction-policy"]');
        if (saveBtn) saveBtn.addEventListener('click', saveCompactionPolicy);
    }

    function setupAgentEditor() {
        const root = document.getElementById('agentEditorRoot');
        if (!root) return;

        root.addEventListener('input', function () {
            if (appState.currentPage === 'agentEditor') markAgentEditorDirty();
        });
        root.addEventListener('change', function (e) {
            if (appState.currentPage !== 'agentEditor') return;
            if (e.target.matches('[data-agent-field="modelEnabled"]')) {
                const enabled = e.target.checked;
                const section = root.querySelector('[data-agent-model-section]');
                const pickers = root.querySelector('[data-agent-model-pickers]');
                const hintOff = root.querySelector('.agent-model-hint-off');
                if (section) section.classList.toggle('agent-model-section--enabled', enabled);
                if (pickers) pickers.classList.toggle('hidden', !enabled);
                if (hintOff) hintOff.classList.toggle('hidden', enabled);
                const hint = root.querySelector('[data-agent-model-id-hint]');
                if (hint) {
                    if (!enabled) hint.textContent = '—';
                    else updateAgentModelIdHint(root);
                }
            }
            if (e.target.matches('[data-agent-field="providerId"]')) {
                const vendorSelect = root.querySelector('[data-agent-vendor-select]');
                if (vendorSelect) {
                    vendorSelect.innerHTML = renderModelSelectOptions(e.target.value, null);
                }
                updateAgentModelIdHint(root);
            }
            if (e.target.matches('[data-agent-field="vendorModelId"]')) {
                updateAgentModelIdHint(root);
            }
            markAgentEditorDirty();
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

    function setupProviders() {
        renderProviderList();

        const providerList = document.getElementById('providerList');
        if (providerList) {
            providerList.addEventListener('click', function (e) {
                const item = e.target.closest('[data-provider-id]');
                if (!item) return;
                handleManagedListItemClick(e, 'providers', item, function (el) {
                    openProviderDetail(el.dataset.providerId);
                });
            });
        }

        const modelList = document.getElementById('providerModelList');
        if (modelList) {
            modelList.addEventListener('click', function (e) {
                const menuBtn = e.target.closest('[data-provider-model-menu]');
                if (menuBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    showProviderModelMenu(menuBtn.dataset.providerModelMenu);
                    return;
                }
                const item = e.target.closest('.provider-model-item');
                if (!item || !item.dataset.vendorModelId) return;
                handleManagedListItemClick(e, 'providerModels', item, function (el) {
                    openModelSamplingPage(el.dataset.vendorModelId);
                });
            });
        }

        const addModelBtn = document.querySelector('[data-action="add-provider-model"]');
        if (addModelBtn) addModelBtn.addEventListener('click', openAddModelModal);

        const newProviderBtn = document.querySelector('[data-action="new-provider"]');
        if (newProviderBtn) {
            newProviderBtn.addEventListener('click', function () {
                showToast('添加服务商（原型未实现）');
            });
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
                if (item) {
                    handleManagedListItemClick(e, 'agents', item, function (el) {
                        openAgentEditor(el.dataset.id);
                    });
                }
            });
        }

        setupProviders();
        const newAgentBtn = document.querySelector('[data-action="new-agent"]');
        if (newAgentBtn) newAgentBtn.addEventListener('click', createNewAgent);
    }

    function setupWorkspaceModel() {
        loadWorkspaceModel();
        refreshWorkspaceModelDisplays();
        const providerSelect = document.getElementById('modelPickerProviderId');
        if (providerSelect) {
            providerSelect.addEventListener('change', function () {
                const vendorSelect = document.getElementById('modelPickerVendorModelId');
                if (vendorSelect) {
                    vendorSelect.innerHTML = renderModelSelectOptions(providerSelect.value, null);
                }
            });
        }
        const confirmPicker = document.querySelector('[data-action="confirm-model-picker"]');
        if (confirmPicker) confirmPicker.addEventListener('click', confirmModelPickerModal);
        document.querySelectorAll('[data-action="close-model-picker"]').forEach(function (btn) {
            btn.addEventListener('click', closeModelPickerModal);
        });
        const saveSampling = document.querySelector('[data-action="save-model-sampling"]');
        if (saveSampling) saveSampling.addEventListener('click', saveModelSamplingPage);
        document.querySelectorAll('[data-action="close-add-model"]').forEach(function (btn) {
            btn.addEventListener('click', closeAddModelModal);
        });
        const confirmAddModel = document.querySelector('[data-action="confirm-add-model"]');
        if (confirmAddModel) confirmAddModel.addEventListener('click', confirmAddModelModal);
    }

    // --- Regex mock engine (align packages/core domain/regex) ---
    // Ref: apply-regex-rules.ts, validate-regex-rule.ts, compile-regex-rule.ts

    function regexRoleMatchesScope(role, rule) {
        if (role === 'user') return rule.scopeUser;
        if (role === 'assistant') return rule.scopeAssistant;
        return false;
    }

    function regexDepthInRange(floor, rule) {
        return floor >= rule.minDepth && floor <= rule.maxDepth;
    }

    /** Channel without configured replace keeps source text (Core replaceForChannel). */
    function regexReplaceForChannel(text, rule, channel) {
        const replacement = channel === 'llm' ? rule.llmReplace : rule.displayReplace;
        if (replacement == null) return text;
        return text.replace(rule.pattern, replacement);
    }

    /** Sequential apply; skip rules outside role/depth (Core applyRegexRules). */
    function applyRegexRules(text, rules, ctx) {
        let out = text;
        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i];
            if (!regexRoleMatchesScope(ctx.role, rule)) continue;
            if (!regexDepthInRange(ctx.floor, rule)) continue;
            out = regexReplaceForChannel(out, rule, ctx.channel);
        }
        return out;
    }

    /** Browser-friendly validation; mirrors validate-regex-rule.ts (no RegexError throw). */
    function validateRegexRuleFields(fields) {
        const hasLlm = fields.llmReplace != null && fields.llmReplace !== '';
        const hasDisplay = fields.displayReplace != null && fields.displayReplace !== '';
        if (!hasLlm && !hasDisplay) {
            return { ok: false, message: '至少配置 llmReplace 或 displayReplace 之一' };
        }
        if (!fields.scopeUser && !fields.scopeAssistant) {
            return { ok: false, message: '至少选择 user 或 assistant 作用范围之一' };
        }
        if (fields.minDepth > fields.maxDepth) {
            return {
                ok: false,
                message:
                    'minDepth (' + fields.minDepth + ') 必须 <= maxDepth (' + fields.maxDepth + ')',
            };
        }
        try {
            // eslint-disable-next-line no-new
            new RegExp(fields.pattern, fields.flags || '');
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            return { ok: false, message: '无效的正则表达式: ' + msg };
        }
        return { ok: true };
    }

    function compileRegexRuleDraft(fields) {
        const validation = validateRegexRuleFields(fields);
        if (!validation.ok) return { ok: false, message: validation.message };
        try {
            const pattern = new RegExp(fields.pattern, fields.flags || '');
            return {
                ok: true,
                compiled: {
                    pattern: pattern,
                    llmReplace: fields.llmReplace,
                    displayReplace: fields.displayReplace,
                    minDepth: fields.minDepth,
                    maxDepth: fields.maxDepth,
                    scopeUser: fields.scopeUser,
                    scopeAssistant: fields.scopeAssistant,
                },
            };
        } catch (e) {
            const msg = e && e.message ? e.message : String(e);
            return { ok: false, message: '无效的正则表达式: ' + msg };
        }
    }

    /** Single-rule test (nm regex test); disabled rule returns source unchanged. */
    function previewRegexRule(text, draftFields, ctx) {
        if (!draftFields.enabled) return { ok: true, text: text };
        const compiled = compileRegexRuleDraft(draftFields);
        if (!compiled.ok) return { ok: false, message: compiled.message };
        return { ok: true, text: applyRegexRules(text, [compiled.compiled], ctx) };
    }

    function nowMs() {
        return Date.now();
    }

    function slugifyRegexId(name) {
        return String(name)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'rule';
    }

    function findRegexGroup(groupId) {
        return appState.regexGroups.find(function (g) {
            return g.groupId === groupId;
        });
    }

    function regexRulesForGroup(groupId) {
        return appState.regexRules.filter(function (r) {
            return r.groupId === groupId;
        });
    }

    function findRegexRule(groupId, ruleId) {
        return appState.regexRules.find(function (r) {
            return r.groupId === groupId && r.ruleId === ruleId;
        });
    }

    function regexGroupTitle(group) {
        if (!group) return '正则组';
        if (group.displayName) return group.displayName;
        return group.groupId;
    }

    function regexGroupMetaLine(groupId) {
        const n = regexRulesForGroup(groupId).length;
        return n + ' 条规则';
    }

    function regexRuleScopeLabel(rule) {
        const parts = [];
        if (rule.scopeUser) parts.push('user');
        if (rule.scopeAssistant) parts.push('assistant');
        return parts.join('/') || '—';
    }

    function regexRuleMetaLine(rule) {
        const depth = '层数 ' + rule.minDepth + '–' + rule.maxDepth;
        const scope = regexRuleScopeLabel(rule);
        const enabled = rule.enabled ? '启用' : '禁用';
        return depth + ' · ' + scope + ' · ' + enabled;
    }

    function ensureDefaultRegexSeed() {
        try {
            if (localStorage.getItem(REGEX_GROUPS_STORAGE_KEY) != null) return;
        } catch (_e) {
            return;
        }
        const t = nowMs();
        appState.regexGroups = [
            { groupId: 'strict-filter', displayName: '严格脱敏', createdAtMs: t, updatedAtMs: t },
            { groupId: 'llm-only', displayName: '仅提示词', createdAtMs: t, updatedAtMs: t },
        ];
        appState.regexRules = [
            {
                groupId: 'strict-filter',
                ruleId: 'mask-email',
                sortOrder: 1,
                name: 'mask-email',
                pattern: '[\\w.-]+@[\\w.-]+\\.[A-Za-z]{2,}',
                flags: '',
                enabled: true,
                llmReplace: '[redacted]',
                displayReplace: '***',
                minDepth: 1,
                maxDepth: 99,
                scopeUser: true,
                scopeAssistant: true,
                createdAtMs: t,
                updatedAtMs: t,
            },
        ];
        appState.workspaceCurrentRegexGroupId = 'strict-filter';
        persistRegexStore();
        persistWorkspaceRegexGroup();
    }

    function loadRegexStore() {
        ensureDefaultRegexSeed();
        try {
            const groupsRaw = localStorage.getItem(REGEX_GROUPS_STORAGE_KEY);
            if (groupsRaw) appState.regexGroups = JSON.parse(groupsRaw);
            const rulesRaw = localStorage.getItem(REGEX_RULES_STORAGE_KEY);
            if (rulesRaw) appState.regexRules = JSON.parse(rulesRaw);
            const current = localStorage.getItem(WORKSPACE_REGEX_GROUP_STORAGE_KEY);
            appState.workspaceCurrentRegexGroupId = current || null;
            // Pointer invalid after manual storage edits: drop stale id (CLI delete reset parity).
            if (
                appState.workspaceCurrentRegexGroupId &&
                !findRegexGroup(appState.workspaceCurrentRegexGroupId)
            ) {
                resetWorkspaceCurrentRegexGroup();
            }
        } catch (_e) {
            /* file:// may block storage */
        }
    }

    function persistRegexStore() {
        try {
            localStorage.setItem(REGEX_GROUPS_STORAGE_KEY, JSON.stringify(appState.regexGroups));
            localStorage.setItem(REGEX_RULES_STORAGE_KEY, JSON.stringify(appState.regexRules));
        } catch (_e) {
            /* ignore */
        }
    }

    function persistWorkspaceRegexGroup() {
        try {
            if (appState.workspaceCurrentRegexGroupId) {
                localStorage.setItem(
                    WORKSPACE_REGEX_GROUP_STORAGE_KEY,
                    appState.workspaceCurrentRegexGroupId,
                );
            } else {
                localStorage.removeItem(WORKSPACE_REGEX_GROUP_STORAGE_KEY);
            }
        } catch (_e) {
            /* ignore */
        }
    }

    /** Delete current group or clear storage: remove key + null state (CLI auto-reset). */
    function resetWorkspaceCurrentRegexGroup() {
        appState.workspaceCurrentRegexGroupId = null;
        try {
            localStorage.removeItem(WORKSPACE_REGEX_GROUP_STORAGE_KEY);
        } catch (_e) {
            /* ignore */
        }
    }

    function setWorkspaceCurrentRegexGroup(groupId) {
        if (!findRegexGroup(groupId)) return;
        appState.workspaceCurrentRegexGroupId = groupId;
        persistWorkspaceRegexGroup();
        renderRegexGroupList();
        showToast('已设为当前生效正则组');
    }

    function renderRegexGroupList() {
        const host = document.getElementById('regexGroupList');
        if (!host) return;
        const listId = 'regexGroups';
        if (appState.regexGroups.length === 0) {
            host.innerHTML = '<p class="provider-empty-hint">暂无正则组，点击「添加」创建。</p>';
            return;
        }
        let html = '';
        appState.regexGroups.forEach(function (group) {
            const isCurrent =
                group.groupId === appState.workspaceCurrentRegexGroupId && !isBatchMode(listId);
            html +=
                '<div class="provider-item regex-group-item' +
                listItemSelectedClass(listId, group.groupId) +
                (isCurrent ? ' active' : '') +
                '" data-group-id="' +
                escapeHtml(group.groupId) +
                '">';
            html += renderBatchCheckbox(listId, group.groupId);
            html += '<div class="provider-icon">🛡️</div>';
            html += '<div class="provider-info">';
            html += '<div class="provider-name">' + escapeHtml(regexGroupTitle(group)) + '</div>';
            html +=
                '<div class="provider-meta">' +
                escapeHtml(group.groupId) +
                ' · ' +
                escapeHtml(regexGroupMetaLine(group.groupId)) +
                '</div>';
            html += '</div>';
            if (!isBatchMode(listId)) {
                html += '<div class="provider-item-trailing">';
                if (isCurrent) html += '<span class="current-badge">当前</span>';
                html +=
                    '<button type="button" class="agent-menu-btn" data-regex-group-menu="' +
                    escapeHtml(group.groupId) +
                    '" aria-label="更多">⋮</button>';
                html += '<span class="menu-arrow">›</span>';
                html += '</div>';
            }
            html += '</div>';
        });
        host.innerHTML = html;
    }

    function openRegexRulesPage(groupId) {
        if (!findRegexGroup(groupId)) return;
        appState.editingRegexGroupId = groupId;
        renderRegexRuleList();
        navigateToPage('regexRules', true);
    }

    function renderRegexRuleList() {
        const group = findRegexGroup(appState.editingRegexGroupId);
        const title = document.getElementById('regexRulesTitle');
        const host = document.getElementById('regexRulesList');
        if (!host) return;
        if (title) title.textContent = regexGroupTitle(group);
        const rules = regexRulesForGroup(appState.editingRegexGroupId).slice().sort(function (a, b) {
            return a.sortOrder - b.sortOrder;
        });
        const listId = 'regexRules';
        if (rules.length === 0) {
            host.innerHTML = '<p class="provider-empty-hint">暂无规则，点击「添加规则」。</p>';
            return;
        }
        let html = '';
        rules.forEach(function (rule) {
            html +=
                '<div class="provider-model-item regex-rule-item' +
                listItemSelectedClass(listId, rule.ruleId) +
                '" data-rule-id="' +
                escapeHtml(rule.ruleId) +
                '">';
            html += renderBatchCheckbox(listId, rule.ruleId);
            html += '<div class="provider-model-info">';
            html += '<div class="provider-model-name">' + escapeHtml(rule.name) + '</div>';
            html +=
                '<div class="provider-model-meta">' +
                escapeHtml(rule.ruleId) +
                ' · ' +
                escapeHtml(regexRuleMetaLine(rule)) +
                '</div>';
            html += '</div>';
            if (!isBatchMode(listId)) html += '<span class="menu-arrow">›</span>';
            html += '</div>';
        });
        host.innerHTML = html;
    }

    function defaultRegexRuleDraft() {
        return {
            name: '',
            pattern: '',
            flags: '',
            enabled: true,
            llmReplace: null,
            displayReplace: null,
            minDepth: 1,
            maxDepth: 99,
            scopeUser: true,
            scopeAssistant: true,
        };
    }

    function ruleToDraftFields(rule) {
        return {
            name: rule.name,
            pattern: rule.pattern,
            flags: rule.flags || '',
            enabled: rule.enabled,
            llmReplace: rule.llmReplace,
            displayReplace: rule.displayReplace,
            minDepth: rule.minDepth,
            maxDepth: rule.maxDepth,
            scopeUser: rule.scopeUser,
            scopeAssistant: rule.scopeAssistant,
        };
    }

    function renderRegexRuleEditor() {
        const root = document.getElementById('regexRuleEditorRoot');
        if (!root) return;
        const groupId = appState.editingRegexGroupId;
        const ruleId = appState.editingRegexRuleId;
        const existing = ruleId ? findRegexRule(groupId, ruleId) : null;
        const draft = existing ? ruleToDraftFields(existing) : defaultRegexRuleDraft();

        const llmReplaceEnabled = draft.llmReplace != null && draft.llmReplace !== '';
        const displayReplaceEnabled =
            draft.displayReplace != null && draft.displayReplace !== '';

        let html = '<section class="agent-form-section"><h3>规则</h3>';
        html +=
            '<label class="agent-field"><span>名称</span><input type="text" data-regex-field="name" value="' +
            escapeHtml(draft.name) +
            '"></label>';
        html +=
            '<label class="agent-field"><span>正则表达式</span><input type="text" data-regex-field="pattern" value="' +
            escapeHtml(draft.pattern) +
            '"></label>';
        html +=
            '<label class="agent-field"><span>flags</span><input type="text" data-regex-field="flags" placeholder="gim" value="' +
            escapeHtml(draft.flags) +
            '"></label>';
        html +=
            '<label class="agent-field agent-field--row"><span>启用规则</span><input type="checkbox" class="toggle" data-regex-field="enabled"' +
            (draft.enabled ? ' checked' : '') +
            '></label>';
        html += '<div class="regex-test-grid">';
        html +=
            '<label class="agent-field"><span>最小层数 (floor)</span><input type="number" min="1" data-regex-field="minDepth" value="' +
            draft.minDepth +
            '"></label>';
        html +=
            '<label class="agent-field"><span>最大层数 (floor)</span><input type="number" min="1" data-regex-field="maxDepth" value="' +
            draft.maxDepth +
            '"></label>';
        html += '</div>';
        html += '<p class="agent-field-hint regex-scope-heading">作用范围 (role)</p>';
        html +=
            '<label class="agent-field agent-field--row"><span>用户 (user)</span><input type="checkbox" class="toggle" data-regex-field="scopeUser"' +
            (draft.scopeUser ? ' checked' : '') +
            '></label>';
        html +=
            '<label class="agent-field agent-field--row"><span>助手 (assistant)</span><input type="checkbox" class="toggle" data-regex-field="scopeAssistant"' +
            (draft.scopeAssistant ? ' checked' : '') +
            '></label>';
        html += '<p class="agent-field-hint">至少启用一侧替换；作用范围至少选一。</p>';
        html += '</section>';

        html +=
            '<section class="agent-form-section agent-model-section regex-replace-section' +
            (llmReplaceEnabled ? ' agent-model-section--enabled' : '') +
            '" data-regex-llm-section>';
        html += '<div class="agent-section-header">';
        html += '<h3>提示词替换</h3>';
        html += '<label class="agent-model-switch">';
        html += '<span class="agent-model-switch-label">启用</span>';
        html +=
            '<input type="checkbox" class="toggle" data-regex-llm-enable' +
            (llmReplaceEnabled ? ' checked' : '') +
            ' aria-label="启用提示词替换">';
        html += '</label></div>';
        html +=
            '<p class="agent-field-hint agent-model-hint-off' +
            (llmReplaceEnabled ? ' hidden' : '') +
            '">关闭时不改写送入模型的文本（llm 通道）。</p>';
        html +=
            '<div class="agent-model-pickers' +
            (llmReplaceEnabled ? '' : ' hidden') +
            '" data-regex-llm-fields>';
        html +=
            '<label class="agent-field"><span>替换为</span><input type="text" data-regex-field="llmReplace" placeholder="如 [redacted]" value="' +
            escapeHtml(llmReplaceEnabled ? draft.llmReplace : '') +
            '"></label>';
        html += '</div></section>';

        html +=
            '<section class="agent-form-section agent-model-section regex-replace-section' +
            (displayReplaceEnabled ? ' agent-model-section--enabled' : '') +
            '" data-regex-display-section>';
        html += '<div class="agent-section-header">';
        html += '<h3>显示替换</h3>';
        html += '<label class="agent-model-switch">';
        html += '<span class="agent-model-switch-label">启用</span>';
        html +=
            '<input type="checkbox" class="toggle" data-regex-display-enable' +
            (displayReplaceEnabled ? ' checked' : '') +
            ' aria-label="启用显示替换">';
        html += '</label></div>';
        html +=
            '<p class="agent-field-hint agent-model-hint-off' +
            (displayReplaceEnabled ? ' hidden' : '') +
            '">关闭时不改写列表/终端展示文本（display 通道）。</p>';
        html +=
            '<div class="agent-model-pickers' +
            (displayReplaceEnabled ? '' : ' hidden') +
            '" data-regex-display-fields>';
        html +=
            '<label class="agent-field"><span>替换为</span><input type="text" data-regex-field="displayReplace" placeholder="如 ***" value="' +
            escapeHtml(displayReplaceEnabled ? draft.displayReplace : '') +
            '"></label>';
        html += '</div></section>';

        html += '<section class="agent-form-section regex-test-panel"><h3>测试预览</h3>';
        html +=
            '<label class="agent-field"><span>样例文本</span><textarea data-regex-test="text" rows="3">' +
            escapeHtml('mysecret@email.com') +
            '</textarea></label>';
        html +=
            '<label class="agent-field"><span>通道 (channel)</span><select data-regex-test="channel"><option value="display">display</option><option value="llm">llm</option></select></label>';
        html += '<label class="agent-field"><span>预览输出</span></label>';
        html += '<pre class="regex-test-output" data-regex-test-output></pre>';
        html +=
            '<p class="agent-field-hint">按上方规则的作用范围与层数区间预览；floor 取最小层数。</p>';
        html += '</section>';

        html += '<div class="regex-rule-form-actions">';
        html += '<span class="unsaved-indicator regex-rule-unsaved hidden">未保存</span>';
        html +=
            '<button type="button" class="btn-primary" data-action="save-regex-rule">保存</button>';
        html += '</div>';

        root.innerHTML = html;
        clearRegexRuleEditorDirty();
        updateRegexTestPreview();
    }

    function collectRegexRuleFromForm(options) {
        const silent = options && options.silent;
        const root = document.getElementById('regexRuleEditorRoot');
        if (!root) return null;
        function field(name) {
            const el = root.querySelector('[data-regex-field="' + name + '"]');
            if (!el) return null;
            if (el.type === 'checkbox') return el.checked;
            if (el.type === 'number') return Number(el.value);
            return el.value;
        }
        function replaceToggle(kind) {
            const el = root.querySelector('[data-regex-' + kind + '-enable]');
            return el ? el.checked : false;
        }
        function nullableReplace(name, enabled) {
            if (!enabled) return null;
            const v = field(name);
            if (v == null) return null;
            const t = String(v).trim();
            return t === '' ? null : t;
        }
        const llmOn = replaceToggle('llm');
        const displayOn = replaceToggle('display');
        const name = String(field('name') || '').trim();
        if (!name) {
            if (!silent) showToast('请填写规则名称');
            return null;
        }
        const pattern = String(field('pattern') || '').trim();
        if (!pattern) {
            if (!silent) showToast('请填写正则表达式');
            return null;
        }
        const minDepth = Math.max(1, Number(field('minDepth')) || 1);
        const maxDepth = Math.max(1, Number(field('maxDepth')) || 1);
        return {
            name: name,
            pattern: pattern,
            flags: String(field('flags') || '').trim(),
            enabled: !!field('enabled'),
            llmReplace: nullableReplace('llmReplace', llmOn),
            displayReplace: nullableReplace('displayReplace', displayOn),
            minDepth: minDepth,
            maxDepth: maxDepth,
            scopeUser: !!field('scopeUser'),
            scopeAssistant: !!field('scopeAssistant'),
        };
    }

    function collectRegexTestContext(root) {
        const textEl = root.querySelector('[data-regex-test="text"]');
        const channelEl = root.querySelector('[data-regex-test="channel"]');
        return {
            text: textEl ? textEl.value : '',
            channel: channelEl ? channelEl.value : 'display',
        };
    }

    /** Preview role from rule scope checkboxes (not a separate test control). */
    function regexPreviewRoleFromScope(fields) {
        if (fields.scopeAssistant && !fields.scopeUser) return 'assistant';
        return 'user';
    }

    function updateRegexTestPreview() {
        const root = document.getElementById('regexRuleEditorRoot');
        const out = root && root.querySelector('[data-regex-test-output]');
        if (!root || !out) return;
        const fields = collectRegexRuleFromForm({ silent: true });
        if (!fields) {
            out.textContent = '请填写名称与正则表达式后再预览';
            out.classList.add('regex-test-output--error');
            return;
        }
        const test = collectRegexTestContext(root);
        const validation = validateRegexRuleFields(fields);
        if (!validation.ok) {
            out.textContent = validation.message;
            out.classList.add('regex-test-output--error');
            return;
        }
        const result = previewRegexRule(test.text, fields, {
            channel: test.channel,
            floor: fields.minDepth,
            role: regexPreviewRoleFromScope(fields),
        });
        if (!result.ok) {
            out.textContent = result.message;
            out.classList.add('regex-test-output--error');
            return;
        }
        out.textContent = result.text;
        out.classList.remove('regex-test-output--error');
    }

    function markRegexRuleEditorDirty() {
        appState.regexRuleEditorDirty = true;
        const root = document.getElementById('regexRuleEditorRoot');
        const indicator = root && root.querySelector('.regex-rule-unsaved');
        if (indicator) indicator.classList.remove('hidden');
    }

    function clearRegexRuleEditorDirty() {
        appState.regexRuleEditorDirty = false;
        const root = document.getElementById('regexRuleEditorRoot');
        const indicator = root && root.querySelector('.regex-rule-unsaved');
        if (indicator) indicator.classList.add('hidden');
    }

    function openRegexRuleEditor(ruleId) {
        appState.editingRegexRuleId = ruleId;
        renderRegexRuleEditor();
        navigateToPage('regexRuleEditor', true);
    }

    function nextRegexRuleSortOrder(groupId) {
        const rules = regexRulesForGroup(groupId);
        let max = 0;
        rules.forEach(function (r) {
            if (r.sortOrder > max) max = r.sortOrder;
        });
        return max + 1;
    }

    function allocateRegexRuleId(groupId, name) {
        let base = slugifyRegexId(name);
        let candidate = base;
        let n = 2;
        while (findRegexRule(groupId, candidate)) {
            candidate = base + '-' + n;
            n += 1;
        }
        return candidate;
    }

    function saveRegexRuleEditor() {
        const groupId = appState.editingRegexGroupId;
        if (!groupId || !findRegexGroup(groupId)) return;
        const fields = collectRegexRuleFromForm();
        if (!fields) return;
        const validation = validateRegexRuleFields(fields);
        if (!validation.ok) {
            showToast(validation.message);
            return;
        }
        const t = nowMs();
        let ruleId = appState.editingRegexRuleId;
        let existing = ruleId ? findRegexRule(groupId, ruleId) : null;
        if (!existing) {
            ruleId = allocateRegexRuleId(groupId, fields.name);
            existing = {
                groupId: groupId,
                ruleId: ruleId,
                sortOrder: nextRegexRuleSortOrder(groupId),
                createdAtMs: t,
            };
        }
        const updated = Object.assign({}, existing, fields, {
            groupId: groupId,
            ruleId: ruleId,
            flags: fields.flags,
            updatedAtMs: t,
        });
        const idx = appState.regexRules.findIndex(function (r) {
            return r.groupId === groupId && r.ruleId === ruleId;
        });
        if (idx >= 0) appState.regexRules[idx] = updated;
        else appState.regexRules.push(updated);
        appState.editingRegexRuleId = ruleId;
        persistRegexStore();
        clearRegexRuleEditorDirty();
        renderRegexRuleList();
        showToast('已保存规则');
        if (appState.pageStack.length > 0) {
            const previousPage = appState.pageStack.pop();
            navigateToPage(previousPage, false);
        }
    }

    function batchDeleteRegexGroups(ids) {
        const idSet = new Set(ids);
        appState.regexGroups = appState.regexGroups.filter(function (g) {
            return !idSet.has(g.groupId);
        });
        appState.regexRules = appState.regexRules.filter(function (r) {
            return !idSet.has(r.groupId);
        });
        if (
            appState.workspaceCurrentRegexGroupId &&
            idSet.has(appState.workspaceCurrentRegexGroupId)
        ) {
            resetWorkspaceCurrentRegexGroup();
        }
        if (appState.editingRegexGroupId && idSet.has(appState.editingRegexGroupId)) {
            appState.editingRegexGroupId = null;
            if (
                appState.currentPage === 'regexRules' ||
                appState.currentPage === 'regexRuleEditor'
            ) {
                navigateToPage('regexGroups', false);
            }
        }
        persistRegexStore();
        renderRegexGroupList();
    }

    function batchDeleteRegexRules(ruleIds) {
        const groupId = appState.editingRegexGroupId;
        if (!groupId) return;
        const idSet = new Set(ruleIds);
        appState.regexRules = appState.regexRules.filter(function (r) {
            return !(r.groupId === groupId && idSet.has(r.ruleId));
        });
        if (appState.editingRegexRuleId && idSet.has(appState.editingRegexRuleId)) {
            appState.editingRegexRuleId = null;
            if (appState.currentPage === 'regexRuleEditor') {
                navigateToPage('regexRules', false);
            }
        }
        persistRegexStore();
        renderRegexRuleList();
        renderRegexGroupList();
    }

    function deleteRegexGroup(groupId) {
        batchDeleteRegexGroups([groupId]);
        showToast('已删除正则组');
    }

    function showRegexGroupMenu(groupId) {
        const group = findRegexGroup(groupId);
        if (!group) return;
        const isCurrent = appState.workspaceCurrentRegexGroupId === groupId;
        const items = [];
        if (!isCurrent) items.push({ label: '设为当前', action: 'set-current' });
        items.push({ label: '编辑展示名称', action: 'edit-display' });
        items.push({ label: '删除组', action: 'delete-group', danger: true });
        showBottomSheet(items, function (action) {
            if (action === 'set-current') setWorkspaceCurrentRegexGroup(groupId);
            else if (action === 'edit-display') openEditRegexGroupModal(groupId);
            else if (action === 'delete-group') {
                if (!confirm('确定删除正则组 ' + groupId + ' 及其全部规则？')) return;
                deleteRegexGroup(groupId);
            }
        });
    }

    function openNewRegexGroupModal() {
        const modal = document.getElementById('newRegexGroupModal');
        const idInput = document.getElementById('newRegexGroupId');
        const nameInput = document.getElementById('newRegexGroupDisplayName');
        if (idInput) idInput.value = '';
        if (nameInput) nameInput.value = '';
        if (modal) {
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
        }
        if (idInput) idInput.focus();
    }

    function closeNewRegexGroupModal() {
        const modal = document.getElementById('newRegexGroupModal');
        if (modal) {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        }
    }

    function confirmNewRegexGroupModal() {
        const idInput = document.getElementById('newRegexGroupId');
        const nameInput = document.getElementById('newRegexGroupDisplayName');
        if (!idInput) return;
        const groupId = idInput.value.trim();
        if (!groupId) {
            showToast('请填写组 ID');
            return;
        }
        if (findRegexGroup(groupId)) {
            showToast('组 ID 已存在');
            return;
        }
        const displayName =
            nameInput && nameInput.value.trim() ? nameInput.value.trim() : null;
        const t = nowMs();
        appState.regexGroups.push({
            groupId: groupId,
            displayName: displayName,
            createdAtMs: t,
            updatedAtMs: t,
        });
        persistRegexStore();
        closeNewRegexGroupModal();
        renderRegexGroupList();
        showToast('已添加正则组');
    }

    let editingRegexGroupModalId = null;

    function openEditRegexGroupModal(groupId) {
        const group = findRegexGroup(groupId);
        if (!group) return;
        editingRegexGroupModalId = groupId;
        const modal = document.getElementById('editRegexGroupModal');
        const hint = document.getElementById('editRegexGroupIdHint');
        const nameInput = document.getElementById('editRegexGroupDisplayName');
        if (hint) hint.textContent = '组 ID：' + groupId;
        if (nameInput) nameInput.value = group.displayName || '';
        if (modal) {
            modal.classList.remove('hidden');
            modal.setAttribute('aria-hidden', 'false');
        }
    }

    function closeEditRegexGroupModal() {
        editingRegexGroupModalId = null;
        const modal = document.getElementById('editRegexGroupModal');
        if (modal) {
            modal.classList.add('hidden');
            modal.setAttribute('aria-hidden', 'true');
        }
    }

    function confirmEditRegexGroupModal() {
        const group = findRegexGroup(editingRegexGroupModalId);
        const nameInput = document.getElementById('editRegexGroupDisplayName');
        if (!group || !nameInput) return;
        group.displayName = nameInput.value.trim() || null;
        group.updatedAtMs = nowMs();
        persistRegexStore();
        closeEditRegexGroupModal();
        renderRegexGroupList();
        if (appState.editingRegexGroupId === group.groupId) renderRegexRuleList();
        showToast('已更新展示名称');
    }

    function toggleRegexReplaceSection(root, kind, enabled) {
        const section = root.querySelector('[data-regex-' + kind + '-section]');
        const fields = root.querySelector('[data-regex-' + kind + '-fields]');
        const hintOff = section && section.querySelector('.agent-model-hint-off');
        if (section) section.classList.toggle('agent-model-section--enabled', enabled);
        if (fields) fields.classList.toggle('hidden', !enabled);
        if (hintOff) hintOff.classList.toggle('hidden', enabled);
    }

    function setupRegexConfig() {
        loadRegexStore();
        renderRegexGroupList();

        const groupList = document.getElementById('regexGroupList');
        if (groupList) {
            groupList.addEventListener('click', function (e) {
                const menuBtn = e.target.closest('[data-regex-group-menu]');
                if (menuBtn) {
                    e.preventDefault();
                    e.stopPropagation();
                    showRegexGroupMenu(menuBtn.dataset.regexGroupMenu);
                    return;
                }
                const item = e.target.closest('[data-group-id]');
                if (!item) return;
                handleManagedListItemClick(e, 'regexGroups', item, function (el) {
                    openRegexRulesPage(el.dataset.groupId);
                });
            });
        }

        const rulesList = document.getElementById('regexRulesList');
        if (rulesList) {
            rulesList.addEventListener('click', function (e) {
                const item = e.target.closest('[data-rule-id]');
                if (!item) return;
                handleManagedListItemClick(e, 'regexRules', item, function (el) {
                    openRegexRuleEditor(el.dataset.ruleId);
                });
            });
        }

        const newGroupBtn = document.querySelector('[data-action="new-regex-group"]');
        if (newGroupBtn) newGroupBtn.addEventListener('click', openNewRegexGroupModal);

        const newRuleBtn = document.querySelector('[data-action="new-regex-rule"]');
        if (newRuleBtn) {
            newRuleBtn.addEventListener('click', function () {
                openRegexRuleEditor(null);
            });
        }

        document.querySelectorAll('[data-action="close-new-regex-group"]').forEach(function (btn) {
            btn.addEventListener('click', closeNewRegexGroupModal);
        });
        const confirmNewGroup = document.querySelector('[data-action="confirm-new-regex-group"]');
        if (confirmNewGroup) confirmNewGroup.addEventListener('click', confirmNewRegexGroupModal);

        document.querySelectorAll('[data-action="close-edit-regex-group"]').forEach(function (btn) {
            btn.addEventListener('click', closeEditRegexGroupModal);
        });
        const confirmEditGroup = document.querySelector('[data-action="confirm-edit-regex-group"]');
        if (confirmEditGroup) confirmEditGroup.addEventListener('click', confirmEditRegexGroupModal);

        const editorRoot = document.getElementById('regexRuleEditorRoot');
        if (editorRoot) {
            editorRoot.addEventListener('click', function (e) {
                if (e.target.closest('[data-action="save-regex-rule"]')) {
                    saveRegexRuleEditor();
                }
            });
            editorRoot.addEventListener('input', function () {
                if (appState.currentPage === 'regexRuleEditor') {
                    markRegexRuleEditorDirty();
                    updateRegexTestPreview();
                }
            });
            editorRoot.addEventListener('change', function (e) {
                if (appState.currentPage !== 'regexRuleEditor') return;
                if (e.target.matches('[data-regex-llm-enable]')) {
                    toggleRegexReplaceSection(editorRoot, 'llm', e.target.checked);
                }
                if (e.target.matches('[data-regex-display-enable]')) {
                    toggleRegexReplaceSection(editorRoot, 'display', e.target.checked);
                }
                markRegexRuleEditorDirty();
                updateRegexTestPreview();
            });
        }

        if (elements.backBtn) {
            elements.backBtn.addEventListener(
                'click',
                function (e) {
                    if (appState.currentPage === 'regexRuleEditor' && appState.regexRuleEditorDirty) {
                        if (!confirm('有未保存的更改，确定要离开吗？')) {
                            e.stopImmediatePropagation();
                        }
                    }
                },
                true,
            );
        }
    }

    function init() {
        initTheme();
        setupThemeToggle();
        setupNavigation();
        setupBackButton();
        setupDrawer();
        setupSessionListTabs();
        setupChatTopTabs();
        setupSessionActionsDrawer();
        setupSessionLog();
        setupVfsBrowsers();
        setupMenuItems();
        setupBottomSheet();
        setupListBatchSelection();
        setupFileEditor();
        setupAgentEditor();
        setupCompactionPolicyPage();
        appState.globalCompactionPolicy = defaultGlobalCompactionPolicy();
        setupProjectsAndSessions();
        setupAgentsAndProviders();
        setupWorkspaceModel();
        setupRegexConfig();

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
