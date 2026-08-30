/**
 * 思考过程折叠区；消毒 HTML 走 TrustedHtml，明文走 text children。
 */
import {TrustedHtml} from '@web/shared/ui/TrustedHtml';
import {CollapsibleHeader} from './CollapsibleSection';

export type ThinkingSectionProps = {
  text: unknown;
  thinkingKey: string;
  expanded: boolean;
  thinkingHtml: string | null | undefined;
  showDividerBelow: boolean;
  richText: boolean;
};

export function ThinkingSection({
  text,
  thinkingKey,
  expanded,
  thinkingHtml,
  showDividerBelow,
  richText,
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
        title="思考过程"
        action="toggle-thinking"
        dataKey="thinking-key"
        dataValue={thinkingKey}
        expanded={expanded}
      />
      {expanded ? (
        useRich ? (
          <TrustedHtml html={thinkingHtml!} className={bodyClass} />
        ) : (
          <div className={bodyClass}>{trimmed}</div>
        )
      ) : null}
    </div>
  );
}
