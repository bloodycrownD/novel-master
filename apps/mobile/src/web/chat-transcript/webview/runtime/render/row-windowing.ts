/**
 * RowList 窗口化核心（init-busy-yield Step 7）。
 *
 * 长会话全量 vnode 的渲染成本随行数线性膨胀，这里把 #rows 收敛为
 * 「上占位 div + 可见窗口行 + 下占位 div」：
 * - 稳态窗口 = 视口行起 ROW_WINDOW_ROWS 行，上方再留 ROW_WINDOW_BUFFER_ROWS 缓冲；
 * - 滚动近界扩窗、远界收缩（带滞回带防估算抖动来回拉扯）；
 * - 占位高度按「已渲染行实测平均槽高 × 未渲染行数」估算（槽高含行间 gap，
 *   首测前用 fallback 常量，实测后按 EWMA 向真实值收敛）；
 * - 上边界移动后的读位锚定复用 scrollHeight 差值补偿（与 applyPrependPage
 *   同款公式：视口上方内容变化多少，scrollTop 累加多少，估算误差自抵）。
 *
 * 约束遵守：es2018 目标（无 regex lookbehind）、无 requestIdleCallback；
 * 本模块在 runtime 层，可读 state（ui/ 侧经函数调用拿窗口，不直读内部状态）。
 */
import {state} from '../state/state';
import {renderRows} from './row-logic';

/** 稳态窗口行数（视口行起向下覆盖）。 */
export const ROW_WINDOW_ROWS = 60;
/** 视口上方缓冲行数（扩窗触发带）。 */
export const ROW_WINDOW_BUFFER_ROWS = 20;
/** 收缩滞回：窗口边界要落后稳态一带以上才收，防估算抖动来回拉扯。 */
const ROW_WINDOW_SHRINK_HYSTERESIS_ROWS = 20;
/** 首次实测前的槽高估算（px，含行间 gap；短消息气泡 + gap 的保守值）。 */
const ROW_WINDOW_FALLBACK_SLOT_PX = 120;
/** 平均槽高 EWMA 平滑系数（每次实测向真实值收敛的步长）。 */
const ROW_WINDOW_AVG_ALPHA = 0.25;

export const ROW_WINDOW_TOP_SPACER_ID = 'row-win-top';
export const ROW_WINDOW_BOTTOM_SPACER_ID = 'row-win-bottom';

export type RowWindowRange = {start: number; end: number};

/** 测量所需的最小盒子接口（fake DOM 测试只需提供这两个属性）。 */
type LayoutBox = {offsetTop: number; offsetHeight: number};

/** 当前窗口（模块级；测试经 isolateModules 取干净实例）。 */
let win: RowWindowRange = {start: 0, end: 0};
/** 实测平均槽高（px）。 */
let avgSlotPx = ROW_WINDOW_FALLBACK_SLOT_PX;
/** 上次实测过的窗口（相同窗口跳过重测，避免流式期高频 reflow）。 */
let lastMeasuredWin: RowWindowRange | null = null;

function clamp(v: number, lo: number, hi: number): number {
  if (!(v >= lo)) return lo;
  if (!(v <= hi)) return hi;
  return v;
}

/** RowList 渲染取窗口：对当前 rows 总数做防御性 clamp。 */
export function getRowWindowRange(total: number): RowWindowRange {
  const end = clamp(win.end, 0, Math.max(0, total));
  const start = clamp(win.start, 0, end);
  return {start, end};
}

/** RowList 渲染取上下占位高度（未渲染行数 × 实测平均槽高）。 */
export function getRowWindowSpacerHeights(total: number): {
  top: number;
  bottom: number;
} {
  const range = getRowWindowRange(total);
  return {
    top: Math.round(range.start * avgSlotPx),
    bottom: Math.round(Math.max(0, total - range.end) * avgSlotPx),
  };
}

/** 测试 / 调试窥视当前平均槽高估算。 */
export function getRowWindowAvgSlotPx(): number {
  return avgSlotPx;
}

