/**
 * 桌面端原型 - 应用逻辑
 */
(function () {
    'use strict';

    // 应用状态
    const appState = {
        currentView: 'sessions',
        currentSessionId: 'session-1',
        currentAgentId: null,
        currentRightPanel: 'workspace',
        theme: 'light',
    };

    const THEME_STORAGE_KEY = 'nm-desktop-theme';

    // 模拟数据
    const mockData = {
        sessions: [
            { id: 'session-1', name: '第一卷创作', agent: '默认 Agent', lastMessage: '2分钟前', active: true },
            { id: 'session-2', name: '角色设定讨论', agent: '创意 Agent', lastMessage: '1小时前', active: false },
            { id: 'session-3', name: '世界观构建', agent: '默认 Agent', lastMessage: '昨天', active: false },
        ],
        agents: [
            { id: 'agent-1', name: '默认 Agent', model: 'GPT-4', description: '通用写作助手' },
            { id: 'agent-2', name: '创意 Agent', model: 'Claude', description: '创意构思专家' },
            { id: 'agent-3', name: '编辑 Agent', model: 'GPT-4', description: '文本编辑优化' },
        ],
        files: [
            { id: 'file-1', name: 'outline.md', type: 'file', icon: '📄', path: '/outline.md' },
            { id: 'folder-1', name: 'chapters', type: 'folder', icon: '📁', children: [
                { id: 'file-2', name: 'chapter-01.md', type: 'file', icon: '📄', path: '/chapters/chapter-01.md' },
                { id: 'file-3', name: 'chapter-02.md', type: 'file', icon: '📄', path: '/chapters/chapter-02.md' },
                { id: 'file-4', name: 'chapter-03.md', type: 'file', icon: '📄', path: '/chapters/chapter-03.md' },
            ]},
        ],
        logs: [
            { id: 'log-1', tool: 'read_file', status: 'success', summary: '读取 /chapters/chapter-03.md', time: '2分钟前' },
            { id: 'log-2', tool: 'write_file', status: 'success', summary: '写入 /chapters/chapter-02.md', time: '5分钟前' },
            { id: 'log-3', tool: 'replace_in_file', status: 'error', summary: '替换失败: 未找到匹配内容', time: '10分钟前' },
        ],
    };

    // 初始化
    function init() {
        initTheme();
        setupEventListeners();
        renderSessions();
        renderAgents();
        renderFileTree();
        renderLogs();
    }

    // 主题管理
    function initTheme() {
        const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || 'light';
        appState.theme = savedTheme;
        document.documentElement.setAttribute('data-theme', savedTheme);
    }

    function toggleTheme() {
        const newTheme = appState.theme === 'light' ? 'dark' : 'light';
        appState.theme = newTheme;
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
        showToast(newTheme === 'dark' ? '已切换到深色模式' : '已切换到浅色模式');
    }

    // 事件监听
    function setupEventListeners() {
        // 主题切换
        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', toggleTheme);
        }

        // 导航标签切换
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const view = tab.dataset.view;
                switchView(view);
            });
        });

        // 右侧边栏标签切换
        document.querySelectorAll('.right-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                const panel = tab.dataset.panel;
                switchRightPanel(panel);
            });
        });

        // 发送消息
        const sendBtn = document.getElementById('sendBtn');
        const chatInput = document.getElementById('chatInput');
        if (sendBtn && chatInput) {
            sendBtn.addEventListener('click', sendMessage);
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });
        }

        // 动作按钮
        document.addEventListener('click', (e) => {
            const action = e.target.closest('[data-action]')?.dataset.action;
            if (action) handleAction(action);
        });
    }

    // 视图切换
    function switchView(view) {
        appState.currentView = view;

        // 更新导航标签
        document.querySelectorAll('.nav-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.view === view);
        });

        // 更新侧边栏内容
        document.querySelectorAll('.sidebar-content').forEach(content => {
            content.classList.add('hidden');
        });
        const targetView = document.getElementById(`${view}View`);
        if (targetView) {
            targetView.classList.remove('hidden');
        }
    }

    // 右侧面板切换
    function switchRightPanel(panel) {
        appState.currentRightPanel = panel;

        // 更新标签
        document.querySelectorAll('.right-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.panel === panel);
        });

        // 更新面板
        document.querySelectorAll('.right-panel').forEach(p => {
            p.classList.remove('active');
        });
        const targetPanel = document.getElementById(`${panel}Panel`);
        if (targetPanel) {
            targetPanel.classList.add('active');
        }
    }

    // 渲染会话列表
    function renderSessions() {
        const sessionList = document.getElementById('sessionList');
        if (!sessionList) return;

        sessionList.innerHTML = mockData.sessions.map(session => `
            <button class="session-item ${session.active ? 'active' : ''}" data-session-id="${session.id}">
                <div style="flex: 1; min-width: 0;">
                    <div class="session-name">${session.name}</div>
                    <div class="session-meta">${session.agent} · ${session.lastMessage}</div>
                </div>
            </button>
        `).join('');

        // 添加点击事件
        sessionList.querySelectorAll('.session-item').forEach(item => {
            item.addEventListener('click', () => {
                const sessionId = item.dataset.sessionId;
                selectSession(sessionId);
            });
        });
    }

    // 选择会话
    function selectSession(sessionId) {
        appState.currentSessionId = sessionId;
        
        // 更新列表状态
        document.querySelectorAll('.session-item').forEach(item => {
            item.classList.toggle('active', item.dataset.sessionId === sessionId);
        });

        // 更新会话名称
        const session = mockData.sessions.find(s => s.id === sessionId);
        if (session) {
            const chatSessionName = document.getElementById('chatSessionName');
            if (chatSessionName) {
                chatSessionName.textContent = session.name;
            }
        }

        showToast(`已切换到会话: ${session.name}`);
    }

    // 渲染 Agent 列表
    function renderAgents() {
        const agentList = document.getElementById('agentList');
        if (!agentList) return;

        agentList.innerHTML = mockData.agents.map(agent => `
            <button class="agent-item" data-agent-id="${agent.id}">
                <div style="flex: 1; min-width: 0;">
                    <div class="session-name">${agent.name}</div>
                    <div class="session-meta">${agent.model} · ${agent.description}</div>
                </div>
            </button>
        `).join('');

        // 添加点击事件
        agentList.querySelectorAll('.agent-item').forEach(item => {
            item.addEventListener('click', () => {
                const agentId = item.dataset.agentId;
                editAgent(agentId);
            });
        });
    }

    // 编辑 Agent
    function editAgent(agentId) {
        appState.currentAgentId = agentId;
        const agent = mockData.agents.find(a => a.id === agentId);
        
        // 显示编辑器视图
        document.getElementById('chatView').classList.add('hidden');
        document.getElementById('agentEditorView').classList.remove('hidden');
        
        // 更新标题
        const title = document.getElementById('agentEditorTitle');
        if (title && agent) {
            title.textContent = `编辑 Agent: ${agent.name}`;
        }

        showToast(`正在编辑: ${agent.name}`);
    }

    // 渲染文件树
    function renderFileTree() {
        const fileTree = document.getElementById('fileTree');
        if (!fileTree) return;

        function renderFile(file, level = 0) {
            const indent = level * 16;
            if (file.type === 'folder') {
                let html = `
                    <div class="file-item" style="padding-left: ${indent + 12}px;" data-file-id="${file.id}">
                        <span class="file-icon">${file.icon}</span>
                        <span class="file-name">${file.name}</span>
                    </div>
                `;
                if (file.children) {
                    html += file.children.map(child => renderFile(child, level + 1)).join('');
                }
                return html;
            } else {
                return `
                    <div class="file-item" style="padding-left: ${indent + 12}px;" data-file-id="${file.id}">
                        <span class="file-icon">${file.icon}</span>
                        <span class="file-name">${file.name}</span>
                    </div>
                `;
            }
        }

        fileTree.innerHTML = mockData.files.map(file => renderFile(file)).join('');

        // 添加点击事件
        fileTree.querySelectorAll('.file-item').forEach(item => {
            item.addEventListener('click', () => {
                showToast('文件点击功能待实现');
            });
        });
    }

    // 渲染日志列表
    function renderLogs() {
        const logList = document.getElementById('logList');
        if (!logList) return;

        logList.innerHTML = mockData.logs.map(log => `
            <div class="log-item ${log.status}">
                <div class="log-header">
                    <span class="log-tool">${log.tool}</span>
                    <span class="log-time">${log.time}</span>
                </div>
                <div class="log-summary">${log.summary}</div>
            </div>
        `).join('');
    }

    // 发送消息
    function sendMessage() {
        const chatInput = document.getElementById('chatInput');
        if (!chatInput) return;

        const message = chatInput.value.trim();
        if (!message) return;

        // 添加用户消息到界面
        const messageList = document.getElementById('messageList');
        if (messageList) {
            const messageDiv = document.createElement('div');
            messageDiv.className = 'message user fade-in';
            messageDiv.innerHTML = `
                <div class="message-avatar">U</div>
                <div class="message-bubble">
                    <div class="message-content">${escapeHtml(message)}</div>
                </div>
            `;
            messageList.appendChild(messageDiv);
            messageList.scrollTop = messageList.scrollHeight;
        }

        // 清空输入框
        chatInput.value = '';
        chatInput.style.height = 'auto';

        // 模拟 AI 回复
        setTimeout(() => {
            if (messageList) {
                const replyDiv = document.createElement('div');
                replyDiv.className = 'message assistant fade-in';
                replyDiv.innerHTML = `
                    <div class="message-avatar">AI</div>
                    <div class="message-bubble">
                        <div class="message-content">收到您的消息: "${escapeHtml(message)}"。这是一个演示回复。</div>
                    </div>
                `;
                messageList.appendChild(replyDiv);
                messageList.scrollTop = messageList.scrollHeight;
            }
        }, 1000);
    }

    // 处理动作
    function handleAction(action) {
        switch (action) {
            case 'new-session':
                showToast('新建会话功能待实现');
                break;
            case 'new-agent':
                showToast('新建 Agent 功能待实现');
                break;
            case 'switch-model':
                showToast('切换模型功能待实现');
                break;
            case 'session-menu':
                showToast('会话菜单功能待实现');
                break;
            case 'providers':
                showToast('服务商管理功能待实现');
                break;
            case 'compaction':
                showToast('压缩策略功能待实现');
                break;
            case 'regex':
                showToast('正则配置功能待实现');
                break;
            case 'global-template':
                showToast('全局模板功能待实现');
                break;
            case 'cancel-agent':
                document.getElementById('agentEditorView').classList.add('hidden');
                document.getElementById('chatView').classList.remove('hidden');
                break;
            case 'save-agent':
                showToast('Agent 配置已保存');
                document.getElementById('agentEditorView').classList.add('hidden');
                document.getElementById('chatView').classList.remove('hidden');
                break;
            case 'back-to-settings':
                document.getElementById('settingsDetailView').classList.add('hidden');
                document.getElementById('chatView').classList.remove('hidden');
                break;
            case 'save-settings':
                showToast('设置已保存');
                break;
        }
    }

    // Toast 提示
    function showToast(message, duration = 2000) {
        const toast = document.getElementById('toast');
        if (!toast) return;

        toast.textContent = message;
        toast.classList.remove('hidden');
        setTimeout(() => {
            toast.classList.add('show');
        }, 10);

        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => {
                toast.classList.add('hidden');
            }, 300);
        }, duration);
    }

    // HTML 转义
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // 页面加载完成后初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
