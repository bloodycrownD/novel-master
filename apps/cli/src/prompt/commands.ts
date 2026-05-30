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
} from "@novel-master/core";
import type { NovelMasterRuntime } from "../runtime.js";
import { applyActiveRegexChannel } from "../regex/apply-channel.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runPrompt(
  rt: Pick<
    NovelMasterRuntime,
    "messages" | "scope" | "worktree" | "state" | "regexConfig"
  >,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  if (subcommand !== "render") {
    throw new Error(
      "Usage: novel-master prompt render --path <file> [--project <id>] [--session <id>] [--db <path>]",
    );
  }

  const { flags } = parseCliArgs(args);
  const path = flags.get("path");
  if (typeof path !== "string") {
    throw new Error(
      "Usage: novel-master prompt render --path <file> [--project <id>] [--session <id>] [--db <path>]",
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
}
