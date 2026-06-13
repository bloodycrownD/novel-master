/**
 * Session VFS 纯目录树渲染（不应用 worktree 规则、不读文件正文）。
 *
 * @module domain/vfs/logic/render-session-vfs-tree
 */

import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { VfsListEntry } from "@/domain/vfs/model/vfs-list-entry.js";
import type { VfsService } from "@/domain/vfs/ports/vfs-service.port.js";

type TreeEntry = { readonly kind: "dir" | "file"; readonly path: string };

function entryName(entry: TreeEntry): string {
  const normalized = normalizePath(entry.path);
  if (entry.kind === "dir") {
    if (normalized === "/") {
      return "/";
    }
    const idx = normalized.lastIndexOf("/");
    const base = idx >= 0 ? normalized.slice(idx + 1) : normalized;
    return `${base}/`;
  }
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function parentDir(filePath: string): string {
  const normalized = normalizePath(filePath);
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) {
    return "/";
  }
  return normalized.slice(0, idx);
}

function buildDirSet(entries: readonly VfsListEntry[]): Set<string> {
  const dirs = new Set<string>(["/"]);
  for (const entry of entries) {
    if (entry.kind === "directory") {
      dirs.add(normalizePath(entry.path));
    } else {
      dirs.add(parentDir(entry.path));
    }
  }
  return dirs;
}

function directChildDirs(dirPath: string, allDirs: ReadonlySet<string>): string[] {
  const prefix = dirPath === "/" ? "/" : `${dirPath}/`;
  const children: string[] = [];
  for (const d of allDirs) {
    if (d === dirPath) {
      continue;
    }
    if (!d.startsWith(prefix)) {
      continue;
    }
    const rest = d.slice(prefix.length);
    if (rest.includes("/")) {
      continue;
    }
    children.push(d);
  }
  return children;
}

function directChildFiles(
  dirPath: string,
  entries: readonly VfsListEntry[],
): string[] {
  const prefix = dirPath === "/" ? "/" : `${dirPath}/`;
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.kind !== "file") {
      continue;
    }
    const path = normalizePath(entry.path);
    if (dirPath === "/") {
      if (path.startsWith("/") && !path.slice(1).includes("/")) {
        files.push(path);
      }
      continue;
    }
    if (!path.startsWith(prefix)) {
      continue;
    }
    const rest = path.slice(prefix.length);
    if (rest.includes("/")) {
      continue;
    }
    files.push(path);
  }
  return files;
}

function compareTreeEntries(a: TreeEntry, b: TreeEntry): number {
  if (a.kind !== b.kind) {
    return a.kind === "dir" ? -1 : 1;
  }
  return entryName(a).localeCompare(entryName(b), "en");
}

function sortedChildren(
  dirPath: string,
  allDirs: ReadonlySet<string>,
  entries: readonly VfsListEntry[],
): TreeEntry[] {
  const subdirs = directChildDirs(dirPath, allDirs).map(
    (path) => ({ kind: "dir" as const, path }),
  );
  const files = directChildFiles(dirPath, entries).map(
    (path) => ({ kind: "file" as const, path }),
  );
  return [...subdirs, ...files].sort(compareTreeEntries);
}

function appendDirLines(
  lines: string[],
  dirPath: string,
  prefix: string,
  allDirs: ReadonlySet<string>,
  entries: readonly VfsListEntry[],
): void {
  const children = sortedChildren(dirPath, allDirs, entries);
  for (let i = 0; i < children.length; i++) {
    const isLast = i === children.length - 1;
    const branch = isLast ? "└── " : "├── ";
    const child = children[i]!;
    lines.push(`${prefix}${branch}${entryName(child)}`);
    if (child.kind === "dir") {
      appendDirLines(
        lines,
        child.path,
        prefix + (isLast ? "    " : "│   "),
        allDirs,
        entries,
      );
    }
  }
}

/**
 * 将 session 作用域 VFS 渲染为 UTF-8 目录树（目录优先、同层字典序）。
 * 不调用 WorktreeService。
 */
export async function renderSessionVfsTree(vfs: VfsService): Promise<string> {
  const entries = await vfs.list("/", { recursive: true });
  const allDirs = buildDirSet(entries);
  const lines: string[] = ["/"];
  appendDirLines(lines, "/", "", allDirs, entries);
  return lines.join("\n");
}
