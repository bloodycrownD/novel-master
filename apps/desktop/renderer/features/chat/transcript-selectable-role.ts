/** Desktop 薄 re-export：可见性 / tail 批量范围逻辑见 @novel-master/core/chat。 */
import type { ChatMessageDto } from "@shared/ipc-types";
import type { TailBatchRow } from "@novel-master/core/chat";
import { buildChatListItems } from "./message-blocks";

export type {
  MessageVisibilityBatchMode,
  TranscriptSelectableRole,
  TailBatchMode,
  TailBatchRow,
} from "@novel-master/core/chat";
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
} from "@novel-master/core/chat";

/** Desktop 消息批量模式（含 delete）。 */
export type MessageBatchMode = "hide" | "restore" | "delete";

/** 将会话消息映射为 tail 批量行（含 user_vfs_turn 合成卡片）。 */
export function buildTailBatchRows(
  messages: readonly ChatMessageDto[],
): readonly TailBatchRow[] {
  const items = buildChatListItems(messages);
  const rows: TailBatchRow[] = [];

  for (const item of items) {
    if (item.kind === "user_vfs_turn") {
      const msg = messages.find((m) => m.id === item.id);
      if (msg == null) {
        continue;
      }
      rows.push({
        id: item.id,
        role: msg.role,
        seq: msg.seq,
        selectable: true,
      });
      continue;
    }
    rows.push({
      id: item.message.id,
      role: item.message.role,
      seq: item.message.seq,
      selectable: true,
    });
  }

  return rows;
}
