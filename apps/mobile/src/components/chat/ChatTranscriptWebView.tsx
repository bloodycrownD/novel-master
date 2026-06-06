/**
 * RN WebView wrapper for chat transcript — postMessage both directions via bridge envelopes.
 */
import React, {useCallback, useEffect, useRef, useState} from 'react';
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
import {buildTranscriptRows} from './message-blocks';
import {
  CHAT_TRANSCRIPT_BASE_URL,
  CHAT_TRANSCRIPT_HTML,
} from '../../web/chat-transcript/transcript-html';
import {
  emitChatTranscriptTelemetry,
} from '../../services/chat-transcript-telemetry';
import {useTheme} from '../../theme/ThemeProvider';

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
  readonly onScrollSnapshot?: (snap: ChatTranscriptScrollSnapshot) => void;
  readonly onReady?: () => void;
  readonly onLoadOlder?: () => void;
  readonly onOpenToolFile?: (path: string) => void;
};

function themeFromTokens(tokens: {
  background: string;
  text: string;
  textSecondary: string;
  primary: string;
  surface: string;
  borderLight: string;
}): TranscriptTheme {
  return {
    background: tokens.background,
    text: tokens.text,
    textSecondary: tokens.textSecondary,
    primary: tokens.primary,
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

export function ChatTranscriptWebView({
  sessionKey,
  messages,
  streamingText = '',
  streamingThinking = '',
  hasMore = false,
  flags,
  initialScroll = null,
  defaultScrollToBottom = true,
  onScrollSnapshot,
  onReady,
  onLoadOlder,
  onOpenToolFile,
}: ChatTranscriptWebViewProps) {
  const {tokens} = useTheme();
  const webRef = useRef<WebView>(null);
  const [webReady, setWebReady] = useState(false);
  const prevStreamTextRef = useRef('');
  const prevStreamThinkingRef = useRef('');
  const sessionKeyRef = useRef(sessionKey);
  const prevFirstMessageIdRef = useRef<string | undefined>(undefined);
  const prevMessageCountRef = useRef(0);
  const prevRichTextRef = useRef(flags?.richText ?? false);
  const lastScrollRef = useRef({nearBottom: true, offsetY: 0});
  const initialScrollRef = useRef(initialScroll);
  const defaultScrollToBottomRef = useRef(defaultScrollToBottom);
  const needsOpenSnapshotRef = useRef(true);

  useEffect(() => {
    initialScrollRef.current = initialScroll;
  }, [initialScroll]);

  useEffect(() => {
    defaultScrollToBottomRef.current = defaultScrollToBottom;
  }, [defaultScrollToBottom]);

  const postToWeb = useCallback((message: HostToTranscriptMessage) => {
    webRef.current?.postMessage(encodeHostToTranscript(message));
  }, []);

  const sendInit = useCallback(() => {
    const resolvedFlags: TranscriptFlags = {
      richText: flags?.richText ?? false,
      showFullToolParams: flags?.showFullToolParams ?? false,
      batchMode: flags?.batchMode ?? false,
    };
    postToWeb({
      v: 1,
      type: 'init',
      payload: {theme: themeFromTokens(tokens), flags: resolvedFlags},
    });
  }, [flags, postToWeb, tokens]);

  // C1: sessionSnapshot must not depend on streamingText/streamingThinking — stream tail only via streamDelta.
  const sendSessionSnapshot = useCallback(
    (
      scrollIntent: TranscriptScrollIntent,
      restoreScroll?: TranscriptRestoreScroll,
    ) => {
      const richText = flags?.richText ?? false;
      const rows = enrichTranscriptRows(buildTranscriptRows(messages), richText);
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
    [messages, hasMore, postToWeb, sessionKey, flags?.richText],
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
            buildTranscriptRows(olderMessages),
            richText,
          ),
          prependedCount,
        },
      });
    },
    [messages, postToWeb, flags?.richText],
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
      }
    },
    [onReady, onScrollSnapshot, onLoadOlder, onOpenToolFile],
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
    postToWeb({
      v: 1,
      type: 'flagsUpdate',
      payload: {
        flags: {
          richText: flags?.richText ?? false,
          showFullToolParams: flags?.showFullToolParams ?? false,
          batchMode: flags?.batchMode ?? false,
        },
      },
    });
  }, [webReady, flags, postToWeb]);

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
      return;
    }

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
    } else {
      sendSessionSnapshot('preserve');
    }

    prevFirstMessageIdRef.current = firstId;
    prevMessageCountRef.current = messages.length;
  }, [webReady, sessionKey, messages, sendSessionSnapshot, sendPrependPage]);

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
      postToWeb({v: 1, type: 'streamReset', payload: {}});
      prevStreamTextRef.current = '';
      prevStreamThinkingRef.current = '';
      return;
    }
    const textDelta = streamingText.slice(prevText.length);
    const thinkingDelta = streamingThinking.slice(prevThinking.length);
    if (textDelta.length > 0) {
      postToWeb({
        v: 1,
        type: 'streamDelta',
        payload: {kind: 'text', delta: textDelta},
      });
    }
    if (thinkingDelta.length > 0) {
      postToWeb({
        v: 1,
        type: 'streamDelta',
        payload: {kind: 'thinking', delta: thinkingDelta},
      });
    }
    prevStreamTextRef.current = streamingText;
    prevStreamThinkingRef.current = streamingThinking;
  }, [webReady, streamingText, streamingThinking, postToWeb]);

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
}

const styles = StyleSheet.create({
  fill: {flex: 1, minHeight: 0},
});
