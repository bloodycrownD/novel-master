/**
 * Worktree application service port.
 *
 * @module service/worktree/worktree.port
 */

import type {
  SetDirRuleInput,
  SetFileRuleInput,
  WorktreeListRow,
  WorktreeScope,
} from "@/domain/worktree/model/worktree-types.js";

/** Worktree configuration and display operations for one VFS scope. */
export interface WorktreeService {
  readonly scope: WorktreeScope;

  setDirRule(input: SetDirRuleInput): Promise<void>;

  setFileRule(input: SetFileRuleInput): Promise<void>;

  /** Full tree listing rows (without TSV header). */
  buildListRows(): Promise<WorktreeListRow[]>;

  /** Renders `<file>` blocks for visible files. */
  renderDisplay(): Promise<string>;
}
