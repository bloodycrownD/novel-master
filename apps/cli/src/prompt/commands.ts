/**
 * `nm prompt` subcommands.
 *
 * @module prompt/commands
 */

import { readFile } from "node:fs/promises";
import {
  buildPromptLlmInput,
  formatPromptLlmInputForCli,
  loadPromptBlocksFromYaml,
  parseApplicationModelId,
  serializePromptLlmInput,
} from "@novel-master/core";
import type { NovelMasterRuntime } from "../runtime.js";
import { applyActiveRegexChannel } from "../regex/apply-channel.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runPrompt(
  rt: Pick<
    NovelMasterRuntime,
    | "messages"
    | "scope"
    | "worktree"
    | "state"
    | "regexConfig"
    | "tokenCounters"
    | "providerModels"
  >,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  if (subcommand !== "render") {
    throw new Error(
      "Usage: novel-master prompt render --path <file> [--tokens] [--model <applicationModelId>] [--project <id>] [--session <id>] [--db <path>]",
    );
  }

  const { flags } = parseCliArgs(args);
  const path = flags.get("path");
  if (typeof path !== "string") {
    throw new Error(
      "Usage: novel-master prompt render --path <file> [--tokens] [--model <applicationModelId>] [--project <id>] [--session <id>] [--db <path>]",
    );
  }

  const source = await readFile(path, "utf8");
  const blocks = loadPromptBlocksFromYaml(source);
  const { projectId, sessionId } = await rt.scope.resolveProjectSession(flags);
  const allMessages = await rt.messages.listBySession(sessionId);
  const activeGroupId = await rt.state.getCurrentRegexGroupId();
  const messages = await applyActiveRegexChannel(
    rt.regexConfig,
    activeGroupId,
    allMessages,
    allMessages.filter((m) => !m.hidden),
    "llm",
  );
  const worktreeDisplay = await rt
    .worktree({ kind: "session", projectId, sessionId })
    .renderDisplay();

  const ctx = { worktreeDisplay, messages };
  const input = buildPromptLlmInput(blocks, ctx);
  const text = formatPromptLlmInputForCli(blocks, input, ctx);
  if (text.length > 0) {
    process.stdout.write(text);
  }

  if (flags.get("tokens") === true) {
    const serialized = serializePromptLlmInput(input);
    const modelFlag = flags.get("model");
    const modelId = typeof modelFlag === "string" ? modelFlag : null;

    let counter = rt.tokenCounters.heuristic;
    if (modelId != null) {
      try {
        const { providerId, vendorModelId } = parseApplicationModelId(modelId);
        const saved = await rt.providerModels.savedList(providerId);
        if (!saved.some((m) => m.vendorModelId === vendorModelId)) {
          console.error(
            `warning: model ${modelId} not saved; using heuristic counter`,
          );
        } else {
          counter = rt.tokenCounters.forApplicationModel(modelId);
        }
      } catch {
        console.error(
          `warning: invalid model id ${modelId}; using heuristic counter`,
        );
      }
    }

    const tokenCount = counter.countText(serialized);
    console.error(
      JSON.stringify({
        tokenCount,
        model: modelId,
        counter: counter.kind,
        counterKind: counter.kind,
      }),
    );
  }
}
