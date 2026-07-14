/**
 * Composer 附件草稿 chip 横滑行。
 */
import type { MessageAttachmentDto } from '@shared/ipc-types';

export type AttachmentDraftChipsProps = {
  attachments: readonly MessageAttachmentDto[];
  onRemove: (index: number) => void;
  disabled?: boolean;
};

function chipLabel(a: MessageAttachmentDto): string {
  if (a.source === 'user_ops') {
    return a.name || '用户操作';
  }
  const prefix =
    a.source === 'workplace' ? '工作区' : a.type === 'dir' ? '目录' : '@';
  return `${prefix} ${a.path ?? a.name}`;
}

export function AttachmentDraftChips({
  attachments,
  onRemove,
  disabled,
}: AttachmentDraftChipsProps) {
  if (attachments.length === 0) {
    return null;
  }
  return (
    <div className="chat-composer__chips" role="list" aria-label="待发送附件">
      {attachments.map((a, index) => (
        <div
          key={`${a.source}:${a.path ?? a.name}:${index}`}
          className="chat-composer__chip"
          role="listitem"
        >
          <span className="chat-composer__chip-label" title={chipLabel(a)}>
            {chipLabel(a)}
          </span>
          <button
            type="button"
            className="chat-composer__chip-remove"
            aria-label={`移除 ${chipLabel(a)}`}
            disabled={disabled}
            onClick={() => onRemove(index)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
