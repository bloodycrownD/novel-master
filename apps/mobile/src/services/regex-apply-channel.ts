/**
 * Applies active regex group to visible messages for a channel (CLI parity).
 */
import { visibleFloorByMessageId, type ChatMessage } from "@novel-master/core/chat";

import { applyRegexChannelToMessages, resolveActiveCompiledRules, type RegexChannel, type RegexConfigService } from "@novel-master/core/regex";
import type {MobileNovelMasterRuntime} from '../runtime/types';

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

/**
 * Session messages for chat timeline (display-channel regex; DB unchanged).
 * Includes hidden rows — chat UI greys them out; prompt paths filter hidden separately.
 */
export async function loadSessionMessagesForDisplay(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
): Promise<ChatMessage[]> {
  const all = await runtime.messages.listBySession(sessionId);
  const activeGroupId = await runtime.state.getCurrentRegexGroupId();
  return applyActiveRegexChannel(
    runtime.regexConfig,
    activeGroupId,
    all,
    all,
    'display',
  );
}

export async function loadSessionMessagesTailForDisplay(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  limit: number,
): Promise<ChatMessage[]> {
  const tail = await runtime.messages.listBySessionTail(sessionId, {limit});
  const activeGroupId = await runtime.state.getCurrentRegexGroupId();
  return applyActiveRegexChannel(
    runtime.regexConfig,
    activeGroupId,
    tail,
    tail,
    'display',
  );
}

export async function loadSessionMessagesPageForDisplay(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  options: {limit: number; beforeSeq?: number},
): Promise<ChatMessage[]> {
  const page = await runtime.messages.listBySessionPage(sessionId, options);
  const activeGroupId = await runtime.state.getCurrentRegexGroupId();
  return applyActiveRegexChannel(
    runtime.regexConfig,
    activeGroupId,
    page,
    page,
    'display',
  );
}
