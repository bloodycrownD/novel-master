/**
 * Parses agents bundle documents into id → {@link AgentDefinition}.
 *
 * @module domain/agent/agents-bundle-from-json
 */

import { AgentConfigError } from "../../errors/agent-config-errors.js";
import { validatePromptBlocksFromMap } from "../prompt/prompt-blocks-validate.js";
import type { AgentDefinition } from "./agent-definition.js";
import {
  agentsBundleDocumentSchema,
  type AgentsBundleDocument,
} from "./agents-bundle.schema.js";

function zodMessage(error: { message: string }): string {
  return error.message;
}

/**
 * Parses bundle JSON/YAML object; each map key becomes {@link AgentDefinition.name}.
 */
export function agentsBundleFromJson(raw: unknown): ReadonlyMap<string, AgentDefinition> {
  const parsed = agentsBundleDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgentConfigError("INVALID_SCHEMA", zodMessage(parsed.error));
  }
  return documentToBundle(parsed.data);
}

function documentToBundle(doc: AgentsBundleDocument): ReadonlyMap<string, AgentDefinition> {
  const map = new Map<string, AgentDefinition>();
  for (const [agentId, entry] of Object.entries(doc.agents)) {
    const blocks = validatePromptBlocksFromMap(entry.prompts.blocks);
    map.set(agentId, {
      schemaVersion: 1,
      name: agentId,
      prompts: blocks,
      model: entry.model,
      runtime: entry.runtime,
    });
  }
  return map;
}

/** True when raw object is a multi-agent bundle (not a single-agent root doc). */
export function isAgentsBundleDocument(raw: unknown): boolean {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return false;
  }
  const record = raw as Record<string, unknown>;
  return record.schemaVersion === 1 && record.agents != null && typeof record.agents === "object";
}
