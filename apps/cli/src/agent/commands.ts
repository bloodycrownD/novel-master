/**
 * `nm agent` subcommands.
 *
 * @module agent/commands
 */

import { readFile } from "node:fs/promises";
import {
  ChatAgentSession,
  createAgentRunner,
  createCompactionPipeline,
  loadPromptBlocksFromYaml,
  parseApplicationModelId,
  registerVfsTools,
  textBlocks,
  ToolRegistry,
  validateAgentDefinition,
  type AgentDefinition,
  type LlmStreamEvent,
} from "@novel-master/core";
import type { NovelMasterRuntime } from "../runtime.js";
import { buildMinimalDefinition } from "../config/build-minimal-definition.js";
import { loadAgentConfigFile } from "../config/load-agent-config-file.js";
import { resolveModelId } from "../config/resolve-provider-scope.js";
import { parseCliArgs } from "../vfs/parse-args.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

async function resolveDefinition(
  rt: NovelMasterRuntime,
  flags: ReadonlyMap<string, string | true>,
  modelId: string,
): Promise<AgentDefinition> {
  const agentConfigPath = flagString(flags, "agent-config");
  const promptPath = flagString(flags, "prompt-path");
  const modelOverride = flagString(flags, "modelId");

  let definition: AgentDefinition;
  if (agentConfigPath != null) {
    definition = await loadAgentConfigFile(agentConfigPath);
  } else if (promptPath != null) {
    const source = await readFile(promptPath, "utf8");
    const blocks = loadPromptBlocksFromYaml(source);
    definition = buildMinimalDefinition({
      prompts: blocks,
      applicationModelId: modelId,
    });
  } else {
    definition = buildMinimalDefinition({
      prompts: [],
      applicationModelId: modelId,
    });
  }

  const effectiveModelId = modelOverride ?? definition.model.applicationModelId;
  if (effectiveModelId !== definition.model.applicationModelId) {
    definition = {
      ...definition,
      model: { ...definition.model, applicationModelId: effectiveModelId },
    };
  } else if (agentConfigPath == null && promptPath == null) {
    definition = {
      ...definition,
      model: { ...definition.model, applicationModelId: modelId },
    };
  }

  await validateAgentDefinition(definition, {
    getProtocolForModel: async (applicationModelId) => {
      const { providerId } = parseApplicationModelId(applicationModelId);
      try {
        const provider = await rt.providers.get(providerId);
        return provider.protocol;
      } catch {
        return undefined;
      }
    },
  });

  return definition;
}

async function resolveMaxSteps(
  flags: ReadonlyMap<string, string | true>,
  definition: AgentDefinition,
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
  return definition.runtime?.maxSteps ?? defaultSteps;
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
      const agentConfigPath = flagString(flags, "agent-config");
      const modelId =
        agentConfigPath != null && flagString(flags, "modelId") == null
          ? (await loadAgentConfigFile(agentConfigPath)).model.applicationModelId
          : await resolveModelId(flags, rt.state);
      const content = flagString(flags, "content");
      const noStream = flags.get("no-stream") === true;

      const definition = await resolveDefinition(rt, flags, modelId);
      const maxSteps =
        subcommand === "continue"
          ? 1
          : await resolveMaxSteps(flags, definition, 20);

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

      const worktreeDisplay = await rt
        .worktree({ kind: "session", projectId, sessionId })
        .renderDisplay();

      const registry = new ToolRegistry();
      const vfs = rt.sessionVfs(projectId, sessionId);
      registerVfsTools(registry);

      const session = new ChatAgentSession(rt.messages, sessionId);
      const runner = createAgentRunner({
        session,
        modelRequests: rt.modelRequests,
        registry,
        toolCtx: { vfs },
        compaction: createCompactionPipeline({
          modelRequests: rt.modelRequests,
          policyStore: rt.compactionPolicy,
          resolveAgent: rt.resolveCompactionAgent,
        }),
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
        definition,
        maxSteps,
        promptContext: { worktreeDisplay },
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
        "Usage: nm agent <run|continue> [--content <text>] [--agent-config <file>] [--prompt-path <file>] [--max-steps <n>] [--no-stream] [--session] [--project] [--modelId]",
      );
  }
}
