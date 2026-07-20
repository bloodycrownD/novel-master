/**
 * Prompt → LLM input and CLI formatting（三区 layout；workplace 双段在 persist 文本与 chat 之前注入）。
 *
 * @module service/prompt/render-prompt
 */

import type { ChatMessage } from "../../domain/chat/model/message.js";
import { textBlocks } from "../../domain/chat/content/text-blocks.js";
import { TOOL_TURN_BRIDGE_TEXT } from "../chat/impl/append-tool-turn-bridge.js";
import { formatChatMessageForCliPreview } from "../../domain/chat/content/message-body-text.js";
import type {
  AgentPromptLayout,
  DynamicPromptBlock,
  PersistTextPromptBlock,
} from "../../domain/prompt/model/agent-prompt-layout.js";
import { expandDynamicMacros } from "../../domain/prompt/logic/expand-dynamic-macros.js";
import { shouldIncludeDynamicBlock } from "../../domain/prompt/logic/should-include-dynamic-block.js";
import type { LlmExportZones } from "../../domain/prompt/logic/normalize-for-llm-export.js";
import type {
  PromptLlmInput,
  PromptRenderContext,
} from "../../domain/prompt/model/prompt-render-context.js";

export type {
  PromptLlmInput,
  PromptRenderContext,
} from "../../domain/prompt/model/prompt-render-context.js";

/** One segment from the single assembly traversal (preview / serialize / LLM derive). */
export interface PromptAssemblySegment {
  readonly id: string;
  readonly role: string;
  readonly title: string;
  readonly body: string;
  readonly source: "template" | "message" | "system";
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
}

/**
 * 计算 `buildPromptLlmInputFromLayout` 输出 messages 的三区边界。
 *
 * @remarks 传入 `workplaceDisplay` 时与注入逻辑一致：空串不算 workplace 双段。
 */
export function computeLlmExportZonesFromLayout(
  layout: AgentPromptLayout,
  options?: PromptAssemblyOptions & { readonly workplaceDisplay?: string }
): LlmExportZones {
  const agentStepIndex = resolveAgentStepIndex(options);
  const injectWorkplace =
    layout.workplace === true &&
    (options?.workplaceDisplay === undefined ||
      options.workplaceDisplay.trim() !== "");
  const textBlockCount = layout.persist.length;
  const persistCount =
    (injectWorkplace ? 2 : 0) +
    (layout.persistEnabled === true ? textBlockCount : 0);
  let dynamicCount = 0;
  if (layout.dynamicEnabled === true) {
    for (const block of layout.dynamic) {
      if (shouldIncludeDynamicBlock(block, agentStepIndex)) {
        dynamicCount += 1;
      }
    }
  }
  return { persistCount, dynamicCount };
}

function resolveAgentStepIndex(options?: PromptAssemblyOptions): number {
  return options?.agentStepIndex ?? 0;
}

function formatSegment(role: string, body: string): string {
  const trimmed = body.replace(/\r\n/g, "\n");
  if (trimmed === "") {
    return `${role}: `;
  }
  const lines = trimmed.split("\n");
  if (lines.length === 1) {
    return `${role}: ${lines[0]}`;
  }
  return `${role}: ${lines[0]}\n${lines.slice(1).join("\n")}`;
}

