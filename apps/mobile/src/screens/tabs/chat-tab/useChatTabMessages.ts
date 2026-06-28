/**
 * Chat tab message list state: tail load, cache, and older-message paging.
 */
import {useCallback, useEffect, useRef, useState} from 'react';
import {Alert} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { type ChatMessage } from "@novel-master/core/chat";

import { EVENT_SESSION_COMPACTION_REQUESTED } from "@novel-master/core/events";
import {formatError} from '@/errors/format-error';
import {toastMessage} from '@/errors/toast-message';
import {
  applyTextEditToMessage,
  editableTextFromMessage,
} from '@/components/chat/message-edit';
import {
  deriveComposerSendState,
  findLastVisibleMessage,
} from '@/components/chat/composer-send-state';
import {
  computeHideRangeFromSelection,
} from '@/components/chat/transcript-selectable-role';
import {
  chatMessagesToTailBatchRows,
  computeTailBatchRangeFromSelection,
  tailBatchDeleteAfterSeq,
} from '@/components/chat/transcript-selectable-role';
import type {MessageBatchMode} from '@/components/chat/transcript-selectable-role';
import type {useBatchSelection} from '@/hooks/useBatchSelection';
import {
  isRollbackRevisionBackfillRequiredError,
  isRollbackVfsDegradableError,
} from '@novel-master/core/session-fs';
import type {RollbackOptions} from '@novel-master/core/message-checkpoint';
import {rollbackToMessage} from '@/services/message-rollback.service';
import {
  getSessionViewCache,
  sessionViewCacheKey,
  setSessionViewCache,
} from '@/services/chat-session-view-cache';
import {
  loadSessionMessagesPageForDisplay,
  loadSessionMessagesTailForDisplay,
} from '@/services/regex-apply-channel';
import {prependOlderMessages} from '@/services/message-paging';
import type {MobileNovelMasterRuntime} from '@/runtime/types';
import type {ChatSubview} from './useChatTabScope';

const CHAT_PAGE_SIZE = 40;

export type UseChatTabMessagesParams = {
  runtime: MobileNovelMasterRuntime;
  projectId: string | undefined;
  sessionId: string | undefined;
  chatSubview: ChatSubview;
};

