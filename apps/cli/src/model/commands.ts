/**
 * `nm model` subcommands.
 *
 * @module model/commands
 */

import { textBlocks } from "@novel-master/core/chat";

import {
  assertSavedModelUuid,
  ProviderError,
  savedModelDisplayName,
} from "@novel-master/core/provider";
import { depthByMessageId, listVisibleForDepth } from "@novel-master/core/compaction";

import { applyRegexChannelToMessages, resolveActiveCompiledRules } from "@novel-master/core/regex";
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
        throw new Error("Usage: nm model use --modelId <uuid>");
      }
      const saved = await assertSavedModelUuid(modelId, rt.savedModels);
      await rt.state.setCurrentModelId(saved.id);
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
        throw new ProviderError(
          "INVALID_SAVED_MODEL_ID",
          `Saved model not found: ${modelId}`,
          { modelId },
        );
      }
      console.log(savedModelDisplayName(saved));
      return;
    }
    case "list": {
      const providers = await rt.providers.list();
      for (const provider of providers) {
        const list = await rt.providerModels.savedList(provider.id);
        for (const m of list) {
          console.log(
            `${m.id}\t${savedModelDisplayName(m)}\t${m.vendorModelId}`,
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
        let history = all.filter((m) => !m.hidden);
        const activeGroupId = await rt.state.getCurrentRegexGroupId();
        const rules = await resolveActiveCompiledRules(
          rt.regexConfig,
          activeGroupId,
        );
        if (rules.length > 0) {
          const depthMap = depthByMessageId(listVisibleForDepth(all));
          history = applyRegexChannelToMessages(
            history,
            rules,
            "llm",
            depthMap,
          );
        }
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
