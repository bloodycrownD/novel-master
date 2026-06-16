/**
 * `nm compaction-conditions` subcommands.
 *
 * @module compaction-conditions/commands
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { decode, parseText } from "@novel-master/core";

import { compactionConditionsSchema, CompactionConditionsError, type CompactionConditionsStore } from "@novel-master/core/compaction";
import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

async function parseFile(path: string): Promise<unknown> {
  const source = await readFile(path, "utf8");
  const ext = extname(path).toLowerCase();
  const format = ext === ".json" ? "json" : "yaml";
  return parseText(source, format);
}

export async function runCompactionConditions(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const store = rt.compactionConditions;

  switch (subcommand) {
    case "show": {
      const conditions = await store.getConditions();
      if (conditions == null) {
        console.log("No compaction conditions configured.");
        return;
      }
      // Domain object from store; schema uses Zod transform (not encodable).
      console.log(JSON.stringify(conditions, null, 2));
      return;
    }
    case "set": {
      const filePath = flagString(flags, "file");
      if (filePath == null) {
        throw new Error(
          "Usage: nm compaction-conditions set --file <path>",
        );
      }
      const raw = await parseFile(filePath);
      const conditions = decode(raw, compactionConditionsSchema);
      await store.setConditions(conditions);
      return;
    }
    case "clear":
    case "remove": {
      await store.clearConditions();
      return;
    }
    default:
      throw new Error(
        "Usage: nm compaction-conditions <show|set|clear> [--file <path>]",
      );
  }
}

export type { CompactionConditionsStore, CompactionConditionsError };
