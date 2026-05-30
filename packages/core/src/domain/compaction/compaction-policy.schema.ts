/**
 * Zod schemas for {@link CompactionPolicy} JSON/YAML payloads.
 *
 * @module domain/compaction/compaction-policy.schema
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

/** Root compaction policy document schema. */
export const compactionPolicyDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    enabled: z.boolean(),
    trigger: compactionTriggerSchema,
    action: compactionActionSchema,
  })
  .strict();

export type CompactionPolicyDocument = z.infer<typeof compactionPolicyDocumentSchema>;
