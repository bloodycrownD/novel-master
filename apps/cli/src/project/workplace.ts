/**
 * `nm project workplace` subcommands.
 *
 * @module project/workplace
 */

import type { NovelMasterRuntime } from "../runtime.js";
import { runWorkplace } from "../workplace/run-workplace.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runProjectWorkplace(
  rt: NovelMasterRuntime,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const projectId = await rt.scope.resolveProjectId(flags);
  const wt = rt.workplace({ kind: "project", projectId });
  const rest = args[0] === "workplace" ? args.slice(1) : args;
  await runWorkplace(wt, rest);
}
