/**
 * 消息附件组：样式对齐 ToolCallGroupCard（可折叠 summary + 卡片列表）。
 */
import type { MessageAttachmentDto } from '@shared/ipc-types';
import { formatAttachmentChipLabel } from './AttachmentDraftChips';

export type MessageAttachmentGroupCardProps = {
  attachments: readonly MessageAttachmentDto[];
  dimmed?: boolean;
};

function sourceLabel(a: MessageAttachmentDto): string {
  if (a.source === 'workplace') {
    return '工作区';
  }
  if (a.source === 'user_ops') {
    return '';
  }
  return a.type === 'dir' ? '目录' : '文件';
}

export function MessageAttachmentGroupCard({
  attachments,
  dimmed = false,
}: MessageAttachmentGroupCardProps) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <details
      className={`chat-message__tool-group chat-message__attach-group${
        dimmed ? ' chat-message__tool-group--dimmed' : ''
      }`}
    >
      <summary>消息附件 ({attachments.length})</summary>
      <div className="chat-message__tool-group-items">
        {attachments.map((a, index) => (
          <div
            key={`${a.source}:${a.path ?? a.name}:${index}`}
            className="tool-call-card tool-call-card--group-item"
          >
            <div className="tool-call-card__header">
              <span className="tool-call-card__name">
                {formatAttachmentChipLabel(a)}
              </span>
              {sourceLabel(a) ? (
                <span className="tool-call-card__status tool-call-card__status--success">
                  {sourceLabel(a)}
                </span>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
