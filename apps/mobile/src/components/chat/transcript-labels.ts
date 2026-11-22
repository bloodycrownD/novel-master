/**
 * 转录渲染层文案装配（spec §2.2.8 / C32；p27 R6 第 0 片扩 ui.* 域）：4 个
 * `label.transcript.*` key 与 webview 消费的 `ui.transcript.*` key 经 core
 * translator 取文案，随 `init.labels` 下发给 web；locale 固定 zh-CN（G6 再做
 * 切换）。纯函数，可单测。
 *
 * @module components/chat/transcript-labels
 */
import type {MessageLike} from '@novel-master/core/i18n';
import type {TranscriptLabels} from './ChatTranscriptBridge';

/** core 文案 translator（zh-CN 固定；descriptor → string）。 */
type Translator = (m: MessageLike) => string;

/**
 * webview 消费的 `ui.transcript.*` key 清单（与 core keys.ts 的 UI_MESSAGE_KEYS
 * transcript 段一致；波 3 webview 片组件接线后逐键消费）。
 */
const UI_LABEL_KEYS = [
    'ui.transcript.menu.edit',
    'ui.transcript.menu.copy',
    'ui.transcript.menu.set_floor',
    'ui.transcript.menu.fork',
    'ui.transcript.menu.rollback',
    'ui.transcript.tool_result_title',
    'ui.transcript.tool_status.success',
    'ui.transcript.tool_status.error',
    'ui.transcript.tool_status.pending',
    'ui.transcript.tool_status.interrupted',
    'ui.transcript.tool_group_title',
    'ui.transcript.open_hint',
    'ui.transcript.open_kind.subagent',
    'ui.transcript.open_kind.skill',
    'ui.transcript.open_kind.result',
    'ui.transcript.open_kind.workspace',
    'ui.transcript.role.user',
    'ui.transcript.role.assistant',
    'ui.transcript.message_actions',
    'ui.transcript.attach_group_title',
    'ui.transcript.attach_src.workspace',
    'ui.transcript.attach_src.dir',
    'ui.transcript.attach_src.file',
    // mermaid 全屏关闭（两管线共享 portal；波 3-1 第二桥随两条 init.labels 通道都下发，波 3-2 接线）。
    'ui.common.close',
    // 附件状态 chip（presentation 降级 domain/chat 后 descriptor 化；webview AttachGroup 两步渲染：
    // 先 uiText 取 action 词，再插 label.attachment.chip 模板。宿主 coreT 预渲染下发，缺省兜底见 webview labels）。
    'label.attachment.action.delete',
    'label.attachment.action.write',
    'label.attachment.action.edit',
    'label.attachment.action.mkdir',
    'label.attachment.action.rename',
    'label.attachment.action.move',
    'label.attachment.action.workplace_change',
    'label.attachment.action.annotate',
    'label.attachment.chip',
    'label.attachment.attach_ref',
] as const;

// 偏离登记：文件名主体 TranscriptLabels 与本文件 import 的类型 TranscriptLabels 撞名，
// 按 p23 XxxFactory 先例加角色后缀起名 TranscriptLabelsFactory。
export namespace TranscriptLabelsFactory {
    // nm-style: keep-public — spec C32 指定的独立装配面（宿主 init.labels 下发 + T-SP22 单测直测）；内联会把 i18n key 映射埋进 WebView 组件，测试只能绕道渲染。
    /** core 文案 translator → web 渲染层文案（四元组 + ui.* map，key 与 core catalog 一一对应）。 */
    export function build(t: Translator): TranscriptLabels {
        const ui: Record<string, string> = {};
        for (const key of UI_LABEL_KEYS) ui[key] = t({key});
        return {
            generating: t({key: 'label.transcript.generating'}),
            thinking: t({key: 'label.transcript.thinking_header'}),
            empty: t({key: 'label.transcript.empty'}),
            loadOlder: t({key: 'label.transcript.load_older'}),
            ui,
        };
    }
}
