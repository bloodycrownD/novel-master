/**
 * Agent definition model (prompts, optional model pin, runtime).
 *
 * @module domain/agent/model/agent-definition
 */

import type { AgentPromptLayout } from "@/domain/prompt/model/agent-prompt-layout.js";

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
  /** 是否可被 `task` 工具调用为子代理；缺省按 `false` 处理（递归基线）。 */
  readonly subagentCallable?: boolean;
}
