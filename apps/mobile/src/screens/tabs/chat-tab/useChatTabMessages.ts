/**
 * Chat tab message list state: tail load, cache, and older-message paging.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import { type ChatMessage } from '@novel-master/core/chat';

import {
  deriveComposerSendState,
  findLastVisibleMessage,
} from '@/components/chat/composer-send-state';
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
  /** 详情页压缩等外部动作触发 session-transcript-changed 后，reload 完调一下，让上层刷新 token 计数。 */
  onAfterExternalReload?: () => void;
};

export function useChatTabMessages({
  runtime,
  projectId,
  sessionId,
  chatSubview,
  onAfterExternalReload,
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

  // 详情页压缩/置位后 DB 消息 hidden 已变，但聊天页 chatMessages state 不会自动刷新。
  // 监听 session-transcript-changed 事件，命中当前 session 时强制 reload + 刷新 token 计数。
  useEffect(() => {
    if (sessionId == null) {
      return;
    }
    const sub = DeviceEventEmitter.addListener('session-transcript-changed', (e?: { sessionId?: string }) => {
      if (e?.sessionId === sessionId) {
        reloadMessages(true)
          .then(() => {
            onAfterExternalReload?.();
          })
          .catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, [sessionId, reloadMessages, onAfterExternalReload]);

  return {
    chatMessages,
    setChatMessages,
    hasMoreMessages,
    setHasMoreMessages,
    loadingMoreMessages,
    canResumeWithoutInput,
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
