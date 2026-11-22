/**
 * Composer 状态 chip（不可叉）：workplace + user_ops（含 annotate 预览）。
 * 文件引用不再使用 attach chip（认正文 `@路径`）；userAttach 不进状态条。
 * 判定 / partition 单点：`@shared/logic/chat`。
 */
import { AttachmentChip, composerChips } from '@shared/logic/chat';
import { coreT } from '@shared/logic/core-i18n';
import type { MessageAttachmentDto } from '@shared/ipc-types';

type AttachmentDraftChipsProps = {
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
 * Chip 明文（core descriptor 经 coreT 渲染；文案在 chat catalog，zh 逐字同旧口径）。
 */
// nm-style: keep-local — attachment-draft-chips.test 直引断言文案口径（10 个调用点）；内联会破坏测试锁名。
export function formatAttachmentChipLabel(a: MessageAttachmentDto): string {
    const d = AttachmentChip.fromAttachment(a);
    return d == null ? '' : coreT(d);
}

/** chip 根 class（T-UI2：目录不再带 warning 色类）。 */
// nm-style: keep-local — attachment-draft-chips.test 直引断言 chip 根 class；内联会破坏测试锁名。
export function attachmentChipClassName(): string {
    return 'chat-composer__chip';
}

function AttachmentDraftChips({
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
            aria-label={ariaLabel ?? (showRemove ? coreT({key: "ui.chat.attachment_draft_aria"}) : coreT({key: "ui.chat.attachment_status_aria"}))}
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
                                aria-label={coreT({key: "ui.chat.remove_attachment_aria", params: {label}})}
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
    const { status } = composerChips.partition(attachments);
    return (
        <AttachmentDraftChips
            attachments={status}
            showRemove={false}
            disabled={disabled}
            transparentRow
            aria-label={coreT({key: "ui.chat.attachment_status_aria"})}
        />
    );
}
