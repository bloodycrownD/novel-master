/** VFS tree row display helpers (aligned with mobile vfs-row-mapper). */
import type { WorktreeListRowDto } from "../../../shared/ipc-types";

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
    const rule = row.ruleState.includes("开") ? "规则·开" : "规则·关";
    return rule;
  }
  return `${row.inclusionMode} · ${row.displayState}`;
}

export function inclusionModeFromLabel(label: string): "auto" | "show" | "hide" {
  switch (label) {
    case "展示":
      return "show";
    case "隐藏":
      return "hide";
    default:
      return "auto";
  }
}
