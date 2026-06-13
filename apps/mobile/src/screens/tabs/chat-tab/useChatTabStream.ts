/**
 * Chat tab agent stream buffering: legacy RN list + WebView transcript paths.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {RefObject} from 'react';
import type {ChatTranscriptWebViewHandle} from '../../../components/chat/ChatTranscriptWebView';
import type {ChatTranscriptScrollSnapshot} from '../../../components/chat/ChatTranscriptBridge';
import {useAgentStreamMetrics} from '../../../hooks/useAgentStreamMetrics';
import {
  getScrollSnapshot,
  scrollCacheKey,
  setScrollSnapshot,
  type ChatListScrollSnapshot,
} from '../../../services/chat-list-scroll-cache';
import {
  getTranscriptScrollSnapshot,
  normalizeScrollSnapshot,
  setTranscriptScrollSnapshot,
} from '../../../services/chat-transcript-scroll-cache';
import {emitChatTranscriptTelemetry} from '../../../services/chat-transcript-telemetry';
import {createStreamBuffer} from '../../../services/stream-buffer.service';

export type UseChatTabStreamParams = {
  useWebviewTranscript: boolean;
  transcriptWebRef: RefObject<ChatTranscriptWebViewHandle | null>;
};

export function useChatTabStream({
  useWebviewTranscript,
  transcriptWebRef,
}: UseChatTabStreamParams) {
  const [agentRunning, setAgentRunning] = useState(false);
  const {
    metrics: streamMetrics,
    noteTextDelta,
    noteThinkingDelta,
    noteToolUseDelta,
  } = useAgentStreamMetrics(agentRunning);
  const [streamingText, setStreamingText] = useState('');
  const [streamingThinking, setStreamingThinking] = useState('');
  const streamMetricsRef = useRef({noteTextDelta, noteThinkingDelta, noteToolUseDelta});
  streamMetricsRef.current = {noteTextDelta, noteThinkingDelta, noteToolUseDelta};
  const pendingBusStreamRef = useRef({text: '', thinking: ''});
  const busStreamTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const useWebviewTranscriptRef = useRef(false);
  useWebviewTranscriptRef.current = useWebviewTranscript;

  const streamBuffer = useMemo(
    () =>
      createStreamBuffer({
        onTextFlush: delta => {
          if (useWebviewTranscriptRef.current) {
            return;
          }
          streamMetricsRef.current.noteTextDelta(delta);
          setStreamingText(prev => prev + delta);
        },
        onThinkingFlush: delta => {
          if (useWebviewTranscriptRef.current) {
            return;
          }
          streamMetricsRef.current.noteThinkingDelta(delta);
          setStreamingThinking(prev => prev + delta);
        },
      }),
    [],
  );

  const flushBusStreamToBuffer = useCallback(() => {
    busStreamTimerRef.current = null;
    const pending = pendingBusStreamRef.current;
    if (pending.text.length === 0 && pending.thinking.length === 0) {
      return;
    }
    pendingBusStreamRef.current = {text: '', thinking: ''};
    if (useWebviewTranscriptRef.current) {
      if (pending.text.length > 0) {
        transcriptWebRef.current?.pushStreamDelta('text', pending.text);
        streamMetricsRef.current.noteTextDelta(pending.text);
      }
      if (pending.thinking.length > 0) {
        transcriptWebRef.current?.pushStreamDelta('thinking', pending.thinking);
        streamMetricsRef.current.noteThinkingDelta(pending.thinking);
      }
      return;
    }
    if (pending.text.length > 0) {
      streamBuffer.push('text', pending.text);
    }
    if (pending.thinking.length > 0) {
      streamBuffer.push('thinking', pending.thinking);
    }
  }, [streamBuffer, transcriptWebRef]);

  const scheduleBusStreamFlush = useCallback(() => {
    if (busStreamTimerRef.current != null) {
      return;
    }
    busStreamTimerRef.current = setTimeout(flushBusStreamToBuffer, 32);
  }, [flushBusStreamToBuffer]);

  const handleStreamText = useCallback(
    (delta: string) => {
      pendingBusStreamRef.current.text += delta;
      scheduleBusStreamFlush();
    },
    [scheduleBusStreamFlush],
  );

  const handleStreamThinking = useCallback(
    (delta: string) => {
      pendingBusStreamRef.current.thinking += delta;
      scheduleBusStreamFlush();
    },
    [scheduleBusStreamFlush],
  );

  const handleStreamToolUseDelta = useCallback((delta: string) => {
    if (delta.length === 0) {
      return;
    }
    streamMetricsRef.current.noteToolUseDelta(delta);
  }, []);

  const handleStreamReset = useCallback(() => {
    if (busStreamTimerRef.current != null) {
      clearTimeout(busStreamTimerRef.current);
      busStreamTimerRef.current = null;
    }
    pendingBusStreamRef.current = {text: '', thinking: ''};
    // Discard buffered deltas only — flushing would re-apply text that is already persisted.
    streamBuffer.reset();
    if (useWebviewTranscriptRef.current) {
      transcriptWebRef.current?.resetStream();
    } else {
      setStreamingText('');
      setStreamingThinking('');
    }
  }, [streamBuffer, transcriptWebRef]);

  const resetStreamingDisplay = useCallback(() => {
    setStreamingText('');
    setStreamingThinking('');
  }, []);

  useEffect(() => {
    return () => {
      streamBuffer.dispose();
    };
  }, [streamBuffer]);

  return {
    agentRunning,
    setAgentRunning,
    streamMetrics,
    streamingText,
    streamingThinking,
    handleStreamText,
    handleStreamThinking,
    handleStreamToolUseDelta,
    handleStreamReset,
    resetStreamingDisplay,
  };
}

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

export type UseChatTabStreamResult = ReturnType<typeof useChatTabStream>;
