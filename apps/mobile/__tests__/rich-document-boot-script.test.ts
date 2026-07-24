/**
 * T-BB-07：rich-document 契约测迁移矩阵 — 读 webview-dist 产物（pretest 已 build:webview）。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {readWebViewDistFile} from './helpers/read-webview-dist';

function bootScript(): string {
  return readWebViewDistFile('rich-document', 'app.js');
}

function indexHtml(): string {
  return readWebViewDistFile('rich-document', 'index.html');
}

function appCss(): string {
  return readWebViewDistFile('rich-document', 'app.css');
}

describe('rich-document WebView boot (T-BB-07 / dist)', () => {
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
    expect(html).toContain('<script src="./app.js"');
    expect(html).not.toContain('type="module"');
    expect(html).not.toContain('https://novel-master.local/');
  });

  it('T-BR-RD-01: setDocument / themeUpdate / annotate; no chat menu handlers', () => {
    const script = bootScript();
    expect(script).toContain('setDocument');
    expect(script).toContain('msg.type === "setDocument"');
    expect(script).toContain('handleHostMessage');
    expect(script).toContain('themeUpdate');
    expect(script).toContain('setAnnotateEnabled');
    expect(script).toContain('setAnnotations');
    expect(script).toContain('annotateOpen');
    expect(script).toContain('annotatingEnabled: false');
    expect(script).toContain('__nmCollectRecogitoSelection');
    // 旧 mark / selectionCollect 生产不挂载
    expect(script).not.toContain('applyAnnotateMarks');
    expect(script).not.toContain('__nmCollectAnnotateSelection');
    // 「添加批注」由 RN menuItems 负责，Web 侧不再发 selectionAnnotate / 不叠 DOM 浮动条
    expect(script).not.toContain('selectionAnnotate');
    expect(script).not.toContain('annotate-bar');
    expect(script).not.toContain('menuOverlayHandler');
    expect(script).not.toContain('openMessageMenu');
  });

  it('T-BR-RD-02: over-limit / frontMatter / TrustedHtml（三列矩阵）', () => {
    const script = bootScript();
    expect(script).toContain('over-limit-hint');
    expect(script).toContain('frontMatterHtml');
    // esbuild IIFE 将中文常量化为 \uXXXX
    expect(script).toContain('OVER_LIMIT_HINT');
    expect(script).toMatch(/\\u5185\\u5BB9\\u8FC7\\u957F/);
    // token：doc-body / rich / TrustedHtml；装配：registerSetDocumentView
    expect(script).toContain('doc-body');
    expect(script).toContain('TrustedHtml');
    expect(script).toContain('registerSetDocumentView');
    // 允许删除：手拼 doc-body 整段（已迁 DocumentApp + TrustedHtml）
    expect(script).not.toContain("'<div class=\"doc-body rich\">'+");
  });

  it('T-BR-CSS-02: rich list padding；旧 annotate CSS 标为非主路径遗留', () => {
    const css = appCss();
    expect(css).toContain('padding-left: 1.5em');
    expect(css).toContain('list-style-position: outside');
    expect(css).toContain('#doc .doc-body.rich');
    // 非主路径遗留 class 仍可能出现在产物 CSS；主路径用 Recogito
    expect(css).toContain('annotate-mark');
    expect(css).not.toContain('annotate-bar');
  });

  it('T-SA6: document.css 含非主路径遗留 nm-annotate-anchor 注释块', () => {
    const src = readFileSync(
      join(__dirname, '../src/web/rich-document/styles/document.css'),
      'utf8',
    );
    expect(src).toContain('.nm-annotate-anchor');
    expect(src).toMatch(/非主路径遗留/);
  });
});
