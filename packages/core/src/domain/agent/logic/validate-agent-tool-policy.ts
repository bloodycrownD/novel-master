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

/**
 * 内置已知名白名单（与 {@link FILE_TOOL_NAMES} 并列）：不依赖 probe 注册。
 *
 * `task` 由 `createSubagentTool` 工厂在 `runAgentTurn` 装配期动态注册，
 * `validateAgentDefinition` 用的 probe（`new ToolRegistry(); registerBuiltinTools(probe)`）
 * 不含 `task`。若不加入白名单，用户配 `tools.allow: ["task"]` 会被
 * `INVALID_TOOL_POLICY` 拒掉（P1-9）。
 */
const BUILTIN_KNOWN_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...FILE_TOOL_NAMES,
  "task",
]);

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
    // 内置白名单优先（task 等不在 probe 里的工具名）：P1-9。
    if (BUILTIN_KNOWN_TOOL_NAMES.has(name)) {
      continue;
    }
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
