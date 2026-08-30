/**
 * 消息附件组：对齐工具组折叠交互。
 */
import type {AttachmentChip} from '../../runtime/state/state';
import {
  attachmentChipLabel,
  attachmentSourceLabel,
} from '../../runtime/render/row-logic';
import {CollapsibleSection} from './CollapsibleSection';

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
  return (
    <CollapsibleSection
      title={'消息附件 (' + attachments.length + ')'}
      action="toggle-attach-group"
      dataKey="attach-group-key"
      dataValue={groupKey}
      expanded={expanded}
      sectionClass="tool-group-section attach-group-section"
      dividedClass={showDividerAbove ? ' attach-group-divided-above' : ''}
    >
      {attachments.map((a, i) => {
        const src = attachmentSourceLabel(a);
        return (
          <div key={i} className="tool-group-item tool-card attach-card">
            <div className="tool-header">
              <span className="tool-name">{attachmentChipLabel(a)}</span>
              {src ? <span className="tool-status success">{src}</span> : null}
            </div>
          </div>
        );
      })}
    </CollapsibleSection>
  );
}
