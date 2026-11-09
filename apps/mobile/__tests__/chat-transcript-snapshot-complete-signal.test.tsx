/**
 * T-R5 组件半（rollback-large-jank Step 5）：onSnapshotComplete 回调。
 *
 * - 完整走完的快照（末片 post + deferred actions 排空后）恰 notify 一次；
 * - aborted 代次（被新代次顶替 / 重挂）不额外 notify——该次快照未生效；
 * - 缺省不传回调零影响（既有行为）。
 *
 * transcript-converge：宿主从已退役的 `ChatTranscriptWebView` 迁到统一宿主
 * `ChatConversationWebView`（快照分片/代次/信号的行为面一字未动，props 名同名）。
 * ready 握手走共享 fixture（v2 + t2 + streamProjection，spec §9.1 / T-SP20）。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Platform} from 'react-native';
import {type ChatMessageData} from '@novel-master/core/chat';
import {decodeConversationUpstream} from '@/components/chat/ChatConversationBridge';
import {
  ChatConversationWebView,
  type ChatConversationWebViewHandle,
} from '@/components/chat/ChatConversationWebView';
import {
  clearMockWebViewPostMessages,
  mockWebViewPostMessages,
} from '../test-utils/react-native-webview-mock';
import {
  makeTranscriptReadyPayload,
  simulateTranscriptReady,
} from '../test-utils/transcript-ready';

jest.mock('@/theme/ThemeProvider', () => ({
  useTheme: () => ({
    tokens: {
      background: '#000',
      surface: '#111',
      borderLight: '#222',
      textSecondary: '#ccc',
      primary: '#08f',
      text: '#fff',
      selection: '#08f55',
    },
  }),
}));

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: jest.fn(), getString: jest.fn(async () => '')},
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

function sampleMessage(id: string, seq: number): ChatMessageData {
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

/** 统一宿主的最小 props 面（流式行投影由 Step 3 的 props 驱动，本套件用缺省）。 */
function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    sessionKey: 'p1:s1',
    ...overrides,
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

  /**
   * 抽出全部 sessionSnapshot 载荷。
   *
   * 统一宿主下行信封是 v:2（`decodeHostToTranscript` 对 v≠1 直接 throw），
   * 故改用自带宽松 decoder `decodeConversationUpstream`。载荷字段本身没变
   * （generation / chunkIndex / chunkTotal / scrollIntent 都还在）。
   */
  function snapshotPayloads(): Array<Record<string, number | string>> {
    return mockWebViewPostMessages.flatMap(raw => {
      const decoded = decodeConversationUpstream(raw);
      if (!decoded.ok || decoded.message.type !== 'sessionSnapshot') {
        return [];
      }
      return [decoded.message.payload as Record<string, number | string>];
    });
  }

  /** 记录 notify 时刻已 post 的 sessionSnapshot 消息总数（时序锚点）。 */
  function sessionSnapshotCount(): number {
    return snapshotPayloads().length;
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
    const ref = React.createRef<ChatConversationWebViewHandle>();

    await act(async () => {
      tree = TestRenderer.create(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({
            messages,
            onSnapshotComplete,
          })}
        />,
      );
    });
    simulateTranscriptReady(tree.root);
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

    const snapshots = snapshotPayloads();
    // 完整代次 = 该代次发过末片（chunkIndex === chunkTotal-1）；
    // aborted 代次发不满（在让步点被顶替作废），不计入。
    const byGeneration = new Map<number, number[]>();
    for (const payload of snapshots) {
      const list = byGeneration.get(payload.generation as number) ?? [];
      list.push(payload.chunkIndex as number);
      byGeneration.set(payload.generation as number, list);
    }
    let completeGenerations = 0;
    let lastChunkAt = 0;
    snapshots.forEach((payload, index) => {
      if (
        (payload.chunkIndex as number) ===
        (payload.chunkTotal as number) - 1
      ) {
        lastChunkAt = index + 1;
      }
    });
    for (const [generation, chunkIndexes] of byGeneration) {
      const total = snapshots.find(p => p.generation === generation)!
        .chunkTotal as number;
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
        <ChatConversationWebView
          {...baseProps({
            messages,
            defaultScrollToBottom: true,
            onSnapshotComplete,
          })}
        />,
      );
    });
    simulateTranscriptReady(tree.root);
    await flushSnapshotChunks();

    // ready 双路径（T-S1 先例）：两个代次都完整发出单包 → 各 notify 一次。
    const snapshots = snapshotPayloads();
    const generations = new Set(snapshots.map(p => p.generation));
    expect(onSnapshotComplete).toHaveBeenCalledTimes(generations.size);
    expect(onSnapshotComplete).toHaveBeenCalled();
    tree.unmount();
  });
});

