// 归属例外（check-public-ownership）：depth / compaction-conditions 是
// compaction 的实现细节，对外语义统一是 compaction。
export { DepthSlice } from "../domain/depth/logic/depth-slice.js";
export { HideMessageRange } from "../domain/depth/logic/resolve-hide-message-range.js";
export type { CompactionConditions } from "../domain/compaction-conditions/model/compaction-conditions.js";
export { DEFAULT_HIDE_START_DEPTH } from "../domain/compaction-conditions/model/compaction-conditions.js";
export { compactionConditionsSchema } from "../domain/compaction-conditions/model/compaction-conditions.schema.js";
export type { CompactionConditionsStore } from "../service/compaction-conditions/compaction-conditions-store.port.js";
export { CompactionFactory, type CompactionConditionEvaluator } from "../service/compaction-conditions/compaction-factory.js";
export {
    Compaction,
    type RunCompactionDeps,
} from "../service/compaction-conditions/run-compaction.js";
