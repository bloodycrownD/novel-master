/**
 * T-TS1：chat-transcript 独立入口 dist 契约测（composer-native-2026-10 Step 2）。
 *
 * 读 webview-dist 产物（pretest 已 build:webview），风格对照 chat-conversation-boot-script.test.ts。
 * 锁的是「转录拆回独立文档」这条链的外部可见面：
 * - ready v2 握手面：入口自包的 ready 带 `version:'t1'` 与转录域能力清单；
 * - composer/dock 域完全不在独立入口里（能力位字符串、dockAction/composerState
 *   协议 type、壳子树三重反面）；
 * - 壳结构与样式：#app（flex 列容器）/ #scroller / #rows / 双 portal，基底
 *   transcript.css 的两个注入占位均已替换。
 *
 * 「收到 composer 域消息不崩（宽松解码）」的行为面由 chat-conversation-bridge.test
 * 的 decoder 断言 + runtime 自身 handleHostMessage 的既有套件覆盖（未知 type
 * 宽松丢弃是 runtime 既有纪律），此处不再重复行为跑。
 */
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {readWebViewDistFile} from './helpers/read-webview-dist';

function bootScript(): string {
  return readWebViewDistFile('chat-transcript', 'app.js');
}

function indexHtml(): string {
  return readWebViewDistFile('chat-transcript', 'index.html');
}

function appCss(): string {
  return readWebViewDistFile('chat-transcript', 'app.css');
}

describe('chat-transcript 独立入口（T-TS1 · dist）', () => {
  it('T-TS1a: ready v2 面——version t1 字面量 + DOMContentLoaded 兜底 + 装配闸', () => {
    const script = bootScript();
    // minify 稳定面：ready payload 的 version 字面量（独立入口的 u 标识）。
    // 宿主判定只认 v === 2（信封 v），标识仅辅助信息——t1 与合成包 'u1' 刻意不同，
    // 报障日志里一眼区分 ready 来源。
    expect(script).toMatch(/version:\s*['"]t1['"]/);
    expect(script).toMatch(/readyState\s*===\s*['"]loading['"]/);
    // 装配闸：壳未命中不发 ready（诊断文案是 minify 保留的字符串面）。
    expect(script).toContain('[chat-transcript]');
    expect(script).toMatch(/getElementById\(['"]rows['"]\)/);
    expect(() => {
      // eslint-disable-next-line no-new-func -- 语法守护：boot IIFE 不可损坏
      new Function(script);
    }).not.toThrow();
  });

  it('T-TS1b: composer/dock 域完全不在独立入口（能力位 / 协议 type / 壳子树三重反面）', () => {
    const script = bootScript();
    // 能力位：独立入口 capabilities = TRANSCRIPT_CAPABILITIES（纯转录域），
    // composer-dock 字符串不该出现在产物任何位置（模型/dispatcher/dock 全没进包）。
    expect(script).not.toContain('composer-dock');
    // dock/composer 域协议 type 同理。反面清单只挑**协议唯一**的字面量：
    // `selectAll` 在第三方库（d3/mermaid 的 .selectAll()）里是常见 API 名，
    // 整串反面会误红，不作断言。
    expect(script).not.toContain('dockAction');
    expect(script).not.toContain('composerState');
    expect(script).not.toContain('composerPaste');
    // 转录域能力位照常声明（宿主据此启用块级渲染）
    expect(script).toContain('streamBlockCommit');
    // 壳子树反面：无 dock 子树
    expect(indexHtml()).not.toContain('id="composer-dock"');
    expect(indexHtml()).not.toContain('id="composer-input"');
  });

  it('T-TS1c: 壳含 #app/#scroller/#rows 与相对 app.js/app.css；双 portal 为 body 直接子级', () => {
    const html = indexHtml();
    expect(html).toContain('id="app"');
    expect(html).toContain('id="scroller"');
    expect(html).toContain('id="rows"');
    expect(html).toContain('./app.js');
    expect(html).toContain('./app.css');
    expect(html).toContain('<script src="./app.js"');
    expect(html).not.toContain('type="module"');
    // 双 portal 不被卷进 #app（fixed 包含块语境与 chat-conversation 一致）
    expect(html.indexOf('id="app"')).toBeLessThan(html.indexOf('id="menu-portal"'));
    expect(
      /<\/div>\s*<div id="menu-portal"><\/div>/.test(html) ||
        /<div id="menu-portal"><\/div>/.test(html),
    ).toBe(true);
    expect(html).toContain('id="mermaid-viewer-portal"');
  });

  it('T-TS1d: app.css 基底全文——#app 四属性齐 + 两个注入占位已替换 + 转录关键 selector 在', () => {
    const css = appCss();
    // #app 四属性（transcript.css 基底自持：独立包无合成包覆盖段，
    // #scroller 的 height:100% 要靠它解析）
    const appRule = /#app\s*\{([^}]*)\}/.exec(css);
    expect(appRule).not.toBeNull();
    const body = appRule ? appRule[1] : '';
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/flex-direction:\s*column/);
    expect(body).toMatch(/height:\s*100%/);
    expect(body).toMatch(/min-height:\s*0/);
    // 注入占位均已消失 = injectCss 命中
    expect(css).not.toContain('/* __RICH_CSS__ */');
    expect(css).not.toContain('/* __MERMAID_FULLSCREEN_CSS__ */');
    expect(css).toContain('.bubble.rich');
    expect(css).toContain('.mermaid-fullscreen-backdrop');
    // 转录段关键 selector（基底被截断即空转录区）
    for (const selector of ['.bubble', '.ref-token', '.menu-backdrop', '#rows']) {
      expect(css).toContain(selector);
    }
    // 反面：dock 段样式不该在独立包里（合成包 cssRel 的增量段才带）
    expect(css).not.toContain('#composer-dock');
  });
});
