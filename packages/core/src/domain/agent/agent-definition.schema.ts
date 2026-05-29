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

const openAiSamplingSchema = z
  .object({
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    max_tokens: z.number().int().positive().optional(),
  })
  .strict();

const anthropicSamplingSchema = z
  .object({
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    top_k: z.number().int().positive().optional(),
    max_tokens: z.number().int().positive().optional(),
  })
  .strict();

const geminiSamplingSchema = z
  .object({
    temperature: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().int().positive().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict();

const modelSamplingParamsSchema = z.discriminatedUnion("protocol", [
  z.object({ protocol: z.literal("openai"), openai: openAiSamplingSchema }).strict(),
  z
    .object({ protocol: z.literal("anthropic"), anthropic: anthropicSamplingSchema })
    .strict(),
  z.object({ protocol: z.literal("gemini"), gemini: geminiSamplingSchema }).strict(),
]);

const compactionTriggerSchema = z
  .object({
    tokenThreshold: z.number().int().positive().optional(),
    floorThreshold: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (t) => t.tokenThreshold != null || t.floorThreshold != null,
    "compact.trigger requires at least one of tokenThreshold or floorThreshold",
  );

const compactionAbstractSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), content: z.string() }).strict(),
  z
    .object({
      type: z.literal("agent"),
      instruction: z.string().optional(),
    })
    .strict(),
]);

const compactionActionSchema = z
  .object({
    keepLastN: z.number().int().positive(),
    abstract: compactionAbstractSchema,
  })
  .strict();

const compactConfigSchema = z
  .object({
    trigger: compactionTriggerSchema,
    action: compactionActionSchema,
  })
  .strict();

/** Root agent definition document schema. */
export const agentDefinitionDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().min(1),
    prompts: z
      .object({
        blocks: z.array(promptBlockSchema).min(0),
      })
      .strict(),
    model: z
      .object({
        applicationModelId: z.string().min(1),
        params: modelSamplingParamsSchema.optional(),
      })
      .strict(),
    compact: compactConfigSchema.optional(),
    runtime: z.object({ maxSteps: z.number().int().positive().optional() }).strict().optional(),
  })
  .strict();

export type AgentDefinitionDocument = z.infer<typeof agentDefinitionDocumentSchema>;
