/**
 * RowList 窗口化行为级测试（init-busy-yield Step 7，T-W1）。
 *
 * 覆盖：窗口外行不进 vnode / 占位高度正确 / 滚动扩缩窗（含滞回）/
 * 上端移动行坐标重映射保读位 / prependPage 锚定补偿（上占位清零 +
 * 下占位行数不变 → scrollHeight 差值恰为新行真实总高）/ append 窗口
 * 跟随贴尾 / applySnapshot stick 窗口贴尾 / measure 平均槽高收敛 /
 * onScroll 集成触发扩窗。
 *
 * 行为级直测（照 rows-click-anchor.test.ts / snapshot-chunk 先例）：
 * renderRows mock 为「真调 RowList() 并应用到 FakeLayout 布局模型」——
 * 布局按「窗口行实际高 ROW_PX、占位高按渲染时的平均槽高估算」计算，
 * 估算误差场景（fallback avg ≠ 实际行高）由此可行为级验证。
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
jest.mock('../src/web/chat-transcript/webview/ui/render/MessageRow', () => {
  const MsgRowStub = (_props: {row: {id: string}}) => null;
  (MsgRowStub as unknown as {__isMsgRowStub: boolean}).__isMsgRowStub = true;
  return {MessageRow: MsgRowStub};
});
jest.mock('../src/web/chat-transcript/webview/ui/stream/StreamTail', () => ({
  StreamTail: () => null,
}));

type VNodeLike = {
  type: unknown;
  key?: string;
  props: Record<string, unknown> & {style?: {height?: string}};
};

type TranscriptRowData = {kind: 'message'; id: string; role: string; text: string};

type Modules = {
  windowing: typeof import('../src/web/chat-transcript/webview/runtime/render/row-windowing');
  state: typeof import('../src/web/chat-transcript/webview/runtime/state/state')['state'];
  RowList: () => VNodeLike[];
  snapshot: typeof import('../src/web/chat-transcript/webview/runtime/render/snapshot');
  scroll: typeof import('../src/web/chat-transcript/webview/runtime/scroll/scroll');
  renderRows: ReturnType<typeof jest.fn>;
  /** isolate 内 bridge post（与 snapshot/scroll 实际引用同一 mock 实例）。 */
  post: ReturnType<typeof jest.fn>;
};

/** 布局常量：按钮高 / 底 padding / 窗口行「实际」渲染高（px）。 */
const BTN_PX = 48;
const PAD_PX = 20;
const ROW_PX = 80;
/** 首测前 fallback 平均槽高（与 row-windowing 常量一致）。 */
const FALLBACK_AVG = 120;
const CLIENT_H = 600;

/**
 * 最小布局模型：scrollHeight / 占位与窗口行位置由「当前渲染输出」推导；
 * scrollTop setter 带浏览器 clamp 语义。
 */
class FakeLayout {
  scrollTop = 0;
  hasMore = false;
  total = 0;
  winStart = 0;
  winEnd = 0;
  topSpPx = 0;
  bottomSpPx = 0;
  /** 最近一次渲染输出的行 id 序列（含首末，供断言）。 */
  lastRowIds: string[] = [];

  btnH(): number {
    return this.hasMore ? BTN_PX : 0;
  }

  winRows(): number {
    return Math.max(0, this.winEnd - this.winStart);
  }

  get scrollHeight(): number {
    return (
      this.btnH() +
      this.topSpPx +
      this.winRows() * ROW_PX +
      this.bottomSpPx +
      PAD_PX
    );
  }

  clampScroll(v: number): number {
    return Math.min(Math.max(0, v), Math.max(0, this.scrollHeight - CLIENT_H));
  }

  topSpEl(): {offsetTop: number; offsetHeight: number} {
    return {offsetTop: this.btnH(), offsetHeight: this.topSpPx};
  }

  bottomSpEl(): {offsetTop: number; offsetHeight: number} {
    return {
      offsetTop: this.btnH() + this.topSpPx + this.winRows() * ROW_PX,
      offsetHeight: this.bottomSpPx,
    };
  }

  rowEls(): Array<{offsetTop: number; offsetHeight: number}> {
    const els: Array<{offsetTop: number; offsetHeight: number}> = [];
    for (let i = 0; i < this.winRows(); i++) {
      els.push({
        offsetTop: this.btnH() + this.topSpPx + i * ROW_PX,
        offsetHeight: ROW_PX,
      });
    }
    return els;
  }

