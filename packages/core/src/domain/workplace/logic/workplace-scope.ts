/**
 * Workplace scope key helpers.
 *
 * @module domain/workplace/workplace-scope
 */

import type { WorkplaceScope as WorkplaceScopeType } from "../model/workplace-types.js";

/** 本文件同时以「类型别名 + namespace const」双含义导出 `WorkplaceScope`（type=模型类型，value=键位助手）。 */
export type WorkplaceScope = WorkplaceScopeType;

export const WorkplaceScope = {
    /**
   * Stable storage key for a workplace scope.
   */
    key(scope: WorkplaceScopeType): string {
        switch (scope.kind) {
            case "global":
                return "global";
            case "project":
                return `project:${scope.projectId}`;
            case "session":
                return `session:${scope.sessionId}`;
            case "global-meta":
                return "global:meta";
            case "project-meta":
                return `project:${scope.projectId}:meta`;
        }
    },

    /**
   * Root logical path for workplace rules in this scope (unified `/` for all domains).
   */
    rootLogicalPath(_scope: WorkplaceScopeType): string {
        return "/";
    },

    /**
   * Whether `logicalPath` is the scope root (rule cannot be turned off).
   */
    isRootPath(scope: WorkplaceScopeType, logicalPath: string): boolean {
        return logicalPath === WorkplaceScope.rootLogicalPath(scope);
    },
} as const;
