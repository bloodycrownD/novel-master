import { CHAT_TRANSCRIPT_HTML } from '../src/web/chat-transcript/transcript-html';

describe('chat transcript rich styles', () => {
  it('indents lists inside rich bubbles so markers stay in bounds', () => {
    expect(CHAT_TRANSCRIPT_HTML).toContain('.bubble.rich ol');
    expect(CHAT_TRANSCRIPT_HTML).toContain('.bubble.rich ul');
    expect(CHAT_TRANSCRIPT_HTML).toContain('padding-left: 1.5em');
    expect(CHAT_TRANSCRIPT_HTML).toContain(
      'outside markers stay inside the content area',
    );
  });
});
