/**
 * Validates agent tool allow/deny policy against registered tool names.
 *
 * @module domain/agent/logic/validate-agent-tool-policy
 */

import {
  FILE_TOOL_NAMES,
  LEGACY_FILE_TOOL_HINTS,
  normalizeAgentToolPolicyName,
} from "@/domain/tool/builtin/vfs-tools.js";
import { AgentConfigError } from "@/errors/agent-config-errors.js";
import { Result } from "@/errors/either.js";
import type { AgentToolPolicy } from "../model/agent-definition.js";

/**
 * Ensures tool policy is well-formed and references only registered tools.
 *
 * @returns Result.err(AgentConfigError) `INVALID_TOOL_POLICY` on mutual exclusion or unknown names.
 */
export function validateAgentToolPolicy(tools: AgentToolPolicy | undefined, registryNames: ReadonlySet<string>): Result<void, AgentConfigError> {
  if (tools == null) {
    return Result.ok(undefined);
  }
  if (tools.allow != null && tools.deny != null) {
    return Result.err(new AgentConfigError("INVALID_TOOL_POLICY", "tools.allow and tools.deny cannot both be set"));
  }
  for (const [listLabel, names] of [["tools.allow", tools.allow], ["tools.deny", tools.deny]] as const) {
    if (names == null) {
      continue;
    }
    for (const raw of names) {
      const name = normalizeAgentToolPolicyName(raw);
      if (registryNames.has(name)) {
        continue;
      }
      const hint = LEGACY_FILE_TOOL_HINTS[name];
      const v2List = FILE_TOOL_NAMES.join(", ");
      const suffix = hint != null ? ` Legacy tool "${raw}" was removed; use ${hint} instead. V2 tools: ${v2List}.` : ` Known V2 tools: ${v2List}.`;
      return Result.err(new AgentConfigError("INVALID_TOOL_POLICY", `${listLabel} references unknown tool: ${raw}.${suffix}`));
    }
  }
  return Result.ok(undefined);
}
