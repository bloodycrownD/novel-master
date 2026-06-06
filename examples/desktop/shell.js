/**
 * examples/desktop — browser UI prototype.
 *
 * Layout frozen: #preview-pane | #explorer-pane | #chat-rail.
 * Nav state machine: rootTab (chat|profile) + chat drill-down + pageStack for config subpages.
 * Mock store persisted to localStorage (nm-desktop-shell-state-v1).
 */
(function initDesktopShell() {
  "use strict";

  var STORAGE_KEY = "nm-desktop-shell-state-v1";
  var THEME_STORAGE_KEY = "nm-desktop-theme";

  /** @typedef {"global"|"session"|"chat"} WorkspaceScope */

  var CHAT_LEVELS = ["projects", "sessions", "conversation"];

  // Config subpages keep explorer on global scope (or don't change drill-down state).
  var NAV_TO_WORKSPACE = {
    projects: "global",
    sessions: "session",
    conversation: "chat",
    profile: "global",
    agentsSettings: "global",
    agentEditor: "global",
    providers: "global",
    providerDetail: "global",
    modelSampling: "global",
    compactionConditions: "global",
    eventsConfig: "global",
    regexGroups: "global",
    regexRules: "global",
    regexRuleEditor: "global",
    globalTemplate: "global",
    realPrompt: "chat",
    sessionLog: "chat",
  };

  var WORKSPACE_TITLES = {
    global: "全局工作区",
    session: "会话工作区",
    chat: "聊天工作区",
  };

  var VIEW_TITLES = {
    profile: "我的",
    agentsSettings: "agent管理",
    agentEditor: "Agent 配置",
    providers: "服务商管理",
    providerDetail: "模型管理",
    modelSampling: "采样配置",
    compactionConditions: "压缩条件",
    eventsConfig: "事件配置",
    regexGroups: "正则配置",
    regexRules: "正则规则",
    regexRuleEditor: "规则详情",
    globalTemplate: "全局模板",
    realPrompt: "真实提示词",
    sessionLog: "会话日志",
  };

  function seedStore() {
    return {
      workspaceCurrentModelId: "zhipu/glm-4.6",
      workspaceCurrentAgentId: "agent-writer",
      workspaceCurrentRegexGroupId: null,
      llmStreamEnabled: true,
      chatRichTextEnabled: false,
      tokenCounterMode: "auto",
      agents: {
        "agent-writer": {
          id: "agent-writer",
          definition: {
            schemaVersion: 1,
            name: "写作助手",
            runtime: { maxSteps: 20 },
            prompts: [
              { name: "system", type: "text", role: "system", content: "你是一位创意写作助手。" },
              { name: "history", type: "chat" },
            ],
          },
        },
        "agent-creative": {
          id: "agent-creative",
          definition: {
            schemaVersion: 1,
            name: "创意策划",
            runtime: { maxSteps: 15 },
            prompts: [
              { name: "system", type: "text", role: "system", content: "你擅长头脑风暴与情节设计。" },
              { name: "history", type: "chat" },
            ],
          },
        },
      },
      providers: [
        {
          id: "zhipu",
          name: "智谱 AI",
          models: [
            { vendorModelId: "glm-4.6", label: "GLM-4.6", settings: { sampling: { enabled: true, params: { openai: { temperature: 0.7 } } } } },
            { vendorModelId: "glm-4-flash", label: "GLM-4 Flash", settings: {} },
          ],
        },
        {
          id: "openai",
          name: "OpenAI",
          models: [
            { vendorModelId: "gpt-4o", label: "GPT-4o", settings: {} },
          ],
        },
      ],
      compactionConditions: {
        schemaVersion: 3,
        enabled: true,
        tokenRatio: 0.8,
        visibleFloor: 20,
      },
      eventsConfig: {
        schemaVersion: 2,
        events: {
          "session.compaction.requested": {
            mode: "parallel",
            actions: [
              { type: "hide-message", params: { "start-depth": 6 } },
              { type: "refresh-macros" },
            ],
          },
        },
      },
      regexGroups: [
        { groupId: "strict-filter", displayName: "严格过滤" },
        { groupId: "loose-filter", displayName: "宽松过滤" },
      ],
      regexRules: {
        "strict-filter": [
          { ruleId: "r1", name: "隐藏系统提示", pattern: "SYSTEM:", scopeUser: true, scopeAssistant: false, minDepth: 0, maxDepth: 99 },
        ],
      },
      previewFiles: {
        "g-global-yaml": {
          name: "global-rules.yaml",
          text: "# 全局正则与事件规则\nschemaVersion: 1\n",
        },
        "g-shared-md": {
          name: "shared-prompt.md",
          text: "全应用共享提示词片段（静态 mock）。\n",
        },
        "s-inherit": {
          name: "inherit-from-global.md",
          text: "项目模板继承说明。\n",
        },
        "s-outline": {
          name: "project-outline.md",
          text: "当前项目的结构大纲占位。\n",
        },
        "c-ch1": {
          name: "chapter-01.md",
          text: "# 第一章 · 启程\n\n晨光透过舷窗洒在控制台上。林远深吸一口气，启动了跃迁引擎。\n",
        },
        "c-outline": {
          name: "outline.md",
          text: "本卷章节提纲（静态 mock）。\n",
        },
        "c-draft": {
          name: "draft.txt",
          text: "临时笔记草稿内容。\n",
        },
      },
    };
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return seedStore();
      var parsed = JSON.parse(raw);
      var seed = seedStore();
      Object.keys(seed).forEach(function (key) {
        if (parsed[key] == null) parsed[key] = seed[key];
      });
      return parsed;
    } catch (_e) {
      return seedStore();
    }
  }

  function persistStore() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (_e) { /* file:// may block */ }
  }

  var store = loadStore();

  var navState = {
    rootTab: "chat",
    chatLevel: "projects",
    viewId: "projects",
    pageStack: [],
    projectId: null,
    projectName: null,
    sessionId: null,
    sessionName: null,
    workspaceScope: "global",
    previewFileId: null,
    previewEditMode: false,
    editingAgentId: null,
    editingProviderId: null,
    editingVendorModelId: null,
    editingRegexGroupId: null,
    editingRegexRuleId: null,
  };

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(message) {
    var el = document.getElementById("shell-toast");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
    el.classList.add("is-visible");
    setTimeout(function () {
      el.classList.remove("is-visible");
      setTimeout(function () { el.classList.add("hidden"); }, 200);
    }, 2000);
  }

  function initTheme() {
    var saved = localStorage.getItem(THEME_STORAGE_KEY) || "light";
    document.documentElement.setAttribute("data-theme", saved);
    updateThemeButton(saved);
  }

  function toggleTheme() {
    var current = document.documentElement.getAttribute("data-theme") || "light";
    var next = current === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    updateThemeButton(next);
    showToast(next === "dark" ? "已切换到深色模式" : "已切换到浅色模式");
  }

  function updateThemeButton(theme) {
    var btn = document.getElementById("theme-toggle");
    if (btn) btn.textContent = theme === "dark" ? "☾" : "☀";
  }

  function setWorkspaceScope(scope) {
    navState.workspaceScope = scope;
    var titleEl = document.getElementById("workspace-title");
    if (titleEl) titleEl.textContent = WORKSPACE_TITLES[scope] || "工作区";

    document.querySelectorAll("[data-workspace-panel]").forEach(function (el) {
      var panelScope = el.getAttribute("data-workspace-panel");
      var isVisible = panelScope === scope;
      el.classList.toggle("is-visible", isVisible);
      el.hidden = !isVisible;
    });
  }

  /** Sync explorer title/panel with current nav view; preserves chat drill-down when on profile stack. */
  function syncWorkspaceWithNav(viewId) {
    setWorkspaceScope(NAV_TO_WORKSPACE[viewId] || "global");
  }

  function updateRootTabs() {
    document.querySelectorAll("[data-root-tab]").forEach(function (tab) {
      var isActive = tab.getAttribute("data-root-tab") === navState.rootTab;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  function switchRootTab(tab) {
    navState.rootTab = tab;
    updateRootTabs();
    if (tab === "profile") {
      showNavView("profile");
    } else {
      showNavView(navState.chatLevel || "projects");
    }
  }

  function isChatLevel(viewId) {
    return CHAT_LEVELS.indexOf(viewId) >= 0;
  }

  function showNavView(viewId) {
    navState.viewId = viewId;
    if (isChatLevel(viewId)) {
      navState.chatLevel = viewId;
    }

    document.querySelectorAll("[data-nav-view]").forEach(function (view) {
      var target = view.getAttribute("data-nav-view") === viewId;
      view.classList.toggle("is-visible", target);
      view.hidden = !target;
    });

    syncWorkspaceWithNav(viewId);
    renderViewContent(viewId);
    updateConversationMeta();
  }

  function pushNavView(viewId) {
    navState.pageStack.push(navState.viewId);
    showNavView(viewId);
  }

  function popNavView() {
    if (navState.pageStack.length === 0) return;
    var prev = navState.pageStack.pop();
    showNavView(prev);
  }

  function renderStackHeader(title, showBack) {
    var back = showBack
      ? '<button type="button" class="chat-nav-back" data-action="nav-back" aria-label="返回">‹</button>'
      : "";
    return (
      '<div class="chat-nav-header rail-stack-header">' +
      back +
      '<span class="chat-nav-header__title">' + escapeHtml(title) + "</span></div>"
    );
  }

  function renderProfileView() {
    var root = document.getElementById("profile-view-root");
    if (!root) return;

    var agentName = store.agents[store.workspaceCurrentAgentId];
    var agentLabel = agentName ? agentName.definition.name : "—";
    var regexLabel = "不启用";
    if (store.workspaceCurrentRegexGroupId) {
      var g = store.regexGroups.find(function (x) { return x.groupId === store.workspaceCurrentRegexGroupId; });
      regexLabel = g ? (g.displayName || g.groupId) : "不启用";
    }

    var html = renderStackHeader("我的", false);
    html += '<div class="rail-menu">';
    html += '<div class="rail-menu-section">工作区</div>';
    html += menuRow("🤖", "当前模型", store.workspaceCurrentModelId, "pick-model");
    html += menuRow("🧠", "当前 agent", agentLabel, "pick-agent");
    html += menuRow("🛡️", "当前正则组", regexLabel, "pick-regex-group");
    html += switchRow("⚡", "流式输出", "llm-stream", store.llmStreamEnabled);
    html += switchRow("📝", "富文本消息", "chat-rich-text", store.chatRichTextEnabled);
    html += menuRow("🔢", "Token 计数器", store.tokenCounterMode, "pick-token-counter");
    html += '<div class="rail-menu-section">数据管理</div>';
    html += menuRow("💾", "导出数据库", "分享备份文件", "export-db");
    html += menuRow("📥", "导入数据库", "完全替换", "import-db");
    html += '<div class="rail-menu-section">配置</div>';
    html += menuRow("🤖", "agent管理", "", "goto-agents");
    html += menuRow("🔌", "服务商管理", "", "goto-providers");
    html += menuRow("🗜️", "压缩条件", "", "goto-compaction");
    html += menuRow("⚡", "事件配置", "", "goto-events");
    html += menuRow("🛡️", "正则配置", "", "goto-regex");
    html += menuRow("🌐", "全局模板", "", "goto-global-template");
    html += "</div>";
    root.innerHTML = html;
  }

  function menuRow(icon, label, value, action) {
    return (
      '<button type="button" class="rail-menu-item" data-profile-action="' + action + '">' +
      '<span class="rail-menu-icon">' + icon + "</span>" +
      '<span class="rail-menu-label">' + escapeHtml(label) + "</span>" +
      (value ? '<span class="rail-menu-value">' + escapeHtml(value) + "</span>" : "") +
      '<span class="rail-menu-chevron">›</span></button>'
    );
  }

  function switchRow(icon, label, action, checked) {
    return (
      '<div class="rail-menu-item rail-menu-item--switch">' +
      '<span class="rail-menu-icon">' + icon + "</span>" +
      '<span class="rail-menu-label">' + escapeHtml(label) + "</span>" +
      '<label class="rail-switch"><input type="checkbox" data-profile-switch="' + action + '"' +
      (checked ? " checked" : "") + "><span class=\"rail-switch-slider\"></span></label></div>"
    );
  }

  function renderAgentsSettings() {
    var root = document.getElementById("agents-settings-root");
    if (!root) return;
    var html = renderStackHeader("agent管理", true);
    html += '<div class="rail-toolbar"><button type="button" class="btn-primary" data-action="new-agent">新建</button></div>';
    html += '<div class="rail-list">';
    Object.keys(store.agents).forEach(function (id) {
      var def = store.agents[id].definition;
      html +=
        '<button type="button" class="rail-list-item" data-agent-id="' + id + '">' +
        '<span class="rail-list-label">' + escapeHtml(def.name) + "</span>" +
        '<span class="rail-list-chevron">›</span></button>';
    });
    html += "</div>";
    root.innerHTML = html;
  }

  function renderAgentEditor() {
    var root = document.getElementById("agent-editor-root");
    if (!root || !navState.editingAgentId) return;
    var entry = store.agents[navState.editingAgentId];
    if (!entry) return;
    var def = entry.definition;
    var html = renderStackHeader(def.name, true);
    html += '<div class="rail-form">';
    html += '<label class="rail-field"><span>名称</span><input type="text" data-agent-field="name" value="' + escapeHtml(def.name) + '"></label>';
    html += '<label class="rail-field"><span>最大步数</span><input type="number" data-agent-field="maxSteps" value="' + (def.runtime && def.runtime.maxSteps ? def.runtime.maxSteps : 20) + '"></label>';
    html += '<div class="rail-toolbar"><button type="button" class="btn-primary" data-action="save-agent">保存</button></div>';
    html += "</div>";
    root.innerHTML = html;
  }

  function renderProviders() {
    var root = document.getElementById("providers-root");
    if (!root) return;
    var html = renderStackHeader("服务商管理", true);
    html += '<div class="rail-list">';
    store.providers.forEach(function (p) {
      html +=
        '<button type="button" class="rail-list-item" data-provider-id="' + p.id + '">' +
        '<span class="rail-list-label">' + escapeHtml(p.name) + "</span>" +
        '<span class="rail-list-meta">' + p.models.length + " 个模型</span>" +
        '<span class="rail-list-chevron">›</span></button>';
    });
    html += "</div>";
    root.innerHTML = html;
  }

  function renderProviderDetail() {
    var root = document.getElementById("provider-detail-root");
    if (!root || !navState.editingProviderId) return;
    var provider = store.providers.find(function (p) { return p.id === navState.editingProviderId; });
    if (!provider) return;
    var html = renderStackHeader(provider.name, true);
    html += '<div class="rail-list">';
    provider.models.forEach(function (m) {
      html +=
        '<button type="button" class="rail-list-item" data-vendor-model-id="' + escapeHtml(m.vendorModelId) + '">' +
        '<span class="rail-list-label">' + escapeHtml(m.label) + "</span>" +
        '<span class="rail-list-chevron">›</span></button>';
    });
    html += "</div>";
    root.innerHTML = html;
  }

  function renderModelSampling() {
    var root = document.getElementById("model-sampling-root");
    if (!root) return;
    var html = renderStackHeader("采样配置", true);
    html += '<div class="rail-form">';
    html += '<label class="rail-field"><span>温度</span><input type="number" data-sampling-field="temperature" min="0" max="2" step="0.1" value="0.7"></label>';
    html += '<div class="rail-toolbar"><button type="button" class="btn-primary" data-action="save-sampling">保存</button></div>';
    html += "</div>";
    root.innerHTML = html;
  }

  function renderCompactionConditions() {
    var root = document.getElementById("compaction-conditions-root");
    if (!root) return;
    var c = store.compactionConditions;
    var html = renderStackHeader("压缩条件", true);
    html += '<div class="rail-form">';
    html += '<label class="rail-field rail-field--row"><span>启用自动压缩</span><input type="checkbox" data-compaction-field="enabled"' + (c.enabled ? " checked" : "") + "></label>";
    html += '<label class="rail-field"><span>Token 比例</span><input type="number" data-compaction-field="tokenRatio" min="0.01" max="1" step="0.01" value="' + (c.tokenRatio || "") + '"></label>';
    html += '<label class="rail-field"><span>可见条数阈值</span><input type="number" data-compaction-field="visibleFloor" min="0" step="1" value="' + (c.visibleFloor || "") + '"></label>';
    html += '<div class="rail-toolbar"><button type="button" class="btn-primary" data-action="save-compaction">保存</button></div>';
    html += "</div>";
    root.innerHTML = html;
  }

  function renderEventsConfig() {
    var root = document.getElementById("events-config-root");
    if (!root) return;
    var config = store.eventsConfig;
    var eventId = Object.keys(config.events || {})[0] || "session.compaction.requested";
    var block = config.events[eventId] || { mode: "parallel", actions: [] };
    var html = renderStackHeader("事件配置", true);
    html += '<div class="rail-form">';
    html += '<label class="rail-field"><span>事件 ID</span><input type="text" readonly value="' + escapeHtml(eventId) + '"></label>';
    html += '<label class="rail-field"><span>执行模式</span><select data-events-field="mode"><option value="parallel"' + (block.mode === "parallel" ? " selected" : "") + '>parallel</option><option value="sequential"' + (block.mode === "sequential" ? " selected" : "") + ">sequential</option></select></label>";
    html += '<label class="rail-field"><span>动作 JSON</span><textarea data-events-field="actions" rows="8">' + escapeHtml(JSON.stringify(block.actions, null, 2)) + "</textarea></label>";
    html += '<div class="rail-toolbar"><button type="button" class="btn-primary" data-action="save-events">保存</button></div>';
    html += "</div>";
    root.innerHTML = html;
  }

  function renderRegexGroups() {
    var root = document.getElementById("regex-groups-root");
    if (!root) return;
    var html = renderStackHeader("正则配置", true);
    html += '<div class="rail-list">';
    store.regexGroups.forEach(function (g) {
      html +=
        '<button type="button" class="rail-list-item" data-regex-group-id="' + escapeHtml(g.groupId) + '">' +
        '<span class="rail-list-label">' + escapeHtml(g.displayName || g.groupId) + "</span>" +
        '<span class="rail-list-chevron">›</span></button>';
    });
    html += "</div>";
    root.innerHTML = html;
  }

  function renderRegexRules() {
    var root = document.getElementById("regex-rules-root");
    if (!root || !navState.editingRegexGroupId) return;
    var rules = store.regexRules[navState.editingRegexGroupId] || [];
    var group = store.regexGroups.find(function (g) { return g.groupId === navState.editingRegexGroupId; });
    var html = renderStackHeader(group ? (group.displayName || group.groupId) : "正则规则", true);
    html += '<div class="rail-list">';
    rules.forEach(function (r) {
      html +=
        '<button type="button" class="rail-list-item" data-regex-rule-id="' + escapeHtml(r.ruleId) + '">' +
        '<span class="rail-list-label">' + escapeHtml(r.name) + "</span>" +
        '<span class="rail-list-chevron">›</span></button>';
    });
    html += "</div>";
    root.innerHTML = html;
  }

  function renderRegexRuleEditor() {
    var root = document.getElementById("regex-rule-editor-root");
    if (!root) return;
    var html = renderStackHeader("规则详情", true);
    html += '<div class="rail-form"><p class="rail-hint">正则规则编辑 mock（字段对齐 mobile 原型）。</p>';
    html += '<label class="rail-field"><span>名称</span><input type="text" value="隐藏系统提示"></label>';
    html += '<label class="rail-field"><span>模式</span><input type="text" value="SYSTEM:"></label>';
    html += '<div class="rail-toolbar"><button type="button" class="btn-primary" data-action="save-regex-rule">保存</button></div></div>';
    root.innerHTML = html;
  }

  function renderGlobalTemplate() {
    var root = document.getElementById("global-template-root");
    if (!root) return;
    var html = renderStackHeader("全局模板", true);
    html += '<p class="rail-hint">全局模板文件在左侧 explorer 全局工作区树中浏览；此处为入口说明。</p>';
    html += '<p class="rail-hint">选中 <code>shared-prompt.md</code> 可在预览区查看/编辑。</p>';
    root.innerHTML = html;
    setWorkspaceScope("global");
  }

  function renderRealPrompt() {
    var root = document.getElementById("real-prompt-root");
    if (!root) return;
    var html = renderStackHeader("真实提示词", true);
    html += '<pre class="rail-code">&lt;file path="/chapters/chapter-01.md"&gt;\n# 第一章 觉醒\n...\n&lt;/file&gt;</pre>';
    root.innerHTML = html;
  }

  function renderSessionLog() {
    var root = document.getElementById("session-log-root");
    if (!root) return;
    var html = renderStackHeader("会话日志", true);
    html += '<div class="rail-log"><div class="rail-log-item"><span class="rail-log-time">10:02</span> read_file 成功</div>';
    html += '<div class="rail-log-item"><span class="rail-log-time">10:05</span> 检查点 cp-001</div></div>';
    root.innerHTML = html;
  }

  function renderViewContent(viewId) {
    if (viewId === "profile") renderProfileView();
    else if (viewId === "agentsSettings") renderAgentsSettings();
    else if (viewId === "agentEditor") renderAgentEditor();
    else if (viewId === "providers") renderProviders();
    else if (viewId === "providerDetail") renderProviderDetail();
    else if (viewId === "modelSampling") renderModelSampling();
    else if (viewId === "compactionConditions") renderCompactionConditions();
    else if (viewId === "eventsConfig") renderEventsConfig();
    else if (viewId === "regexGroups") renderRegexGroups();
    else if (viewId === "regexRules") renderRegexRules();
    else if (viewId === "regexRuleEditor") renderRegexRuleEditor();
    else if (viewId === "globalTemplate") renderGlobalTemplate();
    else if (viewId === "realPrompt") renderRealPrompt();
    else if (viewId === "sessionLog") renderSessionLog();
  }

  function updateConversationMeta() {
    var meta = document.getElementById("conversation-meta");
    if (!meta) return;
    if (navState.viewId !== "conversation") {
      meta.innerHTML = "";
      return;
    }
    var agent = store.agents[store.workspaceCurrentAgentId];
    var agentLabel = agent ? agent.definition.name : "—";
    meta.innerHTML =
      '<span class="conversation-meta__chip">🧠 ' + escapeHtml(agentLabel) + "</span>" +
      '<span class="conversation-meta__chip">🤖 ' + escapeHtml(store.workspaceCurrentModelId) + "</span>";
  }

  function showPreview(fileId, fileName) {
    navState.previewFileId = fileId;
    var filenameEl = document.getElementById("preview-filename");
    var bodyEl = document.getElementById("preview-body");
    var editorEl = document.getElementById("preview-editor");
    if (!filenameEl || !bodyEl) return;

    filenameEl.textContent = fileName;
    var file = store.previewFiles[fileId];
    var text = file ? file.text : "「" + fileName + "」预览占位。";

    if (navState.previewEditMode && editorEl) {
      bodyEl.classList.add("hidden");
      editorEl.classList.remove("hidden");
      editorEl.value = text;
    } else {
      if (editorEl) editorEl.classList.add("hidden");
      bodyEl.classList.remove("hidden");
      bodyEl.innerHTML = "<pre class=\"preview-text\">" + escapeHtml(text) + "</pre>";
    }
  }

  function togglePreviewEdit() {
    navState.previewEditMode = !navState.previewEditMode;
    var btn = document.getElementById("preview-edit-toggle");
    if (btn) btn.classList.toggle("is-active", navState.previewEditMode);
    if (navState.previewFileId) {
      var file = store.previewFiles[navState.previewFileId];
      if (file) showPreview(navState.previewFileId, file.name);
    }
    showToast(navState.previewEditMode ? "编辑模式" : "预览模式");
  }

  function savePreviewEdit() {
    var editorEl = document.getElementById("preview-editor");
    if (!editorEl || !navState.previewFileId) return;
    var file = store.previewFiles[navState.previewFileId];
    if (!file) return;
    file.text = editorEl.value;
    persistStore();
    showToast("文件已保存");
  }

  function openSessionMenu(anchor) {
    var menu = document.getElementById("session-menu");
    if (!menu) return;
    var agent = store.agents[store.workspaceCurrentAgentId];
    var agentLabel = agent ? agent.definition.name : "—";
    menu.innerHTML =
      '<div class="session-menu-readonly"><span>当前 agent</span><strong>' + escapeHtml(agentLabel) + "</strong></div>" +
      '<div class="session-menu-readonly"><span>当前模型</span><strong>' + escapeHtml(store.workspaceCurrentModelId) + "</strong></div>" +
      '<button type="button" data-session-menu="switch-agent">切换 agent</button>' +
      '<button type="button" data-session-menu="switch-model">切换模型</button>' +
      '<button type="button" data-session-menu="real-prompt">真实提示词</button>' +
      '<button type="button" data-session-menu="session-log">会话日志</button>';

    var rect = anchor.getBoundingClientRect();
    menu.style.top = rect.bottom + 6 + "px";
    menu.style.right = "16px";
    menu.classList.remove("hidden");
  }

  function closeSessionMenu() {
    var menu = document.getElementById("session-menu");
    if (menu) menu.classList.add("hidden");
  }

  function pickAgent() {
    var ids = Object.keys(store.agents);
    var current = store.workspaceCurrentAgentId;
    var next = ids[(ids.indexOf(current) + 1) % ids.length];
    store.workspaceCurrentAgentId = next;
    persistStore();
    updateConversationMeta();
    if (navState.viewId === "profile") renderProfileView();
    showToast("已切换 agent");
  }

  function pickModel() {
    var options = ["zhipu/glm-4.6", "openai/gpt-4o"];
    var idx = options.indexOf(store.workspaceCurrentModelId);
    store.workspaceCurrentModelId = options[(idx + 1) % options.length];
    persistStore();
    updateConversationMeta();
    if (navState.viewId === "profile") renderProfileView();
    showToast("已切换模型");
  }

  function pickRegexGroup() {
    var ids = [null].concat(store.regexGroups.map(function (g) { return g.groupId; }));
    var idx = ids.indexOf(store.workspaceCurrentRegexGroupId);
    store.workspaceCurrentRegexGroupId = ids[(idx + 1) % ids.length];
    persistStore();
    if (navState.viewId === "profile") renderProfileView();
    showToast(store.workspaceCurrentRegexGroupId ? "已切换正则组" : "已禁用正则组");
  }

  function pickTokenCounter() {
    var modes = ["auto", "heuristic", "tiktoken", "claude", "gemma", "llama3", "mistral"];
    var idx = modes.indexOf(store.tokenCounterMode);
    store.tokenCounterMode = modes[(idx + 1) % modes.length];
    persistStore();
    if (navState.viewId === "profile") renderProfileView();
    showToast("Token 计数器：" + store.tokenCounterMode);
  }

  function exportDatabase() {
    var blob = new Blob([JSON.stringify(store, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "novel-master-desktop-mock.json";
    a.click();
    URL.revokeObjectURL(url);
    showToast("数据库已导出");
  }

  function importDatabase() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          store = Object.assign(seedStore(), JSON.parse(String(reader.result || "{}")));
          persistStore();
          renderViewContent(navState.viewId);
          updateConversationMeta();
          showToast("数据库已导入");
        } catch (_e) {
          showToast("导入失败");
        }
      };
      reader.readAsText(file);
    };
    if (!confirm("将用所选备份完全替换当前 mock 数据，是否继续？")) return;
    input.click();
  }

  function bindTreeClicks() {
    document.querySelectorAll(".explorer-tree").forEach(function (container) {
      container.addEventListener("click", function (event) {
        var node = event.target.closest("[data-file-id]");
        if (!node || !container.contains(node)) return;
        var panel = container.closest("[data-workspace-panel]");
        if (panel && panel.hidden) return;
        container.querySelectorAll(".is-active").forEach(function (n) {
          n.classList.remove("is-active");
        });
        node.classList.add("is-active");
        showPreview(node.getAttribute("data-file-id") || "", node.getAttribute("data-file-name") || "—");
      });
    });
  }

  function bindChatNavigation() {
    var projectList = document.getElementById("project-list");
    if (projectList) {
      projectList.addEventListener("click", function (event) {
        var item = event.target.closest("[data-project-id]");
        if (!item) return;
        navState.projectId = item.getAttribute("data-project-id");
        navState.projectName = item.getAttribute("data-project-name");
        navState.sessionId = null;
        navState.sessionName = null;
        var sessionsTitle = document.getElementById("sessions-project-name");
        if (sessionsTitle) sessionsTitle.textContent = navState.projectName;
        navState.rootTab = "chat";
        updateRootTabs();
        showNavView("sessions");
      });
    }

    var sessionList = document.getElementById("session-list");
    if (sessionList) {
      sessionList.addEventListener("click", function (event) {
        var item = event.target.closest("[data-session-id]");
        if (!item) return;
        navState.sessionId = item.getAttribute("data-session-id");
        navState.sessionName = item.getAttribute("data-session-name");
        var convProject = document.getElementById("conversation-project-name");
        var convSession = document.getElementById("conversation-session-name");
        if (convProject) convProject.textContent = navState.projectName || "—";
        if (convSession) convSession.textContent = navState.sessionName || "—";
        navState.rootTab = "chat";
        updateRootTabs();
        showNavView("conversation");
      });
    }

    document.querySelectorAll("[data-action='back-to-projects']").forEach(function (btn) {
      btn.addEventListener("click", function () {
        navState.projectId = null;
        navState.projectName = null;
        navState.sessionId = null;
        navState.sessionName = null;
        showNavView("projects");
      });
    });

    document.querySelectorAll("[data-action='back-to-sessions']").forEach(function (btn) {
      btn.addEventListener("click", function () {
        navState.sessionId = null;
        navState.sessionName = null;
        showNavView("sessions");
      });
    });
  }

  function bindRailInteractions() {
    document.querySelectorAll("[data-root-tab]").forEach(function (tab) {
      tab.addEventListener("click", function () {
        switchRootTab(tab.getAttribute("data-root-tab") || "chat");
      });
    });

    document.getElementById("chat-rail").addEventListener("click", function (e) {
      var back = e.target.closest("[data-action='nav-back']");
      if (back) {
        popNavView();
        return;
      }

      var profileAction = e.target.closest("[data-profile-action]");
      if (profileAction) {
        var action = profileAction.getAttribute("data-profile-action");
        if (action === "pick-model") pickModel();
        else if (action === "pick-agent") pickAgent();
        else if (action === "pick-regex-group") pickRegexGroup();
        else if (action === "pick-token-counter") pickTokenCounter();
        else if (action === "export-db") exportDatabase();
        else if (action === "import-db") importDatabase();
        else if (action === "goto-agents") pushNavView("agentsSettings");
        else if (action === "goto-providers") pushNavView("providers");
        else if (action === "goto-compaction") pushNavView("compactionConditions");
        else if (action === "goto-events") pushNavView("eventsConfig");
        else if (action === "goto-regex") pushNavView("regexGroups");
        else if (action === "goto-global-template") pushNavView("globalTemplate");
        return;
      }

      var sw = e.target.closest("[data-profile-switch]");
      if (sw) {
        var key = sw.getAttribute("data-profile-switch");
        if (key === "llm-stream") store.llmStreamEnabled = sw.checked;
        else if (key === "chat-rich-text") store.chatRichTextEnabled = sw.checked;
        persistStore();
        showToast("偏好已保存");
        return;
      }

      var agentBtn = e.target.closest("[data-agent-id]");
      if (agentBtn) {
        navState.editingAgentId = agentBtn.getAttribute("data-agent-id");
        pushNavView("agentEditor");
        return;
      }

      if (e.target.closest("[data-action='new-agent']")) {
        var id = "agent-" + Date.now();
        store.agents[id] = {
          id: id,
          definition: {
            schemaVersion: 1,
            name: "new-agent",
            runtime: { maxSteps: 20 },
            prompts: [{ name: "system", type: "text", role: "system", content: "" }, { name: "history", type: "chat" }],
          },
        };
        persistStore();
        navState.editingAgentId = id;
        pushNavView("agentEditor");
        return;
      }

      if (e.target.closest("[data-action='save-agent']")) {
        var nameInput = document.querySelector("[data-agent-field='name']");
        var stepsInput = document.querySelector("[data-agent-field='maxSteps']");
        if (navState.editingAgentId && store.agents[navState.editingAgentId]) {
          var def = store.agents[navState.editingAgentId].definition;
          if (nameInput) def.name = nameInput.value.trim() || def.name;
          if (stepsInput) def.runtime = { maxSteps: Number(stepsInput.value) || 20 };
          persistStore();
          showToast("Agent 已保存");
        }
        return;
      }

      var providerBtn = e.target.closest("[data-provider-id]");
      if (providerBtn) {
        navState.editingProviderId = providerBtn.getAttribute("data-provider-id");
        pushNavView("providerDetail");
        return;
      }

      var modelBtn = e.target.closest("[data-vendor-model-id]");
      if (modelBtn) {
        navState.editingVendorModelId = modelBtn.getAttribute("data-vendor-model-id");
        pushNavView("modelSampling");
        return;
      }

      if (e.target.closest("[data-action='save-sampling']")) {
        persistStore();
        showToast("采样配置已保存");
        return;
      }

      if (e.target.closest("[data-action='save-compaction']")) {
        var enabledEl = document.querySelector("[data-compaction-field='enabled']");
        var ratioEl = document.querySelector("[data-compaction-field='tokenRatio']");
        var floorEl = document.querySelector("[data-compaction-field='visibleFloor']");
        store.compactionConditions = {
          schemaVersion: 3,
          enabled: enabledEl ? enabledEl.checked : false,
          tokenRatio: ratioEl && ratioEl.value ? Number(ratioEl.value) : undefined,
          visibleFloor: floorEl && floorEl.value ? Number(floorEl.value) : undefined,
        };
        persistStore();
        showToast("压缩条件已保存");
        return;
      }

      if (e.target.closest("[data-action='save-events']")) {
        var modeEl = document.querySelector("[data-events-field='mode']");
        var actionsEl = document.querySelector("[data-events-field='actions']");
        try {
          var actions = JSON.parse(actionsEl ? actionsEl.value : "[]");
          store.eventsConfig = {
            schemaVersion: 2,
            events: {
              "session.compaction.requested": {
                mode: modeEl ? modeEl.value : "parallel",
                actions: actions,
              },
            },
          };
          persistStore();
          showToast("事件配置已保存");
        } catch (_e) {
          showToast("动作 JSON 无效");
        }
        return;
      }

      var regexGroupBtn = e.target.closest("[data-regex-group-id]");
      if (regexGroupBtn) {
        navState.editingRegexGroupId = regexGroupBtn.getAttribute("data-regex-group-id");
        pushNavView("regexRules");
        return;
      }

      var regexRuleBtn = e.target.closest("[data-regex-rule-id]");
      if (regexRuleBtn) {
        navState.editingRegexRuleId = regexRuleBtn.getAttribute("data-regex-rule-id");
        pushNavView("regexRuleEditor");
        return;
      }

      if (e.target.closest("[data-action='save-regex-rule']")) {
        showToast("规则已保存");
        return;
      }
    });

    var sessionMenuBtn = document.querySelector("[data-action='open-session-menu']");
    if (sessionMenuBtn) {
      sessionMenuBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        openSessionMenu(sessionMenuBtn);
      });
    }

    document.addEventListener("click", function () {
      closeSessionMenu();
    });

    var sessionMenu = document.getElementById("session-menu");
    if (sessionMenu) {
      sessionMenu.addEventListener("click", function (e) {
        e.stopPropagation();
        var btn = e.target.closest("[data-session-menu]");
        if (!btn) return;
        closeSessionMenu();
        var action = btn.getAttribute("data-session-menu");
        if (action === "switch-agent") pickAgent();
        else if (action === "switch-model") pickModel();
        else if (action === "real-prompt") pushNavView("realPrompt");
        else if (action === "session-log") pushNavView("sessionLog");
      });
    }

    var editToggle = document.querySelector("[data-action='toggle-preview-edit']");
    if (editToggle) editToggle.addEventListener("click", togglePreviewEdit);

    var editorEl = document.getElementById("preview-editor");
    if (editorEl) {
      editorEl.addEventListener("blur", savePreviewEdit);
    }

    var themeBtn = document.getElementById("theme-toggle");
    if (themeBtn) themeBtn.addEventListener("click", toggleTheme);
  }

  var app = document.getElementById("app");
  if (!app) return;

  initTheme();
  bindTreeClicks();
  bindChatNavigation();
  bindRailInteractions();
  updateRootTabs();
  showNavView("projects");
})();
