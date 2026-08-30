/**
 * chat-transcript boot 共享状态与版本常量。
 */

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
  /** 子智能体会话 id：非空时卡片可点击进入子会话只读浏览。applySnapshot 是浅引用赋值，运行时数据已挂在对象上，这里只是补类型声明。 */
  subagentSessionId?: string;
  /** skill 跳转三元组：read 由 tool_result meta 透传；write/edit 由 skill-tool-ref.ts 从 input 解析。 */
  skillRef?: SkillRefMeta;
};

/** skill 卡片跳详情三元组（与 core SkillToolRef 同形）。 */
export type SkillRefMeta = {
  domain: 'global' | 'project';
  projectId?: string;
  name: string;
};

/** 消息附件芯片。 */
export type AttachmentChip = {
  source?: string;
  type?: string;
  name?: string;
  path?: string;
  action?: string;
  content?: string | null;
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
  flags: {richText: false, menuDisabled: false},
  menu: null,
  menuOverlayHandler: null,
  menuNativeTextBlockHandler: null,
  thinkingExpanded: {},
  toolGroupExpanded: {},
  attachGroupExpanded: {},
  scrollRaf: null,
  loadOlderArmed: true,
  menuOpenedAt: 0,
};
