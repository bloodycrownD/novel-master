/**
 * rich-document 桥与 setDocument 门面（runtime；无 JSX）。
 * setDocument 仅调用 main 已注册的视图刷新实现；禁止在此拼串或 preact.render。
 *
 * 文件名 bridge.ts 按域前缀起名 RichDocumentBridge：三域同名 bridge.ts 语义独立，
 * 域前缀自解释。
 */
import {BRIDGE_V, type DocumentPayload} from './document-model';
import {post} from './post';
import {Annotate, type AnnotateRenderMark} from './annotate';
import {MermaidFullscreen} from '@web/shared/mermaid-fullscreen/mermaid-fullscreen';
import {HostMessageChannel} from '@web/shared/host-message-channel';
import {HostTheme} from '@web/shared/host-theme';
import {ViewSlot} from '@web/shared/view-slot';
import {Labels, DEFAULT_RICH_DOCUMENT_LABELS, type RichDocumentLabels} from '../ui/labels';

/**
 * P0-3：setDocument 视图槽。Preact DocumentApp 由 main 注册；本文件只持有实现引用。
 */
export const documentViewSlot = ViewSlot.create<DocumentPayload>();


export {post};

// HostTheme 超集与条件式写入统一在 @web/shared/host-theme（web/C-orch-2）
export type {HostTheme};

export namespace RichDocumentBridge {
  /** 渲染层文案 holder（init.labels 下发；旧宿主/缺省回退默认中文，镜像 chat-transcript state.labels）。 */
  const labels: { current: RichDocumentLabels } = { current: DEFAULT_RICH_DOCUMENT_LABELS };
  /** 门面：转发到已注册的 DocumentApp 视图刷新（符号名供契约测保留）。 */
  export function setDocument(payload: DocumentPayload | null | undefined): void {
    documentViewSlot.invoke(payload ?? {});
  }

  /**
   * 渲染层文案读取口（波 3-2 接线消费：over-limit 提示 / mermaid 全屏关闭）。
   */
  export function currentLabels(): RichDocumentLabels {
    return labels.current;
  }

  export function handle(raw: unknown): void {
    const msg = HostMessageChannel.match(raw, BRIDGE_V);
    if (!msg) return;
    if (msg.type === 'init') {
      HostTheme.apply(msg.payload && (msg.payload.theme as HostTheme | undefined));
      // labels：宿主经 core i18n 下发；旧宿主/缺省/非法值回退默认中文（第二桥镜像 C30）。
      labels.current = Labels.resolve(msg.payload?.labels);
      return;
    }
    if (msg.type === 'setDocument') {
      setDocument(msg.payload as DocumentPayload | undefined);
      return;
    }
    if (msg.type === 'themeUpdate') {
      HostTheme.apply(msg.payload && (msg.payload.theme as HostTheme | undefined));
      return;
    }
    if (msg.type === 'setAnnotateEnabled') {
      Annotate.setEnabled(msg.payload?.enabled === true);
      return;
    }
    if (msg.type === 'setAnnotations') {
      const rawList = msg.payload?.annotations;
      const list = Array.isArray(rawList) ? (rawList as AnnotateRenderMark[]) : [];
      Annotate.setAnnotations(list);
      return;
    }
    if (msg.type === 'clearAnnotateSelection') {
      Annotate.clearSelection();
      return;
    }
    // Android 返回键：RN 拦截后下发关闭；关闭后回发 mermaidViewerClosed 复位 RN 态
    if (msg.type === 'closeMermaidViewer') {
      MermaidFullscreen.close(true);
    }
  }
}
