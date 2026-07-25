/**
 * Desktop Composer 状态条投影（main 进程）。
 * UserOpsLogStore 以 **main** 为真源（与 userVfsTurn / hasPendingTurns / flush 同进程）。
 */
import {
  projectComposerStatusAttachments,
  type MessageAttachment,
} from "@novel-master/core/chat";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

/**
 * session 真源 → 状态条 attachments（仅 user_ops；App 侧再 ∪ annotate）。
 * 读 main 进程内 log store；无净 diff preview。
 */
export async function projectComposerStatusForSession(
  _rt: DesktopNovelMasterRuntime,
  sessionId: string,
): Promise<MessageAttachment[]> {
  return projectComposerStatusAttachments(sessionId);
}
