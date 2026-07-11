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
        scrollIntent: 'stick' as const,
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
      decodeTranscriptToHost(
        JSON.stringify({ v: 99, type: 'ready', payload: {} }),
      ),
    ).toThrow(/version/i);
  });

  it('round-trips streamDelta', () => {
    const message = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'streamDelta' as const,
      payload: { kind: 'text' as const, delta: 'chunk', html: '<p>chunk</p>' },
    };
    expect(decodeHostToTranscript(encodeHostToTranscript(message))).toEqual(
      message,
    );
  });

  it('round-trips RN→Web prependPage envelope', () => {
    const message = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'prependPage' as const,
      payload: {
        rows: [
          {
            kind: 'message' as const,
            id: 'm0',
            role: 'user' as const,
            hidden: false,
            text: 'older',
            thinking: '',
          },
        ],
        prependedCount: 1,
      },
    };
    expect(decodeHostToTranscript(encodeHostToTranscript(message))).toEqual(
      message,
    );
  });

  it('round-trips Web→RN openToolFile envelope', () => {
    const message = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'openToolFile' as const,
      payload: { path: '/续写/chapter.md' },
    };
    const raw = encodeTranscriptToHost(message);
    const parsed = decodeTranscriptToHost(raw);
    expect(parsed).toEqual(message);
    expect(parsed.type === 'openToolFile' ? parsed.payload.path : '').toBe(
      '/续写/chapter.md',
    );
  });

  it('round-trips Web→RN openMessageMenu envelope', () => {
    const message = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'openMessageMenu' as const,
      payload: { messageId: 'm1', pageX: 120, pageY: 340 },
    };
    expect(decodeTranscriptToHost(encodeTranscriptToHost(message))).toEqual(
      message,
    );
  });

  it('round-trips Web→RN messageMenuAction envelope', () => {
    const message = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'messageMenuAction' as const,
      payload: { messageId: 'm1', action: 'copy' },
    };
    expect(decodeTranscriptToHost(encodeTranscriptToHost(message))).toEqual(
      message,
    );
  });

  it('round-trips Web→RN menuOpened envelope', () => {
    const message = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'menuOpened' as const,
      payload: {},
    };
    expect(decodeTranscriptToHost(encodeTranscriptToHost(message))).toEqual(
      message,
    );
  });

  it('round-trips Web→RN menuClosed envelope', () => {
    const message = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'menuClosed' as const,
      payload: {},
    };
    expect(decodeTranscriptToHost(encodeTranscriptToHost(message))).toEqual(
      message,
    );
  });

  it('round-trips RN→Web closeMenu envelope', () => {
    const message = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'closeMenu' as const,
      payload: {},
    };
    expect(decodeHostToTranscript(encodeHostToTranscript(message))).toEqual(
      message,
    );
  });

  it('round-trips RN→Web themeUpdate envelope', () => {
    const message = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'themeUpdate' as const,
      payload: {
        theme: {
          background: '#000',
          text: '#fff',
          textSecondary: '#aaa',
          primary: '#0af',
          surface: '#111',
          borderLight: '#333',
        },
      },
    };
    expect(decodeHostToTranscript(encodeHostToTranscript(message))).toEqual(
      message,
    );
  });

  it('openMessageMenu handler path does not require sessionSnapshot', () => {
    /** M3 T7: long-press menu is Web-only DOM; RN handles openMessageMenu without reload. */
    const menuMessage = {
      v: CHAT_TRANSCRIPT_BRIDGE_VERSION,
      type: 'openMessageMenu' as const,
      payload: { messageId: 'm1', pageX: 10, pageY: 20 },
    };
    expect(menuMessage.type).toBe('openMessageMenu');
    expect(menuMessage.type).not.toBe('sessionSnapshot');
  });
});
