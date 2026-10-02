/**
 * chat-conversation dock 单测（T-CD 系列）。
 *
 * 两层断言：
 * 1. **纯判定层**（node 直测）：hintRow / error / chips 文案 / 发送态 / toolbar 禁用态 /
 *    dock 底 padding 六项判定；
 * 2. **DOM 层**（本仓既有做法：RN jest preset 无 jsdom，自带极小 DOM 桩，跑**真
 *    runtime**——composer 的 editor/bridge 与 dock 都不 mock，见
 *    `composer-input-factory.test.ts` 的同款桩）。断言 dock handler 的实际副作用：
 *    composerState 渲染分支、dockAction 派发、composerPaste / selectAll 落点。
 */
import {
  DOCK_PADDING_BASE,
  createConversationDock,
  resolveChipLabels,
  resolveDockBottomPadding,
  resolveErrorText,
  resolveHintRowVisible,
  resolveSendButtonState,
  resolveToolbarDisabled,
  resolveTypeaheadEnabled,
  shouldEmitConversationReady,
} from '@web/chat-conversation/webview/dock';
import {
  computeTypeaheadView,
  skillTypeaheadTag,
  TYPEAHEAD_LIMIT,
} from '@web/chat-conversation/webview/typeahead';
import {
  destroyComposerEditor,
  mountComposerEditor,
} from '@web/composer-input/webview/runtime/editor';
import {coerceComposerState} from '@web/chat-conversation/webview/dispatcher';
import type {
  ConversationComposerState,
  ConversationTypeaheadSource,
} from '@web/chat-conversation/webview/model';

/* ------------------------------------------------------------------ *
 * 极小 DOM 桩
 * ------------------------------------------------------------------ */

type AnyFn = (event?: unknown) => void;

class FakeStyle {
  readonly props: Record<string, string> = {};
  /** 直接赋值型内联样式（dock 的 paddingBottom / 按钮 fontSize 走这条）。 */
  fontSize = '';
  /**
   * paddingBottom **每次写入时** owner 身上是否带着 `dock--animated`。
   *
   * 这是首帧豁免（cr2-B-4）的唯一可观测面：本桩没有 CSS 引擎，「这次写入会不会带
   * 200ms 过渡」等价于「写入那一刻过渡类在不在」。记逐次快照而非末态，才能断言
   * 「重挂的**首次**写入不带过渡」而不是「后来某一帧不带」。
   */
  readonly paddingTransitionLog: boolean[] = [];
  private pad = '';

  constructor(private readonly owner: FakeElement) {}

