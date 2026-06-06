/** VFS tree row display helpers (aligned with mobile vfs-row-mapper). */
import type { WorktreeListRowDto } from "../../shared/ipc-types";

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
