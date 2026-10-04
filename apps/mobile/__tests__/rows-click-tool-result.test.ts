/**
 * T-TRW：rows-click「工具结果阅读」分支（open-tool-result）行为测试。
 *
 * 照 rows-click-anchor.test.ts 的最小 fake 元素形态（无 jsdom）。正文不进
 * DOM 属性（可达数百 KB）：分支按 data-tool-use-id 从 state.rows 反查
 * resultContent——本组用例钉住「DOM 属性 ↔ state 反查 ↔ post 载荷」三方
 * 约定（ucu 迭代 P0 事故即死在渲染键与读取键不一致）。
 */
import {onRowsClick} from '../src/web/chat-transcript/webview/runtime/render/rows-click';
import {state} from '../src/web/chat-transcript/webview/runtime/state/state';

type FakeElement = {
  tagName: string;
  attrs: Record<string, string>;
  closest: (selector: string) => FakeElement | null;
  getAttribute: (name: string) => string | null;
};

function makeEl(
  tagName: string,
  attrs: Record<string, string> = {},
): FakeElement {
  const el: FakeElement = {
    tagName,
    attrs,
    closest(selector) {
      return selector === '[data-action]' && el.attrs['data-action'] != null
        ? el
        : null;
    },
    getAttribute(name) {
      return el.attrs[name] ?? null;
    },
  };
  return el;
}

function makeEvent(target: FakeElement): MouseEvent {
  return {target, preventDefault: jest.fn()} as unknown as MouseEvent;
}

function postedEnvelopes(): Array<{v: number; type: string; payload: unknown}> {
  const bridge = (
    window as unknown as {
      ReactNativeWebView?: {postMessage: (msg: string) => void};
    }
  ).ReactNativeWebView;
  return bridge
    ? (bridge.postMessage as unknown as jest.Mock).mock.calls.map(call =>
        JSON.parse(call[0] as string),
      )
    : [];
}

/** 往 state.rows 塞一条带工具组的消息行（浅引用赋值语义，直接换数组）。 */
function seedToolRow(toolUseId: string, row: object): void {
  state.rows = [
    {
      kind: 'message',
      id: 'm1',
      role: 'assistant',
      tools: [{toolUseId, name: 'search', ...row}],
    },
  ];
}

