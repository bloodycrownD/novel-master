/**
 * 智能体配置 wire 有效性判定。
 *
 * @module config-forms/stored-config-validity/assess-agent-definition-wire
 */

import { agentDefinitionSchema } from "@/domain/agent/model/agent-definition.schema.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import { normalizeAgentPromptLayoutDomain } from "@/domain/prompt/logic/normalize-agent-prompt-layout.js";
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

function isAgentDefinitionDomainShape(value: unknown): value is AgentDefinition {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  if ("schemaVersion" in value) {
    return false;
  }
  const record = value as AgentDefinition;
  if (typeof record.name !== "string" || record.name.trim().length === 0) {
    return false;
  }
  const prompts = record.prompts;
  if (prompts == null || typeof prompts !== "object" || Array.isArray(prompts)) {
    return false;
  }
  return (
    Array.isArray(prompts.persist) &&
    Array.isArray(prompts.dynamic)
  );
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

/**
 * 从存储读取智能体定义：支持 wire 文档与已解析的领域对象。
 *
 * 项目 `agent_config_json.definition` 与 registry `get()` 返回领域形态
 *（`prompts.persist` 为数组），不可直接走 wire 判定。
 */
export function resolveAgentDefinitionFromStorage(
  stored: unknown,
): StoredConfigHealth<AgentDefinition> {
  if (isAgentDefinitionDomainShape(stored)) {
    return {
      status: "valid",
      value: {
        ...stored,
        prompts: normalizeAgentPromptLayoutDomain(stored.prompts),
      },
    };
  }
  return assessAgentDefinitionWire(stored);
}
