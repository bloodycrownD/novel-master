/**
 * Applies active regex group LLM channel to visible messages (shared CLI / Mobile / AgentRunner).
 *
 * @module service/prompt/apply-regex-channel-for-llm
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { applyRegexChannelToMessages } from "@/domain/regex/logic/apply-regex-rules.js";
import { depthByMessageId, listVisibleForDepth } from "@/domain/depth/logic/depth-from-tail.js";
import { resolveActiveCompiledRules } from "@/domain/regex/logic/resolve-active-regex-rules.js";
import type { RegexConfigService } from "../regex/regex-config.port.js";

/**
 * View-time LLM channel transform — same pipeline as CLI `applyActiveRegexChannel(..., 'llm')`.
 */
export async function applyRegexChannelForLlm(
  config: RegexConfigService,
  activeGroupId: string | undefined,
  allSessionMessages: readonly ChatMessage[],
  visibleMessages: readonly ChatMessage[],
): Promise<ChatMessage[]> {
  const rules = await resolveActiveCompiledRules(config, activeGroupId);
  if (rules.length === 0) {
    return [...visibleMessages];
  }
  const visibleSorted = listVisibleForDepth(allSessionMessages);
  const depthMap = depthByMessageId(visibleSorted);
  return applyRegexChannelToMessages(
    visibleMessages,
    rules,
    "llm",
    depthMap,
  );
}
