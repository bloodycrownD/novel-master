/**
 * Composer 状态 chip（不可叉）：workplace + user_ops（含 annotate 预览）。
 * 文件引用不再使用 attach chip（认正文 `@路径`）；userAttach 不进状态条。
 * 判定 / partition 单点：`@shared/logic/chat`。
 */
import {
  formatStatusChipLabelFromAttachment,
  partitionComposerChipAttachments,
} from '@shared/logic/chat';
import type { MessageAttachmentDto } from '@shared/ipc-types';

export type AttachmentDraftChipsProps = {
  attachments: readonly MessageAttachmentDto[];
  /**
   * 是否显示叉号。默认 `false`：Composer 唯一合法路径为无叉状态 chip
   *（workplace + user_ops）；有叉 attach 条已废止，勿再默认开启。
   */
  showRemove?: boolean;
  onRemove?: (index: number) => void;
  disabled?: boolean;
  'aria-label'?: string;
  /** 状态条：透明行底。 */
  transparentRow?: boolean;
};

/**
 * Chip 文案：中文二字 + `:` + path（Core `formatStatusChipLabelFromAttachment`）。
 */
export function formatAttachmentChipLabel(a: MessageAttachmentDto): string {
  return formatStatusChipLabelFromAttachment(a);
}

/** chip 根 class（T-UI2：目录不再带 warning 色类）。 */
export function attachmentChipClassName(): string {
  return 'chat-composer__chip';
}

export function AttachmentDraftChips({
  attachments,
  showRemove = false,
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

/** 状态 chip（无叉）：放在输入框内顶部。 */
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