  get paddingBottom(): string {
    return this.pad;
  }
  set paddingBottom(value: string) {
    this.pad = value;
    this.paddingTransitionLog.push(
      this.owner.classList.contains('dock--animated'),
    );
  }
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
  readonly style: FakeStyle;
  readonly classList = new FakeClassList(this);
  readonly attributes: Record<string, string> = {};
  /** dataset 桩（applyHostTheme 的 `root.dataset.nmMode` 写入）。 */
  readonly dataset: Record<string, string> = {};
  children: FakeElement[] = [];
  parentNode: FakeElement | null = null;
  listeners: Array<{type: string; fn: AnyFn}> = [];
  hidden = false;
  textContent = '';
  disabled = false;
  type = '';
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
  didSelect = false;
  didFocus = false;
  didBlur = false;
  private html = '';
  /** innerHTML 写入次数（无 MutationObserver，用写次数当「重渲了一次」的代理）。 */
  innerHTMLWrites = 0;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
    // FakeStyle 回指 owner（要读 classList 记 padding 写入是否带过渡类），必须在
    // classList 之后建：classList 是字段初始化器，先于构造函数体跑。
    this.style = new FakeStyle(this);
  }

  get innerHTML(): string {
    return this.html;
  }

  /**
   * innerHTML 写入：只把 `<div class="...">` 段落落成子节点（dock 唯一依赖 innerHTML
   * 反查的形状就是 typeahead 行），其余原样存字符串供文案断言。
   */
  set innerHTML(value: string) {
    this.html = value;
    this.innerHTMLWrites += 1;
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
    for (const item of this.listeners.filter(l => l.type === type)) {
      item.fn(payload);
    }
  }
  /** DOM 标准入口（editor 的 applyText 走 document.dispatchEvent 派 CustomEvent）。 */
  dispatchEvent(event: {type: string}): boolean {
    this.dispatch(event.type, {target: this});
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
    this.didSelect = true;
  }
  focus(): void {
    fakeDocument.activeElement = this;
    this.didFocus = true;
  }
  blur(): void {
    this.didBlur = true;
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

type PostedMessage = {
  v: number;
  type: string;
  payload: Record<string, unknown>;
};

const g = globalThis as unknown as Record<string, unknown>;
const originalWindow = g.window;
const originalDocument = g.document;
const originalRaf = g.requestAnimationFrame;

let fakeDocument: FakeElement & {
  documentElement: FakeElement;
  activeElement: FakeElement | null;
  createElement: (tag: string) => FakeElement;
  getElementById: (id: string) => FakeElement | null;
  querySelector: (selector: string) => FakeElement | null;
  querySelectorAll: (selector: string) => FakeElement[];
};
let fakeWindow: FakeElement & {
  ReactNativeWebView: {postMessage: (raw: string) => void};
  getSelection: () => {selectAll: () => void} | null;
};
let posted: PostedMessage[];
let rafQueue: Array<() => void>;
let documentSelectAllCalls: number;

function flushRaf(): void {
  for (let round = 0; round < 10 && rafQueue.length > 0; round += 1) {
    const batch = rafQueue;
    rafQueue = [];
    for (const cb of batch) cb();
  }
}

function dockEl(id: string): FakeElement {
  const el = fakeDocument.getElementById(id);
  if (el == null) throw new Error(`dock 壳缺少 #${id}`);
  return el;
}

function toolbarBtn(cls: string): FakeElement {
  const btn = dockEl('composer-toolbar').querySelector(`.${cls}`);
  if (btn == null) throw new Error(`toolbar 缺少 .${cls}`);
  return btn;
}

/** 建出与 index.html 同形的 dock 壳 + composer 挂载点。 */
function buildShell(): void {
  const app = fakeDocument.createElement('div');
  app.id = 'app';
  const dock = fakeDocument.createElement('div');
  dock.id = 'composer-dock';
  const hintRow = fakeDocument.createElement('div');
  hintRow.id = 'composer-hint-row';
  const errorRow = fakeDocument.createElement('div');
  errorRow.id = 'composer-error';
  const box = fakeDocument.createElement('div');
  box.id = 'composer-box';
  const chips = fakeDocument.createElement('div');
  chips.id = 'composer-chips';
  const area = fakeDocument.createElement('div');
  area.id = 'composer-input-area';
  const typeahead = fakeDocument.createElement('div');
  typeahead.id = 'composer-typeahead';
  const inputHost = fakeDocument.createElement('div');
  inputHost.id = 'composer-input';
  const toolbar = fakeDocument.createElement('div');
  toolbar.id = 'composer-toolbar';

  area.appendChild(typeahead);
  area.appendChild(inputHost);
  area.appendChild(toolbar);
  box.appendChild(chips);
  box.appendChild(area);
  dock.appendChild(hintRow);
  dock.appendChild(errorRow);
  dock.appendChild(box);
  app.appendChild(dock);
  fakeDocument.appendChild(app);

  // composer runtime 先挂载（真实顺序：两工厂 → dock handler）
  mountComposerEditor(inputHost as unknown as HTMLElement, {
    heightReport: false,
  });
}

function textarea(): FakeElement {
  const el = fakeDocument.querySelector('.composer-input__input');
  if (el == null) throw new Error('composer textarea 未挂出');
  return el;
}

function stateOf(
  patch: Record<string, unknown> = {},
): ConversationComposerState {
  return coerceComposerState({
    inputDisabled: false,
    hasModel: true,
    sendDisabled: false,
    running: false,
    fullscreenEnabled: true,
    placeholder: '输入消息…',
    chips: [],
    keyboardUp: false,
    ...patch,
  });
}

function dockActions(): string[] {
  return posted
    .filter(msg => msg.type === 'dockAction')
    .map(msg => String(msg.payload.action));
}

const SKILL = (patch: Record<string, unknown> = {}) => ({
  name: 'refactor',
  description: '重构',
  domain: 'project',
  overridden: false,
  disabled: false,
  valid: true,
  effective: true,
  ...patch,
});

const SOURCE: ConversationTypeaheadSource = {
  files: [
    {path: 'src/app.ts', kind: 'file'},
    {path: 'src/lib', kind: 'dir'},
  ],
  skills: [SKILL(), SKILL({name: 'review', domain: 'global'})],
} as unknown as ConversationTypeaheadSource;

beforeEach(() => {
  posted = [];
  rafQueue = [];
  documentSelectAllCalls = 0;
  g.requestAnimationFrame = (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  g.cancelAnimationFrame = () => {};

  const doc = new FakeElement('#document');
  doc.documentElement = new FakeElement('html');
  doc.activeElement = null;
  doc.createElement = (tag: string) => new FakeElement(tag);
  doc.getElementById = (id: string) => doc.querySelector(`#${id}`);
  doc.querySelector = (selector: string) =>
    doc.descendants().find(n => n.matches(selector)) ?? null;
  doc.querySelectorAll = (selector: string) =>
    doc.descendants().filter(n => n.matches(selector));

  const win = new FakeElement('window');
  win.ReactNativeWebView = {
    postMessage: (raw: string) => {
      posted.push(JSON.parse(raw) as PostedMessage);
    },
  };
  win.getSelection = () => ({
    selectAll: () => {
      documentSelectAllCalls += 1;
    },
  });

  fakeDocument = doc as unknown as typeof fakeDocument;
  fakeWindow = win as unknown as typeof fakeWindow;
  g.document = fakeDocument;
  g.window = fakeWindow;

  buildShell();
});

afterEach(() => {
  destroyComposerEditor();
  flushRaf();
  g.window = originalWindow;
  g.document = originalDocument;
  g.requestAnimationFrame = originalRaf;
  g.cancelAnimationFrame = originalRaf;
});

/* ------------------------------------------------------------------ *
 * 纯判定层
 * ------------------------------------------------------------------ */

describe('dock 纯判定（T-CD）', () => {
  it('T-CD-01：底 padding = keyboardUp ? 0 : max(8, safeAreaBottom)', () => {
    expect(DOCK_PADDING_BASE).toBe(8);
    expect(resolveDockBottomPadding(false, 0)).toBe(8);
    expect(resolveDockBottomPadding(false, 34)).toBe(34);
    expect(resolveDockBottomPadding(false, 3)).toBe(8);
    expect(resolveDockBottomPadding(true, 34)).toBe(0);
    expect(resolveDockBottomPadding(true, 0)).toBe(0);
  });

  it('T-CD-02：hintRow 判据是 !hasModel，运行态（inputDisabled）不得误显', () => {
    expect(resolveHintRowVisible(stateOf({hasModel: true}))).toBe(false);
    expect(
      resolveHintRowVisible(
        stateOf({hasModel: true, running: true, inputDisabled: true}),
      ),
    ).toBe(false);
    expect(resolveHintRowVisible(stateOf({hasModel: false}))).toBe(true);
    // 首条 composerState 到达前不渲染（避免闪现）
    expect(resolveHintRowVisible(null)).toBe(false);
  });

  it('T-CD-03：error 行空串即不渲染', () => {
    expect(resolveErrorText(stateOf({}))).toBe('');
    expect(resolveErrorText(stateOf({error: '上一轮失败'}))).toBe('上一轮失败');
    expect(resolveErrorText(null)).toBe('');
  });

  it('T-CD-04：chips 文案走 core 真源（workplace 降级为「规则:<path>」）', () => {
    expect(
      resolveChipLabels([
        {
          source: 'workplace',
          name: 'src',
          path: 'src/a.ts',
          type: 'text',
          content: null,
        },
        {
          source: 'attach',
          name: 'b.ts',
          path: 'b.ts',
          type: 'text',
          content: null,
          action: 'write',
        },
      ] as never),
    ).toEqual(['规则:src/a.ts', '创建:b.ts']);
    expect(resolveChipLabels(undefined)).toEqual([]);
  });

  it('T-CD-05：发送态三形态（sendDisabled 置灰 / running danger+终止 / 否则 primary）', () => {
    expect(resolveSendButtonState(stateOf({}))).toEqual({
      disabled: false,
      running: false,
      variant: 'primary',
      action: 'send',
    });
    expect(resolveSendButtonState(stateOf({running: true}))).toEqual({
      disabled: false,
      running: true,
      variant: 'danger',
      action: 'terminate',
    });
    expect(resolveSendButtonState(stateOf({sendDisabled: true}))).toEqual({
      disabled: true,
      running: false,
      variant: 'disabled',
      action: 'send',
    });
  });

  it('T-CD-06：toolbar 禁用态：⛶ 看 fullscreenEnabled，@/$ 看 inputDisabled', () => {
    expect(resolveToolbarDisabled(stateOf({}))).toEqual({
      fullscreen: false,
      atPicker: false,
      skillPicker: false,
    });
    expect(
      resolveToolbarDisabled(
        stateOf({fullscreenEnabled: false, inputDisabled: true}),
      ),
    ).toEqual({fullscreen: true, atPicker: true, skillPicker: true});
    // 未收到 composerState 前全部禁用（点不动）
    expect(resolveToolbarDisabled(null)).toEqual({
      fullscreen: true,
      atPicker: true,
      skillPicker: true,
    });
  });

  it('T-CD-07：typeahead 展开判据 = !inputDisabled', () => {
    expect(resolveTypeaheadEnabled(stateOf({}))).toBe(true);
    expect(resolveTypeaheadEnabled(stateOf({inputDisabled: true}))).toBe(false);
    expect(resolveTypeaheadEnabled(null)).toBe(false);
  });

  it('T-CD-23：ready 闸门四组合真值表——两面都装成才发 ready', () => {
    expect(
      shouldEmitConversationReady({composerMounted: true, dockMounted: true}),
    ).toBe(true);
    expect(
      shouldEmitConversationReady({composerMounted: true, dockMounted: false}),
    ).toBe(false);
    expect(
      shouldEmitConversationReady({composerMounted: false, dockMounted: true}),
    ).toBe(false);
    expect(
      shouldEmitConversationReady({composerMounted: false, dockMounted: false}),
    ).toBe(false);
  });
});

describe('typeahead web 自治纯逻辑（T-CD）', () => {
  it('T-CD-08：@ 路径按 query 过滤、目录带尾斜杠、token 经 core 规范化（落库带前导 /）', () => {
    const view = computeTypeaheadView('看 @src', 6, SOURCE, true);
    expect(view?.trigger).toBe('@');
    expect(view?.start).toBe(2);
    expect(view?.query).toBe('src');
    // label 用候选源原样 path；token 走 `formatComposerAtPathToken`（store 规范化加前导 /）
    expect(view?.items).toEqual([
      {label: '📄src/app.ts', token: '@/src/app.ts', tag: ''},
      {label: '📁src/lib/', token: '@/src/lib/', tag: ''},
    ]);
  });

  it('T-CD-09：$ 技能带来源 tag，禁用/全局/覆盖三态文案对齐现网', () => {
    expect(skillTypeaheadTag(SKILL({disabled: true}) as never)).toBe('已关闭');
    expect(skillTypeaheadTag(SKILL({domain: 'global'}) as never)).toBe('全局');
    expect(skillTypeaheadTag(SKILL({overridden: true}) as never)).toBe(
      '项目 · 覆盖全局',
    );
    expect(skillTypeaheadTag(SKILL() as never)).toBe('项目');
    const view = computeTypeaheadView('用 $re', 6, SOURCE, true);
    expect(view?.trigger).toBe('$');
    expect(view?.items).toEqual([
      {label: '$ refactor', token: '$refactor', tag: '项目'},
      {label: '$ review', token: '$review', tag: '全局'},
    ]);
  });

  it('T-CD-10：最多 5 条；无活跃 token / 禁用 / 候选空一律不展开', () => {
    const many = {
      files: Array.from({length: 9}, (_, i) => ({
        path: `f${i}.ts`,
        kind: 'file' as const,
      })),
      skills: [],
    };
    expect(computeTypeaheadView('@', 1, many, true)?.items).toHaveLength(
      TYPEAHEAD_LIMIT,
    );
    expect(computeTypeaheadView('没有触发字符', 6, SOURCE, true)).toBeNull();
    expect(computeTypeaheadView('@s', 2, SOURCE, false)).toBeNull();
    expect(
      computeTypeaheadView('@s', 2, {files: [], skills: []}, true),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * DOM 层：dock handler 副作用
 * ------------------------------------------------------------------ */

describe('mountConversationDock（DOM 层）', () => {
  it('T-CD-11：装配 toolbar 五元素（spacer + ⛶ + @ + $ + 发送），⛶ 字号 20', () => {
    const dock = createConversationDock((type, payload) =>
      posted.push({v: 2, type, payload: payload ?? {}}),
    );
    // 装配成功要把 true 交回入口（ready 闸门的输入之一）
    expect(dock.mount()).toBe(true);

    const toolbar = dockEl('composer-toolbar');
    expect(toolbar.querySelector('.toolbar__spacer')).not.toBeNull();
    expect(toolbar.querySelector('.toolbar__fullscreen')).not.toBeNull();
    expect(toolbar.querySelector('.toolbar__at')).not.toBeNull();
    expect(toolbar.querySelector('.toolbar__skill')).not.toBeNull();
    expect(toolbar.querySelector('.toolbar__send')).not.toBeNull();
    expect(toolbarBtn('toolbar__fullscreen').style.fontSize).toBe('20px');
    expect(toolbarBtn('toolbar__at').style.fontSize).toBe('16px');
    // 幂等：重复 mount 不重复装配
    expect(dock.mount()).toBe(true);
    expect(toolbar.querySelectorAll('.toolbar__send')).toHaveLength(1);
    dock.unmount();
  });

  it('T-CD-12：壳缺元素时静默跳过（不抛，与 composer 工厂的 null 守卫同口径）', () => {
    for (const id of [
      'composer-hint-row',
      'composer-error',
      'composer-chips',
      'composer-typeahead',
      'composer-toolbar',
    ]) {
      fakeDocument.querySelector(`#${id}`)?.remove();
    }
    const dock = createConversationDock(() => {});
    // 缺壳必须**如实上报 false**（静默 void 会让入口照发 ready，宿主 8s 兜底失效）
    expect(dock.mount()).toBe(false);
    expect(() => {
      dock.applyRoute({kind: 'composerState', state: stateOf()});
    }).not.toThrow();
    dock.unmount();
  });
});

describe('composerState 渲染分支（T-CU6）', () => {
  it('T-CD-13：!hasModel 显 hintRow 并可点 → dockAction.needModel（走 v:2）', () => {
    const dock = createConversationDock((type, payload) =>
      posted.push({v: 2, type, payload: payload ?? {}}),
    );
    dock.mount();
    dock.applyRoute({kind: 'composerState', state: stateOf({hasModel: false})});

    expect(dockEl('composer-hint-row').hidden).toBe(false);
    dockEl('composer-hint-row').dispatch('click');
    expect(dockActions()).toEqual(['needModel']);
    expect(posted[posted.length - 1].v).toBe(2);
    dock.unmount();
  });

  it('T-CD-14：error 行按字段显隐；chips 渲染且不随 inputDisabled 置灰', () => {
    const dock = createConversationDock(() => {});
    dock.mount();
    dock.applyRoute({kind: 'composerState', state: stateOf({})});
    expect(dockEl('composer-error').hidden).toBe(true);
    expect(dockEl('composer-chips').hidden).toBe(true);

    dock.applyRoute({
      kind: 'composerState',
      state: stateOf({
        inputDisabled: true,
        error: '上一轮失败',
        chips: [
          {
            source: 'workplace',
            name: 'src',
            path: 'src/a.ts',
            type: 'text',
            content: null,
          },
        ],
      }),
    });
    expect(dockEl('composer-error').hidden).toBe(false);
    expect(dockEl('composer-error').textContent).toBe('上一轮失败');
    expect(dockEl('composer-chips').hidden).toBe(false);
    // chips 纯展示：HTML 里只有 chip 结构，无置灰 class
    const chipsHtml = dockEl('composer-chips').innerHTML;
    expect(chipsHtml).toContain('规则:src/a.ts');
    expect(chipsHtml).not.toContain('disabled');
    // inputDisabled 同时禁掉 @/$ 与 input 只读
    expect(textarea().readOnly).toBe(true);
    expect(toolbarBtn('toolbar__at').disabled).toBe(true);
    // 禁用态不挂 `.composer-input--disabled`（整块淡出是旧 RN 链 styles 搬入的产物，
    // 现网 chat 链的 TextInput 从无此变体；置灰语义只由 readOnly 承担）。
    // 扫整棵输入区子树：toggle 打在 textarea 的父节点上，只查壳节点会漏。
    const inputArea = [
      dockEl('composer-input'),
      ...dockEl('composer-input').descendants(),
    ];
    expect(
      inputArea.some(el => (el.className ?? '').indexOf('disabled') >= 0),
    ).toBe(false);
    dock.unmount();
  });

  it('T-CD-15：placeholder 落到 input；running 时发送钮 danger + 终止', () => {
    const dock = createConversationDock(() => {});
    dock.mount();
    dock.applyRoute({
      kind: 'composerState',
      state: stateOf({placeholder: '选择模型后可发送'}),
    });
    expect(textarea().placeholder).toBe('选择模型后可发送');

    dock.applyRoute({kind: 'composerState', state: stateOf({running: true})});
    const send = toolbarBtn('toolbar__send');
    expect(send.className).toContain('toolbar__send--danger');
    expect(send.getAttribute('aria-label')).toBe('终止');
    dock.unmount();
  });

  it('T-CD-16：键盘态翻转 dock 底 padding 在 0 ↔ max(8, safeAreaBottom) 间切换', () => {
    const dock = createConversationDock(() => {});
    dock.mount();
    dock.applyRoute({kind: 'init', safeAreaBottom: 34});
    expect(dockEl('composer-dock').style.paddingBottom).toBe('34px');

    dock.applyRoute({
      kind: 'composerState',
      state: stateOf({keyboardUp: true}),
    });
    expect(dockEl('composer-dock').style.paddingBottom).toBe('0px');

    dock.applyRoute({
      kind: 'composerState',
      state: stateOf({keyboardUp: false}),
    });
    expect(dockEl('composer-dock').style.paddingBottom).toBe('34px');
    dock.unmount();
  });
});

describe('dockAction 上行派发（v:2）', () => {
  it('T-CD-17：⛶ / @ / $ / 发送 四钮各派一个动作；运行态改派 terminate', () => {
    const dock = createConversationDock((type, payload) =>
      posted.push({v: 2, type, payload: payload ?? {}}),
    );
    dock.mount();
    dock.applyRoute({kind: 'composerState', state: stateOf()});

    toolbarBtn('toolbar__fullscreen').dispatch('click');
    toolbarBtn('toolbar__at').dispatch('click');
    toolbarBtn('toolbar__skill').dispatch('click');
    toolbarBtn('toolbar__send').dispatch('click');
    expect(dockActions()).toEqual([
      'fullscreen',
      'atPicker',
      'skillPicker',
      'send',
    ]);

    dock.applyRoute({kind: 'composerState', state: stateOf({running: true})});
    toolbarBtn('toolbar__send').dispatch('click');
    expect(dockActions()).toEqual([
      'fullscreen',
      'atPicker',
      'skillPicker',
      'send',
      'terminate',
    ]);
    dock.unmount();
  });

  it('T-CD-18：禁用态按钮仍派动作（兜底在 host controller，web 侧不断链）', () => {
    const dock = createConversationDock((type, payload) =>
      posted.push({v: 2, type, payload: payload ?? {}}),
    );
    dock.mount();
    dock.applyRoute({
      kind: 'composerState',
      state: stateOf({fullscreenEnabled: false}),
    });
    expect(toolbarBtn('toolbar__fullscreen').disabled).toBe(true);
    toolbarBtn('toolbar__fullscreen').dispatch('click');
    expect(dockActions()).toEqual(['fullscreen']);
    dock.unmount();
  });
});

describe('composerPaste / selectAll（划词菜单链路）', () => {
  it('T-CD-19：未聚焦时先聚焦再在光标处插入，并上行 change 让草稿落库', () => {
    const dock = createConversationDock(() => {});
    dock.mount();
    dock.applyRoute({kind: 'composerState', state: stateOf()});

    const input = textarea();
    input.value = '你好';
    input.setSelectionRange(2, 2);
    expect(fakeDocument.activeElement).toBeNull();

    dock.applyRoute({kind: 'composerPaste', text: '世界'});
    expect(input.didFocus).toBe(true);
    expect(input.value).toBe('你好世界');
    expect(input.selectionStart).toBe(4);
    // 主动补发 change（applyText 期间 suppressChange 包裹，内核不自报）
    expect(posted.filter(msg => msg.type === 'change')).toEqual([
      {v: 1, type: 'change', payload: {text: '你好世界'}},
    ]);
    dock.unmount();
  });

  it('T-CD-20：空串粘贴零副作用', () => {
    const dock = createConversationDock(() => {});
    dock.mount();
    dock.applyRoute({kind: 'composerState', state: stateOf()});
    dock.applyRoute({kind: 'composerPaste', text: ''});
    expect(textarea().value).toBe('');
    expect(posted).toEqual([]);
    dock.unmount();
  });

  it('T-CD-28：inputDisabled 时划词粘贴被闸门挡下（零聚焦、零写入、零 change 上行）', () => {
    const dock = createConversationDock((type, payload) =>
      posted.push({v: 2, type, payload: payload ?? {}}),
    );
    dock.mount();
    // 运行中 / 未选模型态：宿主已把输入框置为只读，划词菜单却照样展示「粘贴」
    dock.applyRoute({
      kind: 'composerState',
      state: stateOf({inputDisabled: true, running: true}),
    });

    const input = textarea();
    input.value = '已有正文';
    input.setSelectionRange(4, 4);
    dock.applyRoute({kind: 'composerPaste', text: '注入'});

    expect(input.value).toBe('已有正文');
    expect(input.didFocus).toBe(false);
    expect(posted.filter(msg => msg.type === 'change')).toEqual([]);
    dock.unmount();
  });

  it('T-CD-21：selectAll 在输入框聚焦时选 textarea，否则选整篇文档', () => {
    const dock = createConversationDock(() => {});
    dock.mount();
    dock.applyRoute({kind: 'composerState', state: stateOf()});

    const input = textarea();
    input.value = '全选这段';
    input.focus();
    dock.applyRoute({kind: 'selectAll'});
    expect(documentSelectAllCalls).toBe(0);
    expect(input.didSelect).toBe(true);
    expect(input.selectionEnd).toBe(4);

    fakeDocument.activeElement = null;
    dock.applyRoute({kind: 'selectAll'});
    expect(documentSelectAllCalls).toBe(1);
    dock.unmount();
  });
});

describe('typeahead 点选（web 自治插入，零跨桥）', () => {
  it('T-CD-22：点选 @ 候选在同文档插入 token 并上行 change，不发 dockAction', () => {
    const dock = createConversationDock((type, payload) =>
      posted.push({v: 2, type, payload: payload ?? {}}),
    );
    dock.mount();
    dock.applyRoute({
      kind: 'composerState',
      state: stateOf({typeahead: SOURCE}),
    });

    const input = textarea();
    input.value = '看 @src/app.ts';
    input.setSelectionRange(15, 15);
    input.dispatch('input');
    flushRaf(); // 五源已收敛到 rAF 合并，浮层渲染落在下一帧
    expect(dockEl('composer-typeahead').hidden).toBe(false);
    expect(dockEl('composer-typeahead').innerHTML).toContain('src/app.ts');

    const rows =
      dockEl('composer-typeahead').querySelectorAll('.typeahead__row');
    expect(rows.length).toBeGreaterThan(0);
    dockEl('composer-typeahead').dispatch('click', {target: rows[0]});

    // 区间 [start, cursor) 被完整 token 替换 + 尾空格（buildTokenInsertion 口径，
    // token 经 core 的 `formatComposerAtPathToken` 规范化成 store 路径带前导 /）
    expect(input.value).toBe('看 @/src/app.ts ');
    // 两条 change：先打字那条（input 事件，v:1 走 composer 单例），后点选插入那条
    // （applyText 的 suppressChange 期间由 dock 主动补发，同样 v:1）
    const changes = posted.filter(msg => msg.type === 'change');
    expect(changes).toEqual([
      {v: 1, type: 'change', payload: {text: '看 @src/app.ts'}},
      {v: 1, type: 'change', payload: {text: '看 @/src/app.ts '}},
    ]);
    expect(dockActions()).toEqual([]);
    dock.unmount();
  });
});

describe('typeahead 重渲收敛（r6-E-1 / cr1-P2-7）', () => {
  it('T-CD-24：五事件源同帧合并 + 同键短路：同 query 连发只写一次 innerHTML', () => {
    const dock = createConversationDock(() => {});
    dock.mount();
    dock.applyRoute({
      kind: 'composerState',
      state: stateOf({typeahead: SOURCE}),
    });

    const input = textarea();
    input.value = '看 @src';
    input.setSelectionRange(5, 5);
    input.focus();
    // 一次击键的典型连发：input + keyup + click + select + selectionchange
    input.dispatch('input');
    input.dispatch('keyup');
    input.dispatch('click');
    input.dispatch('select');
    fakeDocument.dispatch('selectionchange');
    flushRaf();

    const typeahead = dockEl('composer-typeahead');
    expect(typeahead.innerHTML).toContain('src/app.ts');
    const writes = typeahead.innerHTMLWrites;
    expect(writes).toBeGreaterThan(0);

    // 状态没变再来一轮：renderKey 相同 -> 一次都不许碰 DOM
    input.dispatch('input');
    input.dispatch('keyup');
    flushRaf();
    expect(typeahead.innerHTMLWrites).toBe(writes);
    dock.unmount();
  });

  it('T-CD-25：query 变化才重渲（键短路不误杀真实更新）', () => {
    const dock = createConversationDock(() => {});
    dock.mount();
    dock.applyRoute({
      kind: 'composerState',
      state: stateOf({typeahead: SOURCE}),
    });

    const input = textarea();
    input.value = '@s';
    input.setSelectionRange(2, 2);
    input.dispatch('input');
    flushRaf();
    const typeahead = dockEl('composer-typeahead');
    expect(typeahead.innerHTML).toContain('app.ts');
    const writes = typeahead.innerHTMLWrites;

    // 收窄 query：候选集变了，键必变，必须真重渲
    input.value = '@src/app';
    input.setSelectionRange(8, 8);
    input.dispatch('input');
    flushRaf();
    expect(typeahead.innerHTMLWrites).toBeGreaterThan(writes);
    expect(typeahead.innerHTML).toContain('app.ts');
    expect(typeahead.innerHTML).not.toContain('src/lib');
    dock.unmount();
  });

  it('T-CD-26：宿主 setText 的程序化写值（composer:text-changed）也驱动浮层重渲', () => {
    const dock = createConversationDock(() => {});
    dock.mount();
    dock.applyRoute({
      kind: 'composerState',
      state: stateOf({typeahead: SOURCE}),
    });

    const input = textarea();
    const typeahead = dockEl('composer-typeahead');
    input.value = '没有触发字符';
    input.setSelectionRange(6, 6);
    input.dispatch('input');
    flushRaf();
    expect(typeahead.hidden).toBe(true);

    // 程序化写值：内核不派 input/keyup，只靠 editor 往 document 补的 CustomEvent 兜住
    input.value = '回填 @src';
    input.setSelectionRange(7, 7);
    fakeDocument.dispatch('composer:text-changed');
    flushRaf();
    expect(typeahead.hidden).toBe(false);
    expect(typeahead.innerHTML).toContain('src/app.ts');
    dock.unmount();
  });
});

describe('装配序不变式（cr1-P1-1）', () => {
  it('T-CD-29：dock 先于 composer runtime 装配 = 输入区监听全丢（顺序是红线）', () => {
    // 入口的「先 composer runtime 后 dock.mount()」是红线：dock 在 bindEvents 里现查
    // textarea，编辑器还没挂出来时 input == null，五源 + composer:text-changed 一个都
    // 绑不上，且**此后不会补绑**。这里把 beforeEach 已挂好的编辑器拆掉重来，复现顺序倒置。
    destroyComposerEditor();
    const dock = createConversationDock(() => {});
    // 壳元素都在，mount 仍返回 true —— 装配失败信号只覆盖「壳没命中」，顺序倒置得靠行为断言
    expect(dock.mount()).toBe(true);
    mountComposerEditor(dockEl('composer-input') as unknown as HTMLElement, {
      heightReport: false,
    });

    dock.applyRoute({
      kind: 'composerState',
      state: stateOf({typeahead: SOURCE}),
    });
    const input = textarea();
    input.value = '看 @src';
    input.setSelectionRange(5, 5);
    input.focus();
    input.dispatch('input');
    flushRaf();
    // 监听没绑上 -> 浮层永远不展开（正常顺序下这里是 hidden=false）
    expect(dockEl('composer-typeahead').hidden).toBe(true);
    dock.unmount();
  });
});

describe('主题 fan-out（cr1-P1-6）', () => {
  it('T-CD-27：applyTheme 走真 applyHostTheme，--selection 落到 documentElement', () => {
    const dock = createConversationDock(() => {});
    dock.mount();
    dock.applyTheme({
      background: '#ffffff',
      text: '#111111',
      selection: '#3366ff',
    });

    const root = fakeDocument.documentElement;
    expect(root.style.getPropertyValue('--selection')).toBe('#3366ff');
    // 顺带证明走的是真 applyHostTheme（键序映射表），不是手写 setProperty
    expect(root.style.getPropertyValue('--bg')).toBe('#ffffff');
    expect(root.style.getPropertyValue('--text')).toBe('#111111');
    expect(root.dataset.nmMode).toBe('light');
    dock.unmount();
  });
});

describe('首帧豁免 dock--animated（cr2-B-4）', () => {
  it('T-CD-30：unmount→mount 重挂后，首帧 padding 写入不带 transition', () => {
    const dock = createConversationDock(() => {});
    const dockNode = dockEl('composer-dock');
    expect(dock.mount()).toBe(true);
    // 首拍：renderAll 已把 padding 定在初值，下一拍才启用 transition
    expect(dockNode.classList.contains('dock--animated')).toBe(false);
    flushRaf();
    expect(dockNode.classList.contains('dock--animated')).toBe(true);

    // unmount 不换 DOM（#composer-dock 是 index.html 常驻节点，unmount 只把 els 置空），
    // 所以过渡类会**原样留在节点上**——这正是重挂首帧带 200ms 过渡的成因。
    dock.unmount();
    expect(dockNode.classList.contains('dock--animated')).toBe(true);

    // 重挂：摘类必须在 renderAll 之前，否则这次首帧写 padding 就带着过渡（底部滑一下）
    const before = dockNode.style.paddingTransitionLog.length;
    expect(dock.mount()).toBe(true);
    const log = dockNode.style.paddingTransitionLog;
    expect(log.length).toBeGreaterThan(before);
    expect(log.slice(before)).toEqual([false]);
    // 豁免仍只活一拍：下一拍照常挂回过渡类（键盘抬起的补间不能被一并废掉）
    flushRaf();
    expect(dockNode.classList.contains('dock--animated')).toBe(true);
    dock.unmount();
  });

  it('T-CD-31：transcript-only 变体（#app.transcript-only 隐藏 dock）同链路豁免', () => {
    const app = fakeDocument.getElementById('app');
    if (app == null) throw new Error('壳缺少 #app');
    // 转录 only 变体：CSS 侧 #app.transcript-only 把 dock 整块隐藏（mount-and-hide，
    // 不是 skip mount——所以隐藏态下 renderAll 照样写 padding，豁免与可见性无关）
    app.classList.add('transcript-only');
    const dock = createConversationDock(() => {});
    const dockNode = dockEl('composer-dock');

    expect(dock.mount()).toBe(true);
    expect(dockNode.style.paddingTransitionLog).toEqual([false]);
    flushRaf();
    expect(dockNode.classList.contains('dock--animated')).toBe(true);

    // 隐藏 → 显示：变体切回普通形态，init 带 transcriptOnly:false 摘掉 #app 的类。
    // 跨隐藏态的这次补间此前零断言覆盖。
    dock.applyRoute({kind: 'init', safeAreaBottom: 34, transcriptOnly: true});
    expect(app.classList.contains('transcript-only')).toBe(true);
    dock.applyRoute({kind: 'init', safeAreaBottom: 34, transcriptOnly: false});
    expect(app.classList.contains('transcript-only')).toBe(false);
    expect(dockNode.style.paddingBottom).toBe('34px');

    // 变体路径同样会重挂：摘类在 renderAll 之前，隐藏与否都改不了这条
    dock.unmount();
    const before = dockNode.style.paddingTransitionLog.length;
    expect(dock.mount()).toBe(true);
    expect(dockNode.style.paddingTransitionLog.slice(before)).toEqual([false]);
    flushRaf();
    expect(dockNode.classList.contains('dock--animated')).toBe(true);
    dock.unmount();
  });
});
