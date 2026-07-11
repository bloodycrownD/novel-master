/**
 * Session worktree block capture helpers（消费方 ②）。
 *
 * @module services/worktree-block.service
 */
import { captureSessionWorktreeBlock } from '@novel-master/core/worktree';
import type {MobileNovelMasterRuntime} from '../runtime/types';

export interface SessionWorktreeBlockScope {
  readonly projectId: string;
  readonly sessionId: string;
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
    {
      worktree: s => runtime.worktree(s),
      worktreeBlockStore: runtime.worktreeBlockStore,
    },
  );
}

/** 手动刷新提示词文件块：委托 {@link captureSessionWorktreeBlockForMobile}。 */
export async function captureSessionWorktreeBlockOnManualRefresh(
  runtime: MobileNovelMasterRuntime,
  scope: SessionWorktreeBlockScope,
) {
  return captureSessionWorktreeBlockForMobile(runtime, scope);
}
