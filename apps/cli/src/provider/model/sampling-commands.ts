/**
 * `nm provider model sampling` subcommands (KKV profiles per saved model).
 *
 * @module provider/model/sampling-commands
 */

import { readFile } from "node:fs/promises";
import {
  modelSamplingProfileFromJson,
  modelSamplingProfileToJson,
  parseApplicationModelId,
} from "@novel-master/core";
import type { NovelMasterRuntime } from "../../runtime.js";
import { parseCliArgs } from "../../vfs/parse-args.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

function requireModelId(flags: ReadonlyMap<string, string | true>): string {
  const modelId = flagString(flags, "modelId");
  if (modelId == null) {
    throw new Error(
      "Usage: nm provider model sampling <show|set|clear> --modelId <provider>/<vendor> [--file <path>]",
    );
  }
  return modelId;
}

export async function runProviderModelSampling(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const modelId = requireModelId(flags);
  const { providerId, vendorModelId } = parseApplicationModelId(modelId);

  const saved = await rt.providerModels.savedList(providerId);
  if (!saved.some((m) => m.vendorModelId === vendorModelId)) {
    throw new Error(
      `Model not saved: ${modelId} (run: nm provider model save --vendorModelId ${vendorModelId})`,
    );
  }

  switch (subcommand) {
    case "show": {
      const profile = await rt.modelSamplingProfiles.getProfile(modelId);
      if (profile == null) {
        console.log(JSON.stringify({ enabled: false }, null, 2));
        return;
      }
      console.log(JSON.stringify(modelSamplingProfileToJson(profile), null, 2));
      return;
    }
    case "set": {
      const filePath = flagString(flags, "file");
      if (filePath == null) {
        throw new Error(
          "Usage: nm provider model sampling set --modelId <id> --file <json|yaml>",
        );
      }
      const raw = await readFile(filePath, "utf8");
      const profile = modelSamplingProfileFromJson(JSON.parse(raw) as unknown);
      await rt.modelSamplingProfiles.setProfile(modelId, profile);
      return;
    }
    case "clear": {
      await rt.modelSamplingProfiles.clearProfile(modelId);
      return;
    }
    default:
      throw new Error(
        "Usage: nm provider model sampling <show|set|clear> --modelId <provider>/<vendor>",
      );
  }
}
