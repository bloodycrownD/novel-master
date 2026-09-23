/**
 * T-R3（rollback-large-jank Step 3）：快照分片字节预算（SNAPSHOT_CHUNK_BYTES）。
 *
 * 分片条件从「条数 > SNAPSHOT_CHUNK_SIZE(50)」扩为「条数超限 **或** 累计
 * 源 content JSON 尺寸超 256KB」——大消息场景 40 条也切多片，片间既有
 * 量子让步与 generation 代次机制自然生效；web 侧拼装零改动（多片路径
 * 本就存在，T-S1 已钉住「分片拼装与单包直发全等」）。
 *
 * 断言分两层：
 * - 纯函数直测 planSnapshotChunkBounds：贪心分桶边界、单桶预算上限、
 *   条数上限并存、小包单桶（chunkTotal=1 与旧条数除法逐字节等价）、
 *   单条超预算独占桶、空列表单空桶；
 * - 组件级（对齐 chat-transcript-webview.test.tsx 的 T-S 断言形态）：
 *   40 条 × ~10KB 大消息渲染 → postToWeb 收到多片 sessionSnapshot，
 *   chunkIndex 连续、chunkTotal 恒定、各片行拼接完整覆盖 40 条、
 *   末片携带 scrollIntent；小消息 40 条仍单包。
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
import {
  ChatTranscriptWebView,
  planSnapshotChunkBounds,
} from '@/components/chat/ChatTranscriptWebView';
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

// 与 chat-transcript-webview.test.tsx 同款：让步真实排队 setTimeout(0)，
// 测试可控观察到多片在途窗口。
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

function textMessage(id: string, seq: number, text: string): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq,
    role: 'user',
    content: {blocks: [{type: 'text', text}]},
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

function bigMessages(count: number): ChatMessage[] {
  // 每条源 JSON ~10KB：256KB 预算下贪心每桶 ~25 条，40 条切 2 桶。
  const filler = 'x'.repeat(10 * 1024);
  return Array.from({length: count}, (_, i) =>
    textMessage(`m${i}`, i + 1, `${i}:${filler}`),
  );
}

describe('快照分片字节预算 planSnapshotChunkBounds（T-R3 纯函数半）', () => {
  it('40 条 × ~10KB 大消息按源尺寸贪心切多桶，单桶不超预算且桶界连续', () => {
    const messages = bigMessages(40);
    const bounds = planSnapshotChunkBounds(messages);
    expect(bounds.length).toBeGreaterThan(1);

    // 桶界连续覆盖：[0,b1)+[b1,b2)+...+[bk,40) 无缝衔接全部消息。
    expect(bounds[0]![0]).toBe(0);
    expect(bounds[bounds.length - 1]![1]).toBe(messages.length);
    for (let i = 1; i < bounds.length; i++) {
      expect(bounds[i]![0]).toBe(bounds[i - 1]![1]);
    }

    // 每桶条数 ≤ 50；除「单条自身超预算独占桶」外每桶累计源尺寸 ≤ 256KB。
    const budget = 256 * 1024;
    for (const [start, end] of bounds) {
      expect(end - start).toBeLessThanOrEqual(50);
      if (end - start > 1) {
        let bytes = 0;
        for (let i = start; i < end; i++) {
          bytes += JSON.stringify(messages[i]!.content).length;
        }
        expect(bytes).toBeLessThanOrEqual(budget);
        // 贪心性：桶尾再加一条必超预算或超条数。
        if (end < messages.length) {
          const withNext = bytes + JSON.stringify(messages[end]!.content).length;
          expect(
            withNext > budget || end - start >= 50,
          ).toBe(true);
        }
      }
    }
  });

  it('小消息 40 条仍单桶（chunkTotal=1，与旧条数除法逐字节等价）', () => {
    const messages = Array.from({length: 40}, (_, i) =>
      textMessage(`s${i}`, i + 1, `small ${i}`),
    );
    expect(planSnapshotChunkBounds(messages)).toEqual([[0, 40]]);
  });

  it('条数上限并存：51 条小消息按 50 条上限切 2 桶', () => {
    const messages = Array.from({length: 51}, (_, i) =>
      textMessage(`s${i}`, i + 1, `small ${i}`),
    );
    expect(planSnapshotChunkBounds(messages)).toEqual([[0, 50], [50, 51]]);
  });

  it('单条自身超预算独占一桶（无法再细分，与相邻条分桶）', () => {
    const huge = 'y'.repeat(300 * 1024);
    const messages = [
      textMessage('a', 1, 'small'),
      textMessage('b', 2, huge),
      textMessage('c', 3, 'small'),
    ];
    const bounds = planSnapshotChunkBounds(messages);
    // a 与 b 分桶（a+b 超预算）；b 独占（单条超预算后 c 另起桶）。
    expect(bounds).toEqual([[0, 1], [1, 2], [2, 3]]);
  });

  it('空列表返回单空桶——空快照仍发单包（等价旧行为）', () => {
    expect(planSnapshotChunkBounds([])).toEqual([[0, 0]]);
  });
});

describe('快照分片字节预算（T-R3 组件半）', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(() => {
    clearMockWebViewPostMessages();
  });

  async function flushSnapshotChunks(rounds = 24): Promise<void> {
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

  function snapshotChunks() {
    return mockWebViewPostMessages
      .map(raw => decodeHostToTranscript(raw))
      .flatMap(msg =>
        msg.type === 'sessionSnapshot'
          ? [
              {
                generation: msg.payload.generation,
                chunkIndex: msg.payload.chunkIndex,
                chunkTotal: msg.payload.chunkTotal,
                scrollIntent: msg.payload.scrollIntent,
                rowIds: msg.payload.rows
                  .filter(r => r.kind === 'message')
                  .map(r => (r.kind === 'message' ? r.id : '')),
              },
            ]
          : [],
      );
  }

  function renderWithMessages(messages: ChatMessage[]) {
    return TestRenderer.create(
      <ChatTranscriptWebView
        sessionKey="p1:s1"
        messages={messages}
        hasMore={false}
        defaultScrollToBottom
      />,
    );
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

  /** 提取「最后一个到达的代次」的分片序列（webReady 双路径下首代次会被
   * 顶替、仍可能发出片 0——照 T-S1 先例只对末代次断言完整序列）。 */
  function finalGenerationChunks(chunks: ReturnType<typeof snapshotChunks>) {
    const generations: number[] = [];
    for (const chunk of chunks) {
      if (generations[generations.length - 1] !== chunk.generation) {
        generations.push(chunk.generation);
      }
    }
    const last = generations[generations.length - 1];
    return {
      generations,
      stale: chunks.filter(c => c.generation !== last),
      final: chunks.filter(c => c.generation === last),
    };
  }

  it('T-R3: 40 条大消息切多片——chunkIndex 连续、chunkTotal 恒定、行拼接完整、末片带 scrollIntent', async () => {
    const messages = bigMessages(40);
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = renderWithMessages(messages);
    });
    simulateWebReady(tree.root);
    await flushSnapshotChunks();

    const {stale, final} = finalGenerationChunks(snapshotChunks());
    // 双路径下被顶替的旧代次至多发出片 0（在让步点作废）。
    for (const chunk of stale) {
      expect(chunk.chunkIndex).toBe(0);
    }
    expect(final.length).toBeGreaterThan(1);

    const total = final[0]!.chunkTotal;
    expect(total).toBeGreaterThan(1);
    // chunkTotal 预计算：chunk 0 的 payload 即携带最终值（所有片一致）。
    for (const chunk of final) {
      expect(chunk.chunkTotal).toBe(total);
    }
    // chunkIndex 连续覆盖 0..total-1。
    expect(final.map(c => c.chunkIndex)).toEqual(
      Array.from({length: total}, (_, i) => i),
    );
    // 各片行拼接完整覆盖 40 条消息、顺序不乱（与全量单包严格同序）。
    const joined = final.flatMap(c => c.rowIds);
    expect(joined).toEqual(messages.map(m => m.id));
    // 滚动意图仅末片携带（T-S4 聚合口径）。
    for (const chunk of final.slice(0, -1)) {
      expect(chunk.scrollIntent).toBeUndefined();
    }
    expect(final[final.length - 1]!.scrollIntent).toBe('stick');

    tree.unmount();
  });

  it('小消息 40 条仍单包——chunkTotal=1、单携带 scrollIntent（与现状逐字节等价）', async () => {
    const messages = Array.from({length: 40}, (_, i) =>
      textMessage(`s${i}`, i + 1, `small ${i}`),
    );
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = renderWithMessages(messages);
    });
    simulateWebReady(tree.root);
    await flushSnapshotChunks();

    const {final} = finalGenerationChunks(snapshotChunks());
    expect(final).toHaveLength(1);
    expect(final[0]!.chunkTotal).toBe(1);
    expect(final[0]!.chunkIndex).toBe(0);
    expect(final[0]!.scrollIntent).toBe('stick');
    expect(final[0]!.rowIds).toEqual(messages.map(m => m.id));

    tree.unmount();
  });
});
