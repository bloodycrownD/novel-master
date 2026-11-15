/**
 * Parent path helper for VFS directory operations.
 *
 * @module domain/vfs/logic/parent-dir
 */

import { Result } from "@/errors/either.js";
import type { AppError } from "@/errors/app-error.js";
import { normalizePath } from "../repositories/impl/normalize-path.js";

/** Returns the parent directory path; root's parent is `/`.
 * normalizePath 失败走 `Result.err`（错误通道迁移四期：`throw r.error` 清零，决定权交给上层；isStorageRootParent 同款）。
 */
export function parentDir(path: string): Result<string, AppError> {
  const resolved = normalizePath(path);
  if (!resolved.ok) return resolved;
  const normalized = resolved.value;
  if (normalized === "/") {
    return Result.ok("/");
  }
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) {
    return Result.ok("/");
  }
  return Result.ok(normalized.slice(0, idx));
}

/**
 * Scope storage roots are virtual parents (no directory row required).
 *
 * @remarks Physical roots only: global `/template`, project `…/template`, session mount.
 */
export function isStorageRootParent(parentPath: string): Result<boolean, AppError> {
  const resolved = normalizePath(parentPath);
  if (!resolved.ok) return Result.err(resolved.error);
  const normalized = resolved.value;
  if (normalized === "/template") {
    return Result.ok(true);
  }
  if (/^\/projects\/[^/]+\/sessions\/[^/]+$/.test(normalized)) {
    return Result.ok(true);
  }
  if (/^\/projects\/[^/]+\/template$/.test(normalized)) {
    return Result.ok(true);
  }
  return Result.ok(false);
}
