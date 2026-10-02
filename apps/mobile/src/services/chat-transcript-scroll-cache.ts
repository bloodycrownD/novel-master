/**
 * WebView transcript scroll snapshots (schema v2, forward DOM semantics).
 * v1 inverted FlatList snapshots are discarded on read.
 */
import {createScopeKeyCache} from './scope-key-cache';

/** Transcript → host 滚动快照 schema（v2，前向 DOM 语义）。 */
export const CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION = 2 as const;

export type ChatTranscriptScrollSnapshot = {
  readonly schemaVersion: typeof CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION;
  /** Distance from visual bottom, px (forward DOM scrollTop semantics). */
  readonly offsetY: number;
  readonly nearBottom: boolean;
};

/** @deprecated v1 inverted list snapshot — rejected by transcript cache. */
export type LegacyChatListScrollSnapshot = {
  readonly offsetY: number;
  readonly nearBottom: boolean;
};

const cache = createScopeKeyCache<ChatTranscriptScrollSnapshot>({
  maxEntries: 500,
});

export function scrollCacheKey(projectId: string, sessionId: string): string {
  return cache.key(projectId, sessionId);
}

export function getTranscriptScrollSnapshot(
  key: string,
): ChatTranscriptScrollSnapshot | undefined {
  return cache.get(key);
}

export function setTranscriptScrollSnapshot(
  key: string,
  snap: ChatTranscriptScrollSnapshot,
): void {
  if (snap.schemaVersion !== CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION) {
    return;
  }
  cache.set(key, snap);
}

export function clearTranscriptScrollSnapshot(key: string): void {
  cache.clear(key);
}

/** 项目删除后按前缀清理其全部会话快照。 */
export function clearTranscriptScrollSnapshotsByProject(
  projectId: string,
): void {
  cache.clearByProjectPrefix(projectId);
}

/**
 * v2-only 读闸门：v1（无 `schemaVersion`）一律返回 undefined。
 *
 * 写入侧（`setTranscriptScrollSnapshot`）已按 schemaVersion 拦过一次，这里挡的是
 * 「缓存被别处污染」的兜底。Step 8 退役 legacy 转录引擎后，读侧不再有 v1 回落
 * （v1 的唯一写入者 `MessageList` 已删），故返回值就是快照本身——原先配套的
 * `discardedLegacy` 标志与 `legacy_cache_discarded` 遥测一并退场。
 */
export function normalizeScrollSnapshot(
  snap: LegacyChatListScrollSnapshot | ChatTranscriptScrollSnapshot | undefined,
): ChatTranscriptScrollSnapshot | undefined {
  if (snap == null) {
    return undefined;
  }
  if (
    'schemaVersion' in snap &&
    snap.schemaVersion === CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION
  ) {
    return snap;
  }
  return undefined;
}

/** Test-only: reset process-wide cache between cases. */
export function clearAllTranscriptScrollSnapshots(): void {
  cache.clearAll();
}

/** Test-only: entry count for LRU-bound assertions. */
export function transcriptScrollSnapshotCacheSize(): number {
  return cache.size;
}
