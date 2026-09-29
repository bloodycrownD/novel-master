/**
 * RN ↔ Web composer 输入框桥：带类型信封 `{v, type, payload}`（对齐 vfs/CodeEditorBridge）。
 *
 * 单源约束：web 侧同形声明在 `src/web/composer-input/webview/runtime/model.ts`，
 * 两侧 BRIDGE_V 必须同为 1（`__tests__/composer-input-bridge.test.ts` 有一致性断言）。
 * decode 走抛错口径（坏信封 = JSON 坏 / v 不符 / type 缺失），由宿主 try/catch 静默丢弃。
 */
export const COMPOSER_INPUT_BRIDGE_VERSION = 1 as const;

export type BridgeEnvelope<T extends string, P> = {
  readonly v: typeof COMPOSER_INPUT_BRIDGE_VERSION;
  readonly type: T;
  readonly payload: P;
};

/** 高亮分段来源（单包双模式）：chat 链 token / 宏链白名单宏。 */
export type ComposerInputMode = 'composer-token' | 'prompt-macro';

/**
 * 尺寸口径：maxHeight = null 表示不限高（web 侧不上报 heightChange，容器 flex 全高）。
 * 当前无生产消费方（原 chat 全屏已改走 PromptEditor 编辑屏），保留为协议能力。
 */
export type ComposerInputMetrics = {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly paddingH: number;
  readonly paddingV: number;
  readonly minHeight: number;
  readonly maxHeight: number | null;
};

/**
 * 主题 token（对齐 TranscriptTheme 裁剪版）：胶囊 = primary 字 + primaryMuted 底，
 * primaryMuted 由宿主拼好下发（mobile 侧 = `${primary}22`），web 不做颜色计算。
 */
export type ComposerInputTheme = {
  readonly background: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly primary: string;
  readonly primaryMuted: string;
  readonly selection: string;
};

export type ComposerInputSelection = {
  readonly start: number;
  readonly end: number;
};

export type ComposerInputInitPayload = {
  readonly mode: ComposerInputMode;
  readonly disabled: boolean;
  readonly theme: ComposerInputTheme;
  readonly metrics: ComposerInputMetrics;
  readonly placeholder: string;
};

export type ComposerInputSetTextPayload = {
  readonly text: string;
  /** 省略时光标保持内核写值后的位置（value 赋值后落末位）。 */
  readonly selectionStart?: number;
  readonly selectionEnd?: number;
};

/** Host → composer 输入框 WebView */
export type HostToComposerInputMessage =
  | BridgeEnvelope<'init', ComposerInputInitPayload>
  | BridgeEnvelope<'themeUpdate', {theme: ComposerInputTheme}>
  | BridgeEnvelope<'setText', ComposerInputSetTextPayload>
  | BridgeEnvelope<'setSelection', ComposerInputSelection>
  | BridgeEnvelope<'setDisabled', {disabled: boolean}>
  | BridgeEnvelope<'blur', Record<string, never>>;

/** composer 输入框 WebView → host */
export type ComposerInputToHostMessage =
  | BridgeEnvelope<'ready', {version: number}>
  | BridgeEnvelope<'change', {text: string}>
  | BridgeEnvelope<'selectionChange', ComposerInputSelection>
  | BridgeEnvelope<'focus', Record<string, never>>
  | BridgeEnvelope<'blur', Record<string, never>>
  | BridgeEnvelope<'heightChange', {height: number}>;

export function encodeHostToComposerInput(
  message: HostToComposerInputMessage,
): string {
  return JSON.stringify(message);
}

export function encodeComposerInputToHost(
  message: ComposerInputToHostMessage,
): string {
  return JSON.stringify(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value);
}

export function decodeComposerInputToHost(
  raw: string,
): ComposerInputToHostMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.v !== COMPOSER_INPUT_BRIDGE_VERSION) {
    throw new Error('Invalid composer-input bridge envelope version');
  }
  if (typeof parsed.type !== 'string' || !isRecord(parsed.payload)) {
    throw new Error('Invalid composer-input bridge envelope shape');
  }
  return parsed as ComposerInputToHostMessage;
}

export function decodeHostToComposerInput(
  raw: string,
): HostToComposerInputMessage {
  const parsed: unknown = JSON.parse(raw);
  if (!isRecord(parsed) || parsed.v !== COMPOSER_INPUT_BRIDGE_VERSION) {
    throw new Error('Invalid composer-input bridge envelope version');
  }
  if (typeof parsed.type !== 'string') {
    throw new Error('Invalid composer-input bridge envelope shape');
  }
  return parsed as HostToComposerInputMessage;
}
