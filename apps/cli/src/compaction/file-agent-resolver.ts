/**
 * Resolves compaction summary agents from `{novelMasterHome}/agents.yaml` bundle.
 *
 * @module compaction/file-agent-resolver
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  agentsBundleFromJson,
  CompactionPolicyError,
  type AgentDefinition,
  type CompactionAgentResolver,
} from "@novel-master/core";
import { resolveNovelMasterHome } from "./novel-master-home.js";

const AGENTS_BUNDLE_FILE = "agents.yaml";

async function loadAgentsBundle(
  home: string,
): Promise<ReadonlyMap<string, AgentDefinition>> {
  const path = join(home, AGENTS_BUNDLE_FILE);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new CompactionPolicyError(
      "INVALID_SCHEMA",
      `agents bundle not found: ${path} (expected ${AGENTS_BUNDLE_FILE} with schemaVersion and agents map)`,
    );
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(raw) as unknown;
  } catch {
    throw new CompactionPolicyError("INVALID_SCHEMA", `${AGENTS_BUNDLE_FILE}: invalid YAML`);
  }
  try {
    return agentsBundleFromJson(parsed);
  } catch (error) {
    if (error instanceof CompactionPolicyError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "invalid bundle";
    throw new CompactionPolicyError("INVALID_SCHEMA", `${AGENTS_BUNDLE_FILE}: ${message}`);
  }
}

/**
 * Creates a resolver that reads agent definitions from `{home}/agents.yaml`.
 */
export function createFileCompactionAgentResolver(
  dbPath: string,
): CompactionAgentResolver {
  const home = resolveNovelMasterHome(dbPath);

  return {
    async resolve(agentId: string): Promise<AgentDefinition> {
      const bundle = await loadAgentsBundle(home);
      const def = bundle.get(agentId);
      if (def == null) {
        throw new CompactionPolicyError(
          "AGENT_NOT_FOUND",
          `agent not found: ${agentId}`,
          { agentId },
        );
      }
      return def;
    },
  };
}

/** Returns agent ids from `{home}/agents.yaml` (empty when bundle is missing). */
export async function listBundleAgentIds(dbPath: string): Promise<readonly string[]> {
  const home = resolveNovelMasterHome(dbPath);
  try {
    const bundle = await loadAgentsBundle(home);
    return [...bundle.keys()].sort();
  } catch (error) {
    if (error instanceof CompactionPolicyError) {
      return [];
    }
    throw error;
  }
}
