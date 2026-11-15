/**
 * 常驻工作区 helpers（原 BlockStore capture 已退役）。
 *
 * @module services/workplace-block.service
 */
import type {MobileNovelMasterRuntime} from '@/runtime/types';
import {refreshComposerStatusAfterSessionKkvCleared} from './project-composer-status.service';

export interface SessionWorkplaceBlockScope {
  readonly projectId: string;
  readonly sessionId: string;
}

/**
 * 手动重置常驻工作区缓存：clear session kkv，并清 Composer 上条。
 * 不必清 annotate store。
 */
export async function clearSessionWorkplaceKkv(
  runtime: MobileNovelMasterRuntime,
  scope: SessionWorkplaceBlockScope,
) {
  await runtime.sessionKkv.clearSession(scope.sessionId);
  await refreshComposerStatusAfterSessionKkvCleared(runtime, scope);
  return {workplaceDisplay: '', capturedAtMs: Date.now()};
}
