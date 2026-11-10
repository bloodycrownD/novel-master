import {state} from '../state/state';
import type {StreamCheckpoint, TranscriptRow} from '../state/state';
import {
  offsetFromBottom,
  isNearBottom,
  stickToBottom,
  emitScrollSnapshot,
} from '../scroll/scroll';
import {closeContextMenu} from '../menu/menu';
import {scrollTopForOffsetFromBottom} from '../../../../../webview-host/chat-transcript/scroll';
import {renderRows} from './row-logic';
import {
  getRowWindowRange,
  getRowWindowSpacerPxTotal,
  handleRowWindowScroll,
  notePrependHeightDelta,
  resetRowWindowForSnapshot,
  retargetRowWindowForPrepend,
  type RowWindowPositioning,
} from './row-windowing';
import {requestResync, resetStreamBlockRenderState} from '../stream/stream';
import {clearStreamRichUpgrade} from '../stream/stream-markdown';
import {mergeCheckpoint} from '../stream/stream-checkpoint';
import {reconcileFinishedStreamingRows} from './finished-stream-row-dom';
import {reseedStreamingRow} from './finished-stream-row-dom';
import {scheduleMermaidScan} from '../mermaid';

export {reconcileFinishedStreamingRows} from './finished-stream-row-dom';

/** 距底偏移 → scrollTop（scrollHeight/clientHeight 三参入口的收口）。 */
function scrollTopFrom(scroller: Element, offset: number): number {
  const {scrollHeight, clientHeight} = scroller;
  return scrollTopForOffsetFromBottom(scrollHeight, clientHeight, offset);
}

export type RestoreScroll = {
  nearBottom?: boolean;
  offsetY: number;
};

export type SnapshotPayload = {
  scrollIntent?: string;
  sessionKey?: string;
  rows?: TranscriptRow[];
  hasMore?: boolean;
  restoreScroll?: RestoreScroll;
  /** 流式检查点：任一 occurrence 均可携带，最后到达者为准；末片必须与流式行同片。 */
  stream?: StreamCheckpoint;
  /** 分片协议（init-busy-yield Step 6）：单片/旧载荷缺省视为 chunkTotal=1。 */
  generation?: number;
  chunkIndex?: number;
  chunkTotal?: number;
};

export type RowsPayload = {
  rows?: TranscriptRow[];
  scrollIntent?: string;
};

/**
 * 分片拼装状态（init-busy-yield Step 6，Step 7 前的最小适配）：
 * 同代次按 chunkIndex 顺序累计 rows 与流式检查点（每片 last-wins），末片到齐
 * 才整体 applySnapshot——分片期间不产生中间渲染，也不触发任何滚动副作用（T-S4 前半）。
 */
type SnapshotChunkAccumulator = {
  generation: number;
  /** 期望的下一个 chunkIndex（同时是已收片数）。 */
  received: number;
  rows: TranscriptRow[];
  sessionKey?: string;
  hasMore?: boolean;
  stream?: StreamCheckpoint;
};

/** 已完整应用的最新代次（RN 侧模块级计数器从 1 起单调递增）。 */
let appliedSnapshotGeneration = 0;
let pendingChunkAcc: SnapshotChunkAccumulator | null = null;

/**
 * 分片收集在途时挂起的两通道动作（C-orch-1 web 侧防御）：appendTailRows /
 * prependPage 若在末片之前到达（协议异常时序），先按到达序挂起，末片
 * applySnapshot 后原序重放——末片整体替换基线会抹掉已 concat 的增量行，
 * 重放恢复之。收集器被顶替/作废时挂起队列一并丢弃（新代次基线为准）。
 */
type PendingChunkAction =
  | {kind: 'appendTail'; rows: TranscriptRow[]}
  | {kind: 'prependPage'; rows: TranscriptRow[]};
let pendingChunkActions: PendingChunkAction[] = [];

/** 连续异常快照退避参数（spec §3.4.1）：1s / 5s，连续 3 次停止自动 resync。 */
const SNAPSHOT_RESYNC_ANOMALY_LIMIT = 3;
const BACKOFF_MS = 1000;
const BACKOFF_LONG_MS = 5000;

