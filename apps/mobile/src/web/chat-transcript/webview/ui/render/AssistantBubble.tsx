/**
 * 助手气泡内层：思考 / 正文 / 生成中条 / 工具组。
 * 宿主消毒 HTML（textHtml / thinkingHtml）一律经 TrustedHtml。
 */
import type { ComponentChildren } from 'preact';
import type { ToolCallRow } from '../../runtime/state/state';
import { TrustedHtml } from '@web/shared/ui/TrustedHtml';
import { ThinkingSection } from './ThinkingSection';
import { ToolInvokingBar } from './ToolInvokingBar';
import { ToolGroup } from './ToolGroup';

export type AssistantBubbleInnerProps = {
  text: unknown;
  textHtml: string | null | undefined;
  thinking: unknown;
  thinkingKey: string;
  thinkingExpanded: boolean;
  thinkingHtml: string | null | undefined;
  tools: ToolCallRow[] | null | undefined;
  toolGroupKey: string;
  toolGroupExpanded: boolean;
  showToolInvoking: boolean;
  richText: boolean;
};

export function AssistantBubbleInner({
  text,
  textHtml,
  thinking,
  thinkingKey,
  thinkingExpanded,
  thinkingHtml,
  tools,
  toolGroupKey,
  toolGroupExpanded,
  showToolInvoking,
  richText,
}: AssistantBubbleInnerProps) {
  const hasThinking = !!(thinking && String(thinking).trim());
  const hasTools = !!(tools && tools.length > 0);
  const hasInvoking = !!showToolInvoking;
  const hasText = !!(text && String(text).trim());
  const useRichText = !!(richText && textHtml);

  const children: ComponentChildren[] = [];
  if (hasThinking) {
    children.push(
      <ThinkingSection
        text={thinking}
        thinkingKey={thinkingKey}
        expanded={thinkingExpanded}
        thinkingHtml={thinkingHtml}
        showDividerBelow={hasText || hasTools || hasInvoking}
        richText={richText}
      />,
    );
  }
  if (hasText) {
    children.push(
      useRichText ? (
        <TrustedHtml html={textHtml!} className="bubble-body rich" />
      ) : (
        <div className="bubble-body">{String(text)}</div>
      ),
    );
  } else if (hasThinking) {
    // WHY: 仅有 thinking、正文为空时预置空壳，供后续 text 增量挂载。
    children.push(
      <div
        className={'bubble-body' + (richText && textHtml ? ' rich' : '')}
        data-text-shell="1"
      />,
    );
  }
  if (hasInvoking) {
    children.push(<ToolInvokingBar />);
  }
  if (hasTools) {
    children.push(
      <ToolGroup
        tools={tools!}
        groupKey={toolGroupKey}
        expanded={toolGroupExpanded}
        showDividerBelow={false}
      />,
    );
  }
  return children;
}
