import {describe, expect, it, beforeEach} from '@jest/globals';
import type {ChatMessage} from '@novel-master/core';
import {
  clearAllSessionViewCaches,
  getSessionViewCache,
  sessionViewCacheKey,
  setSessionViewCache,
} from '../src/services/chat-session-view-cache';

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
});
