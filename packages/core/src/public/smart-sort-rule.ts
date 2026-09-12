/**
 * Public exports for smart sort rule management (`@novel-master/core/smart-sort-rule`).
 *
 * @module public/smart-sort-rule
 */

export { SmartSortRuleError } from "../errors/smart-sort-rule-errors.js";
export type { SmartSortRuleErrorCode } from "../errors/smart-sort-rule-errors.js";
export {
  BUILTIN_SMART_SORT_RULE_ID_PREFIX,
  isBuiltinSmartSortRuleId,
} from "../domain/smart-sort-rule/model/smart-sort-rule.js";
export type { SmartSortRule } from "../domain/smart-sort-rule/model/smart-sort-rule.js";
export {
  createSmartSortRuleSchema,
  updateSmartSortRuleSchema,
} from "../domain/smart-sort-rule/model/smart-sort-rule.schema.js";
export type {
  CreateSmartSortRuleInput,
  UpdateSmartSortRuleInput,
} from "../domain/smart-sort-rule/model/smart-sort-rule.schema.js";
export {
  SMART_SORT_RULE_BUNDLE_SCHEMA_VERSION,
  smartSortRuleBundleDocumentSchema,
  encodeSmartSortRuleBundle,
  decodeSmartSortRuleBundle,
} from "../domain/smart-sort-rule/model/smart-sort-rule-io.js";
export type {
  SmartSortRuleBundleDocument,
  SmartSortRuleBundleRule,
} from "../domain/smart-sort-rule/model/smart-sort-rule-io.js";
export {
  compileSmartSortRule,
  validateSmartSortRuleDraft,
} from "../domain/smart-sort-rule/logic/compile-smart-sort-rule.js";
export type { SmartSortRuleValidationFields } from "../domain/smart-sort-rule/logic/compile-smart-sort-rule.js";
export {
  matchSmartSortPattern,
} from "../domain/smart-sort-rule/logic/match-smart-sort-pattern.js";
export type {
  MatchSmartSortPatternResult,
  MatchSmartSortPatternOk,
  MatchSmartSortPatternErr,
  SmartSortPatternMatch,
} from "../domain/smart-sort-rule/logic/match-smart-sort-pattern.js";
export {
  formatPatternInput,
  parsePatternInput,
} from "../domain/smart-sort-rule/logic/parse-pattern-input.js";
export type { ParsedPatternInput } from "../domain/smart-sort-rule/logic/parse-pattern-input.js";
export type { CompiledSmartSortRule } from "../domain/workplace/logic/smart-sort.js";
export { createSmartSortRuleService } from "../service/smart-sort-rule/create-smart-sort-rule.service.js";
export type { SmartSortRuleService } from "../service/smart-sort-rule/smart-sort-rule.port.js";
export type {
  SmartSortRuleMoveTarget,
  SmartSortRulePreviewDraft,
  SmartSortRulePreviewLine,
  SmartSortRulePreviewResult,
} from "../service/smart-sort-rule/smart-sort-rule.port.js";
