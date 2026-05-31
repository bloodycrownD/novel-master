/**
 * Zod schemas for {@link AgentDefinition} JSON/YAML payloads.
 *
 * @module domain/agent/agent-definition.schema
 */

import { z } from "zod";
import { AgentConfigError } from "@/errors/agent-config-errors.js";
import { validatePromptBlocksFromMap } from "@/domain/prompt/logic/validate-prompt-blocks.js";
import type { PromptBlock } from "@/domain/prompt/model/prompt-block.js";
import type { AgentDefinition } from "./agent-definition.js";

const textPromptBlockValueSchema = z
  .object({
    type: z.literal("text"),
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
  })
  .strict();

const chatPromptBlockValueSchema = z
  .object({
    type: z.literal("chat"),
  })
  .strict();

const abstractPromptBlockValueSchema = z
  .object({
    type: z.literal("abstract"),
    content: z.string(),
  })
  .strict();

const promptBlockValueSchema = z.union([
  textPromptBlockValueSchema,
  chatPromptBlockValueSchema,
  abstractPromptBlockValueSchema,
]);

const promptsDocumentSchema = z
  .object({
    blocks: z.record(z.string().min(1), promptBlockValueSchema),
  })
  .strict();

/** Root agent definition wire document schema (strict â€?rejects legacy keys). */
export const agentDefinitionDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1),
    prompts: promptsDocumentSchema,
    model: z.string().min(1).optional(),
    runtime: z.object({ maxSteps: z.number().int().positive().optional() }).strict().optional(),
  })
  .strict();

export type AgentDefinitionDocument = z.infer<typeof agentDefinitionDocumentSchema>;

function assertNoLegacyAgentFields(raw: unknown): void {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return;
  }
  const record = raw as Record<string, unknown>;
  if ("preferredModelId" in record) {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      "preferredModelId is removed; use optional model: <applicationModelId>",
    );
  }
  const model = record.model;
  if (model != null && typeof model === "object" && !Array.isArray(model)) {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      "legacy nested model block is not supported",
    );
  }
}

function blockToMapValue(
  block: PromptBlock,
): AgentDefinitionDocument["prompts"]["blocks"][string] {
  if (block.type === "text") {
    return {
      type: "text",
      role: block.role,
      content: block.content,
    };
  }
  if (block.type === "abstract") {
    return { type: "abstract", content: block.content };
  }
  return { type: "chat" };
}

function documentToDefinition(doc: AgentDefinitionDocument): AgentDefinition {
  const blocks = validatePromptBlocksFromMap(doc.prompts.blocks);
  return {
    name: doc.name,
    prompts: blocks,
    model: doc.model,
    runtime: doc.runtime,
  };
}

function definitionToDocument(def: AgentDefinition): AgentDefinitionDocument {
  const blocks: AgentDefinitionDocument["prompts"]["blocks"] = {};
  for (const block of def.prompts) {
    blocks[block.name] = blockToMapValue(block);
  }
  return {
    schemaVersion: 1,
    name: def.name,
    prompts: { blocks },
    ...(def.model != null ? { model: def.model } : {}),
    ...(def.runtime != null ? { runtime: def.runtime } : {}),
  };
}

const agentDefinitionWireSchema = z.preprocess((raw) => {
  assertNoLegacyAgentFields(raw);
  return raw;
}, agentDefinitionDocumentSchema);

/** Domain parser: wire document â†?{@link AgentDefinition}. */
export const agentDefinitionSchema = Object.assign(
  agentDefinitionWireSchema.transform(documentToDefinition),
  { encode: definitionToDocument },
);

export { promptsDocumentSchema, promptBlockValueSchema };
