/**
 * 自动生成：scripts/gen-sql-mapper.mjs 从 resources/sql/agent-definition.mapper.xml 生成，勿手改。
 * namespace=agent_definition；语句 id 与 repo 方法同名；展开 include 后的完整模板文本。
 *
 * @module infra/sql-template/generated
 */

export const AgentDefinitionSql = {
    listIds: `SELECT agent_id
    FROM agent_definition
    ORDER BY agent_id ASC
`,
    getRawWire: `SELECT prompts_json
    FROM agent_definition
    WHERE agent_id = #{agentId}
`,
    exists: `SELECT 1
    FROM agent_definition
    WHERE agent_id = #{agentId}
    LIMIT 1
`,
    upsert: `INSERT INTO agent_definition (agent_id, prompts_json, created_at_ms, updated_at_ms)
    VALUES (#{agentId}, #{promptsJson}, #{now}, #{now})
    ON CONFLICT(agent_id) DO UPDATE
    SET prompts_json = excluded.prompts_json, updated_at_ms = excluded.updated_at_ms
`,
    delete: `DELETE
    FROM agent_definition
    WHERE agent_id = #{agentId}
`,
    list: `SELECT prompts_json
    FROM agent_definition
    ORDER BY agent_id ASC
`,
    listAgentPrompts: `SELECT agent_id, prompts_json
    FROM agent_definition
`,
} as const;

/** 各语句的 #{param} 参数名清单（按出现序，供调用处对参与测试断言）。 */
export const AgentDefinitionSqlParams = {
    listIds: [],
    getRawWire: ["agentId"],
    exists: ["agentId"],
    upsert: ["agentId", "promptsJson", "now"],
    delete: ["agentId"],
    list: [],
    listAgentPrompts: [],
} as const;
