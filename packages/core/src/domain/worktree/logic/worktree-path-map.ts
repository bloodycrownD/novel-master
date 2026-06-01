/**
 * Project ↔ session worktree logical path mapping.
 *
 * @module domain/worktree/worktree-path-map
 */

import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";

/**
 * Maps a project template logical path to session scope (identity after unified root).
 */
export function mapProjectWorktreePathToSession(logical: string): string {
  return normalizePath(logical);
}

/**
 * Maps a session logical path back to project template scope (identity).
 */
export function mapSessionWorktreePathToProject(logical: string): string {
  return normalizePath(logical);
}
