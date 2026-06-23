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
    notifyWorkspaceMutated,
    syncPreviewTabsFromFileRows,
  } = useShellNav();
  const title = workspaceTitleForScope(workspaceScope);

  return (
    <>
      <header className="column-header" id="explorer-header" aria-label="工作区">
        <span className="column-header__title" id="workspace-title">
          {title}
        </span>
        <WorkspaceHeaderActions
          panelScope={workspaceScope}
          onRefresh={notifyWorkspaceMutated}
        />
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
                  onPointerDown={(e) => {
                    // 树节点按下时不 refresh，避免 reload 替换 DOM 导致 macOS 单击丢失
                    if ((e.target as HTMLElement).closest(".tree-node")) {
                      return;
                    }
                    notifyWorkspaceMutated();
                  }}
                  onContextMenu={(e) => {
                    if ((e.target as HTMLElement).closest(".tree-node")) {
                      return;
                    }
                    e.preventDefault();
                    onBlankContextMenu({
                      kind: "blank",
                      panelScope: scope,
                      x: e.clientX,
                      y: e.clientY,
                    });
                  }}
                >
                  {visible ? (
                    <WorkspaceTree
                      panelScope={scope}
                      refreshToken={treeRefreshToken}
                      onOpenContextMenu={onOpenContextMenu}
                      onRowsLoaded={(rows) =>
                        syncPreviewTabsFromFileRows(scope, rows)
                      }
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
