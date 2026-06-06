import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import type {ChatMessage} from '@novel-master/core';
import {
  CHAT_TRANSCRIPT_BRIDGE_VERSION,
  decodeHostToTranscript,
} from '../src/components/chat/ChatTranscriptBridge';
import {ChatTranscriptWebView} from '../src/components/chat/ChatTranscriptWebView';
import {
  clearMockWebViewPostMessages,
  mockWebViewPostMessages,
} from '../test-utils/react-native-webview-mock';

jest.mock('../src/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      surface: '#111',
      borderLight: '#222',
      textSecondary: '#ccc',
      primary: '#08f',
      text: '#fff',
    },
  }),
}));

jest.mock('../src/services/chat-transcript-telemetry', () => ({
  emitChatTranscriptTelemetry: jest.fn(),
}));

function sampleMessage(id: string, seq: number): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq,
    role: 'user',
    content: {blocks: [{type: 'text', text: `msg-${id}`}]},
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

function messageTypesSince(clearAfterIndex: number): string[] {
  return mockWebViewPostMessages.slice(clearAfterIndex).map(raw => {
    const parsed = decodeHostToTranscript(raw);
    return parsed.type;
  });
}

function simulateWebReady(
  root: TestRenderer.ReactTestInstance,
): void {
  const webView = root.findByType(
    require('react-native-webview').default as React.ComponentType<{
      onMessage?: (event: {nativeEvent: {data: string}}) => void;
    }>,
  );
  act(() => {
    webView.props.onMessage?.({
      nativeEvent: {
        data: JSON.stringify({
          v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
          type: 'ready',
          payload: {version: 'test'},
        }),
      },
    });
  });
}

describe('ChatTranscriptWebView', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(() => {
    clearMockWebViewPostMessages();
  });

  it('C1: stream-only prop changes post streamDelta, not sessionSnapshot', async () => {
    const messages = [sampleMessage('m1', 1)];
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          streamingText=""
          streamingThinking=""
        />,
      );
    });

    simulateWebReady(tree!.root);

    await act(async () => {
      await Promise.resolve();
    });

    const baseline = mockWebViewPostMessages.length;
    expect(messageTypesSince(0)).toContain('sessionSnapshot');

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          streamingText="hello"
          streamingThinking=""
        />,
      );
    });

    const typesAfterStream = messageTypesSince(baseline);
    expect(typesAfterStream).not.toContain('sessionSnapshot');
    expect(typesAfterStream).toContain('streamDelta');

    const baseline2 = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          streamingText="hello world"
          streamingThinking="think"
        />,
      );
    });

    const typesAfterMoreStream = messageTypesSince(baseline2);
    expect(typesAfterMoreStream).not.toContain('sessionSnapshot');
    expect(typesAfterMoreStream.filter(t => t === 'streamDelta').length).toBeGreaterThanOrEqual(1);
  });
});
