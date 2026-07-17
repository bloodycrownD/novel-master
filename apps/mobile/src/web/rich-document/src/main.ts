// @ts-nocheck
/**
 * rich-document WebView 打包入口（esbuild → IIFE app.js）。
 */
/**
 * rich-document WebView boot 正文（assemble 外包 IIFE）。
 */
export var BRIDGE_V = 1;
export var OVER_LIMIT_HINT = '内容过长，已显示原文';

export function post(type, payload) {
    var msg = JSON.stringify({ v: BRIDGE_V, type: type, payload: payload || {} });
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(msg);
    }
  }

export function applyTheme(theme) {
    if (!theme) return;
    var root = document.documentElement;
    if (theme.background) root.style.setProperty('--bg', theme.background);
    if (theme.text) root.style.setProperty('--text', theme.text);
    if (theme.textSecondary) root.style.setProperty('--text-secondary', theme.textSecondary);
    if (theme.primary) root.style.setProperty('--primary', theme.primary);
    if (theme.surface) root.style.setProperty('--surface', theme.surface);
    if (theme.borderLight) root.style.setProperty('--border', theme.borderLight);
  }

export function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

export function setDocument(payload) {
    var doc = document.getElementById('doc');
    if (!doc) return;
    var fm = (payload && payload.frontMatterHtml) || '';
    var mode = payload && payload.mode;
    var overLimit = !!(payload && payload.overLimit);
    var bodyHtml = '';
    if (mode === 'html' && payload.html) {
      bodyHtml = '<div class="doc-body rich">' + payload.html + '</div>';
    } else if (payload.plain) {
      bodyHtml =
        '<div class="doc-body">' + escapeHtml(payload.plain) + '</div>';
    }
    var hint = overLimit
      ? '<div class="over-limit-hint">' + OVER_LIMIT_HINT + '</div>'
      : '';
    doc.innerHTML = fm + bodyHtml + hint;
  }

export function handleHostMessage(raw) {
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

