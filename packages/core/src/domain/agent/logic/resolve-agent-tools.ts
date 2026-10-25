/**
 * Filters a tool registry according to agent definition tool policy.
 *
 * @module domain/agent/logic/resolve-agent-tools
 */

import { normalizeAgentToolPolicyName } from "@/domain/tool/builtin/vfs-tools.js";
import { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { AgentDefinition } from "../model/agent-definition.js";

/**
 * Returns a new registry containing only tools permitted for the agent.
 *
 * 三层过滤：
 * 1. 用户 policy：无 tools → 全量；allow → 只留名单；deny → 去掉名单。
 * 2. 硬规则（覆盖 policy）：subagent 或 depth >= 2 → 摘 task / agent
 *    （子智能体不能再生子智能体，也不能改写 agent 定义；孙 agent 双保险）。
 * 3. prompts.skillsEnabled === false → 摘 skill（技能索引注入随 D4 联动同关）。
 *
 * 用户在 tools.allow/deny 里配 task / agent 是合法的，但对子智能体无效。
 * policy allow 只含 skill 时开关关闭会得到空 registry，属预期（用户全关）。
 */
export function resolveAgentToolRegistry<Ctx>(baseRegistry: ToolRegistry<Ctx>, definition: AgentDefinition, options?: {readonly depth?: number}): ToolRegistry<Ctx> {
  const allNames = baseRegistry.list();
  const allowed = new Set(allNames);
  if (definition.tools?.allow != null) {
    allowed.clear();
    for (const name of definition.tools.allow) {
      allowed.add(normalizeAgentToolPolicyName(name));
    }
  } else if (definition.tools?.deny != null && definition.tools.deny.length > 0) {
    for (const name of definition.tools.deny) {
      allowed.delete(normalizeAgentToolPolicyName(name));
    }
  }
  if (definition.mode === "subagent" || (options?.depth ?? 0) >= 2) {
    allowed.delete("task");
    allowed.delete("agent");
  }
  if (definition.prompts.skillsEnabled === false) {
    allowed.delete("skill");
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
