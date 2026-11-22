/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/chat-session.mapper.xml 生成，勿手改。
 * namespace=chat_session；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const ChatSessionSql = {
    listByProject: `SELECT id, project_id, title, parent_session_id, created_at_ms, updated_at_ms
    FROM chat_session
    WHERE project_id = #{projectId} AND parent_session_id IS NULL
    ORDER BY created_at_ms
`,
    listByParentSession: `SELECT id, project_id, title, parent_session_id, created_at_ms, updated_at_ms
    FROM chat_session
    WHERE parent_session_id = #{parentSessionId}
    ORDER BY created_at_ms
`,
    updateTitle: `UPDATE chat_session SET title = #{title}, updated_at_ms = #{updatedAtMs} WHERE id = #{id}
`,
    deleteByProject: `DELETE FROM chat_session WHERE project_id = #{projectId}
`,
    getComposerDraftJson: `SELECT composer_draft_json FROM chat_session WHERE id = #{id}
`,
    setComposerDraftJson: `UPDATE chat_session SET composer_draft_json = #{draftJson} WHERE id = #{id}
`,
    getSessionAgentConfig: `SELECT agent_config_json FROM chat_session WHERE id = #{id}
`,
    setSessionAgentConfig: `UPDATE chat_session SET agent_config_json = #{agentConfigJson}, updated_at_ms = #{updatedAtMs} WHERE id = #{id}
`,
    insert: `INSERT INTO chat_session (id, project_id, title, parent_session_id, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?, ?, ?)
`,
    listAgentConfigs: `SELECT id, agent_config_json
    FROM chat_session
`,
} as const;

/** <sql id> 片段原样导出（供 base repository 的结构化拼装等非语句消费）。 */
export const ChatSessionSqlFragments = {
    selectColumns: `id, project_id, title, parent_session_id, created_at_ms, updated_at_ms
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const ChatSessionSqlParams = {
    listByProject: ["projectId"],
    listByParentSession: ["parentSessionId"],
    updateTitle: ["title", "updatedAtMs", "id"],
    deleteByProject: ["projectId"],
    getComposerDraftJson: ["id"],
    setComposerDraftJson: ["draftJson", "id"],
    getSessionAgentConfig: ["id"],
    setSessionAgentConfig: ["agentConfigJson", "updatedAtMs", "id"],
    insert: [],
    listAgentConfigs: [],
} as const;
