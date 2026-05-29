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
        if (!elements.bottomSheet) return;
        elements.bottomSheet.classList.remove('show');
        setTimeout(function () {
            elements.bottomSheet.classList.add('hidden');
        }, 300);
    }

    function showBottomSheet(items, callback) {
        if (!elements.sheetContent || !elements.bottomSheet) return;
        elements.sheetContent.innerHTML = '';
        items.forEach(function (item) {
            const div = document.createElement('div');
            div.className = 'sheet-item' + (item.danger ? ' danger' : '');
            div.textContent = item.label;
            div.addEventListener('click', function () {
                callback(item.action);
                hideBottomSheet();
            });
            elements.sheetContent.appendChild(div);
        });
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
        html += '<button type="button" class="vfs-fm-tool-btn" data-vfs-action="new" data-vfs-scope="' + scope + '">＋</button>';
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
        if (action === 'apply-strategy') {
            showToast('打开目录策略配置（示意）');
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
                  { label: '应用目录策略', action: 'apply-strategy' },
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

    function vfsShowNewSheet(scope) {
        showBottomSheet(
            [
                { label: '新建文件', action: 'new-file' },
                { label: '新建文件夹', action: 'new-folder' },
                { label: '导入压缩包', action: 'import' },
            ],
            function (action) {
                if (action === 'new-file') showToast('新建文件（' + scope + '）');
                else if (action === 'new-folder') showToast('新建文件夹（' + scope + '）');
                else if (action === 'import') showToast('导入压缩包（' + scope + '）');
            },
        );
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

            const toolBtn = e.target.closest('[data-vfs-action="new"]');
            if (toolBtn) {
                e.preventDefault();
                vfsShowNewSheet(toolBtn.dataset.vfsScope);
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
        if (!elements.bottomSheet) return;
        elements.bottomSheet.addEventListener('click', function (e) {
            if (e.target === elements.bottomSheet) hideBottomSheet();
        });
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

    function setupAgentsAndProviders() {
        document.querySelectorAll('.agent-item').forEach(function (item) {
            item.addEventListener('click', function () {
                showToast('编辑 Agent 配置');
            });
        });
        document.querySelectorAll('.provider-item').forEach(function (item) {
            item.addEventListener('click', function () {
                showToast('编辑服务商配置');
            });
        });
        const newAgentBtn = document.querySelector('[data-action="new-agent"]');
        if (newAgentBtn) newAgentBtn.addEventListener('click', function () { showToast('新建 Agent'); });
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
