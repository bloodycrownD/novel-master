/**
 * Smart sort rule YAML bundle document: single source shared by CLI /
 * desktop / mobile import-export (spec D10).
 *
 * The document is the exchange unit (`schemaVersion` + ordered `rules` list);
 * text (de)serialization stays with the callers via
 * `@/infra/serialization` `parseText`/`stringifyText`.
 *
 * @module domain/smart-sort-rule/model/smart-sort-rule-io
 */

import { z } from "zod";
import { decode } from "@/infra/serialization/decode.js";
import type { SmartSortRule } from "./smart-sort-rule.js";

/** Current bundle document schema version. */
export const SMART_SORT_RULE_BUNDLE_SCHEMA_VERSION = 1;

/** Bundle 内单条规则（example 缺省 null；sortOrder 即导出时的优先级顺序）。 */
const bundleRuleSchema = z
  .object({
    ruleId: z.string().min(1),
    name: z.string().min(1),
    pattern: z.string().min(1),
    flags: z.string(),
    example: z.string().nullable().optional(),
    enabled: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();

export type SmartSortRuleBundleRule = z.infer<typeof bundleRuleSchema>;

/** Root bundle document（替换式导入导出，spec D10）。 */
export const smartSortRuleBundleDocumentSchema = z
  .object({
    schemaVersion: z.literal(SMART_SORT_RULE_BUNDLE_SCHEMA_VERSION),
    rules: z.array(bundleRuleSchema),
  })
  .strict();

export type SmartSortRuleBundleDocument = z.infer<
  typeof smartSortRuleBundleDocumentSchema
>;

/** Domain rules → bundle document（全量、按 sortOrder；example null 省略）。 */
export function encodeSmartSortRuleBundle(
  rules: readonly SmartSortRule[]
): SmartSortRuleBundleDocument {
  return {
    schemaVersion: SMART_SORT_RULE_BUNDLE_SCHEMA_VERSION,
    rules: rules.map((rule) => ({
      ruleId: rule.ruleId,
      name: rule.name,
      pattern: rule.pattern,
      flags: rule.flags,
      ...(rule.example != null ? { example: rule.example } : {}),
      enabled: rule.enabled,
      sortOrder: rule.sortOrder,
    })),
  };
}

/** Parses + validates an unknown payload as a bundle document. */
export function decodeSmartSortRuleBundle(
  raw: unknown
): SmartSortRuleBundleDocument {
  return decode(raw, smartSortRuleBundleDocumentSchema);
}

/** Bundle rules → domain entities（时间戳由导入方重新分配）。 */
export function bundleRulesToEntities(
  doc: SmartSortRuleBundleDocument,
  nowMs: number
): SmartSortRule[] {
  return doc.rules.map((rule, index) => ({
    ruleId: rule.ruleId,
    name: rule.name,
    pattern: rule.pattern,
    flags: rule.flags,
    example: rule.example ?? null,
    enabled: rule.enabled,
    sortOrder: index + 1,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }));
}
