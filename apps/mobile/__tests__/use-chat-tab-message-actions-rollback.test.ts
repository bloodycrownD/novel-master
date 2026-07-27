/**
 * T-M2/T-M3 / T-UD1–T-UD3：Mobile 回滚确认文案、undo_send Composer draft 与工作区批注恢复。
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  appendUserOpsLog,
  buildAnnotateAttachmentFromDraft,
  buildUserOpsAttachmentFromLogEntry,
  listUserOpsLog,
  resetUserOpsLogStoreForTests,
  type ChatMessage,
  type MessageAttachment,
} from '@novel-master/core/chat';
import { Alert } from 'react-native';
import {
  addChatAnnotateDraft,
  chipsFromAnnotateStore,
  listChatAnnotateDrafts,
  resetChatAnnotateDraftStoreForTests,
} from '../src/storage/chat-annotate-draft';
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
    resetChatAnnotateDraftStoreForTests();
    resetUserOpsLogStoreForTests();
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
    resetChatAnnotateDraftStoreForTests();
    resetUserOpsLogStoreForTests();
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

  it('T-TX2: 编辑打开弹窗不污染 Composer draft；仅 undo_send 回填正文', async () => {
    writeChatComposerDraftState('s1', {
      text: 'keep-me',
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

    expect(setMessageEditPrompt).toHaveBeenCalledWith({
      messageId: target.id,
      initialText: editText,
    });
    const draft = readChatComposerDraftState('s1');
    expect(draft.text).toBe('keep-me');
    expect(draft.attachments).toEqual([
      {
        name: '/w.md',
        source: 'workplace',
        type: 'text',
        content: null,
        path: '/w.md',
      },
      {
        name: '/old.md',
        source: 'attach',
        type: 'text',
        content: null,
        path: '/old.md',
      },
    ]);
    expect(mockSetDraftRestoreToken).not.toHaveBeenCalled();
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

  it('T-UD1: undo_send 含 annotate → store 含 path 草稿 + chip；与未发送并存', async () => {
    addChatAnnotateDraft('s1', {
      id: 'unsent-keep',
      path: '/keep.md',
      originalText: '未发送原文',
      userAnnotation: '未发送说明',
    });
    const annotateAtt = buildAnnotateAttachmentFromDraft({
      id: 'sent-ann',
      path: '/chapter/a.md',
      originalText: '选中原文',
      userAnnotation: '请改短',
    });
    const anchor = plainUserMessage('请看批注', [annotateAtt]);
    const api = mountActions([anchor]);

    await act(async () => {
      api.handleMessageMenuAction(anchor, 'rollback');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRollbackToMessage).toHaveBeenCalled();
    expect(readChatComposerDraft('s1')).toBe('请看批注');
    const drafts = listChatAnnotateDrafts('s1');
    expect(drafts).toHaveLength(2);
    expect(drafts.some(d => d.id === 'unsent-keep' && d.path === '/keep.md')).toBe(
      true,
    );
    const restored = drafts.find(d => d.path === '/chapter/a.md');
    expect(restored).toMatchObject({
      path: '/chapter/a.md',
      originalText: '选中原文',
      userAnnotation: '请改短',
    });
    expect(restored?.id).not.toBe('sent-ann');
    const chips = chipsFromAnnotateStore('s1');
    expect(chips.some(c => c.path === '/chapter/a.md' && c.action === 'annotate')).toBe(
      true,
    );
    expect(chips.some(c => c.path === '/keep.md' && c.action === 'annotate')).toBe(
      true,
    );
    const draftAttachments = readChatComposerDraftState('s1').attachments ?? [];
    expect(draftAttachments.some(a => a.source === 'attach')).toBe(false);
    expect(
      draftAttachments.some(
        a => a.action === 'annotate' && a.path === '/chapter/a.md',
      ),
    ).toBe(true);
  });

  it('T-UD2: undo_send 无 annotate → store 不新增；正文恢复；attachments 仍 []', async () => {
    writeChatComposerDraftState('s1', { text: 'old', attachments: [] });
    const anchor = plainUserMessage('仅正文 @/a.md', [
      {
        name: '/a.md',
        source: 'attach' as const,
        type: 'text' as const,
        content: null,
        path: '/a.md',
      },
    ]);
    const api = mountActions([anchor]);

    await act(async () => {
      api.handleMessageMenuAction(anchor, 'rollback');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readChatComposerDraft('s1')).toBe('仅正文 @/a.md');
    expect(listChatAnnotateDrafts('s1')).toEqual([]);
    expect(chipsFromAnnotateStore('s1')).toEqual([]);
    expect(readChatComposerDraftState('s1').attachments ?? []).toEqual([]);
  });

  it('T-UD3: undo_send 伪 path __message__: / /__message__: → 不写入文件批注 store', async () => {
    // 手工伪 path（消息批注 builder 已移除；历史防御）
    const msgAtt: MessageAttachment = {
      name: '__message__:m-99:d1',
      source: 'user_ops',
      type: 'text',
      content:
        '<action name="annotate">\n{"path":"__message__:m-99:d1","messageId":"m-99","originalText":"气泡选区","userAnnotation":"批一下"}\n</action>',
      path: '__message__:m-99:d1',
      action: 'annotate',
    };
    const withSlash: MessageAttachment = {
      ...msgAtt,
      path: `/${msgAtt.path}`,
      name: `/${msgAtt.path}`,
    };
    const anchor = plainUserMessage('消息批注 Undo', [msgAtt, withSlash]);
    const api = mountActions([anchor]);

    await act(async () => {
      api.handleMessageMenuAction(anchor, 'rollback');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readChatComposerDraft('s1')).toBe('消息批注 Undo');
    expect(listChatAnnotateDrafts('s1')).toEqual([]);
    expect(chipsFromAnnotateStore('s1')).toEqual([]);
    expect(listUserOpsLog('s1')).toEqual([]);
    expect(readChatComposerDraftState('s1').attachments ?? []).toEqual([]);
  });

  it('T-UD4/T-UOL7: undo_send 含 user_ops → log store 清空、无 user_ops chip；正文恢复', async () => {
    appendUserOpsLog('s1', {
      id: 'uol-unsent',
      createdAtMs: 1,
      actionXml: `<action name="write">\n${JSON.stringify({ path: '/keep.md', content: 'k' }, null, 2)}\n</action>`,
      action: 'write',
      path: '/keep.md',
      content: 'k',
    });
    const opsAtt = buildUserOpsAttachmentFromLogEntry({
      id: 'uol-sent',
      createdAtMs: 2,
      actionXml: `<action name="edit">\n${JSON.stringify({ path: '/chapter/a.md', oldString: 'a', newString: 'b' }, null, 2)}\n</action>`,
      action: 'edit',
      path: '/chapter/a.md',
      hunks: [{ oldString: 'a', newString: 'b' }],
    });
    const anchor = plainUserMessage('请看手改', [opsAtt]);
    const api = mountActions([anchor]);

    await act(async () => {
      api.handleMessageMenuAction(anchor, 'rollback');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRollbackToMessage).toHaveBeenCalled();
    expect(readChatComposerDraft('s1')).toBe('请看手改');
    expect(listUserOpsLog('s1')).toEqual([]);
    const draftAttachments = readChatComposerDraftState('s1').attachments ?? [];
    expect(draftAttachments.some(a => a.source === 'attach')).toBe(false);
    expect(draftAttachments.some(a => a.source === 'user_ops')).toBe(false);
  });

  it('T-UD5/T-UOL7: rewind 不映回消息手改附件', async () => {
    const opsAtt = buildUserOpsAttachmentFromLogEntry({
      id: 'uol-asst-should-not',
      createdAtMs: 1,
      actionXml: `<action name="write">\n${JSON.stringify({ path: '/no.md', content: 'x' }, null, 2)}\n</action>`,
      action: 'write',
      path: '/no.md',
      content: 'x',
    });
    // assistant 锚点 → rewind；即便误带 user_ops 也不映回
    const asst: ChatMessage = {
      ...assistantMessage(),
      attachments: [opsAtt],
    };
    const api = mountActions([plainUserMessage('u'), asst]);

    await act(async () => {
      api.handleMessageMenuAction(asst, 'rollback');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRollbackToMessage).toHaveBeenCalled();
    expect(listUserOpsLog('s1')).toEqual([]);
    expect(mockSetDraftRestoreToken).not.toHaveBeenCalled();
  });

  it('T-UD6/G-1: rewind 前预置未发送 ops → store 空、无 user_ops chip', async () => {
    appendUserOpsLog('s1', {
      id: 'uol-unsent',
      createdAtMs: 1,
      actionXml: `<action name="write">\n${JSON.stringify({ path: '/keep.md', content: 'k' }, null, 2)}\n</action>`,
      action: 'write',
      path: '/keep.md',
      content: 'k',
    });
    writeChatComposerDraftState('s1', {
      text: 'draft',
      attachments: [
        {
          name: '/keep.md',
          source: 'user_ops',
          type: 'text',
          content: null,
          path: '/keep.md',
          action: 'write',
        },
      ],
    });
    const api = mountActions([plainUserMessage('u'), assistantMessage()]);

    await act(async () => {
      api.handleMessageMenuAction(assistantMessage(), 'rollback');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRollbackToMessage).toHaveBeenCalled();
    expect(listUserOpsLog('s1')).toEqual([]);
    const draftAttachments = readChatComposerDraftState('s1').attachments ?? [];
    expect(draftAttachments.some(a => a.source === 'user_ops')).toBe(false);
  });
});
