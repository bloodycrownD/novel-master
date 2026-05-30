/**
 * Zod schemas for {@link AgentDefinition} JSON/YAML payloads.
 *
 * @module domain/agent/agent-definition.schema
 */

import { z } from "zod";

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

/** Root agent definition document schema (strict — rejects legacy keys). */
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

export { promptsDocumentSchema, promptBlockValueSchema };