function syntheticTemplateMessage(
  block: PersistTextPromptBlock | DynamicPromptBlock,
  expanded: string,
  ctx: PromptRenderContext
): ChatMessage {
  return {
    id: `prompt:${block.name}`,
    sessionId: ctx.messages[0]?.sessionId ?? "",
    seq: 0,
    role: block.role,
    content: textBlocks(expanded),
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

function syntheticWorkplaceUserMessage(
  workplaceDisplay: string,
  ctx: PromptRenderContext
): ChatMessage {
  return {
    id: "prompt:workplace",
    sessionId: ctx.messages[0]?.sessionId ?? "",
    seq: 0,
    role: "user",
    content: textBlocks(workplaceDisplay),
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

function syntheticWorkplaceDoneMessage(
  ctx: PromptRenderContext
): ChatMessage {
  return {
    id: "prompt:workplace:done",
    sessionId: ctx.messages[0]?.sessionId ?? "",
    seq: 0,
    role: "assistant",
    content: textBlocks(TOOL_TURN_BRIDGE_TEXT),
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

/** `workplace` 开且展示非空时追加 user 文件树 + assistant done。 */
function appendWorkplacePairIfPresent(
  layout: AgentPromptLayout,
  ctx: PromptRenderContext,
  messages: ChatMessage[]
): void {
  if (layout.workplace !== true) {
    return;
  }
  if (ctx.workplaceDisplay.trim() === "") {
    return;
  }
  messages.push(syntheticWorkplaceUserMessage(ctx.workplaceDisplay, ctx));
  messages.push(syntheticWorkplaceDoneMessage(ctx));
}

function appendWorkplacePairSegmentsIfPresent(
  layout: AgentPromptLayout,
  ctx: PromptRenderContext,
  segments: PromptAssemblySegment[]
): void {
  if (layout.workplace !== true || ctx.workplaceDisplay.trim() === "") {
    return;
  }
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
    body: TOOL_TURN_BRIDGE_TEXT,
    source: "template",
  });
}

/**
 * 三区 layout 单次遍历：system → workplace 双段（若开启）→ persist 文本 → chat → dynamic。
 */
export async function buildPromptAssemblyFromLayout(
  layout: AgentPromptLayout,
  ctx: PromptRenderContext,
  options?: PromptAssemblyOptions
): Promise<readonly PromptAssemblySegment[]> {
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

  appendWorkplacePairSegmentsIfPresent(layout, ctx, segments);

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

  for (
    let messageIndex = 0;
    messageIndex < ctx.messages.length;
    messageIndex++
  ) {
    const message = ctx.messages[messageIndex]!;
    if (message.hidden) {
      continue;
    }
    const messageSegments = formatChatMessageForCliPreview(message);
    for (let i = 0; i < messageSegments.length; i++) {
      const segment = messageSegments[i]!;
      segments.push({
        id: `chat-${message.id}-${segmentIndex}`,
        role: segment.role,
        title: `#${message.seq} · ${segment.role}`,
        body: segment.body,
        source: "message",
      });
      segmentIndex += 1;
    }
  }

  if (layout.dynamicEnabled === true) {
    for (const block of layout.dynamic) {
      if (!shouldIncludeDynamicBlock(block, agentStepIndex)) {
        continue;
      }
      const expanded = await expandDynamicMacros(block.content, {
        now: ctx.now,
        workplace: ctx.workplace,
      });
      segments.push({
        id: `dynamic-${block.name}`,
        role: block.role,
        title: block.name,
        body: expanded,
        source: "template",
      });
    }
  }

  return segments;
}

/**
 * 构建 LLM 输入：system 字段 + persist 合成消息 + chat + dynamic。
 */
export async function buildPromptLlmInputFromLayout(
  layout: AgentPromptLayout,
  ctx: PromptRenderContext,
  options?: PromptAssemblyOptions
): Promise<PromptLlmInput> {
  const agentStepIndex = resolveAgentStepIndex(options);
  const messages: ChatMessage[] = [];

  appendWorkplacePairIfPresent(layout, ctx, messages);

  if (layout.persistEnabled === true) {
    for (const block of layout.persist) {
      messages.push(syntheticTemplateMessage(block, block.content, ctx));
    }
  }

  messages.push(...ctx.messages.filter((m) => !m.hidden));

  if (layout.dynamicEnabled === true) {
    for (const block of layout.dynamic) {
      if (!shouldIncludeDynamicBlock(block, agentStepIndex)) {
        continue;
      }
      const expanded = await expandDynamicMacros(block.content, {
        now: ctx.now,
        workplace: ctx.workplace,
      });
      messages.push(syntheticTemplateMessage(block, expanded, ctx));
    }
  }

  const system =
    layout.system != null && layout.system.trim() !== ""
      ? layout.system
      : undefined;

  return { system, messages };
}

/** 构建有序预览分段（每段一张卡片）。 */
export async function buildPromptPreviewSegmentsFromLayout(
  layout: AgentPromptLayout,
  ctx: PromptRenderContext,
  options?: PromptAssemblyOptions
): Promise<PromptPreviewSegment[]> {
  const segments = await buildPromptAssemblyFromLayout(layout, ctx, options);
  return segments.map((segment) => ({
    id: segment.id,
    role: segment.role,
    title: segment.title,
    body: segment.body,
  }));
}

/** CLI 预览与 token 计数用的 role 前缀纯文本。 */
export async function formatPromptLlmInputForCliFromLayout(
  layout: AgentPromptLayout,
  ctx: PromptRenderContext,
  options?: PromptAssemblyOptions
): Promise<string> {
  const segments = await buildPromptAssemblyFromLayout(layout, ctx, options);
  return segments
    .map((segment) => formatSegment(segment.role, segment.body))
    .join("\n");
}
