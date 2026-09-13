import {state} from '../state/state';
import type {MessageRow, TranscriptRow} from '../state/state';
import {
  offsetFromBottom,
  isNearBottom,
  stickToBottom,
  emitScrollSnapshot,
} from '../scroll/scroll';
import {closeContextMenu} from '../menu/menu';
import {scrollTopForOffsetFromBottom} from '../../../../../webview-host/chat-transcript/scroll';
import {renderRows} from './row-logic';
import {setStreamToolInvokingDom} from '../stream/stream';
import {scheduleMermaidScan} from '../mermaid';

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
  generating?: boolean;
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
 * 同代次按 chunkIndex 顺序累计 rows，末片到齐才整体 applySnapshot——
 * 分片期间不产生中间渲染，也不触发任何滚动副作用（T-S4 前半）。
 */
type SnapshotChunkAccumulator = {
  generation: number;
  /** 期望的下一个 chunkIndex（同时是已收片数）。 */
  received: number;
  rows: TranscriptRow[];
  sessionKey?: string;
  hasMore?: boolean;
  generating?: boolean;
};

/** 已完整应用的最新代次（RN 侧模块级计数器从 1 起单调递增）。 */
let appliedSnapshotGeneration = 0;
let pendingChunkAcc: SnapshotChunkAccumulator | null = null;

function numberOf(value: unknown): number {
  return typeof value === 'number' && value >= 0 ? value : -1;
}

/**
 * sessionSnapshot 统一入口：单片（chunkTotal 缺省或 =1）直发 applySnapshot
 * 等价旧协议；多片则按代次拼装——未知/迟到代次与乱序分片一律丢弃
 * （凑不齐的代次由 RN 侧 force 新代次重传兜底）。
 */
export function handleSnapshotPayload(payload: SnapshotPayload): void {
  const rawChunkTotal = numberOf(payload.chunkTotal);
  const chunkTotal = rawChunkTotal >= 1 ? rawChunkTotal : 1;
  const generation = numberOf(payload.generation);
  if (chunkTotal <= 1) {
    if (generation > 0) {
      // 已应用代次的迟到单片（乱序/重复投递）与分片同口径判旧丢弃；
      // generation 缺省=旧协议载荷，不判代次直发。
      if (generation <= appliedSnapshotGeneration) {
        return;
      }
      appliedSnapshotGeneration = generation;
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
  // 新代次首片：重置收集（顶替在途旧代次，旧余片随后被上面的判旧丢弃）。
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
      generating: payload.generating,
    };
    pendingChunkAcc = acc;
  }
  // 乱序/重复分片：丢弃（缺口无法自愈，由 force 新代次整体重发兜底）。
  if (chunkIndex !== acc.received) {
    return;
  }
  const rows = payload.rows || [];
  for (let i = 0; i < rows.length; i++) {
    acc.rows.push(rows[i]);
  }
  // 快照级标量每片重复携带，取最新到达为准。
  acc.sessionKey = payload.sessionKey;
  acc.hasMore = payload.hasMore;
  acc.generating = payload.generating;
  acc.received = chunkIndex + 1;
  if (chunkIndex === chunkTotal - 1) {
    // 末片到齐：滚动字段仅在末片携带，拼齐后整体应用（一次 renderRows、
    // 一次滚动副作用）。
    const assembled: SnapshotPayload = {
      sessionKey: acc.sessionKey,
      rows: acc.rows,
      hasMore: !!acc.hasMore,
      generating: acc.generating,
      scrollIntent: payload.scrollIntent || 'stick',
      restoreScroll: payload.restoreScroll,
    };
    appliedSnapshotGeneration = generation;
    pendingChunkAcc = null;
    applySnapshot(assembled);
  }
}

/**
 * 会话快照、prepend/append 与 streamCommit 编排。
 */
export function applySnapshot(payload: SnapshotPayload): void {
  const intent = payload.scrollIntent || 'stick';
  const scroller = document.getElementById('scroller');
  const wasNearBottom = state.nearBottom;
  const prevOffsetFromBottom = scroller ? offsetFromBottom(scroller) : 0;
  const sessionChanged =
    !!payload.sessionKey && payload.sessionKey !== state.sessionKey;

  state.sessionKey = payload.sessionKey || state.sessionKey;
  state.rows = (payload.rows || []).slice();
  state.hasMore = !!payload.hasMore;
  state.loadOlderArmed = true;
  if (intent !== 'preserve' || sessionChanged) {
    state.stream = {
      text: '',
      thinking: '',
      textHtml: '',
      thinkingHtml: '',
      toolInvoking: false,
    };
  }
  if (sessionChanged) {
    closeContextMenu(false);
  }
  const scrollAfterRender = function () {
    if (!scroller) return;
    if (intent === 'stick') {
      stickToBottom(scroller);
    } else if (intent === 'restore' && payload.restoreScroll) {
      const rs = payload.restoreScroll;
      if (rs.nearBottom) {
        stickToBottom(scroller);
      } else {
        scroller.scrollTop = scrollTopForOffsetFromBottom(
          scroller.scrollHeight,
          scroller.clientHeight,
          rs.offsetY,
        );
      }
    } else if (intent === 'preserve') {
      if (wasNearBottom) {
        stickToBottom(scroller);
      } else {
        // WHY: flex-end layout shrinks tail — restore distance-from-bottom, not raw scrollTop.
        scroller.scrollTop = scrollTopForOffsetFromBottom(
          scroller.scrollHeight,
          scroller.clientHeight,
          prevOffsetFromBottom,
        );
      }
    }
    state.nearBottom = isNearBottom(scroller);
    emitScrollSnapshot();
  };
  requestAnimationFrame(function () {
    if (intent === 'stick' && scroller) {
      scroller.scrollTop = 0;
    }
    renderRows();
    // 历史行渲染后触发 mermaid 扫描（防抖；流式尾不扫）
    scheduleMermaidScan();
    if (payload.generating) {
      setStreamToolInvokingDom(true);
    }
    if (intent === 'stick') {
      requestAnimationFrame(function () {
        scrollAfterRender();
      });
    } else {
      scrollAfterRender();
    }
  });
}

