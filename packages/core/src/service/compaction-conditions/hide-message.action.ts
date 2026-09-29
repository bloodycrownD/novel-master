/**
 * hide-message 动作：按 depth slice 隐藏可见消息。
 *
 * 原先住在 `service/events/impl/actions/hide-message.handler.ts`，是事件编排器
 * 的一个 action。事件编排器移除后，本动作的唯一活消费方是 {@link runCompaction}
 * （直调化压缩入口），所以搬到压缩域来，跟调用方住一起。
 *
 * 读路径（2026-09-29 治本）：区间计算只需要 id/seq/role/hidden——先取**消息头
 * 投影**（不选 content 列、不解压正文；大会话上原先全量 `listBySession` 连解压
 * 是压缩卡顿主源之一）；锚定检查（user 且不含 tool_result）需要正文的行只在
 * slice 窗口内——按窗口下界 `seq >= minSeq` 补拉全量行（窗口到尾通常仅几十条）
 * 替换占位。`resolveHideMessageRange` 的锚定循环有 seq 守卫（窗口外的 content
 * 永不被读），占位行（`content: {blocks: []}`）安全。
 *
 * @module service/compaction-conditions/hide-message.action
 */

import type { DepthSlice } from "@/domain/depth/logic/depth-slice.js";
import { messageIdsInSlice } from "@/domain/depth/logic/depth-slice.js";
import { listVisibleForDepth } from "@/domain/depth/logic/depth-from-tail.js";
import { resolveHideMessageRange } from "@/domain/depth/logic/resolve-hide-message-range.js";
import type {
  ChatMessage,
  ChatMessageHeader,
} from "@/domain/chat/model/message.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { MessageTranscriptEffectsService } from "@/service/chat/message-transcript-effects.port.js";

export interface HideMessageHandlerDeps {
  readonly messages: MessageService;
  readonly messageTranscriptEffects: MessageTranscriptEffectsService;
}

/** 头投影 → 无正文占位消息（content 只会在锚定窗口内被读，见模块头注释）。 */
function headerToPromptlessMessage(header: ChatMessageHeader): ChatMessage {
  return {
    id: header.id,
    sessionId: header.sessionId,
    seq: header.seq,
    role: header.role,
    content: { blocks: [] },
    provider: null,
    raw: null,
    createdAtMs: header.createdAtMs,
    hidden: header.hidden,
  };
}

export async function runHideMessageAction(
  projectId: string,
  sessionId: string,
  slice: DepthSlice,
  deps: HideMessageHandlerDeps
): Promise<void> {
  const headers = await deps.messages.listMessageHeadersBySession(sessionId);
  const stubAll = headers.map(headerToPromptlessMessage);
  const visible = listVisibleForDepth(stubAll);
  const ids = messageIdsInSlice(visible, slice);
  if (ids.length === 0) {
    return;
  }

  // 窗口下界：slice 内最老可见消息的 seq（与 resolveHideMessageRange 内部
  // 的 minSeq 同源）。从它起补拉全量行，锚定检查拿到真实 content。
  const idSet = new Set(ids);
  const minSeq = Math.min(
    ...visible.filter((m) => idSet.has(m.id)).map((m) => m.seq)
  );
  const fullRows = await deps.messages.listBySessionFromSeq(sessionId, minSeq);
  const fullById = new Map(fullRows.map((m) => [m.id, m]));
  const mergedVisible = visible.map((m) => fullById.get(m.id) ?? m);

  const range = resolveHideMessageRange(mergedVisible, slice, ids);
  if (range == null) {
    return;
  }
  await deps.messageTranscriptEffects.hideMessagesInRange(
    projectId,
    sessionId,
    range.fromSeq,
    range.toSeq
  );
}
