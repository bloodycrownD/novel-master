/**
 * `nm session workplace` subcommands.
 *
 * @module session/workplace
 */

import type { NovelMasterRuntime } from "../runtime.js";
import { runWorkplace } from "../workplace/run-workplace.js";
import { parseCliArgs } from "../vfs/parse-args.js";

type SessionWorkplaceDeps = Pick<NovelMasterRuntime, "scope" | "workplace">;

export async function runSessionWorkplace(
  rt: SessionWorkplaceDeps,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const { projectId, sessionId } = await rt.scope.resolveProjectSession(flags);
  const wt = rt.workplace({ kind: "session", projectId, sessionId });
  const rest = args[0] === "workplace" ? args.slice(1) : args;
  await runWorkplace(wt, rest);
}
