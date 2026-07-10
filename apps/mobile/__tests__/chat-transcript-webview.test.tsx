import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import { type ChatMessage } from "@novel-master/core/chat";
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

function assistantWithToolUse(id: string, seq: number): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq,
    role: 'assistant',
    content: {
      blocks: [{type: 'tool_use', id: `tu-${id}`, name: 'read', input: {}}],
    },
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

function assistantTextMessage(id: string, seq: number, text: string): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq,
    role: 'assistant',
    content: {blocks: [{type: 'text', text}]},
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

function toolResultsUserMessage(id: string, seq: number, toolUseId: string): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq,
    role: 'user',
    content: {
      blocks: [{type: 'tool_result', tool_use_id: toolUseId, content: 'ok'}],
    },
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

function streamToolInvokingActiveSince(clearAfterIndex: number): boolean[] {
  return mockWebViewPostMessages
    .slice(clearAfterIndex)
    .map(raw => decodeHostToTranscript(raw))
    .flatMap(msg =>
      msg.type === 'streamToolInvoking' ? [msg.payload.active] : [],
    );
}

function snapshotScrollIntentsSince(
  clearAfterIndex: number,
): Array<'stick' | 'restore' | 'preserve'> {
  return mockWebViewPostMessages
    .slice(clearAfterIndex)
    .map(raw => decodeHostToTranscript(raw))
    .filter(msg => msg.type === 'sessionSnapshot')
    .map(msg => {
      if (msg.type === 'sessionSnapshot') {
        return msg.payload.scrollIntent;
      }
      return undefined;
    })
    .filter(
      (intent): intent is 'stick' | 'restore' | 'preserve' => intent != null,
    );
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

async function flushDeferredSnapshot(): Promise<void> {
  await act(async () => {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
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

  it('richText 开启时 text streamDelta 应包含 RN html（与 spec 契约一致）', async () => {
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
      expect(textDelta.payload.delta).toContain('**bold**');
      expect(typeof textDelta.payload.html).toBe('string');
      expect(textDelta.payload.html?.length).toBeGreaterThan(0);
    }
  });

  it('richText 开启时 thinking streamDelta 应包含 RN html（与 spec 契约一致）', async () => {
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
      expect(thinkingDelta.payload.delta).toContain('*reason*');
      expect(typeof thinkingDelta.payload.html).toBe('string');
      expect(thinkingDelta.payload.html?.length).toBeGreaterThan(0);
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

  it('webReady 后 toolInvoking 变化 post streamToolInvoking', async () => {
    const messages = [sampleMessage('m1', 1)];
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          toolInvoking={false}
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
          toolInvoking
        />,
      );
    });

    const invokingMsg = mockWebViewPostMessages
      .slice(baseline)
      .map(raw => decodeHostToTranscript(raw))
      .find(msg => msg.type === 'streamToolInvoking');
    expect(invokingMsg?.type).toBe('streamToolInvoking');
    if (invokingMsg?.type === 'streamToolInvoking') {
      expect(invokingMsg.payload.active).toBe(true);
    }
  });

  it('T-S3: uiRunning 时 sessionSnapshot preserve 后仍 post streamToolInvoking', async () => {
    const messages = [sampleMessage('m1', 1)];
    const edited = {
      ...messages[0]!,
      content: {blocks: [{type: 'text' as const, text: 'edited'}]},
    };
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          uiRunning
          toolInvoking
        />,
      );
    });

    simulateWebReady(tree!.root);
    await flushDeferredSnapshot();

    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={[edited]}
          uiRunning
          toolInvoking
        />,
      );
    });
    await flushDeferredSnapshot();

    const snapshotMsg = mockWebViewPostMessages
      .slice(baseline)
      .map(raw => decodeHostToTranscript(raw))
      .find(msg => msg.type === 'sessionSnapshot');
    expect(snapshotMsg?.type).toBe('sessionSnapshot');
    if (snapshotMsg?.type === 'sessionSnapshot') {
      expect(snapshotMsg.payload.scrollIntent).toBe('preserve');
      expect(snapshotMsg.payload.generating).toBe(true);
    }
    expect(streamToolInvokingActiveSince(baseline)).toContain(true);
  });

  it('T-S3b: uiRunning 时 streamReset / streamCommit 后仍 post streamToolInvoking', async () => {
    const messages = [sampleMessage('m1', 1)];
    const assistant = assistantTextMessage('a1', 2, 'done');
    let tree: TestRenderer.ReactTestRenderer;
    const ref = React.createRef<import('../src/components/chat/ChatTranscriptWebView').ChatTranscriptWebViewHandle>();

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          ref={ref}
          sessionKey="p1:s1"
          messages={messages}
          uiRunning
          toolInvoking
        />,
      );
    });

    simulateWebReady(tree!.root);
    await flushDeferredSnapshot();

    await act(async () => {
      ref.current?.pushStreamDelta('text', 'partial');
    });
    await flushAnimationFrame();

    const baselineReset = mockWebViewPostMessages.length;

    await act(async () => {
      ref.current?.resetStream();
    });

    expect(streamToolInvokingActiveSince(baselineReset)).toContain(true);

    await act(async () => {
      ref.current?.pushStreamDelta('text', 'stream done');
    });
    await flushAnimationFrame();

    const baselineCommit = mockWebViewPostMessages.length;
    ref.current?.tryCommitStreamTail([...messages, assistant], messages.length);

    expect(messageTypesSince(baselineCommit)).toContain('streamCommit');
    expect(streamToolInvokingActiveSince(baselineCommit)).toContain(true);
  });

  it('richText flag 切换时不抛错并 post sessionSnapshot', async () => {
    const messages = [sampleMessage('m1', 1)];
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          flags={{richText: false, batchMode: false}}
        />,
      );
    });

    simulateWebReady(tree!.root);
    await flushDeferredSnapshot();

    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          flags={{richText: true, batchMode: false}}
        />,
      );
    });
    await flushDeferredSnapshot();

    const typesAfterToggle = messageTypesSince(baseline);
    expect(typesAfterToggle).toContain('sessionSnapshot');
  });

  it('T-kkv-batch-off: pushStreamDelta 同一 RAF 内按到达序 post streamDelta', async () => {
    const messages = [sampleMessage('m1', 1)];
    let tree: TestRenderer.ReactTestRenderer;
    const ref = React.createRef<import('../src/components/chat/ChatTranscriptWebView').ChatTranscriptWebViewHandle>();

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          ref={ref}
          sessionKey="p1:s1"
          messages={messages}
        />,
      );
    });

    simulateWebReady(tree!.root);
    await act(async () => {
      await Promise.resolve();
    });

    const baseline = mockWebViewPostMessages.length;

    // think A → text B → think C，须与 runtime FIFO 一致
    await act(async () => {
      ref.current?.pushStreamDelta('thinking', 'A');
      ref.current?.pushStreamDelta('text', 'B');
      ref.current?.pushStreamDelta('thinking', 'C');
    });
    await flushAnimationFrame();

    const streamDeltas = mockWebViewPostMessages
      .slice(baseline)
      .map(raw => decodeHostToTranscript(raw))
      .filter(msg => msg.type === 'streamDelta');

    expect(streamDeltas).toHaveLength(3);
    expect(
      streamDeltas.map(msg => {
        if (msg.type !== 'streamDelta') {
          return null;
        }
        return {kind: msg.payload.kind, delta: msg.payload.delta};
      }),
    ).toEqual([
      {kind: 'thinking', delta: 'A'},
      {kind: 'text', delta: 'B'},
      {kind: 'thinking', delta: 'C'},
    ]);
  });

  it('imperative pushStreamBatch 发送 streamBatch 且 rich 含 html', async () => {
    const messages = [sampleMessage('m1', 1)];
    let tree: TestRenderer.ReactTestRenderer;
    const ref = React.createRef<import('../src/components/chat/ChatTranscriptWebView').ChatTranscriptWebViewHandle>();

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          ref={ref}
          sessionKey="p1:s1"
          messages={messages}
          flags={{richText: true, batchMode: false}}
        />,
      );
    });

    simulateWebReady(tree!.root);
    await act(async () => {
      await Promise.resolve();
    });

    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      ref.current?.pushStreamBatch({
        segments: [
          {kind: 'thinking', delta: '*r*'},
          {kind: 'text', delta: '**b**'},
        ],
      });
    });
    await flushAnimationFrame();

    const batchMsg = mockWebViewPostMessages
      .slice(baseline)
      .map(raw => decodeHostToTranscript(raw))
      .find(msg => msg.type === 'streamBatch');
    expect(batchMsg?.type).toBe('streamBatch');
    if (batchMsg?.type === 'streamBatch') {
      expect(batchMsg.payload.segments).toEqual([
        {kind: 'thinking', delta: '*r*'},
        {kind: 'text', delta: '**b**'},
      ]);
      expect(typeof batchMsg.payload.textHtml).toBe('string');
      expect(batchMsg.payload.textHtml!.length).toBeGreaterThan(0);
      expect(typeof batchMsg.payload.thinkingHtml).toBe('string');
      expect(batchMsg.payload.thinkingHtml!.length).toBeGreaterThan(0);
    }
  });

  it('agent 运行中 assistant 含 tool_use 落库时走 sessionSnapshot 而非 appendTailRows', async () => {
    const initialMessages = [sampleMessage('u1', 1)];
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={initialMessages}
          agentRunning
        />,
      );
    });

    simulateWebReady(tree!.root);
    await flushDeferredSnapshot();

    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={[...initialMessages, assistantWithToolUse('a1', 2)]}
          agentRunning
        />,
      );
    });
    await flushDeferredSnapshot();

    const typesAfterCommit = messageTypesSince(baseline);
    expect(typesAfterCommit).toContain('sessionSnapshot');
    expect(typesAfterCommit).not.toContain('appendTailRows');
  });

  it('T-W1: tool_results-only user 落库走 sessionSnapshot', async () => {
    const initialMessages = [
      sampleMessage('u1', 1),
      assistantWithToolUse('a1', 2),
    ];
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={initialMessages}
          agentRunning
          uiRunning
        />,
      );
    });

    simulateWebReady(tree!.root);
    await flushDeferredSnapshot();

    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={[
            ...initialMessages,
            toolResultsUserMessage('tr1', 3, 'tu-a1'),
          ]}
          agentRunning
          uiRunning
        />,
      );
    });
    await flushDeferredSnapshot();

    const typesAfterCommit = messageTypesSince(baseline);
    expect(typesAfterCommit).toContain('sessionSnapshot');
    expect(typesAfterCommit).not.toContain('appendTailRows');
  });

  it('T-W2: 纯 text assistant 运行中落库走 appendTailRows', async () => {
    const initialMessages = [sampleMessage('u1', 1)];
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={initialMessages}
          agentRunning
          uiRunning
        />,
      );
    });

    simulateWebReady(tree!.root);
    await flushDeferredSnapshot();

    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={[...initialMessages, assistantTextMessage('a1', 2, 'hello')]}
          agentRunning
          uiRunning
        />,
      );
    });
    await flushDeferredSnapshot();

    const typesAfterCommit = messageTypesSince(baseline);
    expect(typesAfterCommit).toContain('appendTailRows');
    expect(typesAfterCommit).not.toContain('sessionSnapshot');
  });

  it('T-W3: streamCommit 后 messages 更新不再重复 sessionSnapshot', async () => {
    const initialMessages = [sampleMessage('u1', 1)];
    const assistant = assistantTextMessage('a1', 2, 'stream done');
    let tree: TestRenderer.ReactTestRenderer;
    const ref = React.createRef<import('../src/components/chat/ChatTranscriptWebView').ChatTranscriptWebViewHandle>();

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          ref={ref}
          sessionKey="p1:s1"
          messages={initialMessages}
          agentRunning
          uiRunning
        />,
      );
    });

    simulateWebReady(tree!.root);
    await flushDeferredSnapshot();

    await act(async () => {
      ref.current?.pushStreamDelta('text', 'stream done');
    });
    await flushAnimationFrame();

    const baseline = mockWebViewPostMessages.length;
    const committed = ref.current?.tryCommitStreamTail(
      [...initialMessages, assistant],
      initialMessages.length,
    );
    expect(committed).toBe(true);

    const typesAfterCommit = messageTypesSince(baseline);
    expect(typesAfterCommit).toContain('streamCommit');
    expect(typesAfterCommit).not.toContain('streamReset');

    const baseline2 = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          ref={ref}
          sessionKey="p1:s1"
          messages={[...initialMessages, assistant]}
          agentRunning={false}
          uiRunning={false}
        />,
      );
    });
    await flushDeferredSnapshot();

    const typesAfterReload = messageTypesSince(baseline2);
    expect(typesAfterReload).not.toContain('sessionSnapshot');
    expect(typesAfterReload).not.toContain('appendTailRows');
  });

  it('T-W4: abort resetStream 仍清 stream tail', async () => {
    const messages = [sampleMessage('m1', 1)];
    let tree: TestRenderer.ReactTestRenderer;
    const ref = React.createRef<import('../src/components/chat/ChatTranscriptWebView').ChatTranscriptWebViewHandle>();

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView ref={ref} sessionKey="p1:s1" messages={messages} />,
      );
    });

    simulateWebReady(tree!.root);
    await flushDeferredSnapshot();

    await act(async () => {
      ref.current?.pushStreamDelta('text', 'partial');
    });
    await flushAnimationFrame();

    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      ref.current?.resetStream();
    });

    const typesAfterReset = messageTypesSince(baseline);
    expect(typesAfterReset).toContain('streamReset');
    expect(typesAfterReset).not.toContain('streamCommit');
  });

  it('列表缩短（回滚/删除）时 sessionSnapshot 使用 stick', async () => {
    const initialMessages = [
      sampleMessage('m1', 1),
      sampleMessage('m2', 2),
      sampleMessage('m3', 3),
    ];
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView sessionKey="p1:s1" messages={initialMessages} />,
      );
    });

    simulateWebReady(tree!.root);
    await flushDeferredSnapshot();

    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={[initialMessages[0]!]}
        />,
      );
    });
    await flushDeferredSnapshot();

    const intentsAfterShrink = snapshotScrollIntentsSince(baseline);
    expect(intentsAfterShrink).toContain('stick');
    expect(intentsAfterShrink).not.toContain('preserve');
  });

  it('同长度但 firstId 变化（满页回滚）时 sessionSnapshot 使用 stick', async () => {
    const initialMessages = Array.from({length: 40}, (_, i) =>
      sampleMessage(`old-${i + 1}`, i + 1),
    );
    const afterRollback = Array.from({length: 40}, (_, i) =>
      sampleMessage(`new-${i + 1}`, i + 1),
    );
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView sessionKey="p1:s1" messages={initialMessages} />,
      );
    });

    simulateWebReady(tree!.root);
    await flushDeferredSnapshot();

    const baseline = mockWebViewPostMessages.length;

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView sessionKey="p1:s1" messages={afterRollback} />,
      );
    });
    await flushDeferredSnapshot();

    const intentsAfterReplace = snapshotScrollIntentsSince(baseline);
    expect(intentsAfterReplace).toContain('stick');
    expect(intentsAfterReplace).not.toContain('preserve');
  });

  it('同长度消息变更时 sessionSnapshot 仍使用 preserve', async () => {
    const initialMessages = [
      sampleMessage('m1', 1),
      sampleMessage('m2', 2),
    ];
    let tree: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView sessionKey="p1:s1" messages={initialMessages} />,
      );
    });

    simulateWebReady(tree!.root);
    await flushDeferredSnapshot();

    const baseline = mockWebViewPostMessages.length;

    const updatedSameLength = [
      {...initialMessages[0]!, hidden: true},
      initialMessages[1]!,
    ];

    await act(async () => {
      tree!.update(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={updatedSameLength}
        />,
      );
    });
    await flushDeferredSnapshot();

    const intentsAfterSameLength = snapshotScrollIntentsSince(baseline);
    expect(intentsAfterSameLength).toContain('preserve');
    expect(intentsAfterSameLength).not.toContain('stick');
  });
});
