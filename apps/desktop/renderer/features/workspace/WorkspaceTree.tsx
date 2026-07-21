import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  VfsScopeRequest,
  WorkplaceListRowDto,
  WorkspacePanelScope,
} from "@shared/ipc-types";
import { ipcWorkplaceBuildListRows, vfsScope } from "@/ipc/client";
import { useShellNav } from "@/providers/ShellNavProvider";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import type { WorkspaceContextTarget } from "./workspace-context";
import {
  entryName,
  ancestorDirPaths,
  isTreeRowVisible,
  pathDepth,
  vfsEntryStatusText,
} from "./vfs-tree-utils";
import {
  confirmAndApplyBatchIngest,
  finalizeRowDrag,
  handleTreeDrop,
  moveVfsPathsToDir,
  prefetchExportStage,
  resolveDropTargetDir,
  startPrefetchedNativeDrag,
  type BatchIngestConfirmRequest,
} from "./workspace-batch-dnd";
import {
  decodeVfsDragPayload,
  encodeVfsDragPayload,
  NM_VFS_PATHS_MIME,
} from "./vfs-tree-dnd";

export type { WorkspaceContextTarget } from "./workspace-context";

interface WorkspaceTreeProps {
  panelScope: WorkspacePanelScope;
  refreshToken: number;
  onOpenContextMenu: (target: WorkspaceContextTarget) => void;
  /** 列表重载成功后回调，用于同步预览 tab 删除态 */
  onRowsLoaded?: (rows: WorkplaceListRowDto[]) => void;
  /** Blank-area menu is handled on `.explorer-tree` in ExplorerPane. */
  onBlankContextMenu?: (target: Extract<WorkspaceContextTarget, { kind: "blank" }>) => void;
}

function scopeRequest(
  panelScope: WorkspacePanelScope,
  projectId?: string,
  sessionId?: string,
): VfsScopeRequest {
  return vfsScope(panelScope, projectId, sessionId);
}

