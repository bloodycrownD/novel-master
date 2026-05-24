/**
 * `nm project worktree` subcommands.
 *
 * @module project/worktree
 */

import type { NovelMasterRuntime } from "../runtime.js";
import { runWorktree } from "../worktree/run-worktree.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runProjectWorktree(
  rt: NovelMasterRuntime,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const projectId = rt.scope.resolveProjectId(flags);
  const wt = rt.worktree({ kind: "project", projectId });
  const rest = args[0] === "worktree" ? args.slice(1) : args;
  await runWorktree(wt, rest);
}
