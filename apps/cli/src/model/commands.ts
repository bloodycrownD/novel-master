/**
 * `nm model` subcommands.
 *
 * @module model/commands
 */

import { textBlocks } from "@novel-master/core/chat";
import { AppError } from "@novel-master/core/agent";
import { Result } from "@novel-master/core/errors";

import {
  assertSavedModelUuid,
  savedModelDisplayName,
} from "@novel-master/core/provider";

import type { NovelMasterRuntime } from "../runtime.js";
import { RESULT_OK } from "../cli-errors.js";
import { resolveModelId } from "../config/resolve-provider-scope.js";
import { parseCliArgs } from "../vfs/parse-args.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

// nm-style: keep-local — CLI 子命令分发 handler：main.ts 按 domain 单点分发，
// 内联会把 model 域整个 subcommand switch 搬进分发器，破坏 main 的路由结构。
/**
 * repo 读的 `Result` 失败沿返回值交给上层（错误通道迁移四期），由 main.ts 统一出口收口。
 */
export async function runModel(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<Result<void, AppError>> {
  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "use": {
      const modelId = flagString(flags, "modelId");
      if (!modelId) {
        throw new Error("Usage: nm model use --modelId <uuid>");
      }
      const saved = await assertSavedModelUuid(modelId, rt.savedModels);
      if (!saved.ok) return Result.err(saved.error);
      await rt.state.setCurrentModelId(saved.value.id);
      return RESULT_OK;
    }
    case "current": {
      const currentModel = await rt.state.getCurrentModelId();
      if (!currentModel.ok) return Result.err(currentModel.error);
      const modelId = currentModel.value;
      if (modelId == null || modelId === "") {
        throw new Error(
          "No current model (run: nm model use --modelId <uuid>)",
        );
      }
      const saved = await rt.savedModels.findById(modelId);
      if (!saved.ok) return Result.err(saved.error);
      if (saved.value == null) {
        return Result.err(new AppError("PROVIDER_INVALID_SAVED_MODEL_ID", { detail: `Saved model not found: ${modelId}`, modelId }));
      }
      const provider = await rt.providers.get(saved.value.providerId);
      if (!provider.ok) return Result.err(provider.error);
      console.log(savedModelDisplayName(saved.value, provider.value.displayName));
      return RESULT_OK;
    }
    case "list": {
      const listed = await rt.providers.list();
      if (!listed.ok) return Result.err(listed.error);
      for (const provider of listed.value) {
        const list = await rt.providerModels.savedList(provider.id);
        if (!list.ok) return Result.err(list.error);
        for (const m of list.value) {
          console.log(
            `${m.id}\t${savedModelDisplayName(m, provider.displayName)}\t${m.vendorModelId}`,
          );
        }
      }
      return RESULT_OK;
    }
    case "request": {
      const content = flagString(flags, "content");
      if (!content) {
        throw new Error(
          "Usage: nm model request --content <text> [--session <id>] [--modelId <uuid>] [--raw]",
        );
      }
      const resolvedModel = await resolveModelId(flags, rt.state, rt.savedModels);
      if (!resolvedModel.ok) return Result.err(resolvedModel.error);
      const modelId = resolvedModel.value;
      const sessionId = flagString(flags, "session");

      if (sessionId != null) {
        await rt.messages.append(sessionId, "user", textBlocks(content));
        const all = await rt.messages.listBySession(sessionId);
        const history = all.filter((m) => !m.hidden);
        const requested = await rt.modelRequests.request(modelId, content, {
          history,
        });
        if (!requested.ok) return Result.err(requested.error);
        const result = requested.value;
        await rt.messages.append(
          sessionId,
          "assistant",
          { blocks: result.blocks },
          { raw: result.raw as Record<string, unknown> },
        );
        if (flags.get("raw") === true) {
          console.log(JSON.stringify(result.raw));
        } else {
          console.log(result.assistantText);
        }
        return RESULT_OK;
      }

      const requested = await rt.modelRequests.request(modelId, content);
      if (!requested.ok) return Result.err(requested.error);
      const result = requested.value;
      if (flags.get("raw") === true) {
        console.log(JSON.stringify(result.raw));
      } else {
        console.log(result.assistantText);
      }
      return RESULT_OK;
    }
    default:
      throw new Error("Usage: nm model <use|current|list|request> ...");
  }
}
