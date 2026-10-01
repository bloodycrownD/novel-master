/**
 * v1 chat list scroll cache 的 key 命名空间与「按项目清理」入口。
 *
 * 历史上这里还存着 legacy RN FlatList 的滚动快照（offsetY 是「距底部距离」），
 * 但 v1 的唯一写入者 `MessageList` 已随 chat-webview-unify Step 8 退役删除，
 * 读写面（`getScrollSnapshot` / `setScrollSnapshot` / `clearScrollSnapshot`）
 * 全部悬空，r6-C3 起删除。**快照本体只在 `chat-transcript-scroll-cache`
 * （v2，前向 DOM 语义）里**，读写一律走 v2；这里剩下的只有 key 命名空间
 * （`useChatTabStream` 仍在用）与按项目清理（v2 侧由
 * `clearTranscriptScrollSnapshotsByProject` 独立清理）。
 */
import {createScopeKeyCache} from './scope-key-cache';

export type ChatListScrollSnapshot = {
  readonly offsetY: number;
  readonly nearBottom: boolean;
};

const cache = createScopeKeyCache<ChatListScrollSnapshot>({maxEntries: 500});

export function scrollCacheKey(projectId: string, sessionId: string): string {
  return cache.key(projectId, sessionId);
}

/** 项目删除后按前缀清理其全部会话快照。 */
export function clearScrollSnapshotsByProject(projectId: string): void {
  cache.clearByProjectPrefix(projectId);
}

/** Test-only: reset process-wide cache between cases. */
export function clearAllScrollSnapshots(): void {
  cache.clearAll();
}

/** Test-only: entry count for LRU-bound assertions. */
export function scrollSnapshotCacheSize(): number {
  return cache.size;
}
