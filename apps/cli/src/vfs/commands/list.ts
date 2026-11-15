import { type VfsService } from "@novel-master/core/vfs";
import { type AppError, Result } from "@novel-master/core/errors";
import { RESULT_OK } from "../../cli-errors.js";
import { parseCliArgs } from "../parse-args.js";

export async function runList(vfs: VfsService, args: readonly string[]): Promise<Result<void, AppError>> {
  const { positional, flags } = parseCliArgs(args);
  const dir = positional[0] ?? "/";
  const recursive = flags.has("recursive") || flags.has("r");
  const depthRaw = flags.get("depth");
  const maxDepth =
    typeof depthRaw === "string" ? Number.parseInt(depthRaw, 10) : undefined;

  const entries = await vfs.list(dir, {
    recursive,
    maxDepth: recursive ? maxDepth : undefined,
  });
  if (!entries.ok) return Result.err(entries.error);
  for (const entry of entries.value) {
    const kindLabel = entry.kind === "directory" ? "DIR" : "FILE";
    console.log(`${kindLabel}\t${entry.path}`);
  }
  return RESULT_OK;
}
