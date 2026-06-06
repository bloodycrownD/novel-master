import {
  CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
  type ChatTranscriptScrollSnapshot,
} from '../src/components/chat/ChatTranscriptBridge';
import {
  clearAllTranscriptScrollSnapshots,
  getTranscriptScrollSnapshot,
  normalizeScrollSnapshot,
  setTranscriptScrollSnapshot,
} from '../src/services/chat-transcript-scroll-cache';

describe('chat-transcript-scroll-cache', () => {
  beforeEach(() => {
    clearAllTranscriptScrollSnapshots();
  });

  it('rejects legacy v1 snapshots without schemaVersion', () => {
    const legacy = {offsetY: 40, nearBottom: false};
    expect(normalizeScrollSnapshot(legacy)).toEqual({discardedLegacy: true});
    expect(getTranscriptScrollSnapshot('p:s')).toBeUndefined();
  });

  it('accepts and stores v2 snapshots', () => {
    const snap: ChatTranscriptScrollSnapshot = {
      schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
      offsetY: 12,
      nearBottom: true,
    };
    const normalized = normalizeScrollSnapshot(snap);
    expect(normalized).toEqual({snapshot: snap, discardedLegacy: false});
    setTranscriptScrollSnapshot('p1:s1', snap);
    expect(getTranscriptScrollSnapshot('p1:s1')).toEqual(snap);
  });

  it('ignores writes with wrong schemaVersion', () => {
    setTranscriptScrollSnapshot('p1:s1', {
      schemaVersion: 99 as typeof CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
      offsetY: 0,
      nearBottom: true,
    });
    expect(getTranscriptScrollSnapshot('p1:s1')).toBeUndefined();
  });
});