export function useChatTabMessages({
  runtime,
  projectId,
  sessionId,
  chatSubview,
}: UseChatTabMessagesParams) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);

  const composerSendState = deriveComposerSendState(
    findLastVisibleMessage(chatMessages),
  );

  const canResumeWithoutInput = composerSendState.canResumeWithoutInput;

  const persistSessionViewCache = useCallback(
    (messages: readonly ChatMessage[], hasMore: boolean) => {
      if (projectId == null || sessionId == null) {
        return;
      }
      setSessionViewCache(sessionViewCacheKey(projectId, sessionId), {
        messages,
        hasMoreMessages: hasMore,
      });
    },
    [projectId, sessionId],
  );

  const reloadInFlightRef = useRef<Promise<void> | null>(null);
  const reloadCoalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingForceReloadRef = useRef(false);

  const reloadMessages = useCallback(
    async (force = false) => {
      if (force && reloadInFlightRef.current != null) {
        return reloadInFlightRef.current;
      }
      const run = async () => {
        if (sessionId == null || projectId == null) {
          setChatMessages([]);
          setHasMoreMessages(false);
          return;
        }
        const cacheKey = sessionViewCacheKey(projectId, sessionId);
        if (!force) {
          const cached = getSessionViewCache(cacheKey);
          if (cached != null) {
            setChatMessages([...cached.messages]);
            setHasMoreMessages(cached.hasMoreMessages);
            return;
          }
        }
        const list = await loadSessionMessagesTailForDisplay(
          runtime,
          sessionId,
          CHAT_PAGE_SIZE,
        );
        let hasMore = false;
        const oldestSeq = list[0]?.seq;
        if (oldestSeq != null) {
          const older = await runtime.messages.listBySessionPage(sessionId, {
            limit: 1,
            beforeSeq: oldestSeq,
          });
          hasMore = older.length > 0;
        }
        setChatMessages(list);
        setHasMoreMessages(hasMore);
        setSessionViewCache(cacheKey, {
          messages: list,
          hasMoreMessages: hasMore,
        });
      };
      if (!force) {
        await run();
        return;
      }
      const task = run();
      reloadInFlightRef.current = task;
      try {
        await task;
      } finally {
        if (reloadInFlightRef.current === task) {
          reloadInFlightRef.current = null;
        }
      }
    },
    [runtime, sessionId, projectId],
  );

  const hydrateFromSessionCache = useCallback(
    (pid: string, sid: string) => {
      const cached = getSessionViewCache(sessionViewCacheKey(pid, sid));
      if (cached != null) {
        setChatMessages([...cached.messages]);
        setHasMoreMessages(cached.hasMoreMessages);
      } else {
        setChatMessages([]);
        setHasMoreMessages(false);
      }
    },
    [],
  );

  const loadOlderMessages = useCallback(async () => {
    if (sessionId == null || loadingMoreMessages || chatMessages.length === 0) {
      return;
    }
    setLoadingMoreMessages(true);
    try {
      const beforeSeq = chatMessages[0]?.seq;
      if (beforeSeq == null) {
        return;
      }
      const older = await loadSessionMessagesPageForDisplay(runtime, sessionId, {
        limit: CHAT_PAGE_SIZE,
        beforeSeq,
      });
      if (older.length === 0) {
        setHasMoreMessages(false);
        return;
      }
      const hasMore = older.length === CHAT_PAGE_SIZE;
      setChatMessages(prev => {
        const next = prependOlderMessages(prev, older);
        persistSessionViewCache(next, hasMore);
        return next;
      });
      setHasMoreMessages(hasMore);
    } finally {
      setLoadingMoreMessages(false);
    }
  }, [
    runtime,
    sessionId,
    loadingMoreMessages,
    chatMessages,
    persistSessionViewCache,
  ]);

  const handleMessagesChanged = useCallback(
    async (
      refreshChatTokenLabel: () => Promise<void>,
      agentRunning = false,
    ) => {
      if (agentRunning) {
        pendingForceReloadRef.current = true;
        if (reloadCoalesceTimerRef.current != null) {
          void refreshChatTokenLabel();
          return;
        }
        reloadCoalesceTimerRef.current = setTimeout(() => {
          reloadCoalesceTimerRef.current = null;
          const force = pendingForceReloadRef.current;
          pendingForceReloadRef.current = false;
          void reloadMessages(force).then(() => refreshChatTokenLabel());
        }, 200);
        void refreshChatTokenLabel();
        return;
      }
      await reloadMessages(true);
      void refreshChatTokenLabel();
    },
    [reloadMessages],
  );

  useEffect(() => {
    if (chatSubview === 'conversation' && sessionId != null) {
      reloadMessages().catch(() => undefined);
    }
  }, [chatSubview, sessionId, reloadMessages]);

  return {
    chatMessages,
    setChatMessages,
    hasMoreMessages,
    setHasMoreMessages,
    loadingMoreMessages,
    canResumeWithoutInput,
    lastMessageHasToolResult: composerSendState.lastMessageHasToolResult,
    lastMessageIsPlainUserText: composerSendState.lastMessageIsPlainUserText,
    reloadMessages,
    loadOlderMessages,
    persistSessionViewCache,
    handleMessagesChanged,
    hydrateFromSessionCache,
  };
}

export type UseChatTabMessagesResult = ReturnType<typeof useChatTabMessages>;

type BatchSelection = ReturnType<typeof useBatchSelection> & {
  mode: MessageBatchMode | null;
  enterHide: () => void;
  enterRestore: () => void;
  enterDelete: () => void;
};

export type UseChatTabMessageActionsParams = {
  runtime: MobileNovelMasterRuntime;
  projectId: string | undefined;
  sessionId: string | undefined;
  messages: UseChatTabMessagesResult;
  messageBatch: BatchSelection;
  agentRunning: boolean;
  resetStreamingDisplay: () => void;
  showToast: (message: string) => void;
  refreshChatTokenLabel: () => Promise<void>;
  bumpWorktreeUiToken: () => void;
  reloadLists: () => Promise<void>;
  setCurrentSession: (sessionId: string) => Promise<void>;
  setChatSubview: (subview: ChatSubview) => void;
  setConversationPanel: (panel: import('./useChatTabScope').ConversationPanel) => void;
  setMessageEditPrompt: (
    prompt: {messageId: string; initialText: string} | undefined,
  ) => void;
};

