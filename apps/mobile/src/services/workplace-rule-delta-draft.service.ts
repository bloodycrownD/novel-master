/**
 * 规则变更后计算 workplace 附件差集并写入 Composer draft。
 * 不刷新规则快照、不 capture。
 */
import type { MessageAttachment } from '@novel-master/core/chat';
import {
  ruleViewToSnapshotEntries,
  workplaceAttachmentsFromRuleDelta,
  type WorktreeService,
} from '@novel-master/core/worktree';
import type { MobileNovelMasterRuntime } from '../runtime/types';
import { applyComposerAttachmentsSuggest } from '../storage/chat-composer-draft';

/** 与 Core `SESSION_KKV_DOMAIN_FILE_CACHE` 同字面量（避免 Jest 未 map session-kkv 子路径）。 */
const FILE_CACHE_DOMAIN = 'file_cache';

export async function suggestWorkplaceAttachmentsToComposerDraft(
  runtime: MobileNovelMasterRuntime,
  worktree: WorktreeService,
  sessionId: string,
): Promise<MessageAttachment[]> {
  const view = await worktree.evaluateRuleView();
  const live = ruleViewToSnapshotEntries(view);
  const cacheKeys = await runtime.sessionKkv.listKeys(
    sessionId,
    FILE_CACHE_DOMAIN,
  );
  const attachments = workplaceAttachmentsFromRuleDelta(live, cacheKeys);
  applyComposerAttachmentsSuggest({ sessionId, attachments });
  return attachments;
}
