/**
 * Prompt → LLM input and CLI formatting.
 *
 * @module service/prompt/render-prompt
 */

import type { ChatMessage } from "../../domain/chat/model/message.js";
import { textBlocks } from "../../domain/chat/content/text-blocks.js";
import { formatChatMessageForCliPreview } from "../../domain/chat/content/message-body-text.js";
import type { PromptBlock } from "../../domain/prompt/model/prompt-block.js";
import { formatLocalDateTime } from "../../infra/date-format.js";
import { renderMacro } from "../../infra/prompt-template/macro-render.js";
import { formatWeekCn } from "../../infra/prompt-template/week-cn.js";

/** Dot fields available during prompt macro expansion. */
export interface PromptRenderDot {
  readonly worktree: string;
  readonly filetree: string;
}

/** Worktree strings for prompt macros (excludes chat messages). */
export type PromptMacroContext = Omit<PromptRenderContext, "messages">;

/** Inputs required to build LLM input from prompt blocks. */
export interface PromptRenderContext {
  readonly worktreeDisplay: string;
  /** ASCII tree from {@link WorktreeService.renderFileTree}; macro `{{.filetree}}`. */
  readonly filetreeDisplay: string;
  readonly messages: readonly ChatMessage[];
  /** Defaults to `new Date()` when omitted (tests inject a fixed time). */
  readonly now?: Date;
}

/** Structured input for {@link ModelRequestService}. */
export interface PromptLlmInput {
  readonly system?: string;
  readonly messages: readonly ChatMessage[];
}

/** One segment from the single assembly traversal (preview / serialize / LLM derive). */
export interface PromptAssemblySegment {
  readonly id: string;
  readonly role: string;
  readonly title: string;
  readonly body: string;
  readonly source: "template" | "message";
}

/** One collapsible preview card in CLI / mobile real-prompt UI. */
export interface PromptPreviewSegment {
  readonly id: string;
  readonly role: string;
  readonly title: string;
  readonly body: string;
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

function buildDot(ctx: PromptRenderContext): PromptRenderDot {
  return {
    worktree: ctx.worktreeDisplay,
    filetree: ctx.filetreeDisplay,
  };
}

function renderMacroContent(
  content: string,
  dotRecord: Readonly<Record<string, unknown>>,
  root: { readonly time: string; readonly week_cn: string },
): string {
  return renderMacro(content, {
    dot: dotRecord,
    root,
  });
}

function macroRoot(ctx: PromptRenderContext): {
  readonly now: Date;
  readonly dotRecord: Readonly<Record<string, unknown>>;
  readonly root: { readonly time: string; readonly week_cn: string };
} {
  const now = ctx.now ?? new Date();
  const dot = buildDot(ctx);
  const dotRecord = dot as unknown as Readonly<Record<string, unknown>>;
  const root = {
    time: formatLocalDateTime(now),
    week_cn: formatWeekCn(now),
  };
  return { now, dotRecord, root };
}

/**
 * Single block-order traversal: text macros + chat preview segments.
 * Preview, CLI format, and token serialize derive from this; LLM input uses
 * the same macro expansion and block order via a parallel walk in buildPromptLlmInput.
 */
export function buildPromptAssembly(
  blocks: readonly PromptBlock[],
  ctx: PromptRenderContext,
): readonly PromptAssemblySegment[] {
  const { dotRecord, root } = macroRoot(ctx);
  const segments: PromptAssemblySegment[] = [];
  let segmentIndex = 0;

  for (const block of blocks) {
    if (block.type === "text") {
      const content = renderMacroContent(block.content, dotRecord, root);
      segments.push({
        id: `text-${block.name}`,
        role: block.role,
        title: block.name,
        body: content,
        source: "template",
      });
      continue;
    }

    for (const message of ctx.messages) {
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
  }

  return segments;
}

/** Ephemeral template message — not persisted; satisfies mapper shape only. */
function syntheticTemplateMessage(
  block: Extract<PromptBlock, { type: "text" }>,
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

/**
 * Builds LLM input: system text blocks, synthetic template messages, then chat history.
 */
export function buildPromptLlmInput(
  blocks: readonly PromptBlock[],
  ctx: PromptRenderContext,
): PromptLlmInput {
  const { dotRecord, root } = macroRoot(ctx);
  const systemParts: string[] = [];
  const messages: ChatMessage[] = [];

  for (const block of blocks) {
    if (block.type === "text") {
      const expanded = renderMacroContent(block.content, dotRecord, root);
      if (block.role === "system") {
        systemParts.push(expanded);
      } else {
        messages.push(syntheticTemplateMessage(block, expanded, ctx));
      }
      continue;
    }

    messages.push(...ctx.messages);
  }

  const system =
    systemParts.length > 0 ? systemParts.join("\n") : undefined;

  return {
    system,
    messages,
  };
}

/**
 * Builds ordered preview segments (one card per role-prefixed bubble).
 */
export function buildPromptPreviewSegments(
  blocks: readonly PromptBlock[],
  ctx: PromptRenderContext,
): PromptPreviewSegment[] {
  return buildPromptAssembly(blocks, ctx).map((segment) => ({
    id: segment.id,
    role: segment.role,
    title: segment.title,
    body: segment.body,
  }));
}

/**
 * Formats prompt assembly as role-prefixed plain text for CLI preview and token counting.
 */
export function formatPromptLlmInputForCli(
  blocks: readonly PromptBlock[],
  ctx: PromptRenderContext,
): string {
  return buildPromptAssembly(blocks, ctx)
    .map((segment) => formatSegment(segment.role, segment.body))
    .join("\n");
}
