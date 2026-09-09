/**
 * SQLite skill_disabled_rule repository。
 *
 * @module domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import {
  executeTemplate,
  queryTemplate,
} from "@/infra/tdbc/logic/template-helper.js";
import { SKILL_DISABLED_RULE_TABLE } from "@/bootstrap/skills/skills-schema.js";
import type { SkillDisabledRuleRepository } from "../skill-disabled-rule.port.js";

/** TDBC-backed `skill_disabled_rule` repository。 */
export class SqliteSkillDisabledRuleRepository
  implements SkillDisabledRuleRepository
{
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  async listDisabledNames(scopeKey: string): Promise<string[]> {
    const rows = await queryTemplate<{ skill_name: string }>(
      this.conn,
      this.parser,
      `SELECT skill_name FROM ${SKILL_DISABLED_RULE_TABLE}
       WHERE scope_key = #{scopeKey} ORDER BY skill_name`,
      { scopeKey }
    );
    return rows.map((row) => String(row.skill_name));
  }

  async upsert(scopeKey: string, skillName: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT OR IGNORE INTO ${SKILL_DISABLED_RULE_TABLE} (scope_key, skill_name)
       VALUES (#{scopeKey}, #{skillName})`,
      { scopeKey, skillName }
    );
  }

  async remove(scopeKey: string, skillName: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM ${SKILL_DISABLED_RULE_TABLE}
       WHERE scope_key = #{scopeKey} AND skill_name = #{skillName}`,
      { scopeKey, skillName }
    );
  }

  async removeScope(scopeKey: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM ${SKILL_DISABLED_RULE_TABLE} WHERE scope_key = #{scopeKey}`,
      { scopeKey }
    );
  }

  async removeAllScopesByName(skillName: string): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM ${SKILL_DISABLED_RULE_TABLE} WHERE skill_name = #{skillName}`,
      { skillName }
    );
  }

  async renameByName(
    scopeKey: string | null,
    from: string,
    to: string
  ): Promise<void> {
    // UPDATE OR IGNORE：撞 (scope_key, skill_name) 主键的行跳过不更新
    // （目标行已存在，两行等价）；随后无条件清除旧行，被跳过的旧行不残留。
    const scopeFilter =
      scopeKey == null ? "" : " AND scope_key = #{scopeKey}";
    const params: Record<string, string> = { from, to };
    if (scopeKey != null) {
      params.scopeKey = scopeKey;
    }
    await executeTemplate(
      this.conn,
      this.parser,
      `UPDATE OR IGNORE ${SKILL_DISABLED_RULE_TABLE}
       SET skill_name = #{to} WHERE skill_name = #{from}${scopeFilter}`,
      params
    );
    await executeTemplate(
      this.conn,
      this.parser,
      `DELETE FROM ${SKILL_DISABLED_RULE_TABLE}
       WHERE skill_name = #{from}${scopeFilter}`,
      params
    );
  }

  async copyScopeRules(
    fromScopeKey: string,
    toScopeKey: string
  ): Promise<void> {
    await executeTemplate(
      this.conn,
      this.parser,
      `INSERT OR IGNORE INTO ${SKILL_DISABLED_RULE_TABLE} (scope_key, skill_name)
       SELECT #{toScopeKey}, skill_name FROM ${SKILL_DISABLED_RULE_TABLE}
       WHERE scope_key = #{fromScopeKey}`,
      { fromScopeKey, toScopeKey }
    );
  }
}
