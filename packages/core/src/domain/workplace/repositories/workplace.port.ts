/**
 * Workplace repository port (core-internal).
 *
 * @module domain/workplace/repositories/workplace.port
 */

import type {
  InclusionMode,
  WorkplaceDirRule,
  WorkplaceFileRule,
} from "../model/workplace-types.js";

/**
 * Persistence for worktree_dir_rule and worktree_file_rule.
 */
export interface WorkplaceRepository {
  upsertDirRule(rule: WorkplaceDirRule): Promise<void>;

  upsertFileRule(rule: WorkplaceFileRule): Promise<void>;

  deleteScope(scopeKey: string): Promise<void>;

  listDirRules(scopeKey: string): Promise<WorkplaceDirRule[]>;

  listFileRules(scopeKey: string): Promise<WorkplaceFileRule[]>;

  findDirRule(
    scopeKey: string,
    logicalPath: string,
  ): Promise<WorkplaceDirRule | null>;

  findFileRule(
    scopeKey: string,
    logicalPath: string,
  ): Promise<WorkplaceFileRule | null>;

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

export type { InclusionMode, WorkplaceDirRule, WorkplaceFileRule };
