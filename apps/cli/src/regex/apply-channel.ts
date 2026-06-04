/**
 * Applies active regex group to visible messages for a channel.
 *
 * @module regex/apply-channel
 */

import {
  applyRegexChannelForLlm,
  applyRegexChannelToMessages,
  depthByMessageId,
  listVisibleForDepth,
  resolveActiveCompiledRules,
  type ChatMessage,
  type RegexChannel,
  type RegexConfigService,
} from "@novel-master/core";

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
