/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/saved-model.mapper.xml 生成，勿手改。
 * namespace=llm_saved_model；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const LlmSavedModelSql = {
    listByProvider: `SELECT id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms
    FROM llm_saved_model
    WHERE provider_id = #{providerId}
    ORDER BY vendor_model_id, model_name
`,
    findById: `SELECT id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms FROM llm_saved_model WHERE id = #{id}
`,
    insert: `INSERT INTO llm_saved_model (id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms)
    VALUES ( #{id}, #{providerId}, #{vendorModelId}, #{modelName}, #{settingsJson}, #{createdAtMs}, #{updatedAtMs} )
`,
    updateById: `UPDATE llm_saved_model
    SET model_name = #{modelName}, settings_json = #{settingsJson}, updated_at_ms = #{updatedAtMs}
    WHERE id = #{id}
`,
    deleteById: `DELETE FROM llm_saved_model WHERE id = #{id}
`,
    deleteByProvider: `DELETE FROM llm_saved_model WHERE provider_id = #{providerId}
`,
} as const;

/** <sql id> 片段原样导出（供 base repository 的结构化拼装等非语句消费）。 */
export const LlmSavedModelSqlFragments = {
    selectColumns: `id, provider_id, vendor_model_id, model_name, settings_json, created_at_ms, updated_at_ms
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const LlmSavedModelSqlParams = {
    listByProvider: ["providerId"],
    findById: ["id"],
    insert: ["id", "providerId", "vendorModelId", "modelName", "settingsJson", "createdAtMs", "updatedAtMs"],
    updateById: ["modelName", "settingsJson", "updatedAtMs", "id"],
    deleteById: ["id"],
    deleteByProvider: ["providerId"],
} as const;
