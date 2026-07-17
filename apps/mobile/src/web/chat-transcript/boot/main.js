/**
 * chat-transcript boot 入口收尾：宿主 message 监听 + bootTranscript + readyState 兜底。
 */
document.addEventListener('message', onHostMessage);
  window.addEventListener('message', onHostMessage);

  function bootTranscript() {
    var scroller = document.getElementById('scroller');
    var rows = document.getElementById('rows');
    if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true });
    if (rows) {
      rows.addEventListener('click', onRowsClick);
      rows.addEventListener('touchstart', onMessagePointerDown, { passive: true });
      rows.addEventListener('touchmove', onMessagePointerMove, { passive: true });
      rows.addEventListener('touchend', onMessagePointerUp, { passive: true });
      rows.addEventListener('touchcancel', onMessagePointerUp, { passive: true });
    }
    // RN WebView html source 上 DOMContentLoaded 可能已错过；readyState 兜底
    post('ready', { version: 'm3', readyState: document.readyState });
    state.ready = true;
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootTranscript);
  } else {
    bootTranscript();
  }
