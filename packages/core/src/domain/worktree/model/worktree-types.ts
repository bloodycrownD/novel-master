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
export type FillPolicy = "hidden" | "filename" | "header";

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

/** One row in worktree list TSV output. */
export interface WorktreeListRow {
  readonly kind: "dir" | "file";
  readonly path: string;
  readonly ruleState: string;
  readonly inclusionMode: string;
  readonly displayState: string;
}

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
