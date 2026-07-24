/**
 * RN ↔ Web document preview bridge: typed JSON envelopes ({ v, type, payload }).
 * MD 批注：Recogito createAnnotation → recogitoCreate；草稿投影 → setAnnotations。
 */
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

export type RichDocumentSetPayload = {
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
export type RichDocumentSelectionCollectPayload = {
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
  | BridgeEnvelope<'init', {theme: RichDocumentTheme}>
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
  | BridgeEnvelope<'clearAnnotateSelection', Record<string, never>>;

/** Document WebView → host */
export type RichDocumentToHostMessage =
  | BridgeEnvelope<'ready', {version: number}>
  | BridgeEnvelope<
      'log',
      {level: string; message: string; fields?: Record<string, unknown>}
    >
  /** @deprecated 不再作为主通道；保留解码兼容。 */
  | BridgeEnvelope<'selectionAnnotate', {text: string}>
  /**
   * @deprecated 生产不再发送；仅解码兼容。MD 主路径用 recogitoCreate。
   */
  | BridgeEnvelope<'selectionCollect', RichDocumentSelectionCollectPayload>
  | BridgeEnvelope<'recogitoCreate', RichDocumentRecogitoCreatePayload>
  /** 同文多条时 ids 含全部可改删项；单条时长度为 1。 */
  | BridgeEnvelope<'annotateOpen', {ids: readonly string[]}>;

export function encodeHostToRichDocument(
  message: HostToRichDocumentMessage,
): string {
  return JSON.stringify(message);
}

export function encodeRichDocumentToHost(
  message: RichDocumentToHostMessage,
): string {
  return JSON.stringify(message);
}

export function decodeRichDocumentToHost(
  raw: string,
): RichDocumentToHostMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.v !== RICH_DOCUMENT_BRIDGE_VERSION) {
    throw new Error('Invalid rich-document bridge envelope version');
  }
  if (typeof parsed.type !== 'string' || !isRecord(parsed.payload)) {
    throw new Error('Invalid rich-document bridge envelope shape');
  }
  return parsed as RichDocumentToHostMessage;
}

export function decodeHostToRichDocument(
  raw: string,
): HostToRichDocumentMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.v !== RICH_DOCUMENT_BRIDGE_VERSION) {
    throw new Error('Invalid rich-document bridge envelope version');
  }
  if (typeof parsed.type !== 'string') {
    throw new Error('Invalid rich-document bridge envelope shape');
  }
  return parsed as HostToRichDocumentMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}
