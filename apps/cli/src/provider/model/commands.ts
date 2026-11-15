/**
 * `nm provider model` subcommands.
 *
 * @module provider/model/commands
 */

import {
  assertSavedModelUuid,
  isValidTokenCounterModePref,
  savedModelDisplayName,
  type TokenizerOverride,
} from "@novel-master/core/provider";
import { type SavedModelSettingsPatch } from "@novel-master/core/provider";
import { type AppError, Result } from "@novel-master/core/errors";
import type { NovelMasterRuntime } from "../../runtime.js";
import { RESULT_OK } from "../../cli-errors.js";
import { resolveProviderId } from "../../config/resolve-provider-scope.js";
import { parseCliArgs } from "../../vfs/parse-args.js";
import { runProviderModelSampling } from "./sampling-commands.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

/**
 * 解析的 `Result` 失败沿返回值交给上层（错误通道迁移四期），由 main.ts 统一出口收口。
 */
async function requireSavedModelId(
  rt: NovelMasterRuntime,
  flags: ReadonlyMap<string, string | true>,
): Promise<Result<string, AppError>> {
  const modelId = flagString(flags, "modelId");
  if (modelId == null) {
    throw new Error("Missing --modelId <uuid>");
  }
  const saved = await assertSavedModelUuid(modelId, rt.savedModels);
  if (!saved.ok) return Result.err(saved.error);
  return Result.ok(saved.value.id);
}

export async function runProviderModel(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<Result<void, AppError>> {
  const { flags } = parseCliArgs(args);

  if (subcommand === "suggest") {
    const suggestSub = args[0];
    if (suggestSub !== "list") {
      throw new Error("Usage: nm provider model suggest list ...");
    }
    const resolvedProvider = await resolveProviderId(parseCliArgs(args.slice(1)).flags, rt.state);
    if (!resolvedProvider.ok) return Result.err(resolvedProvider.error);
    const providerId = resolvedProvider.value;
    const list = await rt.providerModels.suggestList(providerId);
    for (const s of list) {
      console.log(
        `${s.vendorModelId}\t${s.displayName ?? ""}\t${s.stale ? 1 : 0}`,
      );
    }
    return RESULT_OK;
  }

  if (subcommand === "sampling") {
    const samplingSub = args[0];
    if (samplingSub == null) {
      throw new Error(
        "Usage: nm provider model sampling <show|set|clear> --modelId <uuid>",
      );
    }
    return runProviderModelSampling(rt, samplingSub, args.slice(1));
  }

  const resolvedProvider = await resolveProviderId(flags, rt.state);
  if (!resolvedProvider.ok) return Result.err(resolvedProvider.error);
  const providerId = resolvedProvider.value;

  switch (subcommand) {
    case "fetch": {
      await rt.providerModels.fetch(providerId);
      return RESULT_OK;
    }
    case "save": {
      const vendorModelId = flagString(flags, "vendorModelId");
      if (!vendorModelId) {
        throw new Error(
          "Usage: nm provider model save --vendorModelId <id> [--modelName <name>]",
        );
      }
      await rt.providerModels.save(
        providerId,
        vendorModelId,
        flagString(flags, "modelName"),
      );
      return RESULT_OK;
    }
    case "create": {
      const vendorModelId = flagString(flags, "vendorModelId");
      if (!vendorModelId) {
        throw new Error(
          "Usage: nm provider model create --vendorModelId <id>",
        );
      }
      await rt.providerModels.create(providerId, vendorModelId);
      return RESULT_OK;
    }
    case "list": {
      const list = await rt.providerModels.savedList(providerId);
      const provider = await rt.providers.get(providerId);
      for (const m of list) {
        console.log(
          `${m.id}\t${savedModelDisplayName(m, provider.displayName)}\t${m.vendorModelId}`,
        );
      }
      return RESULT_OK;
    }
    case "edit": {
      const resolvedSavedModel = await requireSavedModelId(rt, flags);
      if (!resolvedSavedModel.ok) return Result.err(resolvedSavedModel.error);
      const savedModelId = resolvedSavedModel.value;
      if (
        !flags.has("modelName") &&
        !flags.has("resetContextWindow") &&
        flagString(flags, "contextWindowTokens") == null &&
        flagString(flags, "tokenCounterMode") == null
      ) {
        throw new Error(
          "Usage: nm provider model edit --modelId <uuid> [--modelName <name>] [--contextWindowTokens N] [--tokenCounterMode <mode>] [--resetContextWindow]",
        );
      }
      const modelName = flags.has("modelName")
        ? (flagString(flags, "modelName") ?? null)
        : undefined;
      if (modelName !== undefined) {
        await rt.providerModels.editSaved(savedModelId, modelName ?? undefined);
      }
      if (flags.has("resetContextWindow")) {
        await rt.providerModels.resetContextWindowToDefault(savedModelId);
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
          await rt.providerModels.updateSettings(savedModelId, patch);
        }
      }
      return RESULT_OK;
    }
    case "delete": {
      const resolvedSavedModel = await requireSavedModelId(rt, flags);
      if (!resolvedSavedModel.ok) return Result.err(resolvedSavedModel.error);
      await rt.providerModels.deleteSaved(resolvedSavedModel.value);
      return RESULT_OK;
    }
    default:
      throw new Error(
        "Usage: nm provider model <suggest list|fetch|save|create|list|edit|delete|sampling> ...",
      );
  }
}
