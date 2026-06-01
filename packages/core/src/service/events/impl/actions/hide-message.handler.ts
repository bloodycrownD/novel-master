/**
 * hide-message event action: hide visible messages matching a depth slice.
 *
 * @module service/events/impl/actions/hide-message.handler
 */

import type { DepthSlice } from "@/domain/depth/logic/depth-slice.js";
import { messageIdsInSlice } from "@/domain/depth/logic/depth-slice.js";
import { listVisibleForDepth } from "@/domain/depth/logic/depth-from-tail.js";
import type { MessageService } from "@/service/chat/message.port.js";
import type { AgentSession } from "@/domain/agent/session/agent-session.port.js";

export interface HideMessageHandlerDeps {
  readonly messages: MessageService;
}

export async function runHideMessageAction(
  session: AgentSession,
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

  const idSet = new Set(ids);
  const toHide = visible.filter((m) => idSet.has(m.id));
  const seqs = toHide.map((m) => m.seq).sort((a, b) => a - b);
  const fromSeq = seqs[0]!;
  const toSeq = seqs[seqs.length - 1]!;
  await session.hideRange(fromSeq, toSeq);
}
