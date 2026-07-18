/**
 * chat-transcript boot 共享状态与版本常量。
 */

/** RN WebView 注入的 postMessage 桥（宿主 API）。 */
export type ReactNativeWebViewBridge = {
  postMessage: (message: string) => void;
};

declare global {
  interface Window {
    ReactNativeWebView?: ReactNativeWebViewBridge;
  }
}

export const SCHEMA_V = 2;
export const BRIDGE_V = 1;
export const VFS_FILE_TOOLS: Record<string, number> = {
  read: 1,
  write: 1,
  edit: 1,
};

/** 工具调用行（渲染用最小字段）。 */
export type ToolCallRow = {
  name?: string;
  status?: string;
  summary?: string;
  input?: Record<string, unknown> | null;
  resultContent?: unknown;
};

/** 消息附件芯片。 */
export type AttachmentChip = {
  source?: string;
  type?: string;
  name?: string;
  path?: string;
};

/** 普通消息行。 */
export type MessageRow = {
  kind: 'message';
  id: string;
  role?: string;
  text?: string;
  textHtml?: string;
  thinking?: string;
  thinkingHtml?: string;
  tools?: ToolCallRow[];
  attachments?: AttachmentChip[];
  hidden?: boolean;
};

export type TranscriptRow = MessageRow;

export type TranscriptFlags = {
  richText: boolean;
  menuDisabled: boolean;
};

export type StreamState = {
  text: string;
  thinking: string;
  textHtml: string;
  thinkingHtml: string;
  toolInvoking: boolean;
};

export type MenuItem = {
  label: string;
  action: string;
  danger?: boolean;
};

export type MenuAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ContextMenuState = {
  messageId: string;
  pageX: number;
  pageY: number;
  anchor: MenuAnchor;
  items: MenuItem[];
};

export type LongPressTarget = {
  messageId: string;
  pageX: number;
  pageY: number;
  hitEl: EventTarget | null;
};

export type TranscriptState = {
  ready: boolean;
  nearBottom: boolean;
  sessionKey: string;
  rows: TranscriptRow[];
  hasMore: boolean;
  stream: StreamState;
  flags: TranscriptFlags;
  menu: ContextMenuState | null;
  menuOverlayHandler: ((event: Event) => void) | null;
  menuNativeTextBlockHandler: ((event: Event) => void) | null;
  thinkingExpanded: Record<string, boolean>;
  toolGroupExpanded: Record<string, boolean>;
  attachGroupExpanded: Record<string, boolean>;
  scrollRaf: number | null;
  loadOlderArmed: boolean;
  longPressTimer: ReturnType<typeof setTimeout> | null;
  longPressTarget: LongPressTarget | null;
  menuOpenedAt: number;
};

export const state: TranscriptState = {
  ready: false,
  nearBottom: true,
  sessionKey: '',
  rows: [],
  hasMore: false,
  stream: {
    text: '',
    thinking: '',
    textHtml: '',
    thinkingHtml: '',
    toolInvoking: false,
  },
  flags: { richText: false, menuDisabled: false },
  menu: null,
  menuOverlayHandler: null,
  menuNativeTextBlockHandler: null,
  thinkingExpanded: {},
  toolGroupExpanded: {},
  attachGroupExpanded: {},
  scrollRaf: null,
  loadOlderArmed: true,
  longPressTimer: null,
  longPressTarget: null,
  menuOpenedAt: 0,
};
