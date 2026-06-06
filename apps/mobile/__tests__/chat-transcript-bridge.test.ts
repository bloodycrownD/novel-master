import {
  CHAT_TRANSCRIPT_BRIDGE_VERSION,
  CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
  decodeHostToTranscript,
  decodeTranscriptToHost,
  encodeHostToTranscript,
  encodeTranscriptToHost,
  parseScrollSnapshotFromHost,
} from '../src/components/chat/ChatTranscriptBridge';

describe('chat-transcript-bridge', () => {
  it('round-trips RN→Web sessionSnapshot envelope', () => {
    const message = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'sessionSnapshot' as const,
      payload: {
        sessionKey: 'p1:s1',
        rows: [
          {
            kind: 'message' as const,
            id: 'm1',
            role: 'user' as const,
            hidden: false,
            text: 'hello',
            thinking: '',
          },
        ],
        hasMore: false,
        stream: {text: '', thinking: ''},
      },
    };
    const raw = encodeHostToTranscript(message);
    const parsed = decodeHostToTranscript(raw);
    expect(parsed).toEqual(message);
  });

  it('round-trips Web→RN scrollSnapshot v2 envelope', () => {
    const message = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'scrollSnapshot' as const,
      payload: {
        schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
        offsetY: 12,
        nearBottom: true,
        scrollHeight: 400,
        clientHeight: 300,
      },
    };
    const raw = encodeTranscriptToHost(message);
    const parsed = decodeTranscriptToHost(raw);
    expect(parsed).toEqual(message);
    expect(parseScrollSnapshotFromHost(parsed)).toEqual({
      schemaVersion: CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
      offsetY: 12,
      nearBottom: true,
    });
  });

  it('rejects invalid bridge version', () => {
    expect(() =>
      decodeTranscriptToHost(JSON.stringify({v: 99, type: 'ready', payload: {}})),
    ).toThrow(/version/i);
  });

  it('round-trips streamDelta', () => {
    const message = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'streamDelta' as const,
      payload: {kind: 'text' as const, delta: 'chunk'},
    };
    expect(decodeHostToTranscript(encodeHostToTranscript(message))).toEqual(message);
  });
});
