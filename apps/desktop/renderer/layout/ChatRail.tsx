import { useCallback, useEffect, useState } from "react";
import type { ProjectDto, SessionDto } from "../../shared/ipc-types";
import {
  ipcProjectsList,
  ipcSessionsListByProject,
} from "../ipc/client";
import { useShellNav } from "../providers/ShellNavProvider";
import { railPaneNavTitle } from "../state/nav-workspace";

export function ChatRail() {
  const {
    viewId,
    projectId,
    projectName,
    sessionName,
    openProject,
    openSession,
    goBackToProjects,
    goBackToSessions,
  } = useShellNav();

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const result = await ipcProjectsList();
      if (result.ok) {
        setProjects(result.data);
      }
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const loadSessions = useCallback(async (pid: string) => {
    setLoadingSessions(true);
    try {
      const result = await ipcSessionsListByProject({ projectId: pid });
      if (result.ok) {
        setSessions(result.data);
      }
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (viewId === "sessions" && projectId) {
      void loadSessions(projectId);
    }
  }, [viewId, projectId, loadSessions]);

  const showBack = viewId === "sessions" || viewId === "conversation";

  return (
    <>
      <header className="column-header" id="rail-header" aria-label="Chat 导航">
        <div className="column-header__nav" id="rail-pane-nav">
          {showBack ? (
            <button
              type="button"
              className="chat-nav-back"
              data-action={
                viewId === "sessions" ? "back-to-projects" : "back-to-sessions"
              }
              aria-label="返回"
              onClick={
                viewId === "sessions" ? goBackToProjects : goBackToSessions
              }
            >
              ‹
            </button>
          ) : null}
          {viewId === "sessions" ? (
            <span className="column-header__title column-header__title--truncate">
              {projectName ?? "—"}
            </span>
          ) : viewId === "conversation" ? (
            <span className="column-header__title column-header__title--truncate">
              {sessionName ?? "—"}
            </span>
          ) : (
            <span className="column-header__title">
              {railPaneNavTitle(viewId)}
            </span>
          )}
        </div>
      </header>
      <section id="chat-rail" aria-label="Chat 内容">
        <div
          className={`chat-nav-view${viewId === "projects" ? " is-visible" : ""}`}
          data-nav-view="projects"
          hidden={viewId !== "projects"}
        >
          <ul className="chat-list" id="project-list">
            {loadingProjects ? (
              <li className="chat-list__item">
                <span className="chat-list__label">加载中…</span>
              </li>
            ) : projects.length === 0 ? (
              <li className="chat-list__item">
                <span className="chat-list__label">暂无项目</span>
              </li>
            ) : (
              projects.map((project) => (
                <li
                  key={project.id}
                  className="chat-list__item"
                  data-project-id={project.id}
                  data-project-name={project.name}
                  role="button"
                  tabIndex={0}
                  onClick={() => void openProject(project)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void openProject(project);
                    }
                  }}
                >
                  <span className="chat-list__icon">📚</span>
                  <span className="chat-list__label">{project.name}</span>
                  <span className="chat-list__chevron">›</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div
          className={`chat-nav-view${viewId === "sessions" ? " is-visible" : ""}`}
          data-nav-view="sessions"
          hidden={viewId !== "sessions"}
        >
          <div className="chat-nav-subheader">会话</div>
          <ul className="chat-list" id="session-list">
            {loadingSessions ? (
              <li className="chat-list__item">
                <span className="chat-list__label">加载中…</span>
              </li>
            ) : sessions.length === 0 ? (
              <li className="chat-list__item">
                <span className="chat-list__label">暂无会话</span>
              </li>
            ) : (
              sessions.map((session) => (
                <li
                  key={session.id}
                  className="chat-list__item"
                  data-session-id={session.id}
                  data-session-name={session.title ?? ""}
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    void openSession(session, projectName ?? "—")
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      void openSession(session, projectName ?? "—");
                    }
                  }}
                >
                  <span className="chat-list__label">
                    {session.title ?? "未命名会话"}
                  </span>
                  <span className="chat-list__chevron">›</span>
                </li>
              ))
            )}
          </ul>
        </div>

        <div
          className={`chat-nav-view${viewId === "conversation" ? " is-visible" : ""}`}
          data-nav-view="conversation"
          hidden={viewId !== "conversation"}
        >
          <div className="conversation-tabs" role="tablist" aria-label="会话内容">
            <button
              type="button"
              className="conversation-tab is-active"
              data-conversation-tab="chat"
              role="tab"
              aria-selected
            >
              聊天
            </button>
            <button
              type="button"
              className="conversation-tab"
              data-conversation-tab="realPrompt"
              role="tab"
              aria-selected={false}
            >
              提示词
            </button>
          </div>
          <div
            className="conversation-panel is-visible"
            data-conversation-panel="chat"
          >
            <div className="chat-messages" id="chat-messages">
              <p className="preview-empty">对话功能将在后续版本提供</p>
            </div>
            <div
              id="chat-batch-bar"
              className="chat-batch-bar hidden"
              hidden
            />
            <div className="chat-composer" id="chat-composer">
              <button
                type="button"
                className="chat-composer__more"
                data-action="open-session-actions"
                aria-label="更多选项"
                aria-haspopup="menu"
              >
                ⋯
              </button>
              <textarea
                disabled
                placeholder="请先配置模型（D5）"
                aria-label="消息输入"
              />
              <button type="button" className="chat-composer__send" disabled>
                发送
              </button>
            </div>
          </div>
          <div
            className="conversation-panel"
            data-conversation-panel="realPrompt"
            hidden
          >
            <div className="real-prompt-list" id="real-prompt-list" />
          </div>
        </div>
      </section>
    </>
  );
}
