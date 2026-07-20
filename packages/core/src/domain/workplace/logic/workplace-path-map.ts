/**
 * Project ↔ session workplace logical path mapping.
 *
 * @module domain/workplace/workplace-path-map
 */

import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";

/**
 * Maps a project template logical path to session scope (identity after unified root).
 */
export function mapProjectWorkplacePathToSession(logical: string): string {
  return normalizePath(logical);
}

/**
 * Maps a session logical path back to project template scope (identity).
 */
export function mapSessionWorkplacePathToProject(logical: string): string {
  return normalizePath(logical);
}
