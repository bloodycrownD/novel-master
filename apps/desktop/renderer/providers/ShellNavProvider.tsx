/**

 * Shell navigation: chat rail drill-down + workspace scope sync.

 */

import {

  createContext,

  useCallback,

  useContext,

  useEffect,

  useMemo,

  useRef,

  useState,

  type ReactNode,

} from "react";

import type {
  ProjectDto,
  SessionDto,
  PreviewFileSelection,
  WorkplaceListRowDto,
  WorkspaceMutatedPayload,
  WorkspacePanelScope,
} from "@shared/ipc-types";
import { previewTabKey } from "../layout/preview-tab-utils";

import {

  ipcProjectsList,

  ipcSessionsListByProject,

  onWorkspaceMutated,

} from "../ipc/client";

import {
  markPreviewTabsDeletedUnderPathInList,
  syncPreviewTabsWithFileRows,
} from "../features/workspace/preview-tab-sync";
import { useWorkspaceFooterReload } from "../features/chat/useWorkspaceFooterReload";

import { loadDesktopScope, setDesktopProject, setDesktopSession } from "../state/desktop-scope";

import {

  syncWorkspaceWithNav,

  type NavViewId,

  type WorkspaceScope,

} from "../state/nav-workspace";



export interface ShellNavContextValue {

  viewId: NavViewId;

  workspaceScope: WorkspaceScope;

  projectId: string | undefined;

  projectName: string | undefined;

  sessionId: string | undefined;

  sessionName: string | undefined;

  updateSessionName: (name: string) => void;

  showNavView: (viewId: NavViewId) => void;

  openProject: (project: ProjectDto) => Promise<void>;

  openSession: (session: SessionDto, projectName: string) => Promise<void>;

  goBackToProjects: () => void;

  goBackToSessions: () => void;

  previewTabs: PreviewFileSelection[];
  activePreviewKey: string | null;
  /** 当前激活的预览文件（由 active tab 派生） */
  previewFile: PreviewFileSelection | null;
  selectPreviewFile: (
    workspaceScope: PreviewFileSelection["workspaceScope"],
    path: string,
  ) => void;
  closePreviewTab: (
    workspaceScope: PreviewFileSelection["workspaceScope"],
    path: string,
  ) => void;
  closePreviewTabsUnderPath: (
    workspaceScope: PreviewFileSelection["workspaceScope"],
    path: string,
  ) => void;
  /** 将路径下预览 tab 标为已删除（VS Code 式，不关闭 tab） */
  markPreviewTabsDeletedUnderPath: (
    workspaceScope: PreviewFileSelection["workspaceScope"],
    path: string,
  ) => void;
  /** 工作区重命名后同步预览 tab 的路径与文件名 */
  renamePreviewTab: (
    workspaceScope: PreviewFileSelection["workspaceScope"],
    oldPath: string,
    newPath: string,
  ) => void;
  /** 工作区树重载后，用 file 行校验 open tab 是否存在 */
  syncPreviewTabsFromFileRows: (
    scope: WorkspacePanelScope,
    rows: WorkplaceListRowDto[],
  ) => void;
  clearPreviewFile: () => void;
  treeRefreshToken: number;
  /** Desktop 消费方 ①：VFS / 规则变更后立即刷新 Explorer（100ms 去抖） */
  notifyWorkspaceMutated: () => void;
  /** @deprecated 使用 notifyWorkspaceMutated */
  refreshWorkspaceTrees: () => void;
  treeExpandRequest: { path: string; token: number } | null;
  requestTreeExpandPath: (path: string) => void;
  /** Bumps when workspace model/agent selection changes (footer, settings, etc.). */
  agentConfigRevision: number;
  notifyAgentConfigChanged: () => void;
  /** 强制重挂 WorkspaceFooter / 重拉 token IPC（run finished、messages changed）。 */
  footerKey: number;
  reloadFooter: () => void;
  /** 注册 Preview 列可见性回调（由 App 注入 toggleColumn）。 */
  registerEnsurePreviewVisible: (fn: () => void) => void;
  /** 在聊天工作区 Preview 打开文件；若 Preview 列隐藏则先显示。 */
  openChatWorkspacePreview: (path: string) => void;
}



const WORKSPACE_MUTATED_DEBOUNCE_MS = 100;

