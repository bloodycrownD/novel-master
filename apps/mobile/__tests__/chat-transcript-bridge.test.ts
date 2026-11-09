import {CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION} from '@/components/chat/ChatTranscriptBridge';
import {CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION as SOURCE_SCHEMA_VERSION} from '@/services/chat-transcript-scroll-cache';

describe('chat-transcript-bridge', () => {
  it('re-exports the scroll snapshot schema version from the cache module', () => {
    expect(CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION).toBe(SOURCE_SCHEMA_VERSION);
  });
});
