import { readFile } from "node:fs/promises";
import { type TdbcConnection } from "@novel-master/core";

import { createVfsZipIoService, type VfsScope } from "@novel-master/core/vfs";
import { parseCliArgs } from "../parse-args.js";

export async function runImportZip(
  conn: TdbcConnection,
  scope: VfsScope,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const file = flags.get("file");
  if (typeof file !== "string" || file === "") {
    throw new Error("Usage: import-zip --file <path> [--yes]");
  }
  const confirmed = flags.get("yes") === true;

  const raw = await readFile(file);
  const zipSvc = createVfsZipIoService(conn);
  await zipSvc.import(scope, new Uint8Array(raw), { confirmed });
}
