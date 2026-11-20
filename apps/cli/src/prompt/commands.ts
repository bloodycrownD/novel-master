/**
 * `nm prompt` subcommands.
 *
 * @module prompt/commands
 */

import { readFile } from "node:fs/promises";
import { registerBuiltinTools, ToolRegistry } from "@novel-master/core";
import { resolveAgentToolRegistry } from "@novel-master/core/agent";
import { formatPromptLlmInputForCliFromLayout, type PromptSkillIndexEntry } from "@novel-master/core/prompt";

import { countPromptLlmInput, isSavedModelUuidFormat, serializePromptLlmInput } from "@novel-master/core/provider";

import { assembleWorkplaceDisplay, type Outcome } from "@novel-master/core/workplace";
import { EncodingCache } from "@novel-master/tokenizer-driver-node";
import type { NovelMasterRuntime } from "../runtime.js";
import { OUTCOME_COMPLETED } from "../cli-errors.js";
import { loadAgentPromptLayoutFromYaml } from "../config/load-agent-prompt-layout.js";
import { parseCliArgs } from "../vfs/parse-args.js";

/** 与 core skill-tool 的 SKILL_TOOL_NAME 同值（core 未公开导出，本地常量）。 */
const SKILL_TOOL_NAME = "skill";

/**
 * 「拿不到模型」那档计数兜底分支的**唯一落点**（可注入的纯函数）。
 *
 * 口径与抽取前逐字一致：真分词器读数优先，只有它返回 `null`（整张 cl100k 表
 * 建不起来——ranks 资源缺失 / 环境未就绪）才退到字符折算。两个计数器**都靠
 * 注入**，所以 `apps/cli/test/` 下能不拉起整套 CLI 就把这两条路径各自钉住——
 * 这段逻辑原先只存在于 `prompt-tokens-e2e.test.ts` 里，而那个套件是长期基线
 * 5/5 红、这段分支在 CI 里从未被执行过。
 *
 * nm-style: keep-public — `apps/cli/test/prompt-token-fallback.test.ts` 直接 import 校验两条计数路径；测试不在本目录可改范围，撤导出会断测试契约。
 */
export function resolveCliPromptTokens(serialized: string, countReal: (text: string) => number | null, countByCharRatio: (text: string) => number): number {
  return countReal(serialized) ?? countByCharRatio(serialized);
}

/**
 * 「拿不到模型」那档 JSON 输出的**唯一落点**。
 *
 * 抽成纯函数是为了让测试能**直接断言**「兜底读数切换不改 `counter` /
 * `estimated` 两个字段的口径」——它们是 CLI 取证/调试面的对外契约。字段名、
 * 字段顺序、字段值三者与抽取前完全一致，输出 JSON 逐字节相同。
 *
 * nm-style: keep-public — `apps/cli/test/prompt-token-fallback.test.ts` 直接 import 断言 JSON 口径；测试不在本目录可改范围，撤导出会断测试契约。
 */
export function buildCliNoModelTokenDiagnostic(tokenCount: number): {
  tokenCount: number;
  model: null;
  counter: "heuristic";
  estimated: true;
  tokenizerFamily: "heuristic";
} {
  return {
    tokenCount,
    model: null,
    counter: "heuristic",
    estimated: true,
    tokenizerFamily: "heuristic",
  };
}

type PromptRuntime = Pick<NovelMasterRuntime, "messages" | "scope" | "workplace" | "sessionKkv" | "sessionVfs" | "state" | "tokenCounters" | "providerModels" | "savedModels" | "skills">;

