/**
 * Applies active regex group to visible messages for a channel (CLI/mobile parity).
 */
import {
  applyRegexChannelToMessages,
  visibleFloorByMessageId,
  resolveActiveCompiledRules,
  type ChatMessage,
  type RegexChannel,
  type RegexConfigService,
} from "@novel-master/core";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

export async function applyActiveRegexChannel(
  config: RegexConfigService,
  activeGroupId: string | undefined,
  allSessionMessages: readonly ChatMessage[],
  visibleMessages: readonly ChatMessage[],
  channel: RegexChannel,
): Promise<ChatMessage[]> {
  const rules = await resolveActiveCompiledRules(config, activeGroupId);
  if (rules.length === 0) {
    return [...visibleMessages];
  }
  const floorMap = visibleFloorByMessageId(allSessionMessages);
  return applyRegexChannelToMessages(
    visibleMessages,
    rules,
    channel,
    floorMap,
  );
}

export async function loadSessionMessagesForDisplay(
  runtime: DesktopNovelMasterRuntime,
  sessionId: string,
): Promise<ChatMessage[]> {
  const all = await runtime.messages.listBySession(sessionId);
  const activeGroupId = await runtime.state.getCurrentRegexGroupId();
  return applyActiveRegexChannel(
    runtime.regexConfig,
    activeGroupId,
    all,
    all,
    "display",
  );
}
