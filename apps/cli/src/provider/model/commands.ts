/**
 * `nm provider model` subcommands.
 *
 * @module provider/model/commands
 */

import { formatApplicationModelId } from "@novel-master/core";
import type { NovelMasterRuntime } from "../../runtime.js";
import { resolveProviderId } from "../../config/resolve-provider-scope.js";
import { parseCliArgs } from "../../vfs/parse-args.js";
import { parseApplicationModelId } from "@novel-master/core";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

export async function runProviderModel(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);

  if (subcommand === "suggest") {
    const suggestSub = args[0];
    if (suggestSub !== "list") {
      throw new Error("Usage: nm provider model suggest list ...");
    }
    const providerId = await resolveProviderId(parseCliArgs(args.slice(1)).flags, rt.state);
    const list = await rt.providerModels.suggestList(providerId);
    for (const s of list) {
      console.log(
        `${s.vendorModelId}\t${s.displayName ?? ""}\t${s.stale ? 1 : 0}`,
      );
    }
    return;
  }

  const providerId = await resolveProviderId(flags, rt.state);

  switch (subcommand) {
    case "fetch": {
      await rt.providerModels.fetch(providerId);
      return;
    }
    case "save": {
      const vendorModelId = flagString(flags, "vendorModelId");
      if (!vendorModelId) {
        throw new Error(
          "Usage: nm provider model save --vendorModelId <id> [--displayName]",
        );
      }
      await rt.providerModels.save(
        providerId,
        vendorModelId,
        flagString(flags, "displayName"),
      );
      return;
    }
    case "create": {
      const vendorModelId = flagString(flags, "vendorModelId");
      if (!vendorModelId) {
        throw new Error(
          "Usage: nm provider model create --vendorModelId <id>",
        );
      }
      await rt.providerModels.create(providerId, vendorModelId);
      return;
    }
    case "list": {
      const list = await rt.providerModels.savedList(providerId);
      for (const m of list) {
        console.log(
          `${formatApplicationModelId(m.providerId, m.vendorModelId)}\t${m.displayName ?? ""}`,
        );
      }
      return;
    }
    case "edit": {
      const modelId = flagString(flags, "modelId");
      if (!modelId) {
        throw new Error(
          "Usage: nm provider model edit --modelId <provider>/<vendor> [--displayName]",
        );
      }
      const { providerId: pid, vendorModelId } = parseApplicationModelId(modelId);
      const displayName = flags.has("displayName")
        ? (flagString(flags, "displayName") ?? null)
        : undefined;
      await rt.providerModels.editSaved(pid, vendorModelId, displayName);
      return;
    }
    case "delete": {
      const modelId = flagString(flags, "modelId");
      if (!modelId) {
        throw new Error(
          "Usage: nm provider model delete --modelId <provider>/<vendor>",
        );
      }
      const { providerId: pid, vendorModelId } = parseApplicationModelId(modelId);
      await rt.providerModels.deleteSaved(pid, vendorModelId);
      return;
    }
    default:
      throw new Error(
        "Usage: nm provider model <suggest list|fetch|save|create|list|edit|delete> ...",
      );
  }
}
