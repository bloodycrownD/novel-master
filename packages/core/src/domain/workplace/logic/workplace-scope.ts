/**
 * Workplace scope key helpers.
 *
 * @module domain/workplace/workplace-scope
 */

import type { WorkplaceScope } from "../model/workplace-types.js";

/**
 * Stable storage key for a workplace scope.
 */
export function workplaceScopeKey(scope: WorkplaceScope): string {
  switch (scope.kind) {
    case "global":
      return "global";
    case "project":
      return `project:${scope.projectId}`;
    case "session":
      return `session:${scope.sessionId}`;
  }
}

/**
 * Root logical path for workplace rules in this scope (unified `/` for all domains).
 */
export function workplaceRootLogicalPath(_scope: WorkplaceScope): string {
  return "/";
}

/**
 * Whether `logicalPath` is the scope root (rule cannot be turned off).
 */
export function isWorkplaceRootPath(
  scope: WorkplaceScope,
  logicalPath: string,
): boolean {
  return logicalPath === workplaceRootLogicalPath(scope);
}
