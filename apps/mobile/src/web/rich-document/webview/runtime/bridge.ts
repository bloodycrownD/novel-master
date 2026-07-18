/**
 * rich-document 桥与 setDocument 门面（runtime；无 JSX）。
 * setDocument 仅调用 main 已注册的视图刷新实现；禁止在此拼串或 preact.render。
 */
import {
  BRIDGE_V,
  type DocumentPayload,
  type HostTheme,
} from './document-model';

/** RN WebView 注入的 postMessage 桥（宿主 API）。 */
type ReactNativeWebViewBridge = {
  postMessage: (message: string) => void;
};

declare global {
  interface Window {
    ReactNativeWebView?: ReactNativeWebViewBridge;
  }
}

/**
 * P0-3：setDocument 视图刷新注册门面。
 * Preact DocumentApp 由 main 注册；本文件只持有实现引用。
 */
export type SetDocumentView = (payload: DocumentPayload) => void;

let _setDocumentView: SetDocumentView | null = null;

/** 由 main 注册 Preact（或其它）文档视图刷新实现。 */
export function registerSetDocumentView(fn: SetDocumentView): void {
  _setDocumentView = fn;
}

/**
 * 调用已注册实现；未注册时返回 false。
 */
export function invokeRegisteredSetDocumentView(
  payload: DocumentPayload,
): boolean {
  if (!_setDocumentView) return false;
  _setDocumentView(payload);
  return true;
}

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

/** 门面：转发到已注册的 DocumentApp 视图刷新（符号名供契约测保留）。 */
export function setDocument(payload: DocumentPayload | null | undefined): void {
  invokeRegisteredSetDocumentView(payload ?? {});
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
