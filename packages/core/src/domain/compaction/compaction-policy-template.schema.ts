/**
 * Zod schema for compaction policy **template** files (`set --file`; no `enabled`).
 *
 * @module domain/compaction/compaction-policy-template.schema
 */

import { z } from "zod";

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

/** Template document: shareable; runtime `enabled` is set by CLI on import. */
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
