/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/mapper/smart-sort-rule.mapper.xml 生成，勿手改。
 * namespace=smart_sort_rule；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const SmartSortRuleSql = {
    listOrdered: `SELECT rule_id, name, pattern, flags, capture_kind, description, enabled, sort_order, created_at_ms, updated_at_ms
    FROM smart_sort_rule
    ORDER BY sort_order ASC, rule_id ASC
`,
    find: `SELECT rule_id, name, pattern, flags, capture_kind, description, enabled, sort_order, created_at_ms, updated_at_ms
    FROM smart_sort_rule
    WHERE rule_id = #{ruleId}
`,
    insert: `INSERT INTO smart_sort_rule (rule_id, name, pattern, flags, capture_kind, description, enabled, sort_order,
    created_at_ms, updated_at_ms)
    VALUES (#{ruleId}, #{name}, #{pattern}, #{flags}, #{captureKind}, #{description}, #{enabled}, #{sortOrder},
    #{createdAtMs}, #{updatedAtMs})
`,
    update: `UPDATE smart_sort_rule
    SET name = #{name}, pattern = #{pattern}, flags = #{flags}, capture_kind = #{captureKind},
    description = #{description}, enabled = #{enabled}, sort_order = #{sortOrder}, updated_at_ms = #{updatedAtMs}
    WHERE rule_id = #{ruleId}
`,
    updateSortOrders: `UPDATE smart_sort_rule
    SET sort_order = CASE rule_id <foreach collection="pairs" item="pair">WHEN #{pair.ruleId} THEN #{pair.sortOrder} </foreach>ELSE sort_order END
    WHERE rule_id IN (<foreach collection="pairs" item="pair" separator=", ">#{pair.ruleId}</foreach>)
`,
    delete: `DELETE
    FROM smart_sort_rule
    WHERE rule_id = #{ruleId}
`,
    deleteAll: `DELETE FROM smart_sort_rule
`,
    nextSortOrder: `SELECT COALESCE(MAX(sort_order), 0) AS max_sort
    FROM smart_sort_rule
`,
} as const;

/** <sql id> 片段原样导出（供 base repository 的结构化拼装等非语句消费）。 */
export const SmartSortRuleSqlFragments = {
    selectColumns: `rule_id, name, pattern, flags, capture_kind, description, enabled, sort_order, created_at_ms, updated_at_ms
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const SmartSortRuleSqlParams = {
    listOrdered: [],
    find: ["ruleId"],
    insert: ["ruleId", "name", "pattern", "flags", "captureKind", "description", "enabled", "sortOrder", "createdAtMs", "updatedAtMs"],
    update: ["name", "pattern", "flags", "captureKind", "description", "enabled", "sortOrder", "updatedAtMs", "ruleId"],
    updateSortOrders: [],
    delete: ["ruleId"],
    deleteAll: [],
    nextSortOrder: [],
} as const;
