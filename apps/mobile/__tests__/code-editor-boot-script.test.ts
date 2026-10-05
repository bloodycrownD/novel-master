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
    // minify 重命名 dispatcher 形参与 handler 本体（`msg.type === …` → `e.type === …`，
    // `handleHostMessage` 消失）。断言换稳定的协议面：`<局部>.type === "<type>"`
    // 路由形态（引号风格容忍）+ 协议 type 字符串本身。
    expect(script).toMatch(/type\s*===\s*['"]init['"]/);
    expect(script).toContain('setDocument');
    expect(script).toContain('themeUpdate');
    expect(script).toMatch(/type\s*===\s*['"]blur['"]/);
    // 上行出口：esbuild 打包时绑定过的 post 会被去重重命名（post / post2 / _t…），
    // 且 minify 会重命名绑定本身——锚「(type 字面量, payload 形态)」这个调用
    // 形态而非函数名：ready 带 {version:1}，change 带 {text:…}。
    expect(script).toMatch(/\(\s*['"]ready['"]\s*,\s*\{\s*version:\s*1\s*\}\s*\)/);
    expect(script).toMatch(/\(\s*['"]change['"]\s*,\s*\{\s*text:/);
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
    // 锁 `atomicRanges.of(` 这个「扩展侧注册点」而不是裸词 atomicRanges——
    // 裸词在 CM 自带产物里就有（Facet.define / facet(...)），删掉
    // composer-tokens.ts 里的 provide 也不会红，断言就没牙了。
    // minify 会把 `EditorView` 压成短符号，但成员访问 `atomicRanges.of(` 是
    // 属性名，压缩动不了，故把宿主符号放宽成属性链起点。
    expect(script).toMatch(/atomicRanges\.of\(/);
    // 双处镜像常量：web 侧 COMPOSER_TOKEN_PATH 与 RN 侧 PromptEditorScreen 同值，
    // 改一边不同步会让胶囊在真机上彻底不亮——只能靠 dist 断言把住（capsule/G-2）
    expect(script).toContain('composer.md');
    // 选区上报协议（capsule/B-1 之后仅 composer 路径发，消息本身仍须在产物里）。
    // 锁「("selectionChange", {start:…})」这个发送点的调用形态而不是裸词——裸词在
    // CM 自带产物里出现 10 处（this.selectionChanged 等内部字段），删掉 editor.ts
    // 的 post 也不会红。
    expect(script).toMatch(/\(\s*['"]selectionChange['"]\s*,\s*\{\s*start:/);
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
