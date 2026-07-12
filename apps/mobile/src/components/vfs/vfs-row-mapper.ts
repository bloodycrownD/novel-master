/**
 * Maps {@link WorktreeListRow} + VFS entry metadata to list UI strings (prototype vfs-fm).
 */
import { type VfsListEntry } from "@novel-master/core/vfs";
import {
  displayStateLabel,
  inclusionModeLabel,
  type InclusionMode,
  type RuleState,
  type WorktreeListRow,
} from "@novel-master/core/worktree";

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

/** Directory rule on/off badge for list rows. */
export function dirRuleBadge(ruleEnabled: boolean): VfsRowBadge {
  return ruleEnabled
    ? {label: '开启', tone: 'in'}
    : {label: '关闭', tone: 'muted'};
}

/** Patch one directory row after rule enabled toggles (no list reload). */
export function patchDirRuleRow(
  row: MappedVfsRow,
  ruleEnabled: boolean,
): MappedVfsRow {
  if (row.kind !== 'dir') {
    return row;
  }
  return {...row, ruleEnabled, badge: dirRuleBadge(ruleEnabled)};
}

/** Worktree list row enum after directory rule enabled toggles. */
export function dirRuleStateFromEnabled(ruleEnabled: boolean): RuleState {
  return ruleEnabled ? 'rule_on' : 'rule_off';
}

function fileBadge(mode: InclusionMode): VfsRowBadge {
  switch (mode) {
    case 'hide':
      return {label: '隐藏', tone: 'muted'};
    case 'show':
      return {label: '展示', tone: 'in'};
    default:
      return {label: '跟随', tone: 'follow'};
  }
}

/** Map a worktree row to vfs-fm subtitle + badge. */
export function mapWorktreeRow(
  row: WorktreeListRow,
  childFileCount?: number,
): MappedVfsRow {
  const name = entryName(row.path);
  if (row.kind === 'dir') {
    const ruleEnabled = row.ruleState === 'rule_on';
    const subtitle =
      childFileCount != null && childFileCount > 0
        ? `${childFileCount}个文件`
        : '';
    return {
      path: row.path,
      name,
      kind: 'dir',
      subtitle,
      badge: dirRuleBadge(ruleEnabled),
      ruleEnabled,
    };
  }

  const subtitle = `${inclusionModeLabel(row.inclusionMode)}·${displayStateLabel(row.displayState)}`;

  return {
    path: row.path,
    name,
    kind: 'file',
    subtitle,
    badge: fileBadge(row.inclusionMode),
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
      badge: dirRuleBadge(false),
      ruleEnabled: false,
    };
  }
  return {
    path: entry.path,
    name: entryName(entry.path),
    kind: 'file',
    subtitle: '跟随·全内容',
    badge: {label: '跟随', tone: 'follow'},
    ruleEnabled: false,
  };
}

/**
 * Re-map direct children of `parentPath` from fresh worktree metadata.
 * Keeps list order stable; updates badges/subtitles after inclusion toggles.
 */
export function remapDirectChildRows(
  rows: readonly MappedVfsRow[],
  parentPath: string,
  allRows: readonly WorktreeListRow[],
): MappedVfsRow[] {
  const metaByPath = new Map(allRows.map(r => [r.path, r]));
  return rows.map(row => {
    if (!isDirectChild(parentPath, row.path)) {
      return row;
    }
    const meta = metaByPath.get(row.path);
    if (!meta) {
      return row;
    }
    if (meta.kind === 'dir') {
      return mapWorktreeRow(meta, countFilesInDir(allRows, meta.path));
    }
    return mapWorktreeRow(meta);
  });
}

/** @deprecated Use {@link mapVfsListEntry}. */
export function mapVfsFilePath(path: string): MappedVfsRow {
  return mapVfsListEntry({path, kind: 'file'});
}
