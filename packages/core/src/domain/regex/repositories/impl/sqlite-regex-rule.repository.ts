/**
 * SQLite `regex_rule` repository.
 *
 * @module domain/regex/repositories/impl/sqlite-regex-rule.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/connection.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/template-helper.js";
import type { Row } from "@/infra/tdbc/types.js";
import type { RegexRule } from "../../model/regex-rule.js";
import type { RegexRuleRepository } from "../regex-rule.port.js";

function rowToRule(row: Row): RegexRule {
  return {
    groupId: String(row.group_id),
    ruleId: String(row.rule_id),
    sortOrder: Number(row.sort_order),
    name: String(row.name),
    pattern: String(row.pattern),
    flags: String(row.flags ?? ""),
    enabled: Number(row.enabled) !== 0,
    llmReplace: row.llm_replace != null ? String(row.llm_replace) : null,
    displayReplace:
      row.display_replace != null ? String(row.display_replace) : null,
    minDepth: Number(row.min_depth),
    maxDepth: Number(row.max_depth),
    scopeUser: Number(row.scope_user) !== 0,
    scopeAssistant: Number(row.scope_assistant) !== 0,
    createdAtMs: Number(row.created_at_ms),
    updatedAtMs: Number(row.updated_at_ms),
  };
}

/** TDBC-backed regex rule repository. */
export class SqliteRegexRuleRepository implements RegexRuleRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listByGroupOrdered(groupId: string): Promise<RegexRule[]> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT group_id, rule_id, sort_order, name, pattern, flags, enabled,
              llm_replace, display_replace, min_depth, max_depth,
              scope_user, scope_assistant, created_at_ms, updated_at_ms
       FROM regex_rule WHERE group_id = #{groupId}
       ORDER BY sort_order ASC, rule_id ASC`,
      { groupId },
    );
    return rows.map(rowToRule);
  }

  async find(groupId: string, ruleId: string): Promise<RegexRule | null> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT group_id, rule_id, sort_order, name, pattern, flags, enabled,
              llm_replace, display_replace, min_depth, max_depth,
              scope_user, scope_assistant, created_at_ms, updated_at_ms
       FROM regex_rule
       WHERE group_id = #{groupId} AND rule_id = #{ruleId}`,
      { groupId, ruleId },
    );
    if (rows.length === 0) {
      return null;
    }
    return rowToRule(rows[0]!);
  }

  async insert(rule: RegexRule): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT INTO regex_rule (
        group_id, rule_id, sort_order, name, pattern, flags, enabled,
        llm_replace, display_replace, min_depth, max_depth,
        scope_user, scope_assistant, created_at_ms, updated_at_ms
      ) VALUES (
        #{groupId}, #{ruleId}, #{sortOrder}, #{name}, #{pattern}, #{flags},
        #{enabled}, #{llmReplace}, #{displayReplace}, #{minDepth}, #{maxDepth},
        #{scopeUser}, #{scopeAssistant}, #{createdAtMs}, #{updatedAtMs}
      )`,
      {
        groupId: rule.groupId,
        ruleId: rule.ruleId,
        sortOrder: rule.sortOrder,
        name: rule.name,
        pattern: rule.pattern,
        flags: rule.flags,
        enabled: rule.enabled ? 1 : 0,
        llmReplace: rule.llmReplace,
        displayReplace: rule.displayReplace,
        minDepth: rule.minDepth,
        maxDepth: rule.maxDepth,
        scopeUser: rule.scopeUser ? 1 : 0,
        scopeAssistant: rule.scopeAssistant ? 1 : 0,
        createdAtMs: rule.createdAtMs,
        updatedAtMs: rule.updatedAtMs,
      },
    );
  }

  async update(rule: RegexRule): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE regex_rule SET
        sort_order = #{sortOrder},
        name = #{name},
        pattern = #{pattern},
        flags = #{flags},
        enabled = #{enabled},
        llm_replace = #{llmReplace},
        display_replace = #{displayReplace},
        min_depth = #{minDepth},
        max_depth = #{maxDepth},
        scope_user = #{scopeUser},
        scope_assistant = #{scopeAssistant},
        updated_at_ms = #{updatedAtMs}
       WHERE group_id = #{groupId} AND rule_id = #{ruleId}`,
      {
        groupId: rule.groupId,
        ruleId: rule.ruleId,
        sortOrder: rule.sortOrder,
        name: rule.name,
        pattern: rule.pattern,
        flags: rule.flags,
        enabled: rule.enabled ? 1 : 0,
        llmReplace: rule.llmReplace,
        displayReplace: rule.displayReplace,
        minDepth: rule.minDepth,
        maxDepth: rule.maxDepth,
        scopeUser: rule.scopeUser ? 1 : 0,
        scopeAssistant: rule.scopeAssistant ? 1 : 0,
        updatedAtMs: rule.updatedAtMs,
      },
    );
  }

  async delete(groupId: string, ruleId: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM regex_rule WHERE group_id = #{groupId} AND rule_id = #{ruleId}`,
      { groupId, ruleId },
    );
  }

  async nextSortOrder(groupId: string): Promise<number> {
    const rows = await queryTemplate(
      this.conn,
      this.parser,
      `SELECT COALESCE(MAX(sort_order), 0) AS max_sort
       FROM regex_rule WHERE group_id = #{groupId}`,
      { groupId },
    );
    const max = Number(rows[0]?.max_sort ?? 0);
    return max + 1;
  }
}
