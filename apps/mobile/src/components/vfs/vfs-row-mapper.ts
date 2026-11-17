/**
 * Maps {@link WorkplaceListRow} + VFS entry metadata to list UI strings (prototype vfs-fm).
 */
import {basenameOf, parentDirOrNull as parentLogicalPath, type VfsListEntry} from '@novel-master/core/vfs';
import {displayStateLabel, inclusionModeLabel, type RuleState, type WorkplaceListRow} from '@novel-master/core/workplace';
import {coreT} from '../../i18n/core';

type VfsBadgeTone = 'in' | 'follow' | 'muted';

interface VfsRowBadge {
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

/**
 * Parent logical path; session root `/` → `null`（无父目录）。
 * 单源：core `domain/vfs/logic/parent-dir.ts` 的 `parentDirOrNull`（含 normalizePath
 * 校验：非法路径也返回 `null`，不再对裸相对路径伪造 `/`）。
 */
export {parentLogicalPath};

/** Whether `childPath` is an immediate child of `dirPath`. */
export function isDirectChild(dirPath: string, childPath: string): boolean {
  return parentLogicalPath(childPath) === dirPath;
}

/**
 * 面包屑展示：用缓存的名字逐段替换路径中的段（如项目/会话 UUID → 名称）。
 *
 * @remarks labelByPath 由导航过程中每次 list 的合成目录行携带（label 字段），
 * 查不到的段回退原文；只影响展示，不改导航与逻辑路径。
 */
export function pathWithLabels(path: string, labelByPath: ReadonlyMap<string, string>): string {
  if (path === '/') {
    return '/';
  }
  const segments = path.split('/');
  let acc = '';
  const mappedSegments = segments.map((seg, i) => {
    if (i === 0) {
      return '';
    }
    acc = `${acc}/${seg}`;
    return labelByPath.get(acc) ?? seg;
  });
  return mappedSegments.join('/');
}

/** Count file rows whose parent directory is `dirPath`. */
export function countFilesInDir(rows: readonly WorkplaceListRow[], dirPath: string): number {
  return rows.filter(r => r.kind === 'file' && isDirectChild(dirPath, r.path)).length;
}

/** Directory rule on/off badge for list rows. */
export function dirRuleBadge(ruleEnabled: boolean): VfsRowBadge {
  return ruleEnabled ? {label: '开启', tone: 'in'} : {label: '关闭', tone: 'muted'};
}

/** Patch one directory row after rule enabled toggles (no list reload). */
export function patchDirRuleRow(row: MappedVfsRow, ruleEnabled: boolean): MappedVfsRow {
  if (row.kind !== 'dir') {
    return row;
  }
  return {...row, ruleEnabled, badge: dirRuleBadge(ruleEnabled)};
}

/** Worktree list row enum after directory rule enabled toggles. */
export function dirRuleStateFromEnabled(ruleEnabled: boolean): RuleState {
  return ruleEnabled ? 'rule_on' : 'rule_off';
}

/** Map a worktree row to vfs-fm subtitle + badge. */
export function mapWorktreeRow(row: WorkplaceListRow, childFileCount?: number): MappedVfsRow {
  const name = basenameOf(row.path);
  if (row.kind === 'dir') {
    const ruleEnabled = row.ruleState === 'rule_on';
    const subtitle = childFileCount != null && childFileCount > 0 ? `${childFileCount}个文件` : '';
    return {
      path: row.path,
      name,
      kind: 'dir',
      subtitle,
      badge: dirRuleBadge(ruleEnabled),
      ruleEnabled,
    };
  }

  const inclusionText = coreT(inclusionModeLabel(row.inclusionMode));
  const displayText = coreT(displayStateLabel(row.displayState));
  const subtitle = `${inclusionText}·${displayText}`;
  const mode = row.inclusionMode;
  const badge: VfsRowBadge = mode === 'hide' ? {label: '隐藏', tone: 'muted'} : mode === 'show' ? {label: '展示', tone: 'in'} : {label: '跟随', tone: 'follow'};

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
  // label 为物理树合成目录行的展示名（项目名/会话名）；未填充时回退路径末段。
  const name = entry.label ?? basenameOf(entry.path);
  if (entry.kind === 'directory') {
    return {
      path: entry.path,
      name,
      kind: 'dir',
      subtitle: '',
      badge: dirRuleBadge(false),
      ruleEnabled: false,
    };
  }
  return {
    path: entry.path,
    name,
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
export function remapDirectChildRows(rows: readonly MappedVfsRow[], parentPath: string, allRows: readonly WorkplaceListRow[]): MappedVfsRow[] {
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
