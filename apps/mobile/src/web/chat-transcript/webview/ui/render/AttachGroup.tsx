/**
 * 消息附件组：对齐工具组折叠交互。
 */
import type { AttachmentChip } from '../../runtime/state/state';
import {
  attachmentChipLabel,
  attachmentSourceLabel,
} from '../../runtime/render/row-logic';

export type AttachGroupProps = {
  attachments: AttachmentChip[];
  groupKey: string;
  expanded: boolean;
  showDividerAbove: boolean;
};

export function AttachGroup({
  attachments,
  groupKey,
  expanded,
  showDividerAbove,
}: AttachGroupProps) {
  if (!attachments || attachments.length === 0) return null;
  const chevron = expanded ? '▼' : '▶';
  const divided = showDividerAbove ? ' attach-group-divided-above' : '';
  return (
    <div
      className={
        'tool-group-section attach-group-section' + divided
      }
      data-attach-group-key={groupKey}
    >
      <div
        className="tool-group-header"
        data-action="toggle-attach-group"
        data-attach-group-key={groupKey}
      >
        <span className="tool-group-title">
          {'消息附件 (' + attachments.length + ')'}
        </span>
        <span className="tool-group-chevron">{chevron}</span>
      </div>
      {expanded ? (
        <div className="tool-group-items">
          {attachments.map((a, i) => {
            const src = attachmentSourceLabel(a);
            return (
              <div
                key={i}
                className="tool-group-item tool-card attach-card"
              >
                <div className="tool-header">
                  <span className="tool-name">{attachmentChipLabel(a)}</span>
                  {src ? (
                    <span className="tool-status success">{src}</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
