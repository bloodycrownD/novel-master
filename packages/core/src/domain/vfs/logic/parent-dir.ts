/**
 * Parent path helper for VFS directory operations.
 *
 * @module domain/vfs/logic/parent-dir
 */

import { normalizePath } from "../repositories/impl/normalize-path.js";

/** Returns the parent directory path; root's parent is `/`.
 * 解包 throw 边界（错误通道迁移三期门⑦）：normalizePath 失败按迁移前形态上抛（isStorageRootParent 同款），上游输入已归一化，失败沿调用链至端点 catch 收口。
 */
export function parentDir(path: string): string {
  const resolved = normalizePath(path);
  if (!resolved.ok) throw resolved.error;
  const normalized = resolved.value;
  if (normalized === "/") {
    return "/";
  }
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) {
    return "/";
  }
  return normalized.slice(0, idx);
}

/**
 * Scope storage roots are virtual parents (no directory row required).
 *
 * @remarks Physical roots only: global `/template`, project `…/template`, session mount.
 */
export function isStorageRootParent(parentPath: string): boolean {
  const resolved = normalizePath(parentPath);
  if (!resolved.ok) throw resolved.error;
  const normalized = resolved.value;
  if (normalized === "/template") {
    return true;
  }
  if (/^\/projects\/[^/]+\/sessions\/[^/]+$/.test(normalized)) {
    return true;
  }
  if (/^\/projects\/[^/]+\/template$/.test(normalized)) {
    return true;
  }
  return false;
}
