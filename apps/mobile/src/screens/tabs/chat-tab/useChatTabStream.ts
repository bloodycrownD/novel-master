/**
 * Chat tab scroll cache helpers (legacy RN + WebView transcript).
 */
import {useCallback, useEffect} from 'react';
import type {ChatTranscriptScrollSnapshot} from '@/components/chat/ChatTranscriptBridge';
import {
  getScrollSnapshot,
  scrollCacheKey,
  setScrollSnapshot,
  type ChatListScrollSnapshot,
} from '@/services/chat-list-scroll-cache';
import {
  getTranscriptScrollSnapshot,
  normalizeScrollSnapshot,
  setTranscriptScrollSnapshot,
} from '@/services/chat-transcript-scroll-cache';
import {emitChatTranscriptTelemetry} from '@/services/chat-transcript-telemetry';

export type UseChatTabScrollCacheParams = {
  projectId: string | undefined;
  sessionId: string | undefined;
  useWebviewTranscript: boolean;
};

export function useChatTabScrollCache({
  projectId,
  sessionId,
  useWebviewTranscript,
}: UseChatTabScrollCacheParams) {
  const chatScrollKey =
    projectId != null && sessionId != null
      ? scrollCacheKey(projectId, sessionId)
      : null;
  const legacyCachedScroll = chatScrollKey
    ? getScrollSnapshot(chatScrollKey)
    : undefined;
  const transcriptCachedScroll = chatScrollKey
    ? getTranscriptScrollSnapshot(chatScrollKey)
    : undefined;
  const rawCachedScroll = transcriptCachedScroll ?? legacyCachedScroll;
  const {snapshot: restoredTranscriptScroll, discardedLegacy} =
    normalizeScrollSnapshot(rawCachedScroll);

  useEffect(() => {
    if (!useWebviewTranscript || !discardedLegacy || rawCachedScroll == null) {
      return;
    }
    const seenVersion =
      'schemaVersion' in rawCachedScroll &&
      typeof rawCachedScroll.schemaVersion === 'number'
        ? rawCachedScroll.schemaVersion
        : undefined;
    emitChatTranscriptTelemetry({
      name: 'legacy_cache_discarded',
      reason: 'wrong_version',
      ...(seenVersion != null ? {seenVersion} : {}),
    });
  }, [useWebviewTranscript, discardedLegacy, chatScrollKey, rawCachedScroll]);

  const cachedChatScroll = useWebviewTranscript
    ? restoredTranscriptScroll
    : legacyCachedScroll;
  const defaultChatScrollToBottom =
    chatScrollKey != null && cachedChatScroll == null;

  const handleChatScrollSnapshot = useCallback(
    (snap: ChatListScrollSnapshot | ChatTranscriptScrollSnapshot) => {
      if (chatScrollKey == null) {
        return;
      }
      if (useWebviewTranscript && 'schemaVersion' in snap) {
        setTranscriptScrollSnapshot(chatScrollKey, snap);
        return;
      }
      if (!useWebviewTranscript && !('schemaVersion' in snap)) {
        setScrollSnapshot(chatScrollKey, snap);
      }
    },
    [chatScrollKey, useWebviewTranscript],
  );

  return {
    chatScrollKey,
    restoredTranscriptScroll,
    cachedChatScroll,
    defaultChatScrollToBottom,
    handleChatScrollSnapshot,
  };
}

export type UseChatTabScrollCacheResult = ReturnType<typeof useChatTabScrollCache>;