/** 目标窗口（纯函数）：视口行 ± 缓冲，clamp 到 [0, total]。 */
export function desiredRowWindow(
  total: number,
  viewportFirstRow: number,
): RowWindowRange {
  const start = clamp(
    Math.floor(viewportFirstRow) - ROW_WINDOW_BUFFER_ROWS,
    0,
    // 短列表（总行数不足一个稳态窗口）始终全量渲染：不留上占位，
    // 也避免短会话中间出现占位空段。
    Math.max(0, total - (ROW_WINDOW_ROWS + 2 * ROW_WINDOW_BUFFER_ROWS)),
  );
  const end = clamp(
    Math.ceil(viewportFirstRow) + ROW_WINDOW_ROWS + ROW_WINDOW_BUFFER_ROWS,
    0,
    total,
  );
  return {start, end};
}

/**
 * 窗口移动计划（纯函数）：对两端分别判扩 / 缩（缩带滞回），
 * 无移动返回 null。一次计划允许两端同时动——上端动由调用方做
 * scrollHeight 差值补偿，下端动不影响视口上方内容（文档流性质）无需补偿。
 */
export function planRowWindowMove(
  total: number,
  start: number,
  end: number,
  viewportFirstRow: number,
): {startDelta: number; endDelta: number} | null {
  if (total <= 0) return null;
  const desired = desiredRowWindow(total, viewportFirstRow);
  let startDelta = 0;
  let endDelta = 0;
  if (desired.start < start) {
    startDelta = desired.start - start;
  } else if (desired.start > start + ROW_WINDOW_SHRINK_HYSTERESIS_ROWS) {
    startDelta = desired.start - start;
  }
  if (desired.end > end) {
    endDelta = desired.end - end;
  } else if (desired.end < end - ROW_WINDOW_SHRINK_HYSTERESIS_ROWS) {
    endDelta = desired.end - end;
  }
  if (startDelta === 0 && endDelta === 0) return null;
  return {startDelta, endDelta};
}

/** 窗口首行的文档纵坐标（上占位底缘；无占位时取首个消息行顶缘）。 */
function windowTopPxInDocument(): number | null {
  const topSpacer = document.getElementById(ROW_WINDOW_TOP_SPACER_ID);
  if (topSpacer) return topSpacer.offsetTop + topSpacer.offsetHeight;
  const first = firstOrLastRowEl(false);
  if (first) return first.offsetTop;
  return null;
}

/**
 * 估算视口顶对应的全局行号（可为小数）：以窗口首行文档位置为锚，
 * scrollTop 偏移量按平均槽高折算行数。无 scroller / 无锚点返回 null。
 * totalHint 只用于 clamp（prepend 平移场景传旧坐标系总数）。
 */
function estimateViewportFirstRow(totalHint: number): number | null {
  const scroller = document.getElementById('scroller');
  if (!scroller) return null;
  const top = windowTopPxInDocument();
  if (top == null) return null;
  const v = win.start + (scroller.scrollTop - top) / avgSlotPx;
  if (!isFinite(v)) return null;
  return clamp(v, 0, Math.max(0, totalHint - 1));
}

/** 直接把窗口设为目标（不渲染、不补偿——渲染与读位锚定由调用方统一处理）。 */
export function retargetRowWindow(total: number, viewportFirstRow: number): void {
  win = desiredRowWindow(total, viewportFirstRow);
  // 窗口内容大换血：下次 render 后必须重测平均槽高。
  lastMeasuredWin = null;
}

/** applySnapshot 的窗口预定位口径。 */
export type RowWindowPositioning =
  | {kind: 'tail'}
  | {
      kind: 'fromBottom';
      offsetFromBottom: number;
      clientHeight: number;
    };

/**
 * applySnapshot 全量替换 rows 后的窗口重置：
 * stick 贴尾；restore / preserve 按距底偏移从底反推视口行。
 * 无 scroller（clientHeight 未知）时退化为贴尾。
 */
export function resetRowWindowForSnapshot(
  total: number,
  positioning: RowWindowPositioning,
): void {
  if (positioning.kind === 'tail' || positioning.clientHeight <= 0) {
    retargetRowWindow(total, total);
    return;
  }
  const v =
    total -
    (Math.max(0, positioning.offsetFromBottom) + positioning.clientHeight) /
      avgSlotPx;
  retargetRowWindow(total, v);
}

