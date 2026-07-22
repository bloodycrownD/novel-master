/**
 * 规则变更后投影 Composer 状态条（仅 user_ops）整表替换。
 * 不刷新规则快照、不 capture。
 * （workplace 差集 chip 已废止；本函数签名保留 workplace 参数供调用方过渡，Step 3 再删 suggest。）
 */
import type { MessageAttachment } from '@novel-master/core/chat';
import type { WorkplaceService } from '@novel-master/core/workplace';
import type { MobileNovelMasterRuntime } from '../runtime/types';
import { applyComposerStatusAttachmentsReplace } from '../storage/chat-composer-draft';
import { projectComposerStatusForSession } from './project-composer-status.service';

export async function suggestWorkplaceAttachmentsToComposerDraft(
  runtime: MobileNovelMasterRuntime,
  _workplace: WorkplaceService,
  sessionId: string,
): Promise<MessageAttachment[]> {
  const attachments = await projectComposerStatusForSession(runtime, sessionId);
  applyComposerStatusAttachmentsReplace({ sessionId, attachments });
  return attachments;
}
