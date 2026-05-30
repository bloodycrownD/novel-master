/**
 * Zod schema for `agents.yaml` multi-agent bundle documents (CLI exchange format).
 *
 * @module agent/schemas/agents-bundle.schema
 */

import { z } from "zod";
import { promptsDocumentSchema } from "@novel-master/core";

const agentBundleEntrySchema = z
  .object({
    prompts: promptsDocumentSchema,
    model: z.string().min(1).optional(),
    runtime: z.object({ maxSteps: z.number().int().positive().optional() }).strict().optional(),
  })
  .strict();

/** Root agents bundle document (`agents` map keys = agentId). */
export const agentsBundleDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    agents: z.record(z.string().min(1), agentBundleEntrySchema),
  })
  .strict();

export type AgentsBundleDocument = z.infer<typeof agentsBundleDocumentSchema>;

/** True when raw object is a multi-agent bundle (not a single-agent root doc). */
export function isAgentsBundleDocument(raw: unknown): boolean {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return false;
  }
  const record = raw as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    record.agents != null &&
    typeof record.agents === "object"
  );
}
