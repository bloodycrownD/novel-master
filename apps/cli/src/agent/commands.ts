/**
 * `nm agent` subcommands.
 *
 * @module agent/commands
 */

import { readFile } from "node:fs/promises";
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";

import {
  AgentConfigError,
  runAgentTurn,
  validateAgentDefinition,
  type AgentDefinition,
} from "@novel-master/core/agent";

import { assertSavedModelUuid, type LlmStreamEvent } from "@novel-master/core/provider";
import type { NovelMasterRuntime } from "../runtime.js";
import { buildMinimalDefinition } from "../config/build-minimal-definition.js";
import { loadAgentFromConfig } from "../config/load-agent-config-file.js";
import { loadAgentPromptLayoutFromYaml } from "../config/load-agent-prompt-layout.js";
import {
  createRegistryValidateOptions,
  runAgentRegistryCommand,
} from "./registry-commands.js";
import { parseCliArgs } from "../vfs/parse-args.js";

function flagString(
  flags: ReadonlyMap<string, string | true>,
  key: string,
): string | undefined {
  const v = flags.get(key);
  return typeof v === "string" ? v : undefined;
}

async function validateDefinitionForCli(
  rt: NovelMasterRuntime,
  definition: AgentDefinition,
): Promise<void> {
  const toolProbe = new ToolRegistry();
  registerBuiltinTools(toolProbe);
  await validateAgentDefinition(definition, {
    assertSavedModel: async (savedModelId) => {
      await assertSavedModelUuid(savedModelId, rt.savedModels);
    },
    registeredToolNames: toolProbe.list(),
  });
}

/**
 * 仅当 `--agent-config` / `--agent-id` / `--prompt-path` 之一存在时解析 definition；
 * 无 flag 时返回 undefined，由 runAgentTurn 内 resolveAgentForProject 处理。
 */
async function tryResolveDefinitionFromFlags(
  rt: NovelMasterRuntime,
  flags: ReadonlyMap<string, string | true>,
): Promise<AgentDefinition | undefined> {
  const agentConfigPath = flagString(flags, "agent-config");
  const agentId = flagString(flags, "agent-id");
  const promptPath = flagString(flags, "prompt-path");

  if (agentConfigPath == null && agentId == null && promptPath == null) {
    return undefined;
  }

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
    const layout = loadAgentPromptLayoutFromYaml(source);
    definition = buildMinimalDefinition({ layout });
  } else {
    return undefined;
  }

  await validateDefinitionForCli(rt, definition);
  return definition;
}

function parseMaxStepsFlag(
  flags: ReadonlyMap<string, string | true>,
): number | undefined {
  const fromFlag = flagString(flags, "max-steps");
  if (fromFlag == null) {
    return undefined;
  }
  const n = Number(fromFlag);
  if (!Number.isFinite(n) || n < 1) {
    throw new Error("--max-steps must be a positive integer");
  }
  return Math.floor(n);
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
      const cliModelId = flagString(flags, "modelId");

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

      const definitionFromFlags = await tryResolveDefinitionFromFlags(rt, flags);
      if (shouldSave) {
        if (definitionFromFlags == null) {
          throw new Error("--save requires --agent-config <path>");
        }
        await rt.agentRegistry.upsert(
          agentId!,
          definitionFromFlags,
          createRegistryValidateOptions(rt),
        );
      }

      const options: {
        stream: boolean;
        cliModelId?: string;
        maxStepsOverride?: number;
        onStream?: (ev: LlmStreamEvent) => void;
        definitionOverride?: AgentDefinition;
        allowResumeWithoutInput?: boolean;
        allowAssistantContinue?: boolean;
      } = {
        stream: !noStream,
        ...(cliModelId != null ? { cliModelId } : {}),
        maxStepsOverride:
          subcommand === "continue" ? 1 : parseMaxStepsFlag(flags),
        onStream: noStream
          ? undefined
          : (ev: LlmStreamEvent) => {
              if (ev.type === "text-delta") {
                process.stdout.write(ev.text);
              }
            },
      };

      if (definitionFromFlags != null) {
        options.definitionOverride = definitionFromFlags;
      }

      if (subcommand === "continue" && (content == null || content === "")) {
        const all = await rt.messages.listBySession(sessionId);
        const visible = all.filter((m) => !m.hidden);
        const lastVisible = visible[visible.length - 1];
        if (lastVisible?.role === "user") {
          options.allowResumeWithoutInput = true;
        } else if (lastVisible?.role === "assistant") {
          options.allowAssistantContinue = true;
        } else if (lastVisible == null) {
          throw new Error(
            "No messages in session; use --content <text> or append a user message first",
          );
        }
      }

      const result = await runAgentTurn(
        rt,
        { projectId, sessionId },
        content ?? "",
        options,
      );

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
