/**
 * Zod schema for compaction conditions wire document (v4).
 *
 * v3 文档由 store 的 {@link migrateV3ToV4} 迁移后再交给本 schema；
 * `hideStartDepth` 缺省时在 transform 阶段补默认值。
 *
 * @module domain/compaction-conditions/model/compaction-conditions.schema
 */

import { z } from "zod";
import type { CompactionConditions } from "./compaction-conditions.js";

const compactionConditionsDocumentSchema = z
  .object({
    schemaVersion: z.literal(4),
    enabled: z.boolean(),
    tokenRatio: z.number().positive().max(1).optional(),
    visibleFloor: z.number().int().nonnegative().optional(),
    "visible-floor": z.number().int().nonnegative().optional(),
    hideStartDepth: z.number().int().nonnegative().optional(),
    "hide-start-depth": z.number().int().nonnegative().optional(),
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
  compactionConditionsDocumentSchema.transform((doc): CompactionConditions => {
    const hideStartDepth = doc.hideStartDepth ?? doc["hide-start-depth"];
    return {
      schemaVersion: 4,
      enabled: doc.enabled,
      tokenRatio: doc.tokenRatio,
      visibleFloor: doc.visibleFloor ?? doc["visible-floor"],
      ...(hideStartDepth != null ? { hideStartDepth } : {}),
    };
  });

export { DEFAULT_HIDE_START_DEPTH } from "./compaction-conditions.js";
