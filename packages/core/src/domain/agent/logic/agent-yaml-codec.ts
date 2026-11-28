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
import { SerializationDecode } from "@/common/serialization/decode.js";
import { SerializationEncode } from "@/common/serialization/encode.js";
import { SerializationParseText } from "@/common/serialization/parse-text.js";
import { SerializationStringifyText } from "@/common/serialization/stringify-text.js";
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

    /**
     * {@link AgentDefinition} → YAML 文本；toWire 门禁失败（块名重名等）沿 `Result.err` 返回。
     * 只有 toWire 成功的文档才会被序列化——不能把 Result 信封本身写进文件（那样导出的文件再导入必失败）。
     */
    encode(def: AgentDefinition): Result<string, AppError> {
        const doc = SerializationEncode.encode(def, agentDefinitionSchema);
        if (!doc.ok) return Result.err(doc.error);
        return Result.ok(SerializationStringifyText.stringify(doc.value, "yaml"));
    },
} as const;
