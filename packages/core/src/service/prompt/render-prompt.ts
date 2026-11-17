/**
 * Prompt → LLM input and CLI formatting（三区 layout；workplace 双段在 persist 文本与 chat 之前注入）。
 *
 * @module service/prompt/render-prompt
 */

import type { ChatMessageData } from "../../domain/chat/model/message.js";
import { textBlocks } from "../../domain/chat/content/text-blocks.js";
import { formatChatMessageForCliPreview } from "../../domain/chat/content/message-body-text.js";
import type { AgentPromptLayout } from "../../domain/prompt/model/agent-prompt-layout.js";
import { DEFAULT_SKILLS_INDEX_PREFIX, layoutHasWorkplace } from "../../domain/prompt/model/agent-prompt-layout.js";
import { expandDynamicMacros } from "../../domain/prompt/logic/expand-dynamic-macros.js";
import type { LlmExportZones } from "../../domain/prompt/logic/normalize-for-llm-export.js";
import type { PromptLlmInput, PromptRenderContext, PromptSkillIndexEntry } from "../../domain/prompt/model/prompt-render-context.js";
import type { AppError } from "../../errors/app-error.js";
import { Result } from "../../errors/either.js";

export type { PromptLlmInput, PromptRenderContext } from "../../domain/prompt/model/prompt-render-context.js";

/** One segment from the single assembly traversal (preview / serialize / preview turns; LLM input derives separately). */
export interface PromptAssemblySegment {
  readonly id: string;
  readonly role: string;
  readonly title: string;
  readonly body: string;
  readonly source: "template" | "message" | "system";
  /** 来源 ChatMessageData id（仅 `source === "message"` 有值）；轮聚合按它分组。 */
  readonly messageId?: string;
  /** 来源 ChatMessageData 的会话内序号（仅 `source === "message"` 有值）。 */
  readonly seq?: number;
}

/** One collapsible preview card in CLI / mobile real-prompt UI. */
export interface PromptPreviewSegment {
  readonly id: string;
  readonly role: string;
  readonly title: string;
  readonly body: string;
}

/** Agent run step context for prompt assembly (defaults to step 0). */
export interface PromptAssemblyOptions {
  /** Agent run step index; 0 = first LLM round after user action. */
  readonly agentStepIndex?: number;
  /**
   * 预览时是否产出 thinking 段（opt-in，默认 false）：CLI 文本与
   * `serializePromptLlmInput` token 计数 parity 沿用不含 thinking 的现状。
   */
  readonly includeThinkingBlocks?: boolean;
}

/** `computeLlmExportZonesFromLayout` 的可选区来源：workplace 展示串 / 技能索引条目。 */
interface LlmExportZonesOptions extends PromptAssemblyOptions {
  readonly workplaceDisplay?: string;
  readonly skillsIndex?: readonly PromptSkillIndexEntry[];
}

/**
 * 计算 `buildPromptLlmInputFromLayout` 输出 messages 的三区边界。
 *
 * @remarks 传入 `workplaceDisplay` 时与注入逻辑一致：空串不算 workplace 双段；
 * `skillsIndex` 非空时计入 persist 前缀（技能索引合成消息 1 条）。
 * nm-style: keep-public — 唯一生产调用方在 service/agent/impl/agent-runner.ts（本片目录外），
 * 且经 public/prompt 作为 core/prompt 公开面导出，片内无内联落点。
 */
export function computeLlmExportZonesFromLayout(layout: AgentPromptLayout, options?: LlmExportZonesOptions): LlmExportZones {
  const agentStepIndex = resolveAgentStepIndex(options);
  const injectWorkplace = layoutHasWorkplace(layout) && (options?.workplaceDisplay === undefined || options.workplaceDisplay.trim() !== "");
  const textBlockCount = layout.persist.length;
  const persistCount = (options?.skillsIndex?.length ? 1 : 0) + (injectWorkplace ? 2 : 0) + (layout.persistEnabled === true ? textBlockCount : 0);
  // dynamic 区一律 once 语义：仅 step 0 注入（缺省 0 ⇒ preview/token 链恒含）。
  const dynamicCount = layout.dynamicEnabled === true && agentStepIndex === 0 ? layout.dynamic.length : 0;
  return { persistCount, dynamicCount };
}

