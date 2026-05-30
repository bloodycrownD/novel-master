/**
 * Zod schema for `{home}/agents.yaml` multi-agent bundle documents.
 *
 * @module domain/agent/agents-bundle.schema
 */

import { z } from "zod";
import { promptsDocumentSchema } from "./agent-definition.schema.js";

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
