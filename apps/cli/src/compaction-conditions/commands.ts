/**
 * `nm compaction-conditions` subcommands.
 *
 * @module compaction-conditions/commands
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { decode, parseText } from "@novel-master/core";
import { type AppError, Result } from "@novel-master/core/errors";
import { RESULT_OK } from "../cli-errors.js";

import { compactionConditionsSchema, type CompactionConditionsStore } from "@novel-master/core/compaction";
import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runCompactionConditions(rt: NovelMasterRuntime, subcommand: string, args: readonly string[]): Promise<Result<void, AppError>> {
  const { flags } = parseCliArgs(args);
  const store = rt.compactionConditions;

  switch (subcommand) {
    case "show": {
      const conditions = await store.getConditions();
      if (!conditions.ok) return Result.err(conditions.error);
      if (conditions.value == null) {
        console.log("No compaction conditions configured.");
        return RESULT_OK;
      }
      // Domain object from store; schema uses Zod transform (not encodable).
      console.log(JSON.stringify(conditions.value, null, 2));
      return RESULT_OK;
    }
    case "set": {
      const filePath = flags.get("file");
      if (typeof filePath !== "string") throw new Error("Usage: nm compaction-conditions set --file <path>");
      // 文本解析的已知失败沿 `Result.err` 回传（五期门⑦）；读文件 IO 异常仍抛。
      const raw = parseText(await readFile(filePath, "utf8"), extname(filePath).toLowerCase() === ".json" ? "json" : "yaml");
      if (!raw.ok) return Result.err(raw.error);
      const conditions = decode(raw.value, compactionConditionsSchema);
      if (!conditions.ok) return Result.err(conditions.error);
      await store.setConditions(conditions.value);
      return RESULT_OK;
    }
    case "clear":
    case "remove": {
      await store.clearConditions();
      return RESULT_OK;
    }
    default:
      throw new Error("Usage: nm compaction-conditions <show|set|clear> [--file <path>]");
  }
}

export type { CompactionConditionsStore };
