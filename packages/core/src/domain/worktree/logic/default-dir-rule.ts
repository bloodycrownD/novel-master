/**
 * Default directory rule when no per-path rule is stored.
 *
 * @module domain/worktree/logic/default-dir-rule
 */

import type { FillPolicy, SortField, SortOrder } from "../model/worktree-types.js";

/** Applied when {@link WorktreeDirRule} is missing for a directory with rules enabled. */
export const DEFAULT_WORKTREE_DIR_RULE = {
  sortField: "name" as const satisfies SortField,
  sortOrder: "asc" as const satisfies SortOrder,
  headCount: 0,
  tailCount: 1000,
  fillPolicy: "full" as const satisfies FillPolicy,
} as const;
