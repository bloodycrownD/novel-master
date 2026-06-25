/**
 * `nm provider model sampling` subcommands (reads/writes `settings_json.sampling`).
 *
 * @module provider/model/sampling-commands
 */

import { readFile } from "node:fs/promises";
import {
  parseApplicationModelId,
  savedModelSampling,
  savedModelSettingsFromJson,
  savedModelSettingsToJson,
} from "@novel-master/core/provider";
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

  const saved = await rt.providerModels.getSaved(modelId);
  if (saved == null) {
    throw new Error(
      `Model not saved: ${modelId} (run: nm provider model save --vendorModelId ${vendorModelId})`,
    );
  }

  switch (subcommand) {
    case "show": {
      const sampling = savedModelSampling(saved.settings);
      console.log(
        JSON.stringify(
          {
            enabled: sampling.enabled,
            ...(sampling.params != null ? { params: sampling.params } : {}),
          },
          null,
          2,
        ),
      );
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
      const doc = JSON.parse(raw) as unknown;
      const base = savedModelSettingsToJson(saved.settings);
      const parsed = savedModelSettingsFromJson({
        ...base,
        generation: {
          ...base.generation,
          sampling: {
            enabled: Boolean((doc as { enabled?: boolean }).enabled),
            params: (doc as { params?: unknown }).params,
          },
        },
      });
      await rt.providerModels.updateSettings(providerId, vendorModelId, {
        sampling: savedModelSampling(parsed),
      });
      return;
    }
    case "clear": {
      await rt.providerModels.updateSettings(providerId, vendorModelId, {
        sampling: { enabled: false },
      });
      return;
    }
    default:
      throw new Error(
        "Usage: nm provider model sampling <show|set|clear> --modelId <provider>/<vendor>",
      );
  }
}
