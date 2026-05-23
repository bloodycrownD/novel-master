import type { VfsService } from "@novel-master/core";
import { parseCliArgs } from "../parse-args.js";

export async function runReplace(
  vfs: VfsService,
  args: readonly string[],
): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const path = positional[0];
  const oldString = positional[1];
  const newString = positional[2];
  if (path == null || oldString == null || newString == null) {
    throw new Error(
      "Usage: novel-master vfs replace <path> <old> <new> [--all]",
    );
  }

  const result = await vfs.replace(path, oldString, newString, {
    replaceAll: flags.has("all"),
  });
  console.log(`${result.version}\t${result.replacements}`);
}