describe('rows-click open-tool-result 分支 (T-TRW)', () => {
  let postMessage: jest.Mock;

  beforeEach(() => {
    postMessage = jest.fn();
    (window as unknown as {ReactNativeWebView?: unknown}).ReactNativeWebView = {
      postMessage,
    };
  });

  afterEach(() => {
    delete (window as unknown as {ReactNativeWebView?: unknown})
      .ReactNativeWebView;
    state.rows = [];
  });

  it('T-TRW1: data-tool-use-id 命中 state 行 → 上抛 openToolResult（title=工具名，content=正文全文）', () => {
    seedToolRow('tu-1', {resultContent: '第 1 条结果\n第 2 条结果'});
    onRowsClick(
      makeEvent(
        makeEl('div', {
          'data-action': 'open-tool-result',
          'data-tool-use-id': 'tu-1',
        }),
      ),
    );
    expect(postedEnvelopes()).toEqual([
      {
        v: 1,
        type: 'openToolResult',
        payload: {title: 'search', content: '第 1 条结果\n第 2 条结果'},
      },
    ]);
  });

  it('T-TRW2: toolUseId 在 state 里找不到行 → 不上抛（静默无动作）', () => {
    seedToolRow('tu-1', {resultContent: '结果'});
    onRowsClick(
      makeEvent(
        makeEl('div', {
          'data-action': 'open-tool-result',
          'data-tool-use-id': 'tu-missing',
        }),
      ),
    );
    expect(postedEnvelopes()).toEqual([]);
  });

  it('T-TRW3: 反查到的 resultContent 非字符串/空串 → 不上抛', () => {
    seedToolRow('tu-1', {resultContent: ''});
    onRowsClick(
      makeEvent(
        makeEl('div', {
          'data-action': 'open-tool-result',
          'data-tool-use-id': 'tu-1',
        }),
      ),
    );
    seedToolRow('tu-2', {resultContent: 42});
    onRowsClick(
      makeEvent(
        makeEl('div', {
          'data-action': 'open-tool-result',
          'data-tool-use-id': 'tu-2',
        }),
      ),
    );
    expect(postedEnvelopes()).toEqual([]);
  });

  it('T-TRW4: data-tool-use-id 属性缺失 → 不上抛（防 undefined 当 key 误配）', () => {
    seedToolRow('tu-1', {resultContent: '结果'});
    onRowsClick(makeEvent(makeEl('div', {'data-action': 'open-tool-result'})));
    expect(postedEnvelopes()).toEqual([]);
  });

  it('T-TRW5: 多行多工具时按 toolUseId 精确命中（不串卡）', () => {
    state.rows = [
      {
        kind: 'message',
        id: 'm1',
        role: 'assistant',
        tools: [
          {toolUseId: 'tu-a', name: 'glob', resultContent: 'a.md'},
          {toolUseId: 'tu-b', name: 'grep', resultContent: 'grep 命中行'},
        ],
      },
      {
        kind: 'message',
        id: 'm2',
        role: 'assistant',
        tools: [{toolUseId: 'tu-c', name: 'curl', resultContent: 'HTTP 200'}],
      },
    ];
    onRowsClick(
      makeEvent(
        makeEl('div', {
          'data-action': 'open-tool-result',
          'data-tool-use-id': 'tu-b',
        }),
      ),
    );
    expect(postedEnvelopes()).toEqual([
      {
        v: 1,
        type: 'openToolResult',
        payload: {title: 'grep', content: 'grep 命中行'},
      },
    ]);
  });

  it('T-TRW6: content 空串但 summary 有信息 → 上抛 summary（fs 空目录真机实锤）', () => {
    state.rows = [
      {
        kind: 'message',
        id: 'm1',
        role: 'assistant',
        tools: [
          {
            toolUseId: 'tu-1',
            name: 'fs',
            resultContent: '',
            summary: '0 entries',
          },
        ],
      },
    ];
    onRowsClick(
      makeEvent(
        makeEl('div', {
          'data-action': 'open-tool-result',
          'data-tool-use-id': 'tu-1',
        }),
      ),
    );
    expect(postedEnvelopes()).toEqual([
      {
        v: 1,
        type: 'openToolResult',
        payload: {title: 'fs', content: '0 entries'},
      },
    ]);
  });

  it('T-TRW7: content 纯空白串 + summary 有信息 → 上抛 summary（CR-1：点击侧与渲染侧 trim 口径统一）', () => {
    // 渲染侧 pickReadable 判空白 content「不可读」回落 summary；修复前
    // 点击侧用 `content !== ''` 把空白串当正文上抛——阅读页一片空白。
    state.rows = [
      {
        kind: 'message',
        id: 'm1',
        role: 'assistant',
        tools: [
          {
            toolUseId: 'tu-1',
            name: 'glob',
            resultContent: '   ',
            summary: '0 paths',
          },
        ],
      },
    ];
    onRowsClick(
      makeEvent(
        makeEl('div', {
          'data-action': 'open-tool-result',
          'data-tool-use-id': 'tu-1',
        }),
      ),
    );
    expect(postedEnvelopes()).toEqual([
      {
        v: 1,
        type: 'openToolResult',
        payload: {title: 'glob', content: '0 paths'},
      },
    ]);
  });

  it('T-TRW8: content 纯空白串 + 无 summary → 不上抛', () => {
    state.rows = [
      {
        kind: 'message',
        id: 'm1',
        role: 'assistant',
        tools: [{toolUseId: 'tu-1', name: 'curl', resultContent: '  '}],
      },
    ];
    onRowsClick(
      makeEvent(
        makeEl('div', {
          'data-action': 'open-tool-result',
          'data-tool-use-id': 'tu-1',
        }),
      ),
    );
    expect(postedEnvelopes()).toEqual([]);
  });
});
