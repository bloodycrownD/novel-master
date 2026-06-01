/**
 * Zod schema for compaction conditions wire document.
 *
 * @module domain/compaction-conditions/model/compaction-conditions.schema
 */

import { z } from "zod";
import type { CompactionConditions } from "./compaction-conditions.js";

const compactionConditionsDocumentSchema = z
  .object({
    schemaVersion: z.literal(2),
    enabled: z.boolean(),
    tokenThreshold: z.number().optional(),
    tokenRatio: z.number().positive().max(1).optional(),
    visibleFloor: z.number().int().nonnegative().optional(),
    "visible-floor": z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (!doc.enabled) {
      return;
    }
    const hasToken = doc.tokenThreshold != null;
    const floor = doc.visibleFloor ?? doc["visible-floor"];
    const hasFloor = floor != null;
    if (!hasToken && !hasFloor) {
      ctx.addIssue({
        code: "custom",
        message:
          "when enabled, at least one of tokenThreshold or visible-floor is required",
      });
    }
  });

export const compactionConditionsSchema =
  compactionConditionsDocumentSchema.transform((doc): CompactionConditions => ({
    schemaVersion: doc.schemaVersion,
    enabled: doc.enabled,
    tokenThreshold: doc.tokenThreshold,
    tokenRatio: doc.tokenRatio,
    visibleFloor: doc.visibleFloor ?? doc["visible-floor"],
  }));
