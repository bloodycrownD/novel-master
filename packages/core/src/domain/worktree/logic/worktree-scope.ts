/**
 * Worktree scope key helpers.
 *
 * @module domain/worktree/worktree-scope
 */

import type { WorktreeScope } from "../model/worktree-types.js";

/**
 * Stable storage key for a worktree scope.
 */
export function worktreeScopeKey(scope: WorktreeScope): string {
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
 * Root logical path for worktree rules in this scope.
 */
export function worktreeRootLogicalPath(scope: WorktreeScope): string {
  return scope.kind === "session" ? "/" : "/template";
}

/**
 * Whether `logicalPath` is the scope root (rule cannot be turned off).
 */
export function isWorktreeRootPath(
  scope: WorktreeScope,
  logicalPath: string,
): boolean {
  return logicalPath === worktreeRootLogicalPath(scope);
}
