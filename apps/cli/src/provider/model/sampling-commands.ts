/**
 * `nm provider model sampling` subcommands (reads/writes `settings_json.sampling`).
 *
 * @module provider/model/sampling-commands
 */

import { readFile } from "node:fs/promises";
import {
  assertSavedModelUuid,
  savedModelSampling,
  savedModelSettingsFromJson,
  savedModelSettingsToJson,
} from "@novel-master/core/provider";
import { type AppError, Result } from "@novel-master/core/errors";
import type { NovelMasterRuntime } from "../../runtime.js";
import { RESULT_OK } from "../../cli-errors.js";
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
      "Usage: nm provider model sampling <show|set|clear> --modelId <uuid> [--file <path>]",
    );
  }
  return modelId;
}

/**
 * save / parse 的 `Result` 失败沿返回值交给上层（错误通道迁移四期），由 main.ts 统一出口收口。
 */
export async function runProviderModelSampling(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<Result<void, AppError>> {
  const { flags } = parseCliArgs(args);
  const modelId = requireModelId(flags);
  const saved = await assertSavedModelUuid(modelId, rt.savedModels);
  if (!saved.ok) return Result.err(saved.error);

  switch (subcommand) {
    case "show": {
      const sampling = savedModelSampling(saved.value.settings);
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
      return RESULT_OK;
    }
    case "set": {
      const filePath = flagString(flags, "file");
      if (filePath == null) {
        throw new Error(
          "Usage: nm provider model sampling set --modelId <uuid> --file <json|yaml>",
        );
      }
      const raw = await readFile(filePath, "utf8");
      const doc = JSON.parse(raw) as unknown;
      const base = savedModelSettingsToJson(saved.value.settings);
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
      if (!parsed.ok) return Result.err(parsed.error);
      await rt.providerModels.updateSettings(saved.value.id, {
        sampling: savedModelSampling(parsed.value),
      });
      return RESULT_OK;
    }
    case "clear": {
      await rt.providerModels.updateSettings(saved.value.id, {
        sampling: { enabled: false },
      });
      return RESULT_OK;
    }
    default:
      throw new Error(
        "Usage: nm provider model sampling <show|set|clear> --modelId <uuid>",
      );
  }
}
