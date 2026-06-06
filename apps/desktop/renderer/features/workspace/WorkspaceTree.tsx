import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  VfsScopeRequest,
  WorktreeListRowDto,
  WorkspacePanelScope,
} from "../../../shared/ipc-types";
import { ipcWorktreeBuildListRows, vfsScope } from "../../ipc/client";
import { useShellNav } from "../../providers/ShellNavProvider";
import type { WorkspaceContextTarget } from "./workspace-context";
import {
  entryName,
  pathDepth,
  vfsEntryStatusText,
} from "./vfs-tree-utils";

export type { WorkspaceContextTarget } from "./workspace-context";

interface WorkspaceTreeProps {
  panelScope: WorkspacePanelScope;
  refreshToken: number;
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

export function WorkspaceTree({
  panelScope,
  refreshToken,
  onOpenContextMenu,
  onBlankContextMenu,
}: WorkspaceTreeProps) {
  const { projectId, sessionId, previewFile, selectPreviewFile } = useShellNav();
  const [rows, setRows] = useState<WorktreeListRowDto[]>([]);
  const [loading, setLoading] = useState(true);

  const req = useMemo(
    () => scopeRequest(panelScope, projectId, sessionId),
    [panelScope, projectId, sessionId],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const result = await ipcWorktreeBuildListRows(req);
      if (result.ok) {
        const sorted = [...result.data].sort((a, b) => {
          if (a.kind !== b.kind) {
            return a.kind === "dir" ? -1 : 1;
          }
          return entryName(a.path).localeCompare(entryName(b.path), "zh-CN");
        });
        setRows(sorted);
      }
    } finally {
      setLoading(false);
    }
  }, [req]);

  useEffect(() => {
    void reload();
  }, [reload, refreshToken]);

  if (loading) {
    return <p className="tree-empty">加载中…</p>;
  }

  return (
    <div
      className="explorer-tree__body"
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest(".tree-node")) {
          return;
        }
        e.preventDefault();
        onBlankContextMenu({
          kind: "blank",
          panelScope,
          x: e.clientX,
          y: e.clientY,
        });
      }}
    >
      {rows.length === 0 ? (
        <p className="tree-empty">空目录</p>
      ) : (
        rows.map((row) => {
          const isDir = row.kind === "dir";
          const depth = pathDepth(row.path);
          const active =
            previewFile?.path === row.path &&
            previewFile.workspaceScope === panelScope;
          return (
            <div
              key={row.path}
              className={`tree-node${isDir ? " tree-node--folder" : ""}${active ? " is-active" : ""}`}
              data-vfs-scope={panelScope}
              data-vfs-kind={row.kind}
              style={{ paddingLeft: `${10 + depth * 14}px` }}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!isDir) {
                  selectPreviewFile(panelScope, row.path);
                }
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
                if ((e.key === "Enter" || e.key === " ") && !isDir) {
                  selectPreviewFile(panelScope, row.path);
                }
              }}
            >
              <span className="tree-node__icon">{isDir ? "📁" : "📄"}</span>
              <span className="tree-node__label">{entryName(row.path)}</span>
              <span className="tree-node__meta">{vfsEntryStatusText(row)}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
