import type { VfsService } from "@novel-master/core";
import { parseCliArgs } from "../parse-args.js";

export async function runList(vfs: VfsService, args: readonly string[]): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const dir = positional[0] ?? "/";
  const recursive = flags.has("recursive") || flags.has("r");
  const depthRaw = flags.get("depth");
  const maxDepth =
    typeof depthRaw === "string" ? Number.parseInt(depthRaw, 10) : undefined;

  const paths = await vfs.list(dir, {
    recursive,
    maxDepth: recursive ? maxDepth : undefined,
  });
  for (const path of paths) {
    console.log(path);
  }
}
