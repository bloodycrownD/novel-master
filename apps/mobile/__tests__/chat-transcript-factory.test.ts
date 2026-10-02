/**
 * T-CF1：createTranscriptRuntime 工厂参数单测（chat-webview-unify Step 1 · chat-transcript 半）。
 *
 * 覆盖三件有牙的事：
 * 1. `bindChannel:false` → 不调 bindHostMessageChannel（单次注册归合成入口）；
 * 2. `emitReady:false`  → 不 post ready（单 ready 归合成入口），且该参数经
 *    DOMContentLoaded 闭包透传（禁模块级可变 flag：同文档两实例参数互不污染）；
 * 3. runtime 内部上行 post 仍是 bridge.ts 的模块级单例（createBoundPost(BRIDGE_V)），
 *    消息头 v 恒为 1 —— 工厂不注入 post。
 *
 * 环境：Jest 为 RN 环境（无 jsdom），照 rows-click-anchor.test.ts 先例注入最小
 * fake document；preact / mermaid-fullscreen / 两个 tsx 视图组件 mock 掉（不进真实
 * 渲染链），其余 runtime 模块（bridge / boot / menu / row-logic / rows-click）走真实代码。
 */
jest.mock('preact', () => ({h: jest.fn(), render: jest.fn()}));
jest.mock(
  '../src/web/chat-transcript/webview/ui/menu/MenuOverlay',
  () => ({MenuOverlay: () => null}),
);
jest.mock('../src/web/chat-transcript/webview/ui/render/RowList', () => ({
  RowList: () => null,
}));
jest.mock('@web/shared/mermaid-fullscreen/mermaid-fullscreen', () => ({
  mountMermaidViewerPortal: jest.fn(),
  attachMermaidViewerDelegation: jest.fn(),
  registerMermaidViewerView: jest.fn(),
  openMermaidViewer: jest.fn(),
  closeMermaidViewer: jest.fn(),
  isMermaidViewerOpen: jest.fn(() => false),
}));
jest.mock('@web/shared/host-message-channel', () => {
  const actual = jest.requireActual('@web/shared/host-message-channel');
  return {
    ...actual,
    bindHostMessageChannel: jest.fn(actual.bindHostMessageChannel),
  };
});

type Listener = (event: unknown) => void;
type ListenerBag = {
  document: Record<string, Listener[]>;
  window: Record<string, Listener[]>;
};
type FakeDocument = {
  readyState: string;
  getElementById: jest.Mock;
  addEventListener: jest.Mock;
  removeEventListener: jest.Mock;
  createElement: jest.Mock;
  body: {classList: {add: jest.Mock; remove: jest.Mock}};
  documentElement: {style: {setProperty: jest.Mock}};
  /** 手动派发某类监听（DOMContentLoaded 路径用）。 */
  fire: (type: string) => void;
  countListeners: (type: string) => number;
};

function pushListener(
  bag: Record<string, Listener[]>,
  type: string,
  fn: Listener,
): void {
  (bag[type] = bag[type] || []).push(fn);
}

/**
 * 装最小 fake document + window 监听面。
 * RN Jest 的 window 是宿主对象（无 addEventListener），而通道绑定是
 * document + window 双注册（shared/host-message-channel），故两边都要 fake，
 * 并分别计数以便断言「单次注册」。
 */
function installFakeDom(): {doc: FakeDocument; bag: ListenerBag} {
  const bag: ListenerBag = {document: {}, window: {}};
  const doc: FakeDocument = {
    readyState: 'complete',
    // 壳节点一律缺失：视图注册回调与 bindShellEvents 走「无宿主元素」早退分支
    getElementById: jest.fn(() => null),
    addEventListener: jest.fn((type: string, fn: Listener) =>
      pushListener(bag.document, type, fn),
    ),
    removeEventListener: jest.fn(),
    createElement: jest.fn(),
    body: {classList: {add: jest.fn(), remove: jest.fn()}},
    documentElement: {style: {setProperty: jest.fn()}},
    fire: (type: string) => {
      for (const fn of bag.document[type] || []) fn({type});
    },
    countListeners: (type: string) => (bag.document[type] || []).length,
  };
  const win = window as unknown as {
    addEventListener: (type: string, fn: Listener) => void;
    removeEventListener: (type: string, fn: Listener) => void;
    __origAddEventListener?: unknown;
    __origRemoveEventListener?: unknown;
  };
  win.__origAddEventListener = win.addEventListener;
  win.__origRemoveEventListener = win.removeEventListener;
  win.addEventListener = (type: string, fn: Listener) =>
    pushListener(bag.window, type, fn);
  win.removeEventListener = () => {};
  (globalThis as unknown as {document: unknown}).document = doc;
  return {doc, bag};
}

