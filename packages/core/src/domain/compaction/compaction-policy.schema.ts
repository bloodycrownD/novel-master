/**
 * Zod schemas for {@link CompactionPolicy} JSON/YAML payloads.
 *
 * @module domain/compaction/compaction-policy.schema
 */

import { z } from "zod";
import type { CompactionPolicy, CompactionPolicyTemplate } from "./compaction-policy.js";

const compactionTriggerSchema = z
  .object({
    tokenThreshold: z.number().int().positive().optional(),
    floorThreshold: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (t) => t.tokenThreshold != null || t.floorThreshold != null,
    "trigger requires at least one of tokenThreshold or floorThreshold",
  );

const compactionAbstractSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), content: z.string() }).strict(),
  z
    .object({
      type: z.literal("agent"),
      agentId: z.string().min(1),
      instruction: z.string().optional(),
    })
    .strict(),
]);

const compactionActionSchema = z
  .object({
    keepLastN: z.number().int().positive(),
    abstract: compactionAbstractSchema,
  })
  .strict();

/** Root compaction policy wire document schema. */
export const compactionPolicyDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean(),
    trigger: compactionTriggerSchema,
    action: compactionActionSchema,
  })
  .strict();

export type CompactionPolicyDocument = z.infer<typeof compactionPolicyDocumentSchema>;

function documentToPolicy(doc: CompactionPolicyDocument): CompactionPolicy {
  return {
    enabled: doc.enabled,
    trigger: doc.trigger,
    action: doc.action,
  };
}

function policyToDocument(policy: CompactionPolicy): CompactionPolicyDocument {
  return {
    schemaVersion: 1,
    enabled: policy.enabled,
    trigger: policy.trigger,
    action: policy.action,
  };
}

/** Domain parser: wire document → {@link CompactionPolicy}. */
export const compactionPolicySchema = Object.assign(
  compactionPolicyDocumentSchema.transform(documentToPolicy),
  { encode: policyToDocument },
);

/** Template wire document (no `enabled`). */
export const compactionPolicyTemplateDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    trigger: compactionTriggerSchema,
    action: compactionActionSchema,
  })
  .strict();

export type CompactionPolicyTemplateDocument = z.infer<
  typeof compactionPolicyTemplateDocumentSchema
>;

function documentToTemplate(
  doc: CompactionPolicyTemplateDocument,
): CompactionPolicyTemplate {
  return {
    trigger: doc.trigger,
    action: doc.action,
  };
}

/** Domain parser: template wire → {@link CompactionPolicyTemplate}. */
export const compactionPolicyTemplateSchema =
  compactionPolicyTemplateDocumentSchema.transform(documentToTemplate);
