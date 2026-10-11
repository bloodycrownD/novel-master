import {readWebViewDistFile} from './helpers/read-webview-dist';

/**
 * 转录富文本样式的 dist 契约。
 *
 * composer-native-2026-10 Step 6 起 chat-conversation 合成包退役，转录样式
 * 唯一落地面是 chat-transcript 独立包的 app.css（transcript.css 基底 + 注入）。
 */
describe('chat transcript rich styles (dist app.css)', () => {
  it('indents lists inside rich bubbles so markers stay in bounds', () => {
    const css = readWebViewDistFile('chat-transcript', 'app.css');
    expect(css).toContain('.bubble.rich ol');
    expect(css).toContain('.bubble.rich ul');
    expect(css).toContain('padding-left: 1.5em');
    expect(css).toContain('outside markers stay inside the content area');
  });
});
