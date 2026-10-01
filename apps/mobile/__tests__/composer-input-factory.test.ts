/**
 * composer-input 装配工厂单测（T-CF 系列）。
 *
 * 断言面 = 工厂三个开关的**行为**（发不发 ready / 绑不绑通道 / 上不上报 heightChange）
 * 与默认参数下的旧包行为等价（宏链活依赖 composer-input 包，行为零变化是硬约束）。
 *
 * 环境说明：Jest 是 RN 环境、无 jsdom（本仓既有约定，见 mermaid-fullscreen.test 头注），
 * 故本文件自带一个极小 DOM 桩（只实现 editor / host 通道 / post 真实走到的成员），
 * 跑的是**真 runtime**（editor + bridge + shared 通道全不 mock）——负面断言因此有牙：
 * 同一条测高序列在默认参数下确实会 post heightChange。
 */
import {
  applyInit,
  destroyComposerEditor,
} from '@web/composer-input/webview/runtime/editor';
import {createComposerRuntime} from '@web/composer-input/webview/runtime/factory';

type AnyFn = (event?: unknown) => void;

class FakeStyle {
  props: Record<string, string> = {};
  setProperty(name: string, value: string): void {
    this.props[name] = value;
  }
}

class FakeClassList {
  readonly owner: FakeElement;
  constructor(owner: FakeElement) {
    this.owner = owner;
  }
  private setOf(): string[] {
    return this.owner.className.split(/\s+/).filter(Boolean);
  }
  private write(list: string[]): void {
    this.owner.className = list.join(' ');
  }
  add(name: string): void {
    const list = this.setOf();
    if (list.indexOf(name) < 0) {
      list.push(name);
    }
    this.write(list);
  }
  remove(name: string): void {
    this.write(this.setOf().filter(item => item !== name));
  }
  contains(name: string): boolean {
    return this.setOf().indexOf(name) >= 0;
  }
  toggle(name: string, force?: boolean): boolean {
    const on = force === undefined ? !this.contains(name) : force;
    if (on) {
      this.add(name);
    } else {
      this.remove(name);
    }
    return on;
  }
}

class FakeElement {
  readonly tagName: string;
  className = '';
  readonly style = new FakeStyle();
  readonly classList = new FakeClassList(this);
  readonly attributes: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  readonly listeners: Array<{type: string; fn: AnyFn}> = [];
  parent: FakeElement | null = null;
  innerHTML = '';
  // 布局读数（jsdom 缺的量，手动喂）
  scrollHeight = 0;
  scrollTop = 0;
  clientHeight = 56;
  // textarea 成员
  value = '';
  selectionStart = 0;
  selectionEnd = 0;
  placeholder = '';
  readOnly = false;
  spellcheck = true;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }
  appendChild(child: FakeElement): FakeElement {
    child.parent = this;
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeElement): void {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.parent = null;
    }
  }
  remove(): void {
    this.parent?.removeChild(this);
  }
  addEventListener(type: string, fn: AnyFn): void {
    this.listeners.push({type, fn});
  }
  removeEventListener(type: string, fn: AnyFn): void {
    const index = this.listeners.findIndex(
      item => item.type === type && item.fn === fn,
    );
    if (index >= 0) {
      this.listeners.splice(index, 1);
    }
  }
  dispatch(type: string, event?: unknown): void {
    for (const item of this.listeners.filter(l => l.type === type)) {
      item.fn(event);
    }
  }
  /** 对齐真 DOM：applyText 用它广播 `composer:text-changed`（同文档内 dock 监听方）。 */
  dispatchEvent(event: {type: string; detail?: unknown}): void {
    this.dispatch(event.type, event);
  }
  countListeners(type: string): number {
    return this.listeners.filter(item => item.type === type).length;
  }
  setSelectionRange(start: number, end: number): void {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
  focus(): void {}
  blur(): void {}
}

type PostedMessage = {v: number; type: string; payload: Record<string, unknown>};

/**
 * 最小 CustomEvent 桩：applyText 用 `new CustomEvent('composer:text-changed')` 广播
 * 文本变化，RN 的 Jest 环境（无 jsdom）没有这个全局构造。
 */
class FakeCustomEvent {
  readonly type: string;
  readonly detail: unknown;
  constructor(type: string, init?: {detail?: unknown}) {
    this.type = type;
    this.detail = init?.detail;
  }
}

/** ResizeObserver 桩：只记 observe / disconnect 次数，用于断言「装没装测高链」。 */
class FakeResizeObserver {
  observed = 0;
  disconnected = 0;
  observe(): void {
    this.observed += 1;
  }
  unobserve(): void {}
  disconnect(): void {
    this.disconnected += 1;
  }
}

