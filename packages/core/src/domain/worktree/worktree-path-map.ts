/**
 * Project ↔ session worktree logical path mapping.
 *
 * @module domain/worktree/worktree-path-map
 */

import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";

/**
 * Maps a project template logical path to session scope.
 *
 * @param logical - Project logical path under `/template`
 */
export function mapProjectWorktreePathToSession(logical: string): string {
  const n = normalizePath(logical);
  if (n === "/template") {
    return "/";
  }
  if (n.startsWith("/template/")) {
    return n.slice("/template".length);
  }
  throw new Error(`not a project template path: ${logical}`);
}

/**
 * Maps a session logical path back to project template scope.
 */
export function mapSessionWorktreePathToProject(logical: string): string {
  const n = normalizePath(logical);
  if (n === "/") {
    return "/template";
  }
  return `/template${n}`;
}
