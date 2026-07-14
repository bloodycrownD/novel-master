import type { RollbackMode } from '@novel-master/core/chat';
import type { MessageAttachmentDto } from '@shared/ipc-types';

export type ComposerDraftSnapshot = {
  readonly text: string;
  readonly attachments: readonly MessageAttachmentDto[];
};

/** undo_send 成功后将 Composer 恢复为锚点原文 + attachments；rewind 路径保持当前输入不变。 */
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
      attachments: [...(restore.attachments ?? [])],
    };
  }
  return {
    text: current.text,
    attachments: [...current.attachments],
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
