/**
 * CLI: read agent config file and deserialize via Core.
 *
 * @module config/load-agent-config-file
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  deserializeAgentDefinition,
  type AgentDefinition,
  type AgentDefinitionFormat,
} from "@novel-master/core";

function formatFromPath(path: string): AgentDefinitionFormat {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") {
    return "json";
  }
  return "yaml";
}

/**
 * Reads an agent config file and returns a validated {@link AgentDefinition}.
 */
export async function loadAgentConfigFile(path: string): Promise<AgentDefinition> {
  const source = await readFile(path, "utf8");
  return deserializeAgentDefinition(source, { format: formatFromPath(path) });
}
