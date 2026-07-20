/**
 * `nm vfs worktree` (global scope).
 *
 * @module vfs/worktree
 */

import type { NovelMasterRuntime } from "../runtime.js";
import { runWorktree } from "../worktree/run-worktree.js";

export async function runVfsWorktree(
  rt: NovelMasterRuntime,
  args: readonly string[],
): Promise<void> {
  const wt = rt.worktree({ kind: "global" });
  await runWorktree(wt, args);
}
