/**
 * rich-document 桥与 setDocument 门面（runtime；无 JSX）。
 * setDocument 仅调用 main 已注册的视图刷新实现；禁止在此拼串或 preact.render。
 */
import {BRIDGE_V, type DocumentPayload} from './document-model';
import {post} from './post';
import {
  setAnnotateEnabled,
  setAnnotations,
  clearAnnotateSelection,
  type AnnotateRenderMark,
} from './annotate';
import {closeMermaidViewer} from '@web/shared/mermaid-fullscreen/mermaid-fullscreen';
import {matchHostMessage} from '@web/shared/host-message-channel';
import {applyHostTheme} from '@web/shared/host-theme';
import type {HostTheme} from '@web/shared/host-theme';

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

export {post};

// HostTheme 超集与条件式写入统一在 @web/shared/host-theme（web/C-orch-2）
export type {HostTheme};

/** 门面：转发到已注册的 DocumentApp 视图刷新（符号名供契约测保留）。 */
export function setDocument(payload: DocumentPayload | null | undefined): void {
  invokeRegisteredSetDocumentView(payload ?? {});
}

export function handleHostMessage(raw: unknown): void {
  const msg = matchHostMessage(raw, BRIDGE_V);
  if (!msg) return;
  if (msg.type === 'init') {
    applyHostTheme(msg.payload && (msg.payload.theme as HostTheme | undefined));
    return;
  }
  if (msg.type === 'setDocument') {
    setDocument(msg.payload as DocumentPayload | undefined);
    return;
  }
  if (msg.type === 'themeUpdate') {
    applyHostTheme(msg.payload && (msg.payload.theme as HostTheme | undefined));
    return;
  }
  if (msg.type === 'setAnnotateEnabled') {
    setAnnotateEnabled(msg.payload?.enabled === true);
    return;
  }
  if (msg.type === 'setAnnotations') {
    const rawList = msg.payload?.annotations;
    const list = Array.isArray(rawList)
      ? (rawList as AnnotateRenderMark[])
      : [];
    setAnnotations(list);
    return;
  }
  if (msg.type === 'clearAnnotateSelection') {
    clearAnnotateSelection();
    return;
  }
  // Android 返回键：RN 拦截后下发关闭；关闭后回发 mermaidViewerClosed 复位 RN 态
  if (msg.type === 'closeMermaidViewer') {
    closeMermaidViewer(true);
  }
}
