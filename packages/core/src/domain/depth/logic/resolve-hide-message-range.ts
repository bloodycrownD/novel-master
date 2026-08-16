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
 * from 侧楼层锚定（订正口径）：隐藏区间第一条必须落在「user 且不含
 * tool_result」的真用户输入上。
 *
 * 协议保证消息严格 user/assistant 交替（tool_result 挂 user role 传递），
 * 一轮对话由真用户输入开启；因此边缘为 assistant 或 user(tool_result) 时
 * 持续向更旧侧扩展，跳过整个 tool 往返，落在最近一条真用户输入——中间的
 * assistant(tool_use) + user(tool_result) 随之整体入区，配对天然完整。
 * 可见列表走到头仍未命中（截断异常）则停在最老消息，孤儿兜底仍在
 * `normalizeOrphanToolResultsForLlm`。
 */
function anchorFromSeqToUserInput(
  visible: readonly ChatMessage[],
  fromSeq: number,
): number {
  let anchored = fromSeq;
  for (let i = visible.length - 1; i >= 0; i--) {
    const m = visible[i];
    if (m.seq > fromSeq) {
      continue;
    }
    if (m.role === "user" && !hasToolResult(m)) {
      return m.seq;
    }
    anchored = m.seq;
  }
  return anchored;
}

/**
 * 配对感知边界处理（spec D5）：边界只允许向外扩（hide 更多），绝不收缩。
 *
 * - `fromSeq`：向上锚定到最近一条真用户输入（见 `anchorFromSeqToUserInput`），
 *   隐藏区间第一条必为 user 且非 tool_result；
 * - `toSeq` 边缘是含 `tool_use` 的 assistant 且配对的 tool_result 消息在
 *   range 外（更新侧）时，向更新侧纳入该 tool_result 消息（防孤儿 result）。
 *
 * 找不到配对时保持原边界（`normalizeOrphanToolResultsForLlm` 兜底仍在）。
 */
function expandRangeForToolPairing(
  visible: readonly ChatMessage[],
  range: HideMessageSeqRange,
): HideMessageSeqRange {
  const fromSeq = anchorFromSeqToUserInput(visible, range.fromSeq);
  let toSeq = range.toSeq;

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
