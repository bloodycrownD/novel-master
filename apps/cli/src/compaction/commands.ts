/**
 * `nm compaction` subcommands (global policy in novel.db KKV).
 *
 * @module compaction/commands
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import {
  compactionPolicySchema,
  compactionPolicyTemplateSchema,
  decode,
  encode,
  parseText,
  CompactionPolicyError,
  type CompactionPolicy,
  type CompactionPolicyStore,
  type CompactionAgentResolver,
  type AgentRegistryService,
} from "@novel-master/core";
import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

async function parsePolicyFile(path: string): Promise<unknown> {
  const source = await readFile(path, "utf8");
  const ext = extname(path).toLowerCase();
  const format = ext === ".json" ? "json" : "yaml";
  return parseText(source, format);
}

async function validateAgentIdsInPolicy(
  policy: CompactionPolicy,
  registry: AgentRegistryService,
): Promise<void> {
  const abstract = policy.action.abstract;
  if (abstract.type !== "agent") {
    return;
  }
  try {
    await registry.get(abstract.agentId);
  } catch {
    throw new CompactionPolicyError(
      "AGENT_NOT_FOUND",
      `agent not found: ${abstract.agentId}`,
      { agentId: abstract.agentId },
    );
  }
}

export async function runCompaction(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
  _argv: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const store = rt.compactionPolicy;

  switch (subcommand) {
    case "show": {
      const policy = await store.getPolicy();
      if (policy == null) {
        console.log("No compaction policy configured (treated as disabled).");
        return;
      }
      console.log(JSON.stringify(encode(policy, compactionPolicySchema), null, 2));
      return;
    }
    case "set": {
      const filePath = flagString(flags, "file");
      if (filePath == null) {
        throw new Error("Usage: nm compaction set --file <path>");
      }
      const raw = await parsePolicyFile(filePath);
      const template = decode(raw, compactionPolicyTemplateSchema);
      const policy: CompactionPolicy = { ...template, enabled: true };
      await validateAgentIdsInPolicy(policy, rt.agentRegistry);
      await store.setPolicy(policy);
      return;
    }
    case "disable": {
      const policy = await store.getPolicy();
      if (policy == null) {
        throw new CompactionPolicyError(
          "NOT_FOUND",
          "No compaction policy configured; nothing to disable",
        );
      }
      await store.setPolicy({ ...policy, enabled: false });
      return;
    }
    case "remove":
    case "clear": {
      await store.clearPolicy();
      return;
    }
    default:
      throw new Error(
        "Usage: nm compaction <show|set|disable|remove|clear> [--file <path>] [--db <path>]",
      );
  }
}

export type { CompactionPolicyStore, CompactionAgentResolver };
