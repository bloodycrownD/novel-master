import type { VfsService } from "@novel-master/core";
import { parseCliArgs } from "../parse-args.js";

export async function runDelete(
  vfs: VfsService,
  args: readonly string[],
): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const path = positional[0];
  if (path == null) {
    throw new Error("Usage: novel-master vfs delete <path> [-r|--recursive]");
  }

  await vfs.delete(path, {
    recursive: flags.has("recursive") || flags.has("r"),
  });
}
