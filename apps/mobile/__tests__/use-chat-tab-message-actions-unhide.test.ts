/**
 * T-UH2：unhide 编排链（showMessagesInRange(seq, seq) → reload → token 标签刷新；
 * 不做 kkv/worktree 刷新；agentRunning 拦截）。
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { type ChatMessage } from '@novel-master/core/chat';

import { useChatTabMessageActions } from '../src/screens/tabs/chat-tab/useChatTabMessages';

const mockShowMessagesInRange = jest.fn();
const mockReloadMessages = jest.fn();
const mockBumpWorktreeUiToken = jest.fn();
const mockRefreshChatTokenLabel = jest.fn();
const mockShowToast = jest.fn();

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: { setString: jest.fn() },
}));

jest.mock('../src/services/regex-apply-channel', () => ({
  loadSessionMessagesPageForDisplay: jest.fn(),
  loadSessionMessagesTailForDisplay: jest.fn(),
}));

jest.mock('../src/services/project-composer-status.service', () => ({
  refreshComposerStatusAfterFloorOrCompaction: jest.fn(async () => undefined),
  refreshComposerStatusAfterSessionKkvCleared: jest.fn(async () => undefined),
}));

jest.mock('../src/services/message-rollback.service', () => ({
  rollbackToMessage: jest.fn(),
}));

jest.mock('react-native', () => ({
  Alert: { alert: jest.fn() },
}));

const mockRuntime = {
  messageTranscriptEffects: {
    showMessagesInRange: mockShowMessagesInRange,
  },
};

let mockAgentRunning = false;

function mountActions() {
  let api: ReturnType<typeof useChatTabMessageActions> | undefined;
  function Harness() {
    api = useChatTabMessageActions({
      runtime: mockRuntime as any,
      projectId: 'p1',
      sessionId: 's1',
      messages: {
        chatMessages: [],
        reloadMessages: mockReloadMessages,
      } as any,
      agentRunning: mockAgentRunning,
      resetStreamingDisplay: jest.fn(),
      showToast: mockShowToast,
      refreshChatTokenLabel: mockRefreshChatTokenLabel,
      bumpWorktreeUiToken: mockBumpWorktreeUiToken,
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

const hiddenMessage = (): ChatMessage => ({
  id: 'm1',
  sessionId: 's1',
  seq: 3,
  role: 'user',
  content: { blocks: [{ type: 'text', text: 'hi' }] },
  provider: null,
  raw: null,
  createdAtMs: 1,
  hidden: true,
});

describe('useChatTabMessageActions unhide', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAgentRunning = false;
    mockShowMessagesInRange.mockResolvedValue(1);
    mockReloadMessages.mockResolvedValue(undefined);
    mockRefreshChatTokenLabel.mockResolvedValue(undefined);
  });

  it('T-UH2: unhide 走 showMessagesInRange(seq, seq) → reload(true) → token 标签刷新，不 bump worktree', async () => {
    const api = mountActions();

    await act(async () => {
      api.handleMessageMenuAction(hiddenMessage(), 'unhide');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockShowMessagesInRange).toHaveBeenCalledWith('p1', 's1', 3, 3);
    expect(mockReloadMessages).toHaveBeenCalledWith(true);
    expect(mockRefreshChatTokenLabel).toHaveBeenCalled();
    // D1：show 不改变 workspace 状态，不做 kkv/worktree 刷新。
    expect(mockBumpWorktreeUiToken).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('已取消隐藏');

    const order = [
      mockShowMessagesInRange.mock.invocationCallOrder[0],
      mockReloadMessages.mock.invocationCallOrder[0],
      mockRefreshChatTokenLabel.mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
  });

  it('T-UH2: agentRunning 时拦截，不调 showMessagesInRange', async () => {
    mockAgentRunning = true;
    const api = mountActions();

    await act(async () => {
      api.handleMessageMenuAction(hiddenMessage(), 'unhide');
      await Promise.resolve();
    });

    expect(mockShowMessagesInRange).not.toHaveBeenCalled();
    expect(mockReloadMessages).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith(
      '请稍候：Agent 运行中无法取消隐藏',
    );
  });
});
