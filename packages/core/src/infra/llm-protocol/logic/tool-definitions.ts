/**
 * Tool registry â†?LLM tool definitions.
 *
 * @module infra/llm-protocol/logic/tool-definitions
 */

import type { ToolRegistry } from "@/domain/tool/logic/tool-registry.js";
import type { LlmToolDefinition } from "../ports/adapter.port.js";
import { zodToJsonSchema } from "./zod-to-json-schema.js";

/** Maps all tools in a registry to LLM-facing definitions. */
export function toolsFromRegistry<Ctx>(
  registry: ToolRegistry<Ctx>,
): LlmToolDefinition[] {
  return registry.list().map((name) => {
    const tool = registry.get(name)!;
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema),
    };
  });
}
