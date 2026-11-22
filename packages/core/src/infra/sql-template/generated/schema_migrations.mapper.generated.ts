/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/schema-migrations.mapper.xml 生成，勿手改。
 * namespace=schema_migrations；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const SchemaMigrationsSql = {
    listAppliedIds: `SELECT id FROM schema_migrations
`,
    markApplied: `INSERT INTO schema_migrations (id, applied_at_ms)
    VALUES (#{id}, #{appliedAtMs})
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const SchemaMigrationsSqlParams = {
    listAppliedIds: [],
    markApplied: ["id", "appliedAtMs"],
} as const;
