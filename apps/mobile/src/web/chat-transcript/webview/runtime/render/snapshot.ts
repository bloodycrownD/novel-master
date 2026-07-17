import { state } from '../state/state';
import type { MessageRow, TranscriptRow } from '../state/state';
import {
  offsetFromBottom,
  isNearBottom,
  stickToBottom,
  emitScrollSnapshot,
} from '../scroll/scroll';
import { closeContextMenu } from '../menu/menu';
import { renderRows } from './row-logic';
import { setStreamToolInvokingDom } from '../stream/stream';

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
};

export type RowsPayload = {
  rows?: TranscriptRow[];
  scrollIntent?: string;
};

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
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight - rs.offsetY,
        );
      }
    } else if (intent === 'preserve') {
      if (wasNearBottom) {
        stickToBottom(scroller);
      } else {
        // WHY: flex-end layout shrinks tail — restore distance-from-bottom, not raw scrollTop.
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight - prevOffsetFromBottom,
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
  if (scroller) {
    if (wasNearBottom) {
      stickToBottom(scroller);
    } else {
      scroller.scrollTop = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight - prevOffsetFromBottom,
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
    if (row.kind !== 'message' && row.kind !== 'user_vfs_turn') {
      continue;
    }
    let dup = false;
    for (let j = 0; j < state.rows.length; j++) {
      const existing = state.rows[j];
      if (
        (existing.kind === 'message' || existing.kind === 'user_vfs_turn') &&
        existing.id === row.id
      ) {
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
  const scrollIntent = payload.scrollIntent || 'preserve';
  if (scroller) {
    if (scrollIntent === 'preserve' && wasNearBottom) {
      stickToBottom(scroller);
    } else if (scrollIntent === 'preserve') {
      scroller.scrollTop = Math.max(
        0,
        scroller.scrollHeight - scroller.clientHeight - prevOffsetFromBottom,
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
  if (scroller) {
    const nextScrollHeight = scroller.scrollHeight;
    scroller.scrollTop =
      prependedScrollTop + (nextScrollHeight - prependedScrollHeight);
    state.nearBottom = isNearBottom(scroller);
  }
  emitScrollSnapshot();
}
