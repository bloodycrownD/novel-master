/**
 * Validates agent tool allow/deny policy against registered tool names.
 *
 * @module domain/agent/logic/validate-agent-tool-policy
 */

import { AgentConfigError } from "@/errors/agent-config-errors.js";
import type { AgentToolPolicy } from "../model/agent-definition.js";

function assertKnownNames(
  names: readonly string[],
  registryNames: ReadonlySet<string>,
  listLabel: string,
): void {
  for (const name of names) {
    if (!registryNames.has(name)) {
      throw new AgentConfigError(
        "INVALID_TOOL_POLICY",
        `${listLabel} references unknown tool: ${name}`,
      );
    }
  }
}

/**
 * Ensures tool policy is well-formed and references only registered tools.
 *
 * @throws {AgentConfigError} `INVALID_TOOL_POLICY` on mutual exclusion or unknown names
 */
export function validateAgentToolPolicy(
  tools: AgentToolPolicy | undefined,
  registryNames: ReadonlySet<string>,
): void {
  if (tools == null) {
    return;
  }

  const hasAllow = tools.allow != null;
  const hasDeny = tools.deny != null;
  if (hasAllow && hasDeny) {
    throw new AgentConfigError(
      "INVALID_TOOL_POLICY",
      "tools.allow and tools.deny cannot both be set",
    );
  }

  if (tools.allow != null) {
    assertKnownNames(tools.allow, registryNames, "tools.allow");
  }
  if (tools.deny != null) {
    assertKnownNames(tools.deny, registryNames, "tools.deny");
  }
}
