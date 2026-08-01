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
 * Persistence for workplace_dir_rule and workplace_file_rule.
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

  /**
   * 批量重命名某逻辑前缀下的目录/文件规则路径（rename 目录时用）。
   *
   * 将 `oldPrefix` 自身及所有子路径的 `logical_path` 原子地替换为
   * `newPrefix` 对应路径。一条 UPDATE 搞定，替代逐条 get+set 循环。
   */
  renameRulesUnderLogicalPrefix(
    scopeKey: string,
    oldPrefix: string,
    newPrefix: string,
  ): Promise<void>;
}

export type { InclusionMode, WorkplaceDirRule, WorkplaceFileRule };
