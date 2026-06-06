import { useCallback, useEffect, useState } from "react";
import type { ProjectDto, SessionDto } from "../../shared/ipc-types";
import { BatchCheckbox } from "../components/batch/BatchCheckbox";
import { ManageHeader } from "../components/batch/ManageHeader";
import { ContextMenu } from "../components/ui/ContextMenu";
import { TextPromptModal } from "../components/ui/TextPromptModal";
import { ConversationPanel } from "../features/chat/ConversationPanel";
import { useBatchSelection } from "../hooks/useBatchSelection";
import {
  ipcProjectsCreate,
  ipcProjectsDelete,
  ipcProjectsList,
  ipcProjectsRename,
  ipcSessionsCreate,
  ipcSessionsDelete,
  ipcSessionsListByProject,
  ipcSessionsRename,
} from "../ipc/client";
import { useShellNav } from "../providers/ShellNavProvider";
import { loadDesktopScope } from "../state/desktop-scope";
import { railPaneNavTitle } from "../state/nav-workspace";

interface ChatRailProps {
  onOpenSessionActions: (anchor: HTMLElement) => void;
  messageBatch: ReturnType<typeof useBatchSelection>;
}

type NamePromptState =
  | { mode: "create-project" }
  | { mode: "rename-project"; projectId: string; initialName: string }
  | { mode: "create-session" }
  | { mode: "rename-session"; sessionId: string; initialName: string };

type ListMenuState =
  | { kind: "project"; projectId: string; x: number; y: number }
  | { kind: "session"; sessionId: string; x: number; y: number };

