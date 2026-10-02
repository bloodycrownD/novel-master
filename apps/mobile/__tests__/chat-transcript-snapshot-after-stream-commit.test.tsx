/**
 * 回滚刷新不丢失（用户实测症状 B 的 P1 病灶回归）：
 * streamCommit 已发生（中断现场的合成行/流式提交）后，messages 更新若
 * 是「tail 满页窗口前移」（条数不变、首条 id 变——回滚删尾后 tail 重新
 * 取满页的形态），吞快照分支不得吞掉全量快照——否则 web 侧永远停留在
 * 回滚前的行，须重进会话才见效果。
 *
 * 照 chat-transcript-snapshot-complete-signal.test.tsx 的 mock 基建。
 *
 * transcript-converge：宿主迁到统一宿主 `ChatConversationWebView`（判据逻辑
 * 「lastStreamCommitIdsRef + 首条 id 变化」一字未动），ready 握手改走 v2。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Platform} from 'react-native';
import {type ChatMessage} from '@novel-master/core/chat';
import {
  CONVERSATION_BRIDGE_V,
  decodeConversationUpstream,
} from '@/components/chat/ChatConversationBridge';
import {
  ChatConversationWebView,
  type ChatConversationWebViewHandle,
} from '@/components/chat/ChatConversationWebView';
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

/** 真实 message id 的 assistant 行（G-01 走 tryCommitStreamTail 的前提：
 *  合成行 id 不在任何 messages 列表里，触发不了「已提交行是否仍在窗内」判定）。 */
function assistantTextMessage(id: string, seq: number): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq,
    role: 'assistant',
    content: {blocks: [{type: 'text', text: `msg-${id}`}]},
    provider: null,
    raw: null,
    createdAtMs: seq,
    hidden: false,
  };
}

/** 统一宿主的最小 props 面（composer 域缺省空串）。 */
function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    sessionKey: 'p1:s1',
    streamingText: '',
    streamingThinking: '',
    ...overrides,
  };
}

