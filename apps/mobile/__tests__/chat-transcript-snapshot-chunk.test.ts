/**
 * sessionSnapshot 分片拼装测试（init-busy-yield Step 6 的 web 侧最小适配）。
 *
 * T-S1（web 半）：同代次分片按 chunkIndex 顺序拼装，末片到齐才整体
 * applySnapshot——rows 与单包直发等价，分片期间零中间渲染。
 * T-S2（web 半）：分片在途时新代次到达，旧代次收集作废、迟到旧片丢弃，
 * 不与新一代次叠加。
 * T-S4 前半：分片期间不 emitScrollSnapshot，末片应用后恰一次。
 *
 * 行为级直测（照 rows-click-anchor.test.ts 先例）：renderRows / mermaid /
 * stream / menu / post 等副作用出口全部 mock，document 以最小 fake scroller
 * 提供；requestAnimationFrame 以同步队列 stub 替换（stick 路径含嵌套 RAF）。
 */
jest.mock('../src/web/chat-transcript/webview/runtime/render/row-logic', () => ({
  renderRows: jest.fn(),
}));
jest.mock('../src/web/chat-transcript/webview/runtime/mermaid', () => ({
  scheduleMermaidScan: jest.fn(),
}));
jest.mock('../src/web/chat-transcript/webview/runtime/stream/stream', () => ({
  setStreamToolInvokingDom: jest.fn(),
}));
jest.mock('../src/web/chat-transcript/webview/runtime/menu/menu', () => ({
  closeContextMenu: jest.fn(),
}));
jest.mock('../src/web/chat-transcript/webview/runtime/bridge', () => ({
  post: jest.fn(),
}));

import {renderRows} from '../src/web/chat-transcript/webview/runtime/render/row-logic';
import {setStreamToolInvokingDom} from '../src/web/chat-transcript/webview/runtime/stream/stream';
import {post} from '../src/web/chat-transcript/webview/runtime/bridge';

type SnapshotModule = typeof import('../src/web/chat-transcript/webview/runtime/render/snapshot');
type StateModule = typeof import('../src/web/chat-transcript/webview/runtime/state/state');

/** 每个用例取全新模块实例（拼装状态与 state 单例都随 isolate 重建）。 */
function loadFreshModules(): {
  snapshot: SnapshotModule;
  state: StateModule['state'];
} {
  let snapshot: SnapshotModule | null = null;
  let state: StateModule['state'] | null = null;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    snapshot = require('../src/web/chat-transcript/webview/runtime/render/snapshot');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    state = require('../src/web/chat-transcript/webview/runtime/state/state')
      .state;
  });
  return {snapshot: snapshot!, state: state!};
}

function makeRows(prefix: string, count: number) {
  const rows: Array<{kind: 'message'; id: string; role: string; text: string}> =
    [];
  for (let i = 0; i < count; i++) {
    rows.push({
      kind: 'message',
      id: `${prefix}-${i}`,
      role: 'user',
      text: `${prefix} text ${i}`,
    });
  }
  return rows;
}

