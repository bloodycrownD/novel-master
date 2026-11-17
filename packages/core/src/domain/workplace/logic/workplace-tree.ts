/**
 * Workplace virtual tree construction (VFS ∪ configured paths).
 *
 * @module domain/workplace/workplace-tree
 */

import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import { parentDirOrNull } from "@/domain/vfs/logic/parent-dir.js";
import type { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { WorkplaceScope } from "../model/workplace-types.js";
import { workplaceRootLogicalPath } from "./workplace-scope.js";

/**
 * 沿 parentDirOrNull 把 `logicalPath` 的祖先目录逐级加入 `dirs`，止于 `root`。
 *
 * 父目录公式单源在 `domain/vfs/logic/parent-dir.ts`（root 在那一层收敛为 null）。
 * 入参在 {@link buildWorkplaceDirSet} 内已过 normalizePath，而 parentDirOrNull
 * 对已规范化路径只在 root 处返回 null——与旧 `parentDirOf(logicalPath)` 的
 * `Ok(null)` 分支逐字等价，故不再有错误通道。
 */
function addParentChain(dirs: Set<string>, logicalPath: string, root: string): void {
  let current = parentDirOrNull(logicalPath);
  while (current != null && current !== root) {
    dirs.add(current);
    current = parentDirOrNull(current);
  }
  dirs.add(root);
}

/**
 * Builds the set of directory logical paths for list/display traversal.
 *
 * nm-style: keep-public — workplace 树构造的唯一 domain 入口，由 workplace.service
 * 跨层单点调用；内联需把 addParentChain/parentDirOrNull 的目录链逻辑一并搬进 service。
 */
export function buildWorkplaceDirSet(params: { readonly scope: WorkplaceScope; readonly filePaths: readonly string[]; readonly configuredPaths: readonly string[] }): Result<Set<string>, AppError> {
  const root = workplaceRootLogicalPath(params.scope);
  const dirs = new Set<string>([root]);
  for (const p of params.filePaths) {
    const resolved = normalizePath(p);
    if (!resolved.ok) return Result.err(resolved.error);
    addParentChain(dirs, resolved.value, root);
  }
  for (const p of params.configuredPaths) {
    const resolved = normalizePath(p);
    if (!resolved.ok) return Result.err(resolved.error);
    const n = resolved.value;
    if (n === root) {
      dirs.add(root);
      continue;
    }
    addParentChain(dirs, n, root);
    const parent = parentDirOrNull(n);
    if (parent != null) {
      dirs.add(parent);
    }
  }
  return Result.ok(dirs);
}

/** Direct child directories of `dir` within `allDirs`. */
export function directChildDirs(dir: string, allDirs: ReadonlySet<string>): Result<string[], AppError> {
  const resolved = normalizePath(dir);
  if (!resolved.ok) return Result.err(resolved.error);
  const normalized = resolved.value;
  const children: string[] = [];
  for (const d of allDirs) {
    if (d === normalized) {
      continue;
    }
    if (parentDirOrNull(d) === normalized) {
      children.push(d);
    }
  }
  return Result.ok(children);
}
