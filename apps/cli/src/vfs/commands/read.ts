import { type VfsService } from "@novel-master/core/vfs";
import { parseCliArgs } from "../parse-args.js";

export async function runRead(vfs: VfsService, args: readonly string[]): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const path = positional[0];
  if (path == null) {
    throw new Error("Usage: novel-master vfs read <path> [--meta]");
  }

  const result = await vfs.read(path);
  if (flags.has("meta")) {
    console.log(JSON.stringify(result));
    return;
  }
  process.stdout.write(result.content);
}
