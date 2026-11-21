/**
 * SQLite skill_disabled_rule repository。
 *
 * @module domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import { SKILL_DISABLED_RULE_TABLE } from "@/bootstrap/skills/skills-schema.js";
import type { SkillDisabledRuleRepository } from "../skill-disabled-rule.port.js";

const LIST_DISABLED_SQL = `SELECT skill_name
    FROM ${SKILL_DISABLED_RULE_TABLE}
    WHERE scope_key = #{scopeKey}
    ORDER BY skill_name`;
const INSERT_SQL = `INSERT OR IGNORE INTO ${SKILL_DISABLED_RULE_TABLE} (scope_key, skill_name)
    VALUES (#{scopeKey}, #{skillName})`;
const REMOVE_SQL = `DELETE
    FROM ${SKILL_DISABLED_RULE_TABLE}
    WHERE scope_key = #{scopeKey} AND skill_name = #{skillName}`;
const REMOVE_SCOPE_SQL = `DELETE FROM ${SKILL_DISABLED_RULE_TABLE} WHERE scope_key = #{scopeKey}`;
const REMOVE_ALL_BY_NAME_SQL = `DELETE FROM ${SKILL_DISABLED_RULE_TABLE} WHERE skill_name = #{skillName}`;
const COPY_SCOPE_SQL = `INSERT OR IGNORE INTO ${SKILL_DISABLED_RULE_TABLE} (scope_key, skill_name) SELECT #{toScopeKey}, skill_name
    FROM ${SKILL_DISABLED_RULE_TABLE}
    WHERE scope_key = #{fromScopeKey}`;

/** TDBC-backed `skill_disabled_rule` repository。 */
export class SqliteSkillDisabledRuleRepository implements SkillDisabledRuleRepository {
  private readonly parser = new SqlTemplateParser();

  constructor(private readonly conn: TdbcConnection) {}

  /** nm-style: keep-public — 实现 SkillDisabledRuleRepository.listDisabledNames 端口方法；内联会把查询 SQL 搬进调用层。 */
  async listDisabledNames(scopeKey: string): Promise<string[]> {
    const rows = await TdbcTemplate.query<{ skill_name: string }>(this.conn, this.parser, LIST_DISABLED_SQL, { scopeKey });
    return rows.map((row) => String(row.skill_name));
  }

  async upsert(scopeKey: string, skillName: string): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, INSERT_SQL, { scopeKey, skillName });
  }

  async remove(scopeKey: string, skillName: string): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, REMOVE_SQL, { scopeKey, skillName });
  }

  /** nm-style: keep-public — 实现 SkillDisabledRuleRepository.removeScope 端口方法；内联会把删除 SQL 搬进调用层。 */
  async removeScope(scopeKey: string): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, REMOVE_SCOPE_SQL, { scopeKey });
  }

  /** nm-style: keep-public — 实现 SkillDisabledRuleRepository.removeAllScopesByName 端口方法；内联会把删除 SQL 搬进调用层。 */
  async removeAllScopesByName(skillName: string): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, REMOVE_ALL_BY_NAME_SQL, { skillName });
  }

  async renameByName(scopeKey: string | null, from: string, to: string): Promise<void> {
    // UPDATE OR IGNORE：撞 (scope_key, skill_name) 主键的行跳过不更新
    // （目标行已存在，两行等价）；随后无条件清除旧行，被跳过的旧行不残留。
    const scopeFilter = scopeKey == null ? "" : " AND scope_key = #{scopeKey}";
    const params: Record<string, string> = { from, to };
    if (scopeKey != null) {
      params.scopeKey = scopeKey;
    }
    await TdbcTemplate.execute(this.conn, this.parser, `UPDATE OR IGNORE ${SKILL_DISABLED_RULE_TABLE}
    SET skill_name = #{to}
    WHERE skill_name = #{from}${scopeFilter}`, params);
    await TdbcTemplate.execute(this.conn, this.parser, `DELETE
    FROM ${SKILL_DISABLED_RULE_TABLE}
    WHERE skill_name = #{from}${scopeFilter}`, params);
  }

  /** nm-style: keep-public — 实现 SkillDisabledRuleRepository.copyScopeRules 端口方法；内联会把跨 scope 复制 SQL 搬进调用层。 */
  async copyScopeRules(fromScopeKey: string, toScopeKey: string): Promise<void> {
    await TdbcTemplate.execute(this.conn, this.parser, COPY_SCOPE_SQL, { fromScopeKey, toScopeKey });
  }
}
