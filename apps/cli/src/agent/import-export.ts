/**
 * Agent bundle import/export helpers.
 *
 * @module agent/import-export
 */

import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  agentDefinitionSchema,
  decode,
  encode,
  parseText,
  stringifyText,
  validatePromptBlocksFromMap,
  type AgentDefinition,
  type AgentRegistryService,
} from "@novel-master/core";
import {
  agentsBundleDocumentSchema,
  type AgentsBundleDocument,
} from "./schemas/agents-bundle.schema.js";

function formatFromPath(path: string): "yaml" | "json" {
  const ext = extname(path).toLowerCase();
  return ext === ".json" ? "json" : "yaml";
}

function bundleToDefinitions(
  doc: AgentsBundleDocument,
): ReadonlyMap<string, AgentDefinition> {
  const map = new Map<string, AgentDefinition>();
  for (const [agentId, entry] of Object.entries(doc.agents)) {
    const blocks = validatePromptBlocksFromMap(entry.prompts.blocks);
    map.set(agentId, {
      name: agentId,
      prompts: blocks,
      model: entry.model,
      runtime: entry.runtime,
    });
  }
  return map;
}

/**
 * Imports agents from a bundle file into the registry.
 */
export async function importAgentsFromFile(
  registry: AgentRegistryService,
  path: string,
): Promise<number> {
  const source = await readFile(path, "utf8");
  const format = formatFromPath(path);
  const raw = parseText(source, format);
  const doc = decode(raw, agentsBundleDocumentSchema);
  const bundle = bundleToDefinitions(doc);
  for (const [agentId, def] of bundle) {
    await registry.upsert(agentId, def);
  }
  return bundle.size;
}

/**
 * Exports all registry agents to a bundle file.
 */
export async function exportAgentsToFile(
  registry: AgentRegistryService,
  path: string,
): Promise<void> {
  const ids = await registry.listAgentIds();
  const agents: AgentsBundleDocument["agents"] = {};
  for (const agentId of ids) {
    const def = await registry.get(agentId);
    const wire = encode(def, agentDefinitionSchema);
    const entry = wire as {
      prompts: AgentsBundleDocument["agents"][string]["prompts"];
      model?: string;
      runtime?: { maxSteps?: number };
    };
    agents[agentId] = {
      prompts: entry.prompts,
      ...(entry.model != null ? { model: entry.model } : {}),
      ...(entry.runtime != null ? { runtime: entry.runtime } : {}),
    };
  }
  const doc: AgentsBundleDocument = { schemaVersion: 1, agents };
  const format = formatFromPath(path);
  const text = stringifyText(doc, format);
  await writeFile(path, text, "utf8");
}
