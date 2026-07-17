import {
  RICH_DOCUMENT_BASE_URL,
  RICH_DOCUMENT_HTML,
} from '../src/web/rich-document/document-html';
import { extractBootScriptFromHtml } from './helpers/extract-webview-boot-script';

function bootScript(): string {
  return extractBootScriptFromHtml(RICH_DOCUMENT_HTML);
}

describe('rich-document WebView boot (T-BR)', () => {
  it('T-BR-ASM-02: script parses', () => {
    const script = bootScript();
    expect(() => {
      // eslint-disable-next-line no-new-func -- 语法守护
      new Function(script);
    }).not.toThrow();
  });

  it('T-BR-ASM-03: shell has #doc; BASE_URL unchanged', () => {
    expect(RICH_DOCUMENT_HTML).toContain('id="doc"');
    expect(RICH_DOCUMENT_BASE_URL).toBe('https://novel-master.local/');
  });

  it('T-BR-RD-01: setDocument / themeUpdate; no chat menu handlers', () => {
    const script = bootScript();
    expect(script).toContain('setDocument');
    expect(script).toContain("msg.type === 'setDocument'");
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
    expect(script).toContain('内容过长，已显示原文');
  });

  it('T-BR-CSS-02: rich list padding in assembled HTML', () => {
    expect(RICH_DOCUMENT_HTML).toContain('padding-left: 1.5em');
    expect(RICH_DOCUMENT_HTML).toContain('list-style-position: outside');
    expect(RICH_DOCUMENT_HTML).toContain('#doc .doc-body.rich');
  });
});
