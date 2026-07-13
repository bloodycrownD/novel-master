/**
 * @deprecated 废弃。chat_grep 已从 {@link registerBuiltinTools} 移除，不再暴露给 Agent。
 * 本文件保留供单元测试与历史参考。
 *
 * Searches the current session message history (including hidden messages).
 *
 * @module domain/tool/builtin/chat-grep-tool
 */

import { z } from "zod";

import { messageBodyText } from "@/domain/chat/content/message-body-text.js";
import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { Tool } from "../model/tool.js";
import type { BuiltinToolContext } from "./builtin-tool-context.js";
import {
  capMatchList,
  TOOL_OUTPUT_MAX_MATCHES,
  truncateLine,
} from "../logic/tool-output-limits.js";

export type ChatGrepMatch = {
  readonly messageId: string;
  readonly seq: number;
  readonly role: string;
  readonly line: number;
  readonly column: number;
  readonly excerpt: string;
  readonly hidden: boolean;
};

export type ChatGrepOutput = {
  readonly matches: readonly ChatGrepMatch[];
  readonly total: number;
  readonly truncated: boolean;
};

function searchLine(
  line: string,
  pattern: string,
  regex: RegExp | null,
): number {
  if (regex != null) {
    const m = regex.exec(line);
    return m?.index ?? -1;
  }
  return line.indexOf(pattern);
}

function collectMatches(
  messages: readonly ChatMessage[],
  pattern: string,
  roleFilter?: string,
): ChatGrepMatch[] {
  let regex: RegExp | null = null;
  try {
    regex = new RegExp(pattern);
  } catch {
    regex = null;
  }

  const results: ChatGrepMatch[] = [];
  for (const message of messages) {
    if (roleFilter != null && message.role !== roleFilter) {
      continue;
    }
    const text = messageBodyText(message);
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const column = searchLine(line, pattern, regex);
      if (column >= 0) {
        results.push({
          messageId: message.id,
          seq: message.seq,
          role: message.role,
          line: i + 1,
          column: column + 1,
          excerpt: truncateLine(line).line,
          hidden: message.hidden,
        });
      }
    }
  }
  return results;
}

/** Creates the chat_grep tool definition（废弃，未注册）。 */
export function createChatGrepTool(): Tool<
  { pattern: string; options?: { role?: string } },
  ChatGrepOutput,
  BuiltinToolContext
> {
  return {
    name: "chat_grep",
    description: "在当前会话消息中搜索文本或正则（含 hidden 消息）",
    inputSchema: z.object({
      pattern: z.string().min(1),
      options: z.object({ role: z.string().optional() }).optional(),
    }),
    outputSchema: z.object({
      matches: z.array(
        z.object({
          messageId: z.string(),
          seq: z.number().int(),
          role: z.string(),
          line: z.number().int(),
          column: z.number().int(),
          excerpt: z.string(),
          hidden: z.boolean(),
        }),
      ),
      total: z.number().int(),
      truncated: z.boolean(),
    }),
    async run(input, ctx) {
      const messages = await ctx.listSessionMessages();
      const raw = collectMatches(
        messages,
        input.pattern,
        input.options?.role,
      );
      const capped = capMatchList(
        raw,
        TOOL_OUTPUT_MAX_MATCHES,
        (m) => JSON.stringify(m),
      );
      return {
        matches: capped.items,
        total: capped.total,
        truncated: capped.truncated,
      };
    },
  };
}
