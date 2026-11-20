/**
 * Agent 定义的 YAML 文本编解码（`SerializationParseText.parse`/`SerializationDecode.decode`
 * 与 `SerializationEncode.encode`/`SerializationStringifyText.stringify` 的单源）。
 *
 * 双端此前各有一份逐字实现（desktop / mobile 的 `agent-yaml.service`），它们只是
 * core 序列化能力的转发；这里收敛后两端只剩对话框编排。
 *
 * @module domain/agent/logic/agent-yaml-codec
 */

import type { AppError } from "@/errors/app-error.js";
import { Result } from "@/errors/either.js";
import { SerializationDecode } from "@/infra/serialization/decode.js";
import { SerializationEncode } from "@/infra/serialization/encode.js";
import { SerializationParseText } from "@/infra/serialization/parse-text.js";
import { SerializationStringifyText } from "@/infra/serialization/stringify-text.js";
import type { AgentDefinition } from "../model/agent-definition.js";
import { agentDefinitionSchema } from "../model/agent-definition.schema.js";

export const AgentYamlCodec = {
  /** YAML 文本 → {@link AgentDefinition}；语法错与 schema 违规沿 `Result.err` 返回。 */
  decode(yaml: string): Result<AgentDefinition, AppError> {
    const parsed = SerializationParseText.parse(yaml, "yaml");
    if (!parsed.ok) return Result.err(parsed.error);
    const decoded = SerializationDecode.decode(parsed.value, agentDefinitionSchema);
    if (!decoded.ok) return Result.err(decoded.error);
    return Result.ok(decoded.value);
  },

  /** {@link AgentDefinition} → YAML 文本。 */
  encode(def: AgentDefinition): string {
    const doc = SerializationEncode.encode(def, agentDefinitionSchema);
    return SerializationStringifyText.stringify(doc, "yaml");
  },
} as const;
