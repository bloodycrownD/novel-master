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
};

/** Rows sent to Web (seq ascending; Web renders forward DOM order). */
export type TranscriptRow =
  | {
      readonly kind: 'message';
      readonly id: string;
      readonly role: 'user' | 'assistant';
      readonly hidden: boolean;
      readonly text: string;
      readonly thinking: string;
      /** Turn-level tool execution phase (no per-tool cards yet). */
      readonly toolPhase?: 'executing';
      /** Embedded tool group for assistant messages with tool_use. */
      readonly tools?: readonly TranscriptToolView[];
      /** Pre-rendered assistant HTML when flags.richText (Web innerHTML). */
      readonly textHtml?: string;
      readonly thinkingHtml?: string;
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
  readonly surface: string;
  readonly borderLight: string;
};

export type TranscriptFlags = {
  readonly richText: boolean;
  readonly batchMode: boolean;
  /** When true, long-press menu is suppressed (e.g. agent running). */
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
  | BridgeEnvelope<
      'init',
      {theme: TranscriptTheme; flags: TranscriptFlags}
    >
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
      }
    >
  | BridgeEnvelope<
      'prependPage',
      {rows: readonly TranscriptRow[]; prependedCount: number}
    >
  | BridgeEnvelope<'appendTailRows', {rows: readonly TranscriptRow[]}>
  | BridgeEnvelope<
      'streamDelta',
      {
        kind: 'text' | 'thinking';
        delta?: string;
        /** Full accumulated tail HTML when flags.richText (same limits as persisted rows). */
        html?: string;
      }
    >
  | BridgeEnvelope<'streamReset', Record<string, never>>
  | BridgeEnvelope<'messagePatch', {messageId: string; patch: unknown}>
  | BridgeEnvelope<'themeUpdate', {theme: TranscriptTheme}>
  | BridgeEnvelope<'flagsUpdate', {flags: TranscriptFlags}>
  | BridgeEnvelope<'selectionUpdate', {selectedMessageIds: readonly string[]}>
  | BridgeEnvelope<'closeMenu', Record<string, never>>;

/** Transcript → host */
export const CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION = 2 as const;

export type ChatTranscriptScrollSnapshot = {
  readonly schemaVersion: typeof CHAT_TRANSCRIPT_SCROLL_SCHEMA_VERSION;
  /** Distance from visual bottom, px (forward DOM scrollTop semantics). */
  readonly offsetY: number;
  readonly nearBottom: boolean;
};

export type TranscriptToHostMessage =
  | BridgeEnvelope<'ready', {version: string}>
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
  | BridgeEnvelope<'toggleMessageSelect', {messageId: string}>
  | BridgeEnvelope<
      'messageMenuAction',
      {messageId: string; action: string}
    >
  | BridgeEnvelope<'menuOpened', Record<string, never>>
  | BridgeEnvelope<'menuClosed', Record<string, never>>
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
