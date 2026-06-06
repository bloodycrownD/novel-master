/**
 * WebView transcript scroll snapshots (schema v2, forward DOM semantics).
 * v1 inverted FlatList snapshots are discarded on read.
 */
import {
  CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
  type ChatTranscriptScrollSnapshot,
} from '../components/chat/ChatTranscriptBridge';

export type {ChatTranscriptScrollSnapshot};

/** @deprecated v1 inverted list snapshot — rejected by transcript cache. */
export type LegacyChatListScrollSnapshot = {
  readonly offsetY: number;
  readonly nearBottom: boolean;
};

const cache = new Map<string, ChatTranscriptScrollSnapshot>();

export function scrollCacheKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
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
  cache.delete(key);
}

/** Accept v2 only; legacy v1 (no schemaVersion) returns undefined and emits discard signal. */
export function normalizeScrollSnapshot(
  snap: LegacyChatListScrollSnapshot | ChatTranscriptScrollSnapshot | undefined,
): {snapshot?: ChatTranscriptScrollSnapshot; discardedLegacy: boolean} {
  if (snap == null) {
    return {discardedLegacy: false};
  }
  if (
    'schemaVersion' in snap &&
    snap.schemaVersion === CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION
  ) {
    return {snapshot: snap, discardedLegacy: false};
  }
  return {discardedLegacy: true};
}

/** Test-only: reset process-wide cache between cases. */
export function clearAllTranscriptScrollSnapshots(): void {
  cache.clear();
}
