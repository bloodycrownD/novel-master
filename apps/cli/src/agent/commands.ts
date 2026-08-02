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

/**
 * Phase 0 兑底：CLI-only flag 被 core 移除后，本地检测到时打印「不再支持」警告到 stderr。
 * 仅提示，不中断流程。
 */
function warnUnsupportedFlag(
  flags: ReadonlyMap<string, string | true>,
  key: string,
  message: string,
): void {
  if (flags.has(key)) {
    process.stderr.write(`[nm] ${message}\n`);
  }
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

      // 已知限制（Phase 0 兑底）：core 已移除 cliModelId / definitionOverride /
      // allowAssistantContinue / maxStepsOverride 四个 CLI-only 入参。CLI 暂不再支持
      // --modelId 覆盖、transient definition 覆盖、assistant-continue 与 --max-steps。
      // 用户如需改 model/definition，请改 workspace 当前模型，或带 --save 写入 agent
      // registry 后再 run。详见 spec chat-session-detail-page Step 0d。
      warnUnsupportedFlag(
        flags,
        "modelId",
        "--modelId 不再支持覆盖；请改 workspace 当前模型或写入 agent registry",
      );
      warnUnsupportedFlag(
        flags,
        "max-steps",
        "--max-steps 不再支持；max-steps 以 definition.runtime.maxSteps 为准",
      );

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

      // --save 路径：解析 + 校验 definition，写入 agent registry（project custom 不走这里）。
      // 已知限制（Phase 0 兑底）：不带 --save 的 transient definition 覆盖不再支持，
      // definitionFromFlags 不再注入运行时。
      const definitionFromFlags = shouldSave
        ? await tryResolveDefinitionFromFlags(rt, flags)
        : undefined;
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

      // 已知限制（Phase 0 兑底）：transient definition 覆盖已降级；options 仅保留
      // stream / onStream / allowResumeWithoutInput 三个 core 通用字段。
      const options: {
        stream: boolean;
        onStream?: (ev: LlmStreamEvent) => void;
        allowResumeWithoutInput?: boolean;
      } = {
        stream: !noStream,
        onStream: noStream
          ? undefined
          : (ev: LlmStreamEvent) => {
              if (ev.type === "text-delta") {
                process.stdout.write(ev.text);
              }
            },
      };

      // 已知限制：transient definition 覆盖（不带 --save）不再支持；definitionFromFlags
      // 仅用于 --save 路径（写 agent registry）。

      if (subcommand === "continue" && (content == null || content === "")) {
        const all = await rt.messages.listBySession(sessionId);
        const visible = all.filter((m) => !m.hidden);
        const lastVisible = visible[visible.length - 1];
        if (lastVisible?.role === "user") {
          options.allowResumeWithoutInput = true;
        } else if (lastVisible?.role === "assistant") {
          // 已知限制（Phase 0 兑底）：core 已移除 allowAssistantContinue，CLI 不再支持
          // assistant-continue，请新增 user 输入后再 run。
          throw new Error(
            "暂不支持 assistant-continue：末条为 assistant，请用 --content <text> 新增 user 输入后再 run",
          );
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
        "Usage: nm agent <run|continue|list|show|import|export|migrate|delete> [--content <text>] [--agent-config <file>] [--agent-id <id>] [--save] [--prompt-path <file>] [--no-stream] [--session] [--project]",
      );
  }
}
