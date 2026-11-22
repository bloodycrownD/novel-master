/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/mapper/workplace-file-rule.mapper.xml 生成，勿手改。
 * namespace=workplace_file_rule；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const WorkplaceFileRuleSql = {
    upsertFileRule: `INSERT INTO workplace_file_rule (scope_key, logical_path, inclusion_mode)
    VALUES (#{scopeKey}, #{logicalPath}, #{inclusionMode})
    ON CONFLICT(scope_key, logical_path) DO UPDATE
    SET inclusion_mode = excluded.inclusion_mode
`,
    batchUpsertFileRules: `INSERT INTO workplace_file_rule (scope_key, logical_path, inclusion_mode)
    VALUES (?, ?, ?)
    ON CONFLICT(scope_key, logical_path) DO UPDATE
    SET inclusion_mode = excluded.inclusion_mode
`,
    deleteScope: `DELETE
    FROM workplace_file_rule
    WHERE scope_key = #{scopeKey}
`,
    listFileRules: `SELECT scope_key, logical_path, inclusion_mode
    FROM workplace_file_rule
    WHERE scope_key = #{scopeKey}
`,
    findFileRule: `SELECT scope_key, logical_path, inclusion_mode
    FROM workplace_file_rule
    WHERE scope_key = #{scopeKey} AND logical_path = #{logicalPath}
`,
    deleteRulesUnderLogicalPrefix: `DELETE
    FROM workplace_file_rule
    WHERE scope_key = #{scopeKey} AND (logical_path = #{path} OR logical_path LIKE #{childPattern} ESCAPE '\\')
`,
    renameRulesUnderLogicalPrefix: `UPDATE workplace_file_rule
    SET logical_path = CASE WHEN logical_path = #{oldBase} THEN #{newBase} ELSE #{newBase} || substr(logical_path,
    length(#{oldBase}) + 1) END
    WHERE scope_key = #{scopeKey} AND (logical_path = #{oldBase} OR logical_path LIKE #{childPattern} ESCAPE '\\')
`,
} as const;

/** <sql id> 片段原样导出（供 base repository 的结构化拼装等非语句消费）。 */
export const WorkplaceFileRuleSqlFragments = {
    selectColumns: `scope_key, logical_path, inclusion_mode
`,
    insertColumns: `(scope_key, logical_path, inclusion_mode)
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const WorkplaceFileRuleSqlParams = {
    upsertFileRule: ["scopeKey", "logicalPath", "inclusionMode"],
    batchUpsertFileRules: [],
    deleteScope: ["scopeKey"],
    listFileRules: ["scopeKey"],
    findFileRule: ["scopeKey", "logicalPath"],
    deleteRulesUnderLogicalPrefix: ["scopeKey", "path", "childPattern"],
    renameRulesUnderLogicalPrefix: ["oldBase", "newBase", "scopeKey", "childPattern"],
} as const;