function restoreFakeDom(win: Record<string, unknown>, hadDocument: boolean, prevDocument: unknown): void {
  if (win.__origAddEventListener) {
    win.addEventListener = win.__origAddEventListener as typeof win.addEventListener;
  } else {
    delete win.addEventListener;
  }
  if (win.__origRemoveEventListener) {
    win.removeEventListener = win.__origRemoveEventListener as typeof win.removeEventListener;
  } else {
    delete win.removeEventListener;
  }
  delete win.__origAddEventListener;
  delete win.__origRemoveEventListener;
  if (hadDocument) {
    (globalThis as unknown as {document?: unknown}).document = prevDocument;
  } else {
    delete (globalThis as unknown as {document?: unknown}).document;
  }
}

type PostedEnvelope = {v: number; type: string; payload: Record<string, unknown>};

type Loaded = {
  create: (options?: {bindChannel?: boolean; emitReady?: boolean}) => void;
  bindHostMessageChannel: jest.Mock;
  mountMermaidViewerPortal: jest.Mock;
  attachMermaidViewerDelegation: jest.Mock;
  post: (type: string, payload?: Record<string, unknown>) => void;
  invokeRegisteredRenderContextMenu: () => boolean;
  invokeRegisteredRenderRows: () => boolean;
  onRowsClick: (event: unknown) => void;
};

/** 隔离模块注册表装载一份干净的 factory（模块级状态不串用例）。 */
function loadRuntime(): Loaded {
  const out = {} as Loaded;
  jest.isolateModules(() => {
    const factory = require('../src/web/chat-transcript/webview/runtime/factory');
    const channel = require('@web/shared/host-message-channel');
    const mermaid = require('@web/shared/mermaid-fullscreen/mermaid-fullscreen');
    const bridge = require('../src/web/chat-transcript/webview/runtime/bridge');
    const menu = require('../src/web/chat-transcript/webview/runtime/menu/menu');
    const rowLogic = require('../src/web/chat-transcript/webview/runtime/render/row-logic');
    const rowsClick = require('../src/web/chat-transcript/webview/runtime/render/rows-click');
    out.create = factory.createTranscriptRuntime;
    out.bindHostMessageChannel = channel.bindHostMessageChannel;
    out.mountMermaidViewerPortal = mermaid.mountMermaidViewerPortal;
    out.attachMermaidViewerDelegation = mermaid.attachMermaidViewerDelegation;
    out.post = bridge.post;
    out.invokeRegisteredRenderContextMenu = menu.invokeRegisteredRenderContextMenu;
    out.invokeRegisteredRenderRows = rowLogic.invokeRegisteredRenderRows;
    out.onRowsClick = rowsClick.onRowsClick;
  });
  return out;
}

/** 捕获上行信封（@web/shared/post 出口为 window.ReactNativeWebView）。 */
function postedEnvelopes(): PostedEnvelope[] {
  const bridge = (window as unknown as {
    ReactNativeWebView?: {postMessage: (msg: string) => void};
  }).ReactNativeWebView;
  if (!bridge) return [];
  return (bridge.postMessage as unknown as jest.Mock).mock.calls.map(call =>
    JSON.parse(call[0] as string),
  );
}

function readyEnvelopes(): PostedEnvelope[] {
  return postedEnvelopes().filter(e => e.type === 'ready');
}

/** rows-click 消费路径的最小事件（<a href> 分支只吃 closest/getAttribute/preventDefault）。 */
function anchorClickEvent(href: string) {
  const anchor = {
    getAttribute: (name: string) => (name === 'href' ? href : null),
  };
  const target = {closest: (sel: string) => (sel === 'a' ? anchor : null)};
  return {target, preventDefault: jest.fn()};
}