describe('sessionSnapshot 分片拼装（init-busy-yield Step 6）', () => {
  let rafQueue: Array<() => void>;
  let fakeScroller: {scrollTop: number; scrollHeight: number; clientHeight: number};

  beforeEach(() => {
    jest.clearAllMocks();
    rafQueue = [];
    fakeScroller = {scrollTop: 0, scrollHeight: 2000, clientHeight: 600};
    (global as unknown as {document: unknown}).document = {
      getElementById: (id: string) => (id === 'scroller' ? fakeScroller : null),
    };
    (global as unknown as {requestAnimationFrame: unknown}).requestAnimationFrame =
      (cb: () => void) => {
        rafQueue.push(cb);
        return rafQueue.length;
      };
  });

  afterEach(() => {
    delete (global as unknown as {document?: unknown}).document;
  });

  /** 同步冲净当前排队的 RAF（stick 路径为两层嵌套，多轮兜底）。 */
  function flushRaf(): void {
    for (let round = 0; round < 6; round++) {
      const cbs = rafQueue.splice(0, rafQueue.length);
      if (cbs.length === 0) {
        break;
      }
      for (const cb of cbs) {
        cb();
      }
    }
  }

  function scrollSnapshotPostCount(): number {
    return (post as jest.Mock).mock.calls.filter(
      (call: unknown[]) => call[0] === 'scrollSnapshot',
    ).length;
  }

  it('T-S1: 同代次分片按 chunkIndex 拼装，末片到齐才整体应用且与单包等价', () => {
    const {snapshot, state} = loadFreshModules();

    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 0,
      chunkTotal: 3,
      sessionKey: 'p1:s1',
      hasMore: true,
      generating: true,
      rows: makeRows('a', 2),
    });
    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 1,
      chunkTotal: 3,
      sessionKey: 'p1:s1',
      hasMore: true,
      generating: true,
      rows: makeRows('b', 2),
    });
    // 分片期间：不产生中间渲染、rows 基线不动
    expect(state.rows).toHaveLength(0);
    expect(renderRows).not.toHaveBeenCalled();

    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 2,
      chunkTotal: 3,
      sessionKey: 'p1:s1',
      hasMore: true,
      generating: true,
      rows: makeRows('c', 1),
      scrollIntent: 'stick',
    });
    flushRaf();

    expect(state.rows.map(row => row.id)).toEqual([
      'a-0',
      'a-1',
      'b-0',
      'b-1',
      'c-0',
    ]);
    expect(state.hasMore).toBe(true);
    expect(renderRows).toHaveBeenCalledTimes(1);
    expect(setStreamToolInvokingDom).toHaveBeenCalledWith(true);

    // 对照：同数据单包直发（gen2 单片）rows 与分片拼装全等
    const chunkedRows = state.rows.slice();
    snapshot.handleSnapshotPayload({
      generation: 2,
      chunkIndex: 0,
      chunkTotal: 1,
      sessionKey: 'p1:s1',
      hasMore: true,
      generating: true,
      rows: [
        ...makeRows('a', 2),
        ...makeRows('b', 2),
        ...makeRows('c', 1),
      ],
      scrollIntent: 'stick',
    });
    flushRaf();
    expect(state.rows).toEqual(chunkedRows);
  });

  it('T-S2: 分片在途时新代次顶替——旧代次收集作废、迟到旧片丢弃不叠加', () => {
    const {snapshot, state} = loadFreshModules();

    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 0,
      chunkTotal: 3,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('old', 1),
    });
    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 1,
      chunkTotal: 3,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('old', 1),
    });
    // force 新代次：gen2 首片到达，gen1 收集（已收 2 片）整体作废
    snapshot.handleSnapshotPayload({
      generation: 2,
      chunkIndex: 0,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('new', 2),
    });
    // gen1 迟到末片：比在途 gen2 旧，丢弃
    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 2,
      chunkTotal: 3,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('old', 1),
      scrollIntent: 'stick',
    });
    expect(state.rows).toHaveLength(0);
    expect(renderRows).not.toHaveBeenCalled();

    snapshot.handleSnapshotPayload({
      generation: 2,
      chunkIndex: 1,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('new-tail', 1),
      scrollIntent: 'stick',
    });
    flushRaf();

    // 只有 gen2 的行：旧代次行不混入（防叠加）
    expect(state.rows.map(row => row.id)).toEqual([
      'new-0',
      'new-1',
      'new-tail-0',
    ]);
    expect(renderRows).toHaveBeenCalledTimes(1);
  });

  it('T-S2: 已应用代次的迟到分片（未知代次）丢弃', () => {
    const {snapshot, state} = loadFreshModules();

    snapshot.handleSnapshotPayload({
      generation: 5,
      chunkIndex: 0,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('a', 1),
    });
    snapshot.handleSnapshotPayload({
      generation: 5,
      chunkIndex: 1,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('b', 1),
      scrollIntent: 'stick',
    });
    flushRaf();
    expect(state.rows.map(row => row.id)).toEqual(['a-0', 'b-0']);

    // gen5 已应用：其迟到重复片与更旧代次的任何片都丢弃
    snapshot.handleSnapshotPayload({
      generation: 5,
      chunkIndex: 1,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('late', 1),
      scrollIntent: 'stick',
    });
    snapshot.handleSnapshotPayload({
      generation: 4,
      chunkIndex: 0,
      chunkTotal: 1,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('older', 1),
    });
    expect(state.rows.map(row => row.id)).toEqual(['a-0', 'b-0']);
  });

  it('乱序分片丢弃：chunkIndex 跳跃后收集缺口不自愈（等 force 新代次兜底）', () => {
    const {snapshot, state} = loadFreshModules();

    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 0,
      chunkTotal: 3,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('a', 1),
    });
    // 跳过片 1 直达片 2：乱序丢弃
    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 2,
      chunkTotal: 3,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('c', 1),
      scrollIntent: 'stick',
    });
    expect(state.rows).toHaveLength(0);
    // 片 1 迟到：收集仍期待片 1？——片 2 已被丢，received 仍为 1，片 1 补到
    // 后 received=2，但末片（片 2）已丢，永远拼不齐 → 不应用；随后 force
    // 新代次 gen2 单片直达。
    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 1,
      chunkTotal: 3,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('b', 1),
    });
    expect(state.rows).toHaveLength(0);
    expect(renderRows).not.toHaveBeenCalled();

    snapshot.handleSnapshotPayload({
      generation: 2,
      chunkIndex: 0,
      chunkTotal: 1,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('r', 2),
      scrollIntent: 'stick',
    });
    flushRaf();
    expect(state.rows.map(row => row.id)).toEqual(['r-0', 'r-1']);
  });

  it('T-S4 前半: 分片期间不 emitScrollSnapshot，末片应用后恰一次', () => {
    const {snapshot} = loadFreshModules();

    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 0,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('a', 2),
    });
    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 1,
      chunkTotal: 2,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('b', 1),
      scrollIntent: 'stick',
    });
    // 末片尚未 flush RAF：scrollSnapshot 也尚未发出
    expect(scrollSnapshotPostCount()).toBe(0);
    flushRaf();
    expect(scrollSnapshotPostCount()).toBe(1);
  });

  it('T-S4 后半: 分片期间零 scrollSnapshot 且零 stick 写入，末片 stick/emit 行为与旧单包一致', () => {
    const {snapshot} = loadFreshModules();
    // fakeScroller.scrollTop 初始 0：stick 判定一旦执行会写 1400，
    // 分片期间保持 0 即锁死「拼装期不做 stick 判定」。
    const chunkPayloads = [
      {generation: 1, chunkIndex: 0, chunkTotal: 3, rows: makeRows('a', 2)},
      {generation: 1, chunkIndex: 1, chunkTotal: 3, rows: makeRows('b', 2)},
    ];
    for (const chunk of chunkPayloads) {
      snapshot.handleSnapshotPayload({
        ...chunk,
        sessionKey: 'p1:s1',
        hasMore: false,
      });
      expect(scrollSnapshotPostCount()).toBe(0);
      expect(fakeScroller.scrollTop).toBe(0);
    }
    snapshot.handleSnapshotPayload({
      generation: 1,
      chunkIndex: 2,
      chunkTotal: 3,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('c', 1),
      scrollIntent: 'stick',
    });
    flushRaf();
    // 末片应用后：一次 stick 到底 + 恰一次 scrollSnapshot
    expect(fakeScroller.scrollTop).toBe(1400);
    expect(scrollSnapshotPostCount()).toBe(1);
    const chunkedPost = (post as jest.Mock).mock.calls.find(
      (call: unknown[]) => call[0] === 'scrollSnapshot',
    )![1];

    // 对照：同数据旧单包（gen2 单片）行为全等
    snapshot.handleSnapshotPayload({
      generation: 2,
      chunkIndex: 0,
      chunkTotal: 1,
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: [...makeRows('a', 2), ...makeRows('b', 2), ...makeRows('c', 1)],
      scrollIntent: 'stick',
    });
    flushRaf();
    expect(fakeScroller.scrollTop).toBe(1400);
    expect(scrollSnapshotPostCount()).toBe(2);
    const singlePost = (post as jest.Mock).mock.calls
      .filter((call: unknown[]) => call[0] === 'scrollSnapshot')
      .map((call: unknown[]) => call[1])[1];
    expect(singlePost).toEqual(chunkedPost);
    expect(singlePost).toEqual({
      schemaVersion: 2,
      offsetY: 0,
      nearBottom: true,
      scrollHeight: 2000,
      clientHeight: 600,
    });
  });

  it('旧协议载荷（无分片字段）直发 applySnapshot——等价单片行为', () => {
    const {snapshot, state} = loadFreshModules();

    snapshot.handleSnapshotPayload({
      sessionKey: 'p1:s1',
      hasMore: false,
      rows: makeRows('legacy', 3),
      scrollIntent: 'stick',
    });
    expect(state.rows.map(row => row.id)).toEqual([
      'legacy-0',
      'legacy-1',
      'legacy-2',
    ]);
    flushRaf();
    expect(renderRows).toHaveBeenCalledTimes(1);
  });
});
