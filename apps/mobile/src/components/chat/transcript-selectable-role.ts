/** Mobile 薄 re-export：可见性批量范围逻辑见 @novel-master/core/chat。 */
export type {
  MessageVisibilityBatchMode,
  TranscriptSelectableRole,
} from '@novel-master/core/chat';
export {
  transcriptSelectableRole,
  isTranscriptRowSelectable,
  computeHideRangeFromSelection,
  computeShowRangeFromSelection,
  computeVisibilityBatchAffectedIds,
  selectVisibilityBatchEligibleIdsFromAnchor,
} from '@novel-master/core/chat';
