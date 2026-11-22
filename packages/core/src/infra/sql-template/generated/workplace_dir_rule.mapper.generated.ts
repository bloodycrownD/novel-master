/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/workplace-dir-rule.mapper.xml 生成，勿手改。
 * namespace=workplace_dir_rule；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const WorkplaceDirRuleSql = {
    upsertDirRule: `INSERT INTO workplace_dir_rule ( scope_key, logical_path, rule_enabled, sort_field, sort_order, head_count, tail_count, fill_policy )
    VALUES ( #{scopeKey}, #{logicalPath}, #{ruleEnabled}, #{sortField}, #{sortOrder}, #{headCount}, #{tailCount},
    #{fillPolicy} )
    ON CONFLICT(scope_key, logical_path) DO UPDATE
    SET rule_enabled = excluded.rule_enabled, sort_field = excluded.sort_field, sort_order = excluded.sort_order,
    head_count = excluded.head_count, tail_count = excluded.tail_count, fill_policy = excluded.fill_policy
`,
    batchUpsertDirRules: `INSERT INTO workplace_dir_rule ( scope_key, logical_path, rule_enabled, sort_field, sort_order, head_count, tail_count, fill_policy )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope_key, logical_path) DO UPDATE
    SET rule_enabled = excluded.rule_enabled, sort_field = excluded.sort_field, sort_order = excluded.sort_order,
    head_count = excluded.head_count, tail_count = excluded.tail_count, fill_policy = excluded.fill_policy
`,
    deleteScope: `DELETE
    FROM workplace_dir_rule
    WHERE scope_key = #{scopeKey}
`,
    listDirRules: `SELECT scope_key, logical_path, rule_enabled, sort_field, sort_order, head_count, tail_count, fill_policy
    FROM workplace_dir_rule
    WHERE scope_key = #{scopeKey}
`,
    findDirRule: `SELECT scope_key, logical_path, rule_enabled, sort_field, sort_order, head_count, tail_count, fill_policy
    FROM workplace_dir_rule
    WHERE scope_key = #{scopeKey} AND logical_path = #{logicalPath}
`,
    deleteRulesUnderLogicalPrefix: `DELETE
    FROM workplace_dir_rule
    WHERE scope_key = #{scopeKey} AND (logical_path = #{path} OR logical_path LIKE #{childPattern} ESCAPE '\\')
`,
    renameRulesUnderLogicalPrefix: `UPDATE workplace_dir_rule
    SET logical_path = CASE WHEN logical_path = #{oldBase} THEN #{newBase} ELSE #{newBase} || substr(logical_path,
    length(#{oldBase}) + 1) END
    WHERE scope_key = #{scopeKey} AND (logical_path = #{oldBase} OR logical_path LIKE #{childPattern} ESCAPE '\\')
`,
} as const;

/** <sql id> 片段原样导出（供 base repository 的结构化拼装等非语句消费）。 */
export const WorkplaceDirRuleSqlFragments = {
    selectColumns: `scope_key, logical_path, rule_enabled, sort_field, sort_order, head_count, tail_count, fill_policy
`,
    insertColumns: `( scope_key, logical_path, rule_enabled, sort_field, sort_order, head_count, tail_count, fill_policy )
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const WorkplaceDirRuleSqlParams = {
    upsertDirRule: ["scopeKey", "logicalPath", "ruleEnabled", "sortField", "sortOrder", "headCount", "tailCount", "fillPolicy"],
    batchUpsertDirRules: [],
    deleteScope: ["scopeKey"],
    listDirRules: ["scopeKey"],
    findDirRule: ["scopeKey", "logicalPath"],
    deleteRulesUnderLogicalPrefix: ["scopeKey", "path", "childPattern"],
    renameRulesUnderLogicalPrefix: ["oldBase", "newBase", "scopeKey", "childPattern"],
} as const;
