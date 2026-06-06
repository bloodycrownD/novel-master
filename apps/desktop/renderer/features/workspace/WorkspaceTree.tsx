import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  VfsScopeRequest,
  WorktreeListRowDto,
  WorkspacePanelScope,
} from "../../../shared/ipc-types";
import {
  ipcProjectsPullTemplate,
  ipcSessionsPullTemplate,
  ipcVfsDelete,
  ipcVfsMkdir,
  ipcVfsRename,
  ipcVfsWrite,
  ipcVfsZipExport,
  ipcVfsZipImport,
  ipcWorktreeBuildListRows,
  ipcWorktreeSetDirRule,
  ipcWorktreeSetFileRule,
  vfsScope,
} from "../../ipc/client";
import { useShellNav } from "../../providers/ShellNavProvider";
import {
  entryName,
  pathDepth,
  vfsEntryStatusText,
} from "./vfs-tree-utils";

export interface WorkspaceContextTarget {
  readonly panelScope: WorkspacePanelScope;
  readonly row: WorktreeListRowDto;
  readonly x: number;
  readonly y: number;
}

interface WorkspaceTreeProps {
  panelScope: WorkspacePanelScope;
  refreshToken: number;
  onRefresh: () => void;
  onOpenContextMenu: (target: WorkspaceContextTarget) => void;
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
  onRefresh,
  onOpenContextMenu,
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

  const createFile = async () => {
    const name = window.prompt("新建文件名");
    if (!name?.trim()) {
      return;
    }
    const path = `/${name.trim()}`;
    await ipcVfsWrite({ ...req, path, content: "" });
    onRefresh();
  };

  const createDir = async () => {
    const name = window.prompt("新建目录名");
    if (!name?.trim()) {
      return;
    }
    await ipcVfsMkdir({ ...req, path: `/${name.trim()}` });
    onRefresh();
  };

  const exportZip = async () => {
    const result = await ipcVfsZipExport(req);
    if (result.ok && result.data === "saved") {
      window.alert("已导出 ZIP");
    }
  };

  const importZip = async () => {
    if (
      !window.confirm("导入 ZIP 将覆盖当前工作区全部文件，确定继续？")
    ) {
      return;
    }
    const result = await ipcVfsZipImport({ ...req, confirmed: true });
    if (result.ok && result.data === "imported") {
      onRefresh();
    }
  };

  const pullTemplate = async () => {
    if (panelScope === "session" && projectId) {
      if (
        !window.confirm(
          "将从全局工作区覆盖当前项目工作区，本地修改将丢失。确定继续？",
        )
      ) {
        return;
      }
      await ipcProjectsPullTemplate({ projectId });
      onRefresh();
      return;
    }
    if (panelScope === "chat" && sessionId) {
      if (
        !window.confirm(
          "将从项目工作区覆盖当前聊天工作区，本地修改将丢失。确定继续？",
        )
      ) {
        return;
      }
      await ipcSessionsPullTemplate({ sessionId });
      onRefresh();
    }
  };

  if (loading) {
    return <p className="tree-empty">加载中…</p>;
  }

  return (
    <>
      <div className="workspace-toolbar">
        <button type="button" className="workspace-toolbar__btn" onClick={() => void createFile()}>
          新建文件
        </button>
        <button type="button" className="workspace-toolbar__btn" onClick={() => void createDir()}>
          新建目录
        </button>
        {(panelScope === "session" || panelScope === "chat") && (
          <button type="button" className="workspace-toolbar__btn" onClick={() => void pullTemplate()}>
            从上级同步
          </button>
        )}
        <button type="button" className="workspace-toolbar__btn" onClick={() => void exportZip()}>
          导出 ZIP
        </button>
        <button type="button" className="workspace-toolbar__btn" onClick={() => void importZip()}>
          导入 ZIP
        </button>
      </div>
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
                onOpenContextMenu({
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
    </>
  );
}

export async function handleWorkspaceContextAction(
  target: WorkspaceContextTarget,
  action: string,
  projectId: string | undefined,
  sessionId: string | undefined,
  onDone: () => void,
): Promise<void> {
  const req = scopeRequest(target.panelScope, projectId, sessionId);
  const row = target.row;

  if (action === "include-hide" && row.kind === "file") {
    await ipcWorktreeSetFileRule({
      ...req,
      logicalPath: row.path,
      inclusionMode: "hide",
    });
    onDone();
    return;
  }
  if (action === "include-show" && row.kind === "file") {
    await ipcWorktreeSetFileRule({
      ...req,
      logicalPath: row.path,
      inclusionMode: "show",
    });
    onDone();
    return;
  }
  if (action === "include-follow" && row.kind === "file") {
    await ipcWorktreeSetFileRule({
      ...req,
      logicalPath: row.path,
      inclusionMode: "auto",
    });
    onDone();
    return;
  }
  if (action === "rename") {
    const next = window.prompt("名称", entryName(row.path));
    if (!next?.trim()) {
      return;
    }
    const parent =
      row.path === "/"
        ? ""
        : row.path.slice(0, row.path.lastIndexOf("/")) || "";
    const newPath = `${parent}/${next.trim()}`.replace(/\/+/g, "/");
    await ipcVfsRename({ ...req, oldPath: row.path, newPath });
    onDone();
    return;
  }
  if (action === "delete") {
    if (!window.confirm(`确定删除「${entryName(row.path)}」？`)) {
      return;
    }
    await ipcVfsDelete({ ...req, path: row.path, recursive: true });
    onDone();
    return;
  }
  if (action === "rule-config" && row.kind === "dir") {
    const enabled = window.confirm("目录规则是否开启？（确定=开，取消=关）");
    await ipcWorktreeSetDirRule({
      ...req,
      logicalPath: row.path,
      ruleEnabled: enabled,
    });
    onDone();
  }
}
