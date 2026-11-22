/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/mapper/chat-project.mapper.xml 生成，勿手改。
 * namespace=chat_project；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const ChatProjectSql = {
    list: `SELECT id, name, created_at_ms, updated_at_ms FROM chat_project ORDER BY created_at_ms
`,
    updateName: `UPDATE chat_project SET name = #{name}, updated_at_ms = #{updatedAtMs} WHERE id = #{id}
`,
    getAgentConfig: `SELECT agent_config_json FROM chat_project WHERE id = #{id}
`,
    updateAgentConfig: `UPDATE chat_project
    SET agent_config_json = #{configJson}, updated_at_ms = #{updatedAtMs}
    WHERE id = #{id}
`,
    insert: `INSERT INTO chat_project (id, name, created_at_ms, updated_at_ms)
    VALUES (?, ?, ?, ?)
`,
    listAgentConfigs: `SELECT id, agent_config_json
    FROM chat_project
`,
} as const;

/** <sql id> 片段原样导出（供 base repository 的结构化拼装等非语句消费）。 */
export const ChatProjectSqlFragments = {
    selectColumns: `id, name, created_at_ms, updated_at_ms
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const ChatProjectSqlParams = {
    list: [],
    updateName: ["name", "updatedAtMs", "id"],
    getAgentConfig: ["id"],
    updateAgentConfig: ["configJson", "updatedAtMs", "id"],
    insert: [],
    listAgentConfigs: [],
} as const;
