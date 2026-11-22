/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/mapper/usage-record.mapper.xml 生成，勿手改。
 * namespace=usage_record；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const UsageRecordSql = {
    insert: `INSERT INTO usage_record ( session_id, message_seq, provider, provider_id, model_name, prompt_tokens,
    completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, first_token_ms, duration_ms,
    created_at_ms )
    VALUES ( #{sessionId}, #{messageSeq}, #{provider}, #{providerId}, #{modelName}, #{promptTokens}, #{completionTokens},
    #{totalTokens}, #{cacheReadTokens}, #{cacheCreationTokens}, #{firstTokenMs}, #{durationMs}, #{createdAtMs} )
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const UsageRecordSqlParams = {
    insert: ["sessionId", "messageSeq", "provider", "providerId", "modelName", "promptTokens", "completionTokens", "totalTokens", "cacheReadTokens", "cacheCreationTokens", "firstTokenMs", "durationMs", "createdAtMs"],
} as const;
