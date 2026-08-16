/**
 * hide-message 事件：解析 open-ended depth slice 的 seq 隐藏范围。
 *
 * @module domain/depth/logic/resolve-hide-message-range
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import type {
  ToolResultBlock,
  ToolUseBlock,
} from "@/domain/chat/model/content-block.js";
import { hasToolResult } from "@/domain/chat/logic/message-content-helpers.js";
import type { DepthSlice } from "./depth-slice.js";
import { depthByMessageId } from "./depth-from-tail.js";

export interface HideMessageSeqRange {
  readonly fromSeq: number;
  readonly toSeq: number;
}

/** 提取消息内全部 `tool_result` block 的 toolUseId（配对匹配用）。 */
function toolResultIdsFromMessage(message: ChatMessage): readonly string[] {
  return (message.content.blocks ?? [])
    .filter((b): b is ToolResultBlock => b.type === "tool_result")
    .map((b) => b.toolUseId);
}

/**
 * 提取消息内全部 `tool_use` block 的 id（配对匹配用）。
 *
 * @remarks
 * 写法对齐 `resolve-rollback-anchor.ts` 的同名私有实现（未导出，故内联）。
 */
function toolUseIdsFromMessage(message: ChatMessage): readonly string[] {
  return (message.content.blocks ?? [])
    .filter((b): b is ToolUseBlock => b.type === "tool_use")
    .map((b) => b.id);
}

/**
 * 配对感知边界扩展（spec D5）：边界只允许向外扩（hide 更多），绝不收缩。
 *
 * - `fromSeq` 边缘是含 `tool_result` 的 user 消息时，向更旧侧纳入配对的
 *   `assistant(tool_use)`（按 toolUseId 匹配，仅在 visible 列表内查找）；
 * - `toSeq` 边缘是含 `tool_use` 的 assistant 且配对的 tool_result 消息在
 *   range 外（更新侧）时，向更新侧纳入该 tool_result 消息。
 *
 * 找不到配对时保持原边界（`normalizeOrphanToolResultsForLlm` 兜底仍在）。
 */
function expandRangeForToolPairing(
  visible: readonly ChatMessage[],
  range: HideMessageSeqRange,
): HideMessageSeqRange {
  let fromSeq = range.fromSeq;
  let toSeq = range.toSeq;

  const fromEdge = visible.find((m) => m.seq === fromSeq);
  if (fromEdge != null && fromEdge.role === "user" && hasToolResult(fromEdge)) {
    const wanted = new Set(toolResultIdsFromMessage(fromEdge));
    for (const m of visible) {
      if (m.seq >= fromSeq || m.role !== "assistant") {
        continue;
      }
      if (toolUseIdsFromMessage(m).some((id) => wanted.has(id))) {
        fromSeq = Math.min(fromSeq, m.seq);
      }
    }
  }

  const toEdge = visible.find((m) => m.seq === toSeq);
  if (toEdge != null && toEdge.role === "assistant") {
    const wanted = new Set(toolUseIdsFromMessage(toEdge));
    if (wanted.size > 0) {
      for (const m of visible) {
        if (m.seq <= toSeq || m.role !== "user") {
          continue;
        }
        const resultIds = toolResultIdsFromMessage(m);
        if (resultIds.some((id) => wanted.has(id))) {
          toSeq = Math.max(toSeq, m.seq);
        }
      }
    }
  }

  return { fromSeq, toSeq };
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
    return expandRangeForToolPairing(visible, { fromSeq: minSeq, toSeq: maxSeq });
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

  return expandRangeForToolPairing(visible, { fromSeq: minSeq, toSeq: maxSeq });
}
