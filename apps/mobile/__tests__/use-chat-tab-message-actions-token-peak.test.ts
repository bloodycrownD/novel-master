/**
 * T-R5 hook 半（rollback-large-jank Step 5）：token 刷新错峰。
 *
 * - 回滚链的 token 全量重算等待快照完成信号：notify 之前不发起、
 *   notify 之后发起（快照末片 post 先于 token 重算的次序断言）；
 * - 信号迟到/超时兜底：fake timers 推进超时后刷新最终仍执行（回到
 *   现状时机，不悬挂）；
 * - 缺省不传信号（无 webview / 既有测试场景）：保持现状时机立即刷新。
 *
 * 照 use-chat-tab-message-actions-rollback.test.ts 先例：Alert mock
 * 自动按「回滚」按钮，mock rollbackToMessage / reloadMessages 等。
 */
import {afterEach, beforeEach, describe, expect, it, jest} from '@jest/globals';
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {type ChatMessage} from '@novel-master/core/chat';
import {Alert} from 'react-native';
import {createSnapshotCompleteSignal} from '../src/services/snapshot-complete-signal';
import {useChatTabMessageActions} from '../src/screens/tabs/chat-tab/useChatTabMessageActions';

const mockRollbackToMessage = jest.fn();
const mockReloadMessages = jest.fn();
const mockSetDraftRestoreToken = jest.fn();
const mockShowToast = jest.fn();
const mockRefreshChatTokenLabel = jest.fn();

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: {setString: jest.fn()},
}));

jest.mock('../src/services/message-rollback.service', () => ({
  rollbackToMessage: (...args: unknown[]) => mockRollbackToMessage(...args),
}));

jest.mock('react-native', () => ({
  Alert: {
    alert: jest.fn(
      (
        _title: string,
        _message: string,
        buttons: {text: string; onPress?: () => void}[],
      ) => {
        buttons.find(b => b.text === '回滚')?.onPress?.();
      },
    ),
  },
}));

const mockRuntime = {};

function plainUserMessage(text: string): ChatMessage {
  return {
    id: 'm-user',
    sessionId: 's1',
    seq: 2,
    role: 'user',
    content: {blocks: [{type: 'text', text}]},
    provider: null,
    raw: null,
    createdAtMs: 1,
    hidden: false,
  };
}

type MountOptions = {
  snapshotCompleteSignal?: ReturnType<typeof createSnapshotCompleteSignal>;
};

function mountActions(chatMessages: ChatMessage[], options?: MountOptions) {
  let api: ReturnType<typeof useChatTabMessageActions> | undefined;
  function Harness() {
    api = useChatTabMessageActions({
      runtime: mockRuntime as any,
      projectId: 'p1',
      sessionId: 's1',
      chatMessages,
      reloadMessages: mockReloadMessages,
      setDraftRestoreToken: mockSetDraftRestoreToken,
      agentRunning: false,
      resetStreamingDisplay: jest.fn(),
      showToast: mockShowToast,
      refreshChatTokenLabel: mockRefreshChatTokenLabel,
      snapshotCompleteSignal: options?.snapshotCompleteSignal,
      bumpWorktreeUiToken: jest.fn(),
      reloadLists: jest.fn(),
      setCurrentSession: jest.fn(),
      setChatSubview: jest.fn(),
      setConversationPanel: jest.fn(),
      setMessageEditPrompt: jest.fn(),
    });
    return null;
  }
  act(() => {
    TestRenderer.create(React.createElement(Harness));
  });
  return api!;
}

/** 排空微任务队列（回滚链跑到 consumeNext 挂起点）。 */
async function flushMicrotasks(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

describe('token 刷新错峰（T-R5 hook 半）', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockRollbackToMessage.mockResolvedValue(undefined);
    mockReloadMessages.mockResolvedValue([]);
    mockSetDraftRestoreToken.mockImplementation(
      (updater: number | ((t: number) => number)) => {
        if (typeof updater === 'function') {
          updater(0);
        }
      },
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('T-R5a: 快照完成信号先于 token 重算——notify 前 refresh 不发起、notify 后发起', async () => {
    const signal = createSnapshotCompleteSignal();
    const anchor = plainUserMessage('hello');
    const api = mountActions([anchor], {snapshotCompleteSignal: signal});

    await act(async () => {
      api.handleMessageMenuAction(anchor, 'rollback');
      await flushMicrotasks();
    });

    // 回滚/重载/toast 已完成，但 token 重算仍等快照完成信号。
    expect(mockRollbackToMessage).toHaveBeenCalled();
    expect(mockReloadMessages).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalled();
    expect(mockRefreshChatTokenLabel).not.toHaveBeenCalled();

    // 快照末片 post + deferred 排空 → notify → token 重算发起。
    await act(async () => {
      signal.notify();
      await flushMicrotasks();
    });
    expect(mockRefreshChatTokenLabel).toHaveBeenCalledTimes(1);
  });

  it('T-R5b: 超时兜底——信号迟到时超时后刷新最终仍执行（不悬挂）', async () => {
    jest.useFakeTimers();
    const signal = createSnapshotCompleteSignal();
    const anchor = plainUserMessage('hello');
    const api = mountActions([anchor], {snapshotCompleteSignal: signal});

    await act(async () => {
      api.handleMessageMenuAction(anchor, 'rollback');
      await flushMicrotasks();
    });
    expect(mockRefreshChatTokenLabel).not.toHaveBeenCalled();

    // 推进超时窗（1500ms 兜底）：刷新最终执行。
    await act(async () => {
      jest.advanceTimersByTime(1500);
      await flushMicrotasks();
    });
    expect(mockRefreshChatTokenLabel).toHaveBeenCalledTimes(1);
  });

  it('T-R5c: 缺省不传信号——保持现状时机立即刷新（既有场景零影响）', async () => {
    const anchor = plainUserMessage('hello');
    const api = mountActions([anchor]);

    await act(async () => {
      api.handleMessageMenuAction(anchor, 'rollback');
      await flushMicrotasks();
    });
    expect(mockRefreshChatTokenLabel).toHaveBeenCalledTimes(1);
  });

  it('T-R5d: 信号早于 consumeNext 到达（notify 先行）——立即放行刷新', async () => {
    const signal = createSnapshotCompleteSignal();
    const anchor = plainUserMessage('hello');
    const api = mountActions([anchor], {snapshotCompleteSignal: signal});

    // reloadMessages mock 立即 resolve，随后组件快照（mock 外） notify
    // 可能早于 consumeNext——latch 语义下 pending 被记住、立即放行。
    signal.notify();
    await act(async () => {
      api.handleMessageMenuAction(anchor, 'rollback');
      await flushMicrotasks();
    });
    expect(mockRefreshChatTokenLabel).toHaveBeenCalledTimes(1);
  });
});
