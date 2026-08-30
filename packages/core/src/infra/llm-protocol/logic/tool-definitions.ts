/**
 * Tool registry �?LLM tool definitions.
 *
 * @module infra/llm-protocol/logic/tool-definitions
 */

import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { LlmToolDefinition } from "../ports/adapter.port.js";
import { zodToJsonSchema } from "@/infra/serialization/zod-to-json-schema.js";

/**
 * &#25226; registry &#37324;&#25152;&#26377;&#24037;&#20855;&#26144;&#23556;&#25104; LLM &#20391;&#23450;&#20041;&#12290;
 *
 * &#35013;&#37197;&#26399;&#35843;&#29992;&#65306;&#27599;&#20010;&#24037;&#20855;&#30340; `description` &#26159; `(ctx) => string` &#20989;&#25968;&#65292;
 * &#36825;&#37324;&#25226; ctx &#20256;&#36827;&#21435;&#27714;&#20540;&#25104;&#26368;&#32456;&#23383;&#31526;&#20018;&#12290;
 */
export function toolsFromRegistry<Ctx>(
  registry: ToolRegistry<Ctx>,
  ctx: Ctx
): LlmToolDefinition[] {
  return registry.list().map((name) => {
    const tool = registry.get(name)!;
    return {
      name: tool.name,
      description: tool.description(ctx),
      inputSchema: zodToJsonSchema(tool.inputSchema),
    };
  });
}
