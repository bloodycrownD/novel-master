/**
 * {@link AgentDefinition} → string (YAML/JSON format layer).
 *
 * @module infra/agent-definition-io/serialize-agent-definition
 */

import { stringify as stringifyYaml } from "yaml";
import { agentDefinitionToJson } from "../../domain/agent/agent-definition-from-json.js";
import type { AgentDefinition } from "../../domain/agent/agent-definition.js";
import type { AgentDefinitionFormat } from "./deserialize-agent-definition.js";

export interface SerializeAgentDefinitionOptions {
  readonly format?: AgentDefinitionFormat;
}

/**
 * Serializes an agent definition to YAML or JSON text.
 */
export function serializeAgentDefinition(
  def: AgentDefinition,
  options?: SerializeAgentDefinitionOptions,
): string {
  const format = options?.format ?? "yaml";
  const doc = agentDefinitionToJson(def);
  if (format === "json") {
    return JSON.stringify(doc, null, 2);
  }
  return stringifyYaml(doc);
}
