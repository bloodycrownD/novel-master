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

const g = globalThis as unknown as Record<string, unknown>;

const originalWindow = g.window;
const originalDocument = g.document;
const originalRaf = g.requestAnimationFrame;
const originalCancelRaf = g.cancelAnimationFrame;

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
  g.requestAnimationFrame = (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  g.cancelAnimationFrame = () => {};

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
