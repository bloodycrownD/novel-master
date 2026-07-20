/**
 * `nm prompt` subcommands.
 *
 * @module prompt/commands
 */

import { readFile } from "node:fs/promises";
import { formatPromptLlmInputForCliFromLayout } from "@novel-master/core/prompt";

import {
  countPromptLlmInput,
  isSavedModelUuidFormat,
  serializePromptLlmInput,
} from "@novel-master/core/provider";

import { applyRegexChannelForLlm } from "@novel-master/core/regex";
import { assembleWorkplaceDisplay } from "@novel-master/core/workplace";
import type { NovelMasterRuntime } from "../runtime.js";
import { loadAgentPromptLayoutFromYaml } from "../config/load-agent-prompt-layout.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runPrompt(
  rt: Pick<
    NovelMasterRuntime,
    | "messages"
    | "scope"
    | "worktree"
    | "sessionKkv"
    | "sessionVfs"
    | "state"
    | "regexConfig"
    | "tokenCounters"
    | "providerModels"
    | "savedModels"
  >,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  if (subcommand !== "render") {
    throw new Error(
      "Usage: novel-master prompt render --path <file> [--tokens] [--model <savedModelId>] [--project <id>] [--session <id>] [--db <path>]",
    );
  }

  const { flags } = parseCliArgs(args);
  const path = flags.get("path");
  if (typeof path !== "string") {
    throw new Error(
      "Usage: novel-master prompt render --path <file> [--tokens] [--model <savedModelId>] [--project <id>] [--session <id>] [--db <path>]",
    );
  }

  const source = await readFile(path, "utf8");
  const layout = loadAgentPromptLayoutFromYaml(source);
  const { projectId, sessionId } = await rt.scope.resolveProjectSession(flags);
  const allMessages = await rt.messages.listBySession(sessionId);
  const activeGroupId = await rt.state.getCurrentRegexGroupId();
  const messages = await applyRegexChannelForLlm(
    rt.regexConfig,
    activeGroupId,
    allMessages,
    allMessages.filter((m) => !m.hidden),
  );
  const wtScope = { kind: "session" as const, projectId, sessionId };
  const vfs = rt.sessionVfs(projectId, sessionId);
  const { workplaceDisplay } = await assembleWorkplaceDisplay(wtScope, {
    sessionKkv: rt.sessionKkv,
    workplace: rt.worktree(wtScope),
    vfs,
    layout,
  });
  const ctx = { workplaceDisplay, messages, vfs };
  const text = await formatPromptLlmInputForCliFromLayout(layout, ctx);
  if (text.length > 0) {
    process.stdout.write(text);
  }

  if (flags.get("tokens") === true) {
    const modelFlag = flags.get("model");
    let savedModelId: string | undefined;
    if (typeof modelFlag === "string") {
      savedModelId = modelFlag;
    } else {
      savedModelId = (await rt.state.getCurrentModelId()) ?? undefined;
    }

    if (savedModelId == null) {
      const serialized = await serializePromptLlmInput(layout, ctx);
      const tokenCount = rt.tokenCounters.heuristic.countText(serialized);
      console.error(
        JSON.stringify({
          tokenCount,
          model: null,
          counter: "heuristic",
          estimated: true,
          tokenizerFamily: "heuristic",
        }),
      );
      return;
    }

    if (!isSavedModelUuidFormat(savedModelId)) {
      console.error(
        `warning: invalid saved model id ${savedModelId}; using heuristic counter`,
      );
    }

    const tokenizerOverride = await rt.providerModels.getTokenCounterMode(
      savedModelId,
    );
    const result = await countPromptLlmInput({
      layout,
      ctx,
      savedModelId,
      registry: rt.tokenCounters,
      tokenizerOverride,
      savedModels: rt.savedModels,
    });

    console.error(
      JSON.stringify({
        tokenCount: result.tokenCount,
        model: savedModelId,
        counter: result.counterKind,
        estimated: result.estimated,
        tokenizerFamily: result.tokenizerFamily,
      }),
    );
  }
}