export async function runPrompt(rt: PromptRuntime, subcommand: string, args: readonly string[]): Promise<Outcome<void>> {
  if (subcommand !== "render") {
    throw new Error("Usage: novel-master prompt render --path <file> [--tokens] [--model <savedModelId>] [--project <id>] [--session <id>] [--db <path>]");
  }

  const { flags } = parseCliArgs(args);
  const path = flags.get("path");
  if (typeof path !== "string") {
    throw new Error("Usage: novel-master prompt render --path <file> [--tokens] [--model <savedModelId>] [--project <id>] [--session <id>] [--db <path>]");
  }

  const source = await readFile(path, "utf8");
  const layoutResult = loadAgentPromptLayoutFromYaml(source);
  if (!layoutResult.ok) return { kind: "failed", error: layoutResult.error };
  const layout = layoutResult.value;
  const resolvedScope = await rt.scope.resolveProjectSession(flags);
  if (!resolvedScope.ok) return { kind: "failed", error: resolvedScope.error };
  const { projectId, sessionId } = resolvedScope.value;
  const allMessagesRead = await rt.messages.listBySession(sessionId);
  // 中断/失败沿本命令既有的 Outcome 通道交回 main 边界（cancelled → 130）。
  if (allMessagesRead.kind === "failed") return { kind: "failed", error: allMessagesRead.error };
  if (allMessagesRead.kind !== "completed") return allMessagesRead;
  const messages = allMessagesRead.value.filter((m) => !m.hidden);
  const wtScope = { kind: "session" as const, projectId, sessionId };
  const vfs = rt.sessionVfs(projectId, sessionId);
  const assembled = await assembleWorkplaceDisplay(wtScope, { sessionKkv: rt.sessionKkv, workplace: rt.workplace(wtScope), vfs, layout });
  if (assembled.kind !== "completed") {
    // 本调用无 shouldStop 判据，中断分支恒不到；failed 与 cancelled/replaced
    // 都沿 Outcome 交回 main 边界——failed 汇入 catch 统一出口，中断走
    // EXIT_CANCELLED（错误通道迁移三期）。
    return assembled;
  }
  const { workplaceDisplay } = assembled.value;
  // 技能索引预算：与双端预览同模式（probe + resolve 判 skill，D4 联动）。
  // CLI 的 YAML 只含 prompts 三区、无 tools policy，壳 definition 走
  // resolveAgentToolRegistry 的「无 policy → 全量工具」分支；不含 skill（D4）时
  // 预览不出现技能索引段。
  let skillsIndex: readonly PromptSkillIndexEntry[] | undefined;
  const probe = new ToolRegistry();
  registerBuiltinTools(probe);
  const registry = resolveAgentToolRegistry(probe, { name: "cli-prompt-preview", prompts: layout });
  if (registry.list().includes(SKILL_TOOL_NAME)) {
    const effective = await rt.skills().effectiveSkills(projectId);
    // 装配失败沿异常通道上抛（原行为）：清单读取失败不静默降级成无索引。
    if (!effective.ok) throw effective.error;
    skillsIndex = effective.value.filter((s) => s.effective).map((s) => ({ name: s.name, description: s.description ?? "", domain: s.domain }));
  }
  const ctx = {
    workplaceDisplay,
    messages,
    vfs,
    ...(skillsIndex != null ? { skillsIndex } : {}),
  };
  const textResult = await formatPromptLlmInputForCliFromLayout(layout, ctx);
  if (!textResult.ok) return { kind: "failed", error: textResult.error };
  const { value: text } = textResult;
  if (text.length > 0) {
    process.stdout.write(text);
  }

  if (flags.get("tokens") === true) {
    const modelFlag = flags.get("model");
    let savedModelId: string | undefined;
    if (typeof modelFlag === "string") {
      savedModelId = modelFlag;
    } else {
      const currentModel = await rt.state.getCurrentModelId();
      if (!currentModel.ok) return { kind: "failed", error: currentModel.error };
      savedModelId = currentModel.value ?? undefined;
    }

    if (savedModelId == null) {
      // CLI 口径说明：此处不计 tools 段（CLI 走取证/调试面，不参与压缩判定），
      // 与压缩评估的本地估算口径存在差异，仅供人工核对，不作为验收基准。
      const serialized = await serializePromptLlmInput(layout, ctx);
      if (!serialized.ok) return { kind: "failed", error: serialized.error };
      // stream-metrics-native ④：拿不到模型时改走 Node 驱动的默认 cl100k 真计数，
      // 而不是 `rt.tokenCounters.heuristic.countText` 的 `ceil(chars / 3.35)`
      // 字符折算（3.35 是英文口径，对中文正文低估 82%~84%）。下面 JSON 的
      // `counter: "heuristic"` / `estimated: true` 不变——变的只是读数本身：
      // cl100k 对任意模型都只是近似，报成精确档反而是误导。编码表建不起来
      // （ranks 资源缺失）时才有最后一级折算兜底。
      const tokenCount = resolveCliPromptTokens(serialized.value, EncodingCache.countText, (text) => rt.tokenCounters.heuristic.countText(text));
      console.error(JSON.stringify(buildCliNoModelTokenDiagnostic(tokenCount)));
      return OUTCOME_COMPLETED;
    }

    if (!isSavedModelUuidFormat(savedModelId)) {
      console.error(`warning: invalid saved model id ${savedModelId}; using heuristic counter`);
    }

    const counterMode = await rt.providerModels.getTokenCounterMode(savedModelId);
    if (!counterMode.ok) return { kind: "failed", error: counterMode.error };
    const tokenizerOverride = counterMode.value;
    // CLI 口径说明：此处不计 tools 段（CLI 走取证/调试面，不参与压缩判定），
    // 与压缩评估的本地估算口径存在差异，仅供人工核对，不作为验收基准。
    const result = await countPromptLlmInput({ layout, ctx, savedModelId, registry: rt.tokenCounters, tokenizerOverride, savedModels: rt.savedModels });
    if (!result.ok) return { kind: "failed", error: result.error };

    const diagnostic = {
      tokenCount: result.value.tokenCount,
      model: savedModelId,
      counter: result.value.counterKind,
      estimated: result.value.estimated,
      tokenizerFamily: result.value.tokenizerFamily,
    };
    console.error(JSON.stringify(diagnostic));
  }
  return OUTCOME_COMPLETED;
}
