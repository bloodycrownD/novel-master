/**
 * Zod schemas for regex rule write payloads (Service/CLI inputs).
 *
 * @module domain/regex/regex-rule.schema
 */

import { z } from "zod";

const replaceFields = z.object({
  llmReplace: z.string().nullable().optional(),
  displayReplace: z.string().nullable().optional(),
});

const scopeFields = z.object({
  scopeUser: z.boolean().optional(),
  scopeAssistant: z.boolean().optional(),
});

const depthFields = z.object({
  minDepth: z.number().int().positive(),
  maxDepth: z.number().int().positive(),
});

/** Fields required when creating a regex rule. */
export const createRegexRuleSchema = z
  .object({
    groupId: z.string().min(1),
    ruleId: z.string().min(1),
    name: z.string().min(1),
    pattern: z.string().min(1),
    flags: z.string().optional(),
    enabled: z.boolean().optional(),
    ...replaceFields.shape,
    ...depthFields.shape,
    ...scopeFields.shape,
  })
  .strict();

export type CreateRegexRuleInput = z.infer<typeof createRegexRuleSchema>;

/** Partial patch for rule updates (all fields optional). */
export const updateRegexRuleSchema = z
  .object({
    name: z.string().min(1).optional(),
    pattern: z.string().min(1).optional(),
    flags: z.string().optional(),
    enabled: z.boolean().optional(),
    ...replaceFields.shape,
    minDepth: z.number().int().positive().optional(),
    maxDepth: z.number().int().positive().optional(),
    ...scopeFields.shape,
  })
  .strict();

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
