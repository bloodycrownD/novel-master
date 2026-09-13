/**
 * Zod schemas for smart sort rule write payloads (Service/CLI inputs).
 *
 * @module domain/smart-sort-rule/model/smart-sort-rule.schema
 */

import { z } from "zod";
import { SmartSortRuleError } from "@/errors/smart-sort-rule-errors.js";
import {
  SMART_SORT_CAPTURE_KINDS,
  type SmartSortCaptureKind,
} from "./smart-sort-rule.js";

/**
 * captureKind 三档枚举（D13）：值域单源 SMART_SORT_CAPTURE_KINDS。
 * fixed 档不禁止捕获组共存（语义：固定元组优先、捕获组被忽略）。
 */
const captureKindSchema = z.enum(
  SMART_SORT_CAPTURE_KINDS as [SmartSortCaptureKind, ...SmartSortCaptureKind[]]
);

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
 * flags 合法性纯谓词（C-4 单源）：仅 g/i/m/s/u/y 字符、不重复，非 throw。
 * schema 校验（{@link assertFlagsValid}）与 logic 层（parse-pattern-input
 * 等）共用本谓词，勿另写平行实现。
 */
export function isFlagsValid(flags: string): boolean {
  return flagsSchema.safeParse(flags).success;
}

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
  if (isFlagsValid(flags)) {
    return;
  }
  // 冷路径（仅非法 flags 触发）：判定已由 isFlagsValid 单源给出，此处
  // 重跑一次 safeParse 仅为取 zod issue 文案（保持既有错误消息不变）。
  const checked = flagsSchema.safeParse(flags);
  const issue = checked.success ? undefined : checked.error.issues[0]?.message;
  throw new SmartSortRuleError(
    "INVALID_ARGUMENT",
    `Invalid flags '${flags}': ${issue ?? "invalid"}`,
    detail
  );
}

/** Create payload: name/pattern 必填，flags 缺省 ''，description 可选。 */
export const createSmartSortRuleSchema = z
  .object({
    name: z.string().min(1),
    pattern: z.string().min(1),
    flags: z.string().optional(),
    captureKind: captureKindSchema.optional(),
    description: z.string().nullable().optional(),
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
    captureKind: captureKindSchema.optional(),
    description: z.string().nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export type UpdateSmartSortRuleInput = z.infer<typeof updateSmartSortRuleSchema>;

/** create 解析结果（flags 已缺省 ''，description 已归一 string | null）。 */
export interface CreateSmartSortRuleFields {
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  readonly captureKind: SmartSortCaptureKind;
  readonly description: string | null;
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
    captureKind: parsed.captureKind ?? "smart",
    description: parsed.description ?? null,
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
