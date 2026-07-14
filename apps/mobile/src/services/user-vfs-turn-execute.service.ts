/**
 * 会话 scope 用户 VFS 操作经 UserVfsTurnService 执行（pending，不 markDirty）。
 *
 * @module services/user-vfs-turn-execute.service
 */
import {
  previewPendingUserOpsAttachment,
  type UserVfsTurnOp,
} from "@novel-master/core/chat";

import { type VfsScope } from "@novel-master/core/vfs";
import { applyComposerAttachmentsSuggest } from '../storage/chat-composer-draft';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** 是否为会话工作区 scope（需走 userVfsTurn）。 */
export function isSessionVfsScope(
  scope: VfsScope,
): scope is Extract<VfsScope, {kind: 'session'}> {
  return scope.kind === 'session';
}

/** 经 userVfsTurn 执行；失败抛错供 toast。 */
export async function executeSessionUserVfsOp(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  op: UserVfsTurnOp,
): Promise<void> {
  const result = await runtime.userVfsTurn.executeOp(sessionId, op);
  if (!result.ok) {
    throw result.error;
  }
  const toolNames = [...new Set(op.tools.map(t => t.name))];
  const name =
    toolNames.length > 0 ? toolNames.join(', ') : '用户操作';
  applyComposerAttachmentsSuggest({
    sessionId,
    attachments: [previewPendingUserOpsAttachment(name)],
  });
}
