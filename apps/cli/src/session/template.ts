/**
 * `nm session template pull`.
 *
 * @module session/template
 */

import { type AppError, Result } from "@novel-master/core/errors";
import type { NovelMasterRuntime } from "../runtime.js";
import { RESULT_OK } from "../cli-errors.js";
import { parseCliArgs } from "../vfs/parse-args.js";

/**
 * scope / pullTemplate 的 `Result` 失败沿返回值交给上层（错误通道迁移四期），
 * 由 runSession 转 `Outcome.failed` 交回 main 边界统一出口。
 */
export async function runSessionTemplate(
  rt: Pick<NovelMasterRuntime, "sessions" | "scope">,
  sub: string,
  args: readonly string[],
): Promise<Result<void, AppError>> {
  if (sub !== "pull") {
    throw new Error(
      "Usage: nm session template pull [--project <id>] [--session <id>]",
    );
  }
  const { flags } = parseCliArgs(args);
  const resolvedSession = await rt.scope.resolveSessionId(flags);
  if (!resolvedSession.ok) return Result.err(resolvedSession.error);
  const pulled = await rt.sessions.pullTemplate(resolvedSession.value);
  if (!pulled.ok) return pulled;
  return RESULT_OK;
}
