/**
 * `nm project template pull`.
 *
 * @module project/template
 */

import type { NovelMasterRuntime } from "../runtime.js";
import { parseCliArgs } from "../vfs/parse-args.js";

export async function runProjectTemplate(
  rt: Pick<NovelMasterRuntime, "projects" | "scope">,
  sub: string,
  args: readonly string[],
): Promise<void> {
  if (sub !== "pull") {
    throw new Error("Usage: nm project template pull [--project <id>]");
  }
  const { flags } = parseCliArgs(args);
  const projectId = rt.scope.resolveProjectId(flags);
  await rt.projects.pullTemplate(projectId);
}
