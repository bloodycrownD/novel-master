/**
 * Tool registry — LLM tool definitions.
 *
 * @module infra/llm-protocol/logic/tool-definitions
 */

import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { LlmToolDefinition } from "../ports/adapter.port.js";
import { SerializationZodToJsonSchema } from "@/common/serialization/zod-to-json-schema.js";

export const ToolDefinitions = {
    /**
   * &#25226; registry &#37324;&#25152;&#26377;&#24037;&#20855;&#26144;&#23556;&#25104; LLM &#20391;&#23450;&#20041;&#12290;
   *
   * &#35013;&#37197;&#26399;&#35843;&#29992;&#65306;&#27599;&#20010;&#24037;&#20855;&#30340; `description` &#26159; `(ctx) => string` &#20989;&#25968;&#65292;
   * &#36825;&#37324;&#25226; ctx &#20256;&#36827;&#21435;&#27714;&#20540;&#25104;&#26368;&#32456;&#23383;&#31526;&#20018;&#12290;
   */
    fromRegistry<Ctx>(registry: ToolRegistry<Ctx>, ctx: Ctx): LlmToolDefinition[] {
        return registry.list().map((name) => {
            const tool = registry.get(name)!;
            // 自带工具：zod inputSchema 转 JSON Schema；外部工具（判别式 `"inputSchema" in tool`）：
            // 声明就是现成 JSON Schema，原样透出、不经 zod（转不了也不回退，见 ExternalTool 注释）。
            const inputSchema = "inputSchema" in tool ? SerializationZodToJsonSchema.toJsonSchema(tool.inputSchema) : {...tool.inputJsonSchema};
            return {
                name: tool.name,
                description: tool.description(ctx),
                inputSchema,
            };
        });
    },
} as const;
