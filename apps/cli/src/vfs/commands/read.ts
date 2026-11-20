import { type VfsService } from "@novel-master/core/vfs";
import { type AppError, Result } from "@novel-master/core/errors";
import { RESULT_OK } from "../../cli-errors.js";
import { parseCliArgs } from "../parse-args.js";

export async function runRead(vfs: VfsService, args: readonly string[]): Promise<Result<void, AppError>> {
  const { positional, flags } = parseCliArgs(args);
  const path = positional[0];
  if (path == null) {
    throw new Error("Usage: novel-master vfs read <path> [--meta]");
  }

  const result = await vfs.read(path);
  if (flags.has("meta")) {
    console.log(JSON.stringify(result));
    return RESULT_OK;
  }
  if (!result.ok) return Result.err(result.error);
  process.stdout.write(result.value.content);
  return RESULT_OK;
}
