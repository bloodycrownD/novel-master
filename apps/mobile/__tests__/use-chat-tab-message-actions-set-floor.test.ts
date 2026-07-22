/**
 * T-SF1：Mobile runSetFloor 编排链（setMessageFloorAtMessage → reload → bump；
 * rule_snapshot+file_cache 由 Core clearDomain，UI 不再调 capture）。
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { type ChatMessage } from '@novel-master/core/chat';

import { useChatTabMessageActions } from '../src/screens/tabs/chat-tab/useChatTabMessages';

const mockSetMessageFloorAtMessage = jest.fn();
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
  Alert: {
    alert: jest.fn(
      (
        _title: string,
        _message: string,
        buttons: { text: string; onPress?: () => void }[],
      ) => {
        buttons.find(b => b.text === '置位')?.onPress?.();
      },
    ),
  },
}));

const mockRuntime = {
  messageTranscriptEffects: {
    setMessageFloorAtMessage: mockSetMessageFloorAtMessage,
  },
};

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
      agentRunning: false,
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

const sampleMessage = (): ChatMessage => ({
  id: 'm1',
  sessionId: 's1',
  seq: 2,
  role: 'user',
  content: { blocks: [{ type: 'text', text: 'hi' }] },
  provider: null,
  raw: null,
  createdAtMs: 1,
  hidden: false,
});

describe('useChatTabMessageActions set-floor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetMessageFloorAtMessage.mockResolvedValue({
      hiddenCount: 1,
      shownCount: 1,
    });
    mockReloadMessages.mockResolvedValue(undefined);
    mockRefreshChatTokenLabel.mockResolvedValue(undefined);
  });

  it('T-SF1: runSetFloor 链 setMessageFloor → reload → bump（kkv 由 Core clearDomain）', async () => {
    const api = mountActions();

    await act(async () => {
      api.handleMessageMenuAction(sampleMessage(), 'set-floor');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockSetMessageFloorAtMessage).toHaveBeenCalledWith('p1', 's1', 'm1');
    expect(mockReloadMessages).toHaveBeenCalledWith(true);
    expect(mockBumpWorktreeUiToken).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith('已置位');

    const order = [
      mockSetMessageFloorAtMessage.mock.invocationCallOrder[0],
      mockReloadMessages.mock.invocationCallOrder[0],
      mockBumpWorktreeUiToken.mock.invocationCallOrder[0],
    ];
    expect(order[0]).toBeLessThan(order[1]!);
    expect(order[1]).toBeLessThan(order[2]!);
  });
});
