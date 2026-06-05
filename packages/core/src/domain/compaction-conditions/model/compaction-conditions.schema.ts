/**
 * Zod schema for compaction conditions wire document (v3 only).
 *
 * @module domain/compaction-conditions/model/compaction-conditions.schema
 */

import { z } from "zod";
import type { CompactionConditions } from "./compaction-conditions.js";

const compactionConditionsDocumentSchema = z
  .object({
    schemaVersion: z.literal(3),
    enabled: z.boolean(),
    tokenRatio: z.number().positive().max(1).optional(),
    visibleFloor: z.number().int().nonnegative().optional(),
    "visible-floor": z.number().int().nonnegative().optional(),
  })
  .strict()
  .superRefine((doc, ctx) => {
    if (!doc.enabled) {
      return;
    }
    const hasRatio = doc.tokenRatio != null;
    const floor = doc.visibleFloor ?? doc["visible-floor"];
    const hasFloor = floor != null;
    if (!hasRatio && !hasFloor) {
      ctx.addIssue({
        code: "custom",
        message:
          "when enabled, at least one of tokenRatio or visible-floor is required",
      });
    }
  });

export const compactionConditionsSchema =
  compactionConditionsDocumentSchema.transform((doc): CompactionConditions => ({
    schemaVersion: 3,
    enabled: doc.enabled,
    tokenRatio: doc.tokenRatio,
    visibleFloor: doc.visibleFloor ?? doc["visible-floor"],
  }));
