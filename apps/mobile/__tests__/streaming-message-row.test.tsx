/**
 * StreamingMessageRow 壳契约（CR1 P2-9 / P2-18e / P1-1 尾部单主）。
 *
 * 行为级直测（照 chat-transcript-row-window.test.ts 的 vnode 直调先例）：
 * - 不 render 真 DOM，只调用函数组件拿 vnode；断言执行产物（class / 属性 /
 *   折叠标题）。函数组件（AssistantBubbleInner / ThinkingSection / CollapsibleHeader）
 *   递归展开；类组件（StreamBodyHost）保留 vnode，必要时 new 出来直调方法。
 *
 * 守三件事：
 * 1. P2-9 等价面：流式起源行与普通 assistant 行同面——外层带 `assistant`
 *    行类（`bubble--fill-width` 的 CSS 选择器依赖它）、thinking 标题同读
 *    `state.labels.thinking`、thinking-only 行同样预置空 `.bubble-body`。
 * 2. P2-18e：`StreamBodyHost.shouldComponentUpdate() === false` 的执行级断言
 *    （防 wipe 不变量的唯一执行面；删掉 sCU/换普通组件这里必须红）。
 * 3. P1-1：`#stream-tail` 单主——只有 checkpoint 指向的 streaming 行挂 id，
 *    旧 step 的 streaming 行不得抢走 delta 落笔点。
 */
jest.mock(
  '../src/web/chat-transcript/webview/runtime/render/row-logic',
  () => ({renderRows: jest.fn()}),
);
jest.mock('../src/web/chat-transcript/webview/runtime/mermaid', () => ({
  scheduleMermaidScan: jest.fn(),
}));
jest.mock('../src/web/chat-transcript/webview/runtime/menu/menu', () => ({
  closeContextMenu: jest.fn(),
  openContextMenuFromAnchor: jest.fn(),
}));
jest.mock('../src/web/chat-transcript/webview/runtime/bridge', () => ({
  post: jest.fn(),
}));

import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {MessageRow as MessageRowModel} from '../src/web/chat-transcript/webview/runtime/state/state';
import {state} from '../src/web/chat-transcript/webview/runtime/state/state';
import {MessageRow} from '../src/web/chat-transcript/webview/ui/render/MessageRow';
import {StreamingMessageRow} from '../src/web/chat-transcript/webview/ui/stream/StreamingMessageRow';

type AnyVNode = {
  type: unknown;
  key?: string;
  props?: Record<string, any>;
};

const CSS_PATH = join(
  __dirname,
  '../src/web/chat-transcript/styles/transcript.css',
);

function streamRow(
  id: string,
  overrides: Partial<MessageRowModel> = {},
): MessageRowModel {
  return {
    kind: 'message',
    id,
    role: 'assistant',
    status: 'streaming',
    text: '',
    thinking: '',
    hidden: false,
    ...overrides,
  };
}

/** 递归展开：函数组件直接调用其渲染函数；类组件只保留 vnode（不实例化）。 */
function deepChildren(node: unknown, out: AnyVNode[] = []): AnyVNode[] {
  if (node == null) return out;
  if (Array.isArray(node)) {
    for (const child of node) deepChildren(child, out);
    return out;
  }
  if (typeof node !== 'object') return out;
  const vnode = node as AnyVNode;
  out.push(vnode);
  const type = vnode.type;
  if (typeof type === 'function') {
    const proto = (type as {prototype?: object} | null | undefined)?.prototype;
    if (proto == null || !('render' in proto)) {
      deepChildren((type as (props: unknown) => unknown)(vnode.props), out);
      return out;
    }
  }
  deepChildren(vnode.props?.children, out);
  return out;
}

function classList(vnode: AnyVNode): string[] {
  return String(vnode.props?.className ?? '')
    .split(/\s+/)
    .filter(Boolean);
}

function findBody(vnode: AnyVNode): AnyVNode | undefined {
  return deepChildren(vnode).find(n => classList(n).includes('bubble-body'));
}

function thinkingHeaderTitle(vnode: AnyVNode): unknown {
  return deepChildren(vnode).find(n => n.props?.action === 'toggle-thinking')
    ?.props?.title;
}

/** StreamBodyHost 是类组件：new 出来直调方法（执行级，不经渲染）。 */
function instantiateBody(vnode: AnyVNode): {
  shouldComponentUpdate(): boolean;
  render(): AnyVNode;
} {
  const ctor = vnode.type as new (props: unknown) => {
    shouldComponentUpdate(): boolean;
    render(): AnyVNode;
  };
  return new ctor(vnode.props);
}

beforeEach(() => {
  state.streamCheckpoint = null;
  state.plainReseedStreamId = null;
  state.flags.richText = false;
});

