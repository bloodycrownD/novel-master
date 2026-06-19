import {CHAT_TRANSCRIPT_HTML} from '../src/web/chat-transcript/transcript-html';

describe('chat transcript rich styles', () => {
  it('indents lists inside rich bubbles so markers stay in bounds', () => {
    expect(CHAT_TRANSCRIPT_HTML).toContain('.bubble.rich ol');
    expect(CHAT_TRANSCRIPT_HTML).toContain('.bubble.rich ul');
    expect(CHAT_TRANSCRIPT_HTML).toContain('padding-left: 1.5em');
    expect(CHAT_TRANSCRIPT_HTML).toContain('outside markers stay inside the content area');
  });

  it('uses compact 20px batch-check in batch mode', () => {
    expect(CHAT_TRANSCRIPT_HTML).toContain('.batch-check');
    expect(CHAT_TRANSCRIPT_HTML).toContain('width: 20px');
    expect(CHAT_TRANSCRIPT_HTML).toContain('height: 20px');
  });
});
