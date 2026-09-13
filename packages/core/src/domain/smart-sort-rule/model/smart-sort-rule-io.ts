/**
 * Smart sort rule YAML bundle document: single source shared by CLI /
 * desktop / mobile import-export (spec D10).
 *
 * The document is the exchange unit (`schemaVersion` + ordered `rules` list);
 * text (de)serialization stays with the callers via
 * `@/infra/serialization` `parseText`/`stringifyText`.
 *
 * v2 (fix ④): rule field `example` renamed to `description`. Decoding keeps
 * accepting v1 documents carrying `example` — the loader maps the legacy
 * field onto `description` before validation, so old exports keep importing.
 * captureKind (D13) joins v2 as an optional field defaulting to `smart` —
 * pre-D13 v2 exports keep importing without bumping the schema version.
 *
 * @module domain/smart-sort-rule/model/smart-sort-rule-io
 */

import { z } from "zod";
import { decode } from "@/infra/serialization/decode.js";
import {
  SMART_SORT_CAPTURE_KINDS,
  type SmartSortCaptureKind,
  type SmartSortRule,
} from "./smart-sort-rule.js";

/** Current bundle document schema version. */
export const SMART_SORT_RULE_BUNDLE_SCHEMA_VERSION = 2;

/** captureKind 三档枚举（D13）：值域单源 SMART_SORT_CAPTURE_KINDS。 */
const captureKindSchema = z.enum(
  SMART_SORT_CAPTURE_KINDS as [SmartSortCaptureKind, ...SmartSortCaptureKind[]]
);

/** Bundle 内单条规则（description 缺省 null；captureKind 缺省 smart，D13；sortOrder 即导出时的优先级顺序）。 */
const bundleRuleSchema = z
  .object({
    ruleId: z.string().min(1),
    name: z.string().min(1),
    pattern: z.string().min(1),
    flags: z.string(),
    captureKind: captureKindSchema.optional(),
    description: z.string().nullable().optional(),
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

/** Domain rules → bundle document（全量、按 sortOrder；description null 省略）。 */
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
      captureKind: rule.captureKind,
      ...(rule.description != null ? { description: rule.description } : {}),
      enabled: rule.enabled,
      sortOrder: rule.sortOrder,
    })),
  };
}

/**
 * v1 兼容映射：旧文档的 `example` 字段挪到 `description`，schemaVersion
 * 改写为 2。仅识别 schemaVersion===1 且逐条规则只做字段搬运（无 example
 * 的规则原样通过，description 与 example 同时存在时以 description 为准）。
 */
function migrateBundleV1Raw(raw: unknown): unknown {
  if (
    typeof raw !== "object" ||
    raw === null ||
    Array.isArray(raw)
  ) {
    return raw;
  }
  const doc = raw as {
    schemaVersion?: unknown;
    rules?: unknown;
    [key: string]: unknown;
  };
  if (doc.schemaVersion !== 1 || !Array.isArray(doc.rules)) {
    return raw;
  }
  return {
    ...doc,
    schemaVersion: SMART_SORT_RULE_BUNDLE_SCHEMA_VERSION,
    rules: doc.rules.map((rule) => {
      if (typeof rule !== "object" || rule === null || Array.isArray(rule)) {
        return rule;
      }
      const r = rule as Record<string, unknown>;
      if (r.description !== undefined || r.example === undefined) {
        return r;
      }
      const { example, ...rest } = r;
      return { ...rest, description: example };
    }),
  };
}

/** Parses + validates an unknown payload as a bundle document. */
export function decodeSmartSortRuleBundle(
  raw: unknown
): SmartSortRuleBundleDocument {
  return decode(migrateBundleV1Raw(raw), smartSortRuleBundleDocumentSchema);
}

/** Bundle rules → domain entities（时间戳由导入方重新分配；captureKind 缺省 smart，D13）。 */
export function bundleRulesToEntities(
  doc: SmartSortRuleBundleDocument,
  nowMs: number
): SmartSortRule[] {
  return doc.rules.map((rule, index) => ({
    ruleId: rule.ruleId,
    name: rule.name,
    pattern: rule.pattern,
    flags: rule.flags,
    captureKind: rule.captureKind ?? "smart",
    description: rule.description ?? null,
    enabled: rule.enabled,
    sortOrder: index + 1,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  }));
}
