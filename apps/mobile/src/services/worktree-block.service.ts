/**
 * Session worktree block capture helpers（消费方 ②）。
 *
 * @module services/worktree-block.service
 */
import {
  captureSessionWorktreeBlock,
  getCapturedBlockOrCapture,
} from '@novel-master/core/worktree';
import type {MobileNovelMasterRuntime} from '../runtime/types';

export interface SessionWorktreeBlockScope {
  readonly projectId: string;
  readonly sessionId: string;
}

function blockRuntime(runtime: MobileNovelMasterRuntime) {
  return {
    worktree: (s: Parameters<MobileNovelMasterRuntime['worktree']>[0]) =>
      runtime.worktree(s),
    worktreeBlockStore: runtime.worktreeBlockStore,
  };
}

/** run / 预览读路径：无条目时显式 capture 一次。 */
export async function getCapturedBlockOrCaptureForMobile(
  runtime: MobileNovelMasterRuntime,
  scope: SessionWorktreeBlockScope,
) {
  return getCapturedBlockOrCapture(
    {
      kind: 'session',
      projectId: scope.projectId,
      sessionId: scope.sessionId,
    },
    blockRuntime(runtime),
  );
}

/** 置位 / 压缩 / 规则等业务入口：物化并写入 block store。 */
export async function captureSessionWorktreeBlockForMobile(
  runtime: MobileNovelMasterRuntime,
  scope: SessionWorktreeBlockScope,
) {
  return captureSessionWorktreeBlock(
    {
      kind: 'session',
      projectId: scope.projectId,
      sessionId: scope.sessionId,
    },
    blockRuntime(runtime),
  );
}

/** 手动刷新提示词文件块：委托 {@link captureSessionWorktreeBlockForMobile}。 */
export async function captureSessionWorktreeBlockOnManualRefresh(
  runtime: MobileNovelMasterRuntime,
  scope: SessionWorktreeBlockScope,
) {
  return captureSessionWorktreeBlockForMobile(runtime, scope);
}
