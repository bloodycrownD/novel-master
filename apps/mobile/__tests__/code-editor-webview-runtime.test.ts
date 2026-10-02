/**
 * code-editor web 侧 runtime 的 change 合帧状态机单测（T-CE 系列，cr2-A-4）。
 *
 * 跑**真 runtime**（`@web/code-editor/webview/runtime/editor`），CodeMirror 6
 * 走最小 stub：只需 `EditorView.updateListener.of` 能把 update 回调喂进来 +
 * `state.doc.toString()` / `selection.main`，以及 `EditorState.create` 与
 * `Compartment` 的 of/reconfigure 形状。这样断言落在 editor.ts 自己的
 * 合帧/收口语义上，而不是 CM6 的内部行为。
 *
 * 环境：本仓 RN jest preset 锁 react-native-env.js（node 子类、无 DOM），
 * **无 jsdom / jest-environment-jsdom 依赖**，故自建极小 DOM 桩
 * （FakeElement/FakeStyle + flushRaf，与 `chat-conversation-dock.test.ts`
 * 同款形态——该文件头注释即本仓 DOM 桩口径声明）。
 *
 * 注：本文件 import `@web/...` 产生的 TS6307 噪声与既有三个 DOM 测试同源
 * （tsconfig include/exclude 形态），不进 typecheck 门。
 */

/* ------------------------------------------------------------------ *
 * CodeMirror 6 最小桩
 * ------------------------------------------------------------------ */

type AnyFn = (...args: any[]) => any;
/** 扩展标记：facet 类带语义标记，plain 类只是占位（编辑器不消费内容）。 */
const CM_FACET = '__cmFacet';
const CM_PLAIN = '__cmPlain';

jest.mock('@codemirror/state', () => {
  class Compartment {
    of(value: unknown) {
      return {[CM_PLAIN]: true, value};
    }
    reconfigure(value: unknown) {
      return {[CM_PLAIN]: true, value};
    }
  }
  return {
    Compartment,
    EditorState: {
      create(config: {
        doc: string;
        extensions?: unknown;
        selection?: {anchor: number; head: number};
      }) {
        const main = config.selection ?? {anchor: 0, head: 0};
        return {
          doc: {toString: () => config.doc},
          selection: {main: {from: main.anchor, to: main.head, ...main}},
          // extensions 必须原样带出去：EditorView 构造时靠它捞 updateListener /
          // domEventHandlers 两个 facet。
          extensions: config.extensions,
        };
      },
    },
  };
});

jest.mock('@codemirror/commands', () => ({
  defaultKeymap: [],
  historyKeymap: [],
  history: () => ({[CM_PLAIN]: true, value: 'history'}),
}));

jest.mock('@codemirror/language', () => ({
  HighlightStyle: {
    define: (spec: unknown) => ({[CM_PLAIN]: true, value: spec}),
  },
  syntaxHighlighting: () => ({[CM_PLAIN]: true, value: 'syntaxHighlighting'}),
}));

jest.mock('@codemirror/lang-json', () => ({
  json: () => ({[CM_PLAIN]: true, value: 'json'}),
}));

jest.mock('@codemirror/lang-markdown', () => ({
  markdown: () => ({[CM_PLAIN]: true, value: 'markdown'}),
}));