/** append / streamCommit 追加尾部行后的窗口重定位（渲染前调用）。 */
export function retargetRowWindowFromBottom(
  offsetFromBottom: number,
  clientHeight: number,
): void {
  resetRowWindowForSnapshot(state.rows.length, {
    kind: 'fromBottom',
    offsetFromBottom,
    clientHeight,
  });
}

/**
 * prependPage 头部插入行后的窗口重定位（渲染前调用）：
 * 上占位清零（新行全部进窗口）、下占位行数保持不变——这样渲染后的
 * scrollHeight 差值恰为窗口内新行的真实总高（上下占位零变化），
 * 既有差值补偿精确成立。窗口超稳态的部分由补偿后的
 * handleRowWindowScroll 收敛（下端收缩不动 scrollTop）。
 */
export function retargetRowWindowForPrepend(prependedRows: number): void {
  const total = state.rows.length;
  const oldTotal = Math.max(0, total - prependedRows);
  const bottomRows = Math.max(0, oldTotal - win.end);
  win = {start: 0, end: clamp(total - bottomRows, 0, total)};
  lastMeasuredWin = null;
}

/**
 * 应用窗口移动：两端分步——先上端后下端。
 *
 * 上端移动的读位锚定用「行坐标线性重映射」：渲染前把视口顶折算成
 * 全局行坐标（窗口外按平均槽高线性折算），渲染后按新窗口锚反算回
 * scrollTop。为什么不用 scrollHeight 差值补偿：扩窗会把视口下方的
 * 占位估算行换成真实行，差值里混入视口下方的高度差，污染补偿量；
 * 行坐标重映射的折算/反算共用同一平均槽高，估算误差一阶抵消，
 * 残余误差仅在窗口内行高分布不均（±1 平均行高容差内）。
 * 下端移动不影响视口上方内容（文档流性质），scrollTop 原地不动。
 */
function applyRowWindowMove(
  move: {startDelta: number; endDelta: number},
  total: number,
): void {
  if (move.startDelta !== 0) {
    const scroller = document.getElementById('scroller');
    const topBefore = windowTopPxInDocument();
    const rowBefore =
      scroller && topBefore != null
        ? win.start + (scroller.scrollTop - topBefore) / avgSlotPx
        : null;
    const nextStart = clamp(win.start + move.startDelta, 0, win.end);
    win = {start: nextStart, end: win.end};
    renderRows();
    if (scroller && rowBefore != null && isFinite(rowBefore)) {
      const topAfter = windowTopPxInDocument();
      if (topAfter != null) {
        scroller.scrollTop = topAfter + (rowBefore - win.start) * avgSlotPx;
      }
    }
  }
  if (move.endDelta !== 0) {
    const nextEnd = clamp(win.end + move.endDelta, win.start, total);
    if (nextEnd !== win.end) {
      win = {start: win.start, end: nextEnd};
      renderRows();
    }
  }
}

/**
 * 滚动驱动的窗口维护（onScroll / 快照读位设定后调用，幂等）：
 * 估算视口行 → 计划移动 → 应用（含渲染与读位补偿）。
 * 返回是否发生窗口移动。
 */
export function handleRowWindowScroll(): boolean {
  const total = state.rows.length;
  const v = estimateViewportFirstRow(total);
  if (v == null) return false;
  const move = planRowWindowMove(total, win.start, win.end, v);
  if (!move) return false;
  applyRowWindowMove(move, total);
  return true;
}

/**
 * renderRows 后的实测钩子（main 装配点回调）：
 * 以上 / 下占位边界量出窗口行实际占高（含行间 gap），EWMA 更新平均槽高。
 * 窗口未变时跳过——流式期间高频 renderRows 不产生额外 reflow。
 */
