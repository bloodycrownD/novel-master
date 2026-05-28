/**
 * `nm agent` subcommands.
 *
 * @module agent/commands
 */

import { readFile } from "node:fs/promises";
import {
  ChatAgentSession,
  createAgentRunner,
  DefaultCompactionService,
  parsePromptYaml,
  registerVfsTools,
  textBlocks,
  ToolRegistry,
  type LlmStreamEvent,
} from "@novel-master/core";
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

async function loadPromptBlocks(promptPath: string | undefined) {
  if (promptPath == null) {
    return [] as ReturnType<typeof parsePromptYaml>;
  }
  const source = await readFile(promptPath, "utf8");
  return parsePromptYaml(source);
}

async function resolveMaxSteps(
  flags: ReadonlyMap<string, string | true>,
  config: NovelMasterRuntime["config"],
  defaultSteps: number,
): Promise<number> {
  const fromFlag = flagString(flags, "max-steps");
  if (fromFlag != null) {
    const n = Number(fromFlag);
    if (!Number.isFinite(n) || n < 1) {
      throw new Error("--max-steps must be a positive integer");
    }
    return Math.floor(n);
  }
  return config.getNumber("agent.maxSteps", defaultSteps);
}

export async function runAgent(
  rt: NovelMasterRuntime,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);

  switch (subcommand) {
    case "run":
    case "continue": {
      const { projectId, sessionId } = await rt.scope.resolveProjectSession(flags);
      const modelId = await resolveModelId(flags, rt.config);
      const promptPath = flagString(flags, "prompt-path");
      const content = flagString(flags, "content");
      const noStream = flags.get("no-stream") === true;

      const maxSteps =
        subcommand === "continue"
          ? 1
          : await resolveMaxSteps(flags, rt.config, 20);

      if (content != null) {
        await rt.messages.append(sessionId, "user", textBlocks(content));
      } else if (subcommand === "continue") {
        const all = await rt.messages.listBySession(sessionId);
        const visible = all.filter((m) => !m.hidden);
        const last = visible[visible.length - 1];
        if (last?.role === "user") {
          // continue without --content: last message already user — do not append
        } else if (last == null) {
          throw new Error(
            "No messages in session; use --content <text> or append a user message first",
          );
        }
      }

      const blocks = await loadPromptBlocks(promptPath);
      const allMessages = await rt.messages.listBySession(sessionId);
      const messages = allMessages.filter((m) => !m.hidden);
      const worktreeDisplay = await rt
        .worktree({ kind: "session", projectId, sessionId })
        .renderDisplay();

      const registry = new ToolRegistry();
      const vfs = rt.sessionVfs(projectId, sessionId);
      registerVfsTools(registry);

      const session = new ChatAgentSession(rt.messages, sessionId);
      const compaction = new DefaultCompactionService({
        config: rt.config,
        modelRequests: rt.modelRequests,
      });

      const runner = createAgentRunner({
        session,
        modelRequests: rt.modelRequests,
        registry,
        toolCtx: { vfs },
        compaction,
      });

      const onStream =
        noStream
          ? undefined
          : (ev: LlmStreamEvent) => {
              if (ev.type === "text-delta") {
                process.stdout.write(ev.text);
              }
            };

      const result = await runner.run({
        maxSteps,
        applicationModelId: modelId,
        promptBlocks: blocks,
        promptContext: { worktreeDisplay, messages },
        stream: !noStream,
        onStream,
      });

      if (!noStream) {
        process.stdout.write("\n");
      }

      if (process.env.NM_AGENT_VERBOSE === "1") {
        console.error(
          JSON.stringify({
            stepsExecuted: result.stepsExecuted,
            finished: result.finished,
            stopReason: result.stopReason,
          }),
        );
      }
      return;
    }
    default:
      throw new Error(
        "Usage: nm agent <run|continue> [--content <text>] [--prompt-path <file>] [--max-steps <n>] [--no-stream] [--session] [--project] [--modelId]",
      );
  }
}