/**
 * 作废在途快照分片管线（streamReset 专用，C18）：宿主 bump generation 后，
 * 旧代次余片（含末片）不得再整体替换 rows。由 bridge 的 streamReset 分支
 * 在 applyStreamReset 之前调用——stream.ts 不 import 本文件（避免循环依赖）。
 *
 * nm-style: keep-public — bridge.ts 的 streamReset 分支先作废在途分片再
 * applyStreamReset（spec C18/P2-8）；跨模块唯一入口。
 */
export function invalidateSnapshotPipeline(generation: number): void {
  pendingChunkAcc = null;
  pendingChunkActions = [];
  appliedSnapshotGeneration = Math.max(appliedSnapshotGeneration, generation);
}

function numberOf(value: unknown): number {
  return typeof value === 'number' && value >= 0 ? value : -1;
}

/**
 * sessionSnapshot 统一入口：单片（chunkTotal 缺省或 =1）直发 applySnapshot
 * 等价旧协议；多片则按代次拼装——未知/迟到代次与乱序分片一律丢弃
 * （凑不齐的代次由 RN 侧 force 新代次重传兜底）。
 * 每个片（含末片）先做代次判旧：旧代次末片不会整体替换 rows。
 */
export function handleSnapshotPayload(payload: SnapshotPayload): void {
  const rawChunkTotal = numberOf(payload.chunkTotal);
  const chunkTotal = rawChunkTotal >= 1 ? rawChunkTotal : 1;
  const generation = numberOf(payload.generation);
  if (generation > 0 && generation < appliedSnapshotGeneration) {
    // 旧代次的任何片（含末片）：丢弃，不回退已应用基线。
    return;
  }
  if (chunkTotal <= 1) {
    if (generation > 0) {
      // 已应用代次的迟到单片（乱序/重复投递）与分片同口径判旧丢弃；
      // generation 缺省=旧协议载荷，不判代次直发。
      if (generation <= appliedSnapshotGeneration) {
        return;
      }
      appliedSnapshotGeneration = generation;
      // web/B-1：单片应用新代次时同步作废在途旧代次收集器——否则其末片
      // 随后到达仍会拼装并 applySnapshot，造成已应用代次回退（当前 RN 实现
      // 不可达，协议鲁棒性缺口）。挂起的增量动作一并作废（新基线为准）。
      if (pendingChunkAcc != null && generation >= pendingChunkAcc.generation) {
        pendingChunkAcc = null;
        pendingChunkActions = [];
      }
    }
    applySnapshot(payload);
    return;
  }
  if (generation <= 0) {
    // 分片载荷缺代次：非法，丢弃。
    return;
  }
  const chunkIndex = numberOf(payload.chunkIndex);
  if (chunkIndex < 0 || chunkIndex >= chunkTotal) {
    return;
  }
  let acc = pendingChunkAcc;
  // 迟到的旧代次分片：丢弃（被更新代次顶替后的余片）。
  if (acc != null && generation < acc.generation) {
    return;
  }
  // 无收集时不新于已应用代次=未知代次迟到片：丢弃（中间片无法启动收集）。
  if (acc == null && generation <= appliedSnapshotGeneration) {
    return;
  }
  // 新代次首片：重置收集（顶替在途旧代次，旧余片随后被上面的判旧丢弃）；
  // 旧收集器挂起的增量动作随之作废（新代次基线为准）。
  if (acc == null || generation > acc.generation) {
    if (chunkIndex !== 0) {
      return;
    }
    acc = {
      generation: generation,
      received: 0,
      rows: [],
      sessionKey: payload.sessionKey,
      hasMore: payload.hasMore,
      stream: payload.stream,
    };
    pendingChunkAcc = acc;
    pendingChunkActions = [];
  }
  // 乱序/重复分片：丢弃（缺口无法自愈，由 force 新代次整体重发兜底）。
  if (chunkIndex !== acc.received) {
    return;
  }
  const rows = payload.rows || [];
  for (let i = 0; i < rows.length; i++) {
    acc.rows.push(rows[i]);
  }
  // 快照级标量每片重复携带，取最新到达为准（stream 每片 last-wins）。
  acc.sessionKey = payload.sessionKey;
  acc.hasMore = payload.hasMore;
  if (payload.stream != null) {
    acc.stream = payload.stream;
  }
  acc.received = chunkIndex + 1;
  if (chunkIndex === chunkTotal - 1) {
    // 末片到齐：滚动字段仅在末片携带，拼齐后整体应用（一次 renderRows、
    // 一次滚动副作用）。
    const assembled: SnapshotPayload = {
      sessionKey: acc.sessionKey,
      rows: acc.rows,
      hasMore: !!acc.hasMore,
      stream: acc.stream,
      scrollIntent: payload.scrollIntent || 'stick',
      restoreScroll: payload.restoreScroll,
    };
    appliedSnapshotGeneration = generation;
    pendingChunkAcc = null;
    applySnapshot(assembled);
    // 末片应用后按原序重放分片期间挂起的增量动作（C-orch-1 web 侧）：
    // applySnapshot 用分片启动时的旧闭包整体替换 rows，挂起的增量行由此恢复。
    const actions = pendingChunkActions;
    pendingChunkActions = [];
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      if (action.kind === 'appendTail') {
        applyAppendTailRowsNow(action.rows);
      } else {
        applyPrependPageNow(action.rows);
      }
    }
  }
}

