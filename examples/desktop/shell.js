/**
 * examples/desktop — browser UI prototype.
 *
 * Layout frozen: #preview-pane | #explorer-pane | #chat-rail.
 * Chat drill-down in rail; settings on full-page #settings-page.
 * Mock store persisted to localStorage (nm-desktop-shell-state-v1).
 */
(function initDesktopShell() {
  "use strict";

  var STORAGE_KEY = "nm-desktop-shell-state-v1";
  var THEME_STORAGE_KEY = "nm-desktop-theme";
  var COLUMN_SPLITTER_SIZE = 5;
  var COLUMN_PREVIEW_MIN_WIDTH = 450;
  var COLUMN_EXPLORER_MIN_WIDTH = 300;
  var COLUMN_CHAT_MIN_WIDTH = 350;

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
  };

  var PROMPT_ROLE_LABELS = {
    system: "系统",
    user: "用户",
    assistant: "助手",
    tool: "工具",
  };

  var MOCK_REAL_PROMPT_SEGMENTS = [
    {
      id: "seg-system",
      role: "system",
      title: "写作助手 · system",
      body:
        "你是一位创意写作助手。\n\n<file path=\"/chapters/chapter-01.md\">\n# 第一章 觉醒\n\n在2157年的新上海...\n</file>",
    },
    {
      id: "seg-file-2",
      role: "system",
      title: "/chapters/chapter-02.md",
      body: "# 第二章 发现\n\n主角发现了一个惊人的秘密...",
    },
    {
      id: "seg-file-3",
      role: "system",
      title: "/chapters/chapter-03.md (header)",
      body: "---\ntitle: 第三章 抉择\nstatus: draft\n---",
    },
    {
      id: "seg-user",
      role: "user",
      title: "会话消息",
      body: "请帮我润色这一段开场白。",
    },
  ];

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
  };

  function seedStore() {
    return {
      workspaceCurrentModelId: "zhipu/glm-4.6",
      workspaceCurrentAgentId: "agent-writer",
      workspaceCurrentRegexGroupId: null,
      llmStreamEnabled: true,
      chatRichTextEnabled: false,
      tokenCounterMode: "auto",
      mockPromptTokenCount: 56100,
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
      sessionMessages: {
        "sess-ch1": [
          {
            id: "m-ch1-1",
            role: "user",
            text: "请帮我润色这一段开场白。",
            hidden: false,
          },
          {
            id: "m-ch1-2",
            role: "assistant",
            text: "好的，这是静态占位回复。原型阶段不接入 Agent 或发送能力。",
            hidden: false,
          },
        ],
        "sess-outline": [
          {
            id: "m-out-1",
            role: "user",
            text: "第三章的大纲需要怎么调整？",
            hidden: false,
          },
          {
            id: "m-out-2",
            role: "assistant",
            text: "建议先明确冲突升级节点，再补一条副线伏笔。",
            hidden: false,
          },
        ],
        "sess-revise": [
          {
            id: "m-rev-1",
            role: "user",
            text: "这段对话节奏有点拖沓。",
            hidden: false,
          },
          {
            id: "m-rev-2",
            role: "assistant",
            text: "可以删掉重复解释，把信息压进动作描写里。",
            hidden: true,
          },
        ],
      },
      workspaceVfs: {
        global: {
          nodes: [
            {
              id: "dir-g-templates",
              kind: "directory",
              name: "templates/",
              path: "/templates",
              depth: 0,
              ruleEnabled: true,
              childCount: 0,
            },
            {
              id: "dir-g-agents",
              kind: "directory",
              name: "agents/",
              path: "/agents",
              depth: 0,
              ruleEnabled: true,
              childCount: 0,
            },
            {
              id: "g-global-yaml",
              kind: "file",
              name: "global-rules.yaml",
              path: "/global-rules.yaml",
              depth: 0,
              fileId: "g-global-yaml",
              inclusion: "show",
              display: "全内容",
            },
            {
              id: "g-shared-md",
              kind: "file",
              name: "shared-prompt.md",
              path: "/shared-prompt.md",
              depth: 0,
              fileId: "g-shared-md",
              inclusion: "auto",
              display: "全内容",
            },
          ],
          directoryRules: {},
        },
        session: {
          nodes: [
            {
              id: "dir-s-template",
              kind: "directory",
              name: "project-template/",
              path: "/project-template",
              depth: 0,
              ruleEnabled: true,
              childCount: 0,
            },
            {
              id: "s-inherit",
              kind: "file",
              name: "inherit-from-global.md",
              path: "/inherit-from-global.md",
              depth: 0,
              fileId: "s-inherit",
              inclusion: "show",
              display: "全内容",
            },
            {
              id: "s-outline",
              kind: "file",
              name: "project-outline.md",
              path: "/project-outline.md",
              depth: 0,
              fileId: "s-outline",
              inclusion: "auto",
              display: "全内容",
            },
          ],
          directoryRules: {},
        },
        chat: {
          nodes: [
            {
              id: "dir-c-chapters",
              kind: "directory",
              name: "chapters/",
              path: "/chapters",
              depth: 0,
              ruleEnabled: true,
              childCount: 1,
            },
            {
              id: "c-ch1",
              kind: "file",
              name: "chapter-01.md",
              path: "/chapters/chapter-01.md",
              depth: 1,
              parentPath: "/chapters",
              fileId: "c-ch1",
              inclusion: "show",
              display: "全内容",
            },
            {
              id: "c-outline",
              kind: "file",
              name: "outline.md",
              path: "/outline.md",
              depth: 0,
              fileId: "c-outline",
              inclusion: "auto",
              display: "全内容",
            },
            {
              id: "dir-c-notes",
              kind: "directory",
              name: "notes/",
              path: "/notes",
              depth: 0,
              ruleEnabled: false,
              childCount: 1,
            },
            {
              id: "c-draft",
              kind: "file",
              name: "draft.txt",
              path: "/notes/draft.txt",
              depth: 1,
              parentPath: "/notes",
              fileId: "c-draft",
              inclusion: "hide",
              display: "不展示",
            },
          ],
          directoryRules: {},
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
    chatLevel: "projects",
    viewId: "projects",
    projectId: null,
    projectName: null,
    sessionId: null,
    sessionName: null,
    workspaceScope: "global",
    conversationTab: "chat",
    previewFileId: null,
    previewEditMode: false,
    activeVfsNodeId: null,
    activeVfsScope: null,
    editingAgentId: null,
    editingProviderId: null,
    editingVendorModelId: null,
    editingRegexGroupId: null,
    editingRegexRuleId: null,
  };

  var messageBatchState = {
    active: false,
    selectedIds: {},
  };

  var MESSAGE_ROLE_LABELS = {
    user: "你",
    assistant: "助手",
  };

  var WORKSPACE_TREE_SCOPES = ["global", "session", "chat"];
  var INCLUSION_LABELS = { auto: "跟随", show: "展示", hide: "隐藏" };
  var DEFAULT_DIRECTORY_RULE = {
    sortField: "name",
    sortDirection: "asc",
    headCount: 1000,
    tailCount: 0,
    fill: "omit",
  };
  var DIRECTORY_RULE_FIELD_LABELS = {
    sortField: { name: "文件名称", ctime: "创建时间", mtime: "更新时间" },
    sortDirection: { asc: "升序", desc: "降序" },
    fill: { filename: "文件名", frontmatter: "头信息", omit: "不展示" },
  };

  var workspaceContextTarget = null;
  var workspaceModalSaveHandler = null;

  var settingsState = {
    viewId: "workspace",
    pageStack: [],
  };

  var SETTINGS_NAV = [
    {
      label: "工作区",
      items: [{ id: "workspace", label: "常规", icon: "🏠" }],
    },
    {
      label: "AI",
      items: [
        { id: "agentsSettings", label: "Agent", icon: "🧠" },
        { id: "providers", label: "服务商与模型", icon: "🔌" },
      ],
    },
    {
      label: "高级",
      items: [
        { id: "compactionConditions", label: "压缩条件", icon: "🗜️" },
        { id: "eventsConfig", label: "事件配置", icon: "⚡" },
        { id: "regexGroups", label: "正则过滤", icon: "🛡️" },
        { id: "globalTemplate", label: "全局模板", icon: "🌐" },
      ],
    },
    {
      label: "数据",
      items: [{ id: "dataManagement", label: "备份与恢复", icon: "💾" }],
    },
  ];

  var SETTINGS_VIEWS = [
    "workspace",
    "dataManagement",
    "agentsSettings",
    "agentEditor",
    "providers",
    "providerDetail",
    "modelSampling",
    "compactionConditions",
    "eventsConfig",
    "regexGroups",
    "regexRules",
    "regexRuleEditor",
    "globalTemplate",
  ];

  var SETTINGS_TOP_LEVEL = {
    workspace: "常规",
    dataManagement: "备份与恢复",
    agentsSettings: "Agent",
    providers: "服务商与模型",
    compactionConditions: "压缩条件",
    eventsConfig: "事件配置",
    regexGroups: "正则过滤",
    globalTemplate: "全局模板",
  };

  function getSettingsNavHighlightId(viewId) {
    if (viewId === "agentEditor") return "agentsSettings";
    if (viewId === "providerDetail" || viewId === "modelSampling") return "providers";
    if (viewId === "regexRules" || viewId === "regexRuleEditor") return "regexGroups";
    return viewId;
  }

  function isSettingsTopLevelView(viewId) {
    return Object.prototype.hasOwnProperty.call(SETTINGS_TOP_LEVEL, viewId);
  }

  function refreshWorkspaceSettingsIfOpen() {
    if (isSettingsOpen() && settingsState.viewId === "workspace") renderWorkspaceView();
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function slugifyId(text) {
    var slug = String(text)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return slug || "id-" + Date.now();
  }

  function findProvider(providerId) {
    return store.providers.find(function (p) { return p.id === providerId; });
  }

  function findProviderModel(providerId, vendorModelId) {
    var provider = findProvider(providerId);
    if (!provider) return null;
    return provider.models.find(function (m) { return m.vendorModelId === vendorModelId; }) || null;
  }

  function getSamplingTemperature(model) {
    if (!model || !model.settings || !model.settings.sampling) return 0.7;
    var sampling = model.settings.sampling;
    if (!sampling.enabled || !sampling.params) return 0.7;
    var openai = sampling.params.openai;
    if (openai && openai.temperature != null) return openai.temperature;
    return 0.7;
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

  var columnWidthsState = { preview: 0, explorer: 0 };
  var columnVisibility = { preview: true, explorer: true, chat: true };
  var columnLayoutMaterialized = false;

  function getWorkspaceElement() {
    return document.querySelector(".workspace");
  }

  function countVisibleWorkspaceColumns(vis) {
    return (vis.preview ? 1 : 0) + (vis.explorer ? 1 : 0) + (vis.chat ? 1 : 0);
  }

  function countWorkspaceSplitters(vis) {
    return Math.max(0, countVisibleWorkspaceColumns(vis) - 1);
  }

  function getColumnMinWidth(key) {
    if (key === "preview") return COLUMN_PREVIEW_MIN_WIDTH;
    if (key === "explorer") return COLUMN_EXPLORER_MIN_WIDTH;
    return COLUMN_CHAT_MIN_WIDTH;
  }

  /** 隐藏栏位后剩余空间扩展优先级：左侧栏 > 右侧栏 > 中间栏 */
  function getFlexibleWorkspaceColumn(vis) {
    if (columnLayoutMaterialized) return null;
    if (countVisibleWorkspaceColumns(vis) === 3) return "chat";
    if (vis.preview) return "preview";
    if (vis.chat) return "chat";
    if (vis.explorer) return "explorer";
    return null;
  }

  function snapColumnWidthsForVisibility(workspace) {
    var vis = columnVisibility;
    if (countVisibleWorkspaceColumns(vis) === 3) {
      return clampColumnWidths(workspace, getDefaultColumnWidths(workspace));
    }
    var flexKey = getFlexibleWorkspaceColumn(vis);
    return {
      preview:
        vis.preview && flexKey !== "preview"
          ? getColumnMinWidth("preview")
          : columnWidthsState.preview,
      explorer:
        vis.explorer && flexKey !== "explorer"
          ? getColumnMinWidth("explorer")
          : columnWidthsState.explorer,
    };
  }

  function getWorkspaceUsableWidth(workspace) {
    return (
      workspace.clientWidth -
      countWorkspaceSplitters(columnVisibility) * COLUMN_SPLITTER_SIZE
    );
  }

  /** 中间栏左分隔条：仅在预览区与工作区之间交换宽度，不挤占右侧栏 */
  function clampPreviewExplorerDragDelta(deltaX) {
    var preview = columnWidthsState.preview;
    var explorer = columnWidthsState.explorer;

    if (deltaX < 0) {
      var maxShrinkPreview = preview - getColumnMinWidth("preview");
      if (maxShrinkPreview <= 0) return 0;
      if (-deltaX > maxShrinkPreview) deltaX = -maxShrinkPreview;
      return deltaX;
    }

    if (deltaX > 0) {
      var maxShrinkExplorer = explorer - getColumnMinWidth("explorer");
      if (maxShrinkExplorer <= 0) return 0;
      if (deltaX > maxShrinkExplorer) deltaX = maxShrinkExplorer;
    }

    return deltaX;
  }

  /** 中间栏右分隔条：仅在工作区与聊天区之间交换宽度 */
  function clampExplorerChatDragDelta(deltaX, workspace) {
    var explorer = columnWidthsState.explorer;
    var vis = columnVisibility;
    var total = getWorkspaceUsableWidth(workspace);
    var previewWidth = vis.preview ? columnWidthsState.preview : 0;

    if (deltaX > 0) {
      var maxExplorer = total - previewWidth - getColumnMinWidth("chat");
      var maxGrowExplorer = maxExplorer - explorer;
      if (maxGrowExplorer <= 0) return 0;
      if (deltaX > maxGrowExplorer) deltaX = maxGrowExplorer;
      return deltaX;
    }

    if (deltaX < 0) {
      var maxShrinkExplorer = explorer - getColumnMinWidth("explorer");
      if (maxShrinkExplorer <= 0) return 0;
      if (-deltaX > maxShrinkExplorer) deltaX = -maxShrinkExplorer;
    }

    return deltaX;
  }

  function clampPreviewChatDragDelta(deltaX, workspace) {
    var preview = columnWidthsState.preview;
    var total = getWorkspaceUsableWidth(workspace);

    if (deltaX < 0) {
      var maxShrinkPreview = preview - getColumnMinWidth("preview");
      if (maxShrinkPreview <= 0) return 0;
      if (-deltaX > maxShrinkPreview) deltaX = -maxShrinkPreview;
      return deltaX;
    }

    if (deltaX > 0) {
      var maxGrowPreview = total - getColumnMinWidth("chat") - preview;
      if (maxGrowPreview <= 0) return 0;
      if (deltaX > maxGrowPreview) deltaX = maxGrowPreview;
    }

    return deltaX;
  }

  function materializeFlexColumns(workspace) {
    if (columnLayoutMaterialized) return;
    columnLayoutMaterialized = true;
    var vis = columnVisibility;
    var widths = {
      preview: columnWidthsState.preview,
      explorer: columnWidthsState.explorer,
    };
    var previewPane = document.getElementById("preview-pane");
    var explorerPane = document.getElementById("explorer-pane");
    if (vis.preview && previewPane) {
      widths.preview = Math.round(previewPane.getBoundingClientRect().width);
    }
    if (vis.explorer && explorerPane) {
      widths.explorer = Math.round(explorerPane.getBoundingClientRect().width);
    }
    commitColumnWidths(workspace, widths);
  }

  function getDefaultColumnWidths(workspace) {
    var total = workspace.clientWidth - COLUMN_SPLITTER_SIZE * 2;
    var ratioSum = 2 + 1 + 2.2;
    return {
      preview: Math.round((total * 2) / ratioSum),
      explorer: Math.round((total * 1) / ratioSum),
    };
  }

  function clampColumnWidths(workspace, widths) {
    var vis = columnVisibility;
    var splitterCount = countWorkspaceSplitters(vis);
    var total = workspace.clientWidth - COLUMN_SPLITTER_SIZE * splitterCount;
    var preview = Math.round(widths.preview);
    var explorer = Math.round(widths.explorer);

    if (countVisibleWorkspaceColumns(vis) <= 1) {
      return { preview: preview, explorer: explorer };
    }

    if (vis.preview && vis.explorer && vis.chat) {
      preview = Math.max(COLUMN_PREVIEW_MIN_WIDTH, preview);
      explorer = Math.max(COLUMN_EXPLORER_MIN_WIDTH, explorer);

      var maxPreview = total - COLUMN_EXPLORER_MIN_WIDTH - COLUMN_CHAT_MIN_WIDTH;
      var maxExplorer = total - COLUMN_PREVIEW_MIN_WIDTH - COLUMN_CHAT_MIN_WIDTH;
      if (maxPreview >= COLUMN_PREVIEW_MIN_WIDTH) {
        preview = Math.min(preview, maxPreview);
      }
      if (maxExplorer >= COLUMN_EXPLORER_MIN_WIDTH) {
        explorer = Math.min(explorer, maxExplorer);
      }

      if (total - preview - explorer < COLUMN_CHAT_MIN_WIDTH) {
        explorer = Math.max(
          COLUMN_EXPLORER_MIN_WIDTH,
          total - preview - COLUMN_CHAT_MIN_WIDTH,
        );
      }
      if (total - preview - explorer < COLUMN_CHAT_MIN_WIDTH) {
        preview = Math.max(
          COLUMN_PREVIEW_MIN_WIDTH,
          total - explorer - COLUMN_CHAT_MIN_WIDTH,
        );
      }

      preview = Math.max(COLUMN_PREVIEW_MIN_WIDTH, preview);
      explorer = Math.max(COLUMN_EXPLORER_MIN_WIDTH, explorer);
    } else if (vis.preview && vis.explorer && !vis.chat) {
      preview = Math.max(
        COLUMN_PREVIEW_MIN_WIDTH,
        Math.min(preview, total - COLUMN_EXPLORER_MIN_WIDTH),
      );
      explorer = Math.max(COLUMN_EXPLORER_MIN_WIDTH, total - preview);
      preview = Math.max(COLUMN_PREVIEW_MIN_WIDTH, total - explorer);
    } else if (vis.preview && !vis.explorer && vis.chat) {
      if (columnLayoutMaterialized) {
        preview = Math.max(
          COLUMN_PREVIEW_MIN_WIDTH,
          Math.min(preview, total - COLUMN_CHAT_MIN_WIDTH),
        );
      }
    } else if (!vis.preview && vis.explorer && vis.chat) {
      if (columnLayoutMaterialized) {
        explorer = Math.max(
          COLUMN_EXPLORER_MIN_WIDTH,
          Math.min(explorer, total - COLUMN_CHAT_MIN_WIDTH),
        );
      }
    } else if (vis.preview && !vis.explorer && !vis.chat) {
      preview = Math.max(
        COLUMN_PREVIEW_MIN_WIDTH,
        Math.min(preview, total),
      );
    } else if (!vis.preview && vis.explorer && !vis.chat) {
      explorer = Math.max(
        COLUMN_EXPLORER_MIN_WIDTH,
        Math.min(explorer, total),
      );
    }

    return { preview: preview, explorer: explorer };
  }

  var WORKSPACE_LAYOUT_IDS = [
    "preview-header",
    "preview-pane",
    "splitter-preview-explorer",
    "explorer-header",
    "explorer-pane",
    "splitter-explorer-chat",
    "rail-header",
    "chat-rail",
  ];

  function setWorkspaceGridItem(id, gridCol, visible) {
    var el = document.getElementById(id);
    if (!el) return;
    if (visible) {
      el.classList.remove("workspace-col-hidden");
      el.style.gridColumn = String(gridCol);
    } else {
      el.classList.add("workspace-col-hidden");
      el.style.gridColumn = "";
    }
  }

  function trackForColumn(key, widths, flexKey) {
    if (flexKey === key) {
      return "minmax(" + getColumnMinWidth(key) + "px, 1fr)";
    }
    if (
      columnLayoutMaterialized &&
      key === "chat" &&
      columnVisibility.chat
    ) {
      var vis = columnVisibility;
      var visibleCount = countVisibleWorkspaceColumns(vis);
      if (visibleCount === 3 || (visibleCount === 2 && !vis.preview && vis.explorer)) {
        return "minmax(" + getColumnMinWidth("chat") + "px, 1fr)";
      }
    }
    if (key === "preview") return widths.preview + "px";
    if (key === "explorer") return widths.explorer + "px";
    return getColumnMinWidth("chat") + "px";
  }

  function applyWorkspaceLayout(workspace) {
    var vis = columnVisibility;
    var widths = columnWidthsState;
    var flexKey = getFlexibleWorkspaceColumn(vis);
    var tracks = [];
    var col = 1;
    var visibleColumns = [];

    WORKSPACE_LAYOUT_IDS.forEach(function (id) {
      setWorkspaceGridItem(id, 0, false);
    });

    if (vis.preview) {
      visibleColumns.push("preview");
      tracks.push(trackForColumn("preview", widths, flexKey));
      setWorkspaceGridItem("preview-header", col, true);
      setWorkspaceGridItem("preview-pane", col, true);
      col += 1;
    }

    if (vis.explorer) {
      if (visibleColumns.length) {
        tracks.push(COLUMN_SPLITTER_SIZE + "px");
        var leftCol = visibleColumns[visibleColumns.length - 1];
        if (leftCol === "preview") {
          setWorkspaceGridItem("splitter-preview-explorer", col, true);
        } else {
          setWorkspaceGridItem("splitter-explorer-chat", col, true);
        }
        col += 1;
      }
      visibleColumns.push("explorer");
      tracks.push(trackForColumn("explorer", widths, flexKey));
      setWorkspaceGridItem("explorer-header", col, true);
      setWorkspaceGridItem("explorer-pane", col, true);
      col += 1;
    }

    if (vis.chat) {
      if (visibleColumns.length) {
        tracks.push(COLUMN_SPLITTER_SIZE + "px");
        var leftColChat = visibleColumns[visibleColumns.length - 1];
        if (leftColChat === "preview") {
          setWorkspaceGridItem("splitter-preview-explorer", col, true);
        } else {
          setWorkspaceGridItem("splitter-explorer-chat", col, true);
        }
        col += 1;
      }
      visibleColumns.push("chat");
      tracks.push(trackForColumn("chat", widths, flexKey));
      setWorkspaceGridItem("rail-header", col, true);
      setWorkspaceGridItem("chat-rail", col, true);
      col += 1;
    }

    workspace.style.gridTemplateColumns = tracks.join(" ");
    workspace.style.setProperty("--col-preview-width", widths.preview + "px");
    workspace.style.setProperty("--col-explorer-width", widths.explorer + "px");
  }

  function commitColumnWidths(workspace, widths) {
    columnWidthsState = clampColumnWidths(workspace, widths);
    applyWorkspaceLayout(workspace);
  }

  function updateColumnToggleButtons() {
    ["preview", "explorer", "chat"].forEach(function (key) {
      var btn = document.getElementById("toggle-column-" + key);
      if (btn) btn.classList.toggle("is-active", columnVisibility[key]);
    });
  }

  function toggleWorkspaceColumn(key) {
    if (!columnVisibility[key] && !Object.prototype.hasOwnProperty.call(columnVisibility, key)) {
      return;
    }
    if (columnVisibility[key] && countVisibleWorkspaceColumns(columnVisibility) <= 1) {
      showToast("至少保留一栏");
      return;
    }
    columnVisibility[key] = !columnVisibility[key];
    columnLayoutMaterialized = false;
    var workspace = getWorkspaceElement();
    if (!workspace) return;
    commitColumnWidths(workspace, snapColumnWidthsForVisibility(workspace));
    updateColumnToggleButtons();
    var labels = { preview: "左侧栏", explorer: "中间栏", chat: "右侧栏" };
    showToast(
      (columnVisibility[key] ? "已显示" : "已隐藏") + (labels[key] || ""),
    );
  }

  function bindColumnSplitterDrag(splitterEl, onDrag) {
    if (!splitterEl) return;
    splitterEl.addEventListener("mousedown", function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      var workspace = getWorkspaceElement();
      if (workspace) materializeFlexColumns(workspace);
      splitterEl.classList.add("is-dragging");
      document.body.classList.add("is-column-resizing");
      var lastX = e.clientX;
      function onMove(ev) {
        var delta = ev.clientX - lastX;
        if (delta !== 0) {
          onDrag(delta);
          lastX = ev.clientX;
        }
      }
      function onUp() {
        splitterEl.classList.remove("is-dragging");
        document.body.classList.remove("is-column-resizing");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  function initColumnSplitters() {
    var workspace = getWorkspaceElement();
    if (!workspace) return;

    columnVisibility = { preview: true, explorer: true, chat: true };
    commitColumnWidths(workspace, getDefaultColumnWidths(workspace));
    updateColumnToggleButtons();

    bindColumnSplitterDrag(
      document.getElementById("splitter-preview-explorer"),
      function (deltaX) {
        if (columnVisibility.preview && columnVisibility.explorer) {
          deltaX = clampPreviewExplorerDragDelta(deltaX);
          if (deltaX === 0) return;
          commitColumnWidths(workspace, {
            preview: columnWidthsState.preview + deltaX,
            explorer: columnWidthsState.explorer - deltaX,
          });
          return;
        }
        if (columnVisibility.preview && columnVisibility.chat) {
          deltaX = clampPreviewChatDragDelta(deltaX, workspace);
          if (deltaX === 0) return;
          commitColumnWidths(workspace, {
            preview: columnWidthsState.preview + deltaX,
            explorer: columnWidthsState.explorer,
          });
        }
      },
    );

    bindColumnSplitterDrag(
      document.getElementById("splitter-explorer-chat"),
      function (deltaX) {
        if (columnVisibility.explorer && columnVisibility.chat) {
          deltaX = clampExplorerChatDragDelta(deltaX, workspace);
          if (deltaX === 0) return;
          commitColumnWidths(workspace, {
            preview: columnWidthsState.preview,
            explorer: columnWidthsState.explorer + deltaX,
          });
        }
      },
    );

    ["preview", "explorer", "chat"].forEach(function (key) {
      var btn = document.getElementById("toggle-column-" + key);
      if (btn) {
        btn.addEventListener("click", function () {
          toggleWorkspaceColumn(key);
        });
      }
    });

    window.addEventListener("resize", function () {
      if (columnLayoutMaterialized) {
        commitColumnWidths(workspace, columnWidthsState);
        return;
      }
      commitColumnWidths(workspace, snapColumnWidthsForVisibility(workspace));
    });
  }

  function settingsRoot() {
    return document.getElementById("settings-page-root");
  }

  function isSettingsOpen() {
    var page = document.getElementById("settings-page");
    return page && !page.hidden;
  }

  function updateSettingsOpenButton() {
    var btn = document.getElementById("settings-open");
    if (!btn) return;
    btn.classList.toggle("is-active", isSettingsOpen());
    btn.setAttribute("aria-label", isSettingsOpen() ? "关闭设置" : "打开设置");
  }

  function openSettings() {
    var main = document.getElementById("main-shell");
    var page = document.getElementById("settings-page");
    if (!main || !page) return;
    main.classList.add("hidden");
    main.hidden = true;
    page.classList.remove("hidden");
    page.hidden = false;
    page.setAttribute("aria-hidden", "false");
    settingsState.pageStack = [];
    showSettingsView("workspace");
    updateSettingsOpenButton();
  }

  function closeSettings() {
    var main = document.getElementById("main-shell");
    var page = document.getElementById("settings-page");
    if (!main || !page) return;
    page.classList.add("hidden");
    page.hidden = true;
    page.setAttribute("aria-hidden", "true");
    main.classList.remove("hidden");
    main.hidden = false;
    settingsState.pageStack = [];
    settingsState.viewId = "workspace";
    updateSettingsOpenButton();
  }

  function toggleSettings() {
    if (isSettingsOpen()) closeSettings();
    else openSettings();
  }

  function renderSettingsNav(activeViewId) {
    var nav = document.getElementById("settings-nav");
    if (!nav) return;
    var highlightId = getSettingsNavHighlightId(activeViewId);
    var html = '<div class="settings-nav__brand">设置</div>';
    SETTINGS_NAV.forEach(function (section) {
      html += '<div class="settings-nav__section">';
      html += '<div class="settings-nav__heading">' + escapeHtml(section.label) + "</div>";
      section.items.forEach(function (item) {
        html +=
          '<button type="button" class="settings-nav__item' +
          (item.id === highlightId ? " is-active" : "") +
          '" data-settings-nav="' +
          escapeHtml(item.id) +
          '">' +
          '<span class="settings-nav__icon" aria-hidden="true">' +
          item.icon +
          "</span>" +
          escapeHtml(item.label) +
          "</button>";
      });
      html += "</div>";
    });
    nav.innerHTML = html;
  }

  function getSettingsMainTitle(viewId) {
    if (viewId === "agentEditor") {
      var agent = store.agents[navState.editingAgentId];
      return agent ? agent.definition.name : "Agent 配置";
    }
    if (viewId === "providerDetail") {
      var provider = findProvider(navState.editingProviderId);
      return provider ? provider.name + " · 模型" : "模型管理";
    }
    if (viewId === "modelSampling") {
      var model = findProviderModel(navState.editingProviderId, navState.editingVendorModelId);
      return model ? model.label + " · 采样" : "采样配置";
    }
    if (viewId === "regexRules") {
      var group = store.regexGroups.find(function (g) {
        return g.groupId === navState.editingRegexGroupId;
      });
      return group ? (group.displayName || group.groupId) + " · 规则" : "正则规则";
    }
    if (viewId === "regexRuleEditor") {
      var rules = store.regexRules[navState.editingRegexGroupId] || [];
      var rule = navState.editingRegexRuleId
        ? rules.find(function (r) { return r.ruleId === navState.editingRegexRuleId; })
        : null;
      return rule ? rule.name : "新规则";
    }
    return SETTINGS_TOP_LEVEL[viewId] || "设置";
  }

  function updateSettingsMainHeader(viewId) {
    var titleEl = document.getElementById("settings-main-title");
    var backEl = document.getElementById("settings-main-back");
    if (titleEl) titleEl.textContent = getSettingsMainTitle(viewId);
    if (backEl) backEl.classList.toggle("hidden", isSettingsTopLevelView(viewId));
  }

  function updateSettingsTitle(viewId) {
    renderSettingsNav(viewId);
    updateSettingsMainHeader(viewId);
  }

  function showSettingsView(viewId) {
    settingsState.viewId = viewId;
    updateSettingsTitle(viewId);
    renderSettingsContent(viewId);
  }

  function pushSettingsView(viewId) {
    settingsState.pageStack.push(settingsState.viewId);
    showSettingsView(viewId);
  }

  function popSettingsView() {
    if (settingsState.pageStack.length === 0) return;
    showSettingsView(settingsState.pageStack.pop());
  }

  function navigateSettingsTopLevel(viewId) {
    settingsState.pageStack = [];
    showSettingsView(viewId);
  }

  function updateWorkspaceToolbar() {
    var footer = document.getElementById("workspace-footer");
    if (!footer) return;
    var inConversation = navState.viewId === "conversation";
    footer.classList.toggle("hidden", !inConversation);
    footer.hidden = !inConversation;
    updateConversationMeta();
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
    renderWorkspaceTree(scope);
  }

  function ensureWorkspaceVfs(scope) {
    if (!store.workspaceVfs) store.workspaceVfs = seedStore().workspaceVfs;
    if (!store.workspaceVfs[scope]) {
      store.workspaceVfs[scope] = { nodes: [], directoryRules: {} };
    }
    if (!store.workspaceVfs[scope].directoryRules) {
      store.workspaceVfs[scope].directoryRules = {};
    }
    return store.workspaceVfs[scope];
  }

  function vfsFindNode(scope, nodeId) {
    var vfs = ensureWorkspaceVfs(scope);
    return vfs.nodes.find(function (n) { return n.id === nodeId; }) || null;
  }

  function vfsRuleKey(scope, path) {
    return scope + "::" + path;
  }

  function vfsGetDirectoryRule(scope, path) {
    var vfs = ensureWorkspaceVfs(scope);
    var key = vfsRuleKey(scope, path);
    if (!vfs.directoryRules[key]) {
      vfs.directoryRules[key] = Object.assign({}, DEFAULT_DIRECTORY_RULE);
    }
    return vfs.directoryRules[key];
  }

  function vfsEntryStatusText(entry) {
    if (entry.kind === "directory") {
      var rule = entry.ruleEnabled !== false ? "规则·开" : "规则·关";
      return entry.childCount ? rule + " · " + entry.childCount + " 项" : rule;
    }
    return (INCLUSION_LABELS[entry.inclusion] || entry.inclusion) + " · " + (entry.display || "全内容");
  }

  function renderWorkspaceTree(scope) {
    var container = document.getElementById("workspace-tree-" + scope);
    if (!container) return;
    var vfs = ensureWorkspaceVfs(scope);
    var nodes = vfs.nodes.slice().sort(function (a, b) {
      if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-CN");
    });
    if (nodes.length === 0) {
      container.innerHTML = '<p class="tree-empty">空目录</p>';
      return;
    }
    container.innerHTML = nodes
      .map(function (entry) {
        var isDir = entry.kind === "directory";
        var depth = entry.depth || 0;
        var classes = "tree-node" + (isDir ? " tree-node--folder" : "");
        if (navState.activeVfsNodeId === entry.id && navState.activeVfsScope === scope) {
          classes += " is-active";
        }
        var html =
          '<div class="' +
          classes +
          '" data-vfs-scope="' +
          escapeHtml(scope) +
          '" data-vfs-id="' +
          escapeHtml(entry.id) +
          '" data-vfs-kind="' +
          entry.kind +
          '"';
        if (entry.fileId) {
          html += ' data-file-id="' + escapeHtml(entry.fileId) + '" data-file-name="' + escapeHtml(entry.name) + '"';
        }
        html += ' style="padding-left:' + (10 + depth * 14) + 'px">';
        html += '<span class="tree-node__icon">' + (isDir ? "📁" : "📄") + "</span>";
        html += '<span class="tree-node__label">' + escapeHtml(entry.name) + "</span>";
        html += '<span class="tree-node__meta">' + escapeHtml(vfsEntryStatusText(entry)) + "</span>";
        html += "</div>";
        return html;
      })
      .join("");
  }

  function renderAllWorkspaceTrees() {
    WORKSPACE_TREE_SCOPES.forEach(renderWorkspaceTree);
  }

  function closeWorkspaceContextMenu() {
    var menu = document.getElementById("workspace-context-menu");
    if (menu) menu.classList.add("hidden");
    workspaceContextTarget = null;
  }

  function openWorkspaceContextMenu(anchorEvent, scope, nodeId) {
    var menu = document.getElementById("workspace-context-menu");
    var entry = vfsFindNode(scope, nodeId);
    if (!menu || !entry) return;
    workspaceContextTarget = { scope: scope, nodeId: nodeId };
    var isDir = entry.kind === "directory";
    var items = isDir
      ? [
          { action: "rule-config", label: "规则配置" },
          { action: "rename", label: "重命名" },
          { action: "delete", label: "删除", danger: true },
        ]
      : [
          { action: "include-hide", label: "隐藏文件" },
          { action: "include-show", label: "展示文件" },
          { action: "include-follow", label: "跟随目录" },
          { action: "rename", label: "重命名" },
          { action: "delete", label: "删除文件", danger: true },
        ];
    menu.innerHTML = items
      .map(function (item) {
        return (
          '<button type="button" data-workspace-action="' +
          item.action +
          '"' +
          (item.danger ? ' class="is-danger"' : "") +
          ">" +
          escapeHtml(item.label) +
          "</button>"
        );
      })
      .join("");
    menu.style.left = Math.max(8, anchorEvent.clientX) + "px";
    menu.style.top = Math.max(8, anchorEvent.clientY) + "px";
    menu.classList.remove("hidden");
  }

  function closeWorkspaceModal() {
    var modal = document.getElementById("workspace-modal");
    if (modal) {
      modal.classList.add("hidden");
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
    workspaceModalSaveHandler = null;
  }

  function openWorkspaceModal(title, bodyHtml, saveLabel, onSave) {
    var modal = document.getElementById("workspace-modal");
    var titleEl = document.getElementById("workspace-modal-title");
    var bodyEl = document.getElementById("workspace-modal-body");
    var footerEl = document.getElementById("workspace-modal-footer");
    if (!modal || !titleEl || !bodyEl || !footerEl) return;
    titleEl.textContent = title;
    bodyEl.innerHTML = bodyHtml;
    footerEl.innerHTML =
      '<button type="button" class="workspace-modal__btn" data-action="close-workspace-modal">取消</button>' +
      '<button type="button" class="workspace-modal__btn workspace-modal__btn--primary" data-action="save-workspace-modal">' +
      escapeHtml(saveLabel || "保存") +
      "</button>";
    workspaceModalSaveHandler = onSave;
    modal.classList.remove("hidden");
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    bodyEl.querySelectorAll("input[type='range']").forEach(function (input) {
      input.addEventListener("input", function () {
        var output = bodyEl.querySelector('[data-rule-output="' + input.getAttribute("data-rule-field") + '"]');
        if (output) output.textContent = input.value;
      });
    });
  }

  function openDirectoryRuleModal(scope, entry) {
    var rule = vfsGetDirectoryRule(scope, entry.path);
    var html = '<p class="workspace-modal__path">' + escapeHtml(entry.path) + "</p>";
    html +=
      '<label class="rail-field rail-field--row"><span>规则开关</span><input type="checkbox" data-dir-field="ruleEnabled"' +
      (entry.ruleEnabled !== false ? " checked" : "") +
      "></label>";
    html += '<label class="rail-field"><span>排序方式</span><select data-rule-field="sortField">';
    html += '<option value="name"' + (rule.sortField === "name" ? " selected" : "") + ">文件名称</option>";
    html += '<option value="ctime"' + (rule.sortField === "ctime" ? " selected" : "") + ">创建时间</option>";
    html += '<option value="mtime"' + (rule.sortField === "mtime" ? " selected" : "") + ">更新时间</option>";
    html += "</select></label>";
    html += '<label class="rail-field"><span>排序方向</span><select data-rule-field="sortDirection">';
    html += '<option value="asc"' + (rule.sortDirection === "asc" ? " selected" : "") + ">升序</option>";
    html += '<option value="desc"' + (rule.sortDirection === "desc" ? " selected" : "") + ">降序</option>";
    html += "</select></label>";
    html +=
      '<label class="rail-field"><span>头部读取</span><input type="range" min="0" max="1000" step="1" data-rule-field="headCount" value="' +
      rule.headCount +
      '"><output data-rule-output="headCount">' +
      rule.headCount +
      "</output></label>";
    html +=
      '<label class="rail-field"><span>尾部读取</span><input type="range" min="0" max="1000" step="1" data-rule-field="tailCount" value="' +
      rule.tailCount +
      '"><output data-rule-output="tailCount">' +
      rule.tailCount +
      "</output></label>";
    html += '<label class="rail-field"><span>填充策略</span><select data-rule-field="fill">';
    html += '<option value="filename"' + (rule.fill === "filename" ? " selected" : "") + ">文件名</option>";
    html += '<option value="frontmatter"' + (rule.fill === "frontmatter" ? " selected" : "") + ">头信息</option>";
    html += '<option value="omit"' + (rule.fill === "omit" ? " selected" : "") + ">不展示</option>";
    html += "</select></label>";
    openWorkspaceModal("目录纳入规则", html, "保存", function () {
      var bodyEl = document.getElementById("workspace-modal-body");
      if (!bodyEl) return;
      var enabledEl = bodyEl.querySelector("[data-dir-field='ruleEnabled']");
      entry.ruleEnabled = enabledEl ? enabledEl.checked : true;
      var nextRule = Object.assign({}, rule);
      bodyEl.querySelectorAll("[data-rule-field]").forEach(function (field) {
        var key = field.getAttribute("data-rule-field");
        if (field.type === "range") nextRule[key] = Number(field.value);
        else nextRule[key] = field.value;
      });
      ensureWorkspaceVfs(scope).directoryRules[vfsRuleKey(scope, entry.path)] = nextRule;
      persistStore();
      renderWorkspaceTree(scope);
      closeWorkspaceModal();
      var sortLabel =
        DIRECTORY_RULE_FIELD_LABELS.sortField[nextRule.sortField] || nextRule.sortField;
      showToast("已保存目录规则（" + sortLabel + " · head " + nextRule.headCount + "）");
    });
  }

  function vfsSetFileInclusion(scope, entry, inclusion) {
    entry.inclusion = inclusion;
    if (inclusion === "show") entry.display = "全内容";
    else if (inclusion === "hide") entry.display = "不展示";
    else entry.display = "全内容";
    persistStore();
    renderWorkspaceTree(scope);
    showToast("纳入方式：" + (INCLUSION_LABELS[inclusion] || inclusion));
  }

  function vfsRenameNode(scope, entry) {
    var next = prompt("名称", entry.name);
    if (!next || !next.trim()) return;
    var newName = next.trim();
    if (entry.kind === "directory" && !newName.endsWith("/")) newName += "/";
    var oldPath = entry.path;
    var parentPath = oldPath.substring(0, oldPath.lastIndexOf("/")) || "";
    var newPath = (parentPath || "") + "/" + newName.replace(/\/$/, "");
    if (entry.kind === "directory") newPath = newPath.replace(/\/+/g, "/");
    else newPath = (parentPath ? parentPath : "") + "/" + newName;
    if (!newPath.startsWith("/")) newPath = "/" + newPath.replace(/^\/+/, "");
    entry.name = newName;
    entry.path = newPath;
    if (entry.fileId && store.previewFiles[entry.fileId]) {
      store.previewFiles[entry.fileId].name = newName.replace(/\/$/, "");
    }
    if (entry.kind === "directory") {
      ensureWorkspaceVfs(scope).nodes.forEach(function (node) {
        if (node.path !== oldPath && node.path.indexOf(oldPath + "/") === 0) {
          node.path = newPath + node.path.slice(oldPath.length);
          if (node.parentPath === oldPath) node.parentPath = newPath;
        }
      });
      var rules = ensureWorkspaceVfs(scope).directoryRules;
      var oldKey = vfsRuleKey(scope, oldPath);
      if (rules[oldKey]) {
        rules[vfsRuleKey(scope, newPath)] = rules[oldKey];
        delete rules[oldKey];
      }
    }
    persistStore();
    renderWorkspaceTree(scope);
    showToast("已重命名");
  }

  function vfsDeleteNode(scope, entry) {
    if (!confirm("确定删除「" + entry.name + "」？")) return;
    var vfs = ensureWorkspaceVfs(scope);
    var removeIds = [entry.id];
    if (entry.kind === "directory") {
      vfs.nodes.forEach(function (node) {
        if (node.id !== entry.id && node.path.indexOf(entry.path + "/") === 0) {
          removeIds.push(node.id);
        }
      });
    }
    removeIds.forEach(function (id) {
      var node = vfsFindNode(scope, id);
      if (node && node.fileId) {
        delete store.previewFiles[node.fileId];
        if (navState.previewFileId === node.fileId) {
          navState.previewFileId = null;
    var filenameEl = document.getElementById("preview-filename");
    var bodyEl = document.getElementById("preview-body");
          if (filenameEl) filenameEl.textContent = "—";
          if (bodyEl) {
            bodyEl.classList.remove("hidden");
            bodyEl.innerHTML = '<p class="preview-empty">在工作区选择文件以预览</p>';
          }
        }
      }
    });
    vfs.nodes = vfs.nodes.filter(function (node) {
      return removeIds.indexOf(node.id) < 0;
    });
    delete vfs.directoryRules[vfsRuleKey(scope, entry.path)];
    if (navState.activeVfsNodeId && removeIds.indexOf(navState.activeVfsNodeId) >= 0) {
      navState.activeVfsNodeId = null;
      navState.activeVfsScope = null;
    }
    persistStore();
    renderWorkspaceTree(scope);
    showToast("已删除");
  }

  function handleWorkspaceContextAction(action) {
    if (!workspaceContextTarget) return;
    var scope = workspaceContextTarget.scope;
    var entry = vfsFindNode(scope, workspaceContextTarget.nodeId);
    closeWorkspaceContextMenu();
    if (!entry) return;
    if (action === "rule-config" && entry.kind === "directory") {
      openDirectoryRuleModal(scope, entry);
      return;
    }
    if (action === "include-hide" && entry.kind === "file") {
      vfsSetFileInclusion(scope, entry, "hide");
      return;
    }
    if (action === "include-show" && entry.kind === "file") {
      vfsSetFileInclusion(scope, entry, "show");
      return;
    }
    if (action === "include-follow" && entry.kind === "file") {
      vfsSetFileInclusion(scope, entry, "auto");
      return;
    }
    if (action === "rename") {
      vfsRenameNode(scope, entry);
      return;
    }
    if (action === "delete") {
      vfsDeleteNode(scope, entry);
    }
  }

  /** Sync explorer title/panel with current chat nav view. */
  function syncWorkspaceWithNav(viewId) {
    if (SETTINGS_VIEWS.indexOf(viewId) >= 0) return;
    setWorkspaceScope(NAV_TO_WORKSPACE[viewId] || "global");
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
    updateRailPaneNav(viewId);
    updateWorkspaceToolbar();
    if (viewId === "conversation") {
      navState.conversationTab = "chat";
      updateConversationPanels();
      renderChatMessages();
    } else {
      exitMessageBatchMode();
    }
  }

  function getSessionMessages(sessionId) {
    if (!sessionId) return [];
    if (!store.sessionMessages) store.sessionMessages = {};
    if (!store.sessionMessages[sessionId]) {
      store.sessionMessages[sessionId] = [];
    }
    return store.sessionMessages[sessionId];
  }

  function getSelectedMessageCount() {
    return Object.keys(messageBatchState.selectedIds).filter(function (id) {
      return messageBatchState.selectedIds[id];
    }).length;
  }

  function updateBatchBar() {
    var bar = document.getElementById("chat-batch-bar");
    var composer = document.getElementById("chat-composer");
    var countEl = document.getElementById("chat-batch-count");
    var selectedCount = getSelectedMessageCount();
    if (bar) {
      bar.classList.toggle("hidden", !messageBatchState.active);
      bar.hidden = !messageBatchState.active;
    }
    if (composer) {
      composer.classList.toggle("hidden", messageBatchState.active);
      composer.hidden = messageBatchState.active;
    }
    if (countEl) countEl.textContent = "已选 " + selectedCount + " 项";
    document.querySelectorAll("[data-action='batch-delete'], [data-action='batch-hide'], [data-action='batch-restore']").forEach(function (btn) {
      btn.disabled = selectedCount === 0;
    });
    var messagesEl = document.getElementById("chat-messages");
    if (messagesEl) {
      messagesEl.classList.toggle("chat-messages--batch", messageBatchState.active);
    }
  }

  function renderChatMessages() {
    var container = document.getElementById("chat-messages");
    if (!container) return;
    var messages = getSessionMessages(navState.sessionId);
    if (messages.length === 0) {
      container.innerHTML = '<p class="chat-messages__empty">暂无消息</p>';
      updateBatchBar();
      return;
    }
    container.innerHTML = messages
      .map(function (msg) {
        var roleLabel = MESSAGE_ROLE_LABELS[msg.role] || msg.role;
        var selected = !!messageBatchState.selectedIds[msg.id];
        var classes = "chat-message chat-message--" + msg.role;
        if (msg.hidden) classes += " chat-message--hidden";
        if (messageBatchState.active) classes += " chat-message--batch";
        if (selected) classes += " is-selected";
        var html =
          '<div class="' +
          classes +
          '" data-message-id="' +
          escapeHtml(msg.id) +
          '">';
        if (messageBatchState.active) {
          html +=
            '<label class="chat-message__check" aria-label="选择消息">' +
            '<input type="checkbox"' +
            (selected ? " checked" : "") +
            "></label>";
        }
        html +=
          '<div class="chat-message__body">' +
          '<span class="chat-message__role">' +
          escapeHtml(roleLabel) +
          (msg.hidden ? ' <span class="chat-message__hidden-tag">已隐藏</span>' : "") +
          "</span>" +
          "<p>" +
          escapeHtml(msg.text) +
          "</p></div></div>";
        return html;
      })
      .join("");
    updateBatchBar();
  }

  function enterMessageBatchMode() {
    if (navState.viewId !== "conversation") return;
    setConversationTab("chat");
    messageBatchState.active = true;
    messageBatchState.selectedIds = {};
    renderChatMessages();
    showToast("选择要操作的消息");
  }

  function exitMessageBatchMode() {
    if (!messageBatchState.active) return;
    messageBatchState.active = false;
    messageBatchState.selectedIds = {};
    renderChatMessages();
  }

  function toggleMessageSelection(messageId) {
    if (!messageBatchState.active || !messageId) return;
    if (messageBatchState.selectedIds[messageId]) {
      delete messageBatchState.selectedIds[messageId];
    } else {
      messageBatchState.selectedIds[messageId] = true;
    }
    renderChatMessages();
  }

  function getSelectedMessageIds() {
    return Object.keys(messageBatchState.selectedIds).filter(function (id) {
      return messageBatchState.selectedIds[id];
    });
  }

  function batchDeleteMessages() {
    var ids = getSelectedMessageIds();
    if (ids.length === 0) return;
    if (!confirm("确定删除选中的 " + ids.length + " 条消息？")) return;
    var messages = getSessionMessages(navState.sessionId);
    store.sessionMessages[navState.sessionId] = messages.filter(function (msg) {
      return ids.indexOf(msg.id) < 0;
    });
    persistStore();
    exitMessageBatchMode();
    showToast("已删除 " + ids.length + " 条消息");
  }

  function batchHideMessages() {
    var ids = getSelectedMessageIds();
    if (ids.length === 0) return;
    if (!confirm("确定隐藏选中的 " + ids.length + " 条消息？")) return;
    getSessionMessages(navState.sessionId).forEach(function (msg) {
      if (ids.indexOf(msg.id) >= 0) msg.hidden = true;
    });
    persistStore();
    exitMessageBatchMode();
    showToast("已隐藏 " + ids.length + " 条消息");
  }

  function batchRestoreMessages() {
    var ids = getSelectedMessageIds();
    if (ids.length === 0) return;
    if (!confirm("确定恢复选中的 " + ids.length + " 条消息？")) return;
    getSessionMessages(navState.sessionId).forEach(function (msg) {
      if (ids.indexOf(msg.id) >= 0) msg.hidden = false;
    });
    persistStore();
    exitMessageBatchMode();
    showToast("已恢复 " + ids.length + " 条消息");
  }

  function promptPreviewLine(body) {
    var line = String(body || "").replace(/\r\n/g, "\n").split("\n")[0].trim();
    if (line.length <= 72) return line;
    return line.slice(0, 69) + "…";
  }

  function renderPromptSegmentCard(segment) {
    var roleLabel = PROMPT_ROLE_LABELS[segment.role] || segment.role;
    var charCount = segment.body ? segment.body.length : 0;
    var collapsedHint = charCount === 0 ? "空内容" : promptPreviewLine(segment.body);
    if (charCount > 0 && !collapsedHint) collapsedHint = charCount + " 字";
    var countSuffix = charCount > 0 ? " · " + charCount + " 字" : "";

    return (
      '<div class="prompt-segment" data-segment-id="' + escapeHtml(segment.id) + '">' +
      '<button type="button" class="prompt-segment__header" data-action="toggle-prompt-segment" aria-expanded="false">' +
      '<span class="prompt-segment__text">' +
      '<span class="prompt-segment__role">' + escapeHtml(roleLabel) + "</span>" +
      '<span class="prompt-segment__title">' + escapeHtml(segment.title) + "</span>" +
      '<span class="prompt-segment__preview">' + escapeHtml(collapsedHint + countSuffix) + "</span>" +
      "</span>" +
      '<span class="prompt-segment__chevron" aria-hidden="true">▶</span>' +
      "</button>" +
      '<pre class="prompt-segment__body">' + escapeHtml(segment.body || "（空）") + "</pre>" +
      "</div>"
    );
  }

  function renderRealPromptPanel() {
    var root = document.getElementById("real-prompt-list");
    if (!root) return;
    var html = MOCK_REAL_PROMPT_SEGMENTS.map(renderPromptSegmentCard).join("");
    html += '<p class="real-prompt-hint">在会话工作区调整纳入规则可改变预览内容。默认折叠以减轻长文本渲染压力。</p>';
    root.innerHTML = html;
  }

  function setConversationTab(tab) {
    if (tab !== "chat" && messageBatchState.active) exitMessageBatchMode();
    navState.conversationTab = tab === "realPrompt" ? "realPrompt" : "chat";
    updateConversationPanels();
  }

  function updateConversationPanels() {
    if (navState.viewId !== "conversation") return;
    document.querySelectorAll("[data-conversation-tab]").forEach(function (btn) {
      var tab = btn.getAttribute("data-conversation-tab");
      var active = tab === navState.conversationTab;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-conversation-panel]").forEach(function (panel) {
      var tab = panel.getAttribute("data-conversation-panel");
      var active = tab === navState.conversationTab;
      panel.classList.toggle("is-visible", active);
      panel.hidden = !active;
    });
    if (navState.conversationTab === "realPrompt") renderRealPromptPanel();
  }

  function updateRailPaneNav(viewId) {
    var nav = document.getElementById("rail-pane-nav");
    if (!nav) return;

    var html = "";
    var showBack = viewId === "sessions" || viewId === "conversation";
    if (showBack) {
      var backAction = viewId === "sessions" ? "back-to-projects" : "back-to-sessions";
      html +=
        '<button type="button" class="chat-nav-back" data-action="' + backAction + '" aria-label="返回">‹</button>';
    }

    if (viewId === "sessions") {
      html +=
        '<span class="column-header__title column-header__title--truncate">' +
        escapeHtml(navState.projectName || "—") +
        "</span>";
    } else if (viewId === "conversation") {
      html +=
        '<span class="column-header__title column-header__title--truncate">' +
        escapeHtml(navState.sessionName || "—") +
        "</span>";
    } else {
      html += '<span class="column-header__title">' + escapeHtml(getRailPaneNavTitle(viewId)) + "</span>";
    }

    nav.innerHTML = html;
  }

  function getRailPaneNavTitle(viewId) {
    if (viewId === "projects") return "项目";
    return "—";
  }

  function settingsRow(label, value, action) {
    return (
      '<button type="button" class="settings-row" data-profile-action="' + action + '">' +
      '<span class="settings-row__label">' + escapeHtml(label) + "</span>" +
      (value ? '<span class="settings-row__value">' + escapeHtml(value) + "</span>" : "") +
      '<span class="settings-row__chevron">›</span></button>'
    );
  }

  function settingsSwitchRow(label, action, checked) {
    return (
      '<div class="settings-row settings-row--static">' +
      '<span class="settings-row__label">' + escapeHtml(label) + "</span>" +
      '<label class="settings-switch"><input type="checkbox" data-profile-switch="' + action + '"' +
      (checked ? " checked" : "") + '><span class="settings-switch-slider"></span></label></div>'
    );
  }

  function settingsSwitchField(label, fieldAttr, checked) {
    return (
      '<label class="settings-field settings-field--row">' +
      '<span class="settings-field__label">' + escapeHtml(label) + "</span>" +
      '<span class="settings-switch"><input type="checkbox" ' + fieldAttr +
      (checked ? " checked" : "") + '><span class="settings-switch-slider"></span></span></label>'
    );
  }

  function settingsField(label, controlHtml) {
    return (
      '<label class="settings-field">' +
      '<span class="settings-field__label">' + escapeHtml(label) + "</span>" +
      controlHtml +
      "</label>"
    );
  }

  function settingsFormSection(title, desc, bodyHtml, actionsHtml) {
    var html = '<section class="settings-section settings-section--form">';
    if (title) html += '<h3 class="settings-section__title">' + escapeHtml(title) + "</h3>";
    if (desc) html += '<p class="settings-section__desc">' + escapeHtml(desc) + "</p>";
    if (bodyHtml) html += '<div class="settings-form-body">' + bodyHtml + "</div>";
    if (actionsHtml) {
      html += '<div class="settings-form-actions">' + actionsHtml + "</div>";
    }
    html += "</section>";
    return html;
  }

  function settingsActionSection(title, desc, actionsHtml) {
    return (
      '<section class="settings-section settings-section--form">' +
      '<h3 class="settings-section__title">' + escapeHtml(title) + "</h3>" +
      '<p class="settings-section__desc">' + escapeHtml(desc) + "</p>" +
      '<div class="settings-form-actions settings-form-actions--solo">' + actionsHtml + "</div>" +
      "</section>"
    );
  }

  function settingsListSection(toolbarHtml, listHtml) {
    var html = '<section class="settings-section settings-section--list">';
    if (toolbarHtml) html += '<div class="settings-toolbar">' + toolbarHtml + "</div>";
    html += '<div class="settings-list">' + listHtml + "</div></section>";
    return html;
  }

  function settingsListItem(label, attrs, meta) {
    var attrStr = "";
    Object.keys(attrs || {}).forEach(function (key) {
      attrStr += " " + key + '="' + escapeHtml(attrs[key]) + '"';
    });
    return (
      '<button type="button" class="settings-list-item"' + attrStr + ">" +
      '<span class="settings-list-item__label">' + escapeHtml(label) + "</span>" +
      (meta ? '<span class="settings-list-item__meta">' + escapeHtml(meta) + "</span>" : "") +
      '<span class="settings-list-item__chevron">›</span></button>'
    );
  }

  function settingsListItemRow(label, itemAttrs, menuAttrs, meta) {
    var itemAttrStr = "";
    var menuAttrStr = "";
    Object.keys(itemAttrs || {}).forEach(function (key) {
      itemAttrStr += " " + key + '="' + escapeHtml(itemAttrs[key]) + '"';
    });
    Object.keys(menuAttrs || {}).forEach(function (key) {
      menuAttrStr += " " + key + '="' + escapeHtml(menuAttrs[key]) + '"';
    });
    return (
      '<div class="settings-list-item-row">' +
      '<button type="button" class="settings-list-item"' + itemAttrStr + ">" +
      '<span class="settings-list-item__label">' + escapeHtml(label) + "</span>" +
      (meta ? '<span class="settings-list-item__meta">' + escapeHtml(meta) + "</span>" : "") +
      '<span class="settings-list-item__chevron">›</span></button>' +
      '<button type="button" class="settings-list-item__menu-btn"' + menuAttrStr + ' aria-label="更多">⋮</button>' +
      "</div>"
    );
  }

  function renderWorkspaceView() {
    var root = settingsRoot();
    if (!root) return;

    var agentName = store.agents[store.workspaceCurrentAgentId];
    var agentLabel = agentName ? agentName.definition.name : "—";
    var regexLabel = "不启用";
    if (store.workspaceCurrentRegexGroupId) {
      var g = store.regexGroups.find(function (x) { return x.groupId === store.workspaceCurrentRegexGroupId; });
      regexLabel = g ? (g.displayName || g.groupId) : "不启用";
    }

    var html = '<div class="settings-panel">';
    html += '<section class="settings-section">';
    html += '<h3 class="settings-section__title">默认选择</h3>';
    html += '<p class="settings-section__desc">新建会话时使用的工作区默认值，也可在会话底部随时切换。</p>';
    html += '<div class="settings-rows">';
    html += settingsRow("当前模型", store.workspaceCurrentModelId, "pick-model");
    html += settingsRow("当前 Agent", agentLabel, "pick-agent");
    html += settingsRow("当前正则组", regexLabel, "pick-regex-group");
    html += "</div></section>";

    html += '<section class="settings-section">';
    html += '<h3 class="settings-section__title">聊天偏好</h3>';
    html += '<p class="settings-section__desc">影响消息展示与 LLM 请求行为。</p>';
    html += '<div class="settings-rows">';
    html += settingsSwitchRow("流式输出", "llm-stream", store.llmStreamEnabled);
    html += settingsSwitchRow("富文本消息", "chat-rich-text", store.chatRichTextEnabled);
    html += settingsRow("Token 计数器", store.tokenCounterMode, "pick-token-counter");
    html += "</div></section></div>";
    root.innerHTML = html;
  }

  function renderDataManagementView() {
    var root = settingsRoot();
    if (!root) return;
    var html = '<div class="settings-panel">';
    html += settingsActionSection(
      "导出",
      "将当前 mock 数据导出为 JSON，便于备份或在其他环境还原。",
      '<button type="button" class="btn-primary" data-profile-action="export-db">导出数据库</button>',
    );
    html += settingsActionSection(
      "导入",
      "用备份文件完全替换当前 mock 数据，操作不可撤销。",
      '<button type="button" class="btn-primary" data-profile-action="import-db">导入数据库</button>',
    );
    html += "</div>";
    root.innerHTML = html;
  }

  function renderProfileView() {
    renderWorkspaceView();
  }

  function renderAgentsSettings() {
    var root = settingsRoot();
    if (!root) return;
    var listHtml = "";
    Object.keys(store.agents).forEach(function (id) {
      var def = store.agents[id].definition;
      listHtml += settingsListItemRow(
        def.name,
        { "data-agent-id": id },
        { "data-agent-menu": id },
      );
    });
    root.innerHTML =
      '<div class="settings-panel">' +
      settingsListSection(
        '<button type="button" class="btn-primary" data-action="new-agent">新建 Agent</button>',
        listHtml,
      ) +
      "</div>";
  }

  function renderAgentEditor() {
    var root = settingsRoot();
    if (!root || !navState.editingAgentId) return;
    var entry = store.agents[navState.editingAgentId];
    if (!entry) return;
    var def = entry.definition;
    var body =
      settingsField("名称", '<input type="text" data-agent-field="name" value="' + escapeHtml(def.name) + '">') +
      settingsField(
        "最大步数",
        '<input type="number" data-agent-field="maxSteps" value="' +
          (def.runtime && def.runtime.maxSteps ? def.runtime.maxSteps : 20) +
          '">',
      );
    root.innerHTML =
      '<div class="settings-panel">' +
      settingsFormSection(
        "Agent 配置",
        "编辑名称与运行时步数上限。",
        body,
        '<button type="button" class="btn-primary" data-action="save-agent">保存</button>',
      ) +
      "</div>";
  }

  function renderProviders() {
    var root = settingsRoot();
    if (!root) return;
    var listHtml = "";
    store.providers.forEach(function (p) {
      listHtml += settingsListItemRow(
        p.name,
        { "data-provider-id": p.id },
        { "data-provider-menu": p.id },
        p.models.length + " 个模型",
      );
    });
    root.innerHTML =
      '<div class="settings-panel">' +
      settingsListSection(
        '<button type="button" class="btn-primary" data-action="new-provider">新建服务商</button>',
        listHtml,
      ) +
      "</div>";
  }

  function renderProviderDetail() {
    var root = settingsRoot();
    if (!root || !navState.editingProviderId) return;
    var provider = store.providers.find(function (p) { return p.id === navState.editingProviderId; });
    if (!provider) return;
    var listHtml = "";
    provider.models.forEach(function (m) {
      listHtml += settingsListItem(m.label, {
        "data-vendor-model-id": m.vendorModelId,
      });
    });
    root.innerHTML =
      '<div class="settings-panel">' +
      settingsListSection("", listHtml) +
      "</div>";
  }

  function renderModelSampling() {
    var root = settingsRoot();
    if (!root) return;
    var model = findProviderModel(navState.editingProviderId, navState.editingVendorModelId);
    var temperature = getSamplingTemperature(model);
    var desc = model
      ? navState.editingProviderId + "/" + model.vendorModelId
      : "调整模型采样参数。";
    var body = settingsField(
      "温度",
      '<input type="number" data-sampling-field="temperature" min="0" max="2" step="0.1" value="' + temperature + '">',
    );
    root.innerHTML =
      '<div class="settings-panel">' +
      settingsFormSection(
        "采样配置",
        desc,
        body,
        '<button type="button" class="btn-primary" data-action="save-sampling">保存</button>',
      ) +
      "</div>";
  }

  function renderCompactionConditions() {
    var root = settingsRoot();
    if (!root) return;
    var c = store.compactionConditions;
    var body =
      settingsSwitchField("启用自动压缩", 'data-compaction-field="enabled"', c.enabled) +
      settingsField(
        "Token 比例",
        '<input type="number" data-compaction-field="tokenRatio" min="0.01" max="1" step="0.01" value="' + (c.tokenRatio || "") + '">',
      ) +
      settingsField(
        "可见条数阈值",
        '<input type="number" data-compaction-field="visibleFloor" min="0" step="1" value="' + (c.visibleFloor || "") + '">',
      );
    root.innerHTML =
      '<div class="settings-panel">' +
      settingsFormSection(
        "压缩条件",
        "达到阈值时触发会话压缩。",
        body,
        '<button type="button" class="btn-primary" data-action="save-compaction">保存</button>',
      ) +
      "</div>";
  }

  function renderEventsConfig() {
    var root = settingsRoot();
    if (!root) return;
    var config = store.eventsConfig;
    var eventId = Object.keys(config.events || {})[0] || "session.compaction.requested";
    var block = config.events[eventId] || { mode: "parallel", actions: [] };
    var body =
      settingsField("事件 ID", '<input type="text" readonly value="' + escapeHtml(eventId) + '">') +
      settingsField(
        "执行模式",
        '<select data-events-field="mode"><option value="parallel"' +
          (block.mode === "parallel" ? " selected" : "") +
          '>parallel</option><option value="sequential"' +
          (block.mode === "sequential" ? " selected" : "") +
          ">sequential</option></select>",
      ) +
      settingsField(
        "动作 JSON",
        '<textarea data-events-field="actions" rows="8">' + escapeHtml(JSON.stringify(block.actions, null, 2)) + "</textarea>",
      );
    root.innerHTML =
      '<div class="settings-panel">' +
      settingsFormSection(
        "事件配置",
        "配置触发后的执行模式与动作列表。",
        body,
        '<button type="button" class="btn-primary" data-action="save-events">保存</button>',
      ) +
      "</div>";
  }

  function renderRegexGroups() {
    var root = settingsRoot();
    if (!root) return;
    var listHtml = "";
    store.regexGroups.forEach(function (g) {
      listHtml += settingsListItem(g.displayName || g.groupId, {
        "data-regex-group-id": g.groupId,
      });
    });
    root.innerHTML =
      '<div class="settings-panel">' +
      settingsListSection("", listHtml) +
      "</div>";
  }

  function renderRegexRules() {
    var root = settingsRoot();
    if (!root || !navState.editingRegexGroupId) return;
    var rules = store.regexRules[navState.editingRegexGroupId] || [];
    var listHtml = "";
    rules.forEach(function (r) {
      listHtml += settingsListItem(r.name, {
        "data-regex-rule-id": r.ruleId,
      });
    });
    root.innerHTML =
      '<div class="settings-panel">' +
      settingsListSection("", listHtml) +
      "</div>";
  }

  function renderRegexRuleEditor() {
    var root = settingsRoot();
    if (!root || !navState.editingRegexGroupId) return;
    var groupId = navState.editingRegexGroupId;
    var rules = store.regexRules[groupId] || [];
    var existing = navState.editingRegexRuleId
      ? rules.find(function (r) { return r.ruleId === navState.editingRegexRuleId; })
      : null;
    var name = existing ? existing.name : "新规则";
    var pattern = existing ? existing.pattern : "";
    var body =
      settingsField("名称", '<input type="text" data-regex-field="name" value="' + escapeHtml(name) + '">') +
      settingsField("模式", '<input type="text" data-regex-field="pattern" value="' + escapeHtml(pattern) + '">');
    root.innerHTML =
      '<div class="settings-panel">' +
      settingsFormSection(
        "正则规则",
        "正则规则编辑 mock（字段对齐 mobile 原型）。",
        body,
        '<button type="button" class="btn-primary" data-action="save-regex-rule">保存</button>',
      ) +
      "</div>";
  }

  function renderGlobalTemplate() {
    var root = settingsRoot();
    if (!root) return;
    root.innerHTML =
      '<div class="settings-panel">' +
      '<section class="settings-section settings-section--form">' +
      '<h3 class="settings-section__title">全局模板文件</h3>' +
      '<p class="settings-section__desc">全局模板在左侧 explorer 的「全局工作区」树中浏览与编辑。</p>' +
      '<p class="settings-hint">选中 <code>shared-prompt.md</code> 可在预览区查看/编辑。</p>' +
      "</section></div>";
    setWorkspaceScope("global");
  }

  function renderSettingsContent(viewId) {
    if (viewId === "workspace") renderWorkspaceView();
    else if (viewId === "dataManagement") renderDataManagementView();
    else if (viewId === "profile") renderWorkspaceView();
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
  }

  function formatTokenCount(n) {
    if (!Number.isFinite(n) || n < 0) return "—";
    var rounded = Math.round(n);
    if (rounded < 1000) return String(rounded);
    if (rounded < 1000000) {
      var k = rounded / 1000;
      if (k >= 100) return Math.round(k) + "K";
      return String(k.toFixed(1)).replace(/\.0$/, "") + "K";
    }
    var m = rounded / 1000000;
    if (m >= 100) return Math.round(m) + "M";
    return String(m.toFixed(1)).replace(/\.0$/, "") + "M";
  }

  function getContextWindowForModel(modelId) {
    var lower = String(modelId || "").toLowerCase();
    if (lower.indexOf("glm") >= 0) return 1000000;
    if (lower.indexOf("gemini") >= 0) return 1000000;
    if (lower.indexOf("gpt-4") >= 0) return 128000;
    return 128000;
  }

  function resolveTokenizerLabel(mode, modelId) {
    if (mode && mode !== "auto") return mode;
    var lower = String(modelId || "").toLowerCase();
    if (lower.indexOf("gpt") >= 0 || lower.indexOf("openai") >= 0) return "tiktoken";
    if (lower.indexOf("claude") >= 0) return "claude";
    if (lower.indexOf("glm") >= 0 || lower.indexOf("gemma") >= 0) return "gemma";
    if (lower.indexOf("llama") >= 0) return "llama3";
    if (lower.indexOf("mistral") >= 0) return "mistral";
    return "auto";
  }

  function getConversationTokenStats() {
    var tokenCount =
      store.mockPromptTokenCount != null ? store.mockPromptTokenCount : 56100;
    var contextWindow = getContextWindowForModel(store.workspaceCurrentModelId);
    var pct = Math.min(999, Math.round((tokenCount / contextWindow) * 100));
    return {
      pct: pct,
      countLabel:
        formatTokenCount(tokenCount) + " / " + formatTokenCount(contextWindow),
      tokenizerLabel: resolveTokenizerLabel(
        store.tokenCounterMode,
        store.workspaceCurrentModelId,
      ),
    };
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
    var stats = getConversationTokenStats();
    var barWidth = Math.min(100, Math.max(0, stats.pct));
    meta.innerHTML =
      '<div class="workspace-footer__picks">' +
      '<button type="button" class="workspace-pick" data-action="open-agent-picker" aria-label="切换 agent">' +
      '<span class="workspace-pick__icon" aria-hidden="true">🧠</span>' +
      '<span class="workspace-pick__body">' +
      '<span class="workspace-pick__label">Agent</span>' +
      '<span class="workspace-pick__value">' +
      escapeHtml(agentLabel) +
      "</span></span></button>" +
      '<button type="button" class="workspace-pick" data-action="open-model-picker" aria-label="切换模型">' +
      '<span class="workspace-pick__icon" aria-hidden="true">🤖</span>' +
      '<span class="workspace-pick__body">' +
      '<span class="workspace-pick__label">模型</span>' +
      '<span class="workspace-pick__value">' +
      escapeHtml(store.workspaceCurrentModelId) +
      "</span></span></button></div>" +
      '<div class="workspace-token-stats">' +
      '<div class="workspace-token-stats__head">' +
      '<span class="workspace-token-stats__title">上下文占用</span>' +
      '<span class="workspace-token-stats__pct">~' +
      stats.pct +
      "%</span></div>" +
      '<div class="workspace-token-bar" role="progressbar" aria-valuenow="' +
      stats.pct +
      '" aria-valuemin="0" aria-valuemax="100" aria-label="上下文占用约 ' +
      stats.pct +
      '%">' +
      '<div class="workspace-token-bar__fill" style="width:' +
      barWidth +
      '%"></div></div>' +
      '<div class="workspace-token-stats__foot">' +
      '<span class="workspace-token-stats__count">' +
      escapeHtml(stats.countLabel) +
      "</span>" +
      '<button type="button" class="workspace-token-stats__tokenizer" data-action="pick-token-counter" aria-label="切换分词器">' +
      escapeHtml(stats.tokenizerLabel) +
      "</button></div></div>";
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

  function setPreviewMode(editMode) {
    navState.previewEditMode = editMode;
    document.querySelectorAll("[data-preview-mode]").forEach(function (btn) {
      var mode = btn.getAttribute("data-preview-mode");
      btn.classList.toggle("is-active", mode === (editMode ? "edit" : "read"));
    });
    if (navState.previewFileId) {
      var file = store.previewFiles[navState.previewFileId];
      if (file) showPreview(navState.previewFileId, file.name);
    }
    showToast(editMode ? "编辑模式" : "预览模式");
  }

  function togglePreviewEdit() {
    setPreviewMode(!navState.previewEditMode);
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

  var itemMenuHandler = null;
  var pickerSelectHandler = null;
  var sessionActionsAnchor = null;

  function closePickerModal() {
    var modal = document.getElementById("picker-modal");
    if (modal) {
      modal.classList.add("hidden");
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
    }
    pickerSelectHandler = null;
  }

  function openPickerModal(title, items, onSelect) {
    var modal = document.getElementById("picker-modal");
    var titleEl = document.getElementById("picker-modal-title");
    var listEl = document.getElementById("picker-modal-list");
    if (!modal || !titleEl || !listEl) return;
    pickerSelectHandler = onSelect;
    titleEl.textContent = title;
    listEl.innerHTML = items
      .map(function (item) {
        return (
          '<button type="button" class="picker-modal__item' +
          (item.selected ? " is-selected" : "") +
          '" data-picker-value="' +
          escapeHtml(item.id) +
          '">' +
          escapeHtml(item.label) +
          "</button>"
        );
      })
      .join("");
    modal.classList.remove("hidden");
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }

  function openAgentPickerModal() {
    var items = Object.keys(store.agents).map(function (id) {
      return {
        id: id,
        label: store.agents[id].definition.name,
        selected: id === store.workspaceCurrentAgentId,
      };
    });
    openPickerModal("选择 Agent", items, function (id) {
      if (!store.agents[id]) return;
      store.workspaceCurrentAgentId = id;
      persistStore();
      updateConversationMeta();
      if (isSettingsOpen()) refreshWorkspaceSettingsIfOpen();
      showToast("已切换 agent");
    });
  }

  function openModelPickerModal() {
    var items = [];
    store.providers.forEach(function (provider) {
      provider.models.forEach(function (model) {
        var id = provider.id + "/" + model.vendorModelId;
        items.push({
          id: id,
          label: (model.label || model.vendorModelId) + " · " + provider.name,
          selected: id === store.workspaceCurrentModelId,
        });
      });
    });
    if (items.length === 0) {
      items.push({ id: store.workspaceCurrentModelId, label: store.workspaceCurrentModelId, selected: true });
    }
    openPickerModal("选择模型", items, function (id) {
      store.workspaceCurrentModelId = id;
      persistStore();
      updateConversationMeta();
      if (isSettingsOpen()) refreshWorkspaceSettingsIfOpen();
      showToast("已切换模型");
    });
  }

  function closeItemMenu() {
    var menu = document.getElementById("item-menu");
    if (menu) menu.classList.add("hidden");
    itemMenuHandler = null;
  }

  function closeSessionActionsMenu() {
    var menu = document.getElementById("session-actions-menu");
    if (menu) menu.classList.add("hidden");
  }

  function openSessionActionsMenu(anchor) {
    var menu = document.getElementById("session-actions-menu");
    if (!menu) return;
    sessionActionsAnchor = anchor;
    var actions = [
      { id: "batch-ops", label: "批量操作" },
      { id: "compact-chat", label: "压缩聊天" },
    ];
    menu.innerHTML = actions
      .map(function (item) {
        return (
          '<button type="button" data-session-action="' +
          item.id +
          '">' +
          escapeHtml(item.label) +
          "</button>"
        );
      })
      .join("");
    var rect = anchor.getBoundingClientRect();
    menu.style.left = Math.max(12, Math.min(rect.left, window.innerWidth - 200)) + "px";
    menu.style.bottom = window.innerHeight - rect.top + 8 + "px";
    menu.classList.remove("hidden");
  }

  function handleSessionAction(action) {
    closeSessionActionsMenu();
    if (action === "batch-ops") {
      enterMessageBatchMode();
          return;
        }
    if (action === "compact-chat") {
      showToast("压缩聊天（原型示意）");
    }
  }

  function openItemMenu(anchor, items, onSelect) {
    var menu = document.getElementById("item-menu");
    if (!menu) return;
    itemMenuHandler = onSelect;
    menu.innerHTML = items
      .map(function (item) {
        var danger = item.danger ? ' class="is-danger"' : "";
        return (
          '<button type="button" data-item-menu="' + item.action + '"' + danger + ">" +
          escapeHtml(item.label) +
          "</button>"
        );
      })
      .join("");
    var rect = anchor.getBoundingClientRect();
    menu.style.top = rect.bottom + 6 + "px";
    menu.style.bottom = "auto";
    menu.style.left = "auto";
    menu.style.right = Math.max(16, window.innerWidth - rect.right) + "px";
    menu.classList.remove("hidden");
  }

  function showAgentItemMenu(agentId, anchor) {
    openItemMenu(
      anchor,
      [
        { label: "重命名", action: "rename" },
        { label: "复制", action: "duplicate" },
        { label: "删除", action: "delete", danger: true },
      ],
      function (action) {
        closeItemMenu();
        var entry = store.agents[agentId];
        if (!entry) return;
        if (action === "rename") {
          var next = prompt("Agent 名称", entry.definition.name);
          if (!next || !next.trim()) return;
          entry.definition.name = next.trim();
          persistStore();
          renderAgentsSettings();
          if (navState.editingAgentId === agentId) renderAgentEditor();
          showToast("已重命名");
          return;
        }
        if (action === "duplicate") {
          var copyId = "agent-" + Date.now();
          store.agents[copyId] = { id: copyId, definition: deepClone(entry.definition) };
          store.agents[copyId].definition.name += "-copy";
          persistStore();
          renderAgentsSettings();
          showToast("已复制 Agent");
          return;
        }
        if (action === "delete") {
          if (Object.keys(store.agents).length <= 1) {
            showToast("至少保留一个 Agent");
            return;
          }
          if (store.workspaceCurrentAgentId === agentId) {
            var remaining = Object.keys(store.agents).filter(function (k) { return k !== agentId; });
            store.workspaceCurrentAgentId = remaining[0];
            updateConversationMeta();
            if (settingsState.viewId === "workspace") renderWorkspaceView();
          }
          if (navState.editingAgentId === agentId) {
            navState.editingAgentId = null;
            if (settingsState.viewId === "agentEditor") popSettingsView();
          }
          delete store.agents[agentId];
          persistStore();
          renderAgentsSettings();
          showToast("已删除 Agent");
        }
      }
    );
  }

  function showProviderItemMenu(providerId, anchor) {
    openItemMenu(
      anchor,
      [
        { label: "重命名", action: "rename" },
        { label: "删除", action: "delete", danger: true },
      ],
      function (action) {
        closeItemMenu();
        var provider = findProvider(providerId);
        if (!provider) return;
        if (action === "rename") {
          var next = prompt("服务商名称", provider.name);
          if (!next || !next.trim()) return;
          provider.name = next.trim();
          persistStore();
          renderProviders();
          if (navState.editingProviderId === providerId && settingsState.viewId === "providerDetail") {
            renderProviderDetail();
          }
          showToast("已重命名");
          return;
        }
        if (action === "delete") {
          if (store.providers.length <= 1) {
            showToast("至少保留一个服务商");
            return;
          }
          if (!confirm("确定删除服务商 " + provider.name + "？")) return;
          store.providers = store.providers.filter(function (p) { return p.id !== providerId; });
          if (navState.editingProviderId === providerId) {
            navState.editingProviderId = null;
            navState.editingVendorModelId = null;
            if (settingsState.viewId === "providerDetail" || settingsState.viewId === "modelSampling") {
              popSettingsView();
              if (settingsState.viewId === "modelSampling") popSettingsView();
            }
          }
          persistStore();
          renderProviders();
          showToast("已删除服务商");
        }
      }
    );
  }

  function createNewProvider() {
    var name = prompt("服务商名称");
    if (!name || !name.trim()) return;
    var id = slugifyId(name.trim());
    while (findProvider(id)) id = id + "-" + Date.now();
    store.providers.push({ id: id, name: name.trim(), models: [] });
    persistStore();
    renderProviders();
    showToast("已添加服务商");
  }

  function pickAgent() {
    openAgentPickerModal();
  }

  function pickModel() {
    openModelPickerModal();
  }

  function pickRegexGroup() {
    var ids = [null].concat(store.regexGroups.map(function (g) { return g.groupId; }));
    var idx = ids.indexOf(store.workspaceCurrentRegexGroupId);
    store.workspaceCurrentRegexGroupId = ids[(idx + 1) % ids.length];
    persistStore();
    if (isSettingsOpen()) refreshWorkspaceSettingsIfOpen();
    showToast(store.workspaceCurrentRegexGroupId ? "已切换正则组" : "已禁用正则组");
  }

  var TOKEN_COUNTER_MODES = [
    { id: "auto", label: "auto（按模型推断）" },
    { id: "heuristic", label: "heuristic（字符估算）" },
    { id: "tiktoken", label: "tiktoken" },
    { id: "claude", label: "claude" },
    { id: "gemma", label: "gemma" },
    { id: "llama3", label: "llama3" },
    { id: "mistral", label: "mistral" },
  ];

  function openTokenCounterPickerModal() {
    var items = TOKEN_COUNTER_MODES.map(function (mode) {
      return {
        id: mode.id,
        label: mode.label,
        selected: mode.id === store.tokenCounterMode,
      };
    });
    openPickerModal("Token 计数器", items, function (id) {
      store.tokenCounterMode = id;
      persistStore();
      updateConversationMeta();
      if (isSettingsOpen()) refreshWorkspaceSettingsIfOpen();
      showToast("Token 计数器：" + id);
    });
  }

  function pickTokenCounter() {
    openTokenCounterPickerModal();
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
          if (isSettingsOpen()) renderSettingsContent(settingsState.viewId);
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
        var node = event.target.closest("[data-vfs-id]");
        if (!node || !container.contains(node)) return;
        var panel = container.closest("[data-workspace-panel]");
        if (panel && panel.hidden) return;
        var scope = node.getAttribute("data-vfs-scope") || "";
        var nodeId = node.getAttribute("data-vfs-id") || "";
        container.querySelectorAll(".is-active").forEach(function (n) {
          n.classList.remove("is-active");
        });
        node.classList.add("is-active");
        navState.activeVfsNodeId = nodeId;
        navState.activeVfsScope = scope;
        var fileId = node.getAttribute("data-file-id");
        if (fileId) {
          showPreview(fileId, node.getAttribute("data-file-name") || "—");
        }
      });

      container.addEventListener("contextmenu", function (event) {
        var node = event.target.closest("[data-vfs-id]");
        if (!node || !container.contains(node)) return;
        var panel = container.closest("[data-workspace-panel]");
        if (panel && panel.hidden) return;
        event.preventDefault();
        event.stopPropagation();
        openWorkspaceContextMenu(
          event,
          node.getAttribute("data-vfs-scope") || "",
          node.getAttribute("data-vfs-id") || "",
        );
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
        showNavView("conversation");
      });
    }
  }

  function bindRailHeaderInteractions() {
    var railHeader = document.getElementById("rail-header");
    if (!railHeader) return;

    railHeader.addEventListener("click", function (e) {
      if (e.target.closest("[data-action='back-to-projects']")) {
        navState.projectId = null;
        navState.projectName = null;
        navState.sessionId = null;
        navState.sessionName = null;
        showNavView("projects");
        return;
      }

      if (e.target.closest("[data-action='back-to-sessions']")) {
        navState.sessionId = null;
        navState.sessionName = null;
        showNavView("sessions");
      }
    });
  }

  function bindExplorerInteractions() {
    var explorer = document.getElementById("explorer-pane");
    if (!explorer) return;

    explorer.addEventListener("click", function (e) {
      if (e.target.closest("[data-action='open-agent-picker']")) {
        e.stopPropagation();
        openAgentPickerModal();
        return;
      }
      if (e.target.closest("[data-action='open-model-picker']")) {
        e.stopPropagation();
        openModelPickerModal();
      }
    });
  }

  function bindConversationInteractions() {
    var chatRail = document.getElementById("chat-rail");
    if (!chatRail) return;

    chatRail.addEventListener("click", function (e) {
      var moreBtn = e.target.closest("[data-action='open-session-actions']");
      if (moreBtn) {
        e.stopPropagation();
        if (navState.viewId !== "conversation") return;
        openSessionActionsMenu(moreBtn);
    return;
  }

      if (e.target.closest("[data-action='batch-cancel']")) {
        exitMessageBatchMode();
        return;
      }
      if (e.target.closest("[data-action='batch-delete']")) {
        batchDeleteMessages();
        return;
      }
      if (e.target.closest("[data-action='batch-hide']")) {
        batchHideMessages();
        return;
      }
      if (e.target.closest("[data-action='batch-restore']")) {
        batchRestoreMessages();
        return;
      }

      var messageEl = e.target.closest("[data-message-id]");
      if (messageEl && messageBatchState.active) {
        if (e.target.closest(".chat-message__check")) return;
        toggleMessageSelection(messageEl.getAttribute("data-message-id"));
        return;
      }

      var messageCheck = e.target.closest(".chat-message__check input[type='checkbox']");
      if (messageCheck) {
        e.stopPropagation();
        var row = messageCheck.closest("[data-message-id]");
        if (row) toggleMessageSelection(row.getAttribute("data-message-id"));
        return;
      }

      var tabBtn = e.target.closest("[data-conversation-tab]");
      if (tabBtn) {
        setConversationTab(tabBtn.getAttribute("data-conversation-tab") || "chat");
        return;
      }

      var segBtn = e.target.closest("[data-action='toggle-prompt-segment']");
      if (!segBtn) return;
      var card = segBtn.closest(".prompt-segment");
      if (!card) return;
      var expanded = card.classList.toggle("is-expanded");
      segBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
      var chevron = segBtn.querySelector(".prompt-segment__chevron");
      if (chevron) chevron.textContent = expanded ? "▼" : "▶";
    });
  }

  function bindSettingsInteractions() {
    var settingsPage = document.getElementById("settings-page");
    if (!settingsPage) return;

    settingsPage.addEventListener("click", function (e) {
      if (e.target.closest("[data-action='settings-back']")) {
        popSettingsView();
        return;
      }

      var navBtn = e.target.closest("[data-settings-nav]");
      if (navBtn) {
        navigateSettingsTopLevel(navBtn.getAttribute("data-settings-nav") || "workspace");
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

      var agentMenuBtn = e.target.closest("[data-agent-menu]");
      if (agentMenuBtn) {
        e.preventDefault();
        e.stopPropagation();
        showAgentItemMenu(agentMenuBtn.getAttribute("data-agent-menu"), agentMenuBtn);
        return;
      }

      var agentBtn = e.target.closest("[data-agent-id]");
      if (agentBtn) {
        navState.editingAgentId = agentBtn.getAttribute("data-agent-id");
        pushSettingsView("agentEditor");
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
        pushSettingsView("agentEditor");
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

      if (e.target.closest("[data-action='new-provider']")) {
        createNewProvider();
        return;
      }

      var providerMenuBtn = e.target.closest("[data-provider-menu]");
      if (providerMenuBtn) {
        e.preventDefault();
        e.stopPropagation();
        showProviderItemMenu(providerMenuBtn.getAttribute("data-provider-menu"), providerMenuBtn);
        return;
      }

      var providerBtn = e.target.closest("[data-provider-id]");
      if (providerBtn) {
        navState.editingProviderId = providerBtn.getAttribute("data-provider-id");
        pushSettingsView("providerDetail");
        return;
      }

      var modelBtn = e.target.closest("[data-vendor-model-id]");
      if (modelBtn) {
        navState.editingVendorModelId = modelBtn.getAttribute("data-vendor-model-id");
        pushSettingsView("modelSampling");
        return;
      }

      if (e.target.closest("[data-action='save-sampling']")) {
        var samplingModel = findProviderModel(navState.editingProviderId, navState.editingVendorModelId);
        if (!samplingModel) return;
        var tempEl = document.querySelector("[data-sampling-field='temperature']");
        var temperature = tempEl ? Number(tempEl.value) : 0.7;
        if (!samplingModel.settings) samplingModel.settings = {};
        samplingModel.settings.sampling = {
          enabled: true,
          params: { protocol: "openai", openai: { temperature: temperature } },
        };
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
        pushSettingsView("regexRules");
        return;
      }

      var regexRuleBtn = e.target.closest("[data-regex-rule-id]");
      if (regexRuleBtn) {
        navState.editingRegexRuleId = regexRuleBtn.getAttribute("data-regex-rule-id");
        pushSettingsView("regexRuleEditor");
        return;
      }

      if (e.target.closest("[data-action='save-regex-rule']")) {
        var groupId = navState.editingRegexGroupId;
        if (!groupId) return;
        var nameEl = document.querySelector("[data-regex-field='name']");
        var patternEl = document.querySelector("[data-regex-field='pattern']");
        var ruleName = nameEl ? nameEl.value.trim() : "";
        var rulePattern = patternEl ? patternEl.value.trim() : "";
        if (!ruleName || !rulePattern) {
          showToast("请填写名称和模式");
          return;
        }
        if (!store.regexRules[groupId]) store.regexRules[groupId] = [];
        var ruleList = store.regexRules[groupId];
        var ruleId = navState.editingRegexRuleId;
        var existingRule = ruleId
          ? ruleList.find(function (r) { return r.ruleId === ruleId; })
          : null;
        if (!existingRule) {
          ruleId = "rule-" + Date.now();
          existingRule = {
            ruleId: ruleId,
            name: ruleName,
            pattern: rulePattern,
            scopeUser: true,
            scopeAssistant: false,
            minDepth: 0,
            maxDepth: 99,
          };
          ruleList.push(existingRule);
          navState.editingRegexRuleId = ruleId;
        } else {
          existingRule.name = ruleName;
          existingRule.pattern = rulePattern;
        }
        persistStore();
        showToast("规则已保存");
        return;
      }
    });
  }

  function bindGlobalInteractions() {
    document.addEventListener("click", function () {
      closeItemMenu();
      closeSessionActionsMenu();
      closeWorkspaceContextMenu();
      closePickerModal();
    });

    document.addEventListener("contextmenu", function (e) {
      if (!e.target.closest(".explorer-tree")) closeWorkspaceContextMenu();
    });

    var itemMenu = document.getElementById("item-menu");
    if (itemMenu) {
      itemMenu.addEventListener("click", function (e) {
        e.stopPropagation();
        var btn = e.target.closest("[data-item-menu]");
        if (!btn || !itemMenuHandler) return;
        itemMenuHandler(btn.getAttribute("data-item-menu"));
      });
    }

    var sessionActionsMenu = document.getElementById("session-actions-menu");
    if (sessionActionsMenu) {
      sessionActionsMenu.addEventListener("click", function (e) {
        e.stopPropagation();
        var btn = e.target.closest("[data-session-action]");
        if (!btn) return;
        handleSessionAction(btn.getAttribute("data-session-action"));
      });
    }

    var workspaceContextMenu = document.getElementById("workspace-context-menu");
    if (workspaceContextMenu) {
      workspaceContextMenu.addEventListener("click", function (e) {
        e.stopPropagation();
        var btn = e.target.closest("[data-workspace-action]");
        if (!btn) return;
        handleWorkspaceContextAction(btn.getAttribute("data-workspace-action"));
      });
    }

    var workspaceModal = document.getElementById("workspace-modal");
    if (workspaceModal) {
      workspaceModal.addEventListener("click", function (e) {
        e.stopPropagation();
        if (e.target.closest("[data-action='close-workspace-modal']")) {
          closeWorkspaceModal();
          return;
        }
        if (e.target.closest("[data-action='save-workspace-modal']")) {
          if (workspaceModalSaveHandler) workspaceModalSaveHandler();
        }
      });
    }

    var pickerModal = document.getElementById("picker-modal");
    if (pickerModal) {
      pickerModal.addEventListener("click", function (e) {
        e.stopPropagation();
        if (e.target.closest("[data-action='close-picker']")) {
          closePickerModal();
          return;
        }
        var pickBtn = e.target.closest("[data-picker-value]");
        if (!pickBtn || !pickerSelectHandler) return;
        pickerSelectHandler(pickBtn.getAttribute("data-picker-value"));
        closePickerModal();
      });
    }

    document.querySelectorAll("[data-action='set-preview-mode']").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setPreviewMode(btn.getAttribute("data-preview-mode") === "edit");
      });
    });

    var editorEl = document.getElementById("preview-editor");
    if (editorEl) {
      editorEl.addEventListener("blur", savePreviewEdit);
    }

    var themeBtn = document.getElementById("theme-toggle");
    if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

    var settingsBtn = document.getElementById("settings-open");
    if (settingsBtn) settingsBtn.addEventListener("click", toggleSettings);
  }

  var app = document.getElementById("app");
  if (!app) return;

  initTheme();
  initColumnSplitters();
  bindTreeClicks();
  bindChatNavigation();
  bindRailHeaderInteractions();
  bindExplorerInteractions();
  bindConversationInteractions();
  bindSettingsInteractions();
  bindGlobalInteractions();
  renderAllWorkspaceTrees();
  showNavView("projects");
})();
