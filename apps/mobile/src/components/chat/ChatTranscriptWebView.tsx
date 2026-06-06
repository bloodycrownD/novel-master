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
  type TranscriptTheme,
} from './ChatTranscriptBridge';
import {buildTranscriptRows} from './message-blocks';
import {
  CHAT_TRANSCRIPT_BASE_URL,
  CHAT_TRANSCRIPT_HTML,
} from '../../web/chat-transcript/transcript-html';
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

  const sendSessionSnapshot = useCallback(() => {
    const rows = buildTranscriptRows(messages);
    postToWeb({
      v: 1,
      type: 'sessionSnapshot',
      payload: {
        sessionKey,
        rows,
        hasMore,
        stream: {text: streamingText, thinking: streamingThinking},
      },
    });
  }, [
    messages,
    streamingText,
    streamingThinking,
    hasMore,
    postToWeb,
    sessionKey,
  ]);

  const sendPrependPage = useCallback(
    (prependedCount: number) => {
      const olderMessages = messages.slice(0, prependedCount);
      postToWeb({
        v: 1,
        type: 'prependPage',
        payload: {
          rows: buildTranscriptRows(olderMessages),
          prependedCount,
        },
      });
    },
    [messages, postToWeb],
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
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      prevStreamTextRef.current = '';
      prevStreamThinkingRef.current = '';
      prevFirstMessageIdRef.current = undefined;
      prevMessageCountRef.current = 0;
      sendSessionSnapshot();
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
      // prependPage: incremental older rows only — avoids full DOM rebuild + scroll jump.
      sendPrependPage(messages.length - prevCount);
    } else {
      sendSessionSnapshot();
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
    if (streamingText.length < prevText.length || streamingThinking.length < prevThinking.length) {
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

  void initialScroll;
  void defaultScrollToBottom;

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
