/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/provider.mapper.xml 生成，勿手改。
 * namespace=llm_provider；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const LlmProviderSql = {
    list: `SELECT id, builtin_key, protocol, base_url, display_name, secret_ref, headers_json, body_params_json, is_builtin, created_at_ms, updated_at_ms FROM llm_provider ORDER BY id
`,
    findById: `SELECT id, builtin_key, protocol, base_url, display_name, secret_ref, headers_json, body_params_json, is_builtin, created_at_ms, updated_at_ms FROM llm_provider WHERE id = #{id}
`,
    insert: `INSERT INTO llm_provider (id, builtin_key, protocol, base_url, display_name, secret_ref, headers_json, body_params_json, is_builtin, created_at_ms, updated_at_ms)
    VALUES ( #{id}, #{builtinKey}, #{protocol}, #{baseUrl}, #{displayName}, #{secretRef}, #{headersJson},
    #{bodyParamsJson}, #{isBuiltin}, #{createdAtMs}, #{updatedAtMs} )
`,
    update: `UPDATE llm_provider
    SET protocol = #{protocol}, base_url = #{baseUrl}, display_name = #{displayName}, secret_ref = #{secretRef},
    headers_json = #{headersJson}, body_params_json = #{bodyParamsJson}, updated_at_ms = #{updatedAtMs}
    WHERE id = #{id}
`,
    delete: `DELETE FROM llm_provider WHERE id = #{id}
`,
    seedBuiltin: `INSERT INTO llm_provider ( id, builtin_key, protocol, base_url, display_name, secret_ref, headers_json, is_builtin,
    created_at_ms, updated_at_ms ) SELECT #{id}, #{builtinKey}, #{protocol}, #{baseUrl}, #{displayName}, NULL, '{}', 1,
    #{now}, #{now}
    WHERE NOT EXISTS (SELECT 1
    FROM llm_provider
    WHERE builtin_key = #{builtinKey})
`,
} as const;

/** <sql id> 片段原样导出（供 base repository 的结构化拼装等非语句消费）。 */
export const LlmProviderSqlFragments = {
    selectColumns: `id, builtin_key, protocol, base_url, display_name, secret_ref, headers_json, body_params_json, is_builtin, created_at_ms, updated_at_ms
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const LlmProviderSqlParams = {
    list: [],
    findById: ["id"],
    insert: ["id", "builtinKey", "protocol", "baseUrl", "displayName", "secretRef", "headersJson", "bodyParamsJson", "isBuiltin", "createdAtMs", "updatedAtMs"],
    update: ["protocol", "baseUrl", "displayName", "secretRef", "headersJson", "bodyParamsJson", "updatedAtMs", "id"],
    delete: ["id"],
    seedBuiltin: ["id", "builtinKey", "protocol", "baseUrl", "displayName", "now"],
} as const;
