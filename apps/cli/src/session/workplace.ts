/**
 * `nm session workplace` subcommands.
 *
 * `display` 走 {@link assembleWorkplaceDisplay}（与 Agent 常驻前缀同源），
 * 见 `run-workplace` 模块头注释「display 双路径」。
 *
 * @module session/workplace
 */

import type { NovelMasterRuntime } from "../runtime.js";
import { runWorkplace } from "../workplace/run-workplace.js";
import { parseCliArgs } from "../vfs/parse-args.js";

type SessionWorkplaceDeps = Pick<
  NovelMasterRuntime,
  "scope" | "workplace" | "sessionKkv" | "sessionVfs"
>;

export async function runSessionWorkplace(
  rt: SessionWorkplaceDeps,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const { projectId, sessionId } = await rt.scope.resolveProjectSession(flags);
  const wt = rt.workplace({ kind: "session", projectId, sessionId });
  const rest = args[0] === "workplace" ? args.slice(1) : args;
  await runWorkplace(wt, rest, {
    projectId,
    sessionId,
    sessionKkv: rt.sessionKkv,
    vfs: rt.sessionVfs(projectId, sessionId),
  });
}
