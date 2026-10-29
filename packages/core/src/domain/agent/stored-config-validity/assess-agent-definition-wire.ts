/**
 * 智能体配置 wire 有效性判定。
 *
 * @module domain/agent/stored-config-validity/assess-agent-definition-wire
 */

import { agentDefinitionSchema } from "@/domain/agent/model/agent-definition.schema.js";
import type { AgentDefinition } from "@/domain/agent/model/agent-definition.js";
import { normalizeAgentPromptLayoutDomain } from "@/domain/prompt/logic/normalize-agent-prompt-layout.js";
import { decode } from "@/infra/serialization/decode.js";
import type { StoredConfigHealth } from "./types.js";

const REMOVED_FEATURE_KEYWORDS = [
  "prompts.blocks",
  "preferredModelId",
  "prompts.regions",
  "prompts.chat",
  "legacy nested model",
] as const;

/**
 * 将智能体配置 wire 判定为 valid / invalid。
 */
export function assessAgentDefinitionWire(raw: unknown): StoredConfigHealth<AgentDefinition> {
  try {
    const value = decode(raw, agentDefinitionSchema);
    return { status: "valid", value };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "invalid", code: REMOVED_FEATURE_KEYWORDS.some((keyword) => message.includes(keyword)) ? "removed_feature" : "broken_wire", message };
  }
}

/**
 * 从存储读取智能体定义：支持 wire 文档与已解析的领域对象。
 *
 * 项目 `agent_config_json.definition` 与 registry `get()` 返回领域形态
 *（`prompts.persist` 为数组），不可直接走 wire 判定。
 */
export function resolveAgentDefinitionFromStorage(stored: unknown): StoredConfigHealth<AgentDefinition> {
  if (stored != null && typeof stored === "object" && !Array.isArray(stored) && !("schemaVersion" in stored)) {
    const record = stored as AgentDefinition;
    if (typeof record.name === "string" && record.name.trim().length > 0 && record.prompts != null && typeof record.prompts === "object" && !Array.isArray(record.prompts) && Array.isArray(record.prompts.persist) && Array.isArray(record.prompts.dynamic)) {
      return { status: "valid", value: { ...record, prompts: normalizeAgentPromptLayoutDomain(record.prompts) } };
    }
  }
  return assessAgentDefinitionWire(stored);
}
