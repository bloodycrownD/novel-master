/**
 * P0-3：行列表刷新门面（RowLogic.render）+ 附件芯片标签辅助。
 * 行列表结构主路径在 ui/render；由 main 注册 Preact 实现。
 * 流式壳已迁 ui/stream；不再保留 renderAssistantBubbleInner 拼串。
 */
import {AttachmentChip} from '@novel-master/core/presentation/chat/attachment-chip.js';
import {createViewSlot} from '@web/shared/view-slot';

/** 行列表视图槽：由 main 注册 Preact（或其它）行列表刷新实现。 */
export const rowsViewSlot = createViewSlot<void>();

export const RowLogic = {
  /**
   * 行列表全量刷新门面：只转发已注册实现（禁止在此拼串 / preact.render）。
   */
  render: (): void => {
    rowsViewSlot.invoke();
  },

  /**
   * 附件芯片主标签（明文；无 emoji /「规则 ·」）。
   * 文案单源：core `presentation/chat/attachment-chip.ts`，本文件只传 attach 前缀口径。
   */
  // nm-style: keep-public — attachment-chip-label.test.ts / task-file-attachment-chips.test.ts 直接 import 断言文案契约，测试锁名
  attachmentChipLabel: (a: {
    source?: string;
    type?: string;
    name?: string;
    path?: string;
    action?: string;
    content?: string | null;
  }): string => {
    const attachment = {
      source: (a.source as 'workplace' | 'attach' | 'user_ops') ?? 'user_ops',
      name: a.name ?? '',
      path: a.path,
      action: a.action as
        | 'delete'
        | 'write'
        | 'edit'
        | 'mkdir'
        | 'rename'
        | 'move'
        | 'workplaceChange'
        | 'userAttach'
        | 'annotate'
        | undefined,
      content: a.content ?? null,
    };
    return AttachmentChip.formatStatusLabelFromAttachment(attachment, {attachPrefixed: true});
  },
} as const;
