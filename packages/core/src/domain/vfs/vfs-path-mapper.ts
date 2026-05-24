/**
 * Maps logical VFS paths to physical `vfs_entry.path` values per scope.
 *
 * @module domain/vfs/vfs-path-mapper
 */

import { vfsInvalidPath } from "../../errors/vfs-errors.js";
import { normalizePath } from "./repositories/impl/normalize-path.js";

/** VFS visibility scope (global, project, or session). */
export type VfsScope =
  | { kind: "global" }
  | { kind: "project"; projectId: string }
  | { kind: "session"; projectId: string; sessionId: string };

const TEMPLATE_PREFIX = "/template";

/**
 * Validates that a logical path is allowed for the given scope.
 *
 * @throws {import("../../errors/vfs-errors.js").VfsError} `INVALID_PATH`
 */
export function assertLogicalPathAllowed(scope: VfsScope, logical: string): void {
  const normalized = normalizePath(logical);
  if (scope.kind === "session") {
    return;
  }
  if (
    normalized === TEMPLATE_PREFIX ||
    normalized.startsWith(`${TEMPLATE_PREFIX}/`)
  ) {
    return;
  }
  throw vfsInvalidPath(
    logical,
    `${scope.kind} scope only allows paths under /template/`,
  );
}

/**
 * Converts a caller logical path to the physical `vfs_entry.path`.
 */
export function toPhysicalPath(scope: VfsScope, logical: string): string {
  assertLogicalPathAllowed(scope, logical);
  const normalized = normalizePath(logical);
  switch (scope.kind) {
    case "global":
      return normalized;
    case "project":
      return `/projects/${scope.projectId}${normalized}`;
    case "session":
      return `/projects/${scope.projectId}/sessions/${scope.sessionId}${normalized}`;
  }
}

/**
 * Converts a physical path back to the logical path for the scope.
 *
 * @throws {import("../../errors/vfs-errors.js").VfsError} `INVALID_PATH` when out of scope
 */
export function toLogicalPath(scope: VfsScope, physical: string): string {
  const normalized = normalizePath(physical);
  switch (scope.kind) {
    case "global":
      if (
        normalized !== TEMPLATE_PREFIX &&
        !normalized.startsWith(`${TEMPLATE_PREFIX}/`)
      ) {
        throw vfsInvalidPath(physical, "not in global template scope");
      }
      return normalized;
    case "project": {
      const prefix = `/projects/${scope.projectId}`;
      if (!normalized.startsWith(`${prefix}/template`)) {
        throw vfsInvalidPath(physical, "not in project template scope");
      }
      return normalized.slice(prefix.length);
    }
    case "session": {
      const prefix = `/projects/${scope.projectId}/sessions/${scope.sessionId}`;
      if (normalized === prefix) {
        return "/";
      }
      if (!normalized.startsWith(`${prefix}/`)) {
        throw vfsInvalidPath(physical, "not in session scope");
      }
      return normalized.slice(prefix.length);
    }
  }
}

/** Physical prefix for a scope (for tree copy and bulk delete). */
export function scopePhysicalPrefix(scope: VfsScope): string {
  switch (scope.kind) {
    case "global":
      return TEMPLATE_PREFIX;
    case "project":
      return `/projects/${scope.projectId}/template`;
    case "session":
      return `/projects/${scope.projectId}/sessions/${scope.sessionId}`;
  }
}

/** Physical prefix for all vfs rows under a project (sessions + template). */
export function projectVfsPrefix(projectId: string): string {
  return `/projects/${projectId}`;
}
