/**
 * `nm vfs workplace` (global scope).
 *
 * `display` 无 session → 调试 live materialize（`renderDisplay`），
 * **不是**聊天前缀；见 `run-workplace` 模块头注释「display 双路径」。
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