type Rows = readonly TranscriptRow[];

function findRowByIdIn(rows: Rows, id: string): TranscriptRow | null {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].id === id) {
      return rows[i];
    }
  }
  return null;
}

type MergeInput = {
  rows0: Rows;
  cp0: StreamCheckpoint | null;
  rows1: Rows;
  cp1: StreamCheckpoint | null;
};

type MergeResult = {
  rows: TranscriptRow[];
  checkpoint: StreamCheckpoint | null;
};

/**
 * 快照行组装（纯函数）：rows 永远是完整基线；同 id 且本地 seq 更大时走
 * rewind 保护（保留本地行与本地 seq，绝不把已显示正文回退）。
 *
 * nm-style: keep-local — spec §3.4.1 明示的纯函数（rows + checkpoint 组装 /
 * rewind 分支独立成段）；内联会把「原子提交」与「旧代次保护」搅在一起，
 * 且该函数是 rewind 不变量（I3/I4）的唯一收口点。
 */
function mergeRows(input: MergeInput): MergeResult {
  const {rows0: localRows, cp0: localCp} = input;
  const {rows1: incomingRows, cp1: incomingCp} = input;
  if (incomingCp == null) {
    return {rows: incomingRows.slice(), checkpoint: null};
  }
  // rewind 必须拿 incoming 的原始 seq 比较，不能先 merge（merge 同 id 取 max
  // 会让 rewind 永假）。
  if (
    localCp != null &&
    localCp.id === incomingCp.id &&
    localCp.seq > incomingCp.seq
  ) {
    const hitLocal = findRowByIdIn(localRows, localCp.id);
    const localRow = hitLocal ?? findRowByIdIn(incomingRows, localCp.id);
    if (localRow == null) {
      return {rows: incomingRows.slice(), checkpoint: incomingCp};
    }
    const rows = incomingRows.filter(r => r.id !== localCp.id);
    rows.push(localRow);
    const localDone = localCp.status === 'finished';
    const incomingDone = incomingCp.status === 'finished';
    const status = localDone || incomingDone ? 'finished' : 'streaming';
    return {rows, checkpoint: {...localCp, status}};
  }
  const hit = findRowByIdIn(localRows, incomingCp.id) != null;
  const nextCp = hit ? mergeCheckpoint(localCp, incomingCp) : incomingCp;
  return {rows: incomingRows.slice(), checkpoint: nextCp};
}

/**
 * 会话快照编排：rows 与 checkpoint 在同一同步块原子替换（中间无渲染），
 * RAF 内一次 renderRows + 一次滚动副作用；流式行 seed/gap 恢复在此重播 body。
 */
