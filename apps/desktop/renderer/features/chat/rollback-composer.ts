import {
  isComposerStatusAttachment,
  type RollbackMode,
} from '@shared/logic/chat';
import type { MessageAttachmentDto } from '@shared/ipc-types';

export type ComposerDraftSnapshot = {
  readonly text: string;
  readonly attachments: readonly MessageAttachmentDto[];
};

/** 回填仅保留状态投影；文件引用认正文 `@路径`，不再恢复 attach chip。 */
function statusOnly(
  attachments: readonly MessageAttachmentDto[],
): MessageAttachmentDto[] {
  return attachments.filter(isComposerStatusAttachment);
}

/**
 * undo_send：恢复锚点原文（含 `@路径`）；attachments 仅状态投影位（通常由 kkv 清空后重投影填充）。
 * rewind：保留当前正文，剥掉文件引用 attach chip。
 */
export function resolveComposerDraftAfterRollbackSuccess(
  current: ComposerDraftSnapshot,
  rollbackMode: RollbackMode,
  restore: {
    readonly text: string | null;
    readonly attachments: readonly MessageAttachmentDto[] | null | undefined;
  },
): ComposerDraftSnapshot {
  if (rollbackMode === 'undo_send' && restore.text != null) {
    return {
      text: restore.text,
      // 不恢复消息上的 attach chip；状态由投影接管
      attachments: [],
    };
  }
  return {
    text: current.text,
    attachments: statusOnly(current.attachments),
  };
}

/** @deprecated 使用 {@link resolveComposerDraftAfterRollbackSuccess} */
export function resolveComposerTextAfterRollbackSuccess(
  currentComposerText: string,
  rollbackMode: RollbackMode,
  restoreText: string | null,
): string {
  return resolveComposerDraftAfterRollbackSuccess(
    { text: currentComposerText, attachments: [] },
    rollbackMode,
    { text: restoreText, attachments: null },
  ).text;
}
