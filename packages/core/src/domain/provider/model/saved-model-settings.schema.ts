/**
 * Zod schemas for {@link SavedModelSettings} JSON payloads.
 *
 * @module domain/provider/model/saved-model-settings.schema
 */

import { z } from "zod";
import { isValidTokenCounterModePref } from "@/infra/tokenizer/logic/read-token-counter-mode-pref.js";
import { modelSamplingParamsSchema } from "./model-sampling-params.schema.js";
import type { SavedModelSettings } from "./saved-model-settings.js";

const savedModelSamplingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    params: modelSamplingParamsSchema.optional(),
  })
  .strict();

// Missing key in legacy JSON → default "auto" (per-model token counter mode).
const tokenCounterModeSchema = z
  .string()
  .default("auto")
  .refine(isValidTokenCounterModePref, { message: "Invalid tokenCounterMode" });

export const savedModelSettingsDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    contextWindowTokens: z.number().int().positive(),
    sampling: savedModelSamplingSettingsSchema,
    tokenCounterMode: tokenCounterModeSchema,
  })
  .strict();

export type SavedModelSettingsDocument = z.infer<
  typeof savedModelSettingsDocumentSchema
>;

export const savedModelSettingsSchema =
  savedModelSettingsDocumentSchema.transform(
    (doc): SavedModelSettings => ({
      schemaVersion: 1,
      contextWindowTokens: doc.contextWindowTokens,
      sampling: doc.sampling,
      tokenCounterMode: doc.tokenCounterMode,
    }),
  );
