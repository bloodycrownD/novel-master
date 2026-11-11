/**
 * 思考过程折叠区；消毒 HTML 走 TrustedHtml，明文走 text children。
 *
 * 标题由调用方下发（`state.labels.thinking`）：普通历史行与流式起源行同源，
 * 避免同屏两种文案（P2-9）。
 *
 * `renderBody` 供流式行注入命令式 body 岛（`StreamBodyHost`，sCU=false）；
 * 缺省走静态 body。class 派生（rich / thinking-body-divided）、折叠键与 header
 * 只此一处，避免流式行手搭第二份等价面。
 */
import type {ComponentChildren} from 'preact';
import {TrustedHtml} from '@web/shared/ui/TrustedHtml';
import {CollapsibleHeader} from './CollapsibleSection';

type ThinkingSectionProps = {
  text: unknown;
  /** 折叠标题（读 state.labels.thinking，普通行/流式行同源）。 */
  title: string;
  thinkingKey: string;
  expanded: boolean;
  thinkingHtml: string | null | undefined;
  showDividerBelow: boolean;
  richText: boolean;
  /** 流式行用：body 交给 StreamBodyHost 保护增量 DOM；缺省走 TrustedHtml/纯文本。 */
  renderBody?: (bodyClass: string, useRich: boolean) => ComponentChildren;
};

export function ThinkingSection({
  text,
  title,
  thinkingKey,
  expanded,
  thinkingHtml,
  showDividerBelow,
  richText,
  renderBody,
}: ThinkingSectionProps) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  const useRich = !!(richText && thinkingHtml);
  let bodyClass = 'thinking-body' + (useRich ? ' rich' : '');
  if (expanded && showDividerBelow) {
    bodyClass += ' thinking-body-divided';
  }
  return (
    <div className="thinking-section" data-thinking-key={thinkingKey}>
      <CollapsibleHeader
        headerClass="thinking-header"
        title={title}
        action="toggle-thinking"
        dataKey="thinking-key"
        dataValue={thinkingKey}
        expanded={expanded}
      />
      {expanded ? (
        renderBody != null ? (
          renderBody(bodyClass, useRich)
        ) : useRich ? (
          <TrustedHtml html={thinkingHtml!} className={bodyClass} />
        ) : (
          <div className={bodyClass}>{trimmed}</div>
        )
      ) : null}
    </div>
  );
}
