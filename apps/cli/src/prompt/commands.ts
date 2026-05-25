/**
 * `nm prompt` subcommands.
 *
 * @module prompt/commands
 */

import { readFile } from "node:fs/promises";
import {
  parsePromptYaml,
  renderPromptToText,
} from "@novel-master/core";
import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runPrompt(
  rt: Pick<NovelMasterRuntime, "messages" | "scope" | "worktree">,
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
  const blocks = parsePromptYaml(source);
  const { projectId, sessionId } = await rt.scope.resolveProjectSession(flags);
  const allMessages = await rt.messages.listBySession(sessionId);
  // Filter out hidden messages from prompt rendering
  const messages = allMessages.filter((m) => !m.hidden);
  const worktreeDisplay = await rt
    .worktree({ kind: "session", projectId, sessionId })
    .renderDisplay();

  const text = renderPromptToText(blocks, { worktreeDisplay, messages });
  if (text.length > 0) {
    process.stdout.write(text);
  }
}