/**
 * ready 版本门（spec §6.2 / §6.3 · T-SP20 宿主半）。
 *
 * v2 信封只锁「桥协议」，旧 t1 dist 仍会说 v2：宿主必须再校验 `version ===
 * 't2'` 与 `streamProjection` 能力位，否则新协议消息会被一个不认得的页面
 * 半认（只在 step 边界补文本）——比显式错误态更难查。判定失败**立即**错误态，
 * 不等 8s 兜底；同时一个下行都不发（webReady 不置位）。
 */
describe('ready 版本门（T-SP20 宿主半）', () => {
  beforeEach(() => {
    clearMockWebViewPostMessages();
  });

  afterEach(() => {
    clearMockWebViewPostMessages();
  });

  async function mountWithMessage(overrides: Record<string, unknown> = {}) {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({
            messages: [sampleMessage('only', 1)],
            ...overrides,
          })}
        />,
      );
    });
    return tree;
  }

  /** 注入任意 ready 信封（版本门用例要自己改 payload）。 */
  function sendEnvelope(
    root: TestRenderer.ReactTestInstance,
    envelope: ReturnType<typeof makeTranscriptReadyPayload>,
  ): void {
    const webView = root.findByType(
      require('react-native-webview').default as React.ComponentType<{
        onMessage?: (event: {nativeEvent: {data: string}}) => void;
      }>,
    );
    act(() => {
      webView.props.onMessage?.({
        nativeEvent: {data: JSON.stringify(envelope)},
      });
    });
  }

  function sentTypes(): string[] {
    return mockWebViewPostMessages.flatMap(raw => {
      const decoded = decodeConversationUpstream(raw);
      return decoded.ok ? [decoded.message.type] : [];
    });
  }

  function errorViews(root: TestRenderer.ReactTestInstance) {
    return root.findAllByProps({testID: 'chat-conversation-ready-error'});
  }

  it('v2 + t2 + streamProjection：接受并进入下行（init → 快照）', async () => {
    const onReady = jest.fn();
    const tree = await mountWithMessage({onReady});
    simulateTranscriptReady(tree.root);
    await act(async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    });

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(errorViews(tree.root)).toHaveLength(0);
    expect(sentTypes()).toContain('init');
    tree.unmount();
  });

  it('version 不是 t2（旧 t1 dist）：立即错误态、零下行', async () => {
    const onReady = jest.fn();
    const tree = await mountWithMessage({onReady});
    const stale = makeTranscriptReadyPayload();
    stale.payload.version = 't1';
    sendEnvelope(tree.root, stale);

    // 立即错误态：不等 8s 超时兜底。
    expect(errorViews(tree.root).length).toBeGreaterThan(0);
    expect(mockWebViewPostMessages).toHaveLength(0);
    expect(onReady).not.toHaveBeenCalled();
    tree.unmount();
  });

  it('t2 但缺 streamProjection：立即错误态、零下行', async () => {
    const onReady = jest.fn();
    const tree = await mountWithMessage({onReady});
    const missing = makeTranscriptReadyPayload();
    missing.payload.capabilities = ['streamBlockCommit'];
    sendEnvelope(tree.root, missing);

    expect(errorViews(tree.root).length).toBeGreaterThan(0);
    expect(mockWebViewPostMessages).toHaveLength(0);
    expect(onReady).not.toHaveBeenCalled();
    tree.unmount();
  });
});
