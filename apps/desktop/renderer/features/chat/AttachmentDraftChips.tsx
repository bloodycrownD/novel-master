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
  /** 状态条：透明行底。 */
  transparentRow?: boolean;
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

/** Chip 文案：user_ops → `action:path`；其余 `📄`/`📁` + path。 */
export function formatAttachmentChipLabel(a: MessageAttachmentDto): string {
  if (a.source === 'user_ops') {
    return a.name;
  }
  const path = a.path ?? a.name;
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
  transparentRow = false,
}: AttachmentDraftChipsProps) {
  if (attachments.length === 0) {
    return null;
  }
  return (
    <div
      className={
        transparentRow
          ? 'chat-composer__chips chat-composer__chips--status'
          : 'chat-composer__chips'
      }
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

/** 状态条（无叉）：由 Composer 放在输入框外上方。 */
export function ComposerStatusChips({
  attachments,
  disabled,
}: {
  attachments: readonly MessageAttachmentDto[];
  disabled?: boolean;
}) {
  const { status } = partitionComposerChipAttachments(attachments);
  return (
    <AttachmentDraftChips
      attachments={status}
      showRemove={false}
      disabled={disabled}
      transparentRow
      aria-label="状态附件"
    />
  );
}

/** 附件条（有叉）：放在输入框内部。 */
export function ComposerAttachChips({
  attachments,
  onRemoveAttach,
  disabled,
}: {
  attachments: readonly MessageAttachmentDto[];
  onRemoveAttach: (attachIndex: number) => void;
  disabled?: boolean;
}) {
  const { attach } = partitionComposerChipAttachments(attachments);
  return (
    <AttachmentDraftChips
      attachments={attach}
      showRemove
      disabled={disabled}
      onRemove={onRemoveAttach}
      aria-label="待发送附件"
    />
  );
}

/**
 * @deprecated 布局已拆为框外状态条 + 框内附件条；保留供旧调用兼容。
 */
export function ComposerDualAttachmentChips({
  attachments,
  onRemoveAttach,
  disabled,
}: {
  attachments: readonly MessageAttachmentDto[];
  onRemoveAttach: (attachIndex: number) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <ComposerStatusChips attachments={attachments} disabled={disabled} />
      <ComposerAttachChips
        attachments={attachments}
        onRemoveAttach={onRemoveAttach}
        disabled={disabled}
      />
    </>
  );
}
