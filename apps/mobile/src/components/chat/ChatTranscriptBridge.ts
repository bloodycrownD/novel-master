/**
 * RN ↔ Web transcript bridge: typed JSON envelopes ({ v, type, payload }).
 * Single source of truth for postMessage payloads — no ad-hoc strings.
 */
export const CHAT_TRANSCRIPT_BRIDGE_VERSION = 1 as const;

export type BridgeEnvelope<T extends string, P> = {
  readonly v: typeof CHAT_TRANSCRIPT_BRIDGE_VERSION;
  readonly type: T;
  readonly payload: P;
};

export type TranscriptToolView = {
  readonly toolUseId: string;
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly status: string;
  readonly resultContent?: string;
  readonly summary?: string;
  /** task 工具的子会话跳转 id（对称 vfs 工具卡片的可点路径）。 */
  readonly subagentSessionId?: string;
  /** skill 跳转三元组（read 由 tool_result meta 透传；write/edit 由 Web 侧从 input 解析）。 */
  readonly skillRef?: TranscriptSkillRef;
};

/** skill 卡片跳详情三元组（与 core SkillToolRef 同形，桥接层独立声明避免拉入 core 类型）。 */
export type TranscriptSkillRef = {
  readonly domain: 'global' | 'project';
  readonly projectId?: string;
  readonly name: string;
};

/** Rows sent to Web (seq ascending; Web renders forward DOM order). */
export type TranscriptAttachmentView = {
  readonly source: 'workplace' | 'attach' | 'user_ops';
  readonly type: 'text' | 'image' | 'dir';
  readonly name: string;
  readonly path: string;
  /** 结构化 action（中文 chip 真源）；缺省时 Web 侧按 name 降级。 */
  readonly action?:
    | 'delete'
    | 'write'
    | 'edit'
    | 'mkdir'
    | 'rename'
    | 'move'
    | 'workplaceChange'
    | 'userAttach'
    | 'annotate'
    | 'skillAttach';
  readonly content?: string | null;
};

export type TranscriptRow =
  | {
      readonly kind: 'message';
      readonly id: string;
      readonly role: 'user' | 'assistant';
      readonly hidden: boolean;
      readonly text: string;
      readonly thinking: string;
      /** Embedded tool group for assistant messages with tool_use. */
      readonly tools?: readonly TranscriptToolView[];
      /** Pre-rendered assistant HTML when flags.richText (Web innerHTML). */
      readonly textHtml?: string;
      readonly thinkingHtml?: string;
      /** user 消息附件摘要（展开为工具调用风格卡片）。 */
      readonly attachments?: readonly TranscriptAttachmentView[];
    }
  | {
      readonly kind: 'stream';
      readonly text: string;
      readonly thinking: string;
    };

export type TranscriptTheme = {
  readonly background: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly primary: string;
  readonly danger: string;
  readonly surface: string;
  readonly borderLight: string;
};

export type TranscriptFlags = {
  readonly richText: boolean;
  /** When true, message action menu (⋯) is suppressed (e.g. agent running). */
  readonly menuDisabled?: boolean;
};

export type TranscriptStreamState = {
  readonly text: string;
  readonly thinking: string;
};

export type TranscriptScrollIntent = 'stick' | 'restore' | 'preserve';

export type TranscriptRestoreScroll = {
  readonly offsetY: number;
  readonly nearBottom: boolean;
};

/** Host → transcript */
export type HostToTranscriptMessage =
  | BridgeEnvelope<'init', {theme: TranscriptTheme; flags: TranscriptFlags}>
  | BridgeEnvelope<
      'sessionSnapshot',
      {
        sessionKey: string;
        rows: readonly TranscriptRow[];
        hasMore: boolean;
        /** @deprecated Stream tail is owned by streamDelta/streamReset only. */
        stream?: TranscriptStreamState;
        scrollIntent: TranscriptScrollIntent;
        restoreScroll?: TranscriptRestoreScroll;
        /** RN 侧 uiRunning 时携带，applySnapshot 后重同步 generating DOM。 */
        generating?: boolean;
      }
    >
  | BridgeEnvelope<
      'prependPage',
      {rows: readonly TranscriptRow[]; prependedCount: number}
    >
  | BridgeEnvelope<'appendTailRows', {rows: readonly TranscriptRow[]}>
  | BridgeEnvelope<
      'streamCommit',
      {
        rows: readonly TranscriptRow[];
        scrollIntent?: 'preserve' | 'none';
      }
    >
  | BridgeEnvelope<
      'streamDelta',
      {
        kind: 'text' | 'thinking';
        delta?: string;
        /** Full accumulated tail HTML when flags.richText (same limits as persisted rows). */
        html?: string;
      }
    >
  | BridgeEnvelope<
      'streamBatch',
      {
        segments: readonly {
          kind: 'text' | 'thinking';
          delta: string;
        }[];
        textHtml?: string;
        thinkingHtml?: string;
      }
    >
  | BridgeEnvelope<'streamReset', Record<string, never>>
  | BridgeEnvelope<'streamToolInvoking', {active: boolean}>
  | BridgeEnvelope<'messagePatch', {messageId: string; patch: unknown}>
  | BridgeEnvelope<'themeUpdate', {theme: TranscriptTheme}>
  | BridgeEnvelope<'flagsUpdate', {flags: TranscriptFlags}>
  | BridgeEnvelope<'closeMenu', Record<string, never>>
  /** Android 返回键：RN 拦截后下发，关闭 mermaid 全屏查看器。 */
  | BridgeEnvelope<'closeMermaidViewer', Record<string, never>>
  /** 键盘抬高输入框后：若当前贴底则重新 stick，避免最后几条被挡在输入框下。 */
  | BridgeEnvelope<'stickIfNearBottom', Record<string, never>>;

