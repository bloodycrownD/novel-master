/**
 * `nm compaction` subcommands (global policy in novel.db KKV).
 *
 * @module compaction/commands
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { parse as parseYaml } from "yaml";
import {
  compactionPolicyFromJson,
  compactionPolicyTemplateFromJson,
  compactionPolicyToJson,
  CompactionPolicyError,
  type CompactionPolicy,
  type CompactionPolicyStore,
  type CompactionAgentResolver,
} from "@novel-master/core";
import type { NovelMasterRuntime } from "../runtime.js";
import { resolveDbPath } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";
import { listBundleAgentIds } from "./file-agent-resolver.js";

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
  if (ext === ".json") {
    return JSON.parse(source) as unknown;
  }
  return parseYaml(source) as unknown;
}

async function validateAgentIdsInPolicy(
  policy: CompactionPolicy,
  dbPath: string,
): Promise<void> {
  const abstract = policy.action.abstract;
  if (abstract.type !== "agent") {
    return;
  }
  const ids = await listBundleAgentIds(dbPath);
  if (!ids.includes(abstract.agentId)) {
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
  argv: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const store = rt.compactionPolicy;
  const dbPath = resolveDbPath(argv);

  switch (subcommand) {
    case "show": {
      const policy = await store.getPolicy();
      if (policy == null) {
        console.log("No compaction policy configured (treated as disabled).");
        return;
      }
      console.log(JSON.stringify(compactionPolicyToJson(policy), null, 2));
      return;
    }
    case "set": {
      const filePath = flagString(flags, "file");
      if (filePath == null) {
        throw new Error("Usage: nm compaction set --file <path>");
      }
      const raw = await parsePolicyFile(filePath);
      const template = compactionPolicyTemplateFromJson(raw);
      const policy = compactionPolicyFromJson({
        ...template,
        enabled: true,
      });
      await validateAgentIdsInPolicy(policy, dbPath);
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
