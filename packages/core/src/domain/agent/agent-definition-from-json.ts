/**
 * Format-agnostic agent definition parsing (JSON object truth source).
 *
 * @module domain/agent/agent-definition-from-json
 */

import { AgentConfigError } from "../../errors/agent-config-errors.js";
import { validatePromptBlocks } from "../prompt/prompt-blocks-validate.js";
import type { AgentDefinition } from "./agent-definition.js";
import {
  agentDefinitionDocumentSchema,
  type AgentDefinitionDocument,
} from "./agent-definition.schema.js";

function zodMessage(error: { message: string }): string {
  return error.message;
}

/**
 * Parses and validates a plain JSON object into {@link AgentDefinition}.
 */
export function agentDefinitionFromJson(raw: unknown): AgentDefinition {
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
 */
export function agentDefinitionToJson(def: AgentDefinition): AgentDefinitionDocument {
  return {
    schemaVersion: 1,
    name: def.name,
    prompts: { blocks: [...def.prompts] },
    ...(def.preferredModelId != null ? { preferredModelId: def.preferredModelId } : {}),
    ...(def.runtime != null ? { runtime: def.runtime } : {}),
  };
}

function documentToDefinition(doc: AgentDefinitionDocument): AgentDefinition {
  const blocks = validatePromptBlocks(doc.prompts.blocks);
  return {
    schemaVersion: 1,
    name: doc.name,
    prompts: blocks,
    preferredModelId: doc.preferredModelId,
    runtime: doc.runtime,
  };
}

export interface ValidateAgentDefinitionOptions {
  /** Ensures preferredModelId refers to a saved model (CLI injects). */
  readonly assertSavedModel?: (
    applicationModelId: string,
  ) => void | Promise<void>;
}

/**
 * Validates optional preferred model pin when host supplies saved-model lookup.
 */
export async function validateAgentDefinition(
  def: AgentDefinition,
  options: ValidateAgentDefinitionOptions = {},
): Promise<void> {
  const pin = def.preferredModelId;
  if (pin == null || options.assertSavedModel == null) {
    return;
  }
  await options.assertSavedModel(pin);
}
