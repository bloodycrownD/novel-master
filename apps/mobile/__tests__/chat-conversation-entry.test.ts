/**
 * chat-conversation 合成包**入口装配**行为测试（T-CE 系列 · cr1-P1-4）。
 *
 * 为什么必须有这个文件：T-CU1/T-CU3 关心的三条入口不变量（单 ready / 单次通道注册 /
 * 装配序）此前只有 dist 字符串比对——那恒真，源码删掉一半装配照样绿。这里跑**真 main.ts**
 * （import 即执行顶层装配，测的就是装配序本身），把三条不变量钉成行为断言。
 *
 * 环境：RN jest preset 是 node 环境、**无 jsdom**（本仓既有约定，见 composer-input-factory
 * 与 chat-conversation-dock 的头注），故照 dock.test.ts 的先例自带极小 DOM 桩，只实现
 * main.ts 装配链真实走到的成员（FakeElement / FakeStyle / FakeClassList / rAF 队列）。
 * 不引 jest-environment-jsdom（本仓没装，且会把 RN preset 顶掉）。
 *
 * mock 面（只挡「真跑会炸」的部分，main.ts 自身与两 runtime 工厂、dispatcher、dock 全走真码）：
 *   - preact / MenuOverlay / RowList：转录域的视图渲染链，无 DOM 渲染不了（沿用
 *     chat-transcript-factory.test.ts 的同款挡法）；
 *   - mermaid-fullscreen：模块刈处一挂接即摸 document portal。
 * 被挡的三者都不参与「注册几次监听 / 发几条 ready / 谁先谁后」这条链——那正是本文件要测的。
 */
