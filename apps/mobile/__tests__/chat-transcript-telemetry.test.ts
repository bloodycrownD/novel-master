import {
  CHAT_TRANSCRIPT_TELEMETRY_ENABLED,
  emitChatTranscriptTelemetry,
} from '../src/services/chat-transcript-telemetry';

describe('chat-transcript-telemetry', () => {
  const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);

  afterEach(() => {
    infoSpy.mockClear();
  });

  afterAll(() => {
    infoSpy.mockRestore();
  });

  it('emits structured log when enabled', () => {
    if (!CHAT_TRANSCRIPT_TELEMETRY_ENABLED) {
      emitChatTranscriptTelemetry({
        name: 'transcript_ready',
        sessionKey: 'p:s',
        rowCount: 3,
        hasInitialScroll: false,
        defaultScrollToBottom: true,
      });
      expect(infoSpy).not.toHaveBeenCalled();
      return;
    }
    emitChatTranscriptTelemetry({
      name: 'scroll_restore',
      mode: 'offset',
      offsetY: 120,
      nearBottom: false,
    });
    expect(infoSpy).toHaveBeenCalledWith(
      '[ChatTranscriptTelemetry]',
      'scroll_restore',
      expect.objectContaining({mode: 'offset', offsetY: 120}),
    );
  });

  it('logs legacy_cache_discarded with wrong_version reason', () => {
    if (!CHAT_TRANSCRIPT_TELEMETRY_ENABLED) {
      return;
    }
    emitChatTranscriptTelemetry({
      name: 'legacy_cache_discarded',
      reason: 'wrong_version',
    });
    expect(infoSpy).toHaveBeenCalledWith(
      '[ChatTranscriptTelemetry]',
      'legacy_cache_discarded',
      expect.objectContaining({reason: 'wrong_version'}),
    );
  });

  it('logs menu_open event', () => {
    if (!CHAT_TRANSCRIPT_TELEMETRY_ENABLED) {
      emitChatTranscriptTelemetry({name: 'menu_open'});
      expect(infoSpy).not.toHaveBeenCalled();
      return;
    }
    emitChatTranscriptTelemetry({name: 'menu_open'});
    expect(infoSpy).toHaveBeenCalledWith(
      '[ChatTranscriptTelemetry]',
      'menu_open',
      expect.objectContaining({name: 'menu_open'}),
    );
  });
});
