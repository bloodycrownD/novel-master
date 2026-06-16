import { type VfsService } from "@novel-master/core/vfs";
import { parseCliArgs } from "../parse-args.js";

export async function runGlob(vfs: VfsService, args: readonly string[]): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const pattern = positional[0];
  if (pattern == null) {
    throw new Error("Usage: novel-master vfs glob <pattern> [--cwd <dir>]");
  }

  const cwdFlag = flags.get("cwd");
  const cwd = typeof cwdFlag === "string" ? cwdFlag : undefined;
  const paths = await vfs.glob(pattern, { cwd });
  for (const path of paths) {
    console.log(path);
  }
}
