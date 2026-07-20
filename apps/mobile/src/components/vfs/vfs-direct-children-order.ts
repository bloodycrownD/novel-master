/**
 * Order direct children of a VFS directory to match worktree DFS list semantics.
 */
import type {WorkplaceDirRule, WorkplaceListRow} from '@novel-master/core/workplace';
import {sortDirPaths, sortFilesForDir} from '@novel-master/core/workplace';
import {isDirectChild} from './vfs-row-mapper';

export type OrderedDirectChildPathsParams = {
  readonly parentPath: string;
  readonly rows: readonly WorkplaceListRow[];
  /** All candidate child paths (e.g. worktree dirs + vfs.list); orphans sorted at end. */
  readonly extraPaths: readonly string[];
  readonly dirRule: WorkplaceDirRule | null;
  readonly mtimeByPath?: ReadonlyMap<string, number>;
  /** VFS-only paths not present in {@link rows}; dirs vs files for orphan sort. */
  readonly kindByPath?: ReadonlyMap<string, 'dir' | 'file'>;
};

function rowKindAtPath(
  rows: readonly WorkplaceListRow[],
  path: string,
): 'dir' | 'file' | undefined {
  return rows.find(r => r.path === path)?.kind;
}

/**
 * Returns direct child paths under `parentPath` in the same order as
 * {@link WorkplaceService.buildListRows} DFS (dirs before files at each level).
 * Paths only in `extraPaths` are appended after row-derived order, sorted with core
 * `sortDirPaths` / `sortFilesForDir` so directory rule changes affect orphans too.
 */
export function orderedDirectChildPaths(
  params: OrderedDirectChildPathsParams,
): string[] {
  const {parentPath, rows, extraPaths, dirRule, mtimeByPath, kindByPath} =
    params;

  const ordered: string[] = [];
  const seen = new Set<string>();

  // DFS list order: first occurrence of each direct child while scanning rows.
  for (const row of rows) {
    if (!isDirectChild(parentPath, row.path) || seen.has(row.path)) {
      continue;
    }
    seen.add(row.path);
    ordered.push(row.path);
  }

  const orphans = extraPaths.filter(p => !seen.has(p));
  if (orphans.length === 0) {
    return ordered;
  }

  const orphanDirs: string[] = [];
  const orphanFiles: string[] = [];
  for (const path of orphans) {
    const kind =
      rowKindAtPath(rows, path) ??
      kindByPath?.get(path) ??
      'file';
    if (kind === 'dir') {
      orphanDirs.push(path);
    } else {
      orphanFiles.push(path);
    }
  }

  const sortedDirs = sortDirPaths(orphanDirs, dirRule);
  const sortedFiles = sortFilesForDir(
    orphanFiles.map(logicalPath => ({
      logicalPath,
      mtimeMs: mtimeByPath?.get(logicalPath) ?? 0,
    })),
    dirRule,
  ).map(f => f.logicalPath);

  return [...ordered, ...sortedDirs, ...sortedFiles];
}