export function applySnapshot(payload: SnapshotPayload): void {
  const intent = payload.scrollIntent || 'stick';
  const scroller = document.getElementById('scroller');
  const wasNearBottom = state.nearBottom;
  const prevOffsetFromBottom = scroller ? offsetFromBottom(scroller) : 0;
  const nextKey = payload.sessionKey;
  const sessionChanged = !!nextKey && nextKey !== state.sessionKey;
  const prevCheckpointId = state.streamCheckpoint?.id;
  const localCheckpoint = state.streamCheckpoint;

  // 1) 组装 nextRows + nextCheckpoint（纯函数，便于单测）
  const rows0 = state.rows;
  const rows1 = payload.rows || [];
  const cp0 = localCheckpoint;
  const cp1 = payload.stream ?? null;
  const merged = mergeRows({rows0, cp0, rows1, cp1});
  let nextCheckpoint = merged.checkpoint;
  const sameCpId = localCheckpoint?.id === nextCheckpoint?.id;
  const localAppliedSeq = sameCpId ? localCheckpoint?.seq ?? -1 : -1;

  // 不变量：checkpoint 指向的行必须存在；否则视为协议异常（清 checkpoint +
  // 异步请求普通快照；不能在同步块里 requestResync，否则会形成快照循环）。
  let anomalyStreamId: string | null = null;
  if (
    nextCheckpoint != null &&
    findRowByIdIn(merged.rows, nextCheckpoint.id) == null
  ) {
    anomalyStreamId = nextCheckpoint.id;
    nextCheckpoint = null;
  } else {
    state.snapshotResyncAnomalyCount = 0;
    state.snapshotResyncBackoffUntil = null;
  }

  // 2) 原子提交：同一同步块内完成，中间不渲染
  state.sessionKey = payload.sessionKey || state.sessionKey;
  state.rows = merged.rows;
  state.streamCheckpoint = nextCheckpoint;
  state.resyncPending = null;
  state.hasMore = !!payload.hasMore;
  state.loadOlderArmed = true;

  // 3) 流式块状态换主：id 变化 → 复位；同 id 但快照带来了更新内容 →
  //    进入 fullReplaceOnly（后续 delta 用全量 textHtml，忽略 tailHtml/块提交）
  const idChanged = prevCheckpointId !== nextCheckpoint?.id;
  const cpId = nextCheckpoint?.id;
  let streamingRow: TranscriptRow | null = null;
  if (cpId != null) streamingRow = findRowByIdIn(merged.rows, cpId);
  const streamingNow = nextCheckpoint?.status === 'streaming';
  const richOn = state.flags.richText;
  const hasRichHtml = !!streamingRow?.textHtml;
  const notSeededYet = state.lastStreamHtmlStreamId !== cpId;
  const richJustEnabled = streamingNow && richOn && hasRichHtml && notSeededYet;
  const cpSeq = nextCheckpoint?.seq ?? -1;
  const seqAdvanced = idChanged ? cpSeq > 0 : cpSeq > localAppliedSeq;
  const hasTextSeed = !!streamingRow?.text;
  const hasThinkingSeed = !!streamingRow?.thinking;
  const hasToolsSeed = (streamingRow?.tools?.length ?? 0) > 0;
  const hasSeedContent = hasTextSeed || hasThinkingSeed || hasToolsSeed;
  const contentSeed = idChanged && hasSeedContent;
  const seedNeeded = richJustEnabled || contentSeed || seqAdvanced;
  const needsReseed = streamingNow && streamingRow != null && seedNeeded;
  if (idChanged) {
    clearStreamRichUpgrade();
    resetStreamBlockRenderState();
    state.fullReplaceOnly = null;
    state.appliedBlockKeys = new Set();
  }
  if (needsReseed) {
    state.fullReplaceOnly = nextCheckpoint!.id;
    resetStreamBlockRenderState();
    clearStreamRichUpgrade();
  }

  // 窗口预定位（Step 7）：stick / restore / preserve 统一按距底偏移从底
  // 反推（stick 即 offset=0 的贴底口径，与读位设定后的重估口径一致，
  // 避免 stick 后无谓的二次扩窗渲染）。
  let positioning: RowWindowPositioning = {kind: 'tail'};
  if (intent === 'restore' && payload.restoreScroll) {
    positioning = {
      kind: 'fromBottom',
      offsetFromBottom: payload.restoreScroll.offsetY,
      clientHeight: scroller ? scroller.clientHeight : 0,
    };
  } else if (intent === 'preserve') {
    positioning = {
      kind: 'fromBottom',
      offsetFromBottom: prevOffsetFromBottom,
      clientHeight: scroller ? scroller.clientHeight : 0,
    };
  } else if (scroller) {
    positioning = {
      kind: 'fromBottom',
      offsetFromBottom: 0,
      clientHeight: scroller.clientHeight,
    };
  }
  resetRowWindowForSnapshot(state.rows.length, positioning);
  if (sessionChanged) closeContextMenu(false);
  const scrollAfterRender = function () {
    if (!scroller) return;
    if (intent === 'stick') {
      stickToBottom(scroller);
    } else if (intent === 'restore' && payload.restoreScroll) {
      const rs = payload.restoreScroll;
      if (rs.nearBottom) {
        stickToBottom(scroller);
      } else {
        scroller.scrollTop = scrollTopFrom(scroller, rs.offsetY);
      }
    } else if (intent === 'preserve') {
      if (wasNearBottom) {
        stickToBottom(scroller);
      } else {
        // WHY: flex-end layout shrinks tail — restore distance-from-bottom, not raw scrollTop.
        scroller.scrollTop = scrollTopFrom(scroller, prevOffsetFromBottom);
      }
    }
    // 读位精确设定后再做一次窗口校正（幂等）：restore / preserve 的预定位
    // 基于平均槽高估算，读位若落在窗口外由此收敛（上端移动自带差值补偿，
    // 不破坏刚设置的读位）。
    handleRowWindowScroll();
    state.nearBottom = isNearBottom(scroller);
    emitScrollSnapshot();
  };
  requestAnimationFrame(function () {
    renderRows();
    // 历史行渲染后触发 mermaid 扫描（防抖；流式行不扫）
    scheduleMermaidScan();
    // 4) streaming 行 reseed（gap/remount/快照 seed）；finished 行仅签名变化时校正
    if (needsReseed && streamingRow != null) {
      reseedStreamingRow(streamingRow);
      state.lastStreamHtmlStreamId = nextCheckpoint!.id;
    }
    reconcileFinishedStreamingRows();
    if (intent === 'stick') {
      // 窗口化后不再先回顶（top 占位巨大时会闪一帧空白）：渲染后立即贴底，
      // 二层 RAF 的 scrollAfterRender 保持原时序幂等收尾（stick + emit）。
      if (scroller) {
        stickToBottom(scroller);
      }
      requestAnimationFrame(function () {
        scrollAfterRender();
      });
    } else {
      scrollAfterRender();
    }
  });

  // 异常快照退避（spec §3.4.1）：queueMicrotask 触发 + 1s/5s 退避，连续 3 次
  // 停止自动 resync；计数与退避截止写在 state 上便于观测/测试。
  if (anomalyStreamId != null) {
    scheduleSnapshotAnomalyResync(anomalyStreamId);
  }
}

