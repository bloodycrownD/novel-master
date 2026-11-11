/**
 * 助手气泡内层：思考 / 正文 / 工具组。
 * 宿主消毒 HTML（textHtml / thinkingHtml）一律经 TrustedHtml。
 * 角色行 + ⋯ 由 MessageRow 顶行提供，不在此重复。
 * 「生成中」条只属于流式行（StreamingMessageRow），这里不再承载。
 */
import type {ToolCallRow} from '../../runtime/state/state';
import {TrustedHtml} from '@web/shared/ui/TrustedHtml';
import {ThinkingSection} from './ThinkingSection';
import {ToolGroup} from './ToolGroup';

type AssistantBubbleInnerProps = {
  text: unknown;
  textHtml: string | null | undefined;
  thinking: unknown;
  /** 折叠标题（state.labels.thinking；Ask 方负责下发，避免组件直读 state）。 */
  thinkingTitle: string;
  thinkingKey: string;
  thinkingExpanded: boolean;
  thinkingHtml: string | null | undefined;
  tools: ToolCallRow[] | null | undefined;
  toolGroupKey: string;
  toolGroupExpanded: boolean;
  richText: boolean;
};

export function AssistantBubbleInner({
  text,
  textHtml,
  thinking,
  thinkingTitle,
  thinkingKey,
  thinkingExpanded,
  thinkingHtml,
  tools,
  toolGroupKey,
  toolGroupExpanded,
  richText,
}: AssistantBubbleInnerProps) {
  const hasThinking = !!(thinking && String(thinking).trim());
  const hasTools = !!(tools && tools.length > 0);
  const hasText = !!(text && String(text).trim());
  const useRichText = !!(richText && textHtml);

  return (
    <>
      {hasThinking ? (
        <ThinkingSection
          text={thinking}
          title={thinkingTitle}
          thinkingKey={thinkingKey}
          expanded={thinkingExpanded}
          thinkingHtml={thinkingHtml}
          showDividerBelow={hasText || hasTools}
          richText={richText}
        />
      ) : null}
      {hasText ? (
        useRichText ? (
          <TrustedHtml html={textHtml!} className="bubble-body rich" />
        ) : (
          <div className="bubble-body">{String(text)}</div>
        )
      ) : hasThinking ? (
        // WHY: 仅有 thinking、正文为空时预置空壳，供后续 text 增量挂载。
        <div
          className={'bubble-body' + (useRichText ? ' rich' : '')}
          data-text-shell="1"
        />
      ) : null}
      {hasTools ? (
        <ToolGroup
          tools={tools!}
          groupKey={toolGroupKey}
          expanded={toolGroupExpanded}
          showDividerBelow={false}
        />
      ) : null}
    </>
  );
}
