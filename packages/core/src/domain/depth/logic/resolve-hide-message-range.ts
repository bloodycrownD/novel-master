/**
 * hide-message 事件：解析 open-ended depth slice 的 seq 隐藏范围。
 *
 * @module domain/depth/logic/resolve-hide-message-range
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type { DepthSlice } from "./depth-slice.js";
import { depthByMessageId } from "./depth-from-tail.js";

export interface HideMessageSeqRange {
  readonly fromSeq: number;
  readonly toSeq: number;
}

/**
 * 解析 hide-message 应作用的 seq 范围；无匹配消息时返回 `null`。
 *
 * @param visible - 可见消息（seq 升序）
 * @param slice - depth 区间
 * @param messageIds - slice 内待隐藏的消息 id
 */
export function resolveHideMessageRange(
  visible: readonly ChatMessage[],
  slice: DepthSlice,
  messageIds: readonly string[],
): HideMessageSeqRange | null {
  if (messageIds.length === 0) {
    return null;
  }

  const idSet = new Set(messageIds);
  const inSlice = visible.filter((m) => idSet.has(m.id));
  if (inSlice.length === 0) {
    return null;
  }

  const seqs = inSlice.map((m) => m.seq);
  const minSeq = Math.min(...seqs);
  const maxSeq = Math.max(...seqs);

  if (slice.startDepth == null || slice.endDepth != null) {
    return { fromSeq: minSeq, toSeq: maxSeq };
  }

  const depths = depthByMessageId(visible);
  let anchor: ChatMessage | undefined = visible.find(
    (m) => depths.get(m.id) === slice.startDepth,
  );

  if (anchor != null && anchor.role !== "assistant") {
    anchor = undefined;
    const depthEntries = [...depths.entries()].sort((a, b) => a[1] - b[1]);
    for (const [id, depth] of depthEntries) {
      if (depth < slice.startDepth) {
        continue;
      }
      const candidate = visible.find((m) => m.id === id);
      if (candidate?.role === "assistant") {
        anchor = candidate;
        break;
      }
    }
  }

  if (anchor == null) {
    return null;
  }

  return { fromSeq: minSeq, toSeq: maxSeq };
}
