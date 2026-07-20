/** Desktop 薄 re-export：可见性 / tail 批量范围逻辑见 @shared/logic/chat。 */
import type { ChatMessageDto } from "@shared/ipc-types";
import type { TailBatchRow } from "@shared/logic/chat";
import { buildChatListItems } from "./message-blocks";

export type {
  MessageVisibilityBatchMode,
  TranscriptSelectableRole,
  TailBatchMode,
  TailBatchRow,
} from "@shared/logic/chat";
export {
  transcriptSelectableRole,
  isTranscriptRowSelectable,
  computeHideRangeFromSelection,
  computeShowRangeFromSelection,
  computeVisibilityBatchAffectedIds,
  selectVisibilityBatchEligibleIdsFromAnchor,
  isTailBatchRowSelectable,
  selectTailBatchEligibleIdsFromAnchor,
  computeTailBatchAffectedIds,
  computeTailBatchRangeFromSelection,
  tailBatchDeleteAfterSeq,
} from "@shared/logic/chat";

/** Desktop 消息批量模式（含 delete）。 */
export type MessageBatchMode = "hide" | "restore" | "delete";

/** 将会话消息映射为 tail 批量行。 */
export function buildTailBatchRows(
  messages: readonly ChatMessageDto[],
): readonly TailBatchRow[] {
  const items = buildChatListItems(messages);
  const rows: TailBatchRow[] = [];

  for (const item of items) {
    rows.push({
      id: item.message.id,
      role: item.message.role,
      seq: item.message.seq,
      hidden: item.message.hidden,
      selectable: true,
    });
  }

  return rows;
}
