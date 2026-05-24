/**
 * `nm session worktree` subcommands.
 *
 * @module session/worktree
 */

import type { NovelMasterRuntime } from "../runtime.js";
import { runWorktree } from "../worktree/run-worktree.js";
import { parseCliArgs } from "../vfs/parse-args.js";

type SessionWorktreeDeps = Pick<NovelMasterRuntime, "scope" | "worktree">;

export async function runSessionWorktree(
  rt: SessionWorktreeDeps,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const { projectId, sessionId } = rt.scope.resolveProjectSession(flags);
  const wt = rt.worktree({ kind: "session", projectId, sessionId });
  const rest = args[0] === "worktree" ? args.slice(1) : args;
  await runWorktree(wt, rest);
}
