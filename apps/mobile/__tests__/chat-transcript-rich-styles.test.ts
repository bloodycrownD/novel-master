import {readWebViewDistFile} from './helpers/read-webview-dist';

/**
 * 转录富文本样式的 dist 契约。
 *
 * transcript-converge 后转录不再有独立的 chat-transcript 包产物（转录并入
 * chat-conversation 合成包），故样式断言改读合成包的 app.css——那是转录样式
 * 唯一真正落地的构建产物（构建期 join transcript.css + chat-conversation.css）。
 */
describe('chat transcript rich styles (dist app.css)', () => {
  it('indents lists inside rich bubbles so markers stay in bounds', () => {
    const css = readWebViewDistFile('chat-conversation', 'app.css');
    expect(css).toContain('.bubble.rich ol');
    expect(css).toContain('.bubble.rich ul');
    expect(css).toContain('padding-left: 1.5em');
    expect(css).toContain('outside markers stay inside the content area');
  });
});
