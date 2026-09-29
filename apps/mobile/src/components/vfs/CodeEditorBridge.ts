/**
 * RN ↔ Web code editor bridge: typed JSON envelopes ({ v, type, payload }).
 */
export const CODE_EDITOR_BRIDGE_VERSION = 1 as const;

export type BridgeEnvelope<T extends string, P> = {
  readonly v: typeof CODE_EDITOR_BRIDGE_VERSION;
  readonly type: T;
  readonly payload: P;
};

export type CodeEditorTheme = {
  readonly background: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly primary: string;
  readonly surface: string;
  readonly borderLight: string;
};

/** Host → code editor WebView */
export type HostToCodeEditorMessage =
  | BridgeEnvelope<'init', {theme: CodeEditorTheme}>
  | BridgeEnvelope<'themeUpdate', {theme: CodeEditorTheme}>
  | BridgeEnvelope<
      'setDocument',
      {
        text: string;
        path: string;
        /** 外部受控选区（token 插入等程序化写入的光标一次落位）。 */
        selectionStart?: number;
        selectionEnd?: number;
      }
    >
  | BridgeEnvelope<'blur', Record<string, never>>;

/** Code editor WebView → host */
export type CodeEditorToHostMessage =
  | BridgeEnvelope<'ready', {version: number}>
  | BridgeEnvelope<'change', {text: string}>
  /** 光标/选区上报（typeahead 的活跃查询判定在 RN 侧）。 */
  | BridgeEnvelope<'selectionChange', {start: number; end: number}>
  | BridgeEnvelope<'focus', Record<string, never>>
  | BridgeEnvelope<'blur', Record<string, never>>;

/** 编辑器上报的选区（plain 文本偏移，与 change 的 text 同一坐标系）。 */
export type CodeEditorSelection = {
  readonly start: number;
  readonly end: number;
};

export function encodeHostToCodeEditor(
  message: HostToCodeEditorMessage,
): string {
  return JSON.stringify(message);
}

export function encodeCodeEditorToHost(
  message: CodeEditorToHostMessage,
): string {
  return JSON.stringify(message);
}

export function decodeCodeEditorToHost(raw: string): CodeEditorToHostMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid code-editor bridge envelope shape');
  }
  const record = parsed as Record<string, unknown>;
  if (record.v !== CODE_EDITOR_BRIDGE_VERSION) {
    throw new Error('Invalid code-editor bridge envelope version');
  }
  if (typeof record.type !== 'string' || typeof record.payload !== 'object') {
    throw new Error('Invalid code-editor bridge envelope shape');
  }
  return parsed as CodeEditorToHostMessage;
}

export function decodeHostToCodeEditor(raw: string): HostToCodeEditorMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid code-editor bridge envelope shape');
  }
  const record = parsed as Record<string, unknown>;
  if (record.v !== CODE_EDITOR_BRIDGE_VERSION) {
    throw new Error('Invalid code-editor bridge envelope version');
  }
  if (typeof record.type !== 'string') {
    throw new Error('Invalid code-editor bridge envelope shape');
  }
  return parsed as HostToCodeEditorMessage;
}
