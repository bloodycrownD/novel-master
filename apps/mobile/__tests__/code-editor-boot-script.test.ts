/**
 * code-editor 契约测 — 读 webview-dist 产物（pretest 已 build:webview）。
 */
import {readWebViewDistFile} from './helpers/read-webview-dist';

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
    // 引号风格容忍（prettier singleQuote 后 dist 产物为单引号），只锁 msg.type + init 语义
    expect(script).toMatch(/msg\.type === ['"]init['"]/);
    expect(script).toContain('setDocument');
    expect(script).toContain('themeUpdate');
    expect(script).toContain('blurEditor');
    // esbuild 打包时同名 post 会被去重重命名为 post2 等形态，断言需兼容 postN。
    expect(script).toMatch(/post\d*\(['"]ready['"]/);
    expect(script).toMatch(/post\d*\(['"]change['"]/);
  });

  it('T-CE-CSS-01: editor shell CSS for full height + touch scroll', () => {
    const css = appCss();
    expect(css).toContain('height: 100%');
    expect(css).toContain('-webkit-overflow-scrolling: touch');
    expect(css).toContain('.cm-scroller');
  });

  it('T-CE-CAPSULE-01: composer-token 胶囊链路在产物里（capsule/G-1）', () => {
    const script = bootScript();
    // 胶囊装饰：mark 装饰 + atomicRanges 原子区间（退格整段删、方向键跳过）
    expect(script).toContain('cm-composer-token');
    // 锁 `EditorView.atomicRanges.of(` 这个「扩展侧注册点」而不是裸词
    // atomicRanges——裸词在 CM 自带产物里就有（Facet.define / facet(...)），
    // 删掉 composer-tokens.ts 里的 provide 也不会红，断言就没牙了
    expect(script).toContain('EditorView.atomicRanges.of(');
    // 双处镜像常量：web 侧 COMPOSER_TOKEN_PATH 与 RN 侧 PromptEditorScreen 同值，
    // 改一边不同步会让胶囊在真机上彻底不亮——只能靠 dist 断言把住（capsule/G-2）
    expect(script).toContain('composer.md');
    // 选区上报协议（capsule/B-1 之后仅 composer 路径发，消息本身仍须在产物里）
    expect(script).toContain('selectionChange');
  });

  it('T-CE-CAPSULE-02: 胶囊 CSS 与 --primary-muted（宿主算色，capsule/C-orch-1 + C-2/C-3）', () => {
    const css = appCss();
    expect(css).toContain('.cm-composer-token');
    // 胶囊底色由宿主下发；CSS 只留 var() 兜底值，不在 web 侧拼 alpha
    expect(css).toContain('--primary-muted');
    // C-2 修复：胶囊内层透回胶囊字色。C-3 纪律：老 WebView 禁新语法，
    // 写成逗号分隔的普通选择器列表，不得出现 :is()（需 Chromium 88+）
    expect(css).toContain('.cm-content .cm-composer-token span');
    expect(css).toContain('color: inherit');
    expect(css).not.toContain(':is(');
  });
});
