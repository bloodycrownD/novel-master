/**
 * Pure regex replacement pipeline (view-time; does not mutate stored messages).
 *
 * @module domain/regex/apply-regex-rules
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { ContentBlock, MessageContent } from "@/domain/chat/model/content-block.js";
import { matchDepth } from "@/domain/depth/logic/depth-slice.js";
import type { CompiledRegexRule } from "./compile-regex-rule.js";

/** Replacement target channel (LLM prompt vs CLI display). */
export type RegexChannel = "llm" | "display";

function roleMatchesScope(
  role: string,
  rule: CompiledRegexRule,
): boolean {
  if (role === "user") {
    return rule.scopeUser;
  }
  if (role === "assistant") {
    return rule.scopeAssistant;
  }
  return false;
}

function depthInRange(depthFromTail: number, rule: CompiledRegexRule): boolean {
  return matchDepth(depthFromTail, {
    startDepth: rule.startDepth ?? undefined,
    endDepth: rule.endDepth ?? undefined,
  });
}

function replaceForChannel(
  text: string,
  rule: CompiledRegexRule,
  channel: RegexChannel,
): string {
  const replacement =
    channel === "llm" ? rule.llmReplace : rule.displayReplace;
  if (replacement == null) {
    return text;
  }
  return text.replace(rule.pattern, replacement);
}

/**
 * Applies enabled rules in order; each rule may transform the prior output.
 */
export function applyRegexRules(
  text: string,
  rules: readonly CompiledRegexRule[],
  ctx: {
    readonly channel: RegexChannel;
    readonly depthFromTail: number;
    readonly role: string;
  },
): string {
  let out = text;
  for (const rule of rules) {
    if (!roleMatchesScope(ctx.role, rule)) {
      continue;
    }
    if (!depthInRange(ctx.depthFromTail, rule)) {
      continue;
    }
    out = replaceForChannel(out, rule, ctx.channel);
  }
  return out;
}

function mapTextBlocks(
  content: MessageContent,
  transform: (text: string) => string,
): MessageContent {
  const blocks: ContentBlock[] = content.blocks.map((block) => {
    if (block.type !== "text") {
      return block;
    }
    return { ...block, text: transform(block.text) };
  });
  return { blocks };
}

export function applyRegexToMessageContent(
  content: MessageContent,
  rules: readonly CompiledRegexRule[],
  ctx: {
    readonly channel: RegexChannel;
    readonly depthFromTail: number;
    readonly role: string;
  },
): MessageContent {
  return mapTextBlocks(content, (text) => applyRegexRules(text, rules, ctx));
}

/**
 * Returns messages with regex applied for a channel (DB rows unchanged).
 *
 * @param depthByMessageId - Tail depth per visible message id (newest = 0)
 */
export function applyRegexChannelToMessages(
  messages: readonly ChatMessage[],
  rules: readonly CompiledRegexRule[],
  channel: RegexChannel,
  depthByMessageId: ReadonlyMap<string, number>,
): ChatMessage[] {
  return messages.map((m) => {
    const depth = depthByMessageId.get(m.id);
    if (depth == null) {
      return m;
    }
    const content = applyRegexToMessageContent(m.content, rules, {
      channel,
      depthFromTail: depth,
      role: m.role,
    });
    if (content === m.content) {
      return m;
    }
    return { ...m, content };
  });
}
