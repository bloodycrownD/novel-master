import { type VfsService } from "@novel-master/core/vfs";
import { type AppError, Result } from "@novel-master/core/errors";
import { RESULT_OK } from "../../cli-errors.js";
import { parseCliArgs } from "../parse-args.js";

export async function runGlob(vfs: VfsService, args: readonly string[]): Promise<Result<void, AppError>> {
  const { positional, flags } = parseCliArgs(args);
  const pattern = positional[0];
  if (pattern == null) {
    throw new Error("Usage: novel-master vfs glob <pattern> [--cwd <dir>]");
  }

  const cwdFlag = flags.get("cwd");
  const cwd = typeof cwdFlag === "string" ? cwdFlag : undefined;
  const globResult = await vfs.glob(pattern, { cwd });
  if (!globResult.ok) return Result.err(globResult.error);
  for (const path of globResult.value) {
    console.log(path);
  }
  return RESULT_OK;
}
