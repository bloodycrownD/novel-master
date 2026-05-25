/**
 * `nm session template pull`.
 *
 * @module session/template
 */

import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runSessionTemplate(
  rt: Pick<NovelMasterRuntime, "sessions" | "scope">,
  sub: string,
  args: readonly string[],
): Promise<void> {
  if (sub !== "pull") {
    throw new Error(
      "Usage: nm session template pull [--project <id>] [--session <id>]",
    );
  }
  const { flags } = parseCliArgs(args);
  const sessionId = await rt.scope.resolveSessionId(flags);
  await rt.sessions.pullTemplate(sessionId);
}
