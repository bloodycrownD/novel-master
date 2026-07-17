/**
 * 思考过程折叠区；消毒 HTML 走 TrustedHtml，明文走 text children。
 */
import { h } from 'preact';
import { TrustedHtml } from '@web/shared/ui/TrustedHtml';

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
  const chevron = expanded ? '▼' : '▶';
  let bodyClass = 'thinking-body' + (useRich ? ' rich' : '');
  if (expanded && showDividerBelow) {
    bodyClass += ' thinking-body-divided';
  }
  return (
    <div className="thinking-section" data-thinking-key={thinkingKey}>
      <div
        className="thinking-header"
        data-action="toggle-thinking"
        data-thinking-key={thinkingKey}
      >
        <span className="thinking-title">思考过程</span>
        <span className="thinking-chevron">{chevron}</span>
      </div>
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