jest.mock('@codemirror/view', () => {
  /** 递归从 extensions 里捞出带 facet 标记的扩展（editor.ts 把它们平铺成数组）。 */
  function collect(extensions: unknown, sink: Record<string, unknown>): void {
    if (Array.isArray(extensions)) {
      for (const item of extensions) collect(item, sink);
      return;
    }
    if (extensions == null || typeof extensions !== 'object') return;
    const ext = extensions as Record<string, unknown>;
    if (ext[CM_FACET] === 'updateListener') {
      sink.updateListener = ext.fn as AnyFn;
    }
    if (ext[CM_FACET] === 'domEventHandlers') {
      sink.domHandlers = ext.handlers as Record<string, AnyFn>;
    }
  }

  class FakeEditorView {
    state: any;
    contentDOM: {blur: AnyFn; focus: AnyFn};
    hasFocus = false;
    destroyed = false;
    private updateListener: AnyFn | null = null;
    private domHandlers: Record<string, AnyFn> = {};

    constructor(config: any) {
      this.state = config.state;
      collect(config.state?.extensions, this as unknown as Record<string, unknown>);
      this.contentDOM = {
        blur: () => {
          this.hasFocus = false;
          this.domHandlers.blur?.();
        },
        focus: () => {
          this.hasFocus = true;
          this.domHandlers.focus?.();
        },
      };
      (EditorView as unknown as {instances: unknown[]}).instances.push(this);
    }

    /** 只吃 editor.ts 实际用到的事务形状：changes / selection / effects。 */
    dispatch(tr: {
      changes?: {from: number; to: number; insert: string};
      selection?: {anchor: number; head: number};
      effects?: unknown;
    }): void {
      if (this.destroyed) return;
      const text = this.state.doc.toString();
      let docChanged = false;
      let nextText = text;
      if (tr.changes != null) {
        docChanged = true;
        nextText =
          text.slice(0, tr.changes.from) +
          tr.changes.insert +
          text.slice(tr.changes.to);
      }
      const selection = tr.selection ?? {anchor: 0, head: 0};
      this.state = {
        doc: {toString: () => nextText},
        selection: {
          main: {from: selection.anchor, to: selection.head, ...selection},
        },
      };
      this.updateListener?.({
        docChanged,
        selectionSet: tr.selection != null,
        state: this.state,
        view: this,
      });
    }

    destroy(): void {
      this.destroyed = true;
    }
  }

  const EditorView: any = FakeEditorView;
  // 测试侧取用：mountEditor 建出的最近一个 stub 实例。
  (EditorView as unknown as {instances: unknown[]}).instances = [];
  EditorView.lineWrapping = {[CM_PLAIN]: true, value: 'lineWrapping'};
  EditorView.updateListener = {
    of: (fn: AnyFn) => ({[CM_FACET]: 'updateListener', fn}),
  };
  EditorView.domEventHandlers = (handlers: Record<string, AnyFn>) => ({
    [CM_FACET]: 'domEventHandlers',
    handlers,
  });
  EditorView.theme = () => ({[CM_PLAIN]: true, value: 'theme'});
  EditorView.scrollIntoView = () => ({
    [CM_PLAIN]: true,
    value: 'scrollIntoView',
  });
  EditorView.atomicRanges = {
    of: (fn: AnyFn) => ({[CM_PLAIN]: true, value: fn}),
  };

  return {
    EditorView,
    drawSelection: () => ({[CM_PLAIN]: true, value: 'drawSelection'}),
    keymap: {of: (arr: unknown) => ({[CM_PLAIN]: true, value: arr})},
    Decoration: {
      mark: (spec: unknown) => ({
        [CM_PLAIN]: true,
        value: spec,
        range: (from: number, to: number) => ({from, to}),
      }),
      none: {[CM_PLAIN]: true, value: 'none'},
      set: (ranges: unknown, sort: boolean) => ({
        [CM_PLAIN]: true,
        value: ranges,
        sort,
      }),
    },
    ViewPlugin: {
      fromClass: (cls: unknown, spec: unknown) => ({
        [CM_PLAIN]: true,
        value: {cls, spec},
      }),
    },
  };
});

const mockPost = jest.fn();
jest.mock('@web/code-editor/webview/runtime/post', () => ({
  post: (...args: unknown[]) => mockPost(...args),
}));

/* ------------------------------------------------------------------ *
 * 被测 runtime（桩装好之后再 import，拿到的是带 facet 的扩展）
 * ------------------------------------------------------------------ */
import {
  blurEditor,
  destroyEditor,
  mountEditor,
  setDocument,
} from '@web/code-editor/webview/runtime/editor';
import {EditorView as StubEditorView} from '@codemirror/view';

type StubView = InstanceType<any> & {
  state: {doc: {toString: () => string}};
  destroyed: boolean;
  dispatch: (tr: {
    changes?: {from: number; to: number; insert: string};
    selection?: {anchor: number; head: number};
  }) => void;
};

/** mountEditor 最近一次建出的 stub EditorView 实例。 */
function lastMountedView(): StubView {
  const instances = (StubEditorView as unknown as {instances: StubView[]})
    .instances;
  const view = instances[instances.length - 1];
  if (view == null) throw new Error('mountEditor 未建出 EditorView 实例');
  return view;
}

/* ------------------------------------------------------------------ *
 * 极小 DOM 桩（同 chat-conversation-dock.test.ts 形态）
 * ------------------------------------------------------------------ */

class FakeStyle {
  setProperty(): void {}
  getPropertyValue(): string {
    return '';
  }
}

class FakeElement {
  readonly style = new FakeStyle();
  readonly visualViewport: unknown = null;
  private listeners: Array<{type: string; fn: AnyFn}> = [];
  addEventListener(type: string, fn: AnyFn): void {
    this.listeners.push({type, fn});
  }
  removeEventListener(type: string, fn: AnyFn): void {
    this.listeners = this.listeners.filter(
      item => item.type !== type || item.fn !== fn,
    );
  }
  dispatch(type: string): void {
    for (const item of this.listeners.filter(l => l.type === type)) item.fn();
  }
}

const g = globalThis as unknown as Record<string, unknown>;
const originalWindow = g.window;
const originalRaf = g.requestAnimationFrame;
const originalCancelRaf = g.cancelAnimationFrame;

let rafQueue: Array<() => void>;

/** 与 dock 测试同款：连跑若干轮，直到 rAF 队列彻底排空。 */
function flushRaf(): void {
  for (let round = 0; round < 10 && rafQueue.length > 0; round += 1) {
    const batch = rafQueue;
    rafQueue = [];
    for (const cb of batch) cb();
  }
}

/** 本次用例内 post('change', …) 的上行文本序列。 */
function changePosts(): string[] {
  return mockPost.mock.calls
    .filter(call => call[0] === 'change')
    .map(call => (call[1] as {text: string}).text);
}

