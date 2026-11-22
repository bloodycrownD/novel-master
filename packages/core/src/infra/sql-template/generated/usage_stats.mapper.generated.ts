/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/usage-stats.mapper.xml 生成，勿手改。
 * namespace=usage_stats；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const UsageStatsSql = {
    aggregate: `SELECT COUNT(*) AS calls,
  COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
  COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
  COALESCE(SUM(total_tokens), 0) AS total_tokens,
  COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
  COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
  COALESCE(SUM(CASE WHEN provider = 'anthropic'
    THEN prompt_tokens + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0)
    ELSE prompt_tokens
  END) FILTER (WHERE cache_read_tokens IS NOT NULL OR cache_creation_tokens IS NOT NULL), 0) AS billed_input_tokens,
  AVG(first_token_ms) AS avg_first_token_ms,
  CAST(SUM(completion_tokens) FILTER (WHERE completion_tokens IS NOT NULL
    AND first_token_ms IS NOT NULL
    AND duration_ms IS NOT NULL AND duration_ms > first_token_ms) AS REAL)
    / (SUM(duration_ms - first_token_ms) FILTER (WHERE completion_tokens IS NOT NULL
    AND first_token_ms IS NOT NULL
    AND duration_ms IS NOT NULL AND duration_ms > first_token_ms) / 1000.0) AS avg_tokens_per_second
    FROM usage_record
    WHERE (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL) <if test="fromMs != null and toMs != null">
  AND created_at_ms >= #{fromMs} AND created_at_ms < #{toMs}</if> <if test="model === null">
  AND (model_name IS NULL OR model_name NOT IN (SELECT DISTINCT vendor_model_id FROM llm_saved_model))</if><if test="model !== undefined and model !== null">
  AND model_name = #{model}</if> <if test="providerId === null">
  AND provider_id IS NULL</if><if test="providerId !== undefined and providerId !== null">
  AND provider_id = #{providerId}</if>
`,
    dailyBuckets: `SELECT strftime('%Y-%m-%d', created_at_ms / 1000, 'unixepoch', 'localtime') AS day_key, COUNT(*) AS calls,
  COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
  COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
  COALESCE(SUM(total_tokens), 0) AS total_tokens,
  COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
  COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
  COALESCE(SUM(CASE WHEN provider = 'anthropic'
    THEN prompt_tokens + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0)
    ELSE prompt_tokens
  END) FILTER (WHERE cache_read_tokens IS NOT NULL OR cache_creation_tokens IS NOT NULL), 0) AS billed_input_tokens,
  AVG(first_token_ms) AS avg_first_token_ms,
  CAST(SUM(completion_tokens) FILTER (WHERE completion_tokens IS NOT NULL
    AND first_token_ms IS NOT NULL
    AND duration_ms IS NOT NULL AND duration_ms > first_token_ms) AS REAL)
    / (SUM(duration_ms - first_token_ms) FILTER (WHERE completion_tokens IS NOT NULL
    AND first_token_ms IS NOT NULL
    AND duration_ms IS NOT NULL AND duration_ms > first_token_ms) / 1000.0) AS avg_tokens_per_second
    FROM usage_record
    WHERE (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL) AND created_at_ms >= #{fromMs} AND created_at_ms < #{toMs} <if test="model === null">
  AND (model_name IS NULL OR model_name NOT IN (SELECT DISTINCT vendor_model_id FROM llm_saved_model))</if><if test="model !== undefined and model !== null">
  AND model_name = #{model}</if> <if test="providerId === null">
  AND provider_id IS NULL</if><if test="providerId !== undefined and providerId !== null">
  AND provider_id = #{providerId}</if>
    GROUP BY day_key
`,
    modelBreakdown: `SELECT provider_id, model_name, COUNT(*) AS calls,
  COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
  COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
  COALESCE(SUM(total_tokens), 0) AS total_tokens,
  COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
  COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
  COALESCE(SUM(CASE WHEN provider = 'anthropic'
    THEN prompt_tokens + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0)
    ELSE prompt_tokens
  END) FILTER (WHERE cache_read_tokens IS NOT NULL OR cache_creation_tokens IS NOT NULL), 0) AS billed_input_tokens,
  AVG(first_token_ms) AS avg_first_token_ms,
  CAST(SUM(completion_tokens) FILTER (WHERE completion_tokens IS NOT NULL
    AND first_token_ms IS NOT NULL
    AND duration_ms IS NOT NULL AND duration_ms > first_token_ms) AS REAL)
    / (SUM(duration_ms - first_token_ms) FILTER (WHERE completion_tokens IS NOT NULL
    AND first_token_ms IS NOT NULL
    AND duration_ms IS NOT NULL AND duration_ms > first_token_ms) / 1000.0) AS avg_tokens_per_second
    FROM usage_record
    WHERE (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL) <if test="fromMs != null and toMs != null">
  AND created_at_ms >= #{fromMs} AND created_at_ms < #{toMs}</if> <if test="model === null">
  AND (model_name IS NULL OR model_name NOT IN (SELECT DISTINCT vendor_model_id FROM llm_saved_model))</if><if test="model !== undefined and model !== null">
  AND model_name = #{model}</if> <if test="providerId === null">
  AND provider_id IS NULL</if><if test="providerId !== undefined and providerId !== null">
  AND provider_id = #{providerId}</if>
    GROUP BY provider_id, model_name -- 不排序：输出顺序由 JS 归并后的 sort 保证（SQL 序会被归并架空）
`,
    countRequestUsage: `SELECT COUNT(*) AS n
    FROM usage_record WHERE (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL)
         <if test="fromMs != null and toMs != null">
  AND created_at_ms >= #{fromMs} AND created_at_ms < #{toMs}</if>
         <if test="model === null">
  AND (model_name IS NULL OR model_name NOT IN (SELECT DISTINCT vendor_model_id FROM llm_saved_model))</if><if test="model !== undefined and model !== null">
  AND model_name = #{model}</if>
         <if test="providerId === null">
  AND provider_id IS NULL</if><if test="providerId !== undefined and providerId !== null">
  AND provider_id = #{providerId}</if>
`,
    listRequestUsage: `SELECT created_at_ms, model_name, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens,
    cache_creation_tokens, first_token_ms, duration_ms
    FROM usage_record WHERE (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL)
         <if test="fromMs != null and toMs != null">
  AND created_at_ms >= #{fromMs} AND created_at_ms < #{toMs}</if>
         <if test="model === null">
  AND (model_name IS NULL OR model_name NOT IN (SELECT DISTINCT vendor_model_id FROM llm_saved_model))</if><if test="model !== undefined and model !== null">
  AND model_name = #{model}</if>
         <if test="providerId === null">
  AND provider_id IS NULL</if><if test="providerId !== undefined and providerId !== null">
  AND provider_id = #{providerId}</if>
    ORDER BY created_at_ms DESC, id ASC
    LIMIT #{limit} OFFSET #{offset}
`,
    listModels: `SELECT DISTINCT vendor_model_id FROM llm_saved_model ORDER BY vendor_model_id ASC
`,
    lastRequest: `SELECT message_seq, model_name, provider, prompt_tokens, completion_tokens, cache_read_tokens, cache_creation_tokens,
    created_at_ms
    FROM usage_record
    WHERE (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL) AND session_id = #{sessionId}
    ORDER BY created_at_ms DESC, id DESC
    LIMIT 1
`,
    visibleMessageCount: `SELECT COUNT(*) AS n FROM chat_message WHERE session_id = #{sessionId} AND hidden = 0
`,
    listAssistantMessageContents: `SELECT id, content_json FROM chat_message WHERE session_id = #{sessionId} AND role = 'assistant'
`,
} as const;

