/**
 * `nm prompt` subcommands.
 *
 * @module prompt/commands
 */

import { readFile } from "node:fs/promises";
import {
  applyRegexChannelForLlm,
  countPromptLlmInput,
  formatPromptLlmInputForCli,
  loadPromptBlocksFromYaml,
  parseApplicationModelId,
  serializePromptLlmInput,
} from "@novel-master/core";
import type { NovelMasterRuntime } from "../runtime.js";
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
  const messages = await applyRegexChannelForLlm(
    rt.regexConfig,
    activeGroupId,
    allMessages,
    allMessages.filter((m) => !m.hidden),
  );
  const wt = rt.worktree({ kind: "session", projectId, sessionId });
  const [worktreeDisplay, filetreeDisplay] = await Promise.all([
    wt.renderDisplay(),
    wt.renderFileTree(),
  ]);

  const ctx = { worktreeDisplay, filetreeDisplay, messages };
  const text = formatPromptLlmInputForCli(blocks, ctx);
  if (text.length > 0) {
    process.stdout.write(text);
  }

  if (flags.get("tokens") === true) {
    const modelFlag = flags.get("model");
    let applicationModelId: string | undefined;
    if (typeof modelFlag === "string") {
      applicationModelId = modelFlag;
    } else {
      applicationModelId = (await rt.state.getCurrentModelId()) ?? undefined;
    }

    if (applicationModelId == null) {
      const serialized = serializePromptLlmInput(blocks, ctx);
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

    try {
      parseApplicationModelId(applicationModelId);
    } catch {
      console.error(
        `warning: invalid model id ${applicationModelId}; using heuristic counter`,
      );
    }

    const result = await countPromptLlmInput({
      blocks,
      ctx,
      applicationModelId,
      registry: rt.tokenCounters,
    });

    console.error(
      JSON.stringify({
        tokenCount: result.tokenCount,
        model: applicationModelId,
        counter: result.counterKind,
        estimated: result.estimated,
        tokenizerFamily: result.tokenizerFamily,
      }),
    );
  }
}
