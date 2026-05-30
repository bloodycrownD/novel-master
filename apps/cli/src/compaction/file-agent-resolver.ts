/**
 * File-based agent registry resolver for compaction summary agents.
 *
 * @module compaction/file-agent-resolver
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
  CompactionPolicyError,
  deserializeAgentDefinition,
  type AgentDefinition,
  type CompactionAgentResolver,
} from "@novel-master/core";
import { resolveNovelMasterHome } from "./novel-master-home.js";

interface AgentRegistryDocument {
  readonly schemaVersion: 1;
  readonly agents: Record<string, string>;
}

function parseRegistry(raw: string): AgentRegistryDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new CompactionPolicyError("INVALID_SCHEMA", "registry.json: invalid JSON");
  }
  if (
    typeof parsed !== "object" ||
    parsed == null ||
    (parsed as AgentRegistryDocument).schemaVersion !== 1 ||
    typeof (parsed as AgentRegistryDocument).agents !== "object" ||
    (parsed as AgentRegistryDocument).agents == null
  ) {
    throw new CompactionPolicyError("INVALID_SCHEMA", "registry.json: invalid shape");
  }
  return parsed as AgentRegistryDocument;
}

async function loadRegistry(home: string): Promise<AgentRegistryDocument> {
  const path = join(home, "agents", "registry.json");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new CompactionPolicyError(
      "INVALID_SCHEMA",
      `agent registry not found: ${path}`,
    );
  }
  return parseRegistry(raw);
}

/**
 * Creates a resolver that reads `{home}/agents/registry.json`.
 */
export function createFileCompactionAgentResolver(
  dbPath: string,
): CompactionAgentResolver {
  const home = resolveNovelMasterHome(dbPath);

  return {
    async resolve(agentId: string): Promise<AgentDefinition> {
      const registry = await loadRegistry(home);
      const relative = registry.agents[agentId];
      if (relative == null) {
        throw new CompactionPolicyError(
          "AGENT_NOT_FOUND",
          `agent not found: ${agentId}`,
          { agentId },
        );
      }
      const agentPath = isAbsolute(relative)
        ? relative
        : resolve(home, relative);
      const source = await readFile(agentPath, "utf8");
      return deserializeAgentDefinition(source);
    },
  };
}

/** Returns registered agent ids from registry.json (empty when missing). */
export async function listRegistryAgentIds(dbPath: string): Promise<readonly string[]> {
  const home = resolveNovelMasterHome(dbPath);
  try {
    const registry = await loadRegistry(home);
    return Object.keys(registry.agents).sort();
  } catch (error) {
    if (error instanceof CompactionPolicyError) {
      return [];
    }
    throw error;
  }
}
