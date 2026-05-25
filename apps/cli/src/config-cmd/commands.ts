/**
 * `nm config` subcommands.
 *
 * @module config-cmd/commands
 */

import type { ConfigService } from "@novel-master/core";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runConfig(
  config: ConfigService,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "set": {
      const key = flags.get("key");
      const value = flags.get("value");
      if (typeof key !== "string" || typeof value !== "string") {
        throw new Error("Usage: nm config set --key <k> --value <v>");
      }
      await config.set(key, value);
      return;
    }
    case "get": {
      const key = flags.get("key");
      if (typeof key !== "string") {
        throw new Error("Usage: nm config get --key <k>");
      }
      const value = await config.get(key);
      console.log(value ?? "");
      return;
    }
    case "list": {
      const entries = await config.list();
      for (const { key, value } of entries) {
        console.log(`${key}\t${value}`);
      }
      return;
    }
    case "reset": {
      const key = flags.get("key");
      if (typeof key !== "string") {
        throw new Error("Usage: nm config reset --key <k>");
      }
      await config.reset(key);
      return;
    }
    default:
      throw new Error("Usage: nm config <set|get|list|reset> ...");
  }
}