describe('createTranscriptRuntime 工厂参数 (T-CF1)', () => {
  let doc: FakeDocument;
  let bag: ListenerBag;
  let postMessage: jest.Mock;
  let hadDocument: boolean;
  let prevDocument: unknown;

  beforeEach(() => {
    hadDocument = 'document' in globalThis;
    prevDocument = (globalThis as unknown as {document?: unknown}).document;
    const dom = installFakeDom();
    doc = dom.doc;
    bag = dom.bag;
    postMessage = jest.fn();
    (window as unknown as {ReactNativeWebView?: unknown}).ReactNativeWebView = {
      postMessage,
    };
  });

  afterEach(() => {
    delete (window as unknown as {ReactNativeWebView?: unknown})
      .ReactNativeWebView;
    restoreFakeDom(
      window as unknown as Record<string, unknown>,
      hadDocument,
      prevDocument,
    );
  });

  it('默认参数 = 旧 main.ts 行为：绑通道 + 发 ready（行为零变化）', () => {
    const rt = loadRuntime();
    rt.create();

    expect(rt.bindHostMessageChannel).toHaveBeenCalledTimes(1);
    // 通道挂在 document + window 双注册（shared 统一实现），各一次
    expect((bag.document.message || []).length).toBe(1);
    expect((bag.window.message || []).length).toBe(1);
    expect(readyEnvelopes()).toEqual([
      {
        v: 1,
        type: 'ready',
        payload: {
          version: 'm4',
          capabilities: expect.any(Array),
          readyState: 'complete',
        },
      },
    ]);
  });

  it('bindChannel:false → 不调 bindHostMessageChannel（通道归合成入口单次注册）', () => {
    const rt = loadRuntime();
    rt.create({bindChannel: false});

    expect(rt.bindHostMessageChannel).not.toHaveBeenCalled();
    expect(bag.document.message).toBeUndefined();
    expect(bag.window.message).toBeUndefined();
    // 其它装配不受影响：ready 仍发（只关通道一项）
    expect(readyEnvelopes()).toHaveLength(1);
  });

  it('emitReady:false → 不 post ready；其余装配照旧', () => {
    const rt = loadRuntime();
    rt.create({emitReady: false});

    expect(readyEnvelopes()).toEqual([]);
    // 装配四件仍发生（视图注册 / mermaid 挂接）
    expect(rt.invokeRegisteredRenderContextMenu()).toBe(true);
    expect(rt.invokeRegisteredRenderRows()).toBe(true);
    expect(rt.mountMermaidViewerPortal).toHaveBeenCalledWith(
      'mermaid-viewer-portal',
    );
    expect(rt.attachMermaidViewerDelegation).toHaveBeenCalledTimes(1);
  });

  it('emitReady 经 DOMContentLoaded 闭包透传：loading 期两实例参数互不污染（禁模块级 flag）', () => {
    const silent = loadRuntime();
    const loud = loadRuntime();
    doc.readyState = 'loading';

    silent.create({emitReady: false});
    loud.create({emitReady: true});

    // DOM 就绪前谁都不发 ready
    expect(readyEnvelopes()).toEqual([]);

    doc.fire('DOMContentLoaded');

    // 恰好一条 ready，且来自 emitReady:true 的那次装配
    expect(readyEnvelopes()).toHaveLength(1);
    expect(readyEnvelopes()[0].v).toBe(1);
  });

  it('runtime 内部 post 仍是 bridge 模块级单例（无注入），上行消息头 v 恒为 1', () => {
    const rt = loadRuntime();
    rt.create();

    // 工厂把 bridge.post 原样交给 mermaid 委托（身份相等 → 未被替换）
    expect(rt.attachMermaidViewerDelegation).toHaveBeenCalledWith(rt.post);

    // ready 自身（create 时即发，readyState 非 loading）
    expect(readyEnvelopes()).toEqual([
      expect.objectContaining({v: 1, type: 'ready'}),
    ]);
    // 消费路径实测：rows-click <a> 分支上行 linkClick（同一 post 单例）
    rt.onRowsClick(anchorClickEvent('笔记/大纲.md'));
    expect(postedEnvelopes().slice(1)).toEqual([
      {v: 1, type: 'linkClick', payload: {href: '笔记/大纲.md'}},
    ]);
  });
});
