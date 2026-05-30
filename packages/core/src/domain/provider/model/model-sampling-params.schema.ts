/**
 * Zod schemas for {@link ModelSamplingParams}.
 *
 * @module domain/provider/model/model-sampling-params.schema
 */

import { z } from "zod";

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

/** Discriminated union for model sampling params in profile documents. */
export const modelSamplingParamsSchema = z.discriminatedUnion("protocol", [
  z.object({ protocol: z.literal("openai"), openai: openAiSamplingSchema }).strict(),
  z
    .object({ protocol: z.literal("anthropic"), anthropic: anthropicSamplingSchema })
    .strict(),
  z.object({ protocol: z.literal("gemini"), gemini: geminiSamplingSchema }).strict(),
]);
