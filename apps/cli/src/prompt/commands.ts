/**
 * `nm prompt` subcommands.
 *
 * @module prompt/commands
 */

import { readFile } from "node:fs/promises";
import { formatPromptLlmInputForCliFromLayout } from "@novel-master/core/prompt";

import { countPromptLlmInput, parseApplicationModelId, serializePromptLlmInput } from "@novel-master/core/provider";

import { applyRegexChannelForLlm } from "@novel-master/core/regex";
import type { NovelMasterRuntime } from "../runtime.js";
import { loadAgentPromptLayoutFromYaml } from "../config/load-agent-prompt-layout.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runPrompt(
  rt: Pick<
    NovelMasterRuntime,
    | "messages"
    | "scope"
    | "worktree"
    | "worktreeSnapshot"
    | "sessionVfs"
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
  const wt = rt.worktree({ kind: "session", projectId, sessionId });
  const snapshot = await rt.worktreeSnapshot.getOrRefresh(
    projectId,
    sessionId,
    () => wt.materialize(),
  );
  const vfs = rt.sessionVfs(projectId, sessionId);
  const ctx = { worktreeDisplay: snapshot.worktreeDisplay, messages, vfs };
  const text = await formatPromptLlmInputForCliFromLayout(layout, ctx);
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

    try {
      parseApplicationModelId(applicationModelId);
    } catch {
      console.error(
        `warning: invalid model id ${applicationModelId}; using heuristic counter`,
      );
    }

    const tokenizerOverride = await rt.providerModels.getTokenCounterMode(
      applicationModelId,
    );
    const result = await countPromptLlmInput({
      layout,
      ctx,
      applicationModelId,
      registry: rt.tokenCounters,
      tokenizerOverride,
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
