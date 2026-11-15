import { type VfsService } from "@novel-master/core/vfs";
import { type AppError, Result } from "@novel-master/core/errors";
import { RESULT_OK } from "../../cli-errors.js";
import { parseCliArgs } from "../parse-args.js";

export async function runGrep(vfs: VfsService, args: readonly string[]): Promise<Result<void, AppError>> {
  const { positional, flags } = parseCliArgs(args);
  const pattern = positional[0];
  if (pattern == null) {
    throw new Error("Usage: novel-master vfs grep <pattern> [--path-prefix <dir>]");
  }

  const prefixFlag = flags.get("path-prefix");
  const pathPrefix =
    typeof prefixFlag === "string" ? prefixFlag : undefined;
  const grepResult = await vfs.grep(pattern, { pathPrefix });
  if (!grepResult.ok) return Result.err(grepResult.error);
  for (const match of grepResult.value) {
    console.log(`${match.path}:${match.line}:${match.excerpt}`);
  }
  return RESULT_OK;
}
