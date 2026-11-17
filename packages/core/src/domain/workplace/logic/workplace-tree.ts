/**
 * Workplace virtual tree construction (VFS ∪ configured paths).
 *
 * @module domain/workplace/workplace-tree
 */

import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import { parentDirOfNormalized } from "@/domain/vfs/logic/parent-dir.js";
import type { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { WorkplaceScope } from "../model/workplace-types.js";
import { workplaceRootLogicalPath } from "./workplace-scope.js";

/** 逻辑路径的父目录；根目录文件返回 `/`。
 * 解包接力（错误通道迁移四期门⑦）：normalizePath 失败沿返回值通道原样上交（buildWorkplaceDirSet / directChildDirs 同款），决定权交给调用方。
 */
export function parentDirOf(logicalPath: string): Result<string | null, AppError> {
  const resolved = normalizePath(logicalPath);
  if (!resolved.ok) return Result.err(resolved.error);
  // 公式单源：domain/vfs/logic/parent-dir.ts（root 在本层收敛为 null，无父目录）。
  return Result.ok(resolved.value === "/" ? null : parentDirOfNormalized(resolved.value));
}

function addParentChain(dirs: Set<string>, logicalPath: string, root: string): Result<void, AppError> {
  let stepped = parentDirOf(logicalPath);
  if (!stepped.ok) return Result.err(stepped.error);
  let current = stepped.value;
  while (current != null && current !== root) {
    dirs.add(current);
    stepped = parentDirOf(current);
    if (!stepped.ok) return Result.err(stepped.error);
    current = stepped.value;
  }
  dirs.add(root);
  return Result.ok(undefined);
}

/**
 * Builds the set of directory logical paths for list/display traversal.
 *
 * nm-style: keep-public — workplace 树构造的唯一 domain 入口，由 workplace.service
 * 跨层单点调用；内联需把 addParentChain/parentDirOf 的目录链逻辑一并搬进 service。
 */
export function buildWorkplaceDirSet(params: { readonly scope: WorkplaceScope; readonly filePaths: readonly string[]; readonly configuredPaths: readonly string[] }): Result<Set<string>, AppError> {
  const root = workplaceRootLogicalPath(params.scope);
  const dirs = new Set<string>([root]);
  for (const p of params.filePaths) {
    const resolved = normalizePath(p);
    if (!resolved.ok) return Result.err(resolved.error);
    const stepped = addParentChain(dirs, resolved.value, root);
    if (!stepped.ok) return Result.err(stepped.error);
  }
  for (const p of params.configuredPaths) {
    const resolved = normalizePath(p);
    if (!resolved.ok) return Result.err(resolved.error);
    const n = resolved.value;
    if (n === root) {
      dirs.add(root);
      continue;
    }
    const stepped = addParentChain(dirs, n, root);
    if (!stepped.ok) return Result.err(stepped.error);
    const parent = parentDirOf(n);
    if (!parent.ok) return Result.err(parent.error);
    if (parent.value != null) {
      dirs.add(parent.value);
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
    const parent = parentDirOf(d);
    if (!parent.ok) return Result.err(parent.error);
    if (parent.value === normalized) {
      children.push(d);
    }
  }
  return Result.ok(children);
}
