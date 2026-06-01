/**
 * Filters a tool registry according to agent definition tool policy.
 *
 * @module domain/agent/logic/resolve-agent-tool-registry
 */

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
    return policy.allow;
  }
  if (policy.deny != null && policy.deny.length > 0) {
    const denied = new Set(policy.deny);
    return allNames.filter((name) => !denied.has(name));
  }
  return allNames;
}

/**
 * Returns a new registry containing only tools permitted for the agent.
 */
export function resolveAgentToolRegistry<Ctx>(
  baseRegistry: ToolRegistry<Ctx>,
  definition: AgentDefinition,
): ToolRegistry<Ctx> {
  const allNames = baseRegistry.list();
  const allowed = new Set(allowedToolNames(definition, allNames));
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
