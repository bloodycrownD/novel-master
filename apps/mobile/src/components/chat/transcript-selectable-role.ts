/** Mobile 薄 re-export：可见性 / tail 批量范围逻辑见 @novel-master/core/chat。 */
import {
  type ChatMessage,
  type MessageVisibilityBatchMode,
  type TailBatchRow,
} from '@novel-master/core/chat';

export type {
  MessageVisibilityBatchMode,
  TranscriptSelectableRole,
  TailBatchRow,
} from '@novel-master/core/chat';

/** 消息批量模式：hide / restore / delete。 */
export type MessageBatchMode = MessageVisibilityBatchMode | 'delete';

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
} from '@novel-master/core/chat';

/** restore / delete 共用 tail 级联规则。 */
export function isTailBatchMode(
  mode: MessageBatchMode | null,
): mode is 'restore' | 'delete' {
  return mode === 'restore' || mode === 'delete';
}

/** 将会话消息映射为 tail 批量行。 */
export function chatMessagesToTailBatchRows(
  messages: readonly ChatMessage[],
): readonly TailBatchRow[] {
  return messages.map(message => ({
    id: message.id,
    role: message.role,
    seq: message.seq,
    hidden: message.hidden,
    selectable: true,
  }));
}
