/**
 * Prompt → LLM input and CLI formatting.
 *
 * @module service/prompt/render-prompt
 */

import type { ChatMessage } from "../../domain/chat/model/message.js";
import { messageBodyText } from "../../domain/prompt/message-body.js";
import type { PromptBlock } from "../../domain/prompt/model/prompt-block.js";
import { formatLocalDateTime } from "../../infra/date-format.js";
import { renderMacro } from "../../infra/prompt-template/macro-render.js";
import { formatWeekCn } from "../../infra/prompt-template/week-cn.js";

/** Inputs required to build LLM input from prompt blocks. */
export interface PromptRenderContext {
  readonly worktreeDisplay: string;
  readonly messages: readonly ChatMessage[];
  /** Defaults to `new Date()` when omitted (tests inject a fixed time). */
  readonly now?: Date;
}

/** Structured input for {@link ModelRequestService}. */
export interface PromptLlmInput {
  readonly system?: string;
  readonly messages: readonly ChatMessage[];
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

/**
 * Builds LLM input from prompt blocks: system text blocks + visible chat messages.
 */
export function buildPromptLlmInput(
  blocks: readonly PromptBlock[],
  ctx: PromptRenderContext,
): PromptLlmInput {
  const now = ctx.now ?? new Date();
  const dot = { worktree: ctx.worktreeDisplay };
  const root = {
    time: formatLocalDateTime(now),
    week_cn: formatWeekCn(now),
  };

  const systemParts: string[] = [];

  for (const block of blocks) {
    if (block.type === "text" && block.role === "system") {
      systemParts.push(renderMacro(block.content, { dot, root }));
    }
  }

  const system =
    systemParts.length > 0 ? systemParts.join("\n") : undefined;

  return {
    system,
    messages: ctx.messages,
  };
}

/**
 * Formats {@link PromptLlmInput} as role-prefixed plain text for CLI preview.
 */
export function formatPromptLlmInputForCli(
  blocks: readonly PromptBlock[],
  input: PromptLlmInput,
  ctx: PromptRenderContext,
): string {
  const now = ctx.now ?? new Date();
  const dot = { worktree: ctx.worktreeDisplay };
  const root = {
    time: formatLocalDateTime(now),
    week_cn: formatWeekCn(now),
  };

  const segments: string[] = [];

  for (const block of blocks) {
    if (block.type === "text") {
      const content = renderMacro(block.content, { dot, root });
      segments.push(formatSegment(block.role, content));
      continue;
    }

    for (const message of input.messages) {
      segments.push(formatSegment(message.role, messageBodyText(message)));
    }
  }

  return segments.join("\n");
}
