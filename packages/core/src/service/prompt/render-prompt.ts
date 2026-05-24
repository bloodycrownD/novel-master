/**
 * Renders prompt blocks to role-prefixed plain text.
 *
 * @module service/prompt/render-prompt
 */

import type { ChatMessage } from "../../domain/chat/model/message.js";
import { messageBodyText } from "../../domain/prompt/message-body.js";
import type { PromptBlock } from "../../domain/prompt/model/prompt-block.js";
import { formatLocalDateTime } from "../../infra/date-format.js";
import { renderMacro } from "../../infra/prompt-template/macro-render.js";
import { formatWeekCn } from "../../infra/prompt-template/week-cn.js";

/** Inputs required to render a prompt to stdout text. */
export interface PromptRenderContext {
  readonly worktreeDisplay: string;
  readonly messages: readonly ChatMessage[];
  /** Defaults to `new Date()` when omitted (tests inject a fixed time). */
  readonly now?: Date;
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
 * Renders blocks to concatenated `role:` prefixed plain text (no block names).
 */
export function renderPromptToText(
  blocks: readonly PromptBlock[],
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

    for (const message of ctx.messages) {
      segments.push(formatSegment(message.role, messageBodyText(message)));
    }
  }

  return segments.join("\n");
}
