/**

 * Shell navigation: chat rail drill-down + workspace scope sync.

 */

import {

  createContext,

  useCallback,

  useContext,

  useEffect,

  useMemo,

  useState,

  type ReactNode,

} from "react";

import type { ProjectDto, SessionDto, PreviewFileSelection } from "@shared/ipc-types";

import {

  ipcProjectsList,

  ipcSessionsListByProject,

} from "../ipc/client";

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

  previewFile: PreviewFileSelection | null;
  selectPreviewFile: (
    workspaceScope: PreviewFileSelection["workspaceScope"],
    path: string,
  ) => void;
  clearPreviewFile: () => void;
  treeRefreshToken: number;
  refreshWorkspaceTrees: () => void;
  treeExpandRequest: { path: string; token: number } | null;
  requestTreeExpandPath: (path: string) => void;
  /** Bumps when workspace model/agent selection changes (footer, settings, etc.). */
  agentConfigRevision: number;
  notifyAgentConfigChanged: () => void;
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

  const [previewFile, setPreviewFile] = useState<PreviewFileSelection | null>(
    null,
  );
  const [treeRefreshToken, setTreeRefreshToken] = useState(0);
  const [treeExpandRequest, setTreeExpandRequest] = useState<{
    path: string;
    token: number;
  } | null>(null);
  const [agentConfigRevision, setAgentConfigRevision] = useState(0);

  const selectPreviewFile = useCallback(
    (workspaceScope: PreviewFileSelection["workspaceScope"], path: string) => {
      setPreviewFile({
        workspaceScope,
        path,
        name: path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1),
      });
    },
    [],
  );

  const clearPreviewFile = useCallback(() => {
    setPreviewFile(null);
  }, []);

  const refreshWorkspaceTrees = useCallback(() => {
    setTreeRefreshToken((t) => t + 1);
  }, []);

  const requestTreeExpandPath = useCallback((path: string) => {
    setTreeExpandRequest((prev) => ({
      path,
      token: (prev?.token ?? 0) + 1,
    }));
  }, []);

  const notifyAgentConfigChanged = useCallback(() => {
    setAgentConfigRevision((r) => r + 1);
  }, []);

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

      previewFile,

      selectPreviewFile,

      clearPreviewFile,

      treeRefreshToken,

      refreshWorkspaceTrees,

      treeExpandRequest,

      requestTreeExpandPath,

      agentConfigRevision,

      notifyAgentConfigChanged,

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

      previewFile,

      selectPreviewFile,

      clearPreviewFile,

      treeRefreshToken,

      refreshWorkspaceTrees,

      treeExpandRequest,

      requestTreeExpandPath,

      agentConfigRevision,

      notifyAgentConfigChanged,

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

