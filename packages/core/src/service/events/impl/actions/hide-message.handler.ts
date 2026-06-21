/**
 * hide-message event action: hide visible messages matching a depth slice.
 *
 * @module service/events/impl/actions/hide-message.handler
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
  deps: HideMessageHandlerDeps,
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
    range.toSeq,
  );
}
