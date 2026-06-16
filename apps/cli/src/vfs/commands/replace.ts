import { type VfsService } from "@novel-master/core/vfs";
import { parseCliArgs } from "../parse-args.js";

export async function runReplace(
  vfs: VfsService,
  args: readonly string[],
): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const path = positional[0];
  const oldFromFlag = flags.get("old");
  const newFromFlag = flags.get("new");
  const oldString =
    typeof oldFromFlag === "string" ? oldFromFlag : positional[1];
  const newString =
    typeof newFromFlag === "string" ? newFromFlag : positional[2];

  if (path == null || oldString == null || newString == null) {
    throw new Error(
      "Usage: novel-master vfs replace <path> <old> <new> [--all]\n" +
        "   or: novel-master vfs replace <path> --old <old> --new <new> [--all]",
    );
  }

  if (
    (typeof oldFromFlag === "string") !== (typeof newFromFlag === "string")
  ) {
    throw new Error("replace requires both --old and --new when using flags");
  }

  const result = await vfs.replace(path, oldString, newString, {
    replaceAll: flags.has("all"),
  });
  console.log(`${result.version}\t${result.replacements}`);
}
