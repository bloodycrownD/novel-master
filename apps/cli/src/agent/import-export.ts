/**
 * Agent bundle import/export helpers.
 *
 * @module agent/import-export
 */

import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { decode, encode, parseText, stringifyText } from "@novel-master/core";

import { agentDefinitionSchema, type AgentDefinition, type AgentRegistryService, type ValidateAgentDefinitionOptions } from "@novel-master/core/agent";

import { validateAgentPromptLayoutFromMaps } from "@novel-master/core/prompt";
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
    const prompts = validateAgentPromptLayoutFromMaps(
      entry.prompts.persist,
      entry.prompts.dynamic,
      entry.prompts.system,
    );
    map.set(agentId, {
      name: agentId,
      prompts,
      model: entry.model,
      runtime: entry.runtime,
      ...(entry.tools != null
        ? {
            tools: {
              ...(entry.tools.allow != null ? { allow: [...entry.tools.allow] } : {}),
              ...(entry.tools.deny != null ? { deny: [...entry.tools.deny] } : {}),
            },
          }
        : {}),
      ...(entry.description != null && entry.description.trim().length > 0
        ? { description: entry.description }
        : {}),
      ...(entry.mode != null ? { mode: entry.mode } : {}),
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
  validateOptions: ValidateAgentDefinitionOptions = {},
): Promise<number> {
  const source = await readFile(path, "utf8");
  const format = formatFromPath(path);
  const raw = parseText(source, format);
  const doc = decode(raw, agentsBundleDocumentSchema);
  const bundle = bundleToDefinitions(doc);
  let imported = 0;
  for (const [agentId, def] of bundle) {
    // general 是内置虚拟 agent，upsert 禁止重名，import 时跳过（由 registry seed 提供）
    if (def.name === "general") continue;
    await registry.upsert(agentId, def, validateOptions);
    imported++;
  }
  return imported;
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
      tools?: { allow?: string[]; deny?: string[] };
      description?: string;
      mode?: "primary" | "subagent" | "all";
    };
    agents[agentId] = {
      prompts: entry.prompts,
      ...(entry.model != null ? { model: entry.model } : {}),
      ...(entry.runtime != null ? { runtime: entry.runtime } : {}),
      ...(entry.tools != null
        ? {
            tools: {
              ...(entry.tools.allow != null ? { allow: [...entry.tools.allow] } : {}),
              ...(entry.tools.deny != null ? { deny: [...entry.tools.deny] } : {}),
            },
          }
        : {}),
      ...(entry.description != null && entry.description.trim().length > 0
        ? { description: entry.description }
        : {}),
      ...(entry.mode != null ? { mode: entry.mode } : {}),
    };
  }
  const doc: AgentsBundleDocument = { schemaVersion: 1, agents };
  const format = formatFromPath(path);
  const text = stringifyText(doc, format);
  await writeFile(path, text, "utf8");
}
