/**
 * RN ↔ Web document preview bridge: typed JSON envelopes ({ v, type, payload }).
 * MD 批注：Recogito createAnnotation → recogitoCreate；草稿投影 → setAnnotations。
 */
import {TypedMessageBridge} from '@/webview-host/typed-message-bridge';

export const RICH_DOCUMENT_BRIDGE_VERSION = 1 as const;

export type BridgeEnvelope<T extends string, P> = {
  readonly v: typeof RICH_DOCUMENT_BRIDGE_VERSION;
  readonly type: T;
  readonly payload: P;
};

export type RichDocumentTheme = {
  readonly background: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly primary: string;
  readonly surface: string;
  readonly borderLight: string;
};

/**
 * rich-document 渲染层文案（`init.labels` 下发；web 缺省回退内置中文常量）。
 * 首桥 TranscriptLabels 的 named 四键是 transcript 特有（label.* 域），本桥
 * 消费面全是 `ui.*` key，故只有 ui map（p27 R6 波 3-1 第二桥）。
 */
export type RichDocumentLabels = {
  /** ui.* 域文案 map（dotted key → 文案；值可含 {param} 模板，由 web 消费方插值）。 */
  readonly ui: Readonly<Record<string, string>>;
};

type RichDocumentSetPayload = {
  readonly mode: 'html' | 'plain';
  readonly html?: string;
  readonly plain?: string;
  readonly overLimit?: boolean;
  /** FM card HTML prepended inside #doc so FM and body scroll together. */
  readonly frontMatterHtml?: string;
  /**
   * html 布局：`plain` 保留 pre-wrap；缺省为 Markdown 富文本。
   * plain Tab 已禁用批注，一般不再走 annotate 路径。
   */
  readonly layout?: 'plain' | 'rich';
};

/**
 * Recogito 投影载荷：相对 MD 渲染正文半开 [renderStart, renderEnd) + quote。
 */
export type RichDocumentAnnotationMark = {
  readonly id: string;
  readonly originalText: string;
  readonly renderStart: number;
  readonly renderEnd: number;
};

/**
 * @deprecated 旧 menuItems / selectionCollect 遗留载荷；生产不再发送。
 * 仅保留解码兼容；MD 主路径已改 recogitoCreate。
 */
type RichDocumentSelectionCollectPayload = {
  readonly originalText: string;
  readonly mode: 'plain' | 'markdown';
  readonly selectionStart?: number;
  readonly selectionEnd?: number;
  readonly contextBefore?: string;
  readonly contextAfter?: string;
};

/** Recogito createAnnotation → 宿主写草稿。 */
export type RichDocumentRecogitoCreatePayload = {
  readonly quote: string;
  readonly renderStart: number;
  readonly renderEnd: number;
  readonly tempId?: string;
};

/** Host → document WebView */
export type HostToRichDocumentMessage =
  | BridgeEnvelope<'init', {theme: RichDocumentTheme; labels?: RichDocumentLabels}>
  | BridgeEnvelope<'setDocument', RichDocumentSetPayload>
  | BridgeEnvelope<'themeUpdate', {theme: RichDocumentTheme}>
  | BridgeEnvelope<'setAnnotateEnabled', {enabled: boolean}>
  | BridgeEnvelope<
      'setAnnotations',
      {
        annotations: readonly RichDocumentAnnotationMark[];
      }
    >
  /** 关闭详情弹窗后清 Recogito 选中，避免二次点击卡顿。 */
  | BridgeEnvelope<'clearAnnotateSelection', Record<string, never>>
  /** Android 返回键：RN 拦截后下发，关闭 mermaid 全屏查看器。 */
  | BridgeEnvelope<'closeMermaidViewer', Record<string, never>>;

/** Document WebView → host */
type RichDocumentToHostMessage =
  | BridgeEnvelope<'ready', {version: number}>
  /** @deprecated 不再作为主通道；保留解码兼容。 */
  | BridgeEnvelope<'selectionAnnotate', {text: string}>
  /**
   * @deprecated 生产不再发送；仅解码兼容。MD 主路径用 recogitoCreate。
   */
  | BridgeEnvelope<'selectionCollect', RichDocumentSelectionCollectPayload>
  | BridgeEnvelope<'recogitoCreate', RichDocumentRecogitoCreatePayload>
  /** 同文多条时 ids 含全部可改删项；单条时长度为 1。 */
  | BridgeEnvelope<'annotateOpen', {ids: readonly string[]}>
  /** mermaid 全屏查看器开（点击图表进全屏；RN 侧登记返回键拦截态）。 */
  | BridgeEnvelope<'mermaidViewerOpened', Record<string, never>>
  /** mermaid 全屏查看器关（点空白/关闭按钮/返回键；RN 侧复位拦截态）。 */
  | BridgeEnvelope<'mermaidViewerClosed', Record<string, never>>
  /** 代码块复制按钮：webview 收集的源码文本，RN 侧原生 Clipboard 落盘。 */
  | BridgeEnvelope<'copyCode', {code: string}>;

export const richDocumentBridge = TypedMessageBridge.create<HostToRichDocumentMessage, RichDocumentToHostMessage>(RICH_DOCUMENT_BRIDGE_VERSION, 'rich-document');
