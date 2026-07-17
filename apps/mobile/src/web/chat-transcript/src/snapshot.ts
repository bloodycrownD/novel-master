// @ts-nocheck
import { state } from './state';
import {
  offsetFromBottom,
  isNearBottom,
  stickToBottom,
  emitScrollSnapshot,
} from './scroll';
import { closeContextMenu } from './menu';
import { renderRow, renderRows } from './row-render';
import { setStreamToolInvokingDom } from './stream';
/**
 * 会话快照、prepend/append 与 streamCommit 编排。
 */
export function applySnapshot(payload) {
    var intent = payload.scrollIntent || 'stick';
    var scroller = document.getElementById('scroller');
    var wasNearBottom = state.nearBottom;
    var prevOffsetFromBottom = scroller ? offsetFromBottom(scroller) : 0;
    var sessionChanged = payload.sessionKey && payload.sessionKey !== state.sessionKey;

    state.sessionKey = payload.sessionKey || state.sessionKey;
    state.rows = (payload.rows || []).slice();
    state.hasMore = !!payload.hasMore;
    state.loadOlderArmed = true;
    if (intent !== 'preserve' || sessionChanged) {
      state.stream = { text: '', thinking: '', textHtml: '', thinkingHtml: '', toolInvoking: false };
    }
    if (sessionChanged) {
      closeContextMenu(false);
    }
    var scrollAfterRender = function () {
      if (!scroller) return;
      if (intent === 'stick') {
        stickToBottom(scroller);
      } else if (intent === 'restore' && payload.restoreScroll) {
      var rs = payload.restoreScroll;
      if (rs.nearBottom) {
        stickToBottom(scroller);
      } else {
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight - rs.offsetY
        );
      }
      } else if (intent === 'preserve') {
        if (wasNearBottom) {
          stickToBottom(scroller);
        } else {
          // WHY: flex-end layout shrinks tail — restore distance-from-bottom, not raw scrollTop.
          scroller.scrollTop = Math.max(
            0,
            scroller.scrollHeight - scroller.clientHeight - prevOffsetFromBottom
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
export function applyAppendTailRows(payload) {
    var newRows = (payload.rows || []).slice();
    if (newRows.length === 0) {
      return;
    }
    var scroller = document.getElementById('scroller');
    var wasNearBottom = state.nearBottom;
    var prevOffsetFromBottom = scroller ? offsetFromBottom(scroller) : 0;
    state.rows = state.rows.concat(newRows);
    var html = '';
    for (var i = 0; i < newRows.length; i++) {
      var row = newRows[i];
      if (row.kind === 'message' || row.kind === 'user_vfs_turn') {
        html += renderRow(row);
      }
    }
    var list = document.getElementById('rows');
    if (!list) {
      return;
    }
    var streamTail = document.getElementById('stream-tail');
    if (streamTail) {
      streamTail.insertAdjacentHTML('beforebegin', html);
    } else {
      var empty = list.querySelector('.empty-state');
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
          scroller.scrollHeight - scroller.clientHeight - prevOffsetFromBottom
        );
      }
      state.nearBottom = isNearBottom(scroller);
      emitScrollSnapshot();
    }
  }

  /**
   * streamCommit: 流式结束单次提交 — 清 stream 状态、追加落库行；优先 promote #stream-tail。
   */
export function promoteStreamTailToRow(row) {
    if (!row || row.kind !== 'message') {
      return false;
    }
    var streamTail = document.getElementById('stream-tail');
    if (!streamTail) {
      return false;
    }
    var rowHtml = renderRow(row);
    if (!rowHtml) {
      return false;
    }
    streamTail.outerHTML = rowHtml;
    return true;
  }

export function applyStreamCommit(payload) {
    var newRows = (payload.rows || []).slice();
    var toAppend = [];
    for (var i = 0; i < newRows.length; i++) {
      var row = newRows[i];
      if (row.kind !== 'message' && row.kind !== 'user_vfs_turn') {
        continue;
      }
      var dup = false;
      for (var j = 0; j < state.rows.length; j++) {
        var existing = state.rows[j];
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
    var scroller = document.getElementById('scroller');
    var wasNearBottom = state.nearBottom;
    var prevOffsetFromBottom = scroller ? offsetFromBottom(scroller) : 0;
    state.rows = state.rows.concat(toAppend);
    var promoted =
      toAppend.length === 1 &&
      toAppend[0].kind === 'message' &&
      promoteStreamTailToRow(toAppend[0]);
    if (!promoted) {
      renderRows();
    }
    var scrollIntent = payload.scrollIntent || 'preserve';
    if (scroller) {
      if (scrollIntent === 'preserve' && wasNearBottom) {
        stickToBottom(scroller);
      } else if (scrollIntent === 'preserve') {
        scroller.scrollTop = Math.max(
          0,
          scroller.scrollHeight - scroller.clientHeight - prevOffsetFromBottom
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
export function applyPrependPage(payload) {
    var newRows = (payload.rows || []).slice();
    var scroller = document.getElementById('scroller');
    var prependedScrollHeight = scroller ? scroller.scrollHeight : 0;
    var prependedScrollTop = scroller ? scroller.scrollTop : 0;
    state.rows = newRows.concat(state.rows);
    state.loadOlderArmed = true;
    renderRows();
    if (scroller) {
      var nextScrollHeight = scroller.scrollHeight;
      scroller.scrollTop = prependedScrollTop + (nextScrollHeight - prependedScrollHeight);
      state.nearBottom = isNearBottom(scroller);
    }
    emitScrollSnapshot();
  }
