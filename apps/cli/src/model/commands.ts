/**
 * `nm model` subcommands.
 *
 * @module model/commands
 */

import {
  parseApplicationModelId,
  ProviderError,
} from "@novel-master/core";
import type { NovelMasterRuntime } from "../runtime.js";
import { resolveModelId } from "../config/resolve-provider-scope.js";
import { parseCliArgs } from "../vfs/parse-args.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

export async function runModel(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "use": {
      const modelId = flagString(flags, "modelId");
      if (!modelId) {
        throw new Error("Usage: nm model use --modelId <provider>/<vendor>");
      }
      const { providerId, vendorModelId } = parseApplicationModelId(modelId);
      const saved = await rt.providerModels.savedList(providerId);
      if (!saved.some((m) => m.vendorModelId === vendorModelId)) {
        throw new ProviderError(
          "MODEL_NOT_SAVED",
          `Model not saved: ${modelId} (run: nm provider model save --vendorModelId ${vendorModelId})`,
          { modelId },
        );
      }
      await rt.config.set("currentModelId", modelId);
      return;
    }
    case "current": {
      const modelId = await rt.config.get("currentModelId");
      if (modelId == null || modelId === "") {
        throw new Error(
          "No current model (run: nm model use --modelId <provider>/<vendor>)",
        );
      }
      console.log(modelId);
      return;
    }
    case "request": {
      const content = flagString(flags, "content");
      if (!content) {
        throw new Error("Usage: nm model request --content <text> [--modelId] [--raw]");
      }
      const modelId = await resolveModelId(flags, rt.config);
      const result = await rt.modelRequests.request(modelId, content);
      if (flags.get("raw") === true) {
        console.log(JSON.stringify(result.raw));
      } else {
        console.log(result.assistantText);
      }
      return;
    }
    default:
      throw new Error("Usage: nm model <use|current|request> ...");
  }
}
