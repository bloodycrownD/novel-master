/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/mapper/session-run-state.mapper.xml 生成，勿手改。
 * namespace=session_run_state；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const SessionRunStateSql = {
    get: `SELECT session_id, project_id, run_id, status, started_at_ms, text_chars, thinking_chars, completion_tokens,
    token_source, partial_text, partial_thinking, pending_children_json, updated_at_ms
    FROM session_run_state
    WHERE session_id = #{sessionId}
`,
    upsert: `INSERT INTO session_run_state (session_id, project_id, run_id, status, started_at_ms, text_chars, thinking_chars,
    completion_tokens, token_source, partial_text, partial_thinking, pending_children_json, updated_at_ms)
    VALUES (#{sessionId}, #{projectId}, #{runId}, #{status}, #{startedAtMs}, #{textChars}, #{thinkingChars},
    #{completionTokens}, #{tokenSource}, #{partialText}, #{partialThinking}, #{pendingChildrenJson}, #{updatedAtMs})
    ON CONFLICT(session_id) DO UPDATE
    SET project_id = excluded.project_id, run_id = excluded.run_id, status = excluded.status,
    started_at_ms = excluded.started_at_ms, text_chars = excluded.text_chars, thinking_chars = excluded.thinking_chars,
    completion_tokens = excluded.completion_tokens, token_source = excluded.token_source,
    partial_text = excluded.partial_text, partial_thinking = excluded.partial_thinking,
    pending_children_json = excluded.pending_children_json, updated_at_ms = excluded.updated_at_ms
`,
    listByStatuses: `SELECT session_id, project_id, run_id, status, started_at_ms, text_chars, thinking_chars, completion_tokens,
    token_source, partial_text, partial_thinking, pending_children_json, updated_at_ms
    FROM session_run_state
    WHERE status IN (<foreach collection="statuses" item="status" separator=", ">#{status}</foreach>)
    ORDER BY session_id
`,
    deleteBySession: `DELETE
    FROM session_run_state
    WHERE session_id = #{sessionId}
`,
    deleteByProject: `DELETE
    FROM session_run_state
    WHERE project_id = #{projectId}
`,
} as const;

/** <sql id> 片段原样导出（供 base repository 的结构化拼装等非语句消费）。 */
export const SessionRunStateSqlFragments = {
    selectColumns: `session_id, project_id, run_id, status, started_at_ms, text_chars, thinking_chars, completion_tokens,
    token_source, partial_text, partial_thinking, pending_children_json, updated_at_ms
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const SessionRunStateSqlParams = {
    get: ["sessionId"],
    upsert: ["sessionId", "projectId", "runId", "status", "startedAtMs", "textChars", "thinkingChars", "completionTokens", "tokenSource", "partialText", "partialThinking", "pendingChildrenJson", "updatedAtMs"],
    listByStatuses: ["status"],
    deleteBySession: ["sessionId"],
    deleteByProject: ["projectId"],
} as const;
