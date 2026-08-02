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
 * `SessionService.updateSessionAgentConfig` 入参——**全量替换**（非 partial overlay）。
 *
 * 调用方需传入完整的新配置；`agentId` 必填，`modelId` 可选。
 */
export type SessionAgentConfigPatch = {
  readonly agentId: string;
  readonly modelId?: string;
};
