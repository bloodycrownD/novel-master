/**
 * WebView document preview boot script (IIFE) — minimal bridge: init / setDocument / themeUpdate.
 * No scroll, stream, or menu handlers (unlike chat-transcript).
 */
export function buildRichDocumentBootScript(): string {
  return `
(function () {
  var BRIDGE_V = 1;
  var OVER_LIMIT_HINT = '内容过长，已显示原文';

  function post(type, payload) {
    var msg = JSON.stringify({ v: BRIDGE_V, type: type, payload: payload || {} });
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(msg);
    }
  }

  function applyTheme(theme) {
    if (!theme) return;
    var root = document.documentElement;
    if (theme.background) root.style.setProperty('--bg', theme.background);
    if (theme.text) root.style.setProperty('--text', theme.text);
    if (theme.textSecondary) root.style.setProperty('--text-secondary', theme.textSecondary);
    if (theme.primary) root.style.setProperty('--primary', theme.primary);
    if (theme.surface) root.style.setProperty('--surface', theme.surface);
    if (theme.borderLight) root.style.setProperty('--border', theme.borderLight);
  }

  function setOverLimitHint(visible) {
    var hint = document.getElementById('over-limit-hint');
    if (!hint) return;
    hint.textContent = OVER_LIMIT_HINT;
    hint.style.display = visible ? 'block' : 'none';
  }

  function setDocument(payload) {
    var doc = document.getElementById('doc');
    if (!doc) return;
    var mode = payload && payload.mode;
    var overLimit = !!(payload && payload.overLimit);
    setOverLimitHint(overLimit);
    if (mode === 'html' && payload.html) {
      doc.innerHTML = payload.html;
      doc.classList.add('rich');
      return;
    }
    doc.textContent = (payload && payload.plain) || '';
    doc.classList.remove('rich');
  }

  function handleHostMessage(raw) {
    var msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!msg || msg.v !== BRIDGE_V) return;
    if (msg.type === 'init') {
      applyTheme(msg.payload && msg.payload.theme);
      return;
    }
    if (msg.type === 'setDocument') {
      setDocument(msg.payload);
      return;
    }
    if (msg.type === 'themeUpdate') {
      applyTheme(msg.payload && msg.payload.theme);
    }
  }

  document.addEventListener('message', function (e) {
    handleHostMessage(e.data);
  });
  window.addEventListener('message', function (e) {
    handleHostMessage(e.data);
  });

  post('ready', { version: 1 });
})();
`.trim();
}
