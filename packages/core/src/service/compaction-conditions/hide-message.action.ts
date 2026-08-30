/**
 * hide-message 动作：按 depth slice 隐藏可见消息。
 *
 * 原先住在 `service/events/impl/actions/hide-message.handler.ts`，是事件编排器
 * 的一个 action。事件编排器移除后，本动作的唯一活消费方是 {@link runCompaction}
 * （直调化压缩入口），所以搬到压缩域来，跟调用方住一起。
 *
 * @module service/compaction-conditions/hide-message.action
 */

import type { DepthSlice } from "@/domain/depth/logic/depth-slice.js";
import { messageIdsInSlice } from "@/domain/depth/logic/depth-slice.js";
import { listVisibleForDepth } from "@/domain/depth/logic/depth-from-tail.js";
import { resolveHideMessageRange } from "@/domain/depth/logic/resolve-hide-message-range.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { MessageTranscriptEffectsService } from "@/service/chat/message-transcript-effects.port.js";

export interface HideMessageHandlerDeps {
  readonly messages: MessageService;
  readonly messageTranscriptEffects: MessageTranscriptEffectsService;
}

export async function runHideMessageAction(
  projectId: string,
  sessionId: string,
  slice: DepthSlice,
  deps: HideMessageHandlerDeps
): Promise<void> {
  const all = await deps.messages.listBySession(sessionId);
  const visible = listVisibleForDepth(all);
  const ids = messageIdsInSlice(visible, slice);
  if (ids.length === 0) {
    return;
  }

  const range = resolveHideMessageRange(visible, slice, ids);
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