describe('streamCommit 残留不吞回滚快照（P1 回归）', () => {
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
            v: CONVERSATION_BRIDGE_V,
            type: 'ready',
            payload: {
              version: 'test',
              capabilities: ['streamBlockCommit'],
              readyState: 'complete',
            },
          }),
        },
      });
    });
  }

  /** 全部 sessionSnapshot 载荷（v:2 信封走宽松 decoder，字段名未变）。 */
  function snapshotPayloads(): Array<Record<string, number | string>> {
    return mockWebViewPostMessages.flatMap(raw => {
      const decoded = decodeConversationUpstream(raw);
      if (!decoded.ok || decoded.message.type !== 'sessionSnapshot') {
        return [];
      }
      return [decoded.message.payload as Record<string, number | string>];
    });
  }

  function completeSnapshotGenerations(): number {
    const snapshots = snapshotPayloads();
    const byGeneration = new Map<number, number[]>();
    for (const payload of snapshots) {
      const generation = payload.generation as number;
      const list = byGeneration.get(generation) ?? [];
      list.push(payload.chunkIndex as number);
      byGeneration.set(generation, list);
    }
    let complete = 0;
    for (const [generation, chunkIndexes] of byGeneration) {
      const total = snapshots.find(p => p.generation === generation)!
        .chunkTotal as number;
      if (chunkIndexes.includes(total - 1)) {
        complete += 1;
      }
    }
    return complete;
  }

  it('中断合成行提交后回滚（tail 满页：条数不变、首条 id 变）必须重发全量快照', async () => {
    // 40 条 = tail 页大小：回滚删尾后重新取页，条数恒 40、首条 id 前移。
    const before = Array.from({length: 40}, (_, i) =>
      sampleMessage(`a-${i + 1}`, i + 1),
    );
    // 回滚后形态：尾部 1 条被删、头部补 1 条更旧的消息进窗口。
    const after = [
      sampleMessage(`a-0`, 0),
      ...Array.from({length: 39}, (_, i) => sampleMessage(`a-${i + 1}`, i + 1)),
    ];

    let tree!: TestRenderer.ReactTestRenderer;
    const ref = React.createRef<ChatConversationWebViewHandle>();
    await act(async () => {
      tree = TestRenderer.create(
        <ChatConversationWebView ref={ref} {...baseProps({messages: before})} />,
      );
    });
    simulateWebReady(tree.root);
    await flushSnapshotChunks();
    const baselineGenerations = completeSnapshotGenerations();
    expect(baselineGenerations).toBeGreaterThanOrEqual(1);

    // 中断现场：合成 assistant 行经 streamCommit 提交 → 置位
    // lastStreamCommitIdsRef（合成行 id 不在任何 messages 列表里）。
    await act(async () => {
      ref.current?.commitSyntheticAssistantRow('partial text', '');
    });
    await flushSnapshotChunks();

    // 回滚：messages 换成满页前移的新窗口（条数不变、首条 id 变）。
    await act(async () => {
      tree.update(
        <ChatConversationWebView ref={ref} {...baseProps({messages: after})} />,
      );
    });
    await flushSnapshotChunks();

    // 吞快照分支曾在此静默吞掉刷新；修复后必须发出新的完整快照。
    expect(completeSnapshotGenerations()).toBeGreaterThan(baselineGenerations);
    tree.unmount();
  });

  it('合成行提交后 messages 未变（同引用）不额外发快照——既有去重行为保持', async () => {
    const messages = Array.from({length: 10}, (_, i) =>
      sampleMessage(`m-${i + 1}`, i + 1),
    );
    let tree!: TestRenderer.ReactTestRenderer;
    const ref = React.createRef<ChatConversationWebViewHandle>();
    await act(async () => {
      tree = TestRenderer.create(
        <ChatConversationWebView ref={ref} {...baseProps({messages})} />,
      );
    });
    simulateWebReady(tree.root);
    await flushSnapshotChunks();
    const baseline = completeSnapshotGenerations();

    await act(async () => {
      ref.current?.commitSyntheticAssistantRow('partial text', '');
    });
    await flushSnapshotChunks();

    // messages 引用未变 → effect 早退（prevMessagesRef === messages），零新快照。
    expect(completeSnapshotGenerations()).toBe(baseline);
    tree.unmount();
  });

  it('tryCommitStreamTail 提交后等长同窗更新仍吞快照——「本该吞」侧的正向回归', async () => {
    // G-01：另一条用例走的是 prevMessagesRef 同引用早退，与新判定无关。
    // 本条钉住判定本身——streamCommit 已同步过的行仍全部在窗内时，
    // 「新数组引用 / 条数不变 / 首条 id 不变 / hidden 未变」的更新
    // 必须继续走吞快照分支，不得退化成全量快照。
    const before = [sampleMessage('u1', 1)];
    const assistant = assistantTextMessage('a1', 2);

    let tree!: TestRenderer.ReactTestRenderer;
    const ref = React.createRef<ChatConversationWebViewHandle>();
    await act(async () => {
      tree = TestRenderer.create(
        <ChatConversationWebView ref={ref} {...baseProps({messages: before})} />,
      );
    });
    simulateWebReady(tree.root);
    await flushSnapshotChunks();
    const baseline = completeSnapshotGenerations();
    expect(baseline).toBeGreaterThanOrEqual(1);

    // 真实 message id 提交（chat-transcript-webview.test.tsx:1767 同款）：
    // lastStreamCommitIdsRef 置位为 ['a1']，且已提交行确实在 messages 里。
    const committed = ref.current?.tryCommitStreamTail(
      [...before, assistant],
      before.length,
    );
    expect(committed).toBe(true);
    await flushSnapshotChunks();
    const afterCommit = completeSnapshotGenerations();
    expect(afterCommit).toBe(baseline);

    // 新数组引用、条数不变（2）、首条 id 不变（u1）、hidden 未变。
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          ref={ref}
          {...baseProps({messages: [...before, assistant]})}
        />,
      );
    });
    await flushSnapshotChunks();

    // 等长且已提交行仍在窗内 → 吞快照，零新增完整快照。
    expect(completeSnapshotGenerations()).toBe(afterCommit);
    tree.unmount();
  });
});
