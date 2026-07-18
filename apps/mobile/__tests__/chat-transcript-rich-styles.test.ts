import { readWebViewDistFile } from './helpers/read-webview-dist';

describe('chat transcript rich styles (dist app.css)', () => {
  it('indents lists inside rich bubbles so markers stay in bounds', () => {
    const css = readWebViewDistFile('chat-transcript', 'app.css');
    expect(css).toContain('.bubble.rich ol');
    expect(css).toContain('.bubble.rich ul');
    expect(css).toContain('padding-left: 1.5em');
    expect(css).toContain(
      'outside markers stay inside the content area',
    );
  });
});
