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

/** 技能能力总开关关闭（prompts.skillsEnabled === false）时摘除的工具。 */
const SKILL_TOOL_POLICY_NAME = "skill";

export interface ResolveAgentToolRegistryOptions {
  /** 当前 agent 递归深度：主 agent depth=0，子 depth=1，孙 depth=2。 */
  readonly depth?: number;
}

/**
 * Returns a new registry containing only tools permitted for the agent.
 *
 * 两层硬性过滤（覆盖用户 policy，防递归）：
 * 1. mode === "subagent" 的智能体强制移除 task——子智能体不能再生子智能体。
 * 2. depth >= 2（孙 agent）也强制移除 task——递归上限双保险。
 * 用户在 tools.allow/deny 里配 task 是合法的，但对子智能体无效（装配时忽略）。
 *
 * 另一层配置过滤：prompts.skillsEnabled === false（技能总开关关）时强制移除
 * skill 工具——与 task 同摘除模式。D4 联动随 registry 不含 skill 自动生效：
 * skills 闭包不注入、技能索引（skillsIndex）置空；用户显式 `$` 引用不受影响。
 * 注意：policy allow 只含 skill 时开关关闭会得到空 registry，属预期（用户全关）。
 */
export function resolveAgentToolRegistry<Ctx>(
  baseRegistry: ToolRegistry<Ctx>,
  definition: AgentDefinition,
  options?: ResolveAgentToolRegistryOptions,
): ToolRegistry<Ctx> {
  const allNames = baseRegistry.list();
  const allowed = new Set(allowedToolNames(definition, allNames));
  // 子智能体强制移除 task（防递归）；孙 agent 同理（递归上限）。
  if (definition.mode === "subagent" || (options?.depth ?? 0) >= 2) {
    allowed.delete(SUBAGENT_TOOL_NAME);
  }
  // 技能能力总开关关闭：移除 skill 工具（索引注入随 D4 联动同关）。
  if (definition.prompts.skillsEnabled === false) {
    allowed.delete(SKILL_TOOL_POLICY_NAME);
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
