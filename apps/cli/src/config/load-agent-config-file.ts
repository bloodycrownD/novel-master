/**
 * CLI: read agent config file (single agent or bundle) via Core parsers.
 *
 * @module config/load-agent-config-file
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  agentDefinitionFromJson,
  agentsBundleFromJson,
  isAgentsBundleDocument,
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

function parseRaw(source: string, format: AgentDefinitionFormat): unknown {
  if (format === "json") {
    return JSON.parse(source) as unknown;
  }
  return parseYaml(source) as unknown;
}

/**
 * Loads one agent from a config path (single-agent doc or bundle + agentId).
 */
export async function loadAgentFromConfig(
  path: string,
  agentId?: string,
): Promise<AgentDefinition> {
  const source = await readFile(path, "utf8");
  const format = formatFromPath(path);
  const raw = parseRaw(source, format);

  if (isAgentsBundleDocument(raw)) {
    if (agentId == null || agentId === "") {
      throw new Error(
        "Config file is an agents bundle; use --agent-id <id> to select an agent",
      );
    }
    const bundle = agentsBundleFromJson(raw);
    const def = bundle.get(agentId);
    if (def == null) {
      throw new Error(`agent not found in bundle: ${agentId}`);
    }
    return def;
  }

  return agentDefinitionFromJson(raw);
}

/**
 * Reads a single-agent config file (not a bundle).
 */
export async function loadAgentConfigFile(path: string): Promise<AgentDefinition> {
  return loadAgentFromConfig(path);
}
