import { writeFile } from "node:fs/promises";
import { type TdbcConnection } from "@novel-master/core";

import { createVfsZipIoService, type VfsScope } from "@novel-master/core/vfs";
import { parseCliArgs } from "../parse-args.js";

export async function runExportZip(
  conn: TdbcConnection,
  scope: VfsScope,
  args: readonly string[],
): Promise<void> {
  const { flags } = parseCliArgs(args);
  const out = flags.get("out");
  if (typeof out !== "string" || out === "") {
    throw new Error("Usage: export-zip --out <path>");
  }

  const zipSvc = createVfsZipIoService(conn);
  const bytes = await zipSvc.export(scope);
  await writeFile(out, bytes);
}