const g = globalThis as unknown as Record<string, unknown>;

const originalWindow = g.window;
const originalDocument = g.document;
const originalRaf = g.requestAnimationFrame;
const originalCancelRaf = g.cancelAnimationFrame;
const originalCustomEvent = g.CustomEvent;
const originalResizeObserver = g.ResizeObserver;

let fakeDocument: FakeElement & {
  documentElement: FakeStyle;
  activeElement: FakeElement | null;
  createElement: (tag: string) => FakeElement;
  getElementById: (id: string) => FakeElement | null;
  querySelector: (selector: string) => FakeElement | null;
};
let fakeWindow: FakeElement;
let posted: PostedMessage[];
let rafQueue: Array<() => void>;
/** requestAnimationFrame 被请求过的总次数（测高链有没有空转就看它）。 */
let rafScheduled: number;
/** 本轮挂载期间构造出的 ResizeObserver 实例（按构造顺序）。 */
let resizeObservers: FakeResizeObserver[];

const METRICS = {
  fontSize: 16,
  lineHeight: 22,
  paddingH: 4,
  paddingV: 6,
  minHeight: 56,
  maxHeight: 160,
};

function makeRoot(): FakeElement {
  const root = new FakeElement('div');
  root.setAttribute('id', 'root');
  fakeDocument.appendChild(root);
  return root;
}

/** 已挂载编辑器：返回 root / 高亮层 / textarea 三个把手。 */
function mountedEditor() {
  const root = fakeDocument.querySelector('#root');
  if (root == null) {
    throw new Error('编辑器未挂载到 #root');
  }
  const editorRoot = root.children[0];
  const highlight = editorRoot.children[0];
  const input = editorRoot.children[1];
  return {editorRoot, highlight, input};
}

function typesOfPost(): string[] {
  return posted.map(msg => msg.type);
}

function postsOfType(type: string): PostedMessage[] {
  return posted.filter(msg => msg.type === type);
}

function flushRaf(): void {
  for (let round = 0; round < 10 && rafQueue.length > 0; round++) {
    const batch = rafQueue;
    rafQueue = [];
    for (const cb of batch) {
      cb();
    }
  }
}

/** 走一遍真实测高序列：挂载收尾 → 喂内容高度 → init（initialized 置位）→ 冲 rAF。 */
function driveHeightReport(height: number): void {
  flushRaf();
  const {highlight} = mountedEditor();
  highlight.scrollHeight = height;
  applyInit({
    mode: 'composer-token',
    disabled: false,
    metrics: METRICS,
    placeholder: '',
  });
  flushRaf();
}

/** 宿主下行消息（走真实 document/window 双通道解析）。 */
function sendHostMessage(message: unknown): void {
  fakeDocument.dispatch('message', {data: JSON.stringify(message)});
}

beforeEach(() => {
  posted = [];
  rafQueue = [];
  rafScheduled = 0;
  resizeObservers = [];
  g.requestAnimationFrame = (cb: () => void) => {
    rafScheduled += 1;
    rafQueue.push(cb);
    return rafQueue.length;
  };
  g.cancelAnimationFrame = () => {};
  g.CustomEvent = FakeCustomEvent;
  g.ResizeObserver = class extends FakeResizeObserver {
    constructor() {
      super();
      resizeObservers.push(this as unknown as FakeResizeObserver);
    }
  };

  const doc = new FakeElement('#document') as unknown as typeof fakeDocument;
  doc.documentElement = new FakeStyle() as unknown as FakeStyle;
  doc.activeElement = null;
  doc.createElement = (tag: string) => new FakeElement(tag);
  const byId: Record<string, FakeElement> = {};
  doc.getElementById = (id: string) => byId[id] ?? null;
  doc.querySelector = (selector: string) => byId[selector] ?? null;
  (doc as unknown as {__byId: Record<string, FakeElement>}).__byId = byId;

  const win = new FakeElement('window');
  (win as unknown as {ReactNativeWebView: {postMessage: (m: string) => void}})
    .ReactNativeWebView = {
    postMessage: (raw: string) => {
      posted.push(JSON.parse(raw) as PostedMessage);
    },
  };

  fakeDocument = doc;
  fakeWindow = win;
  g.document = fakeDocument;
  g.window = fakeWindow;
});

afterEach(() => {
  destroyComposerEditor();
  flushRaf();
  g.window = originalWindow;
  g.document = originalDocument;
  g.requestAnimationFrame = originalRaf;
  g.cancelAnimationFrame = originalCancelRaf;
  g.CustomEvent = originalCustomEvent;
  g.ResizeObserver = originalResizeObserver;
});