/** <sql id> 片段原样导出（供 base repository 的结构化拼装等非语句消费）。 */
export const UsageStatsSqlFragments = {
    billedInputSum: `SUM(CASE WHEN provider = 'anthropic'
    THEN prompt_tokens + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0)
    ELSE prompt_tokens
  END) FILTER (WHERE cache_read_tokens IS NOT NULL OR cache_creation_tokens IS NOT NULL)
`,
    rateFilter: `WHERE completion_tokens IS NOT NULL
    AND first_token_ms IS NOT NULL
    AND duration_ms IS NOT NULL AND duration_ms > first_token_ms
`,
    aggSelect: `COUNT(*) AS calls,
  COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
  COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
  COALESCE(SUM(total_tokens), 0) AS total_tokens,
  COALESCE(SUM(cache_read_tokens), 0) AS cache_read_tokens,
  COALESCE(SUM(cache_creation_tokens), 0) AS cache_creation_tokens,
  COALESCE(SUM(CASE WHEN provider = 'anthropic'
    THEN prompt_tokens + COALESCE(cache_read_tokens, 0) + COALESCE(cache_creation_tokens, 0)
    ELSE prompt_tokens
  END) FILTER (WHERE cache_read_tokens IS NOT NULL OR cache_creation_tokens IS NOT NULL), 0) AS billed_input_tokens,
  AVG(first_token_ms) AS avg_first_token_ms,
  CAST(SUM(completion_tokens) FILTER (WHERE completion_tokens IS NOT NULL
    AND first_token_ms IS NOT NULL
    AND duration_ms IS NOT NULL AND duration_ms > first_token_ms) AS REAL)
    / (SUM(duration_ms - first_token_ms) FILTER (WHERE completion_tokens IS NOT NULL
    AND first_token_ms IS NOT NULL
    AND duration_ms IS NOT NULL AND duration_ms > first_token_ms) / 1000.0) AS avg_tokens_per_second
`,
    usageNotNull: `(prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL)
`,
    modelFilter: `<if test="model === null">
  AND (model_name IS NULL OR model_name NOT IN (SELECT DISTINCT vendor_model_id FROM llm_saved_model))</if><if test="model !== undefined and model !== null">
  AND model_name = #{model}</if>
`,
    providerFilter: `<if test="providerId === null">
  AND provider_id IS NULL</if><if test="providerId !== undefined and providerId !== null">
  AND provider_id = #{providerId}</if>
`,
    timeRange: `<if test="fromMs != null and toMs != null">
  AND created_at_ms >= #{fromMs} AND created_at_ms < #{toMs}</if>
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const UsageStatsSqlParams = {
    aggregate: ["fromMs", "toMs", "model", "providerId"],
    dailyBuckets: ["fromMs", "toMs", "model", "providerId"],
    modelBreakdown: ["fromMs", "toMs", "model", "providerId"],
    countRequestUsage: ["fromMs", "toMs", "model", "providerId"],
    listRequestUsage: ["fromMs", "toMs", "model", "providerId", "limit", "offset"],
    listModels: [],
    lastRequest: ["sessionId"],
    visibleMessageCount: ["sessionId"],
    listAssistantMessageContents: ["sessionId"],
} as const;
