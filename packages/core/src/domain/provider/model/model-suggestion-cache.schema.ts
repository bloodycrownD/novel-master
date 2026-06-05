/**
 * Zod schema for {@link ModelSuggestionCache} wire documents.
 *
 * @module domain/provider/model/model-suggestion-cache.schema
 */

import { z } from "zod";
import type { ModelSuggestionCache } from "./model-suggestion-cache.js";

const modelSuggestionEntrySchema = z
  .object({
    vendorModelId: z.string().min(1),
    displayName: z.string().nullable(),
    stale: z.boolean(),
    lastSeenAtMs: z.number().int().nonnegative(),
  })
  .strict();

export const modelSuggestionCacheDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    models: z.array(modelSuggestionEntrySchema),
  })
  .strict();

export const modelSuggestionCacheSchema =
  modelSuggestionCacheDocumentSchema.transform(
    (doc): ModelSuggestionCache => ({
      schemaVersion: 1,
      models: doc.models,
    }),
  );
