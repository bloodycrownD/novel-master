/**
 * Worktree display state evaluation (pure functions).
 *
 * @module domain/worktree/worktree-eval
 */

import type {
  DisplayState,
  FillPolicy,
  InclusionMode,
  SortField,
  SortOrder,
  WorktreeDirRule,
} from "../model/worktree-types.js";
import { DEFAULT_WORKTREE_DIR_RULE } from "./default-dir-rule.js";

/** File metadata used for sorting within a directory. */
export interface WorktreeFileSortMeta {
  readonly logicalPath: string;
  readonly mtimeMs: number;
}

/**
 * Indices in a sorted auto-file list that belong to the head/tail priority set.
 */
export function computeHeadTailIndices(
  totalCount: number,
  head: number,
  tail: number,
): Set<number> {
  const indices = new Set<number>();
  for (let i = 0; i < head && i < totalCount; i++) {
    indices.add(i);
  }
  for (let i = 0; i < tail && i < totalCount; i++) {
    indices.add(totalCount - 1 - i);
  }
  return indices;
}

function basename(logicalPath: string): string {
  const idx = logicalPath.lastIndexOf("/");
  return idx >= 0 ? logicalPath.slice(idx + 1) : logicalPath;
}

function fileExtension(logicalPath: string): string {
  const base = basename(logicalPath);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot) : "";
}

function compareStrings(a: string, b: string, order: SortOrder): number {
  const cmp = a.localeCompare(b);
  return order === "asc" ? cmp : -cmp;
}

function compareNumbers(a: number, b: number, order: SortOrder): number {
  const cmp = a - b;
  return order === "asc" ? cmp : -cmp;
}

/**
 * Sorts direct child files using directory rule (or name asc default).
 */
export function sortFilesForDir(
  files: readonly WorktreeFileSortMeta[],
  dirRule: WorktreeDirRule | null,
): WorktreeFileSortMeta[] {
  const sortField: SortField =
    dirRule?.sortField ?? DEFAULT_WORKTREE_DIR_RULE.sortField;
  const sortOrder: SortOrder =
    dirRule?.sortOrder ?? DEFAULT_WORKTREE_DIR_RULE.sortOrder;
  const sorted = [...files];
  sorted.sort((a, b) => {
    switch (sortField) {
      case "name":
        return compareStrings(basename(a.logicalPath), basename(b.logicalPath), sortOrder);
      case "created":
      case "updated":
        return compareNumbers(a.mtimeMs, b.mtimeMs, sortOrder);
    }
  });
  return sorted;
}

/**
 * Evaluates display state for one file under its parent directory.
 */
export function evaluateFileDisplay(params: {
  readonly inclusion: InclusionMode;
  readonly parentRuleOn: boolean;
  readonly dirRule: WorktreeDirRule | null;
  readonly indexInSortedAutoFiles: number;
  readonly autoFileCount: number;
  readonly logicalPath: string;
}): DisplayState {
  if (params.inclusion === "hide") {
    return "hidden";
  }
  if (params.inclusion === "show") {
    return "full";
  }
  if (!params.parentRuleOn) {
    return "hidden";
  }
  const head = params.dirRule?.headCount ?? DEFAULT_WORKTREE_DIR_RULE.headCount;
  const tail = params.dirRule?.tailCount ?? DEFAULT_WORKTREE_DIR_RULE.tailCount;
  const fill: FillPolicy =
    params.dirRule?.fillPolicy ?? DEFAULT_WORKTREE_DIR_RULE.fillPolicy;
  const priority = computeHeadTailIndices(
    params.autoFileCount,
    head,
    tail,
  );
  if (priority.has(params.indexInSortedAutoFiles)) {
    return "full";
  }
  if (fill === "hidden") {
    return "hidden";
  }
  if (fill === "full") {
    return "full";
  }
  if (fill === "filename") {
    return "filename";
  }
  const ext = fileExtension(params.logicalPath).toLowerCase();
  if (ext !== ".md" && ext !== ".markdown") {
    return "hidden";
  }
  return "header";
}

/**
 * Sorts sibling directory paths using the parent directory's rule (name + order).
 */
export function sortDirPaths(
  paths: readonly string[],
  parentDirRule: WorktreeDirRule | null,
): string[] {
  const sortOrder: SortOrder = parentDirRule?.sortOrder ?? "asc";
  const sorted = [...paths];
  sorted.sort((a, b) => {
    const nameCmp = compareStrings(basename(a), basename(b), sortOrder);
    if (nameCmp !== 0) {
      return nameCmp;
    }
    return compareStrings(a, b, sortOrder);
  });
  return sorted;
}
