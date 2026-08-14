/**
 * Chat rail nav view → explorer workspace scope mapping (prototype parity).
 *
 * @module state/nav-workspace
 */

export type NavViewId =
  | "projects"
  | "sessions"
  | "conversation"
  | "subagent-conversation";

export type WorkspaceScope = "global" | "session" | "chat";

export const NAV_TO_WORKSPACE: Record<NavViewId, WorkspaceScope> = {
  projects: "global",
  sessions: "session",
  conversation: "chat",
  // panelScope 仍为 "chat"（session 级 VFS），但 workspaceSessionId 在子会话 view 下指向子 session
  // （见 ShellNavProvider），实际展示子 session 自己的工作区，不再与父会话共享
  "subagent-conversation": "chat",
};

export const WORKSPACE_TITLES: Record<WorkspaceScope, string> = {
  global: "全局工作区",
  session: "会话工作区",
  chat: "聊天工作区",
};

/** Sync explorer title/panel with current chat nav view. */
export function syncWorkspaceWithNav(viewId: NavViewId): WorkspaceScope {
  return NAV_TO_WORKSPACE[viewId] ?? "global";
}

export function workspaceTitleForScope(scope: WorkspaceScope): string {
  return WORKSPACE_TITLES[scope] ?? "工作区";
}

export function railPaneNavTitle(viewId: NavViewId): string {
  if (viewId === "projects") return "项目";
  if (viewId === "subagent-conversation") return "子智能体会话";
  return "—";
}
