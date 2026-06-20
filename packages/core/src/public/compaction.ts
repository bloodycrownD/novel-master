export type { DepthSlice } from "../domain/depth/logic/depth-slice.js";
export {
  matchDepth,
  validateDepthSlice,
  messageIdsInSlice,
} from "../domain/depth/logic/depth-slice.js";
export { depthByMessageId, listVisibleForDepth } from "../domain/depth/logic/depth-from-tail.js";
export { resolveHideMessageRange } from "../domain/depth/logic/resolve-hide-message-range.js";
export type { HideMessageSeqRange } from "../domain/depth/logic/resolve-hide-message-range.js";
export type { CompactionConditions } from "../domain/compaction-conditions/model/compaction-conditions.js";
export { compactionConditionsSchema } from "../domain/compaction-conditions/model/compaction-conditions.schema.js";
export {
  CompactionConditionsError,
  compactionConditionsInvalidSchema,
  isCompactionConditionsError,
} from "../errors/compaction-conditions-errors.js";
export type { CompactionConditionsErrorCode } from "../errors/compaction-conditions-errors.js";
export type { CompactionConditionsStore } from "../service/compaction-conditions/compaction-conditions-store.port.js";
export { createCompactionConditionsStore } from "../service/compaction-conditions/create-compaction-conditions-store.js";
export {
  createCompactionConditionEvaluator,
  type CompactionConditionEvaluator,
} from "../service/compaction-conditions/create-compaction-condition-evaluator.js";
export { estimateTokens } from "../domain/compaction-conditions/logic/token-estimate.js";
