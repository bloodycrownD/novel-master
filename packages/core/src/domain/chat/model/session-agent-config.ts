/**
 * 会话智能体配置（存于 `chat_session.agent_config_json` 列）。
 *
 * 与项目级 {@link ProjectAgentConfig} 不同：会话级只引用 registry agent，
 * 不内联自定义 definition。`follow` 表示跟随项目/工作区解析结果，`bind`
 * 表示固定到 registry 中的某个 agent（可附带 modelId 覆盖）。
 *
 * @module domain/chat/model/session-agent-config
 */

/** 会话智能体策略模式。 */
export type SessionAgentMode = "follow" | "bind";

/**
 * 持久化在 `chat_session.agent_config_json` 列内的文档。
 *
 * - `follow`：不绑定具体 agent，运行时跟随项目/工作区解析。
 * - `bind`：固定到 registry 中的 `agentId`；`modelId` 可选，用于覆盖 agent pin。
 */
export type SessionAgentConfig =
  | { readonly mode: "follow" }
  | {
      readonly mode: "bind";
      readonly agentId: string;
      readonly modelId?: string;
    };

/**
 * `SessionService.updateSessionAgentConfig` 的部分更新（partial overlay，非 full replace）。
 *
 * 三种形态：
 * 1. `{ mode: "follow" }`：解绑，整体替换为 follow。
 * 2. `{ mode: "bind"; agentId; modelId? }`：绑定，整体替换为 bind。
 * 3. `{ modelId: string | null }`：仅改 model 覆盖，保持现有 mode/agentId；
 *    若当前已是 `follow`，则因缺 `agentId` 无法落 bind，schema 校验会拒绝。
 */
export type SessionAgentConfigPatch =
  | { readonly mode: "follow" }
  | {
      readonly mode: "bind";
      readonly agentId: string;
      readonly modelId?: string;
    }
  | { readonly modelId: string | null };

/** 列 NULL 或未设置时的默认配置。 */
export const DEFAULT_SESSION_AGENT_CONFIG: SessionAgentConfig = {
  mode: "follow",
};
