/**
 * 常驻工作区 helpers（原 BlockStore capture 已退役）。
 *
 * @module services/worktree-block.service
 */
import { assembleWorkplaceDisplay } from '@novel-master/core/worktree';
import type { MobileNovelMasterRuntime } from '../runtime/types';

export interface SessionWorktreeBlockScope {
  readonly projectId: string;
  readonly sessionId: string;
}

/** 显式拼装常驻前缀（预览 / 调试）；生产发送路径用 session-prompt-input。 */
export async function assembleWorkplaceForMobile(
  runtime: MobileNovelMasterRuntime,
  scope: SessionWorktreeBlockScope,
) {
  const wtScope = {
    kind: 'session' as const,
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  };
  const worktreeDisplay = await assembleWorkplaceDisplay(wtScope, {
    sessionKkv: runtime.sessionKkv,
    worktree: runtime.worktree(wtScope),
    vfs: runtime.sessionVfs(scope.projectId, scope.sessionId),
    layout: { persist: [{ type: 'worktree', name: 'canon' }] },
  });
  return { worktreeDisplay, capturedAtMs: Date.now() };
}

/** @deprecated 使用 {@link assembleWorkplaceForMobile} */
export const getCapturedBlockOrCaptureForMobile = assembleWorkplaceForMobile;

/** 置位后由 Core clearSession；此函数仅保留为无操作兼容壳（T-SF1）。 */
export async function captureSessionWorktreeBlockForMobile(
  _runtime: MobileNovelMasterRuntime,
  _scope: SessionWorktreeBlockScope,
): Promise<{ worktreeDisplay: string; capturedAtMs: number }> {
  return { worktreeDisplay: '', capturedAtMs: Date.now() };
}

/** {@link captureSessionWorktreeBlockForMobile} 的历史导出名。 */
export { captureSessionWorktreeBlockForMobile as captureSessionWorktreeBlock };

/** 手动快照已退役；改为 clear session kkv。 */
export async function captureSessionWorktreeBlockOnManualRefresh(
  runtime: MobileNovelMasterRuntime,
  scope: SessionWorktreeBlockScope,
) {
  await runtime.sessionKkv.clearSession(scope.sessionId);
  return { worktreeDisplay: '', capturedAtMs: Date.now() };
}

/** manual 压缩 emit 成功后：kkv 已由 EventOrchestrator 清空；此处仅校验 emitOk。 */
export async function captureAfterManualCompactionEmit(
  _runtime: MobileNovelMasterRuntime,
  _scope: SessionWorktreeBlockScope,
  emitOk: boolean,
): Promise<void> {
  if (!emitOk) {
    return;
  }
}
