/**
 * chat-transcript 壳级事件绑定单测（cr2-B-3）。
 *
 * 只锁一件事：**bindShellEvents 可重复调用**。
 *
 * `addEventListener` 靠「同一个函数引用」被浏览器自动去重，所以 scroll / click 监听
 * 重复绑定天然只有一份；ResizeObserver 不吃这套——它每次 `new` 都是新实例，旧实例还
 * 活着 observe 着同一个 #scroller，尺寸变化每帧就多触发一次 stickIfNearBottomNow
 * （多写一次 scrollTop）。本文件用 RO 桩把这条「显式 disconnect 上一只」钉住。
 *
 * 环境：RN jest preset 是 node、无 jsdom（本仓既有约定，见 chat-conversation-dock.test
 * 头注），故自带极小 document 桩——bind-shell-events.ts:13 直接裸调
 * `document.getElementById`，node 下不补桩就是 ReferenceError。
 * scroll / rows-click / bridge / code-copy 四个 import 全部 mock 掉：被测面只有绑定
 * 行为，真链会把 snapshot / stream / mermaid 整条渲染依赖拖进来，与本条无关。
 */
const SCROLL_MODULE = '../src/web/chat-transcript/webview/runtime/scroll/scroll';
const ROWS_CLICK_MODULE =
  '../src/web/chat-transcript/webview/runtime/render/rows-click';
const BRIDGE_MODULE = '../src/web/chat-transcript/webview/runtime/bridge';
const SHELL_MODULE =
  '../src/web/chat-transcript/webview/runtime/boot/bind-shell-events';

// 路径必须逐字写死：jest.mock 会被 babel 提升到文件顶部，变量形态的模块路径在
// 那里还没初始化（TDZ），注册会静默失效、被测模块转而加载真依赖链。
jest.mock('../src/web/chat-transcript/webview/runtime/scroll/scroll', () => ({
  onScroll: jest.fn(),
  stickIfNearBottomNow: jest.fn(),
}));
jest.mock(
  '../src/web/chat-transcript/webview/runtime/render/rows-click',
  () => ({onRowsClick: jest.fn()}),
);
jest.mock('../src/web/chat-transcript/webview/runtime/bridge', () => ({
  post: jest.fn(),
}));
jest.mock('@web/shared/code-copy', () => ({
  attachCodeCopyDelegation: jest.fn(),
}));

/* ------------------------------------------------------------------ *
 * 极小 document / ResizeObserver 桩
 * ------------------------------------------------------------------ */

// 本文件只有 require() 没有 import/export，不加这一句就是**全局脚本**——build tsconfig
// 把 __tests__ 一起纳入且这几个 DOM 桩（FakeElement / g / fakeDocument）在多个测试
// 文件里同名同义，会直接撞成 TS2300 Duplicate identifier（同 dock.test.ts 靠 import
// 天然成为 module 而幸免）。加 `export {}` 即声明模块作用域。
export {};

type AnyFn = (event?: unknown) => void;

/** 本模块只用到 addEventListener 与「能不能被 observe」这一层身份。 */
class FakeElement {
  listeners: Array<{type: string; fn: AnyFn}> = [];
  /** document 桩的取节点入口（壳里只有 #scroller / #rows 命中）。 */
  getElementById?: (id: string) => FakeElement | null;
  /**
   * 照浏览器语义：**同 (type, fn) 重复 add 只留一份**。这正是 bindShellEvents 注释里
   * 「listener 靠同引用去重」那句契约的可执行形态——桩若照单全收重复绑定，这条注释
   * 与 RO 那侧的 disconnect 补齐就没有对照面了。
   */
  addEventListener(type: string, fn: AnyFn): void {
    if (this.listeners.some(item => item.type === type && item.fn === fn)) {
      return;
    }
    this.listeners.push({type, fn});
  }
  removeEventListener(type: string, fn: AnyFn): void {
    this.listeners = this.listeners.filter(
      item => item.type !== type || item.fn !== fn,
    );
  }
}

class FakeResizeObserver {
  /** 全部实例（构造即登记）；disconnect 后仍留在表里，方便断言「谁被断掉了」。 */
  static instances: FakeResizeObserver[] = [];
  /** 已 observe 的目标；disconnect 后清空——与浏览器语义一致。 */
  observed: unknown[] = [];
  disconnectCalls = 0;
  readonly callback: () => void;

  constructor(callback: () => void) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }

  observe(target: unknown): void {
    this.observed.push(target);
  }

  unobserve(target: unknown): void {
    this.observed = this.observed.filter(item => item !== target);
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.observed = [];
  }
}

