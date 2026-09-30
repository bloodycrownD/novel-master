/**
 * composer-input 载荷与消息类型（runtime 模型）。
 *
 * 协议 v=1，信封 `{v:1, type, payload}` 对齐三域先例；
 * 本文件是 host↔web 双向消息的**全量**清单（死消息不留：不照抄 transcript 的
 * `log` / `messagePatch`）。RN 侧同形声明在 `components/chat/ComposerInputBridge.ts`，
 * 两侧 BRIDGE_V 必须一致。
 */

export const BRIDGE_V = 1;

/** 高亮分段来源（单包双模式）：chat 链 token / 宏链白名单宏。 */
export type ComposerMode = 'composer-token' | 'prompt-macro';

/**
 * 尺寸口径（RN 宿主组装下发，web 不做尺寸推断）。
 * maxHeight = null 表示不限高（当前无生产消费方——chat 全屏已改走
 * PromptEditor/CodeEditorWebView，保留为协议能力勿当死代码删），web 侧不上报 heightChange。
 */
export type ComposerMetrics = {
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly paddingH: number;
  readonly paddingV: number;
  readonly minHeight: number;
  readonly maxHeight: number | null;
};

/**
 * 主题 token（胶囊 = color: primary; background: primaryMuted）。
 * primaryMuted / selection 由宿主拼好下发，web 不做颜色计算。
 */
export type ComposerTheme = {
  readonly background: string;
  readonly text: string;
  readonly textSecondary: string;
  readonly primary: string;
  readonly primaryMuted: string;
  readonly selection: string;
};

export type ComposerSelectionPayload = {
  readonly start: number;
  readonly end: number;
};

export type InitPayload = {
  readonly mode: ComposerMode;
  /** 初始禁用态（chat 链 running/无模型/末条纯文本；宏链只读详情）。 */
  readonly disabled: boolean;
  readonly theme: ComposerTheme;
  readonly metrics: ComposerMetrics;
  readonly placeholder: string;
};

export type SetTextPayload = {
  readonly text: string;
  /** 缺省时保持内核写值后的光标位置（textarea.value 赋值后落末位）。 */
  readonly selectionStart?: number;
  readonly selectionEnd?: number;
};

/** Host → Web */
export type HostToComposerInputMessage =
  | {readonly type: 'init'; readonly payload: InitPayload}
  | {
      readonly type: 'themeUpdate';
      readonly payload: {readonly theme: ComposerTheme};
    }
  | {readonly type: 'setText'; readonly payload: SetTextPayload}
  | {readonly type: 'setSelection'; readonly payload: ComposerSelectionPayload}
  | {
      readonly type: 'setDisabled';
      readonly payload: {readonly disabled: boolean};
    }
  | {readonly type: 'blur'; readonly payload: Record<string, never>};

/** Web → Host */
export type ComposerInputToHostMessage =
  | {readonly type: 'ready'; readonly payload: {readonly version: number}}
  | {readonly type: 'change'; readonly payload: {readonly text: string}}
  | {
      readonly type: 'selectionChange';
      readonly payload: ComposerSelectionPayload;
    }
  | {readonly type: 'focus'; readonly payload: Record<string, never>}
  | {readonly type: 'blur'; readonly payload: Record<string, never>}
  | {
      readonly type: 'heightChange';
      readonly payload: {readonly height: number};
    };

export type HostToComposerInputType = HostToComposerInputMessage['type'];
export type ComposerInputToHostType = ComposerInputToHostMessage['type'];
