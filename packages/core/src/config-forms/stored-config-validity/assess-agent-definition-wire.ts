/**
 * 智能体配置 wire 有效性判定。
 *
 * @module config-forms/stored-config-validity/assess-agent-definition-wire
 */

import { agentDefinitionSchema } from "@/domain/agent/model/agent-definition.schema.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import { AgentConfigError } from "@/errors/agent-config-errors.js";
import { decode } from "@/infra/serialization/decode.js";
import type { StoredConfigHealth, StoredConfigInvalidCode } from "./types.js";

const REMOVED_FEATURE_KEYWORDS = [
  "prompts.blocks",
  "preferredModelId",
  "prompts.regions",
  "prompts.chat",
  "legacy nested model",
] as const;

function isRemovedFeatureError(error: unknown): boolean {
  if (error instanceof AgentConfigError && error.code === "INVALID_SCHEMA") {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error);
  return REMOVED_FEATURE_KEYWORDS.some((keyword) => message.includes(keyword));
}

/**
 * 将智能体配置 wire 判定为 valid / invalid。
 */
export function assessAgentDefinitionWire(
  raw: unknown,
): StoredConfigHealth<AgentDefinition> {
  try {
    const value = decode(raw, agentDefinitionSchema);
    return { status: "valid", value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code: StoredConfigInvalidCode = isRemovedFeatureError(error)
      ? "removed_feature"
      : "broken_wire";
    return { status: "invalid", code, message };
  }
}
