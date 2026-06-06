/**
 * Shell navigation: chat rail drill-down + workspace scope sync.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ProjectDto, SessionDto } from "../../shared/ipc-types";
import { setDesktopProject, setDesktopSession } from "../state/desktop-scope";
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
  showNavView: (viewId: NavViewId) => void;
  openProject: (project: ProjectDto) => Promise<void>;
  openSession: (session: SessionDto, projectName: string) => Promise<void>;
  goBackToProjects: () => void;
  goBackToSessions: () => void;
}

const ShellNavContext = createContext<ShellNavContextValue | undefined>(
  undefined,
);

export function ShellNavProvider({ children }: { children: ReactNode }) {
  const [viewId, setViewId] = useState<NavViewId>("projects");
  const [workspaceScope, setWorkspaceScope] =
    useState<WorkspaceScope>("global");
  const [projectId, setProjectId] = useState<string | undefined>();
  const [projectName, setProjectName] = useState<string | undefined>();
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [sessionName, setSessionName] = useState<string | undefined>();

  const showNavView = useCallback((nextViewId: NavViewId) => {
    setViewId(nextViewId);
    setWorkspaceScope(syncWorkspaceWithNav(nextViewId));
  }, []);

  const openProject = useCallback(
    async (project: ProjectDto) => {
      setProjectId(project.id);
      setProjectName(project.name);
      setSessionId(undefined);
      setSessionName(undefined);
      await setDesktopProject(project.id);
      showNavView("sessions");
    },
    [showNavView],
  );

  const openSession = useCallback(
    async (session: SessionDto, parentProjectName: string) => {
      setProjectId(session.projectId);
      setProjectName(parentProjectName);
      setSessionId(session.id);
      setSessionName(session.title ?? "未命名会话");
      await setDesktopSession(session.projectId, session.id);
      showNavView("conversation");
    },
    [showNavView],
  );

  const goBackToProjects = useCallback(() => {
    showNavView("projects");
  }, [showNavView]);

  const goBackToSessions = useCallback(() => {
    showNavView("sessions");
  }, [showNavView]);

  const value = useMemo<ShellNavContextValue>(
    () => ({
      viewId,
      workspaceScope,
      projectId,
      projectName,
      sessionId,
      sessionName,
      showNavView,
      openProject,
      openSession,
      goBackToProjects,
      goBackToSessions,
    }),
    [
      viewId,
      workspaceScope,
      projectId,
      projectName,
      sessionId,
      sessionName,
      showNavView,
      openProject,
      openSession,
      goBackToProjects,
      goBackToSessions,
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
