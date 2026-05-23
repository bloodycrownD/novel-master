import { readFile } from "node:fs/promises";
import { stdin } from "node:process";
import type { VfsService, WriteOptions } from "@novel-master/core";
import { VfsError } from "@novel-master/core";
import { parseCliArgs } from "../parse-args.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runWrite(vfs: VfsService, args: readonly string[]): Promise<void> {
  const { positional, flags } = parseCliArgs(args);
  const path = positional[0];
  if (path == null) {
    throw new Error(
      "Usage: novel-master vfs write <path> [--file <path>] [--version <n>] [--no-version-check]",
    );
  }

  const fileFlag = flags.get("file");
  const content =
    typeof fileFlag === "string"
      ? await readFile(fileFlag, "utf8")
      : await readStdin();

  const versionFlag = flags.get("version");
  const options: WriteOptions = {
    ...(flags.has("no-version-check") ? { versionCheck: false } : {}),
    ...(typeof versionFlag === "string"
      ? { expectedVersion: Number.parseInt(versionFlag, 10) }
      : {}),
  };

  try {
    const existing = await vfs.read(path);
    if (!flags.has("no-version-check") && flags.get("version") == null) {
      throw new VfsError(
        "CONFLICT",
        `Path exists; pass --version ${existing.version} or --no-version-check`,
        { path },
      );
    }
  } catch (error) {
    if (!(error instanceof VfsError) || error.code !== "NOT_FOUND") {
      throw error;
    }
  }

  const result = await vfs.write(path, content, options);
  console.log(result.version);
}
