/**
 * Chat tab message list state: tail load, cache, and older-message paging.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {
  type ChatMessage,
  isPlainUserUndoSendEligible,
  parseAnnotateDraftsFromAttachments,
  resolveRollbackConfirmMessage,
} from '@novel-master/core/chat';

import { EVENT_SESSION_COMPACTION_REQUESTED } from '@novel-master/core/events';
import { formatError } from '@/errors/format-error';
import { toastMessage } from '@/errors/toast-message';
import {
  applyTextEditToMessage,
  editableTextFromMessage,
} from '@/components/chat/message-edit';
import {
  deriveComposerSendState,
  findLastVisibleMessage,
} from '@/components/chat/composer-send-state';
import {
  isRollbackRevisionBackfillRequiredError,
  isRollbackVfsDegradableError,
  readRollbackRevisionBackfillMissingPaths,
} from '@novel-master/core/session-fs';
import { addChatAnnotateDraft } from '@/storage/chat-annotate-draft';
import {
  readChatComposerDraftState,
  refreshComposerAnnotateChips,
  writeChatComposerDraftState,
} from '@/storage/chat-composer-draft';
import { refreshComposerStatusAfterSessionKkvCleared } from '@/services/project-composer-status.service';
import type { RollbackOptions } from '@novel-master/core/message-checkpoint';
import { rollbackToMessage } from '@/services/message-rollback.service';
import {
  getSessionViewCache,
  sessionViewCacheKey,
  setSessionViewCache,
} from '@/services/chat-session-view-cache';
import {
  loadSessionMessagesPageForDisplay,
  loadSessionMessagesTailForDisplay,
} from '@/services/regex-apply-channel';
import { prependOlderMessages } from '@/services/message-paging';
import type { MobileNovelMasterRuntime } from '@/runtime/types';
import type { ChatSubview } from './useChatTabScope';

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
  const [draftRestoreToken, setDraftRestoreToken] = useState(0);

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

  const reloadInFlightRef = useRef<Promise<ChatMessage[]> | null>(null);
  const reloadCoalesceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingForceReloadRef = useRef(false);

  const reloadMessages = useCallback(
    async (force = false): Promise<ChatMessage[]> => {
      if (force && reloadInFlightRef.current != null) {
        return reloadInFlightRef.current;
      }
      const run = async (): Promise<ChatMessage[]> => {
        if (sessionId == null || projectId == null) {
          setChatMessages([]);
          setHasMoreMessages(false);
          return [];
        }
        const cacheKey = sessionViewCacheKey(projectId, sessionId);
        if (!force) {
          const cached = getSessionViewCache(cacheKey);
          if (cached != null) {
            setChatMessages([...cached.messages]);
            setHasMoreMessages(cached.hasMoreMessages);
            return [...cached.messages];
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
        return list;
      };
      if (!force) {
        return run();
      }
      const task = run();
      reloadInFlightRef.current = task;
      try {
        return await task;
      } finally {
        if (reloadInFlightRef.current === task) {
          reloadInFlightRef.current = null;
        }
      }
    },
    [runtime, sessionId, projectId],
  );

  const hydrateFromSessionCache = useCallback((pid: string, sid: string) => {
    const cached = getSessionViewCache(sessionViewCacheKey(pid, sid));
    if (cached != null) {
      setChatMessages([...cached.messages]);
      setHasMoreMessages(cached.hasMoreMessages);
    } else {
      setChatMessages([]);
      setHasMoreMessages(false);
    }
  }, []);

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
      const older = await loadSessionMessagesPageForDisplay(
        runtime,
        sessionId,
        {
          limit: CHAT_PAGE_SIZE,
          beforeSeq,
        },
      );
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
      options?: { agentRunning?: boolean; immediate?: boolean },
    ): Promise<ChatMessage[]> => {
      const agentRunning = options?.agentRunning ?? false;
      const immediate = options?.immediate ?? false;

      if (immediate) {
        const list = await reloadMessages(true);
        void refreshChatTokenLabel();
        return list;
      }

      if (agentRunning) {
        pendingForceReloadRef.current = true;
        if (reloadCoalesceTimerRef.current != null) {
          void refreshChatTokenLabel();
          return chatMessages;
        }
        reloadCoalesceTimerRef.current = setTimeout(() => {
          reloadCoalesceTimerRef.current = null;
          const force = pendingForceReloadRef.current;
          pendingForceReloadRef.current = false;
          void reloadMessages(force).then(() => refreshChatTokenLabel());
        }, 200);
        void refreshChatTokenLabel();
        return chatMessages;
      }
      const list = await reloadMessages(true);
      void refreshChatTokenLabel();
      return list;
    },
    [reloadMessages, chatMessages],
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
    draftRestoreToken,
    setDraftRestoreToken,
  };
}

export type UseChatTabMessagesResult = ReturnType<typeof useChatTabMessages>;

export type UseChatTabMessageActionsParams = {
  runtime: MobileNovelMasterRuntime;
  projectId: string | undefined;
  sessionId: string | undefined;
  messages: UseChatTabMessagesResult;
  agentRunning: boolean;
  resetStreamingDisplay: () => void;
  showToast: (message: string) => void;
  refreshChatTokenLabel: () => Promise<void>;
  bumpWorktreeUiToken: () => void;
  reloadLists: () => Promise<void>;
  setCurrentSession: (sessionId: string) => Promise<void>;
  setChatSubview: (subview: ChatSubview) => void;
  setConversationPanel: (
    panel: import('./useChatTabScope').ConversationPanel,
  ) => void;
  setMessageEditPrompt: (
    prompt: { messageId: string; initialText: string } | undefined,
  ) => void;
};

export function useChatTabMessageActions({
  runtime,
  projectId,
  sessionId,
  messages,
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
  const { chatMessages, reloadMessages, setDraftRestoreToken } = messages;

  const handleCompactSession = useCallback(() => {
    if (agentRunning) {
      showToast(toastMessage('请稍候', 'Agent 运行中无法压缩'));
      return;
    }
    if (projectId == null || sessionId == null) {
      return;
    }
    Alert.alert('压缩上下文', '将按照事件配置压缩上下文。是否继续？', [
      { text: '取消', style: 'cancel' },
      {
        text: '压缩',
        onPress: () => {
          void (async () => {
            try {
              const result = await runtime.eventOrchestrator.emit(
                EVENT_SESSION_COMPACTION_REQUESTED,
                { sessionId, projectId, trigger: 'manual' },
              );
              await reloadMessages(true);
              void refreshChatTokenLabel();
              if (!result.ok) {
                showToast(
                  toastMessage('压缩部分失败', result.failures[0]?.error),
                );
              } else {
                await refreshComposerStatusAfterSessionKkvCleared(runtime, {
                  projectId,
                  sessionId,
                });
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
    agentRunning,
    projectId,
    sessionId,
    runtime,
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

      const target = chatMessages.find(m => m.id === messageId);
      if (target == null) {
        showToast(toastMessage('回滚失败', '消息不存在'));
        return;
      }

      const mode = isPlainUserUndoSendEligible(target) ? 'undo_send' : 'rewind';
      const restoreText = editableTextFromMessage(target);
      // 删消息前 snapshot：成功后解析真 VFS 工作区批注（伪 path 由 parse 跳过）
      const annotateAttachmentsSnapshot =
        mode === 'undo_send' ? (target.attachments ?? []) : null;

      const applyComposerRestore = () => {
        if (mode === 'undo_send' && restoreText != null) {
          // T-TX2：仅正文（含 `@路径`）；状态由 kkv 清空后投影；无 attach chip
          writeChatComposerDraftState(
            sessionId,
            {
              text: restoreText,
              attachments: [],
            },
            runtime.sessions,
          );
          // append 进现有 store，与未发送草稿并存；无 annotate 不造草稿
          if (annotateAttachmentsSnapshot != null) {
            const restored = parseAnnotateDraftsFromAttachments(
              annotateAttachmentsSnapshot,
            );
            for (const draft of restored) {
              addChatAnnotateDraft(sessionId, draft);
            }
          }
          // 重投影 chip（含未发送 ∪ 刚恢复）；无批注时仍保持 attachments:[]
          refreshComposerAnnotateChips(sessionId);
          setDraftRestoreToken(t => t + 1);
        }
      };

      const runRollback = async (
        targetMessageId: string,
        options?: RollbackOptions,
      ) => {
        try {
          await rollbackToMessage(
            runtime,
            { projectId, sessionId },
            targetMessageId,
            options,
          );
          await refreshComposerStatusAfterSessionKkvCleared(runtime, {
            projectId,
            sessionId,
          });
          resetStreamingDisplay();
          await reloadMessages(true);
          applyComposerRestore();
          showToast(
            options?.skipVfsReconcile ? '对话已截断，工作区未恢复' : '回滚成功',
          );
        } catch (error) {
          if (
            !options?.skipVfsReconcile &&
            !options?.revisionHeadBackfill &&
            isRollbackRevisionBackfillRequiredError(error)
          ) {
            const missingPaths =
              readRollbackRevisionBackfillMissingPaths(error);
            Alert.alert(
              '快照丢失',
              resolveRollbackConfirmMessage(mode, 'backfill', {
                missingPaths,
              }),
              [
                { text: '取消', style: 'cancel' },
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
          if (
            !options?.skipVfsReconcile &&
            isRollbackVfsDegradableError(error)
          ) {
            const errorMessage = formatError(error);
            Alert.alert(
              '无法恢复工作区',
              `${errorMessage}\n\n${resolveRollbackConfirmMessage(mode, 'degraded')}`,
              [
                { text: '取消', style: 'cancel' },
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
        resolveRollbackConfirmMessage(mode, 'primary'),
        [
          { text: '取消', style: 'cancel' },
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
      chatMessages,
      runtime,
      reloadMessages,
      resetStreamingDisplay,
      showToast,
      setDraftRestoreToken,
    ],
  );

  const handleSetFloorFromMessage = useCallback(
    (messageId: string) => {
      if (sessionId == null || projectId == null) {
        return;
      }
      if (agentRunning) {
        showToast(toastMessage('请稍候', 'Agent 运行中无法置位'));
        return;
      }

      const runSetFloor = async () => {
        try {
          // clear session kkv 由 Core setMessageFloorAtMessage 完成
          const result =
            await runtime.messageTranscriptEffects.setMessageFloorAtMessage(
              projectId,
              sessionId,
              messageId,
            );
          await reloadMessages(true);
          bumpWorktreeUiToken();
          void refreshChatTokenLabel();
          await refreshComposerStatusAfterSessionKkvCleared(runtime, {
            projectId,
            sessionId,
          });
          const changed = result.hiddenCount + result.shownCount;
          showToast(changed > 0 ? '已置位' : '上下文已是最新状态');
        } catch (error) {
          showToast(toastMessage('置位失败', error));
        }
      };

      Alert.alert(
        '置位到此消息？',
        '此消息之前将不参与提示词，此消息及之后将恢复可见。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '置位',
            onPress: () => {
              void runSetFloor();
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
      bumpWorktreeUiToken,
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
        // T-TX2：编辑回填仅正文（含 `@路径`）+ 现有状态投影；无文件引用 chip
        if (sessionId != null) {
          const prev = readChatComposerDraftState(sessionId);
          const statusOnly = (prev.attachments ?? []).filter(
            a => a.source === 'workplace' || a.source === 'user_ops',
          );
          writeChatComposerDraftState(
            sessionId,
            {
              text: initial,
              attachments: statusOnly,
            },
            runtime.sessions,
          );
          setDraftRestoreToken(t => t + 1);
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
      } else if (action === 'set-floor') {
        handleSetFloorFromMessage(target.id);
      } else if (action === 'rollback') {
        handleRollbackFromMessage(target.id);
      }
    },
    [
      handleForkFromMessage,
      handleSetFloorFromMessage,
      handleRollbackFromMessage,
      sessionId,
      setDraftRestoreToken,
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
    handleCompactSession,
    handleMessageMenuAction,
    handleSaveMessageEdit,
  };
}
