/**
 * Filters a tool registry according to agent definition tool policy.
 *
 * @module domain/agent/logic/resolve-agent-tool-registry
 */

import { normalizeAgentToolPolicyName } from "@/domain/tool/builtin/vfs-tools.js";
import { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { AgentDefinition } from "../model/agent-definition.js";

function allowedToolNames(
  definition: AgentDefinition,
  allNames: readonly string[],
): readonly string[] {
  const policy = definition.tools;
  if (policy == null) {
    return allNames;
  }
  if (policy.allow != null) {
    return policy.allow.map(normalizeAgentToolPolicyName);
  }
  if (policy.deny != null && policy.deny.length > 0) {
    const denied = new Set(policy.deny.map(normalizeAgentToolPolicyName));
    return allNames.filter((name) => !denied.has(name));
  }
  return allNames;
}

/** 递归上限（P1-10）：depth >= 2（孙 agent）时 task 被 deny，孙 agent LLM 看不到它。 */
const SUBAGENT_TOOL_NAME = "task";

export interface ResolveAgentToolRegistryOptions {
  /** 当前 agent 递归深度：主 agent depth=0，子 depth=1，孙 depth=2。 */
  readonly depth?: number;
}

/**
 * Returns a new registry containing only tools permitted for the agent.
 *
 * `depth >= 2` 时强制从结果中移除 `task`（递归上限，P1-10）：孙 agent 的 LLM 根本
 * 看不到 `task` 工具，不会尝试调用。调用点从闭包变量传 depth，不依赖 ctx 推导。
 */
export function resolveAgentToolRegistry<Ctx>(
  baseRegistry: ToolRegistry<Ctx>,
  definition: AgentDefinition,
  options?: ResolveAgentToolRegistryOptions,
): ToolRegistry<Ctx> {
  const allNames = baseRegistry.list();
  const allowed = new Set(allowedToolNames(definition, allNames));
  // 孙 agent 强制 deny task，不管 tools policy 如何配。
  if ((options?.depth ?? 0) >= 2) {
    allowed.delete(SUBAGENT_TOOL_NAME);
  }
  const filtered = new ToolRegistry<Ctx>();
  for (const name of allNames) {
    if (allowed.has(name)) {
      const tool = baseRegistry.get(name);
      if (tool != null) {
        filtered.register(tool);
      }
    }
  }
  return filtered;
}
