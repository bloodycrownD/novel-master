/**
 * `nm project workplace` subcommands.
 *
 * `display` 无 session → 调试 live materialize（`renderDisplay`），
 * **不是**聊天前缀；见 `run-workplace` 模块头注释「display 双路径」。
 *
 * @module project/workplace
 */

import type { Outcome } from "@novel-master/core/workplace";
import type { NovelMasterRuntime } from "../runtime.js";
import { runWorkplace } from "../workplace/run-workplace.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runProjectWorkplace(
  rt: NovelMasterRuntime,
  args: readonly string[],
): Promise<Outcome<void>> {
  const { flags } = parseCliArgs(args);
  const resolvedProject = await rt.scope.resolveProjectId(flags);
  if (!resolvedProject.ok) return { kind: "failed", error: resolvedProject.error };
  const projectId = resolvedProject.value;
  const wt = rt.workplace({ kind: "project", projectId });
  const rest = args[0] === "workplace" ? args.slice(1) : args;
  return runWorkplace(wt, rest);
}
