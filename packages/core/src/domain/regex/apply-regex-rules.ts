/**
 * Pure regex replacement pipeline (view-time; does not mutate stored messages).
 *
 * @module domain/regex/apply-regex-rules
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { ContentBlock, MessageContent } from "@/domain/chat/model/content-block.js";
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

function depthInRange(floor: number, rule: CompiledRegexRule): boolean {
  return floor >= rule.minDepth && floor <= rule.maxDepth;
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
 *
 * @param text - Source plain text
 * @param rules - Compiled rules in `sort_order` sequence
 * @param ctx - Channel, visible floor, and message role
 */
export function applyRegexRules(
  text: string,
  rules: readonly CompiledRegexRule[],
  ctx: { readonly channel: RegexChannel; readonly floor: number; readonly role: string },
): string {
  let out = text;
  for (const rule of rules) {
    if (!roleMatchesScope(ctx.role, rule)) {
      continue;
    }
    if (!depthInRange(ctx.floor, rule)) {
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

/**
 * Applies regex rules to text blocks in message content.
 */
export function applyRegexToMessageContent(
  content: MessageContent,
  rules: readonly CompiledRegexRule[],
  ctx: { readonly channel: RegexChannel; readonly floor: number; readonly role: string },
): MessageContent {
  return mapTextBlocks(content, (text) => applyRegexRules(text, rules, ctx));
}

/**
 * Returns messages with regex applied for a channel (DB rows unchanged).
 *
 * @param floorByMessageId - From {@link visibleFloorByMessageId}; hidden ids omitted
 */
export function applyRegexChannelToMessages(
  messages: readonly ChatMessage[],
  rules: readonly CompiledRegexRule[],
  channel: RegexChannel,
  floorByMessageId: ReadonlyMap<string, number>,
): ChatMessage[] {
  return messages.map((m) => {
    const floor = floorByMessageId.get(m.id);
    if (floor == null) {
      return m;
    }
    const content = applyRegexToMessageContent(m.content, rules, {
      channel,
      floor,
      role: m.role,
    });
    if (content === m.content) {
      return m;
    }
    return { ...m, content };
  });
}
