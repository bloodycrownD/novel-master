/**
 * 常驻工作区 helpers（原 BlockStore capture 已退役）。
 *
 * @module services/workplace-block.service
 */
import { assembleWorkplaceDisplay } from '@novel-master/core/workplace';
import type { MobileNovelMasterRuntime } from '../runtime/types';
import { refreshComposerStatusAfterSessionKkvCleared } from './project-composer-status.service';

export interface SessionWorkplaceBlockScope {
  readonly projectId: string;
  readonly sessionId: string;
}

/** 显式拼装常驻前缀（预览 / 调试）；生产发送路径用 session-prompt-input。 */
export async function assembleWorkplaceForMobile(
  runtime: MobileNovelMasterRuntime,
  scope: SessionWorkplaceBlockScope,
) {
  const wtScope = {
    kind: 'session' as const,
    projectId: scope.projectId,
    sessionId: scope.sessionId,
  };
  const { workplaceDisplay } = await assembleWorkplaceDisplay(wtScope, {
    sessionKkv: runtime.sessionKkv,
    workplace: runtime.workplace(wtScope),
    vfs: runtime.sessionVfs(scope.projectId, scope.sessionId),
    layout: { workplace: true },
  });
  return { workplaceDisplay, capturedAtMs: Date.now() };
}

/** 手动重置常驻工作区缓存：clear session kkv，并清 Composer 上条。 */
export async function clearSessionWorkplaceKkv(
  runtime: MobileNovelMasterRuntime,
  scope: SessionWorkplaceBlockScope,
) {
  await runtime.sessionKkv.clearSession(scope.sessionId);
  await refreshComposerStatusAfterSessionKkvCleared(runtime, scope);
  return { workplaceDisplay: '', capturedAtMs: Date.now() };
}
