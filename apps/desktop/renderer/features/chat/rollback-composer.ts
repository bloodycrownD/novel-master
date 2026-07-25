import { type RollbackMode } from '@shared/logic/chat';
import type { MessageAttachmentDto } from '@shared/ipc-types';

export type ComposerDraftSnapshot = {
  readonly text: string;
  readonly attachments: readonly MessageAttachmentDto[];
};

/**
 * undo_send：恢复锚点原文（含 `@路径`）；attachments 恒空（ops 由 main suggest 推；annotate 另 ∪）。
 * rewind：保留当前正文；attachments 恒空——禁止把闭包里旧 user_ops chip 写回
 *（main 已 clear + 推空；renderer 再 ∪ annotate）。
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
      attachments: [],
    };
  }
  return {
    text: current.text,
    attachments: [],
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
