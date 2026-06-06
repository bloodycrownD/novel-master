/**
 * examples/desktop — browser UI prototype.
 *
 * - Workspace title follows chat nav: 全局 / 会话 / 聊天工作区.
 * - Mock trees in index.html; preview updates on file click.
 * - No Electron / core runtime.
 */
(function initDesktopShell() {
  "use strict";

  /** @typedef {"global"|"session"|"chat"} WorkspaceScope */
  /** @typedef {"projects"|"sessions"|"conversation"} NavLevel */

  var NAV_TO_WORKSPACE = {
    projects: "global",
    sessions: "session",
    conversation: "chat",
  };

  var WORKSPACE_TITLES = {
    global: "全局工作区",
    session: "会话工作区",
    chat: "聊天工作区",
  };

  var MOCK_PREVIEW = {
    "g-global-yaml": {
      body: "<p>全局正则与事件规则占位。对应 mobile Profile → 全局模板。</p>",
    },
    "g-shared-md": {
      body: "<p>全应用共享提示词片段（静态 mock）。</p>",
    },
    "s-inherit": {
      body: "<p>项目模板继承说明。对应 mobile 会话列表 · 项目模板。</p>",
    },
    "s-outline": {
      body: "<p>当前项目的结构大纲占位。</p>",
    },
    "c-ch1": {
      body:
        "<h1 class=\"preview-title\">第一章 · 启程</h1>" +
        "<p>晨光透过舷窗洒在控制台上。林远深吸一口气，启动了跃迁引擎。</p>",
    },
    "c-outline": {
      body: "<p>本卷章节提纲（静态 mock）。</p>",
    },
    "c-draft": {
      body: "<p>临时笔记草稿内容。</p>",
    },
  };

  var navState = {
    level: /** @type {NavLevel} */ ("projects"),
    projectId: null,
    projectName: null,
    sessionId: null,
    sessionName: null,
    workspaceScope: /** @type {WorkspaceScope} */ ("global"),
  };

  /**
   * Switch visible tree panel and update the single workspace title.
   * @param {WorkspaceScope} scope
   */
  function setWorkspaceScope(scope) {
    navState.workspaceScope = scope;

    var titleEl = document.getElementById("workspace-title");
    if (titleEl) {
      titleEl.textContent = WORKSPACE_TITLES[scope] || "工作区";
    }

    document.querySelectorAll("[data-workspace-panel]").forEach(function panel(el) {
      var panelScope = el.getAttribute("data-workspace-panel");
      var isVisible = panelScope === scope;
      el.classList.toggle("is-visible", isVisible);
      el.hidden = !isVisible;
    });
  }

  /** @param {NavLevel} level */
  function syncWorkspaceWithNav(level) {
    setWorkspaceScope(NAV_TO_WORKSPACE[level] || "global");
  }

  /** @param {NavLevel} level */
  function showChatLevel(level) {
    navState.level = level;
    document.querySelectorAll("[data-nav-view]").forEach(function toggleView(view) {
      var isTarget = view.getAttribute("data-nav-view") === level;
      view.classList.toggle("is-visible", isTarget);
      view.hidden = !isTarget;
    });
    syncWorkspaceWithNav(level);
  }

  function showPreview(fileId, fileName) {
    var filenameEl = document.getElementById("preview-filename");
    var bodyEl = document.getElementById("preview-body");
    if (!filenameEl || !bodyEl) {
      return;
    }
    filenameEl.textContent = fileName;
    var mock = MOCK_PREVIEW[fileId];
    bodyEl.innerHTML = mock
      ? mock.body
      : "<p class=\"preview-empty\">「" + fileName + "」预览占位。</p>";
  }

  function bindTreeClicks() {
    document.querySelectorAll(".explorer-tree").forEach(function tree(container) {
      container.addEventListener("click", function onTreeClick(event) {
        var node = event.target.closest("[data-file-id]");
        if (!node || !container.contains(node)) {
          return;
        }
        var panel = container.closest("[data-workspace-panel]");
        if (panel && panel.hidden) {
          return;
        }
        container.querySelectorAll(".is-active").forEach(function (n) {
          n.classList.remove("is-active");
        });
        node.classList.add("is-active");
        showPreview(
          node.getAttribute("data-file-id") || "",
          node.getAttribute("data-file-name") || "—",
        );
      });
    });
  }

  function bindChatNavigation() {
    var projectList = document.getElementById("project-list");
    if (projectList) {
      projectList.addEventListener("click", function onProjectClick(event) {
        var item = event.target.closest("[data-project-id]");
        if (!item) {
          return;
        }
        navState.projectId = item.getAttribute("data-project-id");
        navState.projectName = item.getAttribute("data-project-name");
        navState.sessionId = null;
        navState.sessionName = null;

        var sessionsTitle = document.getElementById("sessions-project-name");
        if (sessionsTitle) {
          sessionsTitle.textContent = navState.projectName;
        }

        showChatLevel("sessions");
      });
    }

    var sessionList = document.getElementById("session-list");
    if (sessionList) {
      sessionList.addEventListener("click", function onSessionClick(event) {
        var item = event.target.closest("[data-session-id]");
        if (!item) {
          return;
        }
        navState.sessionId = item.getAttribute("data-session-id");
        navState.sessionName = item.getAttribute("data-session-name");

        var convProject = document.getElementById("conversation-project-name");
        var convSession = document.getElementById("conversation-session-name");
        if (convProject) {
          convProject.textContent = navState.projectName || "—";
        }
        if (convSession) {
          convSession.textContent = navState.sessionName || "—";
        }

        showChatLevel("conversation");
      });
    }

    document.querySelectorAll("[data-action='back-to-projects']").forEach(function bind(btn) {
      btn.addEventListener("click", function onBack() {
        navState.projectId = null;
        navState.projectName = null;
        navState.sessionId = null;
        navState.sessionName = null;
        showChatLevel("projects");
      });
    });

    document.querySelectorAll("[data-action='back-to-sessions']").forEach(function bind(btn) {
      btn.addEventListener("click", function onBack() {
        navState.sessionId = null;
        navState.sessionName = null;
        showChatLevel("sessions");
      });
    });
  }

  var app = document.getElementById("app");
  if (!app) {
    return;
  }

  bindTreeClicks();
  bindChatNavigation();
  showChatLevel("projects");
})();
