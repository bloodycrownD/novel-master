/**
 * Desktop Composer 状态条投影（main 进程）。
 * D7：user ops 拆除后收窄为仅 annotate store 投影；main 与 renderer 的
 * annotate store 各自独立，renderer 收到推送后再 ∪ 自己进程的 annotate chips。
 */
import {
  chipsFromAnnotateStore,
  type MessageAttachment,
} from "@novel-master/core/chat";
import type { DesktopNovelMasterRuntime } from "../runtime/types.js";

/**
 * session 真源 → 状态条 attachments（仅 annotate；App 侧再 ∪ annotate）。
 * 读 main 进程 annotate store；无净 diff preview。
 */
export async function projectComposerStatusForSession(
  _rt: DesktopNovelMasterRuntime,
  sessionId: string,
): Promise<MessageAttachment[]> {
  return chipsFromAnnotateStore(sessionId);
}
