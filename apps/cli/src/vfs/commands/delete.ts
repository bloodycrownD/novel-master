import { type VfsService } from "@novel-master/core/vfs";
import { type AppError, type Result } from "@novel-master/core/errors";
import { parseCliArgs } from "../parse-args.js";

export async function runDelete(vfs: VfsService, args: readonly string[]): Promise<Result<void, AppError>> {
  const { positional, flags } = parseCliArgs(args);
  const path = positional[0];
  if (path == null) {
    throw new Error("Usage: novel-master vfs delete <path> [-r|--recursive]");
  }

  return vfs.delete(path, {
    recursive: flags.has("recursive") || flags.has("r"),
  });
}
