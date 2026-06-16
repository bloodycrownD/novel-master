/**
 * `nm provider model` subcommands.
 *
 * @module provider/model/commands
 */

import { formatApplicationModelId, isValidTokenCounterModePref, type TokenizerOverride } from "@novel-master/core/provider";
import { type SavedModelSettingsPatch } from "@novel-master/core/provider";
import type { NovelMasterRuntime } from "../../runtime.js";
import { resolveProviderId } from "../../config/resolve-provider-scope.js";
import { parseCliArgs } from "../../vfs/parse-args.js";
import { parseApplicationModelId } from "@novel-master/core/provider";
import { runProviderModelSampling } from "./sampling-commands.js";

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

  if (subcommand === "sampling") {
    const samplingSub = args[0];
    if (samplingSub == null) {
      throw new Error(
        "Usage: nm provider model sampling <show|set|clear> --modelId <provider>/<vendor>",
      );
    }
    await runProviderModelSampling(rt, samplingSub, args.slice(1));
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
          "Usage: nm provider model edit --modelId <provider>/<vendor> [--displayName] [--contextWindowTokens N] [--tokenCounterMode <mode>] [--resetContextWindow]",
        );
      }
      const { providerId: pid, vendorModelId } = parseApplicationModelId(modelId);
      const displayName = flags.has("displayName")
        ? (flagString(flags, "displayName") ?? null)
        : undefined;
      if (displayName !== undefined) {
        await rt.providerModels.editSaved(pid, vendorModelId, displayName);
      }
      if (flags.has("resetContextWindow")) {
        await rt.providerModels.resetContextWindowToDefault(pid, vendorModelId);
      } else {
        const contextWindowRaw = flagString(flags, "contextWindowTokens");
        const tokenCounterModeRaw = flagString(flags, "tokenCounterMode");
        let contextWindowTokens: number | undefined;
        if (contextWindowRaw != null) {
          contextWindowTokens = Number(contextWindowRaw);
          if (!Number.isInteger(contextWindowTokens) || contextWindowTokens <= 0) {
            throw new Error("--contextWindowTokens must be a positive integer");
          }
        }
        let tokenCounterMode: TokenizerOverride | undefined;
        if (tokenCounterModeRaw != null) {
          if (!isValidTokenCounterModePref(tokenCounterModeRaw)) {
            throw new Error(
              `--tokenCounterMode must be one of: auto, heuristic, tiktoken, claude, ...`,
            );
          }
          tokenCounterMode = tokenCounterModeRaw as TokenizerOverride;
        }
        if (contextWindowTokens != null || tokenCounterMode != null) {
          const patch: SavedModelSettingsPatch = {
            ...(contextWindowTokens != null ? { contextWindowTokens } : {}),
            ...(tokenCounterMode != null ? { tokenCounterMode } : {}),
          };
          await rt.providerModels.updateSettings(pid, vendorModelId, patch);
        }
      }
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
        "Usage: nm provider model <suggest list|fetch|save|create|list|edit|delete|sampling> ...",
      );
  }
}
