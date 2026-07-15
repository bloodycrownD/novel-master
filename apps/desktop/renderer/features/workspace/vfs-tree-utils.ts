/** VFS tree row display helpers (aligned with mobile vfs-row-mapper). */
import {
  displayStateLabel,
  inclusionModeLabel,
  ruleStateLabel,
} from "@novel-master/core/worktree";
import type { WorktreeListRowDto } from "@shared/ipc-types";

/** `/notes/ch1.md` → [`notes`, `ch1.md`]（跳过空段） */
export function logicalPathSegments(path: string): string[] {
  if (path === "/") {
    return [];
  }
  return path.split("/").filter(Boolean);
}

/** 段 index 对应的绝对逻辑路径，如 index=0 → `/notes` */
export function logicalPathForSegmentIndex(
  segments: readonly string[],
  index: number,
): string {
  if (index < 0 || index >= segments.length) {
    throw new RangeError(`segment index 越界: ${index}`);
  }
  return `/${segments.slice(0, index + 1).join("/")}`;
}

/** 从根到目标目录的路径链（含目标；用于树展开请求） */
export function ancestorDirPaths(path: string): string[] {
  if (path === "/") {
    return ["/"];
  }
  const segments = logicalPathSegments(path);
  const dirs: string[] = ["/"];
  for (let i = 0; i < segments.length; i++) {
    dirs.push(logicalPathForSegmentIndex(segments, i));
  }
  return dirs;
}

/** Parent logical path; session root `/` stays `/`. */
export function parentLogicalPath(path: string): string | null {
  if (path === "/") {
    return null;
  }
  const idx = path.lastIndexOf("/");
  if (idx <= 0) {
    return "/";
  }
  return path.slice(0, idx);
}

/** `childPath` 是否为 `dirPath` 的直子路径。 */
export function isDirectChild(dirPath: string, childPath: string): boolean {
  return parentLogicalPath(childPath) === dirPath;
}

/** Whether `childPath` is under `ancestorPath` (strict descendant). */
export function isDescendantPath(
  ancestorPath: string,
  childPath: string,
): boolean {
  if (ancestorPath === childPath) {
    return false;
  }
  if (ancestorPath === "/") {
    return childPath !== "/";
  }
  return childPath.startsWith(`${ancestorPath}/`);
}

/** Row visible when every ancestor directory is expanded. */
export function isTreeRowVisible(
  path: string,
  expandedDirs: ReadonlySet<string>,
): boolean {
  let current = parentLogicalPath(path);
  while (current !== null) {
    if (!expandedDirs.has(current)) {
      return false;
    }
    current = parentLogicalPath(current);
  }
  return true;
}

export function entryName(path: string): string {
  if (path === "/") {
    return "/";
  }
  const idx = path.lastIndexOf("/");
  return path.slice(idx + 1);
}

export function pathDepth(path: string): number {
  if (path === "/") {
    return 0;
  }
  return path.split("/").filter(Boolean).length;
}

export function vfsEntryStatusText(row: WorktreeListRowDto): string {
  if (row.kind === "dir") {
    return ruleStateLabel(row.ruleState);
  }
  return `${inclusionModeLabel(row.inclusionMode)} · ${displayStateLabel(row.displayState)}`;
}
