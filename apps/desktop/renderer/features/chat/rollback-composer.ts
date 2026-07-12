import type { RollbackMode } from '@novel-master/core/chat';

/** undo_send 成功后将 Composer 恢复为锚点原文；rewind 路径保持当前输入不变。 */
export function resolveComposerTextAfterRollbackSuccess(
  currentComposerText: string,
  rollbackMode: RollbackMode,
  restoreText: string | null,
): string {
  if (rollbackMode === 'undo_send' && restoreText) {
    return restoreText;
  }
  return currentComposerText;
}
