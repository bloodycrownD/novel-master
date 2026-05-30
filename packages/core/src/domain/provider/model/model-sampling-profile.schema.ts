/**
 * Zod schemas for {@link ModelSamplingProfile} JSON payloads.
 *
 * @module domain/provider/model/model-sampling-profile.schema
 */

import { z } from "zod";
import { modelSamplingParamsSchema } from "./model-sampling-params.schema.js";

export const modelSamplingProfileDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean(),
    params: modelSamplingParamsSchema.optional(),
  })
  .strict();

export type ModelSamplingProfileDocument = z.infer<
  typeof modelSamplingProfileDocumentSchema
>;