/** 同帧多次输入（长按连删/连打形态）：一次输入一笔事务，全程不排 rAF。 */
function typeInSameFrame(view: StubView, initial: string, chars: string[]): void {
  let pos = initial.length;
  let text = initial;
  for (const ch of chars) {
    text += ch;
    pos += ch.length;
    view.dispatch({changes: {from: pos - ch.length, to: pos - ch.length, insert: ch}});
  }
}

beforeEach(() => {
  mockPost.mockClear();
  rafQueue = [];
  (StubEditorView as unknown as {instances: unknown[]}).instances.length = 0;
  // cancelAnimationFrame 故意做成空实现（照 dock 测试口径）：让「已取消但仍迟到」
  // 的 rAF 回调真的跑起来——这样 flush 作废断言靠的是 editor.ts 的挂起标记，
  // 而不是桩顺手把回调删了。
  g.requestAnimationFrame = (cb: () => void) => {
    rafQueue.push(cb);
    return rafQueue.length;
  };
  g.cancelAnimationFrame = () => {};
  g.window = new FakeElement();
});

afterEach(() => {
  destroyEditor();
  flushRaf();
  g.window = originalWindow;
  g.requestAnimationFrame = originalRaf;
  g.cancelAnimationFrame = originalCancelRaf;
});

describe('code-editor web runtime change 合帧（T-CE）', () => {
  it('T-CE-01: 同帧多次 docChanged 只上行一次，且上行文本是最后一次的全文', () => {
    mountEditor(new FakeElement() as never, '', 'notes/a.md');
    const view = lastMountedView();

    // 排掉 mount 时 bindCaretRevealOnResize 自带的那一支 rAF，
    // 让下面 rafQueue 的长度只反映 change 合帧。
    flushRaf();
    typeInSameFrame(view, '', ['a', 'b', 'c', 'd']);

    // 一帧还没排：什么都没上行，且四次输入只排了一支 rAF。
    expect(changePosts()).toEqual([]);
    expect(rafQueue).toHaveLength(1);

    flushRaf();

    const posted = changePosts();
    // 不只断条数——上行文本必须是末态全文（last-wins），不是首态、也不是增量。
    expect(posted).toHaveLength(1);
    expect(posted[0]).toBe('abcd');
  });

  it('T-CE-02: blur 同步 flush（不等 rAF）', () => {
    mountEditor(new FakeElement() as never, '', 'notes/a.md');
    const view = lastMountedView();
    typeInSameFrame(view, '', ['h', 'i']);

    expect(changePosts()).toEqual([]);

    // RN 侧保存前的 codeEditorRef.blur() 就是这条路径（跨桥落到 blur handler）。
    blurEditor();

    expect(changePosts()).toEqual(['hi']);
    // rAF 后来再排，也不得重复上行（挂起标记已清）。
    flushRaf();
    expect(changePosts()).toEqual(['hi']);
  });

  it('T-CE-03: setDocument 丢弃挂起快照，旧文档不得迟到回环', () => {
    mountEditor(new FakeElement() as never, '', 'notes/a.md');
    const view = lastMountedView();
    typeInSameFrame(view, '', ['X', 'Y']);

    // 宿主整体替换文档：挂起那条描述的是旧文档，放行会经 RN 镜像把旧内容吃回来。
    setDocument('REPLACED', 'notes/a.md');

    flushRaf();
    expect(changePosts()).toEqual([]);
    expect(view.state.doc.toString()).toBe('REPLACED');
  });

  it('T-CE-04: destroy 后迟到的 rAF 不上行', () => {
    mountEditor(new FakeElement() as never, '', 'notes/a.md');
    const view = lastMountedView();
    // 同上：先排掉 mount 自带的 caret rAF，下面的 pending 才是 change 那支。
    flushRaf();
    typeInSameFrame(view, '', ['Q']);
    expect(rafQueue.length).toBeGreaterThan(0);

    destroyEditor();

    // 桩的 cancelAnimationFrame 是空实现，回调会真的迟到执行。
    flushRaf();
    expect(changePosts()).toEqual([]);
    expect(view.destroyed).toBe(true);
  });

  it('T-CE-05: 非 composer 路径的选区变更不上行 selectionChange', () => {
    mountEditor(new FakeElement() as never, '', 'notes/a.md');
    const view = lastMountedView();
    view.dispatch({selection: {anchor: 1, head: 1}});
    flushRaf();

    const types = mockPost.mock.calls.map(call => String(call[0]));
    expect(types).not.toContain('selectionChange');
  });

  it('T-CE-06: setDocument 程序化替换自身不上行 change（宿主写入不回环）', () => {
    mountEditor(new FakeElement() as never, '', 'notes/a.md');
    setDocument('FROM_HOST', 'notes/a.md');
    flushRaf();

    expect(changePosts()).toEqual([]);
    expect(lastMountedView().state.doc.toString()).toBe('FROM_HOST');
  });
});