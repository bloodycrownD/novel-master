/**
 * 转录渲染层文案装配（spec §2.2.8 / C32）：4 个 `label.transcript.*` key 经
 * core translator 取文案，随 `init.labels` 下发给 web；locale 固定 zh-CN
 * （G6 再做切换）。纯函数，可单测。
 *
 * @module components/chat/transcript-labels
 */
import type {MessageLike} from '@novel-master/core/i18n';
import type {TranscriptLabels} from './ChatTranscriptBridge';

/** core 文案 translator（zh-CN 固定；descriptor → string）。 */
type Translator = (m: MessageLike) => string;

// nm-style: keep-public — spec C32 指定的独立装配面（宿主 init.labels 下发 + T-SP22 单测直测）；内联会把 i18n key 映射埋进 WebView 组件，测试只能绕道渲染。
/** core 文案 translator → web 渲染层文案四元组（key 与 `label.transcript.*` 一一对应）。 */
export function buildTranscriptLabels(t: Translator): TranscriptLabels {
  return {
    generating: t({key: 'label.transcript.generating'}),
    thinking: t({key: 'label.transcript.thinking_header'}),
    empty: t({key: 'label.transcript.empty'}),
    loadOlder: t({key: 'label.transcript.load_older'}),
  };
}