export function measureRowWindow(): void {
  const count = win.end - win.start;
  if (count <= 0) return;
  if (
    lastMeasuredWin != null &&
    lastMeasuredWin.start === win.start &&
    lastMeasuredWin.end === win.end
  ) {
    return;
  }
  const topSpacer = document.getElementById(ROW_WINDOW_TOP_SPACER_ID);
  const bottomSpacer = document.getElementById(ROW_WINDOW_BOTTOM_SPACER_ID);
  let topPx: number | null = null;
  let bottomPx: number | null = null;
  if (topSpacer) {
    topPx = topSpacer.offsetTop + topSpacer.offsetHeight;
  } else {
    const first = firstOrLastRowEl(true);
    if (first) topPx = first.offsetTop;
  }
  if (bottomSpacer) {
    bottomPx = bottomSpacer.offsetTop;
  } else {
    const lastRow = firstOrLastRowEl(true);
    if (lastRow) bottomPx = lastRow.offsetTop + lastRow.offsetHeight;
  }
  if (topPx == null || bottomPx == null) return;
  const measuredPx = bottomPx - topPx;
  if (!(measuredPx > 0)) return;
  const measuredSlot = measuredPx / count;
  avgSlotPx = avgSlotPx * (1 - ROW_WINDOW_AVG_ALPHA) + measuredSlot * ROW_WINDOW_AVG_ALPHA;
  lastMeasuredWin = {start: win.start, end: win.end};
}

function firstOrLastRowEl(last: boolean): LayoutBox | null {
  const rows = document.getElementById('rows');
  if (!rows || typeof rows.querySelectorAll !== 'function') return null;
  const list = rows.querySelectorAll('[data-id]');
  if (!list || list.length === 0) return null;
  const el = list[last ? list.length - 1 : 0];
  return el as unknown as LayoutBox;
}

/**
 * 当前上下占位的像素总高（无占位元素按 0 计）：prepend 差值采样时
 * 扣除占位漂移用（DOM 真值，不受 avg 实测更新与渲染先后差影响）。
 */
export function getRowWindowSpacerPxTotal(): number {
  let total = 0;
  const topSpacer = document.getElementById(ROW_WINDOW_TOP_SPACER_ID);
  if (topSpacer) total += topSpacer.offsetHeight;
  const bottomSpacer = document.getElementById(ROW_WINDOW_BOTTOM_SPACER_ID);
  if (bottomSpacer) total += bottomSpacer.offsetHeight;
  return total;
}

/**
 * prepend 后的占位估算校正（任务点：按 scrollHeight 差值校正一次）：
 * 差值折算到新行的平均高度，并入 EWMA 样本——新行未全进窗口时
 * （差值里混有占位估算），measure 覆盖不到的部分由此兜底收敛。
 *
 * 前提修正（web/C-1）：retargetRowWindowForPrepend 会把上占位清零并让
 * 原上占位区行换进窗口（估算高→真实高），「差值恰为新行真实总高」仅在
 * prepend 前窗口 start=0（上占位本就为零）时成立。start>0 时差值混入
 * 占位置换差；上下占位高度还可能因 avg 实测更新在前后两次渲染间漂移。
 * topSpacerBefore 由调用方在 retarget 前捕获（窗口 start + 占位 DOM 真值）：
 * 采样时扣除占位漂移、分母并入被置换行数，样本恢复为「窗口新增行的
 * 真实平均高」。缺省时保持旧行为（不扣除、分母仅新行数）。
 */
export function notePrependHeightDelta(
  heightDeltaPx: number,
  prependedRows: number,
  topSpacerBefore?: {rows: number; spacerPx: number},
): void {
  const displacedRows = topSpacerBefore?.rows ?? 0;
  const spacerPxBefore =
    topSpacerBefore?.spacerPx ?? getRowWindowSpacerPxTotal();
  const sampledRows = prependedRows + displacedRows;
  if (prependedRows <= 0 || sampledRows <= 0) {
    return;
  }
  const per =
    (heightDeltaPx - (getRowWindowSpacerPxTotal() - spacerPxBefore)) /
    sampledRows;
  if (!(per > 0)) return;
  avgSlotPx =
    avgSlotPx * (1 - ROW_WINDOW_AVG_ALPHA) + per * ROW_WINDOW_AVG_ALPHA;
}
