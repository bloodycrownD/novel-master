/**
 * `nm kkv` subcommands.
 *
 * @module kkv/commands
 */

import type { KkvService } from "@novel-master/core";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runKkv(
  kkv: KkvService,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const module = flags.get("module");
  if (typeof module !== "string") {
    throw new Error("Usage: nm kkv <list|get|set|delete> --module <M> [--key] [--value]");
  }

  switch (subcommand) {
    case "list": {
      const keys = await kkv.listKeys(module);
      for (const key of keys) {
        console.log(key);
      }
      return;
    }
    case "get": {
      const key = flags.get("key");
      if (typeof key !== "string") {
        throw new Error("Usage: nm kkv get --module <M> --key <k>");
      }
      console.log(await kkv.get(module, key));
      return;
    }
    case "set": {
      const key = flags.get("key");
      const value = flags.get("value");
      if (typeof key !== "string" || typeof value !== "string") {
        throw new Error("Usage: nm kkv set --module <M> --key <k> --value <v>");
      }
      await kkv.set(module, key, value);
      return;
    }
    case "delete": {
      const key = flags.get("key");
      if (typeof key !== "string") {
        throw new Error("Usage: nm kkv delete --module <M> --key <k>");
      }
      await kkv.delete(module, key);
      return;
    }
    default:
      throw new Error("Usage: nm kkv <list|get|set|delete> ...");
  }
}
