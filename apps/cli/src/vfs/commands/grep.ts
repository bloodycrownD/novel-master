import type { VfsService } from "@novel-master/core";
import { parseCliArgs } from "../parse-args.js";

export async function runGrep(vfs: VfsService, args: readonly string[]): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const pattern = positional[0];
  if (pattern == null) {
    throw new Error("Usage: novel-master vfs grep <pattern> [--path-prefix <dir>]");
  }

  const prefixFlag = flags.get("path-prefix");
  const pathPrefix =
    typeof prefixFlag === "string" ? prefixFlag : undefined;
  const matches = await vfs.grep(pattern, { pathPrefix });
  for (const match of matches) {
    console.log(`${match.path}:${match.line}:${match.excerpt}`);
  }
}
