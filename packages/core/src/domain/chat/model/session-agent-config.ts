/**
 * 会话智能体配置（存于 `chat_session.agent_config_json` 列）。
 *
 * 与项目级 {@link ProjectAgentConfig} 不同：会话级只引用 registry agent，
 * 不内联自定义 definition。每个会话始终独立持有 `agentId`（必填），
 * 可选 `modelId` 用于覆盖 agent pin 的模型。会话不再「follow workspace」——
 * 新建会话时由 service 复制 workspace 当前指针落库。
 *
 * @module domain/chat/model/session-agent-config
 */

/**
 * 持久化在 `chat_session.agent_config_json` 列内的文档。
 *
 * - `agentId`：固定到 registry 中的 agent，**必填**。
 * - `modelId`：可选，覆盖 agent pin 的模型。
 */
export type SessionAgentConfig = {
  readonly agentId: string;
  readonly modelId?: string;
};

/**
 * `SessionService.updateSessionAgentConfig` 入参——**partial overlay**，不是全量替换。
 *
 * 调用方只传需要改的字段，service 会拿当前 `SessionAgentConfig` 当基线做 merge：
 * - `agentId`：可选。不传就保持当前值；传非空串就覆盖。
 * - `modelId`：可选。不传保持当前值；传非空串覆盖；传 `null` 表示清除会话级
 *   model 覆盖，回退到 agent pin。
 *
 * 注意 `agentId` 在 patch 里是可选的，但 merge 完之后最终落库的
 * {@link SessionAgentConfig} 仍然要求 `agentId` 必填——schema 校验会兜底，
 * 调用方不用自己保证。
 */
export type SessionAgentConfigPatch = {
  readonly agentId?: string;
  readonly modelId?: string | null;
};
