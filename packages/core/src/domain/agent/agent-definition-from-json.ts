/**
 * Format-agnostic agent definition parsing (JSON object truth source).
 *
 * @module domain/agent/agent-definition-from-json
 */

import type { LlmProtocolKind } from "@/infra/llm-protocol/adapter.port.js";
import { AgentConfigError } from "../../errors/agent-config-errors.js";
import { validatePromptBlocks } from "../prompt/prompt-blocks-validate.js";
import type { AgentDefinition } from "./agent-definition.js";
import {
  agentDefinitionDocumentSchema,
  type AgentDefinitionDocument,
} from "./agent-definition.schema.js";
import { samplingProtocol } from "./model/model-sampling-params.js";

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
    model: {
      applicationModelId: def.model.applicationModelId,
      ...(def.model.params != null ? { params: def.model.params } : {}),
    },
    ...(def.runtime != null ? { runtime: def.runtime } : {}),
  };
}

function documentToDefinition(doc: AgentDefinitionDocument): AgentDefinition {
  const blocks = validatePromptBlocks(doc.prompts.blocks);
  return {
    schemaVersion: 1,
    name: doc.name,
    prompts: blocks,
    model: {
      applicationModelId: doc.model.applicationModelId,
      params: doc.model.params,
    },
    runtime: doc.runtime,
  };
}

export interface ValidateAgentDefinitionOptions {
  /** Resolves provider protocol for `applicationModelId` (CLI/tests inject). */
  readonly getProtocolForModel: (
    applicationModelId: string,
  ) => LlmProtocolKind | undefined | Promise<LlmProtocolKind | undefined>;
}

/**
 * Validates model sampling protocol consistency against the resolved provider.
 */
export async function validateAgentDefinition(
  def: AgentDefinition,
  options: ValidateAgentDefinitionOptions,
): Promise<void> {
  const params = def.model.params;
  if (params == null) {
    return;
  }
  const expected = await options.getProtocolForModel(
    def.model.applicationModelId,
  );
  if (expected == null) {
    throw new AgentConfigError(
      "INVALID_MODEL",
      `unknown model: ${def.model.applicationModelId}`,
    );
  }
  const actual = samplingProtocol(params);
  if (actual !== expected) {
    throw new AgentConfigError(
      "PROTOCOL_MISMATCH",
      `model params protocol "${actual}" does not match provider protocol "${expected}"`,
    );
  }
}