/** 模拟 #scroller 的一次尺寸变化：只通知还活着的实例（被 disconnect 的不响）。 */
function fireResize(): void {
  for (const instance of FakeResizeObserver.instances) {
    if (instance.observed.length > 0) {
      instance.callback();
    }
  }
}

const g = globalThis as unknown as Record<string, unknown>;
const originalDocument = g.document;
const originalResizeObserver = g.ResizeObserver;

let fakeDocument: FakeElement & {
  getElementById: (id: string) => FakeElement | null;
};
let scroller: FakeElement;
let rows: FakeElement;
let bindShellEvents: () => void;
/** 必须与被测模块持有的是**同一个** mock 实例：resetModules 之后再 require 会换新对象。 */
let stickIfNearBottomNow: jest.Mock;

function stickCalls(): number {
  return stickIfNearBottomNow.mock.calls.length;
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  FakeResizeObserver.instances = [];

  scroller = new FakeElement();
  rows = new FakeElement();
  const doc = new FakeElement();
  doc.getElementById = (id: string) =>
    id === 'scroller' ? scroller : id === 'rows' ? rows : null;
  fakeDocument = doc as unknown as typeof fakeDocument;

  g.document = fakeDocument;
  g.ResizeObserver = FakeResizeObserver;

  const scroll = require(SCROLL_MODULE) as {
    stickIfNearBottomNow: jest.Mock;
  };
  stickIfNearBottomNow = scroll.stickIfNearBottomNow;
  const shell = require(SHELL_MODULE) as {bindShellEvents: () => void};
  bindShellEvents = shell.bindShellEvents;
});

afterEach(() => {
  g.document = originalDocument;
  g.ResizeObserver = originalResizeObserver;
});

describe('bindShellEvents 的可重复调用（cr2-B-3）', () => {
  it('T-RO-01：连续两次绑定必须 disconnect 上一只 RO，尺寸变化只触发一次回调', () => {
    bindShellEvents();
    expect(FakeResizeObserver.instances).toHaveLength(1);
    expect(FakeResizeObserver.instances[0].observed).toEqual([scroller]);
    // 首只还没被任何人复用，不该有多余的 disconnect
    expect(FakeResizeObserver.instances[0].disconnectCalls).toBe(0);

    bindShellEvents();
    expect(FakeResizeObserver.instances).toHaveLength(2);
    // 关键断言：第二只建起来之前必须把第一只断开，否则两只同时 observe 着 #scroller
    expect(FakeResizeObserver.instances[0].disconnectCalls).toBe(1);
    expect(FakeResizeObserver.instances[0].observed).toEqual([]);
    expect(FakeResizeObserver.instances[1].observed).toEqual([scroller]);

    // 一次尺寸变化只允许有一个回调落地（朴素实现这里是 2）
    fireResize();
    expect(stickCalls()).toBe(1);

    // 再叠三次绑定，回调数仍必须是 1（共 5 只，前 4 只全被断开）
    bindShellEvents();
    bindShellEvents();
    bindShellEvents();
    expect(FakeResizeObserver.instances).toHaveLength(5);
    expect(FakeResizeObserver.instances[4].observed).toEqual([scroller]);
    expect(
      FakeResizeObserver.instances.slice(0, 4).map(item => item.disconnectCalls),
    ).toEqual([1, 1, 1, 1]);
    fireResize();
    expect(stickCalls()).toBe(2);
  });

  it('T-RO-02：无 ResizeObserver 的老 WebView 退化（typeof 守卫，不建不抛）', () => {
    delete g.ResizeObserver;
    expect(() => {
      bindShellEvents();
      bindShellEvents();
    }).not.toThrow();
    expect(FakeResizeObserver.instances).toHaveLength(0);
    // 退化不等于断链：scroll / click / 代码复制委托照绑
    expect(scroller.listeners.map(item => item.type)).toEqual(['scroll']);
    expect(rows.listeners.map(item => item.type)).toEqual(['click']);
  });

  it('T-RO-03：壳缺 #scroller 时不建 RO；缺 #rows 时早退也不抛', () => {
    const bare = new FakeElement();
    bare.getElementById = () => null;
    g.document = bare;

    expect(() => {
      bindShellEvents();
      bindShellEvents();
    }).not.toThrow();
    expect(FakeResizeObserver.instances).toHaveLength(0);

    // 只补 #rows：RO 不建，rows 监听照绑
    rows = new FakeElement();
    const rowsOnly = new FakeElement();
    rowsOnly.getElementById = (id: string) => (id === 'rows' ? rows : null);
    g.document = rowsOnly;
    bindShellEvents();
    expect(FakeResizeObserver.instances).toHaveLength(0);
    expect(rows.listeners.map(item => item.type)).toEqual(['click']);
  });
});