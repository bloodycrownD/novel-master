/**
 * `nm prompt` subcommands.
 *
 * @module prompt/commands
 */

import { readFile } from "node:fs/promises";
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import { resolveAgentToolRegistry } from "@novel-master/core/agent";
import {
  formatPromptLlmInputForCliFromLayout,
  type AgentPromptLayout,
  type PromptSkillIndexEntry,
} from "@novel-master/core/prompt";

import {
  countPromptLlmInput,
  isSavedModelUuidFormat,
  serializePromptLlmInput,
} from "@novel-master/core/provider";

import { applyRegexChannelForLlm } from "@novel-master/core/regex";
import { assembleWorkplaceDisplay } from "@novel-master/core/workplace";
import type { NovelMasterRuntime } from "../runtime.js";
import { loadAgentPromptLayoutFromYaml } from "../config/load-agent-prompt-layout.js";
import { parseCliArgs } from "../vfs/parse-args.js";

/** 与 core skill-tool 的 SKILL_TOOL_NAME 同值（core 未公开导出，本地常量）。 */
const SKILL_TOOL_NAME = "skill";

/**
 * 预算提示词技能索引（与 desktop/mobile 的 prompt-preview.service 同模式）。
 *
 * CLI 的 YAML 只含 prompts 三区、无 tools policy，壳 definition 走
 * resolveAgentToolRegistry 的「无 policy → 全量工具」分支；不含
 * skill（D4）时返回 undefined，预览不出现技能索引段。
 */
async function budgetSkillsIndex(
  rt: Pick<NovelMasterRuntime, "skills">,
  projectId: string,
  layout: AgentPromptLayout,
): Promise<readonly PromptSkillIndexEntry[] | undefined> {
  const probe = new ToolRegistry();
  registerBuiltinTools(probe);
  const registry = resolveAgentToolRegistry(probe, {
    name: "cli-prompt-preview",
    prompts: layout,
  });
  if (!registry.list().includes(SKILL_TOOL_NAME)) {
    return undefined;
  }
  const effective = await rt.skills().effectiveSkills(projectId);
  return effective
    .filter((s) => s.effective)
    .map((s) => ({
      name: s.name,
      description: s.description ?? "",
      domain: s.domain,
    }));
}

export async function runPrompt(
  rt: Pick<
    NovelMasterRuntime,
    | "messages"
    | "scope"
    | "workplace"
    | "sessionKkv"
    | "sessionVfs"
    | "state"
    | "regexConfig"
    | "tokenCounters"
    | "providerModels"
    | "savedModels"
    | "skills"
  >,
  subcommand: string,
  args: readonly string[],
): Promise<void> {
  if (subcommand !== "render") {
    throw new Error(
      "Usage: novel-master prompt render --path <file> [--tokens] [--model <savedModelId>] [--project <id>] [--session <id>] [--db <path>]",
    );
  }

  const { flags } = parseCliArgs(args);
  const path = flags.get("path");
  if (typeof path !== "string") {
    throw new Error(
      "Usage: novel-master prompt render --path <file> [--tokens] [--model <savedModelId>] [--project <id>] [--session <id>] [--db <path>]",
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
  const wtScope = { kind: "session" as const, projectId, sessionId };
  const vfs = rt.sessionVfs(projectId, sessionId);
  const { workplaceDisplay } = await assembleWorkplaceDisplay(wtScope, {
    sessionKkv: rt.sessionKkv,
    workplace: rt.workplace(wtScope),
    vfs,
    layout,
  });
  // 技能索引预算：与双端预览同模式（probe + resolve 判 skill，D4 联动）。
  const skillsIndex = await budgetSkillsIndex(rt, projectId, layout);
  const ctx = {
    workplaceDisplay,
    messages,
    vfs,
    ...(skillsIndex != null ? { skillsIndex } : {}),
  };
  const text = await formatPromptLlmInputForCliFromLayout(layout, ctx);
  if (text.length > 0) {
    process.stdout.write(text);
  }

  if (flags.get("tokens") === true) {
    const modelFlag = flags.get("model");
    let savedModelId: string | undefined;
    if (typeof modelFlag === "string") {
      savedModelId = modelFlag;
    } else {
      savedModelId = (await rt.state.getCurrentModelId()) ?? undefined;
    }

    if (savedModelId == null) {
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

    if (!isSavedModelUuidFormat(savedModelId)) {
      console.error(
        `warning: invalid saved model id ${savedModelId}; using heuristic counter`,
      );
    }

    const tokenizerOverride = await rt.providerModels.getTokenCounterMode(
      savedModelId,
    );
    const result = await countPromptLlmInput({
      layout,
      ctx,
      savedModelId,
      registry: rt.tokenCounters,
      tokenizerOverride,
      savedModels: rt.savedModels,
    });

    console.error(
      JSON.stringify({
        tokenCount: result.tokenCount,
        model: savedModelId,
        counter: result.counterKind,
        estimated: result.estimated,
        tokenizerFamily: result.tokenizerFamily,
      }),
    );
  }
}
