/**
 * T-TS1：chat-transcript 独立入口 dist 契约测（composer-native-2026-10 Step 2）。
 *
 * 读 webview-dist 产物（pretest 已 build:webview），风格对照 chat-conversation-boot-script.test.ts。
 * 锁的是「转录拆回独立文档」这条链的外部可见面：
 * - ready v2 握手面：入口自包的 ready 带 `version:'t1'` 与转录域能力清单；
 * - 入口上行出口 v:2（src 源面：TRANSCRIPT_ENTRY_BRIDGE_V = 2 且绑定 createBoundPost）；
 * - 下行 v2→v1 翻译层接线（白屏根因层）：入口自行
 *   bindHostMessageChannel(rawDowntranslate)、runtime 以 bindChannel:false 装配，
 *   runtime 老桥 v1 常量单一来源（import state.BRIDGE_V，不手抄字面量）；
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

// 翻译层行为单测需把 runtime 的 handleHostMessage 换成记录桩（本条链的真机
// 根因是「runtime 只认 v1、入口自译」，桩只观察喂进去的信封形态，不改被测
// 逻辑）。mock* 前缀是 jest hoist 的命名约定。
const mockHandleHostMessage = jest.fn();
jest.mock(
  '../src/web/chat-transcript/webview/runtime/bridge',
  () => ({
    handleHostMessage: (...args: unknown[]) =>
      mockHandleHostMessage(...args),
  }),
);

import {
  rawDowntranslate,
  TRANSCRIPT_ENTRY_BRIDGE_V,
  TRANSCRIPT_RUNTIME_BRIDGE_V,
} from '../src/web/chat-transcript/webview/host-downtranslate';

function bootScript(): string {
  return readWebViewDistFile('chat-transcript', 'app.js');
}

function indexHtml(): string {
  return readWebViewDistFile('chat-transcript', 'index.html');
}

function appCss(): string {
  return readWebViewDistFile('chat-transcript', 'app.css');
}

/**
 * 入口 src 源码文本（T-TS1e 的源面断言用）：dist 产物是 minify 的，常量名会被
 * 抹掉、数字可能被折叠，`v:2` 形态在产物里未必可寻址；信封版本锁在源码文本上。
 * 手法同 chat-conversation-entry.test.ts 的 mainSource()。
 */
function entrySource(): string {
  return readFileSync(
    join(__dirname, '../src/web/chat-transcript/webview/main.ts'),
    'utf8',
  );
}

