/**
 * `nm agent` subcommands.
 *
 * @module agent/commands
 */

import { readFile } from "node:fs/promises";
import {
  ChatAgentSession,
  createAgentRunner,
  loadPromptBlocksFromYaml,
  parseApplicationModelId,
  registerVfsTools,
  resolveAgentToolRegistry,
  textBlocks,
  ToolRegistry,
  validateAgentDefinition,
  type AgentDefinition,
  type LlmStreamEvent,
} from "@novel-master/core";
import type { NovelMasterRuntime } from "../runtime.js";
import { buildMinimalDefinition } from "../config/build-minimal-definition.js";
import { loadAgentFromConfig } from "../config/load-agent-config-file.js";
import { resolveCliApplicationModelId } from "./resolve-application-model-id.js";
import {
  createRegistryValidateOptions,
  runAgentRegistryCommand,
} from "./registry-commands.js";
import { parseCliArgs } from "../vfs/parse-args.js";
import { AgentConfigError } from "@novel-master/core";

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
): Promise<AgentDefinition> {
  const agentConfigPath = flagString(flags, "agent-config");
  const agentId = flagString(flags, "agent-id");
  const promptPath = flagString(flags, "prompt-path");

  let definition: AgentDefinition;
  if (agentConfigPath != null) {
    definition = await loadAgentFromConfig(agentConfigPath, agentId);
  } else if (agentId != null && agentId !== "") {
    try {
      definition = await rt.agentRegistry.get(agentId);
    } catch (error) {
      if (error instanceof AgentConfigError && error.code === "AGENT_NOT_FOUND") {
        throw new Error(
          `agent not found in registry: ${agentId} (run nm agent import first)`,
        );
      }
      throw error;
    }
  } else if (promptPath != null) {
    const source = await readFile(promptPath, "utf8");
    const blocks = loadPromptBlocksFromYaml(source);
    definition = buildMinimalDefinition({ prompts: blocks });
  } else {
    const currentAgentId = await rt.state.getCurrentAgentId();
    if (currentAgentId != null && currentAgentId !== "") {
      try {
        definition = await rt.agentRegistry.get(currentAgentId);
      } catch (error) {
        if (error instanceof AgentConfigError && error.code === "AGENT_NOT_FOUND") {
          throw new Error(
            `agent not found in registry: ${currentAgentId} (run nm agent import first)`,
          );
        }
        throw error;
      }
    } else {
      definition = buildMinimalDefinition({ prompts: [] });
    }
  }

  const toolProbe = new ToolRegistry();
  registerVfsTools(toolProbe);
  await validateAgentDefinition(definition, {
    assertSavedModel: async (applicationModelId) => {
      const { providerId, vendorModelId } =
        parseApplicationModelId(applicationModelId);
      const list = await rt.providerModels.savedList(providerId);
      if (!list.some((m) => m.vendorModelId === vendorModelId)) {
        throw new Error(`unknown model: ${applicationModelId}`);
      }
    },
    registeredToolNames: toolProbe.list(),
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
    case "list":
    case "show":
    case "import":
    case "export":
    case "migrate":
    case "delete":
      await runAgentRegistryCommand(rt, subcommand, args);
      return;
    case "run":
    case "continue": {
      const { projectId, sessionId } = await rt.scope.resolveProjectSession(flags);
      const content = flagString(flags, "content");
      const noStream = flags.get("no-stream") === true;

      const agentConfigPath = flagString(flags, "agent-config");
      const agentId = flagString(flags, "agent-id");
      const shouldSave = flags.get("save") === true;
      if (shouldSave) {
        if (agentConfigPath == null) {
          throw new Error("--save requires --agent-config <path>");
        }
        if (agentId == null || agentId === "") {
          throw new Error("--save requires --agent-id <id>");
        }
      }

      let definition = await resolveDefinition(rt, flags);
      if (shouldSave) {
        await rt.agentRegistry.upsert(
          agentId!,
          definition,
          createRegistryValidateOptions(rt),
        );
      }

      const { applicationModelId, workspaceModelId, cliModelId } =
        await resolveCliApplicationModelId({
          flags,
          definition,
          state: rt.state,
        });
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

      const wt = rt.worktree({ kind: "session", projectId, sessionId });
      await rt.macroCache.refresh(projectId, sessionId, () => wt.materialize());

      const baseRegistry = new ToolRegistry();
      const vfs = rt.sessionVfs(projectId, sessionId);
      registerVfsTools(baseRegistry);
      const registry = resolveAgentToolRegistry(baseRegistry, definition);

      const session = new ChatAgentSession(rt.messages, sessionId);
      const activeRegexGroupId = await rt.state.getCurrentRegexGroupId();
      const runner = createAgentRunner({
        session,
        modelRequests: rt.modelRequests,
        registry,
        toolCtx: {
          vfs,
          sessionFs: rt.sessionFs,
          projectId,
          sessionId,
        },
        regexConfig: rt.regexConfig,
        listAllSessionMessages: () => rt.messages.listBySession(sessionId),
        eventBus: rt.eventBus,
        macroCache: rt.macroCache,
        compactionConditions: rt.compactionConditionEvaluator,
        eventOrchestrator: rt.eventOrchestrator,
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
        sessionId,
        projectId,
        applicationModelId,
        workspaceModelId,
        cliModelId,
        maxSteps,
        activeRegexGroupId,
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
            rounds: result.rounds,
          }),
        );
      }
      return;
    }
    default:
      throw new Error(
        "Usage: nm agent <run|continue|list|show|import|export|migrate|delete> [--content <text>] [--agent-config <file>] [--agent-id <id>] [--save] [--prompt-path <file>] [--max-steps <n>] [--no-stream] [--session] [--project] [--modelId]",
      );
  }
}
