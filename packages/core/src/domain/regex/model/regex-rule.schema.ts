/**
 * Zod schemas for regex rule write payloads (Service/CLI inputs).
 *
 * @module domain/regex/model/regex-rule.schema
 */

import { z } from "zod";
import { depthSliceFromWire, validateDepthSlice } from "@/domain/depth/logic/depth-slice.js";

const replaceFields = z.object({
  llmReplace: z.string().nullable().optional(),
  displayReplace: z.string().nullable().optional(),
});

const scopeFields = z.object({
  scopeUser: z.boolean().optional(),
  scopeAssistant: z.boolean().optional(),
});

const depthInputSchema = z
  .object({
    startDepth: z.number().int().nonnegative().optional(),
    endDepth: z.number().int().nonnegative().optional(),
    "start-depth": z.number().int().nonnegative().optional(),
    "end-depth": z.number().int().nonnegative().optional(),
  })
  .strict();

/** 将 wire 深度字段规范为 camelCase 数值（create/update 共享）。 */
export function normalizeDepthFields(raw: Record<string, unknown>): {
  startDepth: number | null;
  endDepth: number | null;
} {
  if ("minDepth" in raw || "maxDepth" in raw) {
    throw new Error("minDepth/maxDepth are removed; use startDepth/endDepth");
  }
  const slice = depthSliceFromWire(raw);
  validateDepthSlice(slice);
  return {
    startDepth: slice.startDepth ?? null,
    endDepth: slice.endDepth ?? null,
  };
}

function hasDepthWireKey(raw: Record<string, unknown>, bound: "start" | "end"): boolean {
  if (bound === "start") {
    return "startDepth" in raw || "start-depth" in raw;
  }
  return "endDepth" in raw || "end-depth" in raw;
}

const updateRuleBaseSchema = z
  .object({
    name: z.string().min(1).optional(),
    pattern: z.string().min(1).optional(),
    flags: z.string().optional(),
    enabled: z.boolean().optional(),
    ...replaceFields.shape,
    ...depthInputSchema.shape,
    ...scopeFields.shape,
  })
  .strict();

const createRuleBaseSchema = z
  .object({
    groupId: z.string().min(1),
    ruleId: z.string().min(1),
    name: z.string().min(1),
    pattern: z.string().min(1),
    flags: z.string().optional(),
    enabled: z.boolean().optional(),
    ...replaceFields.shape,
    ...depthInputSchema.shape,
    ...scopeFields.shape,
  })
  .strict();

/** Fields required when creating a regex rule. */
export const createRegexRuleSchema = createRuleBaseSchema.transform((raw) => {
  const depth = normalizeDepthFields(raw as Record<string, unknown>);
  return {
    groupId: raw.groupId,
    ruleId: raw.ruleId,
    name: raw.name,
    pattern: raw.pattern,
    flags: raw.flags,
    enabled: raw.enabled,
    llmReplace: raw.llmReplace,
    displayReplace: raw.displayReplace,
    scopeUser: raw.scopeUser,
    scopeAssistant: raw.scopeAssistant,
    startDepth: depth.startDepth,
    endDepth: depth.endDepth,
  };
});

export type CreateRegexRuleInput = z.infer<typeof createRegexRuleSchema>;

/** Partial patch for rule updates (all fields optional). */
export const updateRegexRuleSchema = updateRuleBaseSchema
  .superRefine((raw, ctx) => {
    if ("minDepth" in raw || "maxDepth" in raw) {
      ctx.addIssue({
        code: "custom",
        message: "minDepth/maxDepth are removed; use startDepth/endDepth",
      });
    }
  })
  .transform((raw): UpdateRegexRuleOutput => {
    const record = raw as Record<string, unknown>;
    const hasStart = hasDepthWireKey(record, "start");
    const hasEnd = hasDepthWireKey(record, "end");
    const result: UpdateRegexRuleOutput = {
      name: raw.name,
      pattern: raw.pattern,
      flags: raw.flags,
      enabled: raw.enabled,
      llmReplace: raw.llmReplace,
      displayReplace: raw.displayReplace,
      scopeUser: raw.scopeUser,
      scopeAssistant: raw.scopeAssistant,
    };
    if (hasStart || hasEnd) {
      const depth = normalizeDepthFields(record);
      if (hasStart) {
        result.startDepth = depth.startDepth;
      }
      if (hasEnd) {
        result.endDepth = depth.endDepth;
      }
    }
    return result;
  });

/** update 解析后的 camelCase 深度字段（不含 kebab wire 键）。 */
export type UpdateRegexRuleOutput = {
  name?: string;
  pattern?: string;
  flags?: string;
  enabled?: boolean;
  llmReplace?: string | null;
  displayReplace?: string | null;
  scopeUser?: boolean;
  scopeAssistant?: boolean;
  startDepth?: number | null;
  endDepth?: number | null;
};

export type UpdateRegexRuleInput = z.infer<typeof updateRegexRuleSchema>;

/** Regex group create payload. */
export const createRegexGroupSchema = z
  .object({
    groupId: z.string().min(1),
    displayName: z.string().nullable().optional(),
  })
  .strict();

export type CreateRegexGroupInput = z.infer<typeof createRegexGroupSchema>;

/** Regex group update payload. */
export const updateRegexGroupSchema = z
  .object({
    displayName: z.string().nullable().optional(),
  })
  .strict();

export type UpdateRegexGroupInput = z.infer<typeof updateRegexGroupSchema>;
