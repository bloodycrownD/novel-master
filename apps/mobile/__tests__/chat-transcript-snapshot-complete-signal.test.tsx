/**
 * T-R5 组件半（rollback-large-jank Step 5）：onSnapshotComplete 回调。
 *
 * - 完整走完的快照（末片 post + deferred actions 排空后）恰 notify 一次；
 * - aborted 代次（被新代次顶替 / 重挂）不额外 notify——该次快照未生效；
 * - 缺省不传回调零影响（既有行为）。
 *
 * 照 chat-transcript-webview.test.tsx 先例的 mock 基建。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Platform} from 'react-native';
import {type ChatMessage} from '@novel-master/core/chat';
import {
  CHAT_TRANSCRIPT_BRIDGE_VERSION,
  decodeHostToTranscript,
} from '@/components/chat/ChatTranscriptBridge';
import {ChatTranscriptWebView} from '@/components/chat/ChatTranscriptWebView';
import type {ChatTranscriptWebViewHandle} from '@/components/chat/ChatTranscriptWebView';
import {
  clearMockWebViewPostMessages,
  mockWebViewPostMessages,
} from '../test-utils/react-native-webview-mock';

jest.mock('@/theme/ThemeProvider', () => ({
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

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: jest.fn()},
}));

jest.mock('sanitize-html', () => {
  const fn = jest.fn((html: string) => html);
  (fn as {defaults?: unknown}).defaults = {
    allowedTags: ['p', 'a', 'span', 'div'],
    allowedAttributes: {
      a: ['href', 'name', 'target', 'rel'],
    },
  };
  return fn;
});

jest.mock('@/services/chat-transcript-telemetry', () => ({
  emitChatTranscriptTelemetry: jest.fn(),
}));

jest.mock('@/services/yield-quantum', () => ({
  createQuantumYield: () => () =>
    new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    }),
}));

jest.mock('react-native-blob-util', () => ({
  __esModule: true,
  default: {
    fs: {
      dirs: {MainBundleDir: '/App/NovelMaster.app'},
    },
  },
}));

Object.defineProperty(Platform, 'OS', {
  configurable: true,
  get: () => 'android',
});

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

describe('onSnapshotComplete 回调（T-R5 组件半）', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(() => {
    clearMockWebViewPostMessages();
  });

  async function flushSnapshotChunks(rounds = 16): Promise<void> {
    for (let i = 0; i < rounds; i++) {
      const before = mockWebViewPostMessages.length;
      await act(async () => {
        await new Promise<void>(resolve => {
          setTimeout(resolve, 0);
        });
      });
      if (mockWebViewPostMessages.length === before) {
        break;
      }
    }
  }

  function simulateWebReady(root: TestRenderer.ReactTestInstance): void {
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

  /** 记录 notify 时刻已 post 的 sessionSnapshot 消息总数（时序锚点）。 */
  function sessionSnapshotCount(): number {
    return mockWebViewPostMessages.filter(raw => {
      const msg = decodeHostToTranscript(raw);
      return msg.type === 'sessionSnapshot';
    }).length;
  }

  it('T-R5: notify 次数 = 完整代次数（aborted 不发）；最后 notify 晚于最后末片 post', async () => {
    // 120 条 → 3 片：分片在途存在让步点，force 开新代次可制造 aborted。
    const messages = Array.from({length: 120}, (_, i) =>
      sampleMessage(`m-${i + 1}`, i + 1),
    );
    const notifyAtSnapshotCount: number[] = [];
    const onSnapshotComplete = jest.fn(() => {
      notifyAtSnapshotCount.push(sessionSnapshotCount());
    });
    let tree!: TestRenderer.ReactTestRenderer;
    const ref = React.createRef<ChatTranscriptWebViewHandle>();

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          ref={ref}
          sessionKey="p1:s1"
          messages={messages}
          onSnapshotComplete={onSnapshotComplete}
        />,
      );
    });
    simulateWebReady(tree.root);
    // 推进一轮让步：首代次在途（发部分片）时 force 开新代次。
    await act(async () => {
      await new Promise<void>(resolve => {
        setTimeout(resolve, 0);
      });
    });
    await act(async () => {
      ref.current?.forceSnapshot();
    });
    await flushSnapshotChunks();

    const snapshots = mockWebViewPostMessages
      .map(raw => decodeHostToTranscript(raw))
      .flatMap(msg =>
        msg.type === 'sessionSnapshot' ? [msg.payload] : [],
      );
    // 完整代次 = 该代次发过末片（chunkIndex === chunkTotal-1）；
    // aborted 代次发不满（在让步点被顶替作废），不计入。
    const byGeneration = new Map<number, number[]>();
    for (const payload of snapshots) {
      const list = byGeneration.get(payload.generation) ?? [];
      list.push(payload.chunkIndex);
      byGeneration.set(payload.generation, list);
    }
    let completeGenerations = 0;
    let lastChunkAt = 0;
    snapshots.forEach((payload, index) => {
      if (payload.chunkIndex === payload.chunkTotal - 1) {
        lastChunkAt = index + 1;
      }
    });
    for (const [generation, chunkIndexes] of byGeneration) {
      const total = snapshots.find(
        p => p.generation === generation,
      )!.chunkTotal;
      if (chunkIndexes.includes(total - 1)) {
        completeGenerations += 1;
      }
    }

    // aborted 不触发消费端：notify 恰等于完整代次数。
    expect(onSnapshotComplete).toHaveBeenCalledTimes(completeGenerations);
    expect(completeGenerations).toBeGreaterThanOrEqual(1);
    // 时序：最后一次 notify 发生在最后一个末片 post 之后（末片 post +
    // deferred 排空先于信号）。
    expect(
      notifyAtSnapshotCount[notifyAtSnapshotCount.length - 1]!,
    ).toBeGreaterThanOrEqual(lastChunkAt);

    tree.unmount();
  });

  it('小快照（单包）完成同样 notify——信号覆盖单片路径（ready 双路径两代次各一次）', async () => {
    const messages = [sampleMessage('only', 1)];
    const onSnapshotComplete = jest.fn();
    let tree!: TestRenderer.ReactTestRenderer;

    await act(async () => {
      tree = TestRenderer.create(
        <ChatTranscriptWebView
          sessionKey="p1:s1"
          messages={messages}
          defaultScrollToBottom
          onSnapshotComplete={onSnapshotComplete}
        />,
      );
    });
    simulateWebReady(tree.root);
    await flushSnapshotChunks();

    // ready 双路径（T-S1 先例）：两个代次都完整发出单包 → 各 notify 一次。
    const snapshots = mockWebViewPostMessages
      .map(raw => decodeHostToTranscript(raw))
      .flatMap(msg =>
        msg.type === 'sessionSnapshot' ? [msg.payload] : [],
      );
    const generations = new Set(snapshots.map(p => p.generation));
    expect(onSnapshotComplete).toHaveBeenCalledTimes(generations.size);
    expect(onSnapshotComplete).toHaveBeenCalled();
    tree.unmount();
  });
});
