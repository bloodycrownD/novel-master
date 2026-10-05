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
    // minify 重命名 dispatcher 的形参与 handler 函数本体（`msg.type === …`
    // → `e.type === …`，`handleHostMessage` 直接消失）。断言换到稳定的协议面：
    // `<局部>.type === "<type>"` 的路由形态 + 协议 type 字符串本身。
    // 引号风格容忍（prettier singleQuote 后 dist 产物为单引号）。
    expect(script).toMatch(/type\s*===\s*['"]setDocument['"]/);
    expect(script).toContain('themeUpdate');
    expect(script).toMatch(/type\s*===\s*['"]themeUpdate['"]/);
    expect(script).toContain('setAnnotateEnabled');
    expect(script).toContain('setAnnotations');
    expect(script).toContain('annotateOpen');
    // 双形态：未压缩 `false` / minify `!1`（esbuild 布尔压缩），两种构建都锁
    expect(script).toMatch(/annotatingEnabled:\s*(?:false|!1)/);
    expect(script).toContain('__nmCollectRecogitoSelection');
    // 旧 mark / selectionCollect 生产不挂载。原先锚的 `applyAnnotateMarks`
    // 是纯标识符（且源码里已无此函数），minify 下恒真失效——换成它产出面：
    // 批注标记类名与 window 上那个兄弟采集器名（都是字符串面，改不掉了）。
    expect(script).not.toContain('annotate-mark');
    expect(script).not.toContain('__nmCollectAnnotateSelection');
    // 「添加批注」由 RN menuItems 负责，Web 侧不再发 selectionAnnotate / 不叠 DOM 浮动条
    expect(script).not.toContain('selectionAnnotate');
    expect(script).not.toContain('annotate-bar');
    // chat 菜单两域整域不在本包里：原先锚的 menuOverlayHandler / openMessageMenu
    // 是标识符（openMessageMenu 兼作上行协议 type），minify 下恒真失效——换成
    // 同义的协议 type 与 DOM 标记字符串面。
    expect(script).not.toContain('openMessageMenu');
    expect(script).not.toContain('messageMenuAction');
    expect(script).not.toContain('menu-portal');
  });

  it('T-BR-RD-02: over-limit / frontMatter / TrustedHtml（三列矩阵）', () => {
    const script = bootScript();
    expect(script).toContain('over-limit-hint');
    expect(script).toContain('frontMatterHtml');
    // 超限提示的**文案本体**：esbuild IIFE 把中文常量化为 \uXXXX（minify 不动字符串内容）。
    // 原先并排断言的 `OVER_LIMIT_HINT` 是常量标识符，minify 重命名后恒失——
    // 换成它的值（转义后的中文），这才是「提示文案没被 tree-shake 掉」的牙齿。
    expect(script).toMatch(/\\u5185\\u5BB9\\u8FC7\\u957F/);
    // token：doc-body / rich / TrustedHtml；装配：setDocument 视图刷新
    expect(script).toContain('doc-body');
    // TrustedHtml 组件标识符被重命名；锁它唯一产出的属性名形态
    // （preact 自身只做 `u=="dangerouslySetInnerHTML"` 的属性读，不会写出
    //   `{__html:…}` 这个字面量，故不会误命中）
    expect(script).toMatch(/dangerouslySetInnerHTML:\{__html:\w+\}/);
    // registerSetDocumentView 标识符被重命名；锁它消费的下行 payload 字段名
    // （overLimit 只有 setDocument 视图刷新这条路径会读）
    expect(script).toContain('overLimit');
    // 允许删除：手拼 doc-body 整段（已迁 DocumentApp + TrustedHtml）
    expect(script).not.toContain('\'<div class="doc-body rich">\'+');
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
