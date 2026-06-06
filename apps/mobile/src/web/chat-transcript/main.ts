/**
 * WebView transcript boot script (IIFE) — mirrors scroll.ts semantics in the WebView.
 * Bundled into CHAT_TRANSCRIPT_HTML; keep nearBottom threshold in sync with scroll.ts.
 */
import {NEAR_BOTTOM_THRESHOLD_PX} from './scroll';

export function buildTranscriptBootScript(): string {
  return `
(function () {
  var NEAR_BOTTOM = ${NEAR_BOTTOM_THRESHOLD_PX};
  var SCHEMA_V = 2;
  var BRIDGE_V = 1;
  var state = {
    ready: false,
    nearBottom: true,
    rows: [],
    stream: { text: '', thinking: '' },
    scrollRaf: null,
  };

  function post(type, payload) {
    var msg = JSON.stringify({ v: BRIDGE_V, type: type, payload: payload || {} });
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(msg);
    }
  }

  function offsetFromBottom(el) {
    return Math.max(0, el.scrollHeight - el.scrollTop - el.clientHeight);
  }

  function isNearBottom(el) {
    return offsetFromBottom(el) <= NEAR_BOTTOM;
  }

  function stickToBottom(el) {
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    state.nearBottom = true;
  }

  function scheduleStickIfNearBottom() {
    if (!state.nearBottom) return;
    if (state.scrollRaf != null) return;
    state.scrollRaf = requestAnimationFrame(function () {
      state.scrollRaf = null;
      var scroller = document.getElementById('scroller');
      if (scroller) stickToBottom(scroller);
    });
  }

  function emitScrollSnapshot() {
    var scroller = document.getElementById('scroller');
    if (!scroller) return;
    var off = offsetFromBottom(scroller);
    var near = off <= NEAR_BOTTOM;
    state.nearBottom = near;
    post('scrollSnapshot', {
      schemaVersion: SCHEMA_V,
      offsetY: off,
      nearBottom: near,
      scrollHeight: scroller.scrollHeight,
      clientHeight: scroller.clientHeight,
    });
  }

  var scrollTimer = null;
  function onScroll() {
    var scroller = document.getElementById('scroller');
    if (scroller) state.nearBottom = isNearBottom(scroller);
    if (scrollTimer != null) return;
    scrollTimer = setTimeout(function () {
      scrollTimer = null;
      emitScrollSnapshot();
    }, 100);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderRows() {
    var list = document.getElementById('rows');
    if (!list) return;
    var html = '';
    for (var i = 0; i < state.rows.length; i++) {
      var row = state.rows[i];
      if (row.kind === 'message') {
        var role = row.role === 'user' ? 'user' : 'assistant';
        var hidden = row.hidden ? ' hidden' : '';
        html += '<div class="row message ' + role + hidden + '" data-id="' + escapeHtml(row.id) + '">';
        html += '<div class="bubble">' + escapeHtml(row.text || '') + '</div></div>';
      } else if (row.kind === 'stream') {
        html += '<div class="row stream"><div class="bubble assistant">' + escapeHtml(row.text || '') + '</div></div>';
      }
    }
    if (state.stream.text || state.stream.thinking) {
      html += '<div class="row stream" id="stream-tail"><div class="bubble assistant">' + escapeHtml(state.stream.text || '') + '</div></div>';
    }
    list.innerHTML = html;
  }

  function applySnapshot(payload, stickBottom) {
    state.rows = (payload.rows || []).slice();
    state.stream = payload.stream || { text: '', thinking: '' };
    renderRows();
    var scroller = document.getElementById('scroller');
    if (!scroller) return;
    if (stickBottom) {
      stickToBottom(scroller);
    }
    scheduleStickIfNearBottom();
    emitScrollSnapshot();
  }

  function appendStreamDelta(kind, delta) {
    if (kind === 'text') state.stream.text += delta;
    else state.stream.thinking += delta;
    var tail = document.getElementById('stream-tail');
    if (tail) {
      var bubble = tail.querySelector('.bubble');
      if (bubble) bubble.textContent = state.stream.text || '';
    } else {
      renderRows();
    }
    scheduleStickIfNearBottom();
  }

  function handleHostMessage(raw) {
    var msg;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return;
    }
    if (!msg || msg.v !== BRIDGE_V || !msg.type) return;
    var p = msg.payload || {};
    switch (msg.type) {
      case 'init':
        if (p.theme) {
          var root = document.documentElement;
          root.style.setProperty('--bg', p.theme.background || '#fff');
          root.style.setProperty('--text', p.theme.text || '#111');
          root.style.setProperty('--primary', p.theme.primary || '#007aff');
          root.style.setProperty('--surface', p.theme.surface || '#f2f2f7');
        }
        break;
      case 'sessionSnapshot':
        applySnapshot(p, true);
        break;
      case 'streamDelta':
        appendStreamDelta(p.kind, p.delta || '');
        break;
      case 'streamReset':
        state.stream = { text: '', thinking: '' };
        renderRows();
        break;
      default:
        break;
    }
  }

  function onHostMessage(event) {
    var data = event && event.data;
    if (data == null) return;
    handleHostMessage(data);
  }

  document.addEventListener('message', onHostMessage);
  window.addEventListener('message', onHostMessage);

  document.addEventListener('DOMContentLoaded', function () {
    var scroller = document.getElementById('scroller');
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    post('ready', { version: 'm0' });
    state.ready = true;
  });
})();
`.trim();
}
