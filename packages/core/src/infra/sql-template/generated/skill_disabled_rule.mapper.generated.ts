/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/skill-disabled-rule.mapper.xml 生成，勿手改。
 * namespace=skill_disabled_rule；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const SkillDisabledRuleSql = {
    listDisabledNames: `SELECT skill_name
    FROM skill_disabled_rule
    WHERE scope_key = #{scopeKey}
    ORDER BY skill_name
`,
    upsert: `INSERT OR IGNORE INTO skill_disabled_rule (scope_key, skill_name)
    VALUES (#{scopeKey}, #{skillName})
`,
    remove: `DELETE
    FROM skill_disabled_rule
    WHERE scope_key = #{scopeKey} AND skill_name = #{skillName}
`,
    removeScope: `DELETE FROM skill_disabled_rule WHERE scope_key = #{scopeKey}
`,
    removeAllScopesByName: `DELETE FROM skill_disabled_rule WHERE skill_name = #{skillName}
`,
    renameByNameUpdate: `UPDATE OR IGNORE skill_disabled_rule
    SET skill_name = #{to}
    WHERE skill_name = #{from}<if test="scopeKey != null"> AND scope_key = #{scopeKey}</if>
`,
    renameByNameDelete: `DELETE
    FROM skill_disabled_rule
    WHERE skill_name = #{from}<if test="scopeKey != null"> AND scope_key = #{scopeKey}</if>
`,
    copyScopeRules: `INSERT OR IGNORE INTO skill_disabled_rule (scope_key, skill_name) SELECT #{toScopeKey}, skill_name
    FROM skill_disabled_rule
    WHERE scope_key = #{fromScopeKey}
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const SkillDisabledRuleSqlParams = {
    listDisabledNames: ["scopeKey"],
    upsert: ["scopeKey", "skillName"],
    remove: ["scopeKey", "skillName"],
    removeScope: ["scopeKey"],
    removeAllScopesByName: ["skillName"],
    renameByNameUpdate: ["to", "from", "scopeKey"],
    renameByNameDelete: ["from", "scopeKey"],
    copyScopeRules: ["toScopeKey", "fromScopeKey"],
} as const;
