/**
 * `nm events` subcommands.
 *
 * @module events/commands
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { decode, encode, parseText } from "@novel-master/core";

import { eventsConfigSchema, type EventsConfigStore } from "@novel-master/core/events";
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

export async function runEvents(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const store = rt.eventsConfig;

  switch (subcommand) {
    case "show": {
      const config = await store.getConfig();
      console.log(JSON.stringify(encode(config, eventsConfigSchema), null, 2));
      return;
    }
    case "set": {
      const filePath = flagString(flags, "file");
      if (filePath == null) {
        throw new Error("Usage: nm events set --file <path>");
      }
      const raw = await parseFile(filePath);
      const config = decode(raw, eventsConfigSchema);
      await store.setConfig(config);
      return;
    }
    case "clear":
    case "remove": {
      await store.clearConfig();
      return;
    }
    default:
      throw new Error("Usage: nm events <show|set|clear> [--file <path>]");
  }
}

export type { EventsConfigStore };
