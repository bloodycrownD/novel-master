/**
 * 消息附件组：样式对齐 ToolCallGroupCard（可折叠 summary + 卡片列表）。
 */
import { AttachmentChip } from '@shared/logic/chat';
import { coreT } from '@shared/logic/core-i18n';
import type { MessageAttachmentDto } from '@shared/ipc-types';

type MessageAttachmentGroupCardProps = {
    attachments: readonly MessageAttachmentDto[];
    dimmed?: boolean;
};

function sourceLabel(a: MessageAttachmentDto): string {
    if (a.source === 'workplace') {
        return coreT({key: "ui.transcript.attach_src.workspace"});
    }
    if (a.source === 'user_ops') {
        return '';
    }
    return a.type === 'dir' ? coreT({key: "ui.transcript.attach_src.dir"}) : coreT({key: "ui.transcript.attach_src.file"});
}

/**
 * 消息气泡附件文案（与 Composer 状态 chip 同口径）：
 * - workplace / user_ops / annotate → Core `AttachmentChip.formatStatusLabelFromAttachment`
 * - attach → `@${path}`（不进状态 chip，气泡仍可展示）
 */
// nm-style: keep-local — message-attachment-group-card.test 直引断言气泡文案口径（6 个调用点）；内联会破坏测试锁名。
export function formatMessageAttachmentLabel(a: MessageAttachmentDto): string {
    if (a.source === 'attach') {
        const path = a.path ?? a.name;
        return path.startsWith('@') ? path : `@${path}`;
    }
    const d = AttachmentChip.fromAttachment(a);
    return d == null ? '' : coreT(d);
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
            <summary>{coreT({key: "ui.transcript.attach_group_title", params: {count: attachments.length}})}</summary>
            <div className="chat-message__tool-group-items">
                {attachments.map((a, index) => (
                    <div
                        key={`${a.source}:${a.path ?? a.name}:${index}`}
                        className="tool-call-card tool-call-card--group-item"
                    >
                        <div className="tool-call-card__header">
                            <span className="tool-call-card__name">
                                {formatMessageAttachmentLabel(a)}
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
