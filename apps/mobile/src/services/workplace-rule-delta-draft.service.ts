/**
 * 规则保存后：refreshRuleSnapshot（evaluate→写 canon→clear file_cache）。
 * workplace 差集 suggest 已废止；不再改 Composer draft attachments。
 *
 * 镜像注：desktop 同名入口在 apps/desktop/src/main/ipc/handlers/workplace.ts（私有）。
 * 两端形态不同（desktop 从 IPC 请求解析 scope 并带空参守卫，本端由调用方传入已解析的
 * workplace/sessionId），共同语义只有 core 的 refreshRuleSnapshot 调用，故不收敛。
 */
import type {WorkplaceService} from '@novel-master/core/workplace';
import {refreshRuleSnapshot} from '@novel-master/core/workplace';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

/**
 * 规则变更后刷新会话规则快照并清空 file_cache。
 */
export async function refreshRuleSnapshotAfterRuleChange(runtime: MobileNovelMasterRuntime, workplace: WorkplaceService, sessionId: string): Promise<void> {
  await refreshRuleSnapshot(sessionId, {
    sessionKkv: runtime.sessionKkv,
    workplace,
  });
}