export function useChatTabMessageActions({
  runtime,
  projectId,
  sessionId,
  messages,
  messageBatch,
  agentRunning,
  resetStreamingDisplay,
  showToast,
  refreshChatTokenLabel,
  bumpWorktreeUiToken,
  reloadLists,
  setCurrentSession,
  setChatSubview,
  setConversationPanel,
  setMessageEditPrompt,
}: UseChatTabMessageActionsParams) {
  const {chatMessages, reloadMessages} = messages;

  const exitMessageBatch = useCallback(() => {
    messageBatch.exit();
  }, [messageBatch]);

  const enterHideMessageBatch = useCallback(() => {
    if (agentRunning) {
      showToast(toastMessage('请稍候', 'Agent 运行中无法操作消息可见性'));
      return;
    }
    messageBatch.exit();
    messageBatch.enterHide();
  }, [agentRunning, messageBatch, showToast]);

  const enterRestoreMessageBatch = useCallback(() => {
    if (agentRunning) {
      showToast(toastMessage('请稍候', 'Agent 运行中无法操作消息可见性'));
      return;
    }
    messageBatch.exit();
    messageBatch.enterRestore();
  }, [agentRunning, messageBatch, showToast]);

  const enterDeleteMessageBatch = useCallback(() => {
    if (agentRunning) {
      showToast(toastMessage('请稍候', 'Agent 运行中无法删除消息'));
      return;
    }
    messageBatch.exit();
    messageBatch.enterDelete();
  }, [agentRunning, messageBatch, showToast]);

  const finishMessageBatchMutation = useCallback(
    async (mode: MessageBatchMode) => {
      exitMessageBatch();
      await reloadMessages(true);
      if (mode === 'hide' || mode === 'restore') {
        bumpWorktreeUiToken();
      }
      void refreshChatTokenLabel();
    },
    [
      exitMessageBatch,
      reloadMessages,
      bumpWorktreeUiToken,
      refreshChatTokenLabel,
    ],
  );

  const confirmVisibilityBatch = useCallback(async () => {
    if (projectId == null || sessionId == null || messageBatch.mode == null) {
      return;
    }
    if (messageBatch.selectedCount === 0) {
      return;
    }

    const runHide = async (toSeq: number) => {
      await runtime.messageTranscriptEffects.hideMessagesInRange(
        projectId,
        sessionId,
        1,
        toSeq,
      );
      await finishMessageBatchMutation('hide');
      showToast('已隐藏');
    };

    const runRestore = async (fromSeq: number, toSeq: number) => {
      await runtime.messageTranscriptEffects.showMessagesInRange(
        projectId,
        sessionId,
        fromSeq,
        toSeq,
      );
      await finishMessageBatchMutation('restore');
      showToast('已恢复');
    };

    const runDelete = async (afterSeq: number) => {
      await runtime.messageTranscriptEffects.truncateMessagesAfter(
        projectId,
        sessionId,
        afterSeq,
      );
      await finishMessageBatchMutation('delete');
      showToast('已删除');
    };

    if (messageBatch.mode === 'hide') {
      const range = computeHideRangeFromSelection(
        chatMessages,
        messageBatch.selectedIds,
      );
      if (range == null) {
        return;
      }
      Alert.alert(
        '确认隐藏',
        `将隐藏所选 assistant 消息（seq ≤ ${range.toSeq}）及其之前的所有消息。是否继续？`,
        [
          {text: '取消', style: 'cancel'},
          {
            text: '隐藏',
            onPress: () => runHide(range.toSeq).catch(err => {
              showToast(toastMessage('隐藏失败', err));
            }),
          },
        ],
      );
      return;
    }

    const all = await runtime.messages.listBySession(sessionId);
    const sessionMaxSeq =
      all.length > 0 ? Math.max(...all.map(m => m.seq)) : 0;
    const tailRows = chatMessagesToTailBatchRows(all);
    const range = computeTailBatchRangeFromSelection(
      tailRows,
      messageBatch.selectedIds,
      sessionMaxSeq,
      messageBatch.mode,
    );
    if (range == null) {
      return;
    }

    if (messageBatch.mode === 'delete') {
      const afterSeq = tailBatchDeleteAfterSeq(range.fromSeq);
      Alert.alert(
        '确认删除',
        `将永久删除所选消息（seq ≥ ${range.fromSeq}）及其之后的所有消息。仅删除聊天记录，工作区文件不变。是否继续？`,
        [
          {text: '取消', style: 'cancel'},
          {
            text: '删除',
            style: 'destructive',
            onPress: () =>
              runDelete(afterSeq).catch(err => {
                showToast(toastMessage('删除失败', err));
              }),
          },
        ],
      );
      return;
    }

    Alert.alert(
      '确认恢复',
      `将恢复所选消息（seq ≥ ${range.fromSeq}）及其之后的所有消息。是否继续？`,
      [
        {text: '取消', style: 'cancel'},
        {
          text: '恢复',
          onPress: () =>
            runRestore(range.fromSeq, range.toSeq).catch(err => {
              showToast(toastMessage('恢复失败', err));
            }),
        },
      ],
    );
  }, [
    projectId,
    sessionId,
    messageBatch,
    chatMessages,
    runtime,
    finishMessageBatchMutation,
    showToast,
  ]);

  const handleCompactSession = useCallback(() => {
    if (agentRunning) {
      showToast(toastMessage('请稍候', 'Agent 运行中无法压缩'));
      return;
    }
    if (projectId == null || sessionId == null) {
      return;
    }
    Alert.alert(
      '压缩上下文',
      '将按照事件配置压缩上下文。是否继续？',
      [
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
                await reloadMessages(true);
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
      ],
    );
  }, [
    agentRunning,
    projectId,
    sessionId,
    runtime.eventOrchestrator,
    reloadMessages,
    refreshChatTokenLabel,
    showToast,
  ]);

  const handleForkFromMessage = useCallback(
    async (messageId: string) => {
      if (sessionId == null) {
        return;
      }
      if (agentRunning) {
        showToast(toastMessage('请稍候', 'Agent 运行中无法分叉'));
        return;
      }
      try {
        const forked = await runtime.messages.fork(sessionId, messageId);
        await reloadLists();
        await setCurrentSession(forked.id);
        setChatSubview('conversation');
        setConversationPanel('chat');
        resetStreamingDisplay();
        showToast(`已分叉：${forked.title ?? forked.id}`);
      } catch (error) {
        showToast(toastMessage('分叉失败', error));
      }
    },
    [
      sessionId,
      agentRunning,
      runtime,
      reloadLists,
      setCurrentSession,
      setChatSubview,
      setConversationPanel,
      resetStreamingDisplay,
      showToast,
    ],
  );

  const handleRollbackFromMessage = useCallback(
    (messageId: string) => {
      if (sessionId == null || projectId == null) {
        return;
      }
      if (agentRunning) {
        showToast(toastMessage('请稍候', 'Agent 运行中无法回滚'));
        return;
      }

      const runRollback = async (
        targetMessageId: string,
        options?: RollbackOptions,
      ) => {
        try {
          await rollbackToMessage(
            runtime,
            {projectId, sessionId},
            targetMessageId,
            options,
          );
          resetStreamingDisplay();
          await reloadMessages(true);
          showToast(
            options?.skipVfsReconcile ? '对话已截断，工作区未恢复' : '回滚成功',
          );
        } catch (error) {
          if (
            !options?.skipVfsReconcile &&
            !options?.revisionHeadBackfill &&
            isRollbackRevisionBackfillRequiredError(error)
          ) {
            Alert.alert(
              '快照丢失',
              '快照丢失，将使用最新内容修复。\n\n其余文件将正常回滚至锚点。',
              [
                {text: '取消', style: 'cancel'},
                {
                  text: '继续回滚',
                  style: 'destructive',
                  onPress: () => {
                    void runRollback(targetMessageId, {
                      revisionHeadBackfill: true,
                    }).catch(err => {
                      showToast(toastMessage('回滚失败', err));
                    });
                  },
                },
              ],
            );
            return;
          }
          if (!options?.skipVfsReconcile && isRollbackVfsDegradableError(error)) {
            const errorMessage = formatError(error);
            Alert.alert(
              '无法恢复工作区',
              `${errorMessage}\n\n可仅删除此消息之后的对话，工作区文件将保持现状。`,
              [
                {text: '取消', style: 'cancel'},
                {
                  text: '仅删除后续对话',
                  style: 'destructive',
                  onPress: () => {
                    void runRollback(targetMessageId, {
                      skipVfsReconcile: true,
                    }).catch(err => {
                      showToast(toastMessage('回滚失败', err));
                    });
                  },
                },
              ],
            );
            return;
          }
          showToast(toastMessage('回滚失败', error));
        }
      };

      Alert.alert(
        '回滚到此消息',
        '将删除此消息之后的对话，并撤销相关文件修改。是否继续？',
        [
          {text: '取消', style: 'cancel'},
          {
            text: '回滚',
            style: 'destructive',
            onPress: () => {
              void runRollback(messageId).catch(err => {
                showToast(toastMessage('回滚失败', err));
              });
            },
          },
        ],
      );
    },
    [
      sessionId,
      projectId,
      agentRunning,
      runtime,
      reloadMessages,
      resetStreamingDisplay,
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
        setMessageEditPrompt({
          messageId: target.id,
          initialText: initial,
        });
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
      }
    },
    [
      handleForkFromMessage,
      handleRollbackFromMessage,
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
      const original = chatMessages.find(m => m.id === messageId);
      if (original == null) {
        showToast(toastMessage('保存失败', '消息不存在'));
        return;
      }
      try {
        await runtime.messages.updateContent(
          messageId,
          applyTextEditToMessage(original, trimmed),
        );
        await reloadMessages(true);
      } catch (error) {
        showToast(toastMessage('保存失败', error));
      }
    },
    [runtime, chatMessages, reloadMessages, showToast],
  );

  return {
    exitMessageBatch,
    enterHideMessageBatch,
    enterRestoreMessageBatch,
    enterDeleteMessageBatch,
    confirmVisibilityBatch,
    handleCompactSession,
    handleMessageMenuAction,
    handleSaveMessageEdit,
  };
}