export function ChatRail({
  onOpenSessionActions,
  messageBatch,
}: ChatRailProps) {
  const {
    viewId,
    projectId,
    projectName,
    sessionId,
    sessionName,
    openProject,
    openSession,
    goBackToProjects,
    goBackToSessions,
    showNavView,
  } = useShellNav();

  const {
    active: projectBatchActive,
    selectedIds: projectSelectedIds,
    selectedCount: projectSelectedCount,
    enter: enterProjectBatch,
    exit: exitProjectBatch,
    toggle: toggleProjectBatch,
    isSelected: isProjectSelected,
  } = useBatchSelection();
  const {
    active: sessionBatchActive,
    selectedIds: sessionSelectedIds,
    selectedCount: sessionSelectedCount,
    enter: enterSessionBatch,
    exit: exitSessionBatch,
    toggle: toggleSessionBatch,
    isSelected: isSessionSelected,
  } = useBatchSelection();

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [sessions, setSessions] = useState<SessionDto[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [namePrompt, setNamePrompt] = useState<NamePromptState | null>(null);
  const [listMenu, setListMenu] = useState<ListMenuState | null>(null);

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

  useEffect(() => {
    if (viewId !== "projects") {
      exitProjectBatch();
    }
  }, [viewId, exitProjectBatch]);

  useEffect(() => {
    if (viewId !== "sessions") {
      exitSessionBatch();
    }
  }, [viewId, exitSessionBatch]);

  const deleteSelectedProjects = useCallback(async () => {
    const ids = [...projectSelectedIds];
    for (const id of ids) {
      await ipcProjectsDelete({ id });
    }
    exitProjectBatch();
    await loadDesktopScope();
    await loadProjects();
    if (projectId != null && ids.includes(projectId)) {
      goBackToProjects();
    }
  }, [
    projectSelectedIds,
    exitProjectBatch,
    loadProjects,
    projectId,
    goBackToProjects,
  ]);

  const deleteSelectedSessions = useCallback(async () => {
    const ids = [...sessionSelectedIds];
    for (const id of ids) {
      await ipcSessionsDelete({ id });
    }
    exitSessionBatch();
    await loadDesktopScope();
    if (projectId) {
      await loadSessions(projectId);
    }
    if (sessionId != null && ids.includes(sessionId)) {
      showNavView("sessions");
    }
  }, [
    sessionSelectedIds,
    exitSessionBatch,
    projectId,
    sessionId,
    loadSessions,
    showNavView,
  ]);

  const confirmProjectBatchDelete = useCallback(() => {
    if (projectSelectedCount === 0) {
      return;
    }
    if (
      window.confirm(
        `确定删除选中的 ${projectSelectedCount} 个项目？将同时移除其下所有会话。`,
      )
    ) {
      void deleteSelectedProjects();
    }
  }, [projectSelectedCount, deleteSelectedProjects]);

  const confirmSessionBatchDelete = useCallback(() => {
    if (sessionSelectedCount === 0) {
      return;
    }
    if (window.confirm(`确定删除选中的 ${sessionSelectedCount} 个会话？`)) {
      void deleteSelectedSessions();
    }
  }, [sessionSelectedCount, deleteSelectedSessions]);

  const handleNamePromptConfirm = useCallback(
    async (name: string) => {
      if (!namePrompt) {
        return;
      }
      if (namePrompt.mode === "create-project") {
        const result = await ipcProjectsCreate({ name });
        if (result.ok) {
          await loadProjects();
          await openProject(result.data);
        }
        return;
      }
      if (namePrompt.mode === "rename-project") {
        const result = await ipcProjectsRename({
          id: namePrompt.projectId,
          name,
        });
        if (result.ok) {
          await loadProjects();
        }
        return;
      }
      if (namePrompt.mode === "create-session" && projectId) {
        const result = await ipcSessionsCreate({
          projectId,
          title: name,
        });
        if (result.ok) {
          await loadSessions(projectId);
          await openSession(result.data, projectName ?? "—");
        }
        return;
      }
      if (namePrompt.mode === "rename-session") {
        const result = await ipcSessionsRename({
          id: namePrompt.sessionId,
          title: name,
        });
        if (result.ok && projectId) {
          await loadSessions(projectId);
        }
      }
    },
    [namePrompt, loadProjects, openProject, projectId, projectName, loadSessions, openSession],
  );

  const openProjectMenu = (
    project: ProjectDto,
    event: React.MouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setListMenu({
      kind: "project",
      projectId: project.id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 140)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 100)),
    });
  };

  const openSessionMenu = (
    session: SessionDto,
    event: React.MouseEvent,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setListMenu({
      kind: "session",
      sessionId: session.id,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 140)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 100)),
    });
  };

  const handleListMenuSelect = useCallback(
    (action: string) => {
      if (!listMenu) {
        return;
      }
      if (listMenu.kind === "project") {
        const project = projects.find((p) => p.id === listMenu.projectId);
        if (!project) {
          return;
        }
        if (action === "rename") {
          setNamePrompt({
            mode: "rename-project",
            projectId: project.id,
            initialName: project.name,
          });
        } else if (action === "delete") {
          if (
            window.confirm(
              `确定删除项目「${project.name}」？将同时移除其下所有会话。`,
            )
          ) {
            void ipcProjectsDelete({ id: project.id }).then(async () => {
              await loadDesktopScope();
              await loadProjects();
              if (projectId === project.id) {
                goBackToProjects();
              }
            });
          }
        }
        return;
      }
      const session = sessions.find((s) => s.id === listMenu.sessionId);
      if (!session) {
        return;
      }
      if (action === "rename") {
        setNamePrompt({
          mode: "rename-session",
          sessionId: session.id,
          initialName: session.title ?? "",
        });
      } else if (action === "delete") {
        const label = session.title?.trim() || "该会话";
        if (window.confirm(`确定删除会话「${label}」？`)) {
          void ipcSessionsDelete({ id: session.id }).then(async () => {
            await loadDesktopScope();
            if (projectId) {
              await loadSessions(projectId);
            }
            if (sessionId === session.id) {
              showNavView("sessions");
            }
          });
        }
      }
    },
    [
      listMenu,
      projects,
      sessions,
      loadProjects,
      projectId,
      goBackToProjects,
      loadSessions,
      sessionId,
      showNavView,
    ],
  );

  const namePromptTitle = (() => {
    if (!namePrompt) {
      return "";
    }
    switch (namePrompt.mode) {
      case "create-project":
        return "新建项目";
      case "rename-project":
        return "重命名项目";
      case "create-session":
        return "新建会话";
      case "rename-session":
        return "重命名会话";
      default:
        return "";
    }
  })();

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
          <ManageHeader
            title="项目"
            batchMode={projectBatchActive}
            selectedCount={projectSelectedCount}
            onEnterBatch={enterProjectBatch}
            onCancelBatch={exitProjectBatch}
            onDelete={confirmProjectBatchDelete}
            hint="选择要删除的项目（将同时移除其下所有会话）"
            normalActions={
              <button
                type="button"
                className="list-manage-header__btn list-manage-header__btn--primary"
                onClick={() => setNamePrompt({ mode: "create-project" })}
              >
                新建
              </button>
            }
          />
          <ul className="chat-list" id="project-list">
            {loadingProjects ? (
              <li className="chat-list__item">
                <span className="chat-list__label">加载中…</span>
              </li>
            ) : projects.length === 0 ? (
              <li className="chat-list__item chat-list__item--empty">
                <span className="chat-list__label">暂无项目</span>
                <button
                  type="button"
                  className="chat-list__create-btn"
                  onClick={() => setNamePrompt({ mode: "create-project" })}
                >
                  新建项目
                </button>
              </li>
            ) : (
              projects.map((project) => (
                <li
                  key={project.id}
                  className={`chat-list__item${isProjectSelected(project.id) ? " is-selected" : ""}`}
                  data-project-id={project.id}
                  data-project-name={project.name}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (projectBatchActive) {
                      toggleProjectBatch(project.id);
                    } else {
                      void openProject(project);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (projectBatchActive) {
                        toggleProjectBatch(project.id);
                      } else {
                        void openProject(project);
                      }
                    }
                  }}
                >
                  {projectBatchActive ? (
                    <BatchCheckbox
                      checked={isProjectSelected(project.id)}
                      onToggle={() => toggleProjectBatch(project.id)}
                    />
                  ) : (
                    <span className="chat-list__icon">📚</span>
                  )}
                  <span className="chat-list__label">{project.name}</span>
                  {!projectBatchActive ? (
                    <>
                      <button
                        type="button"
                        className="chat-list__menu-btn"
                        aria-label="项目操作"
                        onClick={(e) => openProjectMenu(project, e)}
                      >
                        ⋮
                      </button>
                      <span className="chat-list__chevron">›</span>
                    </>
                  ) : null}
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
          <ManageHeader
            title="会话"
            batchMode={sessionBatchActive}
            selectedCount={sessionSelectedCount}
            onEnterBatch={enterSessionBatch}
            onCancelBatch={exitSessionBatch}
            onDelete={confirmSessionBatchDelete}
            hint="选择要删除的会话"
            normalActions={
              <button
                type="button"
                className="list-manage-header__btn list-manage-header__btn--primary"
                onClick={() => setNamePrompt({ mode: "create-session" })}
              >
                新建
              </button>
            }
          />
          <ul className="chat-list" id="session-list">
            {loadingSessions ? (
              <li className="chat-list__item">
                <span className="chat-list__label">加载中…</span>
              </li>
            ) : sessions.length === 0 ? (
              <li className="chat-list__item chat-list__item--empty">
                <span className="chat-list__label">暂无会话</span>
                <button
                  type="button"
                  className="chat-list__create-btn"
                  onClick={() => setNamePrompt({ mode: "create-session" })}
                >
                  新建会话
                </button>
              </li>
            ) : (
              sessions.map((session) => (
                <li
                  key={session.id}
                  className={`chat-list__item${isSessionSelected(session.id) ? " is-selected" : ""}`}
                  data-session-id={session.id}
                  data-session-name={session.title ?? ""}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (sessionBatchActive) {
                      toggleSessionBatch(session.id);
                    } else {
                      void openSession(session, projectName ?? "—");
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (sessionBatchActive) {
                        toggleSessionBatch(session.id);
                      } else {
                        void openSession(session, projectName ?? "—");
                      }
                    }
                  }}
                >
                  {sessionBatchActive ? (
                    <BatchCheckbox
                      checked={isSessionSelected(session.id)}
                      onToggle={() => toggleSessionBatch(session.id)}
                    />
                  ) : null}
                  <span className="chat-list__label">
                    {session.title ?? "未命名会话"}
                  </span>
                  {!sessionBatchActive ? (
                    <>
                      <button
                        type="button"
                        className="chat-list__menu-btn"
                        aria-label="会话操作"
                        onClick={(e) => openSessionMenu(session, e)}
                      >
                        ⋮
                      </button>
                      <span className="chat-list__chevron">›</span>
                    </>
                  ) : null}
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
          {projectId && sessionId ? (
            <ConversationPanel
              projectId={projectId}
              sessionId={sessionId}
              onOpenSessionActions={onOpenSessionActions}
              messageBatch={messageBatch}
            />
          ) : (
            <p className="preview-empty">请选择会话</p>
          )}
        </div>
      </section>

      <TextPromptModal
        open={namePrompt != null}
        title={namePromptTitle}
        initialValue={
          namePrompt?.mode === "rename-project"
            ? namePrompt.initialName
            : namePrompt?.mode === "rename-session"
              ? namePrompt.initialName
              : ""
        }
        placeholder="请输入名称"
        onClose={() => setNamePrompt(null)}
        onConfirm={handleNamePromptConfirm}
      />

      <ContextMenu
        open={listMenu != null}
        x={listMenu?.x ?? 0}
        y={listMenu?.y ?? 0}
        items={[
          { label: "重命名", action: "rename" },
          { label: "删除", action: "delete", danger: true },
        ]}
        onSelect={handleListMenuSelect}
        onClose={() => setListMenu(null)}
      />
    </>
  );
}
