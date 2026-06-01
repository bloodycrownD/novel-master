/**
 * Parent path helper for VFS directory operations.
 *
 * @module domain/vfs/logic/parent-dir
 */

import { normalizePath } from "../repositories/impl/normalize-path.js";

/** Returns the parent directory path; root's parent is `/`. */
export function parentDir(path: string): string {
  const normalized = normalizePath(path);
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
  const normalized = normalizePath(parentPath);
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
