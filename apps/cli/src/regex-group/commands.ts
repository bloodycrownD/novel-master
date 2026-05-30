/**
 * `nm regex-group` subcommands.
 *
 * @module regex-group/commands
 */

import { RegexError } from "@novel-master/core";
import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

function positionalId(args: readonly string[]): string {
  const id = args[0];
  if (id == null || id.startsWith("-")) {
    throw new Error("Missing group id argument");
  }
  return id;
}

export async function runRegexGroup(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags, positional } = parseCliArgs(args);

  switch (subcommand) {
    case "list": {
      const list = await rt.regexConfig.listGroups();
      for (const g of list) {
        console.log(`${g.groupId}\t${g.displayName ?? ""}`);
      }
      return;
    }
    case "create": {
      const groupId = flagString(flags, "groupId") ?? positionalId(positional);
      const displayName = flagString(flags, "displayName") ?? null;
      const g = await rt.regexConfig.createGroup({ groupId, displayName });
      console.log(g.groupId);
      return;
    }
    case "use": {
      const groupId = flagString(flags, "groupId") ?? positionalId(positional);
      await rt.regexConfig.getGroup(groupId);
      await rt.state.setCurrentRegexGroupId(groupId);
      return;
    }
    case "current": {
      const id = await rt.state.getCurrentRegexGroupId();
      if (id == null || id === "") {
        throw new Error(
          "No current regex group (run: nm regex-group use <groupId>)",
        );
      }
      const g = await rt.regexConfig.getGroup(id);
      console.log(`${g.groupId}\t${g.displayName ?? ""}`);
      return;
    }
    case "reset": {
      await rt.state.resetCurrentRegexGroupId();
      return;
    }
    case "edit": {
      const groupId = flagString(flags, "groupId") ?? positionalId(positional);
      const displayName = flags.has("displayName")
        ? (flagString(flags, "displayName") ?? null)
        : undefined;
      const g = await rt.regexConfig.updateGroup(groupId, { displayName });
      console.log(g.groupId);
      return;
    }
    case "delete": {
      const groupId = flagString(flags, "groupId") ?? positionalId(positional);
      try {
        await rt.regexConfig.deleteGroup(groupId);
      } catch (e) {
        if (e instanceof RegexError && e.code === "NOT_FOUND") {
          throw new Error(`Regex group not found: ${groupId}`);
        }
        throw e;
      }
      return;
    }
    default:
      throw new Error(
        "Usage: nm regex-group <list|create|use|current|reset|edit|delete> ...",
      );
  }
}
