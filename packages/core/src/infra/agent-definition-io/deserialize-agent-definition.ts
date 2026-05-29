/**
 * String → {@link AgentDefinition} (YAML/JSON format layer).
 *
 * @module infra/agent-definition-io/deserialize-agent-definition
 */

import { parse as parseYaml } from "yaml";
import { agentDefinitionFromJson } from "../../domain/agent/agent-definition-from-json.js";
import type { AgentDefinition } from "../../domain/agent/agent-definition.js";
import { AgentConfigError } from "../../errors/agent-config-errors.js";

export type AgentDefinitionFormat = "yaml" | "json";

export interface DeserializeAgentDefinitionOptions {
  readonly format?: AgentDefinitionFormat;
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new AgentConfigError("INVALID_SCHEMA", message);
  }
}

function parseYamlSource(source: string): unknown {
  try {
    return parseYaml(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid YAML";
    throw new AgentConfigError("INVALID_SCHEMA", message);
  }
}

/**
 * Deserializes YAML or JSON string into a validated {@link AgentDefinition}.
 */
export function deserializeAgentDefinition(
  source: string,
  options?: DeserializeAgentDefinitionOptions,
): AgentDefinition {
  const format = options?.format ?? "yaml";
  const raw = format === "json" ? parseJson(source) : parseYamlSource(source);
  return agentDefinitionFromJson(raw);
}
