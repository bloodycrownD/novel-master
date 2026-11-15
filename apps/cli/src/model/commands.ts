/**
 * `nm model` subcommands.
 *
 * @module model/commands
 */

import { textBlocks } from "@novel-master/core/chat";
import { AppError } from "@novel-master/core/agent";

import {
  assertSavedModelUuid,
  savedModelDisplayName,
} from "@novel-master/core/provider";

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

// nm-style: keep-local — CLI 子命令分发 handler：main.ts 按 domain 单点分发，
// 内联会把 model 域整个 subcommand switch 搬进分发器，破坏 main 的路由结构。
/**
 * 解包 throw 边界（错误通道迁移三期门⑦）：save 的 `Result` 失败原样上抛（core Result → CLI 异常通道转码点），由 main.ts 两个边界 catch（exitCodeForError + formatCliError）收口。
 */
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
        throw new Error("Usage: nm model use --modelId <uuid>");
      }
      const saved = await assertSavedModelUuid(modelId, rt.savedModels);
      if (!saved.ok) throw saved.error;
      await rt.state.setCurrentModelId(saved.value.id);
      return;
    }
    case "current": {
      const modelId = await rt.state.getCurrentModelId();
      if (modelId == null || modelId === "") {
        throw new Error(
          "No current model (run: nm model use --modelId <uuid>)",
        );
      }
      const saved = await rt.savedModels.findById(modelId);
      if (saved == null) {
        throw new AppError("PROVIDER_INVALID_SAVED_MODEL_ID", { detail: `Saved model not found: ${modelId}`, modelId });
      }
      const provider = await rt.providers.get(saved.providerId);
      console.log(savedModelDisplayName(saved, provider.displayName));
      return;
    }
    case "list": {
      const providers = await rt.providers.list();
      for (const provider of providers) {
        const list = await rt.providerModels.savedList(provider.id);
        for (const m of list) {
          console.log(
            `${m.id}\t${savedModelDisplayName(m, provider.displayName)}\t${m.vendorModelId}`,
          );
        }
      }
      return;
    }
    case "request": {
      const content = flagString(flags, "content");
      if (!content) {
        throw new Error(
          "Usage: nm model request --content <text> [--session <id>] [--modelId <uuid>] [--raw]",
        );
      }
      const modelId = await resolveModelId(flags, rt.state, rt.savedModels);
      const sessionId = flagString(flags, "session");

      if (sessionId != null) {
        await rt.messages.append(sessionId, "user", textBlocks(content));
        const all = await rt.messages.listBySession(sessionId);
        const history = all.filter((m) => !m.hidden);
        const result = await rt.modelRequests.request(modelId, content, {
          history,
        });
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
        return;
      }

      const result = await rt.modelRequests.request(modelId, content);
      if (flags.get("raw") === true) {
        console.log(JSON.stringify(result.raw));
      } else {
        console.log(result.assistantText);
      }
      return;
    }
    default:
      throw new Error("Usage: nm model <use|current|list|request> ...");
  }
}
