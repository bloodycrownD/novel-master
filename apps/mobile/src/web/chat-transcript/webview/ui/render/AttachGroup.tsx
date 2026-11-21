/**
 * 消息附件组：对齐工具组折叠交互。
 */
import type {AttachmentChip} from '../../runtime/state/state';
import type {TranscriptLabels} from '../labels';
import {Labels} from '../labels';
import {RowLogic} from '../../runtime/render/row-logic';
import {CollapsibleSection} from './CollapsibleSection';

type AttachGroupProps = {
  attachments: AttachmentChip[];
  groupKey: string;
  expanded: boolean;
  showDividerAbove: boolean;
  /** 文案（R6 波 4a：宿主下发/缺省兜底的 labels 对象；Ask 方 props 下传，不直读 state）。 */
  labels: TranscriptLabels;
};

export function AttachGroup({
  attachments,
  groupKey,
  expanded,
  showDividerAbove,
  labels,
}: AttachGroupProps) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <CollapsibleSection
      title={Labels.uiText(labels, 'ui.transcript.attach_group_title', {count: attachments.length})}
      action="toggle-attach-group"
      dataKey="attach-group-key"
      dataValue={groupKey}
      expanded={expanded}
      sectionClass="tool-group-section attach-group-section"
      dividedClass={showDividerAbove ? ' attach-group-divided-above' : ''}
    >
      {attachments.map((a, i) => {
        let src: string;
        if (a.source === 'workplace') {
          src = Labels.uiText(labels, 'ui.transcript.attach_src.workspace');
        } else if (a.source === 'user_ops') {
          src = '';
        } else {
          src = Labels.uiText(labels, a.type === 'dir' ? 'ui.transcript.attach_src.dir' : 'ui.transcript.attach_src.file');
        }
        return (
          <div key={i} className="tool-group-item tool-card attach-card">
            <div className="tool-header">
              <span className="tool-name">{RowLogic.attachmentChipLabel(a)}</span>
              {src ? <span className="tool-status success">{src}</span> : null}
            </div>
          </div>
        );
      })}
    </CollapsibleSection>
  );
}
