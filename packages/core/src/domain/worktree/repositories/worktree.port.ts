/**
 * Worktree repository port (core-internal).
 *
 * @module domain/worktree/repositories/worktree.port
 */

import type {
  InclusionMode,
  WorktreeDirRule,
  WorktreeFileRule,
} from "../model/worktree-types.js";

/**
 * Persistence for worktree_dir_rule and worktree_file_rule.
 */
export interface WorktreeRepository {
  upsertDirRule(rule: WorktreeDirRule): Promise<void>;

  upsertFileRule(rule: WorktreeFileRule): Promise<void>;

  deleteScope(scopeKey: string): Promise<void>;

  listDirRules(scopeKey: string): Promise<WorktreeDirRule[]>;

  listFileRules(scopeKey: string): Promise<WorktreeFileRule[]>;

  findDirRule(
    scopeKey: string,
    logicalPath: string,
  ): Promise<WorktreeDirRule | null>;

  findFileRule(
    scopeKey: string,
    logicalPath: string,
  ): Promise<WorktreeFileRule | null>;

  /**
   * Replaces all rules in `toScopeKey` with a copy from `fromScopeKey`.
   */
  copyScope(
    fromScopeKey: string,
    toScopeKey: string,
    mapLogicalPath: (logical: string) => string,
  ): Promise<void>;

  /** 删除某逻辑路径及其子路径下的目录/文件纳入规则。 */
  deleteRulesUnderLogicalPrefix(
    scopeKey: string,
    logicalPrefix: string,
  ): Promise<void>;
}

export type { InclusionMode, WorktreeDirRule, WorktreeFileRule };
