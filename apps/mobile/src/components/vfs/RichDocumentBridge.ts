/**
 * RN ↔ Web document preview bridge: typed JSON envelopes ({ v, type, payload }).
 * Supports document set/theme plus optional annotate (selection collect / open).
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
   * html 布局：`plain` 保留 pre-wrap（认锚文本 Tab）；缺省为 Markdown 富文本。
   */
  readonly layout?: 'plain' | 'rich';
};

/**
 * 应急回滚用旧 mark 载荷（默认主路径不再投递）。
 * @deprecated 预览主路径已改锚注入；仅 `__NM_ANNOTATE_DOM_SEARCH_FALLBACK__` 时使用。
 */
export type RichDocumentAnnotationMark = {
  readonly id: string;
  readonly originalText: string;
  readonly startLine?: number;
  readonly endLine?: number;
  readonly startCol?: number;
  readonly endCol?: number;
};

/** menuItems → injectJS 采集回传（Step 5）。 */
export type RichDocumentSelectionCollectPayload = {
  readonly originalText: string;
  readonly mode: 'plain' | 'markdown';
  readonly selectionStart?: number;
  readonly selectionEnd?: number;
  readonly contextBefore?: string;
  readonly contextAfter?: string;
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
        /** 磁盘源文件全文，供窗口优先匹配（应急）。 */
        sourceText?: string;
      }
    >;

/** Document WebView → host */
export type RichDocumentToHostMessage =
  | BridgeEnvelope<'ready', {version: number}>
  | BridgeEnvelope<
      'log',
      {level: string; message: string; fields?: Record<string, unknown>}
    >
  /** @deprecated 不再作为主通道；保留解码兼容。 */
  | BridgeEnvelope<'selectionAnnotate', {text: string}>
  | BridgeEnvelope<'selectionCollect', RichDocumentSelectionCollectPayload>
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
