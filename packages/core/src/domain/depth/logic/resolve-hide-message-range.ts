/**
 * hide-message 事件：解析 depth slice 的 seq 隐藏范围。
 *
 * @module domain/depth/logic/resolve-hide-message-range
 */

import type { ChatMessage } from "@/domain/chat/model/message.js";
import { hasToolResult } from "@/domain/chat/logic/message-content-helpers.js";
import type { DepthSlice } from "./depth-slice.js";

export interface HideMessageSeqRange {
  readonly fromSeq: number;
  readonly toSeq: number;
}

/**
 * to 侧楼层锚定（最终口径）：`startDepth` 只是启发式起点，从 slice 最新
 * 边界向更旧方向搜索第一条「user 且不含 tool_result」的真用户输入，只隐藏
 * **严格更旧**于它的消息；锚点自身及其整轮（assistant(tool_use) +
 * user(tool_result) 往返）保持可见。
 *
 * 效果：压缩后可见历史以真用户输入开头（user → assistant(tool_call) →
 * tool_result …），保留条数 = 锚点 depth + 1，必然 ≥ `startDepth + 1`
 * （即「可以超出 6」——启发式只保下限，整轮不可拦腰切断）。
 *
 * slice 范围内找不到真用户输入（可见最老消息落在轮中段的病态残留）时返回
 * `null`，放弃本次压缩。
 */
function anchorToSeqBeforeUserTurn(
  visible: readonly ChatMessage[],
  minSeq: number,
  maxSeq: number
): number | null {
  for (let i = visible.length - 1; i >= 0; i--) {
    const m = visible[i];
    if (m.seq > maxSeq || m.seq < minSeq) {
      continue;
    }
    if (m.role === "user" && !hasToolResult(m)) {
      return m.seq - 1;
    }
  }
  return null;
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
  _slice: DepthSlice,
  messageIds: readonly string[]
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

  const toSeq = anchorToSeqBeforeUserTurn(visible, minSeq, maxSeq);
  if (toSeq == null || toSeq < minSeq) {
    // toSeq < minSeq：锚点即 slice 内最老消息，没有比它更旧的可隐藏。
    return null;
  }

  return { fromSeq: minSeq, toSeq };
}
