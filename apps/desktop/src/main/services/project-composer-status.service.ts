/**
 * Desktop Composer 状态条投影（main 进程）。
 * D7：user ops 拆除后收窄为仅 annotate store 投影；main 与 renderer 的
 * annotate store 各自独立，renderer 收到推送后再 ∪ 自己进程的 annotate chips。
 */
import { chatAnnotateDraftStore, type MessageAttachment } from "@novel-master/core/chat";

/**
 * session 真源 → 状态条 attachments（仅 annotate；App 侧再 ∪ annotate）。
 * 读 main 进程 annotate store；无净 diff preview。
 *
 * 十七期第2轮签名审计：首参 runtime 双端都未被引用（`chatAnnotateDraftStore`
 * 是 core 全局单例），已删除——双端只剩这一行等价实现，下一轮可直接删 wrapper
 * 让调用方取 core store（本轮不动调用点命名，保持「投影口径单一入口」的可读性）。
 */
export async function projectComposerStatusForSession(sessionId: string): Promise<MessageAttachment[]> {
  return chatAnnotateDraftStore.chips(sessionId);
}
