/**
 * Prompt → LLM input and CLI formatting（三区 layout）。
 *
 * @module service/prompt/render-prompt
 */

import type { ChatMessage } from "../../domain/chat/model/message.js";
import { textBlocks } from "../../domain/chat/content/text-blocks.js";
import { formatChatMessageForCliPreview } from "../../domain/chat/content/message-body-text.js";
import type {
  AgentPromptLayout,
  DynamicPromptBlock,
  PersistPromptBlock,
  PersistTextPromptBlock,
} from "../../domain/prompt/model/agent-prompt-layout.js";
import { expandDynamicMacros } from "../../domain/prompt/logic/expand-dynamic-macros.js";
import { shouldIncludeDynamicBlock } from "../../domain/prompt/logic/should-include-dynamic-block.js";
import type {
  PromptLlmInput,
  PromptRenderContext,
} from "../../domain/prompt/model/prompt-render-context.js";

export type { PromptLlmInput, PromptRenderContext } from "../../domain/prompt/model/prompt-render-context.js";

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
  ctx: PromptRenderContext,
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

function syntheticWorktreeMessage(
  block: Extract<PersistPromptBlock, { type: "worktree" }>,
  worktreeDisplay: string,
  ctx: PromptRenderContext,
): ChatMessage {
  return {
    id: `prompt:worktree:${block.name}`,
    sessionId: ctx.messages[0]?.sessionId ?? "",
    seq: 0,
    role: block.role ?? "user",
    content: textBlocks(worktreeDisplay),
    provider: null,
    raw: null,
    createdAtMs: 0,
    hidden: false,
  };
}

/**
 * 三区 layout 单次遍历：system → persist → chat → dynamic。
 */
export async function buildPromptAssemblyFromLayout(
  layout: AgentPromptLayout,
  ctx: PromptRenderContext,
  options?: PromptAssemblyOptions,
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

  if (layout.persistEnabled === true) {
    for (const block of layout.persist) {
      if (block.type === "text") {
        segments.push({
          id: `persist-${block.name}`,
          role: block.role,
          title: block.name,
          body: block.content,
          source: "template",
        });
      } else {
        segments.push({
          id: `persist-worktree-${block.name}`,
          role: block.role ?? "user",
          title: block.name,
          body: ctx.worktreeDisplay,
          source: "template",
        });
      }
    }
  }

  for (const message of ctx.messages) {
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
        vfs: ctx.vfs,
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
  options?: PromptAssemblyOptions,
): Promise<PromptLlmInput> {
  const agentStepIndex = resolveAgentStepIndex(options);
  const messages: ChatMessage[] = [];

  if (layout.persistEnabled === true) {
    for (const block of layout.persist) {
      if (block.type === "text") {
        messages.push(syntheticTemplateMessage(block, block.content, ctx));
      } else {
        messages.push(
          syntheticWorktreeMessage(block, ctx.worktreeDisplay, ctx),
        );
      }
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
        vfs: ctx.vfs,
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
  options?: PromptAssemblyOptions,
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
  options?: PromptAssemblyOptions,
): Promise<string> {
  const segments = await buildPromptAssemblyFromLayout(layout, ctx, options);
  return segments
    .map((segment) => formatSegment(segment.role, segment.body))
    .join("\n");
}
