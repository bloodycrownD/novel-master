/**
 * Agent definition model (prompts, optional model pin, runtime).
 *
 * @module domain/agent/model/agent-definition
 */

import type {
  AgentPromptLayout,
  DynamicPromptBlock,
  PersistTextPromptBlock,
} from "@/domain/prompt/model/agent-prompt-layout.js";

/** Allowlist or denylist tool policy (mutually exclusive). */
export interface AgentToolPolicy {
  readonly allow?: readonly string[];
  readonly deny?: readonly string[];
}

/** Serializable agent configuration (Core truth source). */
export interface AgentDefinition {
  readonly name: string;
  /** 人类可读的 agent 描述；用于在 task 工具 description 中向主 agent 介绍各 subagent 擅长什么。 */
  readonly description?: string;
  /** 暴露范围：缺省按 "all" 解释（消费侧 fallback）。 */
  readonly mode?: "primary" | "subagent" | "all";
  readonly prompts: AgentPromptLayout;
  /** Optional default model pin (savedModelId UUID); host resolves with CLI flag/state. */
  readonly model?: string;
  readonly runtime?: {
    readonly maxSteps?: number;
    readonly doomLoopThreshold?: number;
    readonly doomLoopCrossRoundWindow?: number;
  };
  /** Optional tool allow/deny policy (default: all registered tools). */
  readonly tools?: AgentToolPolicy;
}

/** prompts 的部分更新：未提供的键保留、`null` 清除、persist/dynamic 数组整体替换。 */
export interface AgentPromptLayoutPatch {
  readonly system?: string | null;
  readonly persistEnabled?: boolean | null;
  readonly dynamicEnabled?: boolean | null;
  readonly workplace?: string | null;
  readonly customAttach?: string | null;
  readonly skillsEnabled?: boolean | null;
  readonly skillsPrefix?: string | null;
  readonly persist?: readonly PersistTextPromptBlock[] | null;
  readonly dynamic?: readonly DynamicPromptBlock[] | null;
}

/** runtime 的部分更新：未提供的键保留、`null` 清除。 */
export interface AgentRuntimePatch {
  readonly maxSteps?: number | null;
  readonly doomLoopThreshold?: number | null;
  readonly doomLoopCrossRoundWindow?: number | null;
}

/** tools 的部分更新：allow/deny 数组整体替换；两者同时存在由校验层拒绝。 */
export interface AgentToolPolicyPatch {
  readonly allow?: readonly string[] | null;
  readonly deny?: readonly string[] | null;
}

/**
 * agent 定义的部分更新（RFC 7396）：未提供的键保留、`null` 清除、
 * 数组与标量整体替换。`name` 是必填字段，刻意不允许 `null`。
 */
export interface AgentDefinitionPatch {
  readonly name?: string;
  readonly description?: string | null;
  readonly mode?: NonNullable<AgentDefinition["mode"]> | null;
  readonly prompts?: AgentPromptLayoutPatch | null;
  readonly model?: string | null;
  readonly runtime?: AgentRuntimePatch | null;
  readonly tools?: AgentToolPolicyPatch | null;
}
