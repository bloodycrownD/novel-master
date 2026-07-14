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

/** 手动重置常驻工作区缓存：clear session kkv，下次拼装重建。 */
export async function clearSessionWorkplaceKkv(
  runtime: MobileNovelMasterRuntime,
  scope: SessionWorktreeBlockScope,
) {
  await runtime.sessionKkv.clearSession(scope.sessionId);
  return { worktreeDisplay: '', capturedAtMs: Date.now() };
}
