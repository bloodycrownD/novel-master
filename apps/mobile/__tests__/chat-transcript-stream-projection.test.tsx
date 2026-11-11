/**
 * chat-transcript web runtime 流式投影（spec §9.2 T-SP7~T-SP14 / T-SP23~T-SP25 /
 * T-SP30 / T-SP31 的 runtime 半）。
 *
 * 行为级直测（照 chat-transcript-snapshot-chunk.test.ts 先例）：
 * - `renderRows / mermaid / menu / mermaid-fullscreen` 副作用出口 mock；
 * - `document` 用 `helpers/fake-transcript-dom.ts` 最小 harness（无 jsdom）；
 * - `requestAnimationFrame` 以同步队列 stub（applySnapshot 的 RAF 收尾）；
 * - bridge 用**真模块**（post 走 fake `window.ReactNativeWebView`，便于断言
 *   `streamResync` 上行与 init/flagsUpdate 分支）。
 *
 * 每个用例 isolateModules 取全新模块实例（state 单例 / 分片代次 / 块级态 /
 * 签名表都随 isolate 重建）。
 */
jest.mock(
  '../src/web/chat-transcript/webview/runtime/render/row-logic',
  () => ({
    renderRows: jest.fn(),
    flagsEqual: (
      a: {richText: boolean; menuDisabled: boolean},
      b: {richText: boolean; menuDisabled: boolean},
    ) => a.richText === b.richText && a.menuDisabled === b.menuDisabled,
  }),
);
jest.mock('../src/web/chat-transcript/webview/runtime/mermaid', () => ({
  scheduleMermaidScan: jest.fn(),
}));
jest.mock('../src/web/chat-transcript/webview/runtime/menu/menu', () => ({
  closeContextMenu: jest.fn(),
}));
jest.mock('@web/shared/mermaid-fullscreen/mermaid-fullscreen', () => ({
  closeMermaidViewer: jest.fn(),
}));

import {renderRows} from '../src/web/chat-transcript/webview/runtime/render/row-logic';
import {scheduleMermaidScan} from '../src/web/chat-transcript/webview/runtime/mermaid';
import type {MessageRow} from '../src/web/chat-transcript/webview/runtime/state/state';
import {
  countDescendantHtmlOccurrences,
  countHtmlOccurrences,
  createFakeDocument,
  createRowShell,
  installFakeDocument,
  resetWriteCounts,
  totalWriteCount,
  uninstallFakeDocument,
  type FakeDocument,
  type RowShell,
} from './helpers/fake-transcript-dom';

type StateModule =
  typeof import('../src/web/chat-transcript/webview/runtime/state/state');
type SnapshotModule =
  typeof import('../src/web/chat-transcript/webview/runtime/render/snapshot');
type StreamModule =
  typeof import('../src/web/chat-transcript/webview/runtime/stream/stream');
type StreamMarkdownModule =
  typeof import('../src/web/chat-transcript/webview/runtime/stream/stream-markdown');
type BridgeModule =
  typeof import('../src/web/chat-transcript/webview/runtime/bridge');
type StreamingRowModule =
  typeof import('../src/web/chat-transcript/webview/ui/stream/StreamingMessageRow');

type Loaded = {
  state: StateModule['state'];
  snapshot: SnapshotModule;
  stream: StreamModule;
  streamMarkdown: StreamMarkdownModule;
  bridge: BridgeModule;
  StreamingMessageRow: StreamingRowModule['StreamingMessageRow'];
};

/** 350ms 轻量升级定时（与 stream-markdown 内部常量同值；测试本地常量）。 */
const RICH_UPGRADE_MS = 350;

function loadFreshModules(): Loaded {
  let loaded: Loaded | null = null;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stateMod =
      require('../src/web/chat-transcript/webview/runtime/state/state') as StateModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const snapshot =
      require('../src/web/chat-transcript/webview/runtime/render/snapshot') as SnapshotModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const stream =
      require('../src/web/chat-transcript/webview/runtime/stream/stream') as StreamModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const streamMarkdown =
      require('../src/web/chat-transcript/webview/runtime/stream/stream-markdown') as StreamMarkdownModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bridge =
      require('../src/web/chat-transcript/webview/runtime/bridge') as BridgeModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const streamUi =
      require('../src/web/chat-transcript/webview/ui/stream/StreamingMessageRow') as StreamingRowModule;
    loaded = {
      state: stateMod.state,
      snapshot,
      stream,
      streamMarkdown,
      bridge,
      StreamingMessageRow: streamUi.StreamingMessageRow,
    };
  });
  return loaded!;
}

