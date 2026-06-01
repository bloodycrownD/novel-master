import type { VfsService } from "@novel-master/core";
import { parseCliArgs } from "../parse-args.js";

export async function runMkdir(
  vfs: VfsService,
  args: readonly string[],
): Promise<void> {
  const { positional } = parseCliArgs(args);
  const path = positional[0];
  if (path == null) {
    throw new Error("Usage: novel-master vfs mkdir <path>");
  }
  await vfs.mkdir(path);
}
