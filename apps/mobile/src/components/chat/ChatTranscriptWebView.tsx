/**
 * RN WebView wrapper for chat transcript — postMessage both directions via bridge envelopes.
 */
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import {StyleSheet, View} from 'react-native';
import WebView, {type WebViewMessageEvent} from 'react-native-webview';
import type {ChatMessage} from '@novel-master/core';
import {
  encodeHostToTranscript,
  decodeTranscriptToHost,
  parseScrollSnapshotFromHost,
  type ChatTranscriptScrollSnapshot,
  type HostToTranscriptMessage,
  type TranscriptFlags,
  type TranscriptRestoreScroll,
  type TranscriptScrollIntent,
  type TranscriptTheme,
} from './ChatTranscriptBridge';
import {enrichTranscriptRows} from './enrich-transcript-rows';
import {
  buildTranscriptRows,
  messageHasToolUse,
  messageIsToolResultsOnly,
  selectTailTranscriptRows,
} from './message-blocks';
import {
  CHAT_TRANSCRIPT_BASE_URL,
  CHAT_TRANSCRIPT_HTML,
} from '../../web/chat-transcript/transcript-html';
import {
  emitChatTranscriptTelemetry,
} from '../../services/chat-transcript-telemetry';
import {useTheme} from '../../theme/ThemeProvider';
import {prepareStreamTailHtml} from './prepare-stream-tail-html';

export type ChatTranscriptWebViewHandle = {
  pushStreamDelta: (kind: 'text' | 'thinking', delta: string) => void;
  resetStream: () => void;
};

export type ChatTranscriptWebViewProps = {
  readonly sessionKey: string;
  readonly messages: readonly ChatMessage[];
  readonly streamingText?: string;
  readonly streamingThinking?: string;
  readonly hasMore?: boolean;
  readonly flags?: Partial<TranscriptFlags>;
  readonly initialScroll?: ChatTranscriptScrollSnapshot | null;
  /** No cached snapshot: open pinned to bottom. */
  readonly defaultScrollToBottom?: boolean;
  readonly agentRunning?: boolean;
  readonly toolInvoking?: boolean;
  readonly selectedMessageIds?: ReadonlySet<string>;
  readonly affectedMessageIds?: ReadonlySet<string>;
  readonly menuCloseSignal?: number;
  readonly onScrollSnapshot?: (snap: ChatTranscriptScrollSnapshot) => void;
  readonly onReady?: () => void;
  readonly onLoadOlder?: () => void;
  readonly onOpenToolFile?: (path: string) => void;
  readonly onOpenMessageMenu?: (
    messageId: string,
    pageX: number,
    pageY: number,
  ) => void;
  readonly onMessageMenuAction?: (messageId: string, action: string) => void;
  readonly onWebMenuOpenChange?: (open: boolean) => void;
  readonly onToggleMessageSelect?: (messageId: string) => void;
};

function themeFromTokens(tokens: {
  background: string;
  text: string;
  textSecondary: string;
  primary: string;
  danger: string;
  surface: string;
  borderLight: string;
}): TranscriptTheme {
  return {
    background: tokens.background,
    text: tokens.text,
    textSecondary: tokens.textSecondary,
    primary: tokens.primary,
    danger: tokens.danger,
    surface: tokens.surface,
    borderLight: tokens.borderLight,
  };
}

function resolveOpenScrollIntent(
  initialScroll: ChatTranscriptScrollSnapshot | null,
  defaultScrollToBottom: boolean,
): {intent: TranscriptScrollIntent; restoreScroll?: TranscriptRestoreScroll} {
  if (defaultScrollToBottom) {
    return {intent: 'stick'};
  }
  if (initialScroll == null) {
    return {intent: 'stick'};
  }
  if (initialScroll.nearBottom) {
    return {intent: 'stick'};
  }
  return {
    intent: 'restore',
    restoreScroll: {
      offsetY: initialScroll.offsetY,
      nearBottom: initialScroll.nearBottom,
    },
  };
}

function emitScrollRestoreTelemetry(
  intent: TranscriptScrollIntent,
  restoreScroll?: TranscriptRestoreScroll,
): void {
  if (intent === 'restore' && restoreScroll != null) {
    emitChatTranscriptTelemetry({
      name: 'scroll_restore',
      mode: restoreScroll.nearBottom ? 'near_bottom' : 'offset',
      offsetY: restoreScroll.offsetY,
      nearBottom: restoreScroll.nearBottom,
    });
    return;
  }
  if (intent === 'stick') {
    emitChatTranscriptTelemetry({
      name: 'scroll_restore',
      mode: 'stick',
    });
  }
}

