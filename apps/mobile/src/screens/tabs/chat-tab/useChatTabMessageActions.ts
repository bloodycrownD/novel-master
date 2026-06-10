/**
 * Chat tab message menu, batch ops, fork/rollback, and compaction handlers.
 */
import {useCallback} from 'react';
import {Alert} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  EVENT_SESSION_COMPACTION_REQUESTED,
  type ChatMessage,
} from '@novel-master/core';
import {
  applyTextEditToMessage,
  editableTextFromMessage,
} from '../../../components/chat/message-edit';
import {messageHasToolUse} from '../../../components/chat/message-blocks';
import {
  deleteToolTurn,
  hideToolTurn,
} from '../../../components/chat/tool-turn-actions';
import {toastMessage} from '../../../errors/toast-message';
import {rollbackToMessage} from '../../../services/message-rollback.service';
import type {MobileNovelMasterRuntime} from '../../../runtime/types';
import type {UseChatTabScopeResult} from './useChatTabScope';
import type {UseChatTabMessagesResult} from './useChatTabMessages';
import type {UseChatTabStreamResult} from './useChatTabStream';

type BatchSelection = {
  readonly active: boolean;
  readonly selectedCount: number;
  readonly selectedIds: ReadonlySet<string>;
  exit: () => void;
  enter: () => void;
};

export type UseChatTabMessageActionsParams = {
  runtime: MobileNovelMasterRuntime;
  projectId: string | undefined;
  sessionId: string | undefined;
  setCurrentSession: (sessionId: string) => Promise<void>;
  scope: UseChatTabScopeResult;
  messages: UseChatTabMessagesResult;
  stream: UseChatTabStreamResult;
  messageBatch: BatchSelection;
  refreshChatTokenLabel: () => Promise<void>;
  showToast: (message: string) => void;
  setMessageEditPrompt: (
    value: {messageId: string; initialText: string} | undefined,
  ) => void;
};

