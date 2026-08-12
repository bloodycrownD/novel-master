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

  /**
   * 批量 upsert 目录规则：走 `INSERT ... ON CONFLICT DO UPDATE`（upsert 语义），
   * 一次 `conn.batch` 提交所有行，消除 copyScope 的逐条 round-trip。
   *
   * 因为是 upsert，调用方若想要覆盖式写入（不让残留行留下），需先清空目标 scope
   * （例如 copyScope 先调 deleteScope）。空数组是 no-op（不发出 SQL）。
   */
  batchUpsertDirRules(rules: readonly WorkplaceDirRule[]): Promise<void>;

  /**
   * 批量 upsert 文件规则：语义同 {@link batchUpsertDirRules}（同样走 upsert），针对 workplace_file_rule。
   */
  batchUpsertFileRules(rules: readonly WorkplaceFileRule[]): Promise<void>;

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
