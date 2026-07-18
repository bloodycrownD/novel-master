/**
 * T-M2/T-M3：Mobile 回滚确认文案与 undo_send Composer draft 恢复。
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { type ChatMessage } from '@novel-master/core/chat';
import { Alert } from 'react-native';
import {
  readChatComposerDraft,
  readChatComposerDraftState,
  writeChatComposerDraft,
  writeChatComposerDraftState,
} from '../src/storage/chat-composer-draft';
import { useChatTabMessageActions } from '../src/screens/tabs/chat-tab/useChatTabMessages';

const mockRollbackToMessage = jest.fn();
const mockReloadMessages = jest.fn();
const mockSetDraftRestoreToken = jest.fn();
const mockShowToast = jest.fn();

jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: { setString: jest.fn() },
}));

jest.mock('../src/services/regex-apply-channel', () => ({
  loadSessionMessagesPageForDisplay: jest.fn(),
  loadSessionMessagesTailForDisplay: jest.fn(),
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
        buttons: { text: string; onPress?: () => void }[],
      ) => {
        buttons.find(b => b.text === '回滚')?.onPress?.();
      },
    ),
  },
}));

const mockRuntime = {};

function plainUserMessage(
  text: string,
  attachments?: ChatMessage['attachments'],
): ChatMessage {
  return {
    id: 'm-user',
    sessionId: 's1',
    seq: 2,
    role: 'user',
    content: { blocks: [{ type: 'text', text }] },
    provider: null,
    raw: null,
    createdAtMs: 1,
    hidden: false,
    ...(attachments != null && attachments.length > 0
      ? { attachments }
      : {}),
  };
}

function assistantMessage(): ChatMessage {
  return {
    id: 'm-asst',
    sessionId: 's1',
    seq: 3,
    role: 'assistant',
    content: { blocks: [{ type: 'text', text: 'reply' }] },
    provider: null,
    raw: null,
    createdAtMs: 2,
    hidden: false,
  };
}

function mountActions(chatMessages: ChatMessage[]) {
  let api: ReturnType<typeof useChatTabMessageActions> | undefined;
  function Harness() {
    api = useChatTabMessageActions({
      runtime: mockRuntime as any,
      projectId: 'p1',
      sessionId: 's1',
      messages: {
        chatMessages,
        reloadMessages: mockReloadMessages,
        setDraftRestoreToken: mockSetDraftRestoreToken,
      } as any,
      agentRunning: false,
      resetStreamingDisplay: jest.fn(),
      showToast: mockShowToast,
      refreshChatTokenLabel: jest.fn(),
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

describe('useChatTabMessageActions rollback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

  it('T-M1: plain user 确认文案含「及之后」', async () => {
    const api = mountActions([plainUserMessage('hello')]);

    await act(async () => {
      api.handleMessageMenuAction(plainUserMessage('hello'), 'rollback');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      '回滚到此消息',
      expect.stringMatching(/及之后/),
      expect.any(Array),
    );
  });

  it('T-M2/T-TX2: undo_send 成功后写 draft 原文（含 @路径）；无 attach chip', async () => {
    writeChatComposerDraftState('s1', { text: 'old draft', attachments: [] });
    const anchorText = '请看 @/a.md';
    const attachments = [
      {
        name: '/w.md',
        source: 'workplace' as const,
        type: 'text' as const,
        content: null,
        path: '/w.md',
      },
      {
        name: '/a.md',
        source: 'attach' as const,
        type: 'text' as const,
        content: null,
        path: '/a.md',
      },
    ];
    const anchor = plainUserMessage(anchorText, attachments);
    const api = mountActions([anchor]);

    await act(async () => {
      api.handleMessageMenuAction(anchor, 'rollback');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRollbackToMessage).toHaveBeenCalled();
    expect(readChatComposerDraft('s1')).toBe(anchorText);
    expect(readChatComposerDraft('s1')).toContain('@/a.md');
    const draftAttachments = readChatComposerDraftState('s1').attachments ?? [];
    expect(draftAttachments).toEqual([]);
    expect(draftAttachments.some(a => a.source === 'attach')).toBe(false);
    expect(mockSetDraftRestoreToken).toHaveBeenCalled();
  });

  it('T-TX2: 编辑回填仅正文（含 @路径）；不恢复 source:attach', async () => {
    writeChatComposerDraftState('s1', {
      text: '',
      attachments: [
        {
          name: '/w.md',
          source: 'workplace' as const,
          type: 'text' as const,
          content: null,
          path: '/w.md',
        },
        {
          name: '/old.md',
          source: 'attach' as const,
          type: 'text' as const,
          content: null,
          path: '/old.md',
        },
      ],
    });
    const editText = '请看 @/a.md';
    const messageAttachments = [
      {
        name: '/a.md',
        source: 'attach' as const,
        type: 'text' as const,
        content: null,
        path: '/a.md',
      },
    ];
    const target = plainUserMessage(editText, messageAttachments);
    const setMessageEditPrompt = jest.fn();
    let api: ReturnType<typeof useChatTabMessageActions> | undefined;
    function Harness() {
      api = useChatTabMessageActions({
        runtime: mockRuntime as any,
        projectId: 'p1',
        sessionId: 's1',
        messages: {
          chatMessages: [target],
          reloadMessages: mockReloadMessages,
          setDraftRestoreToken: mockSetDraftRestoreToken,
        } as any,
        agentRunning: false,
        resetStreamingDisplay: jest.fn(),
        showToast: mockShowToast,
        refreshChatTokenLabel: jest.fn(),
        bumpWorktreeUiToken: jest.fn(),
        reloadLists: jest.fn(),
        setCurrentSession: jest.fn(),
        setChatSubview: jest.fn(),
        setConversationPanel: jest.fn(),
        setMessageEditPrompt,
      });
      return null;
    }
    act(() => {
      TestRenderer.create(React.createElement(Harness));
    });

    await act(async () => {
      api!.handleMessageMenuAction(target, 'edit');
    });

    expect(setMessageEditPrompt).toHaveBeenCalled();
    const draft = readChatComposerDraftState('s1');
    expect(draft.text).toBe(editText);
    expect(draft.text).toContain('@/a.md');
    expect(draft.attachments).toEqual([
      {
        name: '/w.md',
        source: 'workplace',
        type: 'text',
        content: null,
        path: '/w.md',
      },
    ]);
    expect((draft.attachments ?? []).some(a => a.source === 'attach')).toBe(
      false,
    );
    expect(mockSetDraftRestoreToken).toHaveBeenCalled();
  });

  it('T-M3: assistant 回滚不写 draft', async () => {
    writeChatComposerDraft('s1', 'unchanged');
    const api = mountActions([plainUserMessage('u'), assistantMessage()]);

    await act(async () => {
      api.handleMessageMenuAction(assistantMessage(), 'rollback');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRollbackToMessage).toHaveBeenCalled();
    expect(readChatComposerDraft('s1')).toBe('unchanged');
    expect(mockSetDraftRestoreToken).not.toHaveBeenCalled();
  });
});