/** Transcript → host */
import {
  CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION,
  type ChatTranscriptScrollSnapshot,
} from '../../services/chat-transcript-scroll-cache';

export {CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION} from '../../services/chat-transcript-scroll-cache';
export type {ChatTranscriptScrollSnapshot} from '../../services/chat-transcript-scroll-cache';

export type TranscriptToHostMessage =
  | BridgeEnvelope<'ready', {version: string; readyState?: string}>
  | BridgeEnvelope<
      'scrollSnapshot',
      ChatTranscriptScrollSnapshot & {
        scrollHeight: number;
        clientHeight: number;
      }
    >
  | BridgeEnvelope<'loadOlder', Record<string, never>>
  | BridgeEnvelope<
      'openMessageMenu',
      {messageId: string; pageX: number; pageY: number}
    >
  | BridgeEnvelope<'openToolFile', {path: string}>
  | BridgeEnvelope<'openSubagentSession', {sessionId: string}>
  | BridgeEnvelope<
      'openSkillDetail',
      {
        domain: 'global' | 'project';
        projectId?: string;
        name: string;
      }
    >
  | BridgeEnvelope<'messageMenuAction', {messageId: string; action: string}>
  | BridgeEnvelope<'menuOpened', Record<string, never>>
  | BridgeEnvelope<'menuClosed', Record<string, never>>
  /** mermaid 全屏查看器开（点击图表进全屏；RN 侧登记返回键拦截态）。 */
  | BridgeEnvelope<'mermaidViewerOpened', Record<string, never>>
  /** mermaid 全屏查看器关（点空白/关闭按钮/返回键；RN 侧复位拦截态）。 */
  | BridgeEnvelope<'mermaidViewerClosed', Record<string, never>>
  /** 代码块复制按钮：webview 收集的源码文本，RN 侧原生 Clipboard 落盘。 */
  | BridgeEnvelope<'copyCode', {code: string}>
  | BridgeEnvelope<
      'log',
      {level: string; message: string; fields?: Record<string, unknown>}
    >;

export type HostToTranscriptType = HostToTranscriptMessage['type'];
export type TranscriptToHostType = TranscriptToHostMessage['type'];

export function encodeHostToTranscript(
  message: HostToTranscriptMessage,
): string {
  return JSON.stringify(message);
}

export function encodeTranscriptToHost(
  message: TranscriptToHostMessage,
): string {
  return JSON.stringify(message);
}

export function decodeTranscriptToHost(raw: string): TranscriptToHostMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.v !== CHAT_TRANSCRIPT_BRIDGE_VERSION) {
    throw new Error('Invalid transcript bridge envelope version');
  }
  if (typeof parsed.type !== 'string' || !isRecord(parsed.payload)) {
    throw new Error('Invalid transcript bridge envelope shape');
  }
  return parsed as TranscriptToHostMessage;
}

export function decodeHostToTranscript(raw: string): HostToTranscriptMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.v !== CHAT_TRANSCRIPT_BRIDGE_VERSION) {
    throw new Error('Invalid transcript bridge envelope version');
  }
  if (typeof parsed.type !== 'string') {
    throw new Error('Invalid transcript bridge envelope shape');
  }
  return parsed as HostToTranscriptMessage;
}

export function parseScrollSnapshotFromHost(
  message: TranscriptToHostMessage,
): ChatTranscriptScrollSnapshot | null {
  if (message.type !== 'scrollSnapshot') {
    return null;
  }
  const {schemaVersion, offsetY, nearBottom} = message.payload;
  if (schemaVersion !== CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION) {
    return null;
  }
  return {schemaVersion, offsetY, nearBottom};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}