describe('P2-9 流式起源行与普通 assistant 行等价面', () => {
  it('thinking-only 流式行外层带 assistant 行类，bubble--fill-width 有对应行级选择器', () => {
    const vnode = StreamingMessageRow({
      row: streamRow('st:1', {thinking: 'thought'}),
    }) as AnyVNode;
    expect(classList(vnode)).toEqual(
      expect.arrayContaining(['row', 'message', 'assistant', 'stream']),
    );
    const bubble = deepChildren(vnode).find(n =>
      classList(n).includes('bubble'),
    )!;
    expect(classList(bubble)).toContain('bubble--fill-width');
    // CSS 真源：fill-width 的宽度规则只认 `.row.assistant`，行类缺失就永久不生效
    expect(readFileSync(CSS_PATH, 'utf8')).toContain(
      '.row.assistant .bubble.bubble--fill-width',
    );
  });

  it('finished 流式行与普通历史行的 thinking 标题同读 state.labels.thinking', () => {
    const saved = state.labels;
    state.labels = {...saved, thinking: 'Thinking'};
    try {
      const streamed = StreamingMessageRow({
        row: streamRow('st:1', {
          status: 'finished',
          messageId: 'db-1',
          thinking: 'thought',
          text: 'done',
        }),
      }) as AnyVNode;
      const plain = MessageRow({
        row: {
          kind: 'message',
          id: 'db-1',
          role: 'assistant',
          thinking: 'thought',
          text: 'done',
        },
      }) as AnyVNode;
      expect(thinkingHeaderTitle(streamed)).toBe('Thinking');
      expect(thinkingHeaderTitle(plain)).toBe('Thinking');
    } finally {
      state.labels = saved;
    }
  });

  it('thinking-only 的 finished 流式行与普通历史行都预置空 .bubble-body（data-text-shell）', () => {
    const streamed = StreamingMessageRow({
      row: streamRow('st:1', {
        status: 'finished',
        messageId: 'db-1',
        thinking: 'thought',
      }),
    }) as AnyVNode;
    const streamedBody = findBody(streamed)!;
    expect(streamedBody).toBeTruthy();
    expect(streamedBody.props?.dataTextShell).toBe(true);
    expect(
      instantiateBody(streamedBody).render().props?.['data-text-shell'],
    ).toBe('1');

    const plain = MessageRow({
      row: {
        kind: 'message',
        id: 'db-1',
        role: 'assistant',
        thinking: 'thought',
      },
    }) as AnyVNode;
    const plainShell = deepChildren(plain).find(
      n => n.props?.['data-text-shell'] === '1',
    );
    expect(plainShell).toBeTruthy();
    expect(classList(plainShell!)).toContain('bubble-body');
  });
});

describe('P2-18e StreamBodyHost.shouldComponentUpdate=false（防 wipe 执行面）', () => {
  it('body 岛实例的 shouldComponentUpdate 返回 false；streaming→finished 壳复用同一 body', () => {
    const streamingRow = StreamingMessageRow({
      row: streamRow('st:1', {text: 'hi'}),
    }) as AnyVNode;
    const finishedRow = StreamingMessageRow({
      row: streamRow('st:1', {
        status: 'finished',
        messageId: 'db-1',
        text: 'hi',
      }),
    }) as AnyVNode;
    const liveBody = findBody(streamingRow)!;
    const doneBody = findBody(finishedRow)!;
    expect(liveBody).toBeTruthy();
    expect(instantiateBody(liveBody).shouldComponentUpdate()).toBe(false);
    // 同 key + 同组件类型：status 翻转不 remount，runtime 增量 DOM 不被洗掉
    expect(doneBody.type).toBe(liveBody.type);
    expect(doneBody.key).toBe(liveBody.key);
  });
});