/**
 * 异常快照自动 resync（spec §3.4.1 / C18）：本同步块刚清 `resyncPending`，
 * 直接 `requestResync` 会形成「快照→resync→快照」循环，改为队列微任务触发；
 * 连续异常按 1s/5s 退避（`snapshotResyncBackoffUntil` 既是退避截止也是去重
 * 窗口：窗口内已有待重试时不叠加 timer），连续 3 次停止自动 resync 并留日志。
 * 正常快照不变量通过时由 `applySnapshot` 清零计数与退避截止（待重试自然作废）。
 *
 * nm-style: keep-local — 共享 state.snapshotResyncAnomalyCount/BackoffUntil 的
 * 退避状态机；timer 闭包捕获 deadline 作废语义，内联会把三处状态读写拆散。
 */
function scheduleSnapshotAnomalyResync(streamId: string): void {
  state.snapshotResyncAnomalyCount += 1;
  const count = state.snapshotResyncAnomalyCount;
  if (count >= SNAPSHOT_RESYNC_ANOMALY_LIMIT) {
    if (count === SNAPSHOT_RESYNC_ANOMALY_LIMIT) {
      // console 保留：web runtime 无 logger 依赖；与 main.ts / ToolGroup.tsx 同类
      // （spec §7.3 保留清单）。
      const stopMessage = '[chat-transcript] snapshot anomaly resync stopped';
      console.error(stopMessage + ' after ' + count + ' (' + streamId + ')');
    }
    return;
  }
  const now = performance.now();
  const pendingUntil = state.snapshotResyncBackoffUntil;
  if (pendingUntil != null && now < pendingUntil) {
    // 退避窗口内已有待重试：异常快照连发时不重复排队。
    return;
  }
  const delayMs = count >= 2 ? BACKOFF_LONG_MS : BACKOFF_MS;
  const deadline = now + delayMs;
  state.snapshotResyncBackoffUntil = deadline;
  // microtask 调度：目标 WebView 是 minSdk 26 / Chromium 58，原生 queueMicrotask
  // 是 Chrome 71 才有的 API（`novel-webview/no-es2020-builtin` 禁用它）；
  // Promise.then 与原生同属微任务队列（ES2015 起可用），语义一致。
  Promise.resolve().then(function () {
    setTimeout(function () {
      // 期间正常快照已清零（或退避被新窗口顶替）：本次待重试作废。
      if (state.snapshotResyncBackoffUntil !== deadline) {
        return;
      }
      state.snapshotResyncBackoffUntil = null;
      requestResync(streamId, 0);
    }, delayMs);
  });
}

