/**
 * Public exports for smart sort rule management (`@novel-master/core/smart-sort-rule`).
 *
 * @module public/smart-sort-rule
 */

export {
  SmartSortRule,
  SMART_SORT_CAPTURE_KINDS,
} from "../domain/smart-sort-rule/model/smart-sort-rule.js";
export type {
  SmartSortCaptureKind,
} from "../domain/smart-sort-rule/model/smart-sort-rule.js";
export type {
  CreateSmartSortRuleInput,
  UpdateSmartSortRuleInput,
} from "../domain/smart-sort-rule/model/smart-sort-rule.schema.js";
export { SmartSortRuleIo } from "../domain/smart-sort-rule/model/smart-sort-rule-io.js";
export type { SmartSortRuleBundleDocument } from "../domain/smart-sort-rule/model/smart-sort-rule-io.js";
export { SmartSortRuleCompiler } from "../domain/smart-sort-rule/logic/compile-smart-sort-rule.js";
export { SmartSortPattern } from "../domain/smart-sort-rule/logic/match-smart-sort-pattern.js";
export type {
  MatchSmartSortPatternResult,
  SmartSortPatternMatch,
} from "../domain/smart-sort-rule/logic/match-smart-sort-pattern.js";
export { SmartSortHighlight } from "../domain/smart-sort-rule/logic/split-smart-sort-highlight-segments.js";
export type { SmartSortHighlightMatchInput } from "../domain/smart-sort-rule/logic/split-smart-sort-highlight-segments.js";
export { PatternInput } from "../domain/smart-sort-rule/logic/parse-pattern-input.js";
export type { ParsedPatternInput } from "../domain/smart-sort-rule/logic/parse-pattern-input.js";
// 归属例外（check-public-ownership）：SmartSortRuleCompiler.compile 的返回类型，不可拆。
export type { CompiledSmartSortRule } from "../domain/workplace/logic/smart-sort.js";
export { SmartSortRuleServiceFactory } from "../service/smart-sort-rule/create-smart-sort-rule.service.js";
export type { SmartSortRuleService } from "../service/smart-sort-rule/smart-sort-rule.port.js";
export type {
  SmartSortRuleMoveTarget,
  SmartSortRulePreviewDraft,
  SmartSortRulePreviewLine,
  SmartSortRulePreviewResult,
} from "../service/smart-sort-rule/smart-sort-rule.port.js";
