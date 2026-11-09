/**
 * 中断 partial 快照与回滚刷新（chat-streaming-projection Step 8 · T-SP19）。
 *
 * 本文件原先是「streamCommit 残留不吞回滚快照」的 P1 回归：中断现场的合成行
 * 经 `commitSyntheticAssistantRow` 提交后，回滚（tail 满页：条数不变、首条 id
 * 前移）必须重发全量快照。流式投影协议后合成提交通道随 C7 删除——
 * interrupted 水合单元的 partial 由单元 `streamRows` 投影成一条 finished
 * 流式行（spec §2.1.2 规则 3），宿主只随普通快照下发。回归面因此改写为：
 *
 * 1. ready 快照必须带这条 finished 流式行（无 messageId）；
 * 2. 回滚（tail 满页前移 + 投影清空）后必须发出新代次完整快照，且中断行不复活。
 *
 * 照 chat-transcript-snapshot-complete-signal.test.tsx 的 mock 基建。
 */
import React from 'react';
import {describe, expect, it, jest, beforeEach, afterEach} from '@jest/globals';
import TestRenderer, {act} from 'react-test-renderer';
import {Platform} from 'react-native';
import {type ChatMessageData} from '@novel-master/core/chat';
import {decodeConversationUpstream} from '@/components/chat/ChatConversationBridge';
import type {TranscriptStreamingMessage} from '@/components/chat/ChatTranscriptBridge';
import {ChatConversationWebView} from '@/components/chat/ChatConversationWebView';
import {
  clearMockWebViewPostMessages,
  mockWebViewPostMessages,
} from '../test-utils/react-native-webview-mock';
import {simulateTranscriptReady} from '../test-utils/transcript-ready';

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

const INTERRUPTED_STREAM_ID = 'st:s1:interrupted:4000';

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

/** interrupted 水合单元的单元侧投影（spec §2.1.2 规则 3）。 */
function interruptedStreamRow(): TranscriptStreamingMessage {
  return {
    streamId: INTERRUPTED_STREAM_ID,
    status: 'finished',
    text: '中断正文',
    thinking: '',
    tools: [],
    messageId: null,
  };
}

/** 统一宿主的最小 props 面（messages 必填，其余按用例覆盖）。 */
function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    sessionKey: 'p1:s1',
    messages: [] as ChatMessageData[],
    ...overrides,
  };
}

describe('中断 partial 快照与回滚刷新（T-SP19）', () => {
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

  /** 全部 sessionSnapshot 载荷（v:2 信封走宽松 decoder，字段名未变）。 */
  function snapshotPayloads(): Array<Record<string, unknown>> {
    return mockWebViewPostMessages.flatMap(raw => {
      const decoded = decodeConversationUpstream(raw);
      if (!decoded.ok || decoded.message.type !== 'sessionSnapshot') {
        return [];
      }
      return [decoded.message.payload as Record<string, unknown>];
    });
  }

  /** 末代次的全部快照片。 */
  function lastGenerationChunks(): Array<Record<string, unknown>> {
    const snapshots = snapshotPayloads();
    const last = snapshots.at(-1);
    if (last == null) {
      return [];
    }
    return snapshots.filter(payload => payload.generation === last.generation);
  }

  function lastGenerationRowIds(): string[] {
    return lastGenerationChunks().flatMap(chunk =>
      ((chunk.rows ?? []) as Array<{id: string}>).map(row => row.id),
    );
  }

  /** 已收齐末片的代次数（分片完整性判据，与旧用例同口径）。 */
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

  it('中断 partial 随 ready 快照下发为 finished 流式行（无 messageId）', async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({
            messages: [sampleMessage('m1', 1)],
            streamingRows: [interruptedStreamRow()],
          })}
        />,
      );
    });
    simulateTranscriptReady(tree.root);
    await flushSnapshotChunks();

    const chunks = lastGenerationChunks();
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    const streamChunk = chunks.find(chunk =>
      (chunk.rows as Array<Record<string, unknown>>).some(
        row => row.id === INTERRUPTED_STREAM_ID,
      ),
    );
    expect(streamChunk).toBeDefined();
    const row = (streamChunk!.rows as Array<Record<string, unknown>>).find(
      candidate => candidate.id === INTERRUPTED_STREAM_ID,
    );
    expect(row).toMatchObject({
      kind: 'message',
      role: 'assistant',
      status: 'finished',
      text: '中断正文',
      hidden: false,
    });
    expect(row).not.toHaveProperty('messageId');
    expect(streamChunk!.stream).toEqual({
      id: INTERRUPTED_STREAM_ID,
      seq: 0,
      status: 'finished',
    });
    tree.unmount();
  });

  it('回滚（tail 满页前移 + 投影清空）后重发完整快照，中断行不复活', async () => {
    // 40 条 = tail 页大小：回滚删尾后重新取页，条数恒 40、首条 id 前移。
    const before = Array.from({length: 40}, (_, i) =>
      sampleMessage(`a-${i + 1}`, i + 1),
    );
    // 回滚后形态：尾部 1 条被删、头部补 1 条更旧的消息进窗口。
    const after = [
      sampleMessage('a-0', 0),
      ...Array.from({length: 39}, (_, i) => sampleMessage(`a-${i + 1}`, i + 1)),
    ];

    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <ChatConversationWebView
          {...baseProps({
            messages: before,
            streamingRows: [interruptedStreamRow()],
          })}
        />,
      );
    });
    simulateTranscriptReady(tree.root);
    await flushSnapshotChunks();
    const baselineGenerations = completeSnapshotGenerations();
    expect(baselineGenerations).toBeGreaterThanOrEqual(1);
    expect(lastGenerationRowIds()).toContain(INTERRUPTED_STREAM_ID);

    // 回滚：messages 换成满页前移的新窗口，单元投影已清空（clearStreamProjection）。
    await act(async () => {
      tree.update(
        <ChatConversationWebView
          {...baseProps({messages: after, streamingRows: []})}
        />,
      );
    });
    await flushSnapshotChunks();

    // 等长首条变（tail 替换）必须落全量快照；新基线不再含中断行、无流式检查点。
    expect(completeSnapshotGenerations()).toBeGreaterThan(baselineGenerations);
    expect(lastGenerationRowIds()).not.toContain(INTERRUPTED_STREAM_ID);
    expect(lastGenerationChunks().at(-1)!.stream).toBeUndefined();
    tree.unmount();
  });
});
