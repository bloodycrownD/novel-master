/**
 * b2/B-6：scope 缓存模块统一启用 LRU 上限（500）。
 * 插入超过上限后 size 封顶，最旧条目被淘汰。
 *
 * r6-C3 起 v1 `chat-list-scroll-cache` 的读写面已删除（快照本体只在 v2），
 * LRU 上限由共用的 `createScopeKeyCache` 承担，故本文件只覆盖仍有生产读写的
 * v2 transcript 缓存与 session view 缓存。
 */
import {CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION} from '@/components/chat/ChatTranscriptBridge';
import {
  clearAllTranscriptScrollSnapshots,
  scrollCacheKey as transcriptKey,
  setTranscriptScrollSnapshot,
  transcriptScrollSnapshotCacheSize,
} from '@/services/chat-transcript-scroll-cache';
import {
  clearAllSessionViewCaches,
  getSessionViewCache,
  sessionViewCacheKey,
  sessionViewCacheSize,
  setSessionViewCache,
} from '@/services/chat-session-view-cache';

const CAP = 500;

describe('scope 缓存 LRU 上限启用', () => {
  beforeEach(() => {
    clearAllTranscriptScrollSnapshots();
    clearAllSessionViewCaches();
  });

  it('chat-transcript-scroll-cache：插入超限后 size 封顶', () => {
    for (let i = 0; i <= CAP; i++) {
      setTranscriptScrollSnapshot(transcriptKey('p', `s${i}`), {
        schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
        offsetY: i,
        nearBottom: false,
      });
    }
    expect(transcriptScrollSnapshotCacheSize()).toBe(CAP);
  });

  it('chat-session-view-cache：插入超限后 size 封顶且最旧淘汰', () => {
    const firstKey = sessionViewCacheKey('p', 's0');
    for (let i = 0; i <= CAP; i++) {
      setSessionViewCache(sessionViewCacheKey('p', `s${i}`), {
        messages: [],
        hasMoreMessages: false,
      });
    }
    expect(sessionViewCacheSize()).toBe(CAP);
    expect(getSessionViewCache(firstKey)).toBeUndefined();
  });
});
