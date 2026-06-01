/**
 * Maps {@link WorktreeListRow} + VFS entry metadata to list UI strings (prototype vfs-fm).
 */
import type {VfsListEntry, WorktreeListRow} from '@novel-master/core';

export type VfsBadgeTone = 'in' | 'follow' | 'muted';

export interface VfsRowBadge {
  readonly label: string;
  readonly tone: VfsBadgeTone;
}

export interface MappedVfsRow {
  readonly path: string;
  readonly name: string;
  readonly kind: 'dir' | 'file';
  readonly subtitle: string;
  readonly badge: VfsRowBadge | null;
  /** Directory rule enabled (for toggle menu). */
  readonly ruleEnabled: boolean;
}

/** Parent logical path; session root `/` stays `/`. */
export function parentLogicalPath(path: string): string | null {
  if (path === '/') {
    return null;
  }
  const idx = path.lastIndexOf('/');
  if (idx <= 0) {
    return '/';
  }
  return path.slice(0, idx);
}

/** Whether `childPath` is an immediate child of `dirPath`. */
export function isDirectChild(dirPath: string, childPath: string): boolean {
  return parentLogicalPath(childPath) === dirPath;
}

/** Basename for display. */
export function entryName(path: string): string {
  if (path === '/') {
    return '/';
  }
  const idx = path.lastIndexOf('/');
  return path.slice(idx + 1);
}

/** Count file rows whose parent directory is `dirPath`. */
export function countFilesInDir(
  rows: readonly WorktreeListRow[],
  dirPath: string,
): number {
  return rows.filter(
    r => r.kind === 'file' && isDirectChild(dirPath, r.path),
  ).length;
}

/** Map a worktree row to vfs-fm subtitle + badge. */
export function mapWorktreeRow(
  row: WorktreeListRow,
  childFileCount?: number,
): MappedVfsRow {
  const name = entryName(row.path);
  if (row.kind === 'dir') {
    const ruleEnabled = row.ruleState === '规则·开';
    const subtitle =
      childFileCount != null && childFileCount > 0
        ? `${childFileCount}个文件`
        : '';
    return {
      path: row.path,
      name,
      kind: 'dir',
      subtitle,
      badge: ruleEnabled
        ? {label: '开启', tone: 'in'}
        : {label: '关闭', tone: 'muted'},
      ruleEnabled,
    };
  }

  const subtitle = `${row.inclusionMode}·${row.displayState}`;
  let badge: VfsRowBadge | null;
  if (row.inclusionMode === '隐藏') {
    badge = {label: '隐藏', tone: 'muted'};
  } else if (row.inclusionMode === '展示') {
    badge = {label: '展示', tone: 'in'};
  } else {
    badge = {label: '继承', tone: 'follow'};
  }

  return {
    path: row.path,
    name,
    kind: 'file',
    subtitle,
    badge,
    ruleEnabled: false,
  };
}

/** Fallback row when VFS has a path not yet in worktree listing. */
export function mapVfsListEntry(entry: VfsListEntry): MappedVfsRow {
  if (entry.kind === 'directory') {
    return {
      path: entry.path,
      name: entryName(entry.path),
      kind: 'dir',
      subtitle: '',
      badge: {label: '继承', tone: 'follow'},
      ruleEnabled: false,
    };
  }
  return {
    path: entry.path,
    name: entryName(entry.path),
    kind: 'file',
    subtitle: '继承·全内容',
    badge: {label: '继承', tone: 'follow'},
    ruleEnabled: false,
  };
}

/** @deprecated Use {@link mapVfsListEntry}. */
export function mapVfsFilePath(path: string): MappedVfsRow {
  return mapVfsListEntry({path, kind: 'file'});
}