  getElementById(id: string): unknown {
    if (id === 'scroller') {
      const self = this;
      return {
        get scrollTop() {
          return self.scrollTop;
        },
        set scrollTop(v: number) {
          self.scrollTop = self.clampScroll(v);
        },
        get scrollHeight() {
          return self.scrollHeight;
        },
        get clientHeight() {
          return CLIENT_H;
        },
      };
    }
    if (id === 'rows') {
      const self = this;
      return {
        querySelectorAll: (selector: string) =>
          selector === '[data-id]' ? self.rowEls() : [],
      };
    }
    if (id === 'row-win-top') {
      return this.winStart > 0 ? this.topSpEl() : null;
    }
    if (id === 'row-win-bottom') {
      return this.winEnd < this.total ? this.bottomSpEl() : null;
    }
    return null;
  }

  /** 应用 RowList 渲染输出到布局（renderRows mock 的实现体）。 */
  applyChildren(children: VNodeLike[], rows: TranscriptRowData[], hasMore: boolean): void {
    let topPx = 0;
    let bottomPx = 0;
    const ids: string[] = [];
    for (const vnode of children) {
      if (!vnode || typeof vnode !== 'object') continue;
      if (vnode.key === 'row-win-top') {
        topPx = parseFloat(String(vnode.props.style?.height ?? '0'));
      } else if (vnode.key === 'row-win-bottom') {
        bottomPx = parseFloat(String(vnode.props.style?.height ?? '0'));
      } else if (
        vnode.type != null &&
        (vnode.type as {__isMsgRowStub?: boolean}).__isMsgRowStub === true
      ) {
        ids.push((vnode.props.row as {id: string}).id);
      }
    }
    this.hasMore = hasMore;
    this.total = rows.length;
    this.topSpPx = topPx;
    this.bottomSpPx = bottomPx;
    if (ids.length > 0) {
      this.winStart = Math.max(
        0,
        rows.findIndex(row => row.id === ids[0]),
      );
      this.winEnd =
        Math.max(
          0,
          rows.findIndex(row => row.id === ids[ids.length - 1]),
        ) + 1;
    } else {
      this.winStart = 0;
      this.winEnd = 0;
    }
    this.lastRowIds = ids;
    this.scrollTop = this.clampScroll(this.scrollTop);
  }
}

function makeRows(prefix: string, count: number): TranscriptRowData[] {
  const rows: TranscriptRowData[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      kind: 'message',
      id: `${prefix}-${i}`,
      role: 'user',
      text: `${prefix} ${i}`,
    });
  }
  return rows;
}

