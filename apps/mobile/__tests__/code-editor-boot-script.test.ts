/**
 * code-editor 契约测 — 读 webview-dist 产物（pretest 已 build:webview）。
 */
import { readWebViewDistFile } from './helpers/read-webview-dist';

function bootScript(): string {
  return readWebViewDistFile('code-editor', 'app.js');
}

function indexHtml(): string {
  return readWebViewDistFile('code-editor', 'index.html');
}

function appCss(): string {
  return readWebViewDistFile('code-editor', 'app.css');
}

describe('code-editor WebView boot (dist)', () => {
  it('T-CE-ASM-01: script parses', () => {
    const script = bootScript();
    expect(() => {
      // eslint-disable-next-line no-new-func -- 语法守护
      new Function(script);
    }).not.toThrow();
  });

  it('T-CE-ASM-02: shell has #root; relative app.js/app.css', () => {
    const html = indexHtml();
    expect(html).toContain('id="root"');
    expect(html).toContain('./app.js');
    expect(html).toContain('./app.css');
    expect(html).toContain('<script src="./app.js"');
    expect(html).not.toContain('type="module"');
  });

  it('T-CE-BR-01: init / setDocument / themeUpdate / blur; emits ready/change', () => {
    const script = bootScript();
    expect(script).toContain('handleHostMessage');
    expect(script).toContain('msg.type === "init"');
    expect(script).toContain('setDocument');
    expect(script).toContain('themeUpdate');
    expect(script).toContain('blurEditor');
    expect(script).toContain('post("ready"');
    expect(script).toContain('post("change"');
  });

  it('T-CE-CSS-01: editor shell CSS for full height + touch scroll', () => {
    const css = appCss();
    expect(css).toContain('height: 100%');
    expect(css).toContain('-webkit-overflow-scrolling: touch');
    expect(css).toContain('.cm-scroller');
  });
});