/**
 * appendTailRows: 追加落库行；全量路径走 Preact renderRows（保留滚动锚点）。
 */
export function applyAppendTailRows(payload: RowsPayload): void {
  const newRows = (payload.rows || []).slice();
  if (newRows.length === 0) {
    return;
  }
  const scroller = document.getElementById('scroller');
  const wasNearBottom = state.nearBottom;
  const prevOffsetFromBottom = scroller ? offsetFromBottom(scroller) : 0;
  state.rows = state.rows.concat(newRows);
  renderRows();
  scheduleMermaidScan();
  if (scroller) {
    if (wasNearBottom) {
      stickToBottom(scroller);
    } else {
      scroller.scrollTop = scrollTopForOffsetFromBottom(
        scroller.scrollHeight,
        scroller.clientHeight,
        prevOffsetFromBottom,
      );
    }
    state.nearBottom = isNearBottom(scroller);
    emitScrollSnapshot();
  }
}

/**
 * streamCommit: 流式结束单次提交 — 清 stream 状态、追加落库行；优先 promote #stream-tail。
 */
export function promoteStreamTailToRow(row: TranscriptRow): boolean {
  if (!row || row.kind !== 'message') {
    return false;
  }
  const streamTail = document.getElementById('stream-tail');
  if (!streamTail) {
    return false;
  }
  // Preact 全量路径：调用方已清 stream 并写入 rows，交由 renderRows 刷新
  renderRows();
  return true;
}

export function applyStreamCommit(payload: RowsPayload): void {
  const newRows = (payload.rows || []).slice();
  const toAppend: TranscriptRow[] = [];
  for (let i = 0; i < newRows.length; i++) {
    const row = newRows[i];
    if (row.kind !== 'message') {
      continue;
    }
    let dup = false;
    for (let j = 0; j < state.rows.length; j++) {
      const existing = state.rows[j];
      if (existing.kind === 'message' && existing.id === row.id) {
        dup = true;
        break;
      }
    }
    if (!dup) {
      toAppend.push(row);
    }
  }
  if (toAppend.length === 0) {
    renderRows();
    scheduleMermaidScan();
    return;
  }
  const scroller = document.getElementById('scroller');
  const wasNearBottom = state.nearBottom;
  const prevOffsetFromBottom = scroller ? offsetFromBottom(scroller) : 0;
  state.rows = state.rows.concat(toAppend);
  const promoted =
    toAppend.length === 1 &&
    toAppend[0].kind === 'message' &&
    promoteStreamTailToRow(toAppend[0] as MessageRow);
  if (!promoted) {
    renderRows();
  }
  // 定稿行落库后触发 mermaid 扫描（流式期保留的源码占位在此转图表）
  scheduleMermaidScan();
  const scrollIntent = payload.scrollIntent || 'preserve';
  if (scroller) {
    if (scrollIntent === 'preserve' && wasNearBottom) {
      stickToBottom(scroller);
    } else if (scrollIntent === 'preserve') {
      scroller.scrollTop = scrollTopForOffsetFromBottom(
        scroller.scrollHeight,
        scroller.clientHeight,
        prevOffsetFromBottom,
      );
    }
    state.nearBottom = isNearBottom(scroller);
    emitScrollSnapshot();
  }
}

/**
 * prependPage: only new older rows — NOT a full sessionSnapshot reload.
 * Anchor reading position: scrollTop += scrollHeight - prependedScrollHeight.
 */
export function applyPrependPage(payload: RowsPayload): void {
  const newRows = (payload.rows || []).slice();
  const scroller = document.getElementById('scroller');
  const prependedScrollHeight = scroller ? scroller.scrollHeight : 0;
  const prependedScrollTop = scroller ? scroller.scrollTop : 0;
  state.rows = newRows.concat(state.rows);
  state.loadOlderArmed = true;
  renderRows();
  scheduleMermaidScan();
  if (scroller) {
    const nextScrollHeight = scroller.scrollHeight;
    scroller.scrollTop =
      prependedScrollTop + (nextScrollHeight - prependedScrollHeight);
    state.nearBottom = isNearBottom(scroller);
  }
  emitScrollSnapshot();
}
