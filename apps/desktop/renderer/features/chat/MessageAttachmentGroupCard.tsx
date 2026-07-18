/**
 * 消息附件组：样式对齐 ToolCallGroupCard（可折叠 summary + 卡片列表）。
 */
import type { MessageAttachmentDto } from '@shared/ipc-types';

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

/**
 * 消息气泡附件文案（与 Composer chip 分工不同）：
 * - workplace → `规则 · ${path}`
 * - user_ops → `改稿 · ${name}`
 * - attach → `@${path}`（禁止落入「规则 ·」）
 */
export function formatMessageAttachmentLabel(a: MessageAttachmentDto): string {
  if (a.source === 'user_ops') {
    return `改稿 · ${a.name}`;
  }
  if (a.source === 'workplace') {
    const path = a.path ?? a.name;
    if (a.type === 'dir') {
      const dirPath = path.endsWith('/') ? path : `${path}/`;
      return `规则 · ${dirPath}`;
    }
    return `规则 · ${path}`;
  }
  const path = a.path ?? a.name;
  return path.startsWith('@') ? path : `@${path}`;
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