function assistantRow(
  id: string,
  overrides: Partial<MessageRow> = {},
): MessageRow {
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

function userRow(id: string, text = 'hi'): MessageRow {
  return {kind: 'message', id, role: 'user', text};
}

describe('web 流式投影 runtime（T-SP7~T-SP14 / T-SP23~T-SP25 / T-SP30 / T-SP31）', () => {
  let doc: FakeDocument;
  let rafQueue: Array<() => void>;
  let postMessage: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    rafQueue = [];
    doc = createFakeDocument();
    installFakeDocument(doc);
    (
      globalThis as unknown as {requestAnimationFrame: unknown}
    ).requestAnimationFrame = (cb: () => void) => {
      rafQueue.push(cb);
      return rafQueue.length;
    };
    postMessage = jest.fn();
    (globalThis as unknown as {window: unknown}).window = {
      addEventListener: jest.fn(),
      ReactNativeWebView: {postMessage},
    };
  });

  afterEach(() => {
    uninstallFakeDocument();
    delete (globalThis as unknown as {window?: unknown}).window;
    delete (globalThis as unknown as {requestAnimationFrame?: unknown})
      .requestAnimationFrame;
  });

  function flushRaf(): void {
    for (let round = 0; round < 8; round++) {
      const cbs = rafQueue.splice(0, rafQueue.length);
      if (cbs.length === 0) {
        break;
      }
      for (const cb of cbs) {
        cb();
      }
    }
  }

  function postedMessages(): Array<{type: string; payload: any}> {
    return postMessage.mock.calls.map(call => JSON.parse(String(call[0])));
  }

  function resyncPosts(): Array<{type: string; payload: any}> {
    return postedMessages().filter(msg => msg.type === 'streamResync');
  }

  /** 模拟 Preact 壳 mount 后的首帧播种（renderRows 在 harness 里是 mock）。 */
  function emulateShellSeed(shell: RowShell, row: MessageRow): void {
    shell.textBody.textContent = String(row.text || '');
    if (shell.thinkingBody != null) {
      shell.thinkingBody.textContent = String(row.thinking || '');
    }
  }

  /** #scroller 最小布局模型：scrollTop/scrollHeight/clientHeight 可手动驱动。 */
  function installScroller(
    options: {
      scrollTop?: number;
      scrollHeight?: number;
      clientHeight?: number;
    } = {},
  ) {
    const el = doc.createElement('div');
    el.id = 'scroller';
    el.scrollTop = options.scrollTop ?? 0;
    el.scrollHeight = options.scrollHeight ?? 1000;
    el.clientHeight = options.clientHeight ?? 600;
    doc.body.appendChild(el);
    return el;
  }

  function offsetBottom(el: {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
  }): number {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }

  /* ---------------- T-SP7：applySnapshot 原子替换 rows + checkpoint ---------------- */

  it('T-SP7: 分片快照末片同步替换 rows + checkpoint，中间零渲染，RAF 一次 renderRows', () => {
    const {state, snapshot} = loadFreshModules();
    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 0,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      rows: [userRow('u1')],
    });
    expect(state.rows).toEqual([]);
    expect(state.streamCheckpoint).toBeNull();
    expect(renderRows).not.toHaveBeenCalled();

    const row = assistantRow('st:1', {text: 'abc'});
    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 1,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      rows: [row],
      stream: {id: 'st:1', seq: 0, status: 'streaming'},
      scrollIntent: 'stick',
    });
    // 同步块内 rows 与 checkpoint 同时到位（中间无渲染）
    expect(state.rows.map(r => r.id)).toEqual(['u1', 'st:1']);
    expect(state.streamCheckpoint).toEqual({
      id: 'st:1',
      seq: 0,
      status: 'streaming',
    });
    expect(renderRows).not.toHaveBeenCalled();
    flushRaf();
    expect(renderRows).toHaveBeenCalledTimes(1);
  });

  it('T-SP7: 单一数据面——state.stream / state.ready 引用不存在', () => {
    const {state} = loadFreshModules();
    expect('stream' in state).toBe(false);
    expect('ready' in state).toBe(false);
  });

  /* ---------------- T-SP8：乱序/旧快照/rewind/二次快照零写入 ---------------- */

  it('T-SP8: 同 id 本地 seq 更大时不被回退（rewind 保留本地行与 seq）', () => {
    const {state, snapshot} = loadFreshModules();
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'abcdef'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 5, status: 'streaming'},
    });
    flushRaf();

    // 旧快照（seq 3、正文更短）迟到：不回退已显示正文
    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [assistantRow('st:1', {text: 'abc'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 3, status: 'streaming'},
    });
    flushRaf();
    expect(state.streamCheckpoint).toEqual({
      id: 'st:1',
      seq: 5,
      status: 'streaming',
    });
    expect(state.rows[0].text).toBe('abcdef');
  });

  it('T-SP8: delta(N+1) 先到、旧快照(seq N) 后到 → checkpoint 保持 N+1，后续 N+2 连续', () => {
    const {state, snapshot, stream} = loadFreshModules();
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'hello'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 5, status: 'streaming'},
    });
    flushRaf();

    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 6,
      segments: [{kind: 'text', delta: ' world'}],
    });
    expect(state.streamCheckpoint?.seq).toBe(6);
    expect(state.rows[0].text).toBe('hello world');

    // 旧快照（seq 5、正文 hello）后到：rewind，不回退 checkpoint / 正文
    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [assistantRow('st:1', {text: 'hello'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 5, status: 'streaming'},
    });
    flushRaf();
    expect(state.streamCheckpoint?.seq).toBe(6);
    expect(state.rows[0].text).toBe('hello world');

    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 7,
      segments: [{kind: 'text', delta: '!'}],
    });
    expect(state.streamCheckpoint?.seq).toBe(7);
    expect(state.rows[0].text).toBe('hello world!');
    expect(shell.textBody.textContent).toBe('hello world!');
  });

  it('T-SP8: 不同 id 以新快照为准（新流换主）', () => {
    const {state, snapshot} = loadFreshModules();
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:a', {text: 'a'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:a', seq: 9, status: 'streaming'},
    });
    flushRaf();
    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [assistantRow('st:b', {text: ''})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:b', seq: 0, status: 'streaming'},
    });
    flushRaf();
    expect(state.streamCheckpoint).toEqual({
      id: 'st:b',
      seq: 0,
      status: 'streaming',
    });
    expect(state.rows.map(r => r.id)).toEqual(['st:b']);
  });

  it('T-SP8: 无 stream 的快照清 checkpoint 并移除流式行', () => {
    const {state, snapshot} = loadFreshModules();
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:a', {text: 'a'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:a', seq: 2, status: 'streaming'},
    });
    flushRaf();
    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [userRow('u1')],
      sessionKey: 'p1:s1',
    });
    flushRaf();
    expect(state.streamCheckpoint).toBeNull();
    expect(state.rows.map(r => r.id)).toEqual(['u1']);
  });

  it('T-SP8: 内容未变的第二次快照 body 写入 0（reconcile 签名跳过）', () => {
    const {snapshot} = loadFreshModules();
    const row = assistantRow('st:f', {status: 'finished', text: 'done'});
    const shell = createRowShell(doc, 'st:f', {streaming: false});
    shell.textBody.textContent = 'stale';
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [row],
      sessionKey: 'p1:s1',
      stream: {id: 'st:f', seq: 3, status: 'finished'},
    });
    flushRaf();
    // 首次 reconcile 写入一次
    expect(shell.textBody.textContent).toBe('done');
    resetWriteCounts(doc);

    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [assistantRow('st:f', {status: 'finished', text: 'done'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:f', seq: 3, status: 'finished'},
    });
    flushRaf();
    expect(totalWriteCount(doc)).toBe(0);
  });

  /* ---------------- T-SP9：delta seq / gap / resync / reseed ---------------- */

  it('T-SP9: seq=applied+1 应用；seq<=applied 丢弃；gap 不应用且 post streamResync', () => {
    const {state, snapshot, stream} = loadFreshModules();
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'hello'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 5, status: 'streaming'},
    });
    flushRaf();
    emulateShellSeed(shell, state.rows[0]);

    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 6,
      segments: [{kind: 'text', delta: ' world'}],
    });
    expect(state.rows[0].text).toBe('hello world');
    expect(shell.textBody.textContent).toBe('hello world');
    expect(state.streamCheckpoint?.seq).toBe(6);

    // 重复/过期：幂等丢弃
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 6,
      segments: [{kind: 'text', delta: ' DUP'}],
    });
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 4,
      segments: [{kind: 'text', delta: ' OLD'}],
    });
    expect(state.rows[0].text).toBe('hello world');

    // gap：不应用半截内容，请求普通快照
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 8,
      segments: [{kind: 'text', delta: ' GAP'}],
    });
    expect(state.rows[0].text).toBe('hello world');
    expect(state.streamCheckpoint?.seq).toBe(6);
    expect(resyncPosts()).toHaveLength(1);
    expect(resyncPosts()[0].payload).toEqual({
      streamId: 'st:1',
      expectedSeq: 6,
    });
    expect(state.resyncPending).toBe('st:1');

    // 等待 snapshot 期间同一 streamId 的 delta 继续忽略、不重复请求
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 9,
      segments: [{kind: 'text', delta: ' MORE'}],
    });
    expect(resyncPosts()).toHaveLength(1);
  });

  it('T-SP9: snapshot 到达后清 resyncPending、保留 resyncSentAt；gap 恢复 reseed 全量正文', () => {
    // P2-20：100ms 限流注入时钟，不依赖两条语句的真实耗时（CI 卡顿不能翻红）。
    const nowSpy = jest.spyOn(performance, 'now').mockReturnValue(5000);
    try {
      const {state, snapshot, stream} = loadFreshModules();
      const shell = createRowShell(doc, 'st:1', {streaming: true});
      snapshot.handleSnapshotPayload({
        generation: 1,
        rows: [assistantRow('st:1', {text: 'hello'})],
        sessionKey: 'p1:s1',
        stream: {id: 'st:1', seq: 5, status: 'streaming'},
      });
      flushRaf();
      emulateShellSeed(shell, state.rows[0]);

      stream.applyStreamDelta({streamId: 'st:1', seq: 8, segments: []});
      expect(state.resyncPending).toBe('st:1');
      const sentAt = state.resyncSentAt;
      expect(sentAt).toBe(5000);

      snapshot.handleSnapshotPayload({
        generation: 2,
        rows: [assistantRow('st:1', {text: 'hello gap-filled'})],
        sessionKey: 'p1:s1',
        stream: {id: 'st:1', seq: 8, status: 'streaming'},
      });
      // 同步块：resyncPending 清空，resyncSentAt 保留（100ms 限流依据）
      expect(state.resyncPending).toBeNull();
      expect(state.resyncSentAt).toBe(sentAt);
      flushRaf();

      // reseed：plain body.textContent === row.text（漏掉的 delta 被补齐）
      expect(shell.textBody.textContent).toBe('hello gap-filled');

      // 紧随其后的 gap（+49ms）：仍在限流窗口内，不重复发
      nowSpy.mockReturnValue(5049);
      const before = resyncPosts().length;
      stream.applyStreamDelta({streamId: 'st:1', seq: 10, segments: []});
      expect(resyncPosts().length).toBe(before);

      // 超窗（+101ms）：允许再补一次快照
      nowSpy.mockReturnValue(5101);
      stream.applyStreamDelta({streamId: 'st:1', seq: 10, segments: []});
      expect(resyncPosts().length).toBe(before + 1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  /* ---------------- T-SP10：streamBlockCommit ---------------- */

  it('T-SP10: 块提交只 append 一次（blockKey 去重），不推进 checkpoint、不写回 row.textHtml', () => {
    const {state, snapshot, stream} = loadFreshModules();
    // 块级渲染只在 richText 下激活（plain 走转义增量）
    state.flags.richText = true;
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    // 空流起点（seq 0、无内容）→ 不进入 fullReplaceOnly，块模式可激活
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1')],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 0, status: 'streaming'},
    });
    flushRaf();
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 1,
      segments: [{kind: 'text', delta: 'B1T1'}],
      textHtml: '<p>B1T1</p>',
      tailHtml: '<p>B1T1</p>',
    });
    emulateShellSeed(shell, state.rows[0]);
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 2,
      segments: [{kind: 'text', delta: 'T2'}],
      textHtml: '<p>B1T1T2</p>',
      tailHtml: '<p>T2</p>',
    });
    expect(state.rows[0].textHtml).toBe('<p>B1T1T2</p>');

    stream.applyStreamBlockCommit({
      streamId: 'st:1',
      seq: 2,
      blockKey: 'st:1:text:0',
      kind: 'text',
      html: '<p>B1</p>',
      text: 'B1',
      tailHtml: '<p>T1T2</p>',
      tailText: 'T1T2',
    });
    // 块提交不推进 checkpoint；行上的 textHtml 仍是全量（不写回尾块）
    expect(state.streamCheckpoint?.seq).toBe(2);
    expect(state.rows[0].textHtml).toBe('<p>B1T1T2</p>');
    expect(countHtmlOccurrences(shell.bubble, '<p>B1</p>')).toBe(1);
    // 尾块容器重置为 tailHtml：后代节点里 T1T2 只出现一次（body 自身旧 html 是 harness 噪声）
    expect(countDescendantHtmlOccurrences(shell.textBody, 'T1T2')).toBe(1);

    // 同一 blockKey 重复投递：只 append 一次
    stream.applyStreamBlockCommit({
      streamId: 'st:1',
      seq: 2,
      blockKey: 'st:1:text:0',
      kind: 'text',
      html: '<p>B1</p>',
      text: 'B1',
      tailHtml: '<p>T1T2</p>',
      tailText: 'T1T2',
    });
    expect(countHtmlOccurrences(shell.bubble, '<p>B1</p>')).toBe(1);
  });

  it('T-SP10: 未知 streamId / 已 finished / seq 超前 / fullReplaceOnly 的块提交一律忽略', () => {
    const {state, snapshot, stream} = loadFreshModules();
    state.flags.richText = true;
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1')],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 0, status: 'streaming'},
    });
    flushRaf();
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 1,
      segments: [{kind: 'text', delta: 'X'}],
      textHtml: '<p>X</p>',
      tailHtml: '<p>X</p>',
    });
    emulateShellSeed(shell, state.rows[0]);
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 2,
      segments: [{kind: 'text', delta: 'Y'}],
      textHtml: '<p>XY</p>',
      tailHtml: '<p>Y</p>',
    });
    resetWriteCounts(doc);
    (renderRows as jest.Mock).mockClear();

    // 未知 streamId
    stream.applyStreamBlockCommit({
      streamId: 'st:other',
      seq: 1,
      blockKey: 'k-other',
      kind: 'text',
      html: '<p>NO</p>',
      text: 'NO',
    });
    // seq 超前（只做对账：seq > applied 一律不应用）
    stream.applyStreamBlockCommit({
      streamId: 'st:1',
      seq: 99,
      blockKey: 'k-ahead',
      kind: 'text',
      html: '<p>AHEAD</p>',
      text: 'AHEAD',
    });
    expect(totalWriteCount(doc)).toBe(0);

    // 收尾后迟到 commit：不得触发 renderRows 回退
    stream.applyStreamStatus({streamId: 'st:1', status: 'finished'});
    expect(state.streamCheckpoint?.status).toBe('finished');
    (renderRows as jest.Mock).mockClear();
    resetWriteCounts(doc);
    stream.applyStreamBlockCommit({
      streamId: 'st:1',
      seq: 2,
      blockKey: 'k-late',
      kind: 'text',
      html: '<p>LATE</p>',
      text: 'LATE',
    });
    expect(renderRows).not.toHaveBeenCalled();
    expect(totalWriteCount(doc)).toBe(0);
  });

  it('T-SP10: 块级模式 delta 进尾块 parts——350ms 升级不丢刚追加的增量', () => {
    jest.useFakeTimers({doNotFake: ['requestAnimationFrame']});
    try {
      const {state, snapshot, stream, streamMarkdown} = loadFreshModules();
      state.flags.richText = true;
      const shell = createRowShell(doc, 'st:1', {streaming: true});
      snapshot.handleSnapshotPayload({
        generation: 1,
        rows: [assistantRow('st:1')],
        sessionKey: 'p1:s1',
        stream: {id: 'st:1', seq: 0, status: 'streaming'},
      });
      flushRaf();
      stream.applyStreamDelta({
        streamId: 'st:1',
        seq: 1,
        segments: [{kind: 'text', delta: 'A'}],
        textHtml: '<p>A</p>',
        tailHtml: '<p>A</p>',
      });
      // 块提交：尾块重置为 tailText 'A'（parts 同步重置为 ['A']）
      stream.applyStreamBlockCommit({
        streamId: 'st:1',
        seq: 1,
        blockKey: 'st:1:text:0',
        kind: 'text',
        html: '<p>A</p>',
        text: 'A',
        tailHtml: '<p>A</p>',
        tailText: 'A',
      });
      // 无 tailHtml 的 delta（如超长降级）：只 append 到尾块容器，不整段替换
      stream.applyStreamDelta({
        streamId: 'st:1',
        seq: 2,
        segments: [{kind: 'text', delta: 'B'}],
        textHtml: '<p>AB</p>',
      });
      expect(stream.getStreamActiveTailText('text')).toBe('AB');
      const tailEl = shell.textBody.querySelector('.stream-active-tail');
      expect(tailEl).not.toBeNull();
      // 块提交后的富文本尾块 + 纯文本 append（fake DOM 不解析 HTML，直接看源码）
      expect(tailEl!.innerHTML).toBe('<p>A</p>B');

      // 350ms 升级：源文本必须是 parts 全量（'A' + 'B'），不能被旧 tailText 覆盖
      jest.advanceTimersByTime(RICH_UPGRADE_MS);
      expect(tailEl!.innerHTML).toBe('<p>AB</p>');
      expect(countDescendantHtmlOccurrences(shell.textBody, 'AB')).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('T-SP10: finished 后 350ms 升级 timer 零渲染', () => {
    jest.useFakeTimers({doNotFake: ['requestAnimationFrame']});
    try {
      const {state, snapshot, stream, streamMarkdown} = loadFreshModules();
      state.flags.richText = true;
      createRowShell(doc, 'st:1', {streaming: true});
      snapshot.handleSnapshotPayload({
        generation: 1,
        rows: [assistantRow('st:1', {text: 'A'})],
        sessionKey: 'p1:s1',
        stream: {id: 'st:1', seq: 1, status: 'streaming'},
      });
      flushRaf();
      // 收尾前挂起一次 350ms 升级 timer
      streamMarkdown.scheduleStreamRichUpgrade('text');
      expect(streamMarkdown.streamRichUpgrade.timer).not.toBeNull();

      stream.applyStreamStatus({streamId: 'st:1', status: 'finished'});
      expect(streamMarkdown.streamRichUpgrade.timer).toBeNull();
      (renderRows as jest.Mock).mockClear();
      resetWriteCounts(doc);

      jest.advanceTimersByTime(RICH_UPGRADE_MS);
      expect(renderRows).not.toHaveBeenCalled();
      expect(totalWriteCount(doc)).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  /* ---------------- C21：thinking 增量失败回退（建壳） ---------------- */

  it('C21: thinking 在 text 壳之后首次到达（无 .thinking-body）回退 renderRows 建壳', () => {
    jest.useFakeTimers({doNotFake: ['requestAnimationFrame']});
    try {
      const {state, snapshot, stream} = loadFreshModules();
      state.flags.richText = true;
      // 只有 text 壳，没有 thinking section/body
      createRowShell(doc, 'st:1', {streaming: true});
      snapshot.handleSnapshotPayload({
        generation: 1,
        rows: [assistantRow('st:1')],
        sessionKey: 'p1:s1',
        stream: {id: 'st:1', seq: 0, status: 'streaming'},
      });
      flushRaf();
      stream.applyStreamDelta({
        streamId: 'st:1',
        seq: 1,
        segments: [{kind: 'text', delta: 'X'}],
        textHtml: '<p>X</p>',
        tailHtml: '<p>X</p>',
      });
      stream.applyStreamBlockCommit({
        streamId: 'st:1',
        seq: 1,
        blockKey: 'st:1:text:0',
        kind: 'text',
        html: '<p>X</p>',
        text: 'X',
        tailHtml: '<p>X</p>',
        tailText: 'X',
      });
      expect(
        stream.getStreamThinkingBody(
          doc.getElementById('stream-tail')!.querySelector('.bubble')!,
        ),
      ).toBeNull();
      (renderRows as jest.Mock).mockClear();

      stream.applyStreamDelta({
        streamId: 'st:1',
        seq: 2,
        segments: [{kind: 'thinking', delta: 'H'}],
        thinkingHtml: '<p>H</p>',
      });
      // 增量无 body 可写：必须回退整表建壳，而不是静默丢弃该拍
      expect(renderRows).toHaveBeenCalledTimes(1);
      expect(state.rows[0].thinking).toBe('H');
    } finally {
      jest.useRealTimers();
    }
  });

  /* ---------------- C18：异常快照的自动 resync ---------------- */

  it('C18: 异常快照微任务触发 resync，1s/5s 退避后连续 3 次停止', async () => {
    jest.useFakeTimers({
      doNotFake: ['requestAnimationFrame'],
    });
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    try {
      const {state, snapshot} = loadFreshModules();
      const anomalousSnapshot = (generation: number): void => {
        snapshot.handleSnapshotPayload({
          generation,
          rows: [userRow('u1')],
          sessionKey: 'p1:s1',
          stream: {id: 'st:missing', seq: generation, status: 'streaming'},
        });
      };

      // 第 1 次异常：同步块内零请求，退避截止写入，微任务后排队 1s 重试
      anomalousSnapshot(1);
      expect(state.streamCheckpoint).toBeNull();
      expect(state.snapshotResyncAnomalyCount).toBe(1);
      expect(state.snapshotResyncBackoffUntil).not.toBeNull();
      expect(resyncPosts()).toHaveLength(0);
      await Promise.resolve();
      jest.advanceTimersByTime(1000);
      expect(resyncPosts()).toHaveLength(1);

      // 第 2 次异常（重试后仍异常）：5s 退避
      anomalousSnapshot(2);
      expect(state.snapshotResyncAnomalyCount).toBe(2);
      await Promise.resolve();
      jest.advanceTimersByTime(4999);
      expect(resyncPosts()).toHaveLength(1);
      jest.advanceTimersByTime(1);
      expect(resyncPosts()).toHaveLength(2);

      // 第 3 次异常：停止自动 resync，留错误日志
      anomalousSnapshot(3);
      expect(state.snapshotResyncAnomalyCount).toBe(3);
      expect(state.snapshotResyncBackoffUntil).toBeNull();
      await Promise.resolve();
      jest.advanceTimersByTime(10000);
      expect(resyncPosts()).toHaveLength(2);
      expect(consoleError).toHaveBeenCalledTimes(1);
    } finally {
      consoleError.mockRestore();
      jest.useRealTimers();
    }
  });

  /* ---------------- T-SP14：流式滚动（贴底跟随 / 上滚偏移 / finished 不跳底） ---------------- */

  it('T-SP14: streaming 增长贴底用户逐拍跟随到底', () => {
    const {state, snapshot, stream} = loadFreshModules();
    const scroller = installScroller({
      scrollTop: 400,
      scrollHeight: 1000,
      clientHeight: 600,
    });
    state.nearBottom = true;
    createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1')],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 0, status: 'streaming'},
      scrollIntent: 'stick',
    });
    flushRaf();
    expect(scroller.scrollTop).toBe(400);

    // 第一拍增长：行高 +200 → 贴底用户跟随（去掉 scheduleStickIfNearBottom 后停在 400）
    scroller.scrollHeight = 1200;
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 1,
      segments: [{kind: 'text', delta: 'a'}],
    });
    flushRaf();
    expect(scroller.scrollTop).toBe(600);

    // 第二拍继续增长：仍贴底
    scroller.scrollHeight = 1500;
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 2,
      segments: [{kind: 'text', delta: 'b'}],
    });
    flushRaf();
    expect(scroller.scrollTop).toBe(900);
    expect(state.nearBottom).toBe(true);
  });

  it('T-SP14: 上滚用户流式增长零移动；preserve 快照保持距底偏移', () => {
    const {state, snapshot, stream} = loadFreshModules();
    const scroller = installScroller({
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 600,
    });
    state.nearBottom = false;
    createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'hello'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 1, status: 'streaming'},
      scrollIntent: 'preserve',
    });
    flushRaf();
    expect(scroller.scrollTop).toBe(100);

    // 流式增长：上滚用户零移动（不贴底、也不改读位）
    scroller.scrollHeight = 1200;
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 2,
      segments: [{kind: 'text', delta: '!'}],
    });
    flushRaf();
    expect(scroller.scrollTop).toBe(100);
    expect(state.nearBottom).toBe(false);

    // preserve 快照：内容继续变高，距底偏移保持（不跳底）
    const before = offsetBottom(scroller);
    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [assistantRow('st:1', {text: 'hello!!'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
      scrollIntent: 'preserve',
    });
    scroller.scrollHeight = 1400;
    flushRaf();
    expect(offsetBottom(scroller)).toBe(before);
  });

  it('T-SP14: finished bar 消失——贴底用户仍贴底，不露空档', () => {
    const {state, snapshot, stream} = loadFreshModules();
    const scroller = installScroller({
      scrollTop: 400,
      scrollHeight: 1000,
      clientHeight: 600,
    });
    state.nearBottom = true;
    createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'done'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
      scrollIntent: 'stick',
    });
    flushRaf();

    // status 翻 finished：生成中 bar 消失（行高 -40）
    scroller.scrollHeight = 960;
    stream.applyStreamStatus({
      streamId: 'st:1',
      status: 'finished',
      messageId: 'db-1',
      row: assistantRow('st:1', {
        status: 'finished',
        text: 'done',
        messageId: 'db-1',
      }),
    });
    flushRaf();
    // applyStreamStatus 末尾的 scheduleStickIfNearBottom 让贴底用户仍贴底
    expect(scroller.scrollTop).toBe(360);
    expect(offsetBottom(scroller)).toBe(0);
  });

  it('T-SP14: finished bar 消失后上滚用户不被拽到底', () => {
    const {state, snapshot, stream} = loadFreshModules();
    const scroller = installScroller({
      scrollTop: 100,
      scrollHeight: 1000,
      clientHeight: 600,
    });
    state.nearBottom = false;
    createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'done'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
      scrollIntent: 'preserve',
    });
    flushRaf();

    scroller.scrollHeight = 960;
    stream.applyStreamStatus({
      streamId: 'st:1',
      status: 'finished',
      messageId: 'db-1',
      row: assistantRow('st:1', {
        status: 'finished',
        text: 'done',
        messageId: 'db-1',
      }),
    });
    flushRaf();
    expect(scroller.scrollTop).toBe(100);
    expect(state.nearBottom).toBe(false);
  });

  /* ---------------- T-SP12：applyStreamStatus 文本只增不减 ---------------- */

  it('T-SP12: row 带更长文本时替换，finished 后 DOM 文本 === 新 row.text', () => {
    const {state, snapshot, stream} = loadFreshModules();
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'abc'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
    });
    flushRaf();
    shell.textBody.textContent = 'abc';

    stream.applyStreamStatus({
      streamId: 'st:1',
      status: 'finished',
      messageId: 'db-1',
      row: assistantRow('st:1', {
        status: 'finished',
        text: 'abcdef',
        textHtml: '<p>abcdef</p>',
        messageId: 'db-1',
      }),
    });
    expect(state.rows[0].text).toBe('abcdef');
    expect(state.rows[0].textHtml).toBe('<p>abcdef</p>');
    expect(shell.textBody.textContent).toBe('abcdef');
  });

  it('T-SP12: 更短 incoming 成对保留 text/textHtml/thinkingHtml（rich marker 恰好一次）', () => {
    const {state, snapshot, stream} = loadFreshModules();
    state.flags.richText = true;
    const shell = createRowShell(doc, 'st:1', {
      streaming: true,
      withThinking: true,
    });
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [
        assistantRow('st:1', {
          text: 'abcdef',
          textHtml: '<p>abcdef</p>',
          thinking: 'think',
          thinkingHtml: '<p>think</p>',
        }),
      ],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
    });
    flushRaf();

    stream.applyStreamStatus({
      streamId: 'st:1',
      status: 'finished',
      messageId: 'db-1',
      row: assistantRow('st:1', {
        status: 'finished',
        text: 'ab',
        textHtml: '<p>ab</p>',
        thinking: 't',
        thinkingHtml: '<p>t</p>',
        messageId: 'db-1',
      }),
    });
    // incoming 更短：text 与 textHtml/thinkingHtml 成对保留本地
    expect(state.rows[0].text).toBe('abcdef');
    expect(state.rows[0].textHtml).toBe('<p>abcdef</p>');
    expect(state.rows[0].thinking).toBe('think');
    expect(state.rows[0].thinkingHtml).toBe('<p>think</p>');
    // finished 后 DOM 文本 === 保留的 row.text；rich 用明文 marker 计数
    expect(shell.textBody.innerHTML).toBe('<p>abcdef</p>');
    expect(countHtmlOccurrences(shell.bubble, 'abcdef')).toBe(1);
    expect(shell.thinkingBody!.innerHTML).toBe('<p>think</p>');
    expect(countHtmlOccurrences(shell.bubble, 'think')).toBe(1);
  });

  it('T-SP12: row.text undefined 不判短；非法 id/role/status 的 row 不采用', () => {
    const cases: Array<{
      label: string;
      incoming: Partial<MessageRow>;
      messageId?: string;
    }> = [
      {
        label: 'wrong-id',
        incoming: {
          id: 'st:other',
          text: 'ab',
          textHtml: '<p>ab</p>',
          messageId: 'db-bad',
        },
      },
      {
        label: 'wrong-role',
        incoming: {
          role: 'user',
          text: 'ab',
          textHtml: '<p>ab</p>',
          messageId: 'db-bad',
        },
      },
      {
        label: 'wrong-status',
        incoming: {
          status: 'streaming',
          text: 'ab',
          textHtml: '<p>ab</p>',
          messageId: 'db-bad',
        },
      },
      {
        label: 'text-undefined',
        incoming: {text: undefined, textHtml: undefined, messageId: 'db-1'},
        messageId: 'db-1',
      },
    ];
    for (const testCase of cases) {
      const {state, snapshot, stream} = loadFreshModules();
      snapshot.handleSnapshotPayload({
        generation: 1,
        rows: [
          assistantRow('st:1', {text: 'abcdef', textHtml: '<p>abcdef</p>'}),
        ],
        sessionKey: 'p1:s1',
        stream: {id: 'st:1', seq: 2, status: 'streaming'},
      });
      flushRaf();
      stream.applyStreamStatus({
        streamId: 'st:1',
        status: 'finished',
        messageId: testCase.messageId,
        row: assistantRow('st:1', {
          status: 'finished',
          messageId: 'db-1',
          ...testCase.incoming,
        }),
      });
      // 四类 incoming 都不判短：本地长文本保留
      expect(state.rows[0].text).toBe('abcdef');
      expect(state.rows[0].textHtml).toBe('<p>abcdef</p>');
      if (testCase.messageId == null) {
        // 非法行整行不采用：row.messageId 不会被非法行的 db-bad 顶替
        expect(state.rows[0].messageId).toBeUndefined();
      } else {
        // undefined 不判短：status 载荷的 messageId 正常写入
        expect(state.rows[0].messageId).toBe('db-1');
      }
    }
  });

  it('T-SP12: tools 覆盖、后续不带 row 的 status 不丢 messageId/文本/tools', () => {
    const {state, snapshot, stream} = loadFreshModules();
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'abc'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
    });
    flushRaf();
    const nextTools = [{name: 'read', status: 'completed', toolUseId: 't1'}];
    stream.applyStreamStatus({
      streamId: 'st:1',
      status: 'finished',
      messageId: 'db-1',
      row: assistantRow('st:1', {
        status: 'finished',
        text: 'abc',
        tools: nextTools,
        messageId: 'db-1',
      }),
    });
    expect(state.rows[0].tools).toEqual(nextTools);
    expect(state.rows[0].messageId).toBe('db-1');

    stream.applyStreamStatus({streamId: 'st:1', status: 'finished'});
    expect(state.rows[0].messageId).toBe('db-1');
    expect(state.rows[0].text).toBe('abc');
    expect(state.rows[0].tools).toEqual(nextTools);
  });

  /* ---------------- T-SP11：finished 行正文校正（runtime DOM 半） ---------------- */

  it('T-SP11: finished 行 plain body.textContent === row.text；rich 多块 marker 各一次', () => {
    const {state, snapshot} = loadFreshModules();
    const plainShell = createRowShell(doc, 'st:f1', {streaming: false});
    plainShell.textBody.innerHTML = 'stale';
    state.rows = [assistantRow('st:f1', {status: 'finished', text: 'B1B2'})];
    snapshot.reconcileFinishedStreamingRows();
    expect(plainShell.textBody.textContent).toBe('B1B2');

    state.flags.richText = true;
    const richShell = createRowShell(doc, 'st:f2', {streaming: false});
    richShell.textBody.innerHTML = 'stale';
    state.rows = [
      assistantRow('st:f2', {
        status: 'finished',
        text: 'B1B2',
        textHtml: '<p>B1</p><p>B2</p>',
      }),
    ];
    snapshot.reconcileFinishedStreamingRows();
    expect(richShell.textBody.innerHTML).toBe('<p>B1</p><p>B2</p>');
    expect(countHtmlOccurrences(richShell.bubble, 'B1')).toBe(1);
    expect(countHtmlOccurrences(richShell.bubble, 'B2')).toBe(1);
  });

  /* ---------------- T-SP30：快照 seed 后的块状态 ---------------- */

  it('T-SP30: 快照 seed 后 fullReplaceOnly——后续 delta 用全量 html 替换 body，marker 恰好一次', () => {
    const {state, snapshot, stream} = loadFreshModules();
    state.flags.richText = true;
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [
        assistantRow('st:1', {
          text: 'M1M2',
          textHtml: '<p>M1</p><p>M2</p>',
        }),
      ],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
    });
    flushRaf();
    expect(state.fullReplaceOnly).toBe('st:1');
    expect(shell.textBody.innerHTML).toBe('<p>M1</p><p>M2</p>');

    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 3,
      segments: [{kind: 'text', delta: 'M3'}],
      textHtml: '<p>M1</p><p>M2</p><p>M3</p>',
      tailHtml: '<p>M3</p>',
    });
    // 全量 html 写 body（tailHtml 不参与），每个 marker 恰好一次
    expect(shell.textBody.innerHTML).toBe('<p>M1</p><p>M2</p><p>M3</p>');
    expect(countHtmlOccurrences(shell.bubble, 'M1')).toBe(1);
    expect(countHtmlOccurrences(shell.bubble, 'M2')).toBe(1);
    expect(countHtmlOccurrences(shell.bubble, 'M3')).toBe(1);

    // fullReplaceOnly 期间块提交忽略（appliedBlockKeys 不增长、DOM 不变）
    const before = shell.textBody.innerHTML;
    stream.applyStreamBlockCommit({
      streamId: 'st:1',
      seq: 3,
      blockKey: 'st:1:text:0',
      kind: 'text',
      html: '<p>M1</p>',
      text: 'M1',
    });
    expect(state.appliedBlockKeys.size).toBe(0);
    expect(shell.textBody.innerHTML).toBe(before);
    expect(countHtmlOccurrences(shell.bubble, 'M1')).toBe(1);
  });

  it('T-SP30: richText 多段 seed 后新 step（新 streamId）仍可块切分', () => {
    const {state, snapshot, stream} = loadFreshModules();
    state.flags.richText = true;
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'M1', textHtml: '<p>M1</p>'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 1, status: 'streaming'},
    });
    flushRaf();
    // 新 step：新 streamId 空行 → fullReplaceOnly 清空、块模式复位
    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [assistantRow('st:2')],
      sessionKey: 'p1:s1',
      stream: {id: 'st:2', seq: 0, status: 'streaming'},
    });
    flushRaf();
    expect(state.fullReplaceOnly).toBeNull();
    expect(state.appliedBlockKeys.size).toBe(0);

    // 空 streaming 新 step 仍可块切分：首块 append 到尾块容器之前、尾块重置
    const shell = createRowShell(doc, 'st:2', {streaming: true});
    stream.applyStreamDelta({
      streamId: 'st:2',
      seq: 1,
      segments: [{kind: 'text', delta: 'A'}],
      textHtml: '<p>A</p>',
      tailHtml: '<p>A</p>',
    });
    stream.applyStreamBlockCommit({
      streamId: 'st:2',
      seq: 1,
      blockKey: 'st:2:text:0',
      kind: 'text',
      html: '<p>A</p>',
      text: 'A',
      tailHtml: '<p>A</p>',
      tailText: 'A',
    });
    expect(state.appliedBlockKeys.has('st:2:text:0')).toBe(true);
    const tailEl = shell.textBody.querySelector('.stream-active-tail');
    expect(tailEl).not.toBeNull();
    expect(tailEl!.innerHTML).toBe('<p>A</p>');
    // 已提交块在尾块容器之前 append（不写回 body 全量、不复制）：'A' 恰好两处
    // ——已提交块与尾块容器各一次；第三次出现即说明块内容被复制（P2-18g）。
    expect(countHtmlOccurrences(shell.bubble, 'A')).toBe(2);
  });

  it('T-SP30b: 旧 #stream-tail 与 delta/block 的 streamId 不一致时零写入并整表刷新', () => {
    const {state, snapshot, stream, streamMarkdown} = loadFreshModules();
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:new', {text: 'seed'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:new', seq: 1, status: 'streaming'},
    });
    flushRaf();
    const stale = createRowShell(doc, 'st:old', {streaming: true});
    stale.textBody.textContent = 'old';
    resetWriteCounts(doc);
    (renderRows as jest.Mock).mockClear();

    stream.applyStreamDelta({
      streamId: 'st:new',
      seq: 2,
      segments: [{kind: 'text', delta: ' NEW'}],
    });
    expect(stale.textBody.textContent).toBe('old');
    expect(stale.textBody.writeCount).toBe(0);
    expect(renderRows).toHaveBeenCalled();

    state.fullReplaceOnly = null;
    (renderRows as jest.Mock).mockClear();
    stream.applyStreamBlockCommit({
      streamId: 'st:new',
      seq: 2,
      blockKey: 'st:new:text:0',
      kind: 'text',
      html: '<p>NEW</p>',
      text: 'NEW',
      tailHtml: '<p>NEW</p>',
      tailText: 'NEW',
    });
    expect(stale.bubble.innerHTML).not.toContain('NEW');
    expect(state.appliedBlockKeys.has('st:new:text:0')).toBe(false);
    expect(renderRows).toHaveBeenCalled();

    // 350ms 富文本升级也不能写旧尾巴。
    state.flags.richText = true;
    resetWriteCounts(doc);
    jest.useFakeTimers();
    try {
      streamMarkdown.scheduleStreamRichUpgrade('text');
      jest.advanceTimersByTime(RICH_UPGRADE_MS);
    } finally {
      jest.useRealTimers();
    }
    expect(stale.textBody.writeCount).toBe(0);
  });

  /* ---------------- T-SP31：plain 增量 / rich 开关 reseed ---------------- */

  it('T-SP31: plain 路径首包/连续 delta/tools-only 只 append，body 节点引用不变', () => {
    const {state, snapshot, stream} = loadFreshModules();
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1')],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 0, status: 'streaming'},
    });
    flushRaf();
    // 首包：waiting-first → 建壳一次（真实 Preact 会播种 row.text）
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 1,
      segments: [{kind: 'text', delta: 'Hello'}],
      textHtml: '<p>Hello</p>',
    });
    emulateShellSeed(shell, state.rows[0]);
    const bodyRef = shell.textBody;
    resetWriteCounts(doc);

    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 2,
      segments: [{kind: 'text', delta: ' world'}],
      textHtml: '<p>Hello world</p>',
    });
    expect(state.rows[0].text).toBe('Hello world');
    expect(shell.textBody).toBe(bodyRef);
    expect(shell.textBody.textContent).toBe('Hello world');
    // plain 只 appendEscapedDelta 增量（一次 insertAdjacentHTML），不整段替换
    expect(shell.textBody.writeCount).toBe(1);

    // tools-only 拍：正文零写入、节点引用不变；工具卡整表刷新
    (renderRows as jest.Mock).mockClear();
    resetWriteCounts(doc);
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 3,
      segments: [],
      tools: [{name: 'read', status: 'running', toolUseId: 't1'}],
    });
    expect(state.rows[0].text).toBe('Hello world');
    expect(shell.textBody).toBe(bodyRef);
    expect(shell.textBody.textContent).toBe('Hello world');
    expect(totalWriteCount(doc)).toBe(0);
    expect(renderRows).toHaveBeenCalledTimes(1);
  });

  it('T-SP31: richText 开→关置 plainReseedStreamId；关→开清 lastStreamHtmlStreamId', () => {
    const {state, snapshot, bridge} = loadFreshModules();
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'hi'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 1, status: 'streaming'},
    });
    flushRaf();

    // 关→开：下一次快照强制 reseed（清 lastStreamHtmlStreamId / plainReseedStreamId）
    state.lastStreamHtmlStreamId = 'st:1';
    state.plainReseedStreamId = 'st:1';
    bridge.handleHostMessage({
      v: 1,
      type: 'flagsUpdate',
      payload: {flags: {richText: true, menuDisabled: false}},
    });
    expect(state.flags.richText).toBe(true);
    expect(state.lastStreamHtmlStreamId).toBeNull();
    expect(state.plainReseedStreamId).toBeNull();

    // 开→关：置 plainReseedStreamId 指向当前 streaming 行（UI 消费后清空）
    bridge.handleHostMessage({
      v: 1,
      type: 'flagsUpdate',
      payload: {flags: {richText: false, menuDisabled: false}},
    });
    expect(state.flags.richText).toBe(false);
    expect(state.plainReseedStreamId).toBe('st:1');
  });

  it('T-SP31: richText 开→关后 StreamingMessageRow 把 body 重播种为 row.text 纯文本', () => {
    const {state, StreamingMessageRow} = loadFreshModules();
    state.flags.richText = false;
    const row = assistantRow('st:1', {
      text: 'plain text',
      textHtml: '<p>plain</p>',
    });
    state.rows = [row];
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    shell.textBody.className = 'bubble-body rich';
    shell.textBody.innerHTML = '<p>old markdown</p>';
    state.plainReseedStreamId = 'st:1';

    StreamingMessageRow({row});

    // body 重播种为 row.text；旧 markdown HTML 不残留、rich 类摘除、标记消费后清空
    expect(shell.textBody.textContent).toBe('plain text');
    expect(shell.textBody.innerHTML).toBe('plain text');
    expect(shell.textBody.classList.contains('rich')).toBe(false);
    expect(state.plainReseedStreamId).toBeNull();

    // rich 再打开时不得消费（不能把全量 html 洗成纯文本）
    shell.textBody.className = 'bubble-body rich';
    shell.textBody.innerHTML = '<p>keep</p>';
    state.plainReseedStreamId = 'st:1';
    state.flags.richText = true;
    StreamingMessageRow({row});
    expect(shell.textBody.innerHTML).toBe('<p>keep</p>');
    expect(state.plainReseedStreamId).toBe('st:1');
  });

  it('T-SP31: richText 关→开触发快照 reseed，body 立即变为全量 html', () => {
    const {state, snapshot, bridge} = loadFreshModules();
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'hello'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
    });
    flushRaf();
    shell.textBody.textContent = 'hello';

    bridge.handleHostMessage({
      v: 1,
      type: 'flagsUpdate',
      payload: {flags: {richText: true, menuDisabled: false}},
    });
    expect(state.lastStreamHtmlStreamId).toBeNull();

    // 关→开后下一次快照携带全量 html：needsReseed → body 写成全量 html
    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [assistantRow('st:1', {text: 'hello', textHtml: '<p>hello</p>'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
    });
    flushRaf();
    expect(shell.textBody.innerHTML).toBe('<p>hello</p>');
    expect(shell.textBody.classList.contains('rich')).toBe(true);
  });

  /* ---------------- C21 applyStreamStatus / applyStreamReset ---------------- */

  it('applyStreamStatus: 文本只增不减、messageId 不丢、status 翻 finished', () => {
    const {state, snapshot, stream} = loadFreshModules();
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'abcdef'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
    });
    flushRaf();
    stream.applyStreamStatus({
      streamId: 'st:1',
      status: 'finished',
      messageId: 'db-1',
      row: assistantRow('st:1', {
        status: 'finished',
        text: 'abc',
        textHtml: '<p>abc</p>',
        messageId: 'db-1',
      }),
    });
    expect(state.rows[0].status).toBe('finished');
    expect(state.rows[0].messageId).toBe('db-1');
    // incoming 更短：text 与 textHtml 成对保留本地
    expect(state.rows[0].text).toBe('abcdef');
    expect(state.rows[0].textHtml).toBeUndefined();
    expect(state.streamCheckpoint).toEqual({
      id: 'st:1',
      seq: 2,
      status: 'finished',
    });
  });

  it('applyStreamReset: streamIds 严格按列表删除；[] 不删；缺省删最后一条 streaming', () => {
    const {state, snapshot, stream} = loadFreshModules();
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:a', {text: 'a'}), assistantRow('st:b')],
      sessionKey: 'p1:s1',
      stream: {id: 'st:b', seq: 1, status: 'streaming'},
    });
    flushRaf();
    stream.applyStreamReset({streamIds: []});
    expect(state.rows.map(r => r.id)).toEqual(['st:a', 'st:b']);

    stream.applyStreamReset({streamIds: ['st:a']});
    expect(state.rows.map(r => r.id)).toEqual(['st:b']);

    stream.applyStreamReset({});
    expect(state.rows).toEqual([]);
    expect(state.streamCheckpoint).toBeNull();
    expect(state.fullReplaceOnly).toBeNull();
    expect(state.appliedBlockKeys.size).toBe(0);
  });

  it('bridge streamReset: 旧代次在途末片被 invalidateSnapshotPipeline 作废，行不复活', () => {
    const {state, snapshot, bridge} = loadFreshModules();
    snapshot.handleSnapshotPayload({
      generation: 5,
      chunkIndex: 0,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      rows: [assistantRow('st:a', {text: 'a'})],
      stream: {id: 'st:a', seq: 1, status: 'streaming'},
    });
    // reset 与分片同拍：作废在途 gen5 收集器
    bridge.handleHostMessage({
      v: 1,
      type: 'streamReset',
      payload: {streamIds: ['st:a'], generation: 5},
    });
    expect(state.rows).toEqual([]);
    // gen5 末片迟到：代次不新于已作废代次，丢弃
    snapshot.handleSnapshotPayload({
      generation: 5,
      chunkIndex: 1,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      rows: [assistantRow('st:a', {text: 'a'})],
      stream: {id: 'st:a', seq: 1, status: 'streaming'},
      scrollIntent: 'stick',
    });
    flushRaf();
    expect(state.rows).toEqual([]);
    expect(state.streamCheckpoint).toBeNull();
  });

  it('bridge init: labels 下发覆盖默认值，缺省回退默认中文', () => {
    const {state, bridge} = loadFreshModules();
    expect(state.labels.generating).toBe('生成中');
    bridge.handleHostMessage({
      v: 1,
      type: 'init',
      payload: {
        labels: {
          generating: 'Generating',
          thinking: 'Thinking',
          empty: 'No messages',
          loadOlder: 'Load older',
        },
      },
    });
    expect(state.labels).toEqual({
      generating: 'Generating',
      thinking: 'Thinking',
      empty: 'No messages',
      loadOlder: 'Load older',
    });
    bridge.handleHostMessage({v: 1, type: 'init', payload: {}});
    expect(state.labels.generating).toBe('生成中');
  });

  /* ---------------- T-SP23~T-SP25：mid-run / finished resume / 不重复 ---------------- */

  it('T-SP23: mid-run snapshot(seq5)→delta6/7→snapshot7→finished，文本不重复不回退', () => {
    const {state, snapshot, stream} = loadFreshModules();
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'abcde'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 5, status: 'streaming'},
    });
    flushRaf();
    expect(shell.textBody.textContent).toBe('abcde');

    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 6,
      segments: [{kind: 'text', delta: 'f'}],
    });
    stream.applyStreamDelta({
      streamId: 'st:1',
      seq: 7,
      segments: [{kind: 'text', delta: 'g'}],
    });
    expect(state.rows[0].text).toBe('abcdefg');

    // 再快照（seq 7、内容一致）：不回退不重复；snapshot 后仍可继续 finished
    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [assistantRow('st:1', {text: 'abcdefg'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 7, status: 'streaming'},
    });
    flushRaf();
    expect(state.rows[0].text).toBe('abcdefg');
    expect(state.streamCheckpoint).toEqual({
      id: 'st:1',
      seq: 7,
      status: 'streaming',
    });
    expect(shell.textBody.textContent).toBe('abcdefg');

    stream.applyStreamStatus({
      streamId: 'st:1',
      status: 'finished',
      messageId: 'db-1',
      row: assistantRow('st:1', {
        status: 'finished',
        text: 'abcdefg',
        messageId: 'db-1',
      }),
    });
    expect(state.rows[0].text).toBe('abcdefg');
    expect(shell.textBody.textContent).toBe('abcdefg');
  });

  it('T-SP24: finished resume——普通快照替换 rows，同 id 保留 DOM、bar 消失、无重复行', () => {
    const {state, snapshot, stream} = loadFreshModules();
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'done'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
    });
    flushRaf();
    stream.applyStreamStatus({
      streamId: 'st:1',
      status: 'finished',
      messageId: 'db-1',
      row: assistantRow('st:1', {
        status: 'finished',
        text: 'done',
        messageId: 'db-1',
      }),
    });
    expect(state.rows[0].status).toBe('finished');
    // Preact 壳重渲移除 stream-tail id / bar（无 jsdom，手动模拟重渲结果）
    shell.rowEl.id = '';
    const bodyRef = shell.textBody;

    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [
        assistantRow('st:1', {
          status: 'finished',
          text: 'done',
          messageId: 'db-1',
        }),
      ],
      sessionKey: 'p1:s1',
    });
    flushRaf();
    // finished 后普通快照：同 id 仍是一条，body 节点沿用、文本不重复
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].id).toBe('st:1');
    expect(doc.getElementById('stream-tail')).toBeNull();
    expect(shell.textBody).toBe(bodyRef);
    expect(bodyRef.textContent).toBe('done');
  });

  it('T-SP25: DB 接管快照行数 = DB 可见行数，assistant 恰好一条（流式行不额外计数）', () => {
    const {state, snapshot} = loadFreshModules();
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [userRow('u1'), assistantRow('st:1', {text: 'partial'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 3, status: 'streaming'},
    });
    flushRaf();
    expect(state.rows).toHaveLength(2);

    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [
        userRow('u1'),
        assistantRow('st:1', {
          status: 'finished',
          text: 'done',
          messageId: 'db-1',
        }),
      ],
      sessionKey: 'p1:s1',
    });
    flushRaf();
    expect(state.rows).toHaveLength(2);
    expect(state.rows.filter(r => r.role === 'assistant')).toHaveLength(1);
    expect(new Set(state.rows.map(r => r.id)).size).toBe(state.rows.length);
    // 原地接管：同一行元素被 reconcile 校正成终态文本
    expect(shell.textBody.textContent).toBe('done');
  });

  /* ---------------- CR1 web-runtime：P1-1 / P1-5 / P2-1 / P2-7 / P2-10 / P2-11 ---------------- */

  it('P1-1: 在途快照的旧捕获行不回退已收尾终态（status/messageId/tools/text）', () => {
    const {state, snapshot, stream} = loadFreshModules();
    const shell = createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [userRow('u1'), assistantRow('st:1', {text: 'partial'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 5, status: 'streaming'},
    });
    flushRaf();
    emulateShellSeed(shell, state.rows[1]);

    const tools = [{name: 'read', status: 'completed', toolUseId: 't1'}];
    stream.applyStreamStatus({
      streamId: 'st:1',
      status: 'finished',
      messageId: 'db-1',
      row: assistantRow('st:1', {
        status: 'finished',
        text: 'partial done',
        messageId: 'db-1',
        tools,
      }),
    });
    expect(state.rows[1].status).toBe('finished');

    // 分片在途的末片（捕获行仍是 streaming、无 messageId、正文更短）后到
    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [userRow('u1'), assistantRow('st:1', {text: 'partial'})],
      sessionKey: 'p1:s1',
    });
    flushRaf();
    const row = state.rows[1];
    expect(row.status).toBe('finished');
    expect(row.messageId).toBe('db-1');
    expect(row.tools).toEqual(tools);
    expect(row.text).toBe('partial done');
  });

  it('P1-1: 会话切换按新基线采用（终态保护不跨会话）', () => {
    const {state, snapshot, stream} = loadFreshModules();
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'old'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
    });
    flushRaf();
    stream.applyStreamStatus({
      streamId: 'st:1',
      status: 'finished',
      messageId: 'db-1',
      row: assistantRow('st:1', {
        status: 'finished',
        text: 'old',
        messageId: 'db-1',
      }),
    });

    snapshot.handleSnapshotPayload({
      generation: 2,
      rows: [assistantRow('st:1', {text: 'other'})],
      sessionKey: 'p2:s9',
    });
    flushRaf();
    expect(state.rows[0].status).toBe('streaming');
    expect(state.rows[0].messageId).toBeUndefined();
    expect(state.rows[0].text).toBe('other');
  });

  it('P1-5: finished 行 richText 开→关后摘 rich，纯文本换行保留', () => {
    const {state, snapshot} = loadFreshModules();
    state.flags.richText = true;
    const shell = createRowShell(doc, 'st:f', {streaming: false});
    state.rows = [
      assistantRow('st:f', {
        status: 'finished',
        text: 'L1\nL2',
        textHtml: '<p>L1</p><p>L2</p>',
      }),
    ];
    snapshot.reconcileFinishedStreamingRows();
    expect(shell.textBody.classList.contains('rich')).toBe(true);

    // rich 关闭：同一行（无 textHtml）经快照 -> reconcile 走 plain 分支
    state.flags.richText = false;
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:f', {status: 'finished', text: 'L1\nL2'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:f', seq: 3, status: 'finished'},
    });
    flushRaf();
    expect(shell.textBody.classList.contains('rich')).toBe(false);
    expect(shell.textBody.classList.contains('stream-tail-plain')).toBe(false);
    expect(shell.textBody.textContent).toBe('L1\nL2');
  });

  it('P2-1(web): 分片在途起新流——cp 指向组装基线外的行时按无流快照收敛', () => {
    const {state, snapshot} = loadFreshModules();
    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 0,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      rows: [userRow('u1')],
      stream: {id: 'st:new', seq: 1, status: 'streaming'},
    });
    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 1,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      rows: [userRow('u2')],
      scrollIntent: 'stick',
    });
    flushRaf();
    expect(state.rows.map(r => r.id)).toEqual(['u1', 'u2']);
    // 组装基线里没有 st:new：不能把 cp 挂上去触发异常重传风暴
    expect(state.streamCheckpoint).toBeNull();
    expect(state.snapshotResyncAnomalyCount).toBe(0);
    expect(resyncPosts()).toHaveLength(0);
  });

  it('P2-7: 行缺失时带 row/messageId 的终态请求对账；纯 status 迟到忽略', () => {
    const nowSpy = jest.spyOn(performance, 'now').mockReturnValue(1000);
    try {
      const {state, snapshot, stream} = loadFreshModules();
      snapshot.handleSnapshotPayload({
        generation: 1,
        rows: [assistantRow('st:b')],
        sessionKey: 'p1:s1',
        stream: {id: 'st:b', seq: 3, status: 'streaming'},
      });
      flushRaf();

      stream.applyStreamStatus({
        streamId: 'st:a',
        status: 'finished',
        messageId: 'db-a',
        row: assistantRow('st:a', {
          status: 'finished',
          messageId: 'db-a',
        }),
      });
      expect(resyncPosts()).toHaveLength(1);
      expect(resyncPosts()[0].payload).toEqual({
        streamId: 'st:a',
        expectedSeq: 3,
      });

      // 快照未带回 st:a：纯 status 的迟到消息保持忽略（不再触发对账）
      state.resyncPending = null;
      nowSpy.mockReturnValue(2000);
      stream.applyStreamStatus({streamId: 'st:a', status: 'finished'});
      expect(resyncPosts()).toHaveLength(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('P2-7: 空流式行收尾移除时块/升级态与 applyStreamReset 对齐', () => {
    jest.useFakeTimers({doNotFake: ['requestAnimationFrame']});
    try {
      const {state, snapshot, stream, streamMarkdown} = loadFreshModules();
      state.flags.richText = true;
      createRowShell(doc, 'st:1', {streaming: true});
      snapshot.handleSnapshotPayload({
        generation: 1,
        rows: [assistantRow('st:1')],
        sessionKey: 'p1:s1',
        stream: {id: 'st:1', seq: 0, status: 'streaming'},
      });
      flushRaf();
      state.appliedBlockKeys = new Set(['st:1:text:0']);
      streamMarkdown.scheduleStreamRichUpgrade('text');
      expect(streamMarkdown.streamRichUpgrade.timer).not.toBeNull();

      stream.applyStreamStatus({streamId: 'st:1', status: 'finished'});
      expect(state.rows).toEqual([]);
      expect(state.streamCheckpoint).toBeNull();
      expect(state.fullReplaceOnly).toBeNull();
      expect(state.appliedBlockKeys.size).toBe(0);
      expect(streamMarkdown.streamRichUpgrade.timer).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it('P2-7: 非法 status（streaming）不得收尾', () => {
    const {state, snapshot, stream} = loadFreshModules();
    createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: 'x'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 2, status: 'streaming'},
    });
    flushRaf();
    stream.applyStreamStatus({streamId: 'st:1', status: 'streaming'} as never);
    expect(state.rows[0].status).toBe('streaming');
    expect(state.streamCheckpoint).toEqual({
      id: 'st:1',
      seq: 2,
      status: 'streaming',
    });
  });

  it('P2-10: 收尾后补一次 mermaid 扫描（流式行失去 #stream-tail）', () => {
    const {snapshot, stream} = loadFreshModules();
    createRowShell(doc, 'st:1', {streaming: true});
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:1', {text: '```mermaid\ngraph TD;\n```'})],
      sessionKey: 'p1:s1',
      stream: {id: 'st:1', seq: 1, status: 'streaming'},
    });
    flushRaf();
    (scheduleMermaidScan as jest.Mock).mockClear();

    stream.applyStreamStatus({streamId: 'st:1', status: 'finished'});
    expect(scheduleMermaidScan).toHaveBeenCalledTimes(1);
  });

  it('P2-11: streamReset 后清理已删行的渲染签名（同 id 重建重新写 body）', () => {
    const {state, snapshot, stream} = loadFreshModules();
    const shell = createRowShell(doc, 'st:f', {streaming: false});
    state.rows = [assistantRow('st:f', {status: 'finished', text: 'done'})];
    snapshot.reconcileFinishedStreamingRows();
    expect(shell.textBody.textContent).toBe('done');

    stream.applyStreamReset({streamIds: ['st:f']});
    state.rows = [assistantRow('st:f', {status: 'finished', text: 'done'})];
    shell.textBody.textContent = 'stale';
    snapshot.reconcileFinishedStreamingRows();
    expect(shell.textBody.textContent).toBe('done');
  });

  it('P2-11: 快照换基线（新 streamId）后清理已不在 rows 的渲染签名', () => {
    const {state, snapshot} = loadFreshModules();
    const shell = createRowShell(doc, 'st:old', {streaming: false});
    state.rows = [assistantRow('st:old', {status: 'finished', text: 'old'})];
    snapshot.reconcileFinishedStreamingRows();
    expect(shell.textBody.textContent).toBe('old');

    // 新 streamId 快照：基线里不再有 st:old（旧行被 DB id 接管/淘汰）
    snapshot.handleSnapshotPayload({
      generation: 1,
      rows: [assistantRow('st:new')],
      sessionKey: 'p1:s1',
      stream: {id: 'st:new', seq: 0, status: 'streaming'},
    });
    flushRaf();

    // 旧行以同 id 重现时签名必须已失效，否则旧签名会让 reconcile 跳过重写
    state.rows = [assistantRow('st:old', {status: 'finished', text: 'old'})];
    shell.textBody.textContent = 'stale';
    snapshot.reconcileFinishedStreamingRows();
    expect(shell.textBody.textContent).toBe('old');
  });
});
