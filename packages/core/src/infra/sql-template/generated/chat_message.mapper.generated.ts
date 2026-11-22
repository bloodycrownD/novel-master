/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/chat-message.mapper.xml 生成，勿手改。
 * namespace=chat_message；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const ChatMessageSql = {
    listBySession: `
    SELECT id, session_id, seq, role, content_json, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms
        FROM chat_message
        WHERE session_id = #{sessionId}<if test="includeHidden === false"> AND hidden = 0</if>
        ORDER BY seq ASC
    `,
    listBySessionFromSeq: `
    SELECT id, session_id, seq, role, content_json, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms
        FROM chat_message
        WHERE session_id = #{sessionId} AND seq >= #{fromSeq}
        ORDER BY seq ASC
    `,
    listBySessionUpToSeq: `
    SELECT id, session_id, seq, role, content_json, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms
        FROM chat_message
        WHERE session_id = #{sessionId} AND seq <= #{maxSeq}
        ORDER BY seq ASC
    `,
    listBySessionTailOfRole: `
    SELECT id, session_id, seq, role, content_json, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms
        FROM (SELECT id, session_id, seq, role, content_json, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms
        FROM chat_message
        WHERE session_id = #{sessionId} AND role = #{role}
        ORDER BY seq DESC
        LIMIT #{limit})
        ORDER BY seq ASC
    `,
    listIdsBySession: `
    SELECT id FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq ASC
    `,
    listMessageHeadersBySession: `
    SELECT id, session_id, seq, role, hidden, created_at_ms FROM chat_message WHERE session_id = #{sessionId} ORDER BY seq ASC
    `,
    countBySession: `
    SELECT COUNT(*) AS n FROM chat_message WHERE session_id = #{sessionId}
    `,
    listBySessionOffset: `
    SELECT id, session_id, seq, role, hidden, created_at_ms
        FROM chat_message
        WHERE session_id = #{sessionId}
        ORDER BY seq ASC
        LIMIT -1 OFFSET #{offset}
    `,
    listBySessionTail: `
    SELECT id, session_id, seq, role, content_json, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms
        FROM (SELECT id, session_id, seq, role, content_json, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms
        FROM chat_message
        WHERE session_id = #{sessionId}
        ORDER BY seq DESC
        LIMIT #{limit})
        ORDER BY seq ASC
    `,
    listBySessionPage: `
    SELECT id, session_id, seq, role, content_json, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms
        FROM (SELECT id, session_id, seq, role, content_json, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms
        FROM chat_message
        WHERE session_id = #{sessionId} AND (#{beforeSeq} IS NULL OR seq < #{beforeSeq})
        ORDER BY seq DESC
        LIMIT #{limit})
        ORDER BY seq ASC
    `,
    nextSeq: `
    SELECT MAX(seq) AS max_seq FROM chat_message WHERE session_id = #{sessionId}
    `,
    listIdsAfterSeq: `
    SELECT id FROM chat_message WHERE session_id = #{sessionId} AND seq > #{afterSeq}
    `,
    insert: `
    INSERT INTO chat_message (id, session_id, seq, role, content_json, content_encoding, content_blob, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    updateContent: `
    UPDATE chat_message
        SET content_json = #{json}, content_encoding = NULL, content_blob = NULL
        WHERE id = #{id}
    `,
    updateHidden: `
    UPDATE chat_message SET hidden = #{hidden} WHERE id = #{id}
    `,
    updateHiddenRange: `
    UPDATE chat_message
        SET hidden = #{hidden}
        WHERE session_id = #{sessionId} AND seq >= #{fromSeq} AND seq <= #{toSeq} AND hidden = #{prevHidden}
    `,
    deleteBySession: `
    DELETE FROM chat_message WHERE session_id = #{sessionId}
    `,
    deleteAfterSeq: `
    DELETE FROM chat_message WHERE session_id = #{sessionId} AND seq > #{afterSeq}
    `,
} as const;

/** <sql id> 片段原样导出（供 base repository 的结构化拼装等非语句消费）。 */
export const ChatMessageSqlFragments = {
    selectColumns: `
    id, session_id, seq, role, content_json, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms
    `,
    headerColumns: `
    id, session_id, seq, role, hidden, created_at_ms
    `,
    insertColumns: `
    id, session_id, seq, role, content_json, content_encoding, content_blob, provider, provider_id, raw_json, created_at_ms, hidden, attachments_json, prompt_tokens, completion_tokens, total_tokens, cache_read_tokens, cache_creation_tokens, model_name, first_token_ms, duration_ms
    `,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const ChatMessageSqlParams = {
    listBySession: ["sessionId"],
    listBySessionFromSeq: ["sessionId", "fromSeq"],
    listBySessionUpToSeq: ["sessionId", "maxSeq"],
    listBySessionTailOfRole: ["sessionId", "role", "limit"],
    listIdsBySession: ["sessionId"],
    listMessageHeadersBySession: ["sessionId"],
    countBySession: ["sessionId"],
    listBySessionOffset: ["sessionId", "offset"],
    listBySessionTail: ["sessionId", "limit"],
    listBySessionPage: ["sessionId", "beforeSeq", "limit"],
    nextSeq: ["sessionId"],
    listIdsAfterSeq: ["sessionId", "afterSeq"],
    insert: [],
    updateContent: ["json", "id"],
    updateHidden: ["hidden", "id"],
    updateHiddenRange: ["hidden", "sessionId", "fromSeq", "toSeq", "prevHidden"],
    deleteBySession: ["sessionId"],
    deleteAfterSeq: ["sessionId", "afterSeq"],
} as const;
