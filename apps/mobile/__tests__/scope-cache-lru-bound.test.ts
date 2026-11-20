/**
 * b2/B-6：scope 缓存模块统一启用 LRU 上限（500）。
 * 插入超过上限后 size 封顶，最旧条目被淘汰。
 *
 * r6-C3 起 v1 `chat-list-scroll-cache` 的读写面已删除（快照本体只在 v2），
 * LRU 上限由共用的 `createScopeKeyCache` 承担，故本文件只覆盖仍有生产读写的
 * v2 transcript 缓存与 session view 缓存。
 */
import {CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION} from '@/components/chat/ChatTranscriptBridge';
import {ChatTranscriptScrollCache} from '@/services/chat-transcript-scroll-cache';
import {SessionViewCache} from '@/services/chat-session-view-cache';
const transcriptKey = ChatTranscriptScrollCache.key;

const CAP = 500;

describe('scope 缓存 LRU 上限启用', () => {
  beforeEach(() => {
    ChatTranscriptScrollCache.clearAll();
    SessionViewCache.clearAll();
  });

  it('chat-transcript-scroll-cache：插入超限后 size 封顶', () => {
    for (let i = 0; i <= CAP; i++) {
      ChatTranscriptScrollCache.set(transcriptKey('p', `s${i}`), {
        schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
        offsetY: i,
        nearBottom: false,
      });
    }
    expect(ChatTranscriptScrollCache.size()).toBe(CAP);
  });

  it('chat-session-view-cache：插入超限后 size 封顶且最旧淘汰', () => {
    const firstKey = SessionViewCache.key('p', 's0');
    for (let i = 0; i <= CAP; i++) {
      SessionViewCache.set(SessionViewCache.key('p', `s${i}`), {
        messages: [],
        hasMoreMessages: false,
      });
    }
    expect(SessionViewCache.size()).toBe(CAP);
    expect(SessionViewCache.get(firstKey)).toBeUndefined();
  });
});
