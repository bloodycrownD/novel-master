/**
 * CLI: read a single-agent config file via parseText + decode.
 *
 * @module config/load-agent-config-file
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { decode, parseText, type TextFormat } from "@novel-master/core";

import { agentDefinitionSchema, type AgentDefinition } from "@novel-master/core/agent";

function formatFromPath(path: string): TextFormat {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") {
    return "json";
  }
  return "yaml";
}

/**
 * Loads one agent from a single-agent config path.
 */
export async function loadAgentFromConfig(
  path: string,
): Promise<AgentDefinition> {
  const source = await readFile(path, "utf8");
  const format = formatFromPath(path);
  const raw = parseText(source, format);
  return decode(raw, agentDefinitionSchema);
}

/**
 * Reads a single-agent config file (not a bundle).
 */
export async function loadAgentConfigFile(path: string): Promise<AgentDefinition> {
  return loadAgentFromConfig(path);
}
