import { WorkspaceHeaderActions } from "../features/workspace/WorkspaceHeaderActions";
import {
  WorkspaceTree,
  type WorkspaceContextTarget,
} from "../features/workspace/WorkspaceTree";
import { useShellNav } from "../providers/ShellNavProvider";
import { workspaceTitleForScope } from "../state/nav-workspace";
import { WorkspaceFooter } from "../features/chat/WorkspaceFooter";

interface ExplorerPaneProps {
  onOpenContextMenu: (target: WorkspaceContextTarget) => void;
  onBlankContextMenu: (target: Extract<WorkspaceContextTarget, { kind: "blank" }>) => void;
}

export function ExplorerPane({
  onOpenContextMenu,
  onBlankContextMenu,
}: ExplorerPaneProps) {
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
        <WorkspaceHeaderActions
          panelScope={workspaceScope}
          onRefresh={refreshWorkspaceTrees}
        />
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
                      onOpenContextMenu={onOpenContextMenu}
                      onBlankContextMenu={onBlankContextMenu}
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
