/**
 * rich-document WebView 打包入口（esbuild → IIFE app.js）。
 */

/** RN WebView 注入的 postMessage 桥（宿主 API）。 */
type ReactNativeWebViewBridge = {
  postMessage: (message: string) => void;
};

declare global {
  interface Window {
    ReactNativeWebView?: ReactNativeWebViewBridge;
  }
}

export const BRIDGE_V = 1;
export const OVER_LIMIT_HINT = '内容过长，已显示原文';

export type HostTheme = {
  background?: string;
  text?: string;
  textSecondary?: string;
  primary?: string;
  surface?: string;
  borderLight?: string;
};

export type DocumentPayload = {
  frontMatterHtml?: string;
  mode?: string;
  overLimit?: boolean;
  html?: string;
  plain?: string;
};

export function post(type: string, payload?: Record<string, unknown>): void {
  const msg = JSON.stringify({ v: BRIDGE_V, type: type, payload: payload || {} });
  if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
    window.ReactNativeWebView.postMessage(msg);
  }
}

export function applyTheme(theme: HostTheme | null | undefined): void {
  if (!theme) return;
  const root = document.documentElement;
  if (theme.background) root.style.setProperty('--bg', theme.background);
  if (theme.text) root.style.setProperty('--text', theme.text);
  if (theme.textSecondary) {
    root.style.setProperty('--text-secondary', theme.textSecondary);
  }
  if (theme.primary) root.style.setProperty('--primary', theme.primary);
  if (theme.surface) root.style.setProperty('--surface', theme.surface);
  if (theme.borderLight) root.style.setProperty('--border', theme.borderLight);
}

export function escapeHtml(text: unknown): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function setDocument(payload: DocumentPayload | null | undefined): void {
  const doc = document.getElementById('doc');
  if (!doc) return;
  const fm = (payload && payload.frontMatterHtml) || '';
  const mode = payload && payload.mode;
  const overLimit = !!(payload && payload.overLimit);
  let bodyHtml = '';
  if (mode === 'html' && payload && payload.html) {
    bodyHtml = '<div class="doc-body rich">' + payload.html + '</div>';
  } else if (payload && payload.plain) {
    bodyHtml =
      '<div class="doc-body">' + escapeHtml(payload.plain) + '</div>';
  }
  const hint = overLimit
    ? '<div class="over-limit-hint">' + OVER_LIMIT_HINT + '</div>'
    : '';
  doc.innerHTML = fm + bodyHtml + hint;
}

export function handleHostMessage(raw: unknown): void {
  let msg: { v?: number; type?: string; payload?: Record<string, unknown> };
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (!msg || msg.v !== BRIDGE_V) return;
  if (msg.type === 'init') {
    applyTheme(msg.payload && (msg.payload.theme as HostTheme | undefined));
    return;
  }
  if (msg.type === 'setDocument') {
    setDocument(msg.payload as DocumentPayload | undefined);
    return;
  }
  if (msg.type === 'themeUpdate') {
    applyTheme(msg.payload && (msg.payload.theme as HostTheme | undefined));
  }
}

document.addEventListener('message', function (e: Event) {
  const ev = e as MessageEvent;
  handleHostMessage(ev.data);
});
window.addEventListener('message', function (e: MessageEvent) {
  handleHostMessage(e.data);
});

post('ready', { version: 1 });