describe('P1-1 #stream-tail 单主', () => {
  it('两条 streaming 行时只有 checkpoint 指向的行挂 id', () => {
    state.streamCheckpoint = {id: 'st:2', seq: 3, status: 'streaming'};
    const stale = StreamingMessageRow({
      row: streamRow('st:1', {text: 'old step'}),
    }) as AnyVNode;
    const tail = StreamingMessageRow({
      row: streamRow('st:2', {text: 'new step'}),
    }) as AnyVNode;
    expect(stale.props?.id).toBeUndefined();
    expect(tail.props?.id).toBe('stream-tail');
  });

  it('waiting-first 分支同样单主，不抢当前流', () => {
    state.streamCheckpoint = {id: 'st:2', seq: 0, status: 'streaming'};
    const stale = StreamingMessageRow({row: streamRow('st:1')}) as AnyVNode;
    const tail = StreamingMessageRow({row: streamRow('st:2')}) as AnyVNode;
    expect(stale.props?.id).toBeUndefined();
    expect(tail.props?.id).toBe('stream-tail');
  });

  it('无 checkpoint（尚无基线快照）时退化为 streaming 行即尾；finished 行永不占用 id', () => {
    expect(
      (StreamingMessageRow({row: streamRow('st:1', {text: 'x'})}) as AnyVNode)
        .props?.id,
    ).toBe('stream-tail');
    const finished = StreamingMessageRow({
      row: streamRow('st:1', {
        status: 'finished',
        messageId: 'db-1',
        text: 'x',
      }),
    }) as AnyVNode;
    expect(finished.props?.id).toBeUndefined();
  });

  it('尾行的 data-id/data-stream-id 与 checkpoint id 一致（runtime data-id 校验的比较基准）', () => {
    state.streamCheckpoint = {id: 'st:2', seq: 3, status: 'streaming'};
    const tail = StreamingMessageRow({
      row: streamRow('st:2', {text: 'new step'}),
    }) as AnyVNode;
    const stale = StreamingMessageRow({
      row: streamRow('st:1', {text: 'old step'}),
    }) as AnyVNode;
    // runtime 侧一旦补 `#stream-tail` 的 data-id 校验，这两个属性就是比较基准：
    // 尾主必须是 checkpoint id，旧行只暴露自身 data-id（没有 stream-tail id）。
    expect(tail.props?.id).toBe('stream-tail');
    expect(tail.props?.['data-id']).toBe('st:2');
    expect(tail.props?.['data-stream-id']).toBe('st:2');
    expect(stale.props?.id).toBeUndefined();
    expect(stale.props?.['data-id']).toBe('st:1');
  });

  it('checkpoint 换主后旧主行重渲即失去 stream-tail id，新主接管', () => {
    const staleRow = streamRow('st:1', {text: 'old step'});
    const nextRow = streamRow('st:2', {text: 'new step'});
    state.streamCheckpoint = {id: 'st:1', seq: 2, status: 'streaming'};
    expect((StreamingMessageRow({row: staleRow}) as AnyVNode).props?.id).toBe(
      'stream-tail',
    );
    state.streamCheckpoint = {id: 'st:2', seq: 3, status: 'streaming'};
    // 旧主重渲：id 被 Preact 移除，delta 不可能再按 getElementById 写进旧行。
    expect(
      (StreamingMessageRow({row: staleRow}) as AnyVNode).props?.id,
    ).toBeUndefined();
    const next = StreamingMessageRow({row: nextRow}) as AnyVNode;
    expect(next.props?.id).toBe('stream-tail');
    expect(next.props?.['data-id']).toBe('st:2');
  });
});

describe('P1-1 plain-reseed 的 data-id 校验（ui 侧纵深防御）', () => {
  type FakeBody = {
    textContent: string;
    classList: {remove: (token: string) => void};
  };

  function withFakeTail(dataId: string, body: FakeBody, run: () => void): void {
    const scope = globalThis as {document?: unknown};
    const saved = scope.document;
    scope.document = {
      getElementById: () => ({
        getAttribute: (name: string) => (name === 'data-id' ? dataId : null),
        querySelector: () => body,
      }),
    };
    try {
      run();
    } finally {
      scope.document = saved;
    }
  }

  it('reseed 目标 data-id 与行 id 不一致时零写入、pending 不清', () => {
    const body: FakeBody = {
      textContent: 'orig',
      classList: {remove: jest.fn()},
    };
    state.flags.richText = false;
    state.plainReseedStreamId = 'st:1';
    withFakeTail('st:other', body, () => {
      StreamingMessageRow({row: streamRow('st:1', {text: 'new'})});
    });
    expect(body.textContent).toBe('orig');
    expect(body.classList.remove).not.toHaveBeenCalled();
    // 下一次重渲仍要尝试，不能把 pending 清掉（否则正文永久停在旧文本）。
    expect(state.plainReseedStreamId).toBe('st:1');
  });

  it('reseed 目标 data-id 匹配时写入纯文本、摘 rich 并清 pending', () => {
    const body: FakeBody = {
      textContent: 'orig',
      classList: {remove: jest.fn()},
    };
    state.flags.richText = false;
    state.plainReseedStreamId = 'st:1';
    withFakeTail('st:1', body, () => {
      StreamingMessageRow({row: streamRow('st:1', {text: 'new'})});
    });
    expect(body.textContent).toBe('new');
    expect(body.classList.remove).toHaveBeenCalledWith('rich');
    expect(state.plainReseedStreamId).toBeNull();
  });
});
