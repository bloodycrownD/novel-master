import { useCallback, useEffect, useState } from "react";
import { EVENT_AGENT_RUN_FINISHED } from "@shared/agent-event-types";
import type { AgentRunFinishedPayload } from "@shared/agent-event-types";
import type { VfsScopeRequest, WorkspacePanelScope } from "@shared/ipc-types";
import { onAgentStream, vfsScope } from "../ipc/client";
import { WorkspaceHeaderActions } from "../features/workspace/WorkspaceHeaderActions";
import {
  WorkspaceTree,
  type WorkspaceContextTarget,
} from "../features/workspace/WorkspaceTree";
import { useShellNav } from "../providers/ShellNavProvider";
import { workspaceTitleForScope } from "../state/nav-workspace";
import { WorkspaceFooter } from "../features/chat/WorkspaceFooter";
import { ConfirmModal } from "../components/ui/ConfirmModal";
import {
  confirmAndApplyBatchIngest,
  handleTreeDrop,
  type BatchIngestConfirmRequest,
} from "../features/workspace/workspace-batch-dnd";

interface ExplorerPaneProps {
  onOpenContextMenu: (target: WorkspaceContextTarget) => void;
  onBlankContextMenu: (target: Extract<WorkspaceContextTarget, { kind: "blank" }>) => void;
}

function scopeRequest(
  panelScope: WorkspacePanelScope,
  projectId?: string,
  sessionId?: string,
): VfsScopeRequest {
  return vfsScope(panelScope, projectId, sessionId);
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
    footerKey,
    reloadFooter,
  } = useShellNav();
  const title = workspaceTitleForScope(workspaceScope);
  const [dropHighlightRoot, setDropHighlightRoot] = useState(false);
  const [ingestConfirm, setIngestConfirm] =
    useState<BatchIngestConfirmRequest | null>(null);
  const [ingestBusy, setIngestBusy] = useState(false);

  // agent.run.finished → 刷新页脚 token（缓存已在 core 写好）
  useEffect(() => {
    if (sessionId == null) {
      return;
    }
    return onAgentStream((envelope) => {
      if (envelope.type !== EVENT_AGENT_RUN_FINISHED) {
        return;
      }
      const payload = envelope.payload as AgentRunFinishedPayload;
      if (payload.sessionId === sessionId) {
        reloadFooter();
      }
    });
  }, [sessionId, reloadFooter]);

  const handleBlankDragOver = useCallback((e: React.DragEvent) => {
    if ((e.target as HTMLElement).closest(".tree-node")) {
      return;
    }
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDropHighlightRoot(true);
    }
  }, []);

  const handleBlankDrop = useCallback(
    async (e: React.DragEvent, panelScope: WorkspacePanelScope) => {
      if ((e.target as HTMLElement).closest(".tree-node")) {
        return;
      }
      e.preventDefault();
      setDropHighlightRoot(false);
      await handleTreeDrop({
        scope: scopeRequest(panelScope, projectId, sessionId),
        targetDir: "/",
        dataTransfer: e.dataTransfer,
        onNeedsConfirm: setIngestConfirm,
        onMutated: notifyWorkspaceMutated,
      });
    },
    [projectId, sessionId, notifyWorkspaceMutated],
  );

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
                hidden={!visible}
                data-workspace-panel={scope}
              >
                <div
                  className={`explorer-tree${dropHighlightRoot && visible ? " is-drop-target" : ""}`}
                  data-tree={scope}
                  id={`workspace-tree-${scope}`}
                  onPointerDown={(e) => {
                    // 树节点按下时不 refresh，避免 reload 替换 DOM 导致 macOS 单击丢失
                    if ((e.target as HTMLElement).closest(".tree-node")) {
                      return;
                    }
                    notifyWorkspaceMutated();
                  }}
                  onDragOver={handleBlankDragOver}
                  onDragLeave={() => setDropHighlightRoot(false)}
                  onDrop={(e) => void handleBlankDrop(e, scope)}
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
            <WorkspaceFooter
              key={footerKey}
              projectId={projectId}
              sessionId={sessionId}
            />
          ) : (
            <div id="conversation-meta" className="workspace-footer-card" />
          )}
        </div>
      </section>
      <ConfirmModal
        open={ingestConfirm != null}
        title="覆盖确认"
        message={
          ingestConfirm == null
            ? ""
            : `目标处已有 ${ingestConfirm.conflictCount} 个同名文件/目录。覆盖后不可撤销，是否继续？`
        }
        confirmLabel="覆盖"
        danger
        busy={ingestBusy}
        onCancel={() => setIngestConfirm(null)}
        onConfirm={async () => {
          if (ingestConfirm == null) {
            return;
          }
          setIngestBusy(true);
          try {
            await confirmAndApplyBatchIngest(
              ingestConfirm,
              notifyWorkspaceMutated,
            );
            setIngestConfirm(null);
          } finally {
            setIngestBusy(false);
          }
        }}
      />
    </>
  );
}

export type { WorkspaceContextTarget };
