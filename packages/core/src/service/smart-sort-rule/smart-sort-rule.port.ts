/**
 * Smart sort rule application service port (spec Step 7).
 *
 * @module service/smart-sort-rule/smart-sort-rule.port
 */

import type { CompiledSmartSortRule } from "@/domain/workplace/logic/smart-sort.js";
import type {
  SmartSortCaptureKind,
  SmartSortRule,
} from "@/domain/smart-sort-rule/model/smart-sort-rule.js";
import type { SmartSortRuleBundleDocument } from "@/domain/smart-sort-rule/model/smart-sort-rule-io.js";
import type {
  CreateSmartSortRuleInput,
  UpdateSmartSortRuleInput,
} from "@/domain/smart-sort-rule/model/smart-sort-rule.schema.js";

/** moveRule 目标：top/bottom/up/down 或绝对位次 { index }。 */
export type SmartSortRuleMoveTarget =
  | "top"
  | "bottom"
  | "up"
  | "down"
  | { readonly index: number };

/** 预览输入草稿（编辑器半成品规则；SmartSortRule 结构兼容）。 */
export interface SmartSortRulePreviewDraft {
  readonly ruleId: string;
  readonly name: string;
  readonly pattern: string;
  readonly flags: string;
  /** 捕获档位（D13）：缺省 smart。 */
  readonly captureKind?: SmartSortCaptureKind;
}

/** 预览单行：输入顺序逐行给出命中规则与序号元组。 */
export interface SmartSortRulePreviewLine {
  readonly name: string;
  readonly matchedRuleId: string | null;
  readonly nums: readonly number[] | null;
}

/** previewSort 输出：逐行明细 + 排序后顺序。 */
export interface SmartSortRulePreviewResult {
  readonly lines: readonly SmartSortRulePreviewLine[];
  readonly sortedNames: readonly string[];
}

/** Application service for smart sort rules (flat table, spec D2). */
export interface SmartSortRuleService {
  listRules(): Promise<SmartSortRule[]>;

  createRule(input: CreateSmartSortRuleInput): Promise<SmartSortRule>;

  updateRule(
    ruleId: string,
    patch: UpdateSmartSortRuleInput
  ): Promise<SmartSortRule>;

  /** 删除用户规则；`builtin-` 前缀一律拒绝（仅可禁用，spec D3）。 */
  deleteRule(ruleId: string): Promise<void>;

  /** 批量删除；任一 `builtin-` 前缀则整体拒绝。 */
  deleteBatch(ruleIds: readonly string[]): Promise<void>;

  setEnabled(ruleId: string, enabled: boolean): Promise<SmartSortRule>;

  setEnabledBatch(ruleIds: readonly string[], enabled: boolean): Promise<void>;

  /** 调序（整表重编号，D2）；返回重排后的全量列表。 */
  moveRule(ruleId: string, to: SmartSortRuleMoveTarget): Promise<SmartSortRule[]>;

  /** 按给定 id 顺序整表重排（须恰好覆盖全部规则）。 */
  reorderRules(orderedIds: readonly string[]): Promise<SmartSortRule[]>;

  /** 全量导出（按 sortOrder）为 bundle 文档。 */
  exportRules(): Promise<SmartSortRuleBundleDocument>;

  /** 替换式导入（清空全部含内置 → 按文件顺序插入，D10）。 */
  importRules(raw: unknown): Promise<SmartSortRule[]>;

  /** 删除 `builtin-%` 后重灌内置规则，用户规则不动。 */
  resetDefaults(): Promise<void>;

  /**
   * 排序测试（纯方法，D11）：给定规则集（缺省用库内启用规则）+ 文件名
   * 列表，返回逐行命中明细与排序后顺序。
   */
  previewSort(
    names: readonly string[],
    draftRules?: readonly SmartSortRulePreviewDraft[]
  ): Promise<SmartSortRulePreviewResult>;

  /** 启用规则按 sortOrder 预编译（workplace 排序输入）。 */
  listCompiledRules(): Promise<CompiledSmartSortRule[]>;
}
