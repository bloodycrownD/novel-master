/**
 * Composer chip 双条：上条状态（无叉）、下条附件（有叉）。
 */
import type { MessageAttachmentDto } from '@shared/ipc-types';

export type AttachmentDraftChipsProps = {
  attachments: readonly MessageAttachmentDto[];
  /** false = 状态条（无叉）；true = 附件条（有叉）。 */
  showRemove?: boolean;
  onRemove?: (index: number) => void;
  disabled?: boolean;
  'aria-label'?: string;
};

/** 是否为状态条附件（workplace / user_ops）。 */
export function isComposerStatusAttachment(a: MessageAttachmentDto): boolean {
  return a.source === 'workplace' || a.source === 'user_ops';
}

/** 拆成上条（状态）/ 下条（attach）。 */
export function partitionComposerChipAttachments(
  attachments: readonly MessageAttachmentDto[],
): {
  readonly status: MessageAttachmentDto[];
  readonly attach: MessageAttachmentDto[];
} {
  const status: MessageAttachmentDto[] = [];
  const attach: MessageAttachmentDto[] = [];
  for (const a of attachments) {
    if (isComposerStatusAttachment(a)) {
      status.push(a);
    } else if (a.source === 'attach') {
      attach.push(a);
    }
  }
  return { status, attach };
}

/** Chip 文案：`📄` / `📁` / `✏️` + path（无多余空格）。 */
export function formatAttachmentChipLabel(a: MessageAttachmentDto): string {
  const path = a.path ?? a.name;
  if (a.source === 'user_ops') {
    return `✏️${path}`;
  }
  if (a.type === 'dir') {
    return `📁${path}`;
  }
  return `📄${path}`;
}

/** chip 根 class（T-UI2：目录不再带 warning 色类）。 */
export function attachmentChipClassName(): string {
  return 'chat-composer__chip';
}

export function AttachmentDraftChips({
  attachments,
  showRemove = true,
  onRemove,
  disabled,
  'aria-label': ariaLabel,
}: AttachmentDraftChipsProps) {
  if (attachments.length === 0) {
    return null;
  }
  return (
    <div
      className="chat-composer__chips"
      role="list"
      aria-label={ariaLabel ?? (showRemove ? '待发送附件' : '状态附件')}
    >
      {attachments.map((a, index) => {
        const label = formatAttachmentChipLabel(a);
        return (
          <div
            key={`${a.source}:${a.path ?? a.name}:${index}`}
            className={attachmentChipClassName()}
            role="listitem"
          >
            <span className="chat-composer__chip-label" title={label}>
              {label}
            </span>
            {showRemove ? (
              <button
                type="button"
                className="chat-composer__chip-remove"
                aria-label={`移除 ${label}`}
                disabled={disabled}
                onClick={() => onRemove?.(index)}
              >
                ×
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** 双条：上状态（无叉）/ 下 attach（有叉）；空行不渲染。 */
export function ComposerDualAttachmentChips({
  attachments,
  onRemoveAttach,
  disabled,
}: {
  attachments: readonly MessageAttachmentDto[];
  onRemoveAttach: (attachIndex: number) => void;
  disabled?: boolean;
}) {
  const { status, attach } = partitionComposerChipAttachments(attachments);
  return (
    <>
      <AttachmentDraftChips
        attachments={status}
        showRemove={false}
        disabled={disabled}
        aria-label="状态附件"
      />
      <AttachmentDraftChips
        attachments={attach}
        showRemove
        disabled={disabled}
        onRemove={onRemoveAttach}
        aria-label="待发送附件"
      />
    </>
  );
}
