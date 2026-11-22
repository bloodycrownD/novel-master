/**
 * SQLite skill_disabled_rule repository。
 *
 * @module domain/skills/repositories/impl/sqlite-skill-disabled-rule.repository
 */

import type { TdbcConnection } from "@/infra/tdbc/ports/connection.port.js";
import { SqlTemplateParser } from "@/infra/sql-template/index.js";
import { TdbcTemplate } from "@/infra/tdbc/logic/template-helper.js";
import type { SkillDisabledRuleRepository } from "../skill-disabled-rule.port.js";
import { SkillDisabledRuleSql } from "@/infra/sql-template/generated/skill_disabled_rule.mapper.generated.js";

/** TDBC-backed `skill_disabled_rule` repository。 */
export class SqliteSkillDisabledRuleRepository implements SkillDisabledRuleRepository {
    private readonly parser = new SqlTemplateParser();

    constructor(private readonly conn: TdbcConnection) {}

    /** nm-style: keep-public — 实现 SkillDisabledRuleRepository.listDisabledNames 端口方法；内联会把查询 SQL 搬进调用层。 */
    async listDisabledNames(scopeKey: string): Promise<string[]> {
        const rows = await TdbcTemplate.query<{ skill_name: string }>(this.conn, this.parser, SkillDisabledRuleSql.listDisabledNames, { scopeKey });
        return rows.map((row) => String(row.skill_name));
    }

    async upsert(scopeKey: string, skillName: string): Promise<void> {
        await TdbcTemplate.execute(this.conn, this.parser, SkillDisabledRuleSql.upsert, { scopeKey, skillName });
    }

    async remove(scopeKey: string, skillName: string): Promise<void> {
        await TdbcTemplate.execute(this.conn, this.parser, SkillDisabledRuleSql.remove, { scopeKey, skillName });
    }

    /** nm-style: keep-public — 实现 SkillDisabledRuleRepository.removeScope 端口方法；内联会把删除 SQL 搬进调用层。 */
    async removeScope(scopeKey: string): Promise<void> {
        await TdbcTemplate.execute(this.conn, this.parser, SkillDisabledRuleSql.removeScope, { scopeKey });
    }

    /** nm-style: keep-public — 实现 SkillDisabledRuleRepository.removeAllScopesByName 端口方法；内联会把删除 SQL 搬进调用层。 */
    async removeAllScopesByName(skillName: string): Promise<void> {
        await TdbcTemplate.execute(this.conn, this.parser, SkillDisabledRuleSql.removeAllScopesByName, { skillName });
    }

    async renameByName(scopeKey: string | null, from: string, to: string): Promise<void> {
        // UPDATE OR IGNORE：撞 (scope_key, skill_name) 主键的行跳过不更新
        // （目标行已存在，两行等价）；随后无条件清除旧行，被跳过的旧行不残留。
        // scopeKey 为空时 mapper 的 scope 过滤整段不渲染（全 scope 改名）。
        const params: Record<string, unknown> = scopeKey == null ? { from, to } : { from, to, scopeKey };
        await TdbcTemplate.execute(this.conn, this.parser, SkillDisabledRuleSql.renameByNameUpdate, params);
        await TdbcTemplate.execute(this.conn, this.parser, SkillDisabledRuleSql.renameByNameDelete, params);
    }

    /** nm-style: keep-public — 实现 SkillDisabledRuleRepository.copyScopeRules 端口方法；内联会把跨 scope 复制 SQL 搬进调用层。 */
    async copyScopeRules(fromScopeKey: string, toScopeKey: string): Promise<void> {
        await TdbcTemplate.execute(this.conn, this.parser, SkillDisabledRuleSql.copyScopeRules, { fromScopeKey, toScopeKey });
    }
}
