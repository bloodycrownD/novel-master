/**
 * Zod schemas for {@link AgentDefinition} JSON/YAML payloads.
 *
 * @module domain/agent/agent-definition.schema
 */

import { z } from "zod";

const textPromptBlockSchema = z
  .object({
    name: z.string().min(1),
    type: z.literal("text"),
    role: z.enum(["system", "user", "assistant"]),
    content: z.string(),
  })
  .strict();

const chatPromptBlockSchema = z
  .object({
    name: z.string().min(1),
    type: z.literal("chat"),
  })
  .strict();

const abstractPromptBlockSchema = z
  .object({
    name: z.string().min(1),
    type: z.literal("abstract"),
    content: z.string(),
  })
  .strict();

const promptBlockSchema = z.union([
  textPromptBlockSchema,
  chatPromptBlockSchema,
  abstractPromptBlockSchema,
]);

/** Root agent definition document schema (strict — rejects legacy `model:`). */
export const agentDefinitionDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1),
    prompts: z
      .object({
        blocks: z.array(promptBlockSchema).min(0),
      })
      .strict(),
    preferredModelId: z.string().min(1).optional(),
    runtime: z.object({ maxSteps: z.number().int().positive().optional() }).strict().optional(),
  })
  .strict();

export type AgentDefinitionDocument = z.infer<typeof agentDefinitionDocumentSchema>;
