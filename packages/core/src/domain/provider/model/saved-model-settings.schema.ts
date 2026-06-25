/**
 * {@link SavedModelSettings} JSON 文档的 Zod schema（v1 读兼容 + v2 canonical）。
 *
 * @module domain/provider/model/saved-model-settings.schema
 */

import { z } from "zod";
import {
  isValidTokenCounterModePref,
  parseTokenCounterModePref,
} from "@/infra/tokenizer/logic/read-token-counter-mode-pref.js";
import { modelSamplingParamsSchema } from "./model-sampling-params.schema.js";
import { modelThinkingParamsSchema } from "./model-thinking-params.schema.js";
import type { SavedModelSettings } from "./saved-model-settings.js";

const savedModelSamplingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    params: modelSamplingParamsSchema.optional(),
  })
  .strict();

export const savedModelThinkingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    params: modelThinkingParamsSchema.optional(),
  })
  .strict();

const tokenCounterModeSchema = z
  .string()
  .default("auto")
  .refine(isValidTokenCounterModePref, { message: "Invalid tokenCounterMode" })
  .transform((raw) => parseTokenCounterModePref(raw));

const savedModelInternalSettingsSchema = z
  .object({
    contextWindowTokens: z.number().int().positive(),
    tokenCounterMode: tokenCounterModeSchema,
  })
  .strict();

const savedModelGenerationSettingsSchema = z
  .object({
    sampling: savedModelSamplingSettingsSchema,
    thinking: savedModelThinkingSettingsSchema.default({ enabled: false }),
  })
  .strict();

/** v2 canonical 文档形态（写盘输出）。 */
export const savedModelSettingsV2DocumentSchema = z
  .object({
    schemaVersion: z.literal(2),
    internal: savedModelInternalSettingsSchema,
    generation: savedModelGenerationSettingsSchema,
  })
  .strict();

export type SavedModelSettingsDocument = z.infer<
  typeof savedModelSettingsV2DocumentSchema
>;

/** v1 扁平文档 → v2 内存形态。 */
const savedModelSettingsV1DocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    contextWindowTokens: z.number().int().positive(),
    sampling: savedModelSamplingSettingsSchema,
    tokenCounterMode: tokenCounterModeSchema,
  })
  .strict()
  .transform(
    (doc): SavedModelSettings => ({
      schemaVersion: 2,
      internal: {
        contextWindowTokens: doc.contextWindowTokens,
        tokenCounterMode: doc.tokenCounterMode,
      },
      generation: {
        sampling: doc.sampling,
        thinking: { enabled: false },
      },
    }),
  );

const savedModelSettingsV2ToMemorySchema = savedModelSettingsV2DocumentSchema.transform(
  (doc): SavedModelSettings => ({
    schemaVersion: 2,
    internal: doc.internal,
    generation: doc.generation,
  }),
);

/** 读盘：接受 v1 或 v2 文档，输出 v2 内存形态。 */
export const savedModelSettingsSchema = z.union([
  savedModelSettingsV1DocumentSchema,
  savedModelSettingsV2ToMemorySchema,
]);

/** @deprecated 使用 {@link savedModelSettingsSchema}；保留别名供旧引用。 */
export const savedModelSettingsDocumentSchema = savedModelSettingsSchema;
