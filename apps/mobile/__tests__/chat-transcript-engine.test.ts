import {
  defaultChatTranscriptEngine,
  readChatTranscriptEngine,
} from '../src/storage/chat-transcript-engine';

describe('chat-transcript-engine', () => {
  it('defaults to webview in all builds', () => {
    expect(defaultChatTranscriptEngine()).toBe('webview');
  });

  it('honors KKV override to legacy-rn', async () => {
    const appUi = {
      get: jest.fn(async () => 'legacy-rn'),
    };
    expect(await readChatTranscriptEngine(appUi as never)).toBe('legacy-rn');
  });

  it('falls back to webview when KKV unset', async () => {
    const appUi = {
      get: jest.fn(async () => undefined),
    };
    expect(await readChatTranscriptEngine(appUi as never)).toBe('webview');
  });
});
