/**
 * P0-3：行列表刷新门面（RowLogic.render）+ 附件芯片标签辅助。
 * 行列表结构主路径在 ui/render；由 main 注册 Preact 实现。
 * 流式壳已迁 ui/stream；不再保留 renderAssistantBubbleInner 拼串。
 */
import {AttachmentChip} from '@novel-master/core/domain/chat/presentation/attachment-chip.js';
import type {AttachmentChipDescriptor} from '@novel-master/core/domain/chat/presentation/attachment-chip.js';
import {CHIP_TEMPLATE_KEY} from '@novel-master/core/domain/chat/presentation/chip-keys.js';
import {Labels} from '../../ui/labels';
import type {TranscriptLabels} from '../../ui/labels';
import {ViewSlot} from '@web/shared/view-slot';

/** 行列表视图槽：由 main 注册 Preact（或其它）行列表刷新实现。 */
export const rowsViewSlot = ViewSlot.create<void>();

export const RowLogic = {
  /**
   * 行列表全量刷新门面：只转发已注册实现（禁止在此拼串 / preact.render）。
   */
  render: (): void => {
    rowsViewSlot.invoke();
  },

  /**
   * 附件芯片 descriptor（明文口径；文案在 core chat catalog，渲染用 Labels.uiText）。
   * 单源：core `domain/chat/presentation/attachment-chip.ts`，本文件只传 attach 前缀口径。
   */
  // nm-style: keep-public — attachment-chip-label.test.ts / task-file-attachment-chips.test.ts 直接 import 断言 descriptor 契约，测试锁名
  attachmentChipDescriptor: (a: {
    source?: string;
    type?: string;
    name?: string;
    path?: string;
    action?: string;
    content?: string | null;
  }): AttachmentChipDescriptor | null => {
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
    return AttachmentChip.fromAttachment(attachment, {attachPrefixed: true});
  },

  /**
   * chip descriptor → 明文（uiText 查宿主下发 map；嵌套 action 位先取词再插 `{action}:{path}` 模板；null = 不进 chip）。
   */
  attachmentChipText: (labels: TranscriptLabels, a: {
    source?: string;
    type?: string;
    name?: string;
    path?: string;
    action?: string;
    content?: string | null;
  }): string => {
    const d = RowLogic.attachmentChipDescriptor(a);
    if (d == null) return '';
    if (d.key === CHIP_TEMPLATE_KEY) {
      const action = (d.params ?? {})!.action as {key: string};
      return Labels.uiText(labels, d.key, {action: Labels.uiText(labels, action.key), path: String((d.params ?? {})!.path)});
    }
    return Labels.uiText(labels, d.key, d.params as Record<string, string>);
  },
} as const;
