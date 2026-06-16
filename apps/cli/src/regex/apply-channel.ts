/**
 * Applies active regex group to visible messages for a channel.
 *
 * @module regex/apply-channel
 */

import { type ChatMessage } from "@novel-master/core/chat";


import { depthByMessageId, listVisibleForDepth } from "@novel-master/core/compaction";


import { applyRegexChannelForLlm, applyRegexChannelToMessages, resolveActiveCompiledRules, type RegexChannel, type RegexConfigService } from "@novel-master/core/regex";

/**
 * View-time message transform for llm or display channel.
 */
export async function applyActiveRegexChannel(
  config: RegexConfigService,
  activeGroupId: string | undefined,
  allSessionMessages: readonly ChatMessage[],
  visibleMessages: readonly ChatMessage[],
  channel: RegexChannel,
): Promise<ChatMessage[]> {
  if (channel === "llm") {
    return applyRegexChannelForLlm(
      config,
      activeGroupId,
      allSessionMessages,
      visibleMessages,
    );
  }
  const rules = await resolveActiveCompiledRules(config, activeGroupId);
  if (rules.length === 0) {
    return [...visibleMessages];
  }
  const visibleSorted = listVisibleForDepth(allSessionMessages);
  const depthMap = depthByMessageId(visibleSorted);
  return applyRegexChannelToMessages(
    visibleMessages,
    rules,
    channel,
    depthMap,
  );
}
