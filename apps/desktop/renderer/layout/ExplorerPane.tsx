import { useCallback, useEffect, useState } from "react";
import type { VfsScopeRequest, WorkspacePanelScope } from "@shared/ipc-types";
import { vfsScope } from "../ipc/client";
import { WorkspaceHeaderActions } from "../features/workspace/WorkspaceHeaderActions";
import {
  WorkspaceTree,
  type WorkspaceContextTarget,
} from "../features/workspace/WorkspaceTree";
import { useShellNav } from "../providers/ShellNavProvider";
import { workspaceTitleForScope } from "../state/nav-workspace";

import { ConfirmModal } from "../components/ui/ConfirmModal";
import {
  confirmAndApplyBatchIngest,
  ensureStartDragFailureToast,
  handleTreeDrop,
  moveVfsPathsToDir,
  type BatchIngestConfirmRequest,
} from "../features/workspace/workspace-batch-dnd";
import {
  decodeVfsDragPayload,
  NM_VFS_PATHS_MIME,
} from "../features/workspace/vfs-tree-dnd";

interface ExplorerPaneProps {
  onOpenContextMenu: (target: WorkspaceContextTarget) => void;
  onBlankContextMenu: (target: Extract<WorkspaceContextTarget, { kind: "blank" }>) => void;
}

// projects 视图换只读物理树浏览器；global 面板不再展示，session/chat 面板行为不变
const PANEL_SCOPES = ["physical", "session", "chat"] as const;

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
    workspaceSessionId,
    treeRefreshToken,
    notifyWorkspaceMutated,
    syncPreviewTabsFromFileRows,
  } = useShellNav();
  const title = workspaceTitleForScope(workspaceScope);
  const [dropHighlightRoot, setDropHighlightRoot] = useState(false);
  const [ingestConfirm, setIngestConfirm] =
    useState<BatchIngestConfirmRequest | null>(null);
  const [ingestBusy, setIngestBusy] = useState(false);



  useEffect(() => ensureStartDragFailureToast(), []);

  const handleBlankDragOver = useCallback((e: React.DragEvent) => {
    if ((e.target as HTMLElement).closest(".tree-node")) {
      return;
    }
    const types = Array.from(e.dataTransfer.types);
    if (types.includes("Files") || types.includes(NM_VFS_PATHS_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = types.includes(NM_VFS_PATHS_MIME)
        ? "move"
        : "copy";
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

      const mimeRaw = e.dataTransfer.getData(NM_VFS_PATHS_MIME);
      const mimePayload = mimeRaw ? decodeVfsDragPayload(mimeRaw) : null;
      if (mimePayload != null) {
        await moveVfsPathsToDir({
          scope: scopeRequest(panelScope, projectId, workspaceSessionId),
          targetDir: "/",
          sourcePaths: mimePayload.paths,
          onMoved: notifyWorkspaceMutated,
        });
        return;
      }

      await handleTreeDrop({
        scope: scopeRequest(panelScope, projectId, workspaceSessionId),
        targetDir: "/",
        dataTransfer: e.dataTransfer,
        onNeedsConfirm: setIngestConfirm,
        onMutated: notifyWorkspaceMutated,
      });
    },
    [projectId, workspaceSessionId, notifyWorkspaceMutated],
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
          {PANEL_SCOPES.map((scope) => {
            const visible = workspaceScope === scope;
            // physical 面板只读：不接受拖入、不弹空白区写菜单
            const readOnly = scope === "physical";
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
                  onDragOver={readOnly ? undefined : handleBlankDragOver}
                  onDragLeave={() => setDropHighlightRoot(false)}
                  onDrop={
                    readOnly ? undefined : (e) => void handleBlankDrop(e, scope)
                  }
                  onContextMenu={(e) => {
                    if (readOnly) {
                      return;
                    }
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
        />
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
