/**
 * Worktree domain enums and DTOs.
 *
 * @module domain/worktree/model/worktree-types
 */

import type { VfsScope } from "@/domain/vfs/logic/vfs-path-mapper.js";

/** Worktree configuration scope (aligned with VFS scope). */
export type WorktreeScope = VfsScope;

/** Directory rule on/off. */
export type RuleState = "rule_on" | "rule_off";

/** File inclusion mode. */
export type InclusionMode = "auto" | "show" | "hide";

/** Computed file display state. */
export type DisplayState = "hidden" | "full" | "header" | "filename";

/** Directory sort field. */
export type SortField = "name" | "created" | "updated";

/** Directory sort direction. */
export type SortOrder = "asc" | "desc";

/** Fill policy for auto files outside head/tail set. */
export type FillPolicy = "hidden" | "filename" | "header" | "full";

/** Persisted directory rule row. */
export interface WorktreeDirRule {
  readonly scopeKey: string;
  readonly logicalPath: string;
  readonly ruleEnabled: boolean;
  readonly sortField: SortField;
  readonly sortOrder: SortOrder;
  readonly headCount: number;
  readonly tailCount: number;
  readonly fillPolicy: FillPolicy;
}

/** Persisted file rule row. */
export interface WorktreeFileRule {
  readonly scopeKey: string;
  readonly logicalPath: string;
  readonly inclusionMode: InclusionMode;
}

/** RuleEngine DFS 单行：目录行。 */
export type WorktreeDirRuleRow = {
  readonly kind: "dir";
  readonly path: string;
  readonly ruleState: RuleState;
};

/** RuleEngine DFS 单行：文件行。 */
export type WorktreeFileRuleRow = {
  readonly kind: "file";
  readonly path: string;
  readonly inclusionMode: InclusionMode;
  readonly displayState: DisplayState;
};

/** RuleEngine DFS 单行；dir / file 分支字段互斥。 */
export type WorktreeRuleRow = WorktreeDirRuleRow | WorktreeFileRuleRow;

/** 消费方 ① 列表行；与 {@link WorktreeRuleRow} 结构一致。 */
export type WorktreeListRow = WorktreeRuleRow;

/** Input for setting a directory rule via CLI/service. */
export interface SetDirRuleInput {
  readonly logicalPath: string;
  readonly ruleEnabled?: boolean;
  readonly sortField?: SortField;
  readonly sortOrder?: SortOrder;
  readonly headCount?: number;
  readonly tailCount?: number;
  readonly fillPolicy?: FillPolicy;
}

/** Input for setting a file rule. */
export interface SetFileRuleInput {
  readonly logicalPath: string;
  readonly inclusionMode: InclusionMode;
}
