/**
 * Workplace virtual tree construction (VFS ∪ configured paths).
 *
 * @module domain/workplace/workplace-tree
 */

import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type { WorkplaceScope } from "../model/workplace-types.js";
import { workplaceRootLogicalPath } from "./workplace-scope.js";

/** 逻辑路径的父目录；根目录文件返回 `/`。 */
export function parentDirOf(logicalPath: string): string | null {
  const resolved = normalizePath(logicalPath);
  if (!resolved.ok) throw resolved.error;
  const n = resolved.value;
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
 *
 * nm-style: keep-public — workplace 树构造的唯一 domain 入口，由 workplace.service
 * 跨层单点调用；内联需把 addParentChain/parentDirOf 的目录链逻辑一并搬进 service。
 */
export function buildWorkplaceDirSet(params: { readonly scope: WorkplaceScope; readonly filePaths: readonly string[]; readonly configuredPaths: readonly string[] }): Set<string> {
  const root = workplaceRootLogicalPath(params.scope);
  const dirs = new Set<string>([root]);
  for (const p of params.filePaths) {
    const resolved = normalizePath(p);
    if (!resolved.ok) throw resolved.error;
    addParentChain(dirs, resolved.value, root);
  }
  for (const p of params.configuredPaths) {
    const resolved = normalizePath(p);
    if (!resolved.ok) throw resolved.error;
    const n = resolved.value;
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
export function directChildDirs(dir: string, allDirs: ReadonlySet<string>): string[] {
  const resolved = normalizePath(dir);
  if (!resolved.ok) throw resolved.error;
  const normalized = resolved.value;
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
