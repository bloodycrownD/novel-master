/**
 * RN ↔ Web code editor bridge: typed JSON envelopes ({ v, type, payload }).
 * 四函数编解码单源在 `webview-host/typed-message-bridge.ts`。
 */
import {TypedMessageBridge} from '@/webview-host/typed-message-bridge';

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
    /**
   * primary 的低透明派生（胶囊底色 --primary-muted）。宿主算色、口径与
   * composer-input 一致（capsule/C-orch-1）：web 侧只做条件式写入，不自拼 alpha。
   * 可选——缺省不写入，由 web 侧 CSS 兜底。
   */
    readonly primaryMuted?: string;
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
type CodeEditorToHostMessage =
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

export const codeEditorBridge = TypedMessageBridge.create<HostToCodeEditorMessage, CodeEditorToHostMessage>(CODE_EDITOR_BRIDGE_VERSION, 'code-editor');
