/**
 * 视图缓存（view cache）读写 + 命中水合窗口化。
 *
 * 两个 describe：
 * - hydrateWindowFromCache：纯函数口径（不超窗原样 / 超窗只取尾部一页）；
 * - 采纳点（单元路径）：窗口化只在**冷启动**（消息面为空）时发生。已有消息
 *   面是用户自己翻出来的浏览史，采纳点必须整面收下——否则翻到 200 条的转录
 *   会在重进/切会话当场塌回一屏，并触发一次全量快照重渲。
 */
import {describe, expect, it, beforeEach} from '@jest/globals';
import {type ChatMessage} from '@novel-master/core/chat';
import {
  clearAllSessionViewCaches,
  getSessionViewCache,
  hydrateWindowFromCache,
  SESSION_VIEW_HYDRATE_WINDOW,
  sessionViewCacheKey,
  setSessionViewCache,
} from '@/services/chat-session-view-cache';
import {SessionStreamUnit} from '@/services/session-stream-unit';

function sampleMessage(id: string): ChatMessage {
  return {
    id,
    sessionId: 's1',
    seq: 1,
    role: 'user',
    content: {blocks: [{type: 'text', text: 'hi'}]},
    provider: null,
    raw: null,
    createdAtMs: 1,
    hidden: false,
  };
}

describe('chat-session-view-cache', () => {
  beforeEach(() => {
    clearAllSessionViewCaches();
  });

  it('stores and retrieves messages per session key', () => {
    const key = sessionViewCacheKey('p1', 's1');
    const messages = [sampleMessage('m1')];
    setSessionViewCache(key, {messages, hasMoreMessages: true});
    const cached = getSessionViewCache(key);
    expect(cached?.messages).toHaveLength(1);
    expect(cached?.hasMoreMessages).toBe(true);
  });

  describe('hydrateWindowFromCache（水合窗口裁剪）', () => {
    function seqMessages(n: number): ChatMessage[] {
      return Array.from({length: n}, (_, i) => ({
        ...sampleMessage(`m${i}`),
        seq: i + 1,
      }));
    }

    it('缓存不超窗：原样采纳（hasMore 不翻真）', () => {
      const entry = {
        messages: seqMessages(SESSION_VIEW_HYDRATE_WINDOW),
        hasMoreMessages: false,
      };
      expect(hydrateWindowFromCache(entry)).toBe(entry);
    });

    it('浏览史超窗：只取尾部一页，hasMore 置真（窗口外还有，向上翻照常补）', () => {
      const windowed = hydrateWindowFromCache({
        messages: seqMessages(SESSION_VIEW_HYDRATE_WINDOW * 3),
        hasMoreMessages: false,
      });
      expect(windowed.messages).toHaveLength(SESSION_VIEW_HYDRATE_WINDOW);
      // 尾部窗口：首行是第 (2*W+1) 条（浏览史全量 3W 条的尾部）
      expect(windowed.messages[0]!.seq).toBe(
        SESSION_VIEW_HYDRATE_WINDOW * 2 + 1,
      );
      expect(windowed.hasMoreMessages).toBe(true);
    });
  });

  describe('采纳点（单元路径的缓存水合）', () => {
    /**
     * 裸单元（不经 manager）：本组只关心消息面三件套
     * （loadTailMessages/loadOlderMessages/snapshot），事件管线无关。
     * 仓库是内存型的（tail = 尾部 N 条、page = beforeSeq 之前的尾部 N 条，
     * 与 core 口径一致）。
     */
    function makeUnit(db: ChatMessage[]): {
      readonly unit: SessionStreamUnit;
      readonly tailCalls: () => number;
    } {
      let tailCalls = 0;
      const unit = new SessionStreamUnit({
        sessionId: 's1',
        projectId: 'p1',
        messageStore: {
          listBySessionTail: async (_sid, options) => {
            tailCalls += 1;
            return db.slice(-options.limit);
          },
          listBySessionPage: async (_sid, options) => {
            const filtered =
              options.beforeSeq == null
                ? db
                : db.filter(row => row.seq < options.beforeSeq);
            return filtered.slice(-options.limit);
          },
        },
      });
      return {unit, tailCalls: () => tailCalls};
    }

    function seqMessages(n: number): ChatMessage[] {
      return Array.from({length: n}, (_, i) => ({
        ...sampleMessage(`s1-m${i}`),
        seq: i + 1,
      }));
    }

    it('冷启动（消息面空）+ 缓存 3 页：只采纳尾部一屏，hasMore 置真', async () => {
      setSessionViewCache(sessionViewCacheKey('p1', 's1'), {
        messages: seqMessages(SESSION_VIEW_HYDRATE_WINDOW * 3),
        hasMoreMessages: false,
      });
      const {unit, tailCalls} = makeUnit(seqMessages(0));

      const rows = await unit.loadTailMessages();

      // 采纳 40 条（尾部一屏），不是整面 120 条；缓存命中不回源 DB
      expect(rows).toHaveLength(SESSION_VIEW_HYDRATE_WINDOW);
      const snap = unit.snapshot();
      expect(snap.messages).toHaveLength(SESSION_VIEW_HYDRATE_WINDOW);
      expect(snap.messages[0]!.seq).toBe(SESSION_VIEW_HYDRATE_WINDOW * 2 + 1);
      expect(snap.hasMoreMessages).toBe(true);
      expect(tailCalls()).toBe(0);
    });

    it('消息面非空：缓存水合整面采纳，不再裁回一屏（cr2-E-1）', async () => {
      const {unit, tailCalls} = makeUnit(seqMessages(0));
      // 先水合一次铺出非空消息面
      setSessionViewCache(sessionViewCacheKey('p1', 's1'), {
        messages: seqMessages(SESSION_VIEW_HYDRATE_WINDOW),
        hasMoreMessages: false,
      });
      await unit.loadTailMessages();
      expect(unit.snapshot().messages).toHaveLength(
        SESSION_VIEW_HYDRATE_WINDOW,
      );

      // 缓存里是一整面浏览史（loadOlder 的写回形态）：面已非空 → 整面收下
      const full = seqMessages(SESSION_VIEW_HYDRATE_WINDOW * 3);
      setSessionViewCache(sessionViewCacheKey('p1', 's1'), {
        messages: full,
        hasMoreMessages: false,
      });
      const rows = await unit.loadTailMessages();

      expect(rows).toHaveLength(full.length);
      const snap = unit.snapshot();
      expect(snap.messages).toHaveLength(full.length);
      expect(snap.messages[0]!.seq).toBe(1);
      expect(snap.hasMoreMessages).toBe(false);
      expect(tailCalls()).toBe(0);
    });
  });
});
