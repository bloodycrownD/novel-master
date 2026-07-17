import { readWebViewDistFile } from './helpers/read-webview-dist';

function bootScript(): string {
  return readWebViewDistFile('rich-document', 'app.js');
}

function indexHtml(): string {
  return readWebViewDistFile('rich-document', 'index.html');
}

function appCss(): string {
  return readWebViewDistFile('rich-document', 'app.css');
}

describe('rich-document WebView boot (T-BR / dist)', () => {
  it('T-BR-ASM-02: script parses', () => {
    const script = bootScript();
    expect(() => {
      // eslint-disable-next-line no-new-func -- 语法守护
      new Function(script);
    }).not.toThrow();
  });

  it('T-BR-ASM-03: shell has #doc; relative app.js/app.css（无 BASE_URL）', () => {
    const html = indexHtml();
    expect(html).toContain('id="doc"');
    expect(html).toContain('./app.js');
    expect(html).toContain('./app.css');
    expect(html).not.toContain('https://novel-master.local/');
  });

  it('T-BR-RD-01: setDocument / themeUpdate; no chat menu handlers', () => {
    const script = bootScript();
    expect(script).toContain('setDocument');
    expect(script).toContain('msg.type === "setDocument"');
    expect(script).toContain('handleHostMessage');
    expect(script).toContain('themeUpdate');
    expect(script).not.toContain('menuOverlayHandler');
    expect(script).not.toContain('openMessageMenu');
  });

  it('T-BR-RD-02: over-limit / frontMatter / doc-body', () => {
    const script = bootScript();
    expect(script).toContain('over-limit-hint');
    expect(script).toContain('frontMatterHtml');
    expect(script).toContain('doc-body');
    // esbuild IIFE 将中文常量化为 \uXXXX
    expect(script).toContain('OVER_LIMIT_HINT');
    expect(script).toMatch(/\\u5185\\u5BB9\\u8FC7\\u957F/);
  });

  it('T-BR-CSS-02: rich list padding in app.css', () => {
    const css = appCss();
    expect(css).toContain('padding-left: 1.5em');
    expect(css).toContain('list-style-position: outside');
    expect(css).toContain('#doc .doc-body.rich');
  });
});
