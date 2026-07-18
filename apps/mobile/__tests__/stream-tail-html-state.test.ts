import {nextStreamTailHtmlField} from '../src/webview-host/chat-transcript/stream-tail-html-state';

describe('stream-tail-html-state', () => {
  it('keeps incoming html when present', () => {
    expect(nextStreamTailHtmlField(true, '<strong>x</strong>')).toBe('<strong>x</strong>');
  });

  it('clears html when rich on but RN omitted html (limit exceeded)', () => {
    expect(nextStreamTailHtmlField(true, undefined)).toBe('');
    expect(nextStreamTailHtmlField(true, '')).toBe('');
  });

  it('leaves field unchanged when rich text is off', () => {
    expect(nextStreamTailHtmlField(false, undefined)).toBeNull();
    expect(nextStreamTailHtmlField(false, '')).toBeNull();
  });
});