export const ChatTranscriptWebView = forwardRef<
  ChatTranscriptWebViewHandle,
  ChatTranscriptWebViewProps
>(function ChatTranscriptWebView(
  {
    sessionKey,
    messages,
    streamingText = '',
    streamingThinking = '',
    hasMore = false,
    flags,
    initialScroll = null,
    defaultScrollToBottom = true,
    agentRunning = false,
    toolInvoking = false,
    selectedMessageIds,
    affectedMessageIds,
    menuCloseSignal = 0,
    onScrollSnapshot,
    onReady,
    onLoadOlder,
    onOpenToolFile,
    onOpenMessageMenu,
    onMessageMenuAction,
    onWebMenuOpenChange,
    onToggleMessageSelect,
  },
  ref,
) {
  const {tokens} = useTheme();
  const webRef = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  const prevStreamTextRef = useRef('');
  const prevStreamThinkingRef = useRef('');
  const sessionKeyRef = useRef(sessionKey);
  const prevFirstMessageIdRef = useRef<string | undefined>(undefined);
  const prevMessageCountRef = useRef(0);
  const prevRichTextRef = useRef(flags?.richText ?? false);
  const prevMessagesRef = useRef(messages);
  const prevSentFlagsRef = useRef<TranscriptFlags | null>(null);
  const lastScrollRef = useRef({nearBottom: true, offsetY: 0});
  const initialScrollRef = useRef(initialScroll);
  const defaultScrollToBottomRef = useRef(defaultScrollToBottom);
  const needsOpenSnapshotRef = useRef(true);
  const snapshotDeferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingSnapshotRef = useRef<{
    intent: TranscriptScrollIntent;
    restoreScroll?: TranscriptRestoreScroll;
  } | null>(null);
  const streamRafRef = useRef<number | null>(null);
  const pendingStreamDeltasRef = useRef({text: '', thinking: ''});
  const streamTextAccumRef = useRef('');
  const streamThinkingAccumRef = useRef('');
  const richTextRef = useRef(flags?.richText ?? false);
  const streamActiveRef = useRef(false);

  useEffect(() => {
    richTextRef.current = flags?.richText ?? false;
  }, [flags?.richText]);

  useEffect(() => {
    initialScrollRef.current = initialScroll;
  }, [initialScroll]);

  useEffect(() => {
    defaultScrollToBottomRef.current = defaultScrollToBottom;
  }, [defaultScrollToBottom]);

  const postToWeb = useCallback((message: HostToTranscriptMessage) => {
    webRef.current?.postMessage(encodeHostToTranscript(message));
  }, []);

  const flushPendingStreamDeltas = useCallback(() => {
    if (streamRafRef.current != null) {
      return;
    }
    streamRafRef.current = requestAnimationFrame(() => {
      streamRafRef.current = null;
      const batch = pendingStreamDeltasRef.current;
      pendingStreamDeltasRef.current = {text: '', thinking: ''};
      const richText = richTextRef.current;
      if (batch.text.length > 0) {
        streamTextAccumRef.current += batch.text;
        const html = prepareStreamTailHtml(streamTextAccumRef.current, richText);
        postToWeb({
          v: 1,
          type: 'streamDelta',
          payload: {
            kind: 'text',
            delta: batch.text,
            ...(html != null ? {html} : {}),
          },
        });
      }
      if (batch.thinking.length > 0) {
        streamThinkingAccumRef.current += batch.thinking;
        const html = prepareStreamTailHtml(
          streamThinkingAccumRef.current,
          richText,
        );
        postToWeb({
          v: 1,
          type: 'streamDelta',
          payload: {
            kind: 'thinking',
            delta: batch.thinking,
            ...(html != null ? {html} : {}),
          },
        });
      }
    });
  }, [postToWeb]);

  const queueStreamDelta = useCallback(
    (kind: 'text' | 'thinking', delta: string) => {
      if (!webReady || delta.length === 0) {
        return;
      }
      streamActiveRef.current = true;
      const pending = pendingStreamDeltasRef.current;
      if (kind === 'text') {
        pending.text += delta;
      } else {
        pending.thinking += delta;
      }
      flushPendingStreamDeltas();
    },
    [webReady, flushPendingStreamDeltas],
  );

  const sendInit = useCallback(() => {
    const resolvedFlags: TranscriptFlags = {
      richText: flags?.richText ?? false,
      batchMode: flags?.batchMode ?? false,
      batchModeKind: flags?.batchModeKind ?? null,
      menuDisabled: agentRunning,
    };
    postToWeb({
      v: 1,
      type: 'init',
      payload: {theme: themeFromTokens(tokens), flags: resolvedFlags},
    });
  }, [
    flags?.richText,
    flags?.batchMode,
    flags?.batchModeKind,
    postToWeb,
    tokens,
    agentRunning,
  ]);

  // C1: sessionSnapshot must not depend on streamingText/streamingThinking — stream tail only via streamDelta.
  const sendSessionSnapshotNow = useCallback(
    (
      scrollIntent: TranscriptScrollIntent,
      restoreScroll?: TranscriptRestoreScroll,
    ) => {
      const richText = flags?.richText ?? false;
      const rows = enrichTranscriptRows(
        buildTranscriptRows(messages, undefined, {agentRunning}),
        richText,
      );
      postToWeb({
        v: 1,
        type: 'sessionSnapshot',
        payload: {
          sessionKey,
          rows,
          hasMore,
          scrollIntent,
          ...(scrollIntent === 'restore' && restoreScroll != null
            ? {restoreScroll}
            : {}),
        },
      });
    },
    [messages, hasMore, postToWeb, sessionKey, flags?.richText, agentRunning],
  );

  const flushPendingSnapshot = useCallback(() => {
    if (snapshotDeferTimerRef.current != null) {
      clearTimeout(snapshotDeferTimerRef.current);
      snapshotDeferTimerRef.current = null;
    }
    const pending = pendingSnapshotRef.current;
    pendingSnapshotRef.current = null;
    if (pending != null) {
      sendSessionSnapshotNow(pending.intent, pending.restoreScroll);
    }
  }, [sendSessionSnapshotNow]);

  const sendSessionSnapshot = useCallback(
    (
      intent: TranscriptScrollIntent,
      restoreScroll?: TranscriptRestoreScroll,
    ) => {
      if (!agentRunning) {
        sendSessionSnapshotNow(intent, restoreScroll);
        return;
      }
      pendingSnapshotRef.current = {intent, restoreScroll};
      if (streamActiveRef.current) {
        return;
      }
      if (snapshotDeferTimerRef.current != null) {
        return;
      }
      snapshotDeferTimerRef.current = setTimeout(() => {
        snapshotDeferTimerRef.current = null;
        if (streamActiveRef.current) {
          return;
        }
        const pending = pendingSnapshotRef.current;
        pendingSnapshotRef.current = null;
        if (pending != null) {
          sendSessionSnapshotNow(pending.intent, pending.restoreScroll);
        }
      }, 0);
    },
    [agentRunning, sendSessionSnapshotNow],
  );

  const sendAppendTailRows = useCallback(
    (tailMessages: readonly ChatMessage[]) => {
      if (tailMessages.length === 0) {
        return;
      }
      const richText = flags?.richText ?? false;
      const rows = enrichTranscriptRows(
        selectTailTranscriptRows(messages, tailMessages, {agentRunning}),
        richText,
      );
      if (rows.length === 0) {
        return;
      }
      postToWeb({
        v: 1,
        type: 'appendTailRows',
        payload: {rows},
      });
    },
    [postToWeb, flags?.richText, agentRunning, messages],
  );

  const resetStreamTail = useCallback(() => {
    if (streamRafRef.current != null) {
      cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    }
    pendingStreamDeltasRef.current = {text: '', thinking: ''};
    streamTextAccumRef.current = '';
    streamThinkingAccumRef.current = '';
    prevStreamTextRef.current = '';
    prevStreamThinkingRef.current = '';
    streamActiveRef.current = false;
    if (webReady) {
      postToWeb({v: 1, type: 'streamReset', payload: {}});
    }
    flushPendingSnapshot();
  }, [webReady, postToWeb, flushPendingSnapshot]);

  useImperativeHandle(
    ref,
    () => ({
      pushStreamDelta: queueStreamDelta,
      resetStream: resetStreamTail,
    }),
    [queueStreamDelta, resetStreamTail],
  );

  const sendPrependPage = useCallback(
    (prependedCount: number) => {
      const richText = flags?.richText ?? false;
      const olderMessages = messages.slice(0, prependedCount);
      postToWeb({
        v: 1,
        type: 'prependPage',
        payload: {
          rows: enrichTranscriptRows(
            buildTranscriptRows(olderMessages, undefined, {agentRunning}),
            richText,
          ),
          prependedCount,
        },
      });
    },
    [messages, postToWeb, flags?.richText, agentRunning],
  );

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let message;
      try {
        message = decodeTranscriptToHost(event.nativeEvent.data);
      } catch {
        return;
      }
      if (message.type === 'ready') {
        setWebReady(true);
        onReady?.();
        return;
      }
      if (message.type === 'scrollSnapshot') {
        const snap = parseScrollSnapshotFromHost(message);
        if (snap) {
          lastScrollRef.current = {
            nearBottom: snap.nearBottom,
            offsetY: snap.offsetY,
          };
          onScrollSnapshot?.(snap);
        }
        return;
      }
      if (message.type === 'loadOlder') {
        onLoadOlder?.();
        return;
      }
      if (message.type === 'openToolFile') {
        onOpenToolFile?.(message.payload.path);
        return;
      }
      if (message.type === 'openMessageMenu') {
        if (agentRunning) {
          return;
        }
        emitChatTranscriptTelemetry({name: 'menu_open'});
        onOpenMessageMenu?.(
          message.payload.messageId,
          message.payload.pageX,
          message.payload.pageY,
        );
        return;
      }
      if (message.type === 'messageMenuAction') {
        onMessageMenuAction?.(
          message.payload.messageId,
          message.payload.action,
        );
        return;
      }
      if (message.type === 'menuOpened') {
        onWebMenuOpenChange?.(true);
        return;
      }
      if (message.type === 'menuClosed') {
        onWebMenuOpenChange?.(false);
        return;
      }
      if (message.type === 'toggleMessageSelect') {
        onToggleMessageSelect?.(message.payload.messageId);
        return;
      }
    },
    [
      onReady,
      onScrollSnapshot,
      onLoadOlder,
      onOpenToolFile,
      onOpenMessageMenu,
      onMessageMenuAction,
      onWebMenuOpenChange,
      onToggleMessageSelect,
      agentRunning,
    ],
  );

  useEffect(() => {
    if (!webReady) {
      return;
    }
    sendInit();
  }, [webReady, sendInit]);

  useEffect(() => {
    if (!webReady) {
      return;
    }
    const resolvedFlags: TranscriptFlags = {
      richText: flags?.richText ?? false,
      batchMode: flags?.batchMode ?? false,
      batchModeKind: flags?.batchModeKind ?? null,
      menuDisabled: agentRunning,
    };
    const prev = prevSentFlagsRef.current;
    if (
      prev != null &&
      prev.richText === resolvedFlags.richText &&
      prev.batchMode === resolvedFlags.batchMode &&
      prev.batchModeKind === resolvedFlags.batchModeKind &&
      prev.menuDisabled === resolvedFlags.menuDisabled
    ) {
      return;
    }
    prevSentFlagsRef.current = resolvedFlags;
    postToWeb({
      v: 1,
      type: 'flagsUpdate',
      payload: {flags: resolvedFlags},
    });
  }, [
    webReady,
    flags?.richText,
    flags?.batchMode,
    flags?.batchModeKind,
    agentRunning,
    postToWeb,
  ]);

  useEffect(() => {
    if (!webReady) {
      return;
    }
    postToWeb({
      v: 1,
      type: 'themeUpdate',
      payload: {theme: themeFromTokens(tokens)},
    });
  }, [webReady, tokens, postToWeb]);

  useEffect(() => {
    if (!webReady) {
      return;
    }
    postToWeb({
      v: 1,
      type: 'selectionUpdate',
      payload: {
        selectedMessageIds: selectedMessageIds
          ? [...selectedMessageIds]
          : [],
        affectedMessageIds: affectedMessageIds
          ? [...affectedMessageIds]
          : [],
      },
    });
  }, [webReady, selectedMessageIds, affectedMessageIds, postToWeb]);

  useEffect(() => {
    if (!webReady || menuCloseSignal === 0) {
      return;
    }
    postToWeb({v: 1, type: 'closeMenu', payload: {}});
  }, [webReady, menuCloseSignal, postToWeb]);

  useEffect(() => {
    if (!webReady) {
      return;
    }
    postToWeb({
      v: 1,
      type: 'streamToolInvoking',
      payload: {active: toolInvoking},
    });
  }, [webReady, toolInvoking, postToWeb]);

  useEffect(() => {
    if (!webReady) {
      return;
    }
    const richText = flags?.richText ?? false;
    if (prevRichTextRef.current === richText) {
      return;
    }
    prevRichTextRef.current = richText;
    sendSessionSnapshot('preserve');
  }, [webReady, flags?.richText, sendSessionSnapshot]);

  useEffect(() => {
    if (!webReady) {
      return;
    }
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      prevStreamTextRef.current = '';
      prevStreamThinkingRef.current = '';
      prevFirstMessageIdRef.current = undefined;
      prevMessageCountRef.current = 0;
      needsOpenSnapshotRef.current = true;
    }

    if (needsOpenSnapshotRef.current) {
      needsOpenSnapshotRef.current = false;
      const {intent, restoreScroll} = resolveOpenScrollIntent(
        initialScrollRef.current,
        defaultScrollToBottomRef.current,
      );
      sendSessionSnapshot(intent, restoreScroll);
      emitScrollRestoreTelemetry(intent, restoreScroll);
      emitChatTranscriptTelemetry({
        name: 'transcript_ready',
        sessionKey,
        rowCount: messages.length,
        hasInitialScroll: initialScrollRef.current != null,
        defaultScrollToBottom: defaultScrollToBottomRef.current,
      });
      prevFirstMessageIdRef.current = messages[0]?.id;
      prevMessageCountRef.current = messages.length;
      prevMessagesRef.current = messages;
      return;
    }

    if (prevMessagesRef.current === messages) {
      return;
    }
    prevMessagesRef.current = messages;

    const firstId = messages[0]?.id;
    const prevFirstId = prevFirstMessageIdRef.current;
    const prevCount = prevMessageCountRef.current;
    const grew = messages.length > prevCount;
    const prependedOlder =
      grew &&
      prevFirstId != null &&
      firstId != null &&
      firstId !== prevFirstId;

    if (prependedOlder) {
      const prependedCount = messages.length - prevCount;
      emitChatTranscriptTelemetry({
        name: 'prepend_detected',
        prependedCount,
        wasNearBottom: lastScrollRef.current.nearBottom,
        offsetYBefore: lastScrollRef.current.offsetY,
      });
      sendPrependPage(prependedCount);
    } else if (agentRunning && grew) {
      const added = messages.slice(prevCount);
      // WHY: appendTail 无法刷新既有行的 toolPhase；含 tool_use / tool_result 落库需全量 snapshot。
      const needsFullSnapshot =
        added.some(messageIsToolResultsOnly) ||
        added.some(
          message =>
            message.role === 'assistant' && messageHasToolUse(message),
        );
      if (needsFullSnapshot) {
        sendSessionSnapshot('preserve');
      } else {
        sendAppendTailRows(added);
      }
    } else {
      sendSessionSnapshot('preserve');
    }

    prevFirstMessageIdRef.current = firstId;
    prevMessageCountRef.current = messages.length;
  }, [
    webReady,
    sessionKey,
    messages,
    agentRunning,
    sendSessionSnapshot,
    sendPrependPage,
    sendAppendTailRows,
  ]);

  // Legacy MessageList path: stream via props. WebView path uses imperative ref (no parent re-render).
  useEffect(() => {
    if (!webReady) {
      return;
    }
    const prevText = prevStreamTextRef.current;
    const prevThinking = prevStreamThinkingRef.current;
    if (
      streamingText.length < prevText.length ||
      streamingThinking.length < prevThinking.length
    ) {
      resetStreamTail();
      return;
    }
    const textDelta = streamingText.slice(prevText.length);
    const thinkingDelta = streamingThinking.slice(prevThinking.length);
    prevStreamTextRef.current = streamingText;
    prevStreamThinkingRef.current = streamingThinking;
    if (textDelta.length > 0) {
      queueStreamDelta('text', textDelta);
    }
    if (thinkingDelta.length > 0) {
      queueStreamDelta('thinking', thinkingDelta);
    }
  }, [
    webReady,
    streamingText,
    streamingThinking,
    queueStreamDelta,
    resetStreamTail,
  ]);

  return (
    <View style={styles.fill}>
      <WebView
        ref={webRef}
        style={styles.fill}
        originWhitelist={['*']}
        source={{html: CHAT_TRANSCRIPT_HTML, baseUrl: CHAT_TRANSCRIPT_BASE_URL}}
        onMessage={handleMessage}
        javaScriptEnabled
        domStorageEnabled
        scrollEnabled={false}
        showsVerticalScrollIndicator={false}
        keyboardDisplayRequiresUserAction={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  fill: {flex: 1, minHeight: 0},
});
