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
