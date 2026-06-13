/**
 * Worktree application service port.
 *
 * @module service/worktree/worktree.port
 */

import type {
  SetDirRuleInput,
  SetFileRuleInput,
  WorktreeDirRule,
  WorktreeListRow,
  WorktreeScope,
} from "@/domain/worktree/model/worktree-types.js";

/** Single materialized worktree snapshot: list rows plus macro display strings. */
export interface WorktreeMaterialized {
  readonly listRows: readonly WorktreeListRow[];
  readonly worktreeDisplay: string;
  readonly filetreeDisplay: string;
}

/** Worktree configuration and display operations for one VFS scope. */
export interface WorktreeService {
  readonly scope: WorktreeScope;

  setDirRule(input: SetDirRuleInput): Promise<void>;

  getDirRule(logicalPath: string): Promise<WorktreeDirRule | undefined>;

  setFileRule(input: SetFileRuleInput): Promise<void>;

  /**
   * Materializes list rows and macro strings in one metadata-first DFS.
   * Display blocks lazily read file content only for `full` / `header` files.
   */
  materialize(): Promise<WorktreeMaterialized>;

  /** Full tree listing rows (without TSV header). */
  buildListRows(): Promise<WorktreeListRow[]>;

  /** Renders `<file>` blocks for visible files. */
  renderDisplay(): Promise<string>;

  /** Renders worktree-filtered ASCII directory tree（非 dynamic `{{$filetree}}`；后者走 VFS）。 */
  renderFileTree(): Promise<string>;
}