/** 让 #root 可被 getElementById / querySelector 命中。 */
function registerRoot(): FakeElement {
  const root = makeRoot();
  (fakeDocument as unknown as {__byId: Record<string, FakeElement>}).__byId[
    '#root'
  ] = root;
  (fakeDocument as unknown as {__byId: Record<string, FakeElement>}).__byId.root =
    root;
  return root;
}

describe('createComposerRuntime 默认参数（= 旧包现行为，宏链依赖零变化）', () => {
  it('T-CF1：挂载编辑器到 host 并透出 handle', () => {
    const root = registerRoot();
    const handle = createComposerRuntime('#root');

    expect(handle.mounted).toBe(true);
    expect(handle.parent).toBe(root as unknown as HTMLElement);
    expect(handle.heightReport).toBe(true);
    expect(handle.bindChannel).toBe(true);
    expect(handle.emitReady).toBe(true);

    const {editorRoot, input} = mountedEditor();
    expect(root.children).toContain(editorRoot);
    expect(editorRoot.className).toBe('composer-input');
    expect(input.tagName).toBe('TEXTAREA');
    expect(input.getAttribute('data-testid')).toBe('composer-input');
  });

  it('T-CF2：发 ready（v=1 单例 + version 载荷），且是第一条上行消息', () => {
    registerRoot();
    createComposerRuntime('#root');

    expect(typesOfPost()).toEqual(['ready']);
    expect(posted[0]).toEqual({v: 1, type: 'ready', payload: {version: 1}});
  });

  it('T-CF3：绑 host 消息通道（document + window 双注册，单次），下行 setText 生效', () => {
    registerRoot();
    createComposerRuntime('#root');

    expect(fakeDocument.countListeners('message')).toBe(1);
    expect(fakeWindow.countListeners('message')).toBe(1);

    sendHostMessage({v: 1, type: 'setText', payload: {text: '宿主写入'}});
    sendHostMessage({v: 1, type: 'setDisabled', payload: {disabled: true}});

    const {input} = mountedEditor();
    expect(input.value).toBe('宿主写入');
    expect(input.readOnly).toBe(true);
  });

  it('T-CF4：heightReport 默认开启——init 后测高发 heightChange（负面断言的对照组）', () => {
    registerRoot();
    createComposerRuntime('#root');

    driveHeightReport(100);

    expect(postsOfType('heightChange')).toEqual([
      {v: 1, type: 'heightChange', payload: {height: 100}},
    ]);
  });

  it('T-CF5：host 支持元素直通（合成包按元素挂载的用法）', () => {
    const root = registerRoot();
    createComposerRuntime(root as unknown as HTMLElement);
    expect(mountedEditor().editorRoot.parent).toBe(root);
    expect(typesOfPost()).toEqual(['ready']);
  });

  it('T-CF6：host 未命中时跳过挂载，但仍绑通道 + 发 ready（旧 main.ts 的 null 守卫口径）', () => {
    const handle = createComposerRuntime('#missing-root');

    expect(handle.mounted).toBe(false);
    expect(handle.parent).toBeNull();
    expect(fakeDocument.countListeners('message')).toBe(1);
    expect(typesOfPost()).toEqual(['ready']);
  });
});

describe('createComposerRuntime heightReport:false（合成包：高度文档内消化）', () => {
  it('T-CF7：同一条测高序列零 heightChange 上行', () => {
    registerRoot();
    createComposerRuntime('#root', {heightReport: false});

    driveHeightReport(100);
    driveHeightReport(140);

    expect(postsOfType('heightChange')).toEqual([]);
    // 其余链路不受影响：ready 照发
    expect(typesOfPost()).toEqual(['ready']);
  });

  it('T-CF8：heightReport:false 下打字/选区等上行照常（只关高度链）', () => {
    registerRoot();
    createComposerRuntime('#root', {heightReport: false});

    const {input} = mountedEditor();
    applyInit({
      mode: 'composer-token',
      disabled: false,
      metrics: METRICS,
      placeholder: '',
    });
    flushRaf();
    input.value = '打字了';
    input.dispatch('input');
    flushRaf();

    expect(postsOfType('change')).toEqual([
      {v: 1, type: 'change', payload: {text: '打字了'}},
    ]);
    expect(postsOfType('heightChange')).toEqual([]);
  });
});

/**
 * 测高链闸门（r6-E-2）：heightReport:false 必须关掉的是**整条链**（rAF 不排、
 * ResizeObserver 不注册），不是只关掉最后一发消息；默认参数侧是对照组。
 */