function resolveAgentStepIndex(options?: PromptAssemblyOptions): number {
  return options?.agentStepIndex ?? 0;
}

/** 合成提示词消息：id / role / 正文由调用方定，会话 id 取首个消息（与 wire 端一致）。 */
function syntheticPromptMessage(id: string, role: string, body: string, ctx: PromptRenderContext): ChatMessageData {
  return {
    id,
    sessionId: ctx.messages[0]?.sessionId ?? "",
    seq: 0,
    role,
    content: textBlocks(body),
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

/** 技能索引段正文：前缀语（缺省默认）+ 每条「名称：描述（来源域）」。 */
function formatSkillsIndexBody(entries: readonly PromptSkillIndexEntry[], prefix?: string): string {
  const lines = entries.map((entry) => {
    const description = entry.description.trim();
    const descSuffix = description !== "" ? `：${description}` : "";
    return `- ${entry.name}${descSuffix}（${entry.domain}）`;
  });
  const header = prefix != null && prefix.trim().length > 0 ? prefix.trim() : DEFAULT_SKILLS_INDEX_PREFIX;
  return [header, ...lines].join("\n");
}

/**
 * 三区 layout 单次遍历：system → skills 索引（若预算非空）→ workplace 双段（若开启）
 * → persist 文本 → chat → dynamic。
 *
 * 五期门⑦：dynamic 宏展开失败沿 `Result.err` 回传（不再 throw）——调用方（turn loop /
 * 两端 buildSessionPromptInput / chip 读口）按 `!ok` 分支收口。
 */
export async function buildPromptAssemblyFromLayout(layout: AgentPromptLayout, ctx: PromptRenderContext, options?: PromptAssemblyOptions): Promise<Result<readonly PromptAssemblySegment[], AppError>> {
  const agentStepIndex = resolveAgentStepIndex(options);
  const segments: PromptAssemblySegment[] = [];
  let segmentIndex = 0;

  if (layout.system != null && layout.system.trim() !== "") {
    segments.push({
      id: "system",
      role: "system",
      title: "system",
      body: layout.system,
      source: "system",
    });
  }

  // skillsEnabled=false（技能总开关关）：不注入索引段（resolve 侧已摘 skill 工具，
  // 此处渲染层双保险——ctx 直接携带 skillsIndex 也不注入）。
  if (layout.skillsEnabled !== false && ctx.skillsIndex != null && ctx.skillsIndex.length > 0) {
    segments.push({
      id: "prompt-skills",
      role: "user",
      title: "skills",
      body: formatSkillsIndexBody(ctx.skillsIndex, layout.skillsPrefix),
      source: "template",
    });
  }

  // `workplace` 开且展示非空时追加 user 文件树 + assistant 配置确认语两段。
  if (layoutHasWorkplace(layout) && ctx.workplaceDisplay.trim() !== "") {
    segments.push({
      id: "prompt-workplace",
      role: "user",
      title: "workplace",
      body: ctx.workplaceDisplay,
      source: "template",
    });
    segments.push({
      id: "prompt-workplace-done",
      role: "assistant",
      title: "workplace · done",
      body: layout.workplace!,
      source: "template",
    });
  }

  if (layout.persistEnabled === true) {
    for (const block of layout.persist) {
      segments.push({
        id: `persist-${block.name}`,
        role: block.role,
        title: block.name,
        body: block.content,
        source: "template",
      });
    }
  }

  for (let messageIndex = 0; messageIndex < ctx.messages.length; messageIndex++) {
    const message = ctx.messages[messageIndex]!;
    if (message.hidden) {
      continue;
    }
    const messageSegments = formatChatMessageForCliPreview(message, {
      includeThinking: options?.includeThinkingBlocks === true,
    });
    for (let i = 0; i < messageSegments.length; i++) {
      const segment = messageSegments[i]!;
      segments.push({
        id: `chat-${message.id}-${segmentIndex}`,
        role: segment.role,
        title: `#${message.seq} · ${segment.role}`,
        body: segment.body,
        source: "message",
        messageId: message.id,
        seq: message.seq,
      });
      segmentIndex += 1;
    }
  }

  if (layout.dynamicEnabled === true && agentStepIndex === 0) {
    for (const block of layout.dynamic) {
      const expanded = await expandDynamicMacros(block.content, { now: ctx.now, workplace: ctx.workplace, filetree: ctx.filetree });
      if (!expanded.ok) {
        return Result.err(expanded.error);
      }
      segments.push({
        id: `dynamic-${block.name}`,
        role: block.role,
        title: block.name,
        body: expanded.value,
        source: "template",
      });
    }
  }

  return Result.ok(segments);
}

/**
 * 构建 LLM 输入：system 字段 + persist 合成消息 + chat + dynamic。
 *
 * 五期门⑦：同 {@link buildPromptAssemblyFromLayout}，dynamic 宏展开失败沿
 * `Result.err` 回传，调用方按 `!ok` 分支收口。
 */
export async function buildPromptLlmInputFromLayout(layout: AgentPromptLayout, ctx: PromptRenderContext, options?: PromptAssemblyOptions): Promise<Result<PromptLlmInput, AppError>> {
  const agentStepIndex = resolveAgentStepIndex(options);
  const messages: ChatMessageData[] = [];

  if (layout.skillsEnabled !== false && ctx.skillsIndex != null && ctx.skillsIndex.length > 0) {
    messages.push(syntheticPromptMessage("prompt:skills", "user", formatSkillsIndexBody(ctx.skillsIndex, layout.skillsPrefix), ctx));
  }

  // `workplace` 开且展示非空时追加 user 文件树 + assistant 配置确认语（assemble 已包 `<workplace>`，此处勿再包）。
  if (layoutHasWorkplace(layout) && ctx.workplaceDisplay.trim() !== "") {
    messages.push(syntheticPromptMessage("prompt:workplace", "user", ctx.workplaceDisplay, ctx));
    messages.push(syntheticPromptMessage("prompt:workplace:done", "assistant", layout.workplace!, ctx));
  }

  if (layout.persistEnabled === true) {
    for (const block of layout.persist) {
      messages.push(syntheticPromptMessage(`prompt:${block.name}`, block.role, block.content, ctx));
    }
  }

  messages.push(...ctx.messages.filter((m) => !m.hidden));

  if (layout.dynamicEnabled === true && agentStepIndex === 0) {
    for (const block of layout.dynamic) {
      const expanded = await expandDynamicMacros(block.content, { now: ctx.now, workplace: ctx.workplace, filetree: ctx.filetree });
      if (!expanded.ok) {
        return Result.err(expanded.error);
      }
      messages.push(syntheticPromptMessage(`prompt:${block.name}`, block.role, expanded.value, ctx));
    }
  }

  const system = layout.system != null && layout.system.trim() !== "" ? layout.system : undefined;

  return Result.ok({ system, messages });
}

/** 构建有序预览分段（每段一张卡片）。 */
export async function buildPromptPreviewSegmentsFromLayout(layout: AgentPromptLayout, ctx: PromptRenderContext, options?: PromptAssemblyOptions): Promise<Result<PromptPreviewSegment[], AppError>> {
  const assembled = await buildPromptAssemblyFromLayout(layout, ctx, options);
  if (!assembled.ok) {
    return Result.err(assembled.error);
  }
  return Result.ok(assembled.value.map((segment) => ({ id: segment.id, role: segment.role, title: segment.title, body: segment.body })));
}

/**
 * CLI 预览与 token 计数用的 role 前缀纯文本。
 *
 * nm-style: keep-public — 跨包契约：infra/tokenizer 以 `serializePromptLlmInput` 别名转发，
 * 三端 token 面（含 tokenizer-driver-node/rn）与 apps/cli 直接消费，片内无内联落点。
 */
export async function formatPromptLlmInputForCliFromLayout(layout: AgentPromptLayout, ctx: PromptRenderContext, options?: PromptAssemblyOptions): Promise<Result<string, AppError>> {
  const assembled = await buildPromptAssemblyFromLayout(layout, ctx, options);
  if (!assembled.ok) {
    return Result.err(assembled.error);
  }
  const lines = assembled.value.map((segment) => {
    const bodyLines = segment.body.replace(/\r\n/g, "\n").split("\n");
    return bodyLines.length === 1 ? `${segment.role}: ${bodyLines[0]}` : `${segment.role}: ${bodyLines[0]}\n${bodyLines.slice(1).join("\n")}`;
  });
  return Result.ok(lines.join("\n"));
}
