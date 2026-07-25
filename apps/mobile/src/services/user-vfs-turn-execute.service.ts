/**
 * 会话 scope 用户 VFS 操作经 UserVfsTurnService 执行（写盘即时 + append 操作日志）。
 *
 * @module services/user-vfs-turn-execute.service
 */
import { type UserVfsTurnOp } from '@novel-master/core/chat';

import { type VfsScope } from '@novel-master/core/vfs';
import { applyComposerStatusAttachmentsReplace } from '../storage/chat-composer-draft';
import type { MobileNovelMasterRuntime } from '../runtime/types';
import { projectComposerStatusForSession } from './project-composer-status.service';

/** 是否为会话工作区 scope（需走 userVfsTurn）。 */
export function isSessionVfsScope(
  scope: VfsScope,
): scope is Extract<VfsScope, { kind: 'session' }> {
  return scope.kind === 'session';
}

/** {@link executeSessionUserVfsOp} 选项。 */
export type ExecuteSessionUserVfsOpOptions = {
  /**
   * 批量移动等场景：跳过每次 op 后的状态条刷新，批次末统一
   * {@link refreshComposerStatusAfterUserVfsOps}（log store 投影已轻量，仍可合并 notify）。
   */
  readonly skipComposerStatusRefresh?: boolean;
};

/** 经 userVfsTurn 执行；失败抛错供 toast。默认成功后轻量投影状态条。 */
export async function executeSessionUserVfsOp(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  op: UserVfsTurnOp,
  options: ExecuteSessionUserVfsOpOptions = {},
): Promise<void> {
  const t0 = Date.now();
  const result = await runtime.userVfsTurn.executeOp(sessionId, op);
  const executeMs = Date.now() - t0;
  if (!result.ok) {
    console.log('[vfs-move] userVfsTurn.executeOp FAILED', {
      sessionId,
      executeMs,
      error:
        result.error instanceof Error
          ? result.error.message
          : String(result.error),
    });
    throw result.error;
  }
  if (options.skipComposerStatusRefresh) {
    console.log('[vfs-move] userVfsTurn op done (composer refresh deferred)', {
      sessionId,
      executeMs,
      totalMs: Date.now() - t0,
    });
    return;
  }
  const t1 = Date.now();
  await refreshComposerStatusAfterUserVfsOps(runtime, sessionId);
  console.log('[vfs-move] userVfsTurn op done', {
    sessionId,
    executeMs,
    composerStatusMs: Date.now() - t1,
    totalMs: Date.now() - t0,
  });
}

/** 批次结束后补一次状态条投影（读 UserOpsLogStore，无净 diff）。 */
export async function refreshComposerStatusAfterUserVfsOps(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
): Promise<void> {
  const t0 = Date.now();
  const attachments = await projectComposerStatusForSession(runtime, sessionId);
  applyComposerStatusAttachmentsReplace({sessionId, attachments});
  console.log('[vfs-move] composer status refresh', {
    sessionId,
    ms: Date.now() - t0,
  });
}