/** 翻译层 src 源码文本（v 号常量与单源断言寻址：常量已随 rawDowntranslate 拆入本文件）。 */
function downtranslateSource(): string {
  return readFileSync(
    join(__dirname, '../src/web/chat-transcript/webview/host-downtranslate.ts'),
    'utf8',
  );
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

  it('T-TS1e: 入口上行出口 v:2——src 源面锁 TRANSCRIPT_ENTRY_BRIDGE_V = 2 且绑定 createBoundPost', () => {
    // 宿主只认 v === 2 的 ready（v:1 envelope 被直接丢弃），入口上行出口的版本
    // 锁在 src 源码文本上（dist 是 minify 的，常量名不可寻址）。两处都锁：
    // 常量定义必须是 2（改 1/改 3 都算漂移），且它必须真作为 createBoundPost
    // 的实参（绕开常量直接传字面量同样算漂移）。变异自检：把常量临时改 1，
    // 第一条断言必红。
    const constant = downtranslateSource();
    const source = entrySource();
    expect(constant).toMatch(/const\s+TRANSCRIPT_ENTRY_BRIDGE_V\s*=\s*2\s*;/);
    expect(source).toMatch(/createBoundPost\(\s*TRANSCRIPT_ENTRY_BRIDGE_V\s*\)/);
  });

  it('T-TS1f: 下行 v2→v1 翻译层接线——入口先绑宿主通道 + runtime 不自绑 + v1 常量单源', () => {
    // 真机白屏根因层（3d206251e）的源面锁定：宿主下行全是 v2 信封，runtime 的
    // handleHostMessage 只认 v1。入口必须**先**把 translate 层的 rawDowntranslate
    // 单次注册进宿主通道，runtime 自身以 bindChannel:false 装配（回到自绑
    // 或删掉翻译层 = 白屏回归）。v1 信封版本必须是 runtime state 的 BRIDGE_V
    // 直接 import（CR-fix-12：v1 契约单一语义，禁第二份手抄字面量）。
    const source = entrySource();
    const translate = downtranslateSource();
    expect(source).toMatch(/bindHostMessageChannel\(\s*rawDowntranslate\s*\)/);
    expect(source).toMatch(
      /createTranscriptRuntime\(\{\s*bindChannel:\s*false,\s*emitReady:\s*false,?\s*\}\)/,
    );
    // runtime 老桥版本：直接 import state 的 BRIDGE_V（改回 `= 1` 手抄即红）。
    expect(translate).toMatch(/const\s+TRANSCRIPT_RUNTIME_BRIDGE_V\s*=\s*BRIDGE_V\s*;/);
    expect(translate).toMatch(/import\s*\{\s*BRIDGE_V\s*\}\s*from/);
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

/**
 * 下行 v2→v1 翻译层行为锁（CR-fix-05：真机白屏根因层的单测）。
 *
 * 白屏根因：宿主下行全是 v2 信封，runtime 的 handleHostMessage 只认 v1——这层
 * 拆包重打包缺失时 init/快照被静默丢弃（无错误页）。这里直接调
 * rawDowntranslate（模块已拆出，不再藏在入口里不可测），断言：
 * - v2 信封（string 未 parse 与对象已 parse 双形态）→ 翻译成 `{v:1,type,payload}`
 *   喂给 runtime；
 * - 非 v2 / 坏 JSON / 非对象 / 缺字段 → 静默丢弃，一次都不调。
 *
 * 变异自检：把 host-downtranslate.ts 的 TRANSCRIPT_ENTRY_BRIDGE_V 临时改 1，
 * 前两条必红（v:2 输入被丢弃）；删掉调用链上的 handleHostMessage 调用同样红。
 */
describe('host-downtranslate · 下行 v2→v1 翻译（白屏根因锁定）', () => {
  beforeEach(() => {
    mockHandleHostMessage.mockClear();
  });

  it('v2 string 信封（宿主未 parse）→ 拆包重打成 v1 喂给 runtime', () => {
    rawDowntranslate(
      JSON.stringify({v: 2, type: 'init', payload: {schemaV: 2}}),
    );

    expect(mockHandleHostMessage).toHaveBeenCalledTimes(1);
    expect(mockHandleHostMessage).toHaveBeenCalledWith({
      v: 1,
      type: 'init',
      payload: {schemaV: 2},
    });
    // 常量面：输出 v 号来自 runtime state 单一来源（CR-fix-12）。
    expect(TRANSCRIPT_RUNTIME_BRIDGE_V).toBe(1);
    expect(TRANSCRIPT_ENTRY_BRIDGE_V).toBe(2);
  });

  it('v2 对象信封（宿主已 JSON.parse）→ 同样翻译，payload 原样透传', () => {
    rawDowntranslate({
      v: 2,
      type: 'snapshot',
      payload: {rows: [{kind: 'message', id: 'm1'}]},
    });

    expect(mockHandleHostMessage).toHaveBeenCalledTimes(1);
    expect(mockHandleHostMessage).toHaveBeenCalledWith({
      v: 1,
      type: 'snapshot',
      payload: {rows: [{kind: 'message', id: 'm1'}]},
    });
  });

  it('非 v2 信封 / 缺字段 / 坏 JSON / 非对象 → 静默丢弃，不调 runtime', () => {
    // v ≠ 2：v1 信封（translator 重复接线才会见到）与漂移的 v3 都不喂
    rawDowntranslate({v: 1, type: 'init', payload: {}});
    rawDowntranslate({v: 3, type: 'init', payload: {}});
    // 缺 v / 缺 type
    rawDowntranslate({type: 'init', payload: {}});
    rawDowntranslate({v: 2, payload: {}});
    // 坏 JSON string
    rawDowntranslate('{not json');
    // 非对象：null / 数字 / 裸字符串（parse 后仍是 string 的兜底）
    rawDowntranslate(null);
    rawDowntranslate(42);
    rawDowntranslate('"v2 但整体只是字符串"');

    expect(mockHandleHostMessage).not.toHaveBeenCalled();
  });
});