/** 判断 main push 的工作区变更是否影响当前导航上下文。 */
function workspaceMutatedMatchesNav(
  payload: WorkspaceMutatedPayload,
  projectId: string | undefined,
  sessionId: string | undefined,
): boolean {
  if (payload.workspaceScope === "global") {
    return true;
  }
  if (payload.workspaceScope === "session") {
    return payload.projectId === projectId;
  }
  return payload.projectId === projectId && payload.sessionId === sessionId;
}

const ShellNavContext = createContext<ShellNavContextValue | undefined>(

  undefined,

);



/** Maps reconciled scope pointers to the chat-rail drill-down view. */

function viewIdForScope(

  projectId: string | undefined,

  sessionId: string | undefined,

): NavViewId {

  if (projectId == null) {

    return "projects";

  }

  if (sessionId == null) {

    return "sessions";

  }

  return "conversation";

}



export function ShellNavProvider({ children }: { children: ReactNode }) {

  const [viewId, setViewId] = useState<NavViewId>("projects");

  const [workspaceScope, setWorkspaceScope] =

    useState<WorkspaceScope>("global");

  const [projectId, setProjectId] = useState<string | undefined>();

  const [projectName, setProjectName] = useState<string | undefined>();

  const [sessionId, setSessionId] = useState<string | undefined>();

  const [sessionName, setSessionName] = useState<string | undefined>();

  const [previewTabs, setPreviewTabs] = useState<PreviewFileSelection[]>([]);
  const [activePreviewKey, setActivePreviewKey] = useState<string | null>(null);
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
  const [treeExpandRequest, setTreeExpandRequest] = useState<{
    path: string;
    token: number;
  } | null>(null);
  const [agentConfigRevision, setAgentConfigRevision] = useState(0);
  const mutateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ensurePreviewVisibleRef = useRef<(() => void) | null>(null);

  const registerEnsurePreviewVisible = useCallback((fn: () => void) => {
    ensurePreviewVisibleRef.current = fn;
  }, []);

  const bumpTreeRefresh = useCallback(() => {
    setTreeRefreshToken((t) => t + 1);
  }, []);

  const notifyWorkspaceMutated = useCallback(() => {
    if (mutateDebounceRef.current != null) {
      clearTimeout(mutateDebounceRef.current);
    }
    mutateDebounceRef.current = setTimeout(() => {
      mutateDebounceRef.current = null;
      bumpTreeRefresh();
    }, WORKSPACE_MUTATED_DEBOUNCE_MS);
  }, [bumpTreeRefresh]);

  useEffect(() => {
    return () => {
      if (mutateDebounceRef.current != null) {
        clearTimeout(mutateDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return onWorkspaceMutated((payload) => {
      if (workspaceMutatedMatchesNav(payload, projectId, sessionId)) {
        notifyWorkspaceMutated();
      }
    });
  }, [projectId, sessionId, notifyWorkspaceMutated]);

  const selectPreviewFile = useCallback(
    (workspaceScope: PreviewFileSelection["workspaceScope"], path: string) => {
      const key = previewTabKey(workspaceScope, path);
      const name = path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1);
      setPreviewTabs((prev) => {
        const index = prev.findIndex(
          (tab) =>
            tab.workspaceScope === workspaceScope && tab.path === path,
        );
        if (index !== -1) {
          const tab = prev[index]!;
          if (!tab.isDeleted) {
            return prev;
          }
          const next = [...prev];
          next[index] = { ...tab, isDeleted: false };
          return next;
        }
        return [...prev, { workspaceScope, path, name, isDeleted: false }];
      });
      setActivePreviewKey(key);
    },
    [],
  );

  const openChatWorkspacePreview = useCallback(
    (path: string) => {
      selectPreviewFile("chat", path);
      ensurePreviewVisibleRef.current?.();
    },
    [selectPreviewFile],
  );

  const closePreviewTab = useCallback(
    (workspaceScope: PreviewFileSelection["workspaceScope"], path: string) => {
      const key = previewTabKey(workspaceScope, path);
      setPreviewTabs((prev) => {
        const index = prev.findIndex(
          (tab) =>
            tab.workspaceScope === workspaceScope && tab.path === path,
        );
        if (index === -1) {
          return prev;
        }
        const next = prev.filter((_, i) => i !== index);
        setActivePreviewKey((activeKey) => {
          if (activeKey !== key) {
            return activeKey;
          }
          if (next.length === 0) {
            return null;
          }
          const nextIndex = Math.min(index, next.length - 1);
          const tab = next[nextIndex]!;
          return previewTabKey(tab.workspaceScope, tab.path);
        });
        return next;
      });
    },
    [],
  );

  const closePreviewTabsUnderPath = useCallback(
    (workspaceScope: PreviewFileSelection["workspaceScope"], path: string) => {
      setPreviewTabs((prev) => {
        const next = prev.filter(
          (tab) =>
            tab.workspaceScope !== workspaceScope ||
            (tab.path !== path && !tab.path.startsWith(`${path}/`)),
        );
        if (next.length === prev.length) {
          return prev;
        }
        setActivePreviewKey((activeKey) => {
          if (activeKey == null) {
            return null;
          }
          const stillOpen = next.some(
            (tab) => previewTabKey(tab.workspaceScope, tab.path) === activeKey,
          );
          if (stillOpen) {
            return activeKey;
          }
          if (next.length === 0) {
            return null;
          }
          const tab = next[next.length - 1]!;
          return previewTabKey(tab.workspaceScope, tab.path);
        });
        return next;
      });
    },
    [],
  );

  const markPreviewTabsDeletedUnderPath = useCallback(
    (workspaceScope: PreviewFileSelection["workspaceScope"], path: string) => {
      setPreviewTabs((prev) =>
        markPreviewTabsDeletedUnderPathInList(prev, workspaceScope, path),
      );
    },
    [],
  );

  const renamePreviewTab = useCallback(
    (
      workspaceScope: PreviewFileSelection["workspaceScope"],
      oldPath: string,
      newPath: string,
    ) => {
      const newName =
        newPath === "/" ? "/" : newPath.slice(newPath.lastIndexOf("/") + 1);
      const oldKey = previewTabKey(workspaceScope, oldPath);
      const newKey = previewTabKey(workspaceScope, newPath);
      setPreviewTabs((prev) =>
        prev.map((tab) =>
          tab.workspaceScope === workspaceScope && tab.path === oldPath
            ? {
                ...tab,
                path: newPath,
                name: newName,
                isDeleted: false,
              }
            : tab,
        ),
      );
      setActivePreviewKey((activeKey) =>
        activeKey === oldKey ? newKey : activeKey,
      );
    },
    [],
  );

  const syncPreviewTabsFromFileRows = useCallback(
    (scope: WorkspacePanelScope, rows: WorkplaceListRowDto[]) => {
      setPreviewTabs((prev) => syncPreviewTabsWithFileRows(prev, rows, scope));
    },
    [],
  );

  const clearPreviewFile = useCallback(() => {
    setPreviewTabs([]);
    setActivePreviewKey(null);
  }, []);

  const previewFile = useMemo(() => {
    if (activePreviewKey == null) {
      return null;
    }
    return (
      previewTabs.find(
        (tab) => previewTabKey(tab.workspaceScope, tab.path) === activePreviewKey,
      ) ?? null
    );
  }, [previewTabs, activePreviewKey]);

  const refreshWorkspaceTrees = notifyWorkspaceMutated;

  const requestTreeExpandPath = useCallback((path: string) => {
    setTreeExpandRequest((prev) => ({
      path,
      token: (prev?.token ?? 0) + 1,
    }));
  }, []);

  const { footerKey, reloadFooter } = useWorkspaceFooterReload();

  const notifyAgentConfigChanged = useCallback(() => {
    setAgentConfigRevision((r) => r + 1);
    reloadFooter();
  }, [reloadFooter]);

  const updateSessionName = useCallback((name: string) => {
    setSessionName(name);
  }, []);

  const showNavView = useCallback((nextViewId: NavViewId) => {

    setViewId(nextViewId);

    setWorkspaceScope(syncWorkspaceWithNav(nextViewId));

  }, []);



  const openProject = useCallback(

    async (project: ProjectDto) => {

      clearPreviewFile();

      setProjectId(project.id);

      setProjectName(project.name);

      setSessionId(undefined);

      setSessionName(undefined);

      await setDesktopProject(project.id);

      showNavView("sessions");

    },

    [showNavView, clearPreviewFile],

  );



  const openSession = useCallback(

    async (session: SessionDto, parentProjectName: string) => {

      clearPreviewFile();

      setProjectId(session.projectId);

      setProjectName(parentProjectName);

      setSessionId(session.id);

      setSessionName(session.title ?? "未命名会话");

      await setDesktopSession(session.projectId, session.id);

      showNavView("conversation");

    },

    [showNavView, clearPreviewFile],

  );



  const goBackToProjects = useCallback(() => {

    clearPreviewFile();

    setProjectId(undefined);

    setProjectName(undefined);

    setSessionId(undefined);

    setSessionName(undefined);

    showNavView("projects");

  }, [showNavView, clearPreviewFile]);



  const goBackToSessions = useCallback(() => {

    clearPreviewFile();

    setSessionId(undefined);

    setSessionName(undefined);

    showNavView("sessions");

  }, [showNavView, clearPreviewFile]);



  useEffect(() => {

    let cancelled = false;



    (async () => {

      // Intent: hydrate chat-rail nav from PersistentState after runtime bootstrap.

      // Main reconciles missing ids; renderer resolves display names and drill-down view.

      const scope = await loadDesktopScope();

      if (cancelled) {

        return;

      }



      let nextProjectId = scope.projectId;

      let nextSessionId = scope.sessionId;

      let nextProjectName: string | undefined;

      let nextSessionName: string | undefined;



      const projectsResult = await ipcProjectsList();

      if (cancelled) {

        return;

      }

      const projects = projectsResult.ok ? projectsResult.data : [];



      if (nextProjectId != null) {

        const project = projects.find((p) => p.id === nextProjectId);

        if (!project) {

          // Stored project no longer exists — fall back to project list.

          nextProjectId = undefined;

          nextSessionId = undefined;

        } else {

          nextProjectName = project.name;

        }

      }



      if (nextProjectId != null && nextSessionId != null) {

        const sessionsResult = await ipcSessionsListByProject({

          projectId: nextProjectId,

        });

        if (cancelled) {

          return;

        }

        const sessions = sessionsResult.ok ? sessionsResult.data : [];

        const session = sessions.find((s) => s.id === nextSessionId);

        if (!session) {

          // Stored session missing — stay on sessions list for the project.

          nextSessionId = undefined;

        } else {

          nextSessionName = session.title ?? "未命名会话";

        }

      }



      const nextViewId = viewIdForScope(nextProjectId, nextSessionId);

      setProjectId(nextProjectId);

      setProjectName(nextProjectName);

      setSessionId(nextSessionId);

      setSessionName(nextSessionName);

      setViewId(nextViewId);

      setWorkspaceScope(syncWorkspaceWithNav(nextViewId));

    })().catch(() => {

      // Scope hydration failure is non-fatal; user stays on default projects view.

    });



    return () => {

      cancelled = true;

    };

  }, []);



  const value = useMemo<ShellNavContextValue>(

    () => ({

      viewId,

      workspaceScope,

      projectId,

      projectName,

      sessionId,

      sessionName,

      updateSessionName,

      showNavView,

      openProject,

      openSession,

      goBackToProjects,

      goBackToSessions,

      previewTabs,

      activePreviewKey,

      previewFile,

      selectPreviewFile,

      closePreviewTab,

      closePreviewTabsUnderPath,

      markPreviewTabsDeletedUnderPath,

      renamePreviewTab,

      syncPreviewTabsFromFileRows,

      clearPreviewFile,

      treeRefreshToken,

      notifyWorkspaceMutated,

      refreshWorkspaceTrees,

      treeExpandRequest,

      requestTreeExpandPath,

      agentConfigRevision,

      notifyAgentConfigChanged,

      footerKey,

      reloadFooter,

      registerEnsurePreviewVisible,

      openChatWorkspacePreview,

    }),

    [

      viewId,

      workspaceScope,

      projectId,

      projectName,

      sessionId,

      sessionName,

      updateSessionName,

      showNavView,

      openProject,

      openSession,

      goBackToProjects,

      goBackToSessions,

      previewTabs,

      activePreviewKey,

      previewFile,

      selectPreviewFile,

      closePreviewTab,

      closePreviewTabsUnderPath,

      markPreviewTabsDeletedUnderPath,

      renamePreviewTab,

      syncPreviewTabsFromFileRows,

      clearPreviewFile,

      treeRefreshToken,

      notifyWorkspaceMutated,

      refreshWorkspaceTrees,

      treeExpandRequest,

      requestTreeExpandPath,

      agentConfigRevision,

      notifyAgentConfigChanged,

      footerKey,

      reloadFooter,

      registerEnsurePreviewVisible,

      openChatWorkspacePreview,

    ],

  );



  return (

    <ShellNavContext.Provider value={value}>{children}</ShellNavContext.Provider>

  );

}



export function useShellNav(): ShellNavContextValue {

  const ctx = useContext(ShellNavContext);

  if (!ctx) {

    throw new Error("useShellNav must be used within ShellNavProvider");

  }

  return ctx;

}

