import { writeFile } from "node:fs/promises";
import { type TdbcConnection } from "@novel-master/core";

import { createVfsZipIoService, type VfsScope } from "@novel-master/core/vfs";
import { type AppError, Result } from "@novel-master/core/errors";
import { RESULT_OK } from "../../cli-errors.js";
import { parseCliArgs } from "../parse-args.js";

export async function runExportZip(conn: TdbcConnection, scope: VfsScope, args: readonly string[]): Promise<Result<void, AppError>> {
  const { flags } = parseCliArgs(args);
  const out = flags.get("out");
  if (typeof out !== "string" || out === "") {
    throw new Error("Usage: export-zip --out <path> [--path <directoryPath>]");
  }
  const pathFlag = flags.get("path");
  const directoryPath = typeof pathFlag === "string" && pathFlag !== "" ? pathFlag : "/";

  const zipSvc = createVfsZipIoService(conn);
  const exported = await zipSvc.export(scope, { directoryPath });
  if (!exported.ok) return Result.err(exported.error);
  await writeFile(out, exported.value);
  return RESULT_OK;
}
