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
import {emitChatTranscriptTelemetry} from '../src/services/chat-transcript-telemetry';

const mockEmitTelemetry = emitChatTranscriptTelemetry as jest.MockedFunction<
  typeof emitChatTranscriptTelemetry
>;

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

function simulateWebMessage(
  root: TestRenderer.ReactTestInstance,
  type: string,
  payload: Record<string, unknown> = {},
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
          type,
          payload,
        }),
      },
    });
  });
}

function simulateWebReady(
  root: TestRenderer.ReactTestInstance,
): void {
  simulateWebMessage(root, 'ready', {version: 'test'});
}

async function flushAnimationFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => {
      requestAnimationFrame(() => resolve());
    });
  });
}

describe('ChatTranscriptWebView', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
    mockEmitTelemetry.mockClear();
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
    await flushAnimationFrame();

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
    await flushAnimationFrame();

    const typesAfterMoreStream = messageTypesSince(baseline2);
    expect(typesAfterMoreStream).not.toContain('sessionSnapshot');
    expect(typesAfterMoreStream.filter(t => t === 'streamDelta').length).toBeGreaterThanOrEqual(1);
  });

  it('includes stream tail html in streamDelta when richText is enabled', async () => {
    const messages = [sampleMessage('m1', 1)];
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          streamingText=""
          streamingThinking=""
          flags={{richText: true,  batchMode: false}}
        />,
      );
    });

    simulateWebReady(tree!.root);
    await act(async () => {
      await Promise.resolve();
    });

    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          streamingText="**bold**"
          streamingThinking=""
          flags={{richText: true,  batchMode: false}}
        />,
      );
    });
    await flushAnimationFrame();

    const streamMessages = mockWebViewPostMessages
      .slice(baseline)
      .map(raw => decodeHostToTranscript(raw))
      .filter(msg => msg.type === 'streamDelta');

    expect(streamMessages.length).toBeGreaterThanOrEqual(1);
    const textDelta = streamMessages.find(
      msg => msg.type === 'streamDelta' && msg.payload.kind === 'text',
    );
    expect(textDelta?.type).toBe('streamDelta');
    if (textDelta?.type === 'streamDelta') {
      expect(textDelta.payload.html).toBeDefined();
      expect(textDelta.payload.html).toContain('<strong>');
    }
  });

  it('includes thinking stream html in streamDelta when richText is enabled', async () => {
    const messages = [sampleMessage('m1', 1)];
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          streamingText=""
          streamingThinking=""
          flags={{richText: true,  batchMode: false}}
        />,
      );
    });

    simulateWebReady(tree!.root);
    await act(async () => {
      await Promise.resolve();
    });

    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          streamingText=""
          streamingThinking="*reason*"
          flags={{richText: true,  batchMode: false}}
        />,
      );
    });
    await flushAnimationFrame();

    const thinkingDelta = mockWebViewPostMessages
      .slice(baseline)
      .map(raw => decodeHostToTranscript(raw))
      .find(
        msg => msg.type === 'streamDelta' && msg.payload.kind === 'thinking',
      );
    expect(thinkingDelta?.type).toBe('streamDelta');
    if (thinkingDelta?.type === 'streamDelta') {
      expect(thinkingDelta.payload.html).toBeDefined();
      expect(thinkingDelta.payload.html).toContain('<em>');
    }
  });

  it('T7: menu open path does not post sessionSnapshot or flagsUpdate when flag values unchanged', async () => {
    const messages = [sampleMessage('m1', 1)];

    function UnstableFlagsParent() {
      const [, setMenuTick] = React.useState(0);
      return (
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          flags={{
            richText: false,
            batchMode: false,
          }}
          onOpenMessageMenu={() => {
            setMenuTick(tick => tick + 1);
          }}
        />
      );
    }

    let tree: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<UnstableFlagsParent />);
    });

    simulateWebReady(tree!.root);
    await act(async () => {
      await Promise.resolve();
    });

    const baseline = mockWebViewPostMessages.length;

    simulateWebMessage(tree!.root, 'openMessageMenu', {
      messageId: 'm1',
      pageX: 120,
      pageY: 240,
    });
    simulateWebMessage(tree!.root, 'menuOpened', {});

    await act(async () => {
      await Promise.resolve();
    });

    const typesAfterMenu = messageTypesSince(baseline);
    expect(typesAfterMenu).not.toContain('sessionSnapshot');
    expect(typesAfterMenu).not.toContain('flagsUpdate');
    expect(mockEmitTelemetry).toHaveBeenCalledWith({name: 'menu_open'});
  });

  it('T7: new flags object ref with same values does not post flagsUpdate', async () => {
    const messages = [sampleMessage('m1', 1)];
    const baseFlags = {
      richText: false,
      batchMode: false,
    };
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          flags={baseFlags}
        />,
      );
    });

    simulateWebReady(tree!.root);
    await act(async () => {
      await Promise.resolve();
    });

    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          flags={{...baseFlags}}
        />,
      );
    });

    const typesAfterRerender = messageTypesSince(baseline);
    expect(typesAfterRerender).not.toContain('flagsUpdate');
    expect(typesAfterRerender).not.toContain('sessionSnapshot');
  });
});
