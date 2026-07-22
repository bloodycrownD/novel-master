/**
 * 规则保存后：refreshRuleSnapshot（evaluate→写 canon→clear file_cache）。
 * workplace 差集 suggest 已废止；不再改 Composer draft attachments。
 */
import type { WorkplaceService } from '@novel-master/core/workplace';
import { refreshRuleSnapshot } from '@novel-master/core/workplace';
import type { MobileNovelMasterRuntime } from '../runtime/types';

/**
 * 规则变更后刷新会话规则快照并清空 file_cache。
 */
export async function refreshRuleSnapshotAfterRuleChange(
  runtime: MobileNovelMasterRuntime,
  workplace: WorkplaceService,
  sessionId: string,
): Promise<void> {
  await refreshRuleSnapshot(sessionId, {
    sessionKkv: runtime.sessionKkv,
    workplace,
  });
}
