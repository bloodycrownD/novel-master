import type {
  PreviewFileSelection,
  WorktreeListRowDto,
  WorkspacePanelScope,
} from "@shared/ipc-types";

/**
 * 用 worktree 文件行校验已打开预览 tab：不在列表中的文件标为已删除。
 */
export function syncPreviewTabsWithFileRows(
  tabs: PreviewFileSelection[],
  rows: WorktreeListRowDto[],
  scope: WorkspacePanelScope,
): PreviewFileSelection[] {
  const filePaths = new Set(
    rows.filter((row) => row.kind === "file").map((row) => row.path),
  );
  let changed = false;
  const next = tabs.map((tab) => {
    if (tab.workspaceScope !== scope) {
      return tab;
    }
    if (filePaths.has(tab.path)) {
      if (tab.isDeleted) {
        changed = true;
        return { ...tab, isDeleted: false };
      }
      return tab;
    }
    if (tab.isDeleted) {
      return tab;
    }
    changed = true;
    return { ...tab, isDeleted: true };
  });
  return changed ? next : tabs;
}

/**
 * 将指定路径及其子路径下的预览 tab 标为已删除（保留 tab，不关闭）。
 */
export function markPreviewTabsDeletedUnderPathInList(
  tabs: PreviewFileSelection[],
  scope: WorkspacePanelScope,
  path: string,
): PreviewFileSelection[] {
  let changed = false;
  const next = tabs.map((tab) => {
    if (tab.workspaceScope !== scope) {
      return tab;
    }
    if (tab.path !== path && !tab.path.startsWith(`${path}/`)) {
      return tab;
    }
    if (tab.isDeleted) {
      return tab;
    }
    changed = true;
    return { ...tab, isDeleted: true };
  });
  return changed ? next : tabs;
}
