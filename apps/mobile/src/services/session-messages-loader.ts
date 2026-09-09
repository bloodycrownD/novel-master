/**
 * 聊天时间线消息加载（原文直出）。
 *
 * 正则系统移除后本模块是原 loadSessionMessages*ForDisplay 的接替者：
 * 保留独立模块以免调用方直接耦合 runtime.messages 的分页细节
 * （list / tail / page 三种口径），命名不再带 ForDisplay 后缀——
 * 消息展示不再做任何通道替换。
 */
import type {ChatMessage} from '@novel-master/core/chat';
import type {MobileNovelMasterRuntime} from '@/runtime/types';

/**
 * 全量会话消息（含隐藏行——聊天 UI 自行置灰；提示词路径另行过滤 hidden）。
 */
export async function loadSessionMessages(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
): Promise<ChatMessage[]> {
  return runtime.messages.listBySession(sessionId);
}

/** 会话尾部 N 条（进入会话页的首屏加载口径）。 */
export async function loadSessionMessagesTail(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  limit: number,
): Promise<ChatMessage[]> {
  return runtime.messages.listBySessionTail(sessionId, {limit});
}

/** 会话分页（向上翻页加载更早消息）。 */
export async function loadSessionMessagesPage(
  runtime: MobileNovelMasterRuntime,
  sessionId: string,
  options: {limit: number; beforeSeq?: number},
): Promise<ChatMessage[]> {
  return runtime.messages.listBySessionPage(sessionId, options);
}
