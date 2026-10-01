/**
 * Chat tab scroll cache helpers（chat-webview-unify Step 8：legacy 双引擎分流已退役）。
 *
 * 退役前这里做的是「双引擎分流」：按 `useWebviewTranscript` 在
 * `chat-list-scroll-cache`（v1，legacy RN FlatList 语义：offsetY 是「距底部距离」）
 * 与 `chat-transcript-scroll-cache`（v2，WebView 前向 DOM 语义）之间选一边读、
 * 选一边写，读到 v1 时还会发一条 `legacy_cache_discarded` 遥测。
 *
 * Step 8 退役 legacy RN 转录引擎后（Q1，2026-10-01 拍板）：
 * - **只读 v2**——legacy 缓存已无写入方（v1 的唯一写入者是被删的 `MessageList`），
 *   回落读一个永远不会被写入的缓存没有意义；
 * - **只写 v2**——`onScrollSnapshot` 的入参收敛为 v2 快照，版本判别交给
 *   `setTranscriptScrollSnapshot` 自带的 schemaVersion 守卫（写入即校验）；
 * - `legacy_cache_discarded` 遥测分支随之删除：没有「读错版本」这回事了。
 */
import {useCallback} from 'react';
import type {ChatTranscriptScrollSnapshot} from '@/components/chat/ChatTranscriptBridge';
import {scrollCacheKey} from '@/services/chat-list-scroll-cache';
import {
  getTranscriptScrollSnapshot,
  normalizeScrollSnapshot,
  setTranscriptScrollSnapshot,
} from '@/services/chat-transcript-scroll-cache';

export type UseChatTabScrollCacheParams = {
  projectId: string | undefined;
  sessionId: string | undefined;
};

export function useChatTabScrollCache({
  projectId,
  sessionId,
}: UseChatTabScrollCacheParams) {
  const chatScrollKey =
    projectId != null && sessionId != null
      ? scrollCacheKey(projectId, sessionId)
      : null;
  // 唯一读源 = v2 transcript 缓存；normalize 是读侧最后一道 v2-only 闸门
  // （写入侧已按 schemaVersion 拦过一次，这里挡住的是「缓存被别处污染」的兜底）。
  const restoredTranscriptScroll =
    chatScrollKey != null
      ? normalizeScrollSnapshot(getTranscriptScrollSnapshot(chatScrollKey))
      : undefined;

  const defaultChatScrollToBottom =
    chatScrollKey != null && restoredTranscriptScroll == null;

  const handleChatScrollSnapshot = useCallback(
    (snap: ChatTranscriptScrollSnapshot) => {
      if (chatScrollKey == null) {
        return;
      }
      setTranscriptScrollSnapshot(chatScrollKey, snap);
    },
    [chatScrollKey],
  );

  return {
    chatScrollKey,
    restoredTranscriptScroll,
    defaultChatScrollToBottom,
    handleChatScrollSnapshot,
  };
}

export type UseChatTabScrollCacheResult = ReturnType<
  typeof useChatTabScrollCache
>;
