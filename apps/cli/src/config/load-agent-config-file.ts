/**
 * CLI: read agent config file (single agent or bundle) via parseText + decode.
 *
 * @module config/load-agent-config-file
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  agentDefinitionSchema,
  decode,
  parseText,
  validatePromptBlocksFromMap,
  type AgentDefinition,
  type TextFormat,
} from "@novel-master/core";
import {
  agentsBundleDocumentSchema,
  isAgentsBundleDocument,
} from "../agent/schemas/agents-bundle.schema.js";

function formatFromPath(path: string): TextFormat {
  const ext = extname(path).toLowerCase();
  if (ext === ".json") {
    return "json";
  }
  return "yaml";
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
  const raw = parseText(source, format);

  if (isAgentsBundleDocument(raw)) {
    if (agentId == null || agentId === "") {
      throw new Error(
        "Config file is an agents bundle; use --agent-id <id> to select an agent",
      );
    }
    const doc = decode(raw, agentsBundleDocumentSchema);
    const entry = doc.agents[agentId];
    if (entry == null) {
      throw new Error(`agent not found in bundle: ${agentId}`);
    }
    const blocks = validatePromptBlocksFromMap(entry.prompts.blocks);
    return {
      name: agentId,
      prompts: blocks,
      model: entry.model,
      runtime: entry.runtime,
    };
  }

  return decode(raw, agentDefinitionSchema);
}

/**
 * Reads a single-agent config file (not a bundle).
 */
export async function loadAgentConfigFile(path: string): Promise<AgentDefinition> {
  return loadAgentFromConfig(path);
}
