/**
 * `nm vfs workplace` (global scope).
 *
 * @module vfs/workplace
 */

import type { NovelMasterRuntime } from "../runtime.js";
import { runWorkplace } from "../workplace/run-workplace.js";

export async function runVfsWorkplace(
  rt: NovelMasterRuntime,
  args: readonly string[],
): Promise<void> {
  const wt = rt.workplace({ kind: "global" });
  await runWorkplace(wt, args);
}
