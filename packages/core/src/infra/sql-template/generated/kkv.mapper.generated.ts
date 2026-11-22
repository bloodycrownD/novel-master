/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/mapper/kkv.mapper.xml 生成，勿手改。
 * namespace=kkv；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const KkvSql = {
    listKeysByModule: `SELECT key
    FROM kkv_entry
    WHERE module = #{module}
    ORDER BY key
`,
    getByKey: `SELECT module, key, value FROM kkv_entry WHERE module = #{module} AND key = #{key}
`,
    getValueByKey: `SELECT value FROM kkv_entry WHERE module = #{module} AND key = #{key}
`,
    upsert: `INSERT INTO kkv_entry (module, key, value)
    VALUES (#{module}, #{key}, #{value})
    ON CONFLICT(module, key) DO UPDATE
    SET value = excluded.value
`,
    deleteByKey: `DELETE
    FROM kkv_entry
    WHERE module = #{module} AND key = #{key}
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const KkvSqlParams = {
    listKeysByModule: ["module"],
    getByKey: ["module", "key"],
    getValueByKey: ["module", "key"],
    upsert: ["module", "key", "value"],
    deleteByKey: ["module", "key"],
} as const;