/**
 * appendTailRows: 追加落库行；全量路径走 Preact renderRows（保留滚动锚点）。
 * 流式行必须保持最后一条（I1）：新行插到它之前。
 * 分片收集在途时挂起（C-orch-1），末片应用后重放。
 */
export function applyAppendTailRows(payload: RowsPayload): void {
  const newRows = (payload.rows || []).slice();
  if (newRows.length === 0) {
    return;
  }
  if (pendingChunkAcc != null) {
    pendingChunkActions.push({kind: 'appendTail', rows: newRows});
    return;
  }
  applyAppendTailRowsNow(newRows);
}

function applyAppendTailRowsNow(newRows: TranscriptRow[]): void {
  const scroller = document.getElementById('scroller');
  const wasNearBottom = state.nearBottom;
  const prevOffsetFromBottom = scroller ? offsetFromBottom(scroller) : 0;
  const last = state.rows[state.rows.length - 1];
  if (last != null && last.status === 'streaming') {
    state.rows = state.rows.slice(0, -1).concat(newRows, [last]);
  } else {
    state.rows = state.rows.concat(newRows);
  }
  // 窗口跟随尾部追加（渲染前）：按追加前距底偏移重定位，新行进窗口。
  resetRowWindowForSnapshot(state.rows.length, {
    kind: 'fromBottom',
    offsetFromBottom: prevOffsetFromBottom,
    clientHeight: scroller ? scroller.clientHeight : 0,
  });
  renderRows();
  scheduleMermaidScan();
  if (scroller) {
    if (wasNearBottom) {
      stickToBottom(scroller);
    } else {
      scroller.scrollTop = scrollTopFrom(scroller, prevOffsetFromBottom);
    }
    state.nearBottom = isNearBottom(scroller);
    emitScrollSnapshot();
  }
}

/**
 * prependPage: only new older rows — NOT a full sessionSnapshot reload.
 * Anchor reading position: scrollTop += scrollHeight - prependedScrollHeight.
 * 分片收集在途时挂起（C-orch-1），末片应用后重放。
 */
export function applyPrependPage(payload: RowsPayload): void {
  const newRows = (payload.rows || []).slice();
  if (pendingChunkAcc != null) {
    pendingChunkActions.push({kind: 'prependPage', rows: newRows});
    return;
  }
  applyPrependPageNow(newRows);
}

function applyPrependPageNow(newRows: TranscriptRow[]): void {
  const scroller = document.getElementById('scroller');
  const prependedScrollHeight = scroller ? scroller.scrollHeight : 0;
  const prependedScrollTop = scroller ? scroller.scrollTop : 0;
  // web/C-1：retarget 前捕获窗口 start 与占位 DOM 真值（retarget 会清零
  // 上占位并把这些行换进窗口），采样时据此扣除占位漂移、并入分母。
  const prependSpacerBefore = {
    rows: getRowWindowRange(state.rows.length).start,
    spacerPx: getRowWindowSpacerPxTotal(),
  };
  state.rows = newRows.concat(state.rows);
  state.loadOlderArmed = true;
  // 窗口按视口读位重定位（渲染前、旧 DOM 旧坐标系）：视口在顶部附近时
  // 新 prepend 行按缓冲带进窗口，其余按估算进上占位。
  retargetRowWindowForPrepend(newRows.length);
  renderRows();
  scheduleMermaidScan();
  if (scroller) {
    const nextScrollHeight = scroller.scrollHeight;
    const deltaHeight = nextScrollHeight - prependedScrollHeight;
    scroller.scrollTop = prependedScrollTop + deltaHeight;
    // 占位估算校正（Step 7）：新行全进窗口后差值折算为窗口新增行的真实
    // 平均高度（web/C-1：扣除占位置换/漂移），并入 EWMA 后续 prepend /
    // 扩窗估算更准。
    notePrependHeightDelta(deltaHeight, newRows.length, prependSpacerBefore);
    // 窗口超稳态的部分收敛（新行全进窗口后窗口变长；下端收缩不动
    // scrollTop，不破坏刚补偿的读位）。
    handleRowWindowScroll();
    state.nearBottom = isNearBottom(scroller);
  }
  emitScrollSnapshot();
}
