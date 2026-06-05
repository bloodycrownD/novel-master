/**
 * Zod schemas for {@link SavedModelSettings} JSON payloads.
 *
 * @module domain/provider/model/saved-model-settings.schema
 */

import { z } from "zod";
import { modelSamplingParamsSchema } from "./model-sampling-params.schema.js";
import type { SavedModelSettings } from "./saved-model-settings.js";

const savedModelSamplingSettingsSchema = z
  .object({
    enabled: z.boolean(),
    params: modelSamplingParamsSchema.optional(),
  })
  .strict();

export const savedModelSettingsDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    contextWindowTokens: z.number().int().positive(),
    sampling: savedModelSamplingSettingsSchema,
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
    }),
  );
