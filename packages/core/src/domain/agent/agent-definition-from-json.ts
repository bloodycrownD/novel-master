/**
 * Format-agnostic agent definition parsing (JSON object truth source).
 *
 * @module domain/agent/agent-definition-from-json
 */

import { AgentConfigError } from "../../errors/agent-config-errors.js";
import { validatePromptBlocksFromMap } from "../prompt/prompt-blocks-validate.js";
import type { PromptBlock } from "../prompt/model/prompt-block.js";
import type { AgentDefinition } from "./agent-definition.js";
import {
  agentDefinitionDocumentSchema,
  type AgentDefinitionDocument,
} from "./agent-definition.schema.js";

function zodMessage(error: { message: string }): string {
  return error.message;
}

/** Rejects removed field names before Zod (clearer than strict unknown-key errors). */
function assertNoLegacyAgentFields(raw: unknown): void {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return;
  }
  const record = raw as Record<string, unknown>;
  if ("preferredModelId" in record) {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      "preferredModelId is removed; use optional model: <applicationModelId>",
    );
  }
  const model = record.model;
  if (model != null && typeof model === "object" && !Array.isArray(model)) {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      "legacy nested model block is not supported",
    );
  }
}

function blockToMapValue(block: PromptBlock): AgentDefinitionDocument["prompts"]["blocks"][string] {
  if (block.type === "text") {
    return {
      type: "text",
      role: block.role,
      content: block.content,
    };
  }
  if (block.type === "abstract") {
    return { type: "abstract", content: block.content };
  }
  return { type: "chat" };
}

/**
 * Parses and validates a plain JSON object into {@link AgentDefinition}.
 */
export function agentDefinitionFromJson(raw: unknown): AgentDefinition {
  assertNoLegacyAgentFields(raw);
  const parsed = agentDefinitionDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AgentConfigError(
      "INVALID_SCHEMA",
      zodMessage(parsed.error),
    );
  }
  return documentToDefinition(parsed.data);
}

/**
 * Serializes {@link AgentDefinition} to a JSON-serializable document object.
 * Blocks are written as an ordered map (key = block name).
 */
export function agentDefinitionToJson(def: AgentDefinition): AgentDefinitionDocument {
  const blocks: AgentDefinitionDocument["prompts"]["blocks"] = {};
  for (const block of def.prompts) {
    blocks[block.name] = blockToMapValue(block);
  }
  return {
    schemaVersion: 1,
    name: def.name,
    prompts: { blocks },
    ...(def.model != null ? { model: def.model } : {}),
    ...(def.runtime != null ? { runtime: def.runtime } : {}),
  };
}

function documentToDefinition(doc: AgentDefinitionDocument): AgentDefinition {
  const blocks = validatePromptBlocksFromMap(doc.prompts.blocks);
  return {
    schemaVersion: 1,
    name: doc.name,
    prompts: blocks,
    model: doc.model,
    runtime: doc.runtime,
  };
}

export interface ValidateAgentDefinitionOptions {
  /** Ensures model pin refers to a saved model (CLI injects). */
  readonly assertSavedModel?: (
    applicationModelId: string,
  ) => void | Promise<void>;
}

/**
 * Validates optional model pin when host supplies saved-model lookup.
 */
export async function validateAgentDefinition(
  def: AgentDefinition,
  options: ValidateAgentDefinitionOptions = {},
): Promise<void> {
  const pin = def.model;
  if (pin == null || options.assertSavedModel == null) {
    return;
  }
  await options.assertSavedModel(pin);
}
