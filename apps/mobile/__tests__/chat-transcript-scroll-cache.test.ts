import {
    CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
    type ChatTranscriptScrollSnapshot,
} from '@/components/chat/ChatTranscriptBridge';
import {ChatTranscriptScrollCache} from '@/services/chat-transcript-scroll-cache';

describe('chat-transcript-scroll-cache', () => {
    beforeEach(() => {
        ChatTranscriptScrollCache.clearAll();
    });

    it('rejects legacy v1 snapshots without schemaVersion', () => {
        const legacy = {offsetY: 40, nearBottom: false};
        expect(ChatTranscriptScrollCache.normalize(legacy)).toBeUndefined();
        expect(ChatTranscriptScrollCache.get('p:s')).toBeUndefined();
    });

    it('accepts and stores v2 snapshots', () => {
        const snap: ChatTranscriptScrollSnapshot = {
            schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
            offsetY: 12,
            nearBottom: true,
        };
        expect(ChatTranscriptScrollCache.normalize(snap)).toEqual(snap);
        ChatTranscriptScrollCache.set('p1:s1', snap);
        expect(ChatTranscriptScrollCache.get('p1:s1')).toEqual(snap);
    });

    it('ignores writes with wrong schemaVersion', () => {
        ChatTranscriptScrollCache.set('p1:s1', {
            schemaVersion: 99 as typeof CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
            offsetY: 0,
            nearBottom: true,
        });
        expect(ChatTranscriptScrollCache.get('p1:s1')).toBeUndefined();
    });
});
