/**
 * Worktree virtual tree construction (VFS ∪ configured paths).
 *
 * @module domain/worktree/worktree-tree
 */

import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { WorktreeScope } from "../model/worktree-types.js";
import { worktreeRootLogicalPath } from "./worktree-scope.js";

/** 逻辑路径的父目录；根目录文件返回 `/`。 */
export function parentDirOf(logicalPath: string): string | null {
  const n = normalizePath(logicalPath);
  if (n === "/") {
    return null;
  }
  const idx = n.lastIndexOf("/");
  if (idx <= 0) {
    return "/";
  }
  return n.slice(0, idx);
}

function addParentChain(dirs: Set<string>, logicalPath: string, root: string): void {
  let current = parentDirOf(logicalPath);
  while (current != null && current !== root) {
    dirs.add(current);
    current = parentDirOf(current);
  }
  dirs.add(root);
}

/**
 * Builds the set of directory logical paths for list/display traversal.
 */
export function buildWorktreeDirSet(params: {
  readonly scope: WorktreeScope;
  readonly filePaths: readonly string[];
  readonly configuredPaths: readonly string[];
}): Set<string> {
  const root = worktreeRootLogicalPath(params.scope);
  const dirs = new Set<string>([root]);
  for (const p of params.filePaths) {
    addParentChain(dirs, normalizePath(p), root);
  }
  for (const p of params.configuredPaths) {
    const n = normalizePath(p);
    if (n === root) {
      dirs.add(root);
      continue;
    }
    addParentChain(dirs, n, root);
    const parent = parentDirOf(n);
    if (parent != null) {
      dirs.add(parent);
    }
  }
  return dirs;
}

/** Direct child directories of `dir` within `allDirs`. */
export function directChildDirs(
  dir: string,
  allDirs: ReadonlySet<string>,
): string[] {
  const normalized = normalizePath(dir);
  const children: string[] = [];
  for (const d of allDirs) {
    if (d === normalized) {
      continue;
    }
    if (parentDirOf(d) === normalized) {
      children.push(d);
    }
  }
  return children;
}

/** Direct child files of `dir` from the file path list. */
export function directChildFiles(
  dir: string,
  filePaths: ReadonlySet<string>,
): string[] {
  const normalized = normalizePath(dir);
  const prefix = normalized === "/" ? "/" : `${normalized}/`;
  const children: string[] = [];
  for (const f of filePaths) {
    if (!f.startsWith(prefix) && !(normalized === "/" && f.startsWith("/"))) {
      continue;
    }
    const rel =
      normalized === "/"
        ? f.slice(1)
        : f.slice(prefix.length);
    if (rel.length === 0 || rel.includes("/")) {
      continue;
    }
    children.push(f);
  }
  return children;
}
