/**
 * {@link ModelThinkingParams} 的 Zod schema。
 *
 * @module domain/provider/model/model-thinking-params.schema
 */

import { z } from "zod";

const anthropicThinkingSchema = z
  .object({
    type: z.literal("enabled"),
    budget_tokens: z.number().int().positive(),
  })
  .strict();

const openAiThinkingSchema = z
  .object({
    reasoning_effort: z.enum(["low", "medium", "high"]),
  })
  .strict();

const geminiThinkingConfigSchema = z
  .object({
    thinkingBudget: z.number().int().optional(),
    thinkingLevel: z.string().optional(),
  })
  .strict();

const geminiThinkingSchema = z
  .object({
    thinkingConfig: geminiThinkingConfigSchema,
  })
  .strict();

/** 已保存模型思考参数文档的 discriminated union。 */
export const modelThinkingParamsSchema = z.discriminatedUnion("protocol", [
  z
    .object({ protocol: z.literal("anthropic"), anthropic: anthropicThinkingSchema })
    .strict(),
  z.object({ protocol: z.literal("openai"), openai: openAiThinkingSchema }).strict(),
  z.object({ protocol: z.literal("gemini"), gemini: geminiThinkingSchema }).strict(),
]);
