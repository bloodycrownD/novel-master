/**
 * Composer 附件草稿 chip 横滑行。
 */
import type { MessageAttachmentDto } from '@shared/ipc-types';

export type AttachmentDraftChipsProps = {
  attachments: readonly MessageAttachmentDto[];
  onRemove: (index: number) => void;
  disabled?: boolean;
};

/** 目录 chip（非 workplace）文案：`@${path}`（@ 与 path 无空格）。文件保持 `@ ${path}`。 */
export function formatAttachmentChipLabel(a: MessageAttachmentDto): string {
  if (a.source === 'user_ops') {
    return a.name || '用户操作';
  }
  if (a.source === 'workplace') {
    return `工作区 ${a.path ?? a.name}`;
  }
  if (a.type === 'dir') {
    return `@${a.path ?? a.name}`;
  }
  return `@ ${a.path ?? a.name}`;
}

function isDirAttachChip(a: MessageAttachmentDto): boolean {
  return a.source !== 'workplace' && a.source !== 'user_ops' && a.type === 'dir';
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
      {attachments.map((a, index) => {
        const label = formatAttachmentChipLabel(a);
        const dirChip = isDirAttachChip(a);
        return (
          <div
            key={`${a.source}:${a.path ?? a.name}:${index}`}
            className={`chat-composer__chip${dirChip ? ' chat-composer__chip--dir' : ''}`}
            role="listitem"
          >
            <span className="chat-composer__chip-label" title={label}>
              {label}
            </span>
            <button
              type="button"
              className="chat-composer__chip-remove"
              aria-label={`移除 ${label}`}
              disabled={disabled}
              onClick={() => onRemove(index)}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
