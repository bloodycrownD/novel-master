/**
 * rich-document 渲染层文案装配（p27 R6 波 3-1 第二桥）：rich-document 管线消费
 * 的 `ui.*` key 经 core translator 取文案，随 `init.labels` 下发给 web；locale
 * 固定 zh-CN（G6 再做切换）。纯函数，可单测。
 *
 * @module components/vfs/rich-document-labels
 */
import type {MessageLike} from '@novel-master/core/i18n';
import type {RichDocumentLabels} from './RichDocumentBridge';

/** core 文案 translator（zh-CN 固定；descriptor → string）。 */
type Translator = (m: MessageLike) => string;

/**
 * rich-document 管线消费的 `ui.*` key 清单：over-limit 提示（document-model 的
 * OVER_LIMIT_HINT 同文，r6-exemptions 桥接面盘点的 2 处未立键之一）+ 两管线
 * 共享的 mermaid 全屏关闭按钮（另一处；chat-transcript 通道亦携带同键）。
 */
const RICH_DOCUMENT_LABEL_KEYS = [
    'ui.rich_document.over_limit_hint',
    'ui.common.close',
] as const;

// nm-style: keep-public — 第二桥指定的独立装配面（宿主 init.labels 下发）；内联会把 i18n key 映射埋进 WebView 组件。
/** core 文案 translator → web 渲染层文案（ui.* map，key 与 core catalog 一一对应）。 */
export namespace RichDocumentLabelsFactory {
    export function build(t: Translator): RichDocumentLabels {
        const ui: Record<string, string> = {};
        for (const key of RICH_DOCUMENT_LABEL_KEYS) ui[key] = t({key});
        return {ui};
    }
}