export function WorkspaceTree({
  panelScope,
  refreshToken,
  onOpenContextMenu,
  onRowsLoaded,
}: WorkspaceTreeProps) {
  const {
    projectId,
    sessionId,
    previewFile,
    selectPreviewFile,
    treeExpandRequest,
    notifyWorkspaceMutated,
  } = useShellNav();
  const [rows, setRows] = useState<WorkplaceListRowDto[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(
    () => new Set(["/"]),
  );
  const [loading, setLoading] = useState(true);
  const [dropHighlight, setDropHighlight] = useState<string | null>(null);
  const [ingestConfirm, setIngestConfirm] =
    useState<BatchIngestConfirmRequest | null>(null);
  const [ingestBusy, setIngestBusy] = useState(false);

  const req = useMemo(
    () => scopeRequest(panelScope, projectId, sessionId),
    [panelScope, projectId, sessionId],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ipcWorkplaceBuildListRows(req);
      if (result.ok) {
        setRows(result.data);
        onRowsLoaded?.(result.data);
        setExpandedDirs(
          new Set(
            result.data
              .filter((row) => row.kind === "dir")
              .map((row) => row.path),
          ),
        );
      }
    } finally {
      setLoading(false);
    }
  }, [req, onRowsLoaded]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  useEffect(() => {
    if (!treeExpandRequest) {
      return;
    }
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      for (const dir of ancestorDirPaths(treeExpandRequest.path)) {
        next.add(dir);
      }
      return next;
    });
  }, [treeExpandRequest]);

  const visibleRows = useMemo(
    () => rows.filter((row) => isTreeRowVisible(row.path, expandedDirs)),
    [rows, expandedDirs],
  );

  const toggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  const onMutated = useCallback(() => {
    notifyWorkspaceMutated();
  }, [notifyWorkspaceMutated]);

  const handleRowDragOver = useCallback(
    (e: React.DragEvent, row: WorkplaceListRowDto) => {
      const types = Array.from(e.dataTransfer.types);
      if (
        types.includes("Files") ||
        types.includes(NM_VFS_PATHS_MIME)
      ) {
        e.preventDefault();
        e.dataTransfer.dropEffect = types.includes(NM_VFS_PATHS_MIME)
          ? "move"
          : "copy";
        setDropHighlight(resolveDropTargetDir(row.path, row.kind));
      }
    },
    [],
  );

  const handleRowDrop = useCallback(
    async (e: React.DragEvent, row: WorkplaceListRowDto) => {
      e.preventDefault();
      e.stopPropagation();
      setDropHighlight(null);
      const targetDir = resolveDropTargetDir(row.path, row.kind);

      const mimeRaw = e.dataTransfer.getData(NM_VFS_PATHS_MIME);
      const mimePayload = mimeRaw ? decodeVfsDragPayload(mimeRaw) : null;
      if (mimePayload != null) {
        await moveVfsPathsToDir({
          scope: req,
          targetDir,
          sourcePaths: mimePayload.paths,
          onMoved: onMutated,
        });
        return;
      }

      await handleTreeDrop({
        scope: req,
        targetDir,
        dataTransfer: e.dataTransfer,
        onNeedsConfirm: setIngestConfirm,
        onMutated,
      });
    },
    [req, onMutated],
  );

  const handleRowPointerDown = useCallback(
    (e: React.PointerEvent, row: WorkplaceListRowDto) => {
      e.stopPropagation();
      // 失败时 prefetchExportStage 内部已 toast
      void prefetchExportStage({ scope: req, logicalPath: row.path });
    },
    [req],
  );

  const handleRowDragStart = useCallback(
    (e: React.DragEvent, row: WorkplaceListRowDto) => {
      try {
        e.dataTransfer.setData(
          NM_VFS_PATHS_MIME,
          encodeVfsDragPayload([row.path]),
        );
        e.dataTransfer.effectAllowed = "copyMove";
      } catch {
        // ignore
      }
      // 主验收路径：同步 startDrag（依赖 pointerdown prefetch）
      startPrefetchedNativeDrag({
        logicalPath: row.path,
        dragEvent: e.nativeEvent,
      });
    },
    [],
  );

  if (loading) {
    return (
      <div className="explorer-tree__body explorer-tree__body--fill">
        <p className="tree-empty">加载中…</p>
      </div>
    );
  }

  return (
    <div className="explorer-tree__body explorer-tree__body--fill">
      {rows.length === 0 ? (
        <p className="tree-empty">空目录</p>
      ) : (
        visibleRows.map((row) => {
          const isDir = row.kind === "dir";
          const depth = pathDepth(row.path);
          const expanded = isDir && expandedDirs.has(row.path);
          const active =
            previewFile?.path === row.path &&
            previewFile.workspaceScope === panelScope;
          const targetDir = resolveDropTargetDir(row.path, row.kind);
          const isDropTarget = dropHighlight === targetDir;
          return (
            <div
              key={row.path}
              className={`tree-node${isDir ? " tree-node--folder" : ""}${active ? " is-active" : ""}${isDropTarget ? " is-drop-target" : ""}`}
              data-vfs-scope={panelScope}
              data-vfs-kind={row.kind}
              style={{ paddingLeft: `${10 + depth * 14}px` }}
              role="button"
              tabIndex={0}
              draggable
              aria-expanded={isDir ? expanded : undefined}
              onPointerDown={(e) => handleRowPointerDown(e, row)}
              onDragStart={(e) => handleRowDragStart(e, row)}
              onDragEnd={() => {
                finalizeRowDrag(row.path);
                setDropHighlight(null);
              }}
              onDragOver={(e) => handleRowDragOver(e, row)}
              onDragLeave={() => setDropHighlight(null)}
              onDrop={(e) => void handleRowDrop(e, row)}
              onClick={() => {
                if (isDir) {
                  toggleDir(row.path);
                  return;
                }
                selectPreviewFile(panelScope, row.path);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onOpenContextMenu({
                  kind: "row",
                  panelScope,
                  row,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") {
                  return;
                }
                e.preventDefault();
                if (isDir) {
                  toggleDir(row.path);
                  return;
                }
                selectPreviewFile(panelScope, row.path);
              }}
            >
              <span
                className={`tree-node__chevron${isDir ? "" : " tree-node__chevron--leaf"}${expanded ? "" : " tree-node__chevron--collapsed"}`}
                aria-hidden
              >
                {isDir ? "▾" : ""}
              </span>
              <span className="tree-node__icon">{isDir ? "📁" : "📄"}</span>
              <span className="tree-node__label">{entryName(row.path)}</span>
              <span className="tree-node__meta">{vfsEntryStatusText(row)}</span>
            </div>
          );
        })
      )}
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
            await confirmAndApplyBatchIngest(ingestConfirm, onMutated);
            setIngestConfirm(null);
          } finally {
            setIngestBusy(false);
          }
        }}
      />
    </div>
  );
}
