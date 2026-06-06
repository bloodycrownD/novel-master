import {
  WorkspaceTree,
  type WorkspaceContextTarget,
  handleWorkspaceContextAction,
} from "../features/workspace/WorkspaceTree";
import { useShellNav } from "../providers/ShellNavProvider";
import { workspaceTitleForScope } from "../state/nav-workspace";
import { WorkspaceFooter } from "../features/chat/WorkspaceFooter";

interface ExplorerPaneProps {
  onOpenContextMenu: (target: WorkspaceContextTarget) => void;
}

export function ExplorerPane({ onOpenContextMenu }: ExplorerPaneProps) {
  const {
    workspaceScope,
    viewId,
    projectId,
    sessionId,
    treeRefreshToken,
    refreshWorkspaceTrees,
  } = useShellNav();
  const title = workspaceTitleForScope(workspaceScope);

  return (
    <>
      <header className="column-header" id="explorer-header" aria-label="工作区">
        <span className="column-header__title" id="workspace-title">
          {title}
        </span>
      </header>
      <section id="explorer-pane" aria-label="工作区">
        <div className="workspace-trees">
          {(["global", "session", "chat"] as const).map((scope) => {
            const visible = workspaceScope === scope;
            return (
              <div
                key={scope}
                className={`workspace-tree-panel${visible ? " is-visible" : ""}`}
                data-workspace-panel={scope}
                hidden={!visible}
              >
                <div
                  className="explorer-tree"
                  data-tree={scope}
                  id={`workspace-tree-${scope}`}
                >
                  {visible ? (
                    <WorkspaceTree
                      panelScope={scope}
                      refreshToken={treeRefreshToken}
                      onRefresh={refreshWorkspaceTrees}
                      onOpenContextMenu={onOpenContextMenu}
                    />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <div
          id="workspace-footer"
          className={`workspace-footer${viewId === "conversation" ? "" : " hidden"}`}
          hidden={viewId !== "conversation"}
        >
          {viewId === "conversation" && projectId && sessionId ? (
            <WorkspaceFooter projectId={projectId} sessionId={sessionId} />
          ) : (
            <div id="conversation-meta" className="workspace-footer-card" />
          )}
        </div>
      </section>
    </>
  );
}

export type { WorkspaceContextTarget };

export async function runWorkspaceContextAction(
  target: WorkspaceContextTarget,
  action: string,
  projectId: string | undefined,
  sessionId: string | undefined,
  refresh: () => void,
): Promise<void> {
  await handleWorkspaceContextAction(
    target,
    action,
    projectId,
    sessionId,
    refresh,
  );
}