describe('RowList 窗口化（init-busy-yield Step 7, T-W1）', () => {
  let layout: FakeLayout;
  let mods: Modules;
  let rafQueue: Array<() => void>;

  beforeEach(() => {
    jest.clearAllMocks();
    layout = new FakeLayout();
    rafQueue = [];
    (global as unknown as {document?: unknown}).document = {
      getElementById: (id: string) => layout.getElementById(id),
    };
    (global as unknown as {requestAnimationFrame?: unknown})
      .requestAnimationFrame = (cb: () => void) => {
      rafQueue.push(cb);
      return rafQueue.length;
    };
    let loaded: Modules | null = null;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const windowing = require('../src/web/chat-transcript/webview/runtime/render/row-windowing');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const stateMod = require('../src/web/chat-transcript/webview/runtime/state/state');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const rowListMod = require('../src/web/chat-transcript/webview/ui/render/RowList');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const snapshot = require('../src/web/chat-transcript/webview/runtime/render/snapshot');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const scroll = require('../src/web/chat-transcript/webview/runtime/scroll/scroll');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const rowLogic = require('../src/web/chat-transcript/webview/runtime/render/row-logic');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const bridge = require('../src/web/chat-transcript/webview/runtime/bridge');
      loaded = {
        windowing,
        state: stateMod.state,
        RowList: rowListMod.RowList,
        snapshot,
        scroll,
        renderRows: rowLogic.renderRows,
        post: bridge.post,
      } as Modules;
    });
    mods = loaded!;
    // renderRows mock = 真调 RowList() 并应用到布局模型（模拟真实渲染）
    mods.renderRows.mockImplementation(() => {
      layout.applyChildren(mods.RowList(), mods.state.rows as TranscriptRowData[], mods.state.hasMore);
    });
  });

  afterEach(() => {
    delete (global as unknown as {document?: unknown}).document;
    delete (global as unknown as {requestAnimationFrame?: unknown})
      .requestAnimationFrame;
  });

  function flushRaf(): void {
    for (let round = 0; round < 6; round++) {
      const cbs = rafQueue.splice(0, rafQueue.length);
      if (cbs.length === 0) break;
      for (const cb of cbs) cb();
    }
  }

  function scrollSnapshotPostCount(): number {
    return mods.post.mock.calls.filter(
      (call: unknown[]) => call[0] === 'scrollSnapshot',
    ).length;
  }

  describe('vnode 窗口化（窗口外行不进 vnode / 占位高度 / 按钮与尾不回归）', () => {
    it('长列表贴尾：只渲染尾部窗口行，上占位高度 = 未渲染行数 × 平均槽高', () => {
      mods.state.rows = makeRows('r', 500) as never;
      mods.state.hasMore = true;
      mods.windowing.resetRowWindowForSnapshot(500, {kind: 'tail'});

      const children = mods.RowList();
      const msgs = children.filter(
        v => (v.type as {__isMsgRowStub?: boolean})?.__isMsgRowStub,
      );
      // 贴尾稳态窗口 [400, 500)（60 行 + 上下缓冲各 20）：窗口外 400 行不进 vnode
      expect(msgs).toHaveLength(100);
      expect(msgs[0]!.key).toBe('r-400');
      expect(msgs[msgs.length - 1]!.key).toBe('r-499');

      const topSp = children.find(v => v.key === 'row-win-top');
      expect(topSp).toBeTruthy();
      // fallback 平均槽高 120 × 400 行
      expect(topSp!.props.style!.height).toBe(`${400 * FALLBACK_AVG}px`);
      // 贴尾无下占位
      expect(children.find(v => v.key === 'row-win-bottom')).toBeFalsy();

      // 「加载更早」按钮与流式尾不回归
      const btn = children.find(v => v.key === 'load-older');
      expect(btn).toBeTruthy();
      expect(btn!.props['data-action']).toBe('load-older');
      expect(children.some(v => v.key === 'stream-tail')).toBe(true);
    });

    it('短列表（不足一个窗口）：全量渲染、无占位', () => {
      mods.state.rows = makeRows('r', 50) as never;
      mods.windowing.resetRowWindowForSnapshot(50, {kind: 'tail'});
      const children = mods.RowList();
      const msgs = children.filter(
        v => (v.type as {__isMsgRowStub?: boolean})?.__isMsgRowStub,
      );
      expect(msgs).toHaveLength(50);
      expect(children.find(v => v.key === 'row-win-top')).toBeFalsy();
      expect(children.find(v => v.key === 'row-win-bottom')).toBeFalsy();
    });

    it('空列表：空态保留、无行无占位', () => {
      mods.state.rows = [] as never;
      const children = mods.RowList();
      const msgs = children.filter(
        v => (v.type as {__isMsgRowStub?: boolean})?.__isMsgRowStub,
      );
      expect(msgs).toHaveLength(0);
      expect(children.find(v => v.key === 'empty-state')).toBeTruthy();
      expect(children.find(v => v.key === 'row-win-top')).toBeFalsy();
    });

    it('hasMore=false：无「加载更早」按钮', () => {
      mods.state.rows = makeRows('r', 500) as never;
      mods.state.hasMore = false;
      mods.windowing.resetRowWindowForSnapshot(500, {kind: 'tail'});
      const children = mods.RowList();
      expect(children.find(v => v.key === 'load-older')).toBeFalsy();
    });
  });

  describe('planRowWindowMove 纯逻辑（扩窗 / 缩窗 / 滞回）', () => {
    function plan(
      total: number,
      start: number,
      end: number,
      v: number,
    ) {
      return mods.windowing.planRowWindowMove(total, start, end, v);
    }

    it('视口逼近上边界：上扩到 desired', () => {
      expect(plan(500, 420, 500, 415)).toEqual({
        startDelta: -25,
        endDelta: 0,
      });
    });

    it('视口在窗口上方占位区：上扩 + 下缩（两端同时动）', () => {
      const move = plan(500, 420, 500, 100);
      expect(move!.startDelta).toBeLessThan(0);
      expect(move!.endDelta).toBeLessThan(0);
    });

    it('视口在窗口中部缓冲带内：no-op（滞回不抖动）', () => {
      expect(plan(500, 180, 300, 200)).toBeNull();
    });

    it('视口远离上边界超滞回带：上缩', () => {
      const move = plan(500, 100, 300, 200);
      expect(move!.startDelta).toBeGreaterThan(0);
    });

    it('视口逼近下边界：下扩', () => {
      expect(plan(500, 180, 270, 200)!.endDelta).toBeGreaterThan(0);
    });

    it('视口远离下边界超滞回带：下缩', () => {
      expect(plan(500, 180, 330, 200)!.endDelta).toBeLessThan(0);
    });

    it('total=0：no-op', () => {
      expect(plan(0, 0, 0, 0)).toBeNull();
    });
  });

  describe('handleRowWindowScroll 行为级（扩缩窗 + 行坐标重映射保读位）', () => {
    it('视口滚进上方占位区：上扩+下缩分步渲染，读位按行坐标保持不动', () => {
      mods.state.rows = makeRows('r', 500) as never;
      mods.windowing.resetRowWindowForSnapshot(500, {kind: 'tail'});
      mods.renderRows(); // 建立初始布局（贴尾窗口 (400,500)，topSp=48000）
      mods.renderRows.mock.calls.length = 0;
      // 视口滚到估算行 200（无按钮坐标系：windowTop=48000）
      layout.scrollTop = 400 * FALLBACK_AVG + (200 - 400) * FALLBACK_AVG; // = 24000

      const moved = mods.windowing.handleRowWindowScroll();
      expect(moved).toBe(true);
      // desired(200) = (180, 280)：上端一步（渲染+重映射）、下端一步（渲染）
      expect(mods.windowing.getRowWindowRange(500)).toEqual({
        start: 180,
        end: 280,
      });
      expect(mods.renderRows).toHaveBeenCalledTimes(2);
      // 行坐标重映射：渲染前后视口的全局行坐标一致 → scrollTop 原样
      expect(layout.scrollTop).toBe(24000);
      expect(layout.winStart).toBe(180);
      expect(layout.winEnd).toBe(280);
      expect(layout.lastRowIds[0]).toBe('r-180');
    });

    it('视口在窗口中部缓冲带内：no-op 不渲染', () => {
      mods.state.rows = makeRows('r', 500) as never;
      mods.windowing.retargetRowWindow(500, 440); // 窗口 (420, 500)
      mods.renderRows();
      layout.scrollTop =
        420 * FALLBACK_AVG + (440 - 420) * FALLBACK_AVG; // 估算行 440
      expect(mods.windowing.handleRowWindowScroll()).toBe(false);
      expect(mods.renderRows).toHaveBeenCalledTimes(1);
    });

    it('贴底守卫：视口高度变化的 scrollTop 钳制（打字换行/键盘弹收）不触发上端收缩', () => {
      mods.state.rows = makeRows('r', 500) as never;
      mods.windowing.resetRowWindowForSnapshot(500, {kind: 'tail'}); // 窗口 (400,500)=贴底
      mods.renderRows();
      mods.renderRows.mock.calls.length = 0;
      // webview 变矮 → scrollTop 被钳到底 → 估算行被推高到 445（超出
      // start+20 滞回带，正常会计划上缩）——贴底时必须跳过，否则顶部
      // 真实行换估算占位、scrollHeight 突变，视口内容跳一格（打字抖动）。
      layout.scrollTop = 400 * FALLBACK_AVG + 45 * FALLBACK_AVG;

      const moved = mods.windowing.handleRowWindowScroll();
      expect(moved).toBe(false);
      expect(mods.windowing.getRowWindowRange(500)).toEqual({
        start: 400,
        end: 500,
      });
      expect(mods.renderRows).toHaveBeenCalledTimes(0);
    });

    it('上端收缩（远离超滞回带）：重映射保读位不跳', () => {
      mods.state.rows = makeRows('r', 500) as never;
      mods.windowing.retargetRowWindow(500, 300); // 窗口 (280, 380)
      mods.renderRows();
      // 视口在窗口内深处（估算行 340 > start+40）：scrollTop = 280*120 + 60*120
      layout.scrollTop = 280 * FALLBACK_AVG + 60 * FALLBACK_AVG; // = 40800
      const moved = mods.windowing.handleRowWindowScroll();
      expect(moved).toBe(true);
      // 上缩生效（start 前移）
      const win = mods.windowing.getRowWindowRange(500);
      expect(win.start).toBeGreaterThan(280);
      // 读位按行坐标保持（±1px 数值容差）
      expect(layout.scrollTop).toBeCloseTo(40800, 0);
    });
  });

  describe('measureRowWindow 平均槽高收敛', () => {
    it('实测向真实槽高收敛（EWMA），窗口未变时跳过重测', () => {
      mods.state.rows = makeRows('r', 500) as never;
      mods.windowing.resetRowWindowForSnapshot(500, {kind: 'tail'});
      mods.renderRows();
      // 窗口 20 行真实占高 1600 → measured slot 80：120→110
      mods.windowing.measureRowWindow();
      expect(mods.windowing.getRowWindowAvgSlotPx()).toBe(110);
      // 窗口未变：重复 measure 跳过
      mods.windowing.measureRowWindow();
      expect(mods.windowing.getRowWindowAvgSlotPx()).toBe(110);
      // 换窗口再测：110→102.5（继续向 80 收敛）
      mods.windowing.retargetRowWindow(500, 440); // 窗口 (420, 500)
      mods.renderRows();
      mods.windowing.measureRowWindow();
      expect(mods.windowing.getRowWindowAvgSlotPx()).toBeCloseTo(102.5, 6);
    });

    it('prepend 差值样本并入 EWMA（占位估算校正）', () => {
      mods.state.rows = makeRows('r', 500) as never;
      mods.windowing.resetRowWindowForSnapshot(500, {kind: 'tail'});
      mods.renderRows();
      mods.windowing.measureRowWindow(); // avg=110
      mods.windowing.notePrependHeightDelta(3200, 40); // 新行均值 80
      expect(mods.windowing.getRowWindowAvgSlotPx()).toBeCloseTo(
        110 * 0.75 + 80 * 0.25,
        6,
      );
    });

    it('web/C-1: prepend 前窗口 start>0——上占位置换差被扣除，avgSlotPx 不被拉偏', () => {
      mods.state.rows = makeRows('r', 500) as never;
      // 视口在中部：窗口 (180, 280)，prepend 前上占位 180 行
      mods.windowing.retargetRowWindow(500, 200);
      mods.renderRows();
      mods.windowing.measureRowWindow(); // avg: 120 → 110（窗口行真实 80）
      expect(mods.windowing.getRowWindowAvgSlotPx()).toBe(110);

      mods.snapshot.applyPrependPage({rows: makeRows('p', 40) as never});

      // 差值 = 新进窗口行真实高 − 上占位估算高 = 220×80 − 180×110 = −2200；
      // 修复后采样 = (−2200 + 180×110) / (40+180) = 80（真实槽高），
      // EWMA 110 → 102.5。未修复时负差值直接跳过（avg 停留 110）或
      // 不扣分母的错实现会得 440（avg → 192.5），均被此断言拦下。
      expect(mods.windowing.getRowWindowAvgSlotPx()).toBeCloseTo(102.5, 6);
    });
  });

  describe('applyPrependPage 锚定（T-W1 核心：±1 平均行高容差）', () => {
    it('prepend 新页：新行全进窗口、读位补偿恰为真实增量（与平均槽高估算无关）', () => {
      mods.state.rows = makeRows('r', 500) as never;
      mods.state.hasMore = true;
      mods.windowing.retargetRowWindow(500, 0); // 视口在顶：窗口 (0, 100)
      mods.renderRows();
      // fallback avg=120 ≠ 实际 80：构造估算误差场景
      expect(mods.windowing.getRowWindowAvgSlotPx()).toBe(FALLBACK_AVG);
      const scrollHeightBefore = layout.scrollHeight; // 56068
      layout.scrollTop = 60; // 视口顶：行 0 顶(48)之下 12px

      mods.snapshot.applyPrependPage({rows: makeRows('p', 40) as never});

      // 上占位清零（新行全进窗口）、下占位行数不变 → 差值 = 40 行真实高
      expect(layout.scrollHeight - scrollHeightBefore).toBe(40 * ROW_PX);
      // 补偿后视口顶仍显示原内容（旧行 0 = 新行 40 顶 3248 + 12）
      expect(layout.scrollTop).toBe(60 + 40 * ROW_PX);
      const win = mods.windowing.getRowWindowRange(540);
      expect(win.start).toBe(0);
      // 新行进窗口 + 原视口缓冲带保留；超稳态部分已被收敛步收缩
      expect(win.end).toBeGreaterThanOrEqual(100);
      expect(layout.lastRowIds[0]).toBe('p-0');
      // 读位偏移在 ±1 平均行高容差内（此处恰为 0：差值=真实增量）
      const anchorTarget = 48 + 40 * ROW_PX + 12;
      expect(Math.abs(layout.scrollTop - anchorTarget)).toBeLessThanOrEqual(
        mods.windowing.getRowWindowAvgSlotPx(),
      );
      expect(scrollSnapshotPostCount()).toBe(1);
    });
  });

  describe('applyAppendTailRows 窗口跟随', () => {
    it('贴底时追加：窗口含新行、stick 贴底、scrollSnapshot 回发一次', () => {
      mods.state.rows = makeRows('r', 500) as never;
      mods.state.nearBottom = true;
      mods.windowing.retargetRowWindow(500, 495); // 窗口 (475, 500)
      mods.renderRows();
      layout.scrollTop = layout.clampScroll(layout.scrollHeight); // 贴底

      mods.snapshot.applyAppendTailRows({rows: makeRows('a', 2) as never});

      const win = mods.windowing.getRowWindowRange(502);
      expect(win.end).toBe(502);
      expect(layout.lastRowIds).toContain('a-0');
      expect(layout.lastRowIds).toContain('a-1');
      expect(layout.scrollTop).toBe(
        layout.clampScroll(layout.scrollHeight),
      );
      expect(scrollSnapshotPostCount()).toBe(1);
    });
  });

  describe('applySnapshot stick 集成', () => {
    it('stick：窗口贴尾、scrollTop 贴底、scrollSnapshot 恰一次', () => {
      mods.snapshot.handleSnapshotPayload({
        generation: 1,
        chunkIndex: 0,
        chunkTotal: 1,
        sessionKey: 'p1:s1',
        hasMore: true,
        rows: makeRows('r', 500) as never,
        scrollIntent: 'stick',
      });
      flushRaf();
      const win = mods.windowing.getRowWindowRange(500);
      expect(win.end).toBe(500);
      expect(win.start).toBeGreaterThanOrEqual(400);
      expect(layout.scrollTop).toBe(layout.clampScroll(layout.scrollHeight));
      expect(layout.lastRowIds[layout.lastRowIds.length - 1]).toBe('r-499');
      expect(scrollSnapshotPostCount()).toBe(1);
    });
  });

  describe('onScroll 集成（滚动近界扩窗）', () => {
    it('滚动进上方占位区触发扩窗；未到顶不触发 loadOlder', () => {
      // onScroll 内部排 100ms 防抖 timer（emitScrollSnapshot）：本地 fake
      // timers 冲净，避免 real timer 泄漏到用例外（document 已拆除）。
      jest.useFakeTimers();
      try {
        mods.state.rows = makeRows('r', 500) as never;
        mods.state.hasMore = true;
        mods.windowing.resetRowWindowForSnapshot(500, {kind: 'tail'});
        mods.renderRows();
        // hasMore=true → 按钮占 48px：windowTop = 48 + 400*120
        layout.scrollTop = 48 + 400 * FALLBACK_AVG - 200 * FALLBACK_AVG; // 估算行 200

        mods.scroll.onScroll();

        expect(mods.windowing.getRowWindowRange(500)).toEqual({
          start: 180,
          end: 280,
        });
        // scrollTop 远大于 SCROLL_TOP_LOAD_OLDER(24)：不回发 loadOlder
        expect(
          mods.post.mock.calls.some(call => call[0] === 'loadOlder'),
        ).toBe(false);
        jest.runAllTimers();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
