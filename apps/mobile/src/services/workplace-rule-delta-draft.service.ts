/**
 * 规则变更后投影 Composer 状态条（workplace + user_ops）整表替换。
 * 不刷新规则快照、不 capture。
 */
import type { MessageAttachment } from '@novel-master/core/chat';
import type { WorktreeService } from '@novel-master/core/worktree';
import type { MobileNovelMasterRuntime } from '../runtime/types';
import { applyComposerStatusAttachmentsReplace } from '../storage/chat-composer-draft';
import { projectComposerStatusForSession } from './project-composer-status.service';

export async function suggestWorkplaceAttachmentsToComposerDraft(
  runtime: MobileNovelMasterRuntime,
  worktree: WorktreeService,
  sessionId: string,
): Promise<MessageAttachment[]> {
  const attachments = await projectComposerStatusForSession(
    runtime,
    worktree,
    sessionId,
  );
  applyComposerStatusAttachmentsReplace({ sessionId, attachments });
  return attachments;
}
