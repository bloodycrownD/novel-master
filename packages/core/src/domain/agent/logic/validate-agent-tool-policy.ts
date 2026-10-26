/**
 * Validates agent tool allow/deny policy against registered tool names.
 *
 * @module domain/agent/logic/validate-agent-tool-policy
 */

import { FILE_TOOL_NAMES, LEGACY_FILE_TOOL_HINTS, normalizeAgentToolPolicyName } from "@/domain/tool/builtin/vfs-tools.js";
import { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import type { AgentToolPolicy } from "../model/agent-definition.js";

/** 本模块唯一的失败载荷。 */
type AgentToolPolicyError = AppError<"AGENT_INVALID_TOOL_POLICY">;

/**
 * Ensures tool policy is well-formed and references only registered tools.
 *
 * @returns Result.err `AGENT_INVALID_TOOL_POLICY` on mutual exclusion or unknown names.
 */
/** nm-style: keep-public — agent 定义写入门禁的公共校验入口，测试直接锁错误码。 */
export function validateAgentToolPolicy(tools: AgentToolPolicy | undefined, registryNames: ReadonlySet<string>): Result<void, AgentToolPolicyError> {
  if (tools == null) {
    return Result.ok(undefined);
  }
  const allow: unknown = tools.allow;
  const deny: unknown = tools.deny;
  if (allow != null && deny != null) {
    return Result.err(new AppError("AGENT_INVALID_TOOL_POLICY", "tools.allow and tools.deny cannot both be set"));
  }
  for (const [listLabel, names] of [
    ["tools.allow", allow],
    ["tools.deny", deny],
  ] as const) {
    if (names == null) {
      continue;
    }
    if (!Array.isArray(names)) {
      return Result.err(new AppError("AGENT_INVALID_TOOL_POLICY", `${listLabel} must be an array of tool names`));
    }
    for (const raw of names) {
      if (typeof raw !== "string") {
        return Result.err(new AppError("AGENT_INVALID_TOOL_POLICY", `${listLabel} must contain only strings`));
      }
      const name = normalizeAgentToolPolicyName(raw);
      if (registryNames.has(name)) {
        continue;
      }
      const hint = LEGACY_FILE_TOOL_HINTS[name];
      const v2List = FILE_TOOL_NAMES.join(", ");
      const suffix = hint != null ? ` Legacy tool "${raw}" was removed; use ${hint} instead. V2 tools: ${v2List}.` : ` Known V2 tools: ${v2List}.`;
      return Result.err(new AppError("AGENT_INVALID_TOOL_POLICY", `${listLabel} references unknown tool: ${raw}.${suffix}`));
    }
  }
  return Result.ok(undefined);
}
