/**
 * RN ↔ Web document preview bridge: typed JSON envelopes ({ v, type, payload }).
 * Minimal surface — init / setDocument / themeUpdate / ready only (no scroll or menu).
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
};

/** Host → document WebView */
export type HostToRichDocumentMessage =
  | BridgeEnvelope<'init', {theme: RichDocumentTheme}>
  | BridgeEnvelope<'setDocument', RichDocumentSetPayload>
  | BridgeEnvelope<'themeUpdate', {theme: RichDocumentTheme}>;

/** Document WebView → host */
export type RichDocumentToHostMessage =
  | BridgeEnvelope<'ready', {version: number}>
  | BridgeEnvelope<
      'log',
      {level: string; message: string; fields?: Record<string, unknown>}
    >;

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
