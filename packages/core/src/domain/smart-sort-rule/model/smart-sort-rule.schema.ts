/**
 * Zod schemas for smart sort rule write payloads (Service/CLI inputs).
 *
 * @module domain/smart-sort-rule/model/smart-sort-rule.schema
 */

import { z } from "zod";
import { SmartSortRuleError } from "@/errors/smart-sort-rule-errors.js";

/**
 * flags 字段共享校验：仅 g/i/m/s/u/y 字符、不重复（与表 CHECK
 * `flags NOT GLOB '*[^gimsuy]*'` 口径一致，重复约束超出 SQL 能力、由应用层守）。
 */
const flagsSchema = z
  .string()
  .regex(/^[gimsuy]*$/, "flags may only contain characters g/i/m/s/u/y")
  .refine((s) => new Set(s).size === s.length, {
    message: "flags must not repeat characters",
  });

/**
 * flags 合法性单源校验（C-1：schema 层与 logic 层共用，勿另写平行实现）。
 *
 * @param flags - 待检 flags 字符串
 * @param detail - 错误 detail（如 { ruleId }），缺省不携带
 * @throws {SmartSortRuleError} INVALID_ARGUMENT（非 gimsuy 字符或重复）
 */
export function assertFlagsValid(
  flags: string,
  detail?: { ruleId?: string }
): void {
  const checked = flagsSchema.safeParse(flags);
  if (!checked.success) {
    throw new SmartSortRuleError(
      "INVALID_ARGUMENT",
      `Invalid flags '${flags}': ${checked.error.issues[0]?.message ?? "invalid"}`,
      detail
    );
  }
}

/** Create payload: name/pattern 必填，flags 缺省 ''，example 可选。 */
export const createSmartSortRuleSchema = z
  .object({
    name: z.string().min(1),
    pattern: z.string().min(1),
    flags: z.string().optional(),
    example: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export type CreateSmartSortRuleInput = z.infer<typeof createSmartSortRuleSchema>;

/** Partial patch for rule updates (all fields optional). */
export const updateSmartSortRuleSchema = z
  .object({
    name: z.string().min(1).optional(),
    pattern: z.string().min(1).optional(),
    flags: z.string().optional(),
    example: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export type UpdateSmartSortRuleInput = z.infer<typeof updateSmartSortRuleSchema>;

/** create 解析结果（flags 已缺省 ''，example 已归一 string | null）。 */
export interface CreateSmartSortRuleFields {
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly example: string | null;
  readonly enabled: boolean;
}

/** Parses create payload; applies flags default + syntax check (throws on bad flags). */
export function parseCreateSmartSortRuleInput(
  raw: unknown
): CreateSmartSortRuleFields {
  const parsed = createSmartSortRuleSchema.parse(raw);
  const flags = parsed.flags ?? "";
  assertFlagsValid(flags);
  return {
    name: parsed.name,
    pattern: parsed.pattern,
    flags,
    example: parsed.example ?? null,
    enabled: parsed.enabled ?? true,
  };
}

/** Parses update payload; validates flags syntax when present (throws on bad flags). */
export function parseUpdateSmartSortRuleInput(
  raw: unknown
): UpdateSmartSortRuleInput {
  const parsed = updateSmartSortRuleSchema.parse(raw);
  if (parsed.flags !== undefined) {
    assertFlagsValid(parsed.flags);
  }
  return parsed;
}
