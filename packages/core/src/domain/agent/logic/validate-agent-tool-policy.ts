/**
 * Validates agent tool allow/deny policy against registered tool names.
 *
 * @module domain/agent/logic/validate-agent-tool-policy
 */

import { FILE_TOOL_NAMES, normalizeAgentToolPolicyName } from "@/domain/tool/builtin/vfs-tools.js";
import { AgentConfigError } from "@/errors/agent-config-errors.js";
import type { AgentToolPolicy } from "../model/agent-definition.js";

const LEGACY_TOOL_MIGRATION: Readonly<Record<string, string>> = {
  replace: "edit",
  delete: "fs (rm / rm -r)",
  move: "fs (mv)",
  copy: "fs (cp / cp -r)",
  mkdir: "fs (mkdir)",
  list: "fs (ls / ls -r)",
};

function migrationHint(raw: string): string | undefined {
  const normalized = normalizeAgentToolPolicyName(raw);
  return LEGACY_TOOL_MIGRATION[normalized];
}

function assertKnownNames(
  names: readonly string[],
  registryNames: ReadonlySet<string>,
  listLabel: string,
): void {
  for (const raw of names) {
    const name = normalizeAgentToolPolicyName(raw);
    if (!registryNames.has(name)) {
      const hint = migrationHint(raw);
      const v2List = FILE_TOOL_NAMES.join(", ");
      const suffix =
        hint != null
          ? ` Legacy tool "${raw}" was removed; use ${hint} instead. V2 tools: ${v2List}.`
          : ` Known V2 tools: ${v2List}.`;
      throw new AgentConfigError(
        "INVALID_TOOL_POLICY",
        `${listLabel} references unknown tool: ${raw}.${suffix}`,
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
  // task 是静态内置工具（registerBuiltinTools 注册，对 LLM 可见），
  // 但不能让用户在 tools.allow/deny 里配 "task"。这里中心过滤掉 task，
  // 后续 assertKnownNames 用过滤后的集合，保证用户写 "task" 仍报 INVALID_TOOL_POLICY（AC-9）。
  const knownNames = new Set(registryNames);
  knownNames.delete("task");

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
    assertKnownNames(tools.allow, knownNames, "tools.allow");
  }
  if (tools.deny != null) {
    assertKnownNames(tools.deny, knownNames, "tools.deny");
  }
}