export function useChatTabMessageActions({
  runtime,
  projectId,
  sessionId,
  setCurrentSession,
  scope,
  messages,
  stream,
  messageBatch,
  refreshChatTokenLabel,
  showToast,
  setMessageEditPrompt,
}: UseChatTabMessageActionsParams) {
  const exitMessageBatch = useCallback(() => {
    messageBatch.exit();
  }, [messageBatch]);

  const enterMessageBatch = useCallback(() => {
    if (stream.agentRunning) {
      showToast(toastMessage('请稍候', 'Agent 运行中无法批量操作消息'));
      return;
    }
    messageBatch.exit();
    messageBatch.enter();
  }, [stream.agentRunning, messageBatch, showToast]);

  const handleForkFromMessage = useCallback(
    async (messageId: string) => {
      if (sessionId == null) {
        return;
      }
      if (stream.agentRunning) {
        showToast(toastMessage('请稍候', 'Agent 运行中无法 Fork'));
        return;
      }
      try {
        const forked = await runtime.messages.fork(sessionId, messageId);
        await scope.reloadLists();
        await setCurrentSession(forked.id);
        scope.setChatSubview('conversation');
        scope.setConversationPanel('chat');
        stream.resetStreamingDisplay();
        scope.bumpVfsRefresh();
        showToast(`已 Fork：${forked.title ?? forked.id}`);
      } catch (error) {
        showToast(toastMessage('Fork 失败', error));
      }
    },
    [
      sessionId,
      stream.agentRunning,
      stream.resetStreamingDisplay,
      runtime,
      scope,
      setCurrentSession,
      showToast,
    ],
  );

  const handleRollbackFromMessage = useCallback(
    (messageId: string) => {
      if (sessionId == null || projectId == null) {
        return;
      }
      if (stream.agentRunning) {
        showToast(toastMessage('请稍候', 'Agent 运行中无法回滚'));
        return;
      }
      Alert.alert(
        '回滚到此消息',
        '将删除此消息之后的对话，并撤销相关文件修改。是否继续？',
        [
          {text: '取消', style: 'cancel'},
          {
            text: '回滚',
            style: 'destructive',
            onPress: () => {
              void (async () => {
                try {
                  await rollbackToMessage(runtime, {projectId, sessionId}, messageId);
                  stream.resetStreamingDisplay();
                  await messages.reloadMessages(true);
                  scope.bumpVfsRefresh();
                  showToast('回滚成功');
                } catch (error) {
                  showToast(toastMessage('回滚失败', error));
                }
              })();
            },
          },
        ],
      );
    },
    [
      sessionId,
      projectId,
      stream.agentRunning,
      stream.resetStreamingDisplay,
      runtime,
      messages.reloadMessages,
      scope.bumpVfsRefresh,
      showToast,
    ],
  );

  const deleteSelectedMessages = useCallback(async () => {
    const ids = [...messageBatch.selectedIds];
    for (const id of ids) {
      const target = messages.chatMessages.find(m => m.id === id);
      if (target != null && messageHasToolUse(target)) {
        await deleteToolTurn(runtime, messages.chatMessages, id);
      } else {
        await runtime.messages.delete(id);
      }
    }
    exitMessageBatch();
    stream.resetStreamingDisplay();
    await messages.reloadMessages(true);
    void refreshChatTokenLabel();
  }, [
    runtime,
    messageBatch,
    messages.chatMessages,
    messages.reloadMessages,
    exitMessageBatch,
    stream.resetStreamingDisplay,
    refreshChatTokenLabel,
  ]);

  const hideSelectedMessages = useCallback(async () => {
    const ids = [...messageBatch.selectedIds];
    for (const id of ids) {
      const target = messages.chatMessages.find(m => m.id === id);
      if (target != null && messageHasToolUse(target)) {
        await hideToolTurn(runtime, messages.chatMessages, id, true);
      } else {
        await runtime.messages.hide(id);
      }
    }
    exitMessageBatch();
    await messages.reloadMessages(true);
    void refreshChatTokenLabel();
  }, [
    runtime,
    messageBatch,
    messages.chatMessages,
    messages.reloadMessages,
    exitMessageBatch,
    refreshChatTokenLabel,
  ]);

  const unhideSelectedMessages = useCallback(async () => {
    const ids = [...messageBatch.selectedIds];
    for (const id of ids) {
      const target = messages.chatMessages.find(m => m.id === id);
      if (target != null && messageHasToolUse(target)) {
        await hideToolTurn(runtime, messages.chatMessages, id, false);
      } else {
        await runtime.messages.show(id);
      }
    }
    exitMessageBatch();
    await messages.reloadMessages(true);
    void refreshChatTokenLabel();
  }, [
    runtime,
    messageBatch,
    messages.chatMessages,
    messages.reloadMessages,
    exitMessageBatch,
    refreshChatTokenLabel,
  ]);

  const confirmMessageBatchDelete = useCallback(() => {
    const count = messageBatch.selectedCount;
    if (count === 0) {
      return;
    }
    Alert.alert('确认删除', `确定删除选中的 ${count} 条消息？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '删除',
        style: 'destructive',
        onPress: () => deleteSelectedMessages().catch(() => undefined),
      },
    ]);
  }, [messageBatch.selectedCount, deleteSelectedMessages]);

  const confirmBatchHideMessages = useCallback(() => {
    const count = messageBatch.selectedCount;
    if (count === 0) {
      return;
    }
    Alert.alert('确认隐藏', `确定隐藏选中的 ${count} 条消息？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '隐藏',
        onPress: () => hideSelectedMessages().catch(() => undefined),
      },
    ]);
  }, [messageBatch.selectedCount, hideSelectedMessages]);

  const confirmBatchUnhideMessages = useCallback(() => {
    const count = messageBatch.selectedCount;
    if (count === 0) {
      return;
    }
    Alert.alert('确认恢复', `确定恢复选中的 ${count} 条消息？`, [
      {text: '取消', style: 'cancel'},
      {
        text: '恢复',
        onPress: () => unhideSelectedMessages().catch(() => undefined),
      },
    ]);
  }, [messageBatch.selectedCount, unhideSelectedMessages]);

  const handleHideMessage = useCallback(
    async (messageId: string) => {
      try {
        const target = messages.chatMessages.find(m => m.id === messageId);
        if (target != null && messageHasToolUse(target)) {
          await hideToolTurn(runtime, messages.chatMessages, messageId, true);
        } else {
          await runtime.messages.hide(messageId);
        }
        await messages.reloadMessages(true);
        void refreshChatTokenLabel();
      } catch (error) {
        showToast(toastMessage('隐藏失败', error));
      }
    },
    [
      runtime,
      messages.chatMessages,
      messages.reloadMessages,
      refreshChatTokenLabel,
      showToast,
    ],
  );

  const handleShowMessage = useCallback(
    async (messageId: string) => {
      try {
        const target = messages.chatMessages.find(m => m.id === messageId);
        if (target != null && messageHasToolUse(target)) {
          await hideToolTurn(runtime, messages.chatMessages, messageId, false);
        } else {
          await runtime.messages.show(messageId);
        }
        await messages.reloadMessages(true);
        void refreshChatTokenLabel();
      } catch (error) {
        showToast(toastMessage('取消隐藏失败', error));
      }
    },
    [
      runtime,
      messages.chatMessages,
      messages.reloadMessages,
      refreshChatTokenLabel,
      showToast,
    ],
  );

  const handleCompactSession = useCallback(() => {
    if (stream.agentRunning) {
      showToast(toastMessage('请稍候', 'Agent 运行中无法压缩'));
      return;
    }
    if (projectId == null || sessionId == null) {
      return;
    }
    Alert.alert('压缩上下文', '将按照事件配置压缩上下文。是否继续？', [
      {text: '取消', style: 'cancel'},
      {
        text: '压缩',
        onPress: () => {
          void (async () => {
            try {
              const result = await runtime.eventOrchestrator.emit(
                EVENT_SESSION_COMPACTION_REQUESTED,
                {sessionId, projectId, trigger: 'manual'},
              );
              await messages.reloadMessages(true);
              void refreshChatTokenLabel();
              if (!result.ok) {
                showToast(toastMessage('压缩部分失败', result.failures[0]?.error));
              } else {
                showToast('已压缩');
              }
            } catch (error) {
              showToast(toastMessage('压缩失败', error));
            }
          })();
        },
      },
    ]);
  }, [
    stream.agentRunning,
    projectId,
    sessionId,
    runtime.eventOrchestrator,
    messages.reloadMessages,
    refreshChatTokenLabel,
    showToast,
  ]);

  const handleDeleteMessage = useCallback(
    async (messageId: string) => {
      try {
        const target = messages.chatMessages.find(m => m.id === messageId);
        if (target != null && messageHasToolUse(target)) {
          await deleteToolTurn(runtime, messages.chatMessages, messageId);
        } else {
          await runtime.messages.delete(messageId);
        }
        stream.resetStreamingDisplay();
        await messages.reloadMessages(true);
        void refreshChatTokenLabel();
      } catch (error) {
        showToast(toastMessage('删除失败', error));
      }
    },
    [
      runtime,
      messages.chatMessages,
      messages.reloadMessages,
      stream.resetStreamingDisplay,
      refreshChatTokenLabel,
      showToast,
    ],
  );

  const handleMessageMenuAction = useCallback(
    (target: ChatMessage, action: string) => {
      if (action === 'edit') {
        const initial = editableTextFromMessage(target);
        if (initial == null) {
          showToast(toastMessage('无法编辑', '该消息没有可编辑的文本'));
          return;
        }
        setMessageEditPrompt({messageId: target.id, initialText: initial});
      } else if (action === 'hide') {
        handleHideMessage(target.id).catch(() => undefined);
      } else if (action === 'unhide') {
        handleShowMessage(target.id).catch(() => undefined);
      } else if (action === 'copy') {
        const text = editableTextFromMessage(target);
        if (text == null) {
          showToast(toastMessage('无法复制', '该消息没有可复制的文本'));
          return;
        }
        Clipboard.setString(text);
        showToast('已复制');
      } else if (action === 'fork') {
        handleForkFromMessage(target.id).catch(() => undefined);
      } else if (action === 'rollback') {
        handleRollbackFromMessage(target.id);
      } else if (action === 'delete') {
        Alert.alert('删除消息', '确定删除这条消息？', [
          {text: '取消', style: 'cancel'},
          {
            text: '删除',
            style: 'destructive',
            onPress: () => handleDeleteMessage(target.id).catch(() => undefined),
          },
        ]);
      }
    },
    [
      handleDeleteMessage,
      handleForkFromMessage,
      handleHideMessage,
      handleRollbackFromMessage,
      handleShowMessage,
      setMessageEditPrompt,
      showToast,
    ],
  );

  const handleSaveMessageEdit = useCallback(
    async (messageId: string, text: string) => {
      const trimmed = text.trim();
      if (trimmed === '') {
        showToast(toastMessage('无法保存', '消息内容不能为空'));
        return;
      }
      const original = messages.chatMessages.find(m => m.id === messageId);
      if (original == null) {
        showToast(toastMessage('保存失败', '消息不存在'));
        return;
      }
      try {
        await runtime.messages.updateContent(
          messageId,
          applyTextEditToMessage(original, trimmed),
        );
        await messages.reloadMessages(true);
      } catch (error) {
        showToast(toastMessage('保存失败', error));
      }
    },
    [runtime, messages.chatMessages, messages.reloadMessages, showToast],
  );

  return {
    exitMessageBatch,
    enterMessageBatch,
    confirmMessageBatchDelete,
    confirmBatchHideMessages,
    confirmBatchUnhideMessages,
    handleCompactSession,
    handleMessageMenuAction,
    handleSaveMessageEdit,
  };
}