describe('测高链闸门（r6-E-2）', () => {
  it('T-CF13：heightReport:false 时连续输入 N 次不产生 rAF 回调、RO 未 observe', () => {
    registerRoot();
    createComposerRuntime('#root', {heightReport: false});

    // 装配收尾（applyMetrics 会调 scheduleMeasure）就已经零 rAF
    expect(rafScheduled).toBe(0);
    expect(resizeObservers.length).toBe(0);

    const {input, highlight} = mountedEditor();
    applyInit({
      mode: 'composer-token',
      disabled: false,
      metrics: METRICS,
      placeholder: '',
    });
    flushRaf();
    expect(rafScheduled).toBe(0);

    for (let i = 1; i <= 5; i++) {
      input.value = `第${i}键`;
      highlight.scrollHeight = 60 + i;
      input.dispatch('input');
      flushRaf();
    }

    // 闸门在 scheduleMeasure 一层：逐键调用直接早退，一帧都没排
    expect(rafScheduled).toBe(0);
    // RO 压根没被构造/observe
    expect(resizeObservers.length).toBe(0);
    expect(postsOfType('heightChange')).toEqual([]);
    // 闸门只关测高：change 上行照跑，否则就成了「内核瘫了」而非「关测高链」
    expect(postsOfType('change').length).toBe(5);
  });

  it('T-CF14：默认参数对照组——RO 已 observe 高亮层且测高确实排 rAF', () => {
    registerRoot();
    createComposerRuntime('#root');

    expect(resizeObservers.length).toBe(1);
    expect(resizeObservers[0].observed).toBe(1);
    expect(rafScheduled).toBeGreaterThan(0);
  });
});

describe('applyText 广播 composer:text-changed（cr1-P2-7 editor 半边）', () => {
  it('T-CF15：内容变化分支派发事件，内容相同短路时不派发', () => {
    registerRoot();
    createComposerRuntime('#root');

    const seen: Array<{text: string; detail: unknown}> = [];
    fakeDocument.addEventListener('composer:text-changed', event => {
      seen.push({
        text: (event as {type: string}).type,
        detail: (event as {detail?: unknown}).detail,
      });
    });

    sendHostMessage({v: 1, type: 'setText', payload: {text: '宿主写入'}});
    expect(seen).toEqual([
      {text: 'composer:text-changed', detail: '宿主写入'},
    ]);

    // 同值 setText 不进变化分支 → 不派发（防浮层被无意义抖动）
    sendHostMessage({v: 1, type: 'setText', payload: {text: '宿主写入'}});
    expect(seen.length).toBe(1);

    // 旧包无监听方时是纯空发：事件只在 document 内派发，绝不跨桥（无对应 postMessage）
    expect(typesOfPost()).toEqual(['ready']);
  });
});

describe('createComposerRuntime emitReady:false（合成包：单 ready 由入口统一发）', () => {
  it('T-CF9：零 ready 上行', () => {
    registerRoot();
    createComposerRuntime('#root', {emitReady: false});

    expect(postsOfType('ready')).toEqual([]);
    expect(postsOfType('ready').length).toBe(0);
  });

  it('T-CF10：其余动作照旧（挂载 + 绑通道 + 高度上报）', () => {
    registerRoot();
    const handle = createComposerRuntime('#root', {emitReady: false});

    expect(handle.emitReady).toBe(false);
    expect(fakeDocument.countListeners('message')).toBe(1);
    driveHeightReport(100);
    expect(postsOfType('heightChange').length).toBe(1);
  });
});

describe('createComposerRuntime bindChannel:false（合成包：入口单次注册通道）', () => {
  it('T-CF11：不注册 document/window 双通道监听', () => {
    registerRoot();
    createComposerRuntime('#root', {bindChannel: false});

    expect(fakeDocument.countListeners('message')).toBe(0);
    expect(fakeWindow.countListeners('message')).toBe(0);
    // 编辑器自身的 document 级监听仍在（selectionchange，非 host 通道）
    expect(fakeDocument.countListeners('selectionchange')).toBe(1);
  });

  it('T-CF12：宿主消息不再被处理（无监听即无副作用），但 ready 照发', () => {
    registerRoot();
    createComposerRuntime('#root', {bindChannel: false});

    sendHostMessage({v: 1, type: 'setText', payload: {text: '不该写入'}});

    const {input} = mountedEditor();
    expect(input.value).toBe('');
    expect(typesOfPost()).toEqual(['ready']);
  });
});