jest.mock('preact', () => ({h: jest.fn(), render: jest.fn()}));
jest.mock('@web/chat-transcript/webview/ui/menu/MenuOverlay', () => ({
  MenuOverlay: () => null,
}));
jest.mock('@web/chat-transcript/webview/ui/render/RowList', () => ({
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

/* ------------------------------------------------------------------ *
 * 极小 DOM 桩（底座照 chat-conversation-dock.test.ts，裁到本文件用得到的成员）
 * ------------------------------------------------------------------ */

type AnyFn = (event?: unknown) => void;

class FakeStyle {
  readonly props: Record<string, string> = {};
  /** 直接赋值型内联样式（dock 的 paddingBottom、按钮 fontSize 走这条）。 */
  paddingBottom = '';
  fontSize = '';

  setProperty(name: string, value: string): void {
    this.props[name] = value;
  }
  getPropertyValue(name: string): string {
    return this.props[name] ?? '';
  }
}

class FakeClassList {
  constructor(private readonly owner: FakeElement) {}

  private list(): string[] {
    return this.owner.className.split(/\s+/).filter(Boolean);
  }
  private write(next: string[]): void {
    this.owner.className = next.join(' ');
  }
  add(name: string): void {
    const next = this.list();
    if (next.indexOf(name) < 0) next.push(name);
    this.write(next);
  }
  remove(name: string): void {
    this.write(this.list().filter(item => item !== name));
  }
  contains(name: string): boolean {
    return this.list().indexOf(name) >= 0;
  }
  toggle(name: string, force?: boolean): boolean {
    const on = force === undefined ? !this.contains(name) : force;
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

class FakeElement {
  tagName: string;
  id = '';
  className = '';
  readonly style = new FakeStyle();
  readonly classList = new FakeClassList(this);
  readonly attributes: Record<string, string> = {};
  readonly dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  listeners: Array<{type: string; fn: AnyFn}> = [];
  hidden = false;
  textContent = '';
  disabled = false;
  /** 供注册序日志区分「谁注册的这条监听」（见 registrationLog）。 */
  label = '';
  // 布局读数（jsdom 缺的量，手动喂）
  scrollTop = 0;
  scrollHeight = 0;
  clientHeight = 56;
  // textarea 成员
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  placeholder = '';
  readOnly = false;
  spellcheck = true;
  private html = '';

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get innerHTML(): string {
    return this.html;
  }
  /** 只把 `<div class="...">` 段落落成子节点（dock 唯一反查 innerHTML 的形状是 typeahead 行）。 */
  set innerHTML(value: string) {
    this.html = value;
    this.children = [];
    const divRe = /<div\s+class="([^"]*)"[^>]*>/g;
    let match: RegExpExecArray | null;
    while ((match = divRe.exec(value)) !== null) {
      const child = new FakeElement('div');
      child.className = match[1];
      child.parentNode = this;
      this.children.push(child);
    }
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name === 'id') this.id = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  appendChild(child: FakeElement): FakeElement {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  remove(): void {
    const parent = this.parentNode;
    if (parent == null) return;
    parent.children = parent.children.filter(item => item !== this);
    this.parentNode = null;
  }
  get parentElement(): FakeElement | null {
    return this.parentNode;
  }

  addEventListener(type: string, fn: AnyFn): void {
    // 注册序日志：装配序红线的证据面。红线要求「先绑通道、后装两 runtime」，
    // 于是第一条注册必须是 message（通道），任何 DOMContentLoaded / selectionchange
    // 抢在它前面就说明 bind 被挪到了工厂之后。
    registrationLog.push(`${this.label}:${type}`);
    this.listeners.push({type, fn});
  }
  removeEventListener(type: string, fn: AnyFn): void {
    this.listeners = this.listeners.filter(
      item => item.type !== type || item.fn !== fn,
    );
  }
  dispatch(type: string, event?: unknown): void {
    const given = (event ?? {}) as {target?: unknown};
    const payload = {...given, target: given.target ?? this};
    // 快照：真 DOM 同一次派发内后注册的监听不会被本次触发（变异自查 b 靠这个语义）。
    for (const item of this.listeners.filter(l => l.type === type).slice()) {
      item.fn(payload);
    }
  }
  dispatchEvent(event: {type: string; detail?: unknown}): boolean {
    this.dispatch(event.type, {target: this, detail: event.detail});
    return true;
  }
  countListeners(type: string): number {
    return this.listeners.filter(item => item.type === type).length;
  }

  setSelectionRange(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  select(): void {
    this.selectionStart = 0;
    this.selectionEnd = this.value.length;
  }
  focus(): void {
    fakeDocument.activeElement = this;
  }
  blur(): void {
    fakeDocument.activeElement = null;
  }

  descendants(): FakeElement[] {
    const out: FakeElement[] = [];
    for (const child of this.children) {
      out.push(child, ...child.descendants());
    }
    return out;
  }
  matches(selector: string): boolean {
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.'))
      return this.classList.contains(selector.slice(1));
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector: string): FakeElement[] {
    return this.descendants().filter(node => node.matches(selector));
  }
  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  closest(selector: string): FakeElement | null {
    let node: FakeElement | null = this;
    while (node != null) {
      if (node.matches(selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
}

/**
 * CustomEvent 桩：RN jest 无此全局构造，而 editor 的 applyText 用它广播
 * `composer:text-changed`（dock 的 typeahead 重渲兜底就靠这条）。
 */
class FakeCustomEvent {
  readonly type: string;
  readonly detail: unknown;
  constructor(type: string, init?: {detail?: unknown}) {
    this.type = type;
    this.detail = init?.detail;
  }
}

/* ------------------------------------------------------------------ *
 * 测试台
 * ------------------------------------------------------------------ */

type PostedEnvelope = {v: number; type: string; payload: Record<string, unknown>};

const g = globalThis as unknown as Record<string, unknown>;
const originalWindow = g.window;
const originalDocument = g.document;
const originalRaf = g.requestAnimationFrame;
const originalCancelRaf = g.cancelAnimationFrame;
const originalCustomEvent = g.CustomEvent;

let fakeDocument: FakeElement & {
  documentElement: FakeElement;
  activeElement: FakeElement | null;
  readyState: string;
  createElement: (tag: string) => FakeElement;
  getElementById: (id: string) => FakeElement | null;
  querySelector: (selector: string) => FakeElement | null;
  querySelectorAll: (selector: string) => FakeElement[];
};
let fakeWindow: FakeElement & {
  ReactNativeWebView: {postMessage: (raw: string) => void};
  getSelection: () => {selectAll: () => void} | null;
};

let posted: PostedEnvelope[];
/** ready 上行到达的瞬间，转录 runtime 是否已完成 boot（state.ready）。 */
let transcriptBootedAtReady: Array<boolean | null>;
/** 全文档监听注册序（`目标标签:事件名`），装配序红线的证据面。 */
let registrationLog: string[];
let rafQueue: Array<() => void>;
/** 转录 runtime 的模块级 state（隔离注册表内的同一实例）。 */
let transcriptState: {ready: boolean} | null;

function flushRaf(): void {
  for (let round = 0; round < 10 && rafQueue.length > 0; round += 1) {
    const batch = rafQueue;
    rafQueue = [];
    for (const cb of batch) cb();
  }
}

function mk(id: string, parent?: FakeElement): FakeElement {
  const node = fakeDocument.createElement('div');
  node.id = id;
  node.label = `#${id}`;
  if (parent != null) parent.appendChild(node);
  return node;
}

/**
 * 建出与 index.html 同形的壳。两个开关各自制造一种「装配失败」真因，
 * 供入口层 ready 闸门验证（真因而非 mock：pickElements 未命中 / host 未命中都是生产路径）。
 *
 * 列表视图随「会话列表进 WebView」回滚整体退役：壳里不再有 #session-list，
 * 入口也不再有 sessionList.mount()（见下方 describe）。
 */
function buildShell(
  opts: {dockShell?: boolean; composerHost?: boolean} = {},
): void {
  const dockShell = opts.dockShell !== false;
  const composerHost = opts.composerHost !== false;
  const app = mk('app');

  if (dockShell) {
    const dock = mk('composer-dock', app);
    mk('composer-hint-row', dock);
    mk('composer-error', dock);
    const box = mk('composer-box', dock);
    mk('composer-chips', box);
    const area = mk('composer-input-area', box);
    mk('composer-typeahead', area);
    if (composerHost) mk('composer-input', area);
    mk('composer-toolbar', area);
  } else if (composerHost) {
    // 只留 composer 挂载点：dock 的 pickElements 必然未命中 → mount() 返回 false
    mk('composer-input', app);
  }

  fakeDocument.appendChild(app);
}

/**
 * 装载一份干净的 main.ts 并让其顶层装配真的跑一遍。
 *
 * isolateModules 的理由：main.ts 的全部断言对象都是**模块级**的（顶层 post / dock /
 * 闸门输入 composerRuntime.mounted），不换注册表就没有「第二个装配」可言。
 *
 * 先 require 两个旧 bridge 再清空注册序日志：bridge.ts 在**模块求值期**就自挂了
 * document:visibilitychange（可见性上报，与装配序无关）。ESM import 会被提升到 main.ts
 * 体之前，那条注册会挤在日志第一条，把「先绑后装」的真相对比淹掉。借 isolateModules 的
 * 模块缓存把 import 期副作用先结清，之后日志里剩下的就只是 main.ts **装配体**的注册序。
 */
function loadEntry(): void {
  jest.isolateModules(() => {
    transcriptState = require('@web/chat-transcript/webview/runtime/state/state')
      .state;
    require('@web/chat-transcript/webview/runtime/bridge');
    require('@web/composer-input/webview/runtime/bridge');
    registrationLog = [];
    require('@web/chat-conversation/webview/main');
  });
}

function readyEnvelopes(): PostedEnvelope[] {
  return posted.filter(msg => msg.type === 'ready');
}

/** 入口源码（装配序断言面；dist 侧的同类断言在 boot-script.test.ts）。 */
function mainSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('node:fs').readFileSync(
    require('node:path').join(
      __dirname,
      '../src/web/chat-conversation/webview/main.ts',
    ),
    'utf8',
  ) as string;
}

beforeEach(() => {
  posted = [];
  transcriptBootedAtReady = [];
  registrationLog = [];
  rafQueue = [];
  transcriptState = null;
  g.requestAnimationFrame = (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  g.cancelAnimationFrame = () => {};
  g.CustomEvent = FakeCustomEvent;

  const doc = new FakeElement('#document');
  doc.label = 'document';
  doc.documentElement = new FakeElement('html');
  doc.activeElement = null;
  doc.readyState = 'complete';
  doc.createElement = (tag: string) => new FakeElement(tag);
  doc.getElementById = (id: string) => doc.querySelector(`#${id}`);
  doc.querySelector = (selector: string) =>
    doc.descendants().find(n => n.matches(selector)) ?? null;
  doc.querySelectorAll = (selector: string) =>
    doc.descendants().filter(n => n.matches(selector));

  const win = new FakeElement('window');
  win.label = 'window';
  win.ReactNativeWebView = {
    postMessage: (raw: string) => {
      const envelope = JSON.parse(raw) as PostedEnvelope;
      posted.push(envelope);
      // 装配序的第二条红线：ready 必须发在两 runtime 均 boot 完成**之后**。
      // 快照 state.ready 而不是事后查——事后查分不出「先发 ready 后 boot」与「先 boot 后 ready」。
      if (envelope.type === 'ready') {
        transcriptBootedAtReady.push(
          transcriptState == null ? null : transcriptState.ready === true,
        );
      }
    },
  };
  win.getSelection = () => ({selectAll: () => {}});

  fakeDocument = doc as unknown as typeof fakeDocument;
  fakeWindow = win as unknown as typeof fakeWindow;
  g.document = fakeDocument;
  g.window = fakeWindow;
});

afterEach(() => {
  flushRaf();
  g.window = originalWindow;
  g.document = originalDocument;
  g.requestAnimationFrame = originalRaf;
  g.cancelAnimationFrame = originalCancelRaf;
  g.CustomEvent = originalCustomEvent;
});

/* ------------------------------------------------------------------ *
 * ① 单 ready（异步分支：readyState === 'loading'）
 * ------------------------------------------------------------------ */

describe('单 ready 上行（T-CE-1）', () => {
  it('T-CE-1：DOMContentLoaded 后恰好一条 ready（v:2 / u1 / 含 composer-dock）', () => {
    fakeDocument.readyState = 'loading';
    buildShell();
    loadEntry();

    // 装配跑完但 DOM 未就绪：此刻一条都不许发（两 runtime 都还没 boot）
    expect(readyEnvelopes()).toEqual([]);

    // 真浏览器在 DOMContentLoaded 派发时 readyState 已是 interactive；桩照此推进，
    // 这样 payload.readyState 断言的是「发 ready 那一刻的真实文档态」而非桩的初值。
    fakeDocument.readyState = 'interactive';
    fakeDocument.dispatch('DOMContentLoaded');

    const ready = readyEnvelopes();
    expect(ready).toHaveLength(1);
    expect(ready[0].v).toBe(2);
    expect(ready[0].payload.version).toBe('u1');
    expect(ready[0].payload.capabilities).toContain('composer-dock');
    // 派发 DOMContentLoaded 时真浏览器的 readyState 已是 interactive
    expect(ready[0].payload.readyState).toBe('interactive');
    // 整轮装配只有 ready 一条上行（两 runtime 均 emitReady:false，不许夹带别的）
    expect(posted.map(m => m.type)).toEqual(['ready']);
  });

  it('T-CE-2：ready 发在转录 runtime boot 完成之后（入口回调注册序靠后）', () => {
    fakeDocument.readyState = 'loading';
    buildShell();
    loadEntry();

    fakeDocument.dispatch('DOMContentLoaded');

    // 入口的 DOMContentLoaded 回调注册在 createTranscriptRuntime 之后，故同一次派发里
    // transcript 的 boot 先跑完。顺序若被倒过来（本回调提前注册），这里就是 false。
    expect(transcriptBootedAtReady).toEqual([true]);
  });
});

/* ------------------------------------------------------------------ *
 * ② 单次通道注册（document + window 各恰一次）
 * ------------------------------------------------------------------ */

describe('宿主通道单次注册（T-CE-3）', () => {
  it('T-CE-3：装配后 document / window 的 message 监听各恰 1', () => {
    fakeDocument.readyState = 'loading';
    buildShell();
    loadEntry();

    // 两 runtime 工厂都以 bindChannel:false 调用，通道注册权只交出入口这一次。
    // 计数多于 1 即意味着某一路又自己绑了一遍——那会让每条下行被处理两次
    // （现网症状：划词粘贴重复插入、dockAction 双发）。
    expect(fakeDocument.countListeners('message')).toBe(1);
    expect(fakeWindow.countListeners('message')).toBe(1);
  });

  it('T-CE-4：通道注册先于两 runtime 装配（装配序红线：先绑后装）', () => {
    fakeDocument.readyState = 'loading';
    buildShell();
    loadEntry();

    // 红线的可观测形态：全文档第一条监听注册必须是 message（通道）。挪到两工厂之后，
    // 先落地的就会是转录 boot 的 DOMContentLoaded 或编辑器的 selectionchange。
    expect(registrationLog[0]).toBe('document:message');
    expect(registrationLog[1]).toBe('window:message');
    expect(registrationLog.filter(item => item.endsWith(':message'))).toHaveLength(
      2,
    );
  });
});

/* ------------------------------------------------------------------ *
 * ③ 同步分支同构（readyState 非 loading）
 * ------------------------------------------------------------------ */

describe('同步分支同构（T-CE-5）', () => {
  it('T-CE-5：readyState 非 loading 时不注册 DOMContentLoaded，import 即发同一条 ready', () => {
    fakeDocument.readyState = 'complete';
    buildShell();
    loadEntry();

    // 同步分支：ready 在 import 返回前就已发出
    const ready = readyEnvelopes();
    expect(ready).toHaveLength(1);
    expect(ready[0].v).toBe(2);
    expect(ready[0].payload.version).toBe('u1');
    expect(ready[0].payload.capabilities).toContain('composer-dock');
    expect(ready[0].payload.readyState).toBe('complete');
    expect(transcriptBootedAtReady).toEqual([true]);
    // 同步分支不注册 DOMContentLoaded（再补发一次就是第二条 ready）
    expect(fakeDocument.countListeners('DOMContentLoaded')).toBe(0);
    // 通道口径与异步分支同构
    expect(fakeDocument.countListeners('message')).toBe(1);
    expect(fakeWindow.countListeners('message')).toBe(1);
    expect(registrationLog[0]).toBe('document:message');
  });
});

/* ------------------------------------------------------------------ *
 * ④ 装配失败闸门：任一面没装成就**不发** ready（cr1-P1-1 在入口层的行为验证）
 * ------------------------------------------------------------------ */

describe('ready 装配闸门（T-CE-6）', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('T-CE-6a：dock 壳未命中（mount 返回 false）→ 零 ready，交宿主 8s 兜底', () => {
    // 真因复现：壳 id 漂移/漏挂，pickElements 未命中（早年是静默 void，入口照发 ready，
    // 于是宿主把残缺文档当正常页面接上，8s 白屏兜底永远不触发）。
    fakeDocument.readyState = 'complete';
    buildShell({dockShell: false, composerHost: true});
    loadEntry();

    expect(posted).toEqual([]);
    // 闸口自己打中文诊断，别静默吞掉（静默是这次 bug 的根因）
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0][0])).toContain('装配未完成');
  });

  it('T-CE-6b：composer 挂载点未命中（mounted 为 false）→ 零 ready', () => {
    fakeDocument.readyState = 'complete';
    buildShell({dockShell: true, composerHost: false});
    loadEntry();

    expect(posted).toEqual([]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(String(consoleError.mock.calls[0][0])).toContain('composerMounted=false');
  });

  it('T-CE-6c：两面都没装成 → 仍只诊断一次、零 ready（不重复报错刷屏）', () => {
    fakeDocument.readyState = 'complete';
    buildShell({dockShell: false, composerHost: false});
    loadEntry();

    expect(posted).toEqual([]);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });

  it('T-CE-7：闸门在异步分支同样生效（DOMContentLoaded 之后才判定，不补发）', () => {
    fakeDocument.readyState = 'loading';
    buildShell({dockShell: false, composerHost: true});
    loadEntry();

    expect(readyEnvelopes()).toEqual([]);

    fakeDocument.dispatch('DOMContentLoaded');

    expect(posted).toEqual([]);
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ *
 * ⑤ 列表视图装配面已随回滚整体退役（会话列表回到 RN）
 * ------------------------------------------------------------------ */

describe('列表视图装配退役（T-CEL）', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('T-CEL-1：壳里没有列表子节点时仍零诊断、照常发 ready', () => {
    // 列表视图随 SPA 化回滚整体退役：入口不再 mount 列表，也就没有「列表未装配」
    // 这条诊断。少了它之后，正常路径一条 console.error 都不该打。
    fakeDocument.readyState = 'complete';
    buildShell();
    loadEntry();

    expect(readyEnvelopes()).toHaveLength(1);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('T-CEL-2：入口源码里不再有列表装配调用与列表诊断', () => {
    const entry = mainSource();
    expect(entry).not.toContain('sessionList.mount()');
    expect(entry).not.toContain('createConversationSessionList');
    expect(entry).not.toContain('viewState');
    expect(entry).not.toContain('listAction');
  });

  it('T-CEL-3：壳里不存在任何 #session-list* 节点（文档结构回退到纯对话）', () => {
    fakeDocument.readyState = 'complete';
    buildShell();
    loadEntry();

    for (const id of [
      'session-list',
      'session-list-header',
      'session-list-create',
      'session-list-rows',
      'session-list-empty',
    ]) {
      expect(fakeDocument.getElementById(id)).toBeNull();
    }
  });

  it('T-CEL-4：装配序 = 通道 → 两 runtime → dock.mount() → ready（无列表一档）', () => {
    fakeDocument.readyState = 'complete';
    buildShell();
    loadEntry();

    // 顶部文档注释里也逐条列了这五步，所以判序只在**注释之后**的正文里数。
    const source = mainSource();
    const entry = source.slice(source.indexOf('bindHostMessageChannel(dispatcher)'));
    const at = (needle: string) => entry.indexOf(needle);
    const channelAt = at('bindHostMessageChannel(dispatcher)');
    const transcriptAt = at('createTranscriptRuntime({');
    const composerAt = at('createComposerRuntime(');
    const dockAt = at('dock.mount()');
    expect(channelAt).toBe(0);
    expect(transcriptAt).toBeGreaterThan(channelAt);
    expect(composerAt).toBeGreaterThan(transcriptAt);
    expect(dockAt).toBeGreaterThan(composerAt);
    // ready 闸门只看 composerMounted + dockMounted（dockMounted 是简写属性名）
    expect(entry).toMatch(
      /shouldEmitConversationReady\(\{\s*composerMounted:\s*composerRuntime\.mounted,\s*dockMounted,?\s*\}\)/,
    );
  });
});