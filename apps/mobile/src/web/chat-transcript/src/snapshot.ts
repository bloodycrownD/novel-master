import { state } from './state';
import type { MessageRow, TranscriptRow } from './state';
import {
  offsetFromBottom,
  isNearBottom,
  stickToBottom,
  emitScrollSnapshot,
} from './scroll';
import { closeContextMenu } from './menu';
import { renderRow, renderRows } from './row-render';
import { setStreamToolInvokingDom } from './stream';

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
 * appendTailRows: append persisted rows at end without full renderRows.
 * Preserves stream tail and scroll anchor when not near bottom.
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
  let html = '';
  for (let i = 0; i < newRows.length; i++) {
    const row = newRows[i];
    if (row.kind === 'message' || row.kind === 'user_vfs_turn') {
      html += renderRow(row);
    }
  }
  const list = document.getElementById('rows');
  if (!list) {
    return;
  }
  const streamTail = document.getElementById('stream-tail');
  if (streamTail) {
    streamTail.insertAdjacentHTML('beforebegin', html);
  } else {
    const empty = list.querySelector('.empty-state');
    if (empty) {
      empty.insertAdjacentHTML('beforebegin', html);
      empty.remove();
    } else {
      list.insertAdjacentHTML('beforeend', html);
    }
  }
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
  const rowHtml = renderRow(row);
  if (!rowHtml) {
    return false;
  }
  streamTail.outerHTML = rowHtml;
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
