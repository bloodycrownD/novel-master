/**
 * SQLite worktree repository.
 *
 * @module domain/worktree/repositories/impl/sqlite-worktree.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import { normalizePath } from "@/domain/vfs/repositories/impl/normalize-path.js";
import type {
  FillPolicy,
  InclusionMode,
  SortField,
  SortOrder,
  WorktreeDirRule,
  WorktreeFileRule,
} from "../../model/worktree-types.js";
import type { WorktreeRepository } from "../worktree.port.js";

function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function rowToDirRule(row: Row): WorktreeDirRule {
  return {
    scopeKey: String(row.scope_key),
    logicalPath: String(row.logical_path),
    ruleEnabled: Number(row.rule_enabled) !== 0,
    sortField: String(row.sort_field) as SortField,
    sortOrder: String(row.sort_order) as SortOrder,
    headCount: Number(row.head_count),
    tailCount: Number(row.tail_count),
    fillPolicy: String(row.fill_policy) as FillPolicy,
  };
}

function rowToFileRule(row: Row): WorktreeFileRule {
  return {
    scopeKey: String(row.scope_key),
    logicalPath: String(row.logical_path),
    inclusionMode: String(row.inclusion_mode) as InclusionMode,
  };
}

/**
 * TDBC-backed worktree configuration repository.
 */
export class SqliteWorktreeRepository implements WorktreeRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async upsertDirRule(rule: WorktreeDirRule): Promise<void> {
    const logicalPath = normalizePath(rule.logicalPath);
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO worktree_dir_rule (
        scope_key, logical_path, rule_enabled, sort_field, sort_order,
        head_count, tail_count, fill_policy
      ) VALUES (
        #{scopeKey}, #{logicalPath}, #{ruleEnabled}, #{sortField}, #{sortOrder},
        #{headCount}, #{tailCount}, #{fillPolicy}
      )
      ON CONFLICT(scope_key, logical_path) DO UPDATE SET
        rule_enabled = excluded.rule_enabled,
        sort_field = excluded.sort_field,
        sort_order = excluded.sort_order,
        head_count = excluded.head_count,
        tail_count = excluded.tail_count,
        fill_policy = excluded.fill_policy`,
      {
        scopeKey: rule.scopeKey,
        logicalPath,
        ruleEnabled: rule.ruleEnabled ? 1 : 0,
        sortField: rule.sortField,
        sortOrder: rule.sortOrder,
        headCount: rule.headCount,
        tailCount: rule.tailCount,
        fillPolicy: rule.fillPolicy,
      },
    );
  }

  async upsertFileRule(rule: WorktreeFileRule): Promise<void> {
    const logicalPath = normalizePath(rule.logicalPath);
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO worktree_file_rule (scope_key, logical_path, inclusion_mode)
       VALUES (#{scopeKey}, #{logicalPath}, #{inclusionMode})
       ON CONFLICT(scope_key, logical_path) DO UPDATE SET
         inclusion_mode = excluded.inclusion_mode`,
      {
        scopeKey: rule.scopeKey,
        logicalPath,
        inclusionMode: rule.inclusionMode,
      },
    );
  }

  async deleteScope(scopeKey: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM worktree_dir_rule WHERE scope_key = #{scopeKey}`,
      { scopeKey },
    );
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM worktree_file_rule WHERE scope_key = #{scopeKey}`,
      { scopeKey },
    );
  }

  async listDirRules(scopeKey: string): Promise<WorktreeDirRule[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT scope_key, logical_path, rule_enabled, sort_field, sort_order,
              head_count, tail_count, fill_policy
       FROM worktree_dir_rule WHERE scope_key = #{scopeKey}`,
      { scopeKey },
    );
    return rows.map(rowToDirRule);
  }

  async listFileRules(scopeKey: string): Promise<WorktreeFileRule[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT scope_key, logical_path, inclusion_mode
       FROM worktree_file_rule WHERE scope_key = #{scopeKey}`,
      { scopeKey },
    );
    return rows.map(rowToFileRule);
  }

  async findDirRule(
    scopeKey: string,
    logicalPath: string,
  ): Promise<WorktreeDirRule | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT scope_key, logical_path, rule_enabled, sort_field, sort_order,
              head_count, tail_count, fill_policy
       FROM worktree_dir_rule
       WHERE scope_key = #{scopeKey} AND logical_path = #{logicalPath}`,
      { scopeKey, logicalPath: normalizePath(logicalPath) },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToDirRule(rows[0]!);
  }

  async findFileRule(
    scopeKey: string,
    logicalPath: string,
  ): Promise<WorktreeFileRule | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT scope_key, logical_path, inclusion_mode
       FROM worktree_file_rule
       WHERE scope_key = #{scopeKey} AND logical_path = #{logicalPath}`,
      { scopeKey, logicalPath: normalizePath(logicalPath) },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToFileRule(rows[0]!);
  }

  async copyScope(
    fromScopeKey: string,
    toScopeKey: string,
    mapLogicalPath: (logical: string) => string,
  ): Promise<void> {
    await this.deleteScope(toScopeKey);
    const dirs = await this.listDirRules(fromScopeKey);
    const files = await this.listFileRules(fromScopeKey);
    for (const d of dirs) {
      await this.upsertDirRule({
        ...d,
        scopeKey: toScopeKey,
        logicalPath: mapLogicalPath(d.logicalPath),
      });
    }
    for (const f of files) {
      await this.upsertFileRule({
        ...f,
        scopeKey: toScopeKey,
        logicalPath: mapLogicalPath(f.logicalPath),
      });
    }
  }

  async deleteRulesUnderLogicalPrefix(
    scopeKey: string,
    logicalPrefix: string,
  ): Promise<void> {
    const base = normalizePath(logicalPrefix);
    const escaped = escapeLike(base);
    const childPattern = `${escaped}/%`;
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM worktree_dir_rule
       WHERE scope_key = #{scopeKey}
         AND (logical_path = #{path} OR logical_path LIKE #{childPattern} ESCAPE '\\')`,
      { scopeKey, path: base, childPattern },
    );
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM worktree_file_rule
       WHERE scope_key = #{scopeKey}
         AND (logical_path = #{path} OR logical_path LIKE #{childPattern} ESCAPE '\\')`,
      { scopeKey, path: base, childPattern },
    );
  }
}
