import { readFile } from "node:fs/promises";
import { type VfsService } from "@novel-master/core/vfs";
import { type AppError, Result } from "@novel-master/core/errors";
import { RESULT_OK } from "../../cli-errors.js";
import { parseCliArgs } from "../parse-args.js";

export async function runWrite(
  vfs: VfsService,
  args: readonly string[],
): Promise<Result<void, AppError>> {
  const { positional, flags } = parseCliArgs(args);
  const path = positional[0];
  if (path == null) {
    throw new Error(
      "Usage: novel-master vfs write <path> [--text <content>] [--file <path>]",
    );
  }

  const fileFlag = flags.get("file");
  const textFlag = flags.get("text");
  if (typeof fileFlag === "string" && typeof textFlag === "string") {
    throw new Error("Cannot use both --file and --text");
  }

  const content =
    typeof fileFlag === "string"
      ? await readFile(fileFlag, "utf8")
      : typeof textFlag === "string"
        ? textFlag
        : await readStdin();

  const result = await vfs.write(path, content);
  if (!result.ok) return Result.err(result.error);
  console.log(result.value.version);
  return RESULT_OK;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) {
    throw new Error("No content provided: pass --text, --file, or stdin");
  }
  return Buffer.concat(chunks).toString("utf8");
}
